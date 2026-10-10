// One list of every effect: names in both languages, where it came from, and house-style warnings.
// Drives the editor library/inspector, the CLI `fx` listing, the AI's instructions and the preview renders.
import { TEXT_ANIMS } from './text';
import type { Overlay } from '../lib/types';

export type Rule = 'caption' | 'shake' | 'zoom' | 'iris' | 'sticker';
export interface Named {
  id: string;
  en: string;
  zh: string;
  // HyperFrames component/block it was ported from; absent = Cutroom's own
  src?: string;
  rule?: Rule;
}

export const RULES: Record<Rule, { en: string; zh: string }> = {
  caption: { en: 'House style: captions only fade, no scale or bounce', zh: '剪辑规范：字幕只淡入淡出，不缩放不回弹' },
  shake: { en: 'House style: no shaking frames', zh: '剪辑规范：画面不要抖' },
  zoom: { en: 'House style: no zoom punch on cuts', zh: '剪辑规范：切镜头不加缩放冲击' },
  iris: { en: 'House style: no iris transitions', zh: '剪辑规范：不用 iris 转场' },
  sticker: { en: 'House style: no animated stickers', zh: '剪辑规范：不用动态贴纸' },
};

export const TRANSITION_LIST: Named[] = [
  { id: '', en: 'Crossfade', zh: '淡入淡出' },
  { id: 'slide', en: 'Slide', zh: '滑入' },
  { id: 'wipe', en: 'Wipe', zh: '擦除' },
  { id: 'flip', en: 'Flip', zh: '翻转' },
  { id: 'clock', en: 'Clock wipe', zh: '时钟擦除' },
  { id: 'iris', en: 'Iris', zh: '圆形展开', rule: 'iris' },
  { id: 'push', en: 'Push cut', zh: '推进切' },
  { id: 'zoom', en: 'Zoom through', zh: '缩放穿越', src: 'zoom-through-transition', rule: 'zoom' },
  { id: 'dip', en: 'Dip to black', zh: '黑场过渡' },
  { id: 'none', en: 'Hard cut', zh: '直接切' },
  { id: 'blur', en: 'Blur dissolve', zh: '模糊溶解', src: 'transitions-blur' },
  { id: 'zoomblur', en: 'Zoom blur', zh: '缩放模糊', src: 'cinematic-zoom', rule: 'zoom' },
  { id: 'whip', en: 'Whip pan', zh: '甩镜', src: 'whip-pan' },
  { id: 'flash', en: 'Flash white', zh: '闪白', src: 'flash-through-white' },
  { id: 'leak', en: 'Light leak', zh: '漏光转场', src: 'light-leak' },
  { id: 'glitch', en: 'Glitch cut', zh: '故障切', src: 'glitch' },
  { id: 'chroma', en: 'RGB split', zh: '色散分离', src: 'chromatic-radial-split' },
  { id: 'pixel', en: 'Pixelate', zh: '像素化', src: 'grid-pixelate-wipe' },
  { id: 'grid', en: 'Tile grid', zh: '方格揭示', src: 'transitions-grid' },
  { id: 'strips', en: 'Slit strips', zh: '条带揭示', src: 'slit-scan-reveal' },
  { id: 'blinds', en: 'Blinds', zh: '百叶窗', src: 'transitions-mechanical' },
  { id: 'shutter', en: 'Shutter', zh: '快门闭合', src: 'shutter-slam' },
  { id: 'barn', en: 'Barn doors', zh: '对开门', src: 'curtain-reveal' },
  { id: 'diamond', en: 'Diamond', zh: '菱形展开', src: 'transitions-radial' },
  { id: 'cover', en: 'Cover', zh: '覆盖滑入', src: 'transitions-cover' },
  { id: 'uncover', en: 'Uncover', zh: '揭开滑出', src: 'transitions-cover' },
  { id: 'axis', en: 'Shared axis', zh: '同轴平移', src: 'shared-axis-y' },
  { id: 'axisz', en: 'Depth axis', zh: '纵深切换', src: 'shared-axis-z' },
  { id: 'fadethrough', en: 'Fade through', zh: '淡出再淡入', src: 'fade-through' },
  { id: 'door', en: 'Door swing', zh: '开门', src: 'transitions-3d' },
  { id: 'cube', en: '3D cube', zh: '立方体旋转', src: 'transitions-3d' },
  { id: 'cardzoom', en: 'Card expand', zh: '卡片展开', src: 'parallax-zoom' },
  { id: 'warp', en: 'Heat warp', zh: '热浪扭曲', src: 'thermal-distortion' },
  { id: 'dissolve', en: 'Noise dissolve', zh: '噪点溶解', src: 'transitions-dissolve' },
  { id: 'burn', en: 'Film burn', zh: '胶片烧灼', src: 'ridged-burn' },
  { id: 'halftone', en: 'Halftone', zh: '网点溶解', src: 'halftone-dissolve' },
  { id: 'spin', en: 'Spin blur', zh: '旋转模糊', src: 'swirl-vortex', rule: 'zoom' },
  { id: 'wipesoft', en: 'Soft wipe', zh: '柔边擦除', src: 'directional-wipe' },
  { id: 'irissoft', en: 'Soft iris', zh: '柔边圆形', src: 'iris-reveal' },
];
// Transitions that use the direction setting
export const DIR_TRANSITIONS = ['slide', 'wipe', 'flip', 'whip', 'strips', 'blinds', 'shutter', 'barn', 'cover', 'uncover', 'axis', 'door', 'cube', 'wipesoft'];

