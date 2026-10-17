import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { plain } from '../../src/lib/timeline';
import { loadProps } from '../../src/lib/load';
import type { Format, Props, Scene } from '../../src/lib/types';
import { editTimeline, fmtTime, lineFrames, type ETimeline } from './model';
import { addScene, duplicateScene, getPath, moveScene, removeScene, replaceScene, setMinSec, setPath, splitPoint, splitScene, toggleTall, trimEdge, uniqueId, type Caps, type Op } from './ops';
import { PUBLIC, STATE, readDoc, readLog, readSnapshot, slugs, writeDoc } from './store';
import { HELP as HELP_TEXT } from './help';
import { briefCmd, flowCmd, formatFor, plansCmd, reviewFallback, reviewLogCmd, lengthNote, saveReview, tableNotes } from './flowcli';
import { callReviewer } from './review';
import { catalogText } from './catalog';
import { boardTemplate, sceneTemplate } from './templates';
import { installModel, lineStates, modelInstalled, voiceOf, voiceProject, voiceSettings, voicesOf, writeVoiceSettings } from './voice';
import { addCustomVoice, designCustomVoice, installLocal, localReady, localStatus, removeCustomVoice, stopLocal } from './localvoice';
import { ENGINES, engineDef, type EngineId } from './voices';
import { inspectPage, parseSteps, readRecipes, recordPage, rerecord } from './record';
import { desktopSupported, listMonitors, listWindows, recordDesktop } from './desktop';
import { importFile, setMark } from './importfile';
import { addRule, globalRules, projectRules, removeRule } from './rules';
import { describe as describeLoudness, measureLoudness, normalizeLoudness } from './loudness';
import { runExport } from './exporter';
import { exportJianying } from './jianying';
import { imagine, type ImageEngine, type Shape } from './imagegen';
import { analyzeShots, summary } from './shots';
import { analyzeFocus } from './reframe';
import { pcm, probe } from './media';
import { speechRanges } from './silence';
import { renderFrames } from './look';
import { reviewFrames } from './reviewframes';
import { reviewSheets } from './sheets';
import { checklistText, readBrief } from './stagefiles';
import { contentKey } from './flow';
import { importHtml, isHtml, lintHtml, listHtml, pageName, readHtml, starterHtml, writeHtml } from './htmlfiles';
import { varValues } from '../../src/lib/html';
import { MUSIC_LUFS, STUDIO_URL, api, ensureStudio, expand, installTrack, libraryText, rangeWarnings, renderProject, slugOf, studioHome, type Draft, type Inst } from './compose';

const HELP = `Cutroom CLI\n${HELP_TEXT}\n`;

