import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadProps } from '../../src/lib/load';
import { LAYOUT, withFrame } from '../../src/lib/layout';
import { buildTimeline } from '../../src/lib/timeline';
import type { CaptureMeta, Format, Props, Storyboard, Timings } from '../../src/lib/types';
import { editTimeline } from '../src/model';
import { addScene, addSound, duplicateScene, moveScene, moveSound, removeScene, removeSound, setPath, splitPoint, splitScene, toRef, trimEdge, type Doc } from '../src/ops';
import { BOARD_FX, CARD_LIST, LOWER_LIST, OVERLAY_LIST, SCENE_FX, TEXT_LIST, TRANSITION_LIST, BG_LIST, catalogText } from '../src/catalog';
import { extraPresentation } from '../../src/fx/transitions';
import { cutStarts, type Cut } from '../../src/components/Cuts';
import { linearTiming } from '@remotion/transitions';
import { DEMO_CARDS } from '../../src/fx/demo';
import { ADDABLE, boardTemplate, sceneTemplate } from '../src/templates';
import { SOUNDS, SOUND_CATS, soundDef } from '../../src/fx/sounds';

// Fixture: the showcase project's JSON (no media needed) plus synthetic voice timings
const ROOT = path.join(process.cwd(), 'editor', 'test', 'fixtures');
const SLUG = 'showcase';
const getJson = async <T>(p: string) => (fs.existsSync(path.join(ROOT, p)) ? (JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) as T) : undefined);
const getDims = async () => ({ w: 1920, h: 1080 });
const read = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, SLUG, f), 'utf8')) as T;
const fresh = (): Doc => ({ board: read<Storyboard>('storyboard.json'), timings: { zh: read<Timings>('timings.json') } });
const scene = (d: Doc, id: string) => d.board.scenes.find((s) => s.id === id)!;

async function props(doc: Doc, format: Format): Promise<Props> {
  const l = await loadProps({ slug: SLUG, format }, getJson, getDims, doc.board);
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
  const caps = (await props(d, 'wide')).captures!;
  const t = caps['cap/planner.mp4'].events.find((e) => e.name === 'filter')!.t;
  const r = trimEdge(d, 'record', 'visual', 'to', t + 0.5, caps);
  assert.equal((scene(r.doc, 'record').visual as { to?: unknown }).to, '@filter+0.5');
});

test('voice cut: split moves the narration clips with their lines', async () => {
  const d = fresh();
  const p = await props(d, 'wide');
  const e = editTimeline(p, 60).scenes.find((s) => s.id === 'record')!;
  const at = splitPoint(e, scene(d, 'record'), e.lines[1].start, 60, p.captures!);
  assert.equal(at.line, 1);
  const r = splitScene(d, 'record', at, p.captures!);
  assert.equal(r.doc.timings.zh!.scenes['record'].length, 1);
  assert.equal(r.doc.timings.zh!.scenes['record-2'].length, 1);
  const z = buildTimeline(r.doc.board, r.doc.timings.zh, 'wide', 60, p.captures, false, 'zh').scenes.find((s) => s.scene.id === 'record-2')!;
  assert.ok(z.lines[0].file, 'second half keeps its voice clip');
  assert.equal(z.trans, 0);
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
    const p = await props(d, format);
    const ref = buildTimeline(d.board, d.timings.zh, format, 60, p.captures, false, 'zh');
    const tl = editTimeline(p, 60);
    assert.equal(tl.total, ref.total);
    assert.deepEqual(tl.scenes.map((s) => [s.id, s.start, s.dur]), ref.scenes.map((s) => [s.scene.id, s.start, s.dur]));
  }
  const onlyWide = setPath(d, 'how', 'only', 'wide').doc;
  const pt = await props(onlyWide, 'tall');
  assert.deepEqual(editTimeline(pt, 60).hidden.map((h) => [h.id, h.why]), [['how', '只在横屏']]);
});

test('sounds: add, move across a cut, remove', () => {
  const d = fresh();
  const n0 = scene(d, 'photo').sounds?.length ?? 0;
  const a = addSound(d, 'photo', 'whoosh', 1.234).doc;
  assert.deepEqual(scene(a, 'photo').sounds!.at(-1), { id: 'whoosh', at: 1.23 });
  // Same scene: only the time changes
  const m = moveSound(a, 'photo', n0, 'photo', 2).doc;
  assert.equal(scene(m, 'photo').sounds![n0].at, 2);
  // Another scene: the cue moves with its settings
  const x = moveSound(addSound(fresh(), 'intro', 'boom', 0).doc, 'intro', 0, 'clip', 0.5).doc;
  assert.equal(scene(x, 'intro').sounds, undefined, 'empty list removed');
  assert.deepEqual(scene(x, 'clip').sounds!.at(-1), { id: 'boom', at: 0.5 });
  const r = removeSound(a, 'photo', n0).doc;
  assert.equal(scene(r, 'photo').sounds?.length ?? 0, n0);
  assert.throws(() => removeSound(d, 'intro', 3));
});

