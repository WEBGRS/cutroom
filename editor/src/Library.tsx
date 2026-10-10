import React, { useEffect, useRef, useState } from 'react';
import type { Scene, Theme } from '../../src/lib/types';
import { LOOKS } from '../../src/components/Fx';
import { OVERLAYS, SCENE_FX, TRANSITIONS } from './catalog';
import { thumbsUrl, useAsset, type Thumbs } from './assets';
import { Icon } from './icons';

export type LibTab = 'media' | 'cards' | 'text' | 'trans' | 'looks' | 'audio';

const TABS: [LibTab, string, string][] = [
  ['media', '素材', 'media'],
  ['cards', '卡片', 'cards'],
  ['text', '叠加', 'text'],
  ['trans', '转场', 'trans'],
  ['looks', '滤镜', 'filter'],
  ['audio', '音乐', 'music'],
];

const CARDS: [string, string, string][] = [
  ['title', '标题卡', '开场或章节标题'],
  ['stats', '数字卡', '三个关键数字'],
  ['flow', '流程图', '几步走完一件事'],
  ['outro', '片尾', '结尾和网址'],
];

const LOOK_OPTS = SCENE_FX[0].fields[0].options!;

const isImg = (a: string) => /\.(png|jpe?g|webp|gif)$/i.test(a);
const isVid = (a: string) => /\.(mp4|webm|mov)$/i.test(a);
const isAud = (a: string) => /\.(mp3|wav|m4a)$/i.test(a);
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const base = (p: string) => p.replace(/^.*\//, '');
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

interface Props {
  slug: string;
  assets: string[];
  music: { src: string; beats: boolean }[];
  theme: Theme;
  mode: 'voice' | 'beat';
  target: Scene | null;
  preview: Scene | null;
  musicSrc: string | undefined;
  onAdd: (kind: string, src?: string) => void;
  onImport: () => void;
  onOverlay: (kind: string) => void;
  onTransition: (t: string) => void;
  onLook: (look: string) => void;
  onMusic: (src: string) => void;
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

function Tile({ label, sub, on, warn, onClick, children, title }: { label: string; sub?: string; on?: boolean; warn?: string; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button className={`lt${on ? ' on' : ''}`} onClick={onClick} title={title ?? warn ?? label}>
      <span className="lt-box">
        {children}
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
    <div className="lib-target none">先在时间线上点选一段</div>
  );
}

// Thumbnail of the scene the looks are previewed on
function LookBase({ slug, s, theme }: { slug: string; s: Scene | null; theme: Theme }) {
  const v = s?.visual;
  if (v && (v.kind === 'screen' || v.kind === 'clip' || v.kind === 'image')) return <Thumb slug={slug} src={v.src} at={0.45} dur={false} />;
  const [a, b] = theme.bg ?? ['#0b1020', '#18223d'];
  return <div className="lt-img" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }} />;
}

function Mock({ kind }: { kind: string }) {
  switch (kind) {
    case 'tag':
      return <span className="mk-tag">标签</span>;
    case 'note':
      return (
        <span className="mk-note">
          <i />
          <i />
        </span>
      );
    case 'punch':
      return <span className="mk-punch">重点</span>;
    case 'lower':
      return (
        <span className="mk-lower">
          <i />
          <i />
        </span>
      );
    case 'cinema':
      return (
        <span className="mk-cinema">
          <b>片 名</b>
        </span>
      );
    case 'box':
      return <span className="mk-box" />;
    case 'arrow':
      return (
        <svg className="mk-arrow" viewBox="0 0 40 24">
          <path d="M6 20 30 6M30 6h-9M30 6v9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'spot':
      return <span className="mk-spot" />;
    case 'blur':
      return <span className="mk-blur" />;
    case 'sticker':
      return <span className="mk-sticker">🔥</span>;
    default:
      return null;
  }
}

function AudioRow({ src, label, sub, on, disabled, why, onUse }: { src: string; label: string; sub: string; on: boolean; disabled?: boolean; why?: string; onUse: () => void }) {
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
      <button className="icon sm" onClick={toggle} title={playing ? '停止试听' : '试听'}>
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <span className="arow-t">
        <b>{label}</b>
        <span>{sub}</span>
      </span>
      {on ? (
        <span className="arow-on">
          <Icon name="check" size={13} />
          使用中
        </span>
      ) : (
        <button className="mini" disabled={disabled} title={why} onClick={onUse}>
          使用
        </button>
      )}
    </div>
  );
}

