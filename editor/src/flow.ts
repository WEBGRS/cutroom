// Stages of making a whole video and the user's checkpoints between them
import type { Gate, Gates, ReviewRound, Stage, Storyboard, Tier, Workflow } from '../../src/lib/types';

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
  { id: 'plan+sample', en: 'Check the plan and a sample', zh: '确认方案和样片', hintEn: 'Plans first, then the first finished passage; the AI waits for you both times', hintZh: '先给方案，再做出一段成品，两次都等你点头' },
  { id: 'plan', en: 'Check the plan only', zh: '只确认方案', hintEn: 'You pick the plan; the AI then makes the whole video', hintZh: '你定下方案，之后一口气做完' },
  { id: 'none', en: 'No stops', zh: '全自动', hintEn: 'The AI picks a plan and finishes; plans and review notes stay in the project', hintZh: 'AI 自己挑方案做完，方案和审片记录留在项目里' },
];

// What each tier spends tokens on; rounds = independent reviewer runs allowed, fix = what happens after the last one
export interface TierRule {
  plans: 1 | 3;
  preview: 'motion' | 'still' | 'none';
  brief: 'full' | 'short';
  sample: { rounds: number; fix: boolean } | null;
  batches: 'sheets' | 'lines' | 'none';
  // look frames joined into contact sheets: 0 = one image per frame, 2 = 2×2 (half size), 3 = 3×3
  lookSheet: 0 | 2 | 3;
  // look renders allowed per stage (null = no limit)
  looks: number | null;
  final: { rounds: number; by: 'independent' | 'self'; fix: 'none' | 'all' | 'hard' };
}
export const TIER_IDS: Tier[] = [1, 2, 3, 4, 5];
export const TIERS: Record<Tier, TierRule> = {
  1: { plans: 3, preview: 'motion', brief: 'full', sample: { rounds: 2, fix: false }, batches: 'sheets', lookSheet: 0, looks: null, final: { rounds: 3, by: 'independent', fix: 'none' } },
  2: { plans: 3, preview: 'still', brief: 'full', sample: { rounds: 1, fix: true }, batches: 'lines', lookSheet: 2, looks: 10, final: { rounds: 2, by: 'independent', fix: 'none' } },
  3: { plans: 3, preview: 'none', brief: 'full', sample: { rounds: 0, fix: false }, batches: 'none', lookSheet: 3, looks: 6, final: { rounds: 2, by: 'independent', fix: 'none' } },
  4: { plans: 1, preview: 'none', brief: 'short', sample: null, batches: 'none', lookSheet: 3, looks: 5, final: { rounds: 1, by: 'independent', fix: 'all' } },
  5: { plans: 1, preview: 'none', brief: 'short', sample: null, batches: 'none', lookSheet: 3, looks: 4, final: { rounds: 1, by: 'self', fix: 'hard' } },
};
export const TIER_OPTIONS: Record<Tier, { en: string; zh: string; hintEn: string; hintZh: string }> = {
  1: { en: 'Full', zh: '完整', hintEn: 'Three plans with previews, the sample reviewed twice, review sheets after every batch, up to three final reviews', hintZh: '三个方案都出预览，样片审两轮，每批都出审片图，终审最多三轮' },
  2: { en: 'Careful', zh: '细致', hintEn: 'Three plans with a still each, one sample review, batches checked line by line, up to two final reviews', hintZh: '三个方案出静态预览，样片审一轮，分批逐句核对，终审最多两轮' },
  3: { en: 'Standard', zh: '标准', hintEn: 'Three plans as text, the sample checked without a reviewer, the rest in one pass, up to two final reviews', hintZh: '三个方案只写文字，样片不请审片，其余一次做完，终审最多两轮' },
  4: { en: 'Lean', zh: '精简', hintEn: 'One plan, no sample, a short brief, one final review whose notes get fixed', hintZh: '只出一个方案，不做样片，简报精简，终审一轮、按意见改完' },
  5: { en: 'Minimal', zh: '最省', hintEn: 'One plan, no sample; the AI checks only hard failures itself (data shown, a feature missing, unreadable captions)', hintZh: '一个方案，不做样片，AI 自己只查硬伤（露数据、漏功能、字幕看不清）' },
};

export const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);
export const isMode = (s: unknown): s is Gates => MODES.includes(s as Gates);
export const isGate = (s: unknown): s is Gate => s === 'plan' || s === 'sample';
export const isTier = (s: unknown): s is Tier => TIER_IDS.includes(s as Tier);
const at = (s: Stage) => STAGES.indexOf(s);

export const tierOf = (wf: Workflow | undefined | null): Tier => (wf && isTier(wf.tier) ? wf.tier : 1);
export const rulesOf = (wf: Workflow | undefined | null): TierRule => TIERS[tierOf(wf)];
// The stages a tier goes through (tiers without a sample skip it)
export const stagesFor = (tier: Tier): Stage[] => STAGES.filter((s) => s !== 'sample' || TIERS[tier].sample);
export const stageLabel = (stage: Stage, tier: Tier = 1): [string, string] => (stage === 'plans' && TIERS[tier].plans === 1 ? ['Plan', '方案'] : STAGE_LABEL[stage]);
// The plan the build follows: the one taken, or plan a when the tier makes only one
export const planOf = (wf: Workflow | undefined | null): string | undefined => wf?.choice ?? (wf && rulesOf(wf).plans === 1 ? 'a' : undefined);

export const gatesFor = (mode: Gates, tier: Tier = 1): Gate[] => (mode === 'plan+sample' ? (TIERS[tier].sample ? ['plan', 'sample'] : ['plan']) : mode === 'plan' ? ['plan'] : []);
const gatesOf = (wf: Workflow) => gatesFor(wf.gates, tierOf(wf));

