import type { CaptureMeta, ScreenVisual } from './types';
import { resolveTime } from './timeline';

export interface Seg {
  a: number;
  b: number;
  x: number;
  y: number;
  s: number;
}

const AUTO_SCALE = 1.7;

// Zoom segments in capture time
export function zoomSegments(v: ScreenVisual, cap: CaptureMeta | undefined, autoScale = AUTO_SCALE): Seg[] {
  const ev = cap?.events ?? [];
  const end = cap?.duration ?? 1e9;
  const fixed: Seg[] = [];

  // Explicit zoom marks from capture script
  ev.forEach((e, i) => {
    if (e.type !== 'zoom') return;
    const stop = ev.slice(i + 1).find((n) => n.type === 'zoom' || n.type === 'unzoom');
    fixed.push({ a: e.t, b: stop ? stop.t : end, x: e.x!, y: e.y!, s: e.scale ?? autoScale });
  });
  for (const z of v.zooms ?? []) {
    fixed.push({ a: resolveTime(z.at, cap), b: resolveTime(z.end, cap), x: z.x, y: z.y, s: z.scale ?? autoScale });
  }

  // Click/typing zooms only where no explicit zoom applies
  const auto: Seg[] = [];
  if ((v.zoom ?? 'auto') === 'auto') {
    const free = (a: number, b: number) => !fixed.some((f) => a < f.b && b > f.a);
    let last: { x: number; y: number } | undefined;
    for (const e of ev) {
      let seg: Seg | null = null;
      if (e.type === 'down' || e.type === 'click') {
        last = { x: e.x!, y: e.y! };
        seg = { a: e.t - 0.6, b: e.t + 1.6, x: e.x!, y: e.y!, s: autoScale };
      } else if (e.type === 'key' && last) seg = { a: e.t - 0.3, b: e.t + 1.2, x: last.x, y: last.y, s: autoScale };
      if (seg && free(seg.a, seg.b)) auto.push(seg);
    }
  }

  // Merge overlapping or close segments with the same focus
  const segs = [...fixed, ...auto].sort((p, q) => p.a - q.a);
  const out: Seg[] = [];
  for (const s of segs) {
    const l = out[out.length - 1];
    if (l && s.a - l.b < 0.9 && Math.hypot(s.x - l.x, s.y - l.y) < 40 && s.s === l.s) l.b = Math.max(l.b, s.b);
    else if (l && s.a < l.b) {
      l.b = s.a;
      out.push(s);
    } else out.push(s);
  }
  // Bridge short gaps so the camera pans instead of bouncing out
  for (let i = 1; i < out.length; i++) if (out[i].a - out[i - 1].b < 0.9) out[i - 1].b = out[i].a;
  return out;
}

// Implicit critically damped spring step
function step(x: number, v: number, g: number, w: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * w;
  const oo = w * w;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  return [(f * x + dt * v + hhoo * g) * inv, (v + hoo * (g - x)) * inv];
}

export interface CamState {
  s: number;
  x: number;
  y: number;
}

// Per-frame camera in capture pixel space
export function cameraTrack(segs: Seg[], frames: number, fps: number, t0: number, rate: number, cw: number, ch: number, base = 1, hz = 1.1): CamState[] {
  // Two cascaded critically damped springs: motion starts with zero acceleration (no jolt)
  const w = 2 * Math.PI * hz * 1.6;
  const dt = 1 / fps;
  const target = (t: number) => {
    const s = segs.find((g) => t >= g.a && t < g.b);
    return s ? { s: Math.max(s.s, base), x: s.x, y: s.y } : { s: base, x: cw / 2, y: ch / 2 };
  };
  const init = target(t0);
  const A = { s: init.s, x: init.x, y: init.y, vs: 0, vx: 0, vy: 0 };
  const B = { s: init.s, x: init.x, y: init.y, vs: 0, vx: 0, vy: 0 };
  const out: CamState[] = [];
  for (let f = 0; f < frames; f++) {
    const g = target(t0 + f * dt * rate);
    [A.s, A.vs] = step(A.s, A.vs, g.s, w, dt);
    [A.x, A.vx] = step(A.x, A.vx, g.x, w, dt);
    [A.y, A.vy] = step(A.y, A.vy, g.y, w, dt);
    [B.s, B.vs] = step(B.s, B.vs, A.s, w, dt);
    [B.x, B.vx] = step(B.x, B.vx, A.x, w, dt);
    [B.y, B.vy] = step(B.y, B.vy, A.y, w, dt);
    out.push({ s: B.s, x: B.x, y: B.y });
  }
  return out;
}

