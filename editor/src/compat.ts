// Other model providers through the OpenAI-compatible Chat Completions API (plain fetch + SSE, no SDK)
import fs from 'node:fs';
import { fullLabel, type FullResult, type FullTool } from './fulltools';

export interface Preset {
  id: string;
  en: string;
  zh: string;
  base: string;
  // Tried first when the provider's model list has it; otherwise the newest chat model is used
  model: string;
  keyUrl?: string;
  env?: string;
  noKey?: boolean;
}

export const PRESETS: Preset[] = [
  { id: 'openai', en: 'OpenAI', zh: 'OpenAI', base: 'https://api.openai.com/v1', model: '', keyUrl: 'https://platform.openai.com/api-keys', env: 'OPENAI_API_KEY' },
  { id: 'gemini', en: 'Google Gemini', zh: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', keyUrl: 'https://aistudio.google.com/apikey', env: 'GEMINI_API_KEY' },
  { id: 'deepseek', en: 'DeepSeek', zh: 'DeepSeek 深度求索', base: 'https://api.deepseek.com', model: 'deepseek-v4-pro', keyUrl: 'https://platform.deepseek.com/api_keys', env: 'DEEPSEEK_API_KEY' },
  { id: 'qwen', en: 'Qwen (Alibaba Model Studio)', zh: '通义千问（阿里云百炼）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/', env: 'DASHSCOPE_API_KEY' },
  { id: 'kimi', en: 'Kimi (Moonshot AI)', zh: 'Kimi（月之暗面）', base: 'https://api.moonshot.cn/v1', model: 'kimi-k3', keyUrl: 'https://platform.kimi.com/', env: 'MOONSHOT_API_KEY' },
  { id: 'glm', en: 'GLM (Zhipu AI)', zh: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2', keyUrl: 'https://open.bigmodel.cn/', env: 'ZHIPUAI_API_KEY' },
  { id: 'openrouter', en: 'OpenRouter (many providers)', zh: 'OpenRouter（多家模型聚合）', base: 'https://openrouter.ai/api/v1', model: '', keyUrl: 'https://openrouter.ai/keys', env: 'OPENROUTER_API_KEY' },
  { id: 'ollama', en: 'Ollama (local models)', zh: 'Ollama（本机模型）', base: 'http://127.0.0.1:11434/v1', model: '', noKey: true },
  { id: 'custom', en: 'Another OpenAI-compatible API', zh: '其他 OpenAI 兼容接口', base: '', model: '' },
];

export const preset = (id: string | undefined) => PRESETS.find((p) => p.id === id);

export interface Conn {
  preset: string;
  base: string;
  model: string;
  key: string;
}

const join = (base: string, p: string) => base.replace(/\/+$/, '') + p;

function headers(c: Conn): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.key) h.Authorization = `Bearer ${c.key}`;
  // OpenRouter asks apps to identify themselves
  if (c.preset === 'openrouter') Object.assign(h, { 'HTTP-Referer': 'https://github.com/WEBGRS/cutroom', 'X-Title': 'Cutroom' });
  return h;
}

// The provider's own error text, short
async function failure(r: Response): Promise<Error> {
  let msg = '';
  try {
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      msg = j.error?.message ?? j.message ?? j.msg ?? t;
    } catch {
      msg = t;
    }
  } catch {
    // Body unreadable
  }
  const e = new Error(`${r.status} ${String(msg).replace(/\s+/g, ' ').slice(0, 300)}`);
  (e as Error & { status: number }).status = r.status;
  return e;
}

// Not chat models: embeddings, speech, images, moderation and the like
const NOT_CHAT = /embed|tts|whisper|transcri|audio|realtime|image|dall-e|moderation|rerank|davinci|babbage|speech|imagen|veo|sora|-live|aqa|guard/i;

