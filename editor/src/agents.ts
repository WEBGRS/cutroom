// Subscriptions through the vendors' own command-line agents (ChatGPT via Codex CLI, Google via Gemini CLI).
// The agent gets exactly one tool, the editor CLI, served by editor/dist/mcp.mjs; its own shell and file tools are switched off.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './store';

export type AgentId = 'codex' | 'gemini';

export interface AgentDef {
  id: AgentId;
  en: string;
  zh: string;
  bin: string;
  pkg: string;
  plansEn: string;
  plansZh: string;
  login: string;
}

export const AGENTS: AgentDef[] = [
  { id: 'codex', en: 'ChatGPT (Codex CLI)', zh: 'ChatGPT（Codex CLI）', bin: 'codex', pkg: '@openai/codex', plansEn: 'ChatGPT Plus, Pro, Business, Edu or Enterprise', plansZh: 'ChatGPT Plus、Pro、Business、Edu 或 Enterprise', login: 'codex login' },
  { id: 'gemini', en: 'Google Gemini (Gemini CLI)', zh: 'Google Gemini（Gemini CLI）', bin: 'gemini', pkg: '@google/gemini-cli', plansEn: 'Any Google account (free daily quota), Google AI Pro or Ultra', plansZh: '任意 Google 账号（每日免费额度）、Google AI Pro 或 Ultra', login: 'gemini' },
];

export const agentDef = (id: string | undefined) => AGENTS.find((a) => a.id === id);

// How to start a CLI: a native exe, or node + the script behind an npm .cmd shim (so no shell is needed)
export interface Launch {
  cmd: string;
  pre: string[];
  path: string;
}

export function findCli(name: string): Launch | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
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
}

// Login checks cost no tokens; cached so the settings page can poll
const cache = new Map<AgentId, { t: number; v: AgentState }>();
export const forgetAgents = () => cache.clear();

export async function agentState(id: AgentId): Promise<AgentState> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < 30_000) return hit.v;
  const def = agentDef(id)!;
  const l = findCli(def.bin);
  const v: AgentState = { id, installed: !!l, path: l?.path ?? null, version: null, loggedIn: null, method: null };
  if (l) {
    const ver = await run(l, ['--version']);
    v.version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(ver.out)?.[1] ?? null;
    if (id === 'codex') {
      const s = await run(l, ['login', 'status']);
      v.loggedIn = /not logged in/i.test(s.out) ? false : /logged in/i.test(s.out) ? true : null;
      v.method = /chatgpt/i.test(s.out) ? 'ChatGPT' : /api key/i.test(s.out) ? 'API key' : null;
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
const mcpEnv = (): Record<string, string> => Object.fromEntries(['VS_DATA', 'VS_ROOT', 'ELECTRON_RUN_AS_NODE'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));

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

export function agentArgs(id: AgentId, slug: string, model: string | undefined): { args: string[]; cwd: string; env: Record<string, string> } {
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
        ...['shell_tool', 'unified_exec', 'view_image', 'goals'].flatMap((f) => ['--disable', f]),
        '-c',
        'web_search="disabled"',
        '-c',
        `mcp_servers.cutroom.command=${toml(process.execPath)}`,
        '-c',
        `mcp_servers.cutroom.args=[${toml(MCP())}, ${toml(slug)}]`,
        '-c',
        `mcp_servers.cutroom.cwd=${toml(ROOT)}`,
        '-c',
        `mcp_servers.cutroom.env={${Object.entries(mcpEnv())
          .map(([k, v]) => `${k} = ${toml(v)}`)
          .join(', ')}}`,
        '-c',
        'mcp_servers.cutroom.default_tools_approval_mode="approve"',
        // Voice-over and screen recordings take minutes
        '-c',
        'mcp_servers.cutroom.tool_timeout_sec=900',
        // Extra `-c key=value` lines, e.g. openai_base_url for a proxy
        ...(process.env.CUTROOM_CODEX_CONFIG ?? '').split('\n').filter((x) => x.trim()).flatMap((x) => ['-c', x.trim()]),
        ...(model ? ['-m', model] : []),
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

// One JSONL line from the agent → editor events
export function parseAgentLine(id: AgentId, line: string, state: { textSince: boolean; wrote: boolean }): AgentEvent[] {
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
      out.push({ type: 'tool', id: it.id, args: argsOf(it.arguments) });
    } else if (m.type === 'item.completed' && it?.type === 'mcp_tool_call') out.push({ type: 'tool_result', id: it.id, ok: it.status === 'completed' && !it.error, out: (textOf(it.result?.content) || it.error?.message || '').slice(0, 600) });
    else if (m.type === 'item.completed' && it?.type === 'agent_message') text(String(it.text ?? ''));
    else if (m.type === 'turn.failed') out.push({ type: 'error', message: String(m.error?.message ?? 'Codex turn failed').slice(0, 400) });
    // "Reconnecting... 2/5" is Codex retrying on its own, not a failure
    else if (m.type === 'error' && !/^Reconnecting/i.test(String(m.message))) out.push({ type: 'error', message: String(m.message ?? 'Codex error').slice(0, 400) });
    else if (m.type === 'turn.completed') out.push({ type: 'done' });
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
export function startAgent(id: AgentId, slug: string, model: string | undefined, prompt: string, onEvent: (e: AgentEvent) => void, onExit: (code: number | null, stderr: string) => void): AgentRun | null {
  const l = findCli(agentDef(id)!.bin);
  if (!l) return null;
  const { args, cwd, env } = agentArgs(id, slug, model);
  const child = spawn(l.cmd, [...l.pre, ...args], { cwd, windowsHide: true, env: { ...process.env, ...env } });
  const state = { textSince: false, wrote: false };
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
  child.stdin!.end(prompt);
  const kill = () => {
    if (child.pid && process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill();
  };
  return { child, kill };
}

// A terminal window running the agent's own sign-in (browser login)
export function openSignIn(id: AgentId): boolean {
  const def = agentDef(id)!;
  if (!findCli(def.bin)) return false;
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '""', 'cmd', '/k', def.login], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell app "Terminal" to do script "${def.login}"`], { detached: true, stdio: 'ignore' }).unref();
  else spawn('x-terminal-emulator', ['-e', def.login], { detached: true, stdio: 'ignore' }).unref();
  forgetAgents();
  return true;
}

// npm install -g, when npm is available
export function installAgent(id: AgentId): Promise<{ ok: boolean; out: string }> {
  const def = agentDef(id)!;
  // The npm that ships with this Node, else one on PATH
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npm: Launch | null = fs.existsSync(bundled) ? { cmd: process.execPath, pre: [bundled], path: bundled } : findCli('npm');
  if (!npm) return Promise.resolve({ ok: false, out: 'npm not found' });
  return new Promise((resolve) => {
    execFile(npm.cmd, [...npm.pre, 'install', '-g', def.pkg], { windowsHide: true, timeout: 10 * 60_000 }, (e, so, se) => {
      forgetAgents();
      resolve({ ok: !e, out: `${so}${se}`.slice(-600) });
    });
  });
}
