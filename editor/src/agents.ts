// Subscriptions through the vendors' own command-line agents (ChatGPT via Codex CLI, Google via Gemini CLI or Antigravity).
// The editor CLI is served to them by editor/dist/mcp.mjs; their own shell and file tools are off. With full access the
// same server adds Cutroom's shell and file tools, whose risky steps the user allows in the chat panel.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './store';
import { killTree } from './proc';
import { captureFfmpeg, desktopSupported } from './desktop';
import { lookDir } from './look';
import { L } from './settings';

export type AgentId = 'codex' | 'gemini' | 'antigravity';

export interface AgentDef {
  id: AgentId;
  en: string;
  zh: string;
  bin: string;
  // npm package to install, or a page to download it from
  pkg?: string;
  url?: string;
  // Folders it installs to that may not be on PATH
  dirs?: () => string[];
  plansEn: string;
  plansZh: string;
  login: string;
}

export const AGENTS: AgentDef[] = [
  { id: 'codex', en: 'ChatGPT (Codex CLI)', zh: 'ChatGPT（Codex CLI）', bin: 'codex', pkg: '@openai/codex', plansEn: 'ChatGPT Plus, Pro, Business, Edu or Enterprise', plansZh: 'ChatGPT Plus、Pro、Business、Edu 或 Enterprise', login: 'codex login' },
  { id: 'gemini', en: 'Google Gemini (Gemini CLI)', zh: 'Google Gemini（Gemini CLI）', bin: 'gemini', pkg: '@google/gemini-cli', plansEn: 'Any Google account (free daily quota), Google AI Pro or Ultra', plansZh: '任意 Google 账号（每日免费额度）、Google AI Pro 或 Ultra', login: 'gemini' },
  { id: 'antigravity', en: 'Google Antigravity (agy CLI)', zh: 'Google Antigravity（agy CLI）', bin: 'agy', url: 'https://antigravity.google', dirs: () => [path.join(os.homedir(), '.gemini', 'bin')], plansEn: 'The Google account you use in Antigravity; its Gemini, Claude and GPT-OSS models', plansZh: '你在 Antigravity 里登录的 Google 账号；可用它的 Gemini、Claude、GPT-OSS 模型', login: 'agy' },
];

export const agentDef = (id: string | undefined) => AGENTS.find((a) => a.id === id);

// How to start a CLI: a native exe, or node + the script behind an npm .cmd shim (so no shell is needed)
export interface Launch {
  cmd: string;
  pre: string[];
  path: string;
}

export function findCli(name: string, extra: string[] = []): Launch | null {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), ...extra];
  for (const dir of dirs) {
    if (process.platform === 'win32') {
      const exe = path.join(dir, `${name}.exe`);
      if (fs.existsSync(exe)) return { cmd: exe, pre: [], path: exe };
      const shim = path.join(dir, `${name}.cmd`);
      if (fs.existsSync(shim)) {
        // `"%dp0%\node_modules\pkg\bin\cli.js"` in npm's shims; the last script named is the program
        const ms = [...fs.readFileSync(shim, 'utf8').matchAll(/%~?dp0%?\\([^"\r\n]+?\.(?:js|mjs|cjs))/gi)];
        const m = ms.at(-1);
        if (m) {
          const js = path.join(dir, m[1]);
          if (fs.existsSync(js)) return { cmd: process.execPath, pre: [js], path: js };
        }
      }
    } else {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return { cmd: p, pre: [], path: p };
    }
  }
  return null;
}
export const cliOf = (def: AgentDef) => findCli(def.bin, def.dirs?.() ?? []);

const run = (l: Launch, args: string[], timeout = 20_000) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    execFile(l.cmd, [...l.pre, ...args], { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }));
  });

export interface AgentState {
  id: AgentId;
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean | null;
  method: string | null;
  // Models the CLI offers, when it can list them
  models?: string[];
}

// Login checks cost no tokens; cached so the settings page can poll
const cache = new Map<AgentId, { t: number; v: AgentState }>();
export const forgetAgents = () => cache.clear();

