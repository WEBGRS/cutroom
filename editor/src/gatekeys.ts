// Checkpoint helpers for the page: checklist group labels (stagefiles.ts holds the full checklist, server side), the pass message
export const CHECKLIST_KEYS: [string, string, string][] = [
  ['P', 'Product', '产品'],
  ['F', 'Features', '功能'],
  ['V', 'Look', '风格'],
  ['B', 'Shot table', '镜头表'],
  ['D', 'Data', '数据'],
  ['A', 'Audio', '声音'],
  ['Q', 'Picture', '画面'],
  ['M', 'Words = picture', '台词对画面'],
  ['T', 'Captions', '字幕'],
];

// A pass button's message carries what the user typed; the pointed-at refs go only with typed words
export function passText(message: string, typed: string): { text: string; withRefs: boolean } {
  const t = typed.trim();
  return t ? { text: `${message}\n${t}`, withRefs: true } : { text: message, withRefs: false };
}