export interface CursorState {
  x: number;
  y: number;
  press: number;
  alpha: number;
}

// Per-frame cursor position, click press and idle fade
export function cursorTrack(cap: CaptureMeta | undefined, frames: number, fps: number, t0: number, rate: number): CursorState[] {
  const pts = (cap?.events ?? []).filter((e) => e.x !== undefined && (e.type === 'move' || e.type === 'down' || e.type === 'up' || e.type === 'click'));
  const downs = (cap?.events ?? []).filter((e) => e.type === 'down' || e.type === 'click').map((e) => e.t);
  if (!pts.length) return Array.from({ length: frames }, () => ({ x: -100, y: -100, press: 0, alpha: 0 }));
  const at = (t: number) => {
    if (t <= pts[0].t) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].t >= t) {
        const p = pts[i - 1];
        const q = pts[i];
        const k = (t - p.t) / Math.max(1e-6, q.t - p.t);
        return { x: p.x! + (q.x! - p.x!) * k, y: p.y! + (q.y! - p.y!) * k, t };
      }
    }
    return pts[pts.length - 1];
  };
  const w = 2 * Math.PI * 5;
  const dt = 1 / fps;
  const first = at(t0);
  let x = first.x!, y = first.y!, vx = 0, vy = 0;
  const out: CursorState[] = [];
  for (let f = 0; f < frames; f++) {
    const t = t0 + f * dt * rate;
    const g = at(t);
    [x, vx] = step(x, vx, g.x!, w, dt);
    [y, vy] = step(y, vy, g.y!, w, dt);
    const since = Math.min(...downs.map((d) => (t >= d ? t - d : 1e9)));
    const press = since < 0.25 ? Math.sin((since / 0.25) * Math.PI) : 0;
    const lastMove = pts.filter((p) => p.t <= t).pop()?.t ?? pts[0].t;
    const idle = t - lastMove;
    const alpha = t < pts[0].t - 0.3 ? 0 : idle > 3 ? Math.max(0, 1 - (idle - 3) / 0.5) : 1;
    out.push({ x, y, press, alpha });
  }
  return out;
}

