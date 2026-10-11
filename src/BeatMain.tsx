import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, staticFile, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Backdrop } from './components/Chrome';
import { BeatCaptions, ChapterBar, TallHeader } from './components/Captions';
import { presentation } from './components/Fx';
import { SceneView } from './Main';
import { SceneSounds } from './components/Sounds';
import { SANS } from './lib/fonts';
import { LAYOUT, withFrame } from './lib/layout';
import { screenPaths } from './lib/paths';
import { buildBeatTimeline } from './lib/timeline';
import { XFADE, withFades } from './lib/fades';
import type { Props } from './lib/types';

// Music-driven cut: no narration, cuts and text on the beat grid
export const BeatMain: React.FC<Props> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const { board, format, grid } = props;
  const layout = useMemo(() => withFrame(LAYOUT[format], board?.frame), [format, board?.frame]);
  const tl = useMemo(() => (board && grid ? withFades(buildBeatTimeline(board, grid, format, fps, props.captures, props.lang ?? 'zh'), props.captures, fps) : null), [board, grid, format, fps, props.captures, props.lang]);
  const paths = useMemo(() => (tl ? screenPaths(tl, props.captures, layout, fps) : {}), [tl, props.captures, layout, fps]);
  if (!board?.beat || !tl || !grid) return null;
  const theme = board.theme;
  const vol = board.beat.volume ?? 0.85;
  const period = grid.period;
  const startBar = board.beat.startBar ?? 0;
  const t0 = grid.downbeats[Math.min(startBar, grid.downbeats.length - 1)] ?? 0;
  const seq: React.ReactNode[] = [];
  tl.scenes.forEach((s, i) => {
    if (tl.fadeBefore[i]) seq.push(<TransitionSeries.Transition key={`t-${s.scene.id}`} presentation={(s.scene.beatTransition ? presentation(s.scene.beatTransition, s.scene.transDir, layout.W, layout.H) : fade()) as never} timing={linearTiming({ durationInFrames: XFADE })} />);
    seq.push(
      <TransitionSeries.Sequence key={s.scene.id} durationInFrames={s.dur} premountFor={fps}>
        <SceneView s={s} props={props} layout={layout} theme={theme} bare={!board.beat?.overlays} paths={paths} />
      </TransitionSeries.Sequence>,
    );
  });
  return (
    <AbsoluteFill style={{ fontFamily: SANS, background: '#000' }}>
      <Backdrop theme={theme} slug={props.slug} />
      <TransitionSeries>{seq}</TransitionSeries>
      {format === 'tall' && board.header ? (props.lang === 'en' ? <TallHeader title={board.headerEn ?? board.header} theme={theme} /> : <TallHeader title={board.header} en={board.headerEn} theme={theme} />) : null}
      {board.chapterBar ? <ChapterBar tl={tl} layout={layout} theme={theme} /> : null}
      <BeatCaptions tl={tl} layout={layout} theme={theme} period={period} cs={board.captions} />
      {props.parts === 'picture' ? null : <SceneSounds tl={tl} captures={props.captures} volume={board.sfx?.volume ?? 1} />}
      {props.parts === 'picture' ? null : <Audio
        src={staticFile(board.beat.music)}
        trimBefore={Math.round(t0 * fps)}
        volume={(fr) => vol * Math.min(1, fr / (0.15 * fps)) * Math.min(1, (durationInFrames - fr) / (1.6 * fps))}
      />}
    </AbsoluteFill>
  );
};
