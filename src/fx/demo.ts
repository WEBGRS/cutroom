import type { Theme, Visual } from '../lib/types';

// Starter content for new cards and for the effect preview clips
export const DEMO_THEME: Theme = { accent: '#5b8cff', accent2: '#ffb547', bg: ['#0b1020', '#1b2348'] };

export const DEMO_CARDS: Record<string, Visual> = {
  title: { kind: 'title', kicker: 'Cutroom', title: 'Demos that [[keep up]]', sub: 'Record it, cut it with an AI, re-record when it changes' },
  stats: { kind: 'stats', items: [{ value: '39', label: 'transitions' }, { value: '33', label: 'text animations' }, { value: '45', label: 'overlays' }] },
  counter: { kind: 'counter', value: '12,800+', label: 'frames rendered today', sub: 'one storyboard, every format' },
  chart: { kind: 'chart', title: 'Effects per release', items: [{ label: 'v0.1', value: 12 }, { label: 'v0.2', value: 28 }, { label: 'v0.3', value: 61 }, { label: 'v1.0', value: 160 }] },
  flow: { kind: 'flow', title: 'How it works', cols: [[{ label: 'Storyboard' }], [{ label: 'Timeline' }, { label: 'AI chat' }], [{ label: 'Render' }]] },
  checklist: { kind: 'checklist', title: 'Before you publish', items: ['Captions checked', 'Music credited', 'URLs hidden for Xiaohongshu'] },
  quote: { kind: 'quote', text: 'It feels like editing with a [[co-pilot]] who never gets tired.', author: 'Early user', role: 'YouTube creator', rating: 5 },
  chat: { kind: 'chat', title: 'Ask the editor', messages: [{ me: true, text: 'Make the intro two seconds shorter' }, { text: 'Done. intro now ends at 3.2 s, the rest moved up.' }, { me: true, text: 'Add a light leak on the photo' }] },
  notifs: { kind: 'notifs', items: [{ app: 'Cutroom', title: 'Render finished', body: 'showcase-wide.mp4 · 38 s' }, { app: 'Cutroom', title: 'AI edited 3 scenes', body: 'Undo anytime with Ctrl+Z' }, { app: 'Cutroom', title: 'Captions synced', body: '24 lines matched to voice' }] },
  code: { kind: 'code', title: 'storyboard.json', code: '{\n  "id": "intro",\n  "visual": { "kind": "title", "title": "New in v1.1" },\n  "transition": "whip",\n  "fx": { "look": "warm", "grain": 0.2 }\n}' },
  terminal: { kind: 'terminal', lines: [{ cmd: 'npx cutroom showcase set intro fx.look "warm"', out: '✓ intro.fx.look → warm' }, { cmd: 'npm run render', out: 'rendering 2,280 frames…\n✓ out/showcase-wide.mp4' }] },
  flap: { kind: 'flap', title: 'Now showing', rows: ['CUTROOM  1.0', 'GATE  B12'] },
  compare: { kind: 'compare', a: 'media/lake.jpg', b: 'media/lake-graded.jpg', labelA: 'Before', labelB: 'After' },
  outro: { kind: 'outro', title: 'Cutroom', url: 'github.com/WEBGRS/cutroom', lines: ['Open source · MIT'] },
};

// Sample text that shows each text animation off
export const TEXT_SAMPLE: Record<string, string> = {
  count: '12,800+',
  wheel: '2026',
  strike: 'slow|fast',
  roll: 'Edit|Cut|Ship',
  ticker: 'Edit|Cut|Ship|Share',
  flap: 'CUTROOM',
  highlight: 'Demos that [[keep up]]',
  typewriter: 'Record. Cut. Re-record.',
  scramble: 'NEW IN V1.1',
  decode: 'NEW IN V1.1',
  stream: 'Sure, the intro is now two seconds shorter.',
  lines: 'Write the story\nCut on the beat\nShip every format',
};
export const textSample = (id: string) => TEXT_SAMPLE[id] ?? 'Your app, [[in motion]]';

// Representative values for scene effects in previews
export const FX_DEMO: Record<string, Record<string, unknown>> = {
  'look-warm': { look: 'warm' },
  'look-cool': { look: 'cool' },
  'look-vivid': { look: 'vivid' },
  'look-fade': { look: 'fade' },
  'look-vintage': { look: 'vintage' },
  'look-mono': { look: 'mono' },
  'look-noir': { look: 'noir' },
  'look-teal': { look: 'teal' },
  vignette: { vignette: 0.8 },
  grain: { grain: 0.8 },
  leak: { leak: 0.8 },
  letterbox: { letterbox: 0.12 },
  blur: { blur: 8 },
  dim: { dim: 0.4 },
  kenburns: { kenburns: 'in', kbAmount: 0.25 },
  reveal: { kenburns: 'reveal', kbAmount: 0.2 },
  motionBlur: { kenburns: 'left', kbAmount: 0.4, motionBlur: true },
  chroma: { chroma: 0.8 },
  glitch: { glitch: 1 },
  crt: { crt: 0.9 },
  'duotone-ocean': { duotone: 'ocean' },
  'duotone-sunset': { duotone: 'sunset' },
  'duotone-mint': { duotone: 'mint' },
  'duotone-rose': { duotone: 'rose' },
  'duotone-ink': { duotone: 'ink' },
  bloom: { bloom: 0.9 },
  pixelate: { pixelate: 24 },
  posterize: { posterize: 4 },
  drift: { drift: 1 },
  focusIn: { focusIn: 1.4 },
  stepped: { stepped: 8, kenburns: 'in', kbAmount: 0.3 },
  fadeIn: { fadeIn: 1 },
  shake: { shake: 0.6 },
};
