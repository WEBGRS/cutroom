import React, { useEffect, useRef, useState } from 'react';
import type { Fx, Scene, Theme } from '../../src/lib/types';
import { LOOKS } from '../../src/components/Fx';
import { FX_DEMO } from '../../src/fx/demo';
import { BG_LIST, CARD_LIST, LOWER_LIST, OVERLAY_LIST, RULES, TEXT_LIST, TRANSITION_LIST, type Named } from './catalog';
import { LOOK_LIST } from '../../src/fx/registry';
import { thumbsUrl, useAsset, type Thumbs } from './assets';
import { Icon } from './icons';
import { nm, tr } from './i18n';
import { SOUNDS, SOUND_CATS, soundSrc } from '../../src/fx/sounds';
import { SOUND_MIME } from './Timeline';
import { usePrefs } from './prefs';
import { VoicePanel } from './VoicePanel';
import { HtmlThumb, isHtml, pageName } from './HtmlParts';

export type LibTab = 'media' | 'cards' | 'text' | 'overlay' | 'trans' | 'fx' | 'bg' | 'voice' | 'sfx' | 'audio';

const TABS: [LibTab, string, string, string][] = [
  ['media', 'Media', '素材', 'media'],
  ['cards', 'Cards', '卡片', 'cards'],
  ['text', 'Text', '文字', 'text'],
  ['overlay', 'Overlays', '叠加', 'layers'],
  ['trans', 'Transitions', '转场', 'trans'],
  ['fx', 'Effects', '特效', 'filter'],
  ['bg', 'Backdrop', '背景', 'board'],
  ['voice', 'Voiceover', '配音', 'mic'],
  ['sfx', 'Sound FX', '音效', 'sfx'],
  ['audio', 'Music', '音乐', 'music'],
];

// Scene-effect presets shown as tiles; each id is a key of FX_DEMO
const FX_TILES: { group: { en: string; zh: string }; items: Named[] }[] = [
  {
    group: { en: 'Lens & grade', zh: '镜头与调色' },
    items: [
      { id: 'chroma', en: 'RGB split', zh: '色散', src: 'chromatic-aberration-wipe' },
      { id: 'bloom', en: 'Bloom', zh: '辉光' },
      { id: 'glitch', en: 'Glitch bursts', zh: '故障闪烁', src: 'rgb-glitch-text' },
      { id: 'crt', en: 'CRT lines', zh: '扫描线', src: 'scan-band' },
      { id: 'pixelate', en: 'Pixelate', zh: '像素化', src: 'grid-pixelate-wipe' },
      { id: 'posterize', en: 'Posterize', zh: '色阶分离', src: 'ordered-dither-pass' },
      { id: 'duotone-ocean', en: 'Duotone ocean', zh: '双色·海蓝', src: 'grade-split-reveal' },
      { id: 'duotone-sunset', en: 'Duotone sunset', zh: '双色·日落', src: 'grade-split-reveal' },
      { id: 'duotone-mint', en: 'Duotone mint', zh: '双色·薄荷', src: 'grade-split-reveal' },
      { id: 'duotone-rose', en: 'Duotone rose', zh: '双色·玫瑰', src: 'grade-split-reveal' },
      { id: 'duotone-ink', en: 'Duotone ink', zh: '双色·墨色', src: 'grade-split-reveal' },
      { id: 'blur', en: 'Blur', zh: '模糊' },
    ],
  },
  {
    group: { en: 'Camera', zh: '运镜' },
    items: [
      { id: 'kenburns', en: 'Push in', zh: '慢推' },
      { id: 'reveal', en: 'Pull-back reveal', zh: '拉远揭示', src: 'pull-back-reveal' },
      { id: 'drift', en: 'Handheld drift', zh: '手持漂移', src: 'drift-hold' },
      { id: 'focusIn', en: 'Focus pull-in', zh: '开场对焦', src: 'focus-rack' },
      { id: 'stepped', en: 'Stop motion', zh: '定格动画', src: 'stop-motion-cadence' },
      { id: 'motionBlur', en: 'Motion blur pan', zh: '动态模糊平移', src: 'motion-blur' },
      { id: 'shake', en: 'Shake', zh: '抖动', src: 'camera-shake', rule: 'shake' },
    ],
  },
  {
    group: { en: 'Atmosphere', zh: '氛围' },
    items: [
      { id: 'vignette', en: 'Vignette', zh: '暗角', src: 'vignette' },
      { id: 'grain', en: 'Film grain', zh: '胶片颗粒', src: 'grain-overlay' },
      { id: 'leak', en: 'Light leak', zh: '漏光', src: 'organic-light-leak-overlay' },
      { id: 'letterbox', en: 'Letterbox', zh: '电影黑边' },
      { id: 'dim', en: 'Dim', zh: '压暗' },
      { id: 'fadeIn', en: 'Fade from black', zh: '黑场淡入' },
    ],
  },
];
export const FX_TILE_SOURCES = FX_TILES.flatMap((g) => g.items.map((i) => i.src)).filter((s): s is string => !!s);

