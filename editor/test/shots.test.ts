import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMove, detectCuts, estimateMotion, type Motion } from '../src/shotdetect';
import { bestWindow, columnEnergy, visibleWidth } from '../src/reframe';
import { speechRanges } from '../src/silence';

const W = 96;
const H = 54;

// Seeded texture: smooth noise plus a few hard-edged boxes, big enough to move a 96×54 window over
function texture(seed: number, tw = 360, th = 220): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const gw = 24;
  const gh = 15;
  const grid = Array.from({ length: gw * gh }, () => rnd() * 255);
  const t = new Float32Array(tw * th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const gx = (x / tw) * (gw - 1);
      const gy = (y / th) * (gh - 1);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const g = (i: number, j: number) => grid[Math.min(gh - 1, j) * gw + Math.min(gw - 1, i)];
      t[y * tw + x] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
    }
  for (let k = 0; k < 40; k++) {
    const bx = Math.floor(rnd() * (tw - 20));
    const by = Math.floor(rnd() * (th - 20));
    const v = rnd() * 255;
    for (let y = by; y < by + 6 + rnd() * 14; y++) for (let x = bx; x < bx + 6 + rnd() * 14; x++) t[y * tw + x] = v;
  }
  return t;
}

// A 96×54 view of the texture: top-left corner (x, y) and a zoom (2 = twice as close)
function view(t: Float32Array, x: number, y: number, zoom = 1, tw = 360): Uint8Array {
  const f = new Uint8Array(W * H);
  const cx = x + W / 2;
  const cy = y + H / 2;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const sx = cx + (i - W / 2) / zoom;
      const sy = cy + (j - H / 2) / zoom;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const p = (a: number, b: number) => t[b * tw + a];
      f[j * W + i] = Math.round((p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy);
    }
  return f;
}

test('motion estimate: content shift and zoom between two frames', () => {
  const t = texture(7);
  const a = view(t, 120, 80);
  const m = estimateMotion(a, view(t, 121.5, 80), W, H);
  // The window moved right, so the content moved left by 1.5 px
  assert.ok(Math.abs(m.ux + 1.5) < 0.3, `ux ${m.ux}`);
  assert.ok(Math.abs(m.uy) < 0.3, `uy ${m.uy}`);
  const z = estimateMotion(a, view(t, 120, 80, 1.03), W, H);
  assert.ok(z.s > 1.015 && z.s < 1.045, `s ${z.s}`);
  assert.ok(z.residual < 0.03, `residual ${z.residual}`);
  // Positive control: unrelated content leaves a large residual
  assert.ok(estimateMotion(a, view(texture(99), 120, 80), W, H).residual > 0.08);
});

test('cuts: hard cuts and a dissolve are found, pans and zooms are not cuts; moves are named', () => {
  const fps = 30;
  const A = texture(1);
  const B = texture(2);
  const C = texture(3);
  const D = texture(4);
  const frames: Uint8Array[] = [];
  // 0–39 static A (slight noise), 40–79 B panning right, 80–129 C pushing in, then a dissolve into D at 130–137, D to 179
  for (let i = 0; i < 40; i++) frames.push(view(A, 100 + (i % 2) * 0.2, 60));
  for (let i = 0; i < 40; i++) frames.push(view(B, 40 + i * 1.2, 60));
  for (let i = 0; i < 50; i++) frames.push(view(C, 130, 80, 1 + i * 0.006));
  const c = frames[frames.length - 1];
  const dEnd = view(D, 150, 90);
  for (let i = 0; i < 8; i++) {
    const k = (i + 1) / 9;
    frames.push(Uint8Array.from(c, (v, j) => Math.round(v * (1 - k) + dEnd[j] * k)));
  }
  for (let i = 0; i < 42; i++) frames.push(view(D, 150, 90));
  const cuts = detectCuts(frames, W, H, fps);
  assert.equal(cuts[0], 0);
  assert.ok(cuts.includes(40), `cuts ${cuts}`);
  assert.ok(cuts.includes(80), `cuts ${cuts}`);
  const soft = cuts.filter((t) => t > 120);
  assert.equal(soft.length, 1, `one cut for the dissolve, got ${cuts}`);
  assert.ok(soft[0] >= 129 && soft[0] <= 139, `dissolve cut at ${soft[0]}`);
  assert.equal(cuts.length, 4, `no extra cuts in the pan or the zoom: ${cuts}`);

  const moves = (a: number, b: number) => {
    const ms: Motion[] = [];
    for (let t = a + 2; t + 2 < b; t += 2) ms.push(estimateMotion(frames[t], frames[t + 2], W, H));
    return classifyMove(ms, W, H).move;
  };
  assert.equal(moves(0, 40), 'static');
  assert.equal(moves(40, 80), 'pan-right');
  assert.equal(moves(80, 130), 'push');
  assert.equal(moves(139, 180), 'static');
});

