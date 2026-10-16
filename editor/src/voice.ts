// AI voice-over: narration lines → audio files in <project>/vo plus timings[-en].json (server and CLI)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { plain } from '../../src/lib/timeline';
import type { Line, Timings, VoiceClip } from '../../src/lib/types';
import { PUBLIC, STATE, readDoc, writeTimings } from './store';
import { readSettings, writeSettings, L } from './settings';
import { preset } from './compat';
import { ENGINES, KOKORO, SAMPLE, TEST_ENGINE, engineDef, type EngineDef, type EngineId } from './voices';
import { customVoices, localReady, speakLocal } from './localvoice';

export type Lang = 'zh' | 'en';
const TEST = () => process.env.CUTROOM_VOICE_TEST === '1';
// Version of the built-in voice's text rules (speakable); bump when they change
const RULES = 2;

// ---- settings ----

export interface VoiceSettings {
  engine: EngineId;
  // Chosen voice per engine and language
  voices: Record<string, { zh?: string; en?: string }>;
  speed: number;
}

export function voiceSettings(): VoiceSettings {
  const v = readSettings().voice ?? {};
  const engine: EngineId = engineDef(v.engine, TEST()) ? v.engine : 'builtin';
  const speed = Number(v.speed);
  return { engine, voices: v.voices ?? {}, speed: speed >= 0.5 && speed <= 2 ? speed : 1 };
}

export function writeVoiceSettings(p: { engine?: string; voice?: string; lang?: Lang; speed?: number }) {
  const s = voiceSettings();
  if (p.engine && engineDef(p.engine, TEST())) s.engine = p.engine as EngineId;
  if (p.voice) {
    const def = engineDef(s.engine, TEST())!;
    if (!hasVoice(def, p.voice)) throw new Error(L(`No voice ${p.voice} in ${def.en}`, `${def.zh}里没有音色 ${p.voice}`));
    s.voices = { ...s.voices, [s.engine]: { ...(s.voices[s.engine] ?? {}), [p.lang ?? 'zh']: p.voice } };
  }
  if (typeof p.speed === 'number' && p.speed >= 0.5 && p.speed <= 2) s.speed = Math.round(p.speed * 100) / 100;
  // Keep other voice keys (the HD install's paths)
  writeSettings({ voice: { ...(readSettings().voice ?? {}), ...s } });
  return s;
}

// Voices of an engine; the HD engine adds the user's own
export const voicesOf = (def: EngineDef) => (def.id === 'local' ? [...def.voices, ...customVoices()] : def.voices);
const hasVoice = (def: EngineDef, id: string | undefined) => !!id && voicesOf(def).some((v) => v.id === id);

export const voiceOf = (s: VoiceSettings, engine: EngineId, lang: Lang) => {
  const def = engineDef(engine, TEST())!;
  const id = s.voices[engine]?.[lang];
  return hasVoice(def, id) ? id! : def.def[lang];
};

// Key for a cloud engine: env variable first, then the key saved for that preset in Settings › AI
function keyFor(def: EngineDef): string {
  if (!def.keyPreset) return '';
  const p = preset(def.keyPreset);
  const env = p?.env ? (process.env[p.env] ?? '') : '';
  return env || (readSettings().ai?.compat?.keys?.[def.keyPreset] ?? '');
}

// ---- built-in model (Kokoro through sherpa-onnx) ----

export const modelsDir = () =>
  process.env.CUTROOM_MODELS ??
  (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Cutroom', 'models')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'Cutroom', 'models')
      : path.join(os.homedir(), '.cache', 'cutroom', 'models'));
const kokoroDir = () => path.join(modelsDir(), KOKORO.name);

