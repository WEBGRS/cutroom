// CLI commands of the whole-video process: flow, brief, plans, review log and the reviewer's answer; plus the shot-table notes for plan
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Format, ReviewRound, Scene, Workflow } from '../../src/lib/types';
import type { Doc, Op } from './ops';
import { STAGES, choose, contentKey, describe, isGate, isMode, isStage, moveTo, newWorkflow, phaseOf, wait } from './flow';
import { guide } from './flowguide';
import { renderPlanPreview } from './planpreview';
import { PUBLIC, readDoc } from './store';
import { LIST_FORM, MAX_ROUNDS, SAMPLE_ROUNDS, appendRound, archiveLog, briefFile, briefList, briefSeconds, checklistText, isPlanId, lastProblems, parseVerdict, planFile, readBrief, readPlans, reviewLog, roundsSoFar, writeBrief, writePlan, type Verdict } from './stagefiles';

type Save = (op: Op) => void;

export const withWorkflow = (doc: Doc, wf: Workflow, desc: string): Op => ({ doc: { ...doc, board: { ...doc.board, workflow: wf } }, desc });

export function stageFiles(slug: string): string {
  const plans = readPlans(slug).map((p) => `${p.id}:${p.md ? (p.still || p.clip ? 'plan+preview' : 'plan') : '—'}`).join(' ');
  return `brief.md ${fs.existsSync(briefFile(slug)) ? 'yes' : 'no'} · plans ${plans} · review rounds: sample ${roundsSoFar(slug, 'sample')} of ${SAMPLE_ROUNDS}, batch ${roundsSoFar(slug, 'batch')}, final ${roundsSoFar(slug, 'final')} of ${MAX_ROUNDS}`;
}

// What to do after a round: final rounds stop at MAX_ROUNDS, sample rounds at SAMPLE_ROUNDS, batch rounds never
export function afterRound(r: ReviewRound): string | null {
  if (r.phase === 'sample' && r.round >= SAMPLE_ROUNDS) return `${SAMPLE_ROUNDS} sample rounds done: stop fixing, flow wait sample (or flow stage full when there is no sample checkpoint) and list what is left in your reply`;
  return r.verdict === 'revise' && r.phase === 'final' && r.round >= MAX_ROUNDS ? `${MAX_ROUNDS} final rounds reached: stop fixing, flow stage done, and list what is left in your reply` : null;
}

// A rebuild from the brief starts a new review log
function archived(slug: string) {
  const to = archiveLog(slug);
  if (to) console.log(`review log archived to ${to}`);
}

export function flowCmd(slug: string, doc: Doc, rest: string[], save: Save) {
  const [sub, arg] = rest;
  const wf = doc.board.workflow;
  if (!sub) {
    console.log(describe(wf, contentKey(doc.board)));
    if (!wf) return;
    console.log(`files: ${stageFiles(slug)}`);
    if (wf.waiting) console.log(`The user is looking at the ${wf.waiting} checkpoint. Treat their message as feedback on it: change only what it names, then flow wait ${wf.waiting} again. Never move past it yourself.`);
    return console.log(`\n${guide(wf.stage, wf.gates)}`);
  }
  if (sub === 'start') {
    if (!isMode(arg)) throw new Error('flow start plan+sample | plan | none  (the checking mode the user chose)');
    if (wf && wf.stage !== 'done') throw new Error(`this project already has a workflow (${describe(wf)}); the user changes its mode in Properties`);
    save(withWorkflow(doc, newWorkflow(arg), `workflow ${arg}, stage brief`));
    return archived(slug);
  }
  if (!wf) throw new Error('no workflow yet: flow start plan+sample | plan | none');
  if (sub === 'stage') {
    if (!isStage(arg)) throw new Error(`flow stage <${STAGES.join('|')}>`);
    const next = moveTo(wf, arg);
    if (arg === 'done' && wf.review?.phase === 'final' && wf.review.verdict === 'revise') {
      console.log(`The last final review still says revise (${wf.review.scope}):`);
      lastProblems(slug).forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      console.log('Say in your reply that the reviewer still asks for these, and list them.');
    }
    if (arg !== 'brief') return save(withWorkflow(doc, next, `stage ${wf.stage} → ${arg}`));
    save(withWorkflow(doc, { ...next, review: undefined }, `stage ${wf.stage} → ${arg}`));
    return archived(slug);
  }
  if (sub === 'wait') {
    if (!isGate(arg)) throw new Error('flow wait plan | sample');
    save(withWorkflow(doc, wait(wf, arg), `waiting at the ${arg} checkpoint`));
    return console.log(`End your turn now with one sentence saying ${arg === 'plan' ? 'the three plans are' : 'the sample is'} in the card above; the user answers in the panel.`);
  }
  if (sub === 'choose') {
    if (!isPlanId(arg)) throw new Error('flow choose a | b | c  (the plan you took, in mode none)');
    const next = choose(wf, arg);
    if (!fs.existsSync(planFile(slug, arg))) throw new Error(`there is no plan ${arg} yet: plans write ${arg} '<markdown>' first`);
    return save(withWorkflow(doc, next, `took plan ${arg.toUpperCase()}`));
  }
  throw new Error('flow [start <mode> | stage <stage> | wait <plan|sample> | choose <a|b|c>]');
}

