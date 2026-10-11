// Pauses in speech: the parts of a recording worth keeping when long silences are cut out

export interface SpeechOptions {
  // Silences at least this long are removed (seconds)
  minSilence?: number;
  // Kept on each side of speech (seconds)
  pad?: number;
}

// Kept ranges [start, end] in seconds; the level threshold sits between the noise floor and the speech level
export function speechRanges(samples: Int16Array, rate: number, o: SpeechOptions = {}): { keep: [number, number][]; threshold: number } {
  const minSilence = o.minSilence ?? 0.5;
  const pad = o.pad ?? 0.12;
  const win = Math.max(1, Math.round(rate * 0.02));
  const n = Math.floor(samples.length / win);
  const db: number[] = [];
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = k * win; i < (k + 1) * win; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / win) / 32768;
    db.push(rms > 1e-6 ? 20 * Math.log10(rms) : -120);
  }
  const total = samples.length / rate;
  if (!n) return { keep: [[0, total]], threshold: -120 };
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.1)];
  const loud = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
  // Nothing loud enough to call speech: keep it all
  if (loud - floor < 12) return { keep: [[0, total]], threshold: loud };
  const threshold = Math.max(-60, floor + 0.35 * (loud - floor));
  const silences: [number, number][] = [];
  let runStart = -1;
  for (let k = 0; k <= n; k++) {
    const quiet = k < n && db[k] < threshold;
    if (quiet && runStart < 0) runStart = k;
    if (!quiet && runStart >= 0) {
      const a = (runStart * win) / rate;
      const b = (k * win) / rate;
      if (b - a >= minSilence) silences.push([a, b]);
      runStart = -1;
    }
  }
  // Speech = what lies between the silences; blips under 0.1 s are noise
  const speech: [number, number][] = [];
  let at = 0;
  for (const [a, b] of silences) {
    if (a - at >= 0.1) speech.push([at, a]);
    at = b;
  }
  if (total - at >= 0.1) speech.push([at, total]);
  const keep: [number, number][] = [];
  for (const [a, b] of speech) {
    const s: [number, number] = [Math.max(0, a - pad), Math.min(total, b + pad)];
    const last = keep[keep.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else keep.push(s);
  }
  return { keep: keep.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]), threshold };
}
