import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadProps } from '../../src/lib/load';
import { LAYOUT, withFrame } from '../../src/lib/layout';
import { buildBeatTimeline, buildTimeline } from '../../src/lib/timeline';
import type { CaptureMeta, Format, Props, Storyboard, Timings } from '../../src/lib/types';
import { editTimeline } from '../src/model';
import { addScene, duplicateScene, moveScene, removeScene, setBeatBars, setPath, splitPoint, splitScene, toRef, trimEdge, type Doc } from '../src/ops';
import { BOARD_FX, CARD_LIST, LOWER_LIST, OVERLAY_LIST, SCENE_FX, TEXT_LIST, TRANSITION_LIST, BG_LIST, catalogText } from '../src/catalog';
import { extraPresentation } from '../../src/fx/transitions';
import { DEMO_CARDS } from '../../src/fx/demo';
import { ADDABLE, boardTemplate, sceneTemplate } from '../src/templates';

// Fixture: the showcase project's JSON (no media needed) plus synthetic voice timings
const ROOT = path.join(process.cwd(), 'editor', 'test', 'fixtures');
const SLUG = 'showcase';
const getJson = async <T>(p: string) => (fs.existsSync(path.join(ROOT, p)) ? (JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) as T) : undefined);
const getDims = async () => ({ w: 1920, h: 1080 });
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, SLUG, f), 'utf8')) as T;
const fresh = (): Doc => ({ board: read<Storyboard>('storyboard.json'), timings: { zh: read<Timings>('timings.json') } });
const scene = (d: Doc, id: string) => d.board.scenes.find((s) => s.id === id)!;

async function props(doc: Doc, format: Format, mode: 'voice' | 'beat'): Promise<Props> {
  const l = await loadProps({ slug: SLUG, format, mode }, getJson, getDims, doc.board);
  return { ...l.props, timings: doc.timings.zh };
}

const cap: CaptureMeta = { width: 10, height: 10, fps: 30, duration: 9, events: [{ t: 1, type: 'mark', name: 'a' }, { t: 3, type: 'mark', name: 'b' }] };

test('toRef keeps the anchor kind', () => {
  assert.equal(toRef(3.5, cap, '@b+1'), '@b+0.5');
  assert.equal(toRef(0.6, cap, '@a'), '@a-0.4');
  assert.equal(toRef(1, cap, '@a+0.3'), '@a');
  assert.equal(toRef(2, cap, 1.5), 2);
  assert.equal(toRef(2.9, cap, undefined, true), '@b-0.1');
  assert.equal(toRef(-1, cap, 0), 0);
});

test('move reorders without losing scenes', () => {
  const d = fresh();
  const ids = d.board.scenes.map((s) => s.id);
  const got = moveScene(d, 'numbers', 'photo').doc.board.scenes.map((s) => s.id);
  assert.equal(got.length, ids.length);
  assert.equal(got.indexOf('numbers'), got.indexOf('photo') - 1);
  assert.equal(moveScene(d, 'intro', null).doc.board.scenes.at(-1)!.id, 'intro');
  assert.deepEqual(d.board.scenes.map((s) => s.id), ids, 'input untouched');
});

test('trim writes the new point against the same mark', async () => {
  const d = fresh();
  const caps = (await props(d, 'wide', 'voice')).captures!;
  const t = caps['cap/planner.mp4'].events.find((e) => e.name === 'filter')!.t;
  const r = trimEdge(d, 'record', 'visual', 'to', t + 0.5, caps);
  assert.equal((scene(r.doc, 'record').visual as { to?: unknown }).to, '@filter+0.5');
});

test('beat cut: splitting a clip keeps total length and joins seamlessly', async () => {
  const d = fresh();
  const p = await props(d, 'tall', 'beat');
  const before = buildBeatTimeline(d.board, p.grid!, 'tall', 60, p.captures, 'zh');
  const e = editTimeline(p, 60).scenes.find((s) => s.id === 'record')!;
  const r = splitScene(d, 'record', splitPoint(e, scene(d, 'record'), Math.round(e.dur / 2), 60, p.captures!, 'beat'), p.captures!);
  const ids = r.doc.board.scenes.map((s) => s.id);
  assert.equal(ids[ids.indexOf('record') + 1], 'record-2');
  assert.equal(scene(r.doc, 'record').beat!.length + scene(r.doc, 'record-2').beat!.length, 2);
  const after = buildBeatTimeline(r.doc.board, p.grid!, 'tall', 60, p.captures, 'zh');
  assert.equal(after.total, before.total);
  assert.equal(after.joins[after.scenes.findIndex((s) => s.scene.id === 'record-2')], true);
});

test('voice cut: split moves the narration clips with their lines', async () => {
  const d = fresh();
  const p = await props(d, 'wide', 'voice');
  const e = editTimeline(p, 60).scenes.find((s) => s.id === 'record')!;
  const at = splitPoint(e, scene(d, 'record'), e.lines[1].start, 60, p.captures!, 'voice');
  assert.equal(at.line, 1);
  const r = splitScene(d, 'record', at, p.captures!);
  assert.equal(r.doc.timings.zh!.scenes['record'].length, 1);
  assert.equal(r.doc.timings.zh!.scenes['record-2'].length, 1);
  const z = buildTimeline(r.doc.board, r.doc.timings.zh, 'wide', 60, p.captures, false, 'zh').scenes.find((s) => s.scene.id === 'record-2')!;
  assert.ok(z.lines[0].file, 'second half keeps its voice clip');
  assert.equal(z.trans, 0);
});

