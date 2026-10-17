import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { PUBLIC, ROOT, STATE, appendLog, hash, snapshot } from './store';
import { killTree } from './proc';
import { HELP } from './help';
import { imagesIn, lookReadRule, pathRule } from './look';
import { catalogText } from './catalog';
import { rulesBlock } from './rules';
import { L, readSettings, writeSettings } from './settings';
import { PRESETS, chatLoop, listModels, pickModel, ping, preset, trimHistory, type Conn } from './compat';
import { AGENTS, agentDef, agentState, cliOf, forgetAgents, mcpEnv, startAgent, type AgentId } from './agents';
import { FULL_TOOLS, fullLabel, isFullTool, runFullTool, type FullResult } from './fulltools';
import { list as checkpoints, fileAt, noteOutside, placeOf, rollback, take, type Rollback } from './checkpoints';

export type ChatEvent =
  | { type: 'start'; provider: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; cmd: string }
  | { type: 'tool_result'; id: string; ok: boolean; out: string }
  | { type: 'done'; ms: number; cost?: number }
  | { type: 'error'; message: string }
  // Full access: a step that needs the user's go-ahead, and the answer
  | { type: 'ask'; id: string; cmd: string; detail: string }
  | { type: 'asked'; id: string; allow: boolean }
  | { type: 'checkpoint'; id: string };

export interface ChatContext {
  format: string;
  lang: string;
  variant: string;
  sel?: string | null;
  t?: number;
}

interface LogItem {
  role: 'user' | 'assistant' | 'event';
  text: string;
  // user: the checkpoint taken just before this message; event (a rollback): the checkpoint that undoes it
  cp?: string;
  refs?: string[];
  tools?: { cmd: string; ok: boolean }[];
  t: string;
}

interface Saved {
  sessionId?: string;
  // Told to the assistant with the next message (a rollback since its last turn)
  note?: string;
  // Folder the Claude Code session runs in (a session resumes only there)
  cwd?: string;
  api?: Anthropic.Beta.BetaMessageParam[];
  // OpenAI-compatible conversation, kept only while provider, address and model stay the same
  compat?: { id: string; messages: Record<string, unknown>[] };
  log: LogItem[];
}

const CLI = 'node editor/dist/cli.mjs';
// Full access runs Claude Code in the project folder, so the CLI is called by its full path there
const cliScript = path.join(ROOT, 'editor', 'dist', 'cli.mjs').replace(/\\/g, '/');
const CLI_ABS = `node ${/\s/.test(cliScript) ? `"${cliScript}"` : cliScript}`;
const file = (slug: string) => path.join(STATE, slug, 'chat.json');
const load = (slug: string): Saved => {
  try {
    return JSON.parse(fs.readFileSync(file(slug), 'utf8'));
  } catch {
    return { log: [] };
  }
};
const save = (slug: string, s: Saved) => {
  fs.mkdirSync(path.dirname(file(slug)), { recursive: true });
  fs.writeFileSync(file(slug), JSON.stringify(s));
};

export const history = (slug: string) => load(slug).log;
export const reset = (slug: string) => {
  allowAll.delete(slug);
  save(slug, { log: [] });
};

// Claude Code binary: CLAUDE_BIN, or claude(.exe) on PATH, or the native exe behind an npm shim
export function findClaude(): string | null {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
    const shim = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if ((fs.existsSync(path.join(dir, 'claude.ps1')) || fs.existsSync(path.join(dir, 'claude.cmd'))) && fs.existsSync(shim)) return shim;
  }
  return null;
}

