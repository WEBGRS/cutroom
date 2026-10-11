import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pickModel } from '../src/imagegen';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('model choice: the newest version; within a version, full releases before previews and minis', () => {
  assert.equal(pickModel(['gpt-4o', 'gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'dall-e-3'], 'openai'), 'gpt-image-1.5');
  assert.equal(pickModel(['gpt-image-1-mini', 'gpt-image-1'], 'openai'), 'gpt-image-1');
  assert.equal(pickModel(['gpt-4o', 'dall-e-3'], 'openai'), 'dall-e-3');
  assert.equal(pickModel(['gemini-3.5-flash', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image', 'imagen-3.0-generate'], 'gemini'), 'gemini-3.1-flash-image-preview');
  assert.equal(pickModel(['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'], 'gemini'), 'gemini-3.1-flash-image');
  assert.equal(pickModel(['gemini-3.5-flash'], 'gemini'), null);
});

test('imagine: OpenAI with a transparent background and Gemini with an aspect ratio, saved into media/', async () => {
  const seen: { url: string; body: Record<string, any>; auth: string }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: raw ? JSON.parse(raw) : {}, auth: String(req.headers.authorization ?? req.headers['x-goog-api-key'] ?? '') });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/oa/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'gpt-image-1.5' }] }));
      if (req.url === '/oa/images/generations') return res.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
      if (req.url?.startsWith('/gm/models?')) return res.end(JSON.stringify({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] }] }));
      if (req.url === '/gm/models/gemini-3.1-flash-image:generateContent') return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: PNG } }] } }] }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-img-'));
  fs.cpSync(path.resolve('editor/test/fixtures/showcase'), path.join(DATA, 'demo'), { recursive: true });
  const env = { ...process.env, VS_DATA: DATA, CUTROOM_OPENAI_BASE: `http://127.0.0.1:${port}/oa`, CUTROOM_GEMINI_BASE: `http://127.0.0.1:${port}/gm`, OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'gm-test' };
  const cli = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((ok) => {
      const c = spawn(process.execPath, [path.resolve('editor/dist/cli.mjs'), 'demo', ...args], { env });
      let out = '';
      c.stdout.on('data', (b) => (out += b));
      c.stderr.on('data', (b) => (out += b));
      c.on('close', (code) => ok({ code: code ?? 1, out }));
    });
  try {
    const a = await cli('imagine', 'logo', 'a', 'paper', 'plane', 'logo', '--transparent');
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /saved media\/logo\.png/);
    assert.ok(fs.readFileSync(path.join(DATA, 'demo', 'media', 'logo.png')).subarray(1, 4).toString() === 'PNG');
    const gen = seen.find((s) => s.url === '/oa/images/generations')!;
    assert.equal(gen.body.model, 'gpt-image-1.5');
    assert.equal(gen.body.background, 'transparent');
    assert.equal(gen.body.size, '1024x1024');
    assert.match(gen.body.prompt, /paper plane logo.*transparent background/);
    assert.equal(gen.auth, 'Bearer sk-test');

    const b = await cli('imagine', 'hero', 'a', 'desk', 'at', 'dawn', '--engine', 'gemini', '--shape', 'wide');
    assert.equal(b.code, 0, b.out);
    const gm = seen.find((s) => s.url?.includes(':generateContent'))!;
    assert.deepEqual(gm.body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } });
    assert.equal(gm.auth, 'gm-test');
    assert.ok(fs.existsSync(path.join(DATA, 'demo', 'media', 'hero.png')));

    // Gemini can't do transparency: refused before any request
    const n = seen.length;
    const c = await cli('imagine', 'x', 'thing', '--engine', 'gemini', '--transparent');
    assert.notEqual(c.code, 0);
    assert.match(c.out, /transparent backgrounds need the OpenAI engine/);
    assert.equal(seen.length, n);
  } finally {
    server.close();
  }
});
