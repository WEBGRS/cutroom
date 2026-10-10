import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { plain } from '../../src/lib/timeline';
import type { Theme } from '../../src/lib/types';
import type { EScene, ETimeline } from './model';
import { peaksUrl, thumbsUrl, useAsset, type Peaks, type Thumbs } from './assets';
import { Icon } from './icons';

const LAB = 64;
const CLIP_H = 58;
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60];
export const MAX_ZOOM = 300;

export type Edge = 'l' | 'r';

interface Props {
  etl: ETimeline;
  slug: string;
  theme: Theme;
  player: PlayerRef | null;
  sel: string | null;
  zoom: number | null;
  setZoom: (z: number | null) => void;
  onSelect: (id: string | null, line?: number) => void;
  onSeek: (f: number) => void;
  onMove: (id: string, beforeVisible: string | null) => void;
  canTrim: (e: EScene, edge: Edge) => boolean;
  onTrim: (e: EScene, edge: Edge, dSec: number, done: boolean) => void;
  tools: React.ReactNode;
}

type Drag = { kind: 'move'; id: string; x0: number; moved: boolean; slot: number; px: number } | { kind: 'trim'; e: EScene; edge: Edge; x0: number } | { kind: 'scrub' };

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const stamp = (t: number, fine: boolean) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${fine ? s.toFixed(1).padStart(4, '0') : String(Math.round(s)).padStart(2, '0')}`;
};

// Screen recordings: thumbnails sampled at each tile's moment in the capture
function Strip({ s, slug, pps, fps }: { s: EScene; slug: string; pps: number; fps: number }) {
  const v = s.visual;
  const th = useAsset<Thumbs>(v.kind === 'screen' || v.kind === 'clip' ? thumbsUrl(slug, v.src) : null);
  if (!th) return <div className="strip pending" />;
  const tileW = th.w * (CLIP_H / th.h);
  const width = (s.dur / fps) * pps;
  const from = v.kind === 'clip' ? (v.from ?? 0) : (s.from ?? 0);
  const rate = v.kind === 'clip' ? (v.rate ?? 1) : s.rate;
  const avail = Math.max(0, ((v.kind === 'clip' ? th.dur : (s.to ?? th.dur)) - from) / rate);
  const tiles: React.ReactNode[] = [];
  for (let x = 0, k = 0; x < width; x += tileW, k++) {
    const t = from + Math.min((x + tileW / 2) / pps, avail) * rate;
    const i = clamp(Math.floor(t / th.interval), 0, th.count - 1);
    tiles.push(<div key={k} className="tile" style={{ left: x, width: tileW, backgroundImage: `url(${th.url})`, backgroundSize: `${th.count * tileW}px ${CLIP_H}px`, backgroundPosition: `${-i * tileW}px 0` }} />);
  }
  return <div className="strip">{tiles}</div>;
}

// Cards drawn the way they look in the video: project backdrop, video typeface
function Slate({ s, theme }: { s: EScene; theme: Theme }) {
  const v = s.visual;
  const [a, b] = theme.bg ?? ['#0b1020', '#18223d'];
  const kicker = v.kind === 'title' ? v.kicker : v.kind === 'outro' ? v.url : undefined;
  const main = v.kind === 'stats' ? v.items.map((i) => i.value).join('  ') : s.label;
  return (
    <div className="slate" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}>
      {kicker ? <span className="kick" style={{ color: theme.accent }}>{plain(kicker)}</span> : null}
      <span className="main" style={v.kind === 'stats' ? { color: theme.accent } : undefined}>
        {main}
      </span>
    </div>
  );
}

// Peak waveform; offset/loop map timeline seconds into the file
function Wave({ path, width, height, color, offset = 0, loop = false, pps }: { path: string; width: number; height: number; color: string; offset?: number; loop?: boolean; pps: number }) {
  const pk = useAsset<Peaks>(peaksUrl(path));
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.round(width));
  const dpr = w * (window.devicePixelRatio || 1) > 32000 ? 1 : window.devicePixelRatio || 1;
  useEffect(() => {
    const c = ref.current;
    if (!c || !pk?.p.length) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const n = pk.p.length;
    const per = pk.rate / pps;
    // Peak per pixel column, then a short blur so the envelope reads as a shape, not a barcode
    const raw = new Float32Array(w);
    let end = w;
    for (let x = 0; x < w; x++) {
      let i0 = (offset + x / pps) * pk.rate;
      if (loop) i0 %= n;
      else if (i0 >= n) {
        end = x;
        break;
      }
      let m = 0;
      for (let i = Math.floor(i0); i < Math.max(Math.floor(i0) + 1, Math.floor(i0 + per)); i++) m = Math.max(m, pk.p[loop ? i % n : Math.min(i, n - 1)]);
      raw[x] = Math.pow(m / 255, 0.75);
    }
    const r = Math.max(1, Math.round(pps / 40));
    const mid = height / 2;
    const hh = mid - 2;
    const amp = (x: number) => {
      let s = 0;
      let k = 0;
      for (let j = Math.max(0, x - r); j <= Math.min(end - 1, x + r); j++, k++) s += raw[j];
      return k ? s / k : 0;
    };
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let x = 0; x < end; x++) ctx.lineTo(x + 0.5, mid - Math.max(0.5, amp(x) * hh));
    for (let x = end - 1; x >= 0; x--) ctx.lineTo(x + 0.5, mid + Math.max(0.5, amp(x) * hh));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }, [pk, w, height, color, offset, loop, pps, dpr]);
  return <canvas ref={ref} width={w * dpr} height={height * dpr} style={{ width: w, height }} />;
}

export function Timeline(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { etl } = p;
  const fps = etl.fps;
  const totalSec = etl.total / fps;
  const fit = Math.max(2, (width - LAB - 28) / Math.max(0.5, totalSec));
  const pps = p.zoom ?? fit;
  const X = (f: number) => (f / fps) * pps;
  const contentW = LAB + totalSec * pps + 28;
  const voiced = etl.scenes.some((s) => s.lines.some((l) => l.file));

  const frameAt = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - LAB;
    return clamp(Math.round((x / pps) * fps), 0, etl.total - 1);
  };
  const slotAt = (frame: number, id: string) => {
    let k = 0;
    for (const s of etl.scenes) if (s.id !== id && frame > s.start + s.dur / 2) k++;
    return k;
  };
  const slotX = (slot: number, id: string) => {
    const rest = etl.scenes.filter((s) => s.id !== id);
    if (!rest.length) return 0;
    return slot >= rest.length ? X(rest[rest.length - 1].start + rest[rest.length - 1].dur) : X(rest[slot].start);
  };

  const onClipDown = (ev: React.PointerEvent, s: EScene) => {
    if (ev.button !== 0) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ kind: 'move', id: s.id, x0: ev.clientX, moved: false, slot: 0, px: 0 });
  };
  const onHandleDown = (ev: React.PointerEvent, e: EScene, edge: Edge) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    p.onSelect(e.id);
    setDrag({ kind: 'trim', e, edge, x0: ev.clientX });
  };
  const onMoveEv = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'scrub') return p.onSeek(frameAt(ev.clientX));
    if (d.kind === 'trim') return p.onTrim(d.e, d.edge, (ev.clientX - d.x0) / pps, false);
    const moved = d.moved || Math.abs(ev.clientX - d.x0) > 5;
    if (moved) setDrag({ ...d, moved, slot: slotAt(frameAt(ev.clientX), d.id), px: ev.clientX - d.x0 });
  };
  const onUp = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'trim') return p.onTrim(d.e, d.edge, (ev.clientX - d.x0) / pps, true);
    if (d.kind !== 'move') return;
    const s = etl.scenes.find((x) => x.id === d.id)!;
    if (!d.moved) {
      p.onSelect(d.id);
      const f = p.player?.getCurrentFrame() ?? 0;
      if (f < s.start || f >= s.start + s.dur) p.onSeek(s.start);
      return;
    }
    const rest = etl.scenes.filter((x) => x.id !== d.id);
    const own = rest.findIndex((x) => x.start > s.start);
    if (d.slot === (own < 0 ? rest.length : own)) return;
    p.onMove(d.id, d.slot < rest.length ? rest[d.slot].id : null);
  };

  // Ruler
  const step = STEPS.find((st) => st * pps >= 64) ?? 120;
  // Beat cut: the beat grid takes the minor ticks' place
  const beatGrid = !!(etl.beats && etl.bar && (etl.bar / 4) * pps >= 6);
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i * (step / 4) <= totalSec + 1e-6; i++) {
    const t = i * (step / 4);
    const kind = i % 4 === 0 ? 'big' : i % 2 === 0 ? 'mid' : '';
    if (beatGrid && kind !== 'big') continue;
    ticks.push(<div key={`t${i}`} className={`tick ${kind}`} style={{ left: LAB + t * pps }} />);
    if (i % 4 === 0) ticks.push(<div key={`n${i}`} className="num" style={{ left: LAB + t * pps }}>{stamp(t, step < 1)}</div>);
  }
  const beats = beatGrid ? etl.beats!.map((b, i) => <div key={`b${i}`} className={`beat${b.down ? ' down' : ''}`} style={{ left: LAB + X(b.f) }} />) : null;
  const moving = drag?.kind === 'move' && drag.moved ? drag : null;

  return (
    <div className="tl">
      <div className="tl-tools">
        {p.tools}
        <span className="grow" />
        <div className="zoom">
          <button className="icon" title="缩小" onClick={() => p.setZoom(Math.max(2, pps / 1.5))}>
            <Icon name="minus" />
          </button>
          <button className="icon" title="放大" onClick={() => p.setZoom(Math.min(MAX_ZOOM, pps * 1.5))}>
            <Icon name="plus" />
          </button>
          <button className="icon" title="整条放进视野" onClick={() => p.setZoom(null)} disabled={p.zoom === null}>
            <Icon name="fit" />
          </button>
        </div>
      </div>
      <div className="tl-scroll" ref={scroller} onPointerMove={onMoveEv} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
        <div className="tl-content" style={{ width: contentW }}>
          <div
            className="row ruler"
            onPointerDown={(ev) => {
              (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
              setDrag({ kind: 'scrub' });
              p.onSeek(frameAt(ev.clientX));
            }}
          >
            <div className="lab" />
            {beats}
            {ticks}
          </div>
          <div
            className="row lane-v"
            onPointerDown={(ev) => {
              if (ev.target === ev.currentTarget) {
                p.onSelect(null);
                p.onSeek(frameAt(ev.clientX));
              }
            }}
          >
            <div className="lab">画面</div>
            {etl.scenes.map((s) => {
              const dragging = moving?.id === s.id;
              const w = Math.max(4, X(s.dur));
              return (
                <div
                  key={s.id}
                  className={`clip${p.sel === s.id ? ' sel' : ''}${dragging ? ' dragging' : ''}`}
                  style={{ left: LAB + X(s.start), width: w, transform: dragging ? `translateX(${moving!.px}px)` : undefined }}
                  title={`${s.id}，${(s.dur / fps).toFixed(2)} 秒`}
                  onPointerDown={(ev) => onClipDown(ev, s)}
                >
                  {s.visual.kind === 'screen' || s.visual.kind === 'clip' ? (
                    <Strip s={s} slug={p.slug} pps={pps} fps={fps} />
                  ) : s.visual.kind === 'image' ? (
                    <div className="strip" style={{ background: `url("/${p.slug}/${s.visual.src.split('/').map(encodeURIComponent).join('/')}") center / cover` }} />
                  ) : (
                    <Slate s={s} theme={p.theme} />
                  )}
                  {s.trans > 0 ? <div className="xfade" style={{ width: X(s.trans) }} /> : null}
                  {s.needed && s.needed < s.dur - 2 ? <div className="need" style={{ left: X(s.needed) }} title="旁白在这里结束" /> : null}
                  {s.marks.map((m) => (
                    <div key={m.name + m.f} className="mk" style={{ left: X(m.f) }} title={`@${m.name}`} />
                  ))}
                  <span className="name" style={{ marginLeft: X(s.trans) }}>{s.id}</span>
                  {p.canTrim(s, 'l') ? <div className="h l" onPointerDown={(ev) => onHandleDown(ev, s, 'l')} /> : null}
                  {p.canTrim(s, 'r') ? <div className="h r" onPointerDown={(ev) => onHandleDown(ev, s, 'r')} /> : null}
                </div>
              );
            })}
            {moving ? <div className="drop" style={{ left: LAB + slotX(moving.slot, moving.id) }} /> : null}
          </div>
          <div className="row lane-t">
            <div className="lab">文字</div>
            {etl.scenes.flatMap((s) =>
              s.lines.map((l) => (
                <div
                  key={`${s.id}-${l.k}`}
                  className={`cap${l.stale ? ' stale' : ''}${p.sel === s.id ? ' on' : ''}`}
                  style={{ left: LAB + X(s.start + l.start) + 1, width: Math.max(3, X(l.dur) - 2) }}
                  title={l.stale ? `${l.text}（文字改过，配音还是旧的）` : l.text}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    p.onSelect(s.id, l.k);
                    p.onSeek(s.start + l.start);
                  }}
                >
                  {l.text}
                </div>
              )),
            )}
          </div>
          {voiced ? (
            <div className="row lane-a">
              <div className="lab">旁白</div>
              {etl.scenes.flatMap((s) =>
                s.lines
                  .filter((l) => l.file)
                  .map((l) => (
                    <div key={`a${s.id}-${l.k}`} className="vo" style={{ left: LAB + X(s.start + l.start), width: Math.max(2, X(l.dur)) }}>
                      <Wave path={`${p.slug}/${l.file}`} width={Math.max(2, X(l.dur))} height={24} color="#23845f" pps={pps} />
                    </div>
                  )),
              )}
            </div>
          ) : null}
          {etl.music ? (
            <div className="row lane-m">
              <div className="lab">音乐</div>
              <div className="mus" style={{ left: LAB, width: X(etl.total) }}>
                <Wave path={etl.music.src} width={X(etl.total)} height={22} color="#7a5cc0" offset={etl.music.offset} loop={etl.music.loop} pps={pps} />
              </div>
            </div>
          ) : null}
          <Playhead player={p.player} x={(f) => LAB + X(f)} scroller={scroller} />
        </div>
      </div>
    </div>
  );
}

// Red line that follows the player without re-rendering the timeline
function Playhead({ player, x, scroller }: { player: PlayerRef | null; x: (f: number) => number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const xr = useRef(x);
  xr.current = x;
  useEffect(() => {
    const upd = (f: number) => {
      const px = xr.current(f);
      if (ref.current) ref.current.style.transform = `translateX(${px}px)`;
      const el = scroller.current;
      if (el && player?.isPlaying() && (px > el.scrollLeft + el.clientWidth - 40 || px < el.scrollLeft + LAB)) el.scrollLeft = px - 120;
    };
    if (!player) return;
    const h = (e: { detail: { frame: number } }) => upd(e.detail.frame);
    player.addEventListener('frameupdate', h);
    player.addEventListener('seeked', h);
    upd(player.getCurrentFrame());
    return () => {
      player.removeEventListener('frameupdate', h);
      player.removeEventListener('seeked', h);
    };
  }, [player, scroller]);
  useEffect(() => {
    if (player && ref.current) ref.current.style.transform = `translateX(${x(player.getCurrentFrame())}px)`;
  });
  return <div className="ph" ref={ref} />;
}
