import fs from 'node:fs';
import path from 'node:path';
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
const [slug, cmd, ...rest] = args;

const getJson = async <T>(p: string): Promise<T | undefined> => {
  const f = path.join(PUBLIC, p);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : undefined;
};
// PNG header carries the size
const getDims = async (p: string) => {
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
    case 'show':
      return console.log(JSON.stringify(sceneOf(rest[0]), null, 2));
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
        // Keep an explicit @mark the user typed
        if (ref.startsWith('@')) (op.doc.board.scenes.find((x) => x.id === rest[0])![key] as any)[edge] = ref;
        d = op.doc;
        descs.push(op.desc);
      }
      return save({ doc: d, desc: descs.join('；') });
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

// AI voice-over: list / use / generate
async function voiceCmd(rest: string[]) {
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
