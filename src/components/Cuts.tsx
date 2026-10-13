// Scenes joined by transitions, laid out like @remotion/transitions' TransitionSeries but with one element tree per
// scene for its whole life. TransitionSeries wraps a scene in its presentation only while a transition runs, so
// React remounts the scene when a transition starts and ends, and the preview reloads its videos, images and
// pages there (the player stalls and the music drifts on every cut). Here the presentations always wrap the scene;
// outside its transition a presentation is idle and must leave the scene exactly as it is.
import React from 'react';
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { TransitionPresentation, TransitionTiming } from '@remotion/transitions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPresentation = TransitionPresentation<any>;

export interface Join {
  presentation: AnyPresentation;
  timing: TransitionTiming;
}

export interface Cut {
  key: string;
  dur: number;
  // Transition from the previous scene into this one
  join?: Join;
  children: React.ReactNode;
}

const noop = () => undefined;

// True while a presentation is outside its transition; Cutroom's own presentations then render without styles
export const IdleContext = React.createContext(false);

// Idle style for Remotion's presentations (their *Style props are applied last): nothing that changes the picture
const REST: React.CSSProperties = { transform: 'none', filter: 'none', clipPath: 'none', mask: 'none', opacity: 1, overflow: 'visible', perspective: 'none', transformStyle: 'flat', backfaceVisibility: 'visible', WebkitBackfaceVisibility: 'visible', willChange: 'auto', boxShadow: 'none' };
const idleProps = (p: Record<string, unknown> | undefined) => ({ ...(p ?? {}), enterStyle: REST, exitStyle: REST, outerEnterStyle: REST, outerExitStyle: REST, innerEnterStyle: REST, innerExitStyle: REST });

// Start frame of each scene: transitions overlap the scenes on both sides (TransitionSeries' arithmetic)
export function cutStarts(cuts: Cut[], fps: number): number[] {
  let t = 0;
  return cuts.map((c, i) => {
    const d = i > 0 && c.join ? c.join.timing.getDurationInFrames({ fps }) : 0;
    const start = Math.max(0, t - d);
    t = start + c.dur;
    return start;
  });
}

const Stage: React.FC<{ dur: number; enter?: Join; exit?: Join; children: React.ReactNode }> = ({ dur, enter, exit, children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ed = enter?.timing.getDurationInFrames({ fps }) ?? 0;
  const xd = exit?.timing.getDurationInFrames({ fps }) ?? 0;
  const xf = f - dur + xd;
  const enterActive = !!enter && f >= 0 && f < ed;
  const exitActive = !!exit && xf >= 0 && xf < xd;
  const both = enterActive && exitActive;
  let node = children;
  if (enter) {
    const E = enter.presentation.component;
    node = (
      <IdleContext.Provider value={!enterActive}>
        <E passedProps={enterActive ? (enter.presentation.props ?? {}) : idleProps(enter.presentation.props)} presentationDirection="entering" presentationProgress={enterActive ? enter.timing.getProgress({ frame: f, fps }) : 1} presentationDurationInFrames={ed} onElementImage={noop} onUnmount={noop} bothEnteringAndExiting={both}>
          {node}
        </E>
      </IdleContext.Provider>
    );
  }
  if (exit) {
    const X = exit.presentation.component;
    node = (
      <IdleContext.Provider value={!exitActive}>
        <X passedProps={exitActive ? (exit.presentation.props ?? {}) : idleProps(exit.presentation.props)} presentationDirection="exiting" presentationProgress={exitActive ? exit.timing.getProgress({ frame: xf, fps }) : 0} presentationDurationInFrames={xd} onElementImage={noop} onUnmount={noop} bothEnteringAndExiting={both}>
          {node}
        </X>
      </IdleContext.Provider>
    );
  }
  return <>{node}</>;
};

// premountFor mounts each scene that many frames early, so its media is ready at the cut (preview only)
export const Cuts: React.FC<{ cuts: Cut[]; premountFor?: number }> = ({ cuts, premountFor }) => {
  const { fps } = useVideoConfig();
  const starts = cutStarts(cuts, fps);
  return (
    <Sequence name="Scenes">
      {cuts.map((c, i) => (
        <Sequence key={c.key} from={starts[i]} durationInFrames={c.dur} premountFor={premountFor} name={c.key}>
          <Stage dur={c.dur} enter={i > 0 ? c.join : undefined} exit={cuts[i + 1]?.join}>
            {c.children}
          </Stage>
        </Sequence>
      ))}
    </Sequence>
  );
};
