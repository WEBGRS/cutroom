import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { MONO, SANS } from '../lib/fonts';
import { rgba, type Layout } from '../lib/layout';
import type { Overlay, Theme } from '../lib/types';
import { AnimText } from './text';
import { EASE, clamp01, hash, lerp, tween } from './ease';

// Overlay kinds ported from HyperFrames components/blocks. All positions are 0..1 of the frame;
// x/y is the centre (or the tip for arrows/cursors), w/h a size or offset as noted in the catalog.

interface Ctx {
  o: Overlay;
  // Seconds since the overlay started, and its length
  t: number;
  d: number;
  // Fade-out multiplier for the last frames
  out: number;
  layout: Layout;
  theme: Theme;
  fps: number;
  k: number;
}

const accentOf = (c: Ctx) => c.o.color ?? c.theme.accent;
const hiOf = (c: Ctx) => c.theme.accent2 ?? c.theme.accent;

// Hand-drawn stroke: jittered points, smoothed, drawn on with a dash
function roughEllipse(cx: number, cy: number, rx: number, ry: number, seed: number) {
  const n = 28;
  const pts: [number, number][] = [];
  const start = -2.2 + hash(seed, 9) * 0.4;
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2.18;
    const j = 1 + (hash(seed, i) - 0.5) * 0.07 + (i / n) * 0.06;
    pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
  }
  return smooth(pts);
}
function roughLine(pts: [number, number][], seed: number, amp: number) {
  return smooth(pts.map(([x, y], i) => [x + (hash(seed, i, 1) - 0.5) * amp, y + (hash(seed, i, 2) - 0.5) * amp]));
}
function smooth(pts: [number, number][]) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0].toFixed(1)},${l[1].toFixed(1)}`;
}

const Draw: React.FC<{ d: string; k: number; color: string; width: number; opacity?: number }> = ({ d, k, color, width, opacity = 1 }) => (
  <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} opacity={opacity} />
);

const Svg: React.FC<{ c: Ctx; children: React.ReactNode }> = ({ c, children }) => (
  <svg width={c.layout.W} height={c.layout.H} style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: c.out, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.35))' }}>
    {children}
  </svg>
);

const Label: React.FC<{ c: Ctx; x: number; y: number; text?: string; align?: 'left' | 'center'; k: number }> = ({ c, x, y, text, align = 'center', k }) =>
  text ? (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(${align === 'center' ? '-50%' : '0'}, -50%) translateY(${(1 - k) * 12}px)`, opacity: c.out * k, fontFamily: SANS, fontSize: c.layout.zh * 0.62, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', textShadow: '0 2px 10px rgba(0,0,0,.6)' }}>{text}</div>
  ) : null;

// Boil: hand-drawn lines re-jitter a few times a second
const boil = (c: Ctx) => Math.floor(c.t * 6);

