// Recordings of desktop apps and screens (Windows): the person works the app, Cutroom records it and logs the mouse.
// tools/deskrec.cs (built once with the C# compiler Windows ships) shows the record bar and reports input;
// FFmpeg 8+ captures the window through Windows Graphics Capture (gfxcapture), even when other windows cover it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PUBLIC, ROOT } from './store';
import { killTree } from './proc';
import { L, uiLang } from './settings';
import type { CaptureEvent, CaptureMeta } from '../../src/lib/types';

const FPS = 30;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const appDir = () =>
  process.env.CUTROOM_APPDIR ??
  (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Cutroom') : path.join(os.homedir(), '.cache', 'cutroom'));

export const desktopSupported = () => process.platform === 'win32';
const notWindows = () => L('Recording desktop apps works on Windows for now. Web pages record on every system: record <name> <url>', '录制桌面软件目前只支持 Windows；网页在所有系统都能录：record <name> <url>');

// ---- the helper program ----

function sourceFile(): string {
  const f = [ROOT, path.join(HERE, '..'), path.join(HERE, '..', '..'), path.join(HERE, '..', '..', '..')].map((d) => path.join(d, 'tools', 'deskrec.cs')).find((x) => fs.existsSync(x));
  if (!f) throw new Error('tools/deskrec.cs is missing from this install');
  return f;
}

let built: Promise<string> | null = null;
export function helperExe(): Promise<string> {
  if (!built) built = buildHelper().catch((e) => ((built = null), Promise.reject(e)));
  return built;
}

async function buildHelper(): Promise<string> {
  if (!desktopSupported()) throw new Error(notWindows());
  const src = sourceFile();
  const tag = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex').slice(0, 10);
  const dir = path.join(appDir(), 'bin');
  const exe = path.join(dir, `deskrec-${tag}.exe`);
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const win = process.env.SystemRoot ?? 'C:\\Windows';
  const csc = ['Framework64', 'Framework'].map((d) => path.join(win, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')).find((f) => fs.existsSync(f));
  if (!csc) throw new Error(L('Recording apps needs the C# compiler that comes with Windows (.NET Framework 4, csc.exe), which is missing', '录制软件需要 Windows 自带的 C# 编译器（.NET Framework 4 的 csc.exe），本机没有'));
  const tmp = path.join(dir, `deskrec-${tag}.tmp.exe`);
  const r = spawnSync(csc, ['-nologo', '-utf8output', '-optimize', '-target:winexe', `-out:${tmp}`, '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', src], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(tmp)) throw new Error(`could not build the recorder helper: ${`${r.stdout}${r.stderr}`.trim().slice(-500)}`);
  fs.renameSync(tmp, exe);
  for (const f of fs.readdirSync(dir))
    if (/^deskrec-[0-9a-f]+(\.tmp)?\.exe$/.test(f) && f !== path.basename(exe))
      try {
        fs.rmSync(path.join(dir, f));
      } catch {
        // An older helper that is still running
      }
  return exe;
}

async function helperJson<T>(args: string[]): Promise<T> {
  const exe = await helperExe();
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`recorder helper ${args[0]} failed: ${(r.stderr || r.stdout || '').trim().slice(-300)}`);
  return JSON.parse(r.stdout) as T;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface DeskWindow {
  hwnd: number;
  title: string;
  exe: string;
  pid: number;
  frame: Rect;
  client: Rect;
  minimized: boolean;
  foreground: boolean;
  monitor: number;
}
export interface Monitor {
  index: number;
  handle: number;
  rect: Rect;
  primary: boolean;
  scale: number;
}

export async function listWindows(): Promise<DeskWindow[]> {
  return helperJson<DeskWindow[]>(['list']);
}
export async function listMonitors(): Promise<Monitor[]> {
  return helperJson<Monitor[]>(['monitors']);
}

// ---- FFmpeg with window capture ----

const FF_BUILD = {
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip',
  bytes: 86_573_518,
};
const ffDir = () => path.join(appDir(), 'ffmpeg');

function canCapture(bin: string): boolean {
  const run = (a: string[]) => spawnSync(bin, ['-hide_banner', ...a], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const f = run(['-filters']);
  if (f.status !== 0 || !/\bgfxcapture\b/.test(f.stdout ?? '')) return false;
  return /\blibx264\b/.test(run(['-encoders']).stdout ?? '');
}

let ffFound: string | null = null;
// The full path of a program found on PATH, so child processes with a trimmed environment can run it
function onPath(bin: string): string {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8', windowsHide: true });
  return (r.stdout ?? '').split(/\r?\n/).find((l) => l.trim()) ?? bin;
}

// FFmpeg 8 or newer that has gfxcapture and libx264: CUTROOM_FFMPEG, the one Cutroom downloaded, or ffmpeg on PATH
export function captureFfmpeg(): string | null {
  if (ffFound) return ffFound;
  for (const c of [process.env.CUTROOM_FFMPEG, path.join(ffDir(), 'ffmpeg.exe'), 'ffmpeg'])
    if (c && (c === 'ffmpeg' || fs.existsSync(c)) && canCapture(c)) return (ffFound = c === 'ffmpeg' ? onPath(c) : c);
  return null;
}

export interface DownloadJob {
  state: 'running' | 'done' | 'error';
  got: number;
  total: number;
  error?: string;
}
let ffJob: DownloadJob | null = null;
export const ffmpegStatus = () => ({ installed: !!captureFfmpeg(), bytes: FF_BUILD.bytes, dir: ffDir(), job: ffJob });

// The BtbN Windows build (FFmpeg 9, GPL, shared libraries) into %LOCALAPPDATA%\Cutroom\ffmpeg
export async function installCaptureFfmpeg(onProgress?: (j: DownloadJob) => void): Promise<string> {
  const have = captureFfmpeg();
  if (have) return have;
  if (!desktopSupported()) throw new Error(notWindows());
  if (ffJob?.state === 'running') throw new Error(L('FFmpeg is already downloading', 'FFmpeg 正在下载'));
  const root = appDir();
  fs.mkdirSync(root, { recursive: true });
  const zip = path.join(root, 'ffmpeg.zip.part');
  const tmp = path.join(root, 'ffmpeg.unpack');
  ffJob = { state: 'running', got: 0, total: FF_BUILD.bytes };
  const tell = () => onProgress?.({ ...ffJob! });
  try {
    const r = await fetch(process.env.CUTROOM_FFMPEG_URL ?? FF_BUILD.url);
    if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`);
    ffJob.total = Number(r.headers.get('content-length')) || FF_BUILD.bytes;
    const out = fs.createWriteStream(zip);
    let last = 0;
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
      ffJob.got += chunk.length;
      if (Date.now() - last > 300) {
        last = Date.now();
        tell();
      }
    }
    await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())));
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    // Windows' own tar.exe (bsdtar) unpacks zip files
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    const x = spawnSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', tmp], { encoding: 'utf8', windowsHide: true });
    if (x.status !== 0) throw new Error(`unzip: ${(x.stderr ?? '').trim().slice(-200)}`);
    const bin = findFile(tmp, 'ffmpeg.exe');
    if (!bin) throw new Error(L('The download did not contain ffmpeg.exe', '下载的文件里没有 ffmpeg.exe'));
    fs.rmSync(ffDir(), { recursive: true, force: true });
    fs.renameSync(path.dirname(bin), ffDir());
    ffFound = null;
    const ok = captureFfmpeg();
    if (!ok) throw new Error(L('The downloaded FFmpeg cannot capture windows', '下载的 FFmpeg 不能录窗口'));
    ffJob = { ...ffJob, state: 'done' };
    return ok;
  } catch (e) {
    ffJob = { ...ffJob!, state: 'error', error: (e as Error).message };
    throw e;
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    tell();
  }
}

function findFile(dir: string, name: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    }
  }
  return null;
}

// ---- recording ----

export type DeskMode = 'window' | 'area' | 'screen';

// What the helper reports, one JSON object per line
export interface HelperEvent {
  ev: string;
  ms?: number;
  x?: number;
  y?: number;
  d?: number;
  b?: string;
  why?: string;
  msg?: string;
  mode?: DeskMode;
  hwnd?: number;
  title?: string;
  exe?: string;
  region?: Rect;
  monitor?: { handle: number; index: number; rect: Rect };
  scale?: number;
  keys?: string[];
}

// gfxcapture source for a window's client area, or a monitor cropped to a region
export function captureFilter(t: HelperEvent): string {
  const base = 'capture_cursor=0:max_framerate=30';
  if (t.mode === 'window') return `gfxcapture=hwnd=${t.hwnd}:${base}:width=-2:height=-2,hwdownload,format=bgra,format=yuv420p`;
  const m = t.monitor!.rect;
  const r = t.region!;
  const crop = `crop_left=${r.x - m.x}:crop_top=${r.y - m.y}:crop_right=${m.x + m.w - (r.x + r.w)}:crop_bottom=${m.y + m.h - (r.y + r.h)}`;
  return `gfxcapture=hmonitor=${t.monitor!.handle}:${base}:${crop},hwdownload,format=bgra,format=yuv420p`;
}

// The capture only gets frames when the picture changes; this pass makes it 30 fps, holds the last picture
// to the end, and cuts away everything before the countdown finished
export function finishFilter(skip: number, dur: number): string {
  return `setpts=PTS-STARTPTS,fps=${FPS},tpad=stop_mode=clone:stop_duration=${(skip + dur + 1).toFixed(3)},trim=start=${skip.toFixed(3)}:duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
}

// Helper events → the capture log the camera, cursor and marks read (seconds from the first frame)
export function toCapture(evs: HelperEvent[], goMs: number, dur: number, markNames: string[] = []): CaptureEvent[] {
  const out: CaptureEvent[] = [];
  let k = 0;
  const used = new Set<string>();
  for (const e of evs) {
    if (e.ms === undefined) continue;
    const t = Math.round(((e.ms - goMs) / 1000) * 10000) / 10000;
    if (t < 0 || t > dur) continue;
    if (e.ev === 'move' || e.ev === 'down' || e.ev === 'up') out.push({ t, type: e.ev, x: e.x, y: e.y });
    // Wheel notches (120 = one notch away from the user) → pixels scrolled down
    else if (e.ev === 'scroll') out.push({ t, type: 'scroll', x: e.x, y: Math.round((-(e.d ?? 0) / 120) * 100) });
    else if (e.ev === 'mark') {
      let name = markNames[k] ?? `m${k + 1}`;
      for (let n = 2; used.has(name); n++) name = `${markNames[k] ?? 'm'}${n}`;
      used.add(name);
      out.push({ t, type: 'mark', name });
      k++;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

export interface DeskOpts {
  slug: string;
  name: string;
  // A window title or program name to match, or a window handle; not needed for a whole screen
  window?: string;
  hwnd?: number;
  mode?: DeskMode;
  monitor?: number;
  // Shown on the record bar: what the person should do
  note?: string;
  // Names for the marks, in the order Mark is pressed
  marks?: string[];
  max?: number;
  // Seconds to wait for the person to press Start
  wait?: number;
  // Start right away (the person already clicked Record in the editor); the countdown still runs
  now?: boolean;
  replace?: boolean;
  // Tests: no bar on screen, scripted input
  hiddenBar?: boolean;
  fake?: string;
  log?: (s: string) => void;
  onState?: (s: 'waiting' | 'recording' | 'saving', info?: { title?: string }) => void;
}
export interface DeskResult {
  file: string;
  duration: number;
  marks: { name: string; t: number }[];
  clicks: number;
  width: number;
  height: number;
  title?: string;
  exe?: string;
  stopped: string;
  // Wall-clock milliseconds of the first frame
  startedAt: number;
}

// One recording at a time per process; the bar's controls belong to it
let active: { tell: (s: string) => void } | null = null;
export const stopActive = (how: 'stop' | 'cancel') => {
  if (!active) return false;
  active.tell(how);
  return true;
};

export async function recordDesktop(o: DeskOpts): Promise<DeskResult> {
  // Unattended checks (CUTROOM_DESK_FAKE = an input script): no bar on screen, scripted input, start at once
  if (process.env.CUTROOM_DESK_FAKE && !o.fake) o = { ...o, now: true, hiddenBar: true, fake: process.env.CUTROOM_DESK_FAKE };
  if (!desktopSupported()) throw new Error(notWindows());
  const mode: DeskMode = o.mode ?? (o.window || o.hwnd ? 'window' : 'screen');
  if (mode !== 'screen' && !o.window && !o.hwnd) throw new Error(L('Say which window to record (its title or program name)', '要说明录哪个窗口（窗口标题或程序名）'));
  if (active) throw new Error(L('A desktop recording is already running', '已经在录屏了'));
  const log = o.log ?? (() => undefined);
  let ff = captureFfmpeg();
  if (!ff) {
    log(L('Downloading FFmpeg for window capture (87 MB, once)…', '下载用于录窗口的 FFmpeg（87 MB，只需一次）…'));
    let shown = -1;
    ff = await installCaptureFfmpeg((j) => {
      const pct = Math.floor((j.got / Math.max(1, j.total)) * 10) * 10;
      if (pct > shown) log(`  ${(shown = pct)}%`);
    });
  }
  const exe = await helperExe();
  const outDir = path.join(PUBLIC, o.slug, 'cap');
  fs.mkdirSync(outDir, { recursive: true });
  let name = cleanName(o.name);
  if (!o.replace) for (let n = 2, stem = name; fs.existsSync(path.join(outDir, `${name}.mp4`)); n++) name = `${stem}-${n}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-desk-'));
  const raw = path.join(work, 'raw.ts');

  const args = ['rec', '--mode', mode, '--lang', uiLang(), '--max', String(o.max ?? 300)];
  if (o.hwnd) args.push('--hwnd', String(o.hwnd));
  else if (o.window) args.push('--match', o.window);
  if (o.monitor !== undefined) args.push('--monitor', String(o.monitor));
  if (o.note) args.push('--note', o.note);
  if (o.marks?.length) args.push('--marks', o.marks.join(','));
  if (o.now) args.push('--now');
  if (o.hiddenBar) args.push('--hidden-bar');
  if (o.fake) args.push('--fake', o.fake);
  // A GUI program: hiding it at spawn would hide the record bar too
  const h = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const tell = (s: string) => {
    try {
      h.stdin!.write(`${s}\n`);
    } catch {
      // Already gone
    }
  };
  active = { tell };

  const evs: HelperEvent[] = [];
  let target = null as HelperEvent | null;
  let goMs = 0;
  let stop = null as HelperEvent | null;
  let cap: ChildProcess | null = null;
  let capClosed: Promise<void> = Promise.resolve();
  let t0 = Infinity;
  let capErr = '';
  let helperErr = '';
  h.stderr!.on('data', (d) => (helperErr += d));

  try {
    const outcome = await new Promise<'stop' | 'cancel'>((resolve, reject) => {
      const waitStart = setTimeout(() => {
        if (target) return;
        tell('quit');
        reject(new Error(L(`Nobody pressed Start on the record bar within ${Math.round((o.wait ?? 240) / 60)} min`, `${Math.round((o.wait ?? 240) / 60)} 分钟内没人在录制条上点开始`)));
      }, (o.wait ?? 240) * 1000);
      const fail = (e: Error) => {
        clearTimeout(waitStart);
        tell('quit');
        reject(e);
      };
      h.on('error', fail);
      h.on('close', (code) => {
        clearTimeout(waitStart);
        if (stop) return resolve('stop');
        // The helper went away mid-recording: keep what was captured
        if (goMs) {
          stop = { ev: 'stop', ms: Date.now(), why: 'closed' };
          return resolve('stop');
        }
        reject(new Error(`the record bar closed before recording started${code ? ` (exit ${code}${helperErr ? `: ${helperErr.trim().slice(-300)}` : ''})` : ''}`));
      });
      readline.createInterface({ input: h.stdout! }).on('line', (line) => {
        let e: HelperEvent;
        try {
          e = JSON.parse(line);
        } catch {
          return;
        }
        if (e.ev === 'ready') {
          o.onState?.('waiting');
          log(o.now ? L('starting…', '准备开始…') : L(`The record bar is on screen: press Start (${e.keys?.[0] ?? 'F9'}) when ready, Stop (${e.keys?.[1] ?? 'F10'}) when done`, `录制条已出现在屏幕上：准备好后点开始（${e.keys?.[0] ?? 'F9'}），录完点停止（${e.keys?.[1] ?? 'F10'}）`));
        } else if (e.ev === 'target') {
          target = e;
          clearTimeout(waitStart);
          log(L(`capturing ${e.mode === 'screen' ? `screen ${(e.monitor?.index ?? 0) + 1}` : `"${e.title}" (${e.exe})`}, ${e.region!.w}×${e.region!.h}`, `录制 ${e.mode === 'screen' ? `屏幕 ${(e.monitor?.index ?? 0) + 1}` : `「${e.title}」（${e.exe}）`}，${e.region!.w}×${e.region!.h}`));
          const a = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-stats_period', '0.05', '-filter_complex', captureFilter(e), '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '16', '-flush_packets', '1', '-f', 'mpegts', raw];
          const c = spawn(ff!, a, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          cap = c;
          c.stderr!.on('data', (d) => (capErr += d));
          // Progress blocks (frame=…, out_time_us=…, progress=…) every 50 ms; the first frame's moment is the
          // least-delayed report of "now minus how far the stream has got"
          let told = false;
          let frame = 0;
          let us = 0;
          readline.createInterface({ input: c.stdout! }).on('line', (l) => {
            const [k, v] = l.split('=');
            if (k === 'frame') frame = Number(v) || 0;
            else if (k === 'out_time_us') us = Math.max(0, Number(v) || 0);
            else if (k === 'progress' && frame > 0) {
              t0 = Math.min(t0, Date.now() - us / 1000);
              if (!told) {
                told = true;
                tell('capturing');
              }
            }
          });
          capClosed = new Promise((ok) => c.on('close', () => ok()));
          c.on('close', (code) => {
            if (stop || code === 0) return;
            const msg = capErr.trim().split(/\r?\n/).pop() || `ffmpeg exit ${code}`;
            tell(`status ${L('Capture failed', '录制失败')}: ${msg.slice(0, 80)}`);
            setTimeout(() => fail(new Error(`window capture failed: ${msg.slice(0, 300)}`)), 1500);
          });
        } else if (e.ev === 'go') {
          goMs = e.ms!;
          o.onState?.('recording', { title: target?.title });
          log(L('recording…', '录制中…'));
        } else if (e.ev === 'stop') {
          stop = e;
          resolve('stop');
        } else if (e.ev === 'cancel') resolve('cancel');
        else if (e.ev === 'error') fail(new Error(e.msg ?? 'recorder error'));
        else evs.push(e);
      });
    });

    // Stop the capture: ask, then insist (a still window gives ffmpeg no frame to notice the request on)
    if (cap) {
      const c = cap as ChildProcess;
      try {
        c.stdin!.write('q');
      } catch {
        // Already closed
      }
      const t = setTimeout(() => killTree(c), 1200);
      await capClosed;
      clearTimeout(t);
    }
    if (outcome === 'cancel') throw new Error(L('The recording was cancelled', '录制已取消'));
    if (!goMs || !fs.existsSync(raw)) throw new Error(`nothing was captured${capErr ? `: ${capErr.trim().slice(-300)}` : ''}`);
    o.onState?.('saving');
    log(L('saving…', '保存中…'));
    tell(`status ${L('Saving the recording…', '正在保存录屏…')}`);
    const dur = Math.max(0.5, (stop!.ms! - goMs) / 1000);
    const skip = Math.max(0, (goMs - (Number.isFinite(t0) ? t0 : goMs)) / 1000);
    const tmp = path.join(work, 'out.mp4');
    const fin = spawnSync(ff!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-an', '-vf', finishFilter(skip, dur), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', String(FPS), '-movflags', '+faststart', tmp], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 24 });
    if (fin.status !== 0 || !fs.existsSync(tmp)) throw new Error(`could not finish the recording: ${(fin.stderr ?? '').trim().slice(-300)}`);
    const size = videoSize(ff!, tmp);
    const events = toCapture(evs, goMs, dur, o.marks);
    const meta: CaptureMeta & { source: object } = {
      width: size.w,
      height: size.h,
      fps: FPS,
      dpr: target?.scale ?? 1,
      duration: Math.round(dur * 1000) / 1000,
      events,
      source: { kind: 'desktop', mode, title: target?.title, exe: target?.exe, recorded: new Date().toISOString() },
    };
    fs.copyFileSync(tmp, path.join(outDir, `${name}.mp4`));
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(meta));
    // A desktop recording has no steps to replay; an old recipe with this name would re-record something else
    fs.rmSync(path.join(outDir, `${name}.recipe.json`), { force: true });
    return {
      file: `cap/${name}.mp4`,
      duration: meta.duration,
      marks: events.filter((e) => e.type === 'mark').map((e) => ({ name: e.name!, t: e.t })),
      clicks: events.filter((e) => e.type === 'down').length,
      width: size.w,
      height: size.h,
      title: target?.title,
      exe: target?.exe,
      stopped: stop!.why ?? 'user',
      startedAt: goMs,
    };
  } finally {
    active = null;
    tell('quit');
    if (cap) killTree(cap);
    setTimeout(() => killTree(h), 3000).unref();
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
}

function videoSize(ff: string, file: string): { w: number; h: number } {
  const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8', windowsHide: true });
  const m = /Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(r.stderr ?? '');
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1920, h: 1080 };
}
