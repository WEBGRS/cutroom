import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { REVIEWER_SYSTEM, callReviewer, reviewAnswer, reviewRequest, reviewerUser, safeImages } from '../src/review';
import { askOnce } from '../src/compat';

test('the reviewer gets the brief, the table, the scope and the images, and the rules', () => {
  const u = reviewerUser({ brief: 'BRIEF-X', table: 'TABLE-Y', scope: 'whole cut', images: ['C:/l/a.jpeg'], files: true });
  for (const s of ['BRIEF-X', 'TABLE-Y', 'whole cut', 'C:/l/a.jpeg', 'Read']) assert.ok(u.includes(s), s);
  assert.match(REVIEWER_SYSTEM, /first line.*ready.*revise/i);
  assert.match(REVIEWER_SYSTEM, /Q Picture/);
  assert.doesNotMatch(u + REVIEWER_SYSTEM, /chat history|conversation so far/i);
});

test('a sample review tells the reviewer to judge only the scenes it shows', () => {
  const part = reviewerUser({ brief: 'B', table: 'T', scope: 'scenes intro, record and 1 cut (5 frames)', images: [], files: false, partial: true });
  assert.match(part, /This is a sample \(scenes intro, record and 1 cut \(5 frames\)\), not the whole cut: judge only these scenes; features and scenes outside them are not missing\./);
  const whole = reviewerUser({ brief: 'B', table: 'T', scope: 'whole cut', images: [], files: false });
  assert.doesNotMatch(whole, /This is a sample/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-look-'));
  assert.match(reviewRequest({ brief: 'B', table: 'T', scope: 'scenes a', images: [], dir, files: false, partial: true }).user, /This is a sample \(scenes a\)/);
});

test('the reviewer sees the chosen plan when there is one', () => {
  const u = reviewerUser({ brief: 'B', table: 'T', scope: 'whole cut', images: [], files: false, plan: '# Plan B: Pixel tour\nPalette: #111 #ffd479' });
  assert.match(u, /<chosen plan>\n# Plan B: Pixel tour\nPalette: #111 #ffd479\n<\/chosen plan>/);
  assert.doesNotMatch(reviewerUser({ brief: 'B', table: 'T', scope: 'whole cut', images: [], files: false }), /chosen plan/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-look-'));
  assert.match(reviewRequest({ brief: 'B', table: 'T', scope: 'S', images: [], dir, files: false, plan: 'PLAN-Z' }).user, /PLAN-Z/);
  assert.match(REVIEWER_SYSTEM, /chosen plan/);
});

test('the reviewer call waits as long as it is told, and says when the editor is not running', async () => {
  // A port nothing listens on
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const dead = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const off = await callReviewer(`http://127.0.0.1:${dead}`, { slug: 's' });
  assert.deepEqual(off, { unavailable: `the editor is not running at http://127.0.0.1:${dead}` });

  let body: any;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      body = JSON.parse(b);
      if (body.slow) return;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body.fail ? { error: 'no review sheets' } : { text: 'ready\nscope: x' }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  assert.deepEqual(await callReviewer(base, { slug: 's', images: ['a'] }), { text: 'ready\nscope: x' });
  assert.deepEqual(body, { slug: 's', images: ['a'] });
  assert.deepEqual(await callReviewer(base, { fail: true }), { error: 'no review sheets' });
  const slow = await callReviewer(base, { slow: true }, 300);
  assert.match(slow.error ?? '', /did not answer within/);
  srv.closeAllConnections();
  srv.close();
});

test('images outside the look folder are dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-look-'));
  const inside = path.join(dir, 'a.jpeg');
  fs.writeFileSync(inside, 'x');
  assert.deepEqual(safeImages([inside, path.join(os.tmpdir(), 'evil.jpeg'), path.join(dir, '..', 'b.jpeg')], dir), [path.resolve(inside)]);
});

test('a path outside the look folder sent by the client never reaches the reviewer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-look-'));
  const inside = path.join(dir, 'a.jpeg');
  const evil = path.join(os.tmpdir(), 'secret-evil.jpeg');
  for (const files of [true, false]) {
    const r = reviewRequest({ brief: 'B', table: 'T', scope: 'S', images: [inside, evil], dir, files });
    assert.deepEqual(r.images, [path.resolve(inside)]);
    assert.ok(!r.user.includes('secret-evil'));
    assert.equal(r.user.includes(path.resolve(inside)), files);
  }
});

test('an empty reviewer answer is reported as unavailable', () => {
  assert.deepEqual(reviewAnswer('ready scope: x'), { text: 'ready scope: x' });
  for (const t of ['', '   ']) {
    const r = reviewAnswer(t);
    assert.ok('unavailable' in r && !('text' in r));
  }
});

test('askOnce sends the images as image_url parts and returns the text', async () => {
  let got: any;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      got = JSON.parse(b);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'ready\nscope: x' } }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as AddressInfo).port;
  const img = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-img-')), 'a.jpeg');
  fs.writeFileSync(img, 'jpegbytes');
  const text = await askOnce({ preset: 'custom', base: `http://127.0.0.1:${port}/v1`, model: 'm', key: 'k' }, 'SYS', 'USER', [img]);
  srv.close();
  assert.equal(text, 'ready\nscope: x');
  assert.equal(got.messages[0].role, 'system');
  const parts = got.messages[1].content;
  assert.equal(parts[0].text, 'USER');
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/);
});
