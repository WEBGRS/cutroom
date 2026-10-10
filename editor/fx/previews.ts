// Renders a short looping clip and a poster for every effect into public/_fx/<cat>/<id>.{mp4,jpg}.
// Usage: node editor/dist/previews.mjs [--force] [--only cat[/id],...] [--list]
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { BG_LIST, CARD_LIST, LOWER_LIST, OVERLAY_LIST, TRANSITION_LIST, TEXT_LIST } from '../../src/fx/registry';
import { FX_DEMO } from '../../src/fx/demo';

type Cat = 'transition' | 'text' | 'overlay' | 'lower' | 'fx' | 'bg' | 'card';
interface Job {
  cat: Cat;
  id: string;
  poster: number;
}

const OUT = path.resolve('public/_fx');
const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') && onlyArg ? onlyArg.split(',') : null;

export const fileId = (id: string) => id || 'default';

const jobs: Job[] = [
  ...TRANSITION_LIST.map((x) => ({ cat: 'transition' as Cat, id: x.id, poster: 38 })),
  ...TEXT_LIST.map((x) => ({ cat: 'text' as Cat, id: x.id, poster: 20 })),
  ...OVERLAY_LIST.filter((x) => x.id !== 'lower').map((x) => ({ cat: 'overlay' as Cat, id: x.id, poster: 50 })),
  ...LOWER_LIST.map((x) => ({ cat: 'lower' as Cat, id: x.id, poster: 50 })),
  ...Object.keys(FX_DEMO).map((id) => ({ cat: 'fx' as Cat, id, poster: 40 })),
  ...BG_LIST.map((x) => ({ cat: 'bg' as Cat, id: x.id, poster: 40 })),
  ...CARD_LIST.map((x) => ({ cat: 'card' as Cat, id: x.id, poster: 66 })),
];

const want = (j: Job) => !only || only.some((o) => o === j.cat || o === `${j.cat}/${j.id}` || (o.endsWith('/') && o === `${j.cat}/`));

if (args.includes('--list')) {
  for (const j of jobs) console.log(`${j.cat}/${fileId(j.id)}`);
  process.exit(0);
}

const todo = jobs.filter(want).filter((j) => force || !fs.existsSync(path.join(OUT, j.cat, `${fileId(j.id)}.mp4`)));
console.log(`${todo.length} of ${jobs.length} previews to render`);
if (!todo.length) process.exit(0);
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
let n = 0;
for (const j of todo) {
  const dir = path.join(OUT, j.cat);
  fs.mkdirSync(dir, { recursive: true });
  const inputProps = { cat: j.cat, id: j.id };
  const t0 = Date.now();
  try {
    const composition = await selectComposition({ serveUrl, id: 'fx-preview', inputProps });
    const base = path.join(dir, fileId(j.id));
    await renderMedia({ composition, serveUrl, codec: 'h264', crf: 30, scale: 0.25, inputProps, outputLocation: `${base}.mp4`, muted: true, logLevel: 'error' });
    await renderStill({ composition, serveUrl, frame: j.poster, scale: 0.25, imageFormat: 'jpeg', jpegQuality: 80, inputProps, output: `${base}.jpg`, logLevel: 'error' });
    console.log(`${++n}/${todo.length} ${j.cat}/${fileId(j.id)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`FAIL ${j.cat}/${fileId(j.id)}: ${(e as Error).message.split('\n')[0]}`);
  }
}