// The desktop app runs on Electron, which refuses the native module's audio buffers, so it runs
// sherpa-onnx's own command-line program instead (Windows x64 build, downloaded next to the model)
const SHERPA_CLI = {
  name: 'sherpa-onnx-v1.13.8-win-x64-shared-MT-Release',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release.tar.bz2',
  bytes: 24_805_859,
  files: ['sherpa-onnx-offline-tts.exe', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll'],
};
const useCli = () => (process.env.CUTROOM_TTS_BACKEND ? process.env.CUTROOM_TTS_BACKEND === 'cli' : !!process.versions.electron);
const cliDir = () => path.join(modelsDir(), SHERPA_CLI.name);
const cliExe = () => path.join(cliDir(), SHERPA_CLI.files[0]);
const cliInstalled = () => SHERPA_CLI.files.every((f) => fs.existsSync(path.join(cliDir(), f)));
export const modelInstalled = () => fs.existsSync(path.join(kokoroDir(), 'model.int8.onnx')) && fs.existsSync(path.join(kokoroDir(), 'voices.bin')) && (!useCli() || cliInstalled());
const downloadBytes = () => (fs.existsSync(path.join(kokoroDir(), 'voices.bin')) ? 0 : KOKORO.bytes) + (useCli() && !cliInstalled() ? SHERPA_CLI.bytes : 0);

export interface ModelJob {
  state: 'running' | 'done' | 'error';
  got: number;
  total: number;
  error?: string;
}
let modelJob: ModelJob | null = null;
export const modelStatus = () => ({ installed: modelInstalled(), bytes: downloadBytes() || KOKORO.bytes, dir: kokoroDir(), job: modelJob });

// Windows ships bsdtar, which unpacks .tar.bz2; prefer it over any GNU tar on PATH
const tarBin = () => {
  const sys = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return process.platform === 'win32' && fs.existsSync(sys) ? sys : 'tar';
};

const untar = (archive: string, into: string, members: string[] = []) =>
  new Promise<void>((res, rej) => {
    const p = spawn(tarBin(), ['-xjf', archive, '-C', into, ...members], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`tar: ${err.trim().slice(-200)}`))));
  });

