// Files the stages leave in the project folder: brief.md, plans/, review/log.md
import fs from 'node:fs';
import path from 'node:path';
import type { ReviewRound } from '../../src/lib/types';
import { PUBLIC } from './store';

export const BRIEF_BLOCKS = ['role', 'inputs', 'direction', 'structure', 'build', 'gotchas', 'start'] as const;
export const BRIEF_LISTS = ['features', 'terms', 'data'] as const;
export const PLAN_IDS = ['a', 'b', 'c'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const isPlanId = (s: unknown): s is PlanId => PLAN_IDS.includes(s as PlanId);
export const MAX_ROUNDS = 3;
export const SAMPLE_ROUNDS = 2;

const dir = (slug: string) => path.join(PUBLIC, slug);
export const briefFile = (slug: string) => path.join(dir(slug), 'brief.md');
export const planFile = (slug: string, id: PlanId) => path.join(dir(slug), 'plans', `plan-${id}.md`);
export const planStill = (slug: string, id: PlanId) => path.join(dir(slug), 'plans', `plan-${id}.jpeg`);
export const planClip = (slug: string, id: PlanId) => path.join(dir(slug), 'plans', `plan-${id}.mp4`);
export const reviewDir = (slug: string) => path.join(dir(slug), 'review');
export const reviewLog = (slug: string) => path.join(reviewDir(slug), 'log.md');

function write(f: string, text: string) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}
const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// A list in the brief: a "key:" line followed by "- item" lines (blank lines before the first item are fine)
export function briefList(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*[:：]\\s*$`, 'i').test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (!out.length && !l.trim()) continue;
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(l);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

// How a list is written, for the "missing" message
export const LIST_FORM = (key: string) => `a line "${key}:" then one "- item" line per item`;

// Missing blocks and lists, e.g. ["<gotchas>", "data: list"]
export function briefGaps(text: string): string[] {
  const blocks = BRIEF_BLOCKS.filter((b) => !new RegExp(`<${b}>[\\s\\S]*?</${b}>`).test(text)).map((b) => `<${b}>`);
  const lists = BRIEF_LISTS.filter((k) => !briefList(text, k).length).map((k) => `${k}: list`);
  return [...blocks, ...lists];
}

// The length the brief's <inputs> asks for, in seconds (the first number followed by s, 秒 or seconds)
export function briefSeconds(text: string): number | null {
  const inputs = /<inputs>([\s\S]*?)<\/inputs>/.exec(text)?.[1] ?? '';
  const m = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s(?![a-z])|秒)/i.exec(inputs);
  return m ? Number(m[1]) : null;
}

export const readBrief =(slug: string) => read(briefFile(slug));
export function writeBrief(slug: string, text: string): string[] {
  write(briefFile(slug), text);
  return briefGaps(text);
}

export function writePlan(slug: string, id: PlanId, md: string) {
  write(planFile(slug, id), md);
}

export interface PlanView {
  id: PlanId;
  md: string | null;
  title: string;
  line: string;
  still: boolean;
  clip: boolean;
}

export function readPlans(slug: string): PlanView[] {
  return PLAN_IDS.map((id) => {
    const md = read(planFile(slug, id));
    const lines = (md ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = (lines.find((l) => l.startsWith('#')) ?? '').replace(/^#+\s*/, '').replace(/^plan\s+[a-c]\s*[:：·-]\s*/i, '');
    const line = lines.find((l) => !l.startsWith('#')) ?? '';
    return { id, md, title: head, line, still: fs.existsSync(planStill(slug, id)), clip: fs.existsSync(planClip(slug, id)) };
  });
}

// The plan that was taken (by the user, or by the AI in mode none); null when none is chosen or its file is gone
export const chosenPlan = (slug: string, choice: string | undefined): string | null => (isPlanId(choice) ? read(planFile(slug, choice)) : null);

// Review checklist groups (adapted from Video-Shotcraft final-review)
export const CHECKLIST: { key: string; en: string; zh: string; ask: string }[] = [
  { key: 'P', en: 'Product', zh: '产品', ask: 'what the product is and for whom is clear; no feature claimed that the material does not show' },
  { key: 'F', en: 'Features', zh: '功能', ask: 'every must-show feature has a recognisable shot; every scene adds something new' },
  { key: 'V', en: 'Look', zh: '风格', ask: 'palette, fonts and motion personality match the chosen plan; no drift to an unrelated style' },
  { key: 'B', en: 'Table', zh: '镜头表', ask: 'order, lengths, lines and seams match the shot table; holds respected (brand ≥ 1 s, ≥ 0.5 s still after entrances, opening action ≥ 3 s)' },
  { key: 'D', en: 'Data', zh: '数据', ask: 'no personal names, emails, keys, internal addresses or customer data unless the brief says they are public' },
  { key: 'A', en: 'Audio', zh: '声音', ask: 'voice clear over music, cues on the action, no clipping' },
  { key: 'Q', en: 'Picture', zh: '画面', ask: 'text sharp and readable at phone size; nothing covers captions or what is being operated (click target, cursor path, field being typed in); no empty half-frames; no pop across cuts; no frozen last frame' },
  { key: 'M', en: 'Words = picture', zh: '台词对画面', ask: 'each line shows what it says; nothing appears before the line that introduces it' },
  { key: 'T', en: 'Captions', zh: '字幕', ask: 'product names and terms spelled as in the brief terms list; line breaks at meaning boundaries' },
];
export const checklistText = () => CHECKLIST.map((c) => `  ${c.key} ${c.en}: ${c.ask}`).join('\n');

export interface Verdict {
  verdict: 'ready' | 'revise';
  scope: string;
  scores: Record<string, number>;
  defects: number;
  report: string;
}

// A line without markdown marks or a "Verdict:" label
const bare = (l: string) =>
  l
    .replace(/^[\s#>*_-]+/, '')
    .replace(/^(?:final\s+)?verdict\b[\s*_]*[:：—–-]?[\s*_]*/i, '')
    .trim();
// A labelled line ("scope: …", "**Scores:** …"); the value never runs into the next line
const labelled = (t: string, key: string) => new RegExp(`^[ \\t>*_#-]*${key}[ \\t*_]*[:：][ \\t*_]*(.*)$`, 'im').exec(t)?.[1]?.trim() ?? '';

// ready|revise in the first three lines, a "scope:" line, a "scores:" line like "P 8 F 7 …", then numbered problems
export function parseVerdict(text: string): Verdict {
  const t = text.trim();
  const head = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3);
  const m = head.map((l) => /^(ready|revise)\b/i.exec(bare(l).replace(/^\d+[.)、]\s*/, ''))).find(Boolean);
  if (!m) throw new Error('the review must start with ready or revise');
  const scope = labelled(t, 'scope') || 'not stated';
  const scores: Record<string, number> = {};
  const line = labelled(t, 'scores');
  for (const s of line.matchAll(/\b([PFVBDAQMT])\s*[=:]?\s*(10|[1-9])\b/g)) scores[s[1]] = Number(s[2]);
  const defects = (t.match(/^\s*\d+[.)、]\s+/gm) ?? []).length;
  return { verdict: m[1].toLowerCase() as Verdict['verdict'], scope, scores, defects, report: t };
}

