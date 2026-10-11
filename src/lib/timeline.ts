import type { BeatGrid, CaptureMeta, Format, Scene, Storyboard, TimeRef, Timings, Visual } from './types';

export const LEAD = 0.45;
export const GAP = 0.14;
export const TAIL = 0.5;
export const TRANS = 0.4;
const ZH_CPS = 4.6;

// Strip highlight [[..]] and speed {+..} {++..} {-..} markup
export const plain = (s: string) => s.replace(/\[\[|\]\]|\{\+\+|\{\+|\{-|\}/g, '');

export interface Tok {
  s: string;
  w: number;
  hi: boolean;
  r?: number;
}

const SPEED: Record<string, number> = { '{++': 1.45, '{+': 1.3, '{-': 0.9 };

export interface Chunk {
  toks: Tok[];
  start: number;
  dur: number;
}

export interface TLine {
  zh: string;
  en?: string;
  main: string;
  sub?: string;
  file?: string;
  start: number;
  dur: number;
}

export interface TScene {
  scene: Scene;
  visual: Visual;
  start: number;
  dur: number;
  trans: number;
  lines: TLine[];
}

export interface Timeline {
  scenes: TScene[];
  total: number;
  fps: number;
}

// Fallback duration before TTS exists
export const estimate = (zh: string, cps = ZH_CPS) => Math.max(0.8, plain(zh).replace(/\s/g, '').length / cps);

// Capture time to scene frames for a screen visual
function syncer(v: Visual, captures: Record<string, CaptureMeta> | undefined, fps: number) {
  if (v.kind !== 'screen') return null;
  const cap = captures?.[v.src];
  const from = resolveTime(v.from, cap, 0);
  const rate = v.rate ?? 1;
  return (ref: TimeRef | undefined) => {
    if (ref === undefined) return undefined;
    try {
      return ((resolveTime(ref, cap, 0) - from) / rate) * fps;
    } catch {
      return undefined;
    }
  };
}

// Frame of a sound cue inside its scene; marks follow the recording, undefined if they don't resolve
export function cueFrame(s: TScene, at: TimeRef, captures: Record<string, CaptureMeta> | undefined, fps: number): number | undefined {
  if (typeof at === 'number') return Math.round(Math.max(0, at) * fps);
  const f = syncer(s.visual, captures, fps)?.(at);
  return f === undefined ? undefined : Math.round(f);
}

export function buildTimeline(board: Storyboard, timings: Timings | undefined, format: Format, fps: number, captures?: Record<string, CaptureMeta>, silent = false, lang: 'zh' | 'en' = 'zh'): Timeline {
  if (silent) timings = undefined;
  const list = board.scenes.filter((s) => !s.only || s.only === format);
  const out: TScene[] = [];
  let cursor = 0;
  list.forEach((s, i) => {
    const trans = i === 0 || s.transition === 'none' ? 0 : Math.round((s.transDur ?? TRANS) * fps);
    const clips = timings?.scenes[s.id];
    const visual = format === 'tall' && s.tall ? s.tall : s.visual;
    const sync = syncer(visual, captures, fps);
    let t = Math.max((s.lead ?? LEAD) * fps, trans);
    const lines = s.lines.map((l, k) => {
      const want = sync?.(l.at);
      if (want !== undefined) t = Math.max(t, want);
      const c = clips?.[k];
      const said = plain((lang === 'en' ? (l.sayEn ?? l.en ?? '') : (l.say ?? l.zh)).trim());
      const fresh = c && (!c.text || c.text === plain(l.zh)) && (c.spoken === undefined || c.spoken === said);
      const en = lang === 'en' && l.en;
      const guess = en ? Math.max(0.8, l.en!.length / (silent ? 11 : 14)) : estimate(l.zh, silent ? 3.6 : ZH_CPS);
      const dur = Math.round((fresh && c!.dur ? c!.dur : guess) * fps);
      const line: TLine = { zh: l.zh, en: l.en, main: en ? l.en! : l.zh, sub: en || !l.en ? undefined : plain(l.en), file: fresh && c!.file ? c!.file : undefined, start: Math.round(t), dur };
      // Breathe longer after a full stop than after a comma
      const tail = (en ? l.en! : l.zh).trim().slice(-1);
      t += dur + ('。！？.!?'.includes(tail) ? 0.34 : '，,、；;：:'.includes(tail) ? 0.08 : GAP) * fps;
      return line;
    });
    if (lines.length) t -= GAP * fps;
    const clipEnd = visual.kind === 'screen' ? sync?.(visual.to) : undefined;
    const dur = Math.max(Math.round(t + (s.tail ?? TAIL) * fps), Math.round((s.minSec ?? 0) * fps), Math.round(clipEnd ?? 0), trans + 1);
    const start = cursor - trans;
    out.push({ scene: s, visual, start, dur, trans, lines });
    cursor = start + dur;
  });
  return { scenes: out, total: Math.max(1, cursor), fps };
}

// Resolve "@mark+0.5" against capture events
export function resolveTime(ref: TimeRef | undefined, cap: CaptureMeta | undefined, dflt = 0): number {
  if (ref === undefined) return dflt;
  if (typeof ref === 'number') return ref;
  const m = /^@([\w-]+)([+-][\d.]+)?$/.exec(ref);
  if (!m) return Number(ref) || dflt;
  const ev = cap?.events.find((e) => e.type === 'mark' && e.name === m[1]);
  // "@end" is the end of the recording unless the capture has its own mark of that name
  if (!ev && m[1] === 'end' && cap) return cap.duration + (m[2] ? Number(m[2]) : 0);
  if (!ev) throw new Error(`capture mark not found: ${ref}`);
  return ev.t + (m[2] ? Number(m[2]) : 0);
}

const PAUSE: Record<string, number> = { '，': 0.5, ',': 0.5, '、': 0.3, '；': 0.7, ';': 0.7, '：': 0.5, ':': 0.5, '。': 0.9, '.': 0.9, '！': 0.9, '!': 0.9, '？': 0.9, '?': 0.9, '…': 0.9 };
const KEEP = new Set(['！', '？', '!', '?']);

export function tokens(text: string, hi = false, state = { r: 1 }): Tok[] {
  const out: Tok[] = [];
  const re = /(\{\+\+|\{\+|\{-|\})|\[\[(.+?)\]\]|(\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[A-Za-z0-9][A-Za-z0-9.+#%/'’_-]*)|(\s+)|([\s\S])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) state.r = m[1] === '}' ? 1 : SPEED[m[1]];
    else if (m[2] !== undefined) out.push(...tokens(m[2], true, state));
    else if (m[3]) out.push({ s: m[3], w: 0.55 * m[3].length, hi, r: state.r });
    else if (m[4]) out.push({ s: ' ', w: 0.3, hi, r: state.r });
    else out.push({ s: m[5], w: 1, hi, r: state.r });
  }
  return out;
}

const weight = (toks: Tok[]) => toks.reduce((a, t) => a + t.w, 0);
// Spoken time is weight divided by speaking rate
const timeWeight = (toks: Tok[]) => toks.reduce((a, t) => a + t.w / (t.r ?? 1), 0);

const SOFT_AFTER = new Set([...'的了里着过吗呢吧啊']);
const SOFT_BEFORE = new Set([...'从在把被就都也还是让给对向往为而但又跟和与及或再每一']);

// Cost of breaking a caption between toks[i-1] and toks[i]
function breakCost(toks: Tok[], i: number): number {
  const a = toks[i - 1];
  const b = toks[i];
  if (a.hi && b.hi) return 8;
  if (a.s === ' ' || b.s === ' ') return 0;
  if (SOFT_AFTER.has(a.s) || SOFT_BEFORE.has(b.s)) return 0.4;
  if (/[A-Za-z0-9]/.test(a.s) !== /[A-Za-z0-9]/.test(b.s)) return 1;
  return 3;
}

// Split one spoken line into timed caption chunks
export function chunkLine(zh: string, max: number, start: number, dur: number): Chunk[] {
  const phrases: { toks: Tok[]; pause: number }[] = [];
  let cur: Tok[] = [];
  for (const t of tokens(zh)) {
    if (PAUSE[t.s] !== undefined) {
      if (KEEP.has(t.s)) cur.push({ ...t, w: 0.6 });
      if (cur.length) phrases.push({ toks: cur, pause: PAUSE[t.s] });
      else if (phrases.length) phrases[phrases.length - 1].pause += PAUSE[t.s];
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) phrases.push({ toks: cur, pause: 0 });

  // Trim spaces at chunk edges
  const trim = (ts: Tok[]) => {
    let a = 0;
    let b = ts.length;
    while (a < b && ts[a].s === ' ') a++;
    while (b > a && ts[b - 1].s === ' ') b--;
    return ts.slice(a, b);
  };

  // Split long phrases evenly
  const pieces: { toks: Tok[]; pause: number }[] = [];
  for (const p of phrases) {
    const toks = trim(p.toks);
    const w = weight(toks);
    if (w <= max) {
      pieces.push({ toks, pause: p.pause });
      continue;
    }
    // Pick break points by cost: balanced pieces, breaks at word-ish boundaries
    const target = w / Math.ceil(w / max);
    const n = toks.length;
    const pre = [0];
    toks.forEach((t) => pre.push(pre[pre.length - 1] + t.w));
    const dp = new Array(n + 1).fill(Infinity);
    const from = new Array(n + 1).fill(0);
    dp[0] = 0;
    for (let j = 1; j <= n; j++)
      for (let i = 0; i < j; i++) {
        const pw = pre[j] - pre[i];
        if (pw > max + 0.01 && j - i > 1) continue;
        const c = dp[i] + 1 + 3 * ((pw - target) / max) ** 2 + (j < n ? breakCost(toks, j) : 0);
        if (c < dp[j]) {
          dp[j] = c;
          from[j] = i;
        }
      }
    const cuts: number[] = [];
    for (let j = n; j > 0; j = from[j]) cuts.unshift(j);
    let i0 = 0;
    cuts.forEach((j, k) => {
      pieces.push({ toks: trim(toks.slice(i0, j)), pause: k === cuts.length - 1 ? p.pause : 0.15 });
      i0 = j;
    });
  }

  // Merge tiny neighbours
  const merged: { toks: Tok[]; pause: number }[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && (weight(last.toks) < 4 || weight(p.toks) < 3) && weight(last.toks) + weight(p.toks) + 0.3 <= max) {
      last.toks = [...last.toks, { s: ' ', w: 0.3, hi: false }, ...p.toks];
      last.pause = p.pause;
    } else merged.push({ ...p });
  }

  const total = merged.reduce((a, p) => a + timeWeight(p.toks) + p.pause, 0) || 1;
  let t = start;
  return merged.map((p, i) => {
    const d = i === merged.length - 1 ? start + dur - t : Math.round(((timeWeight(p.toks) + p.pause) / total) * dur);
    const c = { toks: p.toks, start: Math.round(t), dur: Math.max(1, d) };
    t += d;
    return c;
  });
}

export interface BeatInfo {
  period: number;
  t0: number;
}

// Beat-cut edit: scenes snap to whole bars, phrases land on beats. Consecutive scenes cut from one
// clip form a chain that plays at one speed, so the cut between them is seamless.
export function buildBeatTimeline(board: Storyboard, grid: BeatGrid, format: Format, fps: number, captures?: Record<string, CaptureMeta>, lang: 'zh' | 'en' = 'zh'): Timeline & { beat: BeatInfo; joins: boolean[] } {
  const period = grid.period;
  const bar = period * 4;
  const startBar = board.beat?.startBar ?? 0;
  const t0 = grid.downbeats[Math.min(startBar, grid.downbeats.length - 1)] ?? 0;
  const MAX_RATE = 2.6;
  const list = board.scenes.filter((s) => Array.isArray(s.beat) && (!s.only || s.only === format));
  const vis = list.map((s) => (format === 'tall' && s.tall ? s.tall : s.visual));
  // Clip span per scene in capture seconds
  const span = vis.map((v) => {
    if (v.kind !== 'screen') return null;
    const cap = captures?.[v.src];
    const from = resolveTime(v.from, cap, 0);
    const to = v.to !== undefined ? resolveTime(v.to, cap, cap?.duration ?? 0) : (cap?.duration ?? from);
    return { src: v.src, from, to: Math.max(from, Math.min(to, cap?.duration ?? to)) };
  });
  const joins = list.map((_, i) => i > 0 && !!span[i] && !!span[i - 1] && span[i]!.src === span[i - 1]!.src && Math.abs(span[i]!.from - span[i - 1]!.to) < 0.15);
  const words = list.map((s) => Math.max(1, Math.ceil(s.beat!.reduce((a, b) => a + (b.n ?? 4), 0) / 4)));
  const bars = words.slice();
  const rates: (number | null)[] = list.map(() => null);
  // Walk chains: one speed across the chain, bars split by content length
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j + 1 < list.length && joins[j + 1]) j++;
    if (span[i]) {
      const len = span[j]!.to - span[i]!.from;
      let total = 0;
      for (let k = i; k <= j; k++) total += bars[k];
      const need = Math.ceil(len / MAX_RATE / bar);
      while (total < need) {
        let best = i;
        for (let k = i; k <= j; k++) if ((span[k]!.to - span[k]!.from) / bars[k] > (span[best]!.to - span[best]!.from) / bars[best]) best = k;
        bars[best]++;
        total++;
      }
      const rate = Math.max(0.6, len / (total * bar));
      let t = span[i]!.from;
      for (let k = i; k <= j; k++) {
        rates[k] = rate;
        span[k] = { src: span[k]!.src, from: t, to: t + bars[k] * bar * rate };
        t = span[k]!.to;
      }
    }
    i = j + 1;
  }
  const out: TScene[] = [];
  let cursor = 0;
  list.forEach((s, i) => {
    const raw = vis[i];
    const visual: Visual = raw.kind === 'screen' && span[i] ? { ...raw, from: span[i]!.from, to: span[i]!.to, rate: rates[i] ?? 1 } : raw;
    const start = Math.round(cursor * fps);
    const dur = Math.round((cursor + bars[i] * bar) * fps) - start;
    let b = 0;
    const lines: TLine[] = s.beat!.map((p, k) => {
      const n = p.n ?? 4;
      const ls = Math.round(b * period * fps);
      const le = k === s.beat!.length - 1 ? dur : Math.round((b + n) * period * fps);
      b += n;
      const main = lang === 'en' && p.en ? p.en : p.t;
      return { zh: p.t, en: p.en, main, sub: lang === 'en' || !p.en ? undefined : plain(p.en), start: ls, dur: Math.max(1, le - ls) };
    });
    out.push({ scene: s, visual, start, dur, trans: 0, lines });
    cursor += bars[i] * bar;
  });
  return { scenes: out, total: Math.max(1, Math.round(cursor * fps)), fps, beat: { period, t0 }, joins };
}
