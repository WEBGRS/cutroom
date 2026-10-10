import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { rgba } from '../lib/layout';
import type { Theme } from '../lib/types';
import { hash } from './ease';

// Animated backdrops behind every scene (HyperFrames aurora-drift, mesh-gradient-bg, grain-field,
// beat-pulse-background, starfield, snow). Drawn over the theme gradient, in theme colours.

export const BACKGROUNDS = ['aurora', 'mesh', 'grid', 'dots', 'stars', 'snow', 'bokeh', 'pulse', 'lines', 'noise'];

export const FxBackground: React.FC<{ kind: string; theme: Theme }> = ({ kind, theme }) => {
  const f = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = f / fps;
  const a = theme.accent;
  const b = theme.accent2 ?? theme.accent;
  switch (kind) {
    case 'aurora': {
      const blobs = [
        { c: a, x: 30 + Math.sin(t * 0.21) * 18, y: 30 + Math.cos(t * 0.17) * 12, s: 60 },
        { c: b, x: 72 + Math.cos(t * 0.15) * 16, y: 60 + Math.sin(t * 0.19) * 14, s: 55 },
        { c: '#7c4dff', x: 50 + Math.sin(t * 0.11 + 2) * 22, y: 80 + Math.cos(t * 0.13) * 10, s: 50 },
      ];
      return (
        <AbsoluteFill style={{ filter: 'blur(60px) saturate(1.3)', opacity: 0.85 }}>
          {blobs.map((bl, i) => (
            <div key={i} style={{ position: 'absolute', left: `${bl.x - bl.s / 2}%`, top: `${bl.y - bl.s / 2}%`, width: `${bl.s}%`, height: `${bl.s * 0.7}%`, borderRadius: '50%', background: rgba(bl.c, 0.55), transform: `rotate(${t * 8 + i * 40}deg)` }} />
          ))}
        </AbsoluteFill>
      );
    }
    case 'mesh': {
      const p = (k: number, base: number, amp: number) => base + Math.sin(t * k) * amp;
      return (
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(40% 50% at ${p(0.23, 15, 8)}% ${p(0.19, 20, 8)}%, ${rgba(a, 0.75)}, transparent 70%)`,
              `radial-gradient(45% 55% at ${p(0.17, 85, 8)}% ${p(0.21, 25, 10)}%, ${rgba(b, 0.6)}, transparent 70%)`,
              `radial-gradient(50% 50% at ${p(0.13, 20, 10)}% ${p(0.16, 85, 8)}%, rgba(255,120,180,.45), transparent 70%)`,
              `radial-gradient(45% 50% at ${p(0.19, 80, 9)}% ${p(0.14, 80, 9)}%, rgba(80,220,255,.4), transparent 70%)`,
            ].join(','),
          }}
        />
      );
    }
    case 'grid': {
      const cell = Math.round(H / 14);
      const off = (t * cell * 0.25) % cell;
      return (
        <AbsoluteFill>
          <AbsoluteFill style={{ backgroundImage: `linear-gradient(${rgba('#ffffff', 0.1)} 2px, transparent 2px), linear-gradient(90deg, ${rgba('#ffffff', 0.1)} 2px, transparent 2px)`, backgroundSize: `${cell}px ${cell}px`, backgroundPosition: `${off}px ${off}px` }} />
          <AbsoluteFill style={{ background: `radial-gradient(70% 70% at 50% 45%, transparent 45%, rgba(0,0,0,.5) 100%)` }} />
        </AbsoluteFill>
      );
    }
    case 'dots': {
      const cell = Math.round(H / 22);
      return (
        <AbsoluteFill>
          <AbsoluteFill style={{ backgroundImage: `radial-gradient(${rgba('#ffffff', 0.22)} 3px, transparent 3.5px)`, backgroundSize: `${cell}px ${cell}px`, backgroundPosition: `0 ${(t * 6) % cell}px` }} />
          <AbsoluteFill style={{ background: `radial-gradient(70% 70% at 50% 50%, transparent 40%, rgba(0,0,0,.5) 100%)` }} />
        </AbsoluteFill>
      );
    }
    case 'stars':
      return (
        <AbsoluteFill>
          {Array.from({ length: 140 }, (_, i) => {
            const z = 0.3 + hash(i, 3) * 0.7;
            const x = (hash(i, 1) * W + t * 12 * z) % W;
            const y = hash(i, 2) * H;
            const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.8 + hash(i, 4) * 2) + i));
            const s = 1.5 + z * 3;
            return <div key={i} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: '50%', background: '#fff', opacity: tw * z, boxShadow: z > 0.85 ? `0 0 ${s * 3}px rgba(255,255,255,.8)` : undefined }} />;
          })}
        </AbsoluteFill>
      );
    case 'snow':
      return (
        <AbsoluteFill>
          {Array.from({ length: 110 }, (_, i) => {
            const z = 0.35 + hash(i, 3) * 0.65;
            const speed = H * 0.08 * z;
            const y = ((hash(i, 2) * H + t * speed) % (H + 20)) - 10;
            const x = hash(i, 1) * W + Math.sin(t * 0.9 + i) * 18 * z;
            const s = 2 + z * 5;
            return <div key={i} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: '50%', background: '#fff', opacity: 0.35 + 0.5 * z, filter: z < 0.5 ? 'blur(1.5px)' : undefined }} />;
          })}
        </AbsoluteFill>
      );
    case 'bokeh':
      return (
        <AbsoluteFill>
          {Array.from({ length: 22 }, (_, i) => {
            const s = H * (0.06 + hash(i, 3) * 0.16);
            const x = hash(i, 1) * W + Math.sin(t * 0.2 + i) * 40;
            const y = hash(i, 2) * H + Math.cos(t * 0.17 + i * 2) * 30;
            const c = i % 3 ? a : b;
            return <div key={i} style={{ position: 'absolute', left: x - s / 2, top: y - s / 2, width: s, height: s, borderRadius: '50%', background: rgba(c, 0.12 + hash(i, 4) * 0.12), border: `1px solid ${rgba(c, 0.18)}`, filter: `blur(${2 + hash(i, 5) * 6}px)` }} />;
          })}
        </AbsoluteFill>
      );
    case 'pulse': {
      // 120 bpm unless the beat grid drives it
      const beat = (t * 2) % 1;
      return (
        <AbsoluteFill>
          {[0, 1, 2, 3].map((i) => {
            const r = ((beat + i) / 4) * Math.hypot(W, H) * 0.6;
            return <div key={i} style={{ position: 'absolute', left: W / 2 - r, top: H / 2 - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `4px solid ${rgba(a, 0.45 * (1 - (beat + i) / 4))}` }} />;
          })}
          <AbsoluteFill style={{ background: `radial-gradient(30% 30% at 50% 50%, ${rgba(a, 0.22 * (1 - beat))}, transparent 70%)` }} />
        </AbsoluteFill>
      );
    }
    case 'lines': {
      const off = (t * 40) % 80;
      return <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(120deg, ${rgba(a, 0.16)} 0 4px, transparent 4px 48px)`, backgroundPosition: `${off}px 0` }} />;
    }
    case 'noise':
      return (
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: 0.22, mixBlendMode: 'overlay' }}>
          <filter id="bgnoise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={f % 61} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#bgnoise)" />
        </svg>
      );
  }
  return null;
};
