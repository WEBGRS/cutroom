import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-flowcli-'));
fs.cpSync(path.resolve('editor/test/fixtures/showcase'), path.join(DATA, 'demo'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'music'), { recursive: true });
const board = (slug = 'demo') => JSON.parse(fs.readFileSync(path.join(DATA, slug, 'storyboard.json'), 'utf8'));
const cliIn = (slug: string, args: string[], input?: string) => {
  const r = spawnSync(process.execPath, [path.resolve('editor/dist/cli.mjs'), slug, ...args], { env: { ...process.env, VS_DATA: DATA }, encoding: 'utf8', input });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
};
const cli = (...args: string[]) => cliIn('demo', args);
// A second project from the fixture, with a workflow written directly
const project = (slug: string, wf?: object) => {
  fs.rmSync(path.join(DATA, slug), { recursive: true, force: true });
  fs.cpSync(path.resolve('editor/test/fixtures/showcase'), path.join(DATA, slug), { recursive: true });
  const b = board(slug);
  fs.writeFileSync(path.join(DATA, slug, 'storyboard.json'), JSON.stringify({ ...b, slug, ...(wf ? { workflow: wf } : {}) }, null, 2));
};

test('flow without a workflow says how to start', () => {
  const r = cli('flow');
  assert.ok(r.ok);
  assert.match(r.out, /no workflow/);
});