export async function listModels(c: Conn): Promise<string[]> {
  const r = await fetch(join(c.base, '/models'), { headers: headers(c), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw await failure(r);
  const j = (await r.json()) as { data?: { id?: string; created?: number }[]; models?: { id?: string; name?: string; created?: number }[] };
  const rows = (j.data ?? j.models ?? []) as { id?: string; name?: string; created?: number }[];
  const seen = new Set<string>();
  return rows
    .map((m) => ({ id: String(m.id ?? m.name ?? '').replace(/^models\//, ''), created: Number(m.created ?? 0) }))
    .filter((m) => m.id && !NOT_CHAT.test(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .map((m) => m.id);
}

// Keep the chosen model if the provider still has it, else the preset's suggestion, else the newest
export function pickModel(ids: string[], want: string, hint: string): string {
  if (want && ids.includes(want)) return want;
  if (hint && ids.includes(hint)) return hint;
  return ids[0] ?? want;
}

export async function ping(c: Conn): Promise<string> {
  const r = await fetch(join(c.base, '/chat/completions'), {
    method: 'POST',
    headers: headers(c),
    body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw await failure(r);
  const j = (await r.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
  return j.model || c.model;
}

// One request with pictures and no tools (the independent reviewer)
export async function askOnce(c: Conn, system: string, text: string, images: string[]): Promise<string> {
  const parts = [{ type: 'text', text }, ...images.map((f) => ({ type: 'image_url', image_url: { url: `data:image/${/\.png$/i.test(f) ? 'png' : 'jpeg'};base64,${fs.readFileSync(f).toString('base64')}` } }))];
  const r = await fetch(join(c.base, '/chat/completions'), {
    method: 'POST',
    headers: headers(c),
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: parts }] }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok) throw await failure(r);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return String(j.choices?.[0]?.message?.content ?? '').trim();
}

type Msg = Record<string, unknown>;

export interface LoopOpts {
  c: Conn;
  system: string;
  history: Msg[];
  prompt: string;
  toolDescription: string;
  run: (args: string[]) => Promise<{ ok: boolean; out: string; images?: { mime: string; data: string }[] }>;
  onText: (s: string) => void;
  onTool: (id: string, args: string[]) => void;
  onToolResult: (id: string, ok: boolean, out: string) => void;
  signal: AbortSignal;
  // Full access: shell and file tools next to the editor, and room for long jobs
  extra?: FullTool[];
  runExtra?: (name: string, input: unknown) => Promise<FullResult>;
  maxTurns?: number;
  // The loop stopped at maxTurns with work left
  onLimit?: () => void;
}

// Read an SSE stream of chat-completion chunks into one assistant message
async function readStream(r: Response, onText: (s: string) => void, signal: AbortSignal) {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let finish = '';
  const calls: { id: string; name: string; args: string }[] = [];
  const onAbort = () => reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j: any;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new Error(String(j.error.message ?? JSON.stringify(j.error)).slice(0, 300));
        const ch = j.choices?.[0];
        if (!ch) continue;
        const d = ch.delta ?? {};
        if (typeof d.content === 'string' && d.content) {
          content += d.content;
          onText(d.content);
        }
        if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
        for (const t of d.tool_calls ?? []) {
          // Chunks are keyed by index; some servers only send ids
          let k = typeof t.index === 'number' ? t.index : t.id ? calls.findIndex((x) => x.id === t.id) : calls.length - 1;
          if (k < 0) k = calls.length;
          calls[k] ??= { id: '', name: '', args: '' };
          if (t.id) calls[k].id = t.id;
          if (t.function?.name) calls[k].name += t.function.name;
          if (t.function?.arguments) calls[k].args += t.function.arguments;
        }
        if (ch.finish_reason) finish = ch.finish_reason;
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return { content, reasoning, finish, calls: calls.filter(Boolean).map((x, n) => ({ ...x, id: x.id || `call_${Date.now()}_${n}` })) };
}

function parseArgs(raw: string): string[] | null {
  try {
    const v = JSON.parse(raw || '{}');
    const a = Array.isArray(v) ? v : v.args;
    return Array.isArray(a) && a.every((x) => typeof x === 'string') ? a : null;
  } catch {
    return null;
  }
}

// Tool-calling loop; returns the conversation to keep (without the system prompt or old reasoning)
export async function chatLoop(o: LoopOpts): Promise<Msg[]> {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'editor',
        description: o.toolDescription,
        parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'The command and its arguments' } }, required: ['args'] },
      },
    },
    ...(o.extra ?? []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
  ];
  const messages: Msg[] = [...o.history, { role: 'user', content: o.prompt }];
  let wrote = false;
  const pics: { mime: string; data: string }[] = [];
  let seeing = true;
  const isPics = (m: Msg) => m.role === 'user' && Array.isArray(m.content);
  const max = o.maxTurns ?? 24;
  let turn = 0;
  for (; turn < max; turn++) {
    const r = await fetch(join(o.c.base, '/chat/completions'), {
      method: 'POST',
      headers: headers(o.c),
      body: JSON.stringify({ model: o.c.model, stream: true, messages: [{ role: 'system', content: o.system }, ...messages], tools }),
      signal: o.signal,
    });
    if (!r.ok) {
      const err = await failure(r);
      // A model without vision rejects the frames: drop them once and carry on with text
      const k = messages.findLastIndex(isPics);
      if (k >= 0 && seeing && [400, 415, 422].includes((err as Error & { status?: number }).status ?? 0)) {
        messages.splice(k, 1, { role: 'user', content: '(This model cannot view images, so the frames from look are not available; judge from the text output.)' });
        seeing = false;
        turn--;
        continue;
      }
      throw err;
    }
    let first = true;
    const m = await readStream(
      r,
      (s) => {
        // Text after tool calls starts a new paragraph
        if (first && wrote) o.onText('\n\n');
        first = false;
        wrote = true;
        o.onText(s);
      },
      o.signal,
    );
    const msg: Msg = { role: 'assistant', content: m.content || null };
    if (m.calls.length) msg.tool_calls = m.calls.map((x) => ({ id: x.id, type: 'function', function: { name: x.name || 'editor', arguments: x.args || '{}' } }));
    // Thinking models (DeepSeek, Kimi, Qwen) want their reasoning back while a tool loop is running
    if (m.reasoning && m.calls.length) msg.reasoning_content = m.reasoning;
    messages.push(msg);
    if (!m.calls.length) break;
    for (const x of m.calls) {
      if (x.name && x.name !== 'editor' && o.runExtra && o.extra?.some((t) => t.name === x.name)) {
        let input: unknown = null;
        try {
          input = JSON.parse(x.args || '{}');
        } catch {
          messages.push({ role: 'tool', tool_call_id: x.id, content: 'Error: arguments must be a JSON object' });
          continue;
        }
        o.onTool(x.id, [fullLabel(x.name, (input ?? {}) as Record<string, unknown>)]);
        const res = await o.runExtra(x.name, input);
        o.onToolResult(x.id, res.ok, res.out.slice(0, 600));
        messages.push({ role: 'tool', tool_call_id: x.id, content: (res.ok ? '' : 'Error: ') + res.out });
        if (res.images?.length) pics.push(...res.images);
        continue;
      }
      const args = parseArgs(x.args);
      if (!args) {
        messages.push({ role: 'tool', tool_call_id: x.id, content: 'Error: arguments must be {"args": ["command", "arg", ...]}' });
        continue;
      }
      o.onTool(x.id, args);
      const res = await o.run(args);
      o.onToolResult(x.id, res.ok, res.out.slice(0, 600));
      messages.push({ role: 'tool', tool_call_id: x.id, content: (res.ok ? '' : 'Error: ') + (res.out.slice(0, 20000) || '(no output)') });
      if (res.images?.length) pics.push(...res.images);
    }
    // Frames from look: vision models see them; others get told once and go on with text
    if (pics.length && seeing) messages.push({ role: 'user', content: [{ type: 'text', text: 'The images from the tool calls above (frames from look, files you read), in order:' }, ...pics.splice(0).map((x) => ({ type: 'image_url' as const, image_url: { url: `data:${x.mime};base64,${x.data}` } }))] });
    pics.length = 0;
  }
  if (turn >= max) o.onLimit?.();
  // Earlier turns' reasoning and frames are not sent again
  return messages.map((x) => {
    if (isPics(x)) return { role: 'user', content: '(frames from look were shown here)' };
    if (!('reasoning_content' in x)) return x;
    const { reasoning_content: _r, ...rest } = x;
    return rest;
  });
}

// Drop the oldest turns, cutting only at a user message so tool calls stay paired
export function trimHistory(msgs: Msg[], max = 60): Msg[] {
  if (msgs.length <= max) return msgs;
  for (let i = msgs.length - max; i < msgs.length; i++) if (msgs[i].role === 'user') return msgs.slice(i);
  return [];
}
