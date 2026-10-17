// CLI commands of the whole-video process: flow, brief, plans, review log and the reviewer's answer; plus the shot-table notes for plan
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Format, ReviewRound, Scene, Tier, Workflow } from '../../src/lib/types';
import type { Doc, Op } from './ops';
import { STAGES, TIERS, choose, contentKey, describe, isGate, isMode, isStage, isTier, moveTo, newWorkflow, phaseOf, rulesOf, tierOf, wait } from './flow';
import { HARD_FAILURES, guide } from './flowguide';
import { renderPlanPreview } from './planpreview';
import { PUBLIC, STATE, readDoc } from './store';
import { LIST_FORM, appendRound, archiveLog, briefFile, briefList, briefSeconds, checklistText, isPlanId, lastProblems, parseVerdict, planFile, readBrief, readPlans, reviewLog, roundsSoFar, writeBrief, writePlan, type Verdict } from './stagefiles';

type Save = (op: Op) => void;

export const withWorkflow = (doc: Doc, wf: Workflow, desc: string): Op => ({ doc: { ...doc, board: { ...doc.board, workflow: wf } }, desc });

export function stageFiles(slug: string, wf?: Workflow): string {
  const t = rulesOf(wf);
  const plans = readPlans(slug)
    .slice(0, t.plans)
    .map((p) => `${p.id}:${p.md ? (p.still || p.clip ? 'plan+preview' : 'plan') : '—'}`)
    .join(' ');
  const sample = t.sample ? `sample ${roundsSoFar(slug, 'sample')} of ${t.sample.rounds}, ` : '';
  return `brief.md ${fs.existsSync(briefFile(slug)) ? 'yes' : 'no'} · plans ${plans} · review rounds: ${sample}batch ${roundsSoFar(slug, 'batch')}, final ${roundsSoFar(slug, 'final')} of ${t.final.rounds}`;
}

// What to do after a round: sample and final rounds stop at the tier's limit, batch rounds never
export function afterRound(r: ReviewRound, tier: Tier = 1): string | null {
  const t = TIERS[tier];
  if (r.phase === 'sample') {
    const cap = t.sample?.rounds ?? 0;
    if (!cap || r.round < cap) return null;
    return t.sample?.fix
      ? `tier ${tier} reviews the sample once: fix what it lists at the smallest slice, look lines those scenes, then flow wait sample (or flow stage full when there is no sample checkpoint); no second review run`
      : `${cap} sample rounds done: stop fixing, flow wait sample (or flow stage full when there is no sample checkpoint) and list what is left in your reply`;
  }
  if (r.phase !== 'final' || r.round < t.final.rounds || r.verdict !== 'revise') return null;
  if (t.final.fix === 'all') return `tier ${tier} has one final review: fix what it lists at the smallest slice (list the ones that need a new recording instead), check, then flow stage done and name what you left; no second review run`;
  if (t.final.fix === 'hard') return 'fix only these hard failures at the smallest slice, check, then flow stage done; no second round';
  return `${t.final.rounds} final rounds reached: stop fixing, flow stage done, and list what is left in your reply`;
}

// Why a review round may not be added now (null = go ahead); by = who would review
export function roundRefusal(slug: string, wf: Workflow | undefined, by: ReviewRound['by']): string | null {
  // Finished projects and the user's feedback at a checkpoint are not limited
  if (!wf || wf.stage === 'done' || wf.waiting) return null;
  const t = rulesOf(wf);
  const tier = tierOf(wf);
  const phase = phaseOf(wf);
  if (phase === 'batch') return by === 'independent' && t.batches !== 'sheets' ? `tier ${tier} runs no reviewer during ${wf.stage}: check with look lines <ids> and check` : null;
  if (phase === 'sample') {
    if (!t.sample) return `tier ${tier} has no sample stage: flow stage full`;
    if (!t.sample.rounds) return `tier ${tier} checks the sample without a reviewer: look lines <ids> and check, then ${wf.gates === 'plan+sample' ? 'flow wait sample' : 'flow stage full'}`;
    return roundsSoFar(slug, 'sample') >= t.sample.rounds ? `the sample already had ${t.sample.rounds} review round${t.sample.rounds === 1 ? '' : 's'}, the limit at tier ${tier}: ${wf.gates === 'plan+sample' ? 'flow wait sample' : 'flow stage full'} and list what is left` : null;
  }
  if (by === 'independent' && t.final.by === 'self') return null;
  return roundsSoFar(slug, 'final') >= t.final.rounds ? `${t.final.rounds} final round${t.final.rounds === 1 ? '' : 's'} done, the limit at tier ${tier}: flow stage done and list what is left in your reply` : null;
}

// Counts a look render against the tier's budget for the stage; throws when it is used up, else returns [used, max] (null = no budget)
export function countLook(slug: string, wf: Workflow | undefined): [number, number] | null {
  const max = rulesOf(wf).looks;
  if (!wf || !max || wf.waiting || wf.stage === 'done') return null;
  const f = path.join(STATE, slug, 'looks.json');
  let n = 0;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (j.stage === wf.stage) n = Number(j.n) || 0;
  } catch {
    // no count yet
  }
  if (n >= max) throw new Error(`tier ${tierOf(wf)} allows ${max} look renders per stage and ${wf.stage} has used them: stop tuning, finish the stage with what you have, and name in your reply what you could not check`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ stage: wf.stage, n: n + 1 }));
  return [n + 1, max];
}

