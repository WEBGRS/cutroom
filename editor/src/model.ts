import { buildBeatTimeline, buildTimeline, plain, resolveTime, TAIL, type TScene } from '../../src/lib/timeline';
import { withFades } from '../../src/lib/fades';
import type { CaptureMeta, Props, Scene, TimeRef, Visual } from '../../src/lib/types';

export type VisualKey = 'visual' | 'tall';

export interface ELine {
  k: number;
  start: number;
  dur: number;
  text: string;
  file?: string;
  stale?: boolean;
}

export interface EMark {
  f: number;
  name: string;
}

export interface EScene {
  id: string;
  index: number;
  start: number;
  dur: number;
  trans: number;
  key: VisualKey;
  visual: Visual;
  label: string;
  lines: ELine[];
  marks: EMark[];
  // Capture seconds actually played (screen only)
  from?: number;
  to?: number;
  rate: number;
  capDur?: number;
  // Voice cut: length forced by narration
  needed?: number;
}

export interface EHidden {
  id: string;
  index: number;
  why: string;
}

export interface ETimeline {
  scenes: EScene[];
  hidden: EHidden[];
  total: number;
  fps: number;
  beats?: { f: number; down: boolean }[];
  bar?: number;
  // Music file and where in it the cut starts (seconds)
  music?: { src: string; offset: number; loop: boolean };
}

export const visualKey = (s: Scene, format: Props['format']): VisualKey => (format === 'tall' && s.tall ? 'tall' : 'visual');

export function label(v: Visual): string {
  switch (v.kind) {
    case 'screen':
    case 'clip':
    case 'scroll':
    case 'image':
      return v.src.replace(/^.*\//, '');
    case 'title':
      return plain(v.title);
    case 'stats':
      return v.items.map((i) => i.value).join(' · ');
    case 'outro':
      return plain(v.title);
    case 'flow':
      return v.title ? plain(v.title) : 'flow';
    case 'chart':
    case 'code':
    case 'chat':
    case 'checklist':
    case 'flap':
    case 'terminal':
      return v.title ? plain(v.title) : v.kind;
    case 'quote':
      return plain(v.text);
    case 'counter':
      return v.value;
    case 'compare':
      return `${v.labelA ?? v.a} / ${v.labelB ?? v.b}`;
    case 'notifs':
      return v.items.map((i) => i.title).join(' · ');
  }
}

export const safe = (ref: TimeRef | undefined, cap: CaptureMeta | undefined, d: number) => {
  try {
    return resolveTime(ref, cap, d);
  } catch {
    return d;
  }
};

// The timeline exactly as Main/BeatMain lay it out, plus what the editor needs to draw and drag it
export function editTimeline(p: Props, fps: number): ETimeline {
  const board = p.board!;
  const caps = p.captures ?? {};
  const lang = p.lang ?? 'zh';
  let scenes: TScene[];
  let total: number;
  let beats: ETimeline['beats'];
  let bar: number | undefined;
  let music: ETimeline['music'] = board.music ? { src: board.music.src, offset: 0, loop: true } : undefined;
  if (p.mode === 'beat' && p.grid) {
    const bt = withFades(buildBeatTimeline(board, p.grid, p.format, fps, caps, lang), caps, fps);
    scenes = bt.scenes;
    total = bt.total;
    const t0 = bt.beat.t0;
    music = board.beat ? { src: board.beat.music, offset: t0, loop: false } : undefined;
    const downs = new Set(p.grid.downbeats.map((d) => Math.round(d * 1000)));
    beats = p.grid.beats.filter((b) => b >= t0 - 1e-6 && (b - t0) * fps <= total).map((b) => ({ f: Math.round((b - t0) * fps), down: downs.has(Math.round(b * 1000)) }));
    bar = bt.beat.period * 4;
  } else {
    const tl = buildTimeline(board, p.timings, p.format, fps, caps, p.voice === 'off', lang);
    scenes = tl.scenes;
    total = tl.total;
  }
  const used = new Set(scenes.map((s) => s.scene));
  const hidden: EHidden[] = [];
  board.scenes.forEach((s, index) => {
    if (used.has(s)) return;
    const why = s.only && s.only !== p.format ? (s.only === 'wide' ? '只在横屏' : '只在竖屏') : p.mode === 'beat' && !Array.isArray(s.beat) ? '卡点版未用' : '未用';
    hidden.push({ id: s.id, index, why });
  });
  const clipsOf = (id: string) => (lang === 'zh' && p.voice !== 'off' && p.mode !== 'beat' ? p.timings?.scenes[id] : undefined);
  const out = scenes.map((s): EScene => {
    const v = s.visual;
    const index = board.scenes.indexOf(s.scene);
    const e: EScene = { id: s.scene.id, index, start: s.start, dur: s.dur, trans: s.trans, key: visualKey(s.scene, p.format), visual: v, label: label(v), lines: [], marks: [], rate: 1 };
    if (v.kind === 'screen') {
      const cap = caps[v.src];
      const rate = v.rate ?? 1;
      const from = safe(v.from, cap, 0);
      e.rate = rate;
      e.from = from;
      e.to = Math.min(safe(v.to, cap, cap?.duration ?? from), cap?.duration ?? Infinity);
      e.capDur = cap?.duration;
      e.marks = (cap?.events ?? [])
        .filter((ev) => ev.type === 'mark')
        .map((ev) => ({ f: Math.round(((ev.t - from) / rate) * fps), name: ev.name ?? '' }))
        .filter((m) => m.f >= 0 && m.f <= s.dur);
    }
    const clips = clipsOf(s.scene.id);
    e.lines = s.lines.map((l, k) => {
      const c = clips?.[k];
      return { k, start: l.start, dur: l.dur, text: plain(l.main), file: l.file, stale: !!c && !!c.text && c.text !== plain(l.zh) };
    });
    if (p.mode !== 'beat' && e.lines.length) {
      const last = e.lines[e.lines.length - 1];
      e.needed = last.start + last.dur + Math.round((s.scene.tail ?? TAIL) * fps);
    }
    return e;
  });
  return { scenes: out, hidden, total, fps, beats, bar, music };
}

export const fmtTime = (f: number, fps: number) => {
  const t = Math.max(0, f / fps);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
