// A plan's key shot rendered like the export: a hidden one-scene project that borrows the project's look
import fs from 'node:fs';
import path from 'node:path';
import type { Format, Scene, Storyboard } from '../../src/lib/types';
import { PUBLIC, readDoc } from './store';
import { renderFrames } from './look';
import { runExport } from './exporter';
import { planClip, planStill, type PlanId } from './stagefiles';

// Relative media paths of the source project, seen from the hidden one
export function rebase<T>(x: T, slug: string): T {
  if (Array.isArray(x)) return x.map((v) => rebase(v, slug)) as T;
  if (x && typeof x === 'object')
    return Object.fromEntries(
      Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, k === 'src' && typeof v === 'string' && v && !/^(\.\.\/|\/|https?:|data:)/.test(v) ? `../${slug}/${v}` : rebase(v, slug)]),
    ) as T;
  return x;
}

// One hidden project per plan, so two previews never write over each other
export const hiddenSlug = (slug: string, id: PlanId) => `_plan-${slug}-${id}`;

export function previewBoard(src: Storyboard, slug: string, id: PlanId, scene: Scene, seconds: number): Storyboard {
  const s = rebase({ ...scene, id: 'preview', lines: [] }, slug);
  return { slug: hiddenSlug(slug, id), title: src.title, fps: src.fps, format: src.format, theme: src.theme, captions: src.captions, frame: src.frame, glass: src.glass, scenes: [{ ...s, minSec: seconds }] };
}

export async function renderPlanPreview(o: { slug: string; id: PlanId; scene: Scene; at: number; motion?: number; format: Format; log: (s: string) => void }): Promise<{ file: string; still: string; clip?: string }> {
  const { board } = readDoc(o.slug).doc;
  const hidden = hiddenSlug(o.slug, o.id);
  const dir = path.join(PUBLIC, hidden);
  const seconds = Math.max(o.motion ?? 0, o.at + 1, 3);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(previewBoard(board, o.slug, o.id, o.scene, seconds), null, 2));
    const fps = board.fps ?? 60;
    const [shot] = await renderFrames({ slug: hidden, format: o.format, lang: 'zh', frames: [{ f: Math.round(o.at * fps), label: `plan ${o.id}` }], log: o.log });
    const still = planStill(o.slug, o.id);
    fs.mkdirSync(path.dirname(still), { recursive: true });
    fs.copyFileSync(shot.file, still);
    let clip: string | undefined;
    if (o.motion) {
      clip = planClip(o.slug, o.id);
      const r = await runExport({ slug: hidden, format: o.format, variant: 'default', lang: 'zh', voice: 'off', out: clip }, o.log);
      if (r.code !== 0) throw new Error(`the motion preview did not render (exit ${r.code})`);
    }
    return { file: shot.file, still, clip };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
