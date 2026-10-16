// Checkpoints taken before each AI message: every file in the project folder, plus files outside it that the AI
// changes with its file tools, so the user can put everything back as it was before that message. Contents are
// stored once per version (by hash) under .editor/<slug>/checkpoints.
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, STATE } from './store';

interface Entry {
  sha: string;
  size: number;
  mtime: number;
}

export interface Checkpoint {
  id: string;
  t: string;
  label: string;
  // Project files by path relative to the folder (forward slashes)
  files: Record<string, Entry>;
  // Files outside the project changed after this point, as they were before (sha null = did not exist)
  outside: { path: string; sha: string | null }[];
  // Too big to keep a copy of; a rollback leaves them as they are
  skipped?: string[];
}

export interface Place {
  project: string;
  dir: string;
}

const KEEP = 50;
const MAX_FILE = 500 * 1024 * 1024;

export const placeOf = (slug: string): Place => ({ project: path.join(PUBLIC, slug), dir: path.join(STATE, slug, 'checkpoints') });
const objects = (p: Place) => path.join(p.dir, 'objects');
const indexFile = (p: Place) => path.join(p.dir, 'index.json');

export function list(p: Place): Checkpoint[] {
  try {
    return JSON.parse(fs.readFileSync(indexFile(p), 'utf8'));
  } catch {
    return [];
  }
}

function writeIndex(p: Place, cps: Checkpoint[]) {
  fs.mkdirSync(p.dir, { recursive: true });
  const tmp = `${indexFile(p)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cps));
  fs.renameSync(tmp, indexFile(p));
}

async function hashFile(file: string): Promise<string> {
  const h = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

// Keep a copy of the content unless one is stored already
async function keep(p: Place, file: string, sha: string) {
  const dst = path.join(objects(p), sha);
  if (fs.existsSync(dst)) return;
  fs.mkdirSync(objects(p), { recursive: true });
  const tmp = `${dst}.${process.pid}.tmp`;
  await fs.promises.copyFile(file, tmp);
  await fs.promises.rename(tmp, dst);
}

function walk(root: string, rel = ''): string[] {
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  return names.flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? walk(root, r) : d.isFile() ? [r] : [];
  });
}

const samePath = (a: string, b: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const insideDir = (file: string, dir: string) => {
  const r = path.relative(dir, file);
  return !r.startsWith('..') && !path.isAbsolute(r);
};

// Unchanged files (same size and time) reuse the previous checkpoint's hash, so only edits are read and copied
export async function take(p: Place, label: string, tidy = true): Promise<Checkpoint> {
  const cps = list(p);
  const prev = cps.at(-1)?.files ?? {};
  const files: Record<string, Entry> = {};
  const skipped: string[] = [];
  for (const rel of walk(p.project)) {
    const abs = path.join(p.project, rel);
    const st = fs.statSync(abs);
    if (st.size > MAX_FILE) {
      skipped.push(rel);
      continue;
    }
    const o = prev[rel];
    const sha = o && o.size === st.size && o.mtime === st.mtimeMs ? o.sha : await hashFile(abs);
    await keep(p, abs, sha);
    files[rel] = { sha, size: st.size, mtime: st.mtimeMs };
  }
  const cp: Checkpoint = { id: randomUUID().slice(0, 8), t: new Date().toISOString(), label, files, outside: [], ...(skipped.length ? { skipped } : {}) };
  cps.push(cp);
  writeIndex(p, tidy ? prune(p, cps) : cps);
  return cp;
}

// Before the AI changes a file outside the project: remember how it was, once per checkpoint
export async function noteOutside(p: Place, file: string) {
  const abs = path.resolve(p.project, file);
  if (insideDir(abs, p.project)) return;
  const cps = list(p);
  const cp = cps.at(-1);
  if (!cp || cp.outside.some((o) => samePath(o.path, abs))) return;
  let sha: string | null = null;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    sha = await hashFile(abs);
    await keep(p, abs, sha);
  }
  cp.outside.push({ path: abs, sha });
  writeIndex(p, cps);
}

// A project file's content at a checkpoint, or null when it was not there
export function fileAt(p: Place, id: string, rel: string): string | null {
  const e = list(p).find((c) => c.id === id)?.files[rel];
  const blob = e ? path.join(objects(p), e.sha) : '';
  return blob && fs.existsSync(blob) ? fs.readFileSync(blob, 'utf8') : null;
}

export interface Rollback {
  restored: number;
  removed: number;
  outside: number;
  // Checkpoint of the state just before the rollback, to undo it
  undo: string;
  missing: string[];
}

// Put the project folder back as it was at checkpoint id, and every outside file changed since then
export async function rollback(p: Place, id: string): Promise<Rollback> {
  const k = list(p).findIndex((c) => c.id === id);
  if (k < 0) throw new Error('That checkpoint is no longer kept');
  const target = list(p)[k];
  // Not pruned until the restore is done: the target may be the oldest one kept
  const now = await take(p, `before rollback to ${target.label}`, false);
  const missing: string[] = [];
  let restored = 0;
  let removed = 0;
  for (const [rel, e] of Object.entries(target.files)) {
    if (now.files[rel]?.sha === e.sha) continue;
    const blob = path.join(objects(p), e.sha);
    if (!fs.existsSync(blob)) {
      missing.push(rel);
      continue;
    }
    const abs = path.join(p.project, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.copyFile(blob, abs);
    restored++;
  }
  const keepAsIs = new Set(target.skipped ?? []);
  for (const rel of Object.keys(now.files)) {
    if (rel in target.files || keepAsIs.has(rel)) continue;
    fs.rmSync(path.join(p.project, rel), { force: true });
    removed++;
    // Folders left empty by the removal go too
    for (let d = path.dirname(path.join(p.project, rel)); insideDir(d, p.project) && !samePath(d, p.project); d = path.dirname(d)) {
      try {
        fs.rmdirSync(d);
      } catch {
        break;
      }
    }
  }
  // Outside files: the earliest record at or after the target is how the file was then
  const firstSeen = new Map<string, { path: string; sha: string | null }>();
  for (const c of list(p).slice(k)) for (const o of c.outside) if (![...firstSeen.keys()].some((x) => samePath(x, o.path))) firstSeen.set(o.path, o);
  let outside = 0;
  for (const o of firstSeen.values()) {
    await noteOutside(p, o.path);
    if (o.sha === null) fs.rmSync(o.path, { force: true });
    else {
      const blob = path.join(objects(p), o.sha);
      if (!fs.existsSync(blob)) {
        missing.push(o.path);
        continue;
      }
      fs.mkdirSync(path.dirname(o.path), { recursive: true });
      await fs.promises.copyFile(blob, o.path);
    }
    outside++;
  }
  writeIndex(p, prune(p, list(p)));
  return { restored, removed, outside, undo: now.id, missing };
}

// Oldest checkpoints go first; contents no checkpoint refers to any more are deleted
function prune(p: Place, cps: Checkpoint[]): Checkpoint[] {
  const kept = cps.slice(-KEEP);
  if (kept.length === cps.length) return kept;
  const used = new Set(kept.flatMap((c) => [...Object.values(c.files).map((e) => e.sha), ...c.outside.flatMap((o) => (o.sha ? [o.sha] : []))]));
  for (const name of fs.existsSync(objects(p)) ? fs.readdirSync(objects(p)) : []) if (!used.has(name)) fs.rmSync(path.join(objects(p), name), { force: true });
  return kept;
}