// Connection settings saved from the AI panel; the key never leaves this machine
interface AiSettings {
  pref?: 'auto' | 'claude-code' | 'anthropic' | 'compat' | 'agent';
  apiKey?: string;
  // Another subscription through its own CLI (Codex, Gemini CLI, Antigravity), with an optional model per agent
  agent?: { id?: AgentId; models?: Record<string, string> };
  // Other providers: chosen preset, address override (custom), model, one saved key per preset
  compat?: { preset?: string; base?: string; model?: string; keys?: Record<string, string> };
  // Reasoning effort for the connections that take one
  effort?: string;
  // Model for the Claude Code login and the Claude API key
  models?: { 'claude-code'?: string; anthropic?: string };
  // editor: only Cutroom's own commands; full: every tool, risky steps wait for the user's go-ahead in the panel;
  // auto: every tool and nothing waits (checkpoints before each message make it undoable)
  access?: 'editor' | 'full' | 'auto';
}
export interface CompatPatch {
  preset?: string;
  base?: string;
  model?: string;
  key?: string | null;
}
export const readAi = (): AiSettings => readSettings().ai ?? {};
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export function writeAi(patch: { pref?: string; apiKey?: string | null; compat?: CompatPatch; agent?: { id?: string; model?: string }; effort?: string; model?: { provider?: string; value?: string }; access?: string }) {
  const ai: AiSettings = { ...(readSettings().ai ?? {}) };
  if (patch.access !== undefined) ai.access = patch.access === 'full' || patch.access === 'auto' ? patch.access : 'editor';
  if (patch.effort !== undefined) {
    if (EFFORTS.includes(patch.effort)) ai.effort = patch.effort;
    else delete ai.effort;
  }
  // The model of whichever connection the panel is using
  const m = patch.model;
  if (m && typeof m.value === 'string') {
    const v = m.value.trim();
    if (m.provider === 'claude-code' || m.provider === 'anthropic') {
      ai.models = { ...(ai.models ?? {}) };
      if (v) ai.models[m.provider] = v;
      else delete ai.models[m.provider];
    } else if (m.provider === 'compat') patch.compat = { ...(patch.compat ?? {}), model: v };
    else if (m.provider === 'agent' && ai.agent?.id) patch.agent = { id: ai.agent.id, model: v };
  }
  if (patch.pref !== undefined) ai.pref = ['claude-code', 'anthropic', 'compat', 'agent'].includes(patch.pref) ? (patch.pref as AiSettings['pref']) : 'auto';
  if (patch.agent && typeof patch.agent === 'object') {
    const a = { ...(ai.agent ?? {}), models: { ...(ai.agent?.models ?? {}) } };
    if (typeof patch.agent.id === 'string' && agentDef(patch.agent.id)) a.id = patch.agent.id as AgentId;
    if (a.id && typeof patch.agent.model === 'string') {
      const m = patch.agent.model.trim();
      if (m) a.models[a.id] = m;
      else delete a.models[a.id];
    }
    ai.agent = a;
  }
  if (patch.apiKey === null || patch.apiKey === '') delete ai.apiKey;
  else if (typeof patch.apiKey === 'string') ai.apiKey = patch.apiKey.trim();
  const p = patch.compat;
  if (p && typeof p === 'object') {
    const c = { ...(ai.compat ?? {}), keys: { ...(ai.compat?.keys ?? {}) } };
    // Another provider starts from its own address and model
    if (typeof p.preset === 'string' && preset(p.preset) && p.preset !== c.preset) {
      c.preset = p.preset;
      delete c.base;
      delete c.model;
    }
    if (typeof p.base === 'string') {
      const b = p.base.trim();
      if (b && !/^https?:\/\//i.test(b)) throw new Error(L('The address must start with http:// or https://', '地址要以 http:// 或 https:// 开头'));
      if (b && b !== preset(c.preset)?.base) c.base = b;
      else delete c.base;
    }
    if (typeof p.model === 'string') c.model = p.model.trim() || undefined;
    if (c.preset && p.key === null) delete c.keys[c.preset];
    else if (c.preset && typeof p.key === 'string' && p.key.trim()) c.keys[c.preset] = p.key.trim();
    ai.compat = c;
  }
  writeSettings({ ai });
  authCache = null;
}

// The other-provider connection as configured; env keys (OPENAI_API_KEY, ...) win over saved ones
function compatConn(): (Conn & { keySource: 'env' | 'file' | null }) | null {
  const s = readAi().compat ?? {};
  const p = preset(s.preset);
  if (!p) return null;
  const env = p.env ? (process.env[p.env] ?? '') : '';
  const file = s.keys?.[p.id] ?? '';
  return { preset: p.id, base: (s.base || p.base).trim(), model: s.model ?? '', key: env || file, keySource: env ? 'env' : file ? 'file' : null };
}
const compatReady = (c: Conn | null) => !!c && !!c.base && !!c.model && (!!c.key || !!preset(c.preset)?.noKey || c.preset === 'custom');
const apiKey = () => process.env.ANTHROPIC_API_KEY || readAi().apiKey || '';
const pref = () => readAi().pref ?? (process.env.EDITOR_AI === 'anthropic' ? 'anthropic' : 'auto');

// `claude auth status` costs no tokens; cached so the panel can poll it
let authCache: { t: number; v: { loggedIn: boolean; method?: string; plan?: string } | null } | null = null;
function claudeAuth(bin: string): Promise<{ loggedIn: boolean; method?: string; plan?: string } | null> {
  if (authCache && Date.now() - authCache.t < 60_000) return Promise.resolve(authCache.v);
  return new Promise((resolve) => {
    execFile(bin, ['auth', 'status', '--json'], { windowsHide: true, timeout: 15_000 }, (err, out) => {
      let v: { loggedIn: boolean; method?: string; plan?: string } | null = null;
      try {
        const j = JSON.parse(out);
        v = { loggedIn: !!j.loggedIn, method: j.authMethod, plan: j.subscriptionType };
      } catch {
        v = err ? null : { loggedIn: false };
      }
      authCache = { t: Date.now(), v };
      resolve(v);
    });
  });
}
const claudeVersion = (bin: string) =>
  new Promise<string | null>((resolve) => execFile(bin, ['--version'], { windowsHide: true, timeout: 10_000 }, (err, out) => resolve(err ? null : out.trim().split(/\s/)[0])));

export type Provider = 'claude-code' | 'anthropic' | 'compat' | 'agent';

// The chosen subscription agent, if its CLI is installed
const chosenAgent = (): AgentId | null => {
  const id = readAi().agent?.id;
  const def = agentDef(id);
  return def && cliOf(def) ? def.id : null;
};
const agentModel = (id: AgentId) => readAi().agent?.models?.[id];
export const aiAccess = (): 'editor' | 'full' | 'auto' => {
  const a = readAi().access;
  return a === 'full' || a === 'auto' ? a : 'editor';
};
// Both full modes give the assistant every tool; they differ only in asking
const fullOn = () => aiAccess() !== 'editor';
const aiEffort = () => {
  const e = readAi().effort;
  return e && EFFORTS.includes(e) ? e : undefined;
};
// Models offered for the Claude connections ('' = the tool's own default)
export const CLAUDE_CODE_MODELS = ['', 'claude-fable-5-1', 'opus', 'sonnet', 'haiku'];
export const API_MODELS = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

export function provider(): Provider | null {
  const p = pref();
  if (p === 'anthropic') return apiKey() ? 'anthropic' : null;
  if (p === 'claude-code') return findClaude() ? 'claude-code' : null;
  if (p === 'compat') return compatReady(compatConn()) ? 'compat' : null;
  if (p === 'agent') return chosenAgent() ? 'agent' : null;
  // Auto: the local login first, unless it is known to be logged out and a key exists
  if (findClaude() && !(authCache?.v && !authCache.v.loggedIn && apiKey())) return 'claude-code';
  if (apiKey()) return 'anthropic';
  if (compatReady(compatConn())) return 'compat';
  return null;
}

const mask = (k: string) => (k.length > 14 ? `${k.slice(0, 10)}…${k.slice(-4)}` : '••••');

export async function aiStatus() {
  const bin = findClaude();
  const [auth, version] = bin ? await Promise.all([claudeAuth(bin), claudeVersion(bin)]) : [null, null];
  const key = apiKey();
  return {
    provider: provider(),
    pref: pref(),
    claude: bin ? { path: bin, version, loggedIn: auth?.loggedIn ?? null, method: auth?.method ?? null, plan: auth?.plan ?? null } : null,
    key: key ? { source: process.env.ANTHROPIC_API_KEY ? 'env' : 'file', masked: mask(key) } : null,
    compat: compatStatus(),
    effort: aiEffort() ?? '',
    models: { 'claude-code': readAi().models?.['claude-code'] ?? '', anthropic: readAi().models?.anthropic ?? API_MODELS[0] },
    modelChoices: { 'claude-code': CLAUDE_CODE_MODELS, anthropic: API_MODELS },
    access: aiAccess(),
    agent: readAi().agent?.id ?? null,
    agents: await Promise.all(AGENTS.map(async (a) => ({ ...(await agentState(a.id)), en: a.en, zh: a.zh, plansEn: a.plansEn, plansZh: a.plansZh, login: a.login, pkg: a.pkg, url: a.url, model: agentModel(a.id) ?? '' }))),
    presets: PRESETS.map(({ id, en, zh, base, keyUrl, env, noKey }) => ({ id, en, zh, base, keyUrl, env, noKey })),
  };
}

function compatStatus() {
  const c = compatConn();
  if (!c) return null;
  return { preset: c.preset, base: c.base, model: c.model, key: c.key ? { source: c.keySource, masked: mask(c.key) } : null, ready: compatReady(c) };
}

// Readable reason for a failed request to another provider
function compatError(e: unknown, c: Conn): string {
  const st = (e as { status?: number }).status;
  const m = (e as Error).message ?? String(e);
  if (st === 401 || st === 403) return L(`The key was rejected (${st}): ${m.slice(4, 160)}`, `Key 被拒绝（${st}）：${m.slice(4, 160)}`);
  if (st === 404) return L(`Not found (404): check the address and the model name. ${m.slice(4, 160)}`, `找不到（404）：检查地址和模型名。${m.slice(4, 160)}`);
  if (st === 429) return L('Rate limit or no balance left on this account (429)', '请求太频繁或账户余额不足（429）');
  if (/ECONNREFUSED|fetch failed/i.test(m + String((e as { cause?: unknown }).cause ?? ''))) return c.preset === 'ollama' ? L('Ollama is not running: start it, then pull a model, e.g. ollama pull qwen3', 'Ollama 没有在运行：先启动它，再拉一个模型，比如 ollama pull qwen3') : L(`Could not reach ${c.base}`, `连不上 ${c.base}`);
  return m.slice(0, 300);
}

// Models the provider offers; also settles which one is used
export async function compatModels(): Promise<{ models: string[]; model: string; error?: string }> {
  const c = compatConn();
  if (!c || !c.base) return { models: [], model: '', error: L('Choose a provider first', '先选择服务商') };
  if (!c.key && !preset(c.preset)?.noKey && c.preset !== 'custom') return { models: [], model: c.model, error: L('Save an API key first', '先保存 API Key') };
  try {
    const models = await listModels(c);
    const model = pickModel(models, c.model, preset(c.preset)?.model ?? '');
    if (model && model !== c.model) writeAi({ compat: { model } });
    return { models, model };
  } catch (e) {
    return { models: [], model: c.model, error: compatError(e, c) };
  }
}

// One tiny real request through whichever connection is active
export async function aiTest(): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = Date.now();
  const prov = provider();
  const done = (ok: boolean, message: string) => ({ ok, message, ms: Date.now() - t0 });
  if (!prov) return done(false, L('No connection yet: sign in to Claude Code or add an API key', '还没有可用的连接：登录 Claude Code，或者填一个 API Key'));
  if (prov === 'agent') {
    const id = chosenAgent()!;
    forgetAgents();
    const st = await agentState(id);
    if (st.loggedIn === false) return done(false, L(`${agentDef(id)!.en} is installed but not signed in`, `${agentDef(id)!.zh} 已安装，但还没登录`));
    return new Promise((resolve) => {
      let text = '';
      let error = '';
      const r = startAgent(
        id,
        '_',
        agentModel(id),
        'Reply with the single word OK. Do not use any tools.',
        (e) => {
          if (e.type === 'text') text += e.delta;
          if (e.type === 'error') error = e.message;
        },
        (code, stderr) => {
          clearTimeout(timer);
          if (text.trim() && !error) resolve(done(true, L(`${agentDef(id)!.en} works`, `${agentDef(id)!.zh} 可用`)));
          else resolve(done(false, (error || stderr.trim().split('\n').slice(-3).join(' ') || L(`It exited (${code}) without an answer`, `没有回答就退出了（${code}）`)).slice(0, 300)));
        },
      );
      const timer = setTimeout(() => r?.kill(), 120_000);
      if (!r) resolve(done(false, L('The command was not found', '找不到这个命令')));
    });
  }
  if (prov === 'compat') {
    const c = compatConn()!;
    try {
      const m = await ping(c);
      return done(true, L(`Works; answered by ${m}`, `可用，由 ${m} 回答`));
    } catch (e) {
      return done(false, compatError(e, c));
    }
  }
  if (prov === 'anthropic') {
    try {
      const m = await new Anthropic({ apiKey: apiKey() }).models.retrieve('claude-opus-5-5');
      return done(true, L(`API key works; model ${m.display_name ?? m.id}`, `API Key 可用，模型 ${m.display_name ?? m.id}`));
    } catch (e) {
      const st = (e as { status?: number }).status;
      return done(false, st === 401 ? L('Invalid API key (401)', 'API Key 无效（401）') : st === 403 ? L('This key has no access (403)', '这个 Key 没有权限（403）') : L(`Connection failed: ${(e as Error).message.slice(0, 160)}`, `连接失败：${(e as Error).message.slice(0, 160)}`));
    }
  }
  return new Promise((resolve) => {
    const child = spawn(findClaude()!, ['-p', '--output-format', 'json', '--model', 'haiku', '--max-turns', '1', '--setting-sources', 'project,local', '--strict-mcp-config'], { cwd: ROOT, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdin!.end('Reply with the single word OK.');
    child.stdout!.on('data', (d) => (out += d));
    child.stderr!.on('data', (d) => (err += d));
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return resolve(done(false, String(j.result ?? L('Claude Code returned an error', 'Claude Code 返回错误')).slice(0, 200)));
        const model = Object.keys(j.modelUsage ?? {})[0];
        resolve(done(true, L(`Claude Code works${model ? `; tested with ${model}` : ''}`, `Claude Code 可用${model ? `，测试用 ${model}` : ''}`)));
      } catch {
        resolve(done(false, (err || out || L('Claude Code did not answer', 'Claude Code 没有回应')).trim().slice(-200)));
      }
    });
  });
}