export async function installModel(onProgress?: (j: ModelJob) => void): Promise<void> {
  if (modelInstalled()) return;
  if (modelJob?.state === 'running') throw new Error(L('The voice model is already downloading', '语音模型正在下载'));
  if (useCli() && !(process.platform === 'win32' && process.arch === 'x64'))
    throw new Error(L('The built-in voices in the desktop app need 64-bit Windows; run Cutroom from source on other systems', '桌面版内置配音需要 64 位 Windows；其他系统请从源码运行 Cutroom'));
  const dir = modelsDir();
  fs.mkdirSync(dir, { recursive: true });
  modelJob = { state: 'running', got: 0, total: downloadBytes() };
  const tell = () => onProgress?.({ ...modelJob! });
  const parts: string[] = [];
  // Download one archive into the models folder, counting toward the shared progress bar
  const fetchTo = async (url: string, file: string) => {
    parts.push(file);
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`);
    const out = fs.createWriteStream(file);
    let last = 0;
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
      modelJob!.got += chunk.length;
      if (Date.now() - last > 300) {
        last = Date.now();
        tell();
      }
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
  };
  const tmp = path.join(dir, `${KOKORO.name}.unpack`);
  try {
    if (!fs.existsSync(path.join(kokoroDir(), 'voices.bin'))) {
      const archive = path.join(dir, `${KOKORO.name}.tar.bz2.part`);
      await fetchTo(process.env.CUTROOM_MODEL_URL ?? KOKORO.url, archive);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      await untar(archive, tmp);
      const inner = path.join(tmp, KOKORO.name);
      fs.rmSync(kokoroDir(), { recursive: true, force: true });
      fs.renameSync(fs.existsSync(inner) ? inner : tmp, kokoroDir());
    }
    if (useCli() && !cliInstalled()) {
      const archive = path.join(dir, `${SHERPA_CLI.name}.tar.bz2.part`);
      await fetchTo(SHERPA_CLI.url, archive);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      await untar(archive, tmp, SHERPA_CLI.files.map((f) => `${SHERPA_CLI.name}/bin/${f}`));
      fs.mkdirSync(cliDir(), { recursive: true });
      for (const f of SHERPA_CLI.files) fs.renameSync(path.join(tmp, SHERPA_CLI.name, 'bin', f), path.join(cliDir(), f));
    }
    if (!modelInstalled()) throw new Error(L('The download did not contain the voice model', '下载的文件里没有语音模型'));
    modelJob = { ...modelJob, state: 'done' };
  } catch (e) {
    modelJob = { ...modelJob!, state: 'error', error: (e as Error).message };
    throw e;
  } finally {
    for (const f of parts) fs.rmSync(f, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    tell();
  }
}

// One line through the command-line program; the model loads for each call, so callers run a few at once
async function cliSynth(text: string, sid: number, speed: number): Promise<{ samples: Float32Array; sampleRate: number }> {
  const dir = kokoroDir();
  fixLexicon(dir);
  const f = (n: string) => path.join(dir, n);
  const out = path.join(os.tmpdir(), `cutroom-tts-${process.pid}-${crypto.randomBytes(6).toString('hex')}.wav`);
  const args = [
    `--kokoro-model=${f('model.int8.onnx')}`,
    `--kokoro-voices=${f('voices.bin')}`,
    `--kokoro-tokens=${f('tokens.txt')}`,
    `--kokoro-data-dir=${f('espeak-ng-data')}`,
    `--kokoro-dict-dir=${f('dict')}`,
    `--kokoro-lexicon=${f('lexicon-us-en.txt')},${f('lexicon-zh.txt')}`,
    `--tts-rule-fsts=${f('date-zh.fst')},${f('phone-zh.fst')},${f('number-zh.fst')}`,
    '--num-threads=2',
    `--sid=${sid}`,
    `--speed=${speed}`,
    `--output-filename=${out}`,
    text,
  ];
  try {
    await new Promise<void>((res, rej) => {
      const p = spawn(cliExe(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      p.on('error', rej);
      p.on('close', (c) => (c === 0 && fs.existsSync(out) ? res() : rej(new Error(`voice program failed (${c}): ${err.trim().split(/\r?\n/).pop() ?? ''}`))));
    });
    const { samples, sr } = decodeWav(fs.readFileSync(out));
    return { samples, sampleRate: sr };
  } finally {
    fs.rmSync(out, { force: true });
  }
}

// The model's Chinese lexicon has an entry with a phoneme missing from tokens.txt, which prints a warning
// on every load; drop such entries once
function fixLexicon(dir: string) {
  const mark = path.join(dir, '.cutroom-lexicon');
  if (fs.existsSync(mark)) return;
  const toks = new Set(fs.readFileSync(path.join(dir, 'tokens.txt'), 'utf8').split(/\r?\n/).map((l) => l.replace(/\s+\d+\s*$/, '')));
  for (const f of fs.readdirSync(dir).filter((x) => /^lexicon-.*\.txt$/.test(x))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    const keep = lines.filter((l) => l.trim().split(/\s+/).slice(1).every((ph) => toks.has(ph)));
    if (keep.length !== lines.length) fs.writeFileSync(path.join(dir, f), keep.join('\n'));
  }
  fs.writeFileSync(mark, '');
}

// sherpa-onnx is a native addon: loaded only when the built-in voices are used
type Tts = { generateAsync(o: { text: string; sid: number; speed: number }): Promise<{ samples: Float32Array; sampleRate: number }> };
let pool: Promise<Tts[]> | null = null;
let poolTimer: NodeJS.Timeout | null = null;
// Instances not busy right now, and callers waiting for one
let idle: Tts[] = [];
const waiting: ((t: Tts) => void)[] = [];

function kokoroPool(): Promise<Tts[]> {
  if (poolTimer) clearTimeout(poolTimer);
  // Free the models after 10 idle minutes
  poolTimer = setTimeout(() => {
    pool = null;
    idle = [];
  }, 10 * 60_000);
  poolTimer.unref?.();
  if (pool) return pool;
  const dir = kokoroDir();
  fixLexicon(dir);
  const f = (n: string) => path.join(dir, n);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node');
  const cfg = {
    model: {
      kokoro: { model: f('model.int8.onnx'), voices: f('voices.bin'), tokens: f('tokens.txt'), dataDir: f('espeak-ng-data'), dictDir: f('dict'), lexicon: [f('lexicon-us-en.txt'), f('lexicon-zh.txt')].join(',') },
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
    maxNumSentences: 1,
    ruleFsts: [f('date-zh.fst'), f('phone-zh.fst'), f('number-zh.fst')].join(','),
  };
  // One instance per worker; synthesis of one line uses about two cores
  const n = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)));
  pool = Promise.all(Array.from({ length: n }, () => sherpa.OfflineTts.createAsync(cfg) as Promise<Tts>));
  pool.then((list) => (idle = [...list])).catch(() => (pool = null));
  return pool;
}

async function withKokoro<T>(fn: (t: Tts) => Promise<T>): Promise<T> {
  await kokoroPool();
  const t = idle.pop() ?? (await new Promise<Tts>((res) => waiting.push(res)));
  try {
    return await fn(t);
  } finally {
    const next = waiting.shift();
    if (next) next(t);
    else idle.push(t);
  }
}

// ---- text the voice reads ----

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n: number): string {
  if (n < 0) return `minus ${numberWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const)
    if (n >= v) return `${numberWords(Math.floor(n / v))} ${w}${n % v ? ` ${numberWords(n % v)}` : ''}`;
  return String(n);
}

// Words read better than letters the voice would guess at
const SAY_AS: Record<string, string> = { JSON: 'Jason', GIF: 'gif', NASA: 'nasa', SaaS: 'sass' };
// Letter names as words the lexicon knows, so "AI" is read "eh eye" (A as in "eh"), not as the article "a"
const LETTER: Record<string, string> = { A: 'eh', B: 'bee', C: 'see', D: 'dee', E: 'e', F: 'eff', G: 'gee', H: 'aitch', I: 'eye', J: 'jay', K: 'kay', L: 'el', M: 'em', N: 'en', O: 'oh', P: 'pee', Q: 'cue', R: 'are', S: 'ess', T: 'tee', U: 'you', V: 'vee', W: 'double you', X: 'ex', Y: 'why', Z: 'zee' };
// Chinese voices read letters the way Mandarin speakers say them ("AI" = 诶爱)
const LETTER_ZH: Record<string, string> = { A: '诶', B: '比', C: '西', D: '迪', E: '伊', F: '艾弗', G: '吉', H: '艾尺', I: '爱', J: '杰', K: '开', L: '艾勒', M: '艾姆', N: '恩', O: '欧', P: '皮', Q: '丘', R: '阿尔', S: '艾斯', T: '提', U: '优', V: '维', W: '达不溜', X: '艾克斯', Y: '歪', Z: '贼' };

// The built-in voice reads digits only in Chinese text, and guesses at capital-letter abbreviations
export function speakable(text: string, lang: Lang): string {
  let t = plain(text).replace(/\s+/g, ' ').trim();
  const zh = lang === 'zh' && /[\u4e00-\u9fff]/.test(t);
  // Capital abbreviations (AI, CLI, MP4) are spelled out; \b fails next to Chinese characters, so match by hand
  const spell = (w: string) => (zh ? w.split('').map((c) => LETTER_ZH[c]).join('') : ` ${w.split('').map((c) => LETTER[c]).join(' ')} `);
  t = t.replace(/(?<![A-Za-z])[A-Za-z]{2,5}(?![A-Za-z])/g, (w) => SAY_AS[w] ?? (/^[A-Z]{2,5}$/.test(w) ? spell(w) : w)).replace(/ {2,}/g, ' ').trim();
  if (!zh) {
    t = t
      .replace(/(\d)([A-Za-z])/g, '$1 $2')
      .replace(/(\d+):(\d+)/g, '$1 by $2')
      .replace(/(\d[\d,]*)(\.\d+)?\s?%/g, (_, a, b) => `${a}${b ?? ''} percent`)
      .replace(/\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?/g, (m) => {
        const [i, d] = m.replace(/,/g, '').split('.');
        const whole = Number(i);
        if (!Number.isSafeInteger(whole) || whole >= 1e12) return m;
        return numberWords(whole) + (d ? ` point ${d.split('').map((c) => ONES[Number(c)]).join(' ')}` : '');
      });
  }
  return t;
}

// What a line says in a language; `say`/`sayEn` override the caption text
export const spokenText = (l: Line, lang: Lang) => (lang === 'zh' ? (l.say ?? l.zh) : (l.sayEn ?? l.en ?? '')).trim();

// ---- audio ----

export function encodeWav(samples: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

// PCM 16/24/32-bit or float WAV → mono floats
export function decodeWav(buf: Buffer): { samples: Float32Array; sr: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = 1;
  let ch = 1;
  let sr = 24000;
  let bits = 16;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = buf.readUInt16LE(body);
      ch = buf.readUInt16LE(body + 2);
      sr = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if (fmt === 0xfffe) fmt = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      // Streamed WAVs leave the size at 0 or 0xFFFFFFFF
      if (!size || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      const bytes = bits / 8;
      const n = Math.floor(size / bytes / ch);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let c = 0; c < ch; c++) {
          const p = body + (i * ch + c) * bytes;
          acc += fmt === 3 ? (bits === 64 ? buf.readDoubleLE(p) : buf.readFloatLE(p)) : bits === 16 ? buf.readInt16LE(p) / 32768 : bits === 24 ? buf.readIntLE(p, 3) / 8388608 : bits === 32 ? buf.readInt32LE(p) / 2147483648 : (buf[p] - 128) / 128;
        }
        out[i] = acc / ch;
      }
      return { samples: out, sr };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV without data');
}

export const pcm16 = (buf: Buffer): Float32Array => {
  const out = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
};

// Cut silence at both ends (RMS gate), keeping a little air
export function trimSilence(x: Float32Array, sr: number, db = -42, head = 0.04, tail = 0.12): Float32Array {
  const win = Math.max(1, Math.round(sr * 0.01));
  const n = Math.floor(x.length / win);
  const gate = 10 ** (db / 20);
  let a = -1;
  let b = -1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * win; j < (i + 1) * win; j++) s += x[j] * x[j];
    if (Math.sqrt(s / win) > gate) {
      if (a < 0) a = i;
      b = i;
    }
  }
  if (a < 0) return x;
  return x.slice(Math.max(0, a * win - Math.round(head * sr)), Math.min(x.length, (b + 1) * win + Math.round(tail * sr)));
}

