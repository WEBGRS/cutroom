import type { Scene, Storyboard } from '../../src/lib/types';

export const ADDABLE: [string, string, boolean][] = [
  ['title', '标题卡', false],
  ['stats', '数字卡', false],
  ['flow', '流程图', false],
  ['outro', '片尾', false],
  ['image', '图片', true],
  ['clip', '视频', true],
  ['screen', '录屏', true],
];

// A new scene of the given kind, ready to show something on screen
export function sceneTemplate(kind: string, id: string, src?: string): Scene {
  const base = { id, lines: [] as Scene['lines'] };
  switch (kind) {
    case 'title':
      return { ...base, visual: { kind: 'title', kicker: '', title: '新标题', sub: '' }, beat: [{ t: '新标题', n: 4 }], minSec: 2.5, transition: 'fade' };
    case 'stats':
      return { ...base, visual: { kind: 'stats', items: [{ value: '100', label: '项目' }, { value: '2,000', label: '用户' }, { value: '99%', label: '好评' }] }, beat: [{ t: '一些数字', n: 4 }], minSec: 3.5, transition: 'fade' };
    case 'flow':
      return { ...base, visual: { kind: 'flow', title: '流程', cols: [[{ label: '第一步' }], [{ label: '第二步' }], [{ label: '完成' }]] }, beat: [{ t: '怎么做', n: 4 }], minSec: 3.5, transition: 'fade' };
    case 'outro':
      return { ...base, visual: { kind: 'outro', title: '谢谢观看', lines: ['欢迎评论区留言'] }, beat: [{ t: '谢谢观看', n: 4 }], minSec: 3, tail: 1.2, transition: 'fade' };
    case 'image':
      return { ...base, visual: { kind: 'image', src: src ?? '', fit: 'cover' }, beat: [{ t: '', n: 4 }], minSec: 3, transition: 'fade', fx: { kenburns: 'in', kbAmount: 0.08 } };
    case 'clip':
      return { ...base, visual: { kind: 'clip', src: src ?? '', fit: 'cover', muted: true }, beat: [{ t: '', n: 4 }], minSec: 4, transition: 'fade' };
    case 'screen':
      return { ...base, visual: { kind: 'screen', src: src ?? '' }, beat: [{ t: '', n: 4 }], transition: 'fade' };
    default:
      throw new Error(`不认识的类型 ${kind}（可用：${ADDABLE.map(([k]) => k).join(' / ')}）`);
  }
}

// Starting storyboard for a new project
export function boardTemplate(slug: string, title: string): Storyboard {
  return {
    slug,
    title,
    fps: 60,
    theme: { accent: '#3b6ef5', accent2: '#8fb0ff', bg: ['#0b1020', '#1a2140'] },
    scenes: [sceneTemplate('title', 'intro'), sceneTemplate('outro', 'outro')].map((s, i) => (i === 0 ? { ...s, visual: { kind: 'title', title: title, sub: '' }, beat: [{ t: title, n: 4 }] } : s)) as Scene[],
  };
}
