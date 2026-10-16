// Prompt library for the AI panel. 【…】 marks a part to fill in; the first one is selected on insert

export interface PromptItem {
  en: string;
  zh: string;
}
export interface PromptGroup {
  id: string;
  en: string;
  zh: string;
  items: PromptItem[];
}

export const PROMPTS: PromptGroup[] = [
  {
    id: 'review',
    en: 'Review',
    zh: '检查',
    items: [
      { en: 'Watch the whole video and name the 3 changes that would help most, with reasons. Don’t edit yet.', zh: '看一遍整条片子，挑出最该改的 3 处并说明原因，先别动手。' },
      { en: 'Check before export: captions that are too long, lines without voice-over, empty scenes, sound effects that overlap. List them, then fix them one by one.', zh: '导出前检查：字幕太长、没配音的句子、空段落、互相重叠的音效，先列出来，再逐个修。' },
      { en: 'Make the first 3 seconds grab attention: open on the finished result, no build-up.', zh: '把开头 3 秒改得更抓人：一上来就给成品画面或结果，不要铺垫。' },
      { en: 'Go through the video scene by scene: what the narration says, what the picture adds. Where the picture only repeats the words, propose something better.', zh: '逐段过一遍：旁白说了什么、画面补充了什么。画面只是在重复旁白的地方，给出更好的画面方案。' },
      { en: 'Export for video platforms at -14 LUFS.', zh: '按视频平台的响度（-14 LUFS）导出。' },
    ],
  },
  {
    id: 'pace',
    en: 'Pacing',
    zh: '节奏',
    items: [
      { en: 'Cut the whole video to under 【30】 seconds, dropping repeats and build-up first.', zh: '把整条片子压到 【30】 秒以内，先删重复和铺垫的内容。' },
      { en: 'Speed up the selected scene: trim idle footage and shorten the pauses between lines.', zh: '把选中这段的节奏加快：剪掉空镜，缩短旁白之间的停顿。' },
      { en: 'Make transitions consistent: two kinds at most, and plain cuts between related scenes.', zh: '统一转场：全片最多用 2 种，内容相关的相邻段落直接硬切。' },
    ],
  },
  {
    id: 'words',
    en: 'Narration',
    zh: '旁白字幕',
    items: [
      { en: 'Write one narration line per scene for a video about 【what it shows】. One line per on-screen action.', zh: '给每段写一句旁白，这条视频讲的是 【内容】。一句对应一个画面动作。' },
      { en: 'Rewrite the narration so it sounds like a person talking: short, first person, no stock phrases, and never describe what is already on screen.', zh: '把旁白改得像真人随口说：短句、第一人称、不用套话，也不要念画面上已经看得到的东西。' },
      { en: 'Add an English line under every narration line.', zh: '给每句旁白加上英文副字幕。' },
      { en: 'Mark the one key word in every line as a highlight with [[ ]].', zh: '每句旁白里最关键的一个词用 [[ ]] 标成重点。' },
      { en: 'Use outlined captions, a little bigger, in the bottom safe area.', zh: '字幕改成描边样式，放大一点，放在底部安全区。' },
    ],
  },
  {
    id: 'voice',
    en: 'Voice-over',
    zh: '配音',
    items: [
      { en: 'Voice every narration line that has no audio yet.', zh: '给所有还没配音的旁白配音。' },
      { en: 'Switch to a 【female】 voice and re-voice every line.', zh: '换成 【女声】，把全部旁白重新配一遍。' },
      { en: 'Set the voice-over speed to 【1.1】× and re-voice every line.', zh: '把配音语速调到 【1.1】 倍，全部重新配音。' },
      { en: 'Voice the English lines too.', zh: '英文旁白也配上音。' },
    ],
  },
  {
    id: 'record',
    en: 'Recording',
    zh: '录屏',
    items: [
      { en: 'Record 【web address】: 【what to show, e.g. search for something and open the first result】. Add it after the selected scene and caption each step.', zh: '录一段 【网址】：【要演示的操作，比如搜索某个词再打开第一个结果】。加到选中这段后面，每一步配一句字幕。' },
      { en: 'Record a demo of this editor: 【what to show, e.g. pick a transition, preview it, then play】.', zh: '录一段这个软件的使用演示：【要演示的操作，比如选一个转场、预览、再播放】。' },
      { en: 'Record me using 【app, e.g. JianyingPro】: 【what I will do】. Put it into 【scene】 and align the captions to the steps.', zh: '录我操作 【软件，比如剪映】：【我要演示的操作】。替换到 【段落】 里，字幕对齐到每一步。' },
      { en: 'Turn the cards that only repeat the narration into screen recordings, and tell me what I need to record.', zh: '把只是在重复旁白的卡片换成录屏，告诉我需要录什么。' },
      { en: 'I recorded 【path to the video】 myself. Import it, find the key moments and put it after the selected scene.', zh: '我自己录了 【视频文件路径】，导入进来，找出关键时刻，加到选中这段后面。' },
      { en: 'Record 【web address】 at phone size for the 9:16 version.', zh: '把 【网址】 录成手机竖屏版，用在 9:16 版本里。' },
      { en: 'Add a hand-drawn circle or arrow at each key step of the recordings.', zh: '在录屏的每个关键步骤上加手绘圈或箭头。' },
    ],
  },
  {
    id: 'look',
    en: 'Effects',
    zh: '特效包装',
    items: [
      { en: 'Make a 【30】-second 【16:9 widescreen / 9:16 vertical】 video from the media in this project: the result first, then three highlights, then one line asking viewers to try it.', zh: '用项目里的素材做一条 【30】 秒的 【16:9 横屏 / 9:16 竖屏】 片子：开头先给结果，中间三个亮点，结尾一句号召。' },
      { en: 'Make the 【9:16 vertical】 version: check every scene at that size and reframe footage so the important part stays in view.', zh: '做 【9:16 竖屏】 版：每段按这个画幅检查构图，录屏和视频用 reframe 裁好，重点留在画面里。' },
      { en: 'Give the selected scene a cinematic look: warm grade, vignette, a little film grain.', zh: '给选中这段加电影感：暖色调、暗角、一点胶片颗粒。' },
      { en: 'Add a title card at the start: 【title】.', zh: '在最前面加一个标题卡：【标题】。' },
      { en: 'Add a slow push-in to every image.', zh: '给所有图片加慢推效果。' },
      { en: 'Show the key numbers with a count-up animation.', zh: '关键数字出现时用滚动计数的动画。' },
    ],
  },
  {
    id: 'music',
    en: 'Music',
    zh: '配乐',
    items: [
      { en: 'Write music for this video: 【mood and style, e.g. warm acoustic, relaxed】, about as long as the video. Real instrument recordings, then put it under the video.', zh: '给这条片子写一段配乐：【情绪和风格，比如温暖的原声乐器、轻松】，长度和片子差不多。用真实乐器的录音演奏，再配到片子里。' },
      { en: 'Compose the same track again with 【a softer drum pattern】 and keep the old one.', zh: '同一首再写一版：【鼓点更轻】，旧的那首留着，方便我对比。' },
    ],
  },
  {
    id: 'sound',
    en: 'Sound',
    zh: '音效',
    items: [
      { en: 'Add a soft whoosh at every transition, kept quiet.', zh: '每个转场处加一个轻的嗖声，音量低一点。' },
      { en: 'Add a notification ding where each result appears.', zh: '每次出现结果的地方加一个提示音。' },
    ],
  },
];

// Shown in an empty conversation
export const FEATURED: [string, number][] = [
  ['review', 0],
  ['record', 1],
  ['voice', 0],
  ['look', 0],
];

// Above the input once a conversation has started, chosen by what the editor shows
export function chipsFor(c: { sel: boolean }): [string, number][] {
  if (c.sel) return [['pace', 1], ['look', 2]];
  return [['review', 0], ['review', 1]];
}

// Placeholder to select after inserting a prompt
export const SLOT = /【[^】]*】/;
