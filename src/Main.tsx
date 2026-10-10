import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { Backdrop } from './components/Chrome';
import { ClipScene, FlowScene, ImageScene, OutroScene, ScrollScene, StatsScene, TitleScene } from './components/Cards';
import { Captions, ChapterBar, Overlays, TallHeader } from './components/Captions';
import { FxLayer, presentation } from './components/Fx';
import { ScreenScene } from './components/ScreenScene';
import { screenPaths, type ScenePath } from './lib/paths';
import { BeatMain } from './BeatMain';
import { SANS } from './lib/fonts';
import { LAYOUT, withFrame, type Layout } from './lib/layout';
import { buildTimeline, type TScene, type Timeline } from './lib/timeline';
import type { Props, Theme } from './lib/types';

export const SceneView: React.FC<{ s: TScene; props: Props; layout: Layout; theme: Theme; bare?: boolean; paths?: Record<string, ScenePath> }> = ({ s, props, layout, theme, bare, paths }) => {
  const clean = props.variant === 'clean';
  const raw = s.visual;
  const v = clean && (raw.kind === 'screen' || raw.kind === 'scroll' || raw.kind === 'clip' || raw.kind === 'image') ? { ...raw, url: undefined } : clean && raw.kind === 'outro' ? { ...raw, url: undefined, repo: undefined } : raw;
  const slug = props.slug;
  const board = props.board;
  const look = board?.frame ? { ...board.frame, accent: theme.accent } : undefined;
  let body: React.ReactNode = null;
  if (v.kind === 'screen') body = <ScreenScene scenePath={paths?.[s.scene.id]} v={v} cap={props.captures?.[v.src]} slug={slug} dur={s.dur} layout={layout} theme={theme} look={look} ripple={s.scene.fx?.ripple !== false} clickSound={board?.sfx?.click !== false} />;
  else if (v.kind === 'title') body = <TitleScene v={v} layout={layout} theme={theme} />;
  else if (v.kind === 'stats') body = <StatsScene v={v} layout={layout} theme={theme} glass={board?.glass} />;
  else if (v.kind === 'outro') body = <OutroScene v={v} layout={layout} theme={theme} />;
  else if (v.kind === 'flow') body = <FlowScene v={v} layout={layout} theme={theme} glass={board?.glass} />;
  else if (v.kind === 'clip') body = <ClipScene v={v} slug={slug} layout={layout} look={look} />;
  else if (v.kind === 'image') {
    const d = props.images?.[v.src] ?? { w: 1920, h: 1080 };
    body = <ImageScene v={v} slug={slug} layout={layout} imgW={d.w} imgH={d.h} look={look} />;
  } else if (v.kind === 'scroll') {
    const d = props.images?.[v.src] ?? { w: 1920, h: 4000 };
    body = <ScrollScene v={v} slug={slug} layout={layout} dur={s.dur} imgW={d.w} imgH={d.h} look={look} />;
  }
  return (
    <AbsoluteFill>
      <FxLayer fx={s.scene.fx} dur={s.dur}>
        {body}
      </FxLayer>
      {!bare && s.scene.overlays?.length ? <Overlays items={s.scene.overlays} layout={layout} theme={theme} /> : null}
    </AbsoluteFill>
  );
};

// Music volume: duck under voice, fade in/out
function musicEnvelope(tl: Timeline, base: number, duck: number, fadeInSec = 1, fadeOutSec = 2): number[] {
  const n = tl.total;
  const on = new Float32Array(n);
  for (const s of tl.scenes) for (const l of s.lines) for (let f = s.start + l.start; f < Math.min(n, s.start + l.start + l.dur); f++) on[f] = 1;
  const att = 1 / (0.18 * tl.fps);
  const rel = 1 / (0.6 * tl.fps);
  const out: number[] = [];
  let e = 0;
  for (let f = 0; f < n; f++) {
    // Look ahead so the dip lands before speech starts
    const want = on[Math.min(n - 1, f + Math.round(0.12 * tl.fps))];
    e = want > e ? Math.min(want, e + att) : Math.max(want, e - rel);
    const fadeIn = fadeInSec > 0 ? Math.min(1, f / (fadeInSec * tl.fps)) : 1;
    const fadeOut = fadeOutSec > 0 ? Math.min(1, (n - f) / (fadeOutSec * tl.fps)) : 1;
    out.push(base * (1 - (1 - duck) * e) * fadeIn * fadeOut);
  }
  return out;
}

