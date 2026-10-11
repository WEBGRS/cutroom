// Export a cut as a JianyingPro (剪映专业版) draft: picture, narration, music, sounds and captions on their own tracks.
// The draft format follows pyJianYingDraft (Apache-2.0, github.com/GuanYixuan/pyJianYingDraft); the templates in
// ./jianying/ come from it.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import contentTemplate from './jianying/draft_content_template.json';
import metaTemplate from './jianying/draft_meta_info.json';
import { PUBLIC } from './store';
import { probe, still } from './media';
import { runExport } from './exporter';
import { buildBeatTimeline, buildTimeline, cueFrame, plain, tokens, type Timeline } from '../../src/lib/timeline';
import { withFades } from '../../src/lib/fades';
import { musicEnvelope, simplify } from '../../src/lib/mix';
import { SFX_GAIN, soundDef, soundSrc } from '../../src/fx/sounds';
import { LAYOUT } from '../../src/lib/layout';
import type { Props } from '../../src/lib/types';
import { ffmpegBin } from './record';

type TR = { start: number; duration: number };
type Json = Record<string, unknown>;

const uid = () => crypto.randomUUID().replace(/-/g, '');
const us = (sec: number) => Math.round(sec * 1e6);
const CLIP = () => ({ alpha: 1.0, flip: { horizontal: false, vertical: false }, rotation: 0.0, scale: { x: 1.0, y: 1.0 }, transform: { x: 0.0, y: 0.0 } });

// Draft content builder: tracks, materials and segments in JianyingPro's shapes
export class Draft {
  content: Json & { tracks: Json[]; materials: Record<string, Json[]> };
  private index = 0;

  constructor(width: number, height: number, fps: number) {
    this.content = structuredClone(contentTemplate) as unknown as Draft['content'];
    this.content.canvas_config = { width, height, ratio: 'original' };
    this.content.fps = fps;
    this.content.id = crypto.randomUUID().toUpperCase();
  }

  track(type: 'video' | 'audio' | 'text', name: string): Json & { segments: Json[]; render: number } {
    const t = { attribute: 0, flag: 0, id: uid(), is_default_name: false, name, segments: [] as Json[], type };
    this.content.tracks.push(t);
    return Object.assign(t, { render: this.index++ });
  }

  private speed(): string {
    const id = uid();
    this.content.materials.speeds.push({ curve_speed: null, id, mode: 0, speed: 1.0, type: 'speed' });
    return id;
  }

  video(file: string, durUs: number, width: number, height: number): string {
    const id = uid();
    this.content.materials.videos.push({
      audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487,
      crop: { upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0, lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0 },
      crop_ratio: 'free', crop_scale: 1.0, duration: durUs, height, id, local_material_id: '', material_id: id, material_name: path.basename(file), media_path: '', path: file, type: 'video', width,
    });
    return id;
  }

  audio(file: string, durUs: number): string {
    const id = uid();
    this.content.materials.audios.push({ app_id: 0, category_id: '', category_name: 'local', check_flag: 3, copyright_limit_type: 'none', duration: durUs, effect_id: '', formula_id: '', id, local_material_id: id, music_id: id, name: path.basename(file), path: file, source_platform: 0, type: 'extract_music', wave_points: [] });
    return id;
  }

  private segment(track: { render: number }, material: string, target: TR, source: TR | null, volume: number, refs: string[]): Json {
    return {
      enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false, enable_color_wheels: true, enable_lut: true, enable_smart_color_adjust: false,
      last_nonzero_volume: 1.0, reverse: false, track_attribute: 0, track_render_index: 0, visible: true, id: uid(), material_id: material, target_timerange: target,
      common_keyframes: [] as Json[], keyframe_refs: [], source_timerange: source, speed: 1.0, volume, extra_material_refs: refs, is_tone_modify: false, render_index: track.render,
    };
  }

