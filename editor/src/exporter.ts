// One export: file name, output path and the Remotion render command; shared by the server and the CLI
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OUT, PUBLIC, ROOT, STATE, checkSlug } from './store';
import { readSettings } from './settings';
import { slimPublic } from './slim';

export const CODECS: Record<string, string> = { h264: 'mp4', h265: 'mp4', vp9: 'webm', prores: 'mov', gif: 'gif' };

// The folder chosen in Settings, else out/editor (app: Documents\Cutroom\exports\editor)
export const DEFAULT_EXPORTS = path.join(OUT, 'editor');
export function exportDir(): string {
  const d = readSettings().exportDir;
  return typeof d === 'string' && path.isAbsolute(d) ? d : DEFAULT_EXPORTS;
}

const AUDIO_KBPS = 128;
// Video kbit/s that keeps a file of `seconds` under `mb` (6% headroom for the container and rate-control overshoot)
export const videoBitrate = (mb: number, seconds: number) => Math.floor((mb * 8 * 1024 * 1024 * 0.94) / seconds / 1000 - AUDIO_KBPS);

export interface ExportOpts {
  slug: string;
  format: string;
  mode: string;
  variant: string;
  lang: string;
  voice: string;
  scale?: number;
  codec?: string;
  // Fit the file under this many MB (needs `seconds`, the video's length)
  maxMb?: number;
  seconds?: number;
  // 'picture': no captions, narration, music or added sounds (for finishing in another editor)
  parts?: 'picture';
  // Output file instead of <export folder>/<name>.<ext>
  out?: string;
}

export function exportPlan(o: ExportOpts) {
  checkSlug(o.slug);
  const codec = o.codec && CODECS[o.codec] ? o.codec : 'h264';
  const scale = [0.5, 1, 1.5, 2].includes(Number(o.scale)) ? Number(o.scale) : 1;
  const name = [o.slug, o.format, o.mode === 'beat' ? 'beat' : null, o.variant === 'clean' ? 'clean' : null, o.lang === 'en' ? 'en' : null, o.voice === 'off' && o.mode !== 'beat' ? 'silent' : null, scale !== 1 ? `x${scale}` : null].filter(Boolean).join('-');
  const out = o.out ? path.resolve(o.out) : path.join(exportDir(), `${name}.${CODECS[codec]}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(STATE, { recursive: true });
  const propsFile = path.join(STATE, `render-props-${process.pid}.json`);
  fs.writeFileSync(propsFile, JSON.stringify({ slug: o.slug, format: o.format, mode: o.mode, variant: o.variant, lang: o.lang, voice: o.voice, ...(o.parts ? { parts: o.parts } : {}) }));
  const cli = path.join(ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  // Only this project and the shared assets go into the render bundle (not every project and old export)
  const slim = slimPublic(o.slug);
  const args = [cli, 'render', 'src/index.ts', `studio-${o.format}`, out, `--props=${propsFile}`, `--codec=${codec}`, `--public-dir=${slim?.dir ?? PUBLIC}`];
  if (scale !== 1) args.push(`--scale=${scale}`);
  const env: Record<string, string> = {};
  if (o.maxMb && o.seconds && codec !== 'gif' && codec !== 'prores') {
    const v = videoBitrate(o.maxMb, o.seconds);
    if (v < 150) throw new Error(`${o.maxMb} MB is too small for ${o.seconds.toFixed(0)} s of video (it leaves ${v} kbit/s); allow more, or export a shorter cut`);
    args.push(`--video-bitrate=${v}k`, `--audio-bitrate=${AUDIO_KBPS}k`);
    env.CUTROOM_BITRATE = '1';
  }
  const cleanup = () => {
    slim?.cleanup();
    fs.rmSync(propsFile, { force: true });
  };
  return { name, out, args, codec, cleanup, env };
}

// Run an export to the end (CLI); progress lines go to onLine
export function runExport(o: ExportOpts, onLine: (s: string) => void): Promise<{ out: string; code: number }> {
  const plan = exportPlan(o);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, plan.args, { cwd: ROOT, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...plan.env } });
    const feed = (b: Buffer) => b.toString('utf8').split(/[\r\n]+/).filter((x) => x.trim()).forEach((x) => onLine(x.replace(/\x1b\[[0-9;]*m/g, '')));
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('close', (code) => {
      plan.cleanup();
      resolve({ out: plan.out, code: code ?? 1 });
    });
  });
}
