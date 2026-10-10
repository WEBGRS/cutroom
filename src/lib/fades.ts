import { resolveTime, type Timeline } from './timeline';
import type { CaptureMeta } from './types';

export const XFADE = 12;

// Unrelated shots get a short crossfade centred on the beat; scenes cut from one clip join seamlessly
export function withFades<T extends Timeline & { joins: boolean[] }>(tl: T, captures: Record<string, CaptureMeta> | undefined, fps: number): T & { fadeBefore: boolean[] } {
  const h = XFADE / 2;
  const n = tl.scenes.length;
  const before = tl.scenes.map((_, i) => i > 0 && !tl.joins[i]);
  const after = tl.scenes.map((_, i) => i < n - 1 && !tl.joins[i + 1]);
  const scenes = tl.scenes.map((s, i) => {
    const pre = before[i] ? h : 0;
    const v = s.visual;
    const visual = v.kind === 'screen' && pre ? { ...v, from: Math.max(0, resolveTime(v.from, captures?.[v.src], 0) - (pre / fps) * (v.rate ?? 1)) } : v;
    return { ...s, visual, start: s.start - pre, dur: s.dur + pre + (after[i] ? h : 0), trans: before[i] ? XFADE : 0, lines: s.lines.map((l) => ({ ...l, start: l.start + pre })) };
  });
  return { ...tl, scenes, fadeBefore: before };
}
