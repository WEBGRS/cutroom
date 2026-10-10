import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { MONO, SANS } from '../lib/fonts';
import { rgba, type Rect } from '../lib/layout';
import type { Frame, FrameStyle, Theme } from '../lib/types';
import { FxBackground } from '../fx/backgrounds';

export const Backdrop: React.FC<{ theme: Theme; slug?: string }> = ({ theme, slug }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const [a, b] = theme.bg ?? ['#0b1020', '#18223d'];
  if (theme.wallpaper && slug) {
    return (
      <AbsoluteFill style={{ background: a }}>
        <Img src={staticFile(`${slug}/${theme.wallpaper}`)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: theme.wallBlur ? `blur(${theme.wallBlur}px)` : undefined, transform: theme.wallBlur ? 'scale(1.06)' : undefined }} />
        <AbsoluteFill style={{ background: 'rgba(0,0,0,.18)' }} />
      </AbsoluteFill>
    );
  }
  const x1 = 28 + Math.sin(t * 0.17) * 9;
  const y1 = 18 + Math.cos(t * 0.13) * 7;
  const x2 = 78 + Math.cos(t * 0.11) * 9;
  const y2 = 82 + Math.sin(t * 0.15) * 7;
  const base = (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(55% 48% at ${x1}% ${y1}%, ${rgba(theme.accent, 0.32)}, transparent 72%)`,
          `radial-gradient(50% 45% at ${x2}% ${y2}%, ${rgba(theme.accent2 ?? theme.accent, 0.26)}, transparent 72%)`,
          `linear-gradient(160deg, ${a}, ${b})`,
        ].join(','),
      }}
    />
  );
  if (!theme.bgFx) return base;
  return (
    <AbsoluteFill>
      {base}
      <FxBackground kind={theme.bgFx} theme={theme} />
    </AbsoluteFill>
  );
};

// Browser window or phone shell around content
// Shadow scaled by FrameStyle.shadow (1 = the original)
const shadowOf = (base: [number, number, number], k?: number) => {
  if (k === undefined) return undefined;
  return k <= 0 ? 'none' : `0 ${base[0] * k}px ${base[1] * k}px rgba(0,0,0,${Math.min(0.8, base[2] * k)})`;
};

// Theme-colored outline glow around the frame
const glowOf = (look?: FrameStyle & { accent?: string }) => (look?.glow && look.accent ? `, 0 0 0 3px ${look.accent}, 0 0 44px ${rgba(look.accent, 0.55)}` : '');

export const Shell: React.FC<{ rect: Rect; bar: number; kind?: Frame; url?: string; children: React.ReactNode; look?: FrameStyle & { accent?: string } }> = ({ rect, bar, kind = 'window', url, children, look }) => {
  if (kind === 'bare') {
    return <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden', borderRadius: look?.radius ?? 18, boxShadow: (shadowOf([30, 90, 0.45], look?.shadow) ?? '0 30px 90px rgba(0,0,0,.45)') + glowOf(look) }}>{children}</div>;
  }
  if (kind === 'phone') {
    return (
      <div style={{ position: 'absolute', left: rect.x - 14, top: rect.y - 14, width: rect.w + 28, height: rect.h + 28, borderRadius: 64, background: '#0d0f14', boxShadow: '0 40px 100px rgba(0,0,0,.5), inset 0 0 0 2px rgba(255,255,255,.12)', padding: 14 }}>
        <div style={{ width: rect.w, height: rect.h, borderRadius: 50, overflow: 'hidden', position: 'relative', background: '#fff' }}>{children}</div>
      </div>
    );
  }
  const r = look?.radius ?? 16;
  const sh = shadowOf([36, 100, 0.5], look?.shadow);
  return (
    <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: r, overflow: 'hidden', background: '#fff', boxShadow: (sh ? `${sh}, 0 0 0 1px rgba(255,255,255,.10)` : '0 36px 100px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.10)') + glowOf(look) }}>
      <div style={{ height: bar, background: '#eceef2', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 9, borderBottom: '1px solid #d9dce3' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{ width: bar * 0.3, height: bar * 0.3, borderRadius: '50%', background: c }} />
        ))}
        {url ? (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: bar, padding: `${bar * 0.12}px ${bar * 0.6}px`, fontFamily: MONO, fontSize: bar * 0.42, color: '#3b4252', minWidth: '40%', textAlign: 'center', boxShadow: '0 0 0 1px #dfe2e8' }}>
              <span style={{ color: '#7b8394', fontFamily: SANS }}>🔒 </span>
              {url}
            </div>
          </div>
        ) : null}
        <div style={{ width: bar * 1.4 }} />
      </div>
      <div style={{ position: 'relative', width: rect.w, height: rect.h - bar, overflow: 'hidden' }}>{children}</div>
    </div>
  );
};

export const Pointer: React.FC<{ x: number; y: number; size: number; press: number; alpha: number }> = ({ x, y, size, press, alpha }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 28 40" style={{ position: 'absolute', left: x - size * 0.07, top: y - size * 0.07, opacity: alpha, transform: `scale(${1 - press * 0.18})`, transformOrigin: '7% 5%', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.35))' }}>
    <path d="M2 2 L2 31 L9.5 24.5 L14.5 36 L19 34 L14 22.5 L24 22.5 Z" fill="#111" stroke="#fff" strokeWidth={2.4} strokeLinejoin="round" />
  </svg>
);

export const Ripple: React.FC<{ x: number; y: number; age: number; size: number; color: string }> = ({ x, y, age, size, color }) => {
  if (age < 0 || age > 0.5) return null;
  const k = age / 0.5;
  const rad = size * (0.4 + k * 1.1);
  return <div style={{ position: 'absolute', left: x - rad, top: y - rad, width: rad * 2, height: rad * 2, borderRadius: '50%', border: `${size * 0.12}px solid ${rgba(color, 0.9 * (1 - k))}`, background: rgba(color, 0.18 * (1 - k)) }} />;
};

// Finger tap indicator for mobile captures
export const Touch: React.FC<{ x: number; y: number; age: number; size: number }> = ({ x, y, age, size }) => {
  if (age < -0.25 || age > 0.45) return null;
  const a = age < 0 ? 1 + age / 0.25 : 1 - age / 0.45;
  const rad = size * (age < 0 ? 0.9 : 0.9 - Math.min(age, 0.12) * 1.5);
  return <div style={{ position: 'absolute', left: x - rad, top: y - rad, width: rad * 2, height: rad * 2, borderRadius: '50%', background: `rgba(255,255,255,${0.55 * a})`, border: `${size * 0.08}px solid rgba(20,20,30,${0.55 * a})`, boxShadow: `0 4px 14px rgba(0,0,0,${0.25 * a})` }} />;
};
