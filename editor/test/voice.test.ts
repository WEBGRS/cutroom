import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// A throwaway data folder, set before the store reads it
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-voice-'));
process.env.VS_DATA = DATA;
process.env.CUTROOM_VOICE_TEST = '1';
const board = {
  slug: 'demo',
  title: 'Demo',
  theme: { accent: '#3b6ef5', bg: ['#000', '#111'] },
  scenes: [
    { id: 'a', lines: [{ zh: '第一句，有 182 种特效。', en: 'There are 182 effects.' }, { zh: '第二句。', en: 'Line two.' }], visual: { kind: 'title', title: 'A' } },
    { id: 'b', lines: [{ zh: '第三句[[重点]]。', en: '' }], visual: { kind: 'title', title: 'B' } },
  ],
};
fs.mkdirSync(path.join(DATA, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify(board, null, 2));
const V = await import('../src/voice');
const S = await import('../src/store');

const ready = (server: http.Server): Promise<string> =>
  new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

test('numbers and abbreviations become words the built-in voice can read', () => {
  assert.equal(V.numberWords(182), 'one hundred eighty-two');
  assert.equal(V.numberWords(4438), 'four thousand four hundred thirty-eight');
  assert.equal(V.speakable('It has 182 effects, 40% faster, 3.5x and 4,438 rows.', 'en'), 'It has one hundred eighty-two effects, forty percent faster, three point five x and four thousand four hundred thirty-eight rows.');
  assert.equal(V.speakable('Export [[MP4]] in 16:9', 'en'), 'Export em pee four in sixteen by nine');
  // Chinese text keeps its digits (the model's own number rules read them); letters get Mandarin letter names
  assert.equal(V.speakable('AI 助手有 182 种特效', 'zh'), '诶爱 助手有 182 种特效');
  assert.equal(V.speakable('用AI剪', 'zh'), '用诶爱剪');
  assert.equal(V.speakable('The AI edits', 'en'), 'The eh eye edits');
});

test('WAV round trip, silence trim and loudness', () => {
  const sr = 24000;
  const x = new Float32Array(sr);
  for (let i = sr * 0.4; i < sr * 0.6; i++) x[i] = 0.5 * Math.sin(i / 5);
  const t = V.trimSilence(x, sr);
  assert.ok(t.length < sr * 0.4 && t.length > sr * 0.2, `trimmed to ${t.length}`);
  const back = V.decodeWav(V.encodeWav(t, sr));
  assert.equal(back.sr, sr);
  assert.equal(back.samples.length, t.length);
  assert.ok(Math.abs(back.samples[Math.floor(t.length / 2)] - t[Math.floor(t.length / 2)]) < 1e-3);
  const l = V.level(t);
  const rms = Math.sqrt(l.reduce((a, v) => a + v * v, 0) / l.length);
  assert.ok(Math.abs(20 * Math.log10(rms) + 20) < 0.5, `rms ${20 * Math.log10(rms)} dB`);
});

test('voicing writes clips and timings, keeps current ones, redoes changed lines', async () => {
  const r1 = await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'test', voice: 'tone' });
  assert.equal(r1.voiced, 3);
  const t1 = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'timings.json'), 'utf8'));
  assert.equal(t1.voice, 'test:tone');
  assert.equal(t1.scenes.a.length, 2);
  assert.equal(t1.scenes.b[0].text, '第三句重点。');
  assert.ok(fs.existsSync(path.join(DATA, 'demo', t1.scenes.a[0].file)));
  assert.deepEqual(V.lineStates('demo', 'zh').map((l) => l.state), ['voiced', 'voiced', 'voiced']);

  const r2 = await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'test', voice: 'tone' });
  assert.equal(r2.voiced, 0);
  assert.equal(r2.kept, 3);

  // Edit one line: only it is stale and only it is re-voiced
  const { doc, version } = S.readDoc('demo');
  doc.board.scenes[0].lines[1].zh = '第二句改了。';
  S.writeDoc('demo', doc, 'cli', ['edit'], version);
  assert.deepEqual(V.lineStates('demo', 'zh').map((l) => l.state), ['voiced', 'stale', 'voiced']);
  const r3 = await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'test', voice: 'tone' });
  assert.equal(r3.voiced, 1);
  assert.equal(r3.kept, 2);

  // English: empty second-language lines are skipped, the spoken text is recorded
  const r4 = await V.voiceProject({ slug: 'demo', lang: 'en', engine: 'test', voice: 'tone' });
  assert.equal(r4.voiced, 2);
  const te = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'timings-en.json'), 'utf8'));
  assert.equal(te.scenes.a[0].spoken, 'There are 182 effects.');
  assert.equal(te.scenes.b[0].file, '');
  assert.deepEqual(V.lineStates('demo', 'en').map((l) => l.state), ['voiced', 'voiced', 'empty']);
});

