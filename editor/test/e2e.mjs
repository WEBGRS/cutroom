// End-to-end: drives the editor in headless Chrome against a throwaway copy of a project.
// Needs the server running (npm run editor). Usage: node editor/test/e2e.mjs [source-slug]
// E2E_AI=1 also sends one real message through the AI panel.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.EDITOR_URL ?? 'http://127.0.0.1:8814';
const SRC = process.argv[2] ?? 'showcase';
const SLUG = '_edtest';
const PUB = path.resolve('public');
const DIR = path.join(PUB, SLUG);
const SHOTS = path.resolve('.scratch/editor-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

// Which scene plays which part in each test project
const ROLES = {
  showcase: { screen: 'record', mark: '@filter', moveA: 'numbers', moveB: 'photo', split: 'record', caption: '光标', cli: 'intro', fx: 'photo', dup: 'intro', chat: 'intro', beat: 'record', beatHidden: null },
};
const R = ROLES[SRC];
if (!R) throw new Error(`no roles for ${SRC}; add it to ROLES`);
const VOICED = fs.existsSync(path.join(PUB, SRC, 'timings.json'));

// Copy only the small JSON files; media is reached through ../<src>/
function setup() {
  fs.mkdirSync(DIR, { recursive: true });
  const board = JSON.parse(fs.readFileSync(path.join(PUB, SRC, 'storyboard.json'), 'utf8'));
  board.slug = SLUG;
  for (const s of board.scenes) for (const v of [s.visual, s.tall]) if (v && v.src && !v.src.startsWith('../')) v.src = `../${SRC}/${v.src}`;
  fs.writeFileSync(path.join(DIR, 'storyboard.json'), JSON.stringify(board, null, 2));
  for (const f of ['timings.json', 'timings-en.json']) {
    const p = path.join(PUB, SRC, f);
    if (!fs.existsSync(p)) continue;
    const t = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const clips of Object.values(t.scenes)) for (const c of clips) c.file = `../${SRC}/${c.file}`;
    fs.writeFileSync(path.join(DIR, f), JSON.stringify(t, null, 1));
  }
}
function cleanup() {
  for (const f of ['storyboard.json', 'timings.json', 'timings-en.json']) fs.rmSync(path.join(DIR, f), { force: true });
  const media = path.join(DIR, 'media');
  if (fs.existsSync(media)) {
    for (const f of fs.readdirSync(media)) fs.rmSync(path.join(media, f));
    fs.rmdirSync(media);
  }
  for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) if (f.endsWith('.tmp')) fs.rmSync(path.join(DIR, f));
  if (fs.existsSync(DIR)) fs.rmdirSync(DIR);
  fs.rmSync(path.resolve('.editor', SLUG), { recursive: true, force: true });
}

const board = () => JSON.parse(fs.readFileSync(path.join(DIR, 'storyboard.json'), 'utf8'));
const timings = () => JSON.parse(fs.readFileSync(path.join(DIR, 'timings.json'), 'utf8'));
const ids = () => board().scenes.map((s) => s.id);
const sceneOf = (id) => board().scenes.find((s) => s.id === id);
const log = () => fs.readFileSync(path.resolve('.editor', SLUG, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
async function until(what, fn, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (fn()) return;
    } catch {
      // file mid-write
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
  await page.screenshot({ path: path.join(SHOTS, `${String(results.length).padStart(2, '0')}-${name.replace(/\W+/g, '_')}.png`) });
}

setup();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, colorScheme: 'dark' });
const errors = [];
// The stale-save step's 409 is expected
page.on('console', (m) => m.type() === 'error' && !m.text().includes('409 (Conflict)') && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

const block = (id) => page.locator('.clip', { has: page.locator('.name', { hasText: new RegExp(`^${id}$`) }) });
async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}
const view = async (format, mode) => {
  await page.getByRole('button', { name: format === 'tall' ? '竖屏' : '横屏', exact: true }).click();
  await page.getByRole('button', { name: mode === 'beat' ? '卡点版' : '旁白版', exact: true }).click();
  await page.waitForTimeout(1500);
};
const fc = (label) => page.locator('.fc', { has: page.locator('.fl', { hasText: new RegExp(`^${label}$`) }) });

