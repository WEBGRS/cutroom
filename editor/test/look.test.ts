import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// A throwaway data folder, set before the store reads it
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-look-'));
process.env.VS_DATA = DATA;
for (const d of ['demo/media', 'other/media', 'fonts', 'music', 'sfx', 'exports/editor']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify({ scenes: [{ id: 'a', visual: { kind: 'image', src: '../other/media/b.jpg' } }] }));
fs.writeFileSync(path.join(DATA, 'demo', 'media', 'a.jpg'), 'a');
fs.writeFileSync(path.join(DATA, 'other', 'media', 'b.jpg'), 'b');
fs.writeFileSync(path.join(DATA, 'fonts', 'f.ttf'), 'f');
fs.writeFileSync(path.join(DATA, 'exports', 'editor', 'old.mp4'), 'x'.repeat(1000));
fs.mkdirSync(path.join(DATA, 'unrelated'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'unrelated', 'big.mp4'), 'x');
const L = await import('../src/look');
const { slimPublic } = await import('../src/slim');
const { chatLoop } = await import('../src/compat');

test('Claude Code may read only the frames folder', () => {
  const rule = L.lookReadRule();
  assert.match(rule, /^Read\(\/\/.+\/look\/\*\*\)$/);
  if (process.platform === 'win32') assert.match(rule, /^Read\(\/\/[a-z]\/Users\//);
});

test('image lines are honoured only inside the frames folder', () => {
  fs.mkdirSync(L.lookDir(), { recursive: true });
  const ok = path.join(L.lookDir(), 'demo-1.jpeg');
  fs.writeFileSync(ok, 'jpeg-bytes');
  const out = `rendering…\nimage: ${ok}  (0:01.00, a +1.00 s)\nimage: ${path.join(DATA, 'demo', 'media', 'a.jpg')}  (sneaky)\nimage: ${path.join(L.lookDir(), 'gone.jpeg')}\n`;
  const pics = L.imagesIn(out);
  assert.equal(pics.length, 1);
  assert.equal(pics[0].mime, 'image/jpeg');
  assert.equal(Buffer.from(pics[0].data, 'base64').toString(), 'jpeg-bytes');
});

test('the render bundle gets the project, shared assets and projects it points into, nothing else', () => {
  const s = slimPublic('demo');
  assert.ok(s, 'hard links work in the temp folder');
  try {
    assert.deepEqual(fs.readdirSync(s.dir).sort(), ['demo', 'fonts', 'music', 'other', 'sfx']);
    assert.equal(fs.readFileSync(path.join(s.dir, 'other', 'media', 'b.jpg'), 'utf8'), 'b');
  } finally {
    s.cleanup();
  }
  assert.ok(!fs.existsSync(s.dir));
  assert.equal(fs.readFileSync(path.join(DATA, 'demo', 'media', 'a.jpg'), 'utf8'), 'a', 'originals survive the cleanup');
});

// OpenAI-compatible server that rejects images when it has no vision
function mock(vision: boolean): Promise<{ base: string; bodies: any[]; close: () => void }> {
  const bodies: any[] = [];
  const chunk = (res: http.ServerResponse, delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const b = JSON.parse(body);
      bodies.push(b);
      const hasImage = b.messages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url'));
      if (hasImage && !vision) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'image input is not supported' } }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const last = b.messages.at(-1);
      if (last.role === 'user' && typeof last.content === 'string' && last.content === 'look at it') {
        chunk(res, { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'editor', arguments: '{"args":["look"]}' } }] }, 'tool_calls');
      } else chunk(res, { content: hasImage ? 'I can see it.' : 'Text only.' }, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies, close: () => server.close() })));
}

for (const vision of [true, false])
  test(`other models: frames ${vision ? 'reach a vision model' : 'are dropped once for a text-only model'}`, async () => {
    const m = await mock(vision);
    let text = '';
    try {
      const kept = await chatLoop({
        c: { preset: 'custom', base: m.base, model: 'm', key: '' },
        system: 'sys',
        history: [],
        prompt: 'look at it',
        toolDescription: 'run',
        run: async () => ({ ok: true, out: 'image: x', images: [{ mime: 'image/jpeg', data: 'AAAA' }] }),
        onText: (s) => (text += s),
        onTool: () => undefined,
        onToolResult: () => undefined,
        signal: new AbortController().signal,
      });
      assert.equal(text.trim(), vision ? 'I can see it.' : 'Text only.');
      // The saved conversation never carries the image data
      assert.ok(!JSON.stringify(kept).includes('AAAA'));
      if (!vision) assert.ok(m.bodies.at(-1).messages.some((x: any) => typeof x.content === 'string' && x.content.includes('cannot view images')));
    } finally {
      m.close();
    }
  });
