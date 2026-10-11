import type { Timeline } from './timeline';

// Music volume per frame: duck under voice, fade in/out
export function musicEnvelope(tl: Timeline, base: number, duck: number, fadeInSec = 1, fadeOutSec = 2): number[] {
  const n = tl.total;
  const on = new Float32Array(n);
  for (const s of tl.scenes) for (const l of s.lines) for (let f = s.start + l.start; f < Math.min(n, s.start + l.start + l.dur); f++) on[f] = 1;
  const att = 1 / (0.18 * tl.fps);
  const rel = 1 / (0.6 * tl.fps);
  const out: number[] = [];
  let e = 0;
  for (let f = 0; f < n; f++) {
    // Look ahead so the dip lands before speech starts
    const want = on[Math.min(n - 1, f + Math.round(0.12 * tl.fps))];
    e = want > e ? Math.min(want, e + att) : Math.max(want, e - rel);
    const fadeIn = fadeInSec > 0 ? Math.min(1, f / (fadeInSec * tl.fps)) : 1;
    const fadeOut = fadeOutSec > 0 ? Math.min(1, (n - f) / (fadeOutSec * tl.fps)) : 1;
    out.push(base * (1 - (1 - duck) * e) * fadeIn * fadeOut);
  }
  return out;
}

// The few points of a curve that redraw it within `eps` by straight lines (Ramer–Douglas–Peucker)
export function simplify(ys: number[], eps: number): [number, number][] {
  if (ys.length < 3) return ys.map((y, x) => [x, y]);
  const keep = new Uint8Array(ys.length);
  keep[0] = keep[ys.length - 1] = 1;
  const stack: [number, number][] = [[0, ys.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(ys[i] - (ys[a] + ((ys[b] - ys[a]) * (i - a)) / (b - a)));
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst >= 0 && far > eps) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: [number, number][] = [];
  keep.forEach((k, i) => k && out.push([i, ys[i]]));
  return out;
}
