import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-stage-'));
process.env.VS_DATA = DATA;
fs.mkdirSync(path.join(DATA, 'demo'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'demo', 'storyboard.json'), JSON.stringify({ slug: 'demo', title: 'd', theme: { accent: '#000' }, scenes: [] }));
const S = await import('../src/stagefiles');

const BRIEF = `<role>Motion designer</role>
<inputs>
Product: a course search site.
features:
- search by course code
- grade chart
terms:
- COMP SCI 400
data:
- real public course data
</inputs>
<direction>Why: students find a course in seconds. Avoid: purple neon.</direction>
<structure>4 shots</structure>
<build>record + cards</build>
<gotchas>fonts</gotchas>
<start>shot 1</start>`;

test('brief lists and gaps', () => {
  assert.deepEqual(S.briefList(BRIEF, 'features'), ['search by course code', 'grade chart']);
  assert.deepEqual(S.briefGaps(BRIEF), []);
  const gaps = S.briefGaps('<role>x</role>\nfeatures:\n- a');
  assert.ok(gaps.includes('<inputs>'));
  assert.ok(gaps.includes('terms: list'));
  assert.ok(!gaps.includes('features: list'));
  assert.deepEqual(S.writeBrief('demo', BRIEF), []);
  assert.equal(S.readBrief('demo')?.trim(), BRIEF.trim());
});

test('a brief list may start after blank lines; a blank line after items ends it', () => {
  assert.deepEqual(S.briefList('features:\n\n- search\n- chart\n\n- not a feature', 'features'), ['search', 'chart']);
  assert.deepEqual(S.briefList('features:\r\n  \r\n- search', 'features'), ['search']);
  assert.deepEqual(S.briefList('features:\n\nterms:\n- x', 'features'), []);
});

test('review and plans preview default to the board format; the review fallback carries the checklist', async () => {
  const F = await import('../src/flowcli');
  assert.equal(F.formatFor({ format: 'wide', formatGiven: false, boardFormat: 'tall' }), 'tall');
  assert.equal(F.formatFor({ format: 'wide', formatGiven: true, boardFormat: 'tall' }), 'wide');
  assert.equal(F.formatFor({ format: 'wide', formatGiven: false }), 'wide');
  const fb = F.reviewFallback('the editor is not running at http://127.0.0.1:1');
  assert.match(fb, /independent review not available: the editor is not running/);
  assert.ok(fb.includes(S.checklistText()));
  assert.match(fb, /review log '<report>'/);
});

test('plans are written and read back with title and line', () => {
  S.writePlan('demo', 'b', '# Plan B: Pixel tour\n\nA pixel-art walk through the site.\n\n**Look**: …');
  const b = S.readPlans('demo').find((p) => p.id === 'b')!;
  assert.equal(b.title, 'Pixel tour');
  assert.equal(b.line, 'A pixel-art walk through the site.');
  assert.equal(b.still, false);
  assert.equal(S.readPlans('demo').find((p) => p.id === 'a')!.md, null);
  assert.ok(S.isPlanId('c'));
  assert.ok(!S.isPlanId('d'));
});

test('reviewer answers parse into a verdict', () => {
  const v = S.parseVerdict('revise\nscope: whole cut, 12 + 14 cut frames\nscores: P 8 F 6 V 9 B 7 D 10 A 8 Q 6 M 7 T 9\n1. intro 0:02 caption covers the search box — move it up\n2. chart 0:11 number appears before its line — delay 0.8 s');
  assert.equal(v.verdict, 'revise');
  assert.equal(v.scope, 'whole cut, 12 + 14 cut frames');
  assert.equal(v.scores.F, 6);
  assert.equal(v.scores.T, 9);
  assert.equal(v.defects, 2);
  assert.throws(() => S.parseVerdict('looks great'), /ready or revise/);
});

test('the verdict is found under a heading, after a label or in bold, within the first three lines', () => {
  assert.equal(S.parseVerdict('## Verdict\nrevise\nscope: x').verdict, 'revise');
  assert.equal(S.parseVerdict('Verdict: revise\nscope: x').verdict, 'revise');
  assert.equal(S.parseVerdict('**revise**\n\nscope: x').verdict, 'revise');
  assert.equal(S.parseVerdict('1. revise\nscope: x').verdict, 'revise');
  assert.equal(S.parseVerdict('1) ready\nscope: x').verdict, 'ready');
  assert.equal(S.parseVerdict('**Verdict:** ready').verdict, 'ready');
  assert.equal(S.parseVerdict('> READY').verdict, 'ready');
  assert.throws(() => S.parseVerdict('Summary\nThe cut is close\nMostly fine\nrevise'), /ready or revise/);
  assert.equal(S.parseVerdict('revise\n**Scope:** whole cut').scope, 'whole cut');
});

