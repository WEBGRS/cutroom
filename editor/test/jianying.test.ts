import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Draft, runsOf } from '../src/jianying';
import { musicEnvelope, simplify } from '../../src/lib/mix';

type Seg = Record<string, unknown> & { target_timerange: { start: number; duration: number }; common_keyframes: { keyframe_list: { time_offset: number; values: number[] }[]; property_type: string }[] };

// pyJianYingDraft's own output for the same kinds of tracks (paths replaced)
const ref = JSON.parse(fs.readFileSync(path.resolve('editor/test/fixtures/jianying-ref.json'), 'utf8'));
const keys = (x: object) => Object.keys(x).sort();

test('draft segments and materials have the same fields as pyJianYingDraft writes', () => {
  const d = new Draft(1920, 1080, 60);
  const v = d.track('video', 'picture');
  const a = d.track('audio', 'narration');
  const t = d.track('text', 'captions');
  const vm = d.video('C:/media/picture.mp4', 12_000_000, 1920, 1080);
  d.videoSegment(v, vm, { start: 0, duration: 4_000_000 }, { start: 0, duration: 4_000_000 });
  d.videoSegment(v, vm, { start: 4_000_000, duration: 4_000_000 }, { start: 4_000_000, duration: 4_000_000 });
  const am = d.audio('C:/media/voice.wav', 2_500_000);
  d.audioSegment(a, am, { start: 500_000, duration: 2_500_000 }, { start: 0, duration: 2_500_000 }, 1, [[0, 0.3], [1_000_000, 0.1]]);
  d.text(t, runsOf('第一句[[字幕]]'), { start: 500_000, duration: 2_000_000 }, { size: 7, color: [1, 1, 1], hi: [0.5, 0.7, 1], y: -0.8, look: 'outline' });
  const end = d.finish();
  const c = d.content as unknown as { tracks: { type: string; name: string; segments: Seg[] }[]; materials: Record<string, Record<string, unknown>[]>; duration: number };
  assert.equal(end, 8_000_000);
  assert.equal(c.duration, 8_000_000);
  assert.deepEqual(keys(c), keys(ref));
  const refSeg = Object.fromEntries((ref.tracks as { type: string; segments: object[] }[]).map((x) => [x.type, x.segments[0]]));
  for (const tr of c.tracks) {
    assert.deepEqual(keys(tr), keys(ref.tracks[0]), `${tr.type} track fields`);
    for (const s of tr.segments) assert.deepEqual(keys(s), keys(refSeg[tr.type]), `${tr.type} segment fields`);
  }
  for (const k of ['videos', 'audios', 'speeds']) assert.deepEqual(keys(c.materials[k][0]), keys(ref.materials[k][0]), `${k} fields`);
  assert.deepEqual(keys(c.materials.texts[0]).filter((k) => !k.startsWith('background_')), keys(ref.materials.texts[0]));
  // Every reference resolves, except the text's own speed (pyJianYingDraft writes it the same way)
  const ids = new Set(Object.values(c.materials).flat().map((m) => m.id));
  for (const tr of c.tracks)
    for (const s of tr.segments) {
      assert.ok(ids.has(s.material_id), 'material exists');
      if (tr.type !== 'text') for (const r of s.extra_material_refs as string[]) assert.ok(ids.has(r), 'speed exists');
    }
  // Highlighted run gets its own style range, counted in characters
  const content = JSON.parse(String(c.materials.texts[0].content));
  assert.equal(content.text, '第一句字幕');
  assert.deepEqual(content.styles.map((s: { range: number[] }) => s.range), [[0, 3], [3, 5]]);
  assert.deepEqual(content.styles[1].fill.content.solid.color, [0.5, 0.7, 1]);
  // Volume keyframes on the narration segment
  const kf = c.tracks[1].segments[0].common_keyframes[0];
  assert.equal(kf.property_type, 'KFTypeVolume');
  assert.deepEqual(kf.keyframe_list.map((k) => [k.time_offset, k.values[0]]), [[0, 0.3], [1_000_000, 0.1]]);
});

test('music ducking survives as a few keyframes', () => {
  const fps = 30;
  // One line from 2 s to 4 s in a 6 s timeline
  const tl = { fps, total: 180, scenes: [{ start: 0, dur: 180, lines: [{ start: 60, dur: 60 }] }] } as unknown as Parameters<typeof musicEnvelope>[0];
  const env = musicEnvelope(tl, 0.3, 0.3, 1, 2);
  const pts = simplify(env, 0.004);
  assert.ok(pts.length >= 6 && pts.length < 30, `${pts.length} points`);
  // Redrawing from the points stays within the tolerance everywhere
  for (let f = 0; f < env.length; f++) {
    const k = pts.findIndex((p) => p[0] >= f);
    const [x1, y1] = pts[Math.max(0, k)];
    const [x0, y0] = pts[Math.max(0, k - 1)];
    const y = x1 === x0 ? y1 : y0 + ((y1 - y0) * (f - x0)) / (x1 - x0);
    assert.ok(Math.abs(y - env[f]) <= 0.0041, `frame ${f}: ${y} vs ${env[f]}`);
  }
  // Ducked while the line plays, back up after the release
  assert.ok(env[90] < 0.1 && env[150] > env[90]);
});
