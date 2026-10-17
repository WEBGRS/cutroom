import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewFrames } from '../src/reviewframes';
import { tile } from '../src/sheets';
import { findBrowser } from '../src/record';

// Three scenes at 30 fps: a 0–90, b 90–180, c 180–300
const S = [
  { id: 'a', start: 0, dur: 90 },
  { id: 'b', start: 90, dur: 90 },
  { id: 'c', start: 180, dur: 120 },
];

test('whole cut: the middle of each scene and both sides of every cut', () => {
  const r = reviewFrames(S, 300, 30, []);
  assert.deepEqual(r.frames.map((f) => f.f), [45, 87, 96, 135, 177, 186, 240]);
  assert.match(r.frames[1].label, /a\|b −0\.1 s/);
  assert.match(r.scope, /whole cut: 3 scene middles, 2 cuts/);
});

test('named scenes: only those and their cuts', () => {
  const r = reviewFrames(S, 300, 30, ['a']);
  assert.deepEqual(r.frames.map((f) => f.f), [45, 87, 96]);
  assert.match(r.scope, /scenes a/);
  assert.throws(() => reviewFrames(S, 300, 30, ['zz']), /no scene zz/);
});

test('time ranges: a frame every 0.5 s', () => {
  const r = reviewFrames(S, 300, 30, ['2-3']);
  assert.deepEqual(r.frames.map((f) => f.f), [60, 75, 90]);
  assert.match(r.scope, /2–3 s/);
});

test('long cuts are thinned to 48 frames and say so', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, start: i * 60, dur: 60 }));
  const r = reviewFrames(many, 2400, 30, []);
  assert.equal(r.frames.length, 48);
  assert.ok(r.dropped > 0);
});

test('tile joins images into one jpeg', async (t) => {
  if (!findBrowser()) return t.skip('no Chrome/Edge here');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-tile-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const files = [1, 2, 3].map((i) => path.join(dir, `${i}.png`));
  for (const f of files) fs.writeFileSync(f, png);
  const out = path.join(dir, 'sheet.jpeg');
  assert.ok(await tile(files, ['1', '2', '3'], out, 64, 2));
  const b = fs.readFileSync(out);
  assert.equal(b[0], 0xff);
  assert.equal(b[1], 0xd8);
});
