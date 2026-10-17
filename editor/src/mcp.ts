// MCP server (stdio, newline-delimited JSON-RPC) with one tool: run the editor CLI on one project.
// Other agents (Codex, Gemini CLI, Antigravity) edit through it. Usage: node editor/dist/mcp.mjs <slug>
// Full access (CUTROOM_FULL=1) adds shell, read_file and write_file, run by the editor server under the same rule as
// the API assistants: the project folder at once, anything else after the user allows it in the chat panel.
// With --ask it serves only `approve`, Claude Code's permission prompt in full access, which asks the panel too.
// Both reach the editor at CUTROOM_SERVER with CUTROOM_ASK_TOKEN.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { imagesIn } from './look';
import { FULL_TOOLS } from './fulltools';

const slug = process.argv[2];
const askOnly = process.argv.includes('--ask');
const full = process.env.CUTROOM_FULL === '1';
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOOL = {
  name: 'editor',
  description: `Run one Cutroom CLI command on project "${slug}". Pass the command and its arguments as an array of strings, without any program name or project id, e.g. ["ls","--format","wide"], ["show","intro"], ["set","intro","fx.look","\\"warm\\""]. Returns the command's output. Recording, voice-over, look and export can take minutes (record-window waits for the person to press Stop); wait for the result.`,
  inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'The command and its arguments' } }, required: ['args'] },
};

export const ASK_TOOL = {
  name: 'approve',
  description: 'Asks the person in the Cutroom chat panel whether a tool call may run.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
};

const editorCall = (route: string, body: object) =>
  fetch(`${process.env.CUTROOM_SERVER ?? ''}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cutroom-Ask': process.env.CUTROOM_ASK_TOKEN ?? '' },
    body: JSON.stringify({ slug, ...body }),
    // An answer can take the user a while
    signal: AbortSignal.timeout(20 * 60_000),
  }).then((r) => r.json());

// Claude Code's permission prompt format: {"behavior":"allow","updatedInput":…} or {"behavior":"deny","message":…}
async function ask(p: { tool_name?: string; input?: Record<string, unknown> }): Promise<string> {
  const input = p.input ?? {};
  try {
    const j = (await editorCall('/api/chat/permission', { tool: p.tool_name ?? '', input })) as { allow?: boolean; message?: string };
    return JSON.stringify(j.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: j.message || 'The user declined this step in the Cutroom chat panel.' });
  } catch (e) {
    return JSON.stringify({ behavior: 'deny', message: `Could not ask the user: ${(e as Error).message}` });
  }
}

function run(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, slug, ...args], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}

const send = (msg: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle(m: { id?: number | string; method?: string; params?: any }) {
  const reply = (result: object) => m.id !== undefined && send({ id: m.id, result });
  const fail = (code: number, message: string) => m.id !== undefined && send({ id: m.id, error: { code, message } });
  switch (m.method) {
    case 'initialize':
      return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cutroom', version: '1' } });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: askOnly ? [ASK_TOOL] : [TOOL, ...(full ? FULL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) : [])] });
    case 'tools/call': {
      const name = m.params?.name;
      if (askOnly) return name === ASK_TOOL.name ? reply({ content: [{ type: 'text', text: await ask(m.params?.arguments ?? {}) }] }) : fail(-32602, `Unknown tool ${name}`);
      if (full && FULL_TOOLS.some((t) => t.name === name)) {
        try {
          const r = (await editorCall('/api/chat/full-step', { name, input: m.params?.arguments ?? {} })) as { ok: boolean; out: string; images?: { mime: string; data: string }[] };
          const pics = process.env.CUTROOM_LOOK_FILES ? [] : (r.images ?? []).map((x) => ({ type: 'image', data: x.data, mimeType: x.mime }));
          return reply({ content: [{ type: 'text', text: r.out || '(no output)' }, ...pics], isError: !r.ok });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: `The editor did not answer: ${(e as Error).message}` }], isError: true });
        }
      }
      if (name !== TOOL.name) return fail(-32602, `Unknown tool ${name}`);
      const a = m.params?.arguments?.args;
      if (!Array.isArray(a) || !a.every((x) => typeof x === 'string')) return reply({ content: [{ type: 'text', text: 'args must be an array of strings' }], isError: true });
      const r = await run(a);
      // Frames from look go back as images, or as files to open for clients that drop images (Antigravity)
      const files = !!process.env.CUTROOM_LOOK_FILES;
      const pics = files ? [] : imagesIn(r.out).map((x) => ({ type: 'image', data: x.data, mimeType: x.mime }));
      const text = (r.out.slice(0, 20000) || '(no output)') + (files && imagesIn(r.out).length ? '\nOpen each image path above with your file viewer to see the frames.' : '');
      return reply({ content: [{ type: 'text', text }, ...pics], isError: !r.ok });
    }
    default:
      // Notifications (no id) need no answer
      if (m.id !== undefined) fail(-32601, `Method not found: ${m.method}`);
  }
}

if (slug) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } });
    }
    for (const x of Array.isArray(m) ? m : [m]) void handle(x);
  });
}