// How the model reaches the CLI: Claude Code runs it through Bash; API connections call one `editor` tool
const TOOL_DESC = (slug: string) =>
  `Run one Cutroom CLI command for project "${slug}". Pass the command and its arguments as an array, e.g. ["ls","--format","tall"], ["trim","record","--to","@filter+0.8"], ["set","intro","fx.look","\\"warm\\""]. Output is the command's stdout. Recording, voice-over, look and export can take minutes (record-window waits for the person to press Stop).`;

// via: bash = Claude Code; tool = an `editor` tool whose results carry the frames; files = an `editor` tool, frames opened as files
export function systemPrompt(slug: string, via: 'bash' | 'tool' | 'files' = 'bash', fullAccess?: boolean, askNothing?: boolean): string {
  const full = fullAccess ?? fullOn();
  const auto = full && (askNothing ?? aiAccess() === 'auto');
  const how =
    via === 'bash'
      ? full
        ? `- Edit the video with the Cutroom CLI through Bash (your working directory is the project folder):
  ${CLI_ABS} ${slug} <command> ...
  Timeline changes always go through it: it keeps versions, the undo history and the live preview in sync. Never edit storyboard.json by hand.`
        : `- Use only the Bash tool, and only this command form (the working directory is already the project root; never cd, never edit files directly, never run other programs):
  ${CLI} ${slug} <command> ...`
      : `- ${full ? 'Edit the video with' : 'Use only'} the \`editor\` tool. Give it the command and its arguments as an array of strings, without any program name or project id: ["ls","--format","wide"], ["show","intro"], ["set","intro","fx.look","\\"warm\\""]. JSON values for \`set\` are passed as one string.${full ? ' Timeline changes always go through it (versions, undo, live preview); never edit storyboard.json by hand.' : ''}`;
  const access = full
    ? `
- You also have the access a developer has in their own terminal: write files (HTML scenes, SVG, scripts, subtitles), run programs (ffmpeg, python, node, git, package managers), read the user's code and documents, search and read the web, and use any skills and MCP servers you have. Use them whenever the editor alone can't do what was asked.${via === 'bash' ? '' : ' Do it with the `shell`, `read_file` and `write_file` tools next to the editor (relative paths are in the project folder); your own shell and file tools are off here. You can write files: `write_file` works inside the project folder at once and elsewhere ' + (auto ? 'too.' : 'after the user allows it.')}
- The project folder is ${path.join(PUBLIC, slug)}: recordings in cap/, images and video in media/, HTML scenes in scenes/<name>/. Files placed there can be used at once (\`add\`, \`swap\`, image overlays).
${
        auto
          ? `- The user turned approvals off: every step runs at once. Before each message the editor saves a checkpoint of the project folder (and of files you change outside it with your file tools), and the user can roll back to it from the chat. Shell commands that change things outside the project folder can't be rolled back, so before deleting the user's files outside the project, pushing to git or spending money, say what you will do and ask in your reply.`
          : `- Risky steps (shell commands, writing outside the project folder) wait for the user to approve them in the panel, or run in your sandbox; if one is declined, find another way or say what you need. Ask before deleting or overwriting the user's files outside the project, pushing to git or spending money.`
      }`
    : '';
  const port = process.env.PORT ?? 8814;
  return `You are the editing assistant inside Cutroom, a video editor for software demos: product walkthroughs, launch videos and release clips built from screen recordings. You are talking to the user through a small chat panel next to a live preview of project "${slug}". Every change you make through the CLI appears in the preview within a second.