export function newWorkflow(gates: Gates, tier: Tier = 1, now = new Date()): Workflow {
  return { gates: TIERS[tier].sample || gates !== 'plan+sample' ? gates : 'plan', ...(tier !== 1 ? { tier } : {}), stage: 'brief', passed: [], startedAt: now.toISOString() };
}

// Why the project can't move to a stage, or null
export function blocked(wf: Workflow, to: Stage): string | null {
  const tier = tierOf(wf);
  if (!stagesFor(tier).includes(to)) return `tier ${tier} has no ${to} stage: after table comes full`;
  for (const g of gatesOf(wf))
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
  if (!gatesOf(wf).includes(gate)) throw new Error(`this project has no ${gate} checkpoint (mode ${wf.gates}, tier ${tierOf(wf)}): carry on with the next stage`);
  if (wf.stage !== GATE_STAGE[gate]) throw new Error(`the ${gate} checkpoint closes the ${GATE_STAGE[gate]} stage; the project is at ${wf.stage}`);
  return { ...wf, waiting: gate };
}

// Only the panel's button reaches this (server route /api/flow/pass)
export function pass(wf: Workflow, gate: Gate, choice?: string): Workflow {
  if (wf.waiting !== gate) throw new Error(`nothing is waiting at the ${gate} checkpoint`);
  const stages = stagesFor(tierOf(wf));
  return { ...wf, waiting: undefined, passed: [...new Set([...(wf.passed ?? []), gate])], stage: stages[stages.indexOf(GATE_STAGE[gate]) + 1], ...(choice ? { choice } : {}) };
}

// No plan checkpoint (mode none): the AI records the plan it took
export function choose(wf: Workflow, id: string): Workflow {
  if (gatesOf(wf).includes('plan')) throw new Error(`the user picks the plan in the panel (mode ${wf.gates} has a plan checkpoint): flow wait plan and end your turn`);
  if (rulesOf(wf).plans === 1 && id !== 'a') throw new Error(`tier ${tierOf(wf)} makes one plan, plan a`);
  return { ...wf, choice: id };
}

// The user changed the mode: a wait for a checkpoint that no longer applies ends; checkpoints whose stage is already behind the project count as passed
export function setMode(wf: Workflow, gates: Gates): Workflow {
  const gs = gatesFor(gates, tierOf(wf));
  const behind = gs.filter((g) => at(GATE_STAGE[g]) < at(wf.stage));
  const passed = [...new Set([...(wf.passed ?? []), ...behind])];
  return { ...wf, gates: gates === 'plan+sample' && !gs.includes('sample') ? 'plan' : gates, passed, waiting: wf.waiting && gs.includes(wf.waiting) ? wf.waiting : undefined };
}

// The user changed the tier; a tier without a sample has no sample checkpoint
export function setTier(wf: Workflow, tier: Tier): Workflow {
  const { tier: _t, ...rest } = wf;
  return setMode(tier === 1 ? rest : { ...rest, tier }, wf.gates);
}

// The line a workflow run ends with when a turn or time limit cut it off ([en, zh]); null without a workflow in progress
export function pausedLine(wf: Workflow | undefined): [string, string] | null {
  if (!wf || wf.stage === 'done') return null;
  const [en, zh] = stageLabel(wf.stage, tierOf(wf));
  return [`Paused at stage ${en}: send “continue” to go on.`, `停在「${zh}」阶段：发「继续」接着做。`];
}

// The panel's line under the reply when a build ends with the final review still saying revise ([en, zh]); null otherwise
export function finalNote(wf: Workflow | undefined, problems: string[]): [string, string] | null {
  const r = wf?.review;
  if (!wf || wf.stage !== 'done' || !r || r.phase !== 'final' || r.verdict !== 'revise') return null;
  const fixed = TIERS[tierOf(wf)].final.fix !== 'none';
  const list = problems.map((p, i) => `${i + 1}) ${p}`).join(' ');
  return [
    `Review: round ${r.round} (${r.by === 'self' ? 'self-check' : 'independent reviewer'}) said revise${fixed ? '; its notes were fixed once and not reviewed again' : ''}.${list ? ` It listed: ${list}` : ''}`,
    `审片结论：第 ${r.round} 轮${r.by === 'self' ? '自查' : '独立审片'}判定需要修改${fixed ? '，已按意见改过一遍，没有复审' : ''}。${list ? `列出的问题：${list}` : ''}`,
  ];
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
  if (!wf) return 'no workflow: edits only. A whole new video starts with flow start plan+sample|plan|none [tier 1-5] (the mode and tier the user chose)';
  const tier = tierOf(wf);
  const stages = stagesFor(tier);
  const parts = [`mode ${wf.gates}`, `tier ${tier} ${TIER_OPTIONS[tier].en.toLowerCase()}`, `stage ${wf.stage} (${stages.indexOf(wf.stage) + 1}/${stages.length})`];
  if (wf.waiting) parts.push(`WAITING: the user is looking at the ${wf.waiting} checkpoint; their next message is feedback on it`);
  const gs = gatesOf(wf);
  if (gs.length) parts.push(`checkpoints ${gs.map((g) => `${g}${(wf.passed ?? []).includes(g) ? ' passed' : ''}`).join(', ')}`);
  if (wf.choice) parts.push(`plan ${wf.choice.toUpperCase()} chosen`);
  if (wf.review) parts.push(`last review: ${wf.review.phase ?? 'final'} round ${wf.review.round} ${wf.review.verdict} (${wf.review.by})${key && wf.review.version !== key ? ', OUT OF DATE (the video changed since)' : ''}`);
  return parts.join(' · ');
}
