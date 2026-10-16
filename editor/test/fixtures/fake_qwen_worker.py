# Stand-in for editor/py/qwen_tts_worker.py in tests: same protocol, writes a tone as long as the line would take
import json
import math
import os
import struct
import sys
import wave

LOG = os.environ.get("FAKE_QWEN_LOG")
out = sys.stdout


def reply(o):
    out.write(json.dumps(o, ensure_ascii=False) + "\n")
    out.flush()


reply({"event": "started", "pid": os.getpid()})
loaded = False
for line in sys.stdin.buffer:
    r = json.loads(line.decode("utf-8"))
    if LOG:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    if r.get("op") == "quit":
        break
    if os.environ.get("FAKE_QWEN_CRASH"):
        sys.stderr.write("RuntimeError: CUDA out of memory\n")
        sys.exit(3)
    if not loaded:
        reply({"event": "loading", "model": "base", "device": "cuda:0"})
        reply({"event": "ready", "model": "base", "device": "cuda:0"})
        loaded = True
    if r.get("op") in ("speak", "design"):
        sr = 24000
        n = int(sr * max(0.5, len(r["text"]) / 4.5) / float(r.get("speed", 1) or 1))
        with wave.open(r["out"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 8))) for i in range(n)))
        reply({"id": r["id"], "ok": True, "out": r["out"], "dur": round(n / sr, 3)})
    else:
        reply({"id": r.get("id"), "ok": True})
