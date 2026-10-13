// Full access for the API and OpenAI-compatible assistants: a shell and files, like an agent in a terminal.
// Claude Code, Codex, Gemini CLI and Antigravity use their own tools instead.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { killTree } from './proc';

export interface FullTool {
  name: 'shell' | 'read_file' | 'write_file';
  description: string;
  schema: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[]; additionalProperties: false };
}

const SHELL = process.platform === 'win32' ? 'PowerShell' : 'bash';

export const FULL_TOOLS: FullTool[] = [
  {
    name: 'shell',
    description: `Run a ${SHELL} command with the project folder as the working directory and return its output. Use it for anything the editor doesn't do: ffmpeg, python or node scripts, git, installing tools, downloading files, reading the user's code. Runs up to 15 minutes. Don't edit storyboard.json with it.`,
    schema: { type: 'object', properties: { command: { type: 'string', description: 'The command line' } }, required: ['command'], additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a file: an absolute path, or one relative to the project folder. Text comes back as text, images as images.',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'File to read' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'write_file',
    description: 'Write a text file (folders are created): HTML scenes, SVG, scripts, subtitles. Relative paths are in the project folder. The timeline itself (storyboard.json) changes only through the editor tool.',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'File to write' }, content: { type: 'string', description: 'The whole file' } }, required: ['path', 'content'], additionalProperties: false },
  },
];

export const isFullTool = (name: string | undefined) => FULL_TOOLS.some((t) => t.name === name);

// One line for the chat panel's command list
export function fullLabel(name: string, input: Record<string, unknown>): string {
  if (name === 'shell') return String(input.command ?? '');
  return `${name === 'read_file' ? 'read' : 'write'} ${String(input.path ?? '')}`;
}

// Long output keeps its start and its end
export function clip(s: string, max = 20000): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.4);
  return `${s.slice(0, head)}\n…(${s.length - max} characters cut)…\n${s.slice(s.length - (max - head))}`;
}

const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export interface FullResult {
  ok: boolean;
  out: string;
  images?: { mime: string; data: string }[];
}

export function runShell(command: string, cwd: string, signal?: AbortSignal, timeoutMs = 15 * 60_000): Promise<FullResult> {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ${command}`]]
        : [process.env.SHELL || '/bin/bash', ['-lc', command]];
    const child = spawn(cmd, args as string[], { cwd, windowsHide: true });
    let out = '';
    let killed = '';
    const stop = (why: string) => {
      killed = why;
      killTree(child);
    };
    const timer = setTimeout(() => stop(`stopped after ${Math.round(timeoutMs / 60_000)} minutes`), timeoutMs);
    const onAbort = () => stop('stopped');
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (out += d.toString('utf8')));
    child.on('error', (e) => (out += String(e.message)));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const tail = killed ? `\n(${killed})` : code ? `\n(exit code ${code})` : '';
      resolve({ ok: code === 0 && !killed, out: clip(out.trim() + tail) || '(no output)' });
    });
  });
}

function readFile(p: string): FullResult {
  if (!fs.existsSync(p)) return { ok: false, out: `No such file: ${p}` };
  const st = fs.statSync(p);
  if (st.isDirectory()) return { ok: true, out: fs.readdirSync(p).join('\n') || '(empty folder)' };
  const mime = IMAGES[path.extname(p).toLowerCase()];
  if (mime) {
    if (st.size > 5 * 1024 * 1024) return { ok: false, out: `${p} is ${(st.size / 1048576).toFixed(1)} MB; images over 5 MB can't be shown, scale it down first` };
    return { ok: true, out: `${p} (${mime}, ${st.size} bytes)`, images: [{ mime, data: fs.readFileSync(p).toString('base64') }] };
  }
  const buf = fs.readFileSync(p);
  if (buf.subarray(0, 8192).includes(0)) return { ok: true, out: `${p} is a binary file of ${st.size} bytes; inspect it with a program (ffprobe, a script) in the shell` };
  return { ok: true, out: clip(buf.toString('utf8'), 60000) };
}

function writeFile(p: string, content: string): FullResult {
  if (path.basename(p).toLowerCase() === 'storyboard.json') return { ok: false, out: 'Change the timeline through the editor tool: it keeps versions, the undo history and the live preview in sync.' };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return { ok: true, out: `Wrote ${Buffer.byteLength(content)} bytes to ${p}` };
}

// Run one full-access tool call; bad input comes back as an error the model can fix
export async function runFullTool(name: string, input: unknown, cwd: string, signal?: AbortSignal): Promise<FullResult> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
  try {
    if (name === 'shell') {
      const c = str('command');
      return c?.trim() ? runShell(c, cwd, signal) : { ok: false, out: 'command must be a non-empty string' };
    }
    const p = str('path');
    if (!p?.trim()) return { ok: false, out: 'path must be a non-empty string' };
    const abs = path.resolve(cwd, p);
    if (name === 'read_file') return readFile(abs);
    if (name === 'write_file') {
      const c = str('content');
      return c === null ? { ok: false, out: 'content must be a string' } : writeFile(abs, c);
    }
    return { ok: false, out: `Unknown tool ${name}` };
  } catch (e) {
    return { ok: false, out: (e as Error).message };
  }
}
