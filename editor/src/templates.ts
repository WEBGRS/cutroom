import type { Scene, Storyboard } from '../../src/lib/types';
import { DEMO_CARDS } from '../../src/fx/demo';
import { CARD_LIST } from '../../src/fx/registry';

// [kind, English, Chinese, needs a media file]
export const ADDABLE: [string, string, string, boolean][] = [
  ...CARD_LIST.map((c) => [c.id, c.en, c.zh, c.id === 'compare'] as [string, string, string, boolean]),
  ['image', 'Image', '图片', true],
  ['clip', 'Video', '视频', true],
  ['screen', 'Screen recording', '录屏', true],
  ['html', 'HTML page', 'HTML 页面', true],
];

const MIN_SEC: Record<string, number> = { counter: 3, chart: 4, checklist: 4.5, quote: 4.5, chat: 6, notifs: 3.5, code: 6, terminal: 6, flap: 4, compare: 4.5 };

// A new scene of the given kind, ready to show something on screen; starter text in the UI language
export function sceneTemplate(kind: string, id: string, src?: string, lang: 'en' | 'zh' = 'en'): Scene {
  const base = { id, lines: [] as Scene['lines'] };
  const zh = lang === 'zh';
  switch (kind) {
    case 'title': {
      const t = zh ? '新标题' : 'New title';
      return { ...base, visual: { kind: 'title', kicker: '', title: t, sub: '' }, beat: [{ t, n: 4 }], minSec: 2.5, transition: 'fade' };
    }
    case 'stats':
      return { ...base, visual: { kind: 'stats', items: zh ? [{ value: '100', label: '项目' }, { value: '2,000', label: '用户' }, { value: '99%', label: '好评' }] : [{ value: '100', label: 'projects' }, { value: '2,000', label: 'users' }, { value: '99%', label: 'happy' }] }, beat: [{ t: zh ? '一些数字' : 'By the numbers', n: 4 }], minSec: 3.5, transition: 'fade' };
    case 'flow':
      return { ...base, visual: { kind: 'flow', title: zh ? '流程' : 'How it works', cols: zh ? [[{ label: '第一步' }], [{ label: '第二步' }], [{ label: '完成' }]] : [[{ label: 'Step one' }], [{ label: 'Step two' }], [{ label: 'Done' }]] }, beat: [{ t: zh ? '怎么做' : 'How', n: 4 }], minSec: 3.5, transition: 'fade' };
    case 'outro': {
      const t = zh ? '谢谢观看' : 'Thanks for watching';
      return { ...base, visual: { kind: 'outro', title: t, lines: [zh ? '欢迎评论区留言' : 'Tell me what you think'] }, beat: [{ t, n: 4 }], minSec: 3, tail: 1.2, transition: 'fade' };
    }
    case 'image':
      return { ...base, visual: { kind: 'image', src: src ?? '', fit: 'cover' }, beat: [{ t: '', n: 4 }], minSec: 3, transition: 'fade', fx: { kenburns: 'in', kbAmount: 0.08 } };
    case 'clip':
      return { ...base, visual: { kind: 'clip', src: src ?? '', fit: 'cover', muted: true }, beat: [{ t: '', n: 4 }], minSec: 4, transition: 'fade' };
    case 'screen':
      return { ...base, visual: { kind: 'screen', src: src ?? '', to: '@end' }, beat: [{ t: '', n: 4 }], transition: 'fade' };
    case 'html':
      return { ...base, visual: { kind: 'html', src: src ?? '' }, beat: [{ t: '', n: 4 }], minSec: 5, transition: 'fade' };
    default: {
      const demo = DEMO_CARDS[kind];
      if (!demo) throw new Error(`Unknown kind ${kind} (available: ${ADDABLE.map(([k]) => k).join(' / ')})`);
      const visual = demo.kind === 'compare' ? { ...demo, a: src ?? '', b: src ?? '' } : JSON.parse(JSON.stringify(demo));
      return { ...base, visual, beat: [{ t: '', n: 4 }], minSec: MIN_SEC[kind] ?? 4, transition: 'fade' };
    }
  }
}

// Starting storyboard for a new project
export function boardTemplate(slug: string, title: string, lang: 'en' | 'zh' = 'en'): Storyboard {
  return {
    slug,
    title,
    fps: 60,
    theme: { accent: '#3b6ef5', accent2: '#8fb0ff', bg: ['#0b1020', '#1a2140'] },
    scenes: [sceneTemplate('title', 'intro', undefined, lang), sceneTemplate('outro', 'outro', undefined, lang)].map((s, i) => (i === 0 ? { ...s, visual: { kind: 'title', title: title, sub: '' }, beat: [{ t: title, n: 4 }] } : s)) as Scene[],
  };
}
