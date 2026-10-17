import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-flowapi-'));
process.env.VS_DATA = DATA;
const { boardTemplate } = await import('../src/templates');
const { flowView, fromPage, passGate } = await import('../src/flowapi');
const { writePlan, planStill } = await import('../src/stagefiles');
const { moveTo, wait, newWorkflow } = await import('../src/flow');
const { passText } = await import('../src/gatekeys');

const mk = (slug: string, wf?: object) => {
  fs.mkdirSync(path.join(DATA, slug), { recursive: true });
  fs.writeFileSync(path.join(DATA, slug, 'storyboard.json'), JSON.stringify({ ...boardTemplate(slug, slug, 'zh'), ...(wf ? { workflow: wf } : {}) }, null, 2));
};

test('new boards take size and checking mode', () => {
  const b = boardTemplate('x', 'X', 'en', { format: 'tall', gates: 'plan' });
  assert.equal(b.format, 'tall');
  assert.equal(b.workflow?.gates, 'plan');
  assert.equal(b.workflow?.stage, 'brief');
  assert.equal(boardTemplate('y', 'Y').workflow, undefined);
});

test('the view lists plans with their preview urls', () => {
  mk('v', wait(moveTo(newWorkflow('plan'), 'plans'), 'plan'));
  writePlan('v', 'a', '# Plan A: Calm\n\nOne take.');
  fs.writeFileSync(planStill('v', 'a'), 'jpeg');
  const v = flowView('v');
  assert.equal(v.workflow?.waiting, 'plan');
  assert.equal(v.plans[0].title, 'Calm');
  assert.match(v.plans[0].image ?? '', /^\/v\/plans\/plan-a\.jpeg\?v=\d+/);
  assert.equal(v.plans[1].md, null);
});

test('passing the plan checkpoint moves on and returns the message the panel sends', () => {
  mk('p', wait(moveTo(newWorkflow('plan+sample'), 'plans'), 'plan'));
  assert.throws(() => passGate('p', 'plan', undefined, 'zh'), /choose a plan/);
  assert.equal(passGate('p', 'plan', 'b', 'zh'), '我选方案 B，按它继续做。');
  const b = JSON.parse(fs.readFileSync(path.join(DATA, 'p', 'storyboard.json'), 'utf8'));
  assert.equal(b.workflow.stage, 'script');
  assert.equal(b.workflow.choice, 'b');
  assert.throws(() => passGate('p', 'plan', 'b', 'zh'), /nothing is waiting/);
});

test('new boards take a tier; a one-plan tier passes only plan a', () => {
  const b = boardTemplate('t', 'T', 'en', { gates: 'plan+sample', tier: 4 });
  assert.equal(b.workflow?.tier, 4);
  assert.equal(b.workflow?.gates, 'plan');
  mk('one', wait(moveTo(newWorkflow('plan', 4), 'plans'), 'plan'));
  assert.throws(() => passGate('one', 'plan', 'b', 'en'), /one plan/);
  assert.equal(passGate('one', 'plan', 'a', 'en'), "I'll take plan A. Carry on with it.");
});

test('the sample card gets the first three problems of the latest round', () => {
  mk('s', { gates: 'plan+sample', stage: 'sample', waiting: 'sample', passed: ['plan'] });
  assert.deepEqual(flowView('s').problems, []);
  fs.mkdirSync(path.join(DATA, 's', 'review'), { recursive: true });
  fs.writeFileSync(
    path.join(DATA, 's', 'review', 'log.md'),
    '# Review log\n\n## Round 1 · sample · self-review · x\n\nrevise\n1. old problem\n\n## Round 2 · sample · independent reviewer · y\n\nrevise\nscope: sample\nscores: P 8\n1. **intro** 0:02 caption covers the field — move it up\n2. record 0:05 cursor hidden\n3) cut a|b pops\n4. fourth\n',
  );
  assert.deepEqual(flowView('s').problems, ['intro 0:02 caption covers the field — move it up', 'record 0:05 cursor hidden', 'cut a|b pops']);
});

test('the pass button sends the typed feedback with the message, and the refs only then', () => {
  assert.deepEqual(passText('样片通过，继续做全片。', '  字幕再大一点 '), { text: '样片通过，继续做全片。\n字幕再大一点', withRefs: true });
  assert.deepEqual(passText('样片通过，继续做全片。', '  '), { text: '样片通过，继续做全片。', withRefs: false });
});

test('the checkpoint routes answer in the app language and refuse requests from other sites', () => {
  fs.mkdirSync(path.join(DATA, '.editor'), { recursive: true });
  fs.writeFileSync(path.join(DATA, '.editor', 'settings.json'), JSON.stringify({ lang: 'zh' }));
  try {
    mk('z', wait(moveTo(newWorkflow('plan'), 'plans'), 'plan'));
    assert.throws(() => passGate('z', 'plan', undefined, 'zh'), /选一个方案/);
    assert.throws(() => passGate('z', 'sample', undefined, 'zh'), /没有在等/);
    mk('n');
    assert.throws(() => passGate('n', 'sample', undefined, 'zh'), /没有整片流程/);
    assert.throws(() => flowView('missing'), /没有项目/);
  } finally {
    fs.rmSync(path.join(DATA, '.editor', 'settings.json'));
  }
  assert.ok(fromPage({}));
  assert.ok(fromPage({ 'sec-fetch-site': 'same-origin' }));
  for (const s of ['cross-site', 'same-site', 'none']) assert.ok(!fromPage({ 'sec-fetch-site': s }), s);
});
