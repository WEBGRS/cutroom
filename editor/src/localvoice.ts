// HD voices on this computer: Qwen3-TTS run by a Python worker (editor/py/qwen_tts_worker.py) on the graphics card.
// Voices are cloned from a short reference clip: presets ship with Cutroom, the user's own come from a recording,
// an imported clip or a written description (voice design).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, STATE } from './store';
import { readSettings, L } from './settings';
import { killTree } from './proc';
import { ffmpegBin } from './record';
import { modelsDir } from './voice';
import { LOCAL_PRESETS, LOCAL_REF_TEXT, type VoiceDef } from './voices';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const QWEN = {
  base: { repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', name: 'Qwen3-TTS-12Hz-1.7B-Base', bytes: 4_540_000_000 },
  small: { repo: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base', name: 'Qwen3-TTS-12Hz-0.6B-Base', bytes: 2_520_000_000 },
  design: { repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', name: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign', bytes: 4_540_000_000 },
  // PyTorch with CUDA plus the qwen-tts package, as installed
  envBytes: 5_600_000_000,
};

// ---- where things are ----

const home = () => path.join(modelsDir(), 'qwen3-tts');
const venvPython = (dir: string) => (process.platform === 'win32' ? path.join(dir, 'venv', 'Scripts', 'python.exe') : path.join(dir, 'venv', 'bin', 'python'));

export interface LocalCfg {
  python: string;
  models: string;
  // Command put in front of the worker, e.g. a GPU job queue: ["python", "queue.py", "run", "--"]
  wrap: string[];
  // Seconds the worker keeps the model loaded after the last line
  idle: number;
}

// Settings › voice.local { python, models, wrap }, env CUTROOM_QWEN_PYTHON / CUTROOM_QWEN_MODELS, else the install folder
export function localCfg(): LocalCfg {
  const s = readSettings().voice?.local ?? {};
  return {
    python: process.env.CUTROOM_QWEN_PYTHON ?? (typeof s.python === 'string' && s.python ? s.python : venvPython(home())),
    models: process.env.CUTROOM_QWEN_MODELS ?? (typeof s.models === 'string' && s.models ? s.models : home()),
    wrap: Array.isArray(s.wrap) ? s.wrap.map(String) : [],
    idle: Number(process.env.CUTROOM_QWEN_IDLE ?? s.idle ?? 300) || 300,
  };
}

const hasModel = (dir: string) => fs.existsSync(path.join(dir, 'model.safetensors')) && fs.existsSync(path.join(dir, 'speech_tokenizer', 'model.safetensors'));
// The 1.7B model when it is there, else the 0.6B one
export function baseModel(): string | null {
  const m = localCfg().models;
  for (const k of [QWEN.base, QWEN.small]) if (hasModel(path.join(m, k.name))) return path.join(m, k.name);
  return null;
}
const designModel = () => path.join(localCfg().models, QWEN.design.name);
export const localReady = () => fs.existsSync(localCfg().python) && !!baseModel();
export const designReady = () => localReady() && hasModel(designModel());

function findUp(rel: string): string {
  const f = [ROOT, path.join(HERE, '..'), path.join(HERE, '..', '..'), path.join(HERE, '..', '..', '..')].map((d) => path.join(d, rel)).find((x) => fs.existsSync(x));
  if (!f) throw new Error(`${rel} is missing from this install`);
  return f;
}
const workerScript = () => process.env.CUTROOM_QWEN_WORKER ?? findUp(path.join('editor', 'py', 'qwen_tts_worker.py'));

// ---- voices: presets and the user's own ----

const customDir = () => path.join(STATE, 'voices');

interface CustomMeta {
  name: string;
  lang: 'zh' | 'en';
  // What the clip says; empty when unknown (an imported clip), which clones the timbre only
  text: string;
  from: 'record' | 'import' | 'design';
  instruct?: string;
  made: string;
}

export function customVoices(): VoiceDef[] {
  const dir = customDir();
  if (!fs.existsSync(dir)) return [];
  const out: VoiceDef[] = [];
  for (const id of fs.readdirSync(dir)) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'voice.json'), 'utf8')) as CustomMeta;
      if (fs.existsSync(path.join(dir, id, 'ref.wav'))) out.push({ id, en: m.name, zh: m.name, lang: m.lang, mine: m.from });
    } catch {
      // Half-made voice
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const isLocalVoice = (id: string) => LOCAL_PRESETS.some((v) => v.id === id) || customVoices().some((v) => v.id === id);

// Reference clip and its words for a voice id
export function voiceRef(id: string): { ref: string; text: string; lang: 'zh' | 'en' } {
  const p = LOCAL_PRESETS.find((v) => v.id === id);
  if (p) return { ref: findUp(path.join('editor', 'voices', `${id}.wav`)), text: LOCAL_REF_TEXT[id], lang: p.lang === 'en' ? 'en' : 'zh' };
  const dir = path.join(customDir(), id);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'voice.json'), 'utf8')) as CustomMeta;
  return { ref: path.join(dir, 'ref.wav'), text: m.text, lang: m.lang };
}

