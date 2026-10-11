// Shot boundaries and camera moves from small grayscale frames (pure functions; media.ts decodes)

export interface Motion {
  // Content displacement between two frames in pixels (right / down positive) and scale (>1 = enlarged)
  ux: number;
  uy: number;
  s: number;
  // Mean absolute difference left after compensating that motion, 0..1
  residual: number;
}

export type CameraMove = 'static' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'push' | 'pull' | 'handheld' | 'busy';

export const MOVE_NAMES: Record<CameraMove, [string, string]> = {
  static: ['static', '固定'],
  'pan-left': ['pans left', '左移'],
  'pan-right': ['pans right', '右移'],
  'tilt-up': ['moves up', '上移'],
  'tilt-down': ['moves down (or scrolls)', '下移/滚动'],
  push: ['pushes in', '推近'],
  pull: ['pulls out', '拉远'],
  handheld: ['handheld shake', '手持晃动'],
  busy: ['still camera, things move in frame', '画内运动'],
};

export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

// Bilinear sample with edge clamping
function sample(f: Uint8Array, w: number, h: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = f[y0 * w + x0] + (f[y0 * w + x1] - f[y0 * w + x0]) * fx;
  const b = f[y1 * w + x0] + (f[y1 * w + x1] - f[y1 * w + x0]) * fx;
  return a + (b - a) * fy;
}

// Mean |b(x) - a(c + (x - c)/s - u)| over the inner region
function cost(a: Uint8Array, b: Uint8Array, w: number, h: number, ux: number, uy: number, s: number, m: number): number {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let sum = 0;
  let n = 0;
  for (let y = m; y < h - m; y++)
    for (let x = m; x < w - m; x++) {
      const v = s === 1 && Number.isInteger(ux) && Number.isInteger(uy) ? a[(y - uy) * w + (x - ux)] : sample(a, w, h, cx + (x - cx) / s - ux, cy + (y - cy) / s - uy);
      sum += Math.abs(b[y * w + x] - v);
      n++;
    }
  return sum / n / 255;
}

// Sub-step minimum of a parabola through three samples
const refine = (l: number, c: number, r: number) => {
  const d = l - 2 * c + r;
  return d > 1e-9 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))) : 0;
};

// Global motion from a to b: integer shift search, sub-pixel refinement, then scale
export function estimateMotion(a: Uint8Array, b: Uint8Array, w: number, h: number, range = 4): Motion {
  const m = range + 1;
  let best = { ux: 0, uy: 0, c: Infinity };
  const grid = new Map<string, number>();
  for (let uy = -range; uy <= range; uy++)
    for (let ux = -range; ux <= range; ux++) {
      const c = cost(a, b, w, h, ux, uy, 1, m);
      grid.set(`${ux},${uy}`, c);
      if (c < best.c) best = { ux, uy, c };
    }
  const at = (x: number, y: number) => grid.get(`${x},${y}`) ?? best.c;
  const ux = best.ux + (Math.abs(best.ux) < range ? refine(at(best.ux - 1, best.uy), best.c, at(best.ux + 1, best.uy)) : 0);
  const uy = best.uy + (Math.abs(best.uy) < range ? refine(at(best.ux, best.uy - 1), best.c, at(best.ux, best.uy + 1)) : 0);
  // Scale around the best shift
  const steps = [0.96, 0.98, 1, 1.02, 1.04];
  const cs = steps.map((s) => cost(a, b, w, h, ux, uy, s, m));
  let k = cs.indexOf(Math.min(...cs));
  let s = steps[k];
  if (k > 0 && k < steps.length - 1) s += refine(cs[k - 1], cs[k], cs[k + 1]) * 0.02;
  else k = Math.max(0, Math.min(steps.length - 1, k));
  return { ux, uy, s, residual: Math.min(cs[k], cost(a, b, w, h, ux, uy, s, m)) };
}

// Half-size copy, for faster and less noisy comparisons
export function halve(f: Uint8Array, w: number, h: number): Uint8Array {
  const W = w >> 1;
  const H = h >> 1;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * W + x] = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) >> 2;
    }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((p, q) => p - q);
  return s[s.length >> 1];
};

export interface DetectOptions {
  // 0..1: higher finds more (subtler) cuts
  sensitivity?: number;
  // Shortest shot, seconds
  minShot?: number;
}

