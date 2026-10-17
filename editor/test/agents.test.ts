import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGY_DENY, AGY_FULL_ALLOW, agentArgs, codexNative, findCli, parseAgentLine, parseAgyModels, parseCodexModels, type AgentEvent } from '../src/agents';
import { lookDir } from '../src/look';
import { runFullTool } from '../src/fulltools';
import { editorOnly, fullStep, shellCommands, systemPrompt, toolLabel } from '../src/chat';
import { PUBLIC, ROOT } from '../src/store';

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

test('model lists: Codex catalog (listed only, by priority, display names) and Antigravity lines', () => {
  // Shape of "codex debug models" in Codex 0.162, trimmed
  const cat = JSON.stringify({
    models: [
      { slug: 'gpt-b', display_name: 'GPT-B', visibility: 'list', priority: 3, base_instructions: 'x' },
      { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide', priority: 1 },
      { slug: 'gpt-a', display_name: 'GPT-A', visibility: 'list', priority: 1 },
      { slug: 'gpt-c', visibility: 'list' },
    ],
  });
  assert.deepEqual(parseCodexModels(cat), { models: ['gpt-a', 'gpt-b', 'gpt-c'], names: { 'gpt-a': 'GPT-A', 'gpt-b': 'GPT-B' } });
  assert.deepEqual(parseCodexModels('error: unrecognized subcommand'), { models: [], names: {} });
  assert.deepEqual(parseAgyModels('gemini-3.1-pro-high\tGemini 3.1 Pro (High)\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6\nNot signed in\n'), {
    models: ['gemini-3.1-pro-high', 'claude-sonnet-4-6'],
    names: { 'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)', 'claude-sonnet-4-6': 'Claude Sonnet 4.6' },
  });
});

test('reasoning effort reaches Codex (max becomes xhigh) and Antigravity, not Gemini CLI', () => {
  assert.match(agentArgs('codex', 'demo', 'gpt-x', { effort: 'max' }).args.join(' '), /-m gpt-x -c model_reasoning_effort="xhigh" -$/);
  assert.match(agentArgs('codex', 'demo', undefined, { effort: 'low' }).args.join(' '), /model_reasoning_effort="low"/);
  assert.doesNotMatch(agentArgs('codex', 'demo', undefined).args.join(' '), /reasoning_effort/);
  const a = agentArgs('antigravity', 'demo', undefined, { effort: 'high' }).args;
  assert.equal(a[a.indexOf('--effort') + 1], 'high');
  assert.ok(!agentArgs('gemini', 'demo', undefined, { effort: 'high' }).args.includes('--effort'));
});

test('full access: Codex and Antigravity get Cutroom’s shell and file tools; their own shell stays off', () => {
  const env = { CUTROOM_SERVER: 'http://127.0.0.1:1', CUTROOM_ASK_TOKEN: 'tok' };
  const c = agentArgs('codex', 'demo', undefined, { full: true, mcp: env }).args.join(' ');
  for (const f of ['--sandbox read-only', '--disable shell_tool', '--disable unified_exec', 'CUTROOM_FULL = "1"', 'CUTROOM_ASK_TOKEN = "tok"', 'tool_timeout_sec=1500']) assert.ok(c.includes(f), f);
  assert.ok(!c.includes('web_search="disabled"'), 'its web search stays on');
  // No way to reach the editor: no full-access tools
  assert.doesNotMatch(agentArgs('codex', 'demo', undefined, { full: true }).args.join(' '), /CUTROOM_FULL/);
  const a = agentArgs('antigravity', 'demo', undefined, { full: true, mcp: env });
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(a.env.HOME, rel), 'utf8'));
  const perm = read('.gemini/antigravity-cli/settings.json').permissions;
  for (const r of AGY_FULL_ALLOW) assert.ok(perm.allow.includes(r), r);
  for (const r of ['command(*)', 'write_file(*)', 'unsandboxed(*)', 'execute_url(*)']) assert.ok(perm.deny.includes(r), r);
  assert.equal(read('.gemini/config/mcp_config.json').mcpServers.cutroom.env.CUTROOM_FULL, '1');
  // Back to editor only: the old limits return
  agentArgs('antigravity', 'demo', undefined);
  assert.deepEqual(read('.gemini/antigravity-cli/settings.json').permissions.deny, AGY_DENY);
  assert.equal(read('.gemini/config/mcp_config.json').mcpServers.cutroom.env.CUTROOM_FULL, undefined);
});