const isImg = (a: string) => /\.(png|jpe?g|webp|gif)$/i.test(a);
const isVid = (a: string) => /\.(mp4|webm|mov)$/i.test(a);
const isAud = (a: string) => /\.(mp3|wav|m4a)$/i.test(a);
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const base = (p: string) => p.replace(/^.*\//, '');
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const fxOn = (fx: Fx | undefined, preset: Record<string, unknown>) => !!fx && Object.entries(preset).every(([k, v]) => (fx as Record<string, unknown>)[k] === v);

interface Props {
  slug: string;
  assets: string[];
  music: { src: string }[];
  theme: Theme;
  lang: 'zh' | 'en';
  target: Scene | null;
  preview: Scene | null;
  musicSrc: string | undefined;
  onAdd: (kind: string, src?: string) => void;
  onImport: () => void;
  onOverlay: (kind: string, extra?: Record<string, unknown>) => void;
  onTransition: (t: string) => void;
  onLook: (look: string) => void;
  onFx: (preset: Record<string, unknown>, on: boolean) => void;
  onBg: (id: string) => void;
  onMusic: (src: string) => void;
  onSound: (id: string) => void;
  onSettings: () => void;
}

const TH = 72;

// First-frame thumbnail of a video, or the image itself
function Thumb({ slug, src, at = 0.3, dur = true }: { slug: string; src: string; at?: number; dur?: boolean }) {
  const th = useAsset<Thumbs>(isVid(src) ? thumbsUrl(slug, src) : null);
  if (isImg(src)) return <div className="lt-img" style={{ backgroundImage: `url("/${slug}/${enc(src)}")` }} />;
  if (!th) return <div className="lt-img pending" />;
  const w = (th.w * TH) / th.h;
  const i = Math.min(th.count - 1, Math.floor(th.count * at));
  return (
    <>
      <div className="lt-sprite" style={{ width: w, backgroundImage: `url(${th.url})`, backgroundSize: `${th.count * w}px ${TH}px`, backgroundPosition: `${-i * w}px 0` }} />
      {dur ? <span className="lt-dur">{mmss(th.dur)}</span> : null}
    </>
  );
}

// Rendered preview: poster, and the clip while hovered
const Prev: React.FC<{ cat: string; id: string; hover: boolean }> = ({ cat, id, hover }) => {
  const src = `/_fx/${cat}/${id || 'default'}`;
  const [missing, setMissing] = useState(false);
  if (missing) return <div className="lt-img pending" />;
  return (
    <>
      <img className="lt-poster" src={`${src}.jpg`} alt="" loading="lazy" onError={() => setMissing(true)} />
      {hover ? <video className="lt-video" src={`${src}.mp4`} autoPlay muted loop playsInline /> : null}
    </>
  );
};

function Tile({ label, sub, on, warn, onClick, children, title, prev, pick }: { label: string; sub?: string; on?: boolean; warn?: string; onClick: () => void; children?: React.ReactNode; title?: string; prev?: [string, string]; pick?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button className={`lt${on ? ' on' : ''}`} data-pick={pick ?? (prev ? `effect|${prev[0]}:${prev[1]}|${label}` : undefined)} onClick={onClick} title={title ?? warn ?? label} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="lt-box">
        {prev ? <Prev cat={prev[0]} id={prev[1]} hover={hover} /> : children}
        {on ? (
          <span className="lt-on">
            <Icon name="check" size={12} />
          </span>
        ) : (
          <span className="lt-add">
            <Icon name="plus" size={12} />
          </span>
        )}
        {warn ? <span className="lt-warn">!</span> : null}
      </span>
      <span className="lt-name">{label}</span>
      {sub ? <span className="lt-sub">{sub}</span> : null}
    </button>
  );
}

// Who the scene-level tabs act on
function Target({ s, what }: { s: Scene | null; what: string }) {
  return s ? (
    <div className="lib-target">
      {what}
      <b>{s.id}</b>
    </div>
  ) : (
    <div className="lib-target none">{tr('Select a scene on the timeline first', '先在时间线上点选一段')}</div>
  );
}

// Thumbnail of the scene the looks are previewed on
function LookBase({ slug, s, theme }: { slug: string; s: Scene | null; theme: Theme }) {
  const v = s?.visual;
  if (v && (v.kind === 'screen' || v.kind === 'clip' || v.kind === 'image')) return <Thumb slug={slug} src={v.src} at={0.45} dur={false} />;
  const [a, b] = theme.bg ?? ['#0b1020', '#18223d'];
  return <div className="lt-img" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }} />;
}