const args = process.argv.slice(2);
const flag = (name: string, d?: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const has = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const formatGiven = process.argv.includes('--format');
const format = (flag('format', 'wide') as Format) ?? 'wide';
const lang = (flag('lang', 'zh') as 'zh' | 'en') ?? 'zh';
const tallFlag = has('tall');
const unseen = has('unseen');
const fromArg = flag('from');
const toArg = flag('to');
const redo = has('redo');
const engineArg = flag('engine') as EngineId | undefined;
const voiceArg = flag('voice');
const mobile = has('mobile');
const sizeArg = flag('size');
const outArg = flag('out');
const codecArg = flag('codec');
const scaleArg = flag('scale');
const clean = has('clean');
const silent = has('silent');
const nameArg = flag('name');
const sensArg = flag('sensitivity');
const minArg = flag('min');
const maxMbArg = flag('max-mb');
const jianying = has('jianying');
const transparent = has('transparent');
const shapeArg = flag('shape');
const noteArg = flag('note');
const marksArg = flag('marks');
const maxArg = flag('max');
const replace = has('replace');
const area = has('area');
const asMedia = has('media');
const allFlag = has('all');
const keepOverlays = has('keep-overlays');
const lufsArg = flag('lufs');
const textArg = flag('text');
const atArg = flag('at');
const motionArg = flag('motion');
// An option this CLI doesn't know is an error, not something to silently ignore
const unknown = args.find((a) => /^--[a-z][\w-]*$/.test(a));
if (unknown) {
  console.error(`错误: unknown option ${unknown} (help lists the commands and their options)`);
  process.exit(1);
}
const [slug, cmd, ...rest] = args;

const getJson = async <T>(p: string): Promise<T | undefined> => {
  const f = path.join(PUBLIC, p);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : undefined;
};
// PNG header carries the size
const getDims = async (p: string) => {
  // A missing image is reported by check; it must not stop ls, trim or check from running
  if (!fs.existsSync(path.join(PUBLIC, p))) return { w: 1920, h: 4000 };
  const b = fs.readFileSync(path.join(PUBLIC, p));
  return b.toString('ascii', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : { w: 1920, h: 4000 };
};

async function timeline(doc = readDoc(slug).doc, fmt: Format = format): Promise<{ tl: ETimeline; props: Props; caps: Caps }> {
  const base: Props = { slug, format: fmt, lang };
  const loaded = await loadProps(base, getJson, getDims, doc.board);
  const props = { ...loaded.props, timings: lang === 'en' ? doc.timings.en : doc.timings.zh };
  return { tl: editTimeline(props, loaded.fps), props, caps: props.captures ?? {} };
}

const pad = (s: string, n: number) => {
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(1, n - w));
};
const sec = (f: number, fps: number) => (f / fps).toFixed(2);

function save(op: Op, withTimings = false) {
  const { version } = readDoc(slug);
  const v = writeDoc(slug, op.doc, 'cli', [op.desc], version, withTimings);
  console.log(`${op.desc}  [${v}]`);
}

// Seconds or @mark±x → capture seconds for a visual
function capTime(ref: string, caps: Caps, src: string): number {
  if (/^-?[\d.]+$/.test(ref)) return Number(ref);
  const m = /^@([\w-]+)([+-][\d.]+)?$/.exec(ref);
  const ev = m && caps[src]?.events.find((e) => e.type === 'mark' && e.name === m[1]);
  if (m && !ev && m[1] === 'end' && caps[src]) return caps[src].duration + (m[2] ? Number(m[2]) : 0);
  if (!m || !ev) throw new Error(`找不到标记 ${ref}（${src}）`);
  return ev.t + (m[2] ? Number(m[2]) : 0);
}

async function main() {
  if (!slug || slug === 'help') return console.log(HELP);
  if (slug === 'fx' || cmd === 'fx') return console.log(catalogText());
  if (slug === 'projects') return console.log(slugs().filter((s) => !s.startsWith('_')).join('\n') || 'no projects yet: <name> new [title]');
  if (cmd === 'new') {
    const s = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!s || s !== slug) throw new Error(`project names use lowercase letters, digits and dashes (${s || 'my-demo'})`);
    const dir = path.join(PUBLIC, s);
    if (fs.existsSync(path.join(dir, 'storyboard.json'))) throw new Error(`a project called ${s} already exists`);
    fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(boardTemplate(s, rest.join(' ') || s, /[一-鿿]/.test(rest.join(' ')) ? 'zh' : 'en'), null, 2));
    return console.log(`created ${s} (${path.join(dir, 'storyboard.json')}): an intro title and an outro\nnext: record <name> <url> [steps], then add screen cap/<name>.mp4 intro`);
  }
  if (!cmd) return console.log(HELP);
  const { doc } = readDoc(slug);
  const sceneOf = (id: string): Scene => {
    const s = doc.board.scenes.find((x) => x.id === id);
    if (!s) throw new Error(`没有场景 ${id}`);
    return s;
  };
  switch (cmd) {
    case 'ls': {
      const { tl } = await timeline(doc);
      const fps = tl.fps;
      console.log(`${slug} · ${format} · ${lang} — ${sec(tl.total, fps)} s @${fps}fps, ${tl.scenes.length} scenes${tl.hidden.length ? `  (not in this cut: ${tl.hidden.map((h) => `${h.id}[${h.why}]`).join(', ')})` : ''}`);
      for (const s of tl.scenes) {
        const v = s.visual;
        const vis = v.kind === 'screen' ? `${s.label} ${s.from?.toFixed(2)}→${s.to?.toFixed(2)}${s.rate !== 1 ? ` ×${s.rate.toFixed(2)}` : ''}` : `${v.kind}: ${s.label}`;
        console.log(`${String(s.index + 1).padStart(2)} ${pad(s.id, 10)} ${fmtTime(s.start, fps).padStart(8)} ${sec(s.dur, fps).padStart(6)}s  ${pad(vis, 44)} ${s.lines.map((l) => (l.stale ? '⚠' : '') + l.text).join(' / ')}`);
        if (s.marks.length) console.log(`${' '.repeat(14)}marks: ${s.marks.map((m) => `${m.name}@${sec(m.f, fps)}`).join('  ')}`);
        const shot = doc.board.scenes[s.index]?.shot;
        if (shot) console.log(`${' '.repeat(14)}shot: ${shot.replace(/\s+/g, ' ')}`);
      }
      return;
    }
    case 'show': {
      // Several ids, or "all", in one call
      const ids = rest[0] === 'all' || !rest.length ? doc.board.scenes.map((s) => s.id) : rest;
      return console.log(ids.length === 1 ? JSON.stringify(sceneOf(ids[0]), null, 2) : ids.map((id) => `== ${id}\n${JSON.stringify(sceneOf(id), null, 2)}`).join('\n'));
    }
    case 'mv':
      return save(moveScene(doc, rest[0], rest[1] === 'end' ? null : rest[1]));
    case 'trim': {
      const { caps } = await timeline(doc);
      const s = sceneOf(rest[0]);
      const key = tallFlag ? 'tall' : 'visual';
      const v = s[key];
      if (!v || v.kind !== 'screen') throw new Error(`${rest[0]} ${key} 不是录屏画面`);
      let d = doc;
      const descs: string[] = [];
      for (const [edge, ref] of [['from', fromArg], ['to', toArg]] as const) {
        if (!ref) continue;
        const op = trimEdge(d, rest[0], key, edge, capTime(ref, caps, v.src), caps);
        // Keep an explicit @mark the user typed, and say that is what was stored
        if (ref.startsWith('@')) (op.doc.board.scenes.find((x) => x.id === rest[0])![key] as any)[edge] = ref;
        d = op.doc;
        descs.push(ref.startsWith('@') ? op.desc.replace(/→ \S+$/, `→ ${ref}`) : op.desc);
      }
      save({ doc: d, desc: descs.join('；') });
      // Narration can hold a scene longer than the trimmed clip: say so instead of leaving it to guesswork
      if (toArg) {
        const want = capTime(toArg, caps, v.src);
        const { tl: t2 } = await timeline(readDoc(slug).doc);
        const e2 = t2.scenes.find((x) => x.id === rest[0]);
        if (e2 && e2.from !== undefined) {
          const plays = e2.from + (e2.dur / t2.fps) * e2.rate;
          if (plays > want + 0.1) console.log(`note: ${rest[0]}'s narration needs ${(e2.dur / t2.fps).toFixed(2)} s, so the recording keeps playing to ${plays.toFixed(2)} s (not ${want.toFixed(2)}). To cut more, shorten or move its lines.`);
        }
      }
      return;
    }
    case 'min':
      return save(setMinSec(doc, rest[0], rest[1] === 'off' ? undefined : Number(rest[1])));
    case 'split': {
      const { tl, caps } = await timeline(doc);
      const e = tl.scenes.find((x) => x.id === rest[0]);
      if (!e) throw new Error(`${rest[0]} 不在 ${format} 这一版里`);
      const f = Math.round(Number(rest[1]) * tl.fps);
      if (!(f > 0 && f < e.dur)) throw new Error(`拆分点要在 0 和 ${sec(e.dur, tl.fps)} 秒之间`);
      return save(splitScene(doc, e.id, splitPoint(e, sceneOf(e.id), f, tl.fps, caps), caps), true);
    }
    case 'add': {
      const [kind, ...more] = rest;
      const needsSrc = ['image', 'clip', 'screen', 'html'].includes(kind);
      let src = needsSrc ? more.shift() : undefined;
      if (needsSrc && !src) throw new Error(kind === 'html' ? 'add html <scenes/name/index.html | path to a page or folder> [after-id]' : `add ${kind} 需要素材路径，例如 add ${kind} media/a.${kind === 'image' ? 'png' : 'mp4'}`);
      const after = more[0] ?? null;
      const id = uniqueId(doc.board, `${kind}-1`);
      if (kind === 'html') {
        // A page outside the project is copied into scenes/ first
        if (!fs.existsSync(path.join(PUBLIC, slug, src!))) {
          if (!fs.existsSync(src!)) throw new Error(`no ${src} in the project or on disk (html lists the project's pages)`);
          src = importHtml(slug, src!);
          console.log(`copied into ${src}`);
        }
        const { text, meta } = readHtml(slug, src!);
        // Named after the page: scenes/loop/index.html → loop
        const name = pageName(src!).replace(/[^\w-]+/g, '-').toLowerCase() || 'html';
        const hid = doc.board.scenes.some((s) => s.id === name) ? uniqueId(doc.board, name) : name;
        const sc = sceneTemplate('html', hid, src);
        if (meta.dur) sc.minSec = Math.round(meta.dur * 100) / 100;
        save(addScene(doc, sc, after));
        for (const x of lintHtml(text, meta)) console.log(`${x.level}: ${x.msg}`);
        return console.log(`${src}: ${meta.w}×${meta.h}${meta.dur ? `, ${meta.dur} s` : ''}${meta.vars.length ? `; variables: ${meta.vars.map((v) => v.id).join(', ')} (set ${hid} visual.vars.<id> <json>)` : ''}`);
      }
      return save(addScene(doc, sceneTemplate(kind, id, src), after));
    }
    case 'html':
      return htmlCmd(rest);
    case 'fx':
      return console.log(catalogText());
    case 'rm':
      return save(removeScene(doc, rest[0]));
    case 'dup':
      return save(duplicateScene(doc, rest[0]));
    case 'tall':
      return save(toggleTall(doc, rest[0], rest[1] !== 'off'));
    case 'set': {
      const [id, p, ...v] = rest;
      const raw = v.join(' ');
      if (id === '-' && (p ?? '').split('.').filter(Boolean)[0] === 'workflow') throw new Error('the workflow changes only through flow commands (and the user’s buttons in the panel)');
      let value: unknown;
      if (raw === 'undefined') value = undefined;
      else
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw;
        }
      if (id !== '-' && p === '.') return save(replaceScene(doc, id, value as Scene));
      if (/^(visual|tall)\.zoom$/.test(p) && value !== undefined && value !== 'auto' && value !== 'off') throw new Error(`${p} is "auto" (the camera follows the cursor and zooms in on clicks) or "off" (the whole recording, no camera moves); use undefined for the default (auto)`);
      return save(setPath(doc, id === '-' ? null : id, p, value));
    }
    case 'get':
      return console.log(JSON.stringify(getPath(rest[0] === '-' ? doc.board : sceneOf(rest[0]), rest[1] ?? ''), null, 2));
    case 'log': {
      const log = readLog(slug);
      const seenFile = path.join(STATE, slug, 'seen');
      const seen = fs.existsSync(seenFile) ? Number(fs.readFileSync(seenFile, 'utf8')) : 0;
      const list = unseen ? log.slice(seen).filter((e) => e.src !== 'cli') : log.slice(-Number(rest[0] ?? 20));
      for (const e of list) console.log(`${e.t.replace('T', ' ').slice(0, 19)}  ${e.src.padEnd(8)} ${e.version}  ${e.desc.join('；')}`);
      if (!list.length) console.log(unseen ? '没有新的改动' : '没有记录');
      if (unseen) fs.writeFileSync(seenFile, String(log.length));
      return;
    }
    case 'diff': {
      const log = readLog(slug);
      const lastUi = [...log].reverse().find((e) => e.src !== 'cli');
      const a = rest[0] ?? lastUi?.prev;
      const b = rest[1];
      if (!a) return console.log('没有可比较的快照');
      const A = readSnapshot(slug, a);
      const B = b ? readSnapshot(slug, b) : doc.board;
      if (!A || !B) throw new Error('快照不存在');
      const out: string[] = [];
      const ida = A.scenes.map((s) => s.id).join(',');
      const idb = B.scenes.map((s) => s.id).join(',');
      if (ida !== idb) out.push(`顺序: ${ida}\n   → ${idb}`);
      const walk = (x: any, y: any, p: string) => {
        if (JSON.stringify(x) === JSON.stringify(y)) return;
        if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
          for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p ? `${p}.${k}` : k);
          return;
        }
        if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) return x.forEach((_, i) => walk(x[i], y[i], `${p}.${i}`));
        out.push(`${p}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
      };
      const byId = (bd: typeof A) => Object.fromEntries(bd.scenes.map((s) => [s.id, s]));
      const sa = byId(A);
      const sb = byId(B);
      for (const id of new Set([...Object.keys(sa), ...Object.keys(sb)])) walk(sa[id], sb[id], `scenes[${id}]`);
      const { scenes: _a, ...ra } = A;
      const { scenes: _b, ...rb } = B;
      walk(ra, rb, '');
      console.log(out.length ? out.join('\n') : '没有差别');
      return;
    }
    case 'voice':
      return voiceCmd(rest);
    case 'media':
      return mediaCmd();
    case 'check':
      return checkCmd();
    case 'music':
      return musicCmd(rest);
    case 'look':
      return lookCmd(rest);
    case 'export':
      return exportCmd();
    case 'imagine': {
      const [name, ...words] = rest;
      const prompt = words.join(' ').trim();
      if (!name || !prompt) throw new Error('imagine <name> "<what to draw>" [--transparent] [--shape square|wide|tall] [--engine openai|gemini]');
      if (shapeArg && !['square', 'wide', 'tall'].includes(shapeArg)) throw new Error('--shape is square, wide or tall');
      if (engineArg && !['openai', 'gemini'].includes(engineArg)) throw new Error('--engine is openai or gemini');
      console.log(`drawing "${prompt.slice(0, 80)}" …`);
      const r = await imagine({ slug, name, prompt, engine: engineArg as ImageEngine | undefined, shape: shapeArg as Shape | undefined, transparent });
      console.log(`saved ${r.file} (${(r.bytes / 1024).toFixed(0)} KB, ${r.engine})`);
      return console.log(transparent ? `use it on a scene: set <id> overlays.<n> '{"kind":"image","src":"${r.file}","at":0.3,"dur":3,"x":0.8,"y":0.25,"w":0.22}'  (then look)` : `as a scene: add image ${r.file} [after-id]; on a scene: an image overlay with "src":"${r.file}"`);
    }
    case 'cut-silence': {
      const sc = sceneOf(rest[0] ?? '');
      const v = sc.visual;
      if (v.kind !== 'clip') throw new Error(`cut-silence works on video scenes (a person talking); ${sc.id} is ${v.kind}`);
      const file = path.join(PUBLIC, slug, v.src);
      const info = await probe(file);
      if (!info.audio) throw new Error(`${v.src} has no sound to find pauses in`);
      const { tl } = await timeline(doc);
      const e = tl.scenes.find((x) => x.id === sc.id);
      const rate = v.rate ?? 1;
      const from = v.from ?? 0;
      const len = e ? Math.min(info.duration - from, (e.dur / tl.fps) * rate) : info.duration - from;
      const R = 16000;
      const all = await pcm(file, R);
      const part = all.subarray(Math.floor(from * R), Math.min(all.length, Math.ceil((from + len) * R)));
      const min = minArg !== undefined ? Number(minArg) : 0.5;
      const { keep } = speechRanges(part, R, { minSilence: min });
      if (!keep.length) throw new Error(`no speech found in ${v.src} between ${from.toFixed(1)} and ${(from + len).toFixed(1)} s`);
      if (keep.length === 1 && keep[0][0] < 0.05 && keep[0][1] > len - 0.05) return console.log(`${sc.id}: no pauses of ${min} s or longer`);
      const board = structuredClone(doc.board);
      const at = board.scenes.findIndex((x) => x.id === sc.id);
      const ids: string[] = [];
      // Output time t of the old scene → [piece, time in that piece]; times inside a removed pause go to the next piece
      const place = (t: number): [number, number] => {
        const src = t * rate;
        for (let k = 0; k < keep.length; k++) if (src < keep[k][1]) return [k, Math.max(0, src - keep[k][0]) / rate];
        return [keep.length - 1, (keep[keep.length - 1][1] - keep[keep.length - 1][0]) / rate];
      };
      const pieces = keep.map(([a, b], k) => {
        const id = k === 0 ? sc.id : uniqueId({ ...board, scenes: [...board.scenes, ...ids.map((x) => ({ id: x }) as Scene)] }, `${sc.id}-${k + 1}`);
        ids.push(id);
        const piece: Scene = { ...structuredClone(sc), id, visual: { ...v, from: Math.round((from + a) * 1000) / 1000 }, minSec: Math.round(((b - a) / rate) * 1000) / 1000 };
        if (k > 0) {
          piece.transition = 'none';
          piece.lines = [];
          delete piece.chapter;
          delete piece.tall;
        }
        piece.overlays = (sc.overlays ?? []).filter((o) => o && place(o.at)[0] === k).map((o) => ({ ...o, at: Math.round(place(o.at)[1] * 100) / 100 }));
        piece.sounds = (sc.sounds ?? []).filter((c) => typeof c.at === 'number' && place(c.at)[0] === k).map((c) => ({ ...c, at: Math.round(place(c.at as number)[1] * 100) / 100 }));
        if (!piece.overlays.length) delete piece.overlays;
        if (!piece.sounds.length) delete piece.sounds;
        return piece;
      });
      board.scenes.splice(at, 1, ...pieces);
      const kept = keep.reduce((s, [a, b]) => s + b - a, 0);
      save({ doc: { ...doc, board }, desc: `${sc.id}: cut ${keep.length - 1} pause(s), ${len.toFixed(1)} s → ${kept.toFixed(1)} s of footage in ${pieces.length} pieces (${ids.join(', ')})` });
      if (sc.lines.length) console.log(`note: the narration lines stay on ${sc.id}; check that they still fit (ls)`);
      if (v.muted !== false) console.log(`note: ${sc.id} plays without its own sound; to hear the speech: set ${sc.id} visual.muted false (and the same on ${ids.slice(1).join(', ')})`);
      return;
    }
    case 'reframe': {
      // Default target: the 9:16 version, so the 16:9 cut never changes unless asked
      const target: Format = formatGiven ? format : 'tall';
      const sc = structuredClone(sceneOf(rest[0] ?? ''));
      const key = target === 'tall' ? 'tall' : 'visual';
      if (key === 'tall' && !sc.tall) sc.tall = structuredClone(sc.visual);
      const v = sc[key]!;
      if (v.kind !== 'clip' && v.kind !== 'image') throw new Error(`reframe works on image and video scenes; ${sc.id} is ${v.kind}`);
      if (v.frame) throw new Error(`${sc.id} sits in a ${v.frame} frame; reframe crops full-bleed footage (set ${key}.frame undefined first)`);
      const { tl } = await timeline(doc);
      const e = tl.scenes.find((x) => x.id === sc.id);
      const outAr = target === 'tall' ? 1080 / 1920 : 1920 / 1080;
      const f = await analyzeFocus({ slug, src: v.src, from: v.kind === 'clip' ? v.from : undefined, dur: e && v.kind === 'clip' ? (e.dur / tl.fps) * (v.rate ?? 1) : undefined, outAr });
      v.pos = [f.x, f.y];
      v.fit = undefined;
      if (v.kind === 'clip') v.ar = Math.round(f.ar * 10000) / 10000;
      save(replaceScene(doc, sc.id, sc));
      const side = f.x < 0.35 ? 'left side' : f.x > 0.65 ? 'right side' : 'middle';
      return console.log(f.vis >= 0.999 ? `${v.src} already fits ${target === 'tall' ? '9:16' : '16:9'} without cropping` : `${sc.id} ${key}.pos = [${f.x}, ${f.y}]: keeps the ${side}, ${Math.round(f.vis * 100)}% of the width in view. Check it: look ${sc.id} --format ${target}`);
    }
    case 'shots': {
      if (!rest[0]) throw new Error('shots <video> [--name n] [--sensitivity 0..1]  (a file on disk or in the project)');
      const t0 = Date.now();
      const { report, dir } = await analyzeShots({ slug, file: rest[0], name: nameArg, sensitivity: sensArg === undefined ? undefined : Number(sensArg), log: (s) => console.log(s) });
      console.log(summary(report, dir));
      return console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s) Open the keyframe images to see what each shot shows.`);
    }
    case 'rerecord':
      return rerecordCmd(rest);
    case 'inspect': {
      if (!rest[0]) throw new Error('inspect <url> [--mobile]');
      return console.log(await inspectPage(rest[0], mobile));
    }
    case 'windows':
      return windowsCmd(rest.join(' '));
    case 'record-window':
    case 'record-screen':
      return desktopCmd(cmd, rest);
    case 'import': {
      const [file, name] = rest;
      if (!file) throw new Error('import <file> [name] [--media]  (a video becomes a screen recording in cap/; --media keeps it as footage in media/)');
      const r = await importFile(slug, file, name, asMedia);
      if (r.kind === 'screen') {
        console.log(`imported ${r.file}: ${r.duration!.toFixed(1)} s, ${r.width}×${r.height} (as a screen recording, no clicks logged)`);
        return console.log(`next: add screen ${r.file} [after-id], or swap <id> ${r.file}; name moments to align captions to: mark ${r.file.slice(4, -4)} <name> <seconds>  (look or shots ${r.file} help find them)`);
      }
      console.log(`imported ${r.file}`);
      return console.log(r.kind === 'audio' ? `use it as music: set - music.src '"${r.file}"'` : `next: add ${r.kind} ${r.file} [after-id], or swap <id> ${r.file}`);
    }
    case 'mark': {
      const [rec, name, at] = rest;
      if (!rec || !name || at === undefined) throw new Error('mark <recording> <name> <seconds | off>  e.g. mark demo saved 12.4');
      const r = await setMark(slug, rec, name, at === 'off' ? null : Number(at));
      return console.log(`${r.file} marks: ${r.marks.map((m) => `@${m.name} ${m.t.toFixed(2)}s`).join(', ') || 'none'}`);
    }
    case 'swap':
      return swapCmd(rest);
    case 'plan':
      return planCmd();
    case 'flow':
      return flowCmd(slug, doc, rest, save);
    case 'brief':
      return briefCmd(slug, rest);
    case 'plans':
      return plansCmd(slug, rest, { at: atArg, motion: motionArg, format, formatGiven, boardFormat: doc.board.format });
    case 'review': {
      if (rest[0] === 'log') return reviewLogCmd(slug, doc, rest.slice(1).join(' '), save);
      const fmt = formatFor({ format, formatGiven, boardFormat: doc.board.format });
      if (rest[0] === 'run') {
        const args = rest.slice(1);
        const version = contentKey(readDoc(slug).doc.board);
        const { images, scope } = await reviewRender(args, fmt);
        const server = process.env.CUTROOM_SERVER ?? `http://127.0.0.1:${process.env.PORT ?? 8814}`;
        const brief = readBrief(slug) ?? '';
        const table = (await planLines(fmt)).join(String.fromCharCode(10));
        console.log('asking an independent reviewer (a fresh run of your AI connection, no chat history)…');
        // node:http, not fetch: a reviewer run can take longer than fetch waits for response headers (5 min)
        const r = await callReviewer(server, { slug, brief, table, scope, images, partial: args.length > 0 });
        if (!r.text) return console.log(reviewFallback(r.unavailable ?? r.error ?? 'unknown error'));
        saveReview(slug, r.text, version, save);
        return;
      }
      // Looking only: review run renders the same sheets and has them judged
      await reviewRender(rest, fmt);
      console.log(`\nchecklist:\n${checklistText()}\nTo have them judged: review run ${rest.join(' ')} (it renders these sheets again itself); if that is not available, open both sheets, judge them as a critic and save it with review log '<report>' (first line ready or revise, then scope:, scores: P 8 F 7 …, numbered problems with scene id, time, problem, fix).`);
      return;
    }
    case 'rules': {
      const [sub, ...words] = rest;
      if (sub === 'add') {
        const list = addRule(slug, words.join(' '), allFlag);
        return console.log(`saved (${allFlag ? 'every project' : slug}, ${list.length} rule(s)): ${list[list.length - 1]}`);
      }
      if (sub === 'rm') {
        const list = removeRule(slug, Number(words[0]), allFlag);
        return console.log(`removed; ${list.length} rule(s) left ${allFlag ? 'for every project' : `for ${slug}`}`);
      }
      const show = (list: string[]) => list.map((r, i) => `  ${i + 1}. ${r}`).join('\n') || '  none';
      console.log(`rules for every project (rules add --all "…"):\n${show(globalRules())}`);
      return console.log(`rules for ${slug} (rules add "…"; rules rm <n>):\n${show(projectRules(slug))}`);
    }
    case 'record': {
      const [name, url, stepsArg] = rest;
      if (!name || !url) throw new Error('record <name> <url> [steps-json | steps-file] [--mobile] [--size 1280x720]');
      let steps;
      if (stepsArg) {
        const text = fs.existsSync(stepsArg) ? fs.readFileSync(stepsArg, 'utf8') : stepsArg;
        try {
          steps = parseSteps(JSON.parse(text));
        } catch (e) {
          throw new Error(`steps: ${(e as Error).message}`);
        }
      }
      const m = sizeArg ? /^(\d{3,4})x(\d{3,4})$/.exec(sizeArg) : null;
      if (sizeArg && !m) throw new Error('--size is WIDTHxHEIGHT, e.g. 1280x720');
      console.log(`recording ${url} …`);
      const r = await recordPage({ slug, name, url, steps, mobile, size: m ? { width: Number(m[1]), height: Number(m[2]) } : undefined, log: (s) => console.log(s) });
      const marks = r.marks.length ? r.marks.map((x) => `@${x.name} ${x.t.toFixed(2)}s`).join(', ') : 'none';
      console.log(`saved ${r.file}: ${r.duration.toFixed(1)} s, ${r.width}×${r.height}; marks: ${marks}`);
      return console.log(`next: add screen ${r.file} [after-id]  (captions can align to the marks with "at": "@name")`);
    }
    default:
      console.log(HELP);
  }
}

