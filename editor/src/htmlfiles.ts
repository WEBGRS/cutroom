// HTML scene files in a project's scenes/ folder: list, import, write, check, starter page
import fs from 'node:fs';
import path from 'node:path';
import { htmlMeta, type HtmlMeta } from '../../src/lib/html';
import type { Theme } from '../../src/lib/types';
import { PUBLIC } from './store';

import { isHtml, pageName } from './pagename';
export { isHtml, pageName };

// scenes/<name>.html and scenes/<name>/<file>.html, relative to the project
export function listHtml(slug: string): string[] {
  const dir = path.join(PUBLIC, slug, 'scenes');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && isHtml(e.name)) out.push(`scenes/${e.name}`);
    else if (e.isDirectory())
      for (const f of fs.readdirSync(path.join(dir, e.name)))
        if (isHtml(f) && fs.statSync(path.join(dir, e.name, f)).isFile()) out.push(`scenes/${e.name}/${f}`);
  }
  // index.html first within each folder
  return out.sort((a, b) => a.replace(/\/index\.html?$/i, '/').localeCompare(b.replace(/\/index\.html?$/i, '/')));
}

export const safeName = (s: string) => s.replace(/\.html?$/i, '').replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'page';

function freeName(slug: string, want: string): string {
  const dir = path.join(PUBLIC, slug, 'scenes');
  let name = safeName(want);
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${safeName(want)}-${n}`;
  return name;
}

// Copy a page (or its whole folder, when it is the folder's index or the folder itself) into scenes/<name>/
export function importHtml(slug: string, from: string): string {
  const abs = path.resolve(from);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${from}`);
  const st = fs.statSync(abs);
  // A folder's page: index.html, <folder>.html (HyperFrames blocks), or its only HTML file
  const tops = st.isDirectory() ? fs.readdirSync(abs).filter((f) => isHtml(f) && !/^demo\.html?$/i.test(f)) : [];
  const pick = ['index.html', 'index.htm', `${path.basename(abs)}.html`].find((f) => tops.includes(f)) ?? (tops.length === 1 ? tops[0] : undefined);
  const page = st.isDirectory() ? (pick ? path.join(abs, pick) : undefined) : abs;
  if (!page || !isHtml(page)) throw new Error(`${from} is not an HTML file or a folder with index.html${tops.length > 1 ? ` (it has ${tops.join(', ')}; pass one of them)` : ''}`);
  // A lone page that links files next to it (assets/…, a stylesheet) brings its folder along
  const relLinks = /\b(?:src|href)\s*=\s*["'](?![a-z]+:|\/\/|\/|#|data:)[^"']+["']|url\(\s*["']?(?![a-z]+:|\/|data:)[^)"']+/i.test(fs.readFileSync(page, 'utf8'));
  const folder = st.isDirectory() || /^index\.html?$/i.test(path.basename(page)) || relLinks ? path.dirname(page) : null;
  const name = freeName(slug, folder ? path.basename(folder) : path.basename(page));
  const dest = path.join(PUBLIC, slug, 'scenes', name);
  fs.mkdirSync(dest, { recursive: true });
  if (folder) {
    // Small folders only: a composition with its own images, fonts and scripts
    let bytes = 0;
    fs.cpSync(folder, dest, {
      recursive: true,
      filter: (src) => {
        const b = path.basename(src);
        if (b === 'node_modules' || b === '.git' || b === 'renders' || b === 'out') return false;
        if (fs.statSync(src).isFile()) bytes += fs.statSync(src).size;
        if (bytes > 400 * 1024 * 1024) throw new Error(`${from} is over 400 MB; copy only the page and the files it uses`);
        return true;
      },
    });
    return `scenes/${name}/${path.basename(page)}`;
  }
  fs.copyFileSync(page, path.join(dest, 'index.html'));
  return `scenes/${name}/index.html`;
}

// Write a page the AI composed; returns its project path
export function writeHtml(slug: string, name: string, html: string): string {
  if (!/<[a-z!]/i.test(html)) throw new Error('that is not HTML (expected markup such as <div …>)');
  const rel = /\.html?$/i.test(name) ? `scenes/${name.replace(/^scenes\//, '')}` : `scenes/${safeName(name)}/index.html`;
  const f = path.join(PUBLIC, slug, rel);
  if (!path.resolve(f).startsWith(path.resolve(PUBLIC, slug, 'scenes'))) throw new Error('the page has to stay inside scenes/');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
  return rel;
}

export function readHtml(slug: string, rel: string): { text: string; meta: HtmlMeta } {
  const f = path.join(PUBLIC, slug, rel);
  if (!fs.existsSync(f)) throw new Error(`no ${rel} in ${slug}`);
  const text = fs.readFileSync(f, 'utf8');
  return { text, meta: htmlMeta(text) };
}

// Things that make a page render differently in preview and export, or not at all
export function lintHtml(text: string, meta = htmlMeta(text)): { level: 'error' | 'warn' | 'note'; msg: string }[] {
  const out: { level: 'error' | 'warn' | 'note'; msg: string }[] = [];
  const code = [...text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const css = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') + (text.match(/style="[^"]*"/g)?.join('\n') ?? '');
  if (!meta.id) out.push({ level: 'warn', msg: 'no composition root (an element with data-composition-id, data-width, data-height, data-duration); the page is shown at 1920×1080 and the scene length is up to you (min <id> <sec>)' });
  else if (meta.dur === undefined && !/__timelines/.test(code)) out.push({ level: 'warn', msg: 'the root has no data-duration and there is no GSAP timeline, so the page length is unknown; add data-duration="<seconds>" to the root' });
  if (/\b(Date\.now|new Date\(\s*\)|performance\.now)\b/.test(code)) out.push({ level: 'warn', msg: 'reads the clock (Date.now / new Date() / performance.now): those frames will differ between the preview and the export; derive motion from the timeline instead' });
  if (/\b(requestAnimationFrame|setInterval)\s*\(/.test(code)) out.push({ level: 'warn', msg: 'animates with requestAnimationFrame or setInterval, which Cutroom cannot seek; use CSS @keyframes, element.animate(…) or a paused GSAP timeline on window.__timelines' });
  if (/gsap\.timeline\s*\(\s*(\)|\{(?![^}]*paused\s*:\s*true))/.test(code)) out.push({ level: 'warn', msg: 'a GSAP timeline is created without { paused: true }; it would play on its own clock' });
  const keys = [...code.matchAll(/__timelines\s*\[\s*["'`]([^"'`]+)["'`]\s*\]\s*=/g)].map((m) => m[1]);
  if (meta.id && keys.length && !keys.includes(meta.id) && !meta.subs.length) out.push({ level: 'warn', msg: `the timeline is registered as "${keys[0]}" but the root's data-composition-id is "${meta.id}"; they must match` });
  if (/gsap\./.test(code) && !/<script\b[^>]*\bsrc\s*=\s*["'][^"']*gsap[^"']*["']|from\s+["'][^"']*gsap/i.test(text)) out.push({ level: 'error', msg: 'uses gsap but never loads it; add <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script> (or copy gsap.min.js next to the page)' });
  if (meta.dur === undefined && (/\binfinite\b/.test(css) || /repeat\s*:\s*-1/.test(code))) out.push({ level: 'warn', msg: 'an animation repeats forever and the root has no data-duration; set one so the length is known' });
  if (/<audio\b/i.test(text) || /<video\b(?![^>]*\bmuted\b)/i.test(text)) out.push({ level: 'note', msg: 'sound inside an HTML scene is not exported; add music, sound effects or voice-over in Cutroom' });
  if (meta.remote.length) out.push({ level: 'note', msg: `loads ${[...new Set(meta.remote.map((u) => new URL(u).host))].join(', ')} from the internet; previews and exports need a connection (or copy those files next to the page)` });
  if (meta.subs.length) out.push({ level: 'note', msg: `mounts ${meta.subs.length} sub-composition file(s): ${meta.subs.join(', ')}` });
  return out;
}

// A small page that already follows the rules: root, size, length, CSS keyframes on clip time
export function starterHtml(o: { id: string; w: number; h: number; sec: number; title: string; theme?: Theme }): string {
  const accent = o.theme?.accent ?? '#3b6ef5';
  const [bg1, bg2] = o.theme?.bg ?? ['#0b1020', '#1a2140'];
  const big = Math.round(Math.min(o.w, o.h) * 0.1);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  #root { position: relative; overflow: hidden; font-family: system-ui, "Noto Sans SC", sans-serif; color: #fff;
    background: linear-gradient(160deg, ${bg1}, ${bg2}); }
  .clip { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: ${Math.round(big * 0.3)}px; }
  h1 { margin: 0; font-size: ${big}px; line-height: 1.1; animation: rise 0.7s cubic-bezier(.2,.7,.2,1) 0.2s both; }
  .bar { justify-self: center; width: ${Math.round(big * 3)}px; height: ${Math.max(6, Math.round(big * 0.09))}px; border-radius: 99px; background: ${accent};
    transform-origin: left; animation: draw 0.8s cubic-bezier(.6,0,.2,1) 0.6s both; }
  p { margin: 0; font-size: ${Math.round(big * 0.38)}px; opacity: .8; animation: rise 0.6s cubic-bezier(.2,.7,.2,1) 0.9s both; }
  @keyframes rise { from { opacity: 0; transform: translateY(${Math.round(big * 0.4)}px); } to { opacity: 1; transform: none; } }
  @keyframes draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
</head>
<body>
<div id="root" data-composition-id="${o.id}" data-width="${o.w}" data-height="${o.h}" data-duration="${o.sec}">
  <section class="clip" data-start="0" data-duration="${o.sec}">
    <h1>${o.title.replace(/</g, '&lt;')}</h1>
    <div class="bar"></div>
    <p>Edit scenes/${o.id}/index.html</p>
  </section>
</div>
</body>
</html>
`;
}
