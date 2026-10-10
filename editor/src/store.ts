import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Storyboard, Timings } from '../../src/lib/types';
import type { Doc } from './ops';

// editor/dist/*.mjs → repo root
export const ROOT = process.env.VS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Installed app: projects, settings and exports live in a user folder (VS_DATA), not next to the code
export const DATA = process.env.VS_DATA ?? ROOT;
export const PUBLIC = process.env.VS_DATA ? DATA : path.join(ROOT, 'public');
export const STATE = path.join(DATA, '.editor');
export const OUT = process.env.VS_DATA ? path.join(DATA, 'exports') : path.join(ROOT, 'out');

export type Source = 'ui' | 'cli' | 'external';

export interface LogEntry {
  t: string;
  src: Source;
  version: string;
  prev?: string;
  desc: string[];
}

export class Conflict extends Error {
  constructor(public current: string) {
    super('conflict');
  }
}

export const hash = (text: string) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
export const boardFile = (slug: string) => path.join(PUBLIC, slug, 'storyboard.json');
const timingsFile = (slug: string, lang: 'zh' | 'en') => path.join(PUBLIC, slug, lang === 'en' ? 'timings-en.json' : 'timings.json');
const stateDir = (slug: string) => path.join(STATE, slug);

export function checkSlug(slug: string) {
  if (!/^[\w-]+$/.test(slug) || !fs.existsSync(boardFile(slug))) throw new Error(`No project ${slug}`);
}

export const slugs = () =>
  fs
    .readdirSync(PUBLIC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(boardFile(d.name)))
    .map((d) => d.name);

const readJson = <T>(file: string): T | undefined => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : undefined);

export function readDoc(slug: string): { doc: Doc; version: string } {
  checkSlug(slug);
  const text = fs.readFileSync(boardFile(slug), 'utf8');
  return { doc: { board: JSON.parse(text) as Storyboard, timings: { zh: readJson<Timings>(timingsFile(slug, 'zh')), en: readJson<Timings>(timingsFile(slug, 'en')) } }, version: hash(text) };
}

export const currentVersion = (slug: string) => hash(fs.readFileSync(boardFile(slug), 'utf8'));

// Write via temp file so readers never see half a file; on Windows the rename fails while another process
// has the target open, so retry briefly
function atomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

const boardText = (b: Storyboard) => JSON.stringify(b, null, 2);
// timings files are written by tts.py with indent=1
const timingsText = (t: Timings) => JSON.stringify(t, null, 1);

export function snapshot(slug: string, version: string, text: string) {
  const dir = path.join(stateDir(slug), 'snap');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${version}.json`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, text, 'utf8');
}

export function appendLog(slug: string, e: LogEntry) {
  fs.mkdirSync(stateDir(slug), { recursive: true });
  fs.appendFileSync(path.join(stateDir(slug), 'log.jsonl'), JSON.stringify(e) + '\n', 'utf8');
}

export function readLog(slug: string): LogEntry[] {
  const f = path.join(stateDir(slug), 'log.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
}

export function readSnapshot(slug: string, version: string): Storyboard | undefined {
  return readJson<Storyboard>(path.join(stateDir(slug), 'snap', `${version}.json`));
}

// Save a doc; base guards against overwriting a change made elsewhere since it was read
export function writeDoc(slug: string, doc: Doc, src: Source, desc: string[], base?: string, withTimings = false): string {
  checkSlug(slug);
  const prevText = fs.readFileSync(boardFile(slug), 'utf8');
  const prev = hash(prevText);
  if (base && base !== prev) throw new Conflict(prev);
  snapshot(slug, prev, prevText);
  const text = boardText(doc.board);
  const version = hash(text);
  if (withTimings)
    for (const lang of ['zh', 'en'] as const) {
      const t = doc.timings[lang];
      const f = timingsFile(slug, lang);
      if (t && fs.existsSync(f) && timingsText(t) !== timingsText(readJson<Timings>(f)!)) atomic(f, timingsText(t));
    }
  if (version === prev) return version;
  snapshot(slug, version, text);
  appendLog(slug, { t: new Date().toISOString(), src, version, prev, desc });
  atomic(boardFile(slug), text);
  return version;
}
