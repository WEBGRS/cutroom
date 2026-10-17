// Checkpoint card above the chat input: pick a plan or approve the sample; feedback goes in the input
import { useEffect, useState } from 'react';
import type { Workflow } from '../../src/lib/types';
import { CHECKLIST_KEYS } from './gatekeys';
import { TIERS, tierOf } from './flow';
import { tr } from './i18n';

interface FlowView {
  workflow: Workflow | null;
  key: string;
  plans: { id: string; title: string; line: string; md: string | null; image: string | null; clip: string | null }[];
  sheet: string | null;
  problems: string[];
}

export function Scores({ scores }: { scores: Record<string, number> }) {
  return (
    <div className="scores">
      {CHECKLIST_KEYS.filter(([k]) => scores[k] !== undefined).map(([k, en, zh]) => (
        <span key={k} className={scores[k] < 8 ? 'low' : ''} title={tr(en, zh)}>
          {k} {scores[k]}
        </span>
      ))}
    </div>
  );
}

export function GateCard({ slug, workflow, onPass }: { slug: string; workflow: Workflow; onPass: (message: string) => void }) {
  // The view of the project it was fetched for
  const [got, setGot] = useState<{ slug: string; view: FlowView } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    // A late answer for a project that is no longer open is dropped
    let live = true;
    fetch(`/api/flow?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<FlowView>) : null))
      .then((v) => {
        if (live && v) setGot({ slug, view: v });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug, workflow.waiting, workflow.review?.round, workflow.review?.at]);
  const view = got?.slug === slug ? got.view : null;
  if (!workflow.waiting || !view) return null;
  const go = async (gate: 'plan' | 'sample', choice?: string) => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/flow/pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, gate, choice }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error ?? r.statusText);
      setCompare(false);
      onPass(j.message);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // One-plan tiers show only plan a
  const plans = view.plans.slice(0, TIERS[tierOf(workflow)].plans).filter((p) => p.md);
  const one = plans.length === 1;
  // A plan without a preview shows the start of its text
  const excerpt = (md: string) =>
    md
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith('#'))
      .slice(1, 7)
      .join('\n');
  const tile = (p: FlowView['plans'][number], big = false) => (
    <div key={p.id} className={`gate-plan${big ? ' big' : ''}`}>
      {p.clip ? <video src={p.clip} poster={p.image ?? undefined} autoPlay loop muted playsInline /> : p.image ? <img src={p.image} alt="" /> : big || open === p.id ? <div className="gate-noimg" /> : <pre className="gate-md gate-excerpt">{excerpt(p.md ?? '')}</pre>}
      <b>{p.title || tr(`Plan ${p.id.toUpperCase()}`, `方案 ${p.id.toUpperCase()}`)}</b>
      <span>{p.line}</span>
      {big ? <pre className="gate-md">{p.md}</pre> : null}
      <div className="gate-acts">
        {big ? null : (
          <button className="btn" onClick={() => setOpen(open === p.id ? null : p.id)}>
            {open === p.id ? tr('Hide', '收起') : tr('Full plan', '完整方案')}
          </button>
        )}
        <button className="primary" disabled={busy} onClick={() => void go('plan', p.id)}>
          {one ? tr('Use this plan', '就用这个') : tr('Take this', '选这个')}
        </button>
      </div>
    </div>
  );
  if (workflow.waiting === 'plan')
    return (
      <div className="gate">
        <div className="gate-head">
          {one ? tr('Approve the plan, or write below what to change', '方案可以就通过，要改就在下面写') : tr('Pick a plan, or write below what to change', '选一个方案，或在下面写要改什么')}
          {one ? null : (
            <button className="btn" onClick={() => setCompare(true)}>
              {tr('Compare', '并排对比')}
            </button>
          )}
        </div>
        <div className={`gate-plans${one ? ' one' : plans.some((p) => p.image || p.clip) ? '' : ' text'}`}>{plans.map((p) => tile(p))}</div>
        {open ? <pre className="gate-md">{plans.find((p) => p.id === open)?.md}</pre> : null}
        {err ? <div className="err">{err}</div> : null}
        {compare ? (
          <div className="modal-back" onPointerDown={() => setCompare(false)}>
            <div className="gate-compare" onPointerDown={(e) => e.stopPropagation()}>
              {plans.map((p) => tile(p, true))}
            </div>
          </div>
        ) : null}
      </div>
    );
  const rv = workflow.review;
  return (
    <div className="gate">
      <div className="gate-head">{tr('The sample is ready. Approve it, or write below what to change', '样片做好了。没问题就通过，要改就在下面写')}</div>
      {view.sheet ? <img className="gate-sheet" src={view.sheet} alt="" /> : null}
      {rv ? (
        <div className="gate-review">
          <b>{rv.verdict === 'ready' ? tr('Reviewer: ready', '审片：可交付') : tr('Reviewer: needs changes', '审片：需要修改')}</b>
          <span>{rv.by === 'independent' ? tr('independent reviewer', '独立审片') : tr('self-review', '自审')}{rv.version !== view.key ? tr(' · out of date', ' · 已过期') : ''}</span>
          <Scores scores={rv.scores} />
        </div>
      ) : null}
      {rv && view.problems.length ? (
        <ol className="gate-problems">
          {view.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      ) : null}
      <button className="primary" disabled={busy} onClick={() => void go('sample')}>
        {tr('Approve the sample', '样片通过')}
      </button>
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
