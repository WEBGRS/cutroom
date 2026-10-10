import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { Backdrop } from './components/Chrome';
import { FlowScene, OutroScene, StatsScene, TitleScene } from './components/Cards';
import { Overlays } from './components/Captions';
import { FxLayer, presentation } from './components/Fx';
import { FxCard } from './fx/cards';
import { AnimText } from './fx/text';
import { DEMO_CARDS, DEMO_THEME, FX_DEMO, textSample } from './fx/demo';
import { OVERLAY_LIST } from './fx/registry';
import { SANS } from './lib/fonts';
import { LAYOUT } from './lib/layout';
import type { Dir, Fx, Overlay, Visual } from './lib/types';

// One effect on representative footage, for the editor's library tiles (rendered by editor/fx/previews.mjs)
export type PreviewProps = { cat: 'transition' | 'text' | 'overlay' | 'lower' | 'fx' | 'bg' | 'card'; id: string; dir?: Dir };

const layout = LAYOUT.wide;
// Demo positions that land on something in the sample frame
const PREVIEW_AT: Record<string, Partial<Overlay>> = { blur: { x: 0.56, y: 0.47, w: 0.5, h: 0.13 }, ticker: { y: 0.8 }, feather: { x: 0.5, y: 0.47, w: 0.3, h: 0.3 }, tap: { x: 0.35, y: 0.82 }, spot: { x: 0.6, y: 0.45, w: 0.12 } };
const BIG = ['lower', 'ticker', 'keys', 'badge', 'tag', 'note', 'pointer', 'chat', 'notify', 'prompt', 'terminal', 'comment', 'quote', 'progress', 'stars', 'hwbox', 'hwarrow', 'cursor', 'check'];
const theme = DEMO_THEME;

const Photo: React.FC = () => <Img src={staticFile('showcase/media/fractal.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;

const TitleB: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS }}>
    <Backdrop theme={theme} />
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontSize: 170, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>Cutroom</div>
      <div style={{ fontSize: 54, fontWeight: 600, color: theme.accent, marginTop: 10 }}>edit video as code</div>
    </AbsoluteFill>
  </AbsoluteFill>
);

// Light app screen for callouts to point at
const MockUI: React.FC = () => (
  <AbsoluteFill style={{ background: '#e9ecf2', fontFamily: SANS }}>
    <div style={{ position: 'absolute', left: 120, top: 70, right: 120, bottom: 70, borderRadius: 26, background: '#fff', boxShadow: '0 30px 80px rgba(20,30,60,.18)', overflow: 'hidden' }}>
      <div style={{ height: 70, background: '#f3f5f9', borderBottom: '1px solid #e1e5ec', display: 'flex', alignItems: 'center', padding: '0 30px', gap: 12 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{ width: 18, height: 18, borderRadius: '50%', background: c }} />
        ))}
        <div style={{ marginLeft: 30, width: 520, height: 34, borderRadius: 17, background: '#fff', border: '1px solid #dfe3ea' }} />
      </div>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: 300, background: '#f7f8fb', borderRight: '1px solid #e8ebf1', padding: 34 }}>
          {[160, 120, 190, 140, 170].map((w, i) => (
            <div key={i} style={{ width: w, height: 22, borderRadius: 8, background: i === 1 ? '#5b8cff' : '#dfe3ea', marginBottom: 30 }} />
          ))}
        </div>
        <div style={{ flex: 1, padding: 50 }}>
          <div style={{ width: 520, height: 48, borderRadius: 10, background: '#1d2433', marginBottom: 36 }} />
          <div style={{ display: 'flex', gap: 30 }}>
            {['#5b8cff', '#ffb547', '#3fcf8e'].map((c, i) => (
              <div key={i} style={{ flex: 1, height: 300, borderRadius: 20, background: '#f6f8fc', border: '1px solid #e5e9f0', padding: 30 }}>
                <div style={{ width: 70, height: 70, borderRadius: 18, background: c, marginBottom: 30 }} />
                <div style={{ width: '80%', height: 20, borderRadius: 6, background: '#cfd5df', marginBottom: 16 }} />
                <div style={{ width: '55%', height: 20, borderRadius: 6, background: '#e1e5ec' }} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 40, width: 240, height: 64, borderRadius: 14, background: '#5b8cff' }} />
        </div>
      </div>
    </div>
  </AbsoluteFill>
);

