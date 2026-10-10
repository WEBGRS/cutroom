// UI language: this browser's choice, else the app-wide setting (installer / server), else English
export type Lang = 'en' | 'zh';

function read(): Lang {
  if (typeof window === 'undefined') return 'en';
  // ?ui= (not ?lang=, which is the video's language)
  const q = new URLSearchParams(location.search).get('ui');
  if (q === 'en' || q === 'zh') {
    try {
      localStorage.setItem('cutroom-lang', q);
    } catch {
      // Private mode
    }
    return q;
  }
  try {
    const s = localStorage.getItem('cutroom-lang');
    if (s === 'en' || s === 'zh') return s;
  } catch {
    // Private mode
  }
  const d = document.documentElement.dataset.lang;
  return d === 'zh' ? 'zh' : 'en';
}

export const LANG: Lang = read();
if (typeof document !== 'undefined') document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';

// English first: it is the default
export const tr = (en: string, zh: string) => (LANG === 'zh' ? zh : en);
export const nm = (x: { en: string; zh: string }) => (LANG === 'zh' ? x.zh : x.en);

export async function setLang(l: Lang) {
  try {
    localStorage.setItem('cutroom-lang', l);
  } catch {
    // Private mode
  }
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }).catch(() => undefined);
  const q = new URLSearchParams(location.search);
  q.delete('ui');
  location.search = q.toString();
}