## Calling the editor
${how}${access}
- ${full ? (via === 'bash' ? 'Write the editor command out in full every time, alone or several joined with && (no cd, no variables or aliases, no pipes): written that way it runs at once, while any other shell line waits for the user to approve it. ' : '') : 'One CLI command per Bash call, or several joined with &&. Shell loops and variables are blocked; '}\`show a b c\` or \`show all\` prints several scenes at once.
- Write nothing between commands: no progress notes. Your only text is the final reply, in the user's language.
- Some commands take minutes (record, record-window, voice, look, export). Wait for them; don't run them twice.
- When a command fails, read its message: it says what was wrong and usually the command that fixes it.

## Workflow: do the steps the request needs, in this order
0. Size first. Before you make the first version of a video (a new or empty project, or a request to make or rebuild a whole video), the size must be known: 16:9 widescreen (Bilibili, YouTube) or 9:16 vertical (Douyin, Xiaohongshu, Shorts, Reels). Take it from the request when it names one or a platform that implies one; otherwise ask only that, in one sentence, and stop until they answer. Then record it with \`set - format '"wide"'\` or \`set - format '"tall"'\` (the editor's preview switches to it) and build for it: \`ls\` and \`look\` with that --format, HTML scenes at its size, \`reframe\` for footage in 9:16. A project whose board already has a format has its size; don't ask again.
1. Find out first. \`ls\` (with the --format of the user's current view, given in each message) shows the timeline; \`show <id>\` a scene's JSON; \`media\` the footage the project already has; \`windows <word>\` the apps open on this computer. Never ask the user for something these tell you. For a request to improve, restructure or review the video, also run \`plan\`: per scene what the narration says, what the picture shows and the text on screen, with notes where the picture only repeats the words or the words describe an action no footage shows.
2. Shot list, before any recording for a new video or a rebuild: for each narration line write the page and the action that shows it ("courses site: search COMP SCI 400, open it, the grade chart"). Every site, page or feature the narration names gets footage of its own; a line goes only over footage of what it says. A home page that lists or links to things is not footage of those things: record each of them. Plan one scene per line or per page, and build from that list.
3. Get the footage. Choose by what has to be on screen:
   - A website or web app: \`inspect <url>\`, then \`record <name> <url> '<steps>'\`. You work it (scripted clicks and typing).
   - Cutroom itself: \`record\` with this editor's address (below). You work it.
   - A desktop app (JianyingPro/剪映, DaVinci Resolve, Excel, an IDE, a game, anything not in a browser): \`windows <word>\` to find it, then \`record-window <name> "<program or title>" --note "<what to do>" --marks <beat1>,<beat2>\`. The PERSON works the app while a record bar on their screen shows your note; the command returns when they press Stop. Clicks and pointer moves are logged, so the camera zooms in on each click like in a web recording.
   - Several apps or the desktop: \`record-screen <name> [n] --note … --marks …\`, worked by the person the same way.
   - A video they already have (OBS, Game Bar, a phone, an export): \`import <path>\`; name its key moments with \`mark <recording> <name> <seconds>\` (find them with \`look\` or \`shots\`).
   - Something that doesn't exist as footage (numbers, a diagram, a comparison, a title): a card (\`add <kind>\`) or an HTML scene.
4. Put it on the timeline. A new scene: \`add screen cap/<name>.mp4 <after-id>\`. Different footage in an existing scene (keeps its lines, sounds and transition; overlays made for the old picture are removed): \`swap <id> cap/<name>.mp4\`. Show only the part that matters: \`trim <id> --from @mark --to @mark\`.
5. Words. Narration lines: \`set <id> lines '[…]'\` or \`set <id> lines.<k>.zh "…"\`; tie a line to the moment it describes with "at": "@mark".
6. Voice. Run \`voice\` after lines change (it only voices lines without current audio).
7. Look, line by line. \`look lines\` renders one frame in the middle of every narration line with that line's caption on it. Open every frame and check that the picture shows what its line says (the page, the feature, the result it names); for each one that doesn't, fix it (record the right page, swap, trim, move or rewrite the line) and look again. \`look <id>\` checks layout, text and colour in a scene.
8. Check. Run \`check\` after your last edit (again if you changed anything since) and fix what it lists. A recording shorter than its narration can't be fixed by you alone: shorten the lines, or say in the reply that a longer recording is needed and how long.
9. Reply (rules at the end).

## Recording desktop apps (record-window / record-screen)
- You can't click in desktop apps; the person can. So you never say a desktop app "can't be recorded": you record it through them.
- The --note is all the person reads while recording: one or two short sentences in their language with the exact actions in order, ending with when to press Stop. Mention Mark (F9) when you gave --marks. Example: --note "在剪映里把 demo.mp4 拖到时间线上（拖完按 F9），再点导出（导出窗口出现后按 F9），然后点停止" --marks drag,export.
- --marks are the beats you will caption, in the order they happen. A missed Mark is fixed afterwards with \`mark\`.
- If \`windows <word>\` lists nothing, the app is not open: ask the user to open it instead of recording another window. A minimized window must be restored first.
- Start a desktop recording only when the user asked for footage of that app or agreed to make it: it takes their time. When they only asked whether something is possible, answer with the concrete plan in one or two sentences (which scenes, which app, what they would do) and ask whether to start.
- Menus and pop-ups of the app are separate windows: when the actions open them, add --area (records the window's place on screen, menus included).
- Desktop recordings have no saved steps, so \`rerecord\` can't redo them; record again with the same name and --replace.

## Editing rules
- Make the smallest edit that does what was asked. Prefer the dedicated commands (trim/split/mv/add/swap/bars/min) over \`set\`.
- A scene's \`visual\` is shared by the 16:9 and 9:16 versions. To change only the 9:16 one, run \`tall <id> on\` and edit \`tall.*\` instead.
- Effects marked [house rule] go against the user's own style guide: don't use them unless the user explicitly asks.
- You can see the video: \`look\` renders frames exactly as exported (\`look record photo+2.5 0:31\`; no arguments = a spread of scenes; add --format tall for the 9:16 version). ${via === 'bash' ? `Then open every image path it prints with the Read tool${full ? '' : ' (Read works only there)'}.` : via === 'files' ? (full ? 'Then open every image path it prints with your file viewer.' : 'Then open every image path it prints with your file viewer. Those frames are the only files you can open; any other file read ends your turn, so learn everything else through the editor (`help` lists its commands).') : 'The frames come back to you as images.'} Look after you place text, overlays, circles or crops, after changing looks or colours, and before you call a cut done; fix what you see (unreadable text, things covering each other, a circle that misses its target).
- Voice-over (配音/旁白/narration audio): write or fix the narration lines first (\`set <id> lines.<k>.zh ...\`), then run \`voice\`; it only voices lines without current audio, so run it again after editing lines. Add \`--lang en\` for the second-language track. Change the engine or voice (\`voice list\`, \`voice use\`) only when the user asks for a different voice. When they say the voice sounds bad or robotic: \`voice list\` shows whether the HD voices (engine local, Qwen3-TTS on their graphics card) are installed; if so switch with \`voice use local <voice>\` and re-voice with \`voice --redo\`; if not, tell them Library › Voiceover can install them (about 10 GB) and don't start the install yourself. HD voices sample each take: when one line comes out odd, \`voice <scene-id> --redo\` gives a new take of that scene. Their own voice: \`voice clone <clip> --text "<exact words in the clip>"\`.
- Web recordings: run \`inspect <url>\` to see the page's elements and selectors, then \`record <name> <url> '<steps json>'\` with the clicks and typing the user wants shown; put a \`mark\` before each beat you will caption. Keep recordings short (5–20 s of steps); recording takes about real time plus page loading. Only record public pages the user asked for.
- To show Cutroom itself (a tutorial or demo clip), record this editor's own address, http://127.0.0.1:${port}/?slug=${slug}&format=wide&ui=zh (ui=en for English). The recorder notices it is the editor and records a copy of the project, so clicks in the steps never change the real one. Handy selectors: library tabs \`.lib-tabs button:has-text("Transitions")\` (the label follows ui), scenes \`.clip:has(.name:text-is("<scene-id>"))\`, library tiles \`.lt\`, inspector tabs \`.itabs button\`; \`{"press":"Space"}\` plays the preview.
- When a website in a recording has changed, \`rerecord <name>\` (or \`rerecord all\`) records it again from its saved steps; captions and cuts anchored to marks follow the new footage. Then run \`check\` for anchors whose marks are gone.
- HTML scenes: when nothing in the library shows what the user wants (a chart of their own numbers, a custom diagram, a branded title), write a page: \`html write <name> ${via === 'bash' ? "'<page>'" : '<page>'}\`, then \`add html scenes/<name>/index.html <after-id>\`, then \`look\` at it and fix what you see. Page rules: one root \`<div data-composition-id="<name>" data-width="1920" data-height="1080" data-duration="<seconds>">\` (1080×1920 for a 9:16-only scene); animate with CSS @keyframes or element.animate(…) with finite durations and fill both (time 0 is the scene start); elements with data-start/data-duration show only in that window; no Date.now, timers or requestAnimationFrame loops; no sound (add it with the editor); font-family "Noto Sans SC", system-ui. ${via === 'bash' ? 'Pass the whole page as one single-quoted argument: use double quotes inside it and write apostrophes as &#39;. ' : ''}\`html check <name>\` lists problems. Pages that declare variables (data-composition-variables) are filled per scene with \`set <id> visual.vars.<var> <json>\`; \`html vars <id>\` lists them. A HyperFrames composition or any page on disk can be copied in with \`add html <path>\`.
- Reference videos: when the user gives a video to learn from ("cut it like this one"), run \`shots <path>\` first. It lists every shot with its length, camera move and a keyframe image; open a few keyframes, then match the reference's pacing (its average and median shot length) and kinds of shots in your plan. It also works on the user's own export to review rhythm.
- 9:16 versions of footage: \`reframe <id>\` crops an image or video scene for 9:16 so the busy part stays in view (it makes a separate tall visual); then \`look <id> --format tall\`.
- A video of someone talking: \`cut-silence <id>\` removes long pauses as jump cuts; make sure \`visual.muted\` is false so the speech is heard.
- Pictures that don't exist yet (a logo, a sticker, a product shot): \`imagine <name> "<description>" --transparent\` (needs an OpenAI or Gemini key; say so if it reports none), then use it as an image overlay \`{"kind":"image","src":"media/<name>.png","at":…,"dur":…,"x":…,"y":…,"w":…,"enter":"pop"}\` or \`add image\`. Only when the user wants new art; prefer their own media.
- Do not export/render videos unless the user asks; they have an export button. An export reports its loudness; for video platforms export with \`--lufs -14\`. If they want to finish in JianyingPro (剪映), \`export --jianying\` writes a draft with every part on its own track.
- When the message lists things the user pointed at, words like "this", "here", "这里", "这个" mean those. A preview point gives x/y as fractions of the frame from the top-left; match it to the overlay or element at that spot (use \`show <id>\`). If they only pointed and said nothing, describe what is there and propose one concrete improvement, and ask before making big changes.

## Video craft (use it when writing lines or restructuring; the user's own request wins)
- Open on the finished result in the first 3 s; no logo intros or warm-up. When you write an opening, draft two in your head and use the stronger one.
- The picture adds what the narration can't say (the real interface, the result, the numbers); it doesn't put the spoken sentence on screen again. A card that lists what the voice reads becomes footage of the thing, or a few short labels.
- One narration line = one on-screen action. Spoken Chinese runs about 4.5 characters a second, English about 2.5 words a second; size scenes to their lines.
- Write narration like a person talking: short sentences, first person, plain words; no stock phrases, no lists of three, and never describe what the viewer can already see.
- At most one [[highlight]] per line. Keep transitions consistent and cut plainly between related shots.
- Text placed over footage (recordings, photos, clips) gets \`"plate": true\` so it reads on bright frames; confirm with \`look\`.
- Build new scenes from the project's own footage: run \`media\` to see recordings, images, videos and music.

## CLI reference
${HELP}

${catalogText()}

## The user's rules (they win over the defaults above)
${rulesBlock(slug)}
- When the user corrects you or states a preference meant to last ("字幕再大一点", "别用这个转场", "以后都…", "always…"), make the change and save it as one short rule: \`rules add "<rule>"\` for this project, \`rules add --all "<rule>"\` for their style in every project. A one-off edit ("make intro 2 s") is not a rule. Don't mention saving it unless asked.

## How to reply (this matters most)
- The reply is plain text in the user's language, 1–3 short sentences: what you changed (scene ids, before → after), or the one thing you need from the user.
- No headings, no bold, no bullet or numbered lists, no code blocks, no links, no menu of options, no explanations of how the editor works unless asked. Scene ids and file names are plain words (checklist-2, cap/demo.mp4).
- If the request is ambiguous, pick the most likely reading, do it, and say which reading you chose.
- Say that the words and the picture match only when you opened the \`look lines\` frame of every line; otherwise say which lines you checked.
- When only the user can do something (open an app, work it while you record, hand over a file, sign in), first do everything else, then ask for exactly that in one sentence.
- Do not print any status/canary line like "[dir · turn N]"; this is an app panel, not a terminal.
- Good: "checklist-2 换成了你刚录的剪映画面（cap/jianying.mp4），两句字幕对齐到 @drag 和 @export，配音已更新。"
- Good: "可以：checklist-2 讲剪映，我弹出录制条请你在剪映里拖一段素材到时间线；code-2 没有现成软件可录，建议保留代码卡片。要开始录吗？"
- Bad: a heading, "两种方式：1. … 2. …", then a question.`;
}

