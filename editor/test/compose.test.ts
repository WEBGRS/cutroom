import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expand, libraryText, rangeWarnings, slugOf, type Draft, type Inst } from '../src/compose';

// A small stand-in for the studio's /api/library
const LIB: Inst[] = [
  { id: 'piano', kind: 'instrument', family: 'keys', name: 'Piano', samples: [{ midi: 37 }, { midi: 93 }] },
  { id: 'strings', kind: 'instrument', family: 'strings', name: 'Strings', articulations: [{ id: 'sustain' }, { id: 'pizzicato' }], samples: [{ midi: 55 }, { midi: 86 }] },
  { id: 'kick', kind: 'instrument', family: 'drums', name: 'Kick', percussive: true, samples: [{ midi: 60 }] },
  { id: 'tr808-hihat', kind: 'instrument', family: 'drums', name: '808 hat', percussive: true, articulations: [{ id: 'closed' }, { id: 'open' }], samples: [{ midi: 60 }] },
  { id: 'cab-v30', kind: 'cabinet', family: 'cabinets', name: 'Cab' },
];
const base = (tracks: Draft['tracks']): Draft => ({ title: 'Test Song', bpm: 120, bars: 8, tracks });
const notesOf = (p: Record<string, unknown>, i = 0) => (p.tracks as { notes: { start: number; duration: number; midi: number; velocity: number; articulation?: string; id: string }[] }[])[i].notes;

test('a draft expands to the studio project format', () => {
  const p = expand(base([{ inst: 'piano', notes: [[0, 1, 60, 0.6], [4, 2, 64]] }]), LIB) as Record<string, unknown>;
  assert.equal(p.schemaVersion, 1);
  assert.deepEqual(p.timeSignature, [4, 4]);
  assert.equal(p.bars, 8);
  assert.equal(p.id, 'test-song');
  const n = notesOf(p);
  assert.equal(n.length, 2);
  assert.deepEqual(n.map((x) => x.id), ['piano-1-001', 'piano-1-002']);
  assert.equal(n[1].velocity, 0.7, 'velocity defaults');
});

test('loop repeats a phrase from a bar to the end', () => {
  const p = expand(base([{ inst: 'piano', loop: 2, from: 2, notes: [[0, 1, 60], [4, 1, 62]] }]), LIB);
  // Phrase is 2 bars; repeats at bars 2, 4, 6
  assert.deepEqual(notesOf(p).map((x) => x.start), [8, 12, 16, 20, 24, 28]);
});

test('notes past the end are cut or dropped, never left over the edge', () => {
  const p = expand(base([{ inst: 'piano', notes: [[31, 4, 60], [32, 1, 62], [40, 1, 64]] }]), LIB);
  const n = notesOf(p);
  assert.equal(n.length, 1);
  assert.equal(n[0].start + n[0].duration, 32);
});

test('a drum pattern is sixteenth notes at midi 60; X is an accent; an array cycles per bar', () => {
  const p = expand(base([{ inst: 'kick', from: 1, to: 3, pattern: ['X...x...', 'x.......'] }]), LIB);
  const n = notesOf(p);
  // bar 1 (beats 4-7) uses the first string (8 steps, 0.5 beat each), bar 2 the second
  assert.deepEqual(n.map((x) => [x.start, x.midi, x.velocity]), [[4, 60, 0.95], [6, 60, 0.65], [8, 60, 0.65]]);
  assert.ok(n.every((x) => x.duration <= 0.25));
});

test('a track articulation applies to its notes; a note can override it', () => {
  const p = expand(base([{ inst: 'strings', art: 'sustain', notes: [[0, 4, 60], [4, 1, 62, 0.5, 'pizzicato']] }]), LIB);
  const n = notesOf(p);
  assert.equal(n[0].articulation, 'sustain');
  assert.equal(n[1].articulation, 'pizzicato');
});

test('mistakes come back as plain messages the assistant can act on', () => {
  const bad = (d: Draft) => assert.throws(() => expand(d, LIB), (e: Error) => e.message);
  assert.throws(() => expand(base([{ inst: 'theremin', notes: [[0, 1, 60]] }]), LIB), /no such instrument/);
  assert.throws(() => expand(base([{ inst: 'cab-v30', notes: [[0, 1, 60]] }]), LIB), /no such instrument/, 'a cabinet is not an instrument');
  assert.throws(() => expand(base([{ inst: 'strings', art: 'bowed', notes: [[0, 1, 60]] }]), LIB), /articulation "bowed" is not one of sustain, pizzicato/);
  assert.throws(() => expand(base([{ inst: 'piano', notes: [[0, 1, 200]] }]), LIB), /outside 0-127/);
  assert.throws(() => expand(base([{ inst: 'piano', notes: [['a', 1, 60]] }]), LIB), /numbers first/);
  assert.throws(() => expand(base([{ inst: 'kick', pattern: 'x..' }]), LIB), /multiple of 4/);
  assert.throws(() => expand(base([{ inst: 'kick', pattern: 'x...?...' }]), LIB), /pattern characters/);
  assert.throws(() => expand(base([{ inst: 'piano', notes: [] }]), LIB), /no notes/);
  assert.throws(() => expand({ ...base([{ inst: 'piano', notes: [[0, 1, 60]] }]), bpm: 20 }, LIB), /bpm must be/);
  assert.throws(() => expand({ ...base([{ inst: 'piano', notes: [[0, 1, 60]] }]), bars: 100 }, LIB), /bars must be/);
  assert.throws(() => expand(base([]), LIB), /at least one track/);
  void bad;
});

test('notes outside the recorded range are warned about', () => {
  const d = base([{ inst: 'piano', notes: [[0, 1, 60], [1, 1, 20], [2, 1, 110]] }, { inst: 'kick', notes: [[0, 1, 60]] }]);
  const w = rangeWarnings(d, LIB);
  assert.equal(w.length, 1);
  assert.match(w[0], /piano: 2 note/);
});

test('the instrument list shows what is needed to choose', () => {
  const t = libraryText(LIB);
  assert.match(t, /piano\s+keys\s+37-93/);
  assert.match(t, /kick\s+drums\s+drum:midi60/);
  assert.match(t, /art: closed,open/);
  assert.doesNotMatch(t, /cab-v30/, 'cabinets are not listed');
});

test('track names become safe file names', () => {
  assert.equal(slugOf('Warm Afternoon!'), 'warm-afternoon');
  assert.equal(slugOf('  --中文--  '), '');
});