export async function agentState(id: AgentId): Promise<AgentState> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < 30_000) return hit.v;
  const def = agentDef(id)!;
  const l = cliOf(def);
  const v: AgentState = { id, installed: !!l, path: l?.path ?? null, version: null, loggedIn: null, method: null };
  if (l) {
    const ver = await run(l, ['--version']);
    v.version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(ver.out)?.[1] ?? null;
    if (id === 'codex') {
      const s = await run(l, ['login', 'status']);
      v.loggedIn = /not logged in/i.test(s.out) ? false : /logged in/i.test(s.out) ? true : null;
      v.method = /chatgpt/i.test(s.out) ? 'ChatGPT' : /api key/i.test(s.out) ? 'API key' : null;
    } else if (id === 'antigravity') {
      // Listing models needs the sign-in and costs nothing: "gemini-3.1-pro-high<TAB>Gemini 3.1 Pro (High)"
      const s = await run(l, ['models']);
      v.models = [...s.out.matchAll(/^([\w.-]+)\t/gm)].map((m) => m[1]);
      v.loggedIn = v.models.length ? true : /sign.?in|log.?in|auth/i.test(s.out) ? false : null;
      v.method = v.loggedIn ? 'Google' : null;
    } else {
      // Gemini CLI keeps the Google sign-in next to its settings
      const home = path.join(process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini');
      const oauth = fs.existsSync(path.join(home, 'oauth_creds.json'));
      let selected = '';
      try {
        selected = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')).security?.auth?.selectedType ?? '';
      } catch {
        selected = '';
      }
      const key = selected === 'gemini-api-key' && !!process.env.GEMINI_API_KEY;
      v.loggedIn = oauth || key;
      v.method = oauth ? 'Google' : key ? 'API key' : null;
    }
  }
  cache.set(id, { t: Date.now(), v });
  return v;
}

const toml = (s: string) => JSON.stringify(s);
const MCP = () => path.join(ROOT, 'editor', 'dist', 'mcp.mjs');
// The CLIs start the MCP server with a trimmed environment: where the projects live, and (desktop app) run Electron as Node
// Some agents start MCP servers with a trimmed environment; desktop recording needs Windows' folders and its FFmpeg
export const mcpEnv = (): Record<string, string> => {
  const env = Object.fromEntries(['VS_DATA', 'VS_ROOT', 'ELECTRON_RUN_AS_NODE', 'SystemRoot', 'LOCALAPPDATA', 'CUTROOM_APPDIR', 'CUTROOM_DESK_FAKE'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
  const ff = desktopSupported() ? captureFfmpeg() : null;
  if (ff) env.CUTROOM_FFMPEG = ff;
  return env;
};

// Gemini CLI reads MCP servers from <workspace>/.gemini/settings.json; the workspace must sit outside any git repo
function geminiWorkspace(slug: string): string {
  const dir = path.join(os.tmpdir(), 'cutroom-gemini');
  fs.mkdirSync(path.join(dir, '.gemini'), { recursive: true });
  const settings = {
    mcpServers: { cutroom: { command: process.execPath, args: [MCP(), slug], cwd: ROOT, env: mcpEnv(), trust: true, timeout: 900_000 } },
    // Its own file, shell and web tools are off; only the editor remains
    tools: { core: ['mcp_cutroom_editor'] },
  };
  fs.writeFileSync(path.join(dir, '.gemini', 'settings.json'), JSON.stringify(settings, null, 2));
  return dir;
}

// Antigravity reads its MCP servers and permissions only from the home folder, so it gets a home of its own;
// the sign-in lives in the system keyring and still works. Its own tools are denied (the model gets an error
// and carries on); web search remains, which reads nothing on this computer.
export const AGY_DENY = ['command(*)', 'unsandboxed(*)', 'write_file(*)', 'read_url(*)', 'execute_url(*)'];
// Full access: Cutroom's shell and file tools (each risky step asked in the panel) and web pages; its own shell and writes stay off
export const AGY_FULL_ALLOW = ['mcp(cutroom/shell)', 'mcp(cutroom/read_file)', 'mcp(cutroom/write_file)', 'read_url(*)'];
function antigravityHome(slug: string, mcp?: Record<string, string>): string {
  const home = path.join(os.tmpdir(), 'cutroom-agy');
  const put = (rel: string, v: object) => {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), JSON.stringify(v, null, 2));
  };
  // The editor itself runs with the real home folder; Antigravity drops images in tool results, so `look` says where the frames are
  const env = { ...mcpEnv(), ...(mcp ?? {}), HOME: os.homedir(), USERPROFILE: os.homedir(), CUTROOM_LOOK_FILES: '1' };
  // Its own limit per tool call is 3 minutes; voice-over and recordings take longer
  put('.gemini/config/mcp_config.json', { mcpServers: { cutroom: { command: process.execPath, args: [MCP(), slug], cwd: ROOT, env, timeoutSeconds: mcp ? 1500 : 900 } } });
  // Editor only: it may open the rendered frames, nothing else outside its empty workspace
  const allow = ['mcp(cutroom/editor)', `read_file(${path.resolve(lookDir())})`, ...(mcp ? AGY_FULL_ALLOW : [])];
  put('.gemini/antigravity-cli/settings.json', { permissions: { allow, deny: mcp ? AGY_DENY.filter((r) => r !== 'read_url(*)') : AGY_DENY } });
  put('.gemini/config/config.json', {
    userSettings: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF', nonWorkspaceFileAccessPolicy: 'AGENT_SETTING_POLICY_DENY', browserJsExecutionPolicy: 'BROWSER_JS_EXECUTION_POLICY_DISABLED', enableTerminalSandbox: true },
  });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  return home;
}