export function clickTimes(cap: CaptureMeta | undefined): { t: number; x: number; y: number }[] {
  return (cap?.events ?? []).filter((e) => e.type === 'down' || e.type === 'click').map((e) => ({ t: e.t, x: e.x!, y: e.y! }));
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Clamp to the interval between two bounds in either order, so it stays continuous as they cross
function clampEither(v: number, a: number, b: number): number {
  return Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
}

// Smooth version of clampEither: eases into the bound over `soft` px instead of a hard kink
export function softClamp(v: number, a: number, b: number, softMax: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const soft = Math.min(softMax, (hi - lo) / 2);
  if (soft <= 1e-6) return Math.min(Math.max(v, lo), hi);
  const ease = (d: number) => (d >= soft ? d - soft / 2 : (d * d) / (2 * soft));
  if (v < lo + soft) return lo + ease(Math.max(0, v - lo + soft)) - soft / 2;
  if (v > hi - soft) return hi - ease(Math.max(0, hi - v + soft)) + soft / 2;
  return v;
}

// Whole-layer camera: viewport centre drifts toward the focus as zoom grows and is kept so that a
// window larger than the screen never shows background, while a smaller one stays fully in view
export function layerCamera(c: CamState, frame: Box, content: Box, k: number, W: number, H: number) {
  const s = c.s;
  const fx = content.x + c.x * k;
  const fy = content.y + c.y * k;
  const u = Math.min(1, Math.max(0, (s - 1) / 0.6));
  const z = u * u * (3 - 2 * u);
  const nx = W / 2;
  const ny = H / 2;
  const hw = W / (2 * s);
  const hh = H / (2 * s);
  const soft = 160 / s;
  const cx = softClamp(nx + (fx - nx) * z, frame.x + hw, frame.x + frame.w - hw, soft);
  const cy = softClamp(ny + (fy - ny) * z, frame.y + hh, frame.y + frame.h - hh, soft);
  return { s, cx, cy, nx, ny, transform: `translate(${nx}px, ${ny}px) scale(${s}) translate(${-cx}px, ${-cy}px)` };
}

export { clampEither };

// Per-frame raw zoom target (piecewise constant) in capture pixels
export function cameraTargets(segs: Seg[], frames: number, fps: number, t0: number, rate: number, cw: number, ch: number, base = 1): CamState[] {
  const out: CamState[] = [];
  for (let f = 0; f < frames; f++) {
    const t = t0 + (f / fps) * rate;
    const s = segs.find((g) => t >= g.a && t < g.b);
    out.push(s ? { s: Math.max(s.s, base), x: s.x, y: s.y } : { s: base, x: cw / 2, y: ch / 2 });
  }
  return out;
}

// Cascaded critically damped springs over any parameter vector: smooth start, smooth stop
export function smoothPath(targets: number[][], fps: number, hz = 1.1): number[][] {
  if (!targets.length) return [];
  const w = 2 * Math.PI * hz * 1.6;
  const dt = 1 / fps;
  const n = targets[0].length;
  const A = targets[0].slice();
  const B = targets[0].slice();
  const vA = new Array(n).fill(0);
  const vB = new Array(n).fill(0);
  return targets.map((g) => {
    for (let i = 0; i < n; i++) {
      [A[i], vA[i]] = step(A[i], vA[i], g[i], w, dt);
      [B[i], vB[i]] = step(B[i], vB[i], A[i], w, dt);
    }
    return B.slice();
  });
}

// Target camera for the whole-layer view: [scale, viewport centre x, y] with hard limits
export function layerTarget(c: CamState, frame: Box, content: Box, k: number, W: number, H: number): number[] {
  const s = c.s;
  const u = Math.min(1, Math.max(0, (s - 1) / 0.6));
  const z = u * u * (3 - 2 * u);
  const fx = content.x + c.x * k;
  const fy = content.y + c.y * k;
  const hw = W / (2 * s);
  const hh = H / (2 * s);
  const cx = clampEither(W / 2 + (fx - W / 2) * z, frame.x + hw, frame.x + frame.w - hw);
  const cy = clampEither(H / 2 + (fy - H / 2) * z, frame.y + hh, frame.y + frame.h - hh);
  return [s, cx, cy];
}

// Target camera inside the frame: [scale, visible left, visible top] in capture pixels
export function innerTarget(c: CamState, cw: number, ch: number): number[] {
  const s = Math.max(1, c.s);
  return [s, Math.min(Math.max(c.x - cw / (2 * s), 0), cw - cw / s), Math.min(Math.max(c.y - ch / (2 * s), 0), ch - ch / s)];
}

export interface SpringState {
  A: number[];
  B: number[];
  vA: number[];
  vB: number[];
}

// smoothPath that can start from a previous scene's end state and returns its own end state
export function smoothPathState(targets: number[][], fps: number, init?: SpringState, hz = 1.1): { path: number[][]; state: SpringState } {
  const w = 2 * Math.PI * hz * 1.6;
  const dt = 1 / fps;
  const n = targets[0]?.length ?? 3;
  const st: SpringState = init ? { A: init.A.slice(), B: init.B.slice(), vA: init.vA.slice(), vB: init.vB.slice() } : { A: targets[0].slice(), B: targets[0].slice(), vA: new Array(n).fill(0), vB: new Array(n).fill(0) };
  const path = targets.map((g) => {
    for (let i = 0; i < n; i++) {
      [st.A[i], st.vA[i]] = step(st.A[i], st.vA[i], g[i], w, dt);
      [st.B[i], st.vB[i]] = step(st.B[i], st.vB[i], st.A[i], w, dt);
    }
    return st.B.slice();
  });
  return { path, state: st };
}

// Shift zoom targets so the visible cursor stays inside the middle of the view
export function followCursor(targets: CamState[], cursor: CursorState[] | null, halfW: (s: number) => number, halfH: (s: number) => number, margin = 0.72, ahead = 24): CamState[] {
  if (!cursor) return targets;
  const at = (j: number) => cursor[Math.min(j, cursor.length - 1)];
  // Keep the cursor's next `ahead` frames in view so the lagging spring arrives in time
  const axis = (t: number, lo: number, hi: number, now: number, h: number) => {
    if (hi - lo > 2 * h) [lo, hi] = [now, now];
    return lo < t - h ? lo + h : hi > t + h ? hi - h : t;
  };
  return targets.map((t, i) => {
    const c = at(i);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let j = i; j <= i + ahead; j++) {
      const q = at(j);
      if (!q || q.alpha < 0.5) continue;
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    if (x0 === Infinity) return t;
    const now = c && c.alpha >= 0.5 ? c : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    return { s: t.s, x: axis(t.x, x0, x1, now.x, halfW(t.s) * margin), y: axis(t.y, y0, y1, now.y, halfH(t.s) * margin) };
  });
}
