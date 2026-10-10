import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, type PlayerRef } from '@remotion/player';
import { Main } from '../../src/Main';
import { loadProps, type Loaded } from '../../src/lib/load';
import type { Format, Props } from '../../src/lib/types';
import { editTimeline, fmtTime, safe, type EScene, type ETimeline } from './model';
import { addScene, duplicateScene, moveScene, removeScene, setBeatBars, setMinSec, setPath, splitPoint, splitScene, trimEdge, uniqueId, type Caps, type Doc, type Op } from './ops';
import { cancelRender, getAssets, getBoard, getProjects, putBoard, reveal, startRender, type Job } from './api';
import { Timeline, type Edge } from './Timeline';
import { Inspector } from './Inspector';
import { ChatPanel } from './ChatPanel';
import { ADDABLE, sceneTemplate } from './templates';
import { Icon } from './icons';
import type { Fx } from '../../src/lib/types';

const isImg = (a: string) => /\.(png|jpe?g|webp|gif)$/i.test(a);
const isVid = (a: string) => /\.(mp4|webm|mov)$/i.test(a);
const isAud = (a: string) => /\.(mp3|wav|m4a)$/i.test(a);

// SRT timestamps: 00:01:02,345
const srtTime = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const download = (name: string, text: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Small dropdown that closes on outside click
function Menu({ label, icon, children, className, disabled }: { label: React.ReactNode; icon?: string; children: (close: () => void) => React.ReactNode; className?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={className ?? 'tool'} onClick={() => setOpen((o) => !o)} disabled={disabled}>
        {icon ? <Icon name={icon} /> : null}
        {label}
      </button>
      {open ? <div className="menu-pop">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

type Mode = 'voice' | 'beat';
interface Settings {
  slug: string;
  format: Format;
  mode: Mode;
  lang: 'zh' | 'en';
  variant: 'default' | 'clean';
}

const KEY = 'vs-editor';
const query = new URLSearchParams(location.search);

function readSettings(): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    saved = {};
  }
  const pick = <T extends string>(k: keyof Settings, ok: readonly T[], d: T): T => {
    const v = (query.get(k) ?? saved[k]) as T;
    return ok.includes(v) ? v : d;
  };
  return {
    slug: query.get('slug') ?? saved.slug ?? 'showcase',
    format: pick('format', ['wide', 'tall'] as const, 'wide'),
    mode: pick('mode', ['voice', 'beat'] as const, 'voice'),
    lang: pick('lang', ['zh', 'en'] as const, 'zh'),
    variant: pick('variant', ['default', 'clean'] as const, 'default'),
  };
}

function writeSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode: settings just won't persist
  }
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(s)) q.set(k, v);
  q.delete('frame');
  history.replaceState(null, '', `?${q}`);
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : undefined} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </span>
  );
}

function TimeLabel({ player, total, fps }: { player: PlayerRef | null; total: number; fps: number }) {
  const [f, setF] = useState(0);
  useEffect(() => {
    if (!player) return;
    const h = (e: { detail: { frame: number } }) => setF(e.detail.frame);
    player.addEventListener('frameupdate', h);
    player.addEventListener('seeked', h);
    setF(player.getCurrentFrame());
    return () => {
      player.removeEventListener('frameupdate', h);
      player.removeEventListener('seeked', h);
    };
  }, [player]);
  return (
    <span className="time">
      <b>{fmtTime(f, fps)}</b>
      <span>{fmtTime(total, fps)}</span>
    </span>
  );
}