// Production table: what each scene's narration says, what its picture shows and the text on screen, with
// the scenes where the picture only repeats the words, or the words describe an action no footage shows
const NOT_TEXT = new Set(['kind', 'src', 'url', 'fit', 'frame', 'look', 'pos', 'to', 'from', 'font', 'color', 'accent', 'bg', 'icon', 'lang', 'voice', 'ar', 'zoom', 'enter', 'a', 'b', 'vars']);
function screenText(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    // Enum-like values (blurin, left) are settings, not words on screen
    if (v.trim() && !/^[a-z][a-z0-9-]*$/.test(v.trim()) && !/^#[0-9a-f]{3,8}$|\.(png|jpe?g|mp4|webm|html?|svg|wav|mp3)$|^@|^https?:/i.test(v)) out.push(v.trim());
  } else if (Array.isArray(v)) v.forEach((x) => screenText(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!NOT_TEXT.has(k)) screenText(x, out);
  return out;
}
// Share of the on-screen text that is also spoken (character pairs, so it works for Chinese and English)
function spokenShare(screen: string, said: string): number {
  const pairs = (s: string) => {
    const t = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
  };
  const a = pairs(screen);
  if (a.size < 4) return 0;
  const b = pairs(said);
  let n = 0;
  for (const p of a) if (b.has(p)) n++;
  return n / a.size;
}
const ACTION = /点击|点开|打开|拖|输入|搜索|选中|切换|导出|上传|录制|安装|运行|\b(click|open|drag|type|search|select|switch|export|upload|install|run|press)\b/i;
const FOOTAGE_KINDS = new Set(['screen', 'clip', 'image', 'html', 'scroll']);
// Frames for a review, joined into a contact sheet and a phone-size sheet; image lines the AI opens
async function reviewRender(args: string[], fmt: Format): Promise<{ images: string[]; scope: string }> {
  const { tl } = await timeline(readDoc(slug).doc, fmt);
  const { frames, scope, dropped } = reviewFrames(tl.scenes, tl.total, tl.fps, args);
  console.log(`rendering ${frames.length} frames of ${slug} (${fmt}) for review: ${scope}${dropped ? `; ${dropped} more thinned out, name scenes or a time range to see them` : ''}`);
  const shots = await renderFrames({ slug, format: fmt, lang, frames, log: (s) => console.log(s) });
  const sheets = await reviewSheets(slug, shots, fmt);
  const images = sheets ? [sheets.sheet, sheets.phone] : shots.map((s) => path.resolve(s.file));
  if (sheets) {
    console.log(`image: ${sheets.sheet}  (contact sheet: ${scope})`);
    console.log(`image: ${sheets.phone}  (phone size, 360 px per frame)`);
  } else for (const s of shots) console.log(`image: ${path.resolve(s.file)}  (${s.label})`);
  return { images, scope };
}
async function planLines(fmt: Format = format): Promise<string[]> {
  const out: string[] = [];
  const { doc } = readDoc(slug);
  const { tl } = await timeline(doc, fmt);
  const fps = tl.fps;
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  out.push(`${slug} · plan (${lang}, ${fmt}): what each scene says, what its picture adds, the text on screen`);
  let flagged = 0;
  for (const e of tl.scenes) {
    const sc = doc.board.scenes.find((x) => x.id === e.id)!;
    const v = (fmt === 'tall' && sc.tall ? sc.tall : sc.visual) as { kind: string; src?: string };
    const said = e.lines.map((l) => l.text).join(' ');
    const text = [...screenText(v), ...(sc.overlays ?? []).flatMap((o) => (o && 'text' in o && typeof o.text === 'string' ? [o.text] : []))].map((t) => plain(t).replace(/\s+/g, ' ')).join(' / ');
    const shows = v.kind === 'screen' ? `recording ${v.src} ${e.from?.toFixed(1)}→${e.to?.toFixed(1)} s` : v.src ? `${v.kind} ${v.src}` : `${v.kind} card`;
    out.push(`${String(e.index + 1).padStart(2)} ${pad(e.id, 12)} ${fmtTime(e.start, fps).padStart(7)} ${sec(e.dur, fps).padStart(5)}s`);
    if (sc.shot) out.push(`     shot:  ${cut(sc.shot.replace(/\s+/g, ' '), 110)}`);
    if (sc.role) out.push(`     role:  ${sc.role} (${sc.role === 'a' ? 'real footage of the product' : 'made explanation'})`);
    if (sc.intent) out.push(`     intent: ${cut(sc.intent.replace(/\s+/g, ' '), 110)}`);
    if (sc.seam) out.push(`     seam:  ${cut(sc.seam.replace(/\s+/g, ' '), 110)}`);
    out.push(`     says:  ${said ? cut(said, 110) : '(no narration)'}`);
    out.push(`     shows: ${shows}`);
    if (text) out.push(`     text:  ${cut(text, 110)}`);
    const share = text && said ? spokenShare(text, said) : 0;
    if (share >= 0.6 && [...plain(text)].length >= 8) {
      flagged++;
      out.push(`     ! ${Math.round(share * 100)}% of the on-screen text is also spoken: the picture repeats the words instead of adding to them (show the thing itself, or cut the text to a short label)`);
    }
    if (!sc.shot?.trim()) {
      flagged++;
      out.push(`     ! no shot design: write what this shot shows and how it is made (set ${e.id} shot "<page or app · actions · camera>")`);
    }
    if (said && ACTION.test(said) && !FOOTAGE_KINDS.has(v.kind)) {
      flagged++;
      out.push(`     ! the narration describes doing something, but the picture is a ${v.kind} card: footage of it would show it (record, record-window, or import, then swap ${e.id} cap/<name>.mp4)`);
    }
  }
  const table = tableNotes(doc, slug);
  const len = doc.board.workflow ? lengthNote(tl.total / fps, readBrief(slug)) : null;
  if (len) table.push(len);
  for (const n of table) out.push(n);
  flagged += table.length;
  out.push(flagged ? `${flagged} note(s). A note is a suggestion: the user's request decides.` : 'no notes');
  return out;
}
async function planCmd() {
  for (const l of await planLines()) console.log(l);
}

// Windows a desktop recording can capture, front to back; a word narrows the list to matching titles or programs
async function windowsCmd(filter: string) {
  if (!desktopSupported()) return console.log('desktop recording works on Windows for now; web pages: record <name> <url>');
  const f = filter.trim().toLowerCase();
  const all = (await listWindows()).filter((w) => !f || w.title.toLowerCase().includes(f) || w.exe.toLowerCase().includes(f));
  // Window titles can be private (chats, documents): the full list shows only their start
  const n = f ? 50 : 24;
  const short = (t: string) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const open = all.filter((w) => !w.minimized);
  console.log(`windows${f ? ` matching "${filter.trim()}"` : ''} (record-window <name> "<title or program>"):`);
  console.log(open.map((w, i) => `  ${String(i + 1).padStart(2)}. ${short(w.title)}  —  ${w.exe}, ${w.client.w}×${w.client.h}${w.foreground ? ' (in front)' : ''}`).join('\n') || '  none');
  const mins = all.filter((w) => w.minimized);
  if (mins.length) console.log(`minimized (the person has to restore them before recording): ${mins.map((w) => `${short(w.title)} (${w.exe})`).join('; ')}`);
  const mons = await listMonitors();
  console.log(`screens (record-screen <name> [n]):\n${mons.map((m, i) => `  ${i + 1}. ${m.rect.w}×${m.rect.h}${m.primary ? ' (main)' : ''}${m.scale !== 1 ? `, ${Math.round(m.scale * 100)}% scaling` : ''}`).join('\n')}`);
}

// A person works an app (or the whole screen) while Cutroom records it: the record bar shows the note,
// Start/Stop and Mark; clicks and pointer moves are logged for the camera, Mark presses become named marks
async function desktopCmd(which: string, rest: string[]) {
  const [name, ...more] = rest;
  const screen = which === 'record-screen';
  const what = more.join(' ').trim();
  if (!name || (!screen && !what)) throw new Error(screen ? 'record-screen <name> [screen number] [--note "what to do"] [--marks a,b] [--max sec]' : 'record-window <name> "<window title or program>" [--area] [--note "what to do"] [--marks a,b] [--max sec]');
  const marks = marksArg ? marksArg.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
  if (marks?.some((m) => !/^[\w-]+$/.test(m))) throw new Error('--marks are names of letters, digits, - and _, separated by commas: --marks open,drag,done');
  const max = maxArg ? Number(maxArg) : 300;
  if (!(max >= 2 && max <= 1800)) throw new Error('--max is the longest recording in seconds (2–1800)');
  const mon = screen && what ? Number(what) - 1 : undefined;
  if (mon !== undefined && !(mon >= 0)) throw new Error('record-screen <name> [n]: n is a screen number from windows');
  console.log(screen ? `recording screen ${what || 'with the record bar'} …` : `recording the window "${what}" …`);
  const r = await recordDesktop({
    slug,
    name,
    window: screen ? undefined : /^\d{4,}$/.test(what) ? undefined : what,
    hwnd: !screen && /^\d{4,}$/.test(what) ? Number(what) : undefined,
    mode: screen ? 'screen' : area ? 'area' : 'window',
    monitor: mon,
    note: noteArg,
    marks,
    max,
    replace,
    log: (s) => console.log(`  ${s}`),
  });
  const ms = r.marks.length ? r.marks.map((m) => `@${m.name} ${m.t.toFixed(2)}s`).join(', ') : 'none';
  console.log(`saved ${r.file}: ${r.duration.toFixed(1)} s, ${r.width}×${r.height}${r.title ? ` from "${r.title}"` : ''}; ${r.clicks} click(s); marks: ${ms}${r.stopped === 'max' ? ` (stopped at the ${max} s limit)` : r.stopped === 'closed' ? ' (the window was closed)' : ''}`);
  if (marks && r.marks.length < marks.length) console.log(`note: ${marks.length - r.marks.length} of the planned marks were not pressed (${marks.slice(r.marks.length).join(', ')}); add them with mark ${r.file.slice(4, -4)} <name> <seconds> after finding the moment with look`);
  console.log(`next: add screen ${r.file} [after-id], or put it into an existing scene: swap <id> ${r.file}. Captions can align to marks ("at": "@name"); the camera zooms in on each click.`);
}

// New footage into an existing scene: its narration, overlays, sounds and transition stay
async function swapCmd(rest: string[]) {
  const [id, src] = rest;
  if (!id || !src) throw new Error('swap <scene-id> <cap/x.mp4 | media/x.mp4 | media/x.png | scenes/x/index.html> [--tall]');
  const { doc } = readDoc(slug);
  const old = doc.board.scenes.find((x) => x.id === id);
  if (!old) throw new Error(`没有场景 ${id}`);
  if (!fs.existsSync(path.join(PUBLIC, slug, src))) throw new Error(`no ${src} in the project (media lists the files; import <file> brings one in)`);
  const kind = /^cap\/[^/]+\.mp4$/i.test(src) ? 'screen' : /\.(mp4|webm|mov)$/i.test(src) ? 'clip' : /\.(png|jpe?g|webp|gif)$/i.test(src) ? 'image' : /\.html?$/i.test(src) ? 'html' : '';
  if (!kind) throw new Error(`${src}: swap takes a recording (cap/*.mp4), a video or image in media/, or an HTML page in scenes/`);
  const sc = structuredClone(old);
  const fresh = sceneTemplate(kind, id, src);
  const key = tallFlag ? 'tall' : 'visual';
  const was = (sc[key] ?? sc.visual).kind;
  sc[key] = fresh.visual;
  // A card's minimum length meant reading time for the card; footage takes the length of its lines
  if (!tallFlag) {
    if (fresh.minSec !== undefined) sc.minSec = fresh.minSec;
    else delete sc.minSec;
    if (kind === 'image' && !sc.fx) sc.fx = fresh.fx;
  }
  // Overlays were placed on the old picture (a cross over a list item, a circle on a card); they go unless kept
  const dropped = !keepOverlays && !tallFlag ? (sc.overlays ?? []).filter(Boolean) : [];
  if (dropped.length) delete sc.overlays;
  save({ ...replaceScene(doc, id, sc), desc: `${id}${tallFlag ? ' (9:16)' : ''}: ${was} → ${kind} ${src}（台词、音效保留${dropped.length ? `，去掉 ${dropped.length} 个叠加` : ''}）` });
  if (dropped.length) console.log(`removed ${dropped.length} overlay(s) placed on the old ${was} picture: ${dropped.map((o) => `${o!.kind}${'text' in o! && o!.text ? ` "${plain(String(o!.text)).slice(0, 20)}"` : ''} at ${o!.at}s`).join(', ')} (swap ${id} ${src} --keep-overlays keeps them)`);
  const { tl } = await timeline(readDoc(slug).doc);
  const e = tl.scenes.find((x) => x.id === id);
  if (e && kind === 'screen' && e.capDur !== undefined && e.from !== undefined) {
    const hold = e.dur / tl.fps - (e.capDur - e.from) / e.rate;
    if (hold > 0.5) console.log(`note: the recording is ${(e.capDur - e.from).toFixed(1)} s and the narration needs ${(e.dur / tl.fps).toFixed(1)} s, so the last frame would stand still for ${hold.toFixed(1)} s: shorten the lines, or ask for a longer recording`);
  }
  const marks = kind === 'screen' ? (() => {
    const j = path.join(PUBLIC, slug, src.replace(/\.mp4$/i, '.json'));
    if (!fs.existsSync(j)) return [];
    return (JSON.parse(fs.readFileSync(j, 'utf8')).events as { type: string; name?: string; t: number }[]).filter((e) => e.type === 'mark').map((e) => `@${e.name} ${e.t.toFixed(1)}s`);
  })() : [];
  if (marks.length) console.log(`${src} marks: ${marks.join(', ')}; align a line to one: set ${id} lines.<k>.at '"@<mark>"'`);
  console.log(`check it: look ${id}${kind === 'screen' ? `; to show only part of the recording: trim ${id} --from <s|@mark> --to <s|@mark>` : ''}`);
}

// Render the video to a file, like the editor's export button
async function exportCmd() {
  const variant = clean ? 'clean' : 'default';
  if (jianying) {
    const { tl, props } = await timeline();
    console.log(`exporting ${slug} as a JianyingPro (剪映) draft (${format === 'tall' ? '9:16' : '16:9'}, ${lang}) …`);
    const r = await exportJianying({ props: { ...props, variant, voice: silent ? 'off' : 'on' }, fps: tl.fps, root: outArg, name: nameArg, log: (s) => console.log(s) });
    console.log(`draft "${r.name}" (${r.seconds.toFixed(1)} s) in ${r.dir}`);
    for (const t of r.tracks) console.log(`  ${t.name}: ${t.segments} segment(s)`);
    return console.log(r.registered ? "added to JianyingPro's draft list: open JianyingPro (restart it if it is running) and pick the draft" : 'restart JianyingPro to see the draft');
  }
  console.log(`exporting ${slug} (${format === 'tall' ? '9:16' : '16:9'}, ${lang}${clean ? ', links hidden' : ''}${silent ? ', no voice' : ''}) …`);
  const shown: Record<string, number> = {};
  const t0 = Date.now();
  const seconds = maxMbArg ? await timeline().then(({ tl }) => tl.total / tl.fps) : undefined;
  const r = await runExport({ slug, format, lang, variant, voice: silent ? 'off' : 'on', scale: scaleArg ? Number(scaleArg) : undefined, codec: codecArg, out: outArg, maxMb: maxMbArg ? Number(maxMbArg) : undefined, seconds }, (line) => {
    const m = [...line.matchAll(/(\d+)\/(\d+)/g)].pop();
    if (m) {
      const phase = /encod/i.test(line) ? 'encoding' : 'rendering';
      const pct = Math.floor((Number(m[1]) / Math.max(1, Number(m[2]))) * 4) * 25;
      if (pct > (shown[phase] ?? -1)) console.log(`  ${phase} ${(shown[phase] = pct)}%`);
    } else if (/error|failed/i.test(line)) console.log(`  ${line.slice(0, 300)}`);
  });
  if (r.code !== 0 || !fs.existsSync(r.out)) throw new Error(`export failed (exit ${r.code})`);
  console.log(`saved ${r.out} (${(fs.statSync(r.out).size / 1048576).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  // Sound check: platforms play everything at about -14 LUFS, so a quieter mix just sounds weak
  if (codecArg === 'gif') return;
  const loud = measureLoudness(r.out);
  if (!loud) return console.log('no sound in the export');
  const target = lufsArg !== undefined ? Number(lufsArg) : undefined;
  if (target !== undefined) {
    if (!(target >= -30 && target <= -8)) throw new Error('--lufs is a loudness target from -30 to -8 (-14 for video platforms)');
    const after = normalizeLoudness(r.out, target, loud);
    return console.log(`loudness ${describeLoudness(loud)} → ${after ? describeLoudness(after) : '?'}`);
  }
  console.log(`loudness ${describeLoudness(loud)}${loud.i < -16 || loud.i > -12 || loud.tp > -1 ? ' (video platforms play at about -14 LUFS: export again with --lufs -14)' : ''}`);
}

// Record websites again from their saved steps; the edit follows the new footage through its marks
async function rerecordCmd(rest: string[]) {
  const all = readRecipes(slug);
  if (!all.length) return console.log('no recordings with saved steps yet (record <name> <url> [steps] saves them)');
  if (!rest.length) {
    for (const x of all) console.log(`cap/${x.name}.mp4  ${x.recipe.url}  ${x.recipe.steps ? `${x.recipe.steps.length} steps` : 'scroll tour'}${(x.recipe as { recorded?: string }).recorded ? `  recorded ${(x.recipe as { recorded?: string }).recorded!.slice(0, 16).replace('T', ' ')}` : ''}`);
    return console.log('rerecord <name …> | rerecord all');
  }
  const names = rest[0] === 'all' ? all.map((x) => x.name) : rest.map((n) => n.replace(/^cap\//, '').replace(/\.mp4$/, ''));
  let lost = 0;
  for (const n of names) {
    const rec = all.find((x) => x.name === n);
    if (!rec) {
      const j = path.join(PUBLIC, slug, 'cap', `${n}.json`);
      const src = fs.existsSync(j) ? (JSON.parse(fs.readFileSync(j, 'utf8')) as { source?: { kind: string; exe?: string } }).source : undefined;
      if (src?.kind === 'desktop') throw new Error(`cap/${n}.mp4 is a desktop recording (${src.exe ?? 'a screen'}), made by a person working the app, so it has no steps to replay. Record it again: record-window ${n} "${src.exe ?? '<program>'}" --replace --note "…" (press Mark at the same moments and the edit keeps its anchors)`);
      throw new Error(`no saved steps for cap/${n}.mp4 (rerecord lists the ones that have them)`);
    }
    console.log(`re-recording cap/${n}.mp4 from ${rec.recipe.url} …`);
    const r = await rerecord(slug, n, (s) => console.log(s));
    console.log(`cap/${n}.mp4: ${r.before !== undefined ? `${r.before.toFixed(1)} s → ` : ''}${r.duration.toFixed(1)} s; marks: ${r.marks.map((m) => `@${m.name} ${m.t.toFixed(2)}s`).join(', ') || 'none'}`);
    if (r.lost.length) {
      lost += r.lost.length;
      console.log(`  marks gone: ${r.lost.join(', ')}; whatever was anchored to them needs a new anchor (check lists it)`);
    }
  }
  const users = doc0().board.scenes.filter((s) => [s.visual, s.tall].some((v) => v?.kind === 'screen' && names.some((n) => v.src === `cap/${n}.mp4`))).map((s) => s.id);
  console.log(`next: check${users.length ? `, then look ${users.join(' ')}` : ''}${lost ? '' : ' (captions and cuts follow the marks, so the edit already fits the new footage)'}`);
}
const doc0 = () => readDoc(slug).doc;

// Render frames for the AI to look at: seconds, m:ss, a scene id (its middle) or id+seconds; default a few scenes
async function lookCmd(rest: string[]) {
  const { doc } = readDoc(slug);
  const { tl } = await timeline(doc);
  const fps = tl.fps;
  const at = (s: (typeof tl.scenes)[number], rel: number) => ({ f: s.start + rel * fps, label: `${fmtTime(Math.round(s.start + rel * fps), fps)}, ${s.id} +${rel.toFixed(2)} s` });
  const frames: { f: number; label: string }[] = [];
  // One frame in the middle of every narration line, to check each line against its picture
  if (rest[0] === 'lines') {
    frames.push(...lineFrames(tl));
    if (!frames.length) throw new Error('no narration lines yet: look lines needs lines to check');
  }
  const picks = rest[0] === 'lines' ? [] : rest.length ? rest : tl.scenes.filter((_, i, all) => all.length <= 8 || i % Math.ceil(all.length / 8) === 0).map((s) => s.id);
  for (const a of picks.slice(0, 8)) {
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(a);
    const sec = /^\d+(?:\.\d+)?$/.test(a) ? Number(a) : m ? Number(m[1]) * 60 + Number(m[2]) : null;
    if (sec !== null) {
      const f = Math.round(sec * fps);
      const s = tl.scenes.find((x) => f >= x.start && f < x.start + x.dur) ?? tl.scenes[tl.scenes.length - 1];
      frames.push(at(s, (f - s.start) / fps));
      continue;
    }
    const r = /^([\w-]+?)(?:\+(\d+(?:\.\d+)?))?$/.exec(a);
    const s = r ? tl.scenes.find((x) => x.id === r[1]) : undefined;
    if (!s) throw new Error(`look takes seconds (12.5), m:ss (0:12.5), a scene id (its middle) or id+seconds; no scene "${a}"`);
    frames.push(at(s, r![2] !== undefined ? Math.min(Number(r![2]), s.dur / fps - 0.05) : (s.dur / fps) * 0.55));
  }
  console.log(`rendering ${frames.length} frame(s) of ${slug} (${format}, ${lang}) as an export would…`);
  const shots = await renderFrames({ slug, format, lang, frames, log: (s) => console.log(s) });
  for (const x of shots) console.log(`image: ${path.resolve(x.file)}  (${x.label})`);
  console.log(
    rest[0] === 'lines'
      ? 'One image per narration line, in order. Open every one: the picture must show what its line says (the page, the feature, the result). Fix each line that does not before you call the cut done.'
      : 'Each image is one frame exactly as exported. Look at them before judging layout, text or colour.',
  );
}


// Music written as a score and played by real instrument recordings: instruments / compose / use
async function musicCmd(rest: string[]) {
  const sub = rest[0];
  const dir = path.join(PUBLIC, 'music');
  if (sub === 'instruments' || sub === 'library') {
    await ensureStudio();
    const lib = await api<Inst[]>('/api/library');
    return console.log(`instruments (id, family, drums are written at midi 60, pitched range, articulations):\n${libraryText(lib)}`);
  }
  if (sub === 'compose') {
    const name = slugOf(rest[1] ?? '');
    const src = rest[2];
    if (!name || src === undefined) throw new Error("music compose <name> '<draft json>'  (or a file path, or - to read stdin); music help shows the draft format");
    const text = src === '-' ? fs.readFileSync(0, 'utf8') : !src.trim().startsWith('{') && fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : src;
    let draft: Draft;
    try {
      draft = JSON.parse(text) as Draft;
    } catch (e) {
      throw new Error(`the draft is not valid JSON: ${(e as Error).message}`);
    }
    if (fs.existsSync(path.join(dir, `${name}.mp3`)) && !replace) throw new Error(`music/${name}.mp3 exists; pick another name or add --replace`);
    await ensureStudio();
    const home = studioHome();
    if (!home) throw new Error('XSXB-Band is not installed here (set XSXB_BAND_HOME)');
    const lib = await api<Inst[]>('/api/library');
    const project = expand(draft, lib);
    const work = path.join(STATE, 'music', name);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const file = path.join(work, 'project.json');
    fs.writeFileSync(file, JSON.stringify(project));
    const need = (project.tracks as { instrumentId: string }[]).map((t) => t.instrumentId).filter((id) => lib.find((i) => i.id === id && !i.installed));
    console.log(`rendering ${draft.title}: ${draft.bars} bars at ${draft.bpm} BPM, ${draft.tracks.length} track(s)${need.length ? `; first use downloads the recordings for ${[...new Set(need)].join(', ')}` : ''}…`);
    const r = await renderProject(home, file, path.join(work, 'render'));
    const seconds = r.mix.scoreSeconds;
    const out = installTrack(name, r.wav, draft, seconds, { score: JSON.stringify(project) });
    for (const w of [...rangeWarnings(draft, lib), ...r.warnings]) console.log(`warning: ${w}`);
    const peaks = r.mix.secondPeakDbFS.filter((x): x is number => typeof x === 'number');
    // Only the seconds of the score itself; the reverb tail after it is meant to fade
    const quiet = peaks.slice(0, Math.floor(seconds)).filter((x) => x < -40).length;
    console.log(`music/${name}.mp3  ${Math.round(seconds * 10) / 10} s, ${Math.round(draft.bpm)} BPM, ${draft.bars} bars  ${out.i.toFixed(1)} LUFS (target ${MUSIC_LUFS}${out.limited ? '; the peaks stop it being louder, so thin out the loudest hits if it must be' : ''}), true peak ${out.tp.toFixed(1)} dBTP`);
    console.log(`render: peak ${r.mix.peakDbFS.toFixed(1)} dBFS, clipped frames ${r.mix.saturatedFrames}${quiet > 1 ? `, ${quiet} near-silent second(s) of ${peaks.length}: check for gaps` : ''}`);
    if (r.mix.saturatedFrames > 0) console.log('warning: the render clips; lower the loudest tracks (vol) and compose again with --replace');
    console.log(`score kept as music/${name}.score.json`);
    return console.log(`next: music use ${name}. You cannot hear it: say so, and let the user listen.`);
  }
  if (sub === 'use') {
    const name = rest[1]?.replace(/^music\//, '').replace(/\.mp3$/, '');
    if (!name || !fs.existsSync(path.join(dir, `${name}.mp3`))) throw new Error(`music use <name>: no such track in music/ (media lists them)`);
    const { doc } = readDoc(slug);
    const board = structuredClone(doc.board);
    board.music = { ...(board.music ?? {}), src: `music/${name}.mp3` };
    return save({ doc: { ...doc, board }, desc: `配乐 → music/${name}.mp3` });
  }
  if (sub === 'help' || sub === undefined) {
    return console.log(`music instruments                list the instruments you can write for
music compose <name> <draft|file|->  render a score into music/<name>.mp3; --replace overwrites
music use <name>                 put the track under this project

draft = {"title":"…","bpm":96,"bars":16,"key":"A minor","tracks":[ track, … ]}
track = {"inst":"<instrument id>","name":"…","vol":0.7,"pan":0,"reverb":0.2,"art":"<articulation>",
         "notes":[[start beat, length in beats, midi, velocity 0-1, "articulation"?], …],
         "pattern":"x...x...x...x.x.",      drums: 16 steps a bar (x hit, X accent, . rest); an array gives one string per bar, repeated
         "loop":4,"from":0,"to":16}          notes/pattern describe ${'`loop`'} bars and repeat from bar from up to bar to
Beats count quarter notes from 0 (bar 2 starts at beat 4); midi 60 = C4; drums are written at midi 60.
Studio ${STUDIO_URL}. Samples are CC0, downloaded on first use (about 20-250 MB per song).

Writing it well (read before the first compose):
- Length: bars x 4 x 60 / bpm seconds. A track shorter than the video loops.
- Shape: even 30 s needs a start, a change (add or drop a layer every 4 bars) and an ending. A loop of one bar is not music.
- Split the jobs: melody (leave breath between phrases), chords, bass, rhythm. More tracks is not more energy.
- Under a voice-over keep the middle thin: a sparse melody, soft chords, no busy lead. The music is lowered under the voice by itself.
- Stay inside each instrument's listed range. Long notes: sustain or vibrato; do not scatter staccato inside a smooth melody.
- Feel: vary velocity (0.4-0.9), start phrases off the beat sometimes, leave gaps. Drums: kick and snare make the skeleton, hats fill.
- Check the report: clipped frames must be 0; if it says the peaks cap the loudness, thin the loudest hits. You cannot hear it: say so, and offer another take.
- Several takes: compose with another <name> and keep both; the user picks by ear.`);
  }
  throw new Error('music instruments | compose <name> <draft|file|-> | use <name> | help');
}

const musicTracks = () => {
  const dir = path.join(PUBLIC, 'music');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.mp3')).map((f) => `music/${f}`);
};

// Problems worth fixing before export, each with the command that fixes it
async function checkCmd() {
  const { doc } = readDoc(slug);
  const out: string[] = [];
  const add = (where: string, what: string, fix?: string) => out.push(`- ${where}: ${what}${fix ? `\n    fix: ${fix}` : ''}`);
  const len = (s?: string) => [...plain(s ?? '')].length;
  const FOOTAGE = new Set(['screen', 'image', 'clip']);
  const ON_TOP = new Set(['text', 'punch', 'cinema', 'bigword']);
  const { tl, caps } = await timeline(doc);
  const fps = tl.fps;
  for (const s of doc.board.scenes) {
    const e = tl.scenes.find((x) => x.id === s.id);
    // Anchors to marks a re-recording no longer has
    const sv = (format === 'tall' && s.tall ? s.tall : s.visual) as { kind: string; src?: string; from?: unknown; to?: unknown };
    if (sv.kind === 'screen' && sv.src && caps[sv.src]) {
      const gone = (ref: unknown) => typeof ref === 'string' && /^@/.test(ref) && (() => { try { capTime(ref, caps, sv.src!); return false; } catch { return true; } })();
      s.lines.forEach((l, k) => gone(l.at) && add(`${s.id} line ${k + 1}`, `anchored to ${l.at}, which ${sv.src} no longer has`, `media lists its marks; set ${s.id} lines.${k}.at '"@<mark>"'`));
      for (const key of ['from', 'to'] as const) if (gone(sv[key])) add(s.id, `${key} ${sv[key]} is not a mark of ${sv.src}`, `trim ${s.id} --${key} <seconds or @mark>`);
      (s.sounds ?? []).forEach((c, i) => gone(c.at) && add(s.id, `sound ${c.id} is anchored to ${c.at}, which ${sv.src} no longer has`, `set ${s.id} sounds.${i}.at <seconds or "@mark">`));
    }
    s.lines.forEach((l, k) => {
      if (!plain(l.zh).trim()) add(`${s.id} line ${k + 1}`, 'empty caption', `set ${s.id} lines.${k} undefined`);
      else if (len(l.zh) > 26) add(`${s.id} line ${k + 1}`, `${len(l.zh)} characters on one caption (keep it under 20 or so)`, `split it into two lines with set ${s.id} lines '[…]'`);
      if (l.en && l.en.length > 80) add(`${s.id} line ${k + 1}`, `English line is ${l.en.length} characters`, 'shorten it or split the line');
    });
    const v = s.visual as { kind: string; src?: string };
    if (v.src && !v.src.startsWith('../') && !fs.existsSync(path.join(PUBLIC, slug, v.src))) add(s.id, `media file ${v.src} is missing`, 'record or import it again, or point the scene at another file');
    if (e && v.kind === 'screen' && e.capDur !== undefined && e.from !== undefined) {
      const hold = e.dur / fps - (e.capDur - e.from) / e.rate;
      if (hold > 0.5) add(s.id, `the recording runs out ${hold.toFixed(1)} s before the scene ends, so its last frame stands still`, `start it earlier (trim ${s.id} --from <earlier>), shorten its lines, or slow it down (set ${s.id} visual.rate 0.8)`);
      const fv = (format === 'tall' && s.tall ? s.tall : s.visual) as { kind: string; zoom?: string };
      if (format === 'tall' && fv.kind === 'screen' && fv.zoom !== undefined && fv.zoom !== 'auto') add(s.id, 'the camera is off, so the whole desktop recording sits small in the 9:16 frame and its text is unreadable on a phone', `set ${s.id} ${s.tall ? 'tall' : 'visual'}.zoom undefined (the camera follows the cursor again), or give the 9:16 version a phone recording: tall ${s.id} on`);
      if (e.rate < 0.75) add(s.id, `the recording plays at ${e.rate}× speed, so the cursor and typing look like slow motion`, `keep visual.rate at 0.8 or above: show a longer stretch of the recording (trim ${s.id} --from/--to) or shorten the narration`);
    }
    const hv = (format === 'tall' && s.tall ? s.tall : s.visual) as { kind: string; src?: string; fit?: string };
    if (hv.kind === 'html' && hv.src && fs.existsSync(path.join(PUBLIC, slug, hv.src))) {
      const { text, meta } = readHtml(slug, hv.src);
      for (const x of lintHtml(text, meta)) if (x.level !== 'note') add(s.id, `${hv.src}: ${x.msg}`, `html write ${hv.src.replace(/^scenes\//, '')} '<fixed page>'`);
      const want = format === 'tall' ? 1080 / 1920 : 1920 / 1080;
      if (Math.abs(meta.w / meta.h - want) > 0.02 && hv.fit !== 'cover') add(s.id, `${hv.src} is ${meta.w}×${meta.h}, so it shows letterboxed in the ${format === 'tall' ? '9:16' : '16:9'} frame`, `set ${s.id} ${hv === s.tall ? 'tall' : 'visual'}.fit '"cover"' (crops the edges), or make a ${format === 'tall' ? '1080×1920' : '1920×1080'} version`);
    }
    if (e && e.dur < fps) add(s.id, `only ${(e.dur / fps).toFixed(2)} s long`, `min ${s.id} 2`);
    const cues = (e?.sounds ?? []).filter((c) => !c.past).sort((a, b) => a.f - b.f);
    for (let i = 1; i < cues.length; i++)
      if (cues[i].f - cues[i - 1].f < fps * 0.25) add(s.id, `sounds ${cues[i - 1].label} and ${cues[i].label} start ${((cues[i].f - cues[i - 1].f) / fps).toFixed(2)} s apart`, `move one: set ${s.id} sounds.${cues[i].i}.at <seconds>`);
    for (const c of e?.sounds ?? []) if (c.past) add(s.id, `sound ${c.label} starts after the scene ends, so it never plays`, `set ${s.id} sounds.${c.i}.at <seconds>`);
    (s.overlays ?? []).forEach((o, i) => {
      if (!o) return add(s.id, `overlays.${i} is empty`, `set ${s.id} overlays.${i} undefined`);
      if (o.kind === 'image' && (!o.src || !fs.existsSync(path.join(PUBLIC, slug, o.src)))) add(s.id, `image overlay ${i + 1} ${o.src ? `points at ${o.src}, which is missing` : 'has no image'}`, `set ${s.id} overlays.${i}.src '"media/<file>.png"' (media lists the images; imagine makes one)`);
      if (e && o.at * fps >= e.dur) add(s.id, `overlay ${o.kind} at ${o.at} s starts after the scene ends`, `set ${s.id} overlays.${i}.at <seconds>`);
      if (ON_TOP.has(o.kind) && FOOTAGE.has(v.kind) && !o.plate) add(s.id, `${o.kind === 'text' ? 'text' : `${o.kind} text`} "${plain(o.text).slice(0, 20)}" sits on ${v.kind === 'screen' ? 'a screen recording' : 'footage'} and may not read on bright frames`, `set ${s.id} overlays.${i}.plate true`);
    });
  }
  // The same seconds of one recording played in two scenes
  const played = doc.board.scenes.flatMap((s) => {
    const v = (format === 'tall' && s.tall ? s.tall : s.visual) as { kind: string; src?: string };
    const e = tl.scenes.find((x) => x.id === s.id);
    if (v.kind !== 'screen' || !v.src || !e || e.from === undefined) return [];
    return [{ id: s.id, src: v.src, a: e.from, b: Math.min(e.capDur ?? Infinity, e.from + (e.dur / fps) * e.rate) }];
  });
  for (const [i, x] of played.entries())
    for (const y of played.slice(i + 1)) {
      const a = Math.max(x.a, y.a);
      const b = Math.min(x.b, y.b);
      if (y.src === x.src && b - a > 0.5) add(`${x.id} and ${y.id}`, `both play ${x.src} ${a.toFixed(1)}–${b.toFixed(1)} s, so the same moment is shown twice`, `start the later one where the earlier ends (trim ${y.a >= x.a ? y.id : x.id} --from ${(y.a >= x.a ? x.b : y.b).toFixed(1)}) or end the earlier one sooner`);
    }
  for (const lng of ['zh', 'en'] as const) {
    const st = lineStates(slug, lng);
    const voiced = st.some((x) => x.state === 'voiced');
    const todo = st.filter((x) => x.state === 'missing' || x.state === 'stale');
    if ((lng === 'zh' || voiced) && todo.length) add(`${lng === 'zh' ? 'narration' : 'English narration'}`, `${todo.length} line(s) without current audio (${todo.map((x) => `${x.scene}:${x.k + 1}`).join(', ')})`, `voice${lng === 'en' ? ' --lang en' : ''}`);
  }
  console.log(`${slug}: ${(tl.total / fps).toFixed(1)} s, ${tl.scenes.length} scenes`);
  console.log(out.length ? `${out.length} problem(s):\n${out.join('\n')}` : 'no problems found');
}

// Footage and sound the project can use, for building scenes from it
function mediaCmd() {
  const dir = path.join(PUBLIC, slug);
  const list = (sub: string, re: RegExp) => (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)).filter((f) => re.test(f)).map((f) => `${sub}/${f}`) : []);
  const caps = list('cap', /\.mp4$/i).map((f) => {
    const j = path.join(dir, f.replace(/\.mp4$/i, '.json'));
    if (!fs.existsSync(j)) return f;
    const m = JSON.parse(fs.readFileSync(j, 'utf8')) as { duration: number; events: { type: string; name?: string; t: number }[]; source?: { kind: string; title?: string; exe?: string; from?: string } };
    const marks = m.events.filter((e) => e.type === 'mark').map((e) => `@${e.name} ${e.t.toFixed(1)}s`);
    const clicks = m.events.filter((e) => e.type === 'down').map((e) => e.t.toFixed(1));
    // Where it came from: a desktop app (worked by the person) or an imported file; web recordings have recipes
    const src = m.source?.kind === 'desktop' ? `  from ${m.source.exe || 'the screen'}${clicks.length ? `, clicks at ${clicks.slice(0, 12).join(' ')}${clicks.length > 12 ? ' …' : ''} s` : ', no clicks'}` : m.source?.kind === 'import' ? `  imported (${m.source.from})` : '';
    return `${f}  ${m.duration.toFixed(1)} s${marks.length ? `  marks: ${marks.join(', ')}` : ''}${src}`;
  });
  const media = list('media', /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i);
  const audio = list('media', /\.(mp3|wav|m4a)$/i);
  const music = musicTracks();
  const used = new Set(readDoc(slug).doc.board.scenes.flatMap((s) => [s.visual, s.tall].map((v) => (v && 'src' in v ? String(v.src) : ''))));
  const mark = (f: string) => (used.has(f.split('  ')[0]) ? `${f}  (in use)` : f);
  console.log(`screen recordings (add screen <src>):\n${caps.map((f) => `  ${mark(f)}`).join('\n') || '  none'}`);
  console.log(`images and videos (add image|clip <src>):\n${media.map((f) => `  ${mark(f)}`).join('\n') || '  none'}`);
  const pages = listHtml(slug).map((f) => {
    const { meta } = readHtml(slug, f);
    return `${f}  ${meta.w}×${meta.h}${meta.dur ? `, ${meta.dur} s` : ''}${meta.vars.length ? `, variables: ${meta.vars.map((v) => v.id).join(' ')}` : ''}`;
  });
  console.log(`HTML pages (add html <src>):\n${pages.map((f) => `  ${mark(f)}`).join('\n') || '  none'}`);
  const refDir = path.join(dir, 'ref');
  const refs = fs.existsSync(refDir)
    ? fs.readdirSync(refDir).filter((n) => fs.existsSync(path.join(refDir, n, 'shots.json'))).map((n) => {
        const r = JSON.parse(fs.readFileSync(path.join(refDir, n, 'shots.json'), 'utf8')) as { stats: { count: number; mean: number }; duration: number };
        return `ref/${n}/shots.json  ${r.stats.count} shots in ${r.duration.toFixed(1)} s, average ${r.stats.mean.toFixed(2)} s`;
      })
    : [];
  if (refs.length) console.log(`shot breakdowns (shots <video>):\n${refs.map((f) => `  ${f}`).join('\n')}`);
  console.log(`project audio:\n${audio.map((f) => `  ${f}`).join('\n') || '  none'}`);
  console.log(`music library (set - music.src '"music/…"'):\n${music.map((f) => `  ${f}`).join('\n') || '  none'}`);
}

