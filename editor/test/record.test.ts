import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-rec-'));
process.env.VS_DATA = DATA;
fs.mkdirSync(path.join(DATA, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify({ slug: 'demo', title: 'Demo', theme: { accent: '#3b6ef5', bg: ['#000', '#111'] }, scenes: [] }));
const R = await import('../src/record');

test('record steps: one known action each, with the right kind of value', () => {
  const ok = R.parseSteps([{ wait: 500 }, { click: '#add' }, { fill: ['#q', 'hi'] }, { press: 'Enter' }, { mark: 'done' }, { zoom: '#q', scale: 2 }, { unzoom: true }, { scroll: -300, ms: 600 }]);
  assert.equal(ok.length, 8);
  assert.throws(() => R.parseSteps({ wait: 1 }), /JSON array/);
  assert.throws(() => R.parseSteps([{ wait: 1, click: '#a' }]), /exactly one/);
  assert.throws(() => R.parseSteps([{ tap: '#a' }]), /exactly one/);
  assert.throws(() => R.parseSteps([{ wait: '1s' }]), /bad value for "wait"/);
  assert.throws(() => R.parseSteps([{ fill: '#q' }]), /bad value for "fill"/);
});

test('records a local page with clicks, typing and marks', { skip: !R.findBrowser() && 'no Chrome or Edge', timeout: 120_000 }, async () => {
  const site = path.join(DATA, 'site.html');
  fs.writeFileSync(site, '<!doctype html><body style="font:20px sans-serif"><input id="q"><button id="go" onclick="document.body.append(\'added\')">Add</button></body>');
  const r = await R.recordPage({ slug: 'demo', name: 'Unit Test!', url: pathToFileURL(site).href, steps: [{ mark: 'start' }, { fill: ['#q', 'abc'] }, { click: 'text="Add"' }, { mark: 'end-ish' }, { wait: 300 }], size: { width: 640, height: 360 } });
  assert.equal(r.file, 'cap/unit-test.mp4');
  assert.ok(fs.statSync(path.join(DATA, 'demo', 'cap', 'unit-test.mp4')).size > 1000);
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'cap', 'unit-test.json'), 'utf8'));
  assert.deepEqual(r.marks.map((m) => m.name), ['start', 'end-ish']);
  assert.ok(meta.events.some((e: { type: string }) => e.type === 'down'), 'click logged');
  assert.ok(meta.events.filter((e: { type: string }) => e.type === 'key').length >= 3, 'typing logged');
  assert.ok(r.duration > 1 && r.duration < 10, `duration ${r.duration}`);
});

test('a recording keeps its steps, and rerecord makes it again after the page changes', { skip: !R.findBrowser() && 'no Chrome or Edge', timeout: 180_000 }, async () => {
  const site = path.join(DATA, 'site2.html');
  fs.writeFileSync(site, '<!doctype html><body style="font:20px sans-serif"><button id="go">Old label</button></body>');
  const steps = [{ mark: 'open' }, { click: '#go' }, { mark: 'clicked' }, { wait: 300 }];
  await R.recordPage({ slug: 'demo', name: 'again', url: pathToFileURL(site).href, steps, size: { width: 640, height: 360 } });
  const recipe = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'cap', 'again.recipe.json'), 'utf8'));
  assert.deepEqual(recipe.steps, steps);
  assert.deepEqual(R.readRecipes('demo').map((x) => x.name).sort(), ['again', 'unit-test']);
  // The site changes; the same steps record it again with the same marks
  fs.writeFileSync(site, '<!doctype html><body style="font:20px sans-serif;background:#eef"><button id="go">New label</button></body>');
  const old = fs.statSync(path.join(DATA, 'demo', 'cap', 'again.mp4')).mtimeMs;
  const r = await R.rerecord('demo', 'again', () => undefined);
  assert.deepEqual(r.marks.map((m) => m.name), ['open', 'clicked']);
  assert.deepEqual(r.lost, []);
  assert.ok(fs.statSync(path.join(DATA, 'demo', 'cap', 'again.mp4')).mtimeMs > old);
  // Steps that no longer work leave the old footage in place
  fs.writeFileSync(site, '<!doctype html><body>no button now</body>');
  const before = fs.readFileSync(path.join(DATA, 'demo', 'cap', 'again.mp4'));
  const recipeFile = path.join(DATA, 'demo', 'cap', 'again.recipe.json');
  fs.writeFileSync(recipeFile, JSON.stringify({ ...recipe, steps: [{ click: '#go' }] }));
  await assert.rejects(() => R.rerecord('demo', 'again', () => undefined), /nothing matches #go/);
  assert.ok(fs.readFileSync(path.join(DATA, 'demo', 'cap', 'again.mp4')).equals(before), 'old footage restored');
  await assert.rejects(() => R.rerecord('demo', 'nope', () => undefined), /has no recipe/);
});
