// Frames of the video exactly as an export renders them, for the AI to look at
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, ROOT, STATE } from './store';
import { slimPublic } from './slim';

export const lookDir = () => path.join(STATE, 'look');

// Lines the CLI prints for each rendered frame; providers turn them into images for the model
export const IMAGE_LINE = /^image: (.+?\.(?:jpe?g|png))(?:\s{2}|$)/gm;
export function imagesIn(out: string): { path: string; data: string; mime: string }[] {
  const dir = path.resolve(lookDir());
  return [...out.matchAll(IMAGE_LINE)]
    .map((m) => path.resolve(m[1]))
    .filter((f) => f.startsWith(dir) && fs.existsSync(f))
    .slice(0, 8)
    .map((f) => ({ path: f, data: fs.readFileSync(f).toString('base64'), mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg' }));
}

// Claude Code permission rule for reading the frames: //c/Users/... on Windows, //home/... elsewhere
export const lookReadRule = () => {
  const d = path.resolve(lookDir()).replace(/\\/g, '/');
  const posix = /^[A-Za-z]:\//.test(d) ? `/${d[0].toLowerCase()}${d.slice(2)}` : d;
  return `Read(/${posix}/**)`;
};

export interface Frame {
  f: number;
  label: string;
}

export async function renderFrames(o: { slug: string; format: 'wide' | 'tall'; mode: 'voice' | 'beat'; lang: 'zh' | 'en'; frames: Frame[]; log?: (s: string) => void }): Promise<{ file: string; label: string }[]> {
  // The renderer echoes the page's failed requests (timings of a project not voiced yet); noise for the reader
  const err = console.error;
  console.error = (...a: unknown[]) => {
    if (!a.some((x) => String(x).includes('Failed to load resource'))) err(...a);
  };
  try {
    return await render(o);
  } finally {
    console.error = err;
  }
}

async function render(o: { slug: string; format: 'wide' | 'tall'; mode: 'voice' | 'beat'; lang: 'zh' | 'en'; frames: Frame[]; log?: (s: string) => void }): Promise<{ file: string; label: string }[]> {
  const log = o.log ?? (() => undefined);
  const { bundle } = await import('@remotion/bundler');
  const { ensureBrowser, openBrowser, renderStill, selectComposition } = await import('@remotion/renderer');
  let shown = 0;
  await ensureBrowser({
    onBrowserDownload: () => {
      log('Downloading the renderer’s browser once (about 110 MB)…');
      return {
        version: null,
        onProgress: ({ percent }: { percent: number }) => {
          const p = Math.floor(percent * 10) * 10;
          if (p > shown) log(`  ${(shown = p)}%`);
        },
      };
    },
  });
  const slim = slimPublic(o.slug);
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src', 'index.ts'), publicDir: slim?.dir ?? PUBLIC, enableCaching: true })
    .finally(() => slim?.cleanup())
    .catch((e: NodeJS.ErrnoException) => {
    // The renderer copies the projects folder; a linked folder in it can't be copied without admin rights
    if (e.code === 'EPERM' && e.syscall === 'symlink') throw new Error(`the projects folder contains a linked folder (${e.path}), which the renderer cannot copy without admin rights; replace the link with a real copy of that folder`);
    throw e;
  });
  const chromiumOptions = { gl: 'angle' as const };
  const browser = await openBrowser('chrome', { chromiumOptions });
  const out: { file: string; label: string }[] = [];
  try {
    const inputProps = { slug: o.slug, format: o.format, mode: o.mode, variant: 'default', lang: o.lang, voice: 'on' };
    const composition = await selectComposition({ serveUrl, id: `studio-${o.format}`, inputProps, puppeteerInstance: browser, chromiumOptions });
    const dir = lookDir();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [i, x] of o.frames.entries()) {
      const file = path.join(dir, `${o.slug}-${i + 1}.jpeg`);
      const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(x.f)));
      await renderStill({ composition, serveUrl, output: file, frame, inputProps, imageFormat: 'jpeg', jpegQuality: 82, scale: 0.5, puppeteerInstance: browser, chromiumOptions });
      out.push({ file, label: x.label });
    }
  } finally {
    await browser.close({ silent: true }).catch(() => undefined);
    // bundle() leaves a fresh copy of the site in the temp folder each time
    if (!/^https?:/.test(serveUrl)) fs.rmSync(serveUrl, { recursive: true, force: true });
  }
  return out;
}
