import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, type PlayerRef } from '@remotion/player';
import { Main } from '../../src/Main';
import { loadProps, type Loaded } from '../../src/lib/load';
import type { Format, Props } from '../../src/lib/types';
import { editTimeline, fmtTime, safe, type EScene, type ETimeline } from './model';
import { addScene, addSound, duplicateScene, moveScene, moveSound, removeOverlay, removeSound, removeScene, setBeatBars, setMinSec, setPath, splitPoint, splitScene, trimEdge, uniqueId, type Caps, type Doc, type Op } from './ops';
import { cancelRender, getAssets, getBoard, getExports, getProjects, openExports, putBoard, reveal, startRender, type Job } from './api';
import { Timeline, type Edge } from './Timeline';
import { Inspector, type Focus } from './Inspector';
import { ChatPanel } from './ChatPanel';
import { Library, type LibTab } from './Library';
import { ADDABLE, sceneTemplate } from './templates';
import { Icon, Logo } from './icons';
import { OVERLAY_LIST } from './catalog';
import { LANG, nm, tr } from './i18n';
import { textSample } from '../../src/fx/demo';
import { resolvePick, type AiRef } from './pick';
import { soundDef } from '../../src/fx/sounds';
import { SettingsPage, type SettingsTab } from './SettingsPage';
import { getPrefs, usePrefs } from './prefs';
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

// What the main Export button makes (Settings › Export)
const EXPORT_PRESET: Record<string, Record<string, string>> = { mp4: {}, '2x': { scale: '2' }, gif: { codec: 'gif', scale: '0.5' }, prores: { codec: 'prores' } };

function Seg<T extends string>({ value, options, onChange, className }: { value: T; options: [T, string, string?, string?, string?][]; onChange: (v: T) => void; className?: string }) {
  return (
    <span className={`seg${className ? ' ' + className : ''}`}>
      {options.map(([v, label, icon, title, aria]) => (
        <button key={v} className={v === value ? 'on' : undefined} onClick={() => onChange(v)} title={title} aria-label={aria} aria-pressed={v === value}>
          {icon ? <Icon name={icon} size={14} /> : null}
          {label}
        </button>
      ))}
    </span>
  );
}