test('sound library: files exist, ids unique, every category used', () => {
  const ids = new Set(SOUNDS.map((s) => s.id));
  assert.equal(ids.size, SOUNDS.length);
  for (const s of SOUNDS) {
    assert.ok(fs.existsSync(path.join(process.cwd(), 'public', 'sfx', 'lib', `${s.id}.ogg`)), s.id);
    assert.ok(s.en && s.zh && s.dur > 0, s.id);
    assert.ok(SOUND_CATS.some((c) => c.id === s.cat), s.id);
  }
  for (const c of SOUND_CATS) assert.ok(SOUNDS.some((s) => s.cat === c.id), c.id);
  for (const sc of fresh().board.scenes) for (const c of sc.sounds ?? []) assert.ok(soundDef(c.id), `${sc.id}: ${c.id}`);
});

test('editor timeline places sounds and flags ones past the scene end', async () => {
  const d = addSound(addSound(fresh(), 'photo', 'ding', 0.5).doc, 'photo', 'pop', 999).doc;
  const e = editTimeline(await props(d, 'wide'), 60).scenes.find((s) => s.id === 'photo')!;
  const ding = e.sounds.find((x) => x.id === 'ding')!;
  assert.equal(ding.f, 30);
  assert.equal(ding.past, false);
  assert.equal(e.sounds.find((x) => x.id === 'pop')!.past, true);
});

test('sound cues can follow a recording mark', async () => {
  const d = fresh();
  scene(d, 'record').sounds = [{ id: 'click', at: '@filter' }, { id: 'pop', at: '@nope' }];
  const p = await props(d, 'wide');
  const e = editTimeline(p, 60).scenes.find((s) => s.id === 'record')!;
  const v = scene(d, 'record').visual as { from?: number | string; rate?: number };
  const cap = p.captures!['cap/planner.mp4'];
  const t = cap.events.find((x) => x.name === 'filter')!.t;
  const from = typeof v.from === 'number' ? v.from : v.from ? cap.events.find((x) => `@${x.name}` === v.from)!.t : 0;
  assert.equal(e.sounds[0].f, Math.round(((t - from) / (v.rate ?? 1)) * 60));
  assert.equal(e.sounds[0].past, false);
  assert.equal(e.sounds[1].past, true, 'unknown mark is flagged');
});

test('timeline shows what each scene uses: effects, camera moves, overlays, transitions', async () => {
  const d = fresh();
  const e = editTimeline(await props(d, 'wide'), 60).scenes;
  const photo = e.find((s) => s.id === 'photo')!;
  assert.deepEqual(photo.fx.map((x) => x.en), ['Warm', 'Vignette', 'Light leak']);
  assert.deepEqual(photo.camera.map((x) => [x.en, x.tab]), [['Push in', 'fx']]);
  assert.equal(photo.transIn?.en, 'Flip');
  assert.deepEqual(photo.overlays.map((o) => [o.f, o.dur]), [[30, 156]]);
  const record = e.find((s) => s.id === 'record')!;
  assert.ok(record.camera.length > 0 && record.camera.every((c) => c.tab === 'visual' && c.f >= 0 && c.f + c.dur <= record.dur), 'click zooms inside the scene');
  assert.equal(e[0].transIn, undefined, 'first scene has no transition');
});

// Scenes sit where the timeline (captions, sounds, cues) expects them: transitions overlap both sides
test('scene placement matches the timeline in both formats', async () => {
  const d = fresh();
  const join = (n: number): Cut['join'] => ({ presentation: { component: () => null, props: {} }, timing: linearTiming({ durationInFrames: n }) });
  const cut = (k: string, dur: number, n = 0): Cut => ({ key: k, dur, join: n ? join(n) : undefined, children: null });
  assert.deepEqual(cutStarts([cut('a', 100), cut('b', 80, 12), cut('c', 50), cut('d', 60, 30)], 60), [0, 88, 168, 188]);
  for (const format of ['wide', 'tall'] as Format[]) {
    const p = await props(d, format);
    const tl = buildTimeline(d.board, d.timings.zh, format, 60, p.captures, false, 'zh');
    const starts = cutStarts(tl.scenes.map((s, i) => cut(s.scene.id, s.dur, i > 0 ? s.trans : 0)), 60);
    assert.deepEqual(starts, tl.scenes.map((s) => Math.max(0, s.start)), `voice ${format}`);
  }
});
