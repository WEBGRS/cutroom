// Every editable effect in one place: drives the inspector controls, the CLI `fx` listing and the AI's instructions

export interface FieldDef {
  path: string;
  label: string;
  type: 'select' | 'range' | 'bool' | 'text' | 'number';
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
  def?: number | boolean | string;
  hint?: string;
  // Conflicts with the house style rules: shown as a warning, AI avoids unless asked
  rule?: string;
}

export interface Group {
  group: string;
  fields: FieldDef[];
}

const R_CAPTION = '剪辑规范：字幕只淡入淡出，不缩放不回弹';
const R_SHAKE = '剪辑规范：画面不要抖';

export const SCENE_FX: Group[] = [
  {
    group: '调色',
    fields: [
      { path: 'fx.look', label: '滤镜', type: 'select', options: [['', '无'], ['warm', '暖色'], ['cool', '冷色'], ['vivid', '鲜艳'], ['fade', '褪色'], ['vintage', '复古'], ['mono', '黑白'], ['noir', '黑白高反差'], ['teal', '青橙']] },
      { path: 'fx.brightness', label: '亮度', type: 'range', min: 0.3, max: 2, step: 0.05, def: 1 },
      { path: 'fx.contrast', label: '对比度', type: 'range', min: 0.3, max: 2, step: 0.05, def: 1 },
      { path: 'fx.saturate', label: '饱和度', type: 'range', min: 0, max: 3, step: 0.05, def: 1 },
      { path: 'fx.hue', label: '色相', type: 'range', min: -180, max: 180, step: 5, def: 0, hint: '度' },
      { path: 'fx.blur', label: '模糊', type: 'range', min: 0, max: 20, step: 0.5, def: 0, hint: '像素' },
    ],
  },
  {
    group: '氛围',
    fields: [
      { path: 'fx.vignette', label: '暗角', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.grain', label: '胶片颗粒', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.leak', label: '漏光', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.letterbox', label: '电影黑边', type: 'range', min: 0, max: 0.2, step: 0.01, def: 0, hint: '每条占画面高度比例' },
      { path: 'fx.dim', label: '压暗', type: 'range', min: 0, max: 0.9, step: 0.05, def: 0, hint: '音乐断点前压暗 0.2–0.3' },
    ],
  },
  {
    group: '运动',
    fields: [
      { path: 'fx.kenburns', label: '推拉摇移', type: 'select', options: [['', '无'], ['in', '慢推'], ['out', '慢拉'], ['left', '左移'], ['right', '右移'], ['up', '上移'], ['down', '下移']], hint: '图片/视频/卡片的慢速运镜' },
      { path: 'fx.kbAmount', label: '运镜幅度', type: 'range', min: 0.02, max: 0.5, step: 0.01, def: 0.12 },
      { path: 'fx.motionBlur', label: '动态模糊', type: 'bool', def: false, hint: '镜头移动时的拖影；导出变慢' },
      { path: 'fx.shake', label: '抖动', type: 'range', min: 0, max: 1, step: 0.05, def: 0, rule: R_SHAKE },
      { path: 'fx.fadeIn', label: '黑场淡入', type: 'range', min: 0, max: 3, step: 0.1, def: 0, hint: '秒' },
      { path: 'fx.fadeOut', label: '黑场淡出', type: 'range', min: 0, max: 3, step: 0.1, def: 0, hint: '秒' },
    ],
  },
  {
    group: '录屏',
    fields: [{ path: 'fx.ripple', label: '点击涟漪', type: 'bool', def: true }],
  },
];

export const TRANSITIONS: [string, string, string?][] = [
  ['', '淡入淡出'],
  ['slide', '滑入'],
  ['wipe', '擦除'],
  ['flip', '翻转'],
  ['clock', '时钟擦除'],
  ['iris', '圆形展开', '剪辑规范：不用 iris 转场'],
  ['push', '推进切'],
  ['zoom', '缩放穿越', '剪辑规范：切镜头不加缩放冲击'],
  ['dip', '黑场过渡'],
  ['none', '直接切'],
];

export const DIRS: [string, string][] = [
  ['', '默认'],
  ['left', '从左'],
  ['right', '从右'],
  ['up', '从上'],
  ['down', '从下'],
];

export interface OverlayDef {
  kind: string;
  label: string;
  fields: ('text' | 'sub' | 'x' | 'y' | 'w' | 'h')[];
  init: Record<string, unknown>;
  hint?: string;
  rule?: string;
}

export const OVERLAYS: OverlayDef[] = [
  { kind: 'tag', label: '标签', fields: ['text', 'sub', 'x', 'y'], init: { text: '标签', x: 0.5, y: 0.2 } },
  { kind: 'note', label: '注释', fields: ['text', 'sub', 'x', 'y'], init: { text: '注释', x: 0.06, y: 0.15 } },
  { kind: 'punch', label: '大字冲击', fields: ['text', 'sub'], init: { text: '重点' } },
  { kind: 'lower', label: '下三分之一字幕条', fields: ['text', 'sub', 'y'], init: { text: '标题', sub: '说明' } },
  { kind: 'cinema', label: '电影感标题', fields: ['text', 'sub'], init: { text: '片名', dur: 2.4 } },
  { kind: 'box', label: '高亮框', fields: ['text', 'x', 'y', 'w', 'h'], init: { text: '', x: 0.5, y: 0.5, w: 0.3, h: 0.2 }, hint: 'x/y 是中心，w/h 是宽高，都按画面比例' },
  { kind: 'arrow', label: '箭头', fields: ['text', 'x', 'y', 'w', 'h'], init: { text: '看这里', x: 0.5, y: 0.5, w: 0.14, h: 0.12 }, hint: 'x/y 是箭头尖，w/h 是尾巴的偏移' },
  { kind: 'spot', label: '聚光灯', fields: ['x', 'y', 'w'], init: { text: '', x: 0.5, y: 0.5, w: 0.12 }, hint: 'w 是光圈半径' },
  { kind: 'blur', label: '马赛克模糊', fields: ['x', 'y', 'w', 'h'], init: { text: '', x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, hint: '遮住隐私信息' },
  { kind: 'sticker', label: '表情贴纸', fields: ['text', 'x', 'y'], init: { text: '🔥', x: 0.8, y: 0.25 }, rule: '剪辑规范：不用动态贴纸' },
];

export const BOARD_FX: Group[] = [
  {
    group: '字幕样式',
    fields: [
      { path: 'captions.off', label: '不显示字幕', type: 'bool', def: false },
      { path: 'captions.style', label: '样式', type: 'select', options: [['', '默认（底框）'], ['box', '底框'], ['outline', '描边'], ['plain', '无框']] },
      { path: 'captions.pos', label: '位置', type: 'select', options: [['', '底部'], ['bottom', '底部'], ['middle', '中间'], ['top', '顶部']] },
      { path: 'captions.scale', label: '字号', type: 'range', min: 0.6, max: 1.8, step: 0.05, def: 1 },
      { path: 'captions.anim', label: '出现方式', type: 'select', options: [['', '淡入（默认）'], ['fade', '淡入'], ['pop', '弹出'], ['word', '逐词出现'], ['karaoke', '卡拉OK高亮'], ['typewriter', '打字机']], rule: R_CAPTION },
    ],
  },
  {
    group: '录屏画框',
    fields: [
      { path: 'frame.radius', label: '圆角', type: 'range', min: 0, max: 60, step: 1, def: 16, hint: '像素' },
      { path: 'frame.shadow', label: '阴影', type: 'range', min: 0, max: 2, step: 0.05, def: 1 },
      { path: 'frame.inset', label: '留边', type: 'range', min: 0, max: 0.3, step: 0.01, def: 0, hint: '画面四周多留的比例' },
      { path: 'frame.glow', label: '主题色描边光', type: 'bool', def: false },
    ],
  },
  {
    group: '声音',
    fields: [
      { path: 'sfx.whoosh', label: '转场嗖声', type: 'bool', def: true },
      { path: 'sfx.click', label: '点击声', type: 'bool', def: true },
      { path: 'sfx.pop', label: '大字弹出声', type: 'bool', def: true },
      { path: 'sfx.volume', label: '音效音量', type: 'range', min: 0, max: 2, step: 0.05, def: 1 },
      { path: 'music.fadeIn', label: '配乐淡入', type: 'range', min: 0, max: 5, step: 0.1, def: 1, hint: '秒，旁白版' },
      { path: 'music.fadeOut', label: '配乐淡出', type: 'range', min: 0, max: 8, step: 0.1, def: 2, hint: '秒，旁白版' },
    ],
  },
  {
    group: '其他',
    fields: [
      { path: 'glass', label: '毛玻璃卡片', type: 'bool', def: false, hint: '数字卡、流程图卡' },
      { path: 'chapterBar', label: '章节进度条', type: 'bool', def: false, hint: '段落里填了"章节名"才显示' },
      { path: 'theme.wallBlur', label: '背景图模糊', type: 'range', min: 0, max: 40, step: 1, def: 0, hint: '设了背景图时有效' },
    ],
  },
];

const describe = (f: FieldDef) => {
  const vals = f.type === 'select' ? f.options!.filter(([v]) => v).map(([v, l]) => `${v}=${l}`).join(', ') : f.type === 'range' ? `${f.min}..${f.max}${f.def !== undefined ? ` (default ${f.def})` : ''}` : f.type === 'bool' ? `true|false${f.def !== undefined ? ` (default ${f.def})` : ''}` : f.type;
  return `  ${f.path} — ${f.label}: ${vals}${f.hint ? `; ${f.hint}` : ''}${f.rule ? `  [house rule: ${f.rule} — only if the user asks]` : ''}`;
};

// Plain-text reference for the CLI and the AI assistant
export function catalogText(): string {
  const out: string[] = ['Scene effects (set <id> <path> <value>):'];
  for (const g of SCENE_FX) {
    out.push(` ${g.group}`);
    g.fields.forEach((f) => out.push(describe(f)));
  }
  out.push(' 转场 (voice cut): transition = ' + TRANSITIONS.map(([v, l, r]) => `${v || 'fade'}=${l}${r ? ' [house rule]' : ''}`).join(', '));
  out.push('  transDir = left|right|up|down (slide/wipe/flip); transDur = seconds (default 0.4); beatTransition = same values, beat cut only (default 12-frame fade)');
  out.push(' Overlays: scene.overlays = [{kind, at (sec from scene start), dur (sec), text, sub, x, y, w, h}]');
  OVERLAYS.forEach((o) => out.push(`  ${o.kind} — ${o.label}: fields ${o.fields.join(',')}${o.hint ? `; ${o.hint}` : ''}${o.rule ? ` [house rule: ${o.rule}]` : ''}`));
  out.push(' Chapter: scene.chapter = "名称" (shown on the chapter bar)');
  out.push('Board settings (set - <path> <value>):');
  for (const g of BOARD_FX) {
    out.push(` ${g.group}`);
    g.fields.forEach((f) => out.push(describe(f)));
  }
  out.push('  theme.wallpaper = image path inside the project folder (replaces the gradient backdrop)');
  out.push('Visual kinds for `add`: title{kicker,title,sub} stats{items:[{value,label,en}]} outro{title,url,lines} flow{title,cols} image{src,fit,frame} clip{src,from,rate,fit,frame,muted} screen{src,from,to,rate,zoom,base,frame,url}');
  return out.join('\n');
}
