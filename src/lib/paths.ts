import { cameraTargets, cursorTrack, followCursor, innerTarget, layerTarget, smoothPathState, zoomSegments, type CursorState, type SpringState } from './camera';
import { fit, type Layout, type Rect } from './layout';
import { resolveTime, type Timeline } from './timeline';
import type { CaptureMeta } from './types';

export interface ScenePath {
  path: number[][];
  cursor: CursorState[] | null;
}

interface Geo {
  inner: boolean;
  frame: Rect;
  content: Rect;
  k: number;
  cw: number;
  ch: number;
  dpr: number;
}

// Cursor screen position under camera p
function project(g: Geo, layout: Layout, p: number[], x: number, y: number): [number, number] {
  return g.inner
    ? [g.content.x + (x - p[1]) * g.k * p[0], g.content.y + (y - p[2]) * g.k * p[0]]
    : [(g.content.x + x * g.k - p[1]) * p[0] + layout.W / 2, (g.content.y + y * g.k - p[2]) * p[0] + layout.H / 2];
}

// Max-hold then Gaussian blur, both centred: the correction starts before it is needed
function anticipate(d: number[], hold: number, sigma: number): number[] {
  const n = d.length;
  const held = d.map((_, i) => {
    let pos = 0, neg = 0;
    for (let j = Math.max(0, i - hold); j <= Math.min(n - 1, i + hold); j++) {
      pos = Math.max(pos, d[j]);
      neg = Math.min(neg, d[j]);
    }
    return pos + neg;
  });
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return held.map((_, i) => {
    let a = 0, b = 0;
    for (let j = -r; j <= r; j++) {
      const q = held[Math.min(n - 1, Math.max(0, i + j))];
      a += q * w[j + r];
      b += w[j + r];
    }
    return a / b;
  });
}

// Shift a continuous run of camera frames so the pointer never leaves the visible area
function keepCursorInView(path: number[][], cursor: (CursorState | null)[], g: Geo, layout: Layout, fps: number): number[][] {
  const vis = g.inner ? { x0: g.frame.x, y0: g.frame.y, x1: g.frame.x + g.frame.w, y1: g.frame.y + g.frame.h } : { x0: 0, y0: 0, x1: layout.W, y1: layout.H };
  const pad = 36;
  let cur = path.map((p) => [...p]);
  for (let pass = 0; pass < 4; pass++) {
    const dx: number[] = [], dy: number[] = [];
    let worst = 0;
    cur.forEach((p, i) => {
      const c = cursor[i];
      if (!c || c.alpha < 0.05) return void (dx.push(0), dy.push(0));
      const unit = g.k * p[0];
      const glyph = 24 * g.dpr * unit;
      const [x, y] = project(g, layout, p, c.x, c.y);
      const ox = x < vis.x0 + pad ? x - (vis.x0 + pad) : x > vis.x1 - pad - glyph ? x - (vis.x1 - pad - glyph) : 0;
      const oy = y < vis.y0 + pad ? y - (vis.y0 + pad) : y > vis.y1 - pad - glyph * 1.4 ? y - (vis.y1 - pad - glyph * 1.4) : 0;
      worst = Math.max(worst, Math.abs(ox), Math.abs(oy));
      // Screen overflow -> camera units
      dx.push(g.inner ? ox / unit : ox / p[0]);
      dy.push(g.inner ? oy / unit : oy / p[0]);
    });
    if (worst < 1) break;
    const sx = anticipate(dx, Math.round(0.25 * fps), 0.12 * fps);
    const sy = anticipate(dy, Math.round(0.25 * fps), 0.12 * fps);
    cur = cur.map((p, i) => {
      let x = p[1] + sx[i] * 1.15;
      let y = p[2] + sy[i] * 1.15;
      if (g.inner) {
        // Stay inside the capture
        x = Math.max(0, Math.min(g.cw - g.cw / p[0], x));
        y = Math.max(0, Math.min(g.ch - g.ch / p[0], y));
      }
      return [p[0], x, y];
    });
  }
  return cur;
}

// Camera paths for every screen scene; a scene that continues the previous clip keeps its camera
export function screenPaths(tl: Timeline, captures: Record<string, CaptureMeta> | undefined, layout: Layout, fps: number): Record<string, ScenePath> {
  const out: Record<string, ScenePath> = {};
  const chains: { ids: string[]; geo: Geo }[] = [];
  let prev: { src: string; endT: number; state: SpringState; inner: boolean } | null = null;
  for (const s of tl.scenes) {
    const v = s.visual;
    if (v.kind !== 'screen') {
      prev = null;
      continue;
    }
    const cap = captures?.[v.src];
    const cw = cap?.width ?? 1920;
    const ch = cap?.height ?? 1080;
    const kind = v.frame ?? 'window';
    const inner = layout.H > layout.W || kind !== 'window';
    const { frame, content, k } = fit(layout.box, cw, ch, kind === 'window' ? layout.bar : 0);
    const rate = v.rate ?? 1;
    const from = resolveTime(v.from, cap, 0);
    const cursor = v.cursor === false || cap?.mobile ? null : cursorTrack(cap, s.dur, fps, from, rate);
    const raw = cameraTargets(zoomSegments(v, cap, cap?.mobile ? 1.35 : 1.7), s.dur, fps, from, rate, cw, ch, v.base ?? 1);
    const halfW = (z: number) => (inner ? cw / (2 * z) : layout.W / (2 * z * k));
    const halfH = (z: number) => (inner ? ch / (2 * z) : layout.H / (2 * z * k));
    const targets = followCursor(raw, cursor, halfW, halfH, 0.72, Math.round(0.45 * fps)).map((t) => (inner ? innerTarget(t, cw, ch) : layerTarget(t, frame, content, k, layout.W, layout.H)));
    const cont = prev !== null && prev.src === v.src && prev.inner === inner && Math.abs(prev.endT - from) < 0.15;
    const { path, state } = smoothPathState(targets, fps, cont ? prev!.state : undefined);
    out[s.scene.id] = { path, cursor };
    if (cont) chains[chains.length - 1].ids.push(s.scene.id);
    else chains.push({ ids: [s.scene.id], geo: { inner, frame, content, k, cw, ch, dpr: cap?.dpr ?? 1 } });
    const to = resolveTime(v.to, cap, cap?.duration ?? 1e9);
    prev = { src: v.src, endT: Math.min(to, cap?.duration ?? to, from + (s.dur / fps) * rate), state, inner };
  }
  // Correct whole chains at once so joins stay seamless
  for (const { ids, geo } of chains) {
    if (!ids.some((id) => out[id].cursor)) continue;
    const path = ids.flatMap((id) => out[id].path);
    const cursor = ids.flatMap((id) => (out[id].cursor ?? out[id].path.map(() => null)) as (CursorState | null)[]);
    const fixed = keepCursorInView(path, cursor, geo, layout, fps);
    let at = 0;
    for (const id of ids) {
      const n = out[id].path.length;
      out[id] = { ...out[id], path: fixed.slice(at, at + n) };
      at += n;
    }
  }
  return out;
}
