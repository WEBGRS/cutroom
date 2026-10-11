import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { htmlMeta, prepareHtml, varValues } from '../../src/lib/html';
import { lintHtml, pageName, starterHtml } from '../src/htmlfiles';

const ROOT_TAG = `<div id="root" data-composition-id="chart" data-width="1080" data-height="1920" data-duration="6.5"
  data-composition-variables='[{"id":"title","type":"string","default":"Q4 > Q3"},{"id":"bars","type":"number","default":5}]'>`;
const PAGE = `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script></head>
<body>${ROOT_TAG}<div class="clip" data-start="0" data-duration="6.5"></div></div>
<div data-composition-src="compositions/intro.html"></div>
<script>const tl = gsap.timeline({ paused: true }); window.__timelines["chart"] = tl;</script></body></html>`;

test('htmlMeta reads the root even when an attribute holds ">"', () => {
  const m = htmlMeta(PAGE);
  assert.equal(m.id, 'chart');
  assert.deepEqual([m.w, m.h, m.dur], [1080, 1920, 6.5]);
  assert.deepEqual(m.vars.map((v) => v.id), ['title', 'bars']);
  assert.equal(m.vars[0].default, 'Q4 > Q3');
  assert.deepEqual(m.subs, ['compositions/intro.html']);
  assert.deepEqual(m.remote, ['https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js']);
  assert.deepEqual(varValues(m, { bars: 8 }), { title: 'Q4 > Q3', bars: 8 });
  // No root: the defaults, so any page still plays
  assert.deepEqual([htmlMeta('<p>hi</p>').w, htmlMeta('<p>hi</p>').h, htmlMeta('<p>hi</p>').dur], [1920, 1080, undefined]);
});

test('pageName: what an HTML scene is called', () => {
  assert.equal(pageName('scenes/loop/index.html'), 'loop');
  assert.equal(pageName('scenes/walk/walk.html'), 'walk');
  assert.equal(pageName('scenes/loop/tall.html'), 'loop/tall');
  assert.equal(pageName('scenes/card.html'), 'card');
  assert.equal(pageName('../showcase/scenes/loop/index.html'), 'loop');
});

test('prepareHtml puts the runtime first in <head> and keeps the doctype first', () => {
  const out = prepareHtml(PAGE, 'http://x/p/', { title: '</script><b>$& done' });
  assert.ok(out.startsWith('<!doctype html>'));
  const head = out.indexOf('<head>');
  assert.ok(out.indexOf('<base href="http://x/p/">') === head + 6, 'base right after <head>');
  assert.ok(out.indexOf('window.__cutroom') < out.indexOf('gsap.min.js'), 'runtime before the page scripts');
  // A value can't close the script or trigger replacement patterns
  assert.ok(out.includes('\\u003c/script>\\u003cb>$& done'));
  assert.equal(out.match(/<\/script>/g)!.length, PAGE.match(/<\/script>/g)!.length + 1);
  // Bare fragments get a document around them
  assert.match(prepareHtml('<p>hi</p>', 'http://x/'), /^<!doctype html><html><head><base/);
});

test('lintHtml flags what breaks seeking, and passes a clean page', () => {
  const issues = (s: string) => lintHtml(s).map((x) => `${x.level}:${x.msg.split(' ')[0]}`);
  // Positive control: the starter page is clean
  const starter = starterHtml({ id: 'x', w: 1920, h: 1080, sec: 4, title: 'Hi' });
  assert.deepEqual(lintHtml(starter).filter((x) => x.level !== 'note'), []);
  const base = `${ROOT_TAG}</div>`;
  assert.ok(issues(`${base}<script>const t = Date.now();</script>`).some((x) => x.startsWith('warn:reads')));
  assert.ok(issues(`${base}<script>requestAnimationFrame(f)</script>`).some((x) => x.startsWith('warn:animates')));
  assert.ok(issues(`${base}<script>gsap.timeline({ defaults: {} })</script>`).some((x) => x.includes('GSAP') || x.startsWith('warn:a')));
  assert.ok(issues(`${base}<script>gsap.to('.a', {x: 1})</script>`).some((x) => x.startsWith('error:uses')));
  assert.ok(lintHtml(`${base}<script src="gsap.min.js"></script><script>window.__timelines["other"] = gsap.timeline({ paused: true })</script>`).some((x) => /registered as "other"/.test(x.msg)));
  assert.ok(lintHtml('<div>no root</div>').some((x) => /no composition root/.test(x.msg)));
  assert.ok(lintHtml(`${base}<audio src="a.mp3"></audio>`).some((x) => x.level === 'note' && /not exported/.test(x.msg)));
});

