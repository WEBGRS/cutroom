import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { ROOT, STATE } from './store';
import { HELP } from './help';
import { catalogText } from './catalog';

export type ChatEvent =
  | { type: 'start'; provider: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; cmd: string }
  | { type: 'tool_result'; id: string; ok: boolean; out: string }
  | { type: 'done'; ms: number; cost?: number }
  | { type: 'error'; message: string };

export interface ChatContext {
  format: string;
  mode: string;
  lang: string;
  variant: string;
  sel?: string | null;
  t?: number;
}

interface LogItem {
  role: 'user' | 'assistant';
  text: string;
  tools?: { cmd: string; ok: boolean }[];
  t: string;
}

interface Saved {
  sessionId?: string;
  api?: Anthropic.Beta.BetaMessageParam[];
  log: LogItem[];
}

const CLI = 'node editor/dist/cli.mjs';
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
export const reset = (slug: string) => save(slug, { log: [] });

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
  pref?: 'auto' | 'claude-code' | 'anthropic';
  apiKey?: string;
}
const SETTINGS = path.join(STATE, 'settings.json');
const readSettings = (): Record<string, any> => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch {
    return {};
  }
};
export const readAi = (): AiSettings => readSettings().ai ?? {};
export function writeAi(patch: { pref?: string; apiKey?: string | null }) {
  const all = readSettings();
  const ai: AiSettings = { ...(all.ai ?? {}) };
  if (patch.pref !== undefined) ai.pref = ['claude-code', 'anthropic'].includes(patch.pref) ? (patch.pref as AiSettings['pref']) : 'auto';
  if (patch.apiKey === null || patch.apiKey === '') delete ai.apiKey;
  else if (typeof patch.apiKey === 'string') ai.apiKey = patch.apiKey.trim();
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ ...all, ai }, null, 2));
  authCache = null;
}
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

export function provider(): 'claude-code' | 'anthropic' | null {
  const p = pref();
  if (p === 'anthropic') return apiKey() ? 'anthropic' : null;
  if (p === 'claude-code') return findClaude() ? 'claude-code' : null;
  // Auto: the local login first, unless it is known to be logged out and a key exists
  if (findClaude() && !(authCache?.v && !authCache.v.loggedIn && apiKey())) return 'claude-code';
  if (apiKey()) return 'anthropic';
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
  };
}

// One tiny real request through whichever connection is active
export async function aiTest(): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = Date.now();
  const prov = provider();
  const done = (ok: boolean, message: string) => ({ ok, message, ms: Date.now() - t0 });
  if (!prov) return done(false, '还没有可用的连接：登录 Claude Code，或者填一个 API Key');
  if (prov === 'anthropic') {
    try {
      const m = await new Anthropic({ apiKey: apiKey() }).models.retrieve('claude-opus-5-5');
      return done(true, `API Key 可用，模型 ${m.display_name ?? m.id}`);
    } catch (e) {
      const st = (e as { status?: number }).status;
      return done(false, st === 401 ? 'API Key 无效（401）' : st === 403 ? '这个 Key 没有权限（403）' : `连接失败：${(e as Error).message.slice(0, 160)}`);
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
        if (j.is_error) return resolve(done(false, String(j.result ?? 'Claude Code 返回错误').slice(0, 200)));
        const model = Object.keys(j.modelUsage ?? {})[0];
        resolve(done(true, `Claude Code 可用${model ? `，测试用 ${model}` : ''}`));
      } catch {
        resolve(done(false, (err || out || 'Claude Code 没有回应').trim().slice(-200)));
      }
    });
  });
}

export function systemPrompt(slug: string): string {
  return `You are the editing assistant inside Cutroom, a code-first video editor. You are talking to the user through a small chat panel next to a live preview of project "${slug}". Every change you make through the CLI appears in the preview within a second.

How to edit:
- Use only the Bash tool, and only this command form (the working directory is already the project root; never cd, never edit files directly, never run other programs):
  ${CLI} ${slug} <command> ...
- Start with \`ls\` (add --format/--mode to match the user's current view, given in each message) to see the timeline. Use \`show <id>\` for a scene's JSON and \`fx\` for the effect reference.
- Make the smallest edit that does what was asked. Prefer the dedicated commands (trim/split/mv/add/bars/min) over \`set\`.
- Effects marked [house rule] go against the user's own style guide: don't use them unless the user explicitly asks.
- Do not export/render videos; the user has an export button.

How to reply:
- Answer in the user's language (usually Chinese), in 1–3 short sentences: what you changed (scene ids, before → after). No headings, no lists unless several scenes changed.
- Do not print any status/canary line like "[dir · turn N]"; this is an app panel, not a terminal.
- If the request is ambiguous, pick the most likely reading, do it, and say which reading you chose.

CLI reference:
${HELP}

${catalogText()}`;
}

const contextLine = (c: ChatContext) => {
  const view = `${c.format === 'tall' ? '竖屏' : '横屏'} · ${c.mode === 'beat' ? '卡点版 (--mode beat)' : '旁白版'} · ${c.lang === 'en' ? 'English' : '中文'}${c.variant === 'clean' ? ' · 无网址' : ''}`;
  return `[编辑器状态：当前 ${view} (--format ${c.format} --mode ${c.mode} --lang ${c.lang})${c.sel ? `；选中段落 ${c.sel}` : ''}${c.t !== undefined ? `；播放头 ${c.t.toFixed(2)} 秒` : ''}]`;
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

const shortCmd = (cmd: string, slug: string) => cmd.replaceAll(`${CLI} ${slug} `, '').replaceAll(`${CLI} `, '');
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : (x?.text ?? ''))).join('') : '');

