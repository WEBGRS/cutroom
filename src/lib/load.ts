import { LAYOUT } from './layout';
import { buildTimeline } from './timeline';
import type { CaptureMeta, Props, Storyboard, Timings } from './types';

export type GetJson = <T>(path: string) => Promise<T | undefined>;
export type GetDims = (path: string) => Promise<{ w: number; h: number }>;

export interface Loaded {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  props: Props;
}

// Resolve a composition's data from public/ (shared by Root and the editor)
export async function loadProps(props: Props, getJson: GetJson, getDims: GetDims, given?: Storyboard): Promise<Loaded> {
  const board = given ?? (await getJson<Storyboard>(`${props.slug}/storyboard.json`));
  if (!board) throw new Error(`missing public/${props.slug}/storyboard.json`);
  const timings = await getJson<Timings>(`${props.slug}/${props.lang === 'en' ? 'timings-en.json' : 'timings.json'}`);
  const captures: Record<string, CaptureMeta> = {};
  const images: Record<string, { w: number; h: number }> = {};
  for (const s of board.scenes)
    for (const v of [s.visual, s.tall]) {
      if (v?.kind === 'screen' && !captures[v.src]) {
        const cap = await getJson<CaptureMeta>(`${props.slug}/${v.src.replace(/\.mp4$/, '.json')}`);
        if (cap) captures[v.src] = cap;
      }
      if ((v?.kind === 'scroll' || v?.kind === 'image') && !images[v.src]) images[v.src] = await getDims(`${props.slug}/${v.src}`);
    }
  const fps = board.fps ?? 60;
  const L = LAYOUT[props.format];
  const tl = buildTimeline(board, timings, props.format, fps, captures, props.voice === 'off', props.lang ?? 'zh');
  return { durationInFrames: tl.total, fps, width: L.W, height: L.H, props: { ...props, board, timings, captures, images } };
}
