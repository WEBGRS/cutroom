import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { Conflict, DATA, OUT, PUBLIC, ROOT, STATE, appendLog, boardFile, checkSlug, currentVersion, readDoc, readLog, slugs, snapshot, writeDoc, hash } from './store';
import type { Doc } from './ops';
import { aiStatus, aiTest, chat, compatModels, history, isRunning, provider, reset, stop, writeAi } from './chat';
import { agentDef, installAgent, openSignIn, forgetAgents, type AgentId } from './agents';
import { boardTemplate } from './templates';
import { L, readSettings, uiLang, writeSettings } from './settings';

const PORT = Number(process.env.PORT ?? 8814);
const EDITOR = path.join(ROOT, 'editor');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

// ---- server-sent events ----
const clients = new Set<http.ServerResponse>();
function broadcast(msg: object) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(data);
}

// ---- file watching: storyboard/timings edits from anywhere reach the page ----
const known = new Map<string, string>();
const timers = new Map<string, NodeJS.Timeout>();
function onBoardChange(slug: string) {
  let version: string;
  let text: string;
  try {
    text = fs.readFileSync(boardFile(slug), 'utf8');
    JSON.parse(text);
    version = hash(text);
  } catch {
    return;
  }
  if (known.get(slug) === version) return;
  const prev = known.get(slug);
  known.set(slug, version);
  const last = readLog(slug).filter((e) => e.version === version).pop();
  if (!last) {
    snapshot(slug, version, text);
    appendLog(slug, { t: new Date().toISOString(), src: 'external', version, prev, desc: [L('file changed outside the editor', '文件在编辑器外被修改')] });
  }
  broadcast({ type: 'board', slug, version, src: last?.src ?? 'external', desc: last?.desc ?? [L('file changed outside the editor', '文件在编辑器外被修改')] });
}
// One watcher per project folder; dropped when the folder goes away so a recreated folder is watched again
const watched = new Map<string, { w: fs.FSWatcher; id: string }>();
function watch(slug: string) {
  const dir = path.join(PUBLIC, slug);
  const st = fs.statSync(dir);
  const id = `${st.ino}-${st.birthtimeMs}`;
  const cur = watched.get(slug);
  if (cur && cur.id === id) return;
  cur?.w.close();
  known.set(slug, currentVersion(slug));
  const w = fs.watch(dir, (_ev, file) => {
    const name = String(file ?? '');
    const kind = name === 'storyboard.json' ? 'board' : /^timings(-en)?\.json$/.test(name) ? 'timings' : null;
    if (!kind) return;
    const key = `${slug}:${kind}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => (kind === 'board' ? onBoardChange(slug) : broadcast({ type: 'timings', slug })), 150),
    );
  });
  w.on('error', () => {
    w.close();
    if (watched.get(slug)?.w === w) watched.delete(slug);
  });
  watched.set(slug, { w, id });
}

// ---- thumbnails and waveforms for the timeline (ffmpeg, cached by file identity) ----
const CACHE = path.join(STATE, 'cache');
const busy = new Map<string, Promise<unknown>>();
// ffmpeg/ffprobe from Remotion's compositor package when present, so no system install is needed
const COMPOSITOR = ['compositor-win32-x64-msvc', 'compositor-darwin-arm64', 'compositor-darwin-x64', 'compositor-linux-x64-gnu', 'compositor-linux-arm64-gnu']
  .map((n) => path.join(ROOT, 'node_modules', '@remotion', n))
  .find((d) => fs.existsSync(path.join(d, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')));
const tool = (cmd: string) => (COMPOSITOR ? path.join(COMPOSITOR, process.platform === 'win32' ? `${cmd}.exe` : cmd) : cmd);
const run = (cmd: string, args: string[]) =>
  new Promise<Buffer>((ok, bad) => {
    const p = spawn(tool(cmd), args, { windowsHide: true, env: { ...process.env, LD_LIBRARY_PATH: COMPOSITOR ?? process.env.LD_LIBRARY_PATH ?? '' } });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? ok(Buffer.concat(out)) : bad(new Error(err.slice(-300)))));
  });
const fileKey = (f: string) => {
  const st = fs.statSync(f);
  return hash(`${f}|${st.size}|${st.mtimeMs}`);
};
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const meta = path.join(CACHE, `${key}.json`);
  if (fs.existsSync(meta)) return Promise.resolve(JSON.parse(fs.readFileSync(meta, 'utf8')) as T);
  if (!busy.has(key))
    busy.set(
      key,
      make()
        .then((v) => {
          fs.writeFileSync(meta, JSON.stringify(v));
          return v;
        })
        .finally(() => busy.delete(key)),
    );
  return busy.get(key) as Promise<T>;
}

const THUMB_H = 96;
async function thumbs(file: string) {
  fs.mkdirSync(CACHE, { recursive: true });
  const key = fileKey(file);
  return cached(key, async () => {
    const probe = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file])).toString();
    const j = JSON.parse(probe);
    const dur = Number(j.format.duration);
    const w = Math.round((THUMB_H * j.streams[0].width) / j.streams[0].height / 2) * 2;
    const interval = dur <= 24 ? 0.25 : dur / 96;
    const count = Math.max(1, Math.ceil(dur / interval));
    // The bundled ffmpeg has no fps/tile filters: write one jpg per tile, the browser joins them into a strip
    await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `scale=${w}:${THUMB_H}`, '-r', (1 / interval).toFixed(6), '-frames:v', String(count), '-q:v', '4', path.join(CACHE, `${key}-%03d.jpg`)]);
    const frames = fs.readdirSync(CACHE).filter((f) => f.startsWith(`${key}-`) && f.endsWith('.jpg')).sort().map((f) => `/cache/${f}`);
    return { url: '', frames, interval, count: frames.length, w, h: THUMB_H, dur };
  });
}

const PEAK_RATE = 50;
async function peaks(file: string) {
  fs.mkdirSync(CACHE, { recursive: true });
  return cached(`${fileKey(file)}-peaks`, async () => {
    // The bundled ffmpeg has no raw s16le muxer: read the samples out of a piped wav
    const wav = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', '-f', 'wav', '-']);
    const at = wav.indexOf('data', 12);
    const pcm = at < 0 ? Buffer.alloc(0) : wav.subarray(at + 8);
    const n = pcm.length >> 1;
    const per = 8000 / PEAK_RATE;
    const p: number[] = [];
    for (let i = 0; i < n; i += per) {
      let m = 0;
      for (let k = i; k < Math.min(n, i + per); k++) m = Math.max(m, Math.abs(pcm.readInt16LE(k * 2)));
      p.push(Math.round((m / 32768) * 255));
    }
    return { rate: PEAK_RATE, p };
  });
}

// ---- render jobs (one at a time) ----
interface Job {
  slug: string;
  name: string;
  out: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  phase: string;
  tail: string[];
  started: number;
  child?: ChildProcess;
}
let job: Job | null = null;
// Absolute path too, so the page can show exactly where the file went
const jobView = () => (job ? { ...job, child: undefined, out: path.relative(DATA, job.out), path: job.out, dir: path.dirname(job.out) } : null);

const CODECS: Record<string, string> = { h264: 'mp4', h265: 'mp4', vp9: 'webm', prores: 'mov', gif: 'gif' };

// Where exports go: the folder chosen in Settings, else out/editor (app: Documents\Cutroom\exports\editor)
const DEFAULT_EXPORTS = path.join(OUT, 'editor');
function exportDir(): string {
  const d = readSettings().exportDir;
  return typeof d === 'string' && path.isAbsolute(d) ? d : DEFAULT_EXPORTS;
}
const within = (dir: string, f: string) => {
  const r = path.relative(path.resolve(dir), path.resolve(f));
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};
const openFolder = (dir: string) => spawn(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;
  } catch {
    return '';
  }
})();
function cacheBytes(): number {
  if (!fs.existsSync(CACHE)) return 0;
  return fs.readdirSync(CACHE).reduce((a, f) => {
    try {
      return a + fs.statSync(path.join(CACHE, f)).size;
    } catch {
      return a;
    }
  }, 0);
}
const appInfo = () => ({ version: VERSION, exportDir: exportDir(), exportDefault: DEFAULT_EXPORTS, projectsDir: PUBLIC, cache: { dir: CACHE, bytes: cacheBytes() } });

function startRender(o: { slug: string; format: string; mode: string; variant: string; lang: string; voice: string; scale?: number; codec?: string }) {
  if (job?.state === 'running') throw new Error(L('A render is already running', '已有渲染在进行'));
  checkSlug(o.slug);
  const codec = o.codec && CODECS[o.codec] ? o.codec : 'h264';
  const scale = [0.5, 1, 1.5, 2].includes(Number(o.scale)) ? Number(o.scale) : 1;
  const name = [o.slug, o.format, o.mode === 'beat' ? 'beat' : null, o.variant === 'clean' ? 'clean' : null, o.lang === 'en' ? 'en' : null, o.voice === 'off' && o.mode !== 'beat' ? 'silent' : null, scale !== 1 ? `x${scale}` : null].filter(Boolean).join('-');
  const out = path.join(exportDir(), `${name}.${CODECS[codec]}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(STATE, { recursive: true });
  const propsFile = path.join(STATE, `render-props.json`);
  fs.writeFileSync(propsFile, JSON.stringify({ slug: o.slug, format: o.format, mode: o.mode, variant: o.variant, lang: o.lang, voice: o.voice }));
  const cli = path.join(ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  const args = [cli, 'render', 'src/index.ts', `studio-${o.format}`, out, `--props=${propsFile}`, `--codec=${codec}`, `--public-dir=${PUBLIC}`];
  if (scale !== 1) args.push(`--scale=${scale}`);
  const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
  const j: Job = { slug: o.slug, name, out, state: 'running', done: 0, total: 0, phase: L('Bundling', '打包'), tail: [], started: Date.now(), child };
  job = j;
  let last = 0;
  const onData = (buf: Buffer) => {
    const s = buf.toString('utf8');
    for (const line of s.split(/[\r\n]+/).filter((x) => x.trim())) {
      j.tail.push(line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300));
      if (j.tail.length > 30) j.tail.shift();
    }
    const m = [...s.matchAll(/(\d+)\/(\d+)/g)].pop();
    if (m) {
      j.done = Number(m[1]);
      j.total = Number(m[2]);
      j.phase = /encod/i.test(s) ? L('Encoding', '编码') : L('Rendering', '渲染');
    }
    if (Date.now() - last > 250) {
      last = Date.now();
      broadcast({ type: 'render', job: jobView() });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    if (j.state === 'running') j.state = code === 0 ? 'done' : 'error';
    j.child = undefined;
    broadcast({ type: 'render', job: jobView() });
  });
}

// ---- helpers ----
const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const body = (req: http.IncomingMessage) =>
  new Promise<any>((ok, bad) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        bad(e);
      }
    });
  });

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
    if (!st.isFile()) throw new Error();
  } catch {
    res.writeHead(404);
    return res.end();
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const lm = st.mtime.toUTCString();
  const headers: Record<string, string | number> = { 'Content-Type': type, 'Last-Modified': lm, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
  if (req.headers['if-modified-since'] === lm && !req.headers.range) {
    res.writeHead(304, headers);
    return res.end();
  }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Resolve a URL path inside a base directory, refusing anything that escapes it
const inside = (base: string, rel: string) => {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p.startsWith(base + path.sep) ? p : null;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  const slug = url.searchParams.get('slug') ?? '';
  try {
    // Writes only from the editor's own page: blocks other sites posting to localhost
    const origin = req.headers.origin;
    if (req.method !== 'GET' && p.startsWith('/api/') && origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'forbidden origin' });
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', job: jobView() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (p === '/api/projects' && req.method === 'POST') {
      const b = await body(req);
      const s = String(b.slug ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!s || s.startsWith('_')) return send(res, 400, { error: L('Project names use letters, digits and dashes only', '项目名只能用英文字母、数字和横线') });
      const dir = path.join(PUBLIC, s);
      if (fs.existsSync(path.join(dir, 'storyboard.json'))) return send(res, 409, { error: L(`A project called ${s} already exists`, `已经有项目 ${s}`) });
      fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(boardTemplate(s, String(b.title ?? s), uiLang()), null, 2));
      return send(res, 200, { slug: s });
    }
    if (p === '/api/projects') return send(res, 200, slugs().filter((s) => !s.startsWith('_') || process.env.VS_TEST));
    if (p === '/api/upload' && req.method === 'PUT') {
      checkSlug(slug);
      const raw = path.basename(url.searchParams.get('name') ?? '');
      const ext = path.extname(raw).toLowerCase();
      if (!/^\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a)$/.test(ext)) return send(res, 400, { error: L(`Unsupported file type ${ext}`, `不支持的文件类型 ${ext}`) });
      const stem = raw.slice(0, -ext.length).replace(/[^\w一-龥-]+/g, '_').slice(0, 60) || 'file';
      const dir = path.join(PUBLIC, slug, 'media');
      fs.mkdirSync(dir, { recursive: true });
      let name = `${stem}${ext}`;
      for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
      await new Promise<void>((ok, bad) => {
        const w = fs.createWriteStream(path.join(dir, name));
        req.pipe(w);
        w.on('finish', ok);
        w.on('error', bad);
      });
      return send(res, 200, { path: `media/${name}` });
    }
    if (p === '/api/music') {
      const dir = path.join(PUBLIC, 'music');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')) : [];
      return send(res, 200, files.map((f) => ({ src: `music/${f}`, beats: fs.existsSync(path.join(dir, f.replace(/\.mp3$/, '.beats.json'))) })));
    }
    if (p === '/api/settings' && req.method === 'GET') return send(res, 200, { lang: readSettings().lang ?? null });
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await body(req);
      if (b.lang === 'en' || b.lang === 'zh') writeSettings({ lang: b.lang });
      return send(res, 200, { lang: uiLang() });
    }
    if (p === '/api/ai' && req.method === 'GET') return send(res, 200, await aiStatus());
    if (p === '/api/ai' && req.method === 'POST') {
      const b = await body(req);
      try {
        writeAi({ pref: b.pref, apiKey: b.apiKey, compat: b.compat, agent: b.agent });
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      return send(res, 200, await aiStatus());
    }
    if (p === '/api/ai/models' && req.method === 'GET') return send(res, 200, await compatModels());
    // Subscription agents: sign in opens a terminal with the vendor's own login; install runs npm -g
    if (p === '/api/ai/agent' && req.method === 'POST') {
      const b = await body(req);
      if (!agentDef(b.id)) return send(res, 400, { error: 'unknown agent' });
      if (b.action === 'signin') {
        if (!openSignIn(b.id as AgentId)) return send(res, 400, { error: L('Install it first', '先安装') });
        return send(res, 200, { ok: true });
      }
      if (b.action === 'install') return send(res, 200, await installAgent(b.id as AgentId));
      if (b.action === 'refresh') {
        forgetAgents();
        return send(res, 200, await aiStatus());
      }
      return send(res, 400, { error: 'unknown action' });
    }
    if (p === '/api/ai/test' && req.method === 'POST') return send(res, 200, await aiTest());
    if (p === '/api/chat' && req.method === 'GET') return send(res, 200, { provider: provider(), history: history(slug), running: isRunning(slug) });
    if (p === '/api/chat/reset' && req.method === 'POST') {
      reset((await body(req)).slug);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/chat/stop' && req.method === 'POST') {
      stop((await body(req)).slug);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/chat' && req.method === 'POST') {
      const b = await body(req);
      checkSlug(b.slug);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const refs = Array.isArray(b.refs) ? b.refs.filter((r: unknown) => r && typeof (r as { detail?: unknown }).detail === 'string').slice(0, 8).map((r: { label?: string; detail: string }) => ({ label: String(r.label ?? '').slice(0, 80), detail: r.detail.slice(0, 600) })) : [];
      await chat(b.slug, String(b.message ?? ''), b.context ?? {}, b.model || undefined, (e) => res.write(JSON.stringify(e) + '\n'), refs);
      return res.end();
    }
    if (p === '/api/board' && req.method === 'GET') {
      const { doc, version } = readDoc(slug);
      watch(slug);
      return send(res, 200, { ...doc, version });
    }
    if (p === '/api/board' && req.method === 'PUT') {
      const b = await body(req);
      const doc: Doc = { board: b.board, timings: b.timings ?? {} };
      if (!doc.board || !Array.isArray(doc.board.scenes)) return send(res, 400, { error: 'bad board' });
      try {
        const version = writeDoc(slug, doc, 'ui', b.desc ?? [], b.base, !!b.timings);
        known.set(slug, version);
        broadcast({ type: 'board', slug, version, src: 'ui', desc: b.desc ?? [] });
        return send(res, 200, { version });
      } catch (e) {
        if (e instanceof Conflict) {
          const cur = readDoc(slug);
          return send(res, 409, { ...cur.doc, version: cur.version });
        }
        throw e;
      }
    }
    if (p === '/api/log') return send(res, 200, readLog(slug).slice(-Number(url.searchParams.get('n') ?? 50)));
    if (p === '/api/assets') {
      checkSlug(slug);
      const list: string[] = [];
      for (const sub of ['cap', 'media']) {
        const dir = path.join(PUBLIC, slug, sub);
        if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(mp4|png|jpe?g|webp|gif|webm|mov|mp3|wav|m4a)$/i.test(f)) list.push(`${sub}/${f}`);
      }
      return send(res, 200, list);
    }
    if (p === '/api/thumbs' || p === '/api/peaks') {
      // Paths are relative to public/ (thumbs: relative to the project folder)
      const rel = p === '/api/thumbs' ? `${slug}/${url.searchParams.get('src') ?? ''}` : (url.searchParams.get('path') ?? '');
      const f = inside(PUBLIC, path.posix.normalize(rel));
      if (!f || !fs.existsSync(f)) return send(res, 404, { error: 'no file' });
      const v = p === '/api/thumbs' ? await thumbs(f) : await peaks(f);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' });
      return res.end(JSON.stringify(v));
    }
    if (p.startsWith('/cache/')) {
      const f = inside(CACHE, p.slice(7));
      return f ? serveFile(req, res, f) : send(res, 403, {});
    }
    if (p === '/api/render' && req.method === 'POST') {
      startRender(await body(req));
      broadcast({ type: 'render', job: jobView() });
      return send(res, 200, jobView());
    }
    if (p === '/api/render' && req.method === 'GET') return send(res, 200, jobView());
    if (p === '/api/render/cancel' && req.method === 'POST') {
      if (job?.state === 'running' && job.child?.pid) {
        job.state = 'cancelled';
        // Kill only our own render process tree
        execFile('taskkill', ['/pid', String(job.child.pid), '/t', '/f'], () => undefined);
      }
      return send(res, 200, jobView());
    }
    if (p === '/api/reveal' && req.method === 'POST') {
      const b = await body(req);
      // Relative to the data folder (as the render job reports it) or absolute; only inside an export folder
      const raw = String(b.file ?? '');
      const f = path.isAbsolute(raw) ? raw : path.join(DATA, raw);
      if (!(within(exportDir(), f) || within(OUT, f)) || !fs.existsSync(f)) return send(res, 404, { error: 'no file' });
      // open: play it in the default app; otherwise show it selected in its folder
      const args = process.platform === 'win32' ? (b.open ? [f] : [`/select,${f}`]) : [b.open ? f : path.dirname(f)];
      spawn(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', args, { detached: true, stdio: 'ignore' }).unref();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/exports' && req.method === 'GET') {
      const dir = exportDir();
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => /\.(mp4|mov|gif|webm)$/i.test(f)).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        : [];
      return send(res, 200, { dir, files: files.sort((a, b) => b.mtime - a.mtime).slice(0, 8) });
    }
    if (p === '/api/exports/open' && req.method === 'POST') {
      const dir = exportDir();
      fs.mkdirSync(dir, { recursive: true });
      openFolder(dir);
      return send(res, 200, { ok: true });
    }
    // Settings page: folders, cache, version
    if (p === '/api/app' && req.method === 'GET') return send(res, 200, appInfo());
    if (p === '/api/app' && req.method === 'POST') {
      const b = await body(req);
      if (b.exportDir === null || b.exportDir === '') {
        writeSettings({ exportDir: undefined });
      } else if (typeof b.exportDir === 'string') {
        const d = b.exportDir.trim();
        if (!path.isAbsolute(d)) return send(res, 400, { error: L('Use a full folder path, e.g. D:\\Videos\\Exports', '请填完整的文件夹路径，比如 D:\\视频\\导出') });
        try {
          fs.mkdirSync(d, { recursive: true });
          fs.accessSync(d, fs.constants.W_OK);
        } catch {
          return send(res, 400, { error: L(`Can't write to ${d}`, `没法写入 ${d}`) });
        }
        writeSettings({ exportDir: path.resolve(d) });
      }
      return send(res, 200, appInfo());
    }
    if (p === '/api/app/cache/clear' && req.method === 'POST') {
      // Thumbnails and waveforms; rebuilt on demand
      if (fs.existsSync(CACHE)) for (const f of fs.readdirSync(CACHE)) fs.rmSync(path.join(CACHE, f), { force: true, recursive: true });
      return send(res, 200, appInfo());
    }
    if (p === '/api/app/open' && req.method === 'POST') {
      const what = (await body(req)).what;
      const dir = what === 'projects' ? PUBLIC : what === 'cache' ? CACHE : exportDir();
      fs.mkdirSync(dir, { recursive: true });
      openFolder(dir);
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown api' });
    // The page learns the app-wide UI language before its script runs
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(EDITOR, 'index.html'), 'utf8').replace('<html lang="zh-CN">', `<html lang="${uiLang() === 'zh' ? 'zh-CN' : 'en'}" data-lang="${uiLang()}">`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (p.startsWith('/app/')) {
      const f = inside(path.join(EDITOR, 'dist'), p.slice(5));
      return f ? serveFile(req, res, f) : send(res, 403, {});
    }
    if (p === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    // Everything else is public/ (what staticFile() points at)
    const f = inside(PUBLIC, p.slice(1));
    return f ? serveFile(req, res, f) : send(res, 403, {});
  } catch (e) {
    return send(res, 500, { error: (e as Error).message });
  }
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use` : e.message);
  process.exit(1);
});
server.listen({ port: PORT, host: '127.0.0.1', exclusive: true }, () => {
  for (const s of slugs()) watch(s);
  console.log(`Cutroom: http://127.0.0.1:${PORT}/`);
});
