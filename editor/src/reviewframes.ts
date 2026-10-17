// Which frames a review looks at: scene middles, both sides of every cut, or a frame every 0.5 s in a range
import type { Frame } from './look';

export interface RScene {
  id: string;
  start: number;
  dur: number;
}

const MAX = 48;
const RANGE = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;

export function reviewFrames(scenes: RScene[], total: number, fps: number, args: string[]): { frames: Frame[]; scope: string; dropped: number } {
  const ids = args.filter((a) => !RANGE.test(a));
  const ranges = args.filter((a) => RANGE.test(a)).map((a) => RANGE.exec(a)!.slice(1, 3).map(Number) as [number, number]);
  const missing = ids.filter((id) => !scenes.some((s) => s.id === id));
  if (missing.length) throw new Error(`no scene ${missing.join(', ')} in this cut (ls lists them)`);
  const want = (id: string) => !args.length || ids.includes(id);
  const sec = (f: number) => `${(f / fps).toFixed(1)} s`;
  const frames: Frame[] = [];
  let cuts = 0;
  scenes.forEach((s, i) => {
    if (want(s.id)) frames.push({ f: Math.round(s.start + s.dur / 2), label: `${s.id} middle ${sec(s.start + s.dur / 2)}` });
    const next = scenes[i + 1];
    if (next && (want(s.id) || want(next.id)) && (!args.length || ids.length)) {
      cuts++;
      frames.push({ f: Math.round(next.start - 0.1 * fps), label: `${s.id}|${next.id} −0.1 s` }, { f: Math.round(next.start + 0.2 * fps), label: `${s.id}|${next.id} +0.2 s` });
    }
  });
  for (const [a, b] of ranges) for (let t = a; t <= b + 1e-9; t += 0.5) frames.push({ f: Math.min(total - 1, Math.round(t * fps)), label: `${t.toFixed(1)} s` });
  frames.sort((x, y) => x.f - y.f);
  let kept = frames;
  if (frames.length > MAX) kept = Array.from({ length: MAX }, (_, k) => frames[Math.floor((k * frames.length) / MAX)]);
  const parts = [!args.length ? `whole cut: ${scenes.length} scene middles, ${cuts} cuts` : ids.length ? `scenes ${ids.join(', ')} and ${cuts} cut${cuts === 1 ? '' : 's'}` : '', ...ranges.map(([a, b]) => `${a}–${b} s every 0.5 s`)].filter(Boolean);
  return { frames: kept, scope: `${parts.join('; ')} (${kept.length} frames)`, dropped: frames.length - kept.length };
}