// Codex has no "max"; its top level is xhigh
const CODEX_EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };

export interface AgentOpts {
  // Full access: Cutroom's shell and file tools through the MCP server, which reaches the editor with these variables
  full?: boolean;
  mcp?: Record<string, string>;
  effort?: string;
}

export function agentArgs(id: AgentId, slug: string, model: string | undefined, o: AgentOpts = {}): { args: string[]; cwd: string; env: Record<string, string> } {
  const { effort } = o;
  // The MCP server serves the full-access tools only when it can reach the editor
  const mcp = o.full && o.mcp ? { ...o.mcp, CUTROOM_FULL: '1' } : undefined;
  if (id === 'antigravity') {
    const home = antigravityHome(slug, mcp);
    return {
      cwd: path.join(home, 'work'),
      env: { HOME: home, USERPROFILE: home },
      // The prompt arrives on stdin as one stream-json message
      args: ['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands', ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []), '-p', ''],
    };
  }
  if (id === 'codex') {
    const cwd = path.join(os.tmpdir(), 'cutroom-codex');
    fs.mkdirSync(cwd, { recursive: true });
    return {
      cwd,
      env: {},
      args: [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--sandbox',
        'read-only',
        // Its own shell stays off in both modes; full access uses Cutroom's tools and keeps its web search
        ...['shell_tool', 'unified_exec', 'view_image', 'goals'].flatMap((f) => ['--disable', f]),
        ...(mcp ? [] : ['-c', 'web_search="disabled"']),
        '-c',
        `mcp_servers.cutroom.command=${toml(process.execPath)}`,
        '-c',
        `mcp_servers.cutroom.args=[${toml(MCP())}, ${toml(slug)}]`,
        '-c',
        `mcp_servers.cutroom.cwd=${toml(ROOT)}`,
        '-c',
        `mcp_servers.cutroom.env={${Object.entries({ ...mcpEnv(), ...(mcp ?? {}) })
          .map(([k, v]) => `${k} = ${toml(v)}`)
          .join(', ')}}`,
        '-c',
        'mcp_servers.cutroom.default_tools_approval_mode="approve"',
        // Voice-over and screen recordings take minutes
        '-c',
        `mcp_servers.cutroom.tool_timeout_sec=${mcp ? 1500 : 900}`,
        // Extra `-c key=value` lines, e.g. openai_base_url for a proxy
        ...(process.env.CUTROOM_CODEX_CONFIG ?? '').split('\n').filter((x) => x.trim()).flatMap((x) => ['-c', x.trim()]),
        ...(model ? ['-m', model] : []),
        ...(effort && CODEX_EFFORT[effort] ? ['-c', `model_reasoning_effort=${toml(CODEX_EFFORT[effort])}`] : []),
        '-',
      ],
    };
  }
  return {
    cwd: geminiWorkspace(slug),
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    args: ['-o', 'stream-json', '--approval-mode', 'yolo', '--allowed-mcp-server-names', 'cutroom', ...(model ? ['-m', model] : []), '-p', 'Follow the instructions and the request above.'],
  };
}

export type AgentEvent = { type: 'text'; delta: string } | { type: 'tool'; id: string; args: string[] } | { type: 'tool_result'; id: string; ok: boolean; out: string } | { type: 'error'; message: string } | { type: 'done' };

const textOf = (c: unknown): string => (Array.isArray(c) ? c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('') : typeof c === 'string' ? c : '');
const argsOf = (a: unknown): string[] => {
  const v = (a as { args?: unknown })?.args;
  return Array.isArray(v) ? v.map(String) : [];
};
// A call to one of Cutroom's MCP tools as one line: the editor's arguments, or the full-access shell and file tools
const mcpLabel = (tool: unknown, a: unknown): string[] => {
  const o = (a ?? {}) as Record<string, unknown>;
  if (tool === 'shell') return [String(o.command ?? '')];
  if (tool === 'read_file' || tool === 'write_file') return [`${tool === 'read_file' ? 'read' : 'write'} ${String(o.path ?? '')}`];
  return argsOf(a);
};

