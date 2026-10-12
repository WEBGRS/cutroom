// The user's standing rules, which the AI assistant reads with every request and adds to when corrected:
// <project>/RULES.md for this video or series, .editor/rules.md for every project
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, STATE } from './store';

const projectFile = (slug: string) => path.join(PUBLIC, slug, 'RULES.md');
const globalFile = () => path.join(STATE, 'rules.md');
const MAX = 40;

function read(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter((l) => l && !l.startsWith('#'));
}
function write(file: string, title: string, rules: string[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${title}\n\n${rules.map((r) => `- ${r}`).join('\n')}\n`);
}

export const projectRules = (slug: string) => read(projectFile(slug));
export const globalRules = () => read(globalFile());

export function addRule(slug: string, rule: string, all: boolean): string[] {
  const text = rule.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('rules add "<one short rule>"');
  if (text.length > 200) throw new Error('keep a rule to one sentence (under 200 characters)');
  const list = all ? globalRules() : projectRules(slug);
  if (list.some((r) => r.toLowerCase() === text.toLowerCase())) return list;
  // Oldest rules make way once a list is long; the newest correction is the one that matters now
  const next = [...list, text].slice(-MAX);
  write(all ? globalFile() : projectFile(slug), all ? 'Rules for every project' : `Rules for ${slug}`, next);
  return next;
}

export function removeRule(slug: string, n: number, all: boolean): string[] {
  const list = all ? globalRules() : projectRules(slug);
  if (!(n >= 1 && n <= list.length)) throw new Error(`rules rm <n>: n is 1–${list.length} (rules lists them)`);
  const next = list.filter((_, i) => i !== n - 1);
  write(all ? globalFile() : projectFile(slug), all ? 'Rules for every project' : `Rules for ${slug}`, next);
  return next;
}

// The block that goes into the assistant's instructions
export function rulesBlock(slug: string): string {
  const g = globalRules();
  const p = projectRules(slug);
  if (!g.length && !p.length) return 'None saved yet.';
  return [g.length ? `For every project:\n${g.map((r) => `- ${r}`).join('\n')}` : '', p.length ? `For ${slug}:\n${p.map((r) => `- ${r}`).join('\n')}` : ''].filter(Boolean).join('\n');
}
