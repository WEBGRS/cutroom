import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, blocked, choose, contentKey, describe, gatesFor, moveTo, newWorkflow, pass, pausedLine, phaseOf, setMode, wait } from '../src/flow';
import { guide } from '../src/flowguide';
import type { Storyboard } from '../../src/lib/types';

test('modes decide the checkpoints', () => {
  assert.deepEqual(gatesFor('plan+sample'), ['plan', 'sample']);
  assert.deepEqual(gatesFor('plan'), ['plan']);
  assert.deepEqual(gatesFor('none'), []);
  assert.equal(newWorkflow('plan').stage, 'brief');
});

test('a checkpoint blocks the stages after it until the panel passes it', () => {
  let wf = moveTo(newWorkflow('plan+sample'), 'plans');
  assert.match(blocked(wf, 'script') ?? '', /plan checkpoint is not passed/);
  assert.throws(() => moveTo(wf, 'script'), /plan checkpoint/);
  wf = wait(wf, 'plan');
  assert.equal(wf.waiting, 'plan');
  wf = pass(wf, 'plan', 'b');
  assert.equal(wf.stage, 'script');
  assert.equal(wf.choice, 'b');
  assert.equal(wf.waiting, undefined);
  wf = moveTo(moveTo(wf, 'table'), 'sample');
  assert.throws(() => moveTo(wf, 'full'), /sample checkpoint/);
  wf = pass(wait(wf, 'sample'), 'sample');
  assert.equal(wf.stage, 'full');
});

test('mode none never blocks and has nothing to wait for', () => {
  const wf = newWorkflow('none');
  assert.equal(blocked(wf, 'done'), null);
  assert.throws(() => wait(moveTo(wf, 'plans'), 'plan'), /no plan checkpoint/);
});

test('waiting is only allowed at the stage the checkpoint closes; pass needs a wait', () => {
  const wf = newWorkflow('plan');
  assert.throws(() => wait(wf, 'plan'), /closes the plans stage/);
  assert.throws(() => pass(moveTo(wf, 'plans'), 'plan'), /nothing is waiting/);
});

test('going back reopens later checkpoints', () => {
  let wf = pass(wait(moveTo(newWorkflow('plan+sample'), 'plans'), 'plan'), 'plan', 'a');
  wf = moveTo(wf, 'plans');
  assert.deepEqual(wf.passed, []);
  assert.throws(() => moveTo(wf, 'script'), /plan checkpoint/);
});

test('changing the mode ends a wait that no longer applies', () => {
  let wf = wait(moveTo(newWorkflow('plan+sample'), 'plans'), 'plan');
  wf = pass(wf, 'plan', 'a');
  wf = moveTo(wf, 'table');
  wf = moveTo(wf, 'sample');
  wf = wait(wf, 'sample');
  assert.equal(setMode(wf, 'plan').waiting, undefined);
  assert.equal(setMode(wf, 'plan+sample').waiting, 'sample');
});

test('switching to a mode with more checkpoints mid-build does not block the stages ahead', () => {
  const wf = moveTo(newWorkflow('none'), 'full');
  const wf2 = setMode(wf, 'plan+sample');
  assert.equal(blocked(wf2, 'sound'), null);
  assert.ok(wf2.passed?.includes('plan'));
  assert.ok(wf2.passed?.includes('sample'));
  const early = setMode(moveTo(newWorkflow('none'), 'plans'), 'plan');
  assert.ok(!early.passed?.includes('plan'));
});

test('a review is a sample round at sample, a final round at review, a batch check at every other stage', () => {
  const at = (st: Parameters<typeof moveTo>[1]) => phaseOf(moveTo(newWorkflow('none'), st));
  assert.equal(at('sample'), 'sample');
  assert.equal(at('review'), 'final');
  for (const st of ['brief', 'plans', 'script', 'table', 'full', 'sound'] as const) assert.equal(at(st), 'batch', st);
  assert.equal(phaseOf(undefined), 'final');
});

test('the sample is capped at 2 review rounds; full leaves independent reviews to the review stage', () => {
  assert.match(guide('sample', 'plan'), /at most 2 review rounds/);
  const full = guide('full', 'plan');
  assert.match(full, /review run is for the sample and the review stage/);
  assert.match(full, /look.*check.*review <ids>/s);
  assert.doesNotMatch(full, /then review run|run review run|, review run/i);
});