// One JSONL line from the agent → editor events
export function parseAgentLine(id: AgentId, line: string, state: { textSince: boolean; wrote: boolean; seen?: Set<string>; full?: boolean }): AgentEvent[] {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return [];
  }
  const out: AgentEvent[] = [];
  const text = (s: string) => {
    if (!s) return;
    // Text after tool calls starts a new paragraph
    if (state.wrote && !state.textSince) out.push({ type: 'text', delta: '\n\n' });
    state.wrote = true;
    state.textSince = true;
    out.push({ type: 'text', delta: s });
  };
  if (id === 'codex') {
    const it = m.item;
    if (m.type === 'item.started' && it?.type === 'mcp_tool_call') {
      state.textSince = false;
      out.push({ type: 'tool', id: it.id, args: mcpLabel(it.tool, it.arguments) });
    } else if (m.type === 'item.completed' && it?.type === 'mcp_tool_call') out.push({ type: 'tool_result', id: it.id, ok: it.status === 'completed' && !it.error, out: (textOf(it.result?.content) || it.error?.message || '').slice(0, 600) });
    // Full access: its own shell commands, file edits and web searches
    else if (m.type === 'item.started' && it?.type === 'command_execution') {
      state.textSince = false;
      out.push({ type: 'tool', id: it.id, args: [String(it.command ?? '')] });
    } else if (m.type === 'item.completed' && it?.type === 'command_execution') out.push({ type: 'tool_result', id: it.id, ok: it.exit_code === 0, out: String(it.aggregated_output ?? '').slice(0, 600) });
    else if (m.type === 'item.completed' && (it?.type === 'file_change' || it?.type === 'web_search')) {
      state.textSince = false;
      const label = it.type === 'web_search' ? `search ${String(it.query ?? '')}` : `edit ${(Array.isArray(it.changes) ? it.changes : []).map((c: { path?: string }) => c.path).filter(Boolean).join(', ')}`;
      out.push({ type: 'tool', id: it.id, args: [label] }, { type: 'tool_result', id: it.id, ok: it.status !== 'failed', out: '' });
    }
    else if (m.type === 'item.completed' && it?.type === 'agent_message') text(String(it.text ?? ''));
    else if (m.type === 'turn.failed') out.push({ type: 'error', message: String(m.error?.message ?? 'Codex turn failed').slice(0, 400) });
    // "Reconnecting... 2/5" is Codex retrying on its own, not a failure
    else if (m.type === 'error' && !/^Reconnecting/i.test(String(m.message))) out.push({ type: 'error', message: String(m.message ?? 'Codex error').slice(0, 400) });
    else if (m.type === 'turn.completed') out.push({ type: 'done' });
  } else if (id === 'antigravity') {
    const u = m.step_update;
    if (m.event === 'step_update' && u?.step_type === 'agent_response' && typeof u.text_delta === 'string') text(u.text_delta);
    else if (m.event === 'step_update' && u?.step_type === 'tool') {
      const ti = u.tool_info ?? {};
      const p = ti.parameters ?? {};
      const tid = `step-${u.step_index}`;
      // Editor only: just the editor's calls (its own tools are denied or read its tool list). Full access: its own tools too
      const mine = u.tool_name === 'call_mcp_tool' && p.ServerName === 'cutroom';
      if (mine || state.full) {
        const label = mine ? mcpLabel(p.ToolName, p.Arguments) : [`${u.tool_name} ${String(Object.values(p).find((v) => typeof v === 'string') ?? '')}`.trim()];
        // A step can arrive already finished, without an ACTIVE update first
        if ((u.state === 'ACTIVE' || u.state === 'DONE' || u.state === 'ERROR') && !state.seen?.has(tid)) {
          (state.seen ??= new Set()).add(tid);
          state.textSince = false;
          out.push({ type: 'tool', id: tid, args: label });
        }
        if (u.state === 'DONE' || u.state === 'ERROR') out.push({ type: 'tool_result', id: tid, ok: u.state === 'DONE', out: String(ti.output ?? ti.error?.message ?? '').slice(0, 600) });
      }
    } else if (m.event === 'result') {
      const r = m.result ?? {};
      const denied = (Array.isArray(r.denied_actions) ? r.denied_actions : []).map((d: { display_name?: string; action?: string }) => d.display_name ?? d.action).filter(Boolean);
      if (r.status !== 'SUCCESS') out.push({ type: 'error', message: String(r.error ?? 'Antigravity failed').slice(0, 400) });
      // Headless Antigravity ends the turn when a tool needs a permission it cannot ask for
      else if (denied.length) out.push({ type: 'error', message: L(`Antigravity stopped: it tried its own ${denied.join(', ')} tool, which Cutroom does not allow. Send the request again.`, `Antigravity 停下了：它想用自己的 ${denied.join('、')} 工具，剪辑台不允许。再发一次请求即可。`) });
      out.push({ type: 'done' });
    }
  } else {
    if (m.type === 'message' && m.role === 'assistant') text(String(m.content ?? ''));
    else if (m.type === 'tool_use') {
      state.textSince = false;
      out.push({ type: 'tool', id: String(m.tool_id), args: argsOf(m.parameters) });
    } else if (m.type === 'tool_result') out.push({ type: 'tool_result', id: String(m.tool_id), ok: m.status === 'success', out: String(m.output ?? m.error?.message ?? '').slice(0, 600) });
    else if (m.type === 'error' && m.severity === 'error') out.push({ type: 'error', message: String(m.message).slice(0, 400) });
    else if (m.type === 'result') {
      if (m.status === 'error') out.push({ type: 'error', message: String(m.error?.message ?? 'Gemini CLI failed').slice(0, 400) });
      out.push({ type: 'done' });
    }
  }
  return out;
}

