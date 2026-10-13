import React, { useContext, useId } from 'react';
import { AbsoluteFill } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import type { Dir } from '../lib/types';
import { EASE, clamp01, hash } from './ease';
import { IdleContext } from '../components/Cuts';

// Extra transitions ported from HyperFrames (transitions-* blocks and transition primitives).
// Each one wraps the scene it is given; nothing is rendered twice, so scene audio is never doubled.

type P = {
  dir?: Dir;
  W: number;
  H: number;
};
type Props = TransitionPresentationComponentProps<P>;

const io = EASE['power2.inOut'];
const sign = (d?: Dir) => (d === 'left' || d === 'up' ? -1 : 1);
const vertical = (d?: Dir) => d === 'up' || d === 'down';
const fid = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '');
// Seen side of a hard cut at the midpoint
const half = (enter: boolean, p: number) => (enter ? (p >= 0.5 ? 1 : 0) : p < 0.5 ? 1 : 0);
const bump = (p: number) => Math.sin(Math.PI * clamp01(p));

// Outside its transition the wrapper stays mounted but changes nothing
const Fill: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => <AbsoluteFill style={useContext(IdleContext) ? undefined : style}>{children}</AbsoluteFill>;

const Blur: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const k = d === 'exiting' ? p : 1 - p;
  return <Fill style={{ opacity: d === 'exiting' ? 1 - io(p) : io(p), filter: `blur(${k * 28}px)` }}>{children}</Fill>;
};

const ZoomBlur: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const e = io(p);
  return d === 'exiting' ? <Fill style={{ transform: `scale(${1 + 0.35 * e})`, filter: `blur(${e * 22}px)`, opacity: 1 - e }}>{children}</Fill> : <Fill style={{ transform: `scale(${1.25 - 0.25 * e})`, filter: `blur(${(1 - e) * 22}px)`, opacity: e }}>{children}</Fill>;
};

