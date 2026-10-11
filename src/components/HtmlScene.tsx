import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, getRemotionEnvironment, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { htmlMeta, prepareHtml, varValues } from '../lib/html';
import { fit, type Layout } from '../lib/layout';
import type { FrameStyle, HtmlVisual } from '../lib/types';
import { Shell } from './Chrome';

type Runtime = { ready(): Promise<{ w: number; h: number; dur: number | null }>; seek(t: number): Promise<unknown> | null };
type Loaded = { html: string; w: number; h: number };

// Mount data-composition-src files and unwrap a lone <template>, as HyperFrames' assembler does
async function assemble(html: string, url: string, depth = 0): Promise<string> {
  const P = typeof DOMParser === 'undefined' ? null : new DOMParser();
  if (!P) return html;
  const doc = P.parseFromString(html, 'text/html');
  let changed = false;
  if (!doc.body.querySelector('[data-composition-id]')) {
    const t = doc.body.querySelector('template');
    if (t && t.content.querySelector('[data-composition-id]')) {
      t.replaceWith(t.content.cloneNode(true));
      changed = true;
    }
  }
  if (depth < 3)
    for (const host of [...doc.querySelectorAll('[data-composition-src]')]) {
      const src = new URL(host.getAttribute('data-composition-src')!, url).href;
      const r = await fetch(src);
      if (!r.ok) throw new Error(`HTML scene: ${src} (${r.status})`);
      const sub = P.parseFromString(await assemble(await r.text(), src, depth + 1), 'text/html');
      const tpl = sub.querySelector('template');
      const head = tpl ? '' : [...sub.head.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('');
      host.innerHTML = head + (tpl ? tpl.innerHTML : sub.body.innerHTML);
      host.removeAttribute('data-composition-src');
      changed = true;
    }
  return changed ? `<!doctype html>\n${doc.documentElement.outerHTML}` : html;
}

async function load(url: string, vars: Record<string, unknown> | undefined): Promise<Loaded> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTML scene: ${url} (${r.status})`);
  const abs = new URL(url, window.location.href).href;
  const html = await assemble(await r.text(), abs);
  const meta = htmlMeta(html);
  return { html: prepareHtml(html, abs.replace(/[^/]*$/, ''), varValues(meta, vars)), w: meta.w, h: meta.h };
}

// The page sits in an iframe; every frame sets its clock, so preview and export show the same thing
export const HtmlScene: React.FC<{ v: HtmlVisual; slug: string; layout: Layout; look?: FrameStyle; rev?: number }> = ({ v, slug, layout, look, rev }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rendering = getRemotionEnvironment().isRendering;
  const url = staticFile(`${slug}/${v.src}`) + (rev ? `?r=${rev}` : '');
  const varsKey = JSON.stringify(v.vars ?? {});
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [rt, setRt] = useState<Runtime | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const t = Math.max(0, (v.from ?? 0) + frame / fps);
  const tRef = useRef(t);
  tRef.current = t;
  // Only an export waits for the page; the preview shows it once it has loaded
  const hold = useMemo(() => (rendering ? delayRender(`HTML scene ${v.src}`, { timeoutInMilliseconds: 60000 }) : null), [url, varsKey, rendering]);
  const release = () => hold !== null && continueRender(hold);
  const fail = (e: unknown) => {
    if (rendering) cancelRender(e);
    setErr((e as Error).message ?? String(e));
    release();
  };

  useEffect(() => {
    let dead = false;
    setRt(null);
    setErr(null);
    load(url, v.vars).then((d) => !dead && setDoc(d), fail);
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, varsKey]);

  const onLoad = () => {
    const w = ref.current?.contentWindow as (Window & { __cutroom?: Runtime }) | null;
    const r = w?.__cutroom;
    if (!r) return fail(new Error(`HTML scene ${v.src}: the page did not start`));
    r.ready()
      .then(() => Promise.resolve(r.seek(tRef.current)))
      .then(() => {
        setRt(r);
        release();
      }, fail);
  };

  useLayoutEffect(() => {
    if (!rt) return;
    const p = rt.seek(t);
    if (!p || !rendering) return;
    const h = delayRender(`HTML scene ${v.src} at ${t.toFixed(3)} s`);
    p.then(
      () => continueRender(h),
      () => continueRender(h),
    );
  }, [rt, t, rendering, v.src]);

  const kind = v.frame;
  const bar = kind === 'window' ? layout.bar : 0;
  const ar = doc ? doc.w / doc.h : 16 / 9;
  const shell = kind ? fit(layout.box, ar * 1000, 1000, bar) : null;
  const area = shell ? { w: shell.content.w, h: shell.content.h } : { w: layout.W, h: layout.H };
  const page = doc ? (
    (() => {
      const k = (v.fit === 'cover' ? Math.max : Math.min)(area.w / doc.w, area.h / doc.h);
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <iframe
            ref={ref}
            title={v.src}
            srcDoc={doc.html}
            onLoad={onLoad}
            scrolling="no"
            // Preview: hidden until its clock is set, so the page's unseeked first state never shows (an export waits anyway)
            style={{ position: 'absolute', left: (area.w - doc.w * k) / 2, top: (area.h - doc.h * k) / 2, width: doc.w, height: doc.h, transform: `scale(${k})`, transformOrigin: '0 0', border: 0, pointerEvents: 'none', background: 'transparent', colorScheme: 'normal', visibility: rt || rendering ? 'visible' : 'hidden' }}
          />
        </div>
      );
    })()
  ) : null;
  const body = err ? (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', background: 'rgba(160,30,30,.55)', font: '500 28px system-ui', padding: 60, textAlign: 'center' }}>{err}</div>
  ) : (
    page
  );
  // Tests wait for data-ready before comparing a preview frame
  const mark = { 'data-html-scene': v.src, 'data-ready': rt || err ? 'true' : undefined };
  if (!shell) return <AbsoluteFill {...mark}>{body}</AbsoluteFill>;
  return (
    <AbsoluteFill {...mark}>
      <Shell rect={shell.frame} bar={bar} kind={kind} url={v.url} look={look}>
        <div style={{ position: 'relative', width: area.w, height: area.h }}>{body}</div>
      </Shell>
    </AbsoluteFill>
  );
};
