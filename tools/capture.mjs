// Deterministic browser capture: virtual clock + per-frame screenshots piped to ffmpeg, with an event log
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VCLOCK = readFileSync(join(HERE, 'vclock.js'), 'utf8');

// Seeded RNG for human-like jitter
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function record(name, opts, script) {
  const {
    url,
    outDir,
    viewport = { width: 1440, height: 810 },
    dpr = 2,
    fps = 30,
    mobile = false,
    colorScheme = 'light',
    locale = 'en-US',
    headless = true,
    gpu = true,
    crf = 12,
    init,
    seed = 7,
    settle,
    settleMs = 4000,
    clip,
  } = opts;
  mkdirSync(outDir, { recursive: true });
  const args = ['--hide-scrollbars', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
  if (gpu) args.push('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');
  const browser = await chromium.launch({ channel: 'chrome', headless, args });
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme,
    locale,
  });
  await ctx.addInitScript(VCLOCK);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', (e) => console.warn(`[${name}] pageerror:`, e.message));

  let W = viewport.width * dpr;
  let H = viewport.height * dpr;
  let region = null;
  const out = join(outDir, `${name}.mp4`);
  let ff = null;
  let ffDone = Promise.resolve();
  const openFF = () => {
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-vf', `scale=${W}:${H}:flags=lanczos`];
    args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-g', String(fps), '-movflags', '+faststart', out);
    ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    ffDone = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)))));
  };

  const events = [];
  let frame = 0;
  let mouse = { x: viewport.width / 2, y: viewport.height / 2 };
  let recording = false;
  const rand = rng(seed);
  const dt = 1000 / fps;
  const t = () => +(frame / fps).toFixed(4);
  const log = (e) => events.push({ t: t(), ...e });
  const px = (p) => ({ x: Math.round(p.x * dpr), y: Math.round(p.y * dpr) });

  // Wait in real time until the page reports ready, repainting without moving the clock
  async function settleFrame() {
    if (!settle) return;
    const end = Date.now() + settleMs;
    while (Date.now() < end) {
      const ok = await page.evaluate(typeof settle === 'string' ? `(${settle})()` : settle).catch(() => true);
      if (ok) break;
      await new Promise((res) => setTimeout(res, 40));
      await page.evaluate(() => window.__vt && window.__vt.advance(0));
    }
    await page.evaluate(() => window.__vt && window.__vt.advance(0));
  }

  async function snap() {
    await page.evaluate((ms) => window.__vt && window.__vt.advance(ms), dt);
    if (!recording) return;
    await settleFrame();
    await page.evaluate(() => window.__vt && window.__vt.mediaReady && window.__vt.mediaReady());
    const shot = { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false };
    if (region) shot.clip = { ...region, scale: 1 };
    const { data } = await cdp.send('Page.captureScreenshot', shot);
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
    frame++;
    if (frame % (fps * 5) === 0) console.log(`[${name}] ${frame / fps}s captured`);
  }

  async function point(target) {
    if (typeof target === 'string') {
      const loc = page.locator(target).first();
      const b = await loc.boundingBox();
      if (!b) throw new Error(`no box for ${target}`);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
    }
    return target;
  }

  const r = {
    page,
    cdp,
    events,
    get time() {
      return t();
    },
    async goto(u = url, { wait = 'load' } = {}) {
      await page.goto(u, { waitUntil: wait });
    },
    // Start emitting frames
    async start() {
      if (clip) {
        const b = await page.locator(clip).first().boundingBox();
        region = { x: b.x, y: b.y, width: b.width, height: b.height };
        W = Math.round(b.width * dpr / 2) * 2;
        H = Math.round(b.height * dpr / 2) * 2;
      }
      if (!ff) openFF();
      recording = true;
      log({ type: 'move', ...px(mouse) });
    },
    pause() {
      recording = false;
    },
    async wait(ms) {
      const n = Math.round(ms / dt);
      for (let i = 0; i < n; i++) await snap();
    },
    // Real-time wait with virtual clock ticking, no frames
    async until(pred, { timeout = 20000, arg } = {}) {
      const end = Date.now() + timeout;
      for (;;) {
        const code = typeof pred === 'string' && /=>|^\s*function/.test(pred);
        const ok = code
          ? await page.evaluate(`(${pred})()`).catch(() => false)
          : typeof pred === 'string'
            ? (await page.locator(pred).count()) > 0
            : await page.evaluate(pred, arg).catch(() => false);
        if (ok) return;
        if (Date.now() > end) throw new Error(`until timeout: ${pred}`);
        await page.evaluate((ms) => window.__vt && window.__vt.advance(ms), dt);
        await new Promise((res) => setTimeout(res, 50));
      }
    },
    async move(target, { ms } = {}) {
      const p = await point(target);
      const from = { ...mouse };
      const dist = Math.hypot(p.x - from.x, p.y - from.y);
      const dur = ms ?? Math.min(1100, Math.max(420, 300 + dist * 0.6));
      const n = Math.max(1, Math.round(dur / dt));
      const bend = (rand() - 0.5) * 0.25 * dist;
      const nx = -(p.y - from.y) / (dist || 1);
      const ny = (p.x - from.x) / (dist || 1);
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        const arc = Math.sin(k * Math.PI) * bend;
        mouse = { x: from.x + (p.x - from.x) * k + nx * arc, y: from.y + (p.y - from.y) * k + ny * arc };
        await page.mouse.move(mouse.x, mouse.y);
        log({ type: 'move', ...px(mouse) });
        await snap();
      }
      return p;
    },
    async click(target, { ms, hold = 90, after = 250 } = {}) {
      await r.move(target, { ms });
      await r.wait(120);
      log({ type: 'down', ...px(mouse) });
      await page.mouse.down();
      await r.wait(hold);
      await page.mouse.up();
      log({ type: 'up', ...px(mouse) });
      await r.wait(after);
    },
    async type(text, { cps = 11, after = 300 } = {}) {
      for (const ch of text) {
        await page.keyboard.type(ch);
        log({ type: 'key', name: ch });
        await r.wait((1000 / cps) * (0.6 + rand() * 0.8));
      }
      await r.wait(after);
    },
    async press(key, { after = 300 } = {}) {
      await page.keyboard.press(key);
      log({ type: 'key', name: key });
      await r.wait(after);
    },
    // Eased scroll of window or a scrollable element
    async scroll(dy, { ms = 900, el } = {}) {
      const n = Math.max(1, Math.round(ms / dt));
      let done = 0;
      log({ type: 'scroll', y: dy });
      for (let i = 1; i <= n; i++) {
        const want = Math.round(dy * ease(i / n));
        const step = want - done;
        done = want;
        await page.evaluate(([s, sel]) => (sel ? document.querySelector(sel).scrollBy(0, s) : window.scrollBy(0, s)), [step, el ?? null]);
        await snap();
      }
    },
    // Press, move along an eased path, release (sliders, map pans)
    async drag(from, to, { ms = 900 } = {}) {
      await r.move(from);
      log({ type: 'down', ...px(mouse) });
      await page.mouse.down();
      await r.wait(120);
      await r.move(to, { ms });
      await page.mouse.up();
      log({ type: 'up', ...px(mouse) });
      await r.wait(250);
    },
    // Point on an element: fx/fy are fractions of its box
    async at(sel, fx = 0.5, fy = 0.5) {
      const b = await page.locator(sel).first().boundingBox();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    },
    async wheel(dy, { steps = 3, gap = 180 } = {}) {
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, dy / steps);
        log({ type: 'scroll', y: dy / steps });
        await r.wait(gap);
      }
    },
    // Scroll so a target sits `offset` px below the top of the window or scroller
    async scrollTo(target, { ms = 1000, el, offset = 80 } = {}) {
      const dy = await page.evaluate(([sel, box, off]) => {
        const e = document.querySelector(sel);
        const top = box ? document.querySelector(box).getBoundingClientRect().top : 0;
        return Math.round(e.getBoundingClientRect().top - top - off);
      }, [target, el ?? null, offset]);
      if (Math.abs(dy) > 2) await r.scroll(dy, { ms, el });
    },
    // Pick a <select> option by visible text match
    async select(sel, re, { after = 600 } = {}) {
      await r.click(sel, { after: 350 });
      const pick = await page.evaluate(([s2, src]) => {
        const el = document.querySelector(s2);
        const rx = new RegExp(src, 'i');
        const i = [...el.options].findIndex((x) => rx.test(x.textContent));
        return i < 0 ? null : { i, cur: el.selectedIndex, value: el.options[i].value };
      }, [sel, re.source ?? String(re)]);
      if (pick === null) throw new Error(`no option ${re} in ${sel}`);
      // Walk the open list like a person, then confirm
      const key = pick.i >= pick.cur ? 'ArrowDown' : 'ArrowUp';
      for (let k = 0; k < Math.abs(pick.i - pick.cur); k++) {
        await page.keyboard.press(key);
        await r.wait(70);
      }
      await page.keyboard.press('Enter');
      log({ type: 'key', name: 'select' });
      const ok = await page.evaluate(([s2, v]) => document.querySelector(s2).value === v, [sel, pick.value]);
      if (!ok) {
        await page.selectOption(sel, pick.value);
        await page.keyboard.press('Escape');
      }
      await r.wait(after);
    },
    mark(name) {
      log({ type: 'mark', name });
    },
    // Camera hint: zoom on a target until unzoom()
    async zoom(target, scale = 1.8) {
      const p = await point(target);
      log({ type: 'zoom', ...px(p), scale });
    },
    unzoom() {
      log({ type: 'unzoom' });
    },
    async still(file, { fullPage = true } = {}) {
      await page.screenshot({ path: join(outDir, file), fullPage });
    },
  };

  try {
    await script(r);
  } finally {
    if (ff) ff.stdin.end();
    await ffDone.catch((e) => frame && console.error(e));
    await browser.close();
  }
  const meta = { width: W, height: H, fps, dpr, mobile, viewport, duration: +(frame / fps).toFixed(3), events };
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(meta));
  console.log(`captured ${name}: ${frame} frames, ${meta.duration}s, ${events.length} events -> ${out}`);
  return meta;
}