// HTML scenes: pages with seekable animation in scenes/ (HyperFrames compositions included)
async function htmlCmd(rest: string[]) {
  const { doc } = readDoc(slug);
  const [sub, ...more] = rest;
  const users = (src: string) => doc.board.scenes.filter((s) => [s.visual, s.tall].some((v) => v?.kind === 'html' && v.src === src)).map((s) => s.id);
  const resolve = (a?: string) => {
    if (!a) return undefined;
    const sc = doc.board.scenes.find((s) => s.id === a);
    const v = sc && (format === 'tall' && sc.tall ? sc.tall : sc.visual);
    if (v?.kind === 'html') return v.src;
    if (isHtml(a)) return a.startsWith('scenes/') ? a : `scenes/${a}`;
    return `scenes/${a}/index.html`;
  };
  const report = (rel: string) => {
    const { text, meta } = readHtml(slug, rel);
    console.log(`${rel}: ${meta.w}×${meta.h}${meta.dur ? `, ${meta.dur} s` : ', length unknown'}${meta.id ? `, composition "${meta.id}"` : ''}`);
    const issues = lintHtml(text, meta);
    for (const x of issues) console.log(`  ${x.level}: ${x.msg}`);
    if (!issues.some((x) => x.level !== 'note')) console.log('  no problems found (look renders its frames)');
    const u = users(rel);
    console.log(u.length ? `used by ${u.join(', ')}; the preview reloads it` : `next: add html ${rel} [after-id]`);
  };
  switch (sub ?? 'list') {
    case 'list': {
      const all = listHtml(slug);
      if (!all.length) return console.log('no HTML pages yet: html new <name>, html write <name> <html>, or html import <path>');
      for (const f of all) {
        const { meta } = readHtml(slug, f);
        const u = users(f);
        console.log(`${f}  ${meta.w}×${meta.h}${meta.dur ? `, ${meta.dur} s` : ''}${meta.vars.length ? `, variables: ${meta.vars.map((v) => v.id).join(' ')}` : ''}${u.length ? `  (in ${u.join(', ')})` : ''}`);
      }
      return;
    }
    case 'new': {
      const [name, secArg] = more;
      if (!name) throw new Error('html new <name> [seconds]');
      const rel = `scenes/${name.replace(/[^\w-]+/g, '-')}/index.html`;
      if (fs.existsSync(path.join(PUBLIC, slug, rel))) throw new Error(`${rel} already exists (html write replaces it)`);
      const [w, h] = format === 'tall' ? [1080, 1920] : [1920, 1080];
      writeHtml(slug, rel.slice(7), starterHtml({ id: name, w, h, sec: Number(secArg) > 0 ? Number(secArg) : 4, title: doc.board.title ?? name, theme: doc.board.theme }));
      return report(rel);
    }
    case 'write': {
      const [name, content] = more;
      if (!name || content === undefined) throw new Error("html write <name> '<!doctype html>…'  (or a file path, or - to read stdin)");
      const text = content === '-' ? fs.readFileSync(0, 'utf8') : !content.includes('<') && fs.existsSync(content) ? fs.readFileSync(content, 'utf8') : content;
      return report(writeHtml(slug, name, text));
    }
    case 'import': {
      if (!more[0]) throw new Error('html import <path to a page or a folder with index.html>');
      return report(importHtml(slug, more[0]));
    }
    case 'check': {
      const rel = resolve(more[0]);
      if (rel) return report(rel);
      const all = listHtml(slug);
      if (!all.length) return console.log('no HTML pages');
      return all.forEach(report);
    }
    case 'vars': {
      const sc = doc.board.scenes.find((s) => s.id === more[0]);
      const v = sc && (format === 'tall' && sc.tall ? sc.tall : sc.visual);
      if (!sc || v?.kind !== 'html') throw new Error('html vars <scene-id of an HTML scene>');
      const { meta } = readHtml(slug, v.src);
      if (!meta.vars.length) return console.log(`${v.src} declares no variables (data-composition-variables on its root)`);
      const cur = varValues(meta, v.vars);
      for (const d of meta.vars) console.log(`${d.id}${d.type ? ` (${d.type})` : ''}${d.label ? ` ${d.label}` : ''}: ${JSON.stringify(cur[d.id])}${v.vars?.[d.id] === undefined ? ' (default)' : ''}`);
      return console.log(`change one: set ${sc.id} ${v === sc.tall ? 'tall' : 'visual'}.vars.<id> <json>`);
    }
    default:
      throw new Error('html [list] | new <name> [sec] | write <name> <html|file|-> | import <path> | check [name|scene-id] | vars <scene-id>');
  }
}