const newId = () => `my-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

function saveCustom(meta: CustomMeta, write: (refWav: string) => void): VoiceDef {
  const id = newId();
  const dir = path.join(customDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    write(path.join(dir, 'ref.wav'));
    fs.writeFileSync(path.join(dir, 'voice.json'), JSON.stringify(meta, null, 1));
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return { id, en: meta.name, zh: meta.name, lang: meta.lang, mine: meta.from };
}

// A recording or a clip → 24 kHz mono WAV, at most 20 s from the first sound, loudness evened
export function addCustomVoice(o: { name: string; lang: 'zh' | 'en'; audio: string; text?: string; from: 'record' | 'import' }): VoiceDef {
  const text = (o.text ?? '').trim();
  return saveCustom({ name: o.name.trim().slice(0, 40) || L('My voice', '我的声音'), lang: o.lang, text, from: o.from, made: new Date().toISOString() }, (ref) => {
    const r = spawnSync(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', o.audio, '-vn', '-ac', '1', '-ar', '24000', '-t', '20', '-c:a', 'pcm_s16le', ref], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(ref)) throw new Error(L(`Could not read that audio: ${(r.stderr || '').trim().split(/\r?\n/).pop()}`, `读不了这段音频：${(r.stderr || '').trim().split(/\r?\n/).pop()}`));
    const secs = fs.statSync(ref).size / 48000;
    if (secs < 3) throw new Error(L('The clip is too short: record at least 5 seconds', '这段太短了，至少录 5 秒'));
  });
}

export async function designCustomVoice(o: { name: string; lang: 'zh' | 'en'; instruct: string }): Promise<VoiceDef> {
  const instruct = o.instruct.trim();
  if (!instruct) throw new Error(L('Describe the voice first', '先写一句对声音的描述'));
  if (!designReady()) throw new Error(L('Designing a voice needs the voice-design model: download it in the Voiceover panel', '设计声音需要声音设计模型，先在「配音」面板下载'));
  const tmp = path.join(os.tmpdir(), `cutroom-design-${process.pid}-${crypto.randomBytes(4).toString('hex')}.wav`);
  await request({ op: 'design', text: LOCAL_REF_TEXT[o.lang === 'en' ? 'en_m' : 'casual_m'], lang: o.lang, instruct, out: tmp });
  try {
    return saveCustom({ name: o.name.trim().slice(0, 40) || instruct.slice(0, 16), lang: o.lang, text: LOCAL_REF_TEXT[o.lang === 'en' ? 'en_m' : 'casual_m'], from: 'design', instruct, made: new Date().toISOString() }, (ref) => fs.copyFileSync(tmp, ref));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function removeCustomVoice(id: string) {
  if (!/^my-[a-z0-9]+$/.test(id)) throw new Error(L(`No voice ${id}`, `没有音色 ${id}`));
  fs.rmSync(path.join(customDir(), id), { recursive: true, force: true });
}

// ---- the worker ----

export type Phase = 'off' | 'queued' | 'starting' | 'loading' | 'ready';
type Waiter = { ok: (r: Record<string, any>) => void; bad: (e: Error) => void };
// Each worker process has its own waiting requests, so a stopped one can't fail its successor's
let child: { p: ChildProcess; pending: Map<number, Waiter> } | null = null;
let phase: Phase = 'off';
let device = '';
let seq = 0;
let onPhase: ((p: { phase: Phase; device: string }) => void) | null = null;
export const watchLocal = (fn: typeof onPhase) => void (onPhase = fn);
export const localPhase = () => ({ phase, device });

function setPhase(p: Phase) {
  phase = p;
  onPhase?.({ phase, device });
}

function start(): NonNullable<typeof child> {
  if (child && child.p.exitCode === null && child.p.signalCode === null) return child;
  const base = baseModel();
  if (!base) throw new Error(L('The HD voices are not installed yet', '高清配音还没安装'));
  const c = localCfg();
  const ff = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 ? 'ffmpeg' : ffmpegBin();
  const args = [workerScript(), '--base', base, '--design', hasModel(designModel()) ? designModel() : '', '--idle', String(c.idle), '--ffmpeg', ff];
  const [cmd, ...pre] = c.wrap.length ? [...c.wrap, c.python] : [c.python];
  let errTail = '';
  const p = spawn(cmd, [...pre, ...args], { env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const me = { p, pending: new Map<number, Waiter>() };
  child = me;
  const current = () => child === me;
  const pending = me.pending;
  p.stdin!.on('error', () => undefined);
  setPhase(c.wrap.length ? 'queued' : 'starting');
  readline.createInterface({ input: p.stdout! }).on('line', (line) => {
    let m: Record<string, any>;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.event === 'started') {
      if (current()) setPhase('starting');
    } else if (m.event === 'loading' && current()) {
      device = m.device ?? '';
      setPhase('loading');
    } else if (m.event === 'ready' && current()) {
      device = m.device ?? device;
      setPhase('ready');
    } else if (typeof m.id === 'number' && pending.has(m.id)) {
      const w = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.ok) w.ok(m);
      else w.bad(new Error(String(m.error ?? 'voice worker error')));
    }
  });
  p.stderr!.on('data', (d) => (errTail = (errTail + d).slice(-4000)));
  const done = (why: string) => {
    if (current()) {
      child = null;
      setPhase('off');
    }
    const last = errTail.trim().split(/\r?\n/).filter((l) => /Error|error|No module|not found|CUDA|memory/.test(l)).pop() ?? errTail.trim().split(/\r?\n/).pop() ?? '';
    for (const [id, w] of pending) {
      pending.delete(id);
      w.bad(new Error(L(`The HD voice stopped (${why})${last ? `: ${last.slice(0, 300)}` : ''}`, `高清配音进程退出了（${why}）${last ? `：${last.slice(0, 300)}` : ''}`)));
    }
  };
  p.on('error', (e) => done(e.message));
  p.on('close', (code) => done(`exit ${code}`));
  return me;
}

function request(req: Record<string, unknown>): Promise<Record<string, any>> {
  const w = start();
  const id = ++seq;
  return new Promise((ok, bad) => {
    w.pending.set(id, { ok, bad });
    w.p.stdin!.write(`${JSON.stringify({ ...req, id })}\n`);
  });
}

export function stopLocal() {
  if (!child) return;
  const { p, pending } = child;
  child = null;
  setPhase('off');
  killTree(p);
  for (const [id, w] of pending) {
    pending.delete(id);
    w.bad(new Error(L('The HD voice was stopped', '高清配音已停止')));
  }
}
process.once('exit', stopLocal);

// One line in a voice → WAV file at `out`; a graphics-card error gets one more try in a fresh worker
export async function speakLocal(o: { text: string; lang: 'zh' | 'en'; voice: string; speed: number; out: string }): Promise<void> {
  const v = voiceRef(o.voice);
  const req = { op: 'speak', text: o.text, lang: o.lang, ref: v.ref, ref_text: v.text, speed: o.speed, out: o.out };
  try {
    await request(req);
  } catch (e) {
    if (!/CUDA|out of memory|[(（]exit /i.test((e as Error).message)) throw e;
    await request(req);
  }
}

// ---- install ----

export interface LocalJob {
  state: 'running' | 'done' | 'error';
  step: 'python' | 'torch' | 'packages' | 'model' | 'check';
  got: number;
  total: number;
  note?: string;
  error?: string;
}
let job: LocalJob | null = null;
export const localJob = () => job;

// Graphics memory in MB (NVIDIA), 0 when there is no NVIDIA card
export function vramMb(): number {
  const r = spawnSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  return r.status === 0 ? Math.max(0, ...r.stdout.split(/\r?\n/).map(Number).filter((n) => n > 0)) : 0;
}

export function localStatus() {
  const c = localCfg();
  const base = baseModel();
  return {
    ready: localReady(),
    design: designReady(),
    model: base ? path.basename(base) : null,
    python: c.python,
    folder: c.models,
    ...localPhase(),
    job,
    bytes: (fs.existsSync(c.python) ? 0 : QWEN.envBytes) + (base ? 0 : QWEN.base.bytes),
    designBytes: hasModel(designModel()) ? 0 : QWEN.design.bytes,
    custom: customVoices(),
  };
}

const run = (cmd: string, args: string[], onLine?: (l: string) => void) =>
  new Promise<void>((ok, bad) => {
    const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
    let tail = '';
    const feed = (d: Buffer) => {
      tail = (tail + d).slice(-3000);
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) onLine?.(l.trim());
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', bad);
    p.on('close', (c) => (c === 0 ? ok() : bad(new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')}…: ${tail.trim().split(/\r?\n/).slice(-2).join(' ')}`))));
  });