const running = new Map<string, { kill: () => void }>();
export const isRunning = (slug: string) => running.has(slug);
export function stop(slug: string) {
  running.get(slug)?.kill();
}

export async function chat(slug: string, message: string, ctx: ChatContext, model: string | undefined, emit: (e: ChatEvent) => void): Promise<void> {
  const prov = provider();
  if (!prov) return emit({ type: 'error', message: '还没连上 AI：点右上角的连接设置，登录 Claude Code 或填一个 API Key。' });
  if (running.has(slug)) return emit({ type: 'error', message: '上一条还在处理' });
  const saved = load(slug);
  saved.log.push({ role: 'user', text: message, t: new Date().toISOString() });
  save(slug, saved);
  const reply: LogItem = { role: 'assistant', text: '', tools: [], t: '' };
  const toolIds = new Map<string, number>();
  const wrapped = (e: ChatEvent) => {
    if (e.type === 'text') reply.text += e.delta;
    if (e.type === 'tool') {
      toolIds.set(e.id, reply.tools!.length);
      reply.tools!.push({ cmd: e.cmd, ok: true });
    }
    if (e.type === 'tool_result' && toolIds.has(e.id)) reply.tools![toolIds.get(e.id)!].ok = e.ok;
    emit(e);
  };
  emit({ type: 'start', provider: prov });
  const t0 = Date.now();
  const prompt = `${contextLine(ctx)}\n\n${message}`;
  try {
    if (prov === 'claude-code') await viaClaudeCode(slug, prompt, model, saved, wrapped, t0);
    else await viaApi(slug, prompt, saved, wrapped, t0);
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    running.delete(slug);
    const s = load(slug);
    if (saved.sessionId) s.sessionId = saved.sessionId;
    if (saved.api) s.api = saved.api;
    reply.t = new Date().toISOString();
    if (reply.text || reply.tools!.length) s.log.push(reply);
    save(slug, s);
  }
}

// Claude Code headless, restricted to the editor CLI; uses the local Claude Code login
function viaClaudeCode(slug: string, prompt: string, model: string | undefined, saved: Saved, emit: (e: ChatEvent) => void, t0: number): Promise<void> {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--setting-sources', 'project,local', '--strict-mcp-config', '--allowedTools', `Bash(${CLI}:*)`, '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', '--append-system-prompt', systemPrompt(slug)];
    if (model) args.push('--model', model);
    if (saved.sessionId) args.push('--resume', saved.sessionId);
    const child: ChildProcess = spawn(findClaude()!, args, { cwd: ROOT, windowsHide: true, env: process.env });
    let done = false;
    const kill = () => {
      if (child.pid && process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      else child.kill();
    };
    running.set(slug, { kill });
    const timer = setTimeout(kill, 5 * 60_000);
    const filter = new CanaryFilter((s) => emit({ type: 'text', delta: s }));
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
          }
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            streamed.add(msgId);
            filter.push(ev.delta.text);
          }
        } else if (m.type === 'assistant') {
          for (const b of m.message?.content ?? []) {
            if (b.type === 'tool_use') emit({ type: 'tool', id: b.id, cmd: shortCmd(String(b.input?.command ?? b.name), slug) });
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
      if (!done) emit(code === 0 ? { type: 'done', ms: Date.now() - t0 } : { type: 'error', message: `AI 进程退出（${code}）${err ? '：' + err.slice(-300) : ''}` });
      resolve();
    });
  });
}

// Anthropic API with an API key: one tool that runs the editor CLI (no shell)
async function viaApi(slug: string, prompt: string, saved: Saved, emit: (e: ChatEvent) => void, t0: number): Promise<void> {
  const client = new Anthropic({ apiKey: apiKey() });
  const controller = new AbortController();
  running.set(slug, { kill: () => controller.abort() });
  const tools: Anthropic.Beta.BetaTool[] = [
    {
      name: 'editor',
      description: `Run one Cutroom CLI command for project "${slug}". Pass the command and its arguments as an array, e.g. ["ls","--format","tall"], ["trim","record","--to","@filter+0.8"], ["set","intro","fx.look","\\"warm\\""]. Output is the command's stdout.`,
      input_schema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
      strict: true,
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [...(saved.api ?? []), { role: 'user', content: prompt }];
  for (let turn = 0; turn < 24; turn++) {
    const stream = client.beta.messages.stream(
      {
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        system: systemPrompt(slug),
        tools,
        messages,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsStreaming,
      { signal: controller.signal },
    );
    stream.on('text', (d) => emit({ type: 'text', delta: d }));
    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (msg.stop_reason === 'refusal') {
      emit({ type: 'error', message: '模型拒绝了这个请求' });
      break;
    }
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!uses.length) break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const args = (u.input as { args?: unknown }).args;
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'args must be an array of strings' });
        continue;
      }
      emit({ type: 'tool', id: u.id, cmd: args.join(' ') });
      const r = await runCli(slug, args as string[]);
      emit({ type: 'tool_result', id: u.id, ok: r.ok, out: r.out.slice(0, 600) });
      results.push({ type: 'tool_result', tool_use_id: u.id, is_error: !r.ok, content: r.out.slice(0, 20000) || '(no output)' });
    }
    messages.push({ role: 'user', content: results });
  }
  saved.api = messages;
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