// Motion-blurred slide: SVG gaussian blur along one axis only
const Whip: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const id = fid(useId());
  const e = EASE['power3.inOut'](p);
  const s = sign(passedProps.dir);
  const v = vertical(passedProps.dir);
  const off = d === 'exiting' ? -e * 100 * s : (1 - e) * 100 * s;
  const amt = bump(p) * 70;
  return (
    <Fill style={{ transform: v ? `translateY(${off}%)` : `translateX(${off}%)`, filter: amt > 0.5 ? `url(#w${id})` : undefined }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={`w${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={v ? `0 ${amt}` : `${amt} 0`} />
        </filter>
      </svg>
      {children}
    </Fill>
  );
};

const Flash: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => (
  <Fill style={{ opacity: half(d === 'entering', p) }}>
    {children}
    {useContext(IdleContext) ? null : <AbsoluteFill style={{ background: '#fff', opacity: Math.pow(bump(p), 1.6), filter: 'blur(0px)' }} />}
  </Fill>
);

const Leak: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const x = -30 + p * 160;
  return (
    <Fill style={{ opacity: d === 'exiting' ? 1 : io(p) }}>
      {children}
      {d === 'entering' && !useContext(IdleContext) ? (
        <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: Math.min(1, bump(p) * 1.3), background: `radial-gradient(55% 90% at ${x}% 40%, rgba(255,214,140,1), rgba(255,120,60,.8) 40%, rgba(255,60,40,0) 75%), radial-gradient(35% 60% at ${x - 28}% 70%, rgba(255,240,190,.9), rgba(255,200,120,0) 70%)` }} />
      ) : null}
    </Fill>
  );
};

// RGB channels pulled apart: one SVG filter, no duplicated layers
const chromaFilter = (id: string, dx: number, dy = 0) => (
  <svg width={0} height={0} style={{ position: 'absolute' }}>
    <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
      <feOffset in="r" dx={dx} dy={dy} result="ro" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
      <feOffset in="b" dx={-dx} dy={-dy} result="bo" />
      <feBlend in="ro" in2="g" mode="screen" result="rg" />
      <feBlend in="rg" in2="bo" mode="screen" />
    </filter>
  </svg>
);

const Chroma: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const id = `c${fid(useId())}`;
  const amt = bump(p) * 34;
  return (
    <Fill style={{ opacity: d === 'exiting' ? 1 - io(p) : io(p), filter: amt > 0.5 ? `url(#${id})` : undefined, transform: `scale(${1 + bump(p) * 0.03})` }}>
      {chromaFilter(id, amt)}
      {children}
    </Fill>
  );
};

const Glitch: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, presentationDurationInFrames: n }) => {
  const id = `g${fid(useId())}`;
  const fr = Math.floor(p * n);
  const on = p > 0.2 && p < 0.8;
  const j = on ? (hash(fr, 1) - 0.5) * 2 : 0;
  const bars = on
    ? Array.from({ length: 5 }, (_, i) => ({ y: hash(fr, i, 2) * 100, h: 2 + hash(fr, i, 3) * 9, x: (hash(fr, i, 4) - 0.5) * 12 }))
    : [];
  return (
    <Fill style={{ opacity: half(d === 'entering', p), transform: `translateX(${j * 2.4}%)`, filter: on ? `url(#${id})` : undefined }}>
      {chromaFilter(id, 18 * j, 4 * j)}
      {children}
      {bars.map((b, i) => (
        <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${b.y}%`, height: `${b.h}%`, backdropFilter: 'hue-rotate(90deg) saturate(2)', transform: `translateX(${b.x}%)`, background: i % 2 ? 'rgba(255,0,90,.12)' : 'rgba(0,240,255,.1)' }} />
      ))}
    </Fill>
  );
};

// Mosaic: tiles grow to the midpoint, then shrink on the new scene
const Pixel: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const id = `p${fid(useId())}`;
  const size = Math.max(1, Math.round(bump(p) * 56));
  const dot = Math.max(2, Math.round(size / 4));
  return (
    <Fill style={{ opacity: d === 'exiting' ? (p < 0.5 ? 1 : 1 - (p - 0.5) * 8) : clamp01((p - 0.45) * 10), filter: size > 1 ? `url(#${id})` : undefined }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={id} x="0" y="0" width="100%" height="100%">
          <feFlood x={size / 2 - dot / 2} y={size / 2 - dot / 2} width={dot} height={dot} />
          <feComposite width={size} height={size} />
          <feTile result="a" />
          <feComposite in="SourceGraphic" in2="a" operator="in" />
          <feMorphology operator="dilate" radius={(size - dot) / 2} />
        </filter>
      </svg>
      {children}
    </Fill>
  );
};

// Entering scene shown through a set of growing rects (SVG clipPath in 0..1 box units)
const ClipRects: React.FC<{ rects: { x: number; y: number; w: number; h: number }[]; children: React.ReactNode }> = ({ rects, children }) => {
  const id = `r${fid(useId())}`;
  return (
    <Fill style={{ clipPath: `url(#${id})` }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <clipPath id={id} clipPathUnits="objectBoundingBox">
          {rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={Math.max(0, r.w)} height={Math.max(0, r.h)} />
          ))}
        </clipPath>
      </svg>
      {children}
    </Fill>
  );
};

const Grid: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  if (d === 'exiting') return <Fill>{children}</Fill>;
  if (p >= 0.999) return <Fill>{children}</Fill>;
  const C = 12;
  const R = 7;
  const rects = [];
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const k = EASE['power2.out'](clamp01((p - ((c + r) / (C + R - 2)) * 0.6) / 0.4));
      const w = (1 / C) * k;
      const h = (1 / R) * k;
      rects.push({ x: (c + 0.5) / C - w / 2 - 0.0005, y: (r + 0.5) / R - h / 2 - 0.0005, w: w + 0.001, h: h + 0.001 });
    }
  return <ClipRects rects={rects}>{children}</ClipRects>;
};

const Strips: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  if (d === 'exiting' || p >= 0.999) return <Fill>{children}</Fill>;
  const N = 10;
  const v = vertical(passedProps.dir);
  const rects = Array.from({ length: N }, (_, i) => {
    const k = EASE['power3.out'](clamp01((p - (i / N) * 0.45) / 0.55));
    return v ? { x: 0, y: i / N, w: k, h: 1 / N + 0.001 } : { x: i / N, y: 0, w: 1 / N + 0.001, h: k };
  });
  return <ClipRects rects={rects}>{children}</ClipRects>;
};

