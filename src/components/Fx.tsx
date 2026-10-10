import React, { useId } from 'react';
import { AbsoluteFill, Easing, Freeze, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide, type SlideDirection } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { iris } from '@remotion/transitions/iris';
import { pushCut } from '@remotion/transitions/push-cut';
import type { Dir, Fx, Look, Transition } from '../lib/types';
import { extraPresentation } from '../fx/transitions';
import { FxOverlays, NEW_FX_KEYS, fxFilter, fxMotion } from '../fx/scenefx';
import { EASE, clamp01 } from '../fx/ease';

// Color looks as CSS filter chains
export const LOOKS: Record<Look, string> = {
  warm: 'sepia(.18) saturate(1.15) hue-rotate(-8deg) brightness(1.03)',
  cool: 'saturate(.92) hue-rotate(14deg) brightness(1.02) contrast(1.04)',
  mono: 'grayscale(1) contrast(1.08)',
  vintage: 'sepia(.45) contrast(.92) saturate(.85) brightness(1.05)',
  vivid: 'saturate(1.45) contrast(1.08)',
  fade: 'contrast(.85) brightness(1.08) saturate(.8)',
  noir: 'grayscale(1) contrast(1.45) brightness(.9)',
  teal: 'hue-rotate(-12deg) saturate(1.25) contrast(1.06)',
};

const VISUAL_KEYS: (keyof Fx)[] = ['look', 'brightness', 'contrast', 'saturate', 'hue', 'blur', 'vignette', 'grain', 'leak', 'letterbox', 'kenburns', 'motionBlur', 'fadeIn', 'fadeOut', 'shake', 'dim', ...NEW_FX_KEYS];
export const hasVisualFx = (fx?: Fx) => !!fx && VISUAL_KEYS.some((k) => fx[k] !== undefined && fx[k] !== false && fx[k] !== 0);

export function filterOf(fx: Fx): string | undefined {
  const p: string[] = [];
  if (fx.look) p.push(LOOKS[fx.look]);
  if (fx.brightness !== undefined && fx.brightness !== 1) p.push(`brightness(${fx.brightness})`);
  if (fx.contrast !== undefined && fx.contrast !== 1) p.push(`contrast(${fx.contrast})`);
  if (fx.saturate !== undefined && fx.saturate !== 1) p.push(`saturate(${fx.saturate})`);
  if (fx.hue) p.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.blur) p.push(`blur(${fx.blur}px)`);
  return p.length ? p.join(' ') : undefined;
}

