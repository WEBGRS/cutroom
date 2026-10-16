import { resolveTime } from '../../src/lib/timeline';
import type { CaptureMeta, Scene, Storyboard, TimeRef, Timings, Visual } from '../../src/lib/types';
import type { EScene, VisualKey } from './model';

// Everything an edit may touch: the storyboard plus voice timings keyed by scene id
export interface Doc {
  board: Storyboard;
  timings: { zh?: Timings; en?: Timings };
}

export interface Op {
  doc: Doc;
  desc: string;
}

export type Caps = Record<string, CaptureMeta>;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const r2 = (x: number) => Math.round(x * 100) / 100;

export const showRef = (r: TimeRef | undefined) => (r === undefined ? '—' : String(r));
const short = (v: unknown) => {
  const s = v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 38)}…` : s;
};

const fmtRef = (name: string, off: number) => {
  const o = r2(off);
  return o === 0 ? `@${name}` : `@${name}${o > 0 ? '+' : ''}${o}`;
};

// Capture time t written like the old ref: same mark if it used one, else seconds; nearest mark for new points
export function toRef(t: number, cap: CaptureMeta | undefined, old?: TimeRef, nearest = false): TimeRef {
  t = Math.max(0, t);
  const marks = (cap?.events ?? []).filter((e) => e.type === 'mark' && e.name);
  const m = typeof old === 'string' ? /^@([\w-]+)/.exec(old) : null;
  const same = m ? marks.find((e) => e.name === m[1]) : undefined;
  if (same) return fmtRef(same.name!, t - same.t);
  if (nearest && marks.length) {
    const best = marks.reduce((a, e) => (Math.abs(e.t - t) < Math.abs(a.t - t) ? e : a));
    return fmtRef(best.name!, t - best.t);
  }
  return r2(t);
}

const at = (b: Storyboard, id: string) => {
  const i = b.scenes.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`没有场景 ${id}`);
  return i;
};

export function uniqueId(b: Storyboard, base: string): string {
  const ids = new Set(b.scenes.map((s) => s.id));
  const stem = base.replace(/-\d+$/, '');
  for (let n = 2; ; n++) if (!ids.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

const edit = (doc: Doc, fn: (d: Doc) => string): Op => {
  const d = clone(doc);
  const desc = fn(d);
  return { doc: d, desc };
};

// Place scene id right before beforeId (null = end)
export const moveScene = (doc: Doc, id: string, beforeId: string | null): Op =>
  edit(doc, (d) => {
    const b = d.board;
    const i = at(b, id);
    const [s] = b.scenes.splice(i, 1);
    const j = beforeId === null ? b.scenes.length : at(b, beforeId);
    b.scenes.splice(j, 0, s);
    return `移动 ${id}：第 ${i + 1} → 第 ${j + 1} 位`;
  });

export const trimEdge = (doc: Doc, id: string, key: VisualKey, edge: 'from' | 'to', t: number, caps: Caps): Op =>
  edit(doc, (d) => {
    const s = d.board.scenes[at(d.board, id)];
    const v = s[key];
    if (!v || v.kind !== 'screen') throw new Error(`${id} 不是录屏画面，不能裁切`);
    const cap = caps[v.src];
    const old = v[edge];
    const ref = toRef(Math.min(t, cap?.duration ?? t), cap, old);
    v[edge] = ref;
    return `${id}${key === 'tall' ? '（竖屏）' : ''} ${edge === 'from' ? '起点' : '终点'} ${showRef(old)} → ${showRef(ref)}`;
  });

export const setMinSec = (doc: Doc, id: string, sec: number | undefined): Op =>
  edit(doc, (d) => {
    const s = d.board.scenes[at(d.board, id)];
    const old = s.minSec;
    if (sec === undefined) delete s.minSec;
    else s.minSec = r2(sec);
    return `${id} 最短时长 ${old ?? '—'} → ${s.minSec ?? '—'} 秒`;
  });

export interface SplitAt {
  t: Partial<Record<VisualKey, number>>;
  line: number;
  sec: number;
}

// Where a split at scene-relative frame f lands in each visual and the line list
export function splitPoint(e: EScene, scene: Scene, f: number, fps: number, caps: Caps): SplitAt {
  const sec = f / fps;
  const t: SplitAt['t'] = {};
  for (const key of ['visual', 'tall'] as VisualKey[]) {
    const v = scene[key];
    if (v?.kind !== 'screen') continue;
    if (key === e.key && e.from !== undefined) t[key] = e.from + sec * e.rate;
    else t[key] = resolveSafe(v.from, caps[v.src]) + sec * (v.rate ?? 1);
  }
  // Lines already started stay in the first half
  let line = e.lines.findIndex((l) => l.start >= f);
  if (line < 0) line = e.lines.length;
  return { t, line, sec };
}

const resolveSafe = (r: TimeRef | undefined, cap: CaptureMeta | undefined) => {
  try {
    return resolveTime(r, cap, 0);
  } catch {
    return 0;
  }
};

export const splitScene = (doc: Doc, id: string, p: SplitAt, caps: Caps): Op =>
  edit(doc, (d) => {
    const b = d.board;
    const i = at(b, id);
    const a = b.scenes[i];
    const nid = uniqueId(b, id);
    const z: Scene = clone(a);
    z.id = nid;
    for (const key of ['visual', 'tall'] as VisualKey[]) {
      const va = a[key];
      const vz = z[key];
      const t = p.t[key];
      if (va?.kind !== 'screen' || vz?.kind !== 'screen' || t === undefined) continue;
      const cap = caps[va.src];
      va.to = toRef(t, cap, undefined, true);
      vz.from = va.to;
    }
    a.lines = a.lines.slice(0, p.line);
    z.lines = z.lines.slice(p.line);
    if (a.overlays) {
      a.overlays = a.overlays.filter((o) => o.at < p.sec);
      z.overlays = z.overlays!.filter((o) => o.at >= p.sec).map((o) => ({ ...o, at: r2(o.at - p.sec) }));
    }
    // Halves of one clip cut straight, with a short narration gap
    z.transition = 'none';
    a.tail ??= 0.15;
    z.lead ??= 0.15;
    delete a.minSec;
    delete z.minSec;
    for (const lang of ['zh', 'en'] as const) {
      const tm = d.timings[lang];
      const clips = tm?.scenes[id];
      if (!tm || !clips) continue;
      tm.scenes[id] = clips.slice(0, p.line);
      tm.scenes[nid] = clips.slice(p.line);
    }
    b.scenes.splice(i + 1, 0, z);
    return `拆分 ${id} → ${id} + ${nid}（在 ${r2(p.sec)} 秒处）`;
  });

// Insert a new scene after afterId (null = at the end)
export const addScene = (doc: Doc, scene: Scene, afterId: string | null): Op =>
  edit(doc, (d) => {
    const s = clone(scene);
    if (d.board.scenes.some((x) => x.id === s.id)) s.id = uniqueId(d.board, s.id);
    const i = afterId === null ? d.board.scenes.length : at(d.board, afterId) + 1;
    d.board.scenes.splice(i, 0, s);
    return `新增 ${s.id}（${s.visual.kind}）在第 ${i + 1} 位`;
  });

export const removeScene = (doc: Doc, id: string): Op =>
  edit(doc, (d) => {
    const i = at(d.board, id);
    d.board.scenes.splice(i, 1);
    return `删除 ${id}`;
  });

export const duplicateScene = (doc: Doc, id: string): Op =>
  edit(doc, (d) => {
    const i = at(d.board, id);
    const s: Scene = clone(d.board.scenes[i]);
    s.id = uniqueId(d.board, id);
    d.board.scenes.splice(i + 1, 0, s);
    return `复制 ${id} → ${s.id}`;
  });

const parts = (path: string) => path.split('.').filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : p));

export function getPath(obj: unknown, path: string): unknown {
  let o: any = obj;
  for (const k of parts(path)) {
    if (o == null) return undefined;
    o = o[k];
  }
  return o;
}

// Set (or delete with undefined) a field of a scene, or of the board when id is null
export const setPath = (doc: Doc, id: string | null, path: string, value: unknown): Op =>
  edit(doc, (d) => {
    if (id !== null && path === 'id') throw new Error('场景 id 不能改（配音按 id 对应）');
    const root: any = id === null ? d.board : d.board.scenes[at(d.board, id)];
    const ks = parts(path);
    if (!ks.length) throw new Error('路径为空');
    let o = root;
    // An index past the end would leave holes (null entries) in the list
    const gap = (arr: unknown[], k: string | number) => {
      if (typeof k === 'number' && k > arr.length) throw new Error(`${path}：下标 ${k} 超出了末尾（现在有 ${arr.length} 个），要追加请用 ${arr.length}`);
    };
    ks.slice(0, -1).forEach((k, n) => {
      if (Array.isArray(o)) gap(o, k);
      if (o[k] == null) o[k] = typeof ks[n + 1] === 'number' ? [] : {};
      o = o[k];
    });
    const last = ks[ks.length - 1];
    if (Array.isArray(o) && value !== undefined) gap(o, last);
    const old = o[last];
    if (value === undefined) {
      if (Array.isArray(o) && typeof last === 'number') o.splice(last, 1);
      else delete o[last];
    } else o[last] = value;
    return `${id ?? '全片'}.${path}: ${short(old)} → ${short(value)}`;
  });

export const replaceScene = (doc: Doc, id: string, scene: Scene): Op =>
  edit(doc, (d) => {
    if (scene.id !== id) throw new Error('场景 id 不能改（配音按 id 对应）');
    if (!scene.visual || !Array.isArray(scene.lines)) throw new Error('场景缺 visual 或 lines');
    d.board.scenes[at(d.board, id)] = scene;
    return `${id} 整段 JSON 已替换`;
  });

// A library sound `sec` seconds into a scene
export const addSound = (doc: Doc, sceneId: string, id: string, sec: number): Op =>
  edit(doc, (d) => {
    const s = d.board.scenes[at(d.board, sceneId)];
    s.sounds = [...(s.sounds ?? []), { id, at: r2(Math.max(0, sec)) }];
    return `${sceneId} 加音效 ${id}（${r2(sec)} 秒）`;
  });

export const removeSound = (doc: Doc, sceneId: string, i: number): Op =>
  edit(doc, (d) => {
    const s = d.board.scenes[at(d.board, sceneId)];
    const [cue] = s.sounds?.splice(i, 1) ?? [];
    if (!cue) throw new Error(`${sceneId} 没有第 ${i + 1} 个音效`);
    if (!s.sounds!.length) delete s.sounds;
    return `${sceneId} 删除音效 ${cue.id}`;
  });

export const removeOverlay = (doc: Doc, sceneId: string, i: number): Op =>
  edit(doc, (d) => {
    const s = d.board.scenes[at(d.board, sceneId)];
    const [o] = s.overlays?.splice(i, 1) ?? [];
    if (!o) throw new Error(`${sceneId} 没有第 ${i + 1} 个叠加元素`);
    if (!s.overlays!.length) delete s.overlays;
    return `${sceneId} 删除叠加 ${o.kind}`;
  });

// Moving a sound past a cut hands it to the scene it now starts in
export const moveSound = (doc: Doc, from: string, i: number, to: string, sec: number): Op =>
  edit(doc, (d) => {
    const a = d.board.scenes[at(d.board, from)];
    const cue = a.sounds?.[i];
    if (!cue) throw new Error(`${from} 没有第 ${i + 1} 个音效`);
    cue.at = r2(Math.max(0, sec));
    if (from === to) return `${from} 音效 ${cue.id} → ${cue.at} 秒`;
    a.sounds!.splice(i, 1);
    if (!a.sounds!.length) delete a.sounds;
    const b = d.board.scenes[at(d.board, to)];
    b.sounds = [...(b.sounds ?? []), cue];
    return `音效 ${cue.id}：${from} → ${to}（${cue.at} 秒）`;
  });

export const toggleTall = (doc: Doc, id: string, on: boolean): Op =>
  edit(doc, (d) => {
    const s = d.board.scenes[at(d.board, id)];
    if (on) s.tall = clone(s.tall ?? (s.visual as Visual));
    else delete s.tall;
    return `${id} 竖屏${on ? '使用单独画面' : '改用横屏画面'}`;
  });
