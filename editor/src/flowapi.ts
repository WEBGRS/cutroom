// What the panel shows at a checkpoint, and what its buttons do
import fs from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import type { Gate, Workflow } from '../../src/lib/types';
import { boardFile, readDoc, writeDoc } from './store';
import { L } from './settings';
import { contentKey, pass, rulesOf } from './flow';
import { isPlanId, lastProblems, planClip, planStill, readPlans, reviewDir, type PlanId } from './stagefiles';

export interface FlowView {
  workflow: Workflow | null;
  key: string;
  plans: { id: PlanId; title: string; line: string; md: string | null; image: string | null; clip: string | null }[];
  sheet: string | null;
  // The latest round's first problems, for the sample card
  problems: string[];
}

const url = (slug: string, file: string) => (fs.existsSync(file) ? `/${slug}/${path.relative(path.join(file, '..', '..'), file).replace(/\\/g, '/')}?v=${Math.round(fs.statSync(file).mtimeMs)}` : null);

// An existing project, or an error in the app's language
export function checkProject(slug: unknown): asserts slug is string {
  if (typeof slug !== 'string' || !/^[-\w]+$/.test(slug) || !fs.existsSync(boardFile(slug))) throw new Error(L(`No project ${String(slug)}`, `没有项目 ${String(slug)}`));
}

function docOf(slug: string) {
  checkProject(slug);
  return readDoc(slug);
}

// Requests from the editor's own page (or without a browser): a browser marks other sites' requests in Sec-Fetch-Site
export function fromPage(h: IncomingHttpHeaders): boolean {
  const site = h['sec-fetch-site'];
  return !site || site === 'same-origin';
}

export function flowView(slug: string): FlowView {
  const { board } = docOf(slug).doc;
  const sheet = path.join(reviewDir(slug), 'latest-sheet.jpeg');
  return {
    workflow: board.workflow ?? null,
    key: contentKey(board),
    plans: readPlans(slug).map((p) => ({ id: p.id, title: p.title, line: p.line, md: p.md, image: url(slug, planStill(slug, p.id)), clip: url(slug, planClip(slug, p.id)) })),
    sheet: url(slug, sheet),
    problems: lastProblems(slug),
  };
}

export function gateMessage(gate: Gate, choice: string | undefined, lang: 'zh' | 'en'): string {
  if (gate === 'plan') return lang === 'zh' ? `我选方案 ${choice!.toUpperCase()}，按它继续做。` : `I'll take plan ${choice!.toUpperCase()}. Carry on with it.`;
  return lang === 'zh' ? '样片通过，继续做全片。' : 'The sample is approved. Go on with the full video.';
}

// The panel's button: pass the checkpoint, then the panel sends the returned message
export function passGate(slug: string, gate: Gate, choice: string | undefined, lang: 'zh' | 'en'): string {
  if (gate === 'plan' && !isPlanId(choice)) throw new Error(L('choose a plan: a, b or c', '选一个方案：A、B 或 C'));
  const { doc, version } = docOf(slug);
  if (!doc.board.workflow) throw new Error(L('this project has no whole-video workflow', '这个项目没有整片流程'));
  if (doc.board.workflow.waiting !== gate) throw new Error(L(`nothing is waiting at the ${gate} checkpoint`, `没有在等${gate === 'plan' ? '方案' : '样片'}确认`));
  if (gate === 'plan' && choice !== 'a' && rulesOf(doc.board.workflow).plans === 1) throw new Error(L('this tier makes one plan: plan A', '这一档只有方案 A'));
  const wf = pass(doc.board.workflow, gate, gate === 'plan' ? choice : undefined);
  writeDoc(slug, { ...doc, board: { ...doc.board, workflow: wf } }, 'ui', [`passed the ${gate} checkpoint${choice ? ` (plan ${choice})` : ''}`], version);
  return gateMessage(gate, choice, lang);
}