test('bars resize changes only the last phrase', () => {
  const r = setBeatBars(fresh(), 'record', 3);
  assert.deepEqual(scene(r.doc, 'record').beat!.map((b) => b.n), [4, 8]);
  assert.throws(() => setBeatBars(fresh(), 'record', 0.2));
});

test('setPath creates, deletes and refuses id changes', () => {
  const d = fresh();
  const a = setPath(d, 'intro', 'overlays.0', { at: 1, kind: 'tag', text: 'x' });
  assert.equal(scene(a.doc, 'intro').overlays![0].text, 'x');
  assert.equal(scene(setPath(a.doc, 'intro', 'overlays.0', undefined).doc, 'intro').overlays!.length, 0);
  assert.equal(setPath(d, null, 'header', 'T').doc.board.header, 'T');
  assert.throws(() => setPath(d, 'intro', 'id', 'zzz'));
});

test('duplicate gets a fresh id; remove drops it', () => {
  const a = duplicateScene(fresh(), 'photo');
  const b = duplicateScene(a.doc, 'photo');
  const ids = b.doc.board.scenes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('photo-2') && ids.includes('photo-3'));
  assert.equal(removeScene(b.doc, 'photo-2').doc.board.scenes.length, ids.length - 1);
});

test('add scene inserts after the given scene with a unique id', () => {
  const d = fresh();
  const r = addScene(d, sceneTemplate('title', 'intro'), 'intro');
  assert.equal(r.doc.board.scenes[1].visual.kind, 'title');
  assert.notEqual(r.doc.board.scenes[1].id, 'intro');
  const img = addScene(d, sceneTemplate('image', 'pic', 'media/a.png'), null).doc.board.scenes.at(-1)!;
  assert.equal(img.visual.kind, 'image');
  assert.equal(img.fx?.kenburns, 'in');
});

test('templates cover every addable kind', () => {
  for (const [kind] of ADDABLE) assert.equal(sceneTemplate(kind, 'x', 'media/a').visual.kind, kind);
  assert.throws(() => sceneTemplate('nope', 'x'));
  const b = boardTemplate('demo', 'Demo');
  assert.equal(b.scenes.length, 2);
  assert.equal(b.scenes[0].visual.kind, 'title');
});

test('effect catalog is consistent', () => {
  for (const g of [...SCENE_FX, ...BOARD_FX])
    for (const f of g.fields) {
      if (f.type === 'range') {
        assert.ok(f.min! < f.max!, f.path);
        if (typeof f.def === 'number') assert.ok(f.def >= f.min! && f.def <= f.max!, f.path);
      }
      if (f.type === 'select') assert.ok(f.options!.length > 1, f.path);
    }
  for (const g of SCENE_FX) for (const f of g.fields) assert.ok(f.path.startsWith('fx.'), f.path);
  const text = catalogText();
  for (const o of OVERLAY_LIST) assert.ok(text.includes(o.id), o.id);
  for (const t of TRANSITION_LIST) if (t.id) assert.ok(text.includes(t.id), t.id);
});

test('every effect has both languages and a renderer', () => {
  const base = ['', 'slide', 'wipe', 'flip', 'clock', 'iris', 'push', 'zoom', 'dip', 'none'];
  for (const x of [...TRANSITION_LIST, ...OVERLAY_LIST, ...LOWER_LIST, ...BG_LIST, ...CARD_LIST, ...TEXT_LIST]) assert.ok(x.en.trim() && x.zh.trim(), x.id);
  for (const t of TRANSITION_LIST) if (!base.includes(t.id)) assert.ok(extraPresentation(t.id, undefined, 1920, 1080), t.id);
  for (const c of CARD_LIST) assert.ok(DEMO_CARDS[c.id], c.id);
  for (const g of [...SCENE_FX, ...BOARD_FX]) for (const f of g.fields) assert.ok(f.en && f.zh, f.path);
});

test('frame inset leaves the layout untouched when unset', () => {
  assert.equal(withFrame(LAYOUT.wide, undefined), LAYOUT.wide);
  assert.equal(withFrame(LAYOUT.wide, { radius: 20 }), LAYOUT.wide);
  const s = withFrame(LAYOUT.wide, { inset: 0.1 });
  assert.ok(Math.abs(s.box.w - LAYOUT.wide.box.w * 0.9) < 1e-6);
  assert.ok(Math.abs(s.box.x + s.box.w / 2 - (LAYOUT.wide.box.x + LAYOUT.wide.box.w / 2)) < 1e-6, 'stays centred');
});

test('editor timeline matches the render timeline', async () => {
  const d = fresh();
  for (const format of ['wide', 'tall'] as Format[]) {
    const p = await props(d, format, 'voice');
    const ref = buildTimeline(d.board, d.timings.zh, format, 60, p.captures, false, 'zh');
    const tl = editTimeline(p, 60);
    assert.equal(tl.total, ref.total);
    assert.deepEqual(tl.scenes.map((s) => [s.id, s.start, s.dur]), ref.scenes.map((s) => [s.scene.id, s.start, s.dur]));
  }
  const onlyWide = setPath(d, 'how', 'only', 'wide').doc;
  const pt = await props(onlyWide, 'tall', 'voice');
  assert.deepEqual(editTimeline(pt, 60).hidden.map((h) => [h.id, h.why]), [['how', '只在横屏']]);
  const noBeat = setPath(d, 'how', 'beat', undefined).doc;
  const pb = await props(noBeat, 'tall', 'beat');
  const tb = editTimeline(pb, 60);
  assert.ok(tb.beats!.length > 8 && tb.beats![0].f === 0);
  assert.ok(tb.hidden.some((h) => h.id === 'how' && h.why === '卡点版未用'));
  assert.equal(tb.music?.src, 'music/aerosol-of-my-love.mp3');
});
