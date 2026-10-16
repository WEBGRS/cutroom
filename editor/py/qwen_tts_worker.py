"""Cutroom local voice: Qwen3-TTS worker.

One JSON request per stdin line, one JSON reply per stdout line:
  {"id": 1, "op": "ping"}
  {"id": 2, "op": "speak", "text": "...", "lang": "zh", "ref": "a.wav", "ref_text": "...", "speed": 1, "out": "x.wav"}
  {"id": 3, "op": "design", "text": "...", "lang": "zh", "instruct": "...", "out": "ref.wav"}
Exits after --idle seconds without a request, or on {"op": "quit"}.
"""
import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time

# Replies go to the real stdout; anything libraries print goes to stderr
OUT = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr
# Requests are read from a copy of stdin and fd 0 becomes NUL: on Windows a DLL loaded during an import
# (SciPy's BLAS) blocks on stdin while the reader thread waits on it, which hangs the model load
IN = os.fdopen(os.dup(0), "rb")
_nul = os.open(os.devnull, os.O_RDONLY)
os.dup2(_nul, 0)
os.close(_nul)
sys.stdin = open(os.devnull, encoding="utf-8")

# PyTorch's import asks platform for the machine type, which on Windows queries WMI first; a stuck WMI
# service hangs it forever, and the fallback (the Windows version API) is all it needs
if sys.platform == "win32":
    import platform

    def _no_wmi(*a, **k):
        raise OSError("WMI not used")

    if hasattr(platform, "_wmi_query"):
        platform._wmi_query = _no_wmi