try {
  await page.goto(`${BASE}/?slug=${SLUG}&format=wide&mode=voice&lang=zh&variant=default`);
  await page.waitForSelector('.clip', { timeout: 15000 });
  await page.getByRole('button', { name: '属性' }).click();
  await page.waitForTimeout(800);

  await step('select scene', async () => {
    await block(R.screen).click();
    const h = await page.locator('.insp h2').textContent();
    if (!h.startsWith(R.screen)) throw new Error(`inspector shows ${h}`);
  });

  await step('edit narration text', async () => {
    await page.locator('.insp .item textarea').first().fill('改过的旁白（测试）');
    await page.locator('.insp h2').click();
    await until('file updated', () => sceneOf(R.screen).lines[0].zh === '改过的旁白（测试）');
    const last = log().at(-1);
    if (last.src !== 'ui' || !last.desc.join('').includes('lines.0.zh')) throw new Error(`log ${JSON.stringify(last)}`);
    if (VOICED && !(await page.locator('.cap.stale').count())) throw new Error('stale voice not flagged');
  });

  await step('drag to reorder', async () => {
    const s = await block(R.moveA).boundingBox();
    const m = await block(R.moveB).boundingBox();
    await drag({ x: s.x + s.width / 2, y: s.y + s.height / 2 }, { x: m.x + 8, y: m.y + m.height / 2 });
    await until('order changed', () => ids().indexOf(R.moveA) === ids().indexOf(R.moveB) - 1);
  });

  await step('trim keeps the mark anchor', async () => {
    const before = sceneOf(R.screen).visual.to;
    const b = await block(R.screen).boundingBox();
    await drag({ x: b.x + b.width - 3, y: b.y + b.height / 2 }, { x: b.x + b.width - 60, y: b.y + b.height / 2 });
    await until('to changed', () => sceneOf(R.screen).visual.to !== before);
    const to = sceneOf(R.screen).visual.to;
    if (!String(to).startsWith(R.mark)) throw new Error(`to = ${to}`);
  });

  await step('split at playhead moves the voice clip', async () => {
    await page.locator('.cap', { hasText: R.caption }).click();
    await page.waitForTimeout(200);
    await page.keyboard.press('s');
    await until('split exists', () => ids().includes(`${R.split}-2`));
    if (VOICED) await until('timings split', () => timings().scenes[`${R.split}-2`]?.length === 1 && timings().scenes[R.split].length === 1);
    else if (sceneOf(R.split).lines.length !== 1 || sceneOf(`${R.split}-2`).lines.length !== 1) throw new Error('lines not split 1/1');
  });

  await step('undo restores storyboard and timings', async () => {
    await page.keyboard.press('Control+z');
    await until('split gone', () => !ids().includes(`${R.split}-2`) && (!VOICED || timings().scenes[R.split].length === 2));
  });

  await step('CLI edit reaches the page', async () => {
    execFileSync(process.execPath, ['editor/dist/cli.mjs', SLUG, 'set', R.cli, 'lines.0.en', '"Edited from the CLI"']);
    await page.locator('.toast', { hasText: 'Claude' }).waitFor({ timeout: 5000 });
    await block(R.cli).click();
    await page.locator('.insp input[value="Edited from the CLI"]').waitFor({ timeout: 3000 });
  });

  await step('stale save gets 409', async () => {
    const status = await page.evaluate(async (slug) => {
      const r = await fetch(`/api/board?slug=${slug}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: { scenes: [] }, base: 'stale', desc: [] }) });
      return r.status;
    }, SLUG);
    if (status !== 409) throw new Error(`status ${status}`);
  });

  await step('beat cut: resize in whole bars', async () => {
    await view('tall', 'beat');
    if (R.beatHidden) {
      const hidden = await page.locator('.tl-tools .hint').textContent();
      if (!hidden.includes(R.beatHidden)) throw new Error(`hidden: ${hidden}`);
    }
    const n0 = sceneOf(R.beat).beat.at(-1).n ?? 4;
    const total0 = sceneOf(R.beat).beat.reduce((a, b) => a + (b.n ?? 4), 0);
    const b = await block(R.beat).boundingBox();
    const bar = b.width / Math.ceil(total0 / 4);
    await drag({ x: b.x + b.width - 3, y: b.y + b.height / 2 }, { x: b.x + b.width - 3 + bar, y: b.y + b.height / 2 });
    await until('last phrase grew', () => sceneOf(R.beat).beat.at(-1).n === n0 + 4);
  });

  await step('effects panel writes fx', async () => {
    await view('wide', 'voice');
    await block(R.fx).click();
    const v0 = sceneOf(R.fx).fx?.vignette ?? 0;
    await fc('滤镜').locator('select').selectOption('cool');
    await until('look', () => sceneOf(R.fx).fx?.look === 'cool');
    const r = fc('暗角').locator('input[type=range]');
    await r.focus();
    for (let i = 0; i < 6; i++) await r.press('ArrowRight');
    await until('vignette', () => (sceneOf(R.fx).fx?.vignette ?? 0) > v0);
  });

  await step('transition and overlay', async () => {
    await page.locator('.sec', { hasText: '进入这一段的方式' }).locator('select').first().selectOption('dip');
    await until('dip', () => sceneOf(R.fx).transition === 'dip');
    const n = sceneOf(R.fx).overlays?.length ?? 0;
    await page.locator('select.add-sel').selectOption('box');
    await until('overlay', () => sceneOf(R.fx).overlays?.length === n + 1 && sceneOf(R.fx).overlays.at(-1).kind === 'box');
  });

  await step('add scene from menu', async () => {
    const n = ids().length;
    await page.locator('.tl-tools .menu > button', { hasText: '添加' }).click();
    await page.locator('.menu-pop button', { hasText: /^标题卡$/ }).click();
    await until('title scene', () => ids().length === n + 1 && board().scenes.some((s) => s.id.startsWith('title-') && s.visual.kind === 'title'));
  });

  await step('import image becomes a scene', async () => {
    const png = path.join(SHOTS, 'import.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=640x360', '-frames:v', '1', png]);
    await page.locator('input[type=file]').setInputFiles(png);
    await until('image scene', () => board().scenes.some((s) => s.visual.kind === 'image' && s.visual.src.startsWith('media/')), 10000);
  });

  await step('board caption style', async () => {
    await page.keyboard.press('Escape');
    await page.locator('.tl .ruler').click({ position: { x: 300, y: 10 } });
    await page.keyboard.press('Escape');
    await fc('样式').locator('select').selectOption('outline');
    await until('captions', () => board().captions?.style === 'outline');
  });

  await step('Ctrl+D duplicates', async () => {
    await block(R.dup).click();
    await page.keyboard.press('Control+d');
    await until('dup', () => ids().includes(`${R.dup}-2`));
  });

  await step('SRT export', async () => {
    await page.locator('.split-btn .more').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.menu-pop button', { hasText: '字幕文件 SRT' }).click()]);
    const text = fs.readFileSync(await dl.path(), 'utf8');
    if (!/\d\d:\d\d:\d\d,\d{3} --> /.test(text)) throw new Error(text.slice(0, 120));
  });

  await step('chat tab', async () => {
    await page.getByRole('button', { name: 'AI 助手' }).click();
    await page.locator('.chat-head').waitFor();
    if (process.env.E2E_AI) {
      await page.locator('.chat-input textarea').fill(`把 ${R.chat} 这一段的滤镜改成黑白`);
      await page.keyboard.press('Enter');
      await until('ai edit', () => sceneOf(R.chat).fx?.look === 'mono', 120000);
      await page.locator('.msg.bot .txt').first().waitFor({ timeout: 30000 });
    }
  });

  await step('no console errors', async () => {
    if (errors.length) throw new Error(errors.slice(0, 5).join(' | '));
  });
} finally {
  await browser.close();
  cleanup();
}
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