const contextLine = (c: ChatContext) => {
  const view = `${c.format === 'tall' ? '9:16 vertical' : '16:9 widescreen'} · ${c.lang === 'en' ? 'English' : 'Chinese'}${c.variant === 'clean' ? ' · URLs hidden' : ''}`;
  return `[Editor state: showing ${view} (--format ${c.format} --lang ${c.lang})${c.sel ? `; selected scene ${c.sel}` : ''}${c.t !== undefined ? `; playhead at ${c.t.toFixed(2)} s` : ''}]`;
};

// Status line the user's global instructions add to every reply; meaningless in the panel
const CANARY = /^\s*\[[^\]\n]{1,80}·\s*turn\s*\d+\]\s*/;

class CanaryFilter {
  private buf = '';
  private decided = false;
  constructor(private emit: (s: string) => void) {}
  push(s: string) {
    if (this.decided) return this.emit(s);
    this.buf += s;
    if (this.buf.length < 90 && !this.buf.includes('\n') && !/^\s*[^\s[]/.test(this.buf)) return;
    this.decided = true;
    const out = this.buf.replace(CANARY, '');
    this.buf = '';
    if (out) this.emit(out);
  }
  flush() {
    if (!this.decided && this.buf) this.emit(this.buf.replace(CANARY, ''));
    this.buf = '';
    this.decided = true;
  }
  reset() {
    this.flush();
    this.decided = false;
  }
}

const shortCmd = (cmd: string, slug: string) => cmd.replaceAll(`${CLI_ABS} ${slug} `, '').replaceAll(`${CLI_ABS} `, '').replaceAll(`${CLI} ${slug} `, '').replaceAll(`${CLI} `, '');

// One line per tool call in the panel; paths in the project folder are shown relative to it
export function toolLabel(name: string, input: Record<string, unknown> | undefined, slug: string): string {
  const i = input ?? {};
  const proj = path.join(PUBLIC, slug) + path.sep;
  const rel = (v: unknown) => (String(v ?? '').startsWith(proj) ? String(v).slice(proj.length) : String(v ?? ''));
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return shortCmd(String(i.command ?? ''), slug);
    case 'Read':
      return `read ${rel(i.file_path)}`;
    case 'Write':
      return `write ${rel(i.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `edit ${rel(i.file_path)}`;
    case 'NotebookEdit':
      return `edit ${rel(i.notebook_path)}`;
    case 'Glob':
    case 'Grep':
      return `${name.toLowerCase()} ${String(i.pattern ?? '')}`;
    case 'WebSearch':
      return `search ${String(i.query ?? '')}`;
    case 'WebFetch':
      return `fetch ${String(i.url ?? '')}`;
    case 'Skill':
      return `skill ${String(i.skill ?? i.name ?? '')}`;
    case 'Task':
    case 'Agent':
      return `agent ${String(i.description ?? '')}`;
    default:
      return name.startsWith('mcp__') ? name.split('__').slice(1).join(' › ') : name;
  }
}

// What the approval card shows under the command
export function askDetail(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  if (name === 'Write' || name === 'write_file') return String(i.content ?? '').slice(0, 400);
  if (name === 'Edit') return `- ${String(i.old_string ?? '').slice(0, 200)}\n+ ${String(i.new_string ?? '').slice(0, 200)}`;
  if (name === 'Bash' || name === 'PowerShell') return String(i.description ?? '');
  return '';
}

// Shell words of a line, split into commands at unquoted && ; and newlines; null when it pipes, redirects, runs in the
// background or expands anything ($VAR, $(…), backticks), since then what runs can't be read off the line
export function shellCommands(line: string): string[][] | null {
  const cmds: string[][] = [[]];
  let word = '';
  let has = false;
  const push = () => {
    if (has) cmds[cmds.length - 1].push(word);
    word = '';
    has = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) return null;
      word += line.slice(i + 1, j);
      has = true;
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === '$' || line[j] === '`') return null;
        if (line[j] === '\\' && '"\\'.includes(line[j + 1] ?? '')) word += line[++j];
        else word += line[j];
      }
      if (j >= line.length) return null;
      has = true;
      i = j;
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i];
      has = true;
    } else if (c === '&' && line[i + 1] === '&') {
      push();
      cmds.push([]);
      i++;
    } else if (c === ';' || c === '\n') {
      push();
      cmds.push([]);
    } else if ('|&<>`$(){}'.includes(c)) return null;
    else if (/\s/.test(c)) push();
    else {
      word += c;
      has = true;
    }
  }
  push();
  return cmds.filter((x) => x.length);
}

