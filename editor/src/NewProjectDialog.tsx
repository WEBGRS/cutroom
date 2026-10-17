// New project: name, size and how much the user wants to check
import { useState } from 'react';
import type { Format, Gates } from '../../src/lib/types';
import { MODE_OPTIONS } from './flow';
import { tr } from './i18n';

export interface NewProject {
  slug: string;
  format: Format;
  gates: Gates;
}

export function NewProjectDialog({ ok, close }: { ok: (p: NewProject) => void; close: () => void }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>('wide');
  const [gates, setGates] = useState<Gates>('plan+sample');
  const submit = () => {
    if (!name.trim()) return;
    close();
    ok({ slug: name.trim(), format, gates });
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
        {MODE_OPTIONS.map((o) => (
          <label key={o.id} className={`np-opt${gates === o.id ? ' on' : ''}`}>
            <input type="radio" name="gates" checked={gates === o.id} onChange={() => setGates(o.id)} />
            <span>
              <b>{tr(o.en, o.zh)}</b>
              <small>{tr(o.hintEn, o.hintZh)}</small>
            </span>
          </label>
        ))}
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