  videoSegment(track: Json & { segments: Json[]; render: number }, material: string, target: TR, source: TR) {
    track.segments.push({ ...this.segment(track, material, target, source, 1.0, [this.speed()]), clip: CLIP(), uniform_scale: { on: true, value: 1.0 }, hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 } });
  }

  // `volume` keyframes: [offset in µs from the segment start, gain]
  audioSegment(track: Json & { segments: Json[]; render: number }, material: string, target: TR, source: TR, volume: number, keys?: [number, number][]) {
    // Audio segments carry these two as null
    const seg: Json = { ...this.segment(track, material, target, source, volume, [this.speed()]), clip: null, hdr_settings: null };
    if (keys?.length)
      (seg.common_keyframes as Json[]).push({
        id: uid(),
        keyframe_list: keys.map(([t, v]) => ({ curveType: 'Line', graphID: '', left_control: { x: 0.0, y: 0.0 }, right_control: { x: 0.0, y: 0.0 }, id: uid(), time_offset: t, values: [v] })),
        material_id: '',
        property_type: 'KFTypeVolume',
      });
    track.segments.push(seg);
  }

  // Text from [text, highlighted] runs; y is -1 (bottom) .. 1 (top)
  text(track: Json & { segments: Json[]; render: number }, runs: [string, boolean][], target: TR, o: { size: number; color: [number, number, number]; hi: [number, number, number]; y: number; look: 'outline' | 'box' | 'plain' }) {
    const id = uid();
    const text = runs.map((r) => r[0]).join('');
    let at = 0;
    const border = o.look === 'outline' ? [{ content: { solid: { alpha: 1.0, color: [0, 0, 0] } }, width: 40.0 }] : [];
    const styles = runs.map(([t, hi]) => {
      const n = Array.from(t).length;
      const st = { fill: { alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: hi ? o.hi : o.color } } }, range: [at, at + n], size: o.size, bold: true, italic: false, underline: false, strokes: border };
      at += n;
      return st;
    });
    const material: Json = {
      id, content: JSON.stringify({ styles, text }), typesetting: 0, alignment: 1, letter_spacing: 0.0, line_spacing: 0.02, line_feed: 1, line_max_width: 0.82, force_apply_line_max_width: false,
      check_flag: 7 | (o.look === 'outline' ? 8 : 0) | (o.look === 'box' ? 16 : 0), type: 'text', global_alpha: 1.0,
    };
    if (o.look === 'box') Object.assign(material, { background_style: 1, background_color: '#000000', background_alpha: 0.55, background_round_radius: 0.2, background_height: 0.14, background_width: 0.14, background_horizontal_offset: 0, background_vertical_offset: 0 });
    this.content.materials.texts.push(material);
    // Like pyJianYingDraft: a text segment refers to its own speed, which is not listed among the materials
    const seg = this.segment(track, id, target, null, 1.0, [uid()]);
    const clip = CLIP();
    clip.transform.y = o.y;
    track.segments.push({ ...seg, clip, uniform_scale: { on: true, value: 1.0 } });
  }

  finish(): number {
    let end = 0;
    for (const t of this.content.tracks) for (const s of t.segments as { target_timerange: TR }[]) end = Math.max(end, s.target_timerange.start + s.target_timerange.duration);
    this.content.duration = end;
    // The builder's own bookkeeping is not part of the format
    for (const t of this.content.tracks) delete (t as { render?: number }).render;
    return end;
  }
}