export const Main: React.FC<Props> = (props) => (props.mode === 'beat' ? <BeatMain {...props} /> : <VoiceMain {...props} />);

const VoiceMain: React.FC<Props> = (props) => {
  const { fps } = useVideoConfig();
  const { board, timings, format, slug } = props;
  const layout = useMemo(() => withFrame(LAYOUT[format], board?.frame), [format, board?.frame]);
  const tl = useMemo(() => (board ? buildTimeline(board, timings, format, fps, props.captures, props.voice === 'off', props.lang ?? 'zh') : null), [board, timings, format, fps, props.captures, props.voice, props.lang]);
  const paths = useMemo(() => (tl ? screenPaths(tl, props.captures, layout, fps) : {}), [tl, props.captures, layout, fps]);
  const env = useMemo(() => (tl && board?.music ? musicEnvelope(tl, (board.music.volume ?? 0.22) * (props.voice === 'off' ? 1.5 : 1), props.voice === 'off' ? 1 : board.music.duck ?? 0.3, board.music.fadeIn ?? 1, board.music.fadeOut ?? 2) : []), [tl, board, props.voice]);
  if (!board || !tl) return null;
  const theme = board.theme;
  const sfx = board.sfx ?? {};
  const sv = sfx.volume ?? 1;

  const seq: React.ReactNode[] = [];
  tl.scenes.forEach((s, i) => {
    if (i > 0 && s.trans > 0) seq.push(<TransitionSeries.Transition key={`t-${s.scene.id}`} presentation={presentation(s.scene.transition, s.scene.transDir, layout.W, layout.H)} timing={linearTiming({ durationInFrames: s.trans })} />);
    seq.push(
      <TransitionSeries.Sequence key={s.scene.id} durationInFrames={s.dur}>
        <SceneView s={s} props={props} layout={layout} theme={theme} paths={paths} />
      </TransitionSeries.Sequence>,
    );
  });

  return (
    <AbsoluteFill style={{ fontFamily: SANS, background: '#000' }}>
      <Backdrop theme={theme} slug={slug} />
      <TransitionSeries>{seq}</TransitionSeries>
      {format === 'tall' && board.header ? (props.lang === 'en' ? <TallHeader title={board.headerEn ?? board.header} theme={theme} /> : <TallHeader title={board.header} en={board.headerEn} theme={theme} />) : null}
      {board.chapterBar ? <ChapterBar tl={tl} layout={layout} theme={theme} /> : null}
      <Captions tl={tl} layout={layout} theme={theme} en={props.lang === 'en'} cs={board.captions} />
      {tl.scenes.flatMap((s) =>
        s.lines
          .filter((l) => l.file)
          .map((l, k) => (
            <Sequence key={`${s.scene.id}-${k}`} from={s.start + l.start} durationInFrames={l.dur + Math.round(fps * 0.3)}>
              <Audio src={staticFile(`${slug}/${l.file}`)} />
            </Sequence>
          )),
      )}
      {tl.scenes
        .filter((s) => s.trans > 0 && sfx.whoosh !== false)
        .map((s) => (
          <Sequence key={`w-${s.scene.id}`} from={Math.max(0, s.start - Math.round(fps * 0.1))} durationInFrames={Math.round(fps * 0.8)}>
            <Audio src={staticFile('sfx/whoosh.wav')} volume={0.22 * sv} />
          </Sequence>
        ))}
      {tl.scenes.flatMap((s) =>
        (s.scene.overlays ?? [])
          .filter((o) => o.kind === 'punch' && sfx.pop !== false)
          .map((o, k) => (
            <Sequence key={`p-${s.scene.id}-${k}`} from={s.start + Math.round(o.at * fps)} durationInFrames={Math.round(fps * 0.6)}>
              <Audio src={staticFile('sfx/pop.wav')} volume={0.4 * sv} />
            </Sequence>
          )),
      )}
      {board.music ? <Audio src={staticFile(board.music.src)} loop volume={(f) => env[Math.min(env.length - 1, f)] ?? 0} /> : null}
    </AbsoluteFill>
  );
};
