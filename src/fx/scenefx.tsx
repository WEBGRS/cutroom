import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Fx } from '../lib/types';
import { clamp01, hash } from './ease';

// Scene effects ported from HyperFrames (chromatic-aberration-wipe, rgb-glitch, scan-band, ordered-dither/grade passes,
// drift-hold, focus-rack, stop-motion-cadence). One SVG filter chain per scene; absent fields add nothing.

export const DUOTONES: Record<string, [string, string]> = {
  ocean: ['#061a40', '#7fd8ff'],
  sunset: ['#2b0a3d', '#ffb26b'],
  mint: ['#062a26', '#b8ffd9'],
  rose: ['#2a0718', '#ffc2d4'],
  ink: ['#0b0b0f', '#f2efe6'],
};

export const NEW_FX_KEYS: (keyof Fx)[] = ['chroma', 'glitch', 'crt', 'duotone', 'bloom', 'pixelate', 'posterize', 'drift', 'focusIn', 'stepped'];

const hex = (c: string) => {
  const n = parseInt(c.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Glitch bursts: ~0.2 s of disturbance roughly every 1.4 s
export function glitchAt(t: number, amt: number) {
  const slot = Math.floor(t / 1.4);
  const local = t - slot * 1.4 - 0.3 - hash(slot, 9) * 0.6;
  const on = local > 0 && local < 0.2;
  const fr = Math.floor(t * 30);
  return on ? { on, dx: (hash(fr, 1) - 0.5) * 40 * amt, shift: (hash(fr, 2) - 0.5) * 3 * amt, fr } : { on: false, dx: 0, shift: 0, fr };
}

// Builds the filter primitives this fx needs; null when nothing applies at time t
export function fxFilter(id: string, fx: Fx, t: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let src = 'SourceGraphic';
  const step = (name: string) => {
    const out = `${name}${parts.length}`;
    return out;
  };
  if (fx.pixelate && fx.pixelate > 1) {
    const s = Math.round(fx.pixelate);
    const d = Math.max(2, Math.round(s / 4));
    const o = step('px');
    parts.push(
      <React.Fragment key="px">
        <feFlood x={s / 2 - d / 2} y={s / 2 - d / 2} width={d} height={d} result={`${o}f`} />
        <feComposite in={`${o}f`} width={s} height={s} result={`${o}c`} />
        <feTile in={`${o}c`} result={`${o}t`} />
        <feComposite in={src} in2={`${o}t`} operator="in" result={`${o}m`} />
        <feMorphology in={`${o}m`} operator="dilate" radius={(s - d) / 2} result={o} />
      </React.Fragment>,
    );
    src = o;
  }
  if (fx.posterize && fx.posterize >= 2) {
    const n = Math.round(fx.posterize);
    const table = Array.from({ length: n }, (_, i) => (i / (n - 1)).toFixed(3)).join(' ');
    const o = step('po');
    parts.push(
      <feComponentTransfer key="po" in={src} result={o}>
        <feFuncR type="discrete" tableValues={table} />
        <feFuncG type="discrete" tableValues={table} />
        <feFuncB type="discrete" tableValues={table} />
      </feComponentTransfer>,
    );
    src = o;
  }
  if (fx.duotone && DUOTONES[fx.duotone]) {
    const [a, b] = DUOTONES[fx.duotone].map(hex);
    const o = step('du');
    parts.push(
      <React.Fragment key="du">
        <feColorMatrix in={src} type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" result={`${o}g`} />
        <feComponentTransfer in={`${o}g`} result={o}>
          <feFuncR type="table" tableValues={`${a[0]} ${b[0]}`} />
          <feFuncG type="table" tableValues={`${a[1]} ${b[1]}`} />
          <feFuncB type="table" tableValues={`${a[2]} ${b[2]}`} />
        </feComponentTransfer>
      </React.Fragment>,
    );
    src = o;
  }
  const g = fx.glitch ? glitchAt(t, fx.glitch) : null;
  const chroma = (fx.chroma ?? 0) * 14 + (g?.on ? Math.abs(g.dx) : 0);
  if (chroma > 0.3) {
    const o = step('ch');
    const dx = g?.on ? g.dx || chroma : chroma;
    parts.push(
      <React.Fragment key="ch">
        <feColorMatrix in={src} type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result={`${o}r`} />
        <feOffset in={`${o}r`} dx={dx} result={`${o}ro`} />
        <feColorMatrix in={src} type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result={`${o}g`} />
        <feColorMatrix in={src} type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result={`${o}b`} />
        <feOffset in={`${o}b`} dx={-dx} result={`${o}bo`} />
        <feBlend in={`${o}ro`} in2={`${o}g`} mode="screen" result={`${o}rg`} />
        <feBlend in={`${o}rg`} in2={`${o}bo`} mode="screen" result={o} />
      </React.Fragment>,
    );
    src = o;
  }
  if (fx.bloom && fx.bloom > 0) {
    const o = step('bl');
    const k = Math.min(1, fx.bloom);
    parts.push(
      <React.Fragment key="bl">
        <feColorMatrix in={src} type="matrix" values="1 0 0 0 -0.55  0 1 0 0 -0.55  0 0 1 0 -0.55  0 0 0 1 0" result={`${o}h`} />
        <feGaussianBlur in={`${o}h`} stdDeviation={18} result={`${o}b`} />
        <feComposite in={src} in2={`${o}b`} operator="arithmetic" k1={0} k2={1} k3={1.6 * k} k4={0} result={o} />
      </React.Fragment>,
    );
    src = o;
  }
  if (!parts.length) return null;
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }}>
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        {parts}
      </filter>
    </svg>
  );
}