function lowerThird(c: Ctx): React.ReactNode {
  const { o, layout, t } = c;
  const W = layout.W;
  const H = layout.H;
  const tall = H > W;
  const acc = accentOf(c);
  const x = W * 0.06;
  const y = (o.y ?? (tall ? 0.62 : 0.72)) * H;
  const zh = layout.zh;
  const name = o.text;
  const role = o.sub;
  const e = tween(t, 0, 0.55, 'power3.out');
  const e2 = tween(t, 0.15, 0.5, 'power3.out');
  const box: React.CSSProperties = { position: 'absolute', left: x, top: y, fontFamily: SANS, opacity: c.out };
  const nameStyle: React.CSSProperties = { fontSize: zh * 0.78, fontWeight: 900, lineHeight: 1.15, whiteSpace: 'nowrap' };
  const roleStyle: React.CSSProperties = { fontSize: zh * 0.42, fontWeight: 600, marginTop: 4, whiteSpace: 'nowrap' };
  switch (o.style) {
    case 'clean':
      return (
        <div style={{ ...box, transform: `translateY(${(1 - e) * 20}px)`, opacity: c.out * e }}>
          <div style={{ ...nameStyle, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,.6)' }}>{name}</div>
          <div style={{ height: 4, width: zh * 3 * e2, background: acc, margin: '8px 0 6px', borderRadius: 2 }} />
          {role ? <div style={{ ...roleStyle, color: 'rgba(255,255,255,.85)', opacity: e2 }}>{role}</div> : null}
        </div>
      );
    case 'bold':
      return (
        <div style={{ ...box, clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` }}>
          <div style={{ ...nameStyle, background: '#fff', color: '#0b0d12', padding: `${zh * 0.12}px ${zh * 0.4}px` }}>{name}</div>
          {role ? <div style={{ ...roleStyle, display: 'inline-block', marginTop: 0, background: acc, color: '#fff', padding: `${zh * 0.08}px ${zh * 0.4}px`, clipPath: `inset(0 ${(1 - e2) * 100}% 0 0)` }}>{role}</div> : null}
        </div>
      );
    case 'color':
      return (
        <div style={{ ...box, background: acc, color: '#fff', padding: `${zh * 0.22}px ${zh * 0.5}px`, borderRadius: 6, transform: `translateX(${(1 - e) * -40}px)`, opacity: c.out * e, boxShadow: '0 18px 50px rgba(0,0,0,.35)' }}>
          <div style={nameStyle}>{name}</div>
          {role ? <div style={{ ...roleStyle, opacity: 0.88 * e2 }}>{role}</div> : null}
        </div>
      );
    case 'dark':
      return (
        <div style={{ ...box, display: 'flex', alignItems: 'center', gap: zh * 0.35, background: 'rgba(12,14,20,.88)', padding: `${zh * 0.24}px ${zh * 0.45}px`, borderRadius: 14, border: '1px solid rgba(255,255,255,.1)', transform: `translateY(${(1 - e) * 24}px)`, opacity: c.out * e, boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}>
          <div style={{ width: zh * 1.05, height: zh * 1.05, borderRadius: '50%', background: `linear-gradient(135deg, ${acc}, ${rgba(acc, 0.5)})`, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: zh * 0.5 }}>{(name || '?').slice(0, 1)}</div>
          <div>
            <div style={{ ...nameStyle, fontSize: zh * 0.62, color: '#fff' }}>{name}</div>
            {role ? <div style={{ ...roleStyle, color: 'rgba(255,255,255,.7)' }}>{role}</div> : null}
          </div>
        </div>
      );
    case 'kicker':
      return (
        <div style={{ ...box }}>
          {role ? <div style={{ fontSize: zh * 0.36, fontWeight: 700, letterSpacing: '0.18em', color: acc, textTransform: 'uppercase', opacity: e, transform: `translateY(${(1 - e) * 10}px)` }}>{role}</div> : null}
          <div style={{ ...nameStyle, color: '#fff', opacity: e2, transform: `translateY(${(1 - e2) * 14}px)`, textShadow: '0 2px 14px rgba(0,0,0,.55)' }}>{name}</div>
        </div>
      );
    case 'mask':
      return (
        <div style={{ ...box }}>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ ...nameStyle, color: '#fff', transform: `translateY(${(1 - e) * 110}%)`, textShadow: '0 2px 14px rgba(0,0,0,.55)' }}>{name}</div>
          </div>
          {role ? (
            <div style={{ overflow: 'hidden' }}>
              <div style={{ ...roleStyle, marginTop: 2, color: acc, transform: `translateY(${(1 - e2) * 110}%)` }}>{role}</div>
            </div>
          ) : null}
        </div>
      );
    case 'neon':
      return (
        <div style={{ ...box, padding: `${zh * 0.2}px ${zh * 0.5}px`, borderRadius: 12, border: `2px solid ${acc}`, boxShadow: `0 0 ${18 * e}px ${acc}, inset 0 0 ${14 * e}px ${rgba(acc, 0.45)}`, background: 'rgba(5,6,12,.7)', opacity: c.out * Math.min(1, e * 1.4) }}>
          <div style={{ ...nameStyle, color: '#fff', textShadow: `0 0 12px ${acc}` }}>{name}</div>
          {role ? <div style={{ ...roleStyle, color: rgba(acc, 0.95) }}>{role}</div> : null}
        </div>
      );
    case 'side':
      return (
        <div style={{ ...box, display: 'flex', gap: zh * 0.3 }}>
          <div style={{ width: 6, background: acc, borderRadius: 3, transform: `scaleY(${e})`, transformOrigin: 'top' }} />
          <div style={{ opacity: e2, transform: `translateX(${(1 - e2) * -16}px)` }}>
            <div style={{ ...nameStyle, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,.55)' }}>{name}</div>
            {role ? <div style={{ ...roleStyle, color: 'rgba(255,255,255,.82)' }}>{role}</div> : null}
          </div>
        </div>
      );
    case 'pill':
      return (
        <div style={{ ...box, display: 'flex', alignItems: 'center', gap: zh * 0.3, background: 'rgba(255,255,255,.94)', borderRadius: 999, padding: `${zh * 0.16}px ${zh * 0.5}px ${zh * 0.16}px ${zh * 0.18}px`, transform: `scale(${0.9 + 0.1 * e})`, transformOrigin: 'left center', opacity: c.out * e, boxShadow: '0 14px 40px rgba(0,0,0,.3)' }}>
          <div style={{ width: zh * 0.8, height: zh * 0.8, borderRadius: '50%', background: acc }} />
          <div style={{ ...nameStyle, fontSize: zh * 0.58, color: '#111' }}>{name}</div>
          {role ? <div style={{ ...roleStyle, marginTop: 0, color: '#555', opacity: e2 }}>{role}</div> : null}
        </div>
      );
    case 'stack':
      return (
        <div style={{ ...box }}>
          <div style={{ display: 'inline-block', background: '#fff', color: '#0b0d12', padding: `${zh * 0.1}px ${zh * 0.35}px`, transform: `translateX(${(1 - e) * -110}%)`, ...nameStyle }}>{name}</div>
          <br />
          {role ? <div style={{ display: 'inline-block', background: acc, color: '#fff', padding: `${zh * 0.06}px ${zh * 0.35}px`, transform: `translateX(${(1 - e2) * -110}%)`, ...roleStyle, marginTop: 0 }}>{role}</div> : null}
        </div>
      );
    case 'underline':
      return (
        <div style={{ ...box, opacity: c.out * Math.min(1, e * 1.5) }}>
          <div style={{ ...nameStyle, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,.55)', position: 'relative', display: 'inline-block' }}>
            {name}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: -6, height: 6, background: acc, transform: `scaleX(${e2})`, transformOrigin: 'left', borderRadius: 3 }} />
          </div>
          {role ? <div style={{ ...roleStyle, marginTop: 14, color: 'rgba(255,255,255,.82)', opacity: e2 }}>{role}</div> : null}
        </div>
      );
  }
  return null;
}

export const LOWER_STYLES = ['clean', 'bold', 'color', 'dark', 'kicker', 'mask', 'neon', 'side', 'pill', 'stack', 'underline'];

function confetti(c: Ctx) {
  const { layout, t } = c;
  const W = layout.W;
  const H = layout.H;
  const x0 = (c.o.x ?? 0.5) * W;
  const y0 = (c.o.y ?? 0.55) * H;
  const cols = ['#ff5a5f', '#ffd166', '#06d6a0', '#4f8cff', '#c77dff', '#ffffff'];
  const n = 90;
  return (
    <AbsoluteFill style={{ opacity: c.out }}>
      {Array.from({ length: n }, (_, i) => {
        const ang = -Math.PI / 2 + (hash(i, 1) - 0.5) * Math.PI * 1.15;
        const v = (0.55 + hash(i, 2) * 0.75) * H * 1.35;
        const g = H * 1.6;
        const tt = Math.max(0, t);
        const x = x0 + Math.cos(ang) * v * tt * (1 - Math.min(0.6, tt * 0.3));
        const y = y0 + Math.sin(ang) * v * tt + 0.5 * g * tt * tt;
        const rot = hash(i, 3) * 720 * tt + hash(i, 4) * 360;
        const s = 18 + hash(i, 5) * 18;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: s, height: s * (hash(i, 6) > 0.5 ? 0.45 : 1), borderRadius: hash(i, 6) > 0.8 ? '50%' : 2, background: cols[i % cols.length], transform: `rotate(${rot}deg) rotateX(${rot * 1.3}deg)`, opacity: clamp01(1.6 - tt * 0.6) }} />;
      })}
    </AbsoluteFill>
  );
}

function star(cx: number, cy: number, r: number) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Highlight token colours in simple shell/JS code
function codeLine(s: string, acc: string) {
  const parts = s.split(/(\s+|"[^"]*"|'[^']*'|\b\d+\b|\b(?:const|let|return|function|import|from|npm|node|git|await|export)\b)/g).filter(Boolean);
  return parts.map((p, i) => <span key={i} style={{ color: /^["']/.test(p) ? '#9ee493' : /^\d+$/.test(p) ? '#f8c555' : /^(const|let|return|function|import|from|npm|node|git|await|export)$/.test(p) ? acc : undefined }}>{p}</span>);
}

export function fxOverlay(c: Ctx, key: number): React.ReactNode {
  const { o, layout, t, fps } = c;
  const W = layout.W;
  const H = layout.H;
  const tall = H > W;
  const zh = layout.zh;
  const cx = (o.x ?? 0.5) * W;
  const cy = (o.y ?? 0.5) * H;
  const w = (o.w ?? 0.3) * W;
  const h = (o.h ?? 0.2) * H;
  const acc = accentOf(c);
  const k = c.k;
  switch (o.kind) {
    case 'text': {
      const size = zh * 1.5 * (o.size ?? 1);
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%, -50%)', opacity: c.out, textAlign: 'center', width: W * 0.9, fontFamily: SANS }}>
          <AnimText text={o.text} anim={o.anim ?? 'fadeup'} t={t} hi={hiOf(c)} color={o.color ?? '#fff'} style={{ fontSize: size, fontWeight: 900, lineHeight: 1.15, textShadow: '0 4px 30px rgba(0,0,0,.45)' }} />
          {o.sub ? <div style={{ fontSize: size * 0.32, fontWeight: 600, color: 'rgba(255,255,255,.85)', marginTop: size * 0.15, opacity: tween(t, 0.35, 0.4), textShadow: '0 2px 12px rgba(0,0,0,.5)' }}>{o.sub}</div> : null}
        </div>
      );
    }
    case 'ticker': {
      const y = (o.y ?? 0.88) * H;
      const e = tween(t, 0, 0.45, 'power3.out');
      const bh = zh * 1.25;
      const speed = W * 0.12;
      const text = `${o.text}   •   `;
      return (
        <div key={key} style={{ position: 'absolute', left: 0, right: 0, top: y, height: bh, display: 'flex', fontFamily: SANS, opacity: c.out, transform: `translateY(${(1 - e) * bh * 1.4}px)` }}>
          <div style={{ background: acc, color: '#fff', fontWeight: 900, fontSize: zh * 0.5, padding: `0 ${zh * 0.5}px`, display: 'flex', alignItems: 'center', letterSpacing: '0.08em', zIndex: 1 }}>{o.sub || 'LIVE'}</div>
          <div style={{ flex: 1, overflow: 'hidden', background: 'rgba(10,12,18,.9)', display: 'flex', alignItems: 'center' }}>
            <div style={{ whiteSpace: 'nowrap', color: '#fff', fontSize: zh * 0.52, fontWeight: 700, transform: `translateX(${W * 0.4 - t * speed}px)` }}>{text.repeat(6)}</div>
          </div>
        </div>
      );
    }
    case 'hwcircle': {
      const kk = tween(t, 0.05, 0.6, 'power2.inOut');
      return (
        <React.Fragment key={key}>
          <Svg c={c}>
            <Draw d={roughEllipse(cx, cy, w / 2, h / 2, boil(c))} k={kk} color={acc} width={zh * 0.13} />
          </Svg>
          <Label c={c} x={cx} y={cy - h / 2 - zh * 0.55} text={o.text} k={tween(t, 0.5, 0.3)} />
        </React.Fragment>
      );
    }
    case 'hwunderline': {
      const kk = tween(t, 0.05, 0.45, 'power2.inOut');
      const n = 9;
      const pts: [number, number][] = Array.from({ length: n }, (_, i) => [cx - w / 2 + (w * i) / (n - 1), cy + Math.sin(i * 1.3) * zh * 0.06]);
      return (
        <Svg key={key} c={c}>
          <Draw d={roughLine(pts, boil(c), zh * 0.08)} k={kk} color={acc} width={zh * 0.14} />
          {o.text === '2' ? <Draw d={roughLine(pts.map(([x, y]) => [x + 8, y + zh * 0.22]), boil(c) + 5, zh * 0.08)} k={tween(t, 0.3, 0.4, 'power2.inOut')} color={acc} width={zh * 0.12} /> : null}
        </Svg>
      );
    }
    case 'hwarrow': {
      const tx = cx + (o.w ?? 0.14) * W;
      const ty = cy + (o.h ?? 0.12) * H;
      const mx = (cx + tx) / 2 + (ty - cy) * 0.25;
      const my = (cy + ty) / 2 - (tx - cx) * 0.25;
      const pts: [number, number][] = Array.from({ length: 9 }, (_, i) => {
        const u = i / 8;
        return [(1 - u) * (1 - u) * tx + 2 * (1 - u) * u * mx + u * u * cx, (1 - u) * (1 - u) * ty + 2 * (1 - u) * u * my + u * u * cy];
      });
      const ang = Math.atan2(cy - pts[7][1], cx - pts[7][0]);
      const hl = zh * 0.6;
      const head = `M${cx - Math.cos(ang - 0.5) * hl},${cy - Math.sin(ang - 0.5) * hl} L${cx},${cy} L${cx - Math.cos(ang + 0.5) * hl},${cy - Math.sin(ang + 0.5) * hl}`;
      const k1 = tween(t, 0.05, 0.5, 'power2.inOut');
      return (
        <React.Fragment key={key}>
          <Svg c={c}>
            <Draw d={roughLine(pts, boil(c), zh * 0.06)} k={k1} color={acc} width={zh * 0.12} />
            <Draw d={head} k={tween(t, 0.5, 0.18)} color={acc} width={zh * 0.12} />
          </Svg>
          <Label c={c} x={tx} y={ty + zh * 0.55} text={o.text} k={tween(t, 0.1, 0.35)} />
        </React.Fragment>
      );
    }
    case 'hwbox': {
      const x0 = cx - w / 2;
      const y0 = cy - h / 2;
      const pts: [number, number][] = [[x0, y0], [x0 + w, y0 - 4], [x0 + w + 4, y0 + h], [x0 - 2, y0 + h + 3], [x0 + 3, y0 - 8]];
      const dense: [number, number][] = [];
      for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < 4; j++) dense.push([lerp(pts[i][0], pts[i + 1][0], j / 4), lerp(pts[i][1], pts[i + 1][1], j / 4)]);
      dense.push(pts[pts.length - 1]);
      return (
        <React.Fragment key={key}>
          <Svg c={c}>
            <Draw d={roughLine(dense, boil(c), zh * 0.07)} k={tween(t, 0.05, 0.7, 'power2.inOut')} color={acc} width={zh * 0.11} />
          </Svg>
          {o.text ? <div style={{ position: 'absolute', left: x0, top: y0 - zh * 0.95, padding: `2px ${zh * 0.25}px`, background: acc, color: '#fff', fontFamily: SANS, fontSize: zh * 0.48, fontWeight: 800, borderRadius: 6, opacity: c.out * tween(t, 0.55, 0.25), transform: 'rotate(-2deg)' }}>{o.text}</div> : null}
        </React.Fragment>
      );
    }
    case 'hwcheck':
    case 'hwcross': {
      const s = (o.w ?? 0.06) * Math.min(W, H) * 1.6;
      const col = o.kind === 'hwcheck' ? (o.color ?? '#3fcf8e') : (o.color ?? '#ff5a5f');
      const d1 = o.kind === 'hwcheck' ? roughLine([[cx - s * 0.5, cy], [cx - s * 0.25, cy + s * 0.22], [cx - s * 0.1, cy + s * 0.38], [cx + s * 0.2, cy - s * 0.05], [cx + s * 0.55, cy - s * 0.45]], boil(c), s * 0.04) : roughLine([[cx - s * 0.45, cy - s * 0.45], [cx, cy], [cx + s * 0.45, cy + s * 0.45]], boil(c), s * 0.04);
      const d2 = o.kind === 'hwcross' ? roughLine([[cx + s * 0.45, cy - s * 0.45], [cx, cy], [cx - s * 0.45, cy + s * 0.45]], boil(c) + 3, s * 0.04) : null;
      return (
        <React.Fragment key={key}>
          <Svg c={c}>
            <Draw d={d1} k={tween(t, 0.05, 0.35, 'power2.inOut')} color={col} width={s * 0.11} />
            {d2 ? <Draw d={d2} k={tween(t, 0.35, 0.3, 'power2.inOut')} color={col} width={s * 0.11} /> : null}
          </Svg>
          <Label c={c} x={cx} y={cy + s * 0.75} text={o.text} k={tween(t, 0.45, 0.3)} />
        </React.Fragment>
      );
    }
    case 'pointer': {
      const r = zh * 0.32;
      const rings = [0, 0.45, 0.9].map((off) => ((t + 1.35 - off) % 1.35) / 1.35);
      const e = tween(t, 0, 0.35, 'back.out');
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, opacity: c.out }}>
          {rings.map((q, i) => (
            <div key={i} style={{ position: 'absolute', left: -r * (1 + q * 2.4), top: -r * (1 + q * 2.4), width: r * 2 * (1 + q * 2.4), height: r * 2 * (1 + q * 2.4), borderRadius: '50%', border: `3px solid ${rgba(acc, 0.9 * (1 - q))}` }} />
          ))}
          <div style={{ position: 'absolute', left: -r, top: -r, width: r * 2, height: r * 2, borderRadius: '50%', background: acc, transform: `scale(${e})`, boxShadow: `0 0 0 4px #fff, 0 6px 18px rgba(0,0,0,.4)` }} />
          {o.text ? <div style={{ position: 'absolute', left: r * 2.2, top: -zh * 0.42, whiteSpace: 'nowrap', background: '#fff', color: '#111', fontFamily: SANS, fontWeight: 800, fontSize: zh * 0.5, padding: `4px ${zh * 0.3}px`, borderRadius: 8, opacity: tween(t, 0.2, 0.3) }}>{o.text}</div> : null}
        </div>
      );
    }
    case 'feather': {
      const e = tween(t, 0, 0.5, 'power2.out');
      const m = `radial-gradient(${w * 0.62}px ${h * 0.62}px at ${cx}px ${cy}px, transparent 70%, #000 100%)`;
      return (
        <React.Fragment key={key}>
          <AbsoluteFill style={{ background: `rgba(0,0,0,${0.62 * e * c.out})`, WebkitMaskImage: m, maskImage: m }} />
          <Label c={c} x={cx} y={cy + h * 0.62 + zh * 0.4} text={o.text} k={tween(t, 0.3, 0.3)} />
        </React.Fragment>
      );
    }
    case 'tap': {
      const r = zh * 0.55;
      const press = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.2);
      const ring = clamp01((t - 0.12) / 0.6);
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, opacity: c.out }}>
          <div style={{ position: 'absolute', left: -r * (1 + ring * 1.8), top: -r * (1 + ring * 1.8), width: r * 2 * (1 + ring * 1.8), height: r * 2 * (1 + ring * 1.8), borderRadius: '50%', border: `4px solid ${rgba(acc, 0.9 * (1 - ring))}` }} />
          <div style={{ position: 'absolute', left: -r, top: -r, width: r * 2, height: r * 2, borderRadius: '50%', background: rgba(acc, 0.28 + 0.3 * press), border: '3px solid #fff', boxShadow: '0 4px 14px rgba(0,0,0,.3)', transform: `scale(${1 - 0.2 * press})` }} />
        </div>
      );
    }
    case 'cursor': {
      const fx = cx + (o.w ?? 0.18) * W;
      const fy = cy + (o.h ?? 0.16) * H;
      const m = tween(t, 0.1, 0.75, 'power3.inOut');
      const x = lerp(fx, cx, m);
      const y = lerp(fy, cy, m) - Math.sin(m * Math.PI) * zh * 0.8;
      const click = t - 0.9;
      const s = zh * 0.9;
      return (
        <div key={key} style={{ position: 'absolute', left: 0, top: 0, opacity: c.out }}>
          {click > 0 && click < 0.5 ? <div style={{ position: 'absolute', left: cx - s * (0.4 + click * 2), top: cy - s * (0.4 + click * 2), width: s * 2 * (0.4 + click * 2), height: s * 2 * (0.4 + click * 2), borderRadius: '50%', border: `4px solid ${rgba(acc, 1 - click * 2)}` }} /> : null}
          <svg width={s} height={s * 1.4} viewBox="0 0 28 40" style={{ position: 'absolute', left: x - s * 0.07, top: y - s * 0.07, transform: `scale(${click > 0 && click < 0.12 ? 0.85 : 1})`, transformOrigin: '7% 5%', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.4))' }}>
            <path d="M2 2 L2 31 L9.5 24.5 L14.5 36 L19 34 L14 22.5 L24 22.5 Z" fill="#111" stroke="#fff" strokeWidth={2.4} strokeLinejoin="round" />
          </svg>
          {o.text ? <div style={{ position: 'absolute', left: x + s * 0.7, top: y + s * 0.9, background: acc, color: '#fff', fontFamily: SANS, fontWeight: 800, fontSize: zh * 0.42, padding: `3px ${zh * 0.24}px`, borderRadius: 6, whiteSpace: 'nowrap' }}>{o.text}</div> : null}
        </div>
      );
    }
    case 'keys': {
      const keys = (o.text || 'Ctrl+B').split('+').map((s) => s.trim());
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: zh * 0.22, fontFamily: SANS, opacity: c.out }}>
          {keys.map((kk, i) => {
            const e = tween(t, i * 0.12, 0.35, 'back.out');
            const press = clamp01((t - 0.15 - keys.length * 0.12) / 0.08) * (1 - clamp01((t - 0.4 - keys.length * 0.12) / 0.12));
            return (
              <React.Fragment key={i}>
                {i ? <span style={{ color: '#fff', fontSize: zh * 0.6, fontWeight: 800, opacity: e }}>+</span> : null}
                <div style={{ minWidth: zh * 1.2, padding: `${zh * 0.16}px ${zh * 0.3}px`, borderRadius: zh * 0.18, background: 'linear-gradient(#fafbfc, #dfe2e8)', color: '#1a1d24', fontWeight: 800, fontSize: zh * 0.62, textAlign: 'center', boxShadow: `0 ${zh * 0.1 * (1 - press)}px 0 #9aa1ad, 0 10px 24px rgba(0,0,0,.35)`, transform: `translateY(${zh * 0.1 * press}px) scale(${e})`, opacity: clamp01(e * 2) }}>{kk}</div>
              </React.Fragment>
            );
          })}
          {o.sub ? <span style={{ marginLeft: zh * 0.3, color: '#fff', fontWeight: 700, fontSize: zh * 0.5, opacity: tween(t, 0.4, 0.3), textShadow: '0 2px 10px rgba(0,0,0,.6)' }}>{o.sub}</span> : null}
        </div>
      );
    }
    case 'notify': {
      const e = tween(t, 0, 0.55, 'expo.out');
      const nw = Math.min(W * 0.86, tall ? W * 0.86 : 640);
      const top = (o.y ?? 0.05) * H;
      return (
        <div key={key} style={{ position: 'absolute', left: (o.x ?? 0.5) * W - nw / 2, top, width: nw, transform: `translateY(${(1 - e) * -160}%)`, opacity: c.out, fontFamily: SANS }}>
          <div style={{ display: 'flex', gap: zh * 0.3, alignItems: 'center', padding: `${zh * 0.26}px ${zh * 0.32}px`, borderRadius: zh * 0.5, background: 'rgba(242,242,247,.86)', backdropFilter: 'blur(18px) saturate(1.6)', boxShadow: '0 18px 50px rgba(0,0,0,.35)' }}>
            <div style={{ width: zh * 0.95, height: zh * 0.95, borderRadius: zh * 0.24, background: `linear-gradient(135deg, ${acc}, ${rgba(acc, 0.6)})`, flex: 'none', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: zh * 0.48 }}>{o.text.slice(0, 1)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: zh * 0.42, color: '#1c1c1e', fontWeight: 800 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.text}</span>
                <span style={{ color: '#8e8e93', fontWeight: 500, fontSize: zh * 0.34, marginLeft: 12 }}>now</span>
              </div>
              {o.sub ? <div style={{ fontSize: zh * 0.4, color: '#3a3a3c', marginTop: 2, lineHeight: 1.3 }}>{o.sub}</div> : null}
            </div>
          </div>
        </div>
      );
    }
    case 'chat': {
      const left = (o.x ?? 0.3) < 0.5;
      const typing = t < 0.9;
      const e = tween(t, 0, 0.35, 'power3.out');
      const m = tween(t, 0.9, 0.35, 'power3.out');
      const bw = Math.min(W * 0.7, tall ? W * 0.78 : 760);
      return (
        <div key={key} style={{ position: 'absolute', left: left ? W * 0.06 : undefined, right: left ? undefined : W * 0.06, top: cy, maxWidth: bw, transform: `translateY(${(1 - e) * 20}px)`, opacity: c.out * e, fontFamily: SANS }}>
          <div style={{ padding: `${zh * 0.24}px ${zh * 0.36}px`, borderRadius: zh * 0.5, borderBottomLeftRadius: left ? 6 : zh * 0.5, borderBottomRightRadius: left ? zh * 0.5 : 6, background: left ? 'rgba(238,240,245,.96)' : acc, color: left ? '#111' : '#fff', fontSize: zh * 0.52, fontWeight: 600, lineHeight: 1.4, boxShadow: '0 12px 34px rgba(0,0,0,.28)' }}>
            {typing ? (
              <span style={{ display: 'inline-flex', gap: 8, padding: '6px 4px' }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ width: zh * 0.18, height: zh * 0.18, borderRadius: '50%', background: left ? '#8e8e93' : '#fff', opacity: 0.35 + 0.65 * Math.max(0, Math.sin((t * 6 - i * 0.9) * 1.2)) }} />
                ))}
              </span>
            ) : (
              <span style={{ opacity: m }}>{o.text}</span>
            )}
          </div>
          {o.sub && !typing ? <div style={{ fontSize: zh * 0.32, color: 'rgba(255,255,255,.75)', marginTop: 6, textAlign: left ? 'left' : 'right', opacity: m }}>{o.sub}</div> : null}
        </div>
      );
    }
    case 'badge': {
      const e = tween(t, 0, 0.45, 'back.out');
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: `translate(-50%, -50%) scale(${e})`, opacity: c.out * clamp01(e * 1.5), display: 'flex', alignItems: 'center', gap: zh * 0.2, padding: `${zh * 0.16}px ${zh * 0.36}px ${zh * 0.16}px ${zh * 0.2}px`, borderRadius: 999, background: '#fff', fontFamily: SANS, boxShadow: `0 12px 30px rgba(0,0,0,.3), 0 0 0 3px ${rgba(acc, 0.35)}` }}>
          <div style={{ width: zh * 0.62, height: zh * 0.62, borderRadius: '50%', background: acc, display: 'grid', placeItems: 'center', color: '#fff', fontSize: zh * 0.4, fontWeight: 900 }}>{o.sub || '✓'}</div>
          <span style={{ fontSize: zh * 0.5, fontWeight: 800, color: '#111', whiteSpace: 'nowrap' }}>{o.text}</span>
        </div>
      );
    }
    case 'check': {
      const r = (o.w ?? 0.07) * Math.min(W, H);
      const kc = tween(t, 0, 0.5, 'power2.out');
      const kk = tween(t, 0.4, 0.35, 'power3.out');
      const pulse = tween(t, 0.7, 0.25, 'power2.out');
      return (
        <div key={key} style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, opacity: c.out }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#3fcf8e', transform: `scale(${kk > 0 ? 1 + 0.06 * Math.sin(pulse * Math.PI) : 0.001})`, opacity: kk > 0 ? 1 : 0 }} />
          <svg width={r * 2} height={r * 2} viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <circle cx={50} cy={50} r={46} fill="none" stroke="#3fcf8e" strokeWidth={6} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - kc} transform="rotate(-90 50 50)" />
            <path d="M28 52 L44 67 L73 36" fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - kk} />
          </svg>
          {o.text ? <div style={{ position: 'absolute', top: r * 2 + zh * 0.25, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', color: '#fff', fontFamily: SANS, fontSize: zh * 0.6, fontWeight: 800, opacity: pulse, textShadow: '0 2px 12px rgba(0,0,0,.5)' }}>{o.text}</div> : null}
        </div>
      );
    }
    case 'stars': {
      const target = Math.max(0, Math.min(5, Number.parseFloat(o.text) || 5));
      const fill = tween(t, 0.2, 1.1, 'power2.out') * target;
      const s = zh * 0.95;
      const id = `st${key}`;
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%, -50%)', opacity: c.out * tween(t, 0, 0.3), textAlign: 'center', fontFamily: SANS }}>
          <svg width={s * 5.6} height={s}>
            <defs>
              <clipPath id={id}>
                <rect x={0} y={0} width={(fill / 5) * s * 5.6} height={s} />
              </clipPath>
            </defs>
            {Array.from({ length: 5 }, (_, i) => (
              <polygon key={i} points={star(s * (0.5 + i * 1.15), s / 2, s / 2)} fill="rgba(255,255,255,.22)" />
            ))}
            <g clipPath={`url(#${id})`}>
              {Array.from({ length: 5 }, (_, i) => (
                <polygon key={i} points={star(s * (0.5 + i * 1.15), s / 2, s / 2)} fill="#ffc83d" />
              ))}
            </g>
          </svg>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: zh * 0.85, marginTop: 6, textShadow: '0 2px 12px rgba(0,0,0,.5)' }}>
            {fill.toFixed(1)}
            {o.sub ? <span style={{ fontWeight: 600, fontSize: '0.55em', marginLeft: 12, opacity: 0.85 }}>{o.sub}</span> : null}
          </div>
        </div>
      );
    }
    case 'ring': {
      const pct = Math.max(0, Math.min(100, Number.parseFloat(o.text) || 75));
      const kk = tween(t, 0.15, 1.3, 'power3.out');
      const r = (o.w ?? 0.09) * Math.min(W, H);
      return (
        <div key={key} style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, opacity: c.out * tween(t, 0, 0.25), fontFamily: SANS }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(${acc} ${pct * kk * 3.6}deg, rgba(255,255,255,.14) 0)`, WebkitMaskImage: `radial-gradient(circle, transparent ${r * 0.74}px, #000 ${r * 0.76}px)`, maskImage: `radial-gradient(circle, transparent ${r * 0.74}px, #000 ${r * 0.76}px)` }} />
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: r * 0.5 }}>{Math.round(pct * kk)}%</div>
          {o.sub ? <div style={{ position: 'absolute', top: r * 2 + 10, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', color: 'rgba(255,255,255,.88)', fontWeight: 700, fontSize: zh * 0.5 }}>{o.sub}</div> : null}
        </div>
      );
    }
    case 'counter':
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: 'translate(-50%, -50%)', textAlign: 'center', fontFamily: SANS, opacity: c.out }}>
          <AnimText text={o.text || '1,000+'} anim="count" t={t} hi={hiOf(c)} color={acc} style={{ fontSize: zh * 2.2 * (o.size ?? 1), fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }} />
          {o.sub ? <div style={{ color: '#fff', fontWeight: 700, fontSize: zh * 0.6, marginTop: zh * 0.2, opacity: tween(t, 0.3, 0.4), textShadow: '0 2px 12px rgba(0,0,0,.5)' }}>{o.sub}</div> : null}
        </div>
      );
    case 'progress': {
      const pct = Math.max(0, Math.min(100, Number.parseFloat(o.sub ?? '') || 72));
      const kk = tween(t, 0.2, 1.2, 'power3.out');
      const bw = (o.w ?? 0.36) * W;
      return (
        <div key={key} style={{ position: 'absolute', left: cx - bw / 2, top: cy, width: bw, fontFamily: SANS, opacity: c.out * tween(t, 0, 0.3) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 800, fontSize: zh * 0.55, marginBottom: 10, textShadow: '0 2px 10px rgba(0,0,0,.5)' }}>
            <span>{o.text}</span>
            <span style={{ color: acc, fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct * kk)}%</span>
          </div>
          <div style={{ height: zh * 0.3, borderRadius: 999, background: 'rgba(255,255,255,.16)', overflow: 'hidden' }}>
            <div style={{ width: `${pct * kk}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${rgba(acc, 0.7)}, ${acc})`, boxShadow: `0 0 18px ${rgba(acc, 0.6)}` }} />
          </div>
        </div>
      );
    }
    case 'bars': {
      const items = (o.text || 'A:30,B:55,C:80').split(/[,，]/).map((s) => {
        const [l, v] = s.split(/[:：]/);
        return { l: l?.trim() ?? '', v: Number(v) || 0 };
      });
      const max = Math.max(1, ...items.map((i) => i.v));
      const bw = (o.w ?? 0.34) * W;
      const bh = (o.h ?? 0.3) * H;
      return (
        <div key={key} style={{ position: 'absolute', left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh, display: 'flex', alignItems: 'flex-end', gap: bw * 0.04, fontFamily: SANS, opacity: c.out }}>
          {items.map((it, i) => {
            const kk = tween(t, 0.15 + i * 0.12, 0.8, 'power3.out');
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: zh * 0.48, marginBottom: 6, opacity: kk, fontVariantNumeric: 'tabular-nums' }}>{Math.round(it.v * kk)}</div>
                <div style={{ width: '100%', height: `${(it.v / max) * 78 * kk}%`, borderRadius: '8px 8px 2px 2px', background: i === items.length - 1 ? acc : rgba(acc, 0.45) }} />
                <div style={{ color: 'rgba(255,255,255,.85)', fontWeight: 700, fontSize: zh * 0.42, marginTop: 8, whiteSpace: 'nowrap' }}>{it.l}</div>
              </div>
            );
          })}
        </div>
      );
    }
    case 'confetti':
      return <React.Fragment key={key}>{confetti(c)}</React.Fragment>;
    case 'sweep': {
      const p = tween(t, 0, Math.min(1.1, c.d * 0.8), 'power2.inOut');
      const x = -30 + p * 160;
      return <AbsoluteFill key={key} style={{ opacity: c.out, mixBlendMode: 'screen', background: `linear-gradient(105deg, transparent ${x - 14}%, rgba(255,255,255,.08) ${x - 6}%, rgba(255,255,255,.55) ${x}%, rgba(255,255,255,.08) ${x + 6}%, transparent ${x + 14}%)` }} />;
    }
    case 'scan': {
      const p = ((t / 1.6) % 1) * 120 - 10;
      return (
        <AbsoluteFill key={key} style={{ opacity: c.out }}>
          <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent ${p - 12}%, ${rgba(acc, 0.18)} ${p - 1}%, ${rgba(acc, 0.9)} ${p}%, transparent ${p + 0.6}%)` }} />
          <AbsoluteFill style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,.08) 0 2px, transparent 2px 5px)' }} />
        </AbsoluteFill>
      );
    }
    case 'flash': {
      const a = t < 0.05 ? t / 0.05 : Math.max(0, 1 - (t - 0.05) / 0.35);
      return <AbsoluteFill key={key} style={{ background: o.color ?? '#fff', opacity: a * 0.9 * c.out }} />;
    }
    case 'quote': {
      const e = tween(t, 0, 0.6, 'power3.out');
      const qw = tall ? W * 0.84 : W * 0.56;
      return (
        <div key={key} style={{ position: 'absolute', left: cx - qw / 2, top: cy, transform: `translateY(-50%) translateY(${(1 - e) * 30}px)`, width: qw, opacity: c.out * e, fontFamily: SANS, padding: `${zh * 0.6}px ${zh * 0.7}px`, borderRadius: 24, background: 'rgba(255,255,255,.95)', boxShadow: '0 30px 80px rgba(0,0,0,.4)' }}>
          <div style={{ fontSize: zh * 2, lineHeight: 0.6, color: acc, fontWeight: 900, height: zh * 0.8 }}>“</div>
          <div style={{ fontSize: zh * 0.72, fontWeight: 700, color: '#15171c', lineHeight: 1.45 }}>
            <AnimText text={o.text} anim="fadeup" t={t - 0.2} hi={acc} color="#15171c" />
          </div>
          {o.sub ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: zh * 0.45, opacity: tween(t, 0.8, 0.4) }}>
              <div style={{ width: zh * 0.8, height: zh * 0.8, borderRadius: '50%', background: `linear-gradient(135deg, ${acc}, ${rgba(acc, 0.5)})` }} />
              <div style={{ fontSize: zh * 0.46, fontWeight: 700, color: '#444' }}>{o.sub}</div>
            </div>
          ) : null}
        </div>
      );
    }
    case 'comment': {
      const e = tween(t, 0, 0.5, 'power3.out');
      const likes = Math.round(tween(t, 0.4, 1.2, 'power2.out') * (o.value ?? 1280));
      const cw = tall ? W * 0.84 : W * 0.44;
      return (
        <div key={key} style={{ position: 'absolute', left: cx - cw / 2, top: cy, width: cw, transform: `translateY(-50%) translateY(${(1 - e) * 26}px)`, opacity: c.out * e, display: 'flex', gap: zh * 0.3, padding: zh * 0.4, borderRadius: 18, background: 'rgba(22,24,30,.94)', border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 24px 60px rgba(0,0,0,.45)', fontFamily: SANS }}>
          <div style={{ width: zh * 0.95, height: zh * 0.95, borderRadius: '50%', flex: 'none', background: `linear-gradient(135deg, ${acc}, #ff8a5c)`, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: zh * 0.45 }}>{(o.sub || 'U').slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: zh * 0.42, fontWeight: 800, color: 'rgba(255,255,255,.7)' }}>@{o.sub || 'viewer'}</div>
            <div style={{ fontSize: zh * 0.56, fontWeight: 600, color: '#fff', marginTop: 4, lineHeight: 1.4 }}>{o.text}</div>
            <div style={{ fontSize: zh * 0.4, color: 'rgba(255,255,255,.6)', marginTop: 8 }}>♥ {likes.toLocaleString('en-US')}</div>
          </div>
        </div>
      );
    }
    case 'prompt': {
      const e = tween(t, 0, 0.45, 'power3.out');
      const chars = Array.from(o.text);
      const n = Math.min(chars.length, Math.floor(Math.max(0, t - 0.4) / 0.045));
      const done = n >= chars.length;
      const sent = done ? tween(t, 0.4 + chars.length * 0.045 + 0.25, 0.25, 'power2.out') : 0;
      const pw = tall ? W * 0.86 : W * 0.5;
      return (
        <div key={key} style={{ position: 'absolute', left: cx - pw / 2, top: cy, width: pw, transform: `translateY(-50%) translateY(${(1 - e) * 24}px) scale(${1 - 0.02 * sent})`, opacity: c.out * e, fontFamily: SANS, padding: `${zh * 0.36}px ${zh * 0.4}px`, borderRadius: 22, background: 'rgba(24,26,32,.95)', border: `1px solid ${rgba(acc, 0.35 + 0.4 * sent)}`, boxShadow: `0 24px 70px rgba(0,0,0,.5), 0 0 ${30 * sent}px ${rgba(acc, 0.5)}` }}>
          <div style={{ fontSize: zh * 0.6, fontWeight: 600, color: '#fff', minHeight: zh * 0.9, lineHeight: 1.45 }}>
            {chars.slice(0, n).join('')}
            {!done || Math.floor(t / 0.3) % 2 ? <span style={{ display: 'inline-block', width: 3, height: zh * 0.62, background: acc, marginLeft: 3, verticalAlign: 'middle' }} /> : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: zh * 0.25 }}>
            <span style={{ fontSize: zh * 0.38, color: 'rgba(255,255,255,.45)' }}>{o.sub ?? ''}</span>
            <div style={{ width: zh * 0.8, height: zh * 0.8, borderRadius: '50%', background: done ? acc : 'rgba(255,255,255,.15)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: zh * 0.45, fontWeight: 900, transform: `scale(${1 + 0.15 * Math.sin(sent * Math.PI)})` }}>↑</div>
          </div>
        </div>
      );
    }
    case 'terminal': {
      const e = tween(t, 0, 0.4, 'power3.out');
      const cmd = o.text || 'npm run render';
      const out = (o.sub ?? '').split('\n').filter(Boolean);
      const tw = tall ? W * 0.88 : W * 0.52;
      const typed = Math.min(cmd.length, Math.floor(Math.max(0, t - 0.35) / 0.05));
      const outStart = 0.35 + cmd.length * 0.05 + 0.25;
      return (
        <div key={key} style={{ position: 'absolute', left: cx - tw / 2, top: cy, width: tw, transform: `translateY(-50%) translateY(${(1 - e) * 24}px)`, opacity: c.out * e, borderRadius: 16, overflow: 'hidden', background: '#0e1014', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 30px 80px rgba(0,0,0,.55)', fontFamily: MONO }}>
          <div style={{ height: zh * 0.7, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: '#1a1d23' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((col) => (
              <div key={col} style={{ width: 13, height: 13, borderRadius: '50%', background: col }} />
            ))}
          </div>
          <div style={{ padding: `${zh * 0.3}px ${zh * 0.4}px ${zh * 0.4}px`, fontSize: zh * 0.48, lineHeight: 1.6, color: '#e6e6e6' }}>
            <div>
              <span style={{ color: '#3fcf8e' }}>❯ </span>
              {codeLine(cmd.slice(0, typed), acc)}
              {typed < cmd.length || Math.floor(t / 0.3) % 2 ? <span style={{ display: 'inline-block', width: '0.55em', height: '1.05em', background: 'rgba(255,255,255,.75)', verticalAlign: '-0.15em', marginLeft: 2 }} /> : null}
            </div>
            {out.map((l, i) => (
              <div key={i} style={{ color: 'rgba(230,230,230,.72)', opacity: t >= outStart + i * 0.18 ? 1 : 0 }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'bigword': {
      const e = tween(t, 0, 1, 'power2.out');
      const drift = (t / Math.max(1, c.d)) * W * 0.05;
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: `translate(-50%, -50%) translateX(${drift}px)`, fontFamily: SANS, fontSize: H * 0.42, fontWeight: 900, color: '#fff', opacity: 0.13 * e * c.out, whiteSpace: 'nowrap', letterSpacing: '-0.04em' }}>
          {o.text}
        </div>
      );
    }
  }
  if (o.kind === 'lower' && o.style) return <React.Fragment key={key}>{lowerThird(c)}</React.Fragment>;
  return null;
}

// Interpolate helper kept local so callers don't need remotion imports
export const fadeEnvelope = (age: number, d: number) => interpolate(age, [d - 8, d], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
export { EASE };
