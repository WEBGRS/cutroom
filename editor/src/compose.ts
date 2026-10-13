// Music written as a score and played by real instrument recordings (XSXB-Band, CC0 samples).
// The assistant writes a small JSON draft; this module expands it, has the studio render it,
// and puts the result in the music library with the beat data a beat cut needs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PUBLIC } from './store';
import { ffmpegBin } from './record';
import { measureLoudness } from './loudness';

export const STUDIO_URL = process.env.XSXB_URL ?? 'http://127.0.0.1:4318';
// Where the studio was installed; set XSXB_BAND_HOME to move it
export const studioHome = () => {
  const here = process.env.XSXB_BAND_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'XSXB-Band');
  return fs.existsSync(path.join(here, 'server', 'validation.mjs')) ? here : null;
};
export const MUSIC_LUFS = -18;

export interface Inst {
  id: string;
  kind?: string;
  family?: string;
  name?: string;
  percussive?: boolean;
  installed?: boolean;
  articulations?: { id: string }[];
  samples?: { midi?: number }[];
}

export interface Draft {
  title: string;
  bpm: number;
  bars: number;
  key?: string;
  tracks: DraftTrack[];
}
export interface DraftTrack {
  inst: string;
  name?: string;
  vol?: number;
  pan?: number;
  reverb?: number;
  humanize?: number;
  art?: string;
  // [start beat, duration in beats, midi, velocity 0..1, articulation?]
  notes?: (number | string)[][];
  // Drum shorthand: one character per sixteenth note over a bar (x hit, X accent, . rest), one string per bar,
  // or a single string repeated for every bar
  pattern?: string | string[];
  patternArt?: string;
  // Repeat the notes every `loop` bars, from bar `from` (0-based) up to `to` (exclusive, default the end)
  loop?: number;
  from?: number;
  to?: number;
}

const q = (n: number) => Math.round(n * 10000) / 10000;

