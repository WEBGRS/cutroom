// Preview == render: the editor's Player frame vs Remotion's renderStill of the same frame (PSNR).
// The preview runs in Remotion's own headless shell, so any difference is the editor's data or timing,
// not browser text rasterization (system Chrome draws glyph edges 1-2 px differently).
// A positive control compares against a different frame, which must score clearly lower.
// Needs the server running. Usage: node editor/test/oracle.mjs [--system-chrome]
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.EDITOR_URL ?? 'http://127.0.0.1:8814';
const OUT = path.resolve('.scratch/oracle');
const system = process.argv.includes('--system-chrome');
// Same engine must be identical; system Chrome only differs in glyph edge antialiasing
const MIN_PSNR = system ? 30 : 50;
// Frames per project; the first frame of each case also gets a control (a different frame must fail)
const SETS = {
  showcase: [
    { format: 'wide', mode: 'voice', frames: [495, 140, 258, 870, 1010, 1250, 1620, 2250], control: 30 },
    { format: 'tall', mode: 'beat', frames: [290, 60, 520, 650, 940], control: 120 },
  ],
};
const slugArg = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'showcase';
const CASES = (SETS[slugArg] ?? []).map((c) => ({ slug: slugArg, ...c }));
if (!CASES.length) throw new Error(`no oracle frames for ${slugArg}`);
fs.mkdirSync(OUT, { recursive: true });

function psnr(a, b) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:(inf|[\d.]+)/.exec(r.stderr);
  if (!m) throw new Error(r.stderr.slice(-400));
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

const SHELL = path.resolve('node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
// A fresh install has no headless shell until the first render; fetch it now
await ensureBrowser();
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
// Same text/colour flags Remotion's renderer launches with
const FLAGS = ['--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars'];
const browser = await chromium.launch({ ...(system ? { channel: 'chrome' } : { executablePath: SHELL }), headless: true, args: ['--autoplay-policy=no-user-gesture-required', ...(system ? [] : FLAGS)] });
const rows = [];
let fail = 0;
for (const c of CASES) {
  const inputProps = { slug: c.slug, format: c.format, mode: c.mode, lang: 'zh', variant: 'default' };
  const comp = await selectComposition({ serveUrl, id: `studio-${c.format}`, inputProps });
  const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?oracle=1&slug=${c.slug}&format=${c.format}&mode=${c.mode}&lang=zh&variant=default`);
  await page.waitForFunction(() => window.__player, null, { timeout: 30000 });
  const preview = async (f, file) => {
    await page.evaluate((f) => window.__player.seekTo(f), f);
    // Settle: two identical screenshots in a row
    let prev = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(250);
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width: comp.width, height: comp.height } });
      if (prev && buf.equals(prev)) break;
      prev = buf;
    }
    fs.writeFileSync(file, prev);
  };
  for (const [i, f] of c.frames.entries()) {
    const tag = `${c.format}-${c.mode}-${f}`;
    const pv = path.join(OUT, `${tag}-preview.png`);
    const rd = path.join(OUT, `${tag}-render.png`);
    await preview(f, pv);
    await renderStill({ serveUrl, composition: comp, frame: f, output: rd, inputProps });
    const score = psnr(pv, rd);
    const ok = score >= MIN_PSNR;
    if (!ok) fail++;
    rows.push(`${ok ? 'PASS' : 'FAIL'} ${tag.padEnd(22)} PSNR ${score.toFixed(1)} dB`);
    if (i === 0) {
      const shift = c.control;
      const ctl = path.join(OUT, `${tag}-control.png`);
      await renderStill({ serveUrl, composition: comp, frame: f + shift, output: ctl, inputProps });
      const cs = psnr(pv, ctl);
      const caught = cs < MIN_PSNR;
      if (!caught) fail++;
      rows.push(`${caught ? 'PASS' : 'FAIL'} control ${tag} vs +${shift}f  PSNR ${cs.toFixed(1)} dB (must be < ${MIN_PSNR})`);
    }
  }
  await page.close();
}
await browser.close();
console.log(rows.join('\n'));
process.exit(fail ? 1 : 0);
