import React, { useEffect, useRef, useState } from 'react';
import { htmlMeta, prepareHtml, varValues, type HtmlMeta } from '../../src/lib/html';
import type { HtmlVisual } from '../../src/lib/types';
import { Field, Row, isNum } from './Fields';
import { tr } from './i18n';

export { isHtml, pageName } from './pagename';

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const cache = new Map<string, Promise<{ text: string; meta: HtmlMeta }>>();

// Page text and its root's size, length and variables; tick reloads it
export function fetchHtml(slug: string, src: string, tick = 0) {
  const key = `${slug}/${src}#${tick}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/${slug}/${enc(src)}?r=${tick}`, { cache: 'no-store' }).then(async (r) => {
      if (!r.ok) throw new Error(`${src}: ${r.status}`);
      const text = await r.text();
      return { text, meta: htmlMeta(text) };
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function useHtml(slug: string, src: string | undefined, tick = 0) {
  const [d, setD] = useState<{ text: string; meta: HtmlMeta } | null>(null);
  useEffect(() => {
    let alive = true;
    setD(null);
    if (src) fetchHtml(slug, src, tick).then((x) => alive && setD(x), () => undefined);
    return () => {
      alive = false;
    };
  }, [slug, src, tick]);
  return d;
}

// Still of the page at `at` of its length, live in a tiny iframe
export function HtmlThumb({ slug, src, h, at = 0.45 }: { slug: string; src: string; h: number; at?: number }) {
  const d = useHtml(slug, src);
  const ref = useRef<HTMLIFrameElement>(null);
  if (!d) return <div className="lt-img pending" />;
  const { w: pw, h: ph } = d.meta;
  const k = h / ph;
  const base = new URL(`/${enc(slug)}/${enc(src)}`, location.href).href.replace(/[^/]*$/, '');
  const onLoad = () => {
    const rt = (ref.current?.contentWindow as (Window & { __cutroom?: { ready(): Promise<{ dur: number | null }>; seek(t: number): unknown } }) | null)?.__cutroom;
    rt?.ready().then((i) => rt.seek((i.dur ?? 3) * at));
  };
  return (
    <div className="lt-html" style={{ width: pw * k, height: h }}>
      <iframe ref={ref} title={src} srcDoc={prepareHtml(d.text, base, varValues(d.meta, undefined))} onLoad={onLoad} scrolling="no" tabIndex={-1} style={{ width: pw, height: ph, transform: `scale(${k})` }} />
    </div>
  );
}

// Inputs for the page's declared variables (HyperFrames data-composition-variables)
export function HtmlVars({ slug, v, onSet, onLength }: { slug: string; v: HtmlVisual; onSet: (id: string, value: unknown) => void; onLength: (sec: number) => void }) {
  const d = useHtml(slug, v.src);
  if (!d) return null;
  const { meta } = d;
  const cur = varValues(meta, v.vars);
  return (
    <>
      <div className="html-meta">
        <span>
          {meta.w}×{meta.h}
          {meta.dur ? tr(`, ${meta.dur} s`, `，${meta.dur} 秒`) : ''}
        </span>
        {meta.dur ? (
          <button className="mini" onClick={() => onLength(Math.max(0.5, meta.dur! - (v.from ?? 0)))}>
            {tr('Match the page length', '按页面时长')}
          </button>
        ) : null}
      </div>
      {meta.vars.map((x) => {
        const label = x.label || x.id;
        const val = cur[x.id];
        const own = v.vars?.[x.id] !== undefined;
        const reset = own ? (
          <button className="mini html-reset" onClick={() => onSet(x.id, undefined)} title={tr('Back to the page default', '恢复页面默认值')}>
            ↺
          </button>
        ) : null;
        if (x.type === 'boolean')
          return (
            <label key={x.id} className="check">
              <input type="checkbox" checked={!!val} onChange={(e) => onSet(x.id, e.target.checked)} />
              {label}
              {reset}
            </label>
          );
        if (x.type === 'color')
          return (
            <Row key={x.id} label={label}>
              <input type="color" value={typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val) ? val : '#000000'} onChange={(e) => onSet(x.id, e.target.value)} />
              {reset}
            </Row>
          );
        if (x.type === 'number')
          return (
            <Row key={x.id} label={label}>
              <Field value={own ? (val as number) : undefined} placeholder={String(x.default ?? '')} validate={isNum} onCommit={(s) => onSet(x.id, s.trim() === '' ? undefined : Number(s))} />
            </Row>
          );
        const text = String(val ?? '');
        return (
          <Row key={x.id} label={label}>
            <Field multiline={text.includes('\n') || text.length > 40} value={own ? text : undefined} placeholder={String(x.default ?? '')} onCommit={(s) => onSet(x.id, s === '' ? undefined : s)} />
          </Row>
        );
      })}
    </>
  );
}