function card(v: Visual) {
  switch (v.kind) {
    case 'title':
      return <TitleScene v={v} layout={layout} theme={theme} />;
    case 'stats':
      return <StatsScene v={v} layout={layout} theme={theme} />;
    case 'flow':
      return <FlowScene v={v} layout={layout} theme={theme} />;
    case 'outro':
      return <OutroScene v={v} layout={layout} theme={theme} />;
    default:
      return <FxCard v={v} layout={layout} theme={theme} slug="showcase" />;
  }
}

export const FxPreview: React.FC<PreviewProps> = ({ cat, id, dir }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (cat === 'transition') {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={50}>
            <Photo />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition presentation={presentation(id === 'none' ? 'none' : id || undefined, dir, layout.W, layout.H) as never} timing={linearTiming({ durationInFrames: id === 'none' ? 1 : 22 })} />
          <TransitionSeries.Sequence durationInFrames={id === 'none' ? 26 : 47}>
            <TitleB />
          </TransitionSeries.Sequence>
        </TransitionSeries>
      </AbsoluteFill>
    );
  }
  if (cat === 'text') {
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS }}>
        <Backdrop theme={theme} />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <AnimText text={textSample(id)} anim={id} t={(f - 6) / fps} hi={theme.accent2!} color="#fff" style={{ fontSize: id === 'lines' ? 150 : 210, fontWeight: 900, lineHeight: 1.12, textAlign: 'center', maxWidth: 1800 }} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (cat === 'overlay' || cat === 'lower') {
    const def = OVERLAY_LIST.find((o) => o.id === (cat === 'lower' ? 'lower' : id));
    const o = { kind: cat === 'lower' ? 'lower' : id, text: '', ...def?.init, ...(cat === 'lower' ? { style: id || undefined } : {}), ...PREVIEW_AT[id], at: 0.15 } as Overlay;
    o.dur = Math.max(o.dur ?? 1.6, 2.3);
    const onPhoto = ['lower', 'ticker', 'text', 'punch', 'cinema', 'bigword', 'sweep', 'flash', 'confetti', 'counter', 'ring', 'progress', 'stars', 'bars', 'quote', 'comment', 'check', 'badge', 'scan', 'sticker'].includes(o.kind);
    return (
      <AbsoluteFill>
        {onPhoto ? (
          <AbsoluteFill>
            {/* Footage-like but calm, so small overlays read in a tile */}
            <AbsoluteFill style={{ filter: ['sweep', 'flash', 'scan', 'confetti', 'sticker'].includes(o.kind) ? undefined : 'blur(14px) brightness(.5) saturate(.8)', transform: 'scale(1.05)' }}>
              <Photo />
            </AbsoluteFill>
          </AbsoluteFill>
        ) : (
          <MockUI />
        )}
        {/* Larger than in a real cut so small overlays read in a library tile */}
        <Overlays items={[o]} layout={{ ...layout, zh: layout.zh * (BIG.includes(o.kind) ? 1.7 : 1) }} theme={theme} />
      </AbsoluteFill>
    );
  }
  if (cat === 'fx') {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <FxLayer fx={(FX_DEMO[id] ?? {}) as Fx} dur={75}>
          <Photo />
        </FxLayer>
      </AbsoluteFill>
    );
  }
  if (cat === 'bg') {
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS }}>
        <Backdrop theme={{ ...theme, bgFx: id || undefined }} />
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontSize: 120, fontWeight: 900, color: '#fff', textShadow: '0 8px 40px rgba(0,0,0,.4)' }}>Cutroom</div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  const v = DEMO_CARDS[id];
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop theme={theme} />
      {v ? card(v) : null}
    </AbsoluteFill>
  );
};
