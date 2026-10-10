import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Freeze, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Video } from '@remotion/media';
import { clickTimes, type CursorState } from '../lib/camera';
import type { ScenePath } from '../lib/paths';
import { fit, type Layout } from '../lib/layout';
import { resolveTime } from '../lib/timeline';
import type { CaptureMeta, FrameStyle, ScreenVisual, Theme } from '../lib/types';
import { Pointer, Ripple, Shell, Touch } from './Chrome';

interface P {
  scenePath?: ScenePath;
  v: ScreenVisual;
  cap?: CaptureMeta;
  slug: string;
  dur: number;
  layout: Layout;
  theme: Theme;
  look?: FrameStyle;
  ripple?: boolean;
  clickSound?: boolean;
}

// Sample a per-frame track at a possibly fractional frame (motion blur renders sub-frames); whole frames return the stored entry
function sampleArr(arr: number[][], f: number): number[] {
  const i = Math.max(0, Math.min(Math.floor(f), arr.length - 1));
  const t = f - Math.floor(f);
  if (!t || i >= arr.length - 1) return arr[i];
  return arr[i].map((v, k) => v + (arr[i + 1][k] - v) * t);
}
function sampleCur(arr: CursorState[], f: number): CursorState {
  const i = Math.max(0, Math.min(Math.floor(f), arr.length - 1));
  const t = f - Math.floor(f);
  if (!t || i >= arr.length - 1) return arr[i];
  const a = arr[i];
  const b = arr[i + 1];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, press: a.press + (b.press - a.press) * t, alpha: a.alpha + (b.alpha - a.alpha) * t };
}

export const ScreenScene: React.FC<P> = ({ scenePath, v, cap, slug, dur, layout, theme, look, ripple = true, clickSound = true }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cw = cap?.width ?? 1920;
  const ch = cap?.height ?? 1080;
  const dpr = cap?.dpr ?? 1;
  const rate = v.rate ?? 1;
  const from = resolveTime(v.from, cap, 0);
  const to = resolveTime(v.to, cap, cap?.duration ?? 1e9);
  const avail = Math.max(1, Math.floor(((Math.min(to, cap?.duration ?? to) - from) / rate) * fps) - 1);
  const kind = v.frame ?? 'window';
  const bar = kind === 'window' ? layout.bar : 0;
  const { frame, content, k } = fit(layout.box, cw, ch, bar);

  // Tall or frameless shots zoom inside the frame; wide windows zoom the whole layer
  const inner = layout.H > layout.W || kind !== 'window';
  // Precomputed camera (continuous across scenes cut from one clip); cursor follows the recording
  const path = scenePath?.path ?? [inner ? [1, 0, 0] : [1, layout.W / 2, layout.H / 2]];
  const cur = scenePath?.cursor ?? null;
  const clicks = useMemo(() => clickTimes(cap).filter((c) => c.t >= from && c.t < from + (dur / fps) * rate), [cap, from, dur, fps, rate]);
  // Click sound only on the click that leads into a marked moment, at most one per 1.5 s
  const loud = useMemo(() => {
    const marks = (cap?.events ?? []).filter((e) => e.type === 'mark').map((e) => e.t);
    const keep: number[] = [];
    for (const c of clicks) if (marks.some((m) => c.t >= m - 1.2 && c.t <= m + 0.1) && (!keep.length || c.t - keep[keep.length - 1] >= 1.5)) keep.push(c.t);
    return clicks.filter((c) => keep.includes(c.t));
  }, [cap, clicks]);

  const cp = sampleArr(path, f);
  const tNow = from + Math.min(f, avail) / fps * rate;
  const layerT = inner ? undefined : `translate(${layout.W / 2}px, ${layout.H / 2}px) scale(${cp[0]}) translate(${-cp[1]}px, ${-cp[2]}px)`;
  const innerT = inner ? `translate(${-cp[1] * k * cp[0]}px, ${-cp[2] * k * cp[0]}px) scale(${k * cp[0]})` : `scale(${k})`;

  const p = cur?.length ? sampleCur(cur, f) : undefined;
  const size = 24 * dpr;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: layerT, transformOrigin: '0 0' }}>
        <Shell rect={frame} bar={bar} kind={kind} url={v.url} look={look}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: cw, height: ch, transform: innerT, transformOrigin: '0 0' }}>
            <Freeze frame={avail} active={f >= avail}>
              <Video src={staticFile(`${slug}/${v.src}`)} trimBefore={Math.round(from * fps)} playbackRate={rate} muted style={{ width: cw, height: ch }} />
            </Freeze>
            {ripple
              ? clicks.map((cl, i) => (
                  <Ripple key={i} x={cl.x} y={cl.y} age={tNow - cl.t} size={size} color={theme.accent} />
                ))
              : null}
            {cap?.mobile
              ? clicks.map((cl, i) => <Touch key={`t${i}`} x={cl.x} y={cl.y} age={tNow - cl.t} size={size} />)
              : p && p.alpha > 0 ? <Pointer x={p.x} y={p.y} size={size} press={p.press} alpha={p.alpha} /> : null}
          </div>
        </Shell>
      </AbsoluteFill>
      {(clickSound ? loud : []).map((cl, i) => (
        <Sequence key={i} from={Math.round(((cl.t - from) / rate) * fps)} durationInFrames={Math.round(fps * 0.4)}>
          <Audio src={staticFile('sfx/click.wav')} volume={0.35} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
