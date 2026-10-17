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
  for (let i = 1; i <= 2; i++) {
    const r = run('review', 'log', 'revise\nscope: sample intro\n1. intro caption — move it');
    assert.ok(r.out.includes(`sample round ${i} (self-review)`), r.out);
    assert.doesNotMatch(r.out, /rounds reached/);
    if (i < 2) assert.doesNotMatch(r.out, /2 sample rounds done/);
    else assert.match(r.out, /2 sample rounds done: stop fixing, flow wait sample \(or flow stage full when there is no sample checkpoint\) and list what is left in your reply/);
  }
  const third = run('review', 'log', 'revise\nscope: sample intro\n1. intro caption — move it');
  assert.ok(!third.ok, 'a third sample round is over the limit');
  assert.match(third.out, /the sample already had 2 review rounds, the limit at tier 1/);
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
  assert.ok(!run('review', 'log', 'revise\nscope: whole cut\n1. x').ok, 'no fourth final round');
  const log = fs.readFileSync(path.join(DATA, 'phases', 'review', 'log.md'), 'utf8');
  assert.match(log, /## Round 2 · sample · self-review/);
  assert.doesNotMatch(log, /## Round 3 · sample/);
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
  assert.match(r.out, /The panel shows the verdict and these problems under your reply: don't repeat them\.$/m);
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

test('flow start takes a tier; a tier without a sample turns plan+sample into plan', () => {
  project('tierstart');
  const run = (...a: string[]) => cliIn('tierstart', a);
  assert.ok(!run('flow', 'start', 'none', '9').ok);
  const r = run('flow', 'start', 'plan+sample', '4');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /tier 4 has no sample, so the mode is plan/);
  assert.equal(board('tierstart').workflow.tier, 4);
  assert.equal(board('tierstart').workflow.gates, 'plan');
  const shown = run('flow').out;
  assert.match(shown, /mode plan · tier 4 lean · stage brief \(1\/8\)/);
  assert.match(shown, /review rounds: batch 0, final 0 of 1/);
  assert.match(shown, /Stage brief \(tier 4: short brief\)/);
  project('tier1');
  assert.ok(cliIn('tier1', ['flow', 'start', 'plan']).ok);
  assert.equal('tier' in board('tier1').workflow, false, 'tier 1 is the default and is not stored');
});

test('one-plan, text-only tiers refuse plans b and c and previews; tier 2 refuses motion clips', () => {
  project('tierplans', { gates: 'none', tier: 4, stage: 'plans', passed: [] });
  const run = (...a: string[]) => cliIn('tierplans', a);
  const b = run('plans', 'write', 'b', '# Plan B: x');
  assert.ok(!b.ok);
  assert.match(b.out, /tier 4 makes one plan: plans write a/);
  assert.ok(run('plans', 'write', 'a', '# Plan A: Calm\nOne sentence.').ok);
  assert.match(run('plans', 'preview', 'a', '{"visual":{"kind":"title"}}').out, /tier 4 plans are text only: no previews/);
  assert.ok(!run('flow', 'choose', 'b').ok);
  assert.doesNotMatch(run('plans').out, /^b:/m);
  project('tier2plans', { gates: 'none', tier: 2, stage: 'plans', passed: [] });
  const m = cliIn('tier2plans', ['plans', 'preview', 'a', '{"visual":{"kind":"title"}}', '--motion', '3']);
  assert.ok(!m.ok);
  assert.match(m.out, /tier 2 previews are stills: leave out --motion/);
});

test('tiers without a sample go from table to full; a short brief needs three blocks', () => {
  project('tiernos', { gates: 'none', tier: 5, stage: 'table', passed: [] });
  const run = (...a: string[]) => cliIn('tiernos', a);
  assert.match(run('flow').out, /Then: flow stage full\./);
  const s = run('flow', 'stage', 'sample');
  assert.ok(!s.ok);
  assert.match(s.out, /tier 5 has no sample stage: after table comes full/);
  assert.ok(run('flow', 'stage', 'full').ok);
  const brief = run('brief', 'write', '<inputs>\nLength: 30 s\nfeatures:\n- search\nterms:\n- Cutroom\ndata:\n- all public\n</inputs>\n<direction>why</direction>\n<structure>a, b</structure>');
  assert.match(brief.out, /nothing missing/);
});

test('review rounds follow the tier: no reviewer where the tier has none, one final round, and a self-check at tier 5', () => {
  project('tier3s', { gates: 'none', tier: 3, stage: 'sample', passed: [] });
  const s3 = cliIn('tier3s', ['review', 'run']);
  assert.ok(!s3.ok);
  assert.match(s3.out, /tier 3 checks the sample without a reviewer/);
  project('tier2f', { gates: 'none', tier: 2, stage: 'full', passed: [] });
  assert.match(cliIn('tier2f', ['review', 'run']).out, /tier 2 runs no reviewer during full/);
  assert.ok(cliIn('tier2f', ['review', 'log', 'ready\nscope: batch']).ok, 'a batch self-check is still saved');
  project('tier4r', { gates: 'none', tier: 4, stage: 'review', passed: [] });
  const r4 = cliIn('tier4r', ['review', 'log', 'revise\nscope: whole cut\n1. intro caption — move it\n2. outro too short']);
  assert.ok(r4.ok, r4.out);
  assert.match(r4.out, /tier 4 has one final review: fix what it lists/);
  assert.match(cliIn('tier4r', ['review', 'run']).out, /1 final round done, the limit at tier 4/);
  const done = cliIn('tier4r', ['flow', 'stage', 'done']);
  assert.match(done.out, /The final review listed these/);
  assert.match(done.out, /Name in one sentence the ones you fixed after the review/);
  project('tier5r', { gates: 'none', tier: 5, stage: 'review', passed: [] });
  assert.match(cliIn('tier5r', ['flow']).out, /hard failures only/);
  const r5 = cliIn('tier5r', ['review', 'log', 'revise\nscope: contact sheet\n1. outro shows an email']);
  assert.match(r5.out, /fix only these hard failures/);
  assert.ok(!cliIn('tier5r', ['review', 'log', 'ready\nscope: again']).ok, 'one round at tier 5');
  project('waitfb', { gates: 'plan+sample', tier: 2, stage: 'sample', waiting: 'sample', passed: ['plan'] });
  assert.ok(cliIn('waitfb', ['review', 'log', 'revise\nscope: sample\n1. x']).ok);
  assert.ok(cliIn('waitfb', ['review', 'log', 'revise\nscope: sample\n1. x']).ok, "the user's feedback at a checkpoint is not limited");
});

test('tiers 3–5 limit look and review renders per stage; feedback at a checkpoint is not limited', () => {
  project('budget', { gates: 'none', tier: 5, stage: 'full', passed: [] });
  const count = path.join(DATA, '.editor', 'budget', 'looks.json');
  fs.mkdirSync(path.dirname(count), { recursive: true });
  fs.writeFileSync(count, JSON.stringify({ stage: 'full', n: 4 }));
  for (const args of [['look', 'lines'], ['look', 'intro'], ['review']]) {
    const r = cliIn('budget', args);
    assert.ok(!r.ok, args.join(' '));
    assert.match(r.out, /tier 5 allows 4 look renders per stage and full has used them: stop tuning/, args.join(' '));
  }
});

test('look lines checks only the scenes named and refuses unknown ones', () => {
  const r = cli('look', 'lines', 'nope');
  assert.ok(!r.ok);
  assert.match(r.out, /no scene nope/);
});