if os.environ.get("CUTROOM_QWEN_TRACE"):
    import faulthandler

    # Where every thread is after N seconds, for diagnosing a stuck worker
    faulthandler.dump_traceback_later(float(os.environ.get("CUTROOM_QWEN_TRACE_SECS", 30)), file=open(os.environ["CUTROOM_QWEN_TRACE"], "w"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

LANG = {"zh": "Chinese", "en": "English"}
BATCH = 4

ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--design", default="")
ap.add_argument("--idle", type=float, default=300)
ap.add_argument("--device", default="auto")
ap.add_argument("--ffmpeg", default="ffmpeg")
args = ap.parse_args()

lock = threading.Lock()
last = [time.time()]
busy = [0]
models = {}
prompts = {}


def reply(obj):
    with lock:
        try:
            OUT.write(json.dumps(obj, ensure_ascii=False) + "\n")
            OUT.flush()
        except (OSError, ValueError):
            # Nobody is listening any more
            os._exit(0)


def device():
    import torch

    if args.device != "auto":
        return args.device
    if torch.cuda.is_available():
        return "cuda:0"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


ST_DTYPE = {"BF16": "bfloat16", "F16": "float16", "F32": "float32", "F64": "float64", "I64": "int64", "I32": "int32", "I16": "int16", "I8": "int8", "U8": "uint8", "BOOL": "bool"}


# safetensors without memory mapping: each tensor is read from the file when asked for.
# Mapped reads crash with an access violation on Windows when memory is short.
class FileSafeOpen:
    def __init__(self, path, framework="pt", device="cpu"):
        import struct

        self.f = open(path, "rb")
        n = struct.unpack("<Q", self.f.read(8))[0]
        self.head = json.loads(self.f.read(n))
        self.meta = self.head.pop("__metadata__", None)
        self.base = 8 + n
        self.device = device

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.f.close()

    def keys(self):
        return list(self.head.keys())

    def metadata(self):
        return self.meta

    def get_tensor(self, k):
        import torch

        h = self.head[k]
        a, b = h["data_offsets"]
        self.f.seek(self.base + a)
        dt = getattr(torch, ST_DTYPE[h["dtype"]])
        if b == a:
            t = torch.empty(h["shape"], dtype=dt)
        else:
            t = torch.frombuffer(bytearray(self.f.read(b - a)), dtype=dt).reshape(h["shape"])
        return t if self.device in ("cpu", None) else t.to(self.device)

    def get_slice(self, k):
        return FileSlice(self, k)


class FileSlice:
    def __init__(self, src, k):
        self.src, self.k = src, k

    def get_dtype(self):
        return self.src.head[self.k]["dtype"]

    def get_shape(self):
        return list(self.src.head[self.k]["shape"])

    def __getitem__(self, idx):
        return self.src.get_tensor(self.k)[idx]


# Load one model kind; only one stays in memory so an 8 GB card has room
def model(kind):
    if kind in models:
        return models[kind]
    import torch
    import transformers.modeling_utils as mu
    from qwen_tts import Qwen3TTSModel

    mu.safe_open = FileSafeOpen

    for k in list(models):
        del models[k]
        prompts.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    dev = device()
    path = args.base if kind == "base" else args.design
    if not path:
        raise RuntimeError("no voice-design model")
    reply({"event": "loading", "model": kind, "device": dev})
    dtype = torch.bfloat16 if dev.startswith("cuda") else torch.float32
    models[kind] = Qwen3TTSModel.from_pretrained(path, device_map=dev, dtype=dtype, attn_implementation="sdpa")
    reply({"event": "ready", "model": kind, "device": dev})
    return models[kind]


# Seconds a line should take, for the token cap and the runaway check
def expected(text, lang):
    t = re.sub(r"\s+", " ", text)
    if lang == "zh":
        han = len(re.findall(r"[一-鿿]", t))
        words = len(re.findall(r"[A-Za-z]+", t))
        digits = len(re.findall(r"\d", t))
        return han / 4.5 + words * 0.4 + digits * 0.25 + 0.3
    return len(t.split()) / 2.6 + 0.3


def atempo(wav, sr, r):
    if abs(r - 1) < 1e-3 or len(wav) < sr * 0.05:
        return wav
    ff = shutil.which(args.ffmpeg) or (args.ffmpeg if os.path.exists(args.ffmpeg) else None)
    if ff:
        p = subprocess.run([ff, "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-filter:a", f"atempo={r}", "-f", "f32le", "-"], input=wav.astype(np.float32).tobytes(), capture_output=True)
        if p.returncode == 0 and p.stdout:
            return np.frombuffer(p.stdout, dtype=np.float32)
    import librosa

    return librosa.effects.time_stretch(wav.astype(np.float32), rate=r)


def prompt_for(m, ref, ref_text):
    key = (ref, os.path.getmtime(ref), ref_text or "")
    if key not in prompts:
        # A few voices stay ready; each one holds graphics memory
        while len(prompts) >= 3:
            del prompts[next(iter(prompts))]
        prompts[key] = m.create_voice_clone_prompt(ref_audio=ref, ref_text=ref_text or None, x_vector_only_mode=not ref_text)
    return prompts[key]


def free_cuda():
    import gc

    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def is_oom(e):
    return "out of memory" in str(e).lower() or type(e).__name__ == "OutOfMemoryError"


def speak(batch):
    try:
        speak_batch(batch)
    except Exception as e:  # noqa: BLE001
        if not is_oom(e) or len(batch) == 1:
            raise
        # Out of graphics memory: free what can be freed and go one line at a time
        free_cuda()
        for r in batch:
            speak_batch([r])


def speak_batch(batch):
    m = model("base")
    first = batch[0]
    vp = prompt_for(m, first["ref"], first.get("ref_text", ""))
    texts = [r["text"] for r in batch]
    langs = [LANG.get(r.get("lang", "zh"), "Chinese") for r in batch]
    secs = [expected(t, r.get("lang", "zh")) for t, r in zip(texts, batch)]
    todo = list(range(len(batch)))
    got = {}
    # A sampled line can run on or stop early; such lines get one more try
    for attempt in range(2):
        if not todo:
            break
        cap = int(12.5 * max(secs[i] for i in todo) * 2.2) + 60
        wavs, sr = m.generate_voice_clone(text=[texts[i] for i in todo], language=[langs[i] for i in todo], voice_clone_prompt=vp, max_new_tokens=cap)
        left = []
        for i, w in zip(todo, wavs):
            w = np.asarray(w, dtype=np.float32).reshape(-1)
            dur = len(w) / sr
            got[i] = w
            if attempt == 0 and (dur > secs[i] * 2.4 + 1 or dur < secs[i] * 0.3):
                left.append(i)
        todo = left
    for i, r in enumerate(batch):
        w = atempo(got[i], sr, float(r.get("speed", 1) or 1))
        sf.write(r["out"], w, sr, subtype="PCM_16")
        reply({"id": r["id"], "ok": True, "out": r["out"], "dur": round(len(w) / sr, 3)})


def design(r):
    m = model("design")
    wavs, sr = m.generate_voice_design(text=r["text"], language=LANG.get(r.get("lang", "zh"), "Chinese"), instruct=r["instruct"])
    w = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
    sf.write(r["out"], w, sr, subtype="PCM_16")
    reply({"id": r["id"], "ok": True, "out": r["out"], "dur": round(len(w) / sr, 3)})


inbox = queue.Queue()


def read():
    for line in IN:
        line = line.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            inbox.put(json.loads(line))
        except ValueError:
            reply({"ok": False, "error": "bad request"})
    inbox.put({"op": "quit"})


def watchdog():
    while True:
        time.sleep(5)
        if not busy[0] and inbox.empty() and time.time() - last[0] > args.idle:
            reply({"event": "idle-exit"})
            os._exit(0)


threading.Thread(target=read, daemon=True).start()
threading.Thread(target=watchdog, daemon=True).start()
reply({"event": "started", "pid": os.getpid()})

while True:
    r = inbox.get()
    busy[0] = 1
    last[0] = time.time()
    try:
        op = r.get("op")
        if op == "quit":
            break
        if op == "ping":
            reply({"id": r.get("id"), "ok": True, "device": device()})
        elif op == "load":
            model(r.get("model", "base"))
            reply({"id": r.get("id"), "ok": True})
        elif op == "design":
            design(r)
        elif op == "speak":
            # Lines sent together with the same voice go through the model as one batch
            batch = [r]
            time.sleep(0.03)
            held = []
            while len(batch) < BATCH:
                try:
                    n = inbox.get_nowait()
                except queue.Empty:
                    break
                if n.get("op") == "speak" and n.get("ref") == r.get("ref") and n.get("ref_text") == r.get("ref_text"):
                    batch.append(n)
                else:
                    held.append(n)
            for n in held:
                inbox.put(n)
            try:
                speak(batch)
            except Exception as e:  # noqa: BLE001
                for b in batch:
                    reply({"id": b.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:400], "restart": "CUDA" in str(e) or is_oom(e)})
                # A CUDA error spoils the rest of this process: leave, the editor starts a fresh one
                if "CUDA" in str(e) or is_oom(e):
                    os._exit(2)
        else:
            reply({"id": r.get("id"), "ok": False, "error": f"unknown op {op}"})
    except Exception as e:  # noqa: BLE001
        reply({"id": r.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
    finally:
        busy[0] = 0
        last[0] = time.time()
os._exit(0)