function App() {
  const [st, setSt] = useState(readSettings);
  const S = useRef(st);
  S.current = st;
  const update = (p: Partial<Settings>) =>
    setSt((s) => {
      const n = { ...s, ...p };
      writeSettings(n);
      return n;
    });

  const [projects, setProjects] = useState<string[]>([]);
  const [doc, setDocState] = useState<Doc | null>(null);
  const docRef = useRef<Doc | null>(null);
  const applyDoc = (d: Doc | null) => {
    docRef.current = d;
    setDocState(d);
  };
  const version = useRef('');
  const [draft, setDraft] = useState<Doc | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [toast, setToast] = useState<{ text: string; kind?: 'error' } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [music, setMusic] = useState<{ src: string; beats: boolean }[]>([]);
  const [side, setSide] = useState<'props' | 'ai'>(() => {
    try {
      return localStorage.getItem('vs-side') === 'ai' ? 'ai' : 'props';
    } catch {
      return 'props';
    }
  });
  const [fxClip, setFxClip] = useState<Fx | null>(null);
  const [ask, setAsk] = useState<{ title: string; hint: string; ok: (v: string) => void } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingAdd = useRef<string | null>(null);
  const [, bump] = useState(0);
  const hist = useRef<{ past: { doc: Doc; desc: string; key?: string; t: number }[]; future: { doc: Doc; desc: string }[] }>({ past: [], future: [] });
  const pending = useRef<{ fn: (d: Doc) => Op; desc: string; timings: boolean }[]>([]);
  const saving = useRef(false);
  const missed = useRef<{ src: string; desc: string[] } | null>(null);
  const retries = useRef(0);
  const cache = useRef(new Map<string, Promise<unknown>>());
  const toastTimer = useRef<number | undefined>(undefined);
  const lastEtl = useRef<ETimeline | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flash = (text: string, kind?: 'error') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind ? 7000 : 3500);
  };

  // ---- loading ----
  useEffect(() => {
    getProjects().then(setProjects).catch(() => undefined);
    fetch('/api/music')
      .then((r) => r.json())
      .then(setMusic)
      .catch(() => undefined);
  }, []);
  const refreshAssets = () => getAssets(S.current.slug).then(setAssets).catch(() => undefined);

  useEffect(() => {
    let alive = true;
    applyDoc(null);
    setLoaded(null);
    setSel(null);
    setErr('');
    lastEtl.current = null;
    hist.current = { past: [], future: [] };
    pending.current = [];
    cache.current.clear();
    getBoard(st.slug)
      .then((r) => {
        if (!alive) return;
        version.current = r.version;
        applyDoc({ board: r.board, timings: r.timings });
      })
      .catch((e) => alive && setErr((e as Error).message));
    getAssets(st.slug)
      .then((a) => alive && setAssets(a))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [st.slug]);

  const getJson = <T,>(p: string): Promise<T | undefined> => {
    const d = docRef.current;
    const slug = S.current.slug;
    if (d && p === `${slug}/timings.json`) return Promise.resolve(d.timings.zh as T | undefined);
    if (d && p === `${slug}/timings-en.json`) return Promise.resolve(d.timings.en as T | undefined);
    let pr = cache.current.get(p);
    if (!pr) {
      pr = fetch('/' + p.split('/').map(encodeURIComponent).join('/'))
        .then((r) => (r.ok ? r.json() : undefined))
        .catch(() => undefined);
      cache.current.set(p, pr);
    }
    return pr as Promise<T | undefined>;
  };
  const getDims = (p: string) =>
    new Promise<{ w: number; h: number }>((ok) => {
      const im = new Image();
      im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => ok({ w: 1920, h: 4000 });
      im.src = '/' + p;
    });

  useEffect(() => {
    if (!doc) return;
    let alive = true;
    const props: Props = { slug: st.slug, format: st.format, mode: st.mode, lang: st.lang, variant: st.variant };
    loadProps(props, getJson, getDims, doc.board)
      .then((l) => {
        if (!alive) return;
        setLoaded(l);
        setErr('');
      })
      .catch((e) => alive && setErr(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, [doc, st.slug, st.format, st.mode, st.lang, st.variant]);

  const view = draft ?? doc;
  const ready = !!loaded && loaded.props.slug === st.slug && loaded.props.format === st.format && loaded.props.mode === st.mode;
  const etl = useMemo<ETimeline | null>(() => {
    if (!ready || !view) return null;
    try {
      const t = editTimeline({ ...loaded!.props, board: view.board, timings: st.lang === 'en' ? view.timings.en : view.timings.zh }, loaded!.fps);
      lastEtl.current = t;
      return t;
    } catch {
      return lastEtl.current;
    }
  }, [ready, loaded, view, st.lang]);
  const caps: Caps = loaded?.props.captures ?? {};
  const fps = loaded?.fps ?? 60;

  // ---- saving: ops queue up, each save carries the version it was based on ----
  const pump = async () => {
    if (saving.current || !pending.current.length || !docRef.current) return;
    saving.current = true;
    setSaveState('saving');
    const n = pending.current.length;
    const descs = [...new Set(pending.current.map((x) => x.desc))];
    const timings = pending.current.some((x) => x.timings);
    const slug = S.current.slug;
    try {
      const r = await putBoard(slug, docRef.current, version.current, descs, timings);
      saving.current = false;
      if (S.current.slug !== slug) return;
      if ('version' in r) {
        version.current = r.version;
        pending.current.splice(0, n);
      } else {
        // Someone else saved first: replay our edits on top of theirs
        let d: Doc = { board: r.conflict.board, timings: r.conflict.timings };
        const kept: typeof pending.current = [];
        for (const x of pending.current)
          try {
            d = x.fn(d).doc;
            kept.push(x);
          } catch {
            flash(`和外部改动冲突，「${x.desc}」没保留`, 'error');
          }
        version.current = r.conflict.version;
        pending.current = kept;
        applyDoc(d);
        hist.current = { past: [], future: [] };
        flash('文件刚在别处改过，已合并');
      }
      if (pending.current.length) pump();
      else {
        setSaveState('saved');
        const m = missed.current;
        missed.current = null;
        if (m) handlers.current.syncRemote(m.desc.length ? m : null).catch(() => undefined);
      }
    } catch (e) {
      saving.current = false;
      setSaveState('error');
      // Keep the edits queued and try again shortly
      retries.current++;
      if (retries.current <= 5) window.setTimeout(pump, 800 * retries.current);
      else flash(`保存失败：${(e as Error).message}`, 'error');
      return;
    }
    retries.current = 0;
  };

  const commit = (fn: (d: Doc) => Op, opts: { coalesce?: string; timings?: boolean } = {}) => {
    const cur = docRef.current;
    if (!cur) return;
    let op: Op;
    try {
      op = fn(cur);
    } catch (e) {
      flash((e as Error).message, 'error');
      return;
    }
    const h = hist.current;
    const last = h.past[h.past.length - 1];
    if (opts.coalesce && last?.key === opts.coalesce && Date.now() - last.t < 4000) {
      last.t = Date.now();
      last.desc = op.desc;
    } else h.past.push({ doc: cur, desc: op.desc, key: opts.coalesce, t: Date.now() });
    if (h.past.length > 200) h.past.shift();
    h.future = [];
    applyDoc(op.doc);
    pending.current.push({ fn, desc: op.desc, timings: !!opts.timings });
    bump((x) => x + 1);
    pump();
  };

  const restore = (target: Doc, desc: string) => {
    applyDoc(target);
    pending.current.push({ fn: () => ({ doc: target, desc }), desc, timings: true });
    bump((x) => x + 1);
    pump();
    flash(desc);
  };
  const undo = () => {
    const h = hist.current;
    const e = h.past.pop();
    if (!e || !docRef.current) return;
    h.future.push({ doc: docRef.current, desc: e.desc });
    restore(e.doc, `撤销：${e.desc}`);
  };
  const redo = () => {
    const h = hist.current;
    const e = h.future.pop();
    if (!e || !docRef.current) return;
    h.past.push({ doc: docRef.current, desc: e.desc, t: 0 });
    restore(e.doc, `重做：${e.desc}`);
  };

  // ---- live sync with edits made elsewhere (CLI, other tools) ----
  const syncRemote = async (e: { src: string; desc: string[] } | null) => {
    // A save is in flight: catch up once it lands
    if (saving.current || pending.current.length) {
      missed.current = e ?? missed.current ?? { src: 'external', desc: [] };
      return;
    }
    const r = await getBoard(S.current.slug);
    if (r.version === version.current || saving.current || pending.current.length) return;
    version.current = r.version;
    applyDoc({ board: r.board, timings: r.timings });
    hist.current = { past: [], future: [] };
    bump((x) => x + 1);
    if (e) flash(`${e.src === 'cli' ? 'Claude' : '外部'}改了：${e.desc.join('；')}`);
  };
  const syncTimings = async () => {
    const r = await getBoard(S.current.slug);
    const d = docRef.current;
    if (!d) return;
    if (r.version !== version.current) return syncRemote(null);
    if (JSON.stringify(r.timings) === JSON.stringify(d.timings)) return;
    applyDoc({ ...d, timings: r.timings });
    flash('配音已更新');
  };
  const handlers = useRef({ syncRemote, syncTimings });
  handlers.current = { syncRemote, syncTimings };
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'render' || e.type === 'hello') setJob(e.job);
      if (e.type === 'hello') handlers.current.syncRemote(null).catch(() => undefined);
      if (e.type === 'board' && e.slug === S.current.slug && e.version !== version.current) handlers.current.syncRemote(e).catch(() => undefined);
      if (e.type === 'timings' && e.slug === S.current.slug) handlers.current.syncTimings().catch(() => undefined);
    };
    return () => es.close();
  }, []);

  // ---- player ----
  useEffect(() => {
    if (!player) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    player.addEventListener('play', on);
    player.addEventListener('pause', off);
    player.addEventListener('ended', off);
    const f0 = Number(query.get('frame'));
    if (f0 > 0) {
      player.seekTo(f0);
      query.delete('frame');
    }
    return () => {
      player.removeEventListener('play', on);
      player.removeEventListener('pause', off);
      player.removeEventListener('ended', off);
    };
  }, [player]);
  const seek = (f: number) => player?.seekTo(clamp(Math.round(f), 0, (loaded?.durationInFrames ?? 1) - 1));

  // ---- scene actions ----
  const select = (id: string | null, line?: number) => {
    setSel(id);
    setFocusLine(line ?? null);
  };
  const selE = etl?.scenes.find((s) => s.id === sel) ?? null;

  const doSplit = () => {
    if (!etl || !player) return;
    const f = player.getCurrentFrame();
    const inside = (s: EScene) => f > s.start && f < s.start + s.dur;
    const e = selE && inside(selE) ? selE : etl.scenes.find(inside);
    if (!e) return flash('把播放头放到要拆的那段中间', 'error');
    const rel = f - e.start;
    if (rel < 3 || e.dur - rel < 3) return flash('离这一段的边缘太近', 'error');
    const mode = st.mode;
    commit((d) => splitScene(d, e.id, splitPoint(e, d.board.scenes.find((s) => s.id === e.id)!, rel, etl.fps, caps, mode), caps), { timings: true });
    setSel(e.id);
  };
  const doDup = () => sel && commit((d) => duplicateScene(d, sel));
  const doDel = () => {
    if (!sel) return;
    commit((d) => removeScene(d, sel));
    setSel(null);
  };
  const nudge = (dir: -1 | 1) => {
    if (!sel || !doc) return;
    const b = doc.board.scenes;
    const i = b.findIndex((s) => s.id === sel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= b.length) return;
    commit((d) => moveScene(d, sel, dir < 0 ? b[j].id : (b[j + 1]?.id ?? null)));
  };
  const onMove = (id: string, before: string | null) => {
    if (!etl || !doc) return;
    let beforeId = before;
    if (before === null) {
      const rest = etl.scenes.filter((s) => s.id !== id);
      const order = doc.board.scenes.filter((s) => s.id !== id);
      const k = order.findIndex((s) => s.id === rest[rest.length - 1]?.id);
      beforeId = order[k + 1]?.id ?? null;
    }
    commit((d) => moveScene(d, id, beforeId));
  };

  // Scene under the playhead (prefers the selected one)
  const sceneAtPlayhead = () => {
    if (!etl || !player) return null;
    const f = player.getCurrentFrame();
    const inside = (s: EScene) => f >= s.start && f < s.start + s.dur;
    return selE && inside(selE) ? selE : (etl.scenes.find(inside) ?? null);
  };
  const playheadIn = (id: string) => {
    const e = etl?.scenes.find((s) => s.id === id);
    const f = player?.getCurrentFrame() ?? 0;
    return e && etl ? Math.max(0, Math.min(e.dur, f - e.start) / etl.fps) : 0;
  };

  const addKind = (kind: string, src?: string) => {
    if (!docRef.current) return;
    const after = sel ?? sceneAtPlayhead()?.id ?? null;
    const id = uniqueId(docRef.current.board, `${kind}-1`);
    commit((d) => addScene(d, sceneTemplate(kind, id, src), after));
    setSel(id);
  };

  // Media from disk: images and videos become scenes, audio becomes the voice-cut music
  const upload = async (files: File[]) => {
    let n = 0;
    for (const file of files) {
      try {
        const r = await fetch(`/api/upload?slug=${encodeURIComponent(S.current.slug)}&name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        n++;
        const want = pendingAdd.current;
        if (want === 'image' || (!want && isImg(j.path))) addKind('image', j.path);
        else if (want === 'clip' || (!want && isVid(j.path))) addKind('clip', j.path);
        else if (isAud(j.path)) commit((d) => setPath(d, null, 'music', { ...(d.board.music ?? {}), src: `${S.current.slug}/${j.path}` }));
      } catch (err) {
        flash(`${file.name}：${(err as Error).message}`, 'error');
      }
    }
    pendingAdd.current = null;
    refreshAssets();
    if (n) flash(`已导入 ${n} 个文件`);
  };

  const trimToPlayhead = (edge: Edge) => {
    const e = sceneAtPlayhead();
    if (!e || !etl || !player) return;
    const secs = (player.getCurrentFrame() - e.start) / etl.fps;
    if (secs <= 0.05 || secs >= e.dur / etl.fps - 0.05) return flash('播放头要在这一段中间', 'error');
    const mode = st.mode;
    commit((d) => {
      if (mode === 'beat' && edge === 'r') return setBeatBars(d, e.id, Math.max(1, Math.round(secs / (etl.bar ?? 1))));
      if (e.visual.kind === 'screen' && e.from !== undefined) return trimEdge(d, e.id, e.key, edge === 'l' ? 'from' : 'to', e.from + secs * e.rate, caps);
      if (edge === 'r') return setMinSec(d, e.id, secs);
      throw new Error('这种画面只能裁右边');
    });
  };

  const exportSrt = () => {
    if (!etl) return;
    const cues = etl.scenes.flatMap((s) => s.lines.filter((l) => l.text.trim()).map((l) => ({ a: (s.start + l.start) / etl.fps, b: (s.start + l.start + l.dur) / etl.fps, t: l.text })));
    if (!cues.length) return flash('这一版没有字幕', 'error');
    download(`${st.slug}-${st.format}-${st.mode}.srt`, cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(c.b)}\n${c.t}\n`).join('\n'));
  };
  const exportChapters = () => {
    if (!etl) return;
    const ch = etl.scenes.filter((s) => doc?.board.scenes[s.index]?.chapter).map((s) => `${fmtTime(Math.max(0, s.start), etl.fps).replace(/\.\d+$/, '')} ${doc!.board.scenes[s.index].chapter}`);
    if (!ch.length) return flash('先在段落里填"章节名"', 'error');
    if (!ch[0].startsWith('0:00')) ch.unshift(`0:00 ${doc!.board.title}`);
    download(`${st.slug}-chapters.txt`, ch.join('\n') + '\n');
  };

  const canTrim = (e: EScene, edge: Edge) => {
    if (st.mode === 'beat') return edge === 'r' || e.visual.kind === 'screen';
    return e.visual.kind === 'screen' || edge === 'r';
  };
  const onTrim = (e: EScene, edge: Edge, dSec: number, done: boolean) => {
    if (!etl) return;
    const mode = st.mode;
    const bar = etl.bar ?? 1;
    const fn = (d: Doc): Op => {
      const scene = d.board.scenes.find((s) => s.id === e.id)!;
      const v = scene[e.key];
      if (mode === 'beat' && edge === 'r') return setBeatBars(d, e.id, Math.max(1, Math.round((e.dur / etl.fps + dSec) / bar)));
      if (v?.kind === 'screen') {
        const cap = caps[v.src];
        const from = safe(v.from, cap, 0);
        const to = Math.min(safe(v.to, cap, cap?.duration ?? from + 1), cap?.duration ?? Infinity);
        const rate = v.rate ?? 1;
        if (edge === 'l') return trimEdge(d, e.id, e.key, 'from', clamp(from + dSec * rate, 0, to - 0.2), caps);
        return trimEdge(d, e.id, e.key, 'to', clamp(to + dSec * rate, from + 0.2, cap?.duration ?? Infinity), caps);
      }
      return setMinSec(d, e.id, Math.max(0.5, e.dur / etl.fps + dSec));
    };
    if (!done) {
      try {
        if (docRef.current) setDraft(fn(docRef.current).doc);
      } catch {
        // Ignore positions the op rejects while dragging
      }
      return;
    }
    setDraft(null);
    if (Math.abs(dSec) * etl.fps >= 1) commit(fn);
  };

  // ---- export ----
  const doRender = async (extra: Record<string, string> = {}) => {
    if (pending.current.length || saving.current) return flash('还在保存，稍等一下再导出', 'error');
    try {
      setJob(await startRender({ slug: st.slug, format: st.format, mode: st.mode, variant: st.variant, lang: st.lang, voice: 'on', ...extra }));
    } catch (e) {
      flash((e as Error).message, 'error');
    }
  };

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, textarea, select')) {
        if (ev.key === 'Escape') t.blur();
        return;
      }
      const ctrl = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (ctrl && k === 'z') {
        ev.preventDefault();
        return ev.shiftKey ? redo() : undo();
      }
      if (ctrl && k === 'y') {
        ev.preventDefault();
        return redo();
      }
      // Same keys as CapCut / Premiere: split, duplicate, copy/paste effects
      if (ctrl && !ev.altKey && (k === 'b' || k === 'k')) {
        ev.preventDefault();
        return doSplit();
      }
      if (ctrl && !ev.altKey && k === 'd') {
        ev.preventDefault();
        return doDup();
      }
      if (ctrl && ev.altKey && k === 'c' && sel) {
        ev.preventDefault();
        const fx = docRef.current?.board.scenes.find((s) => s.id === sel)?.fx;
        setFxClip(fx ?? null);
        return flash(fx ? `已复制 ${sel} 的特效` : `${sel} 没有特效`);
      }
      if (ctrl && ev.altKey && k === 'v' && sel && fxClip) {
        ev.preventDefault();
        return commit((d) => setPath(d, sel, 'fx', { ...fxClip }));
      }
      if (ctrl || ev.altKey) return;
      if (k === 'q' || k === 'w') {
        ev.preventDefault();
        return trimToPlayhead(k === 'q' ? 'l' : 'r');
      }
      if (ev.key === ' ') {
        ev.preventDefault();
        player?.toggle();
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        const step = ev.shiftKey ? fps : 1;
        seek((player?.getCurrentFrame() ?? 0) + (ev.key === 'ArrowLeft' ? -step : step));
      } else if (ev.key === 'Home') seek(0);
      else if (ev.key === 'End') seek((loaded?.durationInFrames ?? 1) - 1);
      else if (ev.key === 'Delete' || ev.key === 'Backspace') doDel();
      else if (k === 's') doSplit();
      else if (ev.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const h = hist.current;
  // Preview box at the composition's exact aspect ratio
  const ar = loaded ? loaded.width / loaded.height : 16 / 9;
  const fw = Math.max(0, Math.min(stage.w - 48, (stage.h - 40) * ar));
  const fh = fw / ar;

  // Electron has no window.prompt, so new projects use an in-app dialog
  const newProject = () =>
    setAsk({
      title: '新建项目',
      hint: '项目名只用英文字母、数字和横线，例如 my-first-video',
      ok: async (name) => {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: name, title: name }) });
        const j = await r.json();
        if (!r.ok) return flash(j.error ?? '新建失败', 'error');
        setProjects(await getProjects());
        update({ slug: j.slug, mode: 'voice' });
      },
    });
  const ctxNow = () => ({ format: st.format, mode: st.mode, lang: st.lang, variant: st.variant, sel, t: (player?.getCurrentFrame() ?? 0) / fps });
  const where = `${sel ? `选中 ${sel}` : '未选中段落'} · ${st.format === 'tall' ? '竖屏' : '横屏'}${st.mode === 'beat' ? '卡点版' : '旁白版'}`;

  return (
    <div
      className={`app${dragOver ? ' drop' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*"
        onChange={(e) => {
          if (e.target.files?.length) upload([...e.target.files]);
          e.target.value = '';
        }}
      />
      <div className="top">
        <select className="proj" value={st.slug} onChange={(e) => (e.target.value === '__new' ? newProject() : update({ slug: e.target.value }))} title="项目">
          {(projects.includes(st.slug) ? projects : [st.slug, ...projects]).map((p) => (
            <option key={p}>{p}</option>
          ))}
          <option value="__new">+ 新建项目…</option>
        </select>
        <div className="versions">
          <Seg value={st.format} options={[['wide', '横屏'], ['tall', '竖屏']]} onChange={(v) => update({ format: v })} />
          <Seg value={st.mode} options={[['voice', '旁白版'], ['beat', '卡点版']]} onChange={(v) => update({ mode: v })} />
          <Seg value={st.lang} options={[['zh', '中文'], ['en', 'English']]} onChange={(v) => update({ lang: v })} />
          <Seg value={st.variant} options={[['default', '带网址'], ['clean', '无网址']]} onChange={(v) => update({ variant: v })} />
        </div>
        <span className="grow" />
        <div className="hist">
          <button className="icon" onClick={undo} disabled={!h.past.length} title={h.past.length ? `撤销：${h.past[h.past.length - 1].desc}` : '撤销'}>
            <Icon name="undo" />
          </button>
          <button className="icon" onClick={redo} disabled={!h.future.length} title={h.future.length ? `重做：${h.future[h.future.length - 1].desc}` : '重做'}>
            <Icon name="redo" />
          </button>
        </div>
        <span className={`save ${saveState}`}>
          <i />
          {saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : '已保存'}
        </span>
        {job?.state === 'running' ? (
          <span className="job">
            {job.phase} {pct}%
            <span className="bar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <button className="icon" onClick={() => cancelRender()} title="取消导出">
              <Icon name="close" />
            </button>
          </span>
        ) : job?.state === 'done' ? (
          <span className="job">
            {job.out.replace(/^.*[\\/]/, '')}
            <button className="ghost" onClick={() => reveal(job.out)}>
              <Icon name="folder" />
              打开位置
            </button>
          </span>
        ) : job?.state === 'error' ? (
          <span className="job">
            <button className="ghost danger" onClick={() => flash(job.tail.slice(-6).join('\n'), 'error')}>导出失败，看原因</button>
          </span>
        ) : null}
        <div className="split-btn">
          <button className="primary" onClick={() => doRender()} disabled={job?.state === 'running' || !ready}>
            <Icon name="export" />
            导出视频
          </button>
          <Menu label="" icon="down" className="primary more" disabled={!ready}>
            {(close) => (
              <>
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender({ scale: '2' }))}>
                  2 倍分辨率（B站 4K）
                </button>
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender({ codec: 'gif', scale: '0.5' }))}>
                  GIF 动图（半尺寸）
                </button>
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender({ codec: 'prores' }))}>
                  ProRes 母带（.mov）
                </button>
                <div className="menu-sep" />
                <button onClick={() => (close(), exportSrt())}>字幕文件 SRT</button>
                <button onClick={() => (close(), exportChapters())}>章节时间轴（B站/YouTube）</button>
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="mid">
        <div className="stage" ref={stageRef}>
          {err ? <div className="banner">{err}</div> : null}
          {ready ? (
            <div className="frame" style={{ width: fw, height: fh }}>
              <div className="iso">
              <Player
                ref={setPlayer}
                component={Main}
                inputProps={loaded!.props}
                durationInFrames={loaded!.durationInFrames}
                compositionWidth={loaded!.width}
                compositionHeight={loaded!.height}
                fps={loaded!.fps}
                style={{ width: '100%', height: '100%' }}
                controls={false}
                clickToPlay={false}
                doubleClickToFullscreen={false}
                spaceKeyToPlayOrPause={false}
                numberOfSharedAudioTags={16}
                errorFallback={({ error }) => <div style={{ padding: 20, color: '#b42318', background: '#fff' }}>{error.message}</div>}
                acknowledgeRemotionLicense
              />
              </div>
            </div>
          ) : (
            <div className="empty">载入中…</div>
          )}
        </div>
        <div className="side">
          <div className="tabs">
            {(
              [
                ['props', '属性'],
                ['ai', 'AI 助手'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                className={side === k ? 'on' : undefined}
                onClick={() => {
                  setSide(k);
                  try {
                    localStorage.setItem('vs-side', k);
                  } catch {
                    // Private mode
                  }
                }}
              >
                {l}
              </button>
            ))}
          </div>
          {side === 'ai' ? (
            <ChatPanel slug={st.slug} context={ctxNow} where={where} />
          ) : doc ? (
            <Inspector
              doc={doc}
              slug={st.slug}
              format={st.format}
              mode={st.mode}
              etl={etl}
              caps={caps}
              assets={assets}
              music={music}
              sel={sel}
              focusLine={focusLine}
              commit={commit}
              onSelect={(id) => select(id)}
              actions={{ split: doSplit, dup: doDup, del: doDel, up: () => nudge(-1), down: () => nudge(1) }}
              fxClip={fxClip}
              setFxClip={(fx) => {
                setFxClip(fx);
                if (fx) flash('已复制特效，选别的段落点"粘贴"');
              }}
              playheadIn={playheadIn}
            />
          ) : (
            <div className="insp" />
          )}
        </div>
      </div>
      {dragOver ? <div className="drop-hint">松开鼠标导入素材：图片、视频变成新段落，音频设为配乐</div> : null}

      {etl ? (
        <Timeline
          etl={etl}
          slug={st.slug}
          theme={doc!.board.theme}
          player={player}
          sel={sel}
          zoom={zoom}
          setZoom={setZoom}
          onSelect={select}
          onSeek={seek}
          onMove={onMove}
          canTrim={canTrim}
          onTrim={onTrim}
          tools={
            <>
              <button className="play" onClick={() => player?.toggle()} title={playing ? '暂停' : '播放'}>
                <Icon name={playing ? 'pause' : 'play'} size={18} />
              </button>
              <TimeLabel player={player} total={etl.total} fps={etl.fps} />
              <span className="sep" />
              <Menu label="添加" icon="plus">
                {(close) => (
                  <>
                    {ADDABLE.filter(([, , src]) => !src).map(([k, l]) => (
                      <button key={k} onClick={() => (close(), addKind(k))}>
                        {l}
                      </button>
                    ))}
                    <div className="menu-sep" />
                    {(
                      [
                        ['image', '图片', isImg],
                        ['clip', '视频', (a: string) => isVid(a) && !a.startsWith('cap/')],
                        ['screen', '录屏', (a: string) => a.startsWith('cap/') && isVid(a)],
                      ] as [string, string, (a: string) => boolean][]
                    ).map(([k, l, ok]) => {
                      const list = assets.filter(ok);
                      return list.length ? (
                        <div key={k} className="menu-group">
                          <div className="menu-h">{l}</div>
                          {list.slice(0, 12).map((a) => (
                            <button key={a} onClick={() => (close(), addKind(k, a))} title={a}>
                              {a.replace(/^.*\//, '')}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })}
                    <div className="menu-sep" />
                    <button
                      onClick={() => {
                        close();
                        pendingAdd.current = null;
                        fileInput.current?.click();
                      }}
                    >
                      从电脑导入图片 / 视频 / 音乐…
                    </button>
                  </>
                )}
              </Menu>
              <button className="tool" onClick={doSplit} title="在播放头处拆分 (Ctrl+B)">
                <Icon name="split" />
                拆分
              </button>
              <button className="tool" onClick={doDup} disabled={!sel}>
                <Icon name="copy" />
                复制
              </button>
              <button className="tool danger" onClick={doDel} disabled={!sel}>
                <Icon name="trash" />
                删除
              </button>
              {etl.hidden.length ? (
                <span className="hint">
                  这一版没用到
                  {etl.hidden.map((x) => (
                    <button key={x.id} className="chip-btn" onClick={() => select(x.id)} title={x.why}>
                      {x.id}
                    </button>
                  ))}
                </span>
              ) : null}
            </>
          }
        />
      ) : (
        <div className="tl" />
      )}

      {toast ? <div className={`toast${toast.kind === 'error' ? ' error' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{toast.text}</div> : null}
      {ask ? <AskDialog {...ask} close={() => setAsk(null)} /> : null}
    </div>
  );
}

