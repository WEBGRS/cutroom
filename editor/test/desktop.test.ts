import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-desk-test-'));
process.env.VS_DATA = DATA;
fs.mkdirSync(path.join(DATA, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify({ slug: 'demo', title: 'Demo', theme: { accent: '#3b6ef5', bg: ['#000', '#111'] }, scenes: [] }));
const D = await import('../src/desktop');

test('helper events become a capture log: seconds from the first frame, named marks, wheel as pixels', () => {
  const go = 1_000_000;
  const ev = D.toCapture(
    [
      { ev: 'move', ms: go - 50, x: 1, y: 1 },
      { ev: 'move', ms: go, x: 10, y: 20 },
      { ev: 'down', ms: go + 1500, x: 30, y: 40, b: 'left' },
      { ev: 'up', ms: go + 1600, x: 30, y: 40 },
      { ev: 'mark', ms: go + 2000 },
      { ev: 'scroll', ms: go + 2100, x: 5, y: 5, d: -240 },
      { ev: 'mark', ms: go + 2500 },
      { ev: 'mark', ms: go + 2600 },
      { ev: 'move', ms: go + 9000, x: 9, y: 9 },
    ],
    go,
    5,
    ['open', 'open'],
  );
  assert.deepEqual(ev.map((e) => e.type), ['move', 'down', 'up', 'mark', 'scroll', 'mark', 'mark']);
  assert.equal(ev[1].t, 1.5);
  assert.deepEqual([ev[1].x, ev[1].y], [30, 40]);
  assert.deepEqual(ev.filter((e) => e.type === 'mark').map((e) => e.name), ['open', 'open2', 'm3']);
  assert.equal(ev[4].y, 200);
});

test('capture filters: a window by handle, an area as a cropped monitor; the finish pass pads and trims', () => {
  assert.match(D.captureFilter({ ev: 'target', mode: 'window', hwnd: 42 }), /^gfxcapture=hwnd=42:capture_cursor=0:max_framerate=30:width=-2:height=-2,hwdownload/);
  const a = D.captureFilter({ ev: 'target', mode: 'area', region: { x: 110, y: 60, w: 800, h: 600 }, monitor: { handle: 7, index: 1, rect: { x: 100, y: 50, w: 1920, h: 1080 } } });
  assert.match(a, /hmonitor=7:.*crop_left=10:crop_top=10:crop_right=1110:crop_bottom=470/);
  assert.equal(D.finishFilter(2.25, 3), 'setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=6.250,trim=start=2.250:duration=3.000,setpts=PTS-STARTPTS');
  assert.equal(D.cleanName('剪映 Demo!'), 'demo');
  assert.equal(D.cleanName('！！'), 'app');
});

const ff = D.desktopSupported() ? D.captureFfmpeg() : null;
const skip = !D.desktopSupported() ? 'Windows only' : !ff ? 'no FFmpeg with gfxcapture' : false;

// A test window that paints its own clock as 24 black/white cells, so each frame says when it was drawn
async function testWindow(kind: 'anim' | 'still', secs = 20) {
  const exe = await D.helperExe();
  const p = spawn(exe, ['testwin', '640', '360', String(secs), kind]);
  const info = await new Promise<{ hwnd: number }>((ok) => p.stdout.once('data', (d) => ok(JSON.parse(String(d)))));
  return { hwnd: info.hwnd, close: () => p.kill() };
}
function paintTimes(file: string): number[] {
  const raw = spawnSync(ff!, ['-v', 'error', '-i', file, '-vf', 'crop=384:16:16:328,scale=24:1:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }).stdout;
  const out: number[] = [];
  for (let i = 0; i < raw.length / 24; i++) {
    let v = 0;
    for (let b = 0; b < 24; b++) v = v * 2 + (raw[i * 24 + b] > 128 ? 1 : 0);
    out.push(v);
  }
  return out;
}
const wrap = (d: number) => (d > 1 << 23 ? d - (1 << 24) : d < -(1 << 23) ? d + (1 << 24) : d);

test('records a window: 30 fps from the end of the countdown, mouse in window pixels, frames in step with the log', { skip, timeout: 90_000 }, async () => {
  const w = await testWindow('anim');
  try {
    const script = path.join(DATA, 'input.txt');
    fs.writeFileSync(script, ['move 100 100', 'wait 400', 'down 320 180', 'up 320 180', 'wait 300', 'mark', 'wait 500', 'move 600 300', 'wait 600', 'stop'].join('\n'));
    const r = await D.recordDesktop({ slug: 'demo', name: 'Desk Test', hwnd: w.hwnd, now: true, hiddenBar: true, fake: script, marks: ['clicked'] });
    assert.equal(r.file, 'cap/desk-test.mp4');
    assert.deepEqual([r.width, r.height], [640, 360]);
    assert.ok(r.duration > 1.5 && r.duration < 3.5, `duration ${r.duration}`);
    const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'cap', 'desk-test.json'), 'utf8'));
    assert.equal(meta.fps, 30);
    assert.equal(meta.source.kind, 'desktop');
    const down = meta.events.find((e: { type: string }) => e.type === 'down');
    assert.deepEqual([down.x, down.y], [320, 180]);
    assert.ok(down.t > 0.3 && down.t < 0.8, `click at ${down.t}`);
    assert.deepEqual(r.marks.map((m) => m.name), ['clicked']);
    // Frame i was painted at about startedAt + i/30 s
    const times = paintTimes(path.join(DATA, 'demo', 'cap', 'desk-test.mp4'));
    assert.ok(Math.abs(times.length - r.duration * 30) <= 2, `${times.length} frames for ${r.duration} s`);
    const off = times.map((v, i) => wrap(v - ((r.startedAt + (i * 1000) / 30) % (1 << 24)))).sort((a, b) => a - b);
    const med = off[off.length >> 1];
    assert.ok(Math.abs(med) < 80, `median paint offset ${med} ms`);
  } finally {
    w.close();
  }
});

test('a window that never changes still gives the whole length (the last picture is held)', { skip, timeout: 90_000 }, async () => {
  const w = await testWindow('still');
  try {
    const script = path.join(DATA, 'still.txt');
    fs.writeFileSync(script, ['wait 1500', 'stop'].join('\n'));
    const r = await D.recordDesktop({ slug: 'demo', name: 'still', hwnd: w.hwnd, now: true, hiddenBar: true, fake: script });
    assert.ok(r.duration > 1.3 && r.duration < 2.5, `duration ${r.duration}`);
    const n = paintTimes(path.join(DATA, 'demo', 'cap', 'still.mp4')).length;
    assert.ok(Math.abs(n - r.duration * 30) <= 2, `${n} frames for ${r.duration} s`);
  } finally {
    w.close();
  }
});

test('lists windows and monitors; a window that is not open is an error, not a wait', { skip, timeout: 60_000 }, async () => {
  const all = await D.listWindows();
  assert.ok(Array.isArray(all));
  for (const x of all.slice(0, 3)) assert.ok(typeof x.hwnd === 'number' && typeof x.title === 'string' && x.client.w >= 0);
  const mons = await D.listMonitors();
  assert.ok(mons.length >= 1 && mons.some((m) => m.primary));
  await assert.rejects(() => D.recordDesktop({ slug: 'demo', name: 'none', window: 'no-such-window-3f9a', now: true, hiddenBar: true, wait: 20 }), /no window matches no-such-window-3f9a/);
});
