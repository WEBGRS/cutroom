// Screenshots of every editor state (panels, tabs, menus, dialogs, AI panel, error states, small window) for UI review.
// Needs the server running. Usage: node editor/test/uishots.mjs [outDir] [voicedSlug]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? '.scratch/uishots');
// A project with narration and beat music; defaults to the demo
const VOICED = process.argv[3] ?? 'showcase';
fs.mkdirSync(OUT, { recursive: true });
const ROOT = process.cwd();
const B = process.env.EDITOR_URL ?? 'http://127.0.0.1:8814';
const PUB = path.join(ROOT, 'public');

// Throwaway projects: a showcase copy with a chat history, and a broken one
function setup() {
  const src = JSON.parse(fs.readFileSync(path.join(PUB, 'showcase', 'storyboard.json'), 'utf8'));
  src.slug = '_shots';
  for (const s of src.scenes) for (const v of [s.visual, s.tall]) if (v && v.src && !v.src.startsWith('../')) v.src = `../showcase/${v.src}`;
  fs.mkdirSync(path.join(PUB, '_shots'), { recursive: true });
  fs.writeFileSync(path.join(PUB, '_shots', 'storyboard.json'), JSON.stringify(src, null, 2));
  fs.mkdirSync(path.join(ROOT, '.editor', '_shots'), { recursive: true });
  const t = new Date().toISOString();
  fs.writeFileSync(
    path.join(ROOT, '.editor', '_shots', 'chat.json'),
    JSON.stringify({
      log: [
        { role: 'user', text: '把 photo 这段改成暖色，再慢慢推近一点', t },
        { role: 'assistant', text: '改好了：photo 加了暖色滤镜（fx.look = warm），慢推幅度从 0.08 调到 0.14。', tools: [{ cmd: 'show photo', ok: true }, { cmd: 'set photo fx.look "warm"', ok: true }, { cmd: 'set photo fx.kbAmount 0.14', ok: true }], t },
        { role: 'user', text: '字幕换成描边样式', t },
        { role: 'assistant', text: '字幕样式改成了描边（captions.style = outline），其他段落不受影响。', tools: [{ cmd: 'set - captions.style "outline"', ok: true }], t },
      ],
    }),
  );
  fs.mkdirSync(path.join(PUB, '_broken'), { recursive: true });
  fs.writeFileSync(path.join(PUB, '_broken', 'storyboard.json'), JSON.stringify({ slug: '_broken', title: 'Broken', theme: { accent: '#5b8cff' }, scenes: [{ id: 'gone', visual: { kind: 'screen', src: 'cap/missing.mp4' }, lines: [{ zh: '这个录屏不存在' }] }] }, null, 2));
}
function cleanup() {
  for (const d of ['_shots', '_broken']) {
    fs.rmSync(path.join(PUB, d), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, '.editor', d), { recursive: true, force: true });
  }
}

setup();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function open(q, { w = 1600, h = 960, dpr = 1, ls = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: 'dark' });
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((ls) => {
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  }, { 'vs-side': 'props', 'vs-lib': 'media', 'vs-itab': 'visual', 'vs-btab': 'basic', ...ls });
  await page.goto(`${B}/?${q}`);
  return page;
}
const ready = async (page) => {
  await page.waitForSelector('.clip', { timeout: 20000 });
  await page.waitForTimeout(1800);
};
const clip = (page, id) => page.locator('.clip', { has: page.locator('.name', { hasText: new RegExp(`^${id}$`) }) });
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
const crop = async (page, sel, name, extra = {}) => {
  const b = await page.locator(sel).first().boundingBox();
  await shot(page, name, { clip: { ...b, ...extra } });
};
const SC = 'slug=_shots&format=wide&mode=voice&lang=zh&variant=default';
const lib = async (p, name) => {
  await p.locator('.lib-tabs button', { hasText: name }).click();
  await p.waitForTimeout(500);
};
const itab = (p, name) => p.locator('.itabs button', { hasText: name }).click();

