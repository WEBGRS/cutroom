import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageList, workflowSection, EDIT_STEPS } from '../src/flowprompt';
import { moveTo, newWorkflow, wait } from '../src/flow';
import type { Storyboard } from '../../src/lib/types';

const board = (wf?: object) => ({ slug: 's', title: 't', theme: { accent: '#000' }, scenes: [], ...(wf ? { workflow: wf } : {}) }) as unknown as Storyboard;

test('the section has the stages, the checkpoint rules and today’s editing steps', () => {
  const s = workflowSection(board());
  for (const k of ['Making a whole video', 'flow start', 'flow wait', 'card above', 'Editing steps', 'smallest slice', 'rules add']) assert.ok(s.includes(k), k);
  assert.ok(s.includes(EDIT_STEPS));
  assert.match(s, /This project: no workflow/);
});

test('a waiting project is named in the prompt', () => {
  const s = workflowSection(board(wait(moveTo(newWorkflow('plan'), 'plans'), 'plan')));
  assert.match(s, /This project: mode plan · tier 1 full · stage plans .* WAITING/);
});

test('the stage list follows the tier; tier 1 keeps the full list', () => {
  assert.equal(stageList(undefined), '1. brief → 2. plans (checkpoint plan) → 3. script and voice → 4. shot table → 5. sample (checkpoint sample) → 6. full, in batches → 7. sound → 8. review, by an independent reviewer → 9. done.');
  const lean = stageList(newWorkflow('plan', 4));
  assert.match(lean, /2\. one plan \(checkpoint plan\)/);
  assert.doesNotMatch(lean, /sample/);
  assert.match(lean, /5\. full, in one pass/);
  assert.match(lean, /review, one round by an independent reviewer → 8\. done\. Tier 4: the user chose to spend fewer tokens/);
  assert.match(stageList(newWorkflow('none', 5)), /review, a self-check of hard failures/);
  assert.match(workflowSection(board(newWorkflow('none', 3))), /flow start <mode> \[tier\]/);
});

test('the reply rule says nothing runs after the turn and a block means stop and say so', async () => {
  const { systemPrompt } = await import('../src/chat');
  const p = systemPrompt('demo');
  assert.match(p, /nothing keeps running after it: never say you will keep polling, wait, or come back later/);
  assert.match(p, /send “继续”\/“continue” once it is clear/);
});

test('the reply rule names the reviewer’s remaining problems after flow stage done', async () => {
  const { systemPrompt } = await import('../src/chat');
  assert.ok(systemPrompt('demo').includes("When `flow stage done` lists the final review's problems, the panel adds the verdict and those problems under your reply: don't repeat them"));
});
