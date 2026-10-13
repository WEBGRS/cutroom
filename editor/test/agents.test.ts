import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGY_DENY, agentArgs, findCli, parseAgentLine, type AgentEvent } from '../src/agents';
import { lookDir } from '../src/look';

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

// Antigravity CLI 1.3.3 (agy), trimmed from a real run: a denied shell command, the tool list it reads, one editor call
const step = (u: object) => JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', ...u } });
const AGY = [
  '{"event":"init","init":{"model":"gemini-3.8-flash-low","tools":["call_mcp_tool","run_command"],"permission_mode":"request-review"}}',
  step({ step_index: 0, state: 'DONE', step_type: 'user_input' }),
  step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Checking.' }),
  step({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\n', usage: { input_tokens: 12932 } }),
  step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hi' } } }),
  step({ step_index: 2, state: 'ERROR', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hi' }, error: { type: 'TOOL_ERROR', message: 'Permission denied for command(echo hi). Matches user-configured deny rule.' } } }),
  step({ step_index: 3, state: 'DONE', step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: 'C:\\t\\.gemini\\antigravity-cli\\mcp\\cutroom\\editor.json' }, output: '1 lines, 484 bytes' } }),
  step({ step_index: 4, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { name: 'call_mcp_tool', parameters: { Arguments: { args: ['ls'] }, ServerName: 'cutroom', ToolName: 'editor' } } }),
  step({ step_index: 4, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { name: 'call_mcp_tool', parameters: { Arguments: { args: ['ls'] }, ServerName: 'cutroom', ToolName: 'editor' } } }),
  step({ step_index: 4, state: 'DONE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { name: 'call_mcp_tool', parameters: { Arguments: { args: ['ls'] }, ServerName: 'cutroom', ToolName: 'editor' }, output: 'launch · wide · voice · zh' } }),
  step({ step_index: 5, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Two scenes.' }),
  '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"Checking.\\nTwo scenes.","num_turns":1}}',
];

const parse = (id: 'codex' | 'gemini' | 'antigravity', lines: string[]) => {
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

test('antigravity events: only the editor calls show, each once, then the reply', () => {
  const ev = parse('antigravity', AGY);
  assert.deepEqual(ev, [
    { type: 'text', delta: 'Checking.' },
    { type: 'text', delta: '\n' },
    { type: 'tool', id: 'step-4', args: ['ls'] },
    { type: 'tool_result', id: 'step-4', ok: true, out: 'launch · wide · voice · zh' },
    { type: 'text', delta: '\n\n' },
    { type: 'text', delta: 'Two scenes.' },
    { type: 'done' },
  ] satisfies AgentEvent[]);
  assert.deepEqual(parse('antigravity', ['{"event":"result","result":{"status":"ERROR","error":"quota exhausted"}}']), [{ type: 'error', message: 'quota exhausted' }, { type: 'done' }]);
  // A tool it could not ask permission for ends the turn silently; the user is told why
  const denied = parse('antigravity', ['{"event":"result","result":{"status":"SUCCESS","response":"","denied_actions":[{"action":"read_file","display_name":"ViewFile"}]}}']);
  assert.equal(denied[0].type, 'error');
  assert.match((denied[0] as { message: string }).message, /Antigravity.*ViewFile/);
  assert.deepEqual(denied[1], { type: 'done' });
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
  // Antigravity: a home of its own holding only the editor, which it may call; its shell, writes and page reads are denied
  const a = agentArgs('antigravity', 'demo', 'gemini-3.1-pro-high');
  const home = a.env.HOME;
  assert.equal(a.env.USERPROFILE, home);
  assert.notEqual(path.resolve(home), path.resolve(os.homedir()));
  assert.equal(path.dirname(a.cwd), home);
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(home, rel), 'utf8'));
  const mcp = read('.gemini/config/mcp_config.json').mcpServers;
  assert.deepEqual(Object.keys(mcp), ['cutroom']);
  assert.equal(mcp.cutroom.args.at(-1), 'demo');
  assert.equal(mcp.cutroom.env.USERPROFILE, os.homedir(), 'the editor itself keeps the real home');
  assert.equal(mcp.cutroom.env.CUTROOM_LOOK_FILES, '1', 'it drops images in tool results, so frames are opened as files');
  assert.equal(mcp.cutroom.timeoutSeconds, 900, 'its default is 3 minutes per call');
  const perm = read('.gemini/antigravity-cli/settings.json').permissions;
  assert.deepEqual(perm.allow, ['mcp(cutroom/editor)', `read_file(${path.resolve(lookDir())})`]);
  assert.deepEqual(perm.deny, AGY_DENY);
  for (const r of ['command(*)', 'write_file(*)', 'read_url(*)']) assert.ok(perm.deny.includes(r), r);
  assert.deepEqual(a.args.slice(0, 4), ['--input-format', 'stream-json', '--output-format', 'stream-json']);
  assert.deepEqual(a.args.slice(-4), ['--model', 'gemini-3.1-pro-high', '-p', '']);
});

test('reasoning effort reaches Codex (max becomes xhigh) and Antigravity, not Gemini CLI', () => {
  assert.match(agentArgs('codex', 'demo', 'gpt-x', 'max').args.join(' '), /-m gpt-x -c model_reasoning_effort="xhigh" -$/);
  assert.match(agentArgs('codex', 'demo', undefined, 'low').args.join(' '), /model_reasoning_effort="low"/);
  assert.doesNotMatch(agentArgs('codex', 'demo', undefined).args.join(' '), /reasoning_effort/);
  const a = agentArgs('antigravity', 'demo', undefined, 'high').args;
  assert.equal(a[a.indexOf('--effort') + 1], 'high');
  assert.ok(!agentArgs('gemini', 'demo', undefined, 'high').args.includes('--effort'));
});