// The minimal tier's final check, done by the AI itself on the sheets it just rendered
export const selfCheck = (tier: Tier) =>
  `tier ${tier} checks the cut itself, hard failures only: open the contact sheet above (not the phone sheet) and look for ${HARD_FAILURES}. Save it with review log '<report>' (first line ready or revise, a scope: line, then numbered problems with scene id, time, problem, fix), then fix only those.`;

// A rebuild from the brief starts a new review log
function archived(slug: string) {
  const to = archiveLog(slug);
  if (to) console.log(`review log archived to ${to}`);
}

export function flowCmd(slug: string, doc: Doc, rest: string[], save: Save) {
  const [sub, arg, arg2] = rest;
  const wf = doc.board.workflow;
  if (!sub) {
    console.log(describe(wf, contentKey(doc.board)));
    if (!wf) return;
    console.log(`files: ${stageFiles(slug, wf)}`);
    if (wf.waiting) console.log(`The user is looking at the ${wf.waiting} checkpoint. Treat their message as feedback on it: change only what it names, then flow wait ${wf.waiting} again. Never move past it yourself.`);
    return console.log(`\n${guide(wf.stage, wf.gates, tierOf(wf))}`);
  }
  if (sub === 'start') {
    const tier = arg2 === undefined ? 1 : Number(arg2);
    if (!isMode(arg) || !isTier(tier)) throw new Error('flow start plan+sample | plan | none [1-5]  (the checking mode and tier the user chose; tier 1 = every check … 5 = fewest tokens, default 1)');
    if (wf && wf.stage !== 'done') throw new Error(`this project already has a workflow (${describe(wf)}); the user changes its mode and tier in Properties`);
    const next = newWorkflow(arg, tier);
    save(withWorkflow(doc, next, `workflow ${next.gates}, tier ${tier}, stage brief`));
    if (next.gates !== arg) console.log(`tier ${tier} has no sample, so the mode is ${next.gates}`);
    return archived(slug);
  }
  if (!wf) throw new Error('no workflow yet: flow start plan+sample | plan | none');
  if (sub === 'stage') {
    if (!isStage(arg)) throw new Error(`flow stage <${STAGES.join('|')}>`);
    const next = moveTo(wf, arg);
    if (arg === 'done' && wf.review?.phase === 'final' && wf.review.verdict === 'revise') {
      const fixed = rulesOf(wf).final.fix !== 'none';
      console.log(fixed ? `The final review listed these (${wf.review.scope}):` : `The last final review still says revise (${wf.review.scope}):`);
      lastProblems(slug).forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      console.log(`The panel shows the verdict and these problems under your reply: don't repeat them.${fixed ? ' Name in one sentence the ones you fixed after the review.' : ''}`);
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

export function briefCmd(slug: string, rest: string[], wf?: Workflow) {
  const [sub, ...words] = rest;
  if (!sub) return console.log(readBrief(slug) ?? "no brief yet: brief write '<text>'");
  if (sub !== 'write') throw new Error("brief | brief write '<text>' | brief write - (stdin) | brief write <file>");
  const text = readText(words, slug).trim();
  if (!text) throw new Error("brief write '<text>' (or - to read stdin, or a file path): the text is empty");
  const gaps = writeBrief(slug, text, rulesOf(wf).brief === 'short');
  console.log(`saved ${briefFile(slug)}`);
  const lists = gaps.filter((g) => g.endsWith(': list')).map((g) => LIST_FORM(g.slice(0, -': list'.length)));
  console.log(gaps.length ? `missing: ${gaps.join(', ')}; add them and write it again${lists.length ? `. Write each list as ${lists.join('; ')}` : ''}` : 'nothing missing');
}

export async function plansCmd(slug: string, rest: string[], opts: { at?: string; motion?: string; format: Format; formatGiven: boolean; boardFormat?: Format; wf?: Workflow }) {
  const [sub, id, ...words] = rest;
  const t = rulesOf(opts.wf);
  const tier = tierOf(opts.wf);
  if (!sub) {
    for (const p of readPlans(slug).slice(0, t.plans)) console.log(p.md ? `${p.id}: ${p.title} — ${p.line}${p.still || p.clip || t.preview === 'none' ? '' : '  (no preview yet)'}` : `${p.id}: —`);
    return;
  }
  if (t.plans === 1 && isPlanId(id) && id !== 'a') throw new Error(`tier ${tier} makes one plan: plans write a`);
  if (sub === 'write') {
    if (!isPlanId(id)) throw new Error("plans write <a|b|c> '<markdown>'  (or - to read stdin, or a file path)");
    const md = readText(words, slug).trim();
    if (!md) throw new Error('the plan is empty');
    writePlan(slug, id, md);
    return console.log(`saved ${planFile(slug, id)}`);
  }
  if (sub === 'preview') {
    if (t.preview === 'none') throw new Error(`tier ${tier} plans are text only: no previews`);
    if (t.preview === 'still' && opts.motion !== undefined) throw new Error(`tier ${tier} previews are stills: leave out --motion`);
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
  const why = roundRefusal(slug, doc.board.workflow, 'self');
  if (why) throw new Error(why);
  const v = parseVerdict(text);
  const r = appendRound(slug, v, 'self', contentKey(doc.board), phaseOf(doc.board.workflow));
  if (doc.board.workflow) save(withWorkflow(doc, { ...doc.board.workflow, review: r }, `review ${r.phase} round ${r.round}`));
  console.log(`${r.phase} round ${r.round} (self-review): ${r.verdict}, ${r.defects} problem${r.defects === 1 ? '' : 's'} → ${reviewLog(slug)}`);
  const next = afterRound(r, tierOf(doc.board.workflow));
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
  const next = afterRound(round, tierOf(fresh.board.workflow));
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