// A Bash line that only runs this project's editor CLI (after an optional cd into the project or app folder) is what
// Claude Code may already run without asking; the cd or the chaining just keeps its prefix rule from seeing that
export function editorOnly(line: string, slug: string): boolean {
  const cmds = shellCommands(line);
  if (!cmds?.length) return false;
  const same = (a: string, b: string) => {
    const x = path.resolve(a);
    const y = path.resolve(b);
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
  };
  let editor = false;
  for (const w of cmds) {
    if (w[0] === 'cd' && w.length === 2 && path.isAbsolute(w[1]) && (same(w[1], path.join(PUBLIC, slug)) || same(w[1], ROOT))) continue;
    if (w[0] === 'node' && w.length >= 3 && path.isAbsolute(w[1]) && same(w[1], cliScript) && w[2] === slug) {
      editor = true;
      continue;
    }
    return false;
  }
  return editor;
}

export const inside = (file: string, dir: string) => {
  const r = path.relative(dir, file);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};

// A shell or file step of the API and OpenAI-compatible assistants: reads and writes in the project folder run at
// once, shell commands and writes elsewhere wait for the user's go-ahead
export async function fullStep(slug: string, project: string, name: string, input: unknown, signal?: AbortSignal): Promise<FullResult> {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  // A malformed call goes back to the model instead of asking the user about nothing
  if (name === 'shell' && !String(i.command ?? '').trim()) return { ok: false, out: 'command must be a non-empty string: {"command": "..."}' };
  if ((name === 'read_file' || name === 'write_file') && !String(i.path ?? '').trim()) return { ok: false, out: 'path must be a non-empty string' };
  const free = name === 'read_file' || (name === 'write_file' && typeof i.path === 'string' && inside(path.resolve(project, i.path), project));
  if (!free) {
    const a = await askUser(slug, fullLabel(name, i), askDetail(name, i));
    if (!a.allow) return { ok: false, out: a.message ?? 'The user declined this step.' };
  }
  // A file about to be written outside the project is kept first, so a rollback can put it back
  if (name === 'write_file') await noteOutside(placeOf(slug), path.resolve(project, String(i.path))).catch(() => undefined);
  return runFullTool(name, input, project, signal);
}

// Claude Code's file tools: the same, before the edit is allowed
export async function keepBeforeWrite(slug: string, tool: string, input: Record<string, unknown>) {
  const file = ['Write', 'Edit', 'MultiEdit'].includes(tool) ? input.file_path : tool === 'NotebookEdit' ? input.notebook_path : undefined;
  if (typeof file === 'string' && file) await noteOutside(placeOf(slug), file).catch(() => undefined);
}
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : (x?.text ?? ''))).join('') : '');

const running = new Map<string, { kill: () => void }>();
export const isRunning = (slug: string) => running.has(slug);
// Full access: steps waiting for the user's go-ahead in the panel
interface Ask {
  slug: string;
  cmd: string;
  detail: string;
  done: (a: { allow: boolean; message?: string }) => void;
}
const asks = new Map<string, Ask>();
const emitters = new Map<string, (e: ChatEvent) => void>();
// "Allow everything in this conversation"
const allowAll = new Set<string>();
// Shared with the MCP helpers that ask and run full-access steps through this server
export const ASK_TOKEN = randomUUID();
const askEnv = () => ({ CUTROOM_SERVER: `http://127.0.0.1:${process.env.PORT ?? 8814}`, CUTROOM_ASK_TOKEN: ASK_TOKEN });

export function askUser(slug: string, cmd: string, detail = ''): Promise<{ allow: boolean; message?: string }> {
  // "Allow everything" in the access menu, or for this conversation
  if (aiAccess() === 'auto' || allowAll.has(slug)) return Promise.resolve({ allow: true });
  const emit = emitters.get(slug);
  if (!emit) return Promise.resolve({ allow: false, message: 'Nobody is in the chat panel to approve this step.' });
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => answerAsk(slug, id, false, false, 'No answer within 15 minutes.'), 15 * 60_000);
    asks.set(id, {
      slug,
      cmd,
      detail,
      done: (a) => {
        clearTimeout(timer);
        asks.delete(id);
        resolve(a);
      },
    });
    emit({ type: 'ask', id, cmd, detail });
  });
}

export function answerAsk(slug: string, id: string, allow: boolean, always = false, message?: string): boolean {
  const a = asks.get(id);
  if (!a || a.slug !== slug) return false;
  if (allow && always) allowAll.add(slug);
  a.done(allow ? { allow: true } : { allow: false, message: message ?? 'The user declined this step in the chat panel.' });
  emitters.get(slug)?.({ type: 'asked', id, allow });
  return true;
}

export const pendingAsks = (slug: string) => [...asks.entries()].filter(([, a]) => a.slug === slug).map(([id, a]) => ({ id, cmd: a.cmd, detail: a.detail }));
const dropAsks = (slug: string, message: string) => [...asks.entries()].filter(([, a]) => a.slug === slug).forEach(([id]) => answerAsk(slug, id, false, false, message));

export function stop(slug: string) {
  dropAsks(slug, 'The user stopped this request.');
  running.get(slug)?.kill();
}

// Put the project (and outside files the assistant wrote with its file tools) back as before a message; the assistant
// hears about it with the next one
export async function rollbackTo(slug: string, cp: string): Promise<Rollback & { label: string }> {
  if (running.has(slug)) throw new Error(L('Wait until the AI has finished this message', '等 AI 这一条做完再回退'));
  const label = checkpoints(placeOf(slug)).find((c) => c.id === cp)?.label ?? '';
  // Rolling back to a "before rollback" checkpoint undoes that rollback
  const undoing = label.startsWith('before rollback to ');
  // Logged before the files change, so the open editor names the change a rollback
  const board = fileAt(placeOf(slug), cp, 'storyboard.json');
  if (board !== null) {
    const version = hash(board);
    const short = label.length > 24 ? `${label.slice(0, 24)}…` : label;
    snapshot(slug, version, board);
    appendLog(slug, { t: new Date().toISOString(), src: 'rollback', version, desc: [undoing ? L('Rollback undone', '已撤销回退') : L(`Back to before “${short}”`, `已回到「${short}」之前`)] });
  }
  const r = await rollback(placeOf(slug), cp);
  const s = load(slug);
  s.note = undoing
    ? '[The user undid their last rollback: the project files are back as they were before it.]'
    : `[The user rolled the project back to how it was before their message "${label}". Files you changed after that are as they were then (shell changes outside the project folder excepted); check the current state before relying on earlier results.]`;
  s.log.push({ role: 'event', text: undoing ? '' : label, cp: r.undo, t: new Date().toISOString() });
  save(slug, s);
  return { ...r, label };
}

export interface PointedRef {
  label: string;
  detail: string;
}