const Blinds: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  if (d === 'exiting' || p >= 0.999) return <Fill>{children}</Fill>;
  const k = io(p) * 100;
  const ang = vertical(passedProps.dir) ? 180 : 90;
  const m = `repeating-linear-gradient(${ang}deg, #000 0 ${k / 10}%, transparent ${k / 10}% 10%)`;
  return <Fill style={{ WebkitMaskImage: m, maskImage: m }}>{children}</Fill>;
};

const Shutter: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const c = EASE['power3.inOut'](clamp01((0.5 - Math.abs(p - 0.5)) / 0.32));
  const v = !vertical(passedProps.dir);
  return (
    <Fill style={{ opacity: half(d === 'entering', p) }}>
      {children}
      {d === 'entering' || p < 0.5 ? (
        <>
          <div style={{ position: 'absolute', left: 0, top: 0, background: '#07080a', ...(v ? { right: 0, height: `${c * 50}%` } : { bottom: 0, width: `${c * 50}%` }), boxShadow: '0 0 40px rgba(0,0,0,.6)' }} />
          <div style={{ position: 'absolute', right: 0, bottom: 0, background: '#07080a', ...(v ? { left: 0, height: `${c * 50}%` } : { top: 0, width: `${c * 50}%` }), boxShadow: '0 0 40px rgba(0,0,0,.6)' }} />
        </>
      ) : null}
    </Fill>
  );
};

const Barn: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  if (d === 'exiting') return <Fill>{children}</Fill>;
  const k = (1 - EASE['power3.inOut'](p)) * 50;
  return <Fill style={{ clipPath: vertical(passedProps.dir) ? `inset(${k}% 0 ${k}% 0)` : `inset(0 ${k}% 0 ${k}%)` }}>{children}</Fill>;
};

const Diamond: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  if (d === 'exiting') return <Fill>{children}</Fill>;
  const r = EASE['power2.inOut'](p) * 100;
  return <Fill style={{ clipPath: `polygon(50% ${50 - r}%, ${50 + r}% 50%, 50% ${50 + r}%, ${50 - r}% 50%)` }}>{children}</Fill>;
};

const Cover: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const e = EASE['power3.inOut'](p);
  const s = sign(passedProps.dir);
  const v = vertical(passedProps.dir);
  if (d === 'exiting') return <Fill style={{ filter: `brightness(${1 - 0.35 * e})`, transform: `scale(${1 - 0.04 * e})` }}>{children}</Fill>;
  const off = (1 - e) * 100 * -s;
  return <Fill style={{ transform: v ? `translateY(${off}%)` : `translateX(${off}%)`, boxShadow: '0 0 80px rgba(0,0,0,.55)' }}>{children}</Fill>;
};

// Old scene slides away; the new one is revealed where it has gone
const Uncover: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const e = EASE['power3.inOut'](p);
  const s = sign(passedProps.dir);
  const v = vertical(passedProps.dir);
  if (d === 'exiting') return <Fill style={{ transform: v ? `translateY(${e * 100 * s}%)` : `translateX(${e * 100 * s}%)` }}>{children}</Fill>;
  const r = (1 - e) * 100;
  const clip = v ? (s > 0 ? `inset(0 0 ${r}% 0)` : `inset(${r}% 0 0 0)`) : s > 0 ? `inset(0 ${r}% 0 0)` : `inset(0 0 0 ${r}%)`;
  return <Fill style={{ clipPath: clip, filter: `brightness(${0.7 + 0.3 * e})` }}>{children}</Fill>;
};

// Material shared axis: short travel, fade out early, fade in late
const Axis: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const s = sign(passedProps.dir);
  const v = vertical(passedProps.dir);
  const e = EASE['power3.inOut'](p);
  if (d === 'exiting') {
    const off = -e * 30 * s;
    return <Fill style={{ opacity: 1 - clamp01(p / 0.35), transform: v ? `translateY(${off}%)` : `translateX(${off}%)` }}>{children}</Fill>;
  }
  const off = (1 - e) * 30 * s;
  return <Fill style={{ opacity: clamp01((p - 0.3) / 0.7), transform: v ? `translateY(${off}%)` : `translateX(${off}%)` }}>{children}</Fill>;
};

