import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentArgs, findCli, parseAgentLine, type AgentEvent } from '../src/agents';

// Lines as Codex 0.162 and Gemini CLI 0.63 print them (captured against a mock model)
const CODEX = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Falling back from WebSockets to HTTPS transport."}}',
  '{"type":"error","message":"Reconnecting... 2/5 (stream disconnected)"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"cutroom","tool":"editor","arguments":{"args":["ls","--format","wide"]},"result":null,"error":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"cutroom","tool":"editor","arguments":{"args":["ls","--format","wide"]},"result":{"content":[{"type":"text","text":"showcase · wide"}]},"error":null,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Done."}}',
  '{"type":"turn.completed","usage":{"input_tokens":30}}',
];
const GEMINI = [
  '{"type":"init","session_id":"s1","model":"gemini-2.5-flash"}',
  '{"type":"message","role":"user","content":"hi"}',
  '{"type":"message","role":"assistant","content":"Looking. ","delta":true}',
  '{"type":"tool_use","tool_name":"mcp_cutroom_editor","tool_id":"t1","parameters":{"args":["set","photo","fx.look","\\"cool\\""]}}',
  '{"type":"tool_result","tool_id":"t1","status":"error","output":"Error: MCP tool \'editor\' reported an error.","error":{"type":"mcp_tool_error","message":"no project"}}',
  '{"type":"message","role":"assistant","content":"Fixed.","delta":true}',
  '{"type":"result","status":"success","stats":{"total_tokens":45}}',
];

const parse = (id: 'codex' | 'gemini', lines: string[]) => {
  const st = { textSince: false, wrote: false };
  return lines.flatMap((l) => parseAgentLine(id, l, st));
};

test('codex events: tool calls, the reply, retries ignored', () => {
  const ev = parse('codex', CODEX);
  assert.deepEqual(ev, [
    { type: 'tool', id: 'item_1', args: ['ls', '--format', 'wide'] },
    { type: 'tool_result', id: 'item_1', ok: true, out: 'showcase · wide' },
    { type: 'text', delta: 'Done.' },
    { type: 'done' },
  ] satisfies AgentEvent[]);
});

test('gemini events: text, tool call, failed tool, paragraph break, done', () => {
  const ev = parse('gemini', GEMINI);
  assert.deepEqual(
    ev.map((e) => e.type),
    ['text', 'tool', 'tool_result', 'text', 'text', 'done'],
  );
  assert.deepEqual(ev[1], { type: 'tool', id: 't1', args: ['set', 'photo', 'fx.look', '"cool"'] });
  assert.equal((ev[2] as { ok: boolean }).ok, false);
  assert.deepEqual(ev[3], { type: 'text', delta: '\n\n' });
  assert.deepEqual(parse('gemini', ['{"type":"result","status":"error","error":{"message":"quota"}}'])[0], { type: 'error', message: 'quota' });
});

test('npm .cmd shims resolve to node + the script, no shell needed', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-shim-'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'x', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'bin', 'x.js'), '');
  fs.writeFileSync(path.join(dir, 'xcli.cmd'), '@IF EXIST "%dp0%\\node.exe" (\r\n  "%dp0%\\node.exe"  "%dp0%\\node_modules\\x\\bin\\x.js" %*\r\n)\r\n');
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  try {
    const l = findCli('xcli')!;
    assert.equal(l.cmd, process.execPath);
    assert.equal(path.normalize(l.pre[0]), path.join(dir, 'node_modules', 'x', 'bin', 'x.js'));
  } finally {
    process.env.PATH = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agents get only the editor tool', () => {
  const c = agentArgs('codex', 'demo', 'gpt-x').args.join(' ');
  for (const f of ['shell_tool', 'unified_exec', 'view_image', 'goals']) assert.ok(c.includes(`--disable ${f}`), f);
  assert.match(c, /--sandbox read-only/);
  assert.match(c, /--ephemeral/);
  assert.match(c, /--ignore-user-config/);
  assert.match(c, /mcp_servers\.cutroom\.default_tools_approval_mode="approve"/);
  assert.match(c, /-m gpt-x -$/);
  const g = agentArgs('gemini', 'demo', undefined);
  const settings = JSON.parse(fs.readFileSync(path.join(g.cwd, '.gemini', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.tools.core, ['mcp_cutroom_editor']);
  assert.equal(settings.mcpServers.cutroom.args.at(-1), 'demo');
  assert.equal(g.env.GEMINI_CLI_TRUST_WORKSPACE, 'true');
});
