import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowSection, EDIT_STEPS } from '../src/flowprompt';
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
  assert.match(s, /This project: mode plan · stage plans .* WAITING/);
});

test('the reply rule says nothing runs after the turn and a block means stop and say so', async () => {
  const { systemPrompt } = await import('../src/chat');
  const p = systemPrompt('demo');
  assert.match(p, /nothing keeps running after it: never say you will keep polling, wait, or come back later/);
  assert.match(p, /send “继续”\/“continue” once it is clear/);
});

test('the reply rule names the reviewer’s remaining problems after flow stage done', async () => {
  const { systemPrompt } = await import('../src/chat');
  assert.ok(systemPrompt('demo').includes('Exception: when `flow stage done` lists problems'));
});