// JianyingPro's draft folder on this computer, if it is installed
export function jianyingRoot(): string | null {
  const c =
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft')
      : path.join(os.homedir(), 'Movies', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
  return fs.existsSync(c) ? c : null;
}

// Lay out tracks so overlapping sounds go on separate lanes
function lanes<T extends { a: number; b: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  for (const it of [...items].sort((p, q) => p.a - q.a)) {
    const lane = out.find((l) => l[l.length - 1].b <= it.a);
    if (lane) lane.push(it);
    else out.push([it]);
  }
  return out;
}

function convertToWav(src: string, dest: string): Promise<void> {
  return new Promise((ok, bad) => {
    const c = spawn(ffmpegBin(), ['-v', 'error', '-y', '-i', src, '-c:a', 'pcm_s16le', dest], { windowsHide: true });
    let err = '';
    c.stderr.on('data', (b) => (err += b));
    c.on('error', bad);
    c.on('close', (code) => (code === 0 ? ok() : bad(new Error(`could not convert ${path.basename(src)}: ${err.trim()}`))));
  });
}

// Caption text as runs of plain and [[highlighted]] text, markup removed
export function runsOf(text: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  for (const t of tokens(text)) {
    const last = out[out.length - 1];
    if (last && last[1] === t.hi) last[0] += t.s;
    else out.push([t.s, t.hi]);
  }
  return out;
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export interface JianyingResult {
  dir: string;
  name: string;
  registered: boolean;
  tracks: { name: string; segments: number }[];
  seconds: number;
}

// The whole export: render the picture, place every sound and caption, write the draft and list it in JianyingPro
export async function exportJianying(o: { props: Props; fps: number; root?: string; name?: string; log?: (s: string) => void }): Promise<JianyingResult> {
  const log = o.log ?? (() => undefined);
  const p = o.props;
  const board = p.board!;
  const root = o.root ? path.resolve(o.root) : jianyingRoot();
  if (!root) throw new Error('JianyingPro (剪映专业版) was not found on this computer; pass --out <folder> to write the draft somewhere else');
  const base = o.name ?? ['Cutroom', p.slug, p.format === 'tall' ? '9x16' : '16x9', p.mode === 'beat' ? 'beat' : null, p.lang === 'en' ? 'en' : null].filter(Boolean).join(' ');
  let name = base;
  // Replace a draft this exporter made before; never touch anyone else's
  for (let n = 2; fs.existsSync(path.join(root, name)) && !fs.existsSync(path.join(root, name, '.cutroom')); n++) name = `${base} ${n}`;
  const dir = path.join(root, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const res = path.join(dir, 'cutroom');
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(dir, '.cutroom'), `${p.slug}\n`);

  const fps = o.fps;
  const L = LAYOUT[p.format];
  const tl: Timeline =
    p.mode === 'beat' && p.grid ? withFades(buildBeatTimeline(board, p.grid, p.format, fps, p.captures, p.lang ?? 'zh'), p.captures, fps) : buildTimeline(board, p.timings, p.format, fps, p.captures, p.voice === 'off', p.lang ?? 'zh');
  const sec = (f: number) => f / fps;

  log('rendering the picture (no captions, narration, music or added sounds) …');
  const picture = path.join(res, 'picture.mp4');
  let lastPct = -1;
  const r = await runExport({ slug: p.slug, format: p.format, mode: p.mode ?? 'voice', lang: p.lang ?? 'zh', variant: p.variant ?? 'default', voice: p.voice ?? 'on', parts: 'picture', out: picture }, (line) => {
    const m = [...line.matchAll(/(\d+)\/(\d+)/g)].pop();
    if (!m) return;
    const pct = Math.floor((Number(m[1]) / Math.max(1, Number(m[2]))) * 4) * 25;
    if (pct > lastPct) log(`  ${/encod/i.test(line) ? 'encoding' : 'rendering'} ${(lastPct = pct)}%`);
  });
  if (r.code !== 0 || !fs.existsSync(picture)) throw new Error(`rendering the picture failed (exit ${r.code})`);
  const pic = await probe(picture);

  const d = new Draft(L.W, L.H, fps);
  const vTrack = d.track('video', 'picture');
  const vMat = d.video(picture, us(pic.duration), pic.width || L.W, pic.height || L.H);
  // One segment per scene, cut where each scene begins, so scenes can be trimmed or moved in JianyingPro
  const bounds = tl.scenes.map((s) => Math.max(0, s.start)).concat(tl.total).sort((a, b) => a - b);
  const cuts = bounds.filter((f, i) => i === 0 || f > bounds[i - 1]);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = us(sec(cuts[i]));
    const b = Math.min(us(pic.duration), us(sec(cuts[i + 1])));
    if (b - a > 1000) d.videoSegment(vTrack, vMat, { start: a, duration: b - a }, { start: a, duration: b - a });
  }

  // Media copied in, so the draft keeps working when the project moves
  const copies = new Map<string, { file: string; dur: number; mat?: string }>();
  const media = async (rel: string, convert = false) => {
    let c = copies.get(rel);
    if (c) return c;
    const src = path.join(PUBLIC, rel);
    if (!fs.existsSync(src)) return null;
    const flat = rel.replace(/[\\/]/g, '_');
    const dest = path.join(res, convert ? flat.replace(/\.\w+$/, '.wav') : flat);
    if (convert) await convertToWav(src, dest);
    else fs.copyFileSync(src, dest);
    c = { file: dest, dur: (await probe(dest)).duration };
    copies.set(rel, c);
    return c;
  };
  const audioMat = async (rel: string, convert = false) => {
    const c = await media(rel, convert);
    if (!c) return null;
    if (!c.mat) c.mat = d.audio(c.file, us(c.dur));
    return c;
  };

  // Narration
  const voice: { a: number; b: number; rel: string }[] = [];
  if (p.mode !== 'beat')
    for (const s of tl.scenes) for (const l of s.lines) if (l.file) voice.push({ a: sec(s.start + l.start), b: sec(s.start + l.start + l.dur + Math.round(fps * 0.3)), rel: `${p.slug}/${l.file}` });
  if (voice.length) {
    const t = d.track('audio', 'narration');
    for (const v of voice) {
      const c = await audioMat(v.rel);
      if (!c) continue;
      const dur = Math.min(c.dur, v.b - v.a);
      d.audioSegment(t, c.mat!, { start: us(v.a), duration: us(dur) }, { start: 0, duration: us(dur) }, 1.0);
    }
  }

  // Music: looped to the end in the narrated cut with its ducking as volume keyframes; the beat cut starts on its bar
  const total = sec(tl.total);
  if (p.mode === 'beat' && board.beat?.music && p.grid) {
    const c = await audioMat(board.beat.music);
    if (c) {
      const t = d.track('audio', 'music');
      const t0 = p.grid.downbeats[Math.min(board.beat.startBar ?? 0, p.grid.downbeats.length - 1)] ?? 0;
      const dur = Math.min(total, c.dur - t0);
      const vol = board.beat.volume ?? 0.85;
      d.audioSegment(t, c.mat!, { start: 0, duration: us(dur) }, { start: us(t0), duration: us(dur) }, 1.0, [[0, 0], [us(0.15), vol], [us(Math.max(0.15, dur - 1.6)), vol], [us(dur), 0]]);
    }
  } else if (board.music) {
    const c = await audioMat(board.music.src);
    if (c) {
      const t = d.track('audio', 'music');
      const env = musicEnvelope(tl, (board.music.volume ?? 0.22) * (p.voice === 'off' ? 1.5 : 1), p.voice === 'off' ? 1 : (board.music.duck ?? 0.3), board.music.fadeIn ?? 1, board.music.fadeOut ?? 2);
      const step = Math.max(0.5, c.dur);
      for (let a = 0; a < total - 0.01; a += step) {
        const dur = Math.min(step, total - a);
        const f0 = Math.round(a * fps);
        const f1 = Math.min(env.length, Math.round((a + dur) * fps));
        const keys = simplify(env.slice(f0, f1), 0.004).map(([f, v]) => [us(f / fps), Math.round(v * 1000) / 1000] as [number, number]);
        d.audioSegment(t, c.mat!, { start: us(a), duration: us(dur) }, { start: 0, duration: us(dur) }, 1.0, keys);
      }
    }
  }

  // Sound effects: transition whooshes, punch pops and the sounds placed on scenes, on as many lanes as overlap needs
  const sfx = board.sfx ?? {};
  const sv = sfx.volume ?? 1;
  const cues: { a: number; b: number; rel: string; vol: number; convert: boolean }[] = [];
  if (p.mode !== 'beat') {
    for (const s of tl.scenes) if (s.trans > 0 && sfx.whoosh !== false) cues.push({ a: Math.max(0, sec(s.start) - 0.1), b: Math.max(0, sec(s.start) - 0.1) + 0.8, rel: 'sfx/whoosh.wav', vol: 0.22 * sv, convert: false });
    for (const s of tl.scenes) for (const ov of s.scene.overlays ?? []) if (ov?.kind === 'punch' && sfx.pop !== false) cues.push({ a: sec(s.start) + ov.at, b: sec(s.start) + ov.at + 0.6, rel: 'sfx/pop.wav', vol: 0.4 * sv, convert: false });
  }
  for (const s of tl.scenes)
    for (const c of s.scene.sounds ?? []) {
      const def = soundDef(c.id);
      const off = cueFrame(s, c.at, p.captures, fps);
      if (!def || off === undefined || off < 0 || off >= s.dur) continue;
      cues.push({ a: sec(s.start + off), b: sec(s.start + off) + def.dur, rel: soundSrc(c.id), vol: SFX_GAIN * (c.vol ?? 1) * sv, convert: true });
    }
  const lanesOut = lanes(cues);
  for (const [k, lane] of lanesOut.entries()) {
    const t = d.track('audio', lanesOut.length > 1 ? `sound fx ${k + 1}` : 'sound fx');
    for (const cue of lane) {
      const c = await audioMat(cue.rel, cue.convert);
      if (!c) continue;
      const dur = Math.min(c.dur, cue.b - cue.a, total - cue.a);
      if (dur > 0.01) d.audioSegment(t, c.mat!, { start: us(cue.a), duration: us(dur) }, { start: 0, duration: us(dur) }, Math.round(cue.vol * 1000) / 1000);
    }
  }

  // Captions (narrated cut): the main line, and the second-language line on its own track
  if (p.mode !== 'beat' && !board.captions?.off) {
    const look = board.captions?.style ?? 'box';
    const accent = rgb(board.theme.accent2 ?? board.theme.accent);
    const lines = tl.scenes.flatMap((s) => s.lines.map((l) => ({ l, a: sec(s.start + l.start), b: sec(s.start + l.start + l.dur) })));
    const yMain = p.format === 'tall' ? -0.62 : -0.8;
    if (lines.length) {
      const t = d.track('text', 'captions');
      for (const { l, a, b } of lines) if (plain(l.main).trim()) d.text(t, runsOf(l.main), { start: us(a), duration: us(b - a) }, { size: p.format === 'tall' ? 9 : 7, color: [1, 1, 1], hi: accent, y: yMain, look });
    }
    const subs = lines.filter((x) => x.l.sub);
    if (subs.length) {
      const t = d.track('text', 'captions (second language)');
      for (const { l, a, b } of subs) d.text(t, [[l.sub!, false]], { start: us(a), duration: us(b - a) }, { size: p.format === 'tall' ? 5 : 4, color: [1, 1, 1], hi: accent, y: yMain - 0.1, look: look === 'box' ? 'outline' : look });
    }
  }

  const end = d.finish();
  fs.writeFileSync(path.join(dir, 'draft_content.json'), JSON.stringify(d.content));
  try {
    await still(picture, Math.min(1, pic.duration / 2), path.join(dir, 'draft_cover.jpg'), 640);
  } catch {
    // No cover
  }
  const now = Date.now() * 1000;
  const size = fs.readdirSync(res).reduce((s, f) => s + fs.statSync(path.join(res, f)).size, 0);
  const draftId = crypto.randomUUID().toUpperCase();
  const fold = dir.replace(/\\/g, '/');
  const meta = { ...structuredClone(metaTemplate), draft_fold_path: fold, draft_name: name, draft_root_path: root, draft_id: draftId, tm_draft_create: now, tm_draft_modified: now, tm_duration: end, draft_timeline_materials_size: size };
  fs.writeFileSync(path.join(dir, 'draft_meta_info.json'), JSON.stringify(meta, null, 1));
  const registered = register(root, { fold, name, draftId, now, end, size, cover: fs.existsSync(path.join(dir, 'draft_cover.jpg')) ? `${fold}/draft_cover.jpg` : '' });
  return { dir, name, registered, seconds: end / 1e6, tracks: d.content.tracks.map((t) => ({ name: String(t.name), segments: (t.segments as unknown[]).length })) };
}

// Add the draft to JianyingPro's list (root_meta_info.json), keeping a backup; otherwise it shows after a restart
function register(root: string, e: { fold: string; name: string; draftId: string; now: number; end: number; size: number; cover: string }): boolean {
  const file = path.join(root, 'root_meta_info.json');
  if (!fs.existsSync(file)) return false;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const rootMeta = JSON.parse(text) as { all_draft_store: Json[]; draft_ids?: number };
    fs.writeFileSync(`${file}.cutroom-backup`, text);
    rootMeta.all_draft_store = rootMeta.all_draft_store.filter((x) => x.draft_fold_path !== e.fold);
    rootMeta.all_draft_store.unshift({
      cloud_draft_cover: false, cloud_draft_sync: false, draft_cloud_last_action_download: false, draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '', draft_cloud_videocut_purchase_info: '',
      draft_cover: e.cover, draft_fold_path: e.fold, draft_id: e.draftId, draft_is_ai_shorts: false, draft_is_cloud_temp_draft: false, draft_is_invisible: false, draft_is_web_article_video: false,
      draft_json_file: `${e.fold}/draft_content.json`, draft_name: e.name, draft_new_version: '', draft_root_path: root, draft_timeline_materials_size: e.size, draft_type: '', draft_web_article_video_enter_from: '',
      streaming_edit_draft_ready: true, tm_draft_cloud_completed: '', tm_draft_cloud_entry_id: -1, tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1, tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1,
      tm_draft_create: e.now, tm_draft_modified: e.now, tm_draft_removed: 0, tm_duration: e.end,
    });
    if (typeof rootMeta.draft_ids === 'number') rootMeta.draft_ids += 1;
    const tmp = `${file}.cutroom-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rootMeta));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}
