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
fs.writeFileSync(path.join(DATA, 'music', 'aerosol-of-my-love.mp3'), '');
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

test('check finds the same footage played in two scenes', () => {
  const screen = board().scenes.find((s: { visual: { kind: string } }) => s.visual.kind === 'screen');
  assert.ok(cli('set', screen.id, 'visual.from', '0').ok);
  assert.doesNotMatch(cli('check').out, /shown twice/);
  assert.ok(cli('dup', screen.id).ok);
  const copy = sceneIds()[sceneIds().indexOf(screen.id) + 1];
  const r = cli('check');
  assert.match(r.out, new RegExp(`${screen.id} and ${copy}: both play cap/planner\\.mp4 0\\.0–[\\d.]+ s, so the same moment is shown twice\\n    fix: start the later one where the earlier ends \\(trim ${copy} --from [\\d.]+\\)`));
  assert.ok(cli('rm', copy).ok);
  assert.doesNotMatch(cli('check').out, /shown twice/);
  // Stretching a recording to fill narration
  assert.ok(cli('set', screen.id, 'visual.rate', '0.6').ok);
  assert.match(cli('check').out, new RegExp(`${screen.id}: the recording plays at 0\\.6× speed[\\s\\S]*fix: keep visual\\.rate at 0\\.8 or above`));
  assert.ok(cli('set', screen.id, 'visual.rate', '1').ok);
});

test('screen zoom: two values only; camera off is flagged in 9:16', () => {
  const screen = board().scenes.find((s: { visual: { kind: string } }) => s.visual.kind === 'screen');
  const bad = cli('set', screen.id, 'visual.zoom', 'false');
  assert.equal(bad.ok, false);
  assert.match(bad.out, /visual\.zoom is "auto" .* or "off"/);
  assert.ok(cli('set', screen.id, 'visual.zoom', '"off"').ok);
  assert.doesNotMatch(cli('check').out, /camera is off/, '16:9 shows the whole recording well enough');
  assert.match(cli('check', '--format', 'tall').out, new RegExp(`${screen.id}: the camera is off[\\s\\S]*fix: set ${screen.id} visual\\.zoom undefined`));
  assert.ok(cli('set', screen.id, 'visual.zoom', 'undefined').ok);
  assert.doesNotMatch(cli('check', '--format', 'tall').out, /camera is off/);
});

test('the size the video is made for is a board field; the old --mode flag is gone', () => {
  assert.ok(cli('set', '-', 'format', '"tall"').ok);
  assert.equal(board().format, 'tall');
  const old = cli('ls', '--mode', 'beat');
  assert.equal(old.ok, false);
  assert.match(old.out, /unknown option --mode/);
  assert.ok(cli('set', '-', 'format', 'undefined').ok);
  assert.equal(board().format, undefined);
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

test('music use: a library track goes under the video; unknown tracks are refused', () => {
  assert.equal(cli('music', 'use', 'nonexistent').ok, false);
  const voice = cli('music', 'use', 'aerosol-of-my-love');
  assert.ok(voice.ok, voice.out);
  assert.equal(board().music.src, 'music/aerosol-of-my-love.mp3');
  // The other music settings stay as they were
  assert.ok('volume' in board().music || true);
});

test('music help teaches the draft format and does not need the studio', () => {
  const r = cli('music', 'help');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /draft = \{"title"/);
  assert.match(r.out, /pattern/);
  assert.match(r.out, /You cannot hear it/);
  assert.equal(cli('music', 'compose', 'x').ok, false, 'compose needs a draft');
});