// AI voice-over: list / use / generate
async function voiceCmd(rest: string[]) {
  // The native voice library prints dictionary warnings straight to stderr; run in a child and drop them
  if (!process.env.CUTROOM_VOICE_CHILD && !['list', 'use', 'speed', 'forget'].includes(rest[0])) {
    const code = await new Promise<number>((res) => {
      const c = spawn(process.execPath, process.argv.slice(1), { env: { ...process.env, CUTROOM_VOICE_CHILD: '1' }, stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true });
      let buf = '';
      c.stderr.on('data', (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) if (l.trim() && !/sherpa-onnx[\\/]|Skip unknown phonemes|Unknown token|WASM does not support/.test(l)) process.stderr.write(`${l}\n`);
      });
      c.on('close', (n) => res(n ?? 1));
    });
    process.exitCode = code;
    return;
  }
  const s = voiceSettings();
  if (rest[0] === 'list') {
    for (const e of ENGINES) {
      const cur = e.id === s.engine ? ' (current)' : '';
      const voices = voicesOf(e).filter((v) => v.lang === 'any' || v.lang === lang);
      const state = e.id === 'local' ? (localReady() ? ` [installed: ${localStatus().model}]` : ' [not installed: voice install]') : '';
      console.log(`${e.id}${cur}${state}: ${e.en}. ${e.noteEn}
  voice for ${lang}: ${voiceOf(s, e.id, lang)}; ${voices.length} voices: ${voices.map((v) => (v.mine ? `${v.id} (${v.en}, yours)` : v.id)).join(' ')}`);
    }
    console.log(`speed ${s.speed}`);
    return;
  }
  if (rest[0] === 'speed') {
    const v = Number(rest[1]);
    if (!(v >= 0.5 && v <= 2)) throw new Error('voice speed <0.5–2>, e.g. voice speed 1.1');
    writeVoiceSettings({ speed: v });
    return console.log(`voice-over speed ${voiceSettings().speed}× (run voice --redo to re-voice existing lines)`);
  }
  if (rest[0] === 'use') {
    const [, engine, voice] = rest;
    if (!engineDef(engine)) throw new Error(`engines: ${ENGINES.map((e) => e.id).join(', ')}`);
    writeVoiceSettings({ engine });
    if (voice) writeVoiceSettings({ voice, lang });
    const n = voiceSettings();
    return console.log(`voice-over: ${n.engine} · ${voiceOf(n, n.engine, lang)} (${lang})`);
  }
  // HD voices: install, your own voice from a clip, a voice from a description
  if (rest[0] === 'install') {
    const what = rest[1] === 'design' ? 'design' : 'voices';
    let shown = '';
    try {
      await installLocal(what, (j) => {
        const pct = j.total ? ` ${Math.floor((j.got / j.total) * 10) * 10}%` : '';
        const line = `  ${j.step}${pct}`;
        if (line !== shown && j.state === 'running') console.log((shown = line));
      });
      console.log(`HD voices ready (${localStatus().model}, ${localStatus().device || 'device unknown'})`);
    } finally {
      stopLocal();
    }
    return;
  }
  if (rest[0] === 'clone') {
    const file = rest[1];
    if (!file || !fs.existsSync(file)) throw new Error('voice clone <audio file> [--name N] [--text "what the clip says"] [--lang zh|en]');
    const v = addCustomVoice({ name: nameArg ?? '', lang, audio: path.resolve(file), text: textArg, from: 'import' });
    return console.log(`added voice ${v.id} (${v.en}); use it with: voice use local ${v.id}${lang === 'en' ? ' --lang en' : ''}`);
  }
  if (rest[0] === 'design') {
    const instruct = rest.slice(1).join(' ');
    if (!instruct) throw new Error('voice design "<what the voice sounds like>" [--name N] [--lang zh|en]');
    try {
      const v = await designCustomVoice({ name: nameArg ?? '', lang, instruct });
      return console.log(`designed voice ${v.id} (${v.en}); use it with: voice use local ${v.id}${lang === 'en' ? ' --lang en' : ''}`);
    } finally {
      stopLocal();
    }
  }
  if (rest[0] === 'forget') {
    removeCustomVoice(rest[1] ?? '');
    return console.log(`removed voice ${rest[1]}`);
  }
  const engine = engineArg ?? s.engine;
  if (engine === 'builtin' && !modelInstalled()) {
    console.log('Downloading the built-in voice model (147 MB, once)…');
    let shown = 0;
    await installModel((j) => {
      const pct = Math.floor((j.got / j.total) * 10) * 10;
      if (pct > shown) console.log(`  ${(shown = pct)}%`);
    });
  }
  const t0 = Date.now();
  const r = await voiceProject({ slug, lang, scenes: rest.length ? rest : undefined, redo, engine, voice: voiceArg }, (p) => p.line && console.log(`  ${p.done}/${p.total} ${p.line.slice(0, 50)}`)).finally(stopLocal);
  const left = lineStates(slug, lang).filter((l) => l.state === 'missing' || l.state === 'stale').length;
  console.log(`voiced ${r.voiced} line(s), kept ${r.kept}; ${r.seconds} s of ${lang} narration in total; ${left} line(s) still without current audio (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of r.failed) console.log(`  failed ${f.line}: ${f.error}`);
  if (r.failed.length && !r.voiced) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`错误: ${(e as Error).message}`);
  process.exit(1);
});