test('flow start, stage moves and the plan checkpoint', () => {
  assert.ok(cli('flow', 'start', 'plan+sample').ok);
  assert.equal(board().workflow.stage, 'brief');
  assert.match(cli('flow').out, /Stage brief\./);
  assert.ok(cli('flow', 'stage', 'plans').ok);
  const refused = cli('flow', 'stage', 'script');
  assert.ok(!refused.ok);
  assert.match(refused.out, /plan checkpoint is not passed/);
  const waited = cli('flow', 'wait', 'plan');
  assert.ok(waited.ok);
  assert.match(waited.out, /^waiting at the plan checkpoint {2}\[/m);
  assert.match(waited.out, /^End your turn now/m);
  assert.equal(board().workflow.waiting, 'plan');
  const shown = cli('flow').out;
  assert.match(shown, /WAITING/);
  assert.match(shown, /feedback on it[\s\S]*Stage plans\./, 'the waiting note, then the stage contract');
  assert.ok(!cli('flow', 'start', 'none').ok, 'a running workflow is not restarted');
});

test('the CLI can never pass a checkpoint', () => {
  for (const args of [
    ['set', '-', 'workflow.passed', '["plan"]'],
    ['set', '-', '.workflow.passed', '["plan"]'],
    ['set', '-', 'workflow', '{}'],
  ]) {
    const r = cli(...args);
    assert.ok(!r.ok, args.join(' '));
    assert.match(r.out, /only through flow commands/, args.join(' '));
  }
  assert.deepEqual(board().workflow.passed, []);
});

test('brief write reports what is missing', () => {
  const r = cli('brief', 'write', '<role>x</role>\nfeatures:\n- search');
  assert.ok(r.ok);
  assert.match(r.out, /missing: .*<inputs>.*terms: list/);
  assert.match(r.out, /a line "terms:" then one "- item" line per item/);
  assert.match(cli('brief').out, /features:/);
});

test('brief write and plans write take - for stdin or a path to a file', () => {
  project('long');
  const r = cliIn('long', ['brief', 'write', '-'], '<role>from stdin</role>\nfeatures:\n\n- search\n');
  assert.ok(r.ok, r.out);
  assert.match(fs.readFileSync(path.join(DATA, 'long', 'brief.md'), 'utf8'), /from stdin/);
  assert.doesNotMatch(r.out, /features: list/, 'blank line before the items is fine');
  const f = path.join(DATA, 'plan-b-draft.md');
  fs.writeFileSync(f, '# Plan B: From a file\n\nWritten elsewhere.');
  assert.ok(cliIn('long', ['plans', 'write', 'b', f]).ok);
  assert.match(fs.readFileSync(path.join(DATA, 'long', 'plans', 'plan-b.md'), 'utf8'), /From a file/);
  assert.ok(cliIn('long', ['plans', 'write', 'c', '-'], '# Plan C: Piped').ok);
  assert.match(cliIn('long', ['plans']).out, /c: Piped/);
  assert.ok(!cliIn('long', ['brief', 'write', '-'], '  ').ok, 'empty stdin is refused');
});

test('- with stdin closed is an empty-text error, not a hang', () => {
  project('eof');
  const t = Date.now();
  const r = cliIn('eof', ['brief', 'write', '-'], '');
  assert.ok(!r.ok);
  assert.match(r.out, /the text is empty/);
  assert.ok(Date.now() - t < 15000, 'returned quickly');
  assert.ok(cliIn('eof', ['brief', 'write', '-'], '<role>x</role>').ok);
  assert.match(fs.readFileSync(path.join(DATA, 'eof', 'brief.md'), 'utf8'), /<role>x<\/role>/);
});

test('file paths are read only from the project folder or the temp folder', () => {
  project('paths');
  const tmpFile = path.join(os.tmpdir(), `cutroom-plan-${process.pid}.md`);
  fs.writeFileSync(tmpFile, '# Plan A: From temp\n\nok');
  assert.ok(cliIn('paths', ['plans', 'write', 'a', tmpFile]).ok);
  assert.match(fs.readFileSync(path.join(DATA, 'paths', 'plans', 'plan-a.md'), 'utf8'), /From temp/);
  fs.rmSync(tmpFile);
  const outside = path.resolve('package.json');
  assert.ok(fs.existsSync(outside));
  const r = cliIn('paths', ['plans', 'write', 'b', outside]);
  assert.ok(!r.ok);
  assert.match(r.out, /file paths must be inside the project folder or the temp folder/);
  assert.ok(!fs.existsSync(path.join(DATA, 'paths', 'plans', 'plan-b.md')));
});

test('plans write and list', () => {
  assert.ok(cli('plans', 'write', 'a', '# Plan A: Calm tour\n\nOne take through the site.').ok);
  const r = cli('plans');
  assert.match(r.out, /a: Calm tour — One take through the site\./);
  assert.match(r.out, /b: —/);
  assert.ok(!cli('plans', 'write', 'd', 'x').ok);
});

test('plan shows role and intent and flags gaps in a workflow project', () => {
  const ids = board().scenes.map((s: { id: string }) => s.id);
  assert.ok(cli('set', ids[0], 'role', 'a').ok);
  assert.ok(cli('set', ids[0], 'intent', 'search finds the course').ok);
  assert.ok(cli('brief', 'write', '<role>x</role>\nfeatures:\n- search\n- zebra export').ok);
  const r = cli('plan');
  assert.match(r.out, new RegExp(`role:\\s+a`));
  assert.match(r.out, /intent: search finds the course/);
  assert.match(r.out, /no role or intent/);
  assert.match(r.out, /must-show feature without a scene: zebra export/);
  assert.doesNotMatch(r.out, /without a scene: search\b/);
});

test('review log saves a self-review round on the workflow', () => {
  const r = cli('review', 'log', 'revise\nscope: sample intro\nscores: P 8 Q 6\n1. intro 0:02 caption covers the field — move it');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /round 1 \(self-review\): revise, 1 problem/);
  const wf = board().workflow;
  assert.equal(wf.review.round, 1);
  assert.equal(wf.review.by, 'self');
  assert.equal(wf.review.scores.Q, 6);
  assert.equal(wf.review.phase, 'batch');
  assert.match(fs.readFileSync(path.join(DATA, 'demo', 'review', 'log.md'), 'utf8'), /## Round 1 · batch · self-review/);
});

test('sample rounds do not use up the three final rounds; going back to brief archives the log', () => {
  project('phases');
  const run = (...a: string[]) => cliIn('phases', a);
  assert.ok(run('flow', 'start', 'none').ok);
  assert.ok(run('flow', 'stage', 'sample').ok);
  for (let i = 1; i <= 3; i++) {
    const r = run('review', 'log', 'revise\nscope: sample intro\n1. intro caption — move it');
    assert.ok(r.out.includes(`sample round ${i} (self-review)`), r.out);
    assert.doesNotMatch(r.out, /rounds reached/);
    if (i < 2) assert.doesNotMatch(r.out, /2 sample rounds done/);
    else assert.match(r.out, /2 sample rounds done: stop fixing, flow wait sample \(or flow stage full when there is no sample checkpoint\) and list what is left in your reply/);
  }
  assert.equal(board('phases').workflow.review.phase, 'sample');
  assert.ok(run('flow', 'stage', 'full').ok);
  for (let i = 1; i <= 4; i++) {
    const r = run('review', 'log', 'revise\nscope: batch\n1. intro caption — move it');
    assert.ok(r.out.includes(`batch round ${i} (self-review)`), r.out);
    assert.doesNotMatch(r.out, /rounds (reached|done)/);
  }
  assert.ok(run('flow', 'stage', 'review').ok);
  for (let i = 1; i <= 3; i++) {
    const r = run('review', 'log', 'revise\nscope: whole cut\n1. intro caption — move it');
    assert.ok(r.out.includes(`final round ${i} (self-review)`), r.out);
    if (i < 3) assert.doesNotMatch(r.out, /rounds reached/);
    else assert.match(r.out, /3 final rounds reached/);
  }
  const log = fs.readFileSync(path.join(DATA, 'phases', 'review', 'log.md'), 'utf8');
  assert.match(log, /## Round 3 · sample · self-review/);
  assert.match(log, /## Round 3 · final · self-review/);
  assert.match(log, /## Round 4 · batch · self-review/);
  const back = run('flow', 'stage', 'brief');
  assert.ok(back.ok, back.out);
  assert.match(back.out, /archived/);
  assert.ok(!fs.existsSync(path.join(DATA, 'phases', 'review', 'log.md')));
  assert.equal(fs.readdirSync(path.join(DATA, 'phases', 'review')).filter((f) => /^log-.+\.md$/.test(f)).length, 1);
  assert.equal(board('phases').workflow.review, undefined);
  assert.match(run('review', 'log', 'ready\nscope: whole cut').out, /batch round 1/);
  assert.ok(run('flow', 'stage', 'done').ok);
  assert.ok(run('flow', 'start', 'plan').ok);
  assert.ok(!fs.existsSync(path.join(DATA, 'phases', 'review', 'log.md')), 'a new start archives the log too');
});

test('flow stage done after a revise verdict prints its verdict, scope and first 3 problems', () => {
  project('donerev');
  const run = (...a: string[]) => cliIn('donerev', a);
  assert.ok(run('flow', 'start', 'none').ok);
  assert.ok(run('flow', 'stage', 'review').ok);
  assert.ok(run('review', 'log', 'revise\nscope: whole cut\n1. intro caption covers the click\n2. window too small\n3. cut is 34 s\n4. fourth one').ok);
  const r = run('flow', 'stage', 'done');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /revise/);
  assert.match(r.out, /whole cut/);
  assert.match(r.out, /1\. intro caption covers the click/);
  assert.match(r.out, /3\. cut is 34 s/);
  assert.doesNotMatch(r.out, /fourth one/);
  assert.match(r.out, /Say in your reply that the reviewer still asks for these, and list them/);
  project('donerdy');
  const q = (...a: string[]) => cliIn('donerdy', a);
  assert.ok(q('flow', 'start', 'none').ok && q('flow', 'stage', 'review').ok);
  assert.ok(q('review', 'log', 'ready\nscope: whole cut').ok);
  assert.doesNotMatch(q('flow', 'stage', 'done').out, /still asks/);
});

test('plan notes a cut more than 10% off the brief length', () => {
  project('lenchk');
  const run = (...a: string[]) => cliIn('lenchk', a);
  assert.ok(run('flow', 'start', 'none').ok);
  const total = Number(/— ([\d.]+) s @/.exec(run('ls').out)![1]);
  const brief = (n: number) => run('brief', 'write', `<role>x</role>
<inputs>
Length: about ${n} seconds
</inputs>`);
  brief(Math.round(total));
  assert.doesNotMatch(run('plan').out, /the brief asks for/);
  brief(Math.round(total * 2));
  assert.match(run('plan').out, new RegExp(`! the cut is ${total.toFixed(1)} s, the brief asks for ${Math.round(total * 2)} s: trim or merge scenes`));
});

test('a shot-table fix in place keeps the project at review with its checkpoints passed', () => {
  project('inplace', { gates: 'plan+sample', stage: 'review', passed: ['plan', 'sample'], choice: 'a' });
  const id = board('inplace').scenes[0].id;
  assert.ok(cliIn('inplace', ['set', id, 'intent', 'search finds the course']).ok);
  const wf = board('inplace').workflow;
  assert.equal(wf.stage, 'review');
  assert.deepEqual(wf.passed, ['plan', 'sample']);
  assert.match(cliIn('inplace', ['flow']).out, /in place with set/);
});

test('flow choose records the plan in mode none and is refused where the user picks it', () => {
  project('choose');
  const run = (...a: string[]) => cliIn('choose', a);
  assert.ok(run('flow', 'start', 'none').ok);
  assert.ok(run('flow', 'stage', 'plans').ok);
  assert.ok(!run('flow', 'choose', 'b').ok, 'no plan b written yet');
  assert.ok(run('plans', 'write', 'b', '# Plan B: Pixel tour').ok);
  assert.ok(!run('flow', 'choose', 'd').ok);
  const r = run('flow', 'choose', 'b');
  assert.ok(r.ok, r.out);
  assert.equal(board('choose').workflow.choice, 'b');
  project('choose2', { gates: 'plan', stage: 'plans', passed: [] });
  assert.ok(cliIn('choose2', ['plans', 'write', 'a', '# Plan A: Calm']).ok);
  const refused = cliIn('choose2', ['flow', 'choose', 'a']);
  assert.ok(!refused.ok);
  assert.match(refused.out, /picks the plan in the panel/);
});
