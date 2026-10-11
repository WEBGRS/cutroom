// Where to crop footage for another aspect ratio: the window that keeps the most motion and detail
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC } from './store';
import { grayFrames, probe } from './media';

// Per-column interest: motion between frames (when there are several) plus edge detail
export function columnEnergy(frames: Uint8Array[], w: number, h: number): number[] {
  const e = new Array(w).fill(0);
  const motion = new Array(w).fill(0);
  for (let t = 0; t < frames.length; t++) {
    const f = frames[t];
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        e[x] += Math.abs(f[i + 1] - f[i - 1]) + Math.abs(f[i + w] - f[i - w]);
        if (t > 0) motion[x] += Math.abs(f[i] - frames[t - 1][i]);
      }
  }
  const norm = (a: number[]) => {
    const m = Math.max(...a);
    return m > 0 ? a.map((v) => v / m) : a.map(() => 0);
  };
  const ne = norm(e);
  const nm = norm(motion);
  // Moving things matter more than texture when there is any motion at all
  const mw = motion.some((v) => v > 0) ? 0.7 : 0;
  return ne.map((v, x) => mw * nm[x] + (1 - mw) * v);
}

// object-position (0..1) of the window `vis` (visible fraction of the width) that holds the most energy,
// with a mild pull to the middle so flat footage stays centred
export function bestWindow(energy: number[], vis: number): number {
  const n = energy.length;
  if (vis >= 0.999) return 0.5;
  const span = Math.max(1, Math.round(vis * n));
  const pre = [0];
  for (const v of energy) pre.push(pre[pre.length - 1] + v);
  const total = pre[n] || 1;
  let best = 0.5;
  let bestScore = -Infinity;
  for (let a = 0; a + span <= n; a++) {
    const centre = (a + span / 2) / n;
    const score = (pre[a + span] - pre[a]) / total - 0.15 * Math.abs(centre - 0.5);
    if (score > bestScore) {
      bestScore = score;
      best = n - span > 0 ? a / (n - span) : 0.5;
    }
  }
  return Math.round(best * 1000) / 1000;
}

// Visible fraction of the source width when it covers a frame of aspect `outAr`
export const visibleWidth = (srcAr: number, outAr: number) => Math.min(1, outAr / srcAr);

export async function analyzeFocus(o: { slug: string; src: string; from?: number; dur?: number; outAr: number }): Promise<{ x: number; y: number; ar: number; vis: number }> {
  const file = path.join(PUBLIC, o.slug, o.src);
  if (!fs.existsSync(file)) throw new Error(`no ${o.src} in ${o.slug}`);
  if (/\.(png|jpe?g|webp|gif)$/i.test(o.src)) {
    const p = await probe(file);
    const ar = p.width / p.height;
    const w = 96;
    const h = Math.max(8, Math.round(w / ar));
    const { frames } = await grayFrames(file, w, h, 1);
    const vis = visibleWidth(ar, o.outAr);
    return { x: bestWindow(columnEnergy(frames.slice(0, 1), w, h), vis), y: 0.5, ar, vis };
  }
  const p = await probe(file);
  const ar = p.width / p.height;
  const w = 96;
  const h = Math.max(8, Math.round(w / ar));
  const { frames, fps } = await grayFrames(file, w, h, 6);
  const a = Math.max(0, Math.floor((o.from ?? 0) * fps));
  const b = o.dur ? Math.min(frames.length, Math.ceil(((o.from ?? 0) + o.dur) * fps)) : frames.length;
  const part = frames.slice(a, Math.max(a + 1, b));
  const vis = visibleWidth(ar, o.outAr);
  return { x: bestWindow(columnEnergy(part, w, h), vis), y: 0.5, ar, vis };
}
