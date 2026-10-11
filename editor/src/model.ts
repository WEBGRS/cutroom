import { buildBeatTimeline, buildTimeline, cueFrame, plain, resolveTime, TAIL, type TScene } from '../../src/lib/timeline';
import { withFades } from '../../src/lib/fades';
import type { CaptureMeta, Fx, Props, Scene, TimeRef, Visual } from '../../src/lib/types';
import { zoomSegments } from '../../src/lib/camera';
import { OVERLAY_LIST, SCENE_FX, TRANSITION_LIST } from './catalog';
import { soundDef } from '../../src/fx/sounds';

export type VisualKey = 'visual' | 'tall';

export interface ELine {
  k: number;
  start: number;
  dur: number;
  text: string;
  file?: string;
  stale?: boolean;
  voiced?: boolean;
}

// A placed sound: frames from scene start; past = beyond the scene end, so silent
export interface ESound {
  i: number;
  id: string;
  f: number;
  dur: number;
  label: string;
  past: boolean;
}

// A name in both UI languages
export interface ETag {
  en: string;
  zh: string;
}

// Overlay on the timeline: frames from scene start; off = not drawn in this version, and why
export interface EOverlay extends ETag {
  i: number;
  f: number;
  dur: number;
  off?: ETag;
}

// Camera move: recording zooms (tab 'visual') or camera effects (tab 'fx')
export interface ECam extends ETag {
  f: number;
  dur: number;
  tab: 'visual' | 'fx';
  manual?: boolean;
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
  sounds: ESound[];
  overlays: EOverlay[];
  // Colour, lens and atmosphere effects in use
  fx: ETag[];
  camera: ECam[];
  // Transition into this scene, when there is an overlap; plain = the default crossfade
  transIn?: ETag & { plain?: boolean };
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

const FX_FIELDS = SCENE_FX.flatMap((g) => g.fields.map((f) => ({ f, group: g.id })));
// Values shown by their option name alone; other selects read "field option"
const OPTION_ONLY = new Set(['look', 'kenburns']);

// Effects in use, split into picture effects and camera moves (frames within the scene)
function fxTags(fx: Fx | undefined, dur: number, fps: number): { fx: ETag[]; camera: ECam[] } {
  const out: ETag[] = [];
  const camera: ECam[] = [];
  if (!fx) return { fx: out, camera };
  for (const { f, group } of FX_FIELDS) {
    const key = f.path.slice(3);
    const v = (fx as Record<string, unknown>)[key];
    if (v === undefined || v === '' || v === false || v === f.def || key === 'kbAmount' || group === 'screen') continue;
    if (f.def === undefined && v === 0) continue;
    const opt = f.options?.find((o) => o.id === String(v));
    const name: ETag = opt ? (OPTION_ONLY.has(key) ? { en: opt.en, zh: opt.zh } : { en: `${f.en} ${opt.en}`, zh: `${f.zh} ${opt.zh}` }) : { en: f.en, zh: f.zh };
    if (group !== 'motion') {
      out.push(name);
      continue;
    }
    let a = 0;
    let b = dur;
    if (key === 'focusIn' || key === 'fadeIn') b = Math.min(dur, Math.round(Number(v) * fps));
    if (key === 'fadeOut') a = Math.max(0, dur - Math.round(Number(v) * fps));
    camera.push({ ...name, f: a, dur: Math.max(1, b - a), tab: 'fx' });
  }
  return { fx: out, camera };
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
  const clipsOf = (id: string) => (p.voice !== 'off' && p.mode !== 'beat' ? p.timings?.scenes[id] : undefined);
  const out = scenes.map((s): EScene => {
    const v = s.visual;
    const index = board.scenes.indexOf(s.scene);
    const e: EScene = { id: s.scene.id, index, start: s.start, dur: s.dur, trans: s.trans, key: visualKey(s.scene, p.format), visual: v, label: label(v), lines: [], marks: [], sounds: [], overlays: [], fx: [], camera: [], rate: 1 };
    e.sounds = (s.scene.sounds ?? []).map((c, i) => {
      const def = soundDef(c.id);
      const at = cueFrame(s, c.at, caps, fps);
      const f = Math.max(0, at ?? 0);
      return { i, id: c.id, f, dur: Math.max(1, Math.round((def?.dur ?? 0.5) * fps)), label: def?.en ?? c.id, past: at === undefined || at < 0 || f >= s.dur };
    });
    const hideOverlays = p.mode === 'beat' && !board.beat?.overlays;
    // Empty entries (left by older saves) are skipped; check reports them
    e.overlays = (s.scene.overlays ?? []).flatMap((o, i) => (o ? [{ o, i }] : [])).map(({ o, i }) => {
      const def = OVERLAY_LIST.find((x) => x.id === o.kind);
      const text = o.text ? ` ${plain(o.text).slice(0, 24)}` : '';
      const off: ETag | undefined = o.only && o.only !== p.format ? { en: `only in ${o.only === 'wide' ? '16:9' : '9:16'}`, zh: `只在${o.only === 'wide' ? '横屏' : '竖屏'}` } : hideOverlays ? { en: 'the beat cut hides overlays', zh: '卡点版不显示叠加' } : undefined;
      return { i, en: `${def?.en ?? o.kind}${text}`, zh: `${def?.zh ?? o.kind}${text}`, f: Math.round(Math.max(0, o.at) * fps), dur: Math.max(1, Math.round((o.dur ?? 1.6) * fps)), off };
    });
    const tags = fxTags(s.scene.fx, s.dur, fps);
    e.fx = tags.fx;
    e.camera = tags.camera;
    if (s.trans > 0) {
      const tid = p.mode === 'beat' ? (s.scene.beatTransition ?? '') : s.scene.transition === 'fade' ? '' : (s.scene.transition ?? '');
      const t = TRANSITION_LIST.find((x) => x.id === tid);
      e.transIn = !tid ? { en: 'Crossfade', zh: '叠化', plain: true } : t ? { en: t.en, zh: t.zh } : { en: tid, zh: tid };
    }
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
      // Zooms the camera will make: script/explicit ones and the automatic click zooms
      try {
        const manual = [...(v.zooms ?? []).map((z) => safe(z.at, cap, -1)), ...(cap?.events ?? []).filter((x) => x.type === 'zoom').map((x) => x.t)];
        for (const z of zoomSegments(v, cap, cap?.mobile ? 1.35 : 1.7)) {
          const a = Math.max(0, Math.round(((z.a - from) / rate) * fps));
          const b = Math.min(s.dur, Math.round(((z.b - from) / rate) * fps));
          if (b - a < 2) continue;
          const isManual = manual.some((m) => Math.abs(m - z.a) < 0.05);
          const k = `${Number(z.s.toFixed(2))}×`;
          e.camera.push({ en: isManual ? `Zoom ${k}` : `Click zoom ${k}`, zh: isManual ? `推近 ${k}` : `点击推近 ${k}`, f: a, dur: b - a, tab: 'visual', manual: isManual });
        }
      } catch {
        // Unresolvable marks: the render reports those
      }
      if ((v.base ?? 1) !== 1) e.camera.unshift({ en: `Base zoom ${v.base}×`, zh: `基础缩放 ${v.base}×`, f: 0, dur: s.dur, tab: 'visual' });
    }
    const clips = clipsOf(s.scene.id);
    e.lines = s.lines.map((l, k) => {
      const c = clips?.[k];
      return { k, start: l.start, dur: l.dur, text: plain(l.main), file: l.file, stale: !!c?.file && !l.file, voiced: !!l.file };
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