// Same loudness for every line: RMS to -20 dBFS, peaks under -0.5 dB
export function level(x: Float32Array, target = -20): Float32Array {
  let s = 0;
  let peak = 0;
  for (const v of x) {
    s += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(s / Math.max(1, x.length));
  if (rms < 1e-6) return x;
  const g = Math.min(10 ** (target / 20) / rms, 0.95 / peak);
  return x.map((v) => v * g);
}

// ---- engines ----

export interface Synth {
  samples: Float32Array;
  sr: number;
}

async function httpFail(r: Response): Promise<Error> {
  const t = await r.text().catch(() => '');
  let msg = t;
  try {
    const j = JSON.parse(t);
    msg = j.error?.message ?? j.message ?? j.msg ?? t;
  } catch {
    // Not JSON
  }
  return new Error(`${r.status} ${String(msg).replace(/\s+/g, ' ').slice(0, 300)}`);
}

const OPENAI_BASE = () => {
  const c = readSettings().ai?.compat;
  return (c?.preset === 'openai' && c.base) || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
};
const GEMINI_BASE = () => process.env.CUTROOM_GEMINI_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';
const QWEN_BASE = () => {
  if (process.env.CUTROOM_QWEN_BASE) return process.env.CUTROOM_QWEN_BASE;
  const c = readSettings().ai?.compat;
  // Keys from the international (Singapore) region only work there
  return c?.preset === 'qwen' && /dashscope-intl/.test(c.base ?? '') ? 'https://dashscope-intl.aliyuncs.com/api/v1' : 'https://dashscope.aliyuncs.com/api/v1';
};

let geminiModel: { key: string; model: string } | null = null;
async function geminiTtsModel(key: string): Promise<string> {
  if (geminiModel?.key === key) return geminiModel.model;
  const r = await fetch(`${GEMINI_BASE()}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw await httpFail(r);
  const names: string[] = ((await r.json()).models ?? []).map((m: { name: string }) => m.name.replace(/^models\//, '')).filter((n: string) => /tts/i.test(n));
  if (!names.length) throw new Error(L('This Gemini key has no text-to-speech model', '这个 Gemini Key 没有语音合成模型'));
  // Newest flash model first, preview builds after stable ones
  const score = (n: string) => (/flash/.test(n) ? 2 : 0) + (/lite/.test(n) ? -1 : 0) + (/preview/.test(n) ? -0.5 : 0) + Number(/(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0) / 10;
  const model = names.sort((a, b) => score(b) - score(a))[0];
  geminiModel = { key, model };
  return model;
}

// Why an engine cannot run right now (no key, no model), or null
export function notReady(engine: EngineId): string | null {
  const def = engineDef(engine, TEST())!;
  if (def.keyPreset && !keyFor(def)) return L(`Add a ${preset(def.keyPreset)?.en ?? def.en} key in Settings › AI to use these voices`, `要用这些音色，先在「设置 › AI」里填 ${preset(def.keyPreset)?.zh ?? def.zh} 的 Key`);
  if (engine === 'builtin' && !modelInstalled()) return L('The built-in voices need their model: download it in the Voiceover panel first', '内置配音需要先在「配音」面板下载语音模型');
  if (engine === 'local' && !localReady()) return L('The HD voices are not installed yet: install them in the Voiceover panel', '高清配音还没安装，先在「配音」面板安装');
  return null;
}

async function synthOne(engine: EngineId, voice: string, text: string, lang: Lang, speed: number): Promise<Synth> {
  const def = engineDef(engine, TEST())!;
  const key = keyFor(def);
  const why = notReady(engine);
  if (why) throw new Error(why);
  switch (engine) {
    case 'test': {
      const sr = 24000;
      const secs = Math.max(0.4, (lang === 'zh' ? [...plain(text)].length / 4.5 : plain(text).length / 14) / speed);
      const s = new Float32Array(Math.round(secs * sr));
      for (let i = 0; i < s.length; i++) s[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sr);
      return { samples: s, sr };
    }
    case 'builtin': {
      const sid = Math.max(0, KOKORO.speakers.indexOf(voice));
      const a = useCli() ? await cliSynth(speakable(text, lang), sid, speed) : await withKokoro((t) => t.generateAsync({ text: speakable(text, lang), sid, speed }));
      return { samples: a.samples, sr: a.sampleRate };
    }
    case 'local': {
      const out = path.join(os.tmpdir(), `cutroom-hd-${process.pid}-${crypto.randomBytes(6).toString('hex')}.wav`);
      try {
        await speakLocal({ text: plain(text), lang, voice, speed, out });
        return decodeWav(fs.readFileSync(out));
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
    case 'openai': {
      const r = await fetch(`${OPENAI_BASE().replace(/\/+$/, '')}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.CUTROOM_OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', voice, input: plain(text), response_format: 'pcm', speed }),
      });
      if (!r.ok) throw await httpFail(r);
      // pcm = 24 kHz 16-bit mono, no header
      return { samples: pcm16(Buffer.from(await r.arrayBuffer())), sr: 24000 };
    }
    case 'gemini': {
      const model = await geminiTtsModel(key);
      const pace = speed > 1.05 ? 'Read at a brisk pace: ' : speed < 0.95 ? 'Read slowly: ' : '';
      const r = await fetch(`${GEMINI_BASE()}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: pace + plain(text) }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        }),
      });
      if (!r.ok) throw await httpFail(r);
      const j = await r.json();
      const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData;
      if (!part?.data) throw new Error(L('Gemini returned no audio', 'Gemini 没有返回音频'));
      const buf = Buffer.from(part.data, 'base64');
      if (buf.toString('ascii', 0, 4) === 'RIFF') return decodeWav(buf);
      return { samples: pcm16(buf), sr: Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1] ?? 24000) };
    }
    case 'qwen': {
      const r = await fetch(`${QWEN_BASE()}/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.CUTROOM_QWEN_TTS_MODEL ?? 'qwen3-tts-flash', input: { text: plain(text), voice, language_type: lang === 'en' ? 'English' : 'Chinese' } }),
      });
      if (!r.ok) throw await httpFail(r);
      const j = await r.json();
      const audio = j.output?.audio ?? {};
      const url: string | undefined = audio.url ?? j.output?.audio_url ?? j.data?.audio_url;
      let buf: Buffer;
      if (audio.data) buf = Buffer.from(audio.data, 'base64');
      else if (url) {
        const a = await fetch(url);
        if (!a.ok) throw await httpFail(a);
        buf = Buffer.from(await a.arrayBuffer());
      } else throw new Error(L('Qwen returned no audio', '通义千问没有返回音频'));
      return buf.toString('ascii', 0, 4) === 'RIFF' ? decodeWav(buf) : { samples: pcm16(buf), sr: 24000 };
    }
  }
}

