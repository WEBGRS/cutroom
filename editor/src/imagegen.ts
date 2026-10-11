// AI image generation into a project's media folder: OpenAI image models (transparent backgrounds) or Gemini
import fs from 'node:fs';
import path from 'node:path';
import { preset } from './compat';
import { PUBLIC } from './store';
import { readSettings } from './settings';

export type ImageEngine = 'openai' | 'gemini';
export type Shape = 'square' | 'wide' | 'tall';

const OPENAI_BASE = () => {
  const c = readSettings().ai?.compat;
  return (process.env.CUTROOM_OPENAI_BASE ?? ((c?.preset === 'openai' && c.base) || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')).replace(/\/+$/, '');
};
const GEMINI_BASE = () => (process.env.CUTROOM_GEMINI_BASE ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');

// Env variable first, then the key saved for that provider in Settings › AI
export function keyOf(engine: ImageEngine): string {
  const p = preset(engine);
  const env = p?.env ? (process.env[p.env] ?? '') : '';
  return env || (readSettings().ai?.compat?.keys?.[engine] ?? '');
}

async function fail(r: Response, what: string): Promise<Error> {
  const t = await r.text().catch(() => '');
  let msg = t;
  try {
    const j = JSON.parse(t);
    msg = j.error?.message ?? j.message ?? t;
  } catch {
    // Not JSON
  }
  return new Error(`${what}: ${r.status} ${String(msg).slice(0, 300)}`);
}

// Newest model from the provider's own list: names change too often to hard-code
export function pickModel(names: string[], engine: ImageEngine): string | null {
  const ok = names.filter((n) => (engine === 'openai' ? /^gpt-image/i.test(n) || /^dall-e-3$/i.test(n) : /image/i.test(n) && !/imagen-[0-3]\b/i.test(n)));
  if (!ok.length) return null;
  // The newest version wins; within a version, full releases before previews and minis
  const score = (n: string) => (/dall-e/i.test(n) ? -100 : 0) + Number(/(\d+(?:\.\d+)?)/.exec(n.replace(/^gpt-image-?/i, ''))?.[1] ?? 0) - (/mini|lite/i.test(n) ? 0.002 : 0) - (/preview|exp/i.test(n) ? 0.001 : 0);
  return [...ok].sort((a, b) => score(b) - score(a))[0];
}

async function openaiImage(key: string, prompt: string, shape: Shape, transparent: boolean): Promise<Buffer> {
  const base = OPENAI_BASE();
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let model = 'gpt-image-1';
  const list = await fetch(`${base}/models`, { headers });
  if (list.ok) model = pickModel(((await list.json()).data ?? []).map((m: { id: string }) => m.id), 'openai') ?? model;
  const size = shape === 'wide' ? '1536x1024' : shape === 'tall' ? '1024x1536' : '1024x1024';
  const body: Record<string, unknown> = { model, prompt, size, n: 1 };
  if (/^gpt-image/i.test(model)) Object.assign(body, { output_format: 'png', background: transparent ? 'transparent' : 'opaque' });
  else body.response_format = 'b64_json';
  const r = await fetch(`${base}/images/generations`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw await fail(r, `OpenAI ${model}`);
  const b64 = (await r.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI ${model} returned no image`);
  return Buffer.from(b64, 'base64');
}

async function geminiImage(key: string, prompt: string, shape: Shape): Promise<Buffer> {
  const base = GEMINI_BASE();
  const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
  const list = await fetch(`${base}/models?pageSize=1000`, { headers });
  if (!list.ok) throw await fail(list, 'Gemini model list');
  const models: { name: string; supportedGenerationMethods?: string[] }[] = (await list.json()).models ?? [];
  const names = models.filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  const model = pickModel(names, 'gemini');
  if (!model) throw new Error('this Gemini key has no image model');
  const aspectRatio = shape === 'wide' ? '16:9' : shape === 'tall' ? '9:16' : '1:1';
  const r = await fetch(`${base}/models/${model}:generateContent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } } }),
  });
  if (!r.ok) throw await fail(r, `Gemini ${model}`);
  const parts: { inlineData?: { data: string; mimeType?: string } }[] = (await r.json()).candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error(`Gemini ${model} returned no image (it may have refused the prompt)`);
  return Buffer.from(img.inlineData!.data, 'base64');
}

const fileType = (b: Buffer) => (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null);

// Generate and save media/<name>.<ext>; returns the project-relative path
export async function imagine(o: { slug: string; name: string; prompt: string; engine?: ImageEngine; shape?: Shape; transparent?: boolean }): Promise<{ file: string; engine: ImageEngine; bytes: number }> {
  const engines: ImageEngine[] = o.engine ? [o.engine] : (['openai', 'gemini'] as ImageEngine[]).filter((e) => keyOf(e));
  const engine = engines[0];
  if (!engine) throw new Error('image generation needs an OpenAI or Gemini key: add one in Settings › AI (Other models) or set OPENAI_API_KEY / GEMINI_API_KEY');
  const key = keyOf(engine);
  if (!key) throw new Error(`no ${engine === 'openai' ? 'OpenAI' : 'Gemini'} key: add it in Settings › AI or set ${engine === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'}`);
  if (o.transparent && engine === 'gemini') throw new Error('transparent backgrounds need the OpenAI engine (--engine openai); Gemini images always have a background');
  const prompt = o.transparent ? `${o.prompt}. Isolated subject on a transparent background, no backdrop, no shadow on the ground.` : o.prompt;
  const buf = engine === 'openai' ? await openaiImage(key, prompt, o.shape ?? 'square', !!o.transparent) : await geminiImage(key, prompt, o.shape ?? 'square');
  const ext = fileType(buf);
  if (!ext) throw new Error('the image service sent something that is not an image');
  const name = o.name.toLowerCase().replace(/[^a-z0-9一-龥-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  const dir = path.join(PUBLIC, o.slug, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const rel = `media/${name}.${ext}`;
  fs.writeFileSync(path.join(PUBLIC, o.slug, rel), buf);
  return { file: rel, engine, bytes: buf.length };
}
