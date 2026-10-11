// Screen recordings of web pages for the CLI and the AI assistant: look at a page, then record scripted steps
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain JS module
import { record } from '../../tools/capture.mjs';
import { PUBLIC, ROOT } from './store';

// ffmpeg from Remotion's compositor package when present, so no system install is needed
export function ffmpegBin(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dir = ['compositor-win32-x64-msvc', 'compositor-darwin-arm64', 'compositor-darwin-x64', 'compositor-linux-x64-gnu', 'compositor-linux-arm64-gnu']
    .map((n) => path.join(ROOT, 'node_modules', '@remotion', n))
    .find((d) => fs.existsSync(path.join(d, exe)));
  return dir ? path.join(dir, exe) : 'ffmpeg';
}

// Installed Chrome, else Edge (always present on Windows), else Chromium on PATH
export function findBrowser(): { executablePath: string } | null {
  if (process.env.CUTROOM_BROWSER && fs.existsSync(process.env.CUTROOM_BROWSER)) return { executablePath: process.env.CUTROOM_BROWSER };
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const list =
    process.platform === 'win32'
      ? [...pf.map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')), ...pf.map((d) => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const hit = list.find((f) => fs.existsSync(f));
  return hit ? { executablePath: hit } : null;
}

// One action per step; selectors are CSS or Playwright's text="…" / role=button[name="…"]
export type Step =
  | { wait: number }
  | { idle: number }
  | { goto: string }
  | { until: string }
  | { click: string }
  | { hover: string }
  | { fill: [string, string] }
  | { type: string }
  | { press: string }
  | { select: [string, string] }
  | { scroll: number; ms?: number }
  | { scrollTo: string }
  | { mark: string }
  | { zoom: string; scale?: number }
  | { unzoom: true };

const ACTIONS = ['wait', 'idle', 'goto', 'until', 'click', 'hover', 'fill', 'type', 'press', 'select', 'scroll', 'scrollTo', 'mark', 'zoom', 'unzoom'];

export function parseSteps(json: unknown): Step[] {
  if (!Array.isArray(json)) throw new Error('steps must be a JSON array, e.g. [{"wait":800},{"click":"text=\\"Sign up\\""},{"type":"hello"}]');
  return json.map((s, i) => {
    const keys = s && typeof s === 'object' ? Object.keys(s).filter((k) => ACTIONS.includes(k)) : [];
    if (keys.length !== 1) throw new Error(`step ${i + 1} needs exactly one of: ${ACTIONS.join(', ')} (got ${JSON.stringify(s)})`);
    const k = keys[0];
    const v = (s as Record<string, unknown>)[k];
    const okStr = typeof v === 'string' && v.length > 0;
    const okNum = typeof v === 'number' && Number.isFinite(v);
    const okPair = Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string');
    const ok = ['wait', 'idle', 'scroll'].includes(k) ? okNum : ['fill', 'select'].includes(k) ? okPair : k === 'unzoom' ? true : okStr;
    if (!ok) throw new Error(`step ${i + 1}: bad value for "${k}": ${JSON.stringify(v)}`);
    return s as Step;
  });
}

// A short look around the page when no steps are given: settle, scroll down twice, back up
const TOUR = (vh: number): Step[] => [{ wait: 1200 }, { scroll: Math.round(vh * 0.7) }, { wait: 900 }, { scroll: Math.round(vh * 0.7) }, { wait: 900 }, { scroll: -Math.round(vh * 1.4), ms: 1400 }, { wait: 800 }];

export interface RecordOpts {
  slug: string;
  name: string;
  url: string;
  steps?: Step[];
  mobile?: boolean;
  size?: { width: number; height: number };
  dpr?: number;
  log?: (s: string) => void;
}

export async function recordPage(o: RecordOpts): Promise<{ file: string; duration: number; marks: { name: string; t: number }[]; width: number; height: number }> {
  if (!/^https?:\/\/|^file:\/\//i.test(o.url)) throw new Error('the address must start with http://, https:// or file://');
  const name = o.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  const browser = findBrowser();
  if (!browser) throw new Error('No browser found for recording: install Google Chrome or Microsoft Edge');
  const viewport = o.size ?? (o.mobile ? { width: 410, height: 480 } : { width: 1280, height: 720 });
  const outDir = path.join(PUBLIC, o.slug, 'cap');
  // Remotion's Linux ffmpeg loads its libraries from its own folder
  const ff = ffmpegBin();
  if (process.platform === 'linux' && ff !== 'ffmpeg') process.env.LD_LIBRARY_PATH = [path.dirname(ff), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  const steps = o.steps?.length ? o.steps : TOUR(viewport.height);
  const log = o.log ?? (() => undefined);
  const meta = await record(
    name,
    { url: o.url, outDir, viewport, dpr: o.dpr ?? (o.mobile ? 2.4 : 1.5), mobile: !!o.mobile, crf: 20, gpu: false, launch: browser, ffmpeg: ff },
    async (r: any) => {
      const page = r.page;
      // Move a target into view with a visible scroll before pointing at it
      const reach = async (sel: string) => {
        await r.until(sel, { timeout: 15000 }).catch(() => {
          throw new Error(`nothing matches ${sel} (run inspect to list what is on the page)`);
        });
        const b = await page.locator(sel).first().boundingBox();
        if (!b) throw new Error(`${sel} is not visible`);
        const vh = viewport.height;
        if (b.y < 40 || b.y + b.height > vh - 40) await r.scroll(Math.round(b.y - vh * 0.35), { ms: 800 });
      };
      await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Let the page load with its clock running before the first frame
      await r.until('() => document.readyState === "complete"', { timeout: 30000 }).catch(() => undefined);
      await r.idle(1200);
      await r.start();
      for (const s of steps) {
        const k = Object.keys(s).find((x) => ACTIONS.includes(x))!;
        const v = (s as Record<string, any>)[k];
        log(`  ${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`);
        if (k === 'wait') await r.wait(v);
        else if (k === 'idle') await r.idle(v);
        else if (k === 'goto') {
          await page.goto(v, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await r.until('() => document.readyState === "complete"', { timeout: 30000 }).catch(() => undefined);
          await r.wait(600);
        } else if (k === 'until') await r.until(v, { timeout: 20000 });
        else if (k === 'click') {
          await reach(v);
          await r.click(v);
        } else if (k === 'hover') {
          await reach(v);
          await r.move(v);
          await r.wait(400);
        } else if (k === 'fill') {
          await reach(v[0]);
          await r.click(v[0]);
          await r.type(v[1]);
        } else if (k === 'type') await r.type(v);
        else if (k === 'press') await r.press(v);
        else if (k === 'select') {
          await reach(v[0]);
          await r.select(v[0], new RegExp(v[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        } else if (k === 'scroll') await r.scroll(v, { ms: (s as { ms?: number }).ms ?? 900 });
        else if (k === 'scrollTo') {
          await reach(v);
          await r.wait(300);
        } else if (k === 'mark') r.mark(v);
        else if (k === 'zoom') {
          await reach(v);
          await r.zoom(v, (s as { scale?: number }).scale ?? 1.8);
        } else if (k === 'unzoom') r.unzoom();
      }
      await r.wait(500);
    },
  );
  return {
    file: `cap/${name}.mp4`,
    duration: meta.duration,
    marks: meta.events.filter((e: { type: string }) => e.type === 'mark').map((e: { name: string; t: number }) => ({ name: e.name, t: e.t })),
    width: meta.width,
    height: meta.height,
  };
}

// What is on a page and how to point at it, for writing record steps
export async function inspectPage(url: string, mobile = false): Promise<string> {
  const browser = findBrowser();
  if (!browser) throw new Error('No browser found: install Google Chrome or Microsoft Edge');
  const { chromium } = await import('playwright-core');
  const b = await chromium.launch({ ...browser, headless: true });
  try {
    const viewport = mobile ? { width: 410, height: 480 } : { width: 1280, height: 720 };
    const page = await b.newPage({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    const info = await page.evaluate(() => {
      const vis = (e: Element) => {
        const r = e.getBoundingClientRect();
        const st = getComputedStyle(e);
        return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
      };
      const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const cssPath = (e: Element): string => {
        const parts: string[] = [];
        let cur: Element | null = e;
        while (cur && cur !== document.body && parts.length < 5) {
          if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
            parts.unshift(`#${cur.id}`);
            break;
          }
          const tag = cur.tagName.toLowerCase();
          const sib = cur.parentElement ? [...cur.parentElement.children].filter((x) => x.tagName === cur!.tagName) : [];
          parts.unshift(sib.length > 1 ? `${tag}:nth-of-type(${sib.indexOf(cur) + 1})` : tag);
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      };
      const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=menuitem], [role=checkbox], [role=switch], [contenteditable=true]')].filter(vis);
      const label = (e: Element) => clean((e as HTMLElement).getAttribute('aria-label') || (e as HTMLElement).innerText || (e as HTMLInputElement).placeholder || (e as HTMLInputElement).value || e.getAttribute('title') || e.querySelector('img')?.getAttribute('alt'));
      const texts = new Map<string, number>();
      for (const e of els) texts.set(label(e), (texts.get(label(e)) ?? 0) + 1);
      const seen = new Map<string, number>();
      const rows = els.slice(0, 80).map((e) => {
        const tag = e.tagName.toLowerCase();
        const kind = e.getAttribute('role') ?? (tag === 'a' ? 'link' : tag === 'input' ? `input[${(e as HTMLInputElement).type}]` : tag);
        const name = label(e).slice(0, 60);
        let sel: string;
        if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && document.querySelectorAll(`#${e.id}`).length === 1) sel = `#${e.id}`;
        else if (['input', 'textarea', 'select'].includes(tag) && e.getAttribute('name')) sel = `${tag}[name="${q(e.getAttribute('name')!)}"]`;
        else if (['input', 'textarea'].includes(tag) && (e as HTMLInputElement).placeholder) sel = `${tag}[placeholder="${q((e as HTMLInputElement).placeholder)}"]`;
        else if (name && !(e as HTMLElement).getAttribute('aria-label') && name.length <= 60 && clean((e as HTMLElement).innerText) === name) {
          const n = seen.get(name) ?? 0;
          seen.set(name, n + 1);
          sel = `text="${q(name)}"${(texts.get(name) ?? 0) > 1 ? ` >> nth=${n}` : ''}`;
        } else sel = cssPath(e);
        const r = e.getBoundingClientRect();
        return { sel, kind, name, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2 + window.scrollY) };
      });
      const heads = [...document.querySelectorAll('h1, h2, h3')].filter(vis).slice(0, 20).map((h) => `${h.tagName.toLowerCase()} "${clean((h as HTMLElement).innerText).slice(0, 70)}"`);
      return { title: document.title, url: location.href, height: document.documentElement.scrollHeight, heads, rows, more: Math.max(0, els.length - 80) };
    });
    const screens = (info.height / viewport.height).toFixed(1);
    return [
      `${info.title || '(no title)'} — ${info.url}`,
      `${viewport.width}×${viewport.height} viewport; the page is ${info.height}px tall (${screens} screens)`,
      info.heads.length ? `Headings: ${info.heads.join(' · ')}` : 'No headings',
      'Elements (selector  ·  kind  ·  label  ·  x,y on the page):',
      ...info.rows.map((r, i) => `  ${String(i + 1).padStart(2)}. ${r.sel}  ·  ${r.kind}  ·  ${r.name || '-'}  ·  ${r.x},${r.y}`),
      info.more ? `  … ${info.more} more not listed` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } finally {
    await b.close();
  }
}