// ---- what is voiced ----

export interface LineState {
  scene: string;
  k: number;
  text: string;
  state: 'voiced' | 'stale' | 'missing' | 'empty';
  dur?: number;
}

const projectDir = (slug: string) => path.join(PUBLIC, slug);

// A clip is current when its file exists and it was made from the line's present text
export function clipFresh(c: VoiceClip | undefined, l: Line, lang: Lang, slug: string): boolean {
  if (!c?.file || !c.dur) return false;
  if (c.text && c.text !== plain(l.zh)) return false;
  if (c.spoken !== undefined && c.spoken !== plain(spokenText(l, lang))) return false;
  return fs.existsSync(path.join(projectDir(slug), c.file));
}

export function lineStates(slug: string, lang: Lang): LineState[] {
  const { doc } = readDoc(slug);
  const t = doc.timings[lang];
  const out: LineState[] = [];
  for (const s of doc.board.scenes)
    s.lines.forEach((l, k) => {
      const text = spokenText(l, lang);
      const c = t?.scenes[s.id]?.[k];
      const state = !plain(text).trim() ? 'empty' : clipFresh(c, l, lang, slug) ? 'voiced' : c?.file ? 'stale' : 'missing';
      out.push({ scene: s.id, k, text: plain(text), state, dur: state === 'voiced' ? c!.dur : undefined });
    });
  return out;
}

