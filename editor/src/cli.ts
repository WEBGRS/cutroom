import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { plain } from '../../src/lib/timeline';
import { loadProps } from '../../src/lib/load';
import type { Format, Props, Scene } from '../../src/lib/types';
import { editTimeline, fmtTime, type ETimeline } from './model';
import { addScene, duplicateScene, getPath, moveScene, removeScene, replaceScene, setBeatBars, setMinSec, setPath, splitPoint, splitScene, toggleTall, trimEdge, uniqueId, type Caps, type Op } from './ops';
import { PUBLIC, STATE, readDoc, readLog, readSnapshot, writeDoc } from './store';
import { HELP as HELP_TEXT } from './help';
import { catalogText } from './catalog';
import { sceneTemplate } from './templates';
import { installModel, lineStates, modelInstalled, voiceOf, voiceProject, voiceSettings, writeVoiceSettings } from './voice';
import { ENGINES, engineDef, type EngineId } from './voices';
import { inspectPage, parseSteps, recordPage } from './record';
import { renderFrames } from './look';

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

const format = (flag('format', 'wide') as Format) ?? 'wide';
const mode = (flag('mode', 'voice') as 'voice' | 'beat') ?? 'voice';
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
const barArg = flag('bar');
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

async function timeline(doc = readDoc(slug).doc): Promise<{ tl: ETimeline; props: Props; caps: Caps }> {
  const base: Props = { slug, format, mode, lang };
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
      console.log(`${slug} · ${format} · ${mode} · ${lang} — ${sec(tl.total, fps)} s @${fps}fps, ${tl.scenes.length} scenes${tl.hidden.length ? `  (not in this cut: ${tl.hidden.map((h) => `${h.id}[${h.why}]`).join(', ')})` : ''}`);
      for (const s of tl.scenes) {
        const v = s.visual;
        const vis = v.kind === 'screen' ? `${s.label} ${s.from?.toFixed(2)}→${s.to?.toFixed(2)}${s.rate !== 1 ? ` ×${s.rate.toFixed(2)}` : ''}` : `${v.kind}: ${s.label}`;
        console.log(`${String(s.index + 1).padStart(2)} ${pad(s.id, 10)} ${fmtTime(s.start, fps).padStart(8)} ${sec(s.dur, fps).padStart(6)}s  ${pad(vis, 44)} ${s.lines.map((l) => (l.stale ? '⚠' : '') + l.text).join(' / ')}`);
        if (s.marks.length) console.log(`${' '.repeat(14)}marks: ${s.marks.map((m) => `${m.name}@${sec(m.f, fps)}`).join('  ')}`);
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
    case 'bars':
      return save(setBeatBars(doc, rest[0], Number(rest[1])));
    case 'split': {
      const { tl, caps } = await timeline(doc);
      const e = tl.scenes.find((x) => x.id === rest[0]);
      if (!e) throw new Error(`${rest[0]} 不在 ${format}/${mode} 这一版里`);
      const f = Math.round(Number(rest[1]) * tl.fps);
      if (!(f > 0 && f < e.dur)) throw new Error(`拆分点要在 0 和 ${sec(e.dur, tl.fps)} 秒之间`);
      return save(splitScene(doc, e.id, splitPoint(e, sceneOf(e.id), f, tl.fps, caps, mode), caps), true);
    }
    case 'add': {
      const [kind, ...more] = rest;
      const needsSrc = ['image', 'clip', 'screen'].includes(kind);
      const src = needsSrc ? more.shift() : undefined;
      if (needsSrc && !src) throw new Error(`add ${kind} 需要素材路径，例如 add ${kind} media/a.${kind === 'image' ? 'png' : 'mp4'}`);
      const after = more[0] ?? null;
      const id = uniqueId(doc.board, `${kind}-1`);
      return save(addScene(doc, sceneTemplate(kind, id, src), after));
    }
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
      // The beat cut has four settings; its tempo is not one of them
      const BEAT_KEYS = ['music', 'startBar', 'volume', 'overlays'];
      if (id === '-' && /^beat(\.|$)/.test(p)) {
        const keys = p === 'beat' ? (value && typeof value === 'object' ? Object.keys(value as object) : []) : [p.split('.')[1]];
        const bad = keys.filter((k) => !BEAT_KEYS.includes(k));
        const music = p === 'beat.music' ? String(value) : p === 'beat' ? (value as { music?: string } | undefined)?.music : doc.board.beat?.music;
        const g = music ? gridOf(music) : null;
        if (bad.length) throw new Error(`beat.${bad.join(', beat.')} is not a setting. The tempo comes from the track's beat data${g ? ` (${music} is ${Math.round(g.bpm)} BPM)` : ''}; to change it, pick another track: beat use music/<track>.mp3 (run beat to list them)`);
        if (music && !g) throw new Error(`${music} has no beat data; pick a track that has: beat use music/<track>.mp3 (run beat to list them)`);
        const op = setPath(doc, null, p, value);
        // Drop settings that never existed (an earlier bpm guess)
        if (op.doc.board.beat) for (const k of Object.keys(op.doc.board.beat)) if (!BEAT_KEYS.includes(k)) delete (op.doc.board.beat as Record<string, unknown>)[k];
        save(op);
        if (g && music) console.log(`beat cut music ${music}: ${Math.round(g.bpm)} BPM, from its beat data`);
        return;
      }
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
    case 'beat':
      return beatCmd(rest);
    case 'look':
      return lookCmd(rest);
    case 'inspect': {
      if (!rest[0]) throw new Error('inspect <url> [--mobile]');
      return console.log(await inspectPage(rest[0], mobile));
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

// Render frames for the AI to look at: seconds, m:ss, a scene id (its middle) or id+seconds; default a few scenes
async function lookCmd(rest: string[]) {
  const { doc } = readDoc(slug);
  const { tl } = await timeline(doc);
  const fps = tl.fps;
  const at = (s: (typeof tl.scenes)[number], rel: number) => ({ f: s.start + rel * fps, label: `${fmtTime(Math.round(s.start + rel * fps), fps)}, ${s.id} +${rel.toFixed(2)} s` });
  const frames: { f: number; label: string }[] = [];
  const picks = rest.length ? rest : tl.scenes.filter((_, i, all) => all.length <= 8 || i % Math.ceil(all.length / 8) === 0).map((s) => s.id);
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
  console.log(`rendering ${frames.length} frame(s) of ${slug} (${format}, ${mode === 'beat' ? 'beat cut' : 'narrated'}, ${lang}) as an export would…`);
  const shots = await renderFrames({ slug, format, mode, lang, frames, log: (s) => console.log(s) });
  for (const x of shots) console.log(`image: ${path.resolve(x.file)}  (${x.label})`);
  console.log('Each image is one frame exactly as exported. Look at them before judging layout, text or colour.');
}

// Beat cut setup: the tempo comes from the track's own beat data, so there is no BPM to choose
type GridInfo = { bpm: number; duration: number };
const gridOf = (src: string): GridInfo | null => {
  const f = path.join(PUBLIC, src.replace(/\.mp3$/, '.beats.json'));
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as GridInfo) : null;
};
const beatTracks = () => {
  const dir = path.join(PUBLIC, 'music');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.mp3')).map((f) => `music/${f}`);
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function beatCmd(rest: string[]) {
  const { doc } = readDoc(slug);
  const listing = () =>
    beatTracks()
      .map((t) => [t, gridOf(t)] as const)
      .filter(([, g]) => g)
      .map(([t, g]) => `  ${t}  ${Math.round(g!.bpm)} BPM, ${mmss(g!.duration)}`)
      .join('\n') || '  none (run tools/beats.py on an mp3 in public/music first)';
  if (rest[0] === 'use') {
    const src = !rest[1] ? '' : rest[1].startsWith('music/') ? rest[1] : `music/${rest[1]}`;
    const g = src ? gridOf(src) : null;
    if (!g) throw new Error(`pick a track that has beat data:\n${listing()}`);
    const board = structuredClone(doc.board);
    const keep = board.beat ?? { music: src };
    board.beat = { music: src, ...(keep.volume !== undefined ? { volume: keep.volume } : {}), ...(keep.overlays !== undefined ? { overlays: keep.overlays } : {}), ...(barArg !== undefined ? { startBar: Math.max(0, Math.round(Number(barArg))) } : keep.startBar !== undefined ? { startBar: keep.startBar } : {}) };
    return save({ doc: { ...doc, board }, desc: `卡点版配乐 → ${src}（${Math.round(g.bpm)} BPM，取自节拍数据）` });
  }
  if (rest[0] === 'off') {
    const board = structuredClone(doc.board);
    delete board.beat;
    return save({ doc: { ...doc, board }, desc: '去掉卡点版设置' });
  }
  const b = doc.board.beat;
  const g = b?.music ? gridOf(b.music) : null;
  console.log(b?.music ? `beat cut: ${b.music}${g ? `, ${Math.round(g.bpm)} BPM from its beat data` : ' (no beat data!)'}, starting at bar ${b.startBar ?? 0}` : 'no beat cut yet: beat use music/<track>.mp3');
  console.log(`tracks with beat data:\n${listing()}`);
}

// Problems worth fixing before export, each with the command that fixes it
async function checkCmd() {
  const { doc } = readDoc(slug);
  const out: string[] = [];
  const add = (where: string, what: string, fix?: string) => out.push(`- ${where}: ${what}${fix ? `\n    fix: ${fix}` : ''}`);
  const len = (s?: string) => [...plain(s ?? '')].length;
  const FOOTAGE = new Set(['screen', 'image', 'clip']);
  const ON_TOP = new Set(['text', 'punch', 'cinema', 'bigword']);
  const { tl } = await timeline(doc);
  const fps = tl.fps;
  for (const s of doc.board.scenes) {
    const e = tl.scenes.find((x) => x.id === s.id);
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
    if (e && e.dur < fps) add(s.id, `only ${(e.dur / fps).toFixed(2)} s long`, `min ${s.id} 2`);
    const cues = (e?.sounds ?? []).filter((c) => !c.past).sort((a, b) => a.f - b.f);
    for (let i = 1; i < cues.length; i++)
      if (cues[i].f - cues[i - 1].f < fps * 0.25) add(s.id, `sounds ${cues[i - 1].label} and ${cues[i].label} start ${((cues[i].f - cues[i - 1].f) / fps).toFixed(2)} s apart`, `move one: set ${s.id} sounds.${cues[i].i}.at <seconds>`);
    for (const c of e?.sounds ?? []) if (c.past) add(s.id, `sound ${c.label} starts after the scene ends, so it never plays`, `set ${s.id} sounds.${c.i}.at <seconds>`);
    (s.overlays ?? []).forEach((o, i) => {
      if (!o) return add(s.id, `overlays.${i} is empty`, `set ${s.id} overlays.${i} undefined`);
      if (e && o.at * fps >= e.dur) add(s.id, `overlay ${o.kind} at ${o.at} s starts after the scene ends`, `set ${s.id} overlays.${i}.at <seconds>`);
      if (ON_TOP.has(o.kind) && FOOTAGE.has(v.kind) && !o.plate) add(s.id, `${o.kind === 'text' ? 'text' : `${o.kind} text`} "${plain(o.text).slice(0, 20)}" sits on ${v.kind === 'screen' ? 'a screen recording' : 'footage'} and may not read on bright frames`, `set ${s.id} overlays.${i}.plate true`);
    });
    for (const [k, b] of (Array.isArray(s.beat) ? s.beat : []).entries()) if (len(b.t) > 12) add(`${s.id} beat ${k + 1}`, `beat-cut text is ${len(b.t)} characters; it should be a short label`, `set ${s.id} beat.${k}.t '"…"'`);
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
    const m = JSON.parse(fs.readFileSync(j, 'utf8')) as { duration: number; events: { type: string; name?: string; t: number }[] };
    const marks = m.events.filter((e) => e.type === 'mark').map((e) => `@${e.name} ${e.t.toFixed(1)}s`);
    return `${f}  ${m.duration.toFixed(1)} s${marks.length ? `  marks: ${marks.join(', ')}` : ''}`;
  });
  const media = list('media', /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i);
  const audio = list('media', /\.(mp3|wav|m4a)$/i);
  const music = beatTracks().map((t) => {
    const g = gridOf(t);
    return g ? `${t}  (beat data, ${Math.round(g.bpm)} BPM)` : t;
  });
  const used = new Set(readDoc(slug).doc.board.scenes.flatMap((s) => [s.visual, s.tall].map((v) => (v && 'src' in v ? String(v.src) : ''))));
  const mark = (f: string) => (used.has(f.split('  ')[0]) ? `${f}  (in use)` : f);
  console.log(`screen recordings (add screen <src>):\n${caps.map((f) => `  ${mark(f)}`).join('\n') || '  none'}`);
  console.log(`images and videos (add image|clip <src>):\n${media.map((f) => `  ${mark(f)}`).join('\n') || '  none'}`);
  console.log(`project audio:\n${audio.map((f) => `  ${f}`).join('\n') || '  none'}`);
  console.log(`music library (set - music.src '"music/…"'):\n${music.map((f) => `  ${f}`).join('\n') || '  none'}`);
}

// AI voice-over: list / use / generate
async function voiceCmd(rest: string[]) {
  // The native voice library prints dictionary warnings straight to stderr; run in a child and drop them
  if (!process.env.CUTROOM_VOICE_CHILD && !['list', 'use', 'speed'].includes(rest[0])) {
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
      const voices = e.voices.filter((v) => v.lang === 'any' || v.lang === lang);
      console.log(`${e.id}${cur}: ${e.en}. ${e.noteEn}
  voice for ${lang}: ${voiceOf(s, e.id, lang)}; ${voices.length} voices: ${voices.map((v) => v.id).join(' ')}`);
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
  const r = await voiceProject({ slug, lang, scenes: rest.length ? rest : undefined, redo, engine, voice: voiceArg }, (p) => p.line && console.log(`  ${p.done}/${p.total} ${p.line.slice(0, 50)}`));
  const left = lineStates(slug, lang).filter((l) => l.state === 'missing' || l.state === 'stale').length;
  console.log(`voiced ${r.voiced} line(s), kept ${r.kept}; ${r.seconds} s of ${lang} narration in total; ${left} line(s) still without current audio (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of r.failed) console.log(`  failed ${f.line}: ${f.error}`);
  if (r.failed.length && !r.voiced) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`错误: ${(e as Error).message}`);
  process.exit(1);
});