test('the table contract sizes the lines to the brief length; the review contract asks for the verdict in the reply', () => {
  assert.match(guide('table', 'none'), /length the brief asks for/);
  assert.match(guide('review', 'none'), /reply with the reviewer's verdict, what it looked at, and any problems left/);
});

test('going back to table after the sample pass reopens the sample checkpoint, so shot-table fixes are made in place', () => {
  let wf = pass(wait(moveTo(newWorkflow('plan+sample'), 'plans'), 'plan'), 'plan', 'a');
  wf = pass(wait(moveTo(moveTo(wf, 'table'), 'sample'), 'sample'), 'sample');
  wf = moveTo(moveTo(wf, 'sound'), 'review');
  assert.deepEqual(wf.passed, ['plan', 'sample']);
  const back = moveTo(wf, 'table');
  assert.deepEqual(back.passed, ['plan']);
  assert.match(blocked(back, 'full') ?? '', /sample checkpoint/);
  for (const s of ['review', 'full'] as const) {
    const g = guide(s, 'plan+sample');
    assert.match(g, /in place with set/, s);
    assert.match(g, /flow stage table only for structural changes/, s);
    assert.match(g, /reopens the sample checkpoint/, s);
  }
});

test('the AI records its plan only where the user has no plan checkpoint', () => {
  assert.equal(choose(moveTo(newWorkflow('none'), 'plans'), 'b').choice, 'b');
  for (const m of ['plan', 'plan+sample'] as const) assert.throws(() => choose(moveTo(newWorkflow(m), 'plans'), 'b'), /picks the plan in the panel/);
  assert.match(guide('plans', 'none'), /flow choose <a\|b\|c>/);
  assert.doesNotMatch(guide('plans', 'plan'), /flow choose/);
});

test('a run cut off by a limit while a workflow is on names the stage to continue from', () => {
  assert.deepEqual(pausedLine(moveTo(newWorkflow('none'), 'table')), ['Paused at stage Shot table: send “continue” to go on.', '停在「镜头表」阶段：发「继续」接着做。']);
  assert.equal(pausedLine(moveTo(newWorkflow('none'), 'done')), null);
  assert.equal(pausedLine(undefined), null);
});

test('contentKey ignores the workflow itself', () => {
  const b = { slug: 's', title: 't', theme: { accent: '#000' }, scenes: [] } as unknown as Storyboard;
  const k = contentKey(b);
  assert.equal(contentKey({ ...b, workflow: newWorkflow('none') }), k);
  assert.notEqual(contentKey({ ...b, title: 'u' }), k);
});

test('describe names the wait and an out-of-date review', () => {
  const wf = { ...wait(moveTo(newWorkflow('plan'), 'plans'), 'plan'), review: { round: 1, at: '', by: 'self' as const, phase: 'sample' as const, verdict: 'revise' as const, scope: '', scores: {}, defects: 2, version: 'old' } };
  const d = describe(wf, 'new');
  assert.match(d, /WAITING/);
  assert.match(d, /OUT OF DATE/);
  assert.match(d, /last review: sample round 1 revise/);
  assert.match(describe(undefined), /flow start/);
});

test('every stage has a contract that says what to deliver and when it is done', () => {
  for (const s of STAGES) {
    const g = guide(s, 'plan+sample');
    assert.match(g, new RegExp(`^Stage ${s}\\.`));
    if (s !== 'done') {
      assert.match(g, /Deliver:/);
      assert.match(g, /Done when:/);
    }
  }
  assert.match(guide('plans', 'plan'), /flow wait plan/);
  assert.match(guide('plans', 'none'), /pick the strongest/);
  assert.match(guide('sample', 'plan'), /flow stage full/);
  assert.match(guide('sample', 'plan+sample'), /flow wait sample/);
});

test('the sample and review contracts call review run alone: it renders the sheets itself', () => {
  for (const s of ['sample', 'review'] as const) {
    const g = guide(s, 'plan+sample');
    assert.match(g, /review run[^.]*renders the (contact )?sheets itself/, s);
    assert.doesNotMatch(g, /review <their ids> and review run|Do: review \(/, s);
  }
});

test('long briefs and plans can come from a file or stdin', () => {
  assert.match(guide('brief', 'none'), /brief write - /);
  assert.match(guide('plans', 'none'), /plans write a - /);
});