// ---- voicing a project ----

export interface VoiceRun {
  slug: string;
  lang: Lang;
  // Limit to these scenes / these lines ("scene:k"); default every line
  scenes?: string[];
  lines?: string[];
  // Re-voice lines that already have current audio
  redo?: boolean;
  engine?: EngineId;
  voice?: string;
}
export interface VoiceProgress {
  done: number;
  total: number;
  line?: string;
}
export interface VoiceResult {
  voiced: number;
  kept: number;
  total: number;
  seconds: number;
  failed: { line: string; error: string }[];
}

export async function voiceProject(run: VoiceRun, onProgress?: (p: VoiceProgress) => void, signal?: AbortSignal): Promise<VoiceResult> {
  const settings = voiceSettings();
  const engine = run.engine && engineDef(run.engine, TEST()) ? run.engine : settings.engine;
  const voice = run.voice ?? voiceOf(settings, engine, run.lang);
  const def = engineDef(engine, TEST())!;
  if (!hasVoice(def, voice)) throw new Error(L(`No voice ${voice} in ${def.en}`, `${def.zh}里没有音色 ${voice}`));
  const why = notReady(engine);
  if (why) throw new Error(why);
  const speed = settings.speed;
  const { doc } = readDoc(run.slug);
  const lang = run.lang;
  const old = doc.timings[lang];
  const voDir = path.join(projectDir(run.slug), 'vo');
  fs.mkdirSync(voDir, { recursive: true });
  const id = `${engine}:${voice}`;
  // The text rules version is part of the name, so a reading fix makes new files instead of reusing old ones
  // The HD voice samples each take, so redoing a line asks for a new one instead of reusing the file
  const take = run.redo && engine === 'local' ? `|${Date.now().toString(36)}` : '';
  const fileOf = (text: string) => `vo/${crypto.createHash('md5').update(`${id}|${speed}|${lang}|${engine === 'builtin' ? `r${RULES}|` : ''}${text}${take}`).digest('hex').slice(0, 12)}.wav`;

  type Todo = { scene: string; k: number; line: Line; text: string };
  const inScope = (scene: string, k: number) => (!run.scenes?.length || run.scenes.includes(scene)) && (!run.lines?.length || run.lines.includes(`${scene}:${k}`));
  const todo: Todo[] = [];
  for (const s of doc.board.scenes)
    s.lines.forEach((l, k) => {
      const text = plain(spokenText(l, lang));
      if (!text.trim() || !inScope(s.id, k)) return;
      if (!run.redo && clipFresh(old?.scenes[s.id]?.[k], l, lang, run.slug)) return;
      todo.push({ scene: s.id, k, line: l, text });
    });

  const made = new Map<string, VoiceClip>();
  const failed: VoiceResult['failed'] = [];
  let done = 0;
  onProgress?.({ done, total: todo.length });
  const work = async (t: Todo) => {
    const file = fileOf(t.text);
    const abs = path.join(projectDir(run.slug), file);
    try {
      if (!fs.existsSync(abs)) {
        const a = await synthOne(engine, voice, t.text, lang, speed);
        if (signal?.aborted) return;
        const x = level(trimSilence(a.samples, a.sr));
        fs.writeFileSync(abs, encodeWav(x, a.sr));
      }
      const { samples, sr } = decodeWav(fs.readFileSync(abs));
      made.set(`${t.scene}:${t.k}`, { file, dur: Math.round((samples.length / sr) * 1000) / 1000, text: plain(t.line.zh), spoken: t.text, voice: id });
    } catch (e) {
      failed.push({ line: `${t.scene}:${t.k + 1} ${t.text.slice(0, 40)}`, error: (e as Error).message });
    }
    done++;
    onProgress?.({ done, total: todo.length, line: t.text });
  };
  // Cloud engines take a few requests at once; the built-in pool sets its own width; the HD worker batches 4 lines
  const width = !todo.length ? 0 : engine === 'builtin' ? (useCli() ? 3 : (await kokoroPool().catch(() => [null])).length) : engine === 'test' || engine === 'local' ? 4 : 3;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(width, queue.length) }, async () => {
      while (queue.length && !signal?.aborted) {
        await work(queue.shift()!);
        // A provider that fails the first lines (quota, bad key) would fail the rest the same way
        if (failed.length >= 3 && failed.length === done) queue.length = 0;
      }
    }),
  );

  // Rebuild against the board as it is now: lines may have moved while the voices were made
  const now = readDoc(run.slug).doc;
  const prev = now.timings[lang] ?? old;
  const timings: Timings = { voice: id, lang, scenes: {} };
  let kept = 0;
  let seconds = 0;
  for (const s of now.board.scenes) {
    timings.scenes[s.id] = s.lines.map((l, k) => {
      const fresh = made.get(`${s.id}:${k}`);
      if (fresh && fresh.text === plain(l.zh)) {
        seconds += fresh.dur;
        return fresh;
      }
      const c = prev?.scenes[s.id]?.[k];
      if (c && clipFresh(c, l, lang, run.slug)) {
        kept++;
        seconds += c.dur;
      }
      return c ?? { file: '', dur: 0, text: plain(l.zh) };
    });
  }
  if (made.size || !fs.existsSync(path.join(projectDir(run.slug), lang === 'en' ? 'timings-en.json' : 'timings.json'))) writeTimings(run.slug, lang, timings);
  pruneClips(run.slug);
  return { voiced: made.size, kept, total: todo.length + kept, seconds: Math.round(seconds * 10) / 10, failed };
}