test('an empty scope or scores line does not take the next line', () => {
  const v = S.parseVerdict('revise\nscope:\nscores:\n1. Q 3 caption unreadable at phone size');
  assert.equal(v.scope, 'not stated');
  assert.deepEqual(v.scores, {});
  assert.equal(v.defects, 1);
});

test('the chosen plan is read for the reviewer', () => {
  S.writePlan('demo', 'c', '# Plan C: Metaphor\n\nOne running subject.');
  assert.match(S.chosenPlan('demo', 'c') ?? '', /Plan C: Metaphor/);
  assert.equal(S.chosenPlan('demo', undefined), null);
  assert.equal(S.chosenPlan('demo', 'z'), null);
  assert.equal(S.chosenPlan('demo', 'a'), null);
});

test('a reviewer answer without a verdict line is shown, not lost, and nothing is saved', async () => {
  const F = await import('../src/flowcli');
  const out: string[] = [];
  const log = console.log;
  console.log = (s: string) => out.push(String(s));
  try {
    const saved: unknown[] = [];
    const r = F.saveReview('demo', 'Overall\nThe cut is close.\nSome notes\n1. intro 0:02 caption too small', 'k', (op) => saved.push(op));
    assert.equal(r, null);
    assert.equal(saved.length, 0);
    assert.match(out.join('\n'), /caption too small/);
    assert.match(out.join('\n'), /review log/);
  } finally {
    console.log = log;
  }
});

test('rounds are appended to review/log.md with their phase; each phase counts its own rounds', () => {
  const v = S.parseVerdict('ready\nscope: sample\nscores: P 9');
  const r1 = S.appendRound('demo', v, 'self', 'k1', 'sample', new Date('2026-10-17T10:00:00Z'));
  const r2 = S.appendRound('demo', v, 'independent', 'k2', 'final');
  const r3 = S.appendRound('demo', v, 'self', 'k3', 'final');
  assert.equal(r1.round, 1);
  assert.equal(r1.phase, 'sample');
  assert.equal(r2.round, 1);
  assert.equal(r3.round, 2);
  assert.equal(r3.phase, 'final');
  assert.equal(S.roundsSoFar('demo', 'sample'), 1);
  assert.equal(S.roundsSoFar('demo', 'final'), 2);
  assert.equal(S.roundsSoFar('demo'), 3);
  const log = fs.readFileSync(S.reviewLog('demo'), 'utf8');
  assert.match(log, /## Round 1 · sample · self-review · 2026-10-17 10:00/);
  assert.match(log, /## Round 1 · final · independent reviewer/);
  assert.match(log, /## Round 2 · final · self-review/);
});

test('batch rounds are counted apart from sample and final; the brief length is read from inputs', () => {
  const v = S.parseVerdict('revise\nscope: x\n1. a');
  S.appendRound('demo', v, 'independent', 'k', 'batch');
  assert.equal(S.roundsSoFar('demo', 'batch'), 1);
  assert.equal(S.roundsSoFar('demo', 'final'), 2);
  assert.match(fs.readFileSync(S.reviewLog('demo'), 'utf8'), /## Round 1 · batch · independent reviewer/);
  const len = (t: string) => S.briefSeconds(`<role>x</role><inputs>${t}</inputs><direction>10 s of x</direction>`);
  assert.equal(len('Length: 约 30 s, 16:9'), 30);
  assert.equal(len('30 seconds'), 30);
  assert.equal(len('时长 45 秒'), 45);
  assert.equal(len('12.5s'), 12.5);
  assert.equal(len('6 shots, 30 seconds'), 30);
  assert.equal(len('no length'), null);
  assert.equal(S.briefSeconds('<direction>30 s</direction>'), null);
});

test('archiving the log starts the count again and keeps the old rounds', () => {
  const to = S.archiveLog('demo', new Date('2026-10-17T11:22:33Z'));
  assert.equal(to, path.join(S.reviewDir('demo'), 'log-2026-10-17-1122.md'));
  assert.ok(fs.existsSync(to!));
  assert.ok(!fs.existsSync(S.reviewLog('demo')));
  assert.equal(S.roundsSoFar('demo', 'final'), 0);
  assert.equal(S.archiveLog('demo'), null);
});

test('the checklist has every group', () => {
  assert.deepEqual(S.CHECKLIST.map((c) => c.key), ['P', 'F', 'V', 'B', 'D', 'A', 'Q', 'M', 'T']);
  assert.match(S.checklistText(), /Q Picture: .*operated/);
});
