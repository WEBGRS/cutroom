// Every editable effect in one place: drives the inspector controls, the CLI `fx` listing and the AI's instructions
import { BG_LIST, CARD_LIST, DIR_LIST, DIR_TRANSITIONS, DUOTONE_LIST, LOOK_LIST, LOWER_LIST, OVERLAY_LIST, RULES, TEXT_LIST, TRANSITION_LIST, type Named, type OverlayItem, type Rule } from '../../src/fx/registry';

export { BG_LIST, CARD_LIST, DIR_LIST, DIR_TRANSITIONS, LOWER_LIST, OVERLAY_LIST, RULES, TEXT_LIST, TRANSITION_LIST };
export type { Named, OverlayItem, Rule };

export interface FieldDef {
  path: string;
  en: string;
  zh: string;
  type: 'select' | 'range' | 'bool' | 'text' | 'number';
  options?: Named[];
  min?: number;
  max?: number;
  step?: number;
  def?: number | boolean | string;
  hint?: { en: string; zh: string };
  // Conflicts with the house style rules: shown as a warning, AI avoids unless asked
  rule?: Rule;
}

export interface Group {
  id: string;
  en: string;
  zh: string;
  fields: FieldDef[];
  // Only for screen recordings
  screen?: boolean;
}

const H = (en: string, zh: string) => ({ en, zh });
const opts = (list: [string, string, string][]): Named[] => list.map(([id, en, zh]) => ({ id, en, zh }));