test('one scene only; a missing key or model fails before any work', async () => {
  const r = await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'test', voice: 'tone', scenes: ['b'], redo: true });
  assert.equal(r.voiced, 1);
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'openai', voice: 'coral', redo: true }), /OpenAI key/);
  process.env.CUTROOM_MODELS = path.join(DATA, 'no-models');
  await assert.rejects(V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'builtin', voice: 'zm_041', redo: true }), /model/);
});

test('cloud engines: request shapes for OpenAI, Gemini and Qwen', async () => {
  const seen: { url: string; auth?: string; goog?: string; body: any }[] = [];
  const pcm = Buffer.alloc(24000 * 2 * 0.5);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 4)), i * 2);
  const wav = V.encodeWav(new Float32Array(12000).map((_, i) => 0.3 * Math.sin(i / 4)), 24000);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ url: req.url!, auth: req.headers.authorization, goog: req.headers['x-goog-api-key'] as string, body: body ? JSON.parse(body) : null });
      if (req.url === '/oa/audio/speech') {
        res.writeHead(200, { 'Content-Type': 'audio/pcm' });
        return res.end(pcm);
      }
      if (req.url?.startsWith('/gm/models?')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ models: [{ name: 'models/gemini-2.5-pro-preview-tts' }, { name: 'models/gemini-3.1-flash-tts-preview' }, { name: 'models/gemini-3-flash' }] }));
      }
      if (req.url?.startsWith('/gm/models/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }));
      }
      if (req.url === '/qw/services/aigc/multimodal-generation/generation') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ output: { audio: { url: `${base}/qw/file.wav` } } }));
      }
      if (req.url === '/qw/file.wav') {
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        return res.end(wav);
      }
      res.writeHead(404);
      res.end();
    });
  });
  const base = await ready(server);
  Object.assign(process.env, { OPENAI_BASE_URL: `${base}/oa`, OPENAI_API_KEY: 'ok-1', CUTROOM_GEMINI_BASE: `${base}/gm`, GEMINI_API_KEY: 'gk-1', CUTROOM_QWEN_BASE: `${base}/qw`, DASHSCOPE_API_KEY: 'qk-1' });
  try {
    for (const [engine, voice] of [['openai', 'coral'], ['gemini', 'Kore'], ['qwen', 'Cherry']] as const) {
      const r = await V.voiceProject({ slug: 'demo', lang: 'zh', engine, voice, scenes: ['a'], redo: true });
      assert.deepEqual(r.failed, [], engine);
      assert.equal(r.voiced, 2, engine);
    }
    const oa = seen.find((s) => s.url === '/oa/audio/speech')!;
    assert.equal(oa.auth, 'Bearer ok-1');
    assert.equal(oa.body.voice, 'coral');
    assert.equal(oa.body.response_format, 'pcm');
    assert.match(oa.body.input, /^第/);
    const gm = seen.find((s) => s.url.startsWith('/gm/models/'))!;
    assert.equal(gm.url, '/gm/models/gemini-3.1-flash-tts-preview:generateContent');
    assert.equal(gm.goog, 'gk-1');
    assert.deepEqual(gm.body.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(gm.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
    const qw = seen.find((s) => s.url.startsWith('/qw/services'))!;
    assert.equal(qw.auth, 'Bearer qk-1');
    assert.equal(qw.body.model, 'qwen3-tts-flash');
    assert.equal(qw.body.input.voice, 'Cherry');
    assert.equal(qw.body.input.language_type, 'Chinese');
    const t = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'timings.json'), 'utf8'));
    assert.equal(t.voice, 'qwen:Cherry');
    assert.ok(t.scenes.a[0].dur > 0.2 && t.scenes.a[0].dur < 0.7, `dur ${t.scenes.a[0].dur}`);
  } finally {
    server.close();
  }
});