const AxisZ: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const e = EASE['power3.inOut'](p);
  return d === 'exiting' ? <Fill style={{ opacity: 1 - clamp01(p / 0.35), transform: `scale(${1 + 0.1 * e})` }}>{children}</Fill> : <Fill style={{ opacity: clamp01((p - 0.3) / 0.7), transform: `scale(${0.8 + 0.2 * e})` }}>{children}</Fill>;
};

const FadeThrough: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  if (d === 'exiting') return <Fill style={{ opacity: 1 - EASE['power2.in'](clamp01(p / 0.35)) }}>{children}</Fill>;
  const k = EASE['power3.out'](clamp01((p - 0.35) / 0.65));
  return <Fill style={{ opacity: k, transform: `scale(${0.92 + 0.08 * k})` }}>{children}</Fill>;
};

const Door: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const e = EASE['power2.inOut'](p);
  const s = sign(passedProps.dir) * -1;
  const P = passedProps.W * 1.6;
  return d === 'exiting' ? (
    <Fill style={{ transformOrigin: s > 0 ? '0% 50%' : '100% 50%', transform: `perspective(${P}px) rotateY(${-90 * e * s}deg)`, filter: `brightness(${1 - 0.5 * e})` }}>{children}</Fill>
  ) : (
    <Fill style={{ transformOrigin: s > 0 ? '100% 50%' : '0% 50%', transform: `perspective(${P}px) rotateY(${90 * (1 - e) * s}deg)`, filter: `brightness(${0.5 + 0.5 * e})` }}>{children}</Fill>
  );
};

// Faces of a cube turning about its centre, behind the screen
const Cube: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  const e = EASE['power2.inOut'](p);
  const v = vertical(passedProps.dir);
  const s = sign(passedProps.dir) * -1;
  const half = (v ? passedProps.H : passedProps.W) / 2;
  const P = Math.max(passedProps.W, passedProps.H) * 2.2;
  const ang = d === 'exiting' ? -90 * e * s : 90 * (1 - e) * s;
  const rot = v ? `rotateX(${-ang}deg)` : `rotateY(${ang}deg)`;
  return <Fill style={{ transform: `perspective(${P}px) translateZ(${-half}px) ${rot} translateZ(${half}px)`, filter: `brightness(${1 - 0.45 * Math.abs(ang) / 90})`, backfaceVisibility: 'hidden' }}>{children}</Fill>;
};

// New scene rises as a card and expands to full frame
const CardZoom: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const e = EASE['power3.inOut'](p);
  if (d === 'exiting') return <Fill style={{ transform: `scale(${1 - 0.08 * e})`, filter: `brightness(${1 - 0.5 * e}) blur(${e * 6}px)` }}>{children}</Fill>;
  const rise = EASE['power3.out'](clamp01(p / 0.45));
  const grow = EASE['power3.inOut'](clamp01((p - 0.35) / 0.65));
  const s = 0.55 + 0.45 * grow;
  return <Fill style={{ transform: `translateY(${(1 - rise) * 70}%) scale(${s})`, borderRadius: (1 - grow) * 36, overflow: 'hidden', boxShadow: `0 30px 90px rgba(0,0,0,${0.55 * (1 - grow)})` }}>{children}</Fill>;
};

const Warp: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const id = `d${fid(useId())}`;
  const amt = bump(p) * 90;
  return (
    <Fill style={{ opacity: d === 'exiting' ? 1 - io(p) : io(p), filter: amt > 1 ? `url(#${id})` : undefined }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves={2} seed={4} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={amt} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      {children}
    </Fill>
  );
};

