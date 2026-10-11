import React from 'react';
import { Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Layout } from '../lib/layout';
import type { Overlay } from '../lib/types';

// A picture (logo, sticker, generated art) placed on a scene: x/y is its centre, w its width, all fractions of the frame
export const ImageOverlay: React.FC<{ o: Overlay; slug: string; layout: Layout; at: number; dur: number }> = ({ o, slug, layout, at, dur }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!o.src) return null;
  const age = f - at;
  const W = layout.W;
  const H = layout.H;
  const w = (o.w ?? 0.22) * W;
  const enter = o.enter ?? 'pop';
  const p = spring({ frame: age, fps, config: enter === 'pop' ? { damping: 11, stiffness: 140 } : { damping: 200 }, durationInFrames: enter === 'pop' ? 22 : 14 });
  const out = interpolate(f, [at + dur - 8, at + dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  let tf = '';
  let op = out * Math.min(1, p * 1.6);
  if (enter === 'pop') tf = `scale(${p})`;
  else if (enter === 'rise') tf = `translateY(${(1 - p) * H * 0.12}px)`;
  else if (enter === 'slide') tf = `translateX(${(1 - p) * ((o.x ?? 0.5) > 0.5 ? 1 : -1) * W * 0.25}px)`;
  else if (enter === 'spin') tf = `rotate(${(1 - p) * -200}deg) scale(${0.3 + 0.7 * p})`;
  else op = out * interpolate(age, [0, 0.4 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  // A gentle bob after it lands
  const bob = o.float ? Math.sin((age / fps) * Math.PI * 0.9) * H * 0.008 : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: (o.x ?? 0.5) * W,
        top: (o.y ?? 0.5) * H + bob,
        width: w,
        transform: `translate(-50%, -50%) ${tf} rotate(${o.rot ?? 0}deg)`,
        opacity: op,
        filter: 'drop-shadow(0 14px 28px rgba(0,0,0,.35))',
      }}
    >
      <Img src={staticFile(`${slug}/${o.src}`)} style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  );
};