// Camera drift and focus pull applied as transform/filter on the scene
export function fxMotion(fx: Fx, t: number): { transform?: string; blur?: number } {
  const out: { transform?: string; blur?: number } = {};
  const tf: string[] = [];
  if (fx.drift) {
    const a = Math.min(1, fx.drift);
    tf.push(`translate(${Math.sin(t * 0.37) * 1.2 * a}%, ${Math.cos(t * 0.29) * 0.9 * a}%) scale(${1 + 0.035 * a})`);
  }
  if (fx.glitch) {
    const g = glitchAt(t, fx.glitch);
    if (g.on) tf.push(`translateX(${g.shift}%)`);
  }
  if (tf.length) out.transform = tf.join(' ');
  if (fx.focusIn) out.blur = 14 * (1 - clamp01(t / fx.focusIn)) ** 2;
  return out;
}

// CRT scanlines and glitch slices drawn over the scene
export const FxOverlays: React.FC<{ fx: Fx; t: number }> = ({ fx, t }) => {
  const g = fx.glitch ? glitchAt(t, fx.glitch) : null;
  return (
    <>
      {fx.crt ? (
        <>
          <AbsoluteFill style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 2px, transparent 2px 4px)', opacity: Math.min(1, fx.crt), mixBlendMode: 'multiply' }} />
          <AbsoluteFill style={{ background: 'repeating-linear-gradient(90deg, rgba(255,0,0,.05) 0 1px, rgba(0,255,0,.04) 1px 2px, rgba(0,0,255,.05) 2px 3px)', opacity: Math.min(1, fx.crt) }} />
          <AbsoluteFill style={{ boxShadow: `inset 0 0 ${160 * Math.min(1, fx.crt)}px rgba(0,0,0,.75)`, borderRadius: 28 * Math.min(1, fx.crt) }} />
          <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent ${((t * 23) % 100) - 4}%, rgba(255,255,255,.05) ${(t * 23) % 100}%, transparent ${((t * 23) % 100) + 4}%)` }} />
        </>
      ) : null}
      {g?.on
        ? Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${hash(g.fr, i, 3) * 100}%`, height: `${1 + hash(g.fr, i, 4) * 6}%`, background: i % 2 ? 'rgba(255,0,90,.16)' : 'rgba(0,240,255,.14)', mixBlendMode: 'screen' }} />
          ))
        : null}
    </>
  );
};