export const SCENE_FX: Group[] = [
  {
    id: 'color',
    en: 'Color',
    zh: '调色',
    fields: [
      { path: 'fx.look', en: 'Look', zh: '滤镜', type: 'select', options: LOOK_LIST },
      { path: 'fx.brightness', en: 'Brightness', zh: '亮度', type: 'range', min: 0.3, max: 2, step: 0.05, def: 1 },
      { path: 'fx.contrast', en: 'Contrast', zh: '对比度', type: 'range', min: 0.3, max: 2, step: 0.05, def: 1 },
      { path: 'fx.saturate', en: 'Saturation', zh: '饱和度', type: 'range', min: 0, max: 3, step: 0.05, def: 1 },
      { path: 'fx.hue', en: 'Hue', zh: '色相', type: 'range', min: -180, max: 180, step: 5, def: 0, hint: H('degrees', '度') },
      { path: 'fx.duotone', en: 'Duotone', zh: '双色调', type: 'select', options: DUOTONE_LIST },
      { path: 'fx.posterize', en: 'Posterize', zh: '色阶分离', type: 'range', min: 0, max: 8, step: 1, def: 0, hint: H('colour levels per channel; 0 = off', '每个通道的色阶数，0 为关') },
    ],
  },
  {
    id: 'lens',
    en: 'Lens',
    zh: '镜头',
    fields: [
      { path: 'fx.blur', en: 'Blur', zh: '模糊', type: 'range', min: 0, max: 20, step: 0.5, def: 0, hint: H('pixels', '像素') },
      { path: 'fx.chroma', en: 'RGB split', zh: '色散', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.bloom', en: 'Bloom', zh: '辉光', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.pixelate', en: 'Pixelate', zh: '像素化', type: 'range', min: 0, max: 60, step: 1, def: 0, hint: H('block size in pixels', '色块大小（像素）') },
      { path: 'fx.crt', en: 'CRT lines', zh: '显像管扫描线', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.glitch', en: 'Glitch bursts', zh: '故障闪烁', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
    ],
  },
  {
    id: 'mood',
    en: 'Atmosphere',
    zh: '氛围',
    fields: [
      { path: 'fx.vignette', en: 'Vignette', zh: '暗角', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.grain', en: 'Film grain', zh: '胶片颗粒', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.leak', en: 'Light leak', zh: '漏光', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.letterbox', en: 'Letterbox', zh: '电影黑边', type: 'range', min: 0, max: 0.2, step: 0.01, def: 0, hint: H('each bar as a share of the frame height', '每条占画面高度比例') },
      { path: 'fx.dim', en: 'Dim', zh: '压暗', type: 'range', min: 0, max: 0.9, step: 0.05, def: 0, hint: H('0.2–0.3 before a music break', '音乐断点前压暗 0.2–0.3') },
    ],
  },
  {
    id: 'motion',
    en: 'Camera',
    zh: '运动',
    fields: [
      { path: 'fx.kenburns', en: 'Ken Burns', zh: '推拉摇移', type: 'select', options: opts([['', 'None', '无'], ['in', 'Push in', '慢推'], ['out', 'Pull out', '慢拉'], ['left', 'Pan left', '左移'], ['right', 'Pan right', '右移'], ['up', 'Tilt up', '上移'], ['down', 'Tilt down', '下移'], ['reveal', 'Pull-back reveal', '拉远揭示']]), hint: H('Slow camera move over images, clips and cards', '图片/视频/卡片的慢速运镜') },
      { path: 'fx.kbAmount', en: 'Move amount', zh: '运镜幅度', type: 'range', min: 0.02, max: 0.5, step: 0.01, def: 0.12 },
      { path: 'fx.drift', en: 'Handheld drift', zh: '手持漂移', type: 'range', min: 0, max: 1, step: 0.05, def: 0 },
      { path: 'fx.focusIn', en: 'Focus pull-in', zh: '开场对焦', type: 'range', min: 0, max: 3, step: 0.1, def: 0, hint: H('seconds from blurred to sharp', '从模糊到清晰的秒数') },
      { path: 'fx.stepped', en: 'Stop motion', zh: '定格动画', type: 'select', options: opts([['', 'Off', '关'], ['12', '12 fps', '12 帧'], ['8', '8 fps', '8 帧'], ['6', '6 fps', '6 帧']]) },
      { path: 'fx.motionBlur', en: 'Motion blur', zh: '动态模糊', type: 'bool', def: false, hint: H('Trails while the camera moves; slower to export', '镜头移动时的拖影；导出变慢') },
      { path: 'fx.shake', en: 'Shake', zh: '抖动', type: 'range', min: 0, max: 1, step: 0.05, def: 0, rule: 'shake' },
      { path: 'fx.fadeIn', en: 'Fade from black', zh: '黑场淡入', type: 'range', min: 0, max: 3, step: 0.1, def: 0, hint: H('seconds', '秒') },
      { path: 'fx.fadeOut', en: 'Fade to black', zh: '黑场淡出', type: 'range', min: 0, max: 3, step: 0.1, def: 0, hint: H('seconds', '秒') },
    ],
  },
  {
    id: 'screen',
    en: 'Recording',
    zh: '录屏',
    screen: true,
    fields: [{ path: 'fx.ripple', en: 'Click ripples', zh: '点击涟漪', type: 'bool', def: true }],
  },
];

const CAPTION_ANIMS: Named[] = [
  { id: '', en: 'Fade (default)', zh: '淡入（默认）' },
  { id: 'pop', en: 'Pop', zh: '弹出', rule: 'caption' },
  { id: 'word', en: 'Word by word', zh: '逐词出现', rule: 'caption' },
  { id: 'karaoke', en: 'Karaoke', zh: '卡拉OK高亮', rule: 'caption' },
  ...TEXT_LIST.filter((a) => !['count', 'wheel', 'strike', 'roll', 'ticker', 'flap'].includes(a.id)),
];

export const BOARD_FX: Group[] = [
  {
    id: 'captions',
    en: 'Captions',
    zh: '字幕样式',
    fields: [
      { path: 'captions.off', en: 'Hide captions', zh: '不显示字幕', type: 'bool', def: false },
      { path: 'captions.style', en: 'Style', zh: '样式', type: 'select', options: opts([['', 'Box (default)', '默认（底框）'], ['box', 'Box', '底框'], ['outline', 'Outline', '描边'], ['plain', 'Plain', '无框']]) },
      { path: 'captions.pos', en: 'Position', zh: '位置', type: 'select', options: opts([['', 'Bottom', '底部'], ['bottom', 'Bottom', '底部'], ['middle', 'Middle', '中间'], ['top', 'Top', '顶部']]) },
      { path: 'captions.scale', en: 'Size', zh: '字号', type: 'range', min: 0.6, max: 1.8, step: 0.05, def: 1 },
      { path: 'captions.anim', en: 'Animation', zh: '出现方式', type: 'select', options: CAPTION_ANIMS, hint: H('Most text animations work on captions too', '大多数文字动画也能用在字幕上') },
    ],
  },
  {
    id: 'frame',
    en: 'Recording frame',
    zh: '录屏画框',
    fields: [
      { path: 'frame.radius', en: 'Corner radius', zh: '圆角', type: 'range', min: 0, max: 60, step: 1, def: 16, hint: H('pixels', '像素') },
      { path: 'frame.shadow', en: 'Shadow', zh: '阴影', type: 'range', min: 0, max: 2, step: 0.05, def: 1 },
      { path: 'frame.inset', en: 'Padding', zh: '留边', type: 'range', min: 0, max: 0.3, step: 0.01, def: 0, hint: H('extra margin around the picture', '画面四周多留的比例') },
      { path: 'frame.glow', en: 'Accent glow', zh: '主题色描边光', type: 'bool', def: false },
    ],
  },
  {
    id: 'sound',
    en: 'Sound',
    zh: '声音',
    fields: [
      { path: 'sfx.whoosh', en: 'Transition whoosh', zh: '转场嗖声', type: 'bool', def: true },
      { path: 'sfx.click', en: 'Click sounds', zh: '点击声', type: 'bool', def: true },
      { path: 'sfx.pop', en: 'Punch-word pop', zh: '大字弹出声', type: 'bool', def: true },
      { path: 'sfx.volume', en: 'Effects volume', zh: '音效音量', type: 'range', min: 0, max: 2, step: 0.05, def: 1 },
      { path: 'music.fadeIn', en: 'Music fade in', zh: '配乐淡入', type: 'range', min: 0, max: 5, step: 0.1, def: 1, hint: H('seconds, narrated cut', '秒，旁白版') },
      { path: 'music.fadeOut', en: 'Music fade out', zh: '配乐淡出', type: 'range', min: 0, max: 8, step: 0.1, def: 2, hint: H('seconds, narrated cut', '秒，旁白版') },
    ],
  },
  {
    id: 'other',
    en: 'Other',
    zh: '其他',
    fields: [
      { path: 'theme.bgFx', en: 'Animated background', zh: '动态背景', type: 'select', options: BG_LIST },
      { path: 'glass', en: 'Frosted cards', zh: '毛玻璃卡片', type: 'bool', def: false, hint: H('stat and flow cards', '数字卡、流程图卡') },
      { path: 'chapterBar', en: 'Chapter bar', zh: '章节进度条', type: 'bool', def: false, hint: H('needs chapter names on scenes', '段落里填了"章节名"才显示') },
      { path: 'theme.wallBlur', en: 'Wallpaper blur', zh: '背景图模糊', type: 'range', min: 0, max: 40, step: 1, def: 0, hint: H('when a wallpaper image is set', '设了背景图时有效') },
    ],
  },
];

export const allFields = (groups: Group[]) => groups.flatMap((g) => g.fields);

const describe = (f: FieldDef) => {
  const vals = f.type === 'select' ? f.options!.filter((o) => o.id).map((o) => `${o.id}=${o.en}${o.rule ? ' [house rule]' : ''}`).join(', ') : f.type === 'range' ? `${f.min}..${f.max}${f.def !== undefined ? ` (default ${f.def})` : ''}` : f.type === 'bool' ? `true|false${f.def !== undefined ? ` (default ${f.def})` : ''}` : f.type;
  return `  ${f.path} — ${f.en}: ${vals}${f.hint ? `; ${f.hint.en}` : ''}${f.rule ? `  [house rule: ${RULES[f.rule].en} — only if the user asks]` : ''}`;
};

// Plain-text reference for the CLI and the AI assistant
export function catalogText(): string {
  const out: string[] = ['Scene effects (set <id> <path> <value>):'];
  for (const g of SCENE_FX) {
    out.push(` ${g.en}${g.screen ? ' (screen recordings)' : ''}`);
    g.fields.forEach((f) => out.push(describe(f)));
  }
  out.push(' Transitions (voice cut): transition = ' + TRANSITION_LIST.map((t) => `${t.id || 'fade'}=${t.en}${t.rule ? ' [house rule]' : ''}`).join(', '));
  out.push(`  transDir = left|right|up|down for ${DIR_TRANSITIONS.join('/')}; transDur = seconds (default 0.4); beatTransition = same values, beat cut only (default 12-frame fade)`);
  out.push(' Overlays: scene.overlays = [{kind, at (sec from scene start), dur (sec), text, sub, x, y, w, h, style, anim, color, size, value}]');
  OVERLAY_LIST.forEach((o) => out.push(`  ${o.id} — ${o.en}: fields ${o.fields.join(',')}${o.hint ? `; ${o.hint.en}` : ''}${o.rule ? ` [house rule: ${RULES[o.rule].en}]` : ''}`));
  out.push('  lower.style = ' + LOWER_LIST.filter((l) => l.id).map((l) => `${l.id}=${l.en}`).join(', '));
  out.push('  text/anim = ' + TEXT_LIST.map((a) => `${a.id}=${a.en}${a.rule ? ' [house rule for captions]' : ''}`).join(', '));
  out.push(' Chapter: scene.chapter = "name" (shown on the chapter bar)');
  out.push('Board settings (set - <path> <value>):');
  for (const g of BOARD_FX) {
    out.push(` ${g.en}`);
    g.fields.forEach((f) => out.push(describe(f)));
  }
  out.push('  theme.wallpaper = image path inside the project folder (replaces the gradient backdrop)');
  out.push(
    'Visual kinds for `add`: ' +
      [
        'title{kicker,title,sub,anim}',
        'stats{items:[{value,label,en}]}',
        'counter{value,label,sub}',
        'chart{title,unit,items:[{label,value}]}',
        'checklist{title,items:[string]}',
        'quote{text,author,role,rating}',
        'chat{title,messages:[{me,name,text}]}',
        'notifs{items:[{app,title,body}]}',
        'code{title,code}',
        'terminal{title,lines:[{cmd,out}]}',
        'flap{title,rows:[string]}',
        'compare{a,b,labelA,labelB} (two images)',
        'outro{title,url,lines}',
        'flow{title,cols}',
        'image{src,fit,frame}',
        'clip{src,from,rate,fit,frame,muted}',
        'screen{src,from,to,rate,zoom,base,frame,url}',
      ].join(' '),
  );
  out.push('Cards: ' + CARD_LIST.map((c) => `${c.id}=${c.en}`).join(', '));
  return out.join('\n');
}