export async function chat(slug: string, message: string, ctx: ChatContext, model: string | undefined, emit: (e: ChatEvent) => void, refs: PointedRef[] = []): Promise<void> {
  const prov = provider();
  if (!prov) return emit({ type: 'error', message: L('The AI is not connected: open the connection settings, then sign in to Claude Code or add an API key.', '还没连上 AI：点右上角的连接设置，登录 Claude Code 或填一个 API Key。') });
  if (running.has(slug)) return emit({ type: 'error', message: L('Still working on the last message', '上一条还在处理') });
  // Checkpoint before the assistant touches anything, so this message can be rolled back
  const cp = await take(placeOf(slug), message.trim().slice(0, 80) || L('(pointed at the preview)', '（指了预览里的东西）')).catch(() => null);
  const saved = load(slug);
  const note = saved.note;
  delete saved.note;
  saved.log.push({ role: 'user', text: message, refs: refs.length ? refs.map((r) => r.label) : undefined, cp: cp?.id, t: new Date().toISOString() });
  save(slug, saved);
  if (cp) emit({ type: 'checkpoint', id: cp.id });
  const reply: LogItem = { role: 'assistant', text: '', tools: [], t: '' };
  const toolIds = new Map<string, number>();
  // Text before a command is a working note; the answer is what comes after the last one
  let aside = '';
  const wrapped = (e: ChatEvent) => {
    if (e.type === 'text') reply.text += e.delta;
    if (e.type === 'tool') {
      aside = [aside, reply.text.trim()].filter(Boolean).join('\n\n');
      reply.text = '';
      toolIds.set(e.id, reply.tools!.length);
      reply.tools!.push({ cmd: e.cmd, ok: true });
    }
    if (e.type === 'tool_result' && toolIds.has(e.id)) reply.tools![toolIds.get(e.id)!].ok = e.ok;
    emit(e);
  };
  emit({ type: 'start', provider: prov });
  emitters.set(slug, wrapped);
  const t0 = Date.now();
  // Things the user Ctrl+clicked in the editor
  const pointed = refs.length ? `The user pointed at these in the editor:\n${refs.map((r, i) => `${i + 1}. ${r.detail}`).join('\n')}\n\n` : '';
  const prompt = `${note ? `${note}\n\n` : ''}${contextLine(ctx)}\n\n${pointed}${message || '(No words: look at what they pointed at, say what you notice and suggest a fix.)'}`;
  try {
    if (prov === 'claude-code') await viaClaudeCode(slug, prompt, readAi().models?.['claude-code'] || model, saved, wrapped, t0);
    else if (prov === 'compat') await viaCompat(slug, prompt, saved, wrapped, t0);
    else if (prov === 'agent') await viaAgent(slug, prompt, saved, wrapped, t0);
    else await viaApi(slug, prompt, saved, wrapped, t0);
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    running.delete(slug);
    emitters.delete(slug);
    dropAsks(slug, 'The request ended.');
    const s = load(slug);
    if (saved.sessionId) s.sessionId = saved.sessionId;
    // A Claude Code run in another folder starts its own session
    if (saved.cwd) {
      s.cwd = saved.cwd;
      s.sessionId = saved.sessionId;
    }
    if (saved.api) s.api = saved.api;
    if (saved.compat) s.compat = saved.compat;
    reply.t = new Date().toISOString();
    reply.text = (reply.text.trim() ? reply.text : aside).trim();
    if (reply.text || reply.tools!.length) s.log.push(reply);
    save(slug, s);
  }
}

// Claude Code headless, restricted to the editor CLI; uses the local Claude Code login
function viaClaudeCode(slug: string, prompt: string, model: string | undefined, saved: Saved, emit: (e: ChatEvent) => void, t0: number): Promise<void> {
  return new Promise((resolve) => {
    // The instructions go through a file: on Windows a command line holds at most 32,767 characters
    const promptFile = path.join(STATE, slug, 'system-prompt.md');
    fs.mkdirSync(path.dirname(promptFile), { recursive: true });
    fs.writeFileSync(promptFile, systemPrompt(slug));
    const full = fullOn();
    const project = path.join(PUBLIC, slug);
    // Full: the user's own settings, skills and MCP servers; reading, searching and edits in the project folder run at once,
    // anything else waits for the user's answer in the panel (asked through Cutroom's MCP helper)
    const ask = JSON.stringify({ mcpServers: { cutroom: { command: process.execPath, args: [path.join(ROOT, 'editor', 'dist', 'mcp.mjs'), slug, '--ask'], env: { ...mcpEnv(), ...askEnv() } } } });
    const args = full
      ? ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'default', '--mcp-config', ask, '--permission-prompt-tool', 'mcp__cutroom__approve', '--allowedTools', `Bash(${CLI_ABS}:*)`, lookReadRule(), 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill', 'Task', pathRule('Edit', project), '--append-system-prompt-file', promptFile]
      : ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--setting-sources', 'project,local', '--strict-mcp-config', '--allowedTools', `Bash(${CLI}:*)`, lookReadRule(), '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', '--append-system-prompt-file', promptFile];
    if (model) args.push('--model', model);
    const effort = aiEffort();
    if (effort) args.push('--effort', effort);
    // Full access works in the project folder, so relative paths there just work; a session resumes only in its own folder
    const cwd = full && fs.existsSync(project) ? project : ROOT;
    if (saved.sessionId && (saved.cwd ?? ROOT) !== cwd) delete saved.sessionId;
    saved.cwd = cwd;
    if (saved.sessionId) args.push('--resume', saved.sessionId);
    // Voice-over and screen recordings can outlast Bash's default 2-minute limit
    const child: ChildProcess = spawn(findClaude()!, args, { cwd, windowsHide: true, env: { ...process.env, BASH_DEFAULT_TIMEOUT_MS: '900000', BASH_MAX_TIMEOUT_MS: '900000' } });
    let done = false;
    const kill = () => killTree(child);
    running.set(slug, { kill });
    // A whole cut with voice-over and recordings takes a while
    // Full access has no time limit (Stop ends it)
    const timer = full ? undefined : setTimeout(kill, 30 * 60_000);
    let wrote = false;
    let gap = false;
    const filter = new CanaryFilter((s) => {
      // A new assistant message after earlier text starts a new paragraph
      if (gap && wrote) emit({ type: 'text', delta: '\n\n' });
      gap = false;
      wrote = true;
      emit({ type: 'text', delta: s });
    });
    const streamed = new Set<string>();
    let msgId = '';
    let buf = '';
    let err = '';
    child.stdin!.end(prompt);
    child.stderr!.on('data', (d) => (err += d));
    child.stdout!.on('data', (d) => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.session_id) saved.sessionId = m.session_id;
        if (m.type === 'stream_event') {
          const ev = m.event;
          if (ev?.type === 'message_start') {
            msgId = ev.message?.id ?? '';
            filter.reset();
            gap = true;
          }
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            streamed.add(msgId);
            filter.push(ev.delta.text);
          }
        } else if (m.type === 'assistant') {
          for (const b of m.message?.content ?? []) {
            if (b.type === 'tool_use' && b.name !== 'mcp__cutroom__approve') emit({ type: 'tool', id: b.id, cmd: toolLabel(b.name, b.input, slug) });
            // Text only when no partial stream arrived for this message
            if (b.type === 'text' && !streamed.has(m.message?.id ?? '')) {
              filter.reset();
              filter.push(b.text);
              filter.flush();
            }
          }
        } else if (m.type === 'user') {
          for (const b of m.message?.content ?? []) if (b.type === 'tool_result') emit({ type: 'tool_result', id: b.tool_use_id, ok: !b.is_error, out: textOf(b.content).slice(0, 600) });
        } else if (m.type === 'result') {
          filter.flush();
          done = true;
          if (m.is_error && m.result) emit({ type: 'error', message: String(m.result).slice(0, 400) });
          emit({ type: 'done', ms: Date.now() - t0, cost: m.total_cost_usd });
        }
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      filter.flush();
      if (!done) emit(code === 0 ? { type: 'done', ms: Date.now() - t0 } : { type: 'error', message: L(`The AI process exited (${code})${err ? ': ' + err.slice(-300) : ''}`, `AI 进程退出（${code}）${err ? '：' + err.slice(-300) : ''}`) });
      resolve();
    });
  });
}