// Frame indices where a new shot starts (always includes 0)
export function detectCuts(frames: Uint8Array[], w: number, h: number, fps: number, o: DetectOptions = {}): number[] {
  const n = frames.length;
  if (n < 2) return [0];
  const sens = Math.max(0, Math.min(1, o.sensitivity ?? 0.5));
  const small = frames.map((f) => halve(f, w, h));
  const sw = w >> 1;
  const sh = h >> 1;
  const d = [0];
  for (let t = 1; t < n; t++) d.push(frameDiff(small[t - 1], small[t]));
  const hardAbs = 0.11 - 0.05 * sens;
  const residualMin = 0.06 - 0.025 * sens;
  const cuts: { t: number; score: number }[] = [];
  // Hard cuts: a jump well above the local level that motion compensation can't explain
  for (let t = 1; t < n; t++) {
    if (d[t] < hardAbs) continue;
    const around: number[] = [];
    for (let k = Math.max(1, t - 10); k <= Math.min(n - 1, t + 10); k++) if (k !== t) around.push(d[k]);
    if (d[t] < 2.5 * median(around) + 0.02) continue;
    const r = estimateMotion(frames[t - 1], frames[t], w, h, 6).residual;
    if (r >= residualMin) cuts.push({ t, score: r });
  }
  // Soft cuts (dissolves, wipes): frames g apart differ a lot after compensation, each side is steady
  const g = Math.max(2, Math.round(0.25 * fps));
  const far: number[] = new Array(n).fill(0);
  for (let t = g; t < n - g; t++) far[t] = frameDiff(small[t - g], small[t + g]);
  for (let t = g; t < n - g; t++) {
    if (far[t] < hardAbs * 0.8) continue;
    let peak = true;
    for (let k = Math.max(g, t - g); k <= Math.min(n - g - 1, t + g); k++) if (far[k] > far[t] || (far[k] === far[t] && k < t)) peak = false;
    if (!peak) continue;
    if (cuts.some((c) => Math.abs(c.t - t) <= 2 * g)) continue;
    const r = estimateMotion(frames[t - g], frames[t + g], w, h, 8).residual;
    if (r < residualMin * 1.2) continue;
    const before = t - 2 * g >= 0 ? frameDiff(small[t - 2 * g], small[t - g]) : 0;
    const after = t + 2 * g < n ? frameDiff(small[t + g], small[t + 2 * g]) : 0;
    if (before > far[t] * 0.5 || after > far[t] * 0.5) continue;
    cuts.push({ t, score: r });
  }
  // Keep the stronger of cuts closer than the shortest shot
  const minGap = Math.max(1, Math.round((o.minShot ?? 0.3) * fps));
  const kept: { t: number; score: number }[] = [];
  for (const c of cuts.sort((p, q) => q.score - p.score)) if (c.t >= minGap && c.t <= n - minGap && !kept.some((k) => Math.abs(k.t - c.t) < minGap)) kept.push(c);
  return [0, ...kept.map((c) => c.t).sort((p, q) => p - q)];
}

// The camera move over a run of frame-to-frame motions
export function classifyMove(ms: Motion[], w: number, h: number): { move: CameraMove; pan: number; tilt: number; zoom: number; shake: number; activity: number } {
  if (!ms.length) return { move: 'static', pan: 0, tilt: 0, zoom: 1, shake: 0, activity: 0 };
  // Camera moves the opposite way to the content
  const pan = -ms.reduce((a, m) => a + m.ux, 0) / w;
  const tilt = -ms.reduce((a, m) => a + m.uy, 0) / h;
  const zoom = ms.reduce((a, m) => a * m.s, 1);
  const mx = ms.reduce((a, m) => a + m.ux, 0) / ms.length;
  const my = ms.reduce((a, m) => a + m.uy, 0) / ms.length;
  const shake = Math.sqrt(ms.reduce((a, m) => a + (m.ux - mx) ** 2 + (m.uy - my) ** 2, 0) / ms.length);
  const activity = ms.reduce((a, m) => a + m.residual, 0) / ms.length;
  const lz = Math.log(zoom);
  const cands: [CameraMove, number][] = [
    [pan < 0 ? 'pan-left' : 'pan-right', Math.abs(pan) / 0.06],
    [tilt < 0 ? 'tilt-up' : 'tilt-down', Math.abs(tilt) / 0.06],
    [lz > 0 ? 'push' : 'pull', Math.abs(lz) / Math.log(1.05)],
  ];
  const [top, strength] = cands.sort((p, q) => q[1] - p[1])[0];
  let move: CameraMove = strength >= 1 ? top : 'static';
  if (move === 'static' && shake > 0.35) move = 'handheld';
  else if (move === 'static' && activity > 0.025) move = 'busy';
  return { move, pan, tilt, zoom, shake, activity };
}
