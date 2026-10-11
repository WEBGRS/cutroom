// MCP server (stdio, newline-delimited JSON-RPC) with one tool: run the editor CLI on one project.
// Other agents (Codex, Gemini CLI, Antigravity) edit through it. Usage: node editor/dist/mcp.mjs <slug>
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { imagesIn } from './look';

const slug = process.argv[2];
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOOL = {
  name: 'editor',
  description: `Run one Cutroom CLI command on project "${slug}". Pass the command and its arguments as an array of strings, without any program name or project id, e.g. ["ls","--format","wide"], ["show","intro"], ["set","intro","fx.look","\\"warm\\""]. Returns the command's output.`,
  inputSchema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'The command and its arguments' } }, required: ['args'] },
};

function run(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, slug, ...args], { cwd: ROOT, windowsHide: true });
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
      return reply({ tools: [TOOL] });
    case 'tools/call': {
      if (m.params?.name !== TOOL.name) return fail(-32602, `Unknown tool ${m.params?.name}`);
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