test('reframe: the 9:16 window follows the moving subject, flat footage stays centred', () => {
  const w = 96;
  const h = 54;
  // A bright square moving around x ≈ 0.8 of the width over a flat background
  const frames = Array.from({ length: 12 }, (_, t) => {
    const f = new Uint8Array(w * h).fill(40);
    const x0 = 72 + (t % 4);
    for (let y = 20; y < 34; y++) for (let x = x0; x < x0 + 10; x++) f[y * w + x] = 230;
    return f;
  });
  const vis = visibleWidth(16 / 9, 9 / 16);
  assert.ok(Math.abs(vis - 0.316) < 0.01, `visible ${vis}`);
  const x = bestWindow(columnEnergy(frames, w, h), vis);
  // The window [x·(1-vis), x·(1-vis)+vis] must contain the subject: columns 72..85 of 96
  const left = x * (1 - vis);
  assert.ok(left <= 72 / 96 && left + vis >= 85 / 96, `window ${left.toFixed(2)}–${(left + vis).toFixed(2)} (pos ${x})`);
  assert.equal(bestWindow(columnEnergy([new Uint8Array(w * h).fill(90)], w, h), vis), 0.5);
  assert.equal(bestWindow(columnEnergy(frames, w, h), 1), 0.5);
});

test('silences: long pauses are cut with padding, short ones and quiet recordings stay', () => {
  const rate = 16000;
  // 1 s speech, 0.8 s pause, 0.5 s speech, 0.2 s pause, 1 s speech, 1 s trailing pause; low hiss throughout
  const parts: [number, boolean][] = [[1, true], [0.8, false], [0.5, true], [0.2, false], [1, true], [1, false]];
  const total = parts.reduce((a, [d]) => a + d, 0);
  const s = new Int16Array(Math.round(total * rate));
  let i = 0;
  let seed = 3;
  for (const [d, loud] of parts)
    for (let k = 0; k < Math.round(d * rate); k++, i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const hiss = ((seed / 4294967296) - 0.5) * 120;
      s[i] = Math.round((loud ? Math.sin((2 * Math.PI * 220 * i) / rate) * 9000 : 0) + hiss);
    }
  const { keep } = speechRanges(s, rate);
  assert.equal(keep.length, 2, JSON.stringify(keep));
  assert.ok(Math.abs(keep[0][0]) < 0.01 && Math.abs(keep[0][1] - 1.12) < 0.03, JSON.stringify(keep));
  // The 0.2 s pause stays inside the second piece; the trailing second goes
  assert.ok(Math.abs(keep[1][0] - 1.68) < 0.03 && Math.abs(keep[1][1] - 3.62) < 0.03, JSON.stringify(keep));
  // No speech at all: nothing is cut
  assert.deepEqual(speechRanges(new Int16Array(rate).fill(5), rate).keep, [[0, 1]]);
});

test('time-lapse: a sky that changes every frame over still ground is not a cut; a real cut still is', () => {
  const ground = texture(11);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < 90; i++) {
    const sky = view(texture(100 + i), 50, 40);
    const land = view(ground, 120, 90);
    const flicker = (i % 3) * 14;
    // Top half: a different sky (and exposure) every frame; bottom half: the same landscape
    frames.push(Uint8Array.from(land, (v, j) => (j < (H / 2) * W ? Math.min(255, sky[j] + flicker) : v)));
  }
  assert.deepEqual(detectCuts(frames, W, H, 30), [0], 'no cuts in the time-lapse');
  const other = texture(77);
  const withCut = [...frames.slice(0, 45), ...Array.from({ length: 45 }, () => view(other, 140, 60))];
  assert.ok(detectCuts(withCut, W, H, 30).includes(45), 'the real cut is found');
});

test('a single shot gives one start and no cuts', () => {
  const t = texture(5);
  const frames = Array.from({ length: 60 }, (_, i) => view(t, 100, 70 + i * 0.5));
  assert.deepEqual(detectCuts(frames, W, H, 30), [0]);
});