try {
  let p = await open(`${SC}&frame=200`);
  await ready(p);
  await shot(p, '01-board-media');
  await itab(p, 'Sound');
  await lib(p, 'Music');
  await shot(p, '02-board-audio-libmusic');
  await itab(p, 'Captions');
  await lib(p, 'Cards');
  await p.waitForTimeout(800);
  await shot(p, '03-board-captions-libcards');
  await itab(p, 'Frame');
  await lib(p, 'Backdrop');
  await p.waitForTimeout(800);
  await shot(p, '04-board-frame-libbackdrop');

  await clip(p, 'record').click();
  await p.waitForTimeout(600);
  await itab(p, 'Picture');
  await lib(p, 'Effects');
  await p.waitForTimeout(1200);
  await shot(p, '05-scene-visual-libeffects');
  await itab(p, 'Transition');
  await lib(p, 'Transitions');
  await p.waitForTimeout(800);
  await shot(p, '06-scene-trans-libtrans');
  await p.locator('.lt', { hasText: 'Whip pan' }).first().hover();
  await p.waitForTimeout(900);
  await crop(p, '.lib', '07-lib-trans-hover');
  await itab(p, 'Effects');
  await lib(p, 'Text');
  await p.waitForTimeout(800);
  await shot(p, '08-scene-fx-libtext');
  await itab(p, 'Overlays');
  await lib(p, 'Overlays');
  await p.waitForTimeout(800);
  await shot(p, '09-scene-overlays-liboverlays');
  await itab(p, 'Narration');
  await p.waitForTimeout(300);
  await crop(p, '.side', '10-scene-lines-side');
  await clip(p, 'photo').click();
  await itab(p, 'Sound');
  await lib(p, 'Sound FX');
  await p.waitForTimeout(800);
  await shot(p, '10b-scene-sound-libsfx');

  // menus, dialog, toasts
  await p.locator('.tl-tools .menu > button', { hasText: 'Add' }).click();
  await p.waitForTimeout(250);
  await shot(p, '11-add-menu');
  await p.keyboard.press('Escape');
  await p.mouse.click(800, 400);
  await p.locator('.split-btn .more').click();
  await p.waitForTimeout(250);
  await crop(p, 'body', '12-export-menu', { x: 1000, y: 0, width: 600, height: 420 });
  await p.mouse.click(800, 400);
  await p.locator('.ghost.lang').click();
  await p.waitForTimeout(250);
  await crop(p, 'body', '12b-lang-menu', { x: 1000, y: 0, width: 600, height: 300 });
  await p.mouse.click(800, 400);
  await p.evaluate(() => {
    const s = document.querySelector('.proj select');
    s.value = '__new';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  await shot(p, '13-new-project');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await clip(p, 'photo').click();
  await p.keyboard.press('Control+Alt+c');
  await p.waitForTimeout(250);
  await crop(p, 'body', '14-toast', { x: 400, y: 0, width: 800, height: 120 });
  await p.keyboard.press('Escape');
  await p.keyboard.press('q');
  await p.waitForTimeout(250);
  await crop(p, 'body', '15-toast-error', { x: 400, y: 0, width: 800, height: 120 });

  // Ctrl+click pointing: highlight, then chips in the AI input
  await p.keyboard.down('Control');
  const fb = await p.locator('.frame').boundingBox();
  await p.mouse.move(fb.x + fb.width * 0.4, fb.y + fb.height * 0.7);
  await p.waitForTimeout(300);
  await shot(p, '15b-pick-hover');
  await p.mouse.click(fb.x + fb.width * 0.4, fb.y + fb.height * 0.7);
  await p.locator('.sfx').first().click();
  await p.keyboard.up('Control');
  await p.waitForTimeout(500);
  await shot(p, '15c-pick-chips');

  // drop overlay
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(250);
  await shot(p, '16-drop');
  await p.close();

  // AI panel: conversation, settings
  p = await open(SC, { ls: { 'vs-side': 'ai' } });
  await ready(p);
  await p.waitForTimeout(800);
  await shot(p, '17-ai-chat');
  await p.locator('.conn').click();
  await p.waitForTimeout(400);
  await crop(p, '.side', '18-ai-settings');
  await p.close();

  // tall + beat on a voiced project
  p = await open(`slug=${VOICED}&format=tall&mode=beat&lang=zh&variant=default&frame=420`);
  await ready(p);
  await shot(p, '19-tall-beat');
  await p.close();
  p = await open(`slug=${VOICED}&format=wide&mode=voice&lang=zh&variant=default&frame=930`, { dpr: 2 });
  await ready(p);
  await p.locator('.clip').nth(1).click();
  await p.waitForTimeout(800);
  await crop(p, '.tl', '20-timeline-2x', { width: 1100 });
  await itab(p, 'Effects');
  await p.waitForTimeout(300);
  await crop(p, '.side', '21-insp-fx-2x');
  await lib(p, 'Media');
  await p.waitForTimeout(1200);
  await crop(p, '.lib', '22-lib-media-2x');
  await p.close();

  // Chinese interface
  p = await open(`${SC}&frame=200&ui=zh`);
  await ready(p);
  await clip(p, 'photo').click();
  await lib(p, '叠加');
  await p.waitForTimeout(800);
  await shot(p, '22b-chinese');
  await p.close();

  // small window, error project, AI not connected look
  p = await open(`${SC}&frame=300`, { w: 1280, h: 760 });
  await ready(p);
  await clip(p, 'record').click();
  await p.waitForTimeout(600);
  await shot(p, '23-narrow-1280');
  await p.close();
  p = await open('slug=_broken&format=wide&mode=voice&lang=zh&variant=default');
  await p.waitForTimeout(3500);
  await shot(p, '24-broken');
  await p.close();

  // AI panel with no conversation, then with no usable connection
  p = await open('slug=_broken&format=wide&mode=voice&lang=zh&variant=default', { ls: { 'vs-side': 'ai' } });
  await p.waitForTimeout(2500);
  await crop(p, '.side', '25-ai-empty');
  await p.close();
  const settings = path.join(ROOT, '.editor', 'settings.json');
  const had = fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null;
  try {
    await fetch(`${B}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pref: 'anthropic' }) });
    p = await open('slug=_broken&format=wide&mode=voice&lang=zh&variant=default', { ls: { 'vs-side': 'ai' } });
    await p.waitForTimeout(2500);
    await crop(p, '.side', '26-ai-offline');
    await p.close();
  } finally {
    if (had === null) fs.rmSync(settings, { force: true });
    else fs.writeFileSync(settings, had);
  }
} finally {
  await browser.close();
  cleanup();
}
console.log(errors.length ? 'console errors:\n' + [...new Set(errors)].join('\n') : 'no console errors');
console.log(fs.readdirSync(OUT).join('\n'));
