import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Video } from '@remotion/media';
import { MONO, SANS } from '../lib/fonts';
import { fit, rgba, type Layout } from '../lib/layout';
import { tokens } from '../lib/timeline';
import type { ClipVisual, FlowVisual, FrameStyle, ImageVisual, OutroVisual, ScrollVisual, StatsVisual, Theme, TitleVisual } from '../lib/types';
import { Shell } from './Chrome';
import { AnimText } from '../fx/text';

// Frosted glass: blurred backdrop behind translucent cards
const GLASS: React.CSSProperties = { background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(4px) saturate(1.2)', WebkitBackdropFilter: 'blur(4px) saturate(1.2)', boxShadow: '0 20px 60px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.25)' };

const pop = (f: number, fps: number, delay: number) => spring({ frame: f - delay, fps, config: { damping: 200 }, durationInFrames: 14 });

// Render [[hi]] markup with accent color
export const Rich: React.FC<{ text: string; color: string }> = ({ text, color }) => (
  <>
    {tokens(text).map((t, i) => (
      <span key={i} style={t.hi ? { color } : undefined}>
        {t.s}
      </span>
    ))}
  </>
);

export const TitleScene: React.FC<{ v: TitleVisual; layout: Layout; theme: Theme }> = ({ v, layout, theme }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tall = layout.H > layout.W;
  const size = tall ? 112 : 128;
  const chars = tokens(v.title);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, padding: tall ? 70 : 160, textAlign: 'center' }}>
      {v.bg ? <Img src={staticFile(v.bg)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.22, filter: 'blur(6px)' }} /> : null}
      {v.kicker ? (
        <div style={{ opacity: pop(f, fps, 0), fontSize: size * 0.3, letterSpacing: '0.18em', fontWeight: 700, color: theme.accent, marginBottom: 28, textTransform: 'uppercase' }}>{v.kicker}</div>
      ) : null}
      <div style={{ fontSize: size, fontWeight: 900, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.01em', textShadow: '0 8px 40px rgba(0,0,0,.35)' }}>
        {v.anim ? <AnimText text={v.title} anim={v.anim} t={(f - 4) / fps} hi={theme.accent} /> : null}
        {v.anim ? null : chars.map((t, i) => {
          const p = pop(f, fps, 4 + i * 1.6);
          return (
            <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', opacity: p, transform: `translateY(${(1 - p) * 40}px)`, color: t.hi ? theme.accent : undefined }}>
              {t.s}
            </span>
          );
        })}
      </div>
      {v.sub ? (
        <div style={{ marginTop: 34, fontSize: size * 0.32, color: 'rgba(255,255,255,.86)', fontWeight: 500, opacity: interpolate(f, [18, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <Rich text={v.sub} color={theme.accent} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// Count up the leading number of a value string
function countUp(value: string, k: number): string {
  const m = /^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/.exec(value);
  if (!m) return value;
  const raw = m[2].replace(/,/g, '');
  const dec = raw.includes('.') ? raw.split('.')[1].length : 0;
  const n = Number(raw) * k;
  const txt = dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-US');
  return m[1] + (m[2].includes(',') || dec ? txt : txt.replace(/,/g, '')) + m[3];
}

export const StatsScene: React.FC<{ v: StatsVisual; layout: Layout; theme: Theme; glass?: boolean }> = ({ v, layout, theme, glass }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tall = layout.H > layout.W;
  const cols = tall ? 1 : Math.min(v.items.length, 4);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, padding: tall ? '0 70px 300px' : '0 140px 80px' }}>
      {v.title ? <div style={{ fontSize: tall ? 58 : 52, fontWeight: 800, color: '#fff', marginBottom: 48, opacity: pop(f, fps, 0) }}><Rich text={v.title} color={theme.accent} /></div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: tall ? 30 : 36, width: '100%' }}>
        {v.items.map((it, i) => {
          const p = pop(f, fps, 6 + i * 7);
          const k = interpolate(f, [6 + i * 7, 6 + i * 7 + fps * 1.1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
          return (
            <div key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 24, ...(glass ? GLASS : {}), padding: tall ? '34px 40px' : '40px 32px', textAlign: tall ? 'left' : 'center' }}>
              <div style={{ fontSize: tall ? 96 : 84, fontWeight: 900, color: theme.accent, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{countUp(it.value, k)}</div>
              <div style={{ fontSize: tall ? 40 : 32, fontWeight: 700, color: '#fff', marginTop: 16 }}>{it.label}</div>
              {it.en ? <div style={{ fontSize: tall ? 26 : 22, color: 'rgba(255,255,255,.7)', marginTop: 6 }}>{it.en}</div> : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const OutroScene: React.FC<{ v: OutroVisual; layout: Layout; theme: Theme }> = ({ v, layout, theme }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tall = layout.H > layout.W;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, textAlign: 'center', padding: tall ? '0 60px 300px' : '0 120px 80px', gap: 30 }}>
      <div style={{ fontSize: tall ? 96 : 104, fontWeight: 900, color: '#fff', opacity: pop(f, fps, 0), transform: `scale(${0.9 + 0.1 * pop(f, fps, 0)})` }}>
        <Rich text={v.title} color={theme.accent} />
      </div>
      {v.url ? (
        <div style={{ opacity: pop(f, fps, 8), fontFamily: MONO, fontSize: tall ? 40 : 44, color: '#fff', background: rgba(theme.accent, 0.22), border: `2px solid ${rgba(theme.accent, 0.7)}`, borderRadius: 999, padding: '16px 40px' }}>{v.url}</div>
      ) : null}
      {v.repo ? <div style={{ opacity: pop(f, fps, 14), fontFamily: MONO, fontSize: tall ? 32 : 30, color: 'rgba(255,255,255,.8)' }}>github.com/{v.repo}</div> : null}
      {(v.lines ?? []).map((l, i) => (
        <div key={i} style={{ opacity: pop(f, fps, 20 + i * 6), fontSize: tall ? 36 : 34, color: 'rgba(255,255,255,.9)', fontWeight: 600 }}>
          <Rich text={l} color={theme.accent} />
        </div>
      ))}
    </AbsoluteFill>
  );
};

export const ClipScene: React.FC<{ v: ClipVisual; slug: string; layout: Layout; look?: FrameStyle }> = ({ v, slug, layout, look }) => {
  const { fps } = useVideoConfig();
  const src = staticFile(`${slug}/${v.src}`);
  // @remotion/media takes objectFit as a prop; inside style it is ignored
  const video = <Video src={src} trimBefore={Math.round((v.from ?? 0) * fps)} playbackRate={v.rate ?? 1} muted={v.muted ?? true} objectFit={v.fit ?? 'cover'} style={{ width: '100%', height: '100%' }} />;
  if (!v.frame) return <AbsoluteFill>{video}</AbsoluteFill>;
  const bar = v.frame === 'window' ? layout.bar : 0;
  const ar = v.ar ?? 16 / 9;
  const { frame } = fit(layout.box, ar * 1000, 1000, bar);
  return (
    <AbsoluteFill>
      <Shell rect={frame} bar={bar} kind={v.frame} url={v.url} look={look}>
        {video}
      </Shell>
    </AbsoluteFill>
  );
};

// Still image, full-bleed or inside a window/phone frame (Ken Burns comes from scene fx)
export const ImageScene: React.FC<{ v: ImageVisual; slug: string; layout: Layout; imgW: number; imgH: number; look?: FrameStyle }> = ({ v, slug, layout, imgW, imgH, look }) => {
  const img = <Img src={staticFile(`${slug}/${v.src}`)} style={{ width: '100%', height: '100%', objectFit: v.fit ?? 'cover' }} />;
  if (!v.frame) return <AbsoluteFill>{img}</AbsoluteFill>;
  const bar = v.frame === 'window' ? layout.bar : 0;
  const { frame } = fit(layout.box, imgW, imgH, bar);
  return (
    <AbsoluteFill>
      <Shell rect={frame} bar={bar} kind={v.frame} url={v.url} look={look}>
        {img}
      </Shell>
    </AbsoluteFill>
  );
};

export const ScrollScene: React.FC<{ v: ScrollVisual; slug: string; layout: Layout; dur: number; imgW: number; imgH: number; look?: FrameStyle }> = ({ v, slug, layout, dur, imgW, imgH, look }) => {
  const f = useCurrentFrame();
  const kind = v.frame ?? 'window';
  const bar = kind === 'window' ? layout.bar : 0;
  const k0 = (layout.box.w) / imgW;
  const viewH = Math.min(imgH * k0, layout.box.h - bar);
  const frame = { x: layout.box.x, y: layout.box.y + (layout.box.h - viewH - bar) / 2, w: layout.box.w, h: viewH + bar };
  const maxY = Math.max(0, imgH * k0 - viewH);
  const p = interpolate(f, [dur * 0.12, dur * 0.88], [v.from ?? 0, v.to ?? 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Shell rect={frame} bar={bar} kind={kind} url={v.url} look={look}>
        <Img src={staticFile(`${slug}/${v.src}`)} style={{ position: 'absolute', left: 0, top: -p * maxY, width: imgW * k0, height: imgH * k0 }} />
      </Shell>
    </AbsoluteFill>
  );
};

export const FlowScene: React.FC<{ v: FlowVisual; layout: Layout; theme: Theme; glass?: boolean }> = ({ v, layout, theme, glass }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tall = layout.H > layout.W;
  const arrow = tall ? '↓' : '→';
  const items: React.ReactNode[] = [];
  v.cols.forEach((col, i) => {
    if (i > 0) {
      const a = pop(f, fps, i * 14 - 6);
      items.push(
        <div key={`a${i}`} style={{ fontSize: tall ? 64 : 72, color: theme.accent, fontWeight: 900, opacity: a, transform: tall ? `translateY(${(1 - a) * -20}px)` : `translateX(${(1 - a) * -20}px)`, alignSelf: 'center' }}>
          {arrow}
        </div>,
      );
    }
    const p = pop(f, fps, i * 14);
    items.push(
      <div key={`c${i}`} style={{ display: 'flex', flexDirection: tall ? 'row' : 'column', gap: 18, opacity: p, transform: `scale(${0.9 + 0.1 * p})`, flex: 1, justifyContent: 'center' }}>
        {col.map((n, k) => (
          <div key={k} style={{ background: 'rgba(255,255,255,.08)', ...(glass ? GLASS : {}), border: `2px solid ${k === 0 && col.length === 1 ? theme.accent : 'rgba(255,255,255,.16)'}`, borderRadius: 20, padding: tall ? '22px 20px' : '24px 26px', textAlign: 'center', flex: tall ? 1 : undefined }}>
            <div style={{ fontSize: tall ? 38 : 40, fontWeight: 800, color: '#fff' }}>{n.label}</div>
            {n.sub ? <div style={{ fontSize: tall ? 24 : 24, color: 'rgba(255,255,255,.72)', marginTop: 6 }}>{n.sub}</div> : null}
          </div>
        ))}
      </div>,
    );
  });
  return (
    <AbsoluteFill style={{ fontFamily: SANS, justifyContent: 'center', alignItems: 'center', padding: tall ? '280px 60px 520px' : '0 110px 120px' }}>
      {v.title ? <div style={{ fontSize: tall ? 56 : 52, fontWeight: 800, color: '#fff', marginBottom: 44, opacity: pop(f, fps, 0) }}><Rich text={v.title} color={theme.accent} /></div> : null}
      <div style={{ display: 'flex', flexDirection: tall ? 'column' : 'row', gap: tall ? 16 : 28, width: '100%', alignItems: 'stretch' }}>{items}</div>
    </AbsoluteFill>
  );
};
