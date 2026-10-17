// Shot recipes: named ways to build a shot from the editor's own fields, for the AI's instructions and `fx`
export type RecipeCat = 'open' | 'camera' | 'cut' | 'emphasis' | 'data' | 'text' | 'mood' | 'close';

export interface Recipe {
  id: string;
  cat: RecipeCat;
  en: string;
  zh: string;
  // When it fits
  when: string;
  // Fields and commands that make it
  how: string;
  // Registry ids it relies on: transition: overlay: sound: card: text: lower: look: bg: fx:<path>
  uses: string[];
}

export const RECIPE_CATS: Record<RecipeCat, { en: string; zh: string }> = {
  open: { en: 'Opening', zh: '开场' },
  camera: { en: 'Camera', zh: '运镜' },
  cut: { en: 'Cuts', zh: '转场' },
  emphasis: { en: 'Emphasis', zh: '强调' },
  data: { en: 'Numbers and comparisons', zh: '数据与对比' },
  text: { en: 'Text on screen', zh: '文字' },
  mood: { en: 'Mood', zh: '氛围' },
  close: { en: 'Ending', zh: '收尾' },
};

export const RECIPES: Recipe[] = [
  {
    id: 'result-first',
    cat: 'open',
    en: 'Result first',
    zh: '结果先行',
    when: 'any demo: the viewer sees what they get before how',
    how: 'dup the scene that shows the finished result, mv the copy to the front, trim it to 2–3 s around the result (--from @mark-1 --to @mark+1.5); overlays += cinema with the claim; transition "flash" into the first step',
    uses: ['overlay:cinema', 'transition:flash'],
  },
  {
    id: 'typed-question',
    cat: 'open',
    en: 'Typed question',
    zh: '打字提问开场',
    when: 'AI tools, search, anything that starts from a request',
    how: 'overlays += prompt {"text":"<the request>","at":0,"dur":2.5}; sounds += typing at 0; next scene shows the answer with transition "none"',
    uses: ['overlay:prompt', 'sound:typing', 'transition:none'],
  },
  {
    id: 'focus-title',
    cat: 'open',
    en: 'Title out of focus',
    zh: '虚焦拉实标题',
    when: 'a calm title or chapter card',
    how: 'title card with anim "focus"; fx.focusIn 0.8; board theme.bgFx "aurora" or "mesh"',
    uses: ['card:title', 'text:focus', 'fx:fx.focusIn', 'bg:aurora', 'bg:mesh'],
  },
  {
    id: 'follow-click',
    cat: 'camera',
    en: 'Follow the click',
    zh: '跟随点击推近',
    when: 'screen recordings where small controls matter',
    how: 'visual.zoom "auto" (default) zooms to clicks; a fixed close-up: visual.zooms += {"at":"@mark","end":"@mark+2","x":0.7,"y":0.3,"scale":1.8}; keep fx.ripple true',
    uses: ['fx:fx.ripple'],
  },
  {
    id: 'slow-push',
    cat: 'camera',
    en: 'Slow push in',
    zh: '静帧慢推',
    when: 'images, photos, cards held longer than 3 s',
    how: 'fx.kenburns "in"; fx.kbAmount 0.06–0.1 (more looks fast); "left"/"right" for wide pictures',
    uses: ['fx:fx.kenburns', 'fx:fx.kbAmount'],
  },
  {
    id: 'pull-back',
    cat: 'camera',
    en: 'Pull-back reveal',
    zh: '拉远揭示',
    when: 'a detail first, then the whole thing (a field → the full page)',
    how: 'fx.kenburns "reveal"; fx.kbAmount 0.25; sounds += swoosh-up at 0',
    uses: ['fx:fx.kenburns', 'fx:fx.kbAmount', 'sound:swoosh-up'],
  },
  {
    id: 'handheld',
    cat: 'camera',
    en: 'Handheld',
    zh: '手持感',
    when: 'photos and clips of real places or people; never on interface recordings',
    how: 'fx.drift 0.3',
    uses: ['fx:fx.drift'],
  },
  {
    id: 'speed-ramp',
    cat: 'camera',
    en: 'Speed through the wait',
    zh: '等待加速',
    when: 'loading, installs, long typing inside a recording',
    how: 'split the scene at the start and end of the wait; on the middle piece set visual.rate 3–4 and overlays += tag "×4"',
    uses: ['overlay:tag'],
  },
  {
    id: 'hard-cut-steps',
    cat: 'cut',
    en: 'Hard cut between steps',
    zh: '步骤间硬切',
    when: 'consecutive steps in the same app; keep effects for section changes',
    how: 'transition "none" on each step after the first',
    uses: ['transition:none'],
  },
  {
    id: 'same-direction',
    cat: 'cut',
    en: 'Same direction',
    zh: '同向推进',
    when: 'a sequence that moves forward (step 1 → 2 → 3, page to page)',
    how: 'transition "push" or "slide" with the same transDir "left" and transDur 0.35 on every scene of the sequence',
    uses: ['transition:push', 'transition:slide'],
  },
  {
    id: 'whip-chain',
    cat: 'cut',
    en: 'Whip chain',
    zh: '甩镜串联',
    when: 'three or more parallel features or examples',
    how: 'transition "whip", transDur 0.3, transDir alternating left/right; sounds += whoosh-short at 0',
    uses: ['transition:whip', 'sound:whoosh-short'],
  },
  {
    id: 'section-dip',
    cat: 'cut',
    en: 'Section break',
    zh: '段落换章',
    when: 'a new part of the video (setup → result, feature A → feature B)',
    how: 'transition "dip" (or "fadethrough"); overlays += cinema with the section name at 0.2; scene.chapter for the chapter bar',
    uses: ['transition:dip', 'transition:fadethrough', 'overlay:cinema'],
  },
  {
    id: 'glitch-cut',
    cat: 'cut',
    en: 'Glitch cut',
    zh: '故障切',
    when: 'developer tools, terminals, "before it broke / now it works"; once or twice a video',
    how: 'transition "glitch" or "chroma", transDur 0.25; sounds += glitch at 0',
    uses: ['transition:glitch', 'transition:chroma', 'sound:glitch'],
  },
  {
    id: 'spotlight',
    cat: 'emphasis',
    en: 'Spotlight',
    zh: '聚光灯',
    when: 'the one control the line talks about, on a busy screen',
    how: 'overlays += spot {"x":…,"y":…,"w":0.12,"at":<line start>,"dur":1.5}; "feather" for a softer box around a region',
    uses: ['overlay:spot', 'overlay:feather'],
  },
  {
    id: 'hand-circle',
    cat: 'emphasis',
    en: 'Hand-drawn mark',
    zh: '手绘圈注',
    when: 'a number, a field or a word the narration names',
    how: 'overlays += hwcircle {"x":…,"y":…,"w":…,"h":…,"at":<when it is said>,"dur":1.6}; hwunderline under text; hwcheck/hwcross for right and wrong',
    uses: ['overlay:hwcircle', 'overlay:hwunderline', 'overlay:hwcheck', 'overlay:hwcross'],
  },
  {
    id: 'guided-click',
    cat: 'emphasis',
    en: 'Guided click',
    zh: '光标引导点击',
    when: 'screenshots or recordings without a visible cursor',
    how: 'overlays += cursor {"x":<click>,"y":…,"w":<start x>,"h":<start y>,"at":…,"dur":1.2}; tap at the click; sounds += click at the same moment',
    uses: ['overlay:cursor', 'overlay:tap', 'sound:click'],
  },
  {
    id: 'shortcut-keys',
    cat: 'emphasis',
    en: 'Shortcut on screen',
    zh: '快捷键提示',
    when: 'the user presses a keyboard shortcut in the recording',
    how: 'overlays += keys {"text":"Ctrl+K","at":<seconds into the scene>,"dur":1.4}; sounds += click-soft',
    uses: ['overlay:keys', 'sound:click-soft'],
  },
  {
    id: 'punch-word',
    cat: 'emphasis',
    en: 'Punch word',
    zh: '重点词砸屏',
    when: 'the one word of a section that must land; at most once every 20 s',
    how: 'overlays += punch {"text":"<1–4 characters>","at":…,"dur":1}; board sfx.pop adds its sound',
    uses: ['overlay:punch'],
  },
  {
    id: 'number-climb',
    cat: 'data',
    en: 'Number climb',
    zh: '数字滚动',
    when: 'a result worth a number (time saved, users, speed)',
    how: 'counter card, or overlays += counter {"text":"12,800+","sub":"<label>"} over footage (it counts up to the number in text); sounds += riser ending at the final value, then ding',
    uses: ['card:counter', 'overlay:counter', 'sound:riser', 'sound:ding'],
  },
  {
    id: 'before-after',
    cat: 'data',
    en: 'Before / after',
    zh: '前后对比',
    when: 'a change: old vs new, messy vs clean',
    how: 'add compare <img-before> with labelA/labelB; or two scenes of the two states joined by transition "wipe" with transDir "right"',
    uses: ['card:compare', 'transition:wipe'],
  },
  {
    id: 'inline-chart',
    cat: 'data',
    en: 'Chart over footage',
    zh: '画面内小图表',
    when: 'two to five numbers that belong to what is on screen',
    how: 'overlays += bars {"text":"A:12,B:30","x":0.75,"y":0.3,"w":0.3,"h":0.25}; a whole scene of numbers: chart card',
    uses: ['overlay:bars', 'card:chart'],
  },
  {
    id: 'kinetic-title',
    cat: 'text',
    en: 'Kinetic title',
    zh: '动态大标题',
    when: 'a section opener with few words',
    how: 'overlays += text {"text":…,"anim":"maskup","size":1.6}; "tracking" for one word; bigword behind it with the same word',
    uses: ['overlay:text', 'text:maskup', 'text:tracking', 'overlay:bigword'],
  },
  {
    id: 'terminal-run',
    cat: 'text',
    en: 'Command and output',
    zh: '命令行演示',
    when: 'installs, CLI tools, code that runs',
    how: 'terminal card (lines [{cmd,out}]), or overlays += terminal over footage; sounds += typing while the command types',
    uses: ['card:terminal', 'overlay:terminal', 'sound:typing'],
  },
  {
    id: 'feature-label',
    cat: 'text',
    en: 'Feature label',
    zh: '功能角标',
    when: 'naming the feature on screen without a full card',
    how: 'overlays += lower {"text":"<feature>","sub":"<one short line>","style":"kicker"}; "pill" on light footage; add "plate":true over bright frames',
    uses: ['overlay:lower', 'lower:kicker', 'lower:pill'],
  },
  {
    id: 'privacy-blur',
    cat: 'text',
    en: 'Hide private details',
    zh: '隐私打码',
    when: 'emails, keys, names or prices in a recording',
    how: 'overlays += blur {"x":…,"y":…,"w":…,"h":…,"at":0,"dur":<scene length>}; check every frame of the scene with look',
    uses: ['overlay:blur'],
  },
  {
    id: 'cinematic',
    cat: 'mood',
    en: 'Cinematic grade',
    zh: '电影感调色',
    when: 'clips and photos of real things; never on interface recordings (text gets hard to read)',
    how: 'fx.letterbox 0.08; fx.look "teal"; fx.grain 0.15; fx.vignette 0.3',
    uses: ['fx:fx.letterbox', 'look:teal', 'fx:fx.grain', 'fx:fx.vignette'],
  },
  {
    id: 'flashback',
    cat: 'mood',
    en: 'Flashback',
    zh: '回忆段',
    when: '"how it used to be" before showing the new way',
    how: 'fx.look "vintage" (or "mono"); fx.grain 0.25; transition "leak" into it and "leak" out of it',
    uses: ['look:vintage', 'look:mono', 'fx:fx.grain', 'transition:leak'],
  },
  {
    id: 'success-beat',
    cat: 'close',
    en: 'Success beat',
    zh: '成功收尾',
    when: 'right after the final action works',
    how: 'overlays += check {"text":"<what worked>","at":<the moment>}; confetti only for launches; sounds += success',
    uses: ['overlay:check', 'overlay:confetti', 'sound:success'],
  },
  {
    id: 'loop-back',
    cat: 'close',
    en: 'Loop back',
    zh: '首尾呼应',
    when: 'the last shot can echo the first',
    how: 'end on the same frame as the opening (dup the opener, mv it to the end), then the outro card with the URL; fx.fadeOut 1 on the outro',
    uses: ['card:outro', 'fx:fx.fadeOut'],
  },
];

// Plain-text list for the AI's instructions
export function recipesText(): string {
  const out = [
    'Shot recipes (named ways to build a shot; "+=" means set <id> <list>.<next index> \'<json>\'; when you use one, name it in the scene\'s shot design, e.g. "镜头配方：聚光灯"):',
  ];
  for (const cat of Object.keys(RECIPE_CATS) as RecipeCat[]) {
    out.push(` ${RECIPE_CATS[cat].en}`);
    RECIPES.filter((r) => r.cat === cat).forEach((r) => out.push(`  ${r.id} — ${r.en} (${r.zh}): ${r.when}. ${r.how}`));
  }
  return out.join('\n');
}