export async function api<T>(route: string, init?: RequestInit): Promise<T> {
  const r = await fetch(new URL(route, STUDIO_URL), { signal: AbortSignal.timeout(20000), ...init });
  if (!r.ok) throw new Error(`XSXB studio ${route}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

export async function studioUp(): Promise<boolean> {
  try {
    const h = await api<{ ok?: boolean; name?: string }>('/api/health');
    return !!h.ok && h.name === 'XSXB-Band';
  } catch {
    return false;
  }
}

// Start the studio when it is installed but not running
export async function ensureStudio(): Promise<void> {
  if (await studioUp()) return;
  const home = studioHome();
  if (!home) throw new Error('XSXB-Band is not installed. Clone https://github.com/sparklecatta-lang/XSXB-Band, run npm ci && npm run build, then set XSXB_BAND_HOME to the folder (default: ~/XSXB-Band)');
  if (!fs.existsSync(path.join(home, 'dist', 'index.html'))) throw new Error(`XSXB-Band at ${home} is not built: run npm ci && npm run build there`);
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: home, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await studioUp()) return;
  }
  throw new Error('XSXB-Band did not start within 20 seconds');
}

// One line per instrument: what the assistant needs to choose
export function libraryText(lib: Inst[]): string {
  const rows = lib
    .filter((i) => i.kind === undefined || i.kind === 'instrument')
    .map((i) => {
      const mids = (i.samples ?? []).map((s) => s.midi).filter((m): m is number => typeof m === 'number');
      const range = mids.length && Math.min(...mids) !== Math.max(...mids) ? ` ${Math.min(...mids)}-${Math.max(...mids)}` : '';
      const arts = (i.articulations ?? []).map((a) => a.id).join(',');
      return `${i.id.padEnd(18)} ${(i.family ?? '').padEnd(10)}${i.percussive ? ' drum:midi60' : '           '}${range}${arts ? `  art: ${arts}` : ''}${i.installed ? '' : '  (downloads on first use)'}`;
    });
  return rows.join('\n');
}

const COLORS = ['#56928B', '#C4623F', '#4C6EA8', '#B28A2E', '#7A5C9E', '#3F8F5A', '#A8483C', '#5B7F95'];

// Draft → the studio's project JSON. Throws a plain message for anything the studio would reject.
export function expand(d: Draft, lib: Inst[]): Record<string, unknown> {
  const byId = new Map(lib.map((i) => [i.id, i]));
  if (!d || typeof d !== 'object') throw new Error('the draft must be a JSON object');
  if (!Number.isFinite(d.bpm) || d.bpm < 40 || d.bpm > 240) throw new Error('bpm must be 40-240');
  if (!Number.isInteger(d.bars) || d.bars < 1 || d.bars > 64) throw new Error('bars must be a whole number 1-64');
  if (!Array.isArray(d.tracks) || !d.tracks.length) throw new Error('give at least one track');
  if (d.tracks.length > 32) throw new Error('at most 32 tracks');
  const end = d.bars * 4;
  const tracks = d.tracks.map((t, ti) => {
    const where = `track ${ti + 1} (${t.inst})`;
    const inst = byId.get(t.inst);
    if (!inst || (inst.kind && inst.kind !== 'instrument')) throw new Error(`${where}: no such instrument; \`music instruments\` lists them`);
    const arts = new Set((inst.articulations ?? []).map((a) => a.id));
    if (t.art && arts.size && !arts.has(t.art)) throw new Error(`${where}: articulation "${t.art}" is not one of ${[...arts].join(', ')}`);
    const id = `${t.inst}-${ti + 1}`.slice(0, 40);
    const notes: Record<string, unknown>[] = [];
    const push = (start: number, dur: number, midi: number, vel: number, art?: string) => {
      if (start < 0 || start >= end - 1e-9) return;
      const dd = Math.min(dur, end - start);
      if (dd < 0.0625) return;
      if (art && arts.size && !arts.has(art)) throw new Error(`${where}: articulation "${art}" is not one of ${[...arts].join(', ')}`);
      const n: Record<string, unknown> = { id: `${id}-${String(notes.length + 1).padStart(3, '0')}`, start: q(start), duration: q(dd), midi, velocity: Math.max(0, Math.min(1, vel)) };
      if (art) n.articulation = art;
      notes.push(n);
    };
    const from = Math.max(0, t.from ?? 0);
    const to = Math.min(d.bars, t.to ?? d.bars);
    if (from >= to) throw new Error(`${where}: from must be before to`);
    for (const row of t.notes ?? []) {
      const [s, du, m, v, a] = row;
      if (![s, du, m].every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error(`${where}: a note is [start, duration, midi, velocity, articulation?], numbers first; got ${JSON.stringify(row)}`);
      const midi = Math.round(m as number);
      if (midi < 0 || midi > 127) throw new Error(`${where}: midi ${midi} is outside 0-127`);
      const vel = typeof v === 'number' ? v : 0.7;
      const art = typeof a === 'string' && a ? a : t.art;
      if (t.loop && t.loop > 0) {
        // The notes describe one loop of `loop` bars; repeat it over from..to
        for (let b = from; b < to; b += t.loop) push(b * 4 + (s as number), du as number, midi, vel, art);
      } else push(s as number, du as number, midi, vel, art);
    }
    if (t.pattern) {
      const per = Array.isArray(t.pattern) ? t.pattern : [t.pattern];
      const art = t.patternArt ?? t.art;
      for (let b = from; b < to; b++) {
        const p = per[(b - from) % per.length].replace(/[\s|]/g, '');
        if (p.length % 4) throw new Error(`${where}: a drum pattern is sixteenth notes, a multiple of 4 characters per bar (got ${p.length})`);
        const step = 4 / p.length;
        [...p].forEach((c, k) => {
          if (c === 'x') push(b * 4 + k * step, Math.min(step, 0.25), 60, 0.65, art);
          else if (c === 'X') push(b * 4 + k * step, Math.min(step, 0.25), 60, 0.95, art);
          else if (c !== '.' && c !== '-') throw new Error(`${where}: pattern characters are x X . - (got "${c}")`);
        });
      }
    }
    if (!notes.length) throw new Error(`${where}: no notes`);
    // In time order, so the score reads (and edits) top to bottom; ids follow
    notes.sort((x, y) => (x.start as number) - (y.start as number) || (x.midi as number) - (y.midi as number));
    notes.forEach((n, k) => (n.id = `${id}-${String(k + 1).padStart(3, '0')}`));
    const track: Record<string, unknown> = {
      id,
      name: (t.name ?? inst.name ?? t.inst).slice(0, 80),
      instrumentId: t.inst,
      color: COLORS[ti % COLORS.length],
      volume: Math.max(0, Math.min(1, t.vol ?? 0.7)),
      pan: Math.max(-1, Math.min(1, t.pan ?? 0)),
      muted: false,
      solo: false,
      reverb: Math.max(0, Math.min(1, t.reverb ?? 0.2)),
      humanize: Math.max(0, Math.min(1, t.humanize ?? (inst.percussive ? 0.15 : 0.3))),
      notes,
    };
    if (t.art) track.articulation = t.art;
    return track;
  });
  return {
    schemaVersion: 1,
    timeSignature: [4, 4],
    id: (d.title || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'song',
    title: (d.title || 'Untitled').slice(0, 160),
    bpm: d.bpm,
    key: d.key ?? 'C major',
    bars: d.bars,
    tracks,
    updatedAt: new Date().toISOString(),
  };
}

// Pitches outside what the instrument was recorded at, per track (a warning, not an error)
export function rangeWarnings(d: Draft, lib: Inst[]): string[] {
  const out: string[] = [];
  const byId = new Map(lib.map((i) => [i.id, i]));
  for (const t of d.tracks) {
    const inst = byId.get(t.inst);
    const mids = (inst?.samples ?? []).map((s) => s.midi).filter((m): m is number => typeof m === 'number');
    if (!inst || inst.percussive || mids.length < 2) continue;
    const lo = Math.min(...mids) - 3;
    const hi = Math.max(...mids) + 3;
    const bad = (t.notes ?? []).filter((n) => typeof n[2] === 'number' && ((n[2] as number) < lo || (n[2] as number) > hi));
    if (bad.length) out.push(`${t.inst}: ${bad.length} note(s) outside the recorded range ${Math.min(...mids)}-${Math.max(...mids)} (they will sound pitched-up or pitched-down samples)`);
  }
  return out;
}