test('MCP server: full access adds shell and file tools that the editor runs (with its token)', async (t) => {
  const http = await import('node:http');
  const seen: { route: string; token: string; body: Record<string, unknown> }[] = [];
  const editor = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ route: req.url ?? '', token: String(req.headers['x-cutroom-ask'] ?? ''), body: JSON.parse(b) });
      res.end(JSON.stringify({ ok: false, out: 'The user declined this step in the chat panel.' }));
    });
  });
  await new Promise<void>((r) => editor.listen(0, '127.0.0.1', r));
  t.after(() => editor.close());
  const port = (editor.address() as { port: number }).port;
  const { spawn } = await import('node:child_process');
  const talk = async (env: Record<string, string>, msgs: object[]) => {
    const p = spawn(process.execPath, [path.join(process.cwd(), 'editor', 'dist', 'mcp.mjs'), 'demo'], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    for (const m of msgs) p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    for (let i = 0; i < 100 && out.split('\n').filter(Boolean).length < msgs.length; i++) await new Promise((r) => setTimeout(r, 50));
    p.kill();
    return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const list = { id: 1, method: 'tools/list' };
  const plain = await talk({ CUTROOM_FULL: '' }, [list]);
  assert.deepEqual(plain[0].result.tools.map((x: { name: string }) => x.name), ['editor']);
  const full = await talk({ CUTROOM_FULL: '1', CUTROOM_SERVER: `http://127.0.0.1:${port}`, CUTROOM_ASK_TOKEN: 'tok' }, [list, { id: 2, method: 'tools/call', params: { name: 'shell', arguments: { command: 'echo hi' } } }]);
  assert.deepEqual(full.find((x) => x.id === 1).result.tools.map((x: { name: string }) => x.name), ['editor', 'shell', 'read_file', 'write_file']);
  const call = full.find((x) => x.id === 2).result;
  assert.equal(call.isError, true);
  assert.match(call.content[0].text, /declined/);
  assert.deepEqual(seen[0], { route: '/api/chat/full-step', token: 'tok', body: { slug: 'demo', name: 'shell', input: { command: 'echo hi' } } });
});

test('full access: agents show their own commands, file edits and searches', () => {
  const codex = [
    '{"type":"item.started","item":{"id":"c1","type":"command_execution","command":"ffprobe cap/a.mp4","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
    '{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"ffprobe cap/a.mp4","aggregated_output":"Duration: 00:00:12","exit_code":0,"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"f1","type":"file_change","changes":[{"path":"scenes/x/index.html","kind":"add"}],"status":"completed"}}',
  ];
  const ev = parse('codex', codex);
  assert.deepEqual(ev.filter((e) => e.type === 'tool').map((e) => (e as { args: string[] }).args[0]), ['ffprobe cap/a.mp4', 'edit scenes/x/index.html']);
  assert.ok(ev.some((e) => e.type === 'tool_result' && e.id === 'c1' && e.ok));
  // Antigravity's own tools show only with full access
  const own = step({ step_index: 9, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'ffmpeg -version' }, output: 'ffmpeg 9' } });
  assert.equal(parse('antigravity', [own]).length, 0);
  const st = { textSince: false, wrote: false, full: true };
  const shown = parseAgentLine('antigravity', own, st);
  assert.deepEqual(shown.map((e) => e.type), ['tool', 'tool_result']);
  assert.deepEqual((shown[0] as { args: string[] }).args, ['run_command ffmpeg -version']);
});

test('full access tools: files and a shell; the timeline is changed only through the editor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-full-'));
  assert.ok((await runFullTool('write_file', { path: 'scenes/a/index.html', content: '<p>hi</p>' }, dir)).ok);
  assert.equal((await runFullTool('read_file', { path: 'scenes/a/index.html' }, dir)).out, '<p>hi</p>');
  const sb = await runFullTool('write_file', { path: 'storyboard.json', content: '{}' }, dir);
  assert.ok(!sb.ok && /editor tool/.test(sb.out));
  assert.ok(!fs.existsSync(path.join(dir, 'storyboard.json')));
  const sh = await runFullTool('shell', { command: 'echo cutroom-ok' }, dir);
  assert.ok(sh.ok && sh.out.includes('cutroom-ok'), sh.out);
  assert.ok(!(await runFullTool('shell', { command: '' }, dir)).ok);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('full access gate: the project folder runs at once; shell commands and writes elsewhere need the panel', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-proj-'));
  const outside = path.join(os.tmpdir(), `cutroom-outside-${process.pid}.txt`);
  // Nobody is in the chat panel for this project, so anything that must be asked is declined
  assert.ok((await fullStep('nobody-here', project, 'write_file', { path: 'media/notes.txt', content: 'x' })).ok);
  assert.ok((await fullStep('nobody-here', project, 'read_file', { path: 'media/notes.txt' })).ok);
  const w = await fullStep('nobody-here', project, 'write_file', { path: outside, content: 'x' });
  assert.ok(!w.ok && /chat panel/.test(w.out), w.out);
  assert.ok(!fs.existsSync(outside), 'nothing written outside without an answer');
  const up = await fullStep('nobody-here', project, 'write_file', { path: '../escape.txt', content: 'x' });
  assert.ok(!up.ok && !fs.existsSync(path.join(project, '..', 'escape.txt')));
  // A malformed call is sent back without asking anyone
  assert.match((await fullStep('nobody-here', project, 'shell', { cmd: 'echo hi' })).out, /command must be/);
  const sh = await fullStep('nobody-here', project, 'shell', { command: 'echo should-not-run > ran.txt' });
  assert.ok(!sh.ok && !fs.existsSync(path.join(project, 'ran.txt')), 'no shell command without an answer');
  fs.rmSync(project, { recursive: true, force: true });
});

