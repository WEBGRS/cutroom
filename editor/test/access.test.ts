import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Settings and the project live in a throwaway data folder
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-access-test-'));
process.env.VS_DATA = DATA;
fs.mkdirSync(path.join(DATA, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify({ slug: 'demo', title: 'Demo', theme: { accent: '#3b6ef5' }, scenes: [] }));
const C = await import('../src/chat');
const { agentArgs } = await import('../src/agents');

test('allow everything: no step waits for the panel; full access still asks', async () => {
  C.writeAi({ access: 'auto' });
  assert.equal(C.aiAccess(), 'auto');
  // Nobody is in the panel, and the step is allowed anyway
  assert.deepEqual(await C.askUser('demo', 'git push'), { allow: true });
  const r = await C.fullStep('demo', path.join(DATA, 'demo'), 'shell', { command: 'echo hello-from-shell' });
  assert.ok(r.ok, r.out);
  assert.match(r.out, /hello-from-shell/);
  assert.match(C.systemPrompt('demo', 'bash'), /turned approvals off/);
  assert.match(C.systemPrompt('demo', 'tool'), /elsewhere too/);

  C.writeAi({ access: 'full' });
  assert.equal((await C.askUser('demo', 'git push')).allow, false, 'with nobody to answer, full access declines');
  assert.match(C.systemPrompt('demo', 'bash'), /wait for the user to approve/);
  C.writeAi({ access: 'nonsense' });
  assert.equal(C.aiAccess(), 'editor');
});

test('Gemini CLI gets Cutroom’s shell and file tools only with full tools passed in', () => {
  const read = (cwd: string) => JSON.parse(fs.readFileSync(path.join(cwd, '.gemini', 'settings.json'), 'utf8'));
  const plain = read(agentArgs('gemini', 'demo', undefined).cwd);
  assert.deepEqual(plain.tools.core, ['mcp_cutroom_editor']);
  const full = read(agentArgs('gemini', 'demo', undefined, { full: true, mcp: { CUTROOM_SERVER: 'http://127.0.0.1:1', CUTROOM_ASK_TOKEN: 't' } }).cwd);
  assert.deepEqual(full.tools.core, ['mcp_cutroom_editor', 'mcp_cutroom_shell', 'mcp_cutroom_read_file', 'mcp_cutroom_write_file']);
  assert.equal(full.mcpServers.cutroom.env.CUTROOM_FULL, '1');
  assert.equal(full.mcpServers.cutroom.env.CUTROOM_SERVER, 'http://127.0.0.1:1');
});