// Slow zoom / pan over the scene
function kenBurns(fx: Fx, f: number, dur: number): string | undefined {
  if (!fx.kenburns) return undefined;
  const amt = fx.kbAmount ?? 0.12;
  const p = interpolate(f, [0, Math.max(1, dur)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  const s = 1 + amt;
  const t = ((s - 1) / (2 * s)) * 100;
  switch (fx.kenburns) {
    case 'in':
      return `scale(${1 + amt * p})`;
    case 'out':
      return `scale(${1 + amt * (1 - p)})`;
    case 'left':
      return `scale(${s}) translateX(${t - 2 * t * p}%)`;
    case 'right':
      return `scale(${s}) translateX(${-t + 2 * t * p}%)`;
    case 'up':
      return `scale(${s}) translateY(${t - 2 * t * p}%)`;
    case 'down':
      return `scale(${s}) translateY(${-t + 2 * t * p}%)`;
    case 'reveal':
      // Pull-back reveal: starts tight, eases out to the full frame
      return `scale(${1 + Math.max(amt, 0.2) * 2 * (1 - EASE['expo.out'](clamp01(f / 72)))})`;
  }
}

function Grain({ amount }: { amount: number }) {
  const f = useCurrentFrame();
  const id = useId().replace(/:/g, '');
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: Math.min(1, amount) * 0.45, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <filter id={`g${id}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={f % 97} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#g${id})`} />
    </svg>
  );
}

// Effects around one scene's visual; no fx = the children untouched
export const FxLayer: React.FC<{ fx?: Fx; dur: number; children: React.ReactNode }> = ({ fx, dur, children }) => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const sid = `sf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!fx || !hasVisualFx(fx)) return <>{children}</>;
  const t = f / fps;
  const svg = fxFilter(sid, fx, t);
  const mo = fxMotion(fx, t);
  const filter = [filterOf(fx), mo.blur ? `blur(${mo.blur.toFixed(2)}px)` : '', svg ? `url(#${sid})` : ''].filter(Boolean).join(' ') || undefined;
  const kb = kenBurns(fx, f, dur);
  const sh = fx.shake ? fx.shake * 14 : 0;
  const shake = sh ? `translate(${(random(`x${f}`) - 0.5) * sh}px, ${(random(`y${f}`) - 0.5) * sh}px)` : '';
  const transform = [shake, mo.transform, kb].filter(Boolean).join(' ') || undefined;
  // Stop-motion cadence: hold each picture for several frames
  const hold = fx.stepped ? Math.max(1, Math.round(fps / Number(fx.stepped))) : 1;
  const inner = hold > 1 ? <Freeze frame={Math.floor(f / hold) * hold}>{children}</Freeze> : children;
  let body = (
    <AbsoluteFill style={{ filter, transform, transformOrigin: 'center' }}>
      {svg}
      {inner}
    </AbsoluteFill>
  );
  if (fx.motionBlur) body = <CameraMotionBlur shutterAngle={180} samples={6}>{body}</CameraMotionBlur>;
  const fin = fx.fadeIn ? interpolate(f, [0, fx.fadeIn * fps], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const fout = fx.fadeOut ? interpolate(f, [dur - fx.fadeOut * fps, dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const lb = Math.min(0.25, fx.letterbox ?? 0) * height;
  const leakX = interpolate(f, [0, Math.max(1, dur)], [-25, 125]);
  return (
    <AbsoluteFill>
      {body}
      {fx.vignette ? <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${Math.min(1, fx.vignette) * 0.85}) 100%)`, pointerEvents: 'none' }} /> : null}
      {fx.grain ? <Grain amount={fx.grain} /> : null}
      {fx.leak ? <AbsoluteFill style={{ background: `radial-gradient(40% 60% at ${leakX}% 35%, rgba(255,168,84,${Math.min(1, fx.leak) * 0.6}), rgba(255,90,60,0) 70%)`, mixBlendMode: 'screen', pointerEvents: 'none' }} /> : null}
      {lb ? (
        <>
          <div style={{ position: 'absolute', left: 0, top: 0, width, height: lb, background: '#000' }} />
          <div style={{ position: 'absolute', left: 0, bottom: 0, width, height: lb, background: '#000' }} />
        </>
      ) : null}
      <FxOverlays fx={fx} t={t} />
      {fx.dim ? <AbsoluteFill style={{ background: '#000', opacity: Math.min(0.9, fx.dim) }} /> : null}
      {fin || fout ? <AbsoluteFill style={{ background: '#000', opacity: Math.max(fin, fout) }} /> : null}
    </AbsoluteFill>
  );
};

// ---- transitions ----
type Empty = Record<string, never>;
const ZoomT: React.FC<TransitionPresentationComponentProps<Empty>> = ({ children, presentationDirection, presentationProgress: p }) => (
  <AbsoluteFill style={presentationDirection === 'exiting' ? { transform: `scale(${1 + 0.25 * p})`, opacity: 1 - p } : { transform: `scale(${0.86 + 0.14 * p})`, opacity: p }}>{children}</AbsoluteFill>
);
// Dip to black: down in 0.15 s, 2 frames of pure black, up over the rest (video playbook L2 cut)
const DipT: React.FC<TransitionPresentationComponentProps<Empty>> = ({ children, presentationDirection, presentationProgress: p, presentationDurationInFrames: n }) => {
  const { fps } = useVideoConfig();
  const down = Math.min(0.45, (0.15 * fps) / Math.max(1, n));
  const hold = Math.min(0.2, 2 / Math.max(1, n));
  if (presentationDirection === 'exiting')
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <AbsoluteFill style={{ opacity: 1 - Math.min(1, p / down) }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    );
  return <AbsoluteFill style={{ opacity: Math.max(0, (p - down - hold) / Math.max(0.01, 1 - down - hold)) }}>{children}</AbsoluteFill>;
};
const zoomT = (): TransitionPresentation<Empty> => ({ component: ZoomT, props: {} });
const dipT = (): TransitionPresentation<Empty> => ({ component: DipT, props: {} });

const from = (d: Dir): SlideDirection => (d === 'left' ? 'from-left' : d === 'right' ? 'from-right' : d === 'up' ? 'from-top' : 'from-bottom');

type AnyPresentation = TransitionPresentation<Record<string, unknown>>;
// Defaults match the original look: slide from the right, wipe from the left, everything else fades
export function presentation(t: Transition | undefined, dir: Dir | undefined, width: number, height: number): AnyPresentation {
  const p = (() => {
    switch (t) {
      case 'slide':
        return slide({ direction: dir ? from(dir) : 'from-right' });
      case 'wipe':
        return wipe({ direction: dir ? from(dir) : 'from-left' });
      case 'flip':
        return flip({ direction: dir ? from(dir) : 'from-right' });
      case 'clock':
        return clockWipe({ width, height });
      case 'iris':
        return iris({ width, height });
      case 'push':
        return pushCut();
      case 'zoom':
        return zoomT();
      case 'dip':
        return dipT();
      default:
        return (t ? extraPresentation(t, dir, width, height) : null) ?? fade();
    }
  })();
  return p as unknown as AnyPresentation;
}
