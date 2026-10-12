// Loudness of an exported video (EBU R128 through FFmpeg's loudnorm), and a two-pass fix to a target
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegBin } from './record';

export interface Loudness {
  // Integrated loudness (LUFS), true peak (dBTP), loudness range (LU)
  i: number;
  tp: number;
  lra: number;
  thresh: number;
}

const run = (args: string[]) => spawnSync(ffmpegBin(), ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });

// null when the file has no sound
export function measureLoudness(file: string): Loudness | null {
  const r = run(['-i', file, '-vn', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.stderr ?? '');
  if (!m) return null;
  const j = JSON.parse(m[0]) as Record<string, string>;
  const n = (k: string) => Number(j[k]);
  if (!Number.isFinite(n('input_i')) || n('input_i') < -70) return null;
  return { i: n('input_i'), tp: n('input_tp'), lra: n('input_lra'), thresh: n('input_thresh') };
}

// Bring the whole mix to `target` LUFS with a -1.5 dBTP ceiling; the picture is copied, not re-encoded
export function normalizeLoudness(file: string, target: number, measured = measureLoudness(file)): Loudness | null {
  if (!measured) return null;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.lufs${path.extname(file)}`);
  const af = `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${measured.i}:measured_TP=${measured.tp}:measured_LRA=${measured.lra}:measured_thresh=${measured.thresh}:linear=true,aresample=48000`;
  const codec = path.extname(file).toLowerCase() === '.webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k'];
  const r = run(['-y', '-i', file, '-map', '0', '-c:v', 'copy', '-af', af, ...codec, '-movflags', '+faststart', tmp]);
  if (r.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`loudness pass failed: ${(r.stderr ?? '').trim().split(/\r?\n/).pop()}`);
  }
  fs.renameSync(tmp, file);
  return measureLoudness(file);
}

export const describe = (l: Loudness) => `${l.i.toFixed(1)} LUFS, true peak ${l.tp.toFixed(1)} dBTP`;
