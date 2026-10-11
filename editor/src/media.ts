// Decoding for analysis: small grayscale frames and mono PCM, through the bundled ffmpeg
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ffmpegBin } from './record';

export interface Probe {
  duration: number;
  fps: number;
  width: number;
  height: number;
  audio: boolean;
}

function run(args: string[], maxBytes = 2e9): Promise<{ out: Buffer; err: string; code: number }> {
  const ff = ffmpegBin();
  // Remotion's Linux ffmpeg loads its libraries from its own folder
  const env = process.platform === 'linux' && ff !== 'ffmpeg' ? { ...process.env, LD_LIBRARY_PATH: [path.dirname(ff), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : process.env;
  return new Promise((resolve, reject) => {
    const c = spawn(ff, args, { windowsHide: true, env });
    const chunks: Buffer[] = [];
    let size = 0;
    let err = '';
    c.stdout.on('data', (b: Buffer) => {
      size += b.length;
      if (size > maxBytes) return void c.kill();
      chunks.push(b);
    });
    c.stderr.on('data', (b: Buffer) => (err = (err + b.toString('utf8')).slice(-20000)));
    c.on('error', reject);
    c.on('close', (code) => resolve({ out: Buffer.concat(chunks), err, code: code ?? 1 }));
  });
}

// Duration, frame rate and size from ffmpeg's own report (no ffprobe needed)
export async function probe(file: string): Promise<Probe> {
  const { err } = await run(['-hide_banner', '-i', file]);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?(?:([\d.]+) fps|([\d.]+) tbr)/.exec(err);
  if (!d) throw new Error(`can't read ${path.basename(file)} (not a video or audio file?)`);
  return {
    duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    width: v ? Number(v[1]) : 0,
    height: v ? Number(v[2]) : 0,
    fps: v ? Number(v[3] ?? v[4]) : 0,
    audio: /Stream #[^\n]*Audio:/.test(err),
  };
}

// Every frame (at most `maxFps` per second) as w×h grayscale bytes
export async function grayFrames(file: string, w: number, h: number, maxFps = 30): Promise<{ frames: Uint8Array[]; fps: number; duration: number }> {
  const p = await probe(file);
  if (!p.width) throw new Error(`${path.basename(file)} has no video`);
  const fps = p.fps > 0 ? Math.min(p.fps, maxFps) : maxFps;
  const args = ['-v', 'error', '-i', file, '-an', '-vf', `scale=${w}:${h},format=gray`];
  if (p.fps > maxFps || !(p.fps > 0)) args.push('-r', String(fps));
  args.push('-c:v', 'rawvideo', '-f', 'image2pipe', 'pipe:1');
  const { out, code, err } = await run(args);
  if (code !== 0 && !out.length) throw new Error(`ffmpeg could not decode ${path.basename(file)}: ${err.trim().split('\n').pop()}`);
  const n = Math.floor(out.length / (w * h));
  const frames: Uint8Array[] = [];
  for (let i = 0; i < n; i++) frames.push(new Uint8Array(out.buffer, out.byteOffset + i * w * h, w * h));
  return { frames, fps, duration: p.duration };
}

// Mono 16-bit samples at `rate`
export async function pcm(file: string, rate = 16000): Promise<Int16Array> {
  const { out, code, err } = await run(['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1']);
  if (code !== 0 && !out.length) throw new Error(`ffmpeg could not read the sound of ${path.basename(file)}: ${err.trim().split('\n').pop()}`);
  return wavSamples(out);
}

// The data chunk of a 16-bit PCM wav (a piped wav may give a size of 0 or -1 for it)
export function wavSamples(buf: Buffer): Int16Array {
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'data') {
      const start = at + 8;
      const end = size > 0 && size !== 0xffffffff && start + size <= buf.length ? start + size : buf.length;
      const bytes = buf.subarray(start, end - ((end - start) % 2));
      const copy = new Int16Array(bytes.length / 2);
      for (let i = 0; i < copy.length; i++) copy[i] = bytes.readInt16LE(i * 2);
      return copy;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no audio data');
}

// One still as a jpeg file
export async function still(file: string, t: number, out: string, width = 320): Promise<void> {
  const { code, err } = await run(['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out]);
  if (code !== 0) throw new Error(`could not grab a frame at ${t.toFixed(2)} s: ${err.trim().split('\n').pop()}`);
}
