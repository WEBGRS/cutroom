import type { Format, FrameStyle } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  W: number;
  H: number;
  box: Rect;
  capY: number;
  zh: number;
  en: number;
  maxChars: number;
  bar: number;
}

export const LAYOUT: Record<Format, Layout> = {
  wide: { W: 1920, H: 1080, box: { x: 150, y: 46, w: 1620, h: 880 }, capY: 1046, zh: 50, en: 26, maxChars: 20, bar: 44 },
  tall: { W: 1080, H: 1920, box: { x: 48, y: 292, w: 984, h: 1122 }, capY: 1575, zh: 60, en: 30, maxChars: 13, bar: 52 },
};

// Extra padding around recordings (Screen Studio style); no inset = the same layout object
export function withFrame(l: Layout, frame?: FrameStyle): Layout {
  const k = Math.min(0.3, Math.max(0, frame?.inset ?? 0));
  if (!k) return l;
  const { x, y, w, h } = l.box;
  return { ...l, box: { x: x + (w * k) / 2, y: y + (h * k) / 2, w: w * (1 - k), h: h * (1 - k) } };
}

// Fit aspect-ratio content (plus top bar) inside a box, centered
export function fit(box: Rect, cw: number, ch: number, bar = 0): { frame: Rect; content: Rect; k: number } {
  const k = Math.min(box.w / cw, (box.h - bar) / ch);
  const w = cw * k;
  const h = ch * k + bar;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  return { frame: { x, y, w, h }, content: { x, y: y + bar, w, h: h - bar }, k };
}

export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