export interface Rendered {
  dir: string;
  wav: string;
  mix: { seconds: number; scoreSeconds: number; peakDbFS: number; saturatedFrames: number; secondPeakDbFS: (number | null)[] };
  warnings: string[];
}

// Render with the studio's own sampler through its bundled script (needs Chrome or Edge)
export function renderProject(home: string, projectFile: string, outDir: string, stems = false): Promise<Rendered> {
  const script = path.join(home, 'skills', 'xsxb-band', 'scripts', 'render.mjs');
  if (!fs.existsSync(script)) throw new Error(`the studio at ${home} has no skills/xsxb-band/scripts/render.mjs; update XSXB-Band`);
  const args = [script, '--studio', home, '--url', STUDIO_URL, '--project', projectFile, '--out', outDir, ...(stems ? ['--stems'] : [])];
  return new Promise((ok, bad) => {
    const p = spawn(process.execPath, args, { cwd: home, windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('error', bad);
    p.on('close', (code) => {
      const rep = path.join(outDir, 'report.json');
      if (code !== 0 || !fs.existsSync(rep)) return bad(new Error(`render failed: ${(err || out).trim().split(/\r?\n/).slice(-4).join(' | ')}`));
      const r = JSON.parse(fs.readFileSync(rep, 'utf8'));
      ok({ dir: outDir, wav: path.join(outDir, 'mix.wav'), mix: r.mix, warnings: r.warnings ?? [] });
    });
  });
}

const lastLine = (s?: string | null) => (s ?? '').trim().split('\n').pop()?.trim() ?? '';
const ff = (args: string[]) => spawnSync(ffmpegBin(), ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });

// WAV → mp3: cut to the score's length (the studio adds a natural tail), two-pass loudness to the library's level
export function toMp3(wav: string, mp3: string, seconds: number, lufs = MUSIC_LUFS): { i: number; tp: number; limited: boolean } {
  const cut = `${mp3}.cut.wav`;
  const fade = 0.25;
  let gain = 0;
  let limited = false;
  // Remotion's ffmpeg has no afade; a volume ramp over the last quarter second does the same
  const a = ff(['-i', wav, '-t', String(seconds), '-af', `volume='clip((${seconds}-t)/${fade},0,1)':eval=frame`, cut]);
  if (a.status !== 0) throw new Error(`ffmpeg could not trim the render: ${lastLine(a.stderr)}`);
  try {
    const m = measureLoudness(cut);
    if (!m) throw new Error('the render is silent');
    // A plain gain to the target: loudnorm's second pass drifts on dynamic music. The ceiling keeps the true peak under -1.5 dBTP.
    gain = Math.min(lufs - m.i, -1.5 - m.tp);
    limited = -1.5 - m.tp < lufs - m.i;
    const b = ff(['-i', cut, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '2', mp3]);
    if (b.status !== 0 || !fs.existsSync(mp3)) throw new Error(`mp3 encoding failed: ${lastLine(b.stderr)}`);
  } finally {
    fs.rmSync(cut, { force: true });
  }
  const after = measureLoudness(mp3);
  return { i: after?.i ?? NaN, tp: after?.tp ?? NaN, limited };
}

// The score is the beat grid: one beat per quarter note, bar lines are the downbeats
export function beatGrid(track: string, bpm: number, bars: number, seconds: number) {
  const period = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let b = 0; b < bars * 4; b++) {
    const t = Math.round(b * period * 1e5) / 1e5;
    beats.push(t);
    if (b % 4 === 0) downbeats.push(t);
  }
  return { track, bpm, period: Math.round(period * 1e5) / 1e5, offset: 0, duration: Math.round(seconds * 1e3) / 1e3, beats, downbeats, source: 'xsxb-band' };
}

export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Add a rendered song to public/music with its beat data and a CC0 credit line
export function installTrack(name: string, wav: string, d: Draft, seconds: number, extra: { score: string }) {
  const dir = path.join(PUBLIC, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const mp3 = path.join(dir, `${name}.mp3`);
  const loud = toMp3(wav, mp3, seconds);
  fs.writeFileSync(path.join(dir, `${name}.beats.json`), JSON.stringify(beatGrid(`${name}.mp3`, d.bpm, d.bars, seconds)));
  fs.writeFileSync(path.join(dir, `${name}.score.json`), extra.score);
  // Credits file maps mp3 → title and credit text, shared with the Incompetech tracks
  const cf = path.join(dir, 'credits.json');
  const credits = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
  // The samples are CC0: no credit line to print (publish notes only print a credit when there is one)
  credits[`${name}.mp3`] = { title: d.title, credit: '', license: 'CC0 samples, original score (XSXB-Band)' };
  fs.writeFileSync(cf, JSON.stringify(credits, null, 1));
  return { mp3, ...loud };
}