// Noise-threshold dissolve; `burn` adds a glowing edge band
const Dissolve: React.FC<Props & { burn?: boolean }> = ({ children, presentationDirection: d, presentationProgress: p, burn }) => {
  const id = `n${fid(useId())}`;
  if (d === 'exiting' || p >= 0.995) return <Fill>{children}</Fill>;
  const th = 0.78 - p * 0.62;
  const slope = 14;
  return (
    <Fill style={{ filter: `url(#${id})` }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves={3} seed={7} result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="lum" />
          <feComponentTransfer in="lum" result="m1">
            <feFuncA type="linear" slope={slope} intercept={-slope * th} />
          </feComponentTransfer>
          <feComposite in="SourceGraphic" in2="m1" operator="in" result="shown" />
          {burn ? (
            <>
              <feComponentTransfer in="lum" result="m2">
                <feFuncA type="linear" slope={slope} intercept={-slope * (th - 0.06)} />
              </feComponentTransfer>
              <feComposite in="m2" in2="m1" operator="out" result="edge" />
              <feFlood floodColor="#ff8a2a" result="fire" />
              <feComposite in="fire" in2="edge" operator="in" result="glow0" />
              <feGaussianBlur in="glow0" stdDeviation="2.5" result="glow" />
              <feMerge>
                <feMergeNode in="shown" />
                <feMergeNode in="glow" />
                <feMergeNode in="glow0" />
              </feMerge>
            </>
          ) : null}
        </filter>
      </svg>
      {children}
    </Fill>
  );
};
const Burn: React.FC<Props> = (props) => <Dissolve {...props} burn />;

const Halftone: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  if (d === 'exiting' || p >= 0.995) return <Fill>{children}</Fill>;
  const r = p * 30;
  const m = `radial-gradient(circle, #000 ${r}px, transparent ${r + 1}px)`;
  return <Fill style={{ WebkitMaskImage: m, maskImage: m, WebkitMaskSize: '40px 40px', maskSize: '40px 40px', WebkitMaskPosition: 'center', maskPosition: 'center' }}>{children}</Fill>;
};

const Spin: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  const e = io(p);
  return d === 'exiting' ? <Fill style={{ transform: `rotate(${40 * e}deg) scale(${1 + 0.6 * e})`, filter: `blur(${e * 16}px)`, opacity: 1 - e }}>{children}</Fill> : <Fill style={{ transform: `rotate(${-40 * (1 - e)}deg) scale(${0.6 + 0.4 * e})`, filter: `blur(${(1 - e) * 16}px)`, opacity: e }}>{children}</Fill>;
};

const WipeSoft: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p, passedProps }) => {
  if (d === 'exiting' || p >= 0.995) return <Fill>{children}</Fill>;
  const e = io(p) * 130 - 15;
  const ang = { left: 270, right: 90, up: 0, down: 180 }[passedProps.dir ?? 'right'];
  const m = `linear-gradient(${ang}deg, #000 ${e - 15}%, transparent ${e + 15}%)`;
  return <Fill style={{ WebkitMaskImage: m, maskImage: m }}>{children}</Fill>;
};

const IrisSoft: React.FC<Props> = ({ children, presentationDirection: d, presentationProgress: p }) => {
  if (d === 'exiting' || p >= 0.995) return <Fill>{children}</Fill>;
  const r = io(p) * 85;
  const m = `radial-gradient(circle at 50% 50%, #000 ${r}%, transparent ${r + 12}%)`;
  return <Fill style={{ WebkitMaskImage: m, maskImage: m }}>{children}</Fill>;
};

const C: Record<string, React.FC<Props>> = {
  blur: Blur,
  zoomblur: ZoomBlur,
  whip: Whip,
  flash: Flash,
  leak: Leak,
  glitch: Glitch,
  chroma: Chroma,
  pixel: Pixel,
  grid: Grid,
  strips: Strips,
  blinds: Blinds,
  shutter: Shutter,
  barn: Barn,
  diamond: Diamond,
  cover: Cover,
  uncover: Uncover,
  axis: Axis,
  axisz: AxisZ,
  fadethrough: FadeThrough,
  door: Door,
  cube: Cube,
  cardzoom: CardZoom,
  warp: Warp,
  dissolve: Dissolve,
  burn: Burn,
  halftone: Halftone,
  spin: Spin,
  wipesoft: WipeSoft,
  irissoft: IrisSoft,
};

export const EXTRA_TRANSITIONS = Object.keys(C);

export function extraPresentation(t: string, dir: Dir | undefined, W: number, H: number): TransitionPresentation<P> | null {
  const comp = C[t];
  return comp ? { component: comp, props: { dir, W, H } } : null;
}