export interface AgentRun {
  child: ChildProcess;
  kill: () => void;
}

// Start the agent with the whole prompt on stdin (instructions are too long for a Windows command line)
export function startAgent(id: AgentId, slug: string, model: string | undefined, prompt: string, onEvent: (e: AgentEvent) => void, onExit: (code: number | null, stderr: string) => void, o: AgentOpts = {}): AgentRun | null {
  const l = cliOf(agentDef(id)!);
  if (!l) return null;
  const { args, cwd, env } = agentArgs(id, slug, model, o);
  const child = spawn(l.cmd, [...l.pre, ...args], { cwd, windowsHide: true, env: { ...process.env, ...env } });
  const state = { textSince: false, wrote: false, full: !!o.full };
  let buf = '';
  let err = '';
  child.stdout!.on('data', (d) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) for (const e of parseAgentLine(id, line, state)) onEvent(e);
    }
  });
  child.stderr!.on('data', (d) => (err += d));
  child.on('close', (code) => onExit(code, err));
  child.stdin!.end(id === 'antigravity' ? `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n` : prompt);
  const kill = () => killTree(child);
  return { child, kill };
}

// A terminal window running the agent's own sign-in (browser login)
export function openSignIn(id: AgentId): boolean {
  const def = agentDef(id)!;
  const l = cliOf(def);
  if (!l) return false;
  // The terminal finds the CLI even when its folder is not on PATH
  const env = { ...process.env, PATH: [...(def.dirs?.() ?? []), process.env.PATH ?? ''].join(path.delimiter) };
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', def.login], { detached: true, stdio: 'ignore', windowsHide: false, env }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell app "Terminal" to do script "${def.dirs ? `export PATH=${def.dirs().join(':')}:$PATH; ` : ''}${def.login}"`], { detached: true, stdio: 'ignore' }).unref();
  else spawn('x-terminal-emulator', ['-e', def.login], { detached: true, stdio: 'ignore', env }).unref();
  forgetAgents();
  return true;
}

// npm install -g, when npm is available
export function installAgent(id: AgentId): Promise<{ ok: boolean; out: string }> {
  const def = agentDef(id)!;
  const pkg = def.pkg;
  if (!pkg) return Promise.resolve({ ok: false, out: `Download it from ${def.url}` });
  // The npm that ships with this Node, else one on PATH
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npm: Launch | null = fs.existsSync(bundled) ? { cmd: process.execPath, pre: [bundled], path: bundled } : findCli('npm');
  if (!npm) return Promise.resolve({ ok: false, out: 'npm not found' });
  return new Promise((resolve) => {
    execFile(npm.cmd, [...npm.pre, 'install', '-g', pkg], { windowsHide: true, timeout: 10 * 60_000 }, (e, so, se) => {
      forgetAgents();
      resolve({ ok: !e, out: `${so}${se}`.slice(-600) });
    });
  });
}
