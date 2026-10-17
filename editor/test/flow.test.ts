import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, TIER_IDS, blocked, choose, contentKey, describe, finalNote, gatesFor, moveTo, newWorkflow, pass, pausedLine, phaseOf, planOf, setMode, setTier, stageLabel, stagesFor, wait } from '../src/flow';
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
  assert.match(guide('review', 'none'), /reply with the reviewer's verdict in one sentence; when it is revise the panel lists the problems left/);
  assert.doesNotMatch(guide('review', 'none'), /look or review renders per stage/, 'tier 1 has no look budget');
  assert.match(guide('review', 'none', 3), /Fix each problem once and confirm it with one look[\s\S]*tier 3 allows 6 look or review renders per stage/);
  for (const s of ['sample', 'full', 'review'] as const) assert.match(guide(s, 'none', 2), /tier 2 allows 10 look or review renders per stage/, s);
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

test('tiers without a sample drop its stage and checkpoint; tier 1 is not stored', () => {
  assert.deepEqual(gatesFor('plan+sample', 3), ['plan', 'sample']);
  assert.deepEqual(gatesFor('plan+sample', 4), ['plan']);
  assert.deepEqual(stagesFor(5), ['brief', 'plans', 'script', 'table', 'full', 'sound', 'review', 'done']);
  assert.deepEqual(stagesFor(1), STAGES);
  const wf = newWorkflow('plan+sample', 5);
  assert.equal(wf.gates, 'plan');
  assert.equal(wf.tier, 5);
  assert.equal('tier' in newWorkflow('plan'), false);
  assert.match(blocked({ ...wf, stage: 'table', passed: ['plan'] }, 'sample') ?? '', /tier 5 has no sample stage/);
  const passed = pass(wait(moveTo(wf, 'plans'), 'plan'), 'plan', 'a');
  assert.equal(passed.stage, 'script');
  assert.throws(() => wait(moveTo(newWorkflow('plan', 4), 'plans'), 'sample'), /no sample checkpoint/);
  assert.match(describe(moveTo(newWorkflow('none', 4), 'full')), /tier 4 lean · stage full \(5\/8\)/);
});

test('changing the tier keeps the mode valid', () => {
  const waiting = wait(moveTo(moveTo(pass(wait(moveTo(newWorkflow('plan+sample'), 'plans'), 'plan'), 'plan', 'b'), 'table'), 'sample'), 'sample');
  const lean = setTier(waiting, 4);
  assert.equal(lean.gates, 'plan');
  assert.equal(lean.waiting, undefined);
  assert.equal(lean.tier, 4);
  assert.equal('tier' in setTier(lean, 1), false);
  assert.equal(setMode(lean, 'plan+sample').gates, 'plan', 'no plan+sample without a sample');
});

test('one-plan tiers take plan a; their stage is called Plan', () => {
  const wf = moveTo(newWorkflow('none', 4), 'plans');
  assert.throws(() => choose(wf, 'b'), /makes one plan/);
  assert.equal(choose(wf, 'a').choice, 'a');
  assert.equal(planOf(wf), 'a');
  assert.equal(planOf(moveTo(newWorkflow('none'), 'plans')), undefined);
  assert.deepEqual(stageLabel('plans', 4), ['Plan', '方案']);
  assert.deepEqual(pausedLine(wf), ['Paused at stage Plan: send “continue” to go on.', '停在「方案」阶段：发「继续」接着做。']);
});

test('each tier has a contract for every stage it goes through, and leaves out what it drops', () => {
  for (const t of TIER_IDS)
    for (const s of stagesFor(t)) {
      const g = guide(s, 'plan+sample', t);
      assert.match(g, new RegExp(`^Stage ${s}\\b`), `${t} ${s}`);
      if (s !== 'done') assert.match(g, /Deliver:[\s\S]*Done when:/, `${t} ${s}`);
    }
  assert.match(guide('plans', 'none', 2), /no --motion at tier 2/);
  assert.doesNotMatch(guide('plans', 'none', 2), /--motion 3/);
  assert.match(guide('plans', 'none', 3), /Text only/);
  assert.doesNotMatch(guide('plans', 'none', 3), /run plans preview/);
  const one = guide('plans', 'plan', 4);
  assert.match(one, /plans write a/);
  assert.doesNotMatch(one, /plan-b|three plans/);
  assert.match(one, /the plan is in the card above/);
  assert.match(guide('plans', 'none', 5), /Then: flow stage script/);
  assert.match(guide('brief', 'none', 4), /three blocks <inputs> <direction> <structure>/);
  assert.doesNotMatch(guide('brief', 'none', 4), /<role>/);
  assert.match(guide('sample', 'plan', 4), /no sample stage: flow stage full/);
  assert.match(guide('sample', 'none', 3), /No review run at this tier/);
  assert.match(guide('sample', 'none', 2), /review run <their ids> once/);
  assert.match(guide('full', 'none', 2), /look lines <their ids> and check/);
  assert.doesNotMatch(guide('full', 'none', 2), /review <ids>/);
  assert.match(guide('full', 'none', 3), /one pass[\s\S]*contact sheets/);
  assert.match(guide('full', 'none', 4), /following the plan's look/);
  assert.match(guide('review', 'none', 3), /after 2 final rounds/);
  assert.match(guide('review', 'none', 4), /review run once[\s\S]*No second review run/);
  const self = guide('review', 'none', 5);
  assert.match(self, /hard failures only/);
  assert.match(self, /review log/);
  assert.match(self, /No review run/);
  assert.doesNotMatch(self, /Do: review run/);
  assert.match(guide('full', 'none', 5), /the project then goes through full again/);
});

test('the panel note under the reply names the final verdict and problems only when the build ended at revise', () => {
  const rv = (verdict: 'ready' | 'revise', phase: 'final' | 'sample' = 'final') => ({ round: 2, at: '', by: 'independent' as const, phase, verdict, scope: '', scores: {}, defects: 2, version: 'k' });
  const done = { ...moveTo(newWorkflow('none'), 'done'), review: rv('revise') };
  const n = finalNote(done, ['intro caption covers the click', 'cut is 34 s']);
  assert.deepEqual(n, ['Review: round 2 (independent reviewer) said revise. It listed: 1) intro caption covers the click 2) cut is 34 s', '审片结论：第 2 轮独立审片判定需要修改。列出的问题：1) intro caption covers the click 2) cut is 34 s']);
  assert.equal(finalNote({ ...done, review: rv('ready') }, []), null);
  assert.equal(finalNote({ ...done, stage: 'review' }, ['x']), null);
  assert.equal(finalNote({ ...done, review: rv('revise', 'sample') }, ['x']), null);
  assert.match(finalNote({ ...done, tier: 4 }, ['x'])![1], /已按意见改过一遍，没有复审/);
});

test('long briefs and plans can come from a file or stdin', () => {
  assert.match(guide('brief', 'none'), /brief write - /);
  assert.match(guide('plans', 'none'), /plans write a - /);
});
