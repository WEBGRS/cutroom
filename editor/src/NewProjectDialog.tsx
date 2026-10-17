// New project: name, size, how much the user wants to check, and how many tokens the build may spend
import { useState } from 'react';
import type { Format, Gates, Tier } from '../../src/lib/types';
import { MODE_OPTIONS, TIERS, TIER_IDS, TIER_OPTIONS } from './flow';
import { tr } from './i18n';

export interface NewProject {
  slug: string;
  format: Format;
  gates: Gates;
  tier: Tier;
}

export function NewProjectDialog({ ok, close }: { ok: (p: NewProject) => void; close: () => void }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>('wide');
  const [gates, setGates] = useState<Gates>('plan+sample');
  const [tier, setTier] = useState<Tier>(1);
  const noSample = !TIERS[tier].sample;
  const pickTier = (t: Tier) => {
    setTier(t);
    // A tier without a sample has no sample checkpoint
    if (!TIERS[t].sample && gates === 'plan+sample') setGates('plan');
  };
  const submit = () => {
    if (!name.trim()) return;
    close();
    ok({ slug: name.trim(), format, gates, tier });
  };
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal new-project" onPointerDown={(e) => e.stopPropagation()}>
        <h3>{tr('New project', '新建项目')}</h3>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? submit() : e.key === 'Escape' ? close() : undefined)} />
        <div className="hint">{tr('Letters, digits and dashes only, e.g. my-first-video', '项目名只用英文字母、数字和横线，例如 my-first-video')}</div>
        <div className="np-label">{tr('Size', '画幅')}</div>
        <div className="np-seg">
          <button className={format === 'wide' ? 'on' : ''} aria-pressed={format === 'wide'} onClick={() => setFormat('wide')}>
            {tr('16:9 widescreen', '16:9 横屏')}
          </button>
          <button className={format === 'tall' ? 'on' : ''} aria-pressed={format === 'tall'} onClick={() => setFormat('tall')}>
            {tr('9:16 vertical', '9:16 竖屏')}
          </button>
        </div>
        <div className="np-label">{tr('When the AI makes the whole video', 'AI 做整条视频时')}</div>
        {MODE_OPTIONS.map((o) => {
          const off = noSample && o.id === 'plan+sample';
          return (
            <label key={o.id} className={`np-opt${gates === o.id ? ' on' : ''}${off ? ' off' : ''}`}>
              <input type="radio" name="gates" checked={gates === o.id} disabled={off} onChange={() => setGates(o.id)} />
              <span>
                <b>{tr(o.en, o.zh)}</b>
                <small>{off ? tr(`Tier ${tier} makes no sample`, `${tier} 档不做样片`) : tr(o.hintEn, o.hintZh)}</small>
              </span>
            </label>
          );
        })}
        <div className="np-label">{tr('Token use', '用量档位')}</div>
        <div className="np-seg np-tier">
          {TIER_IDS.map((t) => (
            <button key={t} className={tier === t ? 'on' : ''} aria-pressed={tier === t} onClick={() => pickTier(t)}>
              {t} {tr(TIER_OPTIONS[t].en, TIER_OPTIONS[t].zh)}
            </button>
          ))}
        </div>
        <div className="np-tier-hint">{tr(TIER_OPTIONS[tier].hintEn, TIER_OPTIONS[tier].hintZh)}</div>
        <div className="modal-acts">
          <button className="ghost" onClick={close}>
            {tr('Cancel', '取消')}
          </button>
          <button className="primary" onClick={submit} disabled={!name.trim()}>
            {tr('Create', '创建')}
          </button>
        </div>
      </div>
    </div>
  );
}