const has = (cmd: string, args = ['--version']) => spawnSync(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: 20000 }).status === 0;

// A Python 3.10–3.13 to make the environment with (uv fetches one by itself)
function basePython(): { cmd: string; pre: string[] } | null {
  const tries: [string, string[]][] = process.platform === 'win32' ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.13']], ['py', ['-3.10']], ['python', []]] : [['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];
  for (const [cmd, pre] of tries) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1])'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    const v = Number(r.stdout?.trim());
    if (r.status === 0 && v >= 310 && v <= 313) return { cmd, pre };
  }
  return null;
}

// Hugging Face, or its mirror when the main site does not answer (mainland China)
async function hfBase(): Promise<string> {
  if (process.env.CUTROOM_HF_ENDPOINT) return process.env.CUTROOM_HF_ENDPOINT.replace(/\/+$/, '');
  for (const b of ['https://huggingface.co', 'https://hf-mirror.com']) {
    try {
      const r = await fetch(`${b}/api/models/${QWEN.base.repo}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return b;
    } catch {
      // Try the next one
    }
  }
  throw new Error(L('Neither huggingface.co nor hf-mirror.com answers; check the network', 'huggingface.co 和 hf-mirror.com 都连不上，检查一下网络'));
}

async function fetchModel(repo: string, dest: string, tell: (got: number, total: number) => void) {
  const hf = await hfBase();
  const r = await fetch(`${hf}/api/models/${repo}/tree/main?recursive=true`);
  if (!r.ok) throw new Error(`${hf}: ${r.status}`);
  const files = ((await r.json()) as { type: string; path: string; size: number }[]).filter((f) => f.type === 'file' && !/^\.|\.(md|png|jpe?g)$/i.test(f.path));
  const total = files.reduce((a, f) => a + f.size, 0);
  let got = 0;
  for (const f of files) {
    const out = path.join(dest, f.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (fs.existsSync(out) && fs.statSync(out).size === f.size) {
      got += f.size;
      tell(got, total);
      continue;
    }
    // Resume a partial file
    const part = `${out}.part`;
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const res = await fetch(`${hf}/${repo}/resolve/main/${f.path}`, { headers: have ? { Range: `bytes=${have}-` } : {} });
    if (!res.ok || !res.body) throw new Error(`${f.path}: ${res.status}`);
    if (res.status === 200) have = 0;
    got += have;
    const w = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    let last = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!w.write(chunk)) await new Promise((ok) => w.once('drain', ok));
      got += chunk.length;
      if (Date.now() - last > 400) {
        last = Date.now();
        tell(got, total);
      }
    }
    await new Promise<void>((ok, bad) => w.end((e?: Error | null) => (e ? bad(e) : ok())));
    if (fs.statSync(part).size !== f.size) throw new Error(L(`${f.path} arrived incomplete; try again`, `${f.path} 没下载完整，再试一次`));
    fs.renameSync(part, out);
  }
  tell(total, total);
}

// Python environment (PyTorch + qwen-tts) and the model; `what: 'design'` adds the voice-design model only
export async function installLocal(what: 'voices' | 'design', onProgress?: (j: LocalJob) => void): Promise<void> {
  if (job?.state === 'running') throw new Error(L('The HD voices are already being installed', '高清配音正在安装'));
  const c = localCfg();
  job = { state: 'running', step: 'python', got: 0, total: 0 };
  const tell = (patch: Partial<LocalJob> = {}) => {
    job = { ...job!, ...patch };
    onProgress?.({ ...job });
  };
  try {
    if (what === 'voices') {
      const vram = vramMb();
      const mac = process.platform === 'darwin' && process.arch === 'arm64';
      if (!vram && !mac && !process.env.CUTROOM_QWEN_CPU)
        throw new Error(L('The HD voices need an NVIDIA graphics card (or an Apple-silicon Mac). Without one, use the built-in voices or a cloud engine.', '高清配音需要 NVIDIA 显卡（或 M 系列芯片的 Mac）。没有的话用内置配音或云端引擎。'));
      if (!fs.existsSync(c.python)) {
        if (c.python !== venvPython(home())) throw new Error(L(`Python not found at ${c.python} (Settings › voice.local.python)`, `找不到 Python：${c.python}（设置里的 voice.local.python）`));
        tell({ step: 'python', note: '' });
        fs.mkdirSync(home(), { recursive: true });
        const uv = has('uv');
        if (uv) await run('uv', ['venv', '--python', '3.12', path.join(home(), 'venv')]);
        else {
          const py = basePython();
          if (!py) throw new Error(L('Python 3.10–3.13 is needed to install the HD voices: install it from python.org (or install uv) and try again', '安装高清配音需要 Python 3.10–3.13：先从 python.org 装一个（或装 uv），再试一次'));
          await run(py.cmd, [...py.pre, '-m', 'venv', path.join(home(), 'venv')]);
        }
        const pip = (args: string[], step: LocalJob['step']) =>
          uv ? run('uv', ['pip', 'install', '--python', c.python, ...args], (l) => tell({ step, note: l.slice(0, 120) })) : run(c.python, ['-m', 'pip', 'install', ...args], (l) => tell({ step, note: l.slice(0, 120) }));
        tell({ step: 'torch', note: '' });
        await pip(vram ? ['torch', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cu128'] : ['torch', 'torchaudio'], 'torch');
        tell({ step: 'packages', note: '' });
        await pip(['qwen-tts', 'soundfile', 'librosa'], 'packages');
      }
      if (!baseModel()) {
        // 0.6B on cards under 6 GB and without CUDA
        const m = vram >= 6000 ? QWEN.base : QWEN.small;
        tell({ step: 'model', note: m.name });
        await fetchModel(m.repo, path.join(c.models, m.name), (got, total) => tell({ step: 'model', got, total }));
      }
    } else {
      if (!localReady()) throw new Error(L('Install the HD voices first', '先安装高清配音'));
      tell({ step: 'model', note: QWEN.design.name });
      await fetchModel(QWEN.design.repo, designModel(), (got, total) => tell({ step: 'model', got, total }));
      stopLocal();
    }
    // A short line through the worker proves the whole chain
    tell({ step: 'check', note: '' });
    const tmp = path.join(os.tmpdir(), `cutroom-check-${process.pid}.wav`);
    await speakLocal({ text: LOCAL_REF_TEXT.check, lang: 'zh', voice: 'casual_m', speed: 1, out: tmp });
    fs.rmSync(tmp, { force: true });
    tell({ state: 'done', note: device });
  } catch (e) {
    tell({ state: 'error', error: (e as Error).message });
    throw e;
  }
}
