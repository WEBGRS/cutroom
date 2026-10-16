import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { list, noteOutside, rollback, take, type Place } from '../src/checkpoints';

// A project folder, its checkpoint store and a file outside the project, all in a temp folder
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-cp-'));
  const p: Place = { project: path.join(root, 'proj'), dir: path.join(root, 'state', 'checkpoints') };
  fs.mkdirSync(path.join(p.project, 'media'), { recursive: true });
  fs.writeFileSync(path.join(p.project, 'storyboard.json'), '{"v":1}');
  fs.writeFileSync(path.join(p.project, 'media', 'a.png'), 'png-1');
  const out = path.join(root, 'elsewhere', 'notes.txt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, 'outside-1');
  return { p, out, read: (rel: string) => fs.readFileSync(path.join(p.project, rel), 'utf8') };
}

test('rollback puts project files back, removes new ones and restores outside files; it can be undone', async () => {
  const { p, out, read } = setup();
  const cp = await take(p, 'make it warm');
  // What the assistant does during that message
  fs.writeFileSync(path.join(p.project, 'storyboard.json'), '{"v":2}');
  fs.rmSync(path.join(p.project, 'media', 'a.png'));
  fs.mkdirSync(path.join(p.project, 'scenes', 'x'), { recursive: true });
  fs.writeFileSync(path.join(p.project, 'scenes', 'x', 'index.html'), '<div>');
  await noteOutside(p, out);
  fs.writeFileSync(out, 'outside-2');
  const created = path.join(path.dirname(out), 'new.txt');
  await noteOutside(p, created);
  fs.writeFileSync(created, 'made by the AI');

  const r = await rollback(p, cp.id);
  assert.equal(read('storyboard.json'), '{"v":1}');
  assert.equal(read('media/a.png'), 'png-1');
  assert.equal(fs.existsSync(path.join(p.project, 'scenes')), false, 'new files and the folders they needed are gone');
  assert.equal(fs.readFileSync(out, 'utf8'), 'outside-1');
  assert.equal(fs.existsSync(created), false, 'a file the AI created outside is removed');
  assert.deepEqual([r.restored, r.removed, r.outside, r.missing], [2, 1, 2, []]);

  // Undo: back to how things were just before the rollback
  await rollback(p, r.undo);
  assert.equal(read('storyboard.json'), '{"v":2}');
  assert.equal(read('scenes/x/index.html'), '<div>');
  assert.equal(fs.existsSync(path.join(p.project, 'media', 'a.png')), false);
  assert.equal(fs.readFileSync(out, 'utf8'), 'outside-2');
  assert.equal(fs.readFileSync(created, 'utf8'), 'made by the AI');
});

test('checkpoints store each version once and skip files inside the project as outside files', async () => {
  const { p } = setup();
  await take(p, 'one');
  await take(p, 'two');
  const objects = fs.readdirSync(path.join(p.dir, 'objects'));
  assert.equal(objects.length, 2, 'unchanged files are not copied again');
  await noteOutside(p, path.join(p.project, 'storyboard.json'));
  assert.deepEqual(list(p).at(-1)!.outside, []);
  await assert.rejects(rollback(p, 'nope'), /no longer kept/);
});
