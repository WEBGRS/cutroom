import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A throwaway data folder and a fake HD install (empty model files, a Python worker that writes tones)
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-hd-'));
const MODELS = path.join(DATA, '_models');
const LOG = path.join(DATA, 'worker.log');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = [path.join(HERE, '..', '..', 'test', 'fixtures', 'fake_qwen_worker.py'), path.join(HERE, 'fixtures', 'fake_qwen_worker.py')].find((f) => fs.existsSync(f))!;
const python = ['python3', 'python'].map((p) => spawnSync(p, ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' })).find((r) => r.status === 0)?.stdout.trim();
process.env.VS_DATA = DATA;
process.env.CUTROOM_QWEN_MODELS = MODELS;
process.env.CUTROOM_QWEN_PYTHON = python ?? 'python';
process.env.CUTROOM_QWEN_WORKER = FAKE;
process.env.FAKE_QWEN_LOG = LOG;
const board = {
  slug: 'demo',
  title: 'Demo',
  theme: { accent: '#3b6ef5', bg: ['#000', '#111'] },
  scenes: [
    { id: 'a', lines: [{ zh: '用 AI 剪 GitHub 上的项目。', en: 'Cut a GitHub project with AI.' }, { zh: '第二句。', en: 'Line two.' }], visual: { kind: 'title', title: 'A' } },
    { id: 'b', lines: [{ zh: '第三句[[重点]]。', en: '' }], visual: { kind: 'title', title: 'B' } },
  ],
};
fs.mkdirSync(path.join(DATA, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify(board, null, 2));
const V = await import('../src/voice');
const H = await import('../src/localvoice');
const requests = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('the HD engine asks to be installed until the model is there', () => {
  assert.equal(H.localReady(), false);
  const st = V.engineStatus().find((e) => e.id === 'local')!;
  assert.deepEqual([st.ready, st.need], [false, 'install']);
  assert.match(V.notReady('local') ?? '', /install|安装/);
  for (const f of ['model.safetensors', path.join('speech_tokenizer', 'model.safetensors')]) {
    const p = path.join(MODELS, H.QWEN.base.name, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
  }
  assert.equal(H.localReady(), true);
  assert.equal(H.designReady(), false);
  assert.equal(V.engineStatus().find((e) => e.id === 'local')!.need, undefined);
});

test('voicing with a preset sends each line with its reference clip and words', async () => {
  const r = await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'local', voice: 'casual_f' });
  assert.equal(r.voiced, 3, JSON.stringify(r.failed));
  const t = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'timings.json'), 'utf8'));
  assert.equal(t.voice, 'local:casual_f');
  assert.ok(t.scenes.a[0].dur > 1);
  const speak = requests().filter((q) => q.op === 'speak');
  assert.equal(speak.length, 3);
  assert.ok(speak[0].ref.endsWith(path.join('editor', 'voices', 'casual_f.wav')), speak[0].ref);
  assert.match(speak[0].ref_text, /GitHub/);
  // The model reads the text as written: no letter spelling, markup gone
  assert.deepEqual(speak.map((q) => q.text).sort(), ['用 AI 剪 GitHub 上的项目。', '第三句重点。', '第二句。'].sort());
  // Redoing asks for new takes under new file names
  const before = t.scenes.a[0].file;
  await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'local', voice: 'casual_f', redo: true, lines: ['a:0'] });
  const t2 = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'timings.json'), 'utf8'));
  assert.notEqual(t2.scenes.a[0].file, before);
  assert.equal(t2.scenes.a[1].file, t.scenes.a[1].file);
  H.stopLocal();
});

test('your own voice from a clip: listed, usable, removable', async () => {
  const sr = 24000;
  const x = new Float32Array(sr * 6).map((_, i) => 0.3 * Math.sin(i / 9));
  const clip = path.join(DATA, 'me.wav');
  fs.writeFileSync(clip, V.encodeWav(x, sr));
  const v = H.addCustomVoice({ name: '我的声音', lang: 'zh', audio: clip, text: '这是我读的一段话。', from: 'record' });
  assert.match(v.id, /^my-/);
  const def = (await import('../src/voices')).engineDef('local')!;
  assert.ok(V.voicesOf(def).some((x) => x.id === v.id && x.mine === 'record'));
  // Picking a voice keeps the install's own settings
  const St = await import('../src/settings');
  St.writeSettings({ voice: { ...(St.readSettings().voice ?? {}), local: { idle: 7 } } });
  V.writeVoiceSettings({ engine: 'local', voice: v.id, lang: 'zh' });
  assert.equal(V.voiceOf(V.voiceSettings(), 'local', 'zh'), v.id);
  assert.equal(St.readSettings().voice.local.idle, 7);
  assert.equal(H.localCfg().idle, 7);
  const r = await V.voiceProject({ slug: 'demo', lang: 'zh', redo: true, lines: ['b:0'] });
  assert.equal(r.voiced, 1, JSON.stringify(r.failed));
  const last = requests().filter((q) => q.op === 'speak').pop();
  assert.equal(last.ref_text, '这是我读的一段话。');
  assert.ok(last.ref.includes(v.id));
  // Too short to clone from
  fs.writeFileSync(clip, V.encodeWav(x.slice(0, sr), sr));
  assert.throws(() => H.addCustomVoice({ name: 'x', lang: 'zh', audio: clip, from: 'import' }), /short|短/);
  H.removeCustomVoice(v.id);
  assert.ok(!V.voicesOf(def).some((x) => x.id === v.id));
  assert.equal(V.voiceOf(V.voiceSettings(), 'local', 'zh'), 'casual_m');
  assert.throws(() => H.removeCustomVoice('../demo'));
  H.stopLocal();
});

test('a worker that dies reports why instead of hanging', async () => {
  process.env.FAKE_QWEN_CRASH = '1';
  try {
    const r = await V.voiceProject({ slug: 'demo', lang: 'zh', engine: 'local', voice: 'casual_m', redo: true, lines: ['a:1'] });
    assert.equal(r.voiced, 0);
    assert.match(r.failed[0].error, /CUDA out of memory/);
  } finally {
    delete process.env.FAKE_QWEN_CRASH;
    H.stopLocal();
  }
});