function AskDialog({ title, hint, ok, close }: { title: string; hint: string; ok: (v: string) => void; close: () => void }) {
  const [v, setV] = useState('');
  const submit = () => {
    if (!v.trim()) return;
    close();
    ok(v.trim());
  };
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? submit() : e.key === 'Escape' ? close() : undefined)} />
        <div className="hint">{hint}</div>
        <div className="modal-acts">
          <button className="ghost" onClick={close}>
            取消
          </button>
          <button className="primary" onClick={submit} disabled={!v.trim()}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// Bare player at composition size, driven by tests through window.__player
function Oracle() {
  const st = readSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    document.documentElement.classList.add('oracle');
    getBoard(st.slug).then((r) => {
      const getJson = async <T,>(p: string): Promise<T | undefined> => {
        if (p === `${st.slug}/timings.json`) return r.timings.zh as T | undefined;
        if (p === `${st.slug}/timings-en.json`) return r.timings.en as T | undefined;
        const res = await fetch('/' + p);
        return res.ok ? ((await res.json()) as T) : undefined;
      };
      loadProps({ slug: st.slug, format: st.format, mode: st.mode, lang: st.lang, variant: st.variant }, getJson, async () => ({ w: 1920, h: 4000 }), r.board).then(setLoaded);
    });
  }, []);
  if (!loaded) return null;
  return (
    <div className="iso">
      <Player
        ref={(p) => {
          (window as unknown as { __player: PlayerRef | null }).__player = p;
        }}
        component={Main}
        inputProps={loaded.props}
        durationInFrames={loaded.durationInFrames}
        compositionWidth={loaded.width}
        compositionHeight={loaded.height}
        fps={loaded.fps}
        style={{ width: loaded.width, height: loaded.height }}
        numberOfSharedAudioTags={16}
        acknowledgeRemotionLicense
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(query.get('oracle') ? <Oracle /> : <App />);