// Anthropic API with an API key: one tool that runs the editor CLI (no shell)
async function viaApi(slug: string, prompt: string, saved: Saved, emit: (e: ChatEvent) => void, t0: number): Promise<void> {
  const client = new Anthropic({ apiKey: apiKey() });
  const controller = new AbortController();
  running.set(slug, { kill: () => controller.abort() });
  const full = fullOn();
  const project = path.join(PUBLIC, slug);
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    {
      name: 'editor',
      description: TOOL_DESC(slug),
      input_schema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
      strict: true,
    },
    // Full access: a shell, files and web search
    ...(full ? FULL_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true })) : []),
    ...(full ? [{ type: 'web_search_20260209' as const, name: 'web_search' as const }] : []),
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [...(saved.api ?? []), { role: 'user', content: prompt }];
  const effort = aiEffort();
  for (let turn = 0; turn < (full ? 200 : 24); turn++) {
    const stream = client.beta.messages.stream(
      {
        model: readAi().models?.anthropic || API_MODELS[0],
        max_tokens: 64000,
        system: systemPrompt(slug, 'tool'),
        tools,
        messages,
        ...(effort ? { output_config: { effort } } : {}),
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsStreaming,
      { signal: controller.signal },
    );
    stream.on('text', (d) => emit({ type: 'text', delta: d }));
    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (msg.stop_reason === 'refusal') {
      emit({ type: 'error', message: L('The model declined this request', '模型拒绝了这个请求') });
      break;
    }
    // Web searches run on Anthropic's side; show them in the command list
    for (const b of msg.content) if (b.type === 'server_tool_use') emit({ type: 'tool', id: b.id, cmd: `search ${String((b.input as { query?: unknown })?.query ?? '')}` });
    // A long server-side search pauses the turn; send it back to continue
    if (msg.stop_reason === 'pause_turn') continue;
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!uses.length) break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      if (isFullTool(u.name)) {
        emit({ type: 'tool', id: u.id, cmd: fullLabel(u.name, (u.input ?? {}) as Record<string, unknown>) });
        const r = await fullStep(slug, project, u.name, u.input, controller.signal);
        emit({ type: 'tool_result', id: u.id, ok: r.ok, out: r.out.slice(0, 600) });
        const pics = (r.images ?? []).map((x) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: x.mime as 'image/png', data: x.data } }));
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: !r.ok, content: pics.length ? [{ type: 'text', text: r.out }, ...pics] : r.out });
        continue;
      }
      const args = (u.input as { args?: unknown }).args;
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'args must be an array of strings' });
        continue;
      }
      emit({ type: 'tool', id: u.id, cmd: args.join(' ') });
      const r = await runCli(slug, args as string[]);
      emit({ type: 'tool_result', id: u.id, ok: r.ok, out: r.out.slice(0, 600) });
      const pics = imagesIn(r.out).map((x) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: x.mime as 'image/jpeg', data: x.data } }));
      results.push({ type: 'tool_result', tool_use_id: u.id, is_error: !r.ok, content: pics.length ? [{ type: 'text', text: r.out.slice(0, 20000) }, ...pics] : r.out.slice(0, 20000) || '(no output)' });
    }
    messages.push({ role: 'user', content: results });
  }
  // Frames are kept out of the saved history so later messages don't resend them
  saved.api = messages.map((m) =>
    Array.isArray(m.content)
      ? { ...m, content: (m.content as Anthropic.Beta.BetaContentBlockParam[]).map((b) => (b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: b.content.map((c) => (c.type === 'image' ? { type: 'text' as const, text: '(frame shown here)' } : c)) } : b)) }
      : m,
  );
  emit({ type: 'done', ms: Date.now() - t0 });
}

// Another subscription through its own CLI. Each message is a fresh, ephemeral session: the instructions and the
// last few exchanges go in front of the request, so nothing lands in the user's own Codex or Gemini history
// (Antigravity runs with a home folder of its own).
async function viaAgent(slug: string, prompt: string, saved: Saved, emit: (e: ChatEvent) => void, t0: number): Promise<void> {
  const id = chosenAgent()!;
  const def = agentDef(id)!;
  const st = await agentState(id);
  if (st.loggedIn === false) {
    emit({ type: 'error', message: L(`${def.en} is not signed in. Open Settings › AI and press Sign in, or run "${def.login}" in a terminal.`, `${def.zh} 还没登录。到 设置 › AI 点「登录」，或在终端运行「${def.login}」。`) });
    return emit({ type: 'done', ms: Date.now() - t0 });
  }
  const recent = saved.log
    .slice(-7, -1)
    .map((x) => `${x.role === 'user' ? 'User' : 'You'}: ${x.text.slice(0, 600)}`)
    .join('\n');
  // Full access: Cutroom's shell and file tools through the MCP server, not the agent's own. Gemini CLI can't hand a
  // question to the panel, so it gets them only when nothing is asked
  const full = fullOn() && (id !== 'gemini' || aiAccess() === 'auto');
  const text = `<instructions>\n${systemPrompt(slug, id === 'antigravity' ? 'files' : 'tool', full)}\n</instructions>\n\n${recent ? `<conversation so far>\n${recent}\n</conversation so far>\n\n` : ''}${prompt}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve) => {
    let finished = false;
    let failed = false;
    const r = startAgent(
      id,
      slug,
      agentModel(id),
      text,
      (e) => {
        if (e.type === 'text') emit({ type: 'text', delta: e.delta });
        else if (e.type === 'tool') emit({ type: 'tool', id: e.id, cmd: e.args.join(' ') });
        else if (e.type === 'tool_result') emit({ type: 'tool_result', id: e.id, ok: e.ok, out: e.out });
        else if (e.type === 'error') {
          failed = true;
          emit({ type: 'error', message: e.message });
        } else finished = true;
      },
      (code, stderr) => {
        if (timer) clearTimeout(timer);
        running.delete(slug);
        if (!finished && !failed && code !== 0) emit({ type: 'error', message: L(`${def.en} exited (${code})${stderr ? ': ' + stderr.trim().slice(-300) : ''}`, `${def.zh} 退出了（${code}）${stderr ? '：' + stderr.trim().slice(-300) : ''}`) });
        emit({ type: 'done', ms: Date.now() - t0 });
        resolve();
      },
      { full, effort: aiEffort(), mcp: full ? askEnv() : undefined },
    );
    if (!r) {
      emit({ type: 'error', message: L(`${def.en} is not installed`, `${def.zh} 没有安装`) });
      emit({ type: 'done', ms: Date.now() - t0 });
      return resolve();
    }
    running.set(slug, { kill: r.kill });
    // A whole cut with voice-over and recordings takes a while; full access has no limit (Stop ends it)
    timer = full ? undefined : setTimeout(r.kill, 30 * 60_000);
  });
}

// OpenAI-compatible providers (OpenAI, Gemini, DeepSeek, Qwen, Kimi, GLM, OpenRouter, Ollama, custom)
async function viaCompat(slug: string, prompt: string, saved: Saved, emit: (e: ChatEvent) => void, t0: number): Promise<void> {
  const c = compatConn()!;
  const controller = new AbortController();
  running.set(slug, { kill: () => controller.abort() });
  const id = `${c.preset}|${c.base}|${c.model}`;
  try {
    const messages = await chatLoop({
      c,
      system: systemPrompt(slug, 'tool'),
      history: saved.compat?.id === id ? saved.compat.messages : [],
      prompt,
      toolDescription: TOOL_DESC(slug),
      run: async (args) => {
        const r = await runCli(slug, args);
        return { ...r, images: imagesIn(r.out) };
      },
      onText: (s) => emit({ type: 'text', delta: s }),
      onTool: (tid, args) => emit({ type: 'tool', id: tid, cmd: args.join(' ') }),
      onToolResult: (tid, ok, out) => emit({ type: 'tool_result', id: tid, ok, out }),
      signal: controller.signal,
      ...(fullOn() ? { extra: FULL_TOOLS, runExtra: (name: string, input: unknown) => fullStep(slug, path.join(PUBLIC, slug), name, input, controller.signal), maxTurns: 200 } : {}),
    });
    saved.compat = { id, messages: trimHistory(messages) };
  } catch (e) {
    if (!controller.signal.aborted) emit({ type: 'error', message: compatError(e, c) });
  }
  emit({ type: 'done', ms: Date.now() - t0 });
}

function runCli(slug: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'editor', 'dist', 'cli.mjs'), slug, ...args], { cwd: ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}
