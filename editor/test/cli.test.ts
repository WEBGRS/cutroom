import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The CLI the AI uses, run against a throwaway data folder built from the fixtures
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-cli-'));
fs.cpSync(path.resolve('editor/test/fixtures/showcase'), path.join(DATA, 'demo'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'music'), { recursive: true });
fs.copyFileSync(path.resolve('editor/test/fixtures/music/aerosol-of-my-love.beats.json'), path.join(DATA, 'music', 'aerosol-of-my-love.beats.json'));
fs.writeFileSync(path.join(DATA, 'music', 'aerosol-of-my-love.mp3'), '');
fs.writeFileSync(path.join(DATA, 'music', 'no-beats.mp3'), '');
const board = () => JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'storyboard.json'), 'utf8'));
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, [path.resolve('editor/dist/cli.mjs'), 'demo', ...args], { env: { ...process.env, VS_DATA: DATA }, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
};
const sceneIds = () => board().scenes.map((s: { id: string }) => s.id);

test('show takes several scenes, or all of them', () => {
  const [a, b] = sceneIds();
  const two = cli('show', a, b);
  assert.ok(two.ok);
  assert.match(two.out, new RegExp(`== ${a}`));
  assert.match(two.out, new RegExp(`== ${b}`));
  assert.equal((cli('show', 'all').out.match(/^== /gm) ?? []).length, sceneIds().length);
});

test('check lists problems with the command that fixes them', () => {
  const screen = board().scenes.find((s: { visual: { kind: string } }) => s.visual.kind === 'screen');
  assert.ok(screen, 'fixture has a screen recording');
  assert.ok(cli('set', screen.id, `overlays.${(screen.overlays ?? []).length}`, JSON.stringify({ kind: 'text', at: 0.2, text: 'Title on a recording' })).ok);
  assert.ok(cli('set', screen.id, 'lines.0.zh', JSON.stringify('这一句字幕写得特别特别长，长到一行字幕根本放不下还要继续往下写')).ok);
  // Start late in the recording so it runs out before the narration does
  const cap = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'cap', 'planner.json'), 'utf8'));
  assert.ok(cli('set', screen.id, 'visual.from', String(cap.duration - 1)).ok);
  const r = cli('check');
  assert.ok(r.ok);
  assert.match(r.out, /may not read on bright frames[\s\S]*fix: set .* overlays\.\d+\.plate true/);
  assert.match(r.out, /characters on one caption/);
  assert.match(r.out, /recording runs out [\d.]+ s before the scene ends/);
  assert.match(r.out, /without current audio[\s\S]*fix: voice/);
  assert.match(r.out, /media file media\/lake\.jpg is missing/);
});

test('beat cut: tempo comes from beat data, guesses are refused', () => {
  const bad = cli('set', '-', 'beat', '{"bpm":120}');
  assert.equal(bad.ok, false);
  assert.match(bad.out, /beat\.bpm is not a setting/);
  const none = cli('beat', 'use', 'no-beats.mp3');
  assert.equal(none.ok, false);
  assert.match(none.out, /aerosol-of-my-love\.mp3\s+\d+ BPM/);
  const use = cli('beat', 'use', 'aerosol-of-my-love.mp3', '--bar', '2');
  assert.ok(use.ok, use.out);
  assert.equal(board().beat.music, 'music/aerosol-of-my-love.mp3');
  assert.equal(board().beat.startBar, 2);
  assert.match(cli('beat').out, /music\/aerosol-of-my-love\.mp3, \d+ BPM from its beat data, starting at bar 2/);
  // A stray field from an older guess is dropped on the next beat change
  const b = board();
  b.beat.bpm = 128;
  fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify(b, null, 2));
  assert.ok(cli('set', '-', 'beat.startBar', '1').ok);
  assert.equal(board().beat.bpm, undefined);
  assert.equal(board().beat.startBar, 1);
});

test('trim reports the stored mark and when narration holds the scene longer', () => {
  const screen = board().scenes.find((s: { visual: { kind: string } }) => s.visual.kind === 'screen');
  const cap = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'cap', 'planner.json'), 'utf8'));
  const mark = cap.events.find((e: { type: string }) => e.type === 'mark');
  assert.ok(cli('set', screen.id, 'visual.from', '0').ok);
  const r = cli('trim', screen.id, '--to', `@${mark.name}+0.1`);
  assert.ok(r.ok, r.out);
  assert.match(r.out, new RegExp(`→ @${mark.name}\\+0\\.1`));
  assert.match(r.out, /narration needs [\d.]+ s, so the recording keeps playing/);
});