export const DIR_LIST: Named[] = [
  { id: '', en: 'Default', zh: '默认' },
  { id: 'left', en: 'From left', zh: '从左' },
  { id: 'right', en: 'From right', zh: '从右' },
  { id: 'up', en: 'From top', zh: '从上' },
  { id: 'down', en: 'From bottom', zh: '从下' },
];

export interface OverlayItem extends Named {
  group: 'text' | 'callout' | 'draw' | 'ui' | 'data' | 'fx';
  fields: ('text' | 'sub' | 'x' | 'y' | 'w' | 'h' | 'anim' | 'style' | 'size' | 'color')[];
  init: Partial<Overlay>;
  hint?: { en: string; zh: string };
}

const P = (en: string, zh: string) => ({ en, zh });

export const OVERLAY_LIST: OverlayItem[] = [
  { id: 'text', en: 'Animated text', zh: '动画文字', group: 'text', src: 'text-stagger', fields: ['text', 'sub', 'anim', 'x', 'y', 'size', 'color'], init: { text: 'Edit video as code', anim: 'fadeup', x: 0.5, y: 0.45, dur: 2.4 } },
  { id: 'punch', en: 'Punch word', zh: '大字冲击', group: 'text', fields: ['text', 'sub'], init: { text: 'Wow' } },
  { id: 'cinema', en: 'Cinematic title', zh: '电影感标题', group: 'text', fields: ['text', 'sub'], init: { text: 'CUTROOM', dur: 2.4 } },
  { id: 'lower', en: 'Lower third', zh: '下三分之一字幕条', group: 'text', src: 'lt-clean-bar', fields: ['text', 'sub', 'style', 'y', 'color'], init: { text: 'Jamie Chen', sub: 'Product designer', dur: 3 } },
  { id: 'ticker', en: 'News ticker', zh: '滚动新闻条', group: 'text', src: 'news-ticker', fields: ['text', 'sub', 'y', 'color'], init: { text: 'Cutroom 1.0 is out · edit video as code · AI edits the same storyboard', sub: 'NEW', dur: 4 } },
  { id: 'bigword', en: 'Background word', zh: '背景大字', group: 'text', src: 'mk-emphasis-type', fields: ['text', 'x', 'y'], init: { text: 'EDIT', x: 0.5, y: 0.5, dur: 3 } },
  { id: 'tag', en: 'Tag', zh: '标签', group: 'callout', fields: ['text', 'sub', 'x', 'y'], init: { text: 'Tag', x: 0.5, y: 0.2 } },
  { id: 'note', en: 'Note', zh: '注释', group: 'callout', fields: ['text', 'sub', 'x', 'y'], init: { text: 'Note', x: 0.06, y: 0.15 } },
  { id: 'box', en: 'Highlight box', zh: '高亮框', group: 'callout', fields: ['text', 'x', 'y', 'w', 'h'], init: { text: '', x: 0.5, y: 0.5, w: 0.3, h: 0.2 }, hint: P('x/y is the centre, w/h the size, as fractions of the frame', 'x/y 是中心，w/h 是宽高，都按画面比例') },
  { id: 'arrow', en: 'Arrow', zh: '箭头', group: 'callout', fields: ['text', 'x', 'y', 'w', 'h'], init: { text: 'Look here', x: 0.5, y: 0.5, w: 0.14, h: 0.12 }, hint: P('x/y is the tip, w/h the tail offset', 'x/y 是箭头尖，w/h 是尾巴的偏移') },
  { id: 'pointer', en: 'Pulse pointer', zh: '脉冲指示点', group: 'callout', src: 'yt-circle-pointer', fields: ['text', 'x', 'y', 'color'], init: { text: 'Click here', x: 0.5, y: 0.5, dur: 2.4 } },
  { id: 'spot', en: 'Spotlight', zh: '聚光灯', group: 'callout', fields: ['x', 'y', 'w'], init: { text: '', x: 0.5, y: 0.5, w: 0.12 }, hint: P('w is the radius', 'w 是光圈半径') },
  { id: 'feather', en: 'Soft highlight', zh: '柔光聚焦', group: 'callout', src: 'yt-feather-highlight', fields: ['text', 'x', 'y', 'w', 'h'], init: { text: '', x: 0.5, y: 0.45, w: 0.36, h: 0.3, dur: 2.4 } },
  { id: 'blur', en: 'Privacy blur', zh: '马赛克模糊', group: 'callout', fields: ['x', 'y', 'w', 'h'], init: { text: '', x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, hint: P('Covers private details', '遮住隐私信息') },
  { id: 'cursor', en: 'Moving cursor', zh: '移动光标', group: 'callout', src: 'agent-cursor', fields: ['text', 'x', 'y', 'w', 'h'], init: { text: '', x: 0.55, y: 0.5, w: 0.18, h: 0.16, dur: 2 }, hint: P('x/y is where it clicks, w/h where it starts from', 'x/y 是点击位置，w/h 是起点偏移') },
  { id: 'tap', en: 'Tap', zh: '点按', group: 'callout', src: 'press-ripple', fields: ['x', 'y'], init: { text: '', x: 0.5, y: 0.5, dur: 1 } },
  { id: 'keys', en: 'Keyboard keys', zh: '快捷键', group: 'callout', src: 'input-feedback', fields: ['text', 'sub', 'x', 'y'], init: { text: 'Ctrl+B', sub: 'Split', x: 0.5, y: 0.8, dur: 2 }, hint: P('Keys joined with +', '按键用 + 连接') },
  { id: 'hwcircle', en: 'Hand-drawn circle', zh: '手绘圈', group: 'draw', src: 'hw-callout-circle', fields: ['text', 'x', 'y', 'w', 'h', 'color'], init: { text: '', x: 0.5, y: 0.5, w: 0.22, h: 0.18, dur: 2.4 } },
  { id: 'hwunderline', en: 'Hand-drawn underline', zh: '手绘下划线', group: 'draw', src: 'hw-underline', fields: ['x', 'y', 'w', 'color'], init: { text: '', x: 0.5, y: 0.6, w: 0.3, dur: 2.4 } },
  { id: 'hwarrow', en: 'Hand-drawn arrow', zh: '手绘箭头', group: 'draw', src: 'hw-arrow', fields: ['text', 'x', 'y', 'w', 'h', 'color'], init: { text: 'this one', x: 0.45, y: 0.45, w: 0.16, h: 0.18, dur: 2.4 } },
  { id: 'hwbox', en: 'Hand-drawn box', zh: '手绘框', group: 'draw', src: 'hw-box-label', fields: ['text', 'x', 'y', 'w', 'h', 'color'], init: { text: 'New', x: 0.5, y: 0.5, w: 0.3, h: 0.22, dur: 2.4 } },
  { id: 'hwcheck', en: 'Check mark', zh: '手绘勾', group: 'draw', src: 'hw-arrow', fields: ['text', 'x', 'y', 'w', 'color'], init: { text: '', x: 0.5, y: 0.5, w: 0.06, dur: 1.6 } },
  { id: 'hwcross', en: 'Cross mark', zh: '手绘叉', group: 'draw', src: 'hw-arrow', fields: ['text', 'x', 'y', 'w', 'color'], init: { text: '', x: 0.5, y: 0.5, w: 0.06, dur: 1.6 } },
  { id: 'notify', en: 'Notification', zh: '系统通知', group: 'ui', src: 'native-notification-pop', fields: ['text', 'sub', 'x', 'y'], init: { text: 'Cutroom', sub: 'Your video finished rendering', x: 0.5, y: 0.05, dur: 2.6 } },
  { id: 'chat', en: 'Chat bubble', zh: '聊天气泡', group: 'ui', src: 'chat-message', fields: ['text', 'sub', 'x', 'y'], init: { text: 'Can you make the intro shorter?', x: 0.7, y: 0.4, dur: 2.6 }, hint: P('x < 0.5 puts it on the left', 'x 小于 0.5 时在左边') },
  { id: 'prompt', en: 'AI prompt box', zh: 'AI 输入框', group: 'ui', src: 'typed-prompt', fields: ['text', 'sub', 'x', 'y'], init: { text: 'Add a warm look to the photo scene', sub: 'Claude', x: 0.5, y: 0.5, dur: 3.4 } },
  { id: 'terminal', en: 'Terminal', zh: '终端窗口', group: 'ui', src: 'code-terminal-run', fields: ['text', 'sub', 'x', 'y'], init: { text: 'npm run editor', sub: 'editor built\nlistening on 127.0.0.1:8814', x: 0.5, y: 0.5, dur: 3 }, hint: P('Command in text; output lines in sub', '命令写在文字里，输出写在副标题（每行一条）') },
  { id: 'comment', en: 'Comment card', zh: '评论卡片', group: 'ui', src: 'yt-comment-card', fields: ['text', 'sub', 'x', 'y'], init: { text: 'This editor is wild', sub: 'viewer', x: 0.5, y: 0.5, dur: 2.8, value: 1280 } },
  { id: 'quote', en: 'Quote card', zh: '引言卡片', group: 'ui', src: 'testimonial-card', fields: ['text', 'sub', 'x', 'y'], init: { text: 'It feels like editing with a [[co-pilot]].', sub: 'Early user', x: 0.5, y: 0.5, dur: 3.2 } },
  { id: 'badge', en: 'Badge', zh: '徽章', group: 'ui', src: 'badge-pop', fields: ['text', 'sub', 'x', 'y', 'color'], init: { text: 'Saved', x: 0.5, y: 0.5, dur: 1.8 } },
  { id: 'check', en: 'Success check', zh: '完成对勾', group: 'ui', src: 'success-check', fields: ['text', 'x', 'y', 'w'], init: { text: 'Exported', x: 0.5, y: 0.45, w: 0.07, dur: 2 } },
  { id: 'counter', en: 'Counter', zh: '数字计数', group: 'data', src: 'count-up', fields: ['text', 'sub', 'x', 'y', 'size', 'color'], init: { text: '12,800+', sub: 'frames rendered', x: 0.5, y: 0.45, dur: 2.6 } },
  { id: 'ring', en: 'Progress ring', zh: '进度环', group: 'data', src: 'conic-progress-ring', fields: ['text', 'sub', 'x', 'y', 'w', 'color'], init: { text: '87', sub: 'complete', x: 0.5, y: 0.45, w: 0.09, dur: 2.4 } },
  { id: 'progress', en: 'Progress bar', zh: '进度条', group: 'data', src: 'mk-progress-stat', fields: ['text', 'sub', 'x', 'y', 'w', 'color'], init: { text: 'Rendering', sub: '72', x: 0.5, y: 0.5, w: 0.36, dur: 2.4 } },
  { id: 'stars', en: 'Star rating', zh: '星级评分', group: 'data', src: 'star-rating-fill', fields: ['text', 'sub', 'x', 'y'], init: { text: '4.8', sub: 'rating', x: 0.5, y: 0.5, dur: 2.2 } },
  { id: 'bars', en: 'Mini bar chart', zh: '迷你柱状图', group: 'data', src: 'animated-bar-chart', fields: ['text', 'x', 'y', 'w', 'h', 'color'], init: { text: 'Mon:3,Tue:5,Wed:4,Thu:8', x: 0.5, y: 0.5, w: 0.34, h: 0.36, dur: 2.6 }, hint: P('label:value pairs separated by commas', '用逗号分隔的“名称:数值”') },
  { id: 'confetti', en: 'Confetti', zh: '彩带', group: 'fx', src: 'confetti', fields: ['x', 'y'], init: { text: '', x: 0.5, y: 0.6, dur: 2.4 } },
  { id: 'sweep', en: 'Light sweep', zh: '光扫过', group: 'fx', src: 'light-sweep-pass', fields: [], init: { text: '', dur: 1.4 } },
  { id: 'scan', en: 'Scan band', zh: '扫描带', group: 'fx', src: 'scan-band', fields: ['color'], init: { text: '', dur: 2.4 } },
  { id: 'flash', en: 'Flash', zh: '闪光', group: 'fx', src: 'beat-accent', fields: ['color'], init: { text: '', dur: 0.5 } },
  { id: 'sticker', en: 'Emoji sticker', zh: '表情贴纸', group: 'fx', fields: ['text', 'x', 'y'], init: { text: '🔥', x: 0.8, y: 0.25 }, rule: 'sticker' },
];

export const LOWER_LIST: Named[] = [
  { id: '', en: 'Classic', zh: '经典' },
  { id: 'clean', en: 'Clean bar', zh: '简洁线条', src: 'lt-clean-bar' },
  { id: 'bold', en: 'Bold block', zh: '粗体色块', src: 'lt-bold-block' },
  { id: 'color', en: 'Colour block', zh: '主题色块', src: 'lt-color-block' },
  { id: 'dark', en: 'Dark card', zh: '深色卡片', src: 'lt-dark-card' },
  { id: 'kicker', en: 'Kicker + name', zh: '小标题加姓名', src: 'lt-kicker-name' },
  { id: 'mask', en: 'Mask reveal', zh: '遮罩升起', src: 'lt-mask-reveal' },
  { id: 'neon', en: 'Neon border', zh: '霓虹边框', src: 'lt-neon-border' },
  { id: 'side', en: 'Side rule', zh: '侧边竖线', src: 'lt-side-rule' },
  { id: 'pill', en: 'Soft pill', zh: '圆角胶囊', src: 'lt-soft-pill' },
  { id: 'stack', en: 'Stacked bars', zh: '叠放色条', src: 'lt-stack-bars' },
  { id: 'underline', en: 'Accent underline', zh: '主题色下划线', src: 'lt-accent-underline' },
];

export const BG_LIST: Named[] = [
  { id: '', en: 'Gradient', zh: '渐变' },
  { id: 'aurora', en: 'Aurora', zh: '极光', src: 'aurora-drift' },
  { id: 'mesh', en: 'Mesh gradient', zh: '网格渐变', src: 'mesh-gradient-bg' },
  { id: 'grid', en: 'Grid', zh: '网格线', src: 'mk-background' },
  { id: 'dots', en: 'Dots', zh: '点阵', src: 'mk-placeholder-grid' },
  { id: 'stars', en: 'Starfield', zh: '星空', src: 'starfield' },
  { id: 'snow', en: 'Snow', zh: '飘雪', src: 'snow' },
  { id: 'bokeh', en: 'Bokeh', zh: '光斑', src: 'avatar-cloud' },
  { id: 'pulse', en: 'Beat pulse', zh: '节拍脉冲', src: 'beat-pulse-background' },
  { id: 'lines', en: 'Moving lines', zh: '斜线流动', src: 'perspective-marquee' },
  { id: 'noise', en: 'Film grain', zh: '颗粒噪点', src: 'grain-field' },
];

export const DUOTONE_LIST: Named[] = [
  { id: '', en: 'Off', zh: '无' },
  { id: 'ocean', en: 'Ocean', zh: '海蓝' },
  { id: 'sunset', en: 'Sunset', zh: '日落' },
  { id: 'mint', en: 'Mint', zh: '薄荷' },
  { id: 'rose', en: 'Rose', zh: '玫瑰' },
  { id: 'ink', en: 'Ink', zh: '墨色' },
];

export const LOOK_LIST: Named[] = [
  { id: '', en: 'None', zh: '无' },
  { id: 'warm', en: 'Warm', zh: '暖色' },
  { id: 'cool', en: 'Cool', zh: '冷色' },
  { id: 'vivid', en: 'Vivid', zh: '鲜艳' },
  { id: 'fade', en: 'Faded', zh: '褪色' },
  { id: 'vintage', en: 'Vintage', zh: '复古' },
  { id: 'mono', en: 'Mono', zh: '黑白' },
  { id: 'noir', en: 'Noir', zh: '黑白高反差' },
  { id: 'teal', en: 'Teal & orange', zh: '青橙' },
];

export const CARD_LIST: (Named & { group: 'basic' | 'data' | 'ui' })[] = [
  { id: 'title', en: 'Title card', zh: '标题卡', group: 'basic', src: 'titlecard-calm' },
  { id: 'stats', en: 'Stat cards', zh: '数字卡', group: 'data', src: 'count-up' },
  { id: 'counter', en: 'Big counter', zh: '大数字', group: 'data', src: 'count-up' },
  { id: 'chart', en: 'Bar chart', zh: '柱状图', group: 'data', src: 'animated-bar-chart' },
  { id: 'flow', en: 'Flow diagram', zh: '流程图', group: 'basic' },
  { id: 'checklist', en: 'Checklist', zh: '清单打勾', group: 'basic', src: 'marker-checklist-card' },
  { id: 'quote', en: 'Testimonial', zh: '用户评价', group: 'ui', src: 'testimonial-card' },
  { id: 'chat', en: 'Chat thread', zh: '聊天记录', group: 'ui', src: 'chat-thread' },
  { id: 'notifs', en: 'Notification stack', zh: '通知堆叠', group: 'ui', src: 'notification-pileup' },
  { id: 'code', en: 'Code typing', zh: '代码打字', group: 'ui', src: 'code-typing' },
  { id: 'terminal', en: 'Terminal', zh: '终端演示', group: 'ui', src: 'terminal-simulator' },
  { id: 'flap', en: 'Split-flap board', zh: '机场翻牌', group: 'data', src: 'split-flap-board' },
  { id: 'compare', en: 'Before / after', zh: '前后对比', group: 'basic', src: 'before-after-wipe' },
  { id: 'outro', en: 'Outro', zh: '片尾', group: 'basic', src: 'logo-outro' },
];

export const TEXT_LIST: Named[] = TEXT_ANIMS.map((a) => ({ id: a.id, en: a.en, zh: a.zh, src: a.src, rule: a.rule ? 'caption' : undefined }));

// Every HyperFrames source used, for CREDITS
export function hyperframesSources(): string[] {
  const all = [...TRANSITION_LIST, ...OVERLAY_LIST, ...LOWER_LIST, ...BG_LIST, ...CARD_LIST, ...TEXT_LIST];
  return [...new Set(all.map((x) => x.src).filter((s): s is string => !!s))].sort();
}

export const label = (x: Named, lang: 'en' | 'zh') => (lang === 'zh' ? x.zh : x.en);