// Round headers of a phase (all phases when none is given); a header without a phase is a final round
export const roundsSoFar = (slug: string, phase?: ReviewRound['phase']) =>
  (read(reviewLog(slug))?.match(/^## Round \d+.*$/gm) ?? []).filter((h) => !phase || (/^## Round \d+ · (sample|batch)\b/.exec(h)?.[1] ?? 'final') === phase).length;

export function appendRound(slug: string, v: Verdict, by: ReviewRound['by'], version: string, phase: ReviewRound['phase'], now = new Date()): ReviewRound {
  const prev = read(reviewLog(slug)) ?? '# Review log\n';
  const round = roundsSoFar(slug, phase) + 1;
  const when = now.toISOString().slice(0, 16).replace('T', ' ');
  write(reviewLog(slug), `${prev.trimEnd()}\n\n## Round ${round} · ${phase} · ${by === 'independent' ? 'independent reviewer' : 'self-review'} · ${when}\n\n${v.report.trim()}\n`);
  return { round, at: now.toISOString(), by, phase, verdict: v.verdict, scope: v.scope, scores: v.scores, defects: v.defects, version };
}

// The first numbered problems of the latest round in review/log.md
export function lastProblems(slug: string, n = 3): string[] {
  const rounds = (read(reviewLog(slug)) ?? '').split(/^## Round \d+.*$/m);
  if (rounds.length < 2) return [];
  return [...rounds[rounds.length - 1].matchAll(/^[ \t]*\d+[.)、][ \t]+(.+)$/gm)].slice(0, n).map((m) => m[1].replace(/\*\*/g, '').trim());
}

// Moves review/log.md aside (review/log-<time>.md) so a rebuild counts its rounds from 1; the new path, or null
export function archiveLog(slug: string, now = new Date()): string | null {
  if (!fs.existsSync(reviewLog(slug))) return null;
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  let to = path.join(reviewDir(slug), `log-${stamp}.md`);
  for (let n = 2; fs.existsSync(to); n++) to = path.join(reviewDir(slug), `log-${stamp}-${n}.md`);
  fs.renameSync(reviewLog(slug), to);
  return to;
}
