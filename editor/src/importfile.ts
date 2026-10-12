// Footage made elsewhere (OBS, Xbox Game Bar, a phone, JianyingPro): into the project as a screen recording or media
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PUBLIC } from './store';
import { ffmpegBin } from './record';
import { probe } from './media';
import type { CaptureMeta } from '../../src/lib/types';

const VIDEO = /\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv|ts)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;

const stemOf = (f: string) =>
  path
    .basename(f, path.extname(f))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'clip';

function freeName(dir: string, stem: string, ext: string) {
  let name = stem;
  for (let n = 2; fs.existsSync(path.join(dir, `${name}${ext}`)); n++) name = `${stem}-${n}`;
  return name;
}

export interface Imported {
  file: string;
  kind: 'screen' | 'clip' | 'image' | 'audio';
  duration?: number;
  width?: number;
  height?: number;
}

// A video becomes cap/<name>.mp4 (30 fps H.264, the way screen scenes play best) with an empty capture log,
// unless asMedia: then it is copied to media/ as is, like images and audio
export async function importFile(slug: string, file: string, name?: string, asMedia = false): Promise<Imported> {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`no file ${file}`);
  const ext = path.extname(file).toLowerCase();
  const stem = name ? stemOf(name) : stemOf(file);
  const proj = path.join(PUBLIC, slug);
  if (IMAGE.test(ext) || AUDIO.test(ext) || (VIDEO.test(ext) && asMedia)) {
    const dir = path.join(proj, 'media');
    fs.mkdirSync(dir, { recursive: true });
    const n = freeName(dir, stem, ext);
    fs.copyFileSync(file, path.join(dir, `${n}${ext}`));
    const kind = IMAGE.test(ext) ? 'image' : AUDIO.test(ext) ? 'audio' : 'clip';
    return { file: `media/${n}${ext}`, kind };
  }
  if (!VIDEO.test(ext)) throw new Error(`${path.basename(file)}: import takes videos, images and audio`);
  const dir = path.join(proj, 'cap');
  fs.mkdirSync(dir, { recursive: true });
  const n = freeName(dir, stem, '.mp4');
  const info = await probe(file);
  if (!info.width) throw new Error(`${path.basename(file)} has no picture`);
  const out = path.join(dir, `${n}.mp4`);
  // Even size, constant 30 fps, a keyframe each second: seeks land on the right frame
  const r = spawnSync(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-an', '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30', '-movflags', '+faststart', out], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 24 });
  if (r.status !== 0) {
    fs.rmSync(out, { force: true });
    throw new Error(`could not convert ${path.basename(file)}: ${(r.stderr ?? '').trim().slice(-300)}`);
  }
  const got = await probe(out);
  const meta: CaptureMeta & { source: object } = { width: got.width, height: got.height, fps: 30, dpr: 1, duration: Math.round(got.duration * 1000) / 1000, events: [], source: { kind: 'import', from: path.basename(file) } };
  fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(meta));
  return { file: `cap/${n}.mp4`, kind: 'screen', duration: meta.duration, width: got.width, height: got.height };
}

// Add, move or remove a named moment in a recording's capture log
export async function setMark(slug: string, rec: string, name: string, at: number | null): Promise<{ file: string; marks: { name: string; t: number }[] }> {
  const base = rec.replace(/^cap\//, '').replace(/\.mp4$/, '');
  const mp4 = path.join(PUBLIC, slug, 'cap', `${base}.mp4`);
  const js = path.join(PUBLIC, slug, 'cap', `${base}.json`);
  if (!fs.existsSync(mp4)) throw new Error(`no recording cap/${base}.mp4 (media lists them)`);
  if (!/^[\w-]+$/.test(name) || name === 'end') throw new Error('mark names use letters, digits, - and _ ("end" is built in)');
  let meta: CaptureMeta;
  if (fs.existsSync(js)) meta = JSON.parse(fs.readFileSync(js, 'utf8'));
  else {
    const p = await probe(mp4);
    meta = { width: p.width, height: p.height, fps: 30, dpr: 1, duration: p.duration, events: [] };
  }
  meta.events = meta.events.filter((e) => !(e.type === 'mark' && e.name === name));
  if (at !== null) {
    if (!(at >= 0 && at <= meta.duration)) throw new Error(`the recording is ${meta.duration.toFixed(2)} s long`);
    meta.events.push({ t: Math.round(at * 1000) / 1000, type: 'mark', name });
    meta.events.sort((a, b) => a.t - b.t);
  }
  fs.writeFileSync(js, JSON.stringify(meta));
  return { file: `cap/${base}.mp4`, marks: meta.events.filter((e) => e.type === 'mark').map((e) => ({ name: e.name!, t: e.t })) };
}