// Remove clips this tool made that neither language's timings use any more (tts.py names have an underscore)
function pruneClips(slug: string) {
  const dir = path.join(projectDir(slug), 'vo');
  if (!fs.existsSync(dir)) return;
  const used = new Set<string>();
  for (const f of ['timings.json', 'timings-en.json']) {
    const p = path.join(projectDir(slug), f);
    if (!fs.existsSync(p)) continue;
    const t = JSON.parse(fs.readFileSync(p, 'utf8')) as Timings;
    for (const clips of Object.values(t.scenes)) for (const c of clips) if (c.file) used.add(path.basename(c.file));
  }
  for (const f of fs.readdirSync(dir)) if (/^[0-9a-f]{12}\.wav$/.test(f) && !used.has(f)) fs.rmSync(path.join(dir, f), { force: true });
}

// One sentence in a voice, for the preview button; cached per engine, voice, language and speed
export async function sample(engine: EngineId, voice: string, lang: Lang): Promise<Buffer> {
  const speed = voiceSettings().speed;
  const dir = path.join(STATE, 'voice-samples');
  const f = path.join(dir, `${engine}-${voice}-${lang}-${speed}.wav`.replace(/[^\w.-]/g, '_'));
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const a = await synthOne(engine, voice, SAMPLE[lang], lang, speed);
  const buf = encodeWav(level(trimSilence(a.samples, a.sr)), a.sr);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, buf);
  return buf;
}

// Engines for the panel: which are ready, which need a key or the model
export function engineStatus() {
  const list = TEST() ? [...ENGINES, TEST_ENGINE] : ENGINES;
  return list.map((e) => ({
    id: e.id,
    ready: e.id === 'builtin' ? modelInstalled() : e.id === 'local' ? localReady() : e.keyPreset ? !!keyFor(e) : true,
    need: e.id === 'builtin' ? (modelInstalled() ? undefined : 'model') : e.id === 'local' ? (localReady() ? undefined : 'install') : e.keyPreset && !keyFor(e) ? 'key' : undefined,
  }));
}