// One preview at a time across the whole sound list
let sxAudio: HTMLAudioElement | null = null;
function useSoundPreview(): [string | null, (id: string) => void] {
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => sxAudio?.pause(), []);
  const play = (id: string) => {
    sxAudio?.pause();
    if (playing === id) return setPlaying(null);
    sxAudio = new Audio(`/${soundSrc(id)}`);
    sxAudio.volume = 0.7;
    sxAudio.onended = () => setPlaying((x) => (x === id ? null : x));
    void sxAudio.play();
    setPlaying(id);
  };
  return [playing, play];
}

function SoundList({ onAdd }: { onAdd: (id: string) => void }) {
  const [playing, play] = useSoundPreview();
  const { hints } = usePrefs();
  return (
    <>
      {hints ? <div className="lib-note pad0">{tr('Click a name to listen. Drag it onto the Sound FX lane of the timeline, or press + to add it at the playhead.', '点名字试听。拖到时间线的「音效」轨上，或按 + 加在播放头的位置。')}</div> : null}
      {SOUND_CATS.map((c) => {
        const list = SOUNDS.filter((s) => s.cat === c.id);
        return (
          <section key={c.id} className="lib-sec">
            <h4>
              {nm(c)}
              <span>{list.length}</span>
            </h4>
            <div className="sx-grid">
              {list.map((s) => (
                <div
                  key={s.id}
                  className={`sx${playing === s.id ? ' playing' : ''}`}
                  draggable
                  data-pick={`sound|lib:${s.id}|${nm(s)}`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SOUND_MIME, s.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <button className="sx-play" onClick={() => play(s.id)} title={playing === s.id ? tr('Stop', '停止') : tr('Listen', '试听')}>
                    <Icon name={playing === s.id ? 'pause' : 'play'} size={11} />
                    <span className="sx-name">{nm(s)}</span>
                    <span className="sx-dur">{s.dur < 1 ? `${Math.round(s.dur * 1000)} ms` : `${s.dur.toFixed(1)} s`}</span>
                  </button>
                  <button className="sx-add" onClick={() => onAdd(s.id)} title={tr('Add at the playhead', '加在播放头位置')} aria-label={tr(`Add ${s.en}`, `添加${s.zh}`)}>
                    <Icon name="plus" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Record an app window or a screen into cap/ (Windows): the person works the app; the record bar has Stop and Mark
interface DeskWin {
  hwnd: number;
  title: string;
  exe: string;
  w: number;
  h: number;
  foreground: boolean;
}
interface DeskJobView {
  slug: string;
  state: 'starting' | 'waiting' | 'recording' | 'saving' | 'done' | 'error';
  note?: string;
  file?: string;
  duration?: number;
  clicks?: number;
  error?: string;
}
function RecordDesk({ slug }: { slug: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [wins, setWins] = useState<DeskWin[]>([]);
  const [mons, setMons] = useState<{ index: number; rect: { w: number; h: number }; primary: boolean }[]>([]);
  const [pick, setPick] = useState('');
  const [mode, setMode] = useState<'window' | 'area' | 'screen'>('window');
  const [job, setJob] = useState<DeskJobView | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    const r = await (await fetch('/api/desktop')).json();
    setSupported(!!r.supported);
    if (!r.supported) return;
    if (r.error) setErr(r.error);
    // Cutroom's own window is not something to record here
    const list: DeskWin[] = (r.windows ?? []).filter((w: DeskWin) => !/^Cutroom( |$)/.test(w.title));
    setWins(list);
    setMons(r.monitors ?? []);
    setPick((p) => (list.some((w) => String(w.hwnd) === p) ? p : String(list[0]?.hwnd ?? '')));
    if (r.job && !['done', 'error'].includes(r.job.state)) setJob(r.job);
  };
  useEffect(() => {
    void load().catch(() => setSupported(false));
  }, []);
  const busy = !!job && !['done', 'error'].includes(job.state);
  useEffect(() => {
    if (!busy) return;
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'desk' && e.job.slug === slug) setJob(e.job);
    };
    return () => es.close();
  }, [busy, slug]);
  if (!supported) return null;
  const go = async () => {
    setErr('');
    const w = wins.find((x) => String(x.hwnd) === pick);
    const monitor = mode === 'screen' ? Number(pick.replace(/^m/, '')) : undefined;
    const r = await fetch('/api/desktop/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, mode, hwnd: w?.hwnd, exe: w?.exe, title: w?.title, monitor }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setJob(j.job);
  };
  const stop = (cancel = false) => void fetch('/api/desktop/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancel }) });
  if (!open)
    return (
      <button
        className="btn"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        title={tr('Record an app on this computer, or the whole screen, while you use it', '一边操作一边录下电脑上的软件窗口或整个屏幕')}
      >
        <Icon name="screen" />
        {tr('Record an app', '录制软件')}
      </button>
    );
  const status = !job
    ? null
    : job.state === 'done'
      ? { ok: true, text: tr(`Saved ${job.file} (${job.duration?.toFixed(1)} s, ${job.clicks} clicks): click it below to add it`, `已保存 ${job.file}（${job.duration?.toFixed(1)} 秒，${job.clicks} 次点击），在下面点它加到时间线`) }
      : job.state === 'error'
        ? { ok: false, text: job.error ?? '' }
        : { ok: true, text: job.note ?? (job.state === 'recording' ? tr('Recording. Stop on the record bar at the top of the screen (F10), or here.', '录制中。在屏幕顶部的录制条上点停止（F10），或在这里停止。') : job.state === 'saving' ? tr('Saving…', '保存中…') : tr('Switch to the window now: recording starts after the countdown.', '现在切到要录的窗口：倒计时结束后开始录。')) };
  return (
    <div className="recweb">
      <div className="seg">
        {(['window', 'area', 'screen'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? 'on' : ''}
            disabled={busy}
            onClick={() => {
              setMode(m);
              setPick(m === 'screen' ? `m${mons.find((x) => x.primary)?.index ?? 0}` : String(wins[0]?.hwnd ?? ''));
            }}
            title={m === 'area' ? tr("The window's place on screen, with its menus and pop-ups (anything on top of it shows too)", '窗口在屏幕上的那块区域，菜单和弹窗也录得到（盖在上面的东西也会录进去）') : undefined}
          >
            {m === 'window' ? tr('Window', '窗口') : m === 'area' ? tr('Window area', '窗口区域') : tr('Whole screen', '整个屏幕')}
          </button>
        ))}
      </div>
      <div className="recweb-row">
        <select value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)} onFocus={() => void load()}>
          {mode === 'screen'
            ? mons.map((m) => (
                <option key={m.index} value={`m${m.index}`}>
                  {tr(`Screen ${m.index + 1}`, `屏幕 ${m.index + 1}`)} · {m.rect.w}×{m.rect.h}
                  {m.primary ? tr(' (main)', '（主屏）') : ''}
                </option>
              ))
            : wins.map((w) => (
                <option key={w.hwnd} value={w.hwnd} title={w.title}>
                  {w.exe.replace(/\.exe$/i, '')} · {w.title.length > 46 ? `${w.title.slice(0, 45)}…` : w.title}
                </option>
              ))}
        </select>
        {busy ? (
          <button className="primary" disabled={job!.state === 'saving'} onClick={() => stop()}>
            <Icon name={job!.state === 'saving' ? 'wait' : 'stop'} size={14} />
            {tr('Stop', '停止')}
          </button>
        ) : (
          <button className="primary" disabled={!pick} onClick={() => void go()}>
            <Icon name="cam" size={14} />
            {tr('Record', '录制')}
          </button>
        )}
        {!busy ? (
          <button className="icon sm" onClick={() => setOpen(false)} title={tr('Close', '关闭')}>
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>
      <span className={status && !status.ok ? 'vo-err' : 'lib-note'}>
        {status ? status.text : err || tr('A record bar appears at the top of the screen. After a 3-second countdown, use the app; clicks get an automatic zoom. Stop with F10, mark moments with F9.', '屏幕顶部会出现录制条。倒计时 3 秒后开始，正常操作软件即可，点击处会自动放大。F10 停止，F9 打标记。')}
      </span>
    </div>
  );
}

// Record a web page into cap/: a short scroll-through; the AI assistant can script clicks and typing
function RecordWeb({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!busy) return;
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type !== 'record' || e.job.slug !== slug || e.job.state === 'running') return;
      setBusy(false);
      setMsg(e.job.state === 'done' ? { ok: true, text: tr(`Saved ${e.job.file} (${e.job.duration.toFixed(1)} s): click it below to add it`, `已保存 ${e.job.file}（${e.job.duration.toFixed(1)} 秒），在下面点它加到时间线`) } : { ok: false, text: e.job.error });
    };
    return () => es.close();
  }, [busy, slug]);
  const go = async () => {
    setMsg(null);
    const r = await fetch('/api/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, url }) });
    if (!r.ok) return setMsg({ ok: false, text: (await r.json()).error });
    setBusy(true);
  };
  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)} title={tr('Record a web page as a screen recording', '把一个网页录成录屏素材')}>
        <Icon name="globe" />
        {tr('Record a website', '录制网页')}
      </button>
    );
  return (
    <div className="recweb">
      <div className="recweb-row">
        <input
          autoFocus
          value={url}
          disabled={busy}
          placeholder={tr('example.com', '网址，例如 example.com')}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim()) void go();
            if (e.key === 'Escape' && !busy) setOpen(false);
          }}
        />
        <button className="primary" disabled={busy || !url.trim()} onClick={() => void go()}>
          <Icon name={busy ? 'wait' : 'cam'} size={14} />
          {busy ? tr('Recording…', '录制中…') : tr('Record', '录制')}
        </button>
        {!busy ? (
          <button className="icon sm" onClick={() => setOpen(false)} title={tr('Close', '关闭')}>
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>
      <span className={msg ? (msg.ok ? 'lib-note' : 'vo-err') : 'lib-note'}>
        {msg ? msg.text : tr('Scrolls through the page for about 8 s. To click and type on it, ask the AI assistant, e.g. "record searching for X on example.com".', '自动滚动浏览约 8 秒。要点击、输入，跟 AI 助手说，比如"录一段在 example.com 搜索 X"。')}
      </span>
    </div>
  );
}

function AudioRow({ src, label, sub, on, onUse }: { src: string; label: string; sub: string; on: boolean; onUse: () => void }) {
  const [playing, setPlaying] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => el.current?.pause(), []);
  const toggle = () => {
    if (!el.current) {
      el.current = new Audio(`/${enc(src)}`);
      el.current.volume = 0.6;
      el.current.onended = () => setPlaying(false);
    }
    if (playing) el.current.pause();
    else void el.current.play();
    setPlaying(!playing);
  };
  return (
    <div className={`arow${on ? ' on' : ''}`}>
      <button className="icon sm" onClick={toggle} title={playing ? tr('Stop preview', '停止试听') : tr('Preview', '试听')}>
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <span className="arow-t">
        <b>{label}</b>
        <span>{sub}</span>
      </span>
      {on ? (
        <span className="arow-on">
          <Icon name="check" size={13} />
          {tr('In use', '使用中')}
        </span>
      ) : (
        <button className="mini" onClick={onUse}>
          {tr('Use', '使用')}
        </button>
      )}
    </div>
  );
}

const Section: React.FC<{ title?: string; count?: number; children: React.ReactNode }> = ({ title, count, children }) => (
  <section className="lib-sec">
    {title ? (
      <h4>
        {title}
        {count ? <span>{count}</span> : null}
      </h4>
    ) : null}
    <div className="lgrid">{children}</div>
  </section>
);

const GROUP_NAMES: Record<string, { en: string; zh: string }> = {
  text: { en: 'Titles', zh: '标题字' },
  callout: { en: 'Callouts', zh: '标注' },
  draw: { en: 'Hand-drawn', zh: '手绘' },
  ui: { en: 'Interface', zh: '界面元素' },
  data: { en: 'Numbers', zh: '数据' },
  fx: { en: 'Effects', zh: '效果' },
};
// Shown first in their tabs, like the trending row in CapCut
const POPULAR = {
  trans: ['whip', 'glitch', 'burn', 'cube', 'leak', 'grid', 'flash', 'cardzoom'],
  text: ['stagger', 'decode', 'typewriter', 'flap', 'highlight', 'count', 'roll', 'glitch'],
  overlay: ['hwcircle', 'hwarrow', 'notify', 'keys', 'counter', 'check', 'confetti', 'prompt'],
};
const POPULAR_TITLE = { en: 'Popular', zh: '常用' };
const pick = <T extends { id: string }>(list: T[], ids: string[]) => ids.map((id) => list.find((x) => x.id === id)).filter((x): x is T => !!x);

const CARD_GROUPS = { basic: { en: 'Basics', zh: '基础' }, data: { en: 'Numbers', zh: '数据' }, ui: { en: 'Interface', zh: '界面' } };

export function Library(p: Props & { tab: LibTab; setTab: (t: LibTab) => void }) {
  const { hints } = usePrefs();
  const { slug, assets, target } = p;
  const caps = assets.filter((a) => a.startsWith('cap/') && isVid(a));
  const vids = assets.filter((a) => isVid(a) && !a.startsWith('cap/'));
  const imgs = assets.filter(isImg);
  const pages = assets.filter(isHtml);
  const auds = assets.filter(isAud);
  const curTrans = target?.transition === 'fade' ? '' : (target?.transition ?? '');
  const curLook = target?.fx?.look ?? '';
  const warnOf = (x: Named) => (x.rule ? nm(RULES[x.rule]) : undefined);

  const media = (title: string, list: string[], kind: string) =>
    list.length ? (
      <Section key={kind} title={title} count={list.length}>
        {list.map((a) => (
          <Tile key={a} label={kind === 'html' ? pageName(a) : base(a)} pick={`effect|media:${a}|${base(a)}`} onClick={() => p.onAdd(kind, a)} title={tr(`Add to the timeline: ${a}`, `添加到时间线：${a}`)}>
            {kind === 'html' ? <HtmlThumb slug={slug} src={a} h={TH} /> : <Thumb slug={slug} src={a} />}
          </Tile>
        ))}
      </Section>
    ) : null;

  let body: React.ReactNode;
  switch (p.tab) {
    case 'media':
      body = (
        <>
          <div className="lib-bar">
            <button className="btn" onClick={p.onImport}>
              <Icon name="import" />
              {tr('Import', '导入素材')}
            </button>
            <RecordWeb slug={slug} />
            <RecordDesk slug={slug} />
          </div>
          {caps.length + vids.length + imgs.length + pages.length ? (
            <>
              {media(tr('Screen recordings', '录屏'), caps, 'screen')}
              {media(tr('Videos', '视频'), vids, 'clip')}
              {media(tr('Images', '图片'), imgs, 'image')}
              {media(tr('HTML pages', 'HTML 页面'), pages, 'html')}
            </>
          ) : (
            <button className="lib-empty" onClick={p.onImport}>
              <Icon name="import" size={20} />
              {tr('Import images or videos, then click one to add it', '导入图片或视频，点一下就加到时间线')}
            </button>
          )}
        </>
      );
      break;
    case 'cards':
      body = (
        <>
          {hints ? <div className="lib-note pad0">{tr('Click to add after the selected scene', '点一下加在选中段落后面')}</div> : null}
          {(['basic', 'data', 'ui'] as const).map((g) => (
            <Section key={g} title={nm(CARD_GROUPS[g])}>
              {CARD_LIST.filter((c) => c.group === g).map((c) => (
                <Tile key={c.id} label={nm(c)} prev={['card', c.id]} onClick={() => p.onAdd(c.id)} />
              ))}
            </Section>
          ))}
        </>
      );
      break;
    case 'text':
      body = (
        <>
          <Target s={target} what={tr('Adds at the playhead in', '在播放头处加到')} />
          <Section title={nm(POPULAR_TITLE)}>
            {pick(TEXT_LIST, POPULAR.text).map((a) => (
              <Tile key={a.id} label={nm(a)} prev={['text', a.id]} onClick={() => p.onOverlay('text', { anim: a.id })} />
            ))}
          </Section>
          <Section title={tr('All text animations', '全部文字动画')} count={TEXT_LIST.length}>
            {TEXT_LIST.map((a) => (
              <Tile key={a.id} label={nm(a)} prev={['text', a.id]} onClick={() => p.onOverlay('text', { anim: a.id })} />
            ))}
          </Section>
        </>
      );
      break;
    case 'overlay':
      body = (
        <>
          <Target s={target} what={tr('Adds at the playhead in', '在播放头处加到')} />
          <Section title={nm(POPULAR_TITLE)}>
            {pick(OVERLAY_LIST, POPULAR.overlay).map((o) => (
              <Tile key={o.id} label={nm(o)} warn={warnOf(o)} prev={['overlay', o.id]} onClick={() => p.onOverlay(o.id)} />
            ))}
          </Section>
          {(['text', 'callout', 'draw', 'ui', 'data', 'fx'] as const).map((g) => (
            <Section key={g} title={nm(GROUP_NAMES[g])}>
              {OVERLAY_LIST.filter((o) => o.group === g && o.id !== 'text' && o.id !== 'lower').map((o) => (
                <Tile key={o.id} label={nm(o)} warn={warnOf(o)} prev={['overlay', o.id]} onClick={() => p.onOverlay(o.id)} />
              ))}
            </Section>
          ))}
          <Section title={tr('Lower thirds', '下三分之一字幕条')} count={LOWER_LIST.length}>
            {LOWER_LIST.map((l) => (
              <Tile key={l.id || 'classic'} label={nm(l)} prev={['lower', l.id]} onClick={() => p.onOverlay('lower', l.id ? { style: l.id } : {})} />
            ))}
          </Section>
        </>
      );
      break;
    case 'trans':
      body = (
        <>
          <Target s={target} what={tr('Transition into', '进入这一段的转场：')} />
          <Section title={nm(POPULAR_TITLE)}>
            {pick(TRANSITION_LIST, POPULAR.trans).map((t) => (
              <Tile key={t.id} label={nm(t)} warn={warnOf(t)} on={!!target && curTrans === t.id} prev={['transition', t.id]} onClick={() => p.onTransition(t.id)} />
            ))}
          </Section>
          <Section title={tr('All transitions', '全部转场')} count={TRANSITION_LIST.length}>
            {TRANSITION_LIST.map((t) => (
              <Tile key={t.id || 'fade'} label={`${nm(t)}${t.id ? '' : tr(' (default)', '（默认）')}`} warn={warnOf(t)} on={!!target && curTrans === t.id} prev={['transition', t.id]} onClick={() => p.onTransition(t.id)} />
            ))}
          </Section>
        </>
      );
      break;
    case 'fx':
      body = (
        <>
          <Target s={target} what={tr('Applies to', '作用于：')} />
          <Section title={tr('Looks', '滤镜')}>
            {LOOK_LIST.map((l) => (
              <Tile key={l.id || 'none'} label={nm(l)} pick={`effect|look:${l.id}|${nm(l)}`} on={!!target && curLook === l.id} onClick={() => p.onLook(l.id)}>
                <span className="lt-look" style={{ filter: l.id ? LOOKS[l.id as keyof typeof LOOKS] : undefined }}>
                  <LookBase slug={slug} s={p.preview} theme={p.theme} />
                </span>
              </Tile>
            ))}
          </Section>
          {FX_TILES.map((g) => (
            <Section key={g.group.en} title={nm(g.group)}>
              {g.items.map((it) => {
                const preset = FX_DEMO[it.id];
                const on = fxOn(target?.fx, preset);
                return <Tile key={it.id} label={nm(it)} warn={warnOf(it)} on={on} prev={['fx', it.id]} onClick={() => p.onFx(preset, on)} />;
              })}
            </Section>
          ))}
        </>
      );
      break;
    case 'bg':
      body = (
        <>
          {hints ? <div className="lib-note pad0">{tr('Plays behind every scene of this video', '整条片子的背景动画')}</div> : null}
          <Section>
            {BG_LIST.map((b) => (
              <Tile key={b.id || 'none'} label={nm(b)} on={(p.theme.bgFx ?? '') === b.id} prev={['bg', b.id]} onClick={() => p.onBg(b.id)} />
            ))}
          </Section>
        </>
      );
      break;
    case 'voice':
      body = <VoicePanel slug={slug} lang={p.lang} onSettings={p.onSettings} />;
      break;
    case 'sfx':
      body = <SoundList onAdd={p.onSound} />;
      break;
    case 'audio': {
      const tracks = [...p.music.map((m) => ({ src: m.src, own: false })), ...auds.map((a) => ({ src: `${slug}/${a}`, own: true }))];
      body = (
        <>
          <div className="lib-bar">
            <button className="btn" onClick={p.onImport}>
              <Icon name="import" />
              {tr('Import music', '导入音乐')}
            </button>
            {hints ? <span className="lib-note">{tr('Background music, played under the narration', '背景音乐，垫在旁白下面')}</span> : null}
          </div>
          <div className="lib-note pad">{tr('Or have the AI write one: in the AI panel type / and pick Music. It is played by real instrument recordings (XSXB-Band) and needs no credit.', '也可以让 AI 写一首：在 AI 助手里输入 / 选「配乐」。用真实乐器的录音演奏（需要装 XSXB-Band），不用署名。')}</div>
          {tracks.length ? (
            tracks.map((t) => (
              <AudioRow
                key={t.src}
                src={t.src}
                label={base(t.src).replace(/\.\w+$/, '')}
                sub={t.own ? tr('Project file', '项目素材') : tr('Library', '曲库')}
                on={p.musicSrc === t.src}
                onUse={() => p.onMusic(t.src)}
              />
            ))
          ) : (
            <div className="lib-note pad">{tr('No music yet. Import an mp3 or put one in public/music/', '还没有音乐。导入 mp3，或放进 public/music/')}</div>
          )}
        </>
      );
      break;
    }
  }

  return (
    <aside className="lib panel">
      <nav className="lib-tabs" role="tablist" aria-orientation="vertical">
        {TABS.map(([k, en, zh, ic]) => (
          <button key={k} role="tab" aria-selected={p.tab === k} className={p.tab === k ? 'on' : undefined} onClick={() => p.setTab(k)}>
            <Icon name={ic} size={18} />
            {tr(en, zh)}
          </button>
        ))}
      </nav>
      <div className="lib-body">{body}</div>
    </aside>
  );
}
