"""Beat grid for a music track: BPM (catalog or autocorrelation), beat phase and downbeats.

  python tools/beats.py public/music/<track>.mp3 [--bpm 110]

Writes public/music/<track>.beats.json used by the beat-cut edit mode.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 22050
HOP = 512


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


# Spectral flux onset envelope, full band and low band (kick)
def onsets(x: np.ndarray):
    win = np.hanning(2048).astype(np.float32)
    n = 1 + (len(x) - 2048) // HOP
    frames = np.lib.stride_tricks.as_strided(x, shape=(n, 2048), strides=(x.strides[0] * HOP, x.strides[0]))
    mag = np.log1p(np.abs(np.fft.rfft(frames * win, axis=1)))
    flux = np.maximum(0, np.diff(mag, axis=0))
    low = flux[:, : int(200 / (SR / 2048))].sum(axis=1)
    full = flux.sum(axis=1)
    norm = lambda v: (v - v.mean()) / (v.std() + 1e-9)
    return norm(full), norm(low)


def catalog_bpm(path: Path):
    cat = Path(__file__).resolve().parents[1] / ".scratch" / "pieces.json"
    credits = json.loads((path.parent / "credits.json").read_text("utf-8")) if (path.parent / "credits.json").exists() else {}
    title = credits.get(path.name, {}).get("title")
    if not title or not cat.exists():
        return None
    for p in json.loads(cat.read_text("utf-8")):
        if p.get("title") == title:
            try:
                return float(p["bpm"])
            except (TypeError, ValueError):
                return None
    return None


def estimate_bpm(env: np.ndarray) -> float:
    fps = SR / HOP
    ac = np.correlate(env, env, "full")[len(env) - 1 :]
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    ok = (bpm >= 70) & (bpm <= 180)
    return float(bpm[ok][np.argmax(ac[ok])])


def score(env, period, offset, fps):
    t = np.arange(offset, len(env) / fps, period)
    idx = np.clip((t * fps).astype(int), 0, len(env) - 1)
    return env[idx].mean()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    ap.add_argument("--bpm", type=float)
    a = ap.parse_args()
    path = Path(a.track)
    x = decode(path)
    full, low = onsets(x)
    fps = SR / HOP
    bpm = a.bpm or catalog_bpm(path) or estimate_bpm(full)
    # Refine tempo and phase on the onset envelope
    best = (-1e9, bpm, 0.0)
    for b in np.arange(bpm - 0.6, bpm + 0.61, 0.05):
        period = 60 / b
        for off in np.arange(0, period, 1 / fps):
            s = score(full, period, off, fps)
            if s > best[0]:
                best = (s, b, off)
    _, bpm, offset = best
    period = 60 / bpm
    dur = len(x) / SR
    beats = np.arange(offset, dur, period)
    # Downbeat phase: strongest kick among the four positions in a bar
    idx = np.clip((beats * fps).astype(int), 0, len(low) - 1)
    phase = int(np.argmax([low[idx[p::4]].mean() for p in range(4)]))
    out = {
        "track": path.name,
        "bpm": round(float(bpm), 3),
        "period": round(float(period), 5),
        "offset": round(float(offset), 4),
        "duration": round(dur, 3),
        "beats": [round(float(b), 4) for b in beats],
        "downbeats": [round(float(b), 4) for b in beats[phase::4]],
        "confidence": round(float(best[0]), 3),
    }
    dst = path.with_suffix(".beats.json")
    dst.write_text(json.dumps(out), "utf-8")
    print(f"{path.name}: {out['bpm']} bpm, first downbeat {out['downbeats'][0]:.3f}s, confidence {out['confidence']}")


if __name__ == "__main__":
    sys.exit(main())