export function Library(p: Props & { tab: LibTab; setTab: (t: LibTab) => void }) {
  const { slug, assets, target } = p;
  const caps = assets.filter((a) => a.startsWith('cap/') && isVid(a));
  const vids = assets.filter((a) => isVid(a) && !a.startsWith('cap/'));
  const imgs = assets.filter(isImg);
  const auds = assets.filter(isAud);
  const curTrans = p.mode === 'beat' ? (target?.beatTransition ?? '') : target?.transition === 'fade' ? '' : (target?.transition ?? '');
  const curLook = target?.fx?.look ?? '';

  const media = (title: string, list: string[], kind: string) =>
    list.length ? (
      <section className="lib-sec" key={kind}>
        <h4>
          {title}
          <span>{list.length}</span>
        </h4>
        <div className="lgrid">
          {list.map((a) => (
            <Tile key={a} label={base(a)} onClick={() => p.onAdd(kind, a)} title={`添加到时间线：${a}`}>
              <Thumb slug={slug} src={a} />
            </Tile>
          ))}
        </div>
      </section>
    ) : null;

  let body: React.ReactNode;
  switch (p.tab) {
    case 'media':
      body = (
        <>
          <div className="lib-bar">
            <button className="btn" onClick={p.onImport}>
              <Icon name="import" />
              导入素材
            </button>
            <span className="lib-note">或直接拖进窗口</span>
          </div>
          {caps.length + vids.length + imgs.length ? (
            <>
              {media('录屏', caps, 'screen')}
              {media('视频', vids, 'clip')}
              {media('图片', imgs, 'image')}
            </>
          ) : (
            <button className="lib-empty" onClick={p.onImport}>
              <Icon name="import" size={20} />
              导入图片或视频，点一下就加到时间线
            </button>
          )}
        </>
      );
      break;
    case 'cards': {
      const [a, b] = p.theme.bg ?? ['#0b1020', '#18223d'];
      body = (
        <section className="lib-sec">
          <h4>点一下加在选中段落后面</h4>
          <div className="lgrid">
            {CARDS.map(([k, l, sub]) => (
              <Tile key={k} label={l} sub={sub} onClick={() => p.onAdd(k)}>
                <span className="lt-card" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}>
                  {k === 'stats' ? (
                    <span className="lc-stats" style={{ color: p.theme.accent }}>
                      <b>12</b>
                      <b>3.4k</b>
                      <b>98%</b>
                    </span>
                  ) : k === 'flow' ? (
                    <span className="lc-flow">
                      <i />
                      <i />
                      <i style={{ background: p.theme.accent }} />
                    </span>
                  ) : (
                    <span className="lc-title">
                      <small style={{ color: p.theme.accent }}>{k === 'outro' ? 'example.com' : 'KICKER'}</small>
                      {k === 'outro' ? '谢谢观看' : '新标题'}
                    </span>
                  )}
                </span>
              </Tile>
            ))}
          </div>
        </section>
      );
      break;
    }
    case 'text':
      body = (
        <>
          <Target s={target} what="加到播放头位置：" />
          <div className="lgrid">
            {OVERLAYS.map((o) => (
              <Tile key={o.kind} label={o.label} warn={o.rule} onClick={() => p.onOverlay(o.kind)}>
                <span className="lt-mock">
                  <Mock kind={o.kind} />
                </span>
              </Tile>
            ))}
          </div>
        </>
      );
      break;
    case 'trans':
      body = (
        <>
          <Target s={target} what="设置进入这一段的转场：" />
          <div className="lgrid">
            {TRANSITIONS.filter(([t]) => p.mode === 'voice' || t !== 'none').map(([t, l, rule]) => (
              <Tile key={t || 'fade'} label={`${p.mode === 'beat' && !t ? '交叉淡化' : l}${t ? '' : '（默认）'}`} warn={rule} on={!!target && curTrans === t} onClick={() => p.onTransition(t)}>
                <span className={`tx tx-${t || 'fade'}`}>
                  <i className="tx-a" />
                  <i className="tx-b" />
                </span>
              </Tile>
            ))}
          </div>
        </>
      );
      break;
    case 'looks':
      body = (
        <>
          <Target s={target} what="给这一段调色：" />
          <div className="lgrid">
            {LOOK_OPTS.map(([v, l]) => (
              <Tile key={v || 'none'} label={l} on={!!target && curLook === v} onClick={() => p.onLook(v)}>
                <span className="lt-look" style={{ filter: v ? LOOKS[v as keyof typeof LOOKS] : undefined }}>
                  <LookBase slug={slug} s={p.preview} theme={p.theme} />
                </span>
              </Tile>
            ))}
          </div>
        </>
      );
      break;
    case 'audio': {
      const tracks = [...p.music.map((m) => ({ src: m.src, beats: m.beats, own: false })), ...auds.map((a) => ({ src: `${slug}/${a}`, beats: false, own: true }))];
      body = (
        <>
          <div className="lib-bar">
            <button className="btn" onClick={p.onImport}>
              <Icon name="import" />
              导入音乐
            </button>
            <span className="lib-note">{p.mode === 'beat' ? '卡点版只能用分析过节拍的曲子' : '旁白版的背景音乐'}</span>
          </div>
          {tracks.length ? (
            tracks.map((t) => (
              <AudioRow
                key={t.src}
                src={t.src}
                label={base(t.src).replace(/\.\w+$/, '')}
                sub={`${t.own ? '项目素材' : '曲库'}${t.beats ? ' · 有节拍数据' : ''}`}
                on={p.musicSrc === t.src}
                disabled={p.mode === 'beat' && !t.beats}
                why={p.mode === 'beat' && !t.beats ? '没有节拍数据：先运行 python tools/beats.py <文件>' : undefined}
                onUse={() => p.onMusic(t.src)}
              />
            ))
          ) : (
            <div className="lib-note pad">还没有音乐。导入 mp3，或放进 public/music/</div>
          )}
        </>
      );
      break;
    }
  }

  return (
    <aside className="lib panel">
      <nav className="lib-tabs" role="tablist">
        {TABS.map(([k, l, ic]) => (
          <button key={k} role="tab" aria-selected={p.tab === k} className={p.tab === k ? 'on' : undefined} onClick={() => p.setTab(k)}>
            <Icon name={ic} size={18} />
            {l}
          </button>
        ))}
      </nav>
      <div className="lib-body">{body}</div>
    </aside>
  );
}
