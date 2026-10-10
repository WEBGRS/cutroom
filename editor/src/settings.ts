import fs from 'node:fs';
import path from 'node:path';
import { STATE } from './store';

// App-wide settings in .editor/settings.json (git-ignored): UI language, AI connection
const FILE = path.join(STATE, 'settings.json');

export function readSettings(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeSettings(patch: Record<string, unknown>) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

export const uiLang = (): 'en' | 'zh' => (readSettings().lang === 'zh' ? 'zh' : 'en');

// Server-side message in the app's language
export const L = (en: string, zh: string) => (uiLang() === 'zh' ? zh : en);