// Is p inside dir (case-insensitive on Windows)
const inside = (p: string, dir: string) => {
  const fold = (x: string) => (process.platform === 'win32' ? x.toLowerCase() : x);
  const real = (x: string) => {
    try {
      return fs.realpathSync.native(x);
    } catch {
      return path.resolve(x);
    }
  };
  return fold(real(p)).startsWith(fold(real(dir)) + path.sep);
};

// The text of a write: the words, - for stdin, or the path of a file in the project or temp folder
export function readText(words: string[], slug?: string): string {
  const one = words.length === 1 ? words[0].trim() : '';
  if (one === '-') {
    if (process.stdin.isTTY) return '';
    try {
      return fs.readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  }
  if (one && !/[\r\n<]/.test(one) && fs.existsSync(one) && fs.statSync(one).isFile()) {
    const ok = inside(one, os.tmpdir()) || (!!slug && inside(one, path.join(PUBLIC, slug)));
    if (!ok) throw new Error('file paths must be inside the project folder or the temp folder');
    return fs.readFileSync(one, 'utf8');
  }
  return words.join(' ');
}

// review and plans preview look like the board unless --format says otherwise
export const formatFor = (o: { format: Format; formatGiven: boolean; boardFormat?: Format }): Format => (o.formatGiven ? o.format : (o.boardFormat ?? o.format));

// review run without an independent reviewer: the AI judges the sheets itself
export const reviewFallback = (reason: string) =>
  `independent review not available: ${reason}\nSelf-review instead: open both sheets above and judge them as a critic, item by item against this checklist:\n${checklistText()}\nThen save it with review log '<report>' (first line ready or revise, then scope:, scores: P 8 F 7 …, numbered problems with scene id, time, problem, fix).`;

export function briefCmd(slug: string, rest: string[]) {
  const [sub, ...words] = rest;
  if (!sub) return console.log(readBrief(slug) ?? "no brief yet: brief write '<text>'");
  if (sub !== 'write') throw new Error("brief | brief write '<text>' | brief write - (stdin) | brief write <file>");
  const text = readText(words, slug).trim();
  if (!text) throw new Error("brief write '<text>' (or - to read stdin, or a file path): the text is empty");
  const gaps = writeBrief(slug, text);
  console.log(`saved ${briefFile(slug)}`);
  const lists = gaps.filter((g) => g.endsWith(': list')).map((g) => LIST_FORM(g.slice(0, -': list'.length)));
  console.log(gaps.length ? `missing: ${gaps.join(', ')}; add them and write it again${lists.length ? `. Write each list as ${lists.join('; ')}` : ''}` : 'nothing missing');
}

export async function plansCmd(slug: string, rest: string[], opts: { at?: string; motion?: string; format: Format; formatGiven: boolean; boardFormat?: Format }) {
  const [sub, id, ...words] = rest;
  if (!sub) {
    for (const p of readPlans(slug)) console.log(p.md ? `${p.id}: ${p.title} — ${p.line}${p.still || p.clip ? '' : '  (no preview yet)'}` : `${p.id}: —`);
    return;
  }
  if (sub === 'write') {
    if (!isPlanId(id)) throw new Error("plans write <a|b|c> '<markdown>'  (or - to read stdin, or a file path)");
    const md = readText(words, slug).trim();
    if (!md) throw new Error('the plan is empty');
    writePlan(slug, id, md);
    return console.log(`saved ${planFile(slug, id)}`);
  }
  if (sub === 'preview') {
    if (!isPlanId(id)) throw new Error("plans preview <a|b|c> '<scene json>' [--at <seconds>] [--motion <seconds>]");
    let scene: Scene;
    try {
      scene = JSON.parse(words.join(' '));
    } catch {
      throw new Error(`the scene is JSON, e.g. '{"visual":{"kind":"html","src":"scenes/plan-${id}/index.html"}}'`);
    }
    if (!scene?.visual?.kind) throw new Error('the scene needs a visual with a kind (html, title, image, screen, …)');
    const at = opts.at === undefined ? 2 : Number(opts.at);
    const motion = opts.motion === undefined ? undefined : Number(opts.motion);
    if (!Number.isFinite(at) || at < 0) throw new Error('--at is seconds into the shot, e.g. --at 2');
    if (motion !== undefined && !(motion >= 1 && motion <= 6)) throw new Error('--motion is the clip length in seconds, 1–6');
    const format = formatFor(opts);
    console.log(`rendering plan ${id}'s key shot at ${at} s (${format})…`);
    const r = await renderPlanPreview({ slug, id, scene: { ...scene, lines: scene.lines ?? [] }, at, motion, format, log: (s) => console.log(s) });
    console.log(`image: ${path.resolve(r.file)}  (plan ${id})`);
    console.log(`saved ${r.still}${r.clip ? ` and ${r.clip}` : ''}; open the image and fix what is off before showing it`);
    return;
  }
  throw new Error("plans | plans write <a|b|c> '<markdown>' (or - for stdin, or a file) | plans preview <a|b|c> '<scene json>' [--at <s>] [--motion <s>]");
}

export function reviewLogCmd(slug: string, doc: Doc, text: string, save: Save) {
  if (!text.trim()) throw new Error("review log '<report>': first line ready or revise, then scope:, scores:, and numbered problems");
  const v = parseVerdict(text);
  const r = appendRound(slug, v, 'self', contentKey(doc.board), phaseOf(doc.board.workflow));
  if (doc.board.workflow) save(withWorkflow(doc, { ...doc.board.workflow, review: r }, `review ${r.phase} round ${r.round}`));
  console.log(`${r.phase} round ${r.round} (self-review): ${r.verdict}, ${r.defects} problem${r.defects === 1 ? '' : 's'} → ${reviewLog(slug)}`);
  const next = afterRound(r);
  if (next) console.log(next);
}

// The independent reviewer's answer: saved as a round, or shown with what to do when it has no verdict
export function saveReview(slug: string, text: string, version: string, save: Save): ReviewRound | null {
  let v: Verdict;
  try {
    v = parseVerdict(text);
  } catch {
    console.log(`${text.trim()}\n\nThe reviewer's answer above has no ready or revise in its first lines, so it was not saved. Put its verdict (ready or revise) on the first line and save it with review log '<report>'.`);
    return null;
  }
  const fresh = readDoc(slug).doc;
  const round = appendRound(slug, v, 'independent', version, phaseOf(fresh.board.workflow));
  if (fresh.board.workflow) save(withWorkflow(fresh, { ...fresh.board.workflow, review: round }, `review ${round.phase} round ${round.round}`));
  console.log(`\n${v.report}\n\n${round.phase} round ${round.round} (independent): ${v.verdict}, ${v.defects} problem${v.defects === 1 ? '' : 's'} → ${reviewLog(slug)}`);
  const next = afterRound(round);
  if (next) console.log(next);
  return round;
}

// Words of a feature, lower case; runs of CJK characters count as one word
const words = (s: string) => (s.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []).filter((w) => w.length >= 2 || /\p{Script=Han}/u.test(w));

// Must-show features that no scene mentions in its lines, shot or intent
export function featureGaps(features: string[], scenes: Scene[]): string[] {
  const hay = scenes.map((s) => [s.shot, s.intent, ...s.lines.flatMap((l) => [l.zh, l.en])].filter(Boolean).join(' ').toLowerCase());
  return features.filter((f) => {
    const ws = words(f);
    return ws.length > 0 && !hay.some((h) => ws.every((w) => h.includes(w)));
  });
}

// A note when the cut is more than 10% off the length the brief asks for
export function lengthNote(total: number, brief: string | null): string | null {
  const want = brief ? briefSeconds(brief) : null;
  return want && Math.abs(total - want) > want * 0.1 ? `! the cut is ${total.toFixed(1)} s, the brief asks for ${want} s: trim or merge scenes` : null;
}

// Shot-table problems for plan, only in workflow projects
export function tableNotes(doc: Doc, slug: string): string[] {
  if (!doc.board.workflow) return [];
  const notes = doc.board.scenes.filter((s) => !s.role || !s.intent?.trim()).map((s) => `! ${s.id}: no role or intent (set ${s.id} role a|b; set ${s.id} intent "<the one conclusion the viewer takes>")`);
  const brief = readBrief(slug);
  if (brief) for (const f of featureGaps(briefList(brief, 'features'), doc.board.scenes)) notes.push(`! must-show feature without a scene: ${f}`);
  return notes;
}