test('panel labels for Claude Code tools', () => {
  const proj = path.join(PUBLIC, 'showcase');
  assert.equal(toolLabel('Write', { file_path: path.join(proj, 'scenes', 'a', 'index.html') }, 'showcase'), `write ${path.join('scenes', 'a', 'index.html')}`);
  assert.equal(toolLabel('Bash', { command: 'node editor/dist/cli.mjs showcase ls' }, 'showcase'), 'ls');
  assert.equal(toolLabel('WebSearch', { query: 'remotion premount' }, 'showcase'), 'search remotion premount');
  assert.equal(toolLabel('mcp__firecrawl__scrape', {}, 'showcase'), 'firecrawl › scrape');
});

test('the assistant confirms 16:9 or 9:16 before the first version, and knows no beat cut', () => {
  const p = systemPrompt('demo');
  assert.match(p, /0\. Start\. The size/);
  assert.match(p, /16:9 widescreen/);
  assert.match(p, /9:16 vertical/);
  assert.match(p, /set - format '"tall"'/);
  assert.match(p, /set <id> shot/);
  assert.match(p, /rebuild that scene to match it/);
  assert.match(p, /look lines/);
  assert.doesNotMatch(p, /beat cut|--mode/i);
});

test('full access: Bash lines that only run the editor need no go-ahead; anything else still asks', () => {
  const cli = `node ${path.join(ROOT, 'editor', 'dist', 'cli.mjs').replace(/\\/g, '/')}`;
  const proj = path.join(PUBLIC, 'demo').replace(/\\/g, '/');
  assert.ok(editorOnly(`${cli} demo ls`, 'demo'));
  // Quoted text may hold ; and && without splitting the line
  assert.ok(editorOnly(`cd ${proj} && ${cli} demo set intro lines '[{"zh":"先看结果; 再看 && 细节"}]' && ${cli} demo voice && ${cli} demo check`, 'demo'));
  assert.deepEqual(shellCommands(`a 'x; y' && b "c d"`), [['a', 'x; y'], ['b', 'c d']]);
  // The line from the panel: an alias in a variable is not the editor
  assert.equal(editorOnly(`cd ${proj} && C="demo"; $C set screen-2 lines '[{"zh":"一个网站全搞定。"}]' && $C voice`, 'demo'), false);
  assert.equal(editorOnly(`${cli} demo ls | head`, 'demo'), false);
  assert.equal(editorOnly(`${cli} demo ls && rm -rf media`, 'demo'), false);
  assert.equal(editorOnly(`${cli} demo set intro title "$(whoami)"`, 'demo'), false);
  assert.equal(editorOnly(`${cli} demo ls > out.txt`, 'demo'), false);
  assert.equal(editorOnly(`${cli} other ls`, 'demo'), false);
  assert.equal(editorOnly(`cd C:/ && ${cli} demo ls`, 'demo'), false);
  assert.equal(editorOnly(`cd ${proj}`, 'demo'), false);
  assert.match(systemPrompt('demo', 'bash', true), /no cd, no variables or aliases/);
});

// Under the desktop app the npm wrapper (codex.js) starts codex.exe in a visible terminal window; the exe is run directly
test('Codex: the npm shim resolves to its bundled codex.exe, with the wrapper environment', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-codex-'));
  const root = path.join(dir, 'node_modules', '@openai', 'codex');
  const js = path.join(root, 'bin', 'codex.js');
  const exe = path.join(root, 'node_modules', '@openai', `codex-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(js, '');
  fs.writeFileSync(exe, '');
  fs.writeFileSync(path.join(dir, 'codex.cmd'), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  // Only the test folder, not the Codex installed on this machine
  const saved = process.env.PATH;
  process.env.PATH = '';
  const l = findCli('codex', [dir])!;
  process.env.PATH = saved;
  assert.equal(l.cmd, exe);
  assert.deepEqual(l.pre, []);
  assert.equal(l.env?.CODEX_MANAGED_PACKAGE_ROOT, root);
  assert.equal(l.env?.CODEX_MANAGED_BY_NPM, '1');
  // Any other npm script still runs under node
  assert.equal(codexNative(path.join(dir, 'node_modules', 'other', 'bin', 'cli.js')), null);
});