const pref = {
  get: (k: string, d: number) => {
    try {
      const v = Number(localStorage.getItem(k));
      return v > 0 ? v : d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: number | string) => {
    try {
      localStorage.setItem(k, String(v));
    } catch {
      // Private mode
    }
  },
};

// Drag handle between panels; reports the pointer delta since the drag began
function Splitter({ dir, onDrag, onEnd }: { dir: 'x' | 'y'; onDrag: (d: number) => void; onEnd: () => void }) {
  const start = useRef<number | null>(null);
  return (
    <div
      className={`split-${dir}`}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = dir === 'x' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => start.current !== null && onDrag((dir === 'x' ? e.clientX : e.clientY) - start.current)}
      onPointerUp={() => {
        start.current = null;
        onEnd();
      }}
    />
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
      <span>/ {fmtTime(total, fps)}</span>
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
  // Settings window: open page, and a counter that tells the AI panel to re-read its connection
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [aiKey, setAiKey] = useState(0);
  const prefs = usePrefs();
  const settingsOpen = useRef(false);
  settingsOpen.current = settingsTab !== null;
  // Selected sound cue ("scene:i") and the cue the inspector should open
  // Selected sound or overlay on the timeline ("sound:scene:i" / "overlay:scene:i") and the inspector page to open
  const [selCue, setSelCue] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [toast, setToast] = useState<{ text: string; kind?: 'error' } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  // Card that says where a finished export went; stays until closed
  const [doneCard, setDoneCard] = useState(false);
  const lastJobState = useRef<string | undefined>(undefined);
  const [exportDir, setExportDir] = useState('');
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [assetsOf, setAssetsOf] = useState('');
  const [music, setMusic] = useState<{ src: string; beats: boolean }[]>([]);
  const [side, setSide] = useState<'props' | 'ai'>(() => {
    try {
      return localStorage.getItem('vs-side') === 'ai' ? 'ai' : 'props';
    } catch {
      return 'props';
    }
  });
  const [fxClip, setFxClip] = useState<Fx | null>(null);
  const [libTab, setLibTab] = useState<LibTab>(() => {
    try {
      return (localStorage.getItem('vs-lib') as LibTab) || 'media';
    } catch {
      return 'media';
    }
  });
  const [size, setSize] = useState(() => ({ lib: pref.get('vs-w-lib2', innerWidth < 1440 ? 300 : 340), side: pref.get('vs-w-side2', innerWidth < 1440 ? 330 : 356), tl: pref.get('vs-h-tl2', innerHeight < 860 ? 280 : 340) }));
  const size0 = useRef(size);
  const [phId, setPhId] = useState<string | null>(null);
  // Ctrl+click pointing: references waiting in the AI input
  const [aiRefs, setAiRefs] = useState<AiRef[]>([]);
  const [pickHeld, setPickHeld] = useState(false);
  const [pickArmed, setPickArmed] = useState(false);
  const [pickHl, setPickHl] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null);
  const [chatFocus, setChatFocus] = useState(0);
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
      .then((a) => {
        if (!alive) return;
        setAssets(a);
        setAssetsOf(st.slug);
      })
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
  // Scenes whose media file is not in the project folder
  const missing = useMemo(() => {
    const out = new Map<string, string>();
    if (!doc || assetsOf !== st.slug) return out;
    const have = new Set(assets);
    for (const s of doc.board.scenes)
      for (const v of [st.format === 'tall' ? (s.tall ?? s.visual) : s.visual])
        if (v && (v.kind === 'screen' || v.kind === 'clip' || v.kind === 'image') && v.src && !v.src.startsWith('../') && !have.has(v.src)) out.set(s.id, v.src);
    return out;
  }, [doc, assets, assetsOf, st.slug, st.format]);
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
            flash(tr(`Conflicts with an outside edit; dropped "${x.desc}"`, `和外部改动冲突，「${x.desc}」没保留`), 'error');
          }
        version.current = r.conflict.version;
        pending.current = kept;
        applyDoc(d);
        hist.current = { past: [], future: [] };
        flash(tr('The file was just changed elsewhere; merged', '文件刚在别处改过，已合并'));
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
      else flash(tr(`Save failed: ${(e as Error).message}`, `保存失败：${(e as Error).message}`), 'error');
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
    restore(e.doc, tr(`Undo: ${e.desc}`, `撤销：${e.desc}`));
  };
  const redo = () => {
    const h = hist.current;
    const e = h.future.pop();
    if (!e || !docRef.current) return;
    h.past.push({ doc: docRef.current, desc: e.desc, t: 0 });
    restore(e.doc, tr(`Redo: ${e.desc}`, `重做：${e.desc}`));
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
    if (e) flash(tr(`${e.src === 'cli' ? 'Claude' : 'Outside'} edit: ${e.desc.join('; ')}`, `${e.src === 'cli' ? 'Claude' : '外部'}改了：${e.desc.join('；')}`));
  };
  const syncTimings = async () => {
    const r = await getBoard(S.current.slug);
    const d = docRef.current;
    if (!d) return;
    if (r.version !== version.current) return syncRemote(null);
    if (JSON.stringify(r.timings) === JSON.stringify(d.timings)) return;
    applyDoc({ ...d, timings: r.timings });
    flash(tr('Voice-over updated', '配音已更新'));
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

  useEffect(() => {
    if (job?.state === 'done' && lastJobState.current === 'running') setDoneCard(true);
    if (job?.state === 'running') setDoneCard(false);
    lastJobState.current = job?.state;
  }, [job?.state]);
  useEffect(() => {
    getExports()
      .then((e) => setExportDir(e.dir))
      .catch(() => undefined);
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
  useEffect(() => {
    if (!player || !etl) return;
    const upd = (f: number) => {
      const s = etl.scenes.find((x) => f >= x.start && f < x.start + x.dur);
      setPhId(s?.id ?? null);
    };
    const h = (e: { detail: { frame: number } }) => upd(e.detail.frame);
    player.addEventListener('frameupdate', h);
    player.addEventListener('seeked', h);
    upd(player.getCurrentFrame());
    return () => {
      player.removeEventListener('frameupdate', h);
      player.removeEventListener('seeked', h);
    };
  }, [player, etl]);
  const seek = (f: number) => player?.seekTo(clamp(Math.round(f), 0, (loaded?.durationInFrames ?? 1) - 1));

  // ---- scene actions ----
  const select = (id: string | null, line?: number) => {
    setSel(id);
    setFocusLine(line ?? null);
    setSelCue(null);
  };
  const selE = etl?.scenes.find((s) => s.id === sel) ?? null;

  const doSplit = () => {
    if (!etl || !player) return;
    const f = player.getCurrentFrame();
    const inside = (s: EScene) => f > s.start && f < s.start + s.dur;
    const e = selE && inside(selE) ? selE : etl.scenes.find(inside);
    if (!e) return flash(tr('Put the playhead inside the scene you want to split', '把播放头放到要拆的那段中间'), 'error');
    const rel = f - e.start;
    if (rel < 3 || e.dur - rel < 3) return flash(tr('Too close to the edge of the scene', '离这一段的边缘太近'), 'error');
    const mode = st.mode;
    commit((d) => splitScene(d, e.id, splitPoint(e, d.board.scenes.find((s) => s.id === e.id)!, rel, etl.fps, caps, mode), caps), { timings: true });
    setSel(e.id);
  };
  const doDup = () => sel && commit((d) => duplicateScene(d, sel));
  const doDel = () => {
    if (selCue) {
      const [kind, sid, i] = selCue.split(':');
      commit((d) => (kind === 'sound' ? removeSound(d, sid, Number(i)) : removeOverlay(d, sid, Number(i))));
      setSelCue(null);
      return;
    }
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
  // Scene a frame belongs to; during a transition, the one coming in
  const sceneAtFrame = (f: number) => etl?.scenes.filter((s) => f >= s.start && f < s.start + s.dur).pop() ?? null;
  const focusCue = (kind: 'sound' | 'overlay', scene: string, i: number) => {
    setSel(scene);
    setFocusLine(null);
    setSelCue(`${kind}:${scene}:${i}`);
    setFocus({ tab: kind === 'sound' ? 'sound' : 'over', i, n: Date.now() });
    setSide('props');
  };
  // Effect, camera or transition badge on the timeline: that scene's settings page
  const openTab = (scene: string, tab: 'visual' | 'trans' | 'fx') => {
    setSel(scene);
    setFocusLine(null);
    setSelCue(null);
    setFocus({ tab, n: Date.now() });
    setSide('props');
  };
  const onOverlayEdit = (scene: string, i: number, patch: { at?: number; dur?: number }) =>
    commit((d) => {
      let op = null as Op | null;
      for (const [k, v] of Object.entries(patch)) op = setPath(op?.doc ?? d, scene, `overlays.${i}.${k}`, v);
      return op!;
    });
  const placeSound = (id: string, f: number) => {
    const s = sceneAtFrame(f);
    const def = soundDef(id);
    if (!s || !etl || !def || !docRef.current) return;
    const i = docRef.current.board.scenes.find((x) => x.id === s.id)?.sounds?.length ?? 0;
    commit((d) => addSound(d, s.id, id, (f - s.start) / etl.fps));
    focusCue('sound', s.id, i);
    flash(tr(`Added "${def.en}" to ${s.id}`, `已在 ${s.id} 加上「${def.zh}」`));
  };
  const libSound = (id: string) => placeSound(id, player?.getCurrentFrame() ?? 0);
  const onSoundMove = (from: string, i: number, f: number) => {
    const s = sceneAtFrame(f);
    if (!s || !etl || !docRef.current) return;
    const j = s.id === from ? i : (docRef.current.board.scenes.find((x) => x.id === s.id)?.sounds?.length ?? 0);
    commit((d) => moveSound(d, from, i, s.id, (f - s.start) / etl.fps));
    focusCue('sound', s.id, j);
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
    const img = kind === 'compare' && !src ? assets.find((a) => /\.(png|jpe?g|webp)$/i.test(a)) : src;
    const sc = sceneTemplate(kind, id, img, LANG);
    // Settings › Editing: image length, push-in, transition into new scenes
    const pf = getPrefs();
    if (kind === 'image') {
      sc.minSec = pf.imageSec;
      if (!pf.imagePush && sc.fx) {
        delete sc.fx.kenburns;
        delete sc.fx.kbAmount;
        if (!Object.keys(sc.fx).length) delete sc.fx;
      }
    }
    if (sc.transition !== undefined) sc.transition = pf.newTransition || 'fade';
    commit((d) => addScene(d, sc, after));
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
        flash(`${file.name}: ${(err as Error).message}`, 'error');
      }
    }
    pendingAdd.current = null;
    refreshAssets();
    if (n) flash(tr(`Imported ${n} file${n > 1 ? 's' : ''}`, `已导入 ${n} 个文件`));
  };

  const trimToPlayhead = (edge: Edge) => {
    const e = sceneAtPlayhead();
    if (!e || !etl || !player) return;
    const secs = (player.getCurrentFrame() - e.start) / etl.fps;
    if (secs <= 0.05 || secs >= e.dur / etl.fps - 0.05) return flash(tr('The playhead has to be inside the scene', '播放头要在这一段中间'), 'error');
    const mode = st.mode;
    commit((d) => {
      if (mode === 'beat' && edge === 'r') return setBeatBars(d, e.id, Math.max(1, Math.round(secs / (etl.bar ?? 1))));
      if (e.visual.kind === 'screen' && e.from !== undefined) return trimEdge(d, e.id, e.key, edge === 'l' ? 'from' : 'to', e.from + secs * e.rate, caps);
      if (edge === 'r') return setMinSec(d, e.id, secs);
      throw new Error(tr('This kind of scene can only be trimmed at its end', '这种画面只能裁右边'));
    });
  };

  const exportSrt = () => {
    if (!etl) return;
    const cues = etl.scenes.flatMap((s) => s.lines.filter((l) => l.text.trim()).map((l) => ({ a: (s.start + l.start) / etl.fps, b: (s.start + l.start + l.dur) / etl.fps, t: l.text })));
    if (!cues.length) return flash(tr('This version has no captions', '这一版没有字幕'), 'error');
    download(`${st.slug}-${st.format}-${st.mode}.srt`, cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(c.b)}\n${c.t}\n`).join('\n'));
  };
  const exportChapters = () => {
    if (!etl) return;
    const ch = etl.scenes.filter((s) => doc?.board.scenes[s.index]?.chapter).map((s) => `${fmtTime(Math.max(0, s.start), etl.fps).replace(/\.\d+$/, '')} ${doc!.board.scenes[s.index].chapter}`);
    if (!ch.length) return flash(tr('Give some scenes a chapter name first', '先在段落里填"章节名"'), 'error');
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
    if (pending.current.length || saving.current) return flash(tr('Still saving; export again in a moment', '还在保存，稍等一下再导出'), 'error');
    try {
      setJob(await startRender({ slug: st.slug, format: st.format, mode: st.mode, variant: st.variant, lang: st.lang, voice: 'on', ...extra }));
    } catch (e) {
      flash((e as Error).message, 'error');
    }
  };

  useEffect(() => {
    player?.setVolume(prefs.volume);
  }, [player, prefs.volume]);

  // ---- pointing at things for the AI (hold Ctrl, or arm from the AI panel) ----
  const pickCtx = () => ({ etl, scenes: docRef.current?.board.scenes ?? [], frame: player?.getCurrentFrame() ?? 0, fps, size: { w: loaded?.width ?? 1920, h: loaded?.height ?? 1080 }, sel });
  const pickRef = useRef({ pickCtx, armed: pickArmed, held: pickHeld });
  pickRef.current = { pickCtx, armed: pickArmed, held: pickHeld };
  useEffect(() => {
    let swallowClick = false;
    const active = (e: { ctrlKey: boolean; metaKey: boolean }) => pickRef.current.armed || e.ctrlKey || e.metaKey;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setPickHeld(e.type === 'keydown');
      if (e.key === 'Escape' && pickRef.current.armed) setPickArmed(false);
    };
    const off = () => {
      setPickHeld(false);
      setPickHl(null);
    };
    const onMove = (e: PointerEvent) => {
      if (!active(e)) return setPickHl(null);
      const hit = resolvePick(e.target as Element, e.clientX, e.clientY, pickRef.current.pickCtx());
      if (!hit) return setPickHl(null);
      const r = hit.el.getBoundingClientRect();
      setPickHl({ x: r.left, y: r.top, w: r.width, h: r.height, label: hit.ref.label });
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !active(e)) return;
      const t = e.target as Element;
      if (!t.closest('.app') || t.closest('.chat-input')) return;
      const hit = resolvePick(t, e.clientX, e.clientY, pickRef.current.pickCtx());
      if (!hit) return;
      // The click selects nothing and scrubs nothing; it only points
      e.preventDefault();
      e.stopPropagation();
      swallowClick = true;
      setAiRefs((rs) => (rs.some((r) => r.key === hit.ref.key) ? rs : [...rs, hit.ref].slice(-6)));
      setPickArmed(false);
      setPickHl(null);
      setSide('ai');
      setChatFocus((n) => n + 1);
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', off);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', off);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);
  useEffect(() => {
    if (!pickHeld && !pickArmed) setPickHl(null);
  }, [pickHeld, pickArmed]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if ((ev.ctrlKey || ev.metaKey) && ev.key === ',') {
        ev.preventDefault();
        return setSettingsTab((x) => (x ? null : 'general'));
      }
      // The settings window handles its own keys
      if (settingsOpen.current) return;
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
        return flash(fx ? tr(`Copied the effects of ${sel}`, `已复制 ${sel} 的特效`) : tr(`${sel} has no effects`, `${sel} 没有特效`));
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
  const fw = Math.max(0, Math.min(stage.w - 32, (stage.h - 24) * ar));
  const fh = fw / ar;

  // Electron has no window.prompt, so new projects use an in-app dialog
  const newProject = () =>
    setAsk({
      title: tr('New project', '新建项目'),
      hint: tr('Letters, digits and dashes only, e.g. my-first-video', '项目名只用英文字母、数字和横线，例如 my-first-video'),
      ok: async (name) => {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: name, title: name }) });
        const j = await r.json();
        if (!r.ok) return flash(j.error ?? tr('Could not create the project', '新建失败'), 'error');
        setProjects(await getProjects());
        update({ slug: j.slug, mode: 'voice' });
      },
    });
  const ctxNow = () => ({ format: st.format, mode: st.mode, lang: st.lang, variant: st.variant, sel, t: (player?.getCurrentFrame() ?? 0) / fps });
  const versionText = `${st.format === 'tall' ? tr('9:16 vertical', '竖屏 9:16') : tr('16:9 widescreen', '横屏 16:9')} · ${st.mode === 'beat' ? tr('beat cut', '卡点版') : tr('narrated cut', '旁白版')} · ${st.lang === 'en' ? tr('English', '英文版') : tr('Chinese', '中文版')}${st.variant === 'clean' ? tr(' · no URLs', ' · 无网址') : ''}`;
  const where = `${sel ? tr(`Selected: ${sel}`, `选中 ${sel}`) : tr('No scene selected', '未选中段落')} · ${versionText}`;

  // Library actions land on the selected scene, else the one under the playhead
  const targetId = sel ?? phId;
  const target = doc?.board.scenes.find((s) => s.id === targetId) ?? null;
  const preview = target ?? doc?.board.scenes.find((s) => ['screen', 'image', 'clip'].includes(s.visual.kind)) ?? null;
  const needTarget = () => {
    if (!target) flash(tr('Select a scene on the timeline first', '先在时间线上点选一段'), 'error');
    return target;
  };
  const libOverlay = (kind: string, extra: Record<string, unknown> = {}) => {
    const t = needTarget();
    const def = OVERLAY_LIST.find((o) => o.id === kind);
    if (!t || !def) return;
    const at = Math.max(0, Math.round(playheadIn(t.id) * 10) / 10);
    // Text animations start with sample text that shows the effect off
    const text = kind === 'text' && typeof extra.anim === 'string' ? { text: textSample(extra.anim) } : {};
    commit((d) => setPath(d, t.id, `overlays.${t.overlays?.length ?? 0}`, { kind, at, dur: getPrefs().overlaySec, ...def.init, ...text, ...extra }));
    select(t.id);
    flash(tr(`Added "${def.en}" to ${t.id}`, `已在 ${t.id} 加上「${def.zh}」`));
  };
  const libFx = (preset: Record<string, unknown>, on: boolean) => {
    const t = needTarget();
    if (!t) return;
    const next: Record<string, unknown> = { ...(t.fx ?? {}) };
    for (const [k, v] of Object.entries(preset)) {
      if (on) delete next[k];
      else next[k] = v;
    }
    commit((d) => setPath(d, t.id, 'fx', Object.keys(next).length ? next : undefined));
  };
  const libBg = (id: string) => commit((d) => setPath(d, null, 'theme.bgFx', id || undefined));
  const libTransition = (v: string) => {
    const t = needTarget();
    if (!t) return;
    commit((d) => setPath(d, t.id, st.mode === 'beat' ? 'beatTransition' : 'transition', v || undefined));
  };
  const libLook = (v: string) => {
    const t = needTarget();
    if (!t) return;
    commit((d) => setPath(d, t.id, 'fx.look', v || undefined));
  };
  const libMusic = (src: string) =>
    commit((d) => (st.mode === 'beat' ? setPath(d, null, 'beat', { ...(d.board.beat ?? {}), music: src }) : setPath(d, null, 'music', { ...(d.board.music ?? {}), src })));
  const jump = (dir: -1 | 1) => {
    if (!etl || !player) return;
    const f = player.getCurrentFrame();
    const starts = etl.scenes.map((s) => Math.max(0, s.start));
    const to = dir < 0 ? [...starts].reverse().find((x) => x < f - 2) : starts.find((x) => x > f + 1);
    seek(to ?? (dir < 0 ? 0 : (loaded?.durationInFrames ?? 1) - 1));
  };
  const resize = (k: 'lib' | 'side' | 'tl', d: number) => {
    const lim = { lib: [250, 520], side: [280, 560], tl: [200, 520] }[k];
    setSize((s) => ({ ...s, [k]: clamp(size0.current[k] + d, lim[0], lim[1]) }));
  };
  const resized = () => {
    size0.current = size;
    pref.set('vs-w-lib2', size.lib);
    pref.set('vs-w-side2', size.side);
    pref.set('vs-h-tl2', size.tl);
  };
  const setSideTab = (k: 'props' | 'ai') => {
    setSide(k);
    pref.set('vs-side', k);
  };

  return (
    <div
      className={`app${dragOver ? ' filedrop' : ''}${pickHeld || pickArmed ? ' picking' : ''}`}
      style={{ ['--lib-w' as string]: `${size.lib}px`, ['--side-w' as string]: `${size.side}px`, ['--tl-h' as string]: `${size.tl}px` }}
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
      <header className="top">
        <span className="brand">
          <Logo size={20} />
          Cutroom
        </span>
        <span className="top-sep" />
        <label className="proj" title={tr('Switch project', '切换项目')}>
          <Icon name="folder" size={14} />
          <span>{st.slug}</span>
          <select value={st.slug} onChange={(e) => (e.target.value === '__new' ? newProject() : update({ slug: e.target.value }))}>
            {(projects.includes(st.slug) ? projects : [st.slug, ...projects]).map((p) => (
              <option key={p}>{p}</option>
            ))}
            <option value="__new">{tr('+ New project…', '+ 新建项目…')}</option>
          </select>
          <Icon name="chev" size={12} />
        </label>
        <span className={`save ${saveState}`} title={saveState === 'saved' ? tr('Every change is written to storyboard.json', '所有改动已写入 storyboard.json') : undefined}>
          <i />
          {saveState === 'saving' ? tr('Saving', '保存中') : saveState === 'error' ? tr('Save failed', '保存失败') : tr('Saved', '已保存')}
        </span>
        <span className="grow" />
        {job?.state === 'running' ? (
          <span className="job">
            {job.phase} {pct}%
            <span className="bar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <button className="icon sm" onClick={() => cancelRender()} title={tr('Cancel export', '取消导出')}>
              <Icon name="close" size={14} />
            </button>
          </span>
        ) : job?.state === 'done' ? (
          <span className="job">
            <Icon name="check" size={14} />
            {job.out.replace(/^.*[\\/]/, '')}
            <button className="ghost" onClick={() => reveal(job.out)}>
              <Icon name="folder" size={14} />
              {tr('Show in folder', '打开位置')}
            </button>
          </span>
        ) : job?.state === 'error' ? (
          <span className="job">
            <button className="ghost danger" onClick={() => flash(job.tail.slice(-6).join('\n'), 'error')}>
              <Icon name="warn" size={14} />
              {tr('Export failed: see why', '导出失败，看原因')}
            </button>
          </span>
        ) : null}
        <button className="icon gear" onClick={() => setSettingsTab('general')} title={tr('Settings (Ctrl+,)', '设置 (Ctrl+,)')} aria-label={tr('Settings', '设置')}>
          <Icon name="gear" size={17} />
        </button>
        <div className="split-btn">
          <button className="primary" onClick={() => doRender(EXPORT_PRESET[prefs.exportPreset])} disabled={job?.state === 'running' || !ready} title={tr(`Export ${versionText}`, `导出 ${versionText}`)}>
            <Icon name="export" />
            {tr('Export', '导出')}
          </button>
          <Menu label="" icon="chev" className="primary more" disabled={!ready}>
            {(close) => (
              <>
                <div className="menu-h">{tr('This version: ', '当前版本：')}{versionText}</div>
                <div className="menu-dest">
                  <span title={exportDir}>
                    {tr('Saves to ', '保存到 ')}
                    <b>{exportDir || '…'}</b>
                  </span>
                  <button className="mini" onClick={() => (close(), openExports())}>
                    <Icon name="folder" size={13} />
                    {tr('Open', '打开')}
                  </button>
                </div>
                <div className="menu-sep" />
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender())}>
                  {tr('MP4 video', 'MP4 视频')}
                </button>
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender({ scale: '2' }))}>
                  {tr('2× resolution (4K)', '2 倍分辨率（B站 4K）')}
                </button>
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender({ codec: 'gif', scale: '0.5' }))}>
                  {tr('GIF (half size)', 'GIF 动图（半尺寸）')}
                </button>
                <button disabled={job?.state === 'running'} onClick={() => (close(), doRender({ codec: 'prores' }))}>
                  {tr('ProRes master (.mov)', 'ProRes 母带（.mov）')}
                </button>
                <div className="menu-sep" />
                <button onClick={() => (close(), exportSrt())}>{tr('Subtitles (SRT)', '字幕文件 SRT')}</button>
                <button onClick={() => (close(), exportChapters())}>{tr('Chapter list (YouTube/Bilibili)', '章节时间轴（B站/YouTube）')}</button>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className="work">
        {doc ? (
          <Library
            tab={libTab}
            setTab={(t) => {
              setLibTab(t);
              pref.set('vs-lib', t);
            }}
            slug={st.slug}
            assets={assets}
            music={music}
            theme={doc.board.theme}
            mode={st.mode}
            target={target}
            preview={preview}
            musicSrc={st.mode === 'beat' ? doc.board.beat?.music : doc.board.music?.src}
            onAdd={addKind}
            onImport={() => {
              pendingAdd.current = null;
              fileInput.current?.click();
            }}
            onOverlay={libOverlay}
            onFx={libFx}
            onBg={libBg}
            onTransition={libTransition}
            onLook={libLook}
            onMusic={libMusic}
            onSound={libSound}
          />
        ) : (
          <aside className="lib panel" />
        )}
        <Splitter dir="x" onDrag={(d) => resize('lib', d)} onEnd={resized} />
        <section className="viewer panel">
          <div className="stage" ref={stageRef}>
            {err || missing.size ? (
              <div className="banner">
                <Icon name="warn" size={14} />
                <span>
                  {err ||
                    tr(`Missing media: ${[...missing].map(([id, src]) => `${src} (scene ${id})`).join('; ')}. Put the file back in public/${st.slug}/ or choose another one on the right.`, `缺少素材：${[...missing].map(([id, src]) => `${id} 用的 ${src}`).join('；')}。把文件放回 public/${st.slug}/，或者在右边换一个。`)}
                </span>
              </div>
            ) : null}
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
                    loop={prefs.loop}
                    errorFallback={({ error }) => <div style={{ padding: 20, color: '#ffb4ab', background: '#1a1012', font: '14px sans-serif' }}>{error.message}</div>}
                    acknowledgeRemotionLicense
                  />
                </div>
              </div>
            ) : !err ? (
              <div className="empty">
                <span className="spin" />
                {tr('Loading', '载入中')}
              </div>
            ) : null}
          </div>
          <div className="transport">
            <div className="tp-l">{etl ? <TimeLabel player={player} total={etl.total} fps={etl.fps} /> : null}</div>
            <div className="tp-c">
              <button className="icon" onClick={() => jump(-1)} title={tr('Previous scene (Home: start)', '上一段开头 (Home 到片头)')} disabled={!etl}>
                <Icon name="prev" />
              </button>
              <button className="play" onClick={() => player?.toggle()} title={playing ? tr('Pause (Space)', '暂停 (空格)') : tr('Play (Space)', '播放 (空格)')} disabled={!ready}>
                <Icon name={playing ? 'pause' : 'play'} size={18} />
              </button>
              <button className="icon" onClick={() => jump(1)} title={tr('Next scene', '下一段开头')} disabled={!etl}>
                <Icon name="next" />
              </button>
            </div>
            <div className="tp-r">
              <select className="vsel" value={st.lang} title={tr('Video language: captions and narration switch together', '视频语言：字幕和旁白一起切换')} aria-label={tr('Video language', '视频语言')} onChange={(e) => update({ lang: e.target.value as Settings['lang'] })}>
                <option value="zh">{tr('Chinese', '中文版')}</option>
                <option value="en">{tr('English', '英文版')}</option>
              </select>
              <Seg
                className="ratio"
                value={st.format}
                options={[
                  ['wide', '16:9', 'wide', tr('Widescreen: YouTube, Bilibili', '横屏：B站、YouTube'), tr('Widescreen', '横屏')],
                  ['tall', '9:16', 'tall', tr('Vertical: TikTok, Douyin, Xiaohongshu', '竖屏：抖音、小红书'), tr('Vertical', '竖屏')],
                ]}
                onChange={(v) => update({ format: v })}
              />
            </div>
          </div>
        </section>
        <Splitter dir="x" onDrag={(d) => resize('side', -d)} onEnd={resized} />
        <aside className="side panel">
          <div className="ptabs" role="tablist">
            <button role="tab" aria-selected={side === 'props'} className={side === 'props' ? 'on' : undefined} onClick={() => setSideTab('props')}>
              <Icon name="layers" size={14} />
              {tr('Properties', '属性')}
            </button>
            <button role="tab" aria-selected={side === 'ai'} className={side === 'ai' ? 'on' : undefined} onClick={() => setSideTab('ai')}>
              <Icon name="sparkle" size={14} />
              {tr('AI assistant', 'AI 助手')}
            </button>
          </div>
          {side === 'ai' ? (
            <ChatPanel
              slug={st.slug}
              context={ctxNow}
              where={where}
              refs={aiRefs}
              onRemoveRef={(k) => setAiRefs((rs) => rs.filter((r) => r.key !== k))}
              onClearRefs={() => setAiRefs([])}
              armed={pickArmed}
              onArm={() => setPickArmed((a) => !a)}
              focusKey={chatFocus}
              onSettings={() => setSettingsTab('ai')}
              statusKey={aiKey}
            />
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
              focus={focus}
              commit={commit}
              onSelect={(id) => select(id)}
              actions={{ split: doSplit, dup: doDup, del: doDel, up: () => nudge(-1), down: () => nudge(1) }}
              fxClip={fxClip}
              setFxClip={(fx) => {
                setFxClip(fx);
                if (fx) flash(tr('Effects copied; select another scene and press Paste', '已复制特效，选别的段落点"粘贴"'));
              }}
              playheadIn={playheadIn}
            />
          ) : (
            <div className="insp" />
          )}
        </aside>
      </div>
      <Splitter dir="y" onDrag={(d) => resize('tl', -d)} onEnd={resized} />
      {dragOver ? (
        <div className="drop-hint">
          <Icon name="import" size={22} />
          {tr('Drop to import: images and videos become scenes, audio becomes the music', '松开导入：图片、视频变成新段落，音频设为配乐')}
        </div>
      ) : null}

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
          missing={missing}
          followPlayhead={prefs.followPlayhead}
          lanes={prefs.lanes}
          selCue={selCue}
          onCuePick={focusCue}
          onOverlayEdit={onOverlayEdit}
          onOpen={openTab}
          onSoundMove={onSoundMove}
          onSoundDrop={placeSound}
          tools={
            <>
              <Seg
                className="seq"
                value={st.mode}
                options={[
                  ['voice', tr('Narrated', '旁白版'), 'mic', tr('Cut to the voice-over, with captions: YouTube, Bilibili', '按配音节奏剪，有旁白和字幕：B站、YouTube')],
                  ['beat', tr('Beat cut', '卡点版'), 'beat', tr('No narration, cut on the music beat: TikTok, Xiaohongshu', '没有旁白，按音乐节拍切：抖音、小红书')],
                ]}
                onChange={(v) => update({ mode: v })}
              />
              <span className="sep" />
              <button className="icon" onClick={undo} disabled={!h.past.length} title={h.past.length ? tr(`Undo: ${h.past[h.past.length - 1].desc} (Ctrl+Z)`, `撤销：${h.past[h.past.length - 1].desc} (Ctrl+Z)`) : tr('Undo (Ctrl+Z)', '撤销 (Ctrl+Z)')}>
                <Icon name="undo" />
              </button>
              <button className="icon" onClick={redo} disabled={!h.future.length} title={h.future.length ? tr(`Redo: ${h.future[h.future.length - 1].desc} (Ctrl+Y)`, `重做：${h.future[h.future.length - 1].desc} (Ctrl+Y)`) : tr('Redo (Ctrl+Y)', '重做 (Ctrl+Y)')}>
                <Icon name="redo" />
              </button>
              <span className="sep" />
              <button className="icon" onClick={doSplit} title={tr('Split at the playhead (Ctrl+B)', '在播放头处拆分 (Ctrl+B)')}>
                <Icon name="split" />
              </button>
              <button className="icon" onClick={doDup} disabled={!sel} title={tr('Duplicate scene (Ctrl+D)', '复制选中段落 (Ctrl+D)')}>
                <Icon name="copy" />
              </button>
              <button className="icon danger" onClick={doDel} disabled={!sel} title={tr('Delete scene (Delete)', '删除选中段落 (Delete)')}>
                <Icon name="trash" />
              </button>
              <span className="sep" />
              <Menu label={tr('Add', '添加')} icon="plus">
                {(close) => (
                  <>
                    <div className="menu-h">{tr('Cards', '卡片')}</div>
                    {ADDABLE.filter(([, , , src]) => !src).map(([k, en, zh]) => (
                      <button key={k} onClick={() => (close(), addKind(k))}>
                        {tr(en, zh)}
                      </button>
                    ))}
                    {(
                      [
                        ['image', tr('Images', '图片'), isImg],
                        ['clip', tr('Videos', '视频'), (a: string) => isVid(a) && !a.startsWith('cap/')],
                        ['screen', tr('Recordings', '录屏'), (a: string) => a.startsWith('cap/') && isVid(a)],
                      ] as [string, string, (a: string) => boolean][]
                    ).map(([k, l, ok]) => {
                      const list = assets.filter(ok);
                      return list.length ? (
                        <div key={k} className="menu-group">
                          <div className="menu-sep" />
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
                      {tr('Import images, video or music…', '从电脑导入图片 / 视频 / 音乐…')}
                    </button>
                  </>
                )}
              </Menu>
              {etl.hidden.length ? (
                <span className="hint" title={tr('Scenes left out of this version (other aspect ratio only, or not in the beat cut)', '这些段落没进当前版本（只在另一种画幅里，或不在卡点版里）')}>
                  {tr('Not in this version', '这一版没用到')}
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
        <div className="tl panel" />
      )}

      {settingsTab ? (
        <SettingsPage
          tab={settingsTab}
          setTab={setSettingsTab}
          onClose={() => {
            setSettingsTab(null);
            setAiKey((k) => k + 1);
          }}
          variant={st.variant}
          setVariant={(v) => update({ variant: v })}
        />
      ) : null}
      {pickHl ? (
        <div className="pick-hl" style={{ left: pickHl.x - 2, top: pickHl.y - 2, width: pickHl.w + 4, height: pickHl.h + 4 }}>
          <span>{pickHl.label}</span>
        </div>
      ) : null}
      {doneCard && job?.state === 'done' ? (
        <div className="done-card" role="status">
          <div className="done-head">
            <Icon name="check" size={16} />
            <b>{tr('Export finished', '导出完成')}</b>
            <span className="grow" />
            <button className="icon sm" onClick={() => setDoneCard(false)} title={tr('Close', '关闭')}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="done-name">{job.out.replace(/^.*[\\/]/, '')}</div>
          <div className="done-path" title={job.path}>
            {job.dir}
          </div>
          <div className="done-acts">
            <button className="primary" onClick={() => reveal(job.out, true)}>
              <Icon name="play" size={14} />
              {tr('Play', '播放')}
            </button>
            <button className="btn" onClick={() => reveal(job.out)}>
              <Icon name="folder" size={14} />
              {tr('Show in folder', '在文件夹中显示')}
            </button>
          </div>
        </div>
      ) : null}
      {toast ? <div className={`toast${toast.kind === 'error' ? ' error' : ''}`}>{toast.text}</div> : null}
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
            {tr('Cancel', '取消')}
          </button>
          <button className="primary" onClick={submit} disabled={!v.trim()}>
            {tr('Create', '创建')}
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