// The CLI against a throwaway data folder
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-html-'));
fs.cpSync(path.resolve('editor/test/fixtures/showcase'), path.join(DATA, 'demo'), { recursive: true });
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, [path.resolve('editor/dist/cli.mjs'), 'demo', ...args], { env: { ...process.env, VS_DATA: DATA }, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
};
const board = () => JSON.parse(fs.readFileSync(path.join(DATA, 'demo', 'storyboard.json'), 'utf8'));

test('html new + add html: a scene as long as the page', () => {
  const n = cli('html', 'new', 'hello', '3.5');
  assert.ok(n.ok, n.out);
  assert.match(n.out, /scenes\/hello\/index\.html: 1920×1080, 3\.5 s/);
  assert.match(n.out, /no problems found/);
  const a = cli('add', 'html', 'scenes/hello/index.html');
  assert.ok(a.ok, a.out);
  const sc = board().scenes.find((s: { visual: { kind: string } }) => s.visual.kind === 'html');
  assert.equal(sc.visual.src, 'scenes/hello/index.html');
  assert.equal(sc.minSec, 3.5);
  assert.match(cli('html').out, new RegExp(`scenes/hello/index.html .*\\(in ${sc.id}\\)`));
  assert.match(cli('media').out, /HTML pages[^]*scenes\/hello\/index\.html/);
});

test('add html copies a page from outside the project, folder and all', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-page-'));
  fs.writeFileSync(path.join(src, 'index.html'), PAGE.replace('data-composition-src="compositions/intro.html"', ''));
  fs.mkdirSync(path.join(src, 'img'));
  fs.writeFileSync(path.join(src, 'img', 'a.png'), 'x');
  const a = cli('add', 'html', src);
  assert.ok(a.ok, a.out);
  const rel = /copied into (\S+)/.exec(a.out)![1];
  assert.ok(fs.existsSync(path.join(DATA, 'demo', rel)));
  assert.ok(fs.existsSync(path.join(DATA, 'demo', path.dirname(rel), 'img', 'a.png')));
  const sc = board().scenes.find((s: { visual: { src?: string } }) => s.visual.src === rel);
  assert.equal(sc.minSec, 6.5);
  // Variables: defaults, then a value set on the scene
  assert.match(cli('html', 'vars', sc.id).out, /title \(string\): "Q4 > Q3" \(default\)/);
  assert.ok(cli('set', sc.id, 'visual.vars.title', '"Launch week"').ok);
  assert.match(cli('html', 'vars', sc.id).out, /title \(string\): "Launch week"\n/);
  // check reports the page's own problems and the 9:16 page letterboxed in 16:9
  const c = cli('check');
  assert.match(c.out, new RegExp(`${sc.id}: ${rel} is 1080×1920, so it shows letterboxed`));
});

test('new creates a project an agent can build on; projects lists it', () => {
  const run = (...a: string[]) => spawnSync(process.execPath, [path.resolve('editor/dist/cli.mjs'), ...a], { env: { ...process.env, VS_DATA: DATA }, encoding: 'utf8' });
  const r = run('launch-v2', 'new', 'Launch', 'week');
  assert.equal(r.status, 0, r.stderr);
  const b = JSON.parse(fs.readFileSync(path.join(DATA, 'launch-v2', 'storyboard.json'), 'utf8'));
  assert.equal(b.title, 'Launch week');
  assert.deepEqual(b.scenes.map((s: { visual: { kind: string } }) => s.visual.kind), ['title', 'outro']);
  assert.notEqual(run('launch-v2', 'new').status, 0, 'refuses to overwrite');
  assert.notEqual(run('Bad Name', 'new').status, 0);
  assert.match(run('projects').stdout, /launch-v2/);
});

test('html write takes the page as an argument and refuses non-HTML and escapes', () => {
  const w = cli('html', 'write', 'card', '<div data-composition-id="card" data-width="1920" data-height="1080" data-duration="2"><p style="animation: a 1s both">Hi</p></div>');
  assert.ok(w.ok, w.out);
  assert.ok(fs.readFileSync(path.join(DATA, 'demo', 'scenes', 'card', 'index.html'), 'utf8').includes('<p style'));
  assert.match(w.out, /next: add html scenes\/card\/index\.html/);
  assert.ok(!cli('html', 'write', 'card', 'just words').ok);
  assert.ok(!cli('html', 'write', '../../evil.html', '<p>x</p>').ok);
  assert.ok(!fs.existsSync(path.join(DATA, 'evil.html')));
});
