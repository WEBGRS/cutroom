import React from 'react';
import { Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { SFX_GAIN, soundDef, soundSrc } from '../fx/sounds';
import { cueFrame, type Timeline } from '../lib/timeline';
import type { CaptureMeta } from '../lib/types';

export { SFX_GAIN };

// Sound effects placed on scenes; cues past the end of their scene are dropped
export const SceneSounds: React.FC<{ tl: Timeline; captures?: Record<string, CaptureMeta>; volume?: number }> = ({ tl, captures, volume = 1 }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {tl.scenes.flatMap((s) =>
        (s.scene.sounds ?? []).map((c, k) => {
          const def = soundDef(c.id);
          const off = cueFrame(s, c.at, captures, fps);
          if (!def || off === undefined || off < 0 || off >= s.dur) return null;
          return (
            <Sequence key={`sx-${s.scene.id}-${k}`} from={s.start + off} durationInFrames={Math.ceil(def.dur * fps) + 2} name={`sfx ${c.id}`}>
              <Audio src={staticFile(soundSrc(c.id))} volume={SFX_GAIN * (c.vol ?? 1) * volume} />
            </Sequence>
          );
        }),
      )}
    </>
  );
};
