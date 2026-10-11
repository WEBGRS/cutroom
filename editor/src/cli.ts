import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { plain } from '../../src/lib/timeline';
import { loadProps } from '../../src/lib/load';
import type { Format, Props, Scene } from '../../src/lib/types';
import { editTimeline, fmtTime, type ETimeline } from './model';
import { addScene, duplicateScene, getPath, moveScene, removeScene, replaceScene, setBeatBars, setMinSec, setPath, splitPoint, splitScene, toggleTall, trimEdge, uniqueId, type Caps, type Op } from './ops';
import { PUBLIC, STATE, readDoc, readLog, readSnapshot, slugs, writeDoc } from './store';
import { HELP as HELP_TEXT } from './help';
import { catalogText } from './catalog';
import { boardTemplate, sceneTemplate } from './templates';
import { installModel, lineStates, modelInstalled, voiceOf, voiceProject, voiceSettings, writeVoiceSettings } from './voice';
import { ENGINES, engineDef, type EngineId } from './voices';
import { inspectPage, parseSteps, readRecipes, recordPage, rerecord } from './record';
import { runExport } from './exporter';
import { renderFrames } from './look';
import { importHtml, isHtml, lintHtml, listHtml, pageName, readHtml, starterHtml, writeHtml } from './htmlfiles';
import { varValues } from '../../src/lib/html';

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
const outArg = flag('out');
const codecArg = flag('codec');
const scaleArg = flag('scale');
const clean = has('clean');
const silent = has('silent');
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
    case 'export':
      return exportCmd();
    case 'rerecord':
      return rerecordCmd(rest);
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

// Render the video to a file, like the editor's export button
async function exportCmd() {
  const variant = clean ? 'clean' : 'default';
  console.log(`exporting ${slug} (${format === 'tall' ? '9:16' : '16:9'}, ${mode === 'beat' ? 'beat cut' : 'narrated'}, ${lang}${clean ? ', links hidden' : ''}${silent ? ', no voice' : ''}) …`);
  const shown: Record<string, number> = {};
  const t0 = Date.now();
  const r = await runExport({ slug, format, mode, lang, variant, voice: silent ? 'off' : 'on', scale: scaleArg ? Number(scaleArg) : undefined, codec: codecArg, out: outArg }, (line) => {
    const m = [...line.matchAll(/(\d+)\/(\d+)/g)].pop();
    if (m) {
      const phase = /encod/i.test(line) ? 'encoding' : 'rendering';
      const pct = Math.floor((Number(m[1]) / Math.max(1, Number(m[2]))) * 4) * 25;
      if (pct > (shown[phase] ?? -1)) console.log(`  ${phase} ${(shown[phase] = pct)}%`);
    } else if (/error|failed/i.test(line)) console.log(`  ${line.slice(0, 300)}`);
  });
  if (r.code !== 0 || !fs.existsSync(r.out)) throw new Error(`export failed (exit ${r.code})`);
  console.log(`saved ${r.out} (${(fs.statSync(r.out).size / 1048576).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
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
    if (!rec) throw new Error(`no saved steps for cap/${n}.mp4 (rerecord lists the ones that have them)`);
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
  const pages = listHtml(slug).map((f) => {
    const { meta } = readHtml(slug, f);
    return `${f}  ${meta.w}×${meta.h}${meta.dur ? `, ${meta.dur} s` : ''}${meta.vars.length ? `, variables: ${meta.vars.map((v) => v.id).join(' ')}` : ''}`;
  });
  console.log(`HTML pages (add html <src>):\n${pages.map((f) => `  ${mark(f)}`).join('\n') || '  none'}`);
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
