import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenSlug, previewBoard, rebase } from '../src/planpreview';
import type { Scene, Storyboard } from '../../src/lib/types';

test('media paths point back into the source project', () => {
  const s = rebase({ visual: { kind: 'html', src: 'scenes/plan-a/index.html' }, overlays: [{ kind: 'image', src: 'media/logo.png' }, { kind: 'image', src: '../other/x.png' }, { kind: 'image', src: 'https://x/y.png' }] }, 'demo');
  assert.equal(s.visual.src, '../demo/scenes/plan-a/index.html');
  assert.equal(s.overlays[0].src, '../demo/media/logo.png');
  assert.equal(s.overlays[1].src, '../other/x.png');
  assert.equal(s.overlays[2].src, 'https://x/y.png');
});

test('each plan renders through a hidden project of its own', () => {
  assert.equal(hiddenSlug('demo', 'a'), '_plan-demo-a');
  assert.notEqual(hiddenSlug('demo', 'a'), hiddenSlug('demo', 'b'));
});

test('the hidden board has one scene long enough for the frame, with the source look', () => {
  const src = { slug: 'demo', title: 'Demo', fps: 30, format: 'tall', theme: { accent: '#f00' }, captions: { size: 40 }, scenes: [] } as unknown as Storyboard;
  const b = previewBoard(src, 'demo', 'b', { id: 'x', lines: [{ zh: '不要' }], visual: { kind: 'title', title: 'Hi' } } as unknown as Scene, 6);
  assert.equal(b.slug, '_plan-demo-b');
  assert.equal(b.format, 'tall');
  assert.equal(b.fps, 30);
  assert.equal(b.theme.accent, '#f00');
  assert.equal(b.scenes.length, 1);
  assert.equal(b.scenes[0].id, 'preview');
  assert.deepEqual(b.scenes[0].lines, []);
  assert.equal(b.scenes[0].minSec, 6);
});
