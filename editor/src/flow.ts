// Stages of making a whole video and the user's checkpoints between them
import type { Gate, Gates, ReviewRound, Stage, Storyboard, Workflow } from '../../src/lib/types';

export const STAGES: Stage[] = ['brief', 'plans', 'script', 'table', 'sample', 'full', 'sound', 'review', 'done'];
export const MODES: Gates[] = ['plan+sample', 'plan', 'none'];
// The stage each checkpoint closes
export const GATE_STAGE: Record<Gate, Stage> = { plan: 'plans', sample: 'sample' };

export const STAGE_LABEL: Record<Stage, [string, string]> = {
  brief: ['Brief', '简报'],
  plans: ['Three plans', '三个方案'],
  script: ['Script and voice', '稿子和配音'],
  table: ['Shot table', '镜头表'],
  sample: ['Sample', '样片'],
  full: ['Full cut', '全片'],
  sound: ['Sound', '声音'],
  review: ['Review', '审片'],
  done: ['Done', '完成'],
};

export const MODE_OPTIONS: { id: Gates; en: string; zh: string; hintEn: string; hintZh: string }[] = [
  { id: 'plan+sample', en: 'Check the plan and a sample', zh: '确认方案和样片', hintEn: 'Three plans first, then the first finished passage; the AI waits for you both times', hintZh: '先给三个方案，再做出一段成品，两次都等你点头' },
  { id: 'plan', en: 'Check the plan only', zh: '只确认方案', hintEn: 'You pick one of three plans; the AI then makes the whole video', hintZh: '你从三个方案里挑一个，之后一口气做完' },
  { id: 'none', en: 'No stops', zh: '全自动', hintEn: 'The AI picks a plan and finishes; plans and review notes stay in the project', hintZh: 'AI 自己挑方案做完，方案和审片记录留在项目里' },
];

export const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);
export const isMode = (s: unknown): s is Gates => MODES.includes(s as Gates);
export const isGate = (s: unknown): s is Gate => s === 'plan' || s === 'sample';
const at = (s: Stage) => STAGES.indexOf(s);

export const gatesFor = (mode: Gates): Gate[] => (mode === 'plan+sample' ? ['plan', 'sample'] : mode === 'plan' ? ['plan'] : []);

export function newWorkflow(gates: Gates, now = new Date()): Workflow {
  return { gates, stage: 'brief', passed: [], startedAt: now.toISOString() };
}

// Why the project can't move to a stage, or null
export function blocked(wf: Workflow, to: Stage): string | null {
  for (const g of gatesFor(wf.gates))
    if (at(to) > at(GATE_STAGE[g]) && !(wf.passed ?? []).includes(g))
      return `the ${g} checkpoint is not passed yet: finish ${GATE_STAGE[g]}, run flow wait ${g} and end your turn; the user passes it in the panel`;
  return null;
}

export function moveTo(wf: Workflow, to: Stage): Workflow {
  const why = blocked(wf, to);
  if (why) throw new Error(why);
  // Going back reopens the checkpoints at or after that stage
  const passed = (wf.passed ?? []).filter((g) => at(GATE_STAGE[g]) < at(to));
  return { ...wf, stage: to, waiting: undefined, passed };
}

export function wait(wf: Workflow, gate: Gate): Workflow {
  if (!gatesFor(wf.gates).includes(gate)) throw new Error(`this project has no ${gate} checkpoint (mode ${wf.gates}): carry on with the next stage`);
  if (wf.stage !== GATE_STAGE[gate]) throw new Error(`the ${gate} checkpoint closes the ${GATE_STAGE[gate]} stage; the project is at ${wf.stage}`);
  return { ...wf, waiting: gate };
}

// Only the panel's button reaches this (server route /api/flow/pass)
export function pass(wf: Workflow, gate: Gate, choice?: string): Workflow {
  if (wf.waiting !== gate) throw new Error(`nothing is waiting at the ${gate} checkpoint`);
  return { ...wf, waiting: undefined, passed: [...new Set([...(wf.passed ?? []), gate])], stage: STAGES[at(GATE_STAGE[gate]) + 1], ...(choice ? { choice } : {}) };
}

// No plan checkpoint (mode none): the AI records the plan it took
export function choose(wf: Workflow, id: string): Workflow {
  if (gatesFor(wf.gates).includes('plan')) throw new Error(`the user picks the plan in the panel (mode ${wf.gates} has a plan checkpoint): flow wait plan and end your turn`);
  return { ...wf, choice: id };
}

// The user changed the mode: a wait for a checkpoint that no longer applies ends; checkpoints whose stage is already behind the project count as passed
export function setMode(wf: Workflow, gates: Gates): Workflow {
  const behind = gatesFor(gates).filter((g) => at(GATE_STAGE[g]) < at(wf.stage));
  const passed = [...new Set([...(wf.passed ?? []), ...behind])];
  return { ...wf, gates, passed, waiting: wf.waiting && gatesFor(gates).includes(wf.waiting) ? wf.waiting : undefined };
}

// The line a workflow run ends with when a turn or time limit cut it off ([en, zh]); null without a workflow in progress
export function pausedLine(wf: Workflow | undefined): [string, string] | null {
  if (!wf || wf.stage === 'done') return null;
  const [en, zh] = STAGE_LABEL[wf.stage];
  return [`Paused at stage ${en}: send “continue” to go on.`, `停在「${zh}」阶段：发「继续」接着做。`];
}

// A review at the sample stage looks at the sample, at the review stage at the whole cut; any other stage is a batch check
export const phaseOf = (wf: Workflow | undefined): ReviewRound['phase'] => (!wf || wf.stage === 'review' ? 'final' : wf.stage === 'sample' ? 'sample' : 'batch');

// Fingerprint of everything but the workflow, so saving a review doesn't make it stale (FNV-1a)
export function contentKey(board: Storyboard): string {
  const { workflow: _w, ...rest } = board;
  const s = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function describe(wf: Workflow | undefined, key?: string): string {
  if (!wf) return 'no workflow: edits only. A whole new video starts with flow start plan+sample|plan|none (the mode the user chose)';
  const parts = [`mode ${wf.gates}`, `stage ${wf.stage} (${at(wf.stage) + 1}/${STAGES.length})`];
  if (wf.waiting) parts.push(`WAITING: the user is looking at the ${wf.waiting} checkpoint; their next message is feedback on it`);
  const gs = gatesFor(wf.gates);
  if (gs.length) parts.push(`checkpoints ${gs.map((g) => `${g}${(wf.passed ?? []).includes(g) ? ' passed' : ''}`).join(', ')}`);
  if (wf.choice) parts.push(`plan ${wf.choice.toUpperCase()} chosen`);
  if (wf.review) parts.push(`last review: ${wf.review.phase ?? 'final'} round ${wf.review.round} ${wf.review.verdict} (${wf.review.by})${key && wf.review.version !== key ? ', OUT OF DATE (the video changed since)' : ''}`);
  return parts.join(' · ');
}
