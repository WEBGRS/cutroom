import React, { useEffect, useRef, useState } from 'react';
import type { FieldDef } from './catalog';
import { Icon } from './icons';

// ---- text field: local text while focused, commit on pause / blur / Enter ----
interface FieldProps {
  value: unknown;
  onCommit: (s: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  list?: string;
  validate?: (s: string) => boolean;
  type?: string;
  autoFocus?: boolean;
}

export function Field({ value, onCommit, multiline, rows, placeholder, list, validate, type, autoFocus }: FieldProps) {
  const str = value === undefined || value === null ? '' : String(value);
  const [v, setV] = useState(str);
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const base = useRef(str);
  useEffect(() => {
    base.current = str;
    if (!focused.current) setV(str);
  }, [str]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const ok = (x: string) => !validate || validate(x);
  const flush = (x: string) => {
    clearTimeout(timer.current);
    if (x !== base.current && ok(x)) {
      base.current = x;
      onCommit(x);
    }
  };
  const common = {
    value: v,
    placeholder,
    className: ok(v) ? undefined : 'bad',
    autoFocus,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      flush(v);
    },
  };
  const change = (x: string) => {
    setV(x);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(x), 700);
  };
  return multiline ? (
    <textarea {...common} rows={rows ?? 2} onChange={(e) => change(e.target.value)} />
  ) : (
    <input {...common} type={type ?? 'text'} list={list} onChange={(e) => change(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && flush(v)} />
  );
}

export const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
export const isNum = (s: string) => s.trim() === '' || Number.isFinite(Number(s));
export const asRef = (s: string) => (s.trim() === '' ? undefined : /^-?[\d.]+$/.test(s.trim()) ? Number(s) : s.trim());
export const refOk = (marks: string[]) => (s: string) => {
  const t = s.trim();
  if (!t || /^-?[\d.]+$/.test(t)) return true;
  const m = /^@([\w-]+)([+-][\d.]+)?$/.exec(t);
  return !!m && marks.includes(m[1]);
};

export function JsonEdit({ value, onApply }: { value: unknown; onApply: (v: any) => void }) {
  const text = JSON.stringify(value, null, 2);
  const [t, setT] = useState(text);
  const [err, setErr] = useState('');
  useEffect(() => setT(text), [text]);
  return (
    <div>
      <textarea rows={Math.min(18, text.split('\n').length + 1)} value={t} onChange={(e) => setT(e.target.value)} style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }} />
      {err ? <div className="hint" style={{ color: 'var(--err)' }}>{err}</div> : null}
      <button
        className="mini"
        disabled={t === text}
        onClick={() => {
          try {
            onApply(JSON.parse(t));
            setErr('');
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        应用
      </button>
    </div>
  );
}

export const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="row">
    <label>{label}</label>
    {children}
  </div>
);

// Track fill between the default and the current value
const fill = (v: number, d: number, min: number, max: number) => {
  const pc = (x: number) => `${(((x - min) / (max - min)) * 100).toFixed(1)}%`;
  return { ['--a' as string]: pc(Math.min(v, d)), ['--b' as string]: pc(Math.max(v, d)) } as React.CSSProperties;
};

// One catalog field: slider / toggle / select; default value removes the key
export function FieldControl({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const [live, setLive] = useState<number | null>(null);
  const set = (v: unknown) => onChange(v === def.def || v === '' ? undefined : v);
  const warn = def.rule && value !== undefined && value !== def.def && value !== '' ? <span className="rule" title={def.rule}>!</span> : null;
  if (def.type === 'bool') {
    const on = value === undefined ? !!def.def : !!value;
    return (
      <label className="fc toggle" title={def.hint}>
        <span className="fl">
          {def.label}
          {warn}
        </span>
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        <i />
      </label>
    );
  }
  if (def.type === 'select') {
    return (
      <div className="fc" title={def.hint}>
        <span className="fl">
          {def.label}
          {warn}
        </span>
        <select value={value === undefined ? '' : String(value)} onChange={(e) => set(e.target.value || undefined)}>
          {def.options!.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const cur = live ?? (typeof value === 'number' ? value : (def.def as number) ?? 0);
  const changed = value !== undefined && value !== def.def;
  return (
    <div className={`fc range${changed ? ' on' : ''}`} title={def.hint}>
      <span className="fl">
        {def.label}
        {warn}
      </span>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={cur}
        style={fill(cur, (def.def as number) ?? def.min ?? 0, def.min ?? 0, def.max ?? 1)}
        onChange={(e) => setLive(Number(e.target.value))}
        onPointerUp={() => {
          if (live !== null) set(live);
          setLive(null);
        }}
        onKeyUp={() => {
          if (live !== null) set(live);
          setLive(null);
        }}
      />
      <span className="fv">{Number(cur.toFixed(2))}</span>
      <button className="icon sm" title="恢复默认" disabled={!changed} onClick={() => set(undefined)}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
