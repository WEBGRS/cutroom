import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { MONO, SANS } from '../lib/fonts';
import { rgba, type Layout } from '../lib/layout';
import type { Theme, Visual } from '../lib/types';
import { AnimText } from './text';
import { EASE, clamp01, lerp, tween } from './ease';

// Card scenes ported from HyperFrames (animated-bar-chart, code-typing, chat-thread, testimonial-card,
// marker-checklist-card, notification-pileup, split-flap-board, before-after-wipe, count-up, terminal-simulator)

export const CARD_KINDS = ['chart', 'code', 'chat', 'quote', 'checklist', 'notifs', 'flap', 'compare', 'counter', 'terminal'];

const Title: React.FC<{ text?: string; t: number; layout: Layout; theme: Theme }> = ({ text, t, layout, theme }) =>
  text ? (
    <div style={{ fontSize: layout.H > layout.W ? 58 : 52, fontWeight: 800, color: '#fff', marginBottom: 44, textAlign: 'center' }}>
      <AnimText text={text} anim="fadeup" t={t} hi={theme.accent2 ?? theme.accent} />
    </div>
  ) : null;

const card: React.CSSProperties = { background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 28, boxShadow: '0 30px 80px rgba(0,0,0,.35)' };

function codeTokens(line: string, acc: string) {
  const kw = /^(const|let|var|function|return|import|from|export|default|if|else|for|await|async|new|class|def|print|true|false|null)$/;
  return line.split(/(\/\/.*$|#.*$|"[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|[{}()[\].,;:=<>+\-*/])/g).filter((s) => s !== '' && s !== undefined).map((p, i) => {
    const color = /^(\/\/|#)/.test(p) ? '#6b7385' : /^["'`]/.test(p) ? '#9ee493' : /^\d/.test(p) ? '#f8c555' : kw.test(p) ? acc : /^[A-Z]/.test(p) ? '#7fd8ff' : /^[{}()[\].,;:=<>+\-*/]$/.test(p) ? '#a5abb8' : '#e8e9ec';
    return (
      <span key={i} style={{ color, fontStyle: /^(\/\/|#)/.test(p) ? 'italic' : undefined }}>
        {p}
      </span>
    );
  });
}

export const FxCard: React.FC<{ v: Visual; layout: Layout; theme: Theme; slug: string }> = ({ v, layout, theme, slug }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const tall = layout.H > layout.W;
  const acc = theme.accent;
  const hi = theme.accent2 ?? theme.accent;
  const pad = tall ? '0 64px 300px' : '0 160px 80px';
  const wrap = (children: React.ReactNode, title?: string) => (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, padding: pad }}>
      <Title text={title} t={t} layout={layout} theme={theme} />
      {children}
    </AbsoluteFill>
  );
  switch (v.kind) {
    case 'chart': {
      const max = Math.max(1, ...v.items.map((i) => i.value));
      const h = tall ? 760 : 560;
      return wrap(
        <div style={{ ...card, width: '100%', height: h, padding: '40px 50px 30px', display: 'flex', alignItems: 'flex-end', gap: tall ? 26 : 40 }}>
          {v.items.map((it, i) => {
            const k = tween(t, 0.15 + i * 0.1, 0.8, 'power3.out');
            const last = i === v.items.length - 1;
            return (
              <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                <div style={{ color: last ? acc : '#fff', fontWeight: 900, fontSize: tall ? 46 : 42, fontVariantNumeric: 'tabular-nums', opacity: clamp01(k * 2), marginBottom: 12 }}>
                  {Math.round(it.value * k).toLocaleString('en-US')}
                  {v.unit ?? ''}
                </div>
                <div style={{ width: '100%', height: `${(it.value / max) * 72 * k}%`, borderRadius: '14px 14px 4px 4px', background: last ? `linear-gradient(180deg, ${acc}, ${rgba(acc, 0.65)})` : 'rgba(255,255,255,.22)', boxShadow: last ? `0 0 40px ${rgba(acc, 0.45)}` : undefined }} />
                <div style={{ color: 'rgba(255,255,255,.82)', fontWeight: 700, fontSize: tall ? 30 : 28, marginTop: 16, whiteSpace: 'nowrap' }}>{it.label}</div>
              </div>
            );
          })}
        </div>,
        v.title,
      );
    }
    case 'code': {
      const lines = v.code.split('\n');
      const total = v.code.length;
      const shown = Math.floor(Math.max(0, t - 0.5) * 38);
      let acc0 = 0;
      return wrap(
        <div style={{ width: '100%', maxWidth: tall ? undefined : 1300, borderRadius: 22, overflow: 'hidden', background: '#0d0f14', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 40px 100px rgba(0,0,0,.55)', opacity: tween(t, 0, 0.4), transform: `translateY(${(1 - tween(t, 0, 0.5, 'power3.out')) * 30}px)` }}>
          <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 22px', background: '#171a21', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <div key={c} style={{ width: 15, height: 15, borderRadius: '50%', background: c }} />
            ))}
            <span style={{ marginLeft: 14, color: 'rgba(255,255,255,.55)', fontFamily: MONO, fontSize: 20 }}>{v.title ?? 'main.ts'}</span>
          </div>
          <div style={{ padding: '26px 30px 34px', fontFamily: MONO, fontSize: tall ? 30 : 30, lineHeight: 1.6, whiteSpace: 'pre' }}>
            {lines.map((l, i) => {
              const start = acc0;
              acc0 += l.length + 1;
              const n = Math.max(0, Math.min(l.length, shown - start));
              const cur = shown >= start && shown <= start + l.length && shown < total;
              return (
                <div key={i} style={{ display: 'flex' }}>
                  <span style={{ width: 54, color: 'rgba(255,255,255,.22)', flex: 'none' }}>{i + 1}</span>
                  <span>
                    {codeTokens(l.slice(0, n), acc)}
                    {cur ? <span style={{ display: 'inline-block', width: '0.55em', height: '1.1em', background: acc, verticalAlign: '-0.2em', opacity: Math.floor(t / 0.3) % 2 ? 0.25 : 1 }} /> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>,
      );
    }
    case 'chat': {
      let at = 0.3;
      return wrap(
        <div style={{ width: '100%', maxWidth: tall ? undefined : 980, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {v.messages.map((m, i) => {
            const typing = 0.55;
            const start = at;
            at += typing + 0.45 + m.text.length * 0.012;
            const e = tween(t, start, 0.35, 'power3.out');
            const shown = t >= start + typing;
            if (t < start) return null;
            return (
              <div key={i} style={{ alignSelf: m.me ? 'flex-end' : 'flex-start', maxWidth: '78%', opacity: e, transform: `translateY(${(1 - e) * 24}px)` }}>
                {m.name ? <div style={{ fontSize: 22, color: 'rgba(255,255,255,.6)', margin: m.me ? '0 8px 6px auto' : '0 0 6px 8px', textAlign: m.me ? 'right' : 'left' }}>{m.name}</div> : null}
                <div style={{ padding: '20px 28px', borderRadius: 30, borderBottomRightRadius: m.me ? 8 : 30, borderBottomLeftRadius: m.me ? 30 : 8, background: m.me ? acc : 'rgba(255,255,255,.94)', color: m.me ? '#fff' : '#16181d', fontSize: tall ? 38 : 34, fontWeight: 600, lineHeight: 1.4, boxShadow: '0 14px 40px rgba(0,0,0,.25)' }}>
                  {shown ? (
                    m.text
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 9, padding: '6px 2px' }}>
                      {[0, 1, 2].map((d) => (
                        <span key={d} style={{ width: 12, height: 12, borderRadius: '50%', background: m.me ? '#fff' : '#8e8e93', opacity: 0.35 + 0.65 * Math.max(0, Math.sin((t * 6 - d * 0.9) * 1.2)) }} />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>,
        v.title,
      );
    }
    case 'quote': {
      const e = tween(t, 0, 0.7, 'power3.out');
      return wrap(
        <div style={{ ...card, width: '100%', maxWidth: tall ? undefined : 1250, padding: tall ? '60px 56px' : '64px 80px', background: 'rgba(255,255,255,.96)', opacity: e, transform: `translateY(${(1 - e) * 30}px)` }}>
          <div style={{ fontSize: 140, lineHeight: 0.5, color: acc, fontWeight: 900, height: 60 }}>“</div>
          <div style={{ fontSize: tall ? 50 : 52, fontWeight: 800, color: '#14161b', lineHeight: 1.4 }}>
            <AnimText text={v.text} anim="fadeup" t={t - 0.25} hi={acc} color="#14161b" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 40, opacity: tween(t, 1, 0.5) }}>
            <div style={{ width: 70, height: 70, borderRadius: '50%', background: `linear-gradient(135deg, ${acc}, ${rgba(acc, 0.45)})`, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: 32 }}>{(v.author ?? '?').slice(0, 1)}</div>
            <div>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#14161b' }}>{v.author}</div>
              {v.role ? <div style={{ fontSize: 24, color: '#5c6270' }}>{v.role}</div> : null}
            </div>
            {v.rating ? <div style={{ marginLeft: 'auto', color: '#ffb400', fontSize: 34, letterSpacing: 4 }}>{'★'.repeat(Math.round(v.rating))}</div> : null}
          </div>
        </div>,
      );
    }
    case 'checklist':
      return wrap(
        <div style={{ ...card, width: '100%', maxWidth: tall ? undefined : 1100, padding: '40px 56px' }}>
          {v.items.map((it, i) => {
            const at = 0.4 + i * 0.55;
            const e = tween(t, at, 0.35, 'power3.out');
            const ck = tween(t, at + 0.25, 0.3, 'power2.out');
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '20px 0', borderTop: i ? '1px solid rgba(255,255,255,.1)' : undefined, opacity: lerp(0.25, 1, e) }}>
                <svg width={56} height={56} viewBox="0 0 56 56" style={{ flex: 'none' }}>
                  <rect x={4} y={4} width={48} height={48} rx={12} fill={ck > 0 ? acc : 'none'} stroke={ck > 0 ? acc : 'rgba(255,255,255,.4)'} strokeWidth={3} />
                  <path d="M16 29 L25 38 L41 19" fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ck} />
                </svg>
                <span style={{ fontSize: tall ? 42 : 40, fontWeight: 700, color: '#fff', position: 'relative' }}>
                  {it}
                  <span style={{ position: 'absolute', left: 0, right: 0, bottom: 6, height: 14, background: rgba(hi, 0.35), transform: `scaleX(${ck})`, transformOrigin: 'left', zIndex: -1, borderRadius: 4 }} />
                </span>
              </div>
            );
          })}
        </div>,
        v.title,
      );
    case 'notifs':
      return wrap(
        <div style={{ width: tall ? '100%' : 760, position: 'relative', height: tall ? 900 : 640 }}>
          {v.items.map((it, i) => {
            const at = 0.3 + i * 0.45;
            const e = tween(t, at, 0.6, 'expo.out');
            const later = v.items.length - 1 - i;
            const depth = Math.min(later, Math.max(0, Math.floor((t - at) / 0.45)));
            return (
              <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${(1 - e) * -200 + depth * 34}px) scale(${1 - depth * 0.05})`, opacity: t < at ? 0 : 1 - depth * 0.18, zIndex: i, transformOrigin: 'top center' }}>
                <div style={{ display: 'flex', gap: 22, alignItems: 'center', padding: '24px 28px', borderRadius: 30, background: 'rgba(242,242,247,.9)', backdropFilter: 'blur(18px)', boxShadow: '0 20px 50px rgba(0,0,0,.35)' }}>
                  <div style={{ width: 70, height: 70, borderRadius: 18, background: `linear-gradient(135deg, ${acc}, ${rgba(acc, 0.55)})`, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: 32, flex: 'none' }}>{it.app.slice(0, 1)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: '#6e6e73', fontWeight: 600 }}>
                      <span>{it.app}</span>
                      <span>now</span>
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: '#1c1c1e', marginTop: 2 }}>{it.title}</div>
                    {it.body ? <div style={{ fontSize: 26, color: '#3a3a3c', marginTop: 2 }}>{it.body}</div> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>,
      );
    case 'flap':
      return wrap(
        <div style={{ padding: '34px 40px', borderRadius: 24, background: '#08090c', boxShadow: '0 40px 100px rgba(0,0,0,.6), inset 0 0 0 2px rgba(255,255,255,.05)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {v.rows.map((r, i) => (
            <div key={i} style={{ fontFamily: MONO, fontWeight: 800, fontSize: tall ? 54 : 64, letterSpacing: '0.02em' }}>
              <AnimText text={r} anim="flap" t={t - 0.15 - i * 0.15} hi={hi} color={i === 0 ? '#ffd166' : '#f5f1e6'} />
            </div>
          ))}
        </div>,
        v.title,
      );
    case 'compare': {
      const boxW = tall ? layout.W - 128 : 1500;
      const boxH = tall ? 1100 : 820;
      // Divider sweeps from mostly-before to mostly-after
      const e = EASE['power3.inOut'](clamp01((t - 0.6) / 1.6));
      const x = (0.88 - 0.76 * e) * boxW;
      const img = (src: string) => <Img src={staticFile(`${slug}/${src}`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
      return wrap(
        <div style={{ position: 'relative', width: boxW, height: boxH, borderRadius: 26, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,.5)' }}>
          {img(v.b)}
          <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${boxW - x}px 0 0)` }}>{img(v.a)}</div>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: x - 2, width: 4, background: '#fff', boxShadow: '0 0 20px rgba(0,0,0,.4)' }}>
            <div style={{ position: 'absolute', top: '50%', left: -26, width: 56, height: 56, marginTop: -28, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, color: '#111', fontSize: 24 }}>⇆</div>
          </div>
          {v.labelA ? <div style={{ position: 'absolute', left: 24, top: 24, padding: '8px 18px', borderRadius: 10, background: 'rgba(0,0,0,.6)', color: '#fff', fontWeight: 800, fontSize: 28 }}>{v.labelA}</div> : null}
          {v.labelB ? <div style={{ position: 'absolute', right: 24, top: 24, padding: '8px 18px', borderRadius: 10, background: acc, color: '#fff', fontWeight: 800, fontSize: 28 }}>{v.labelB}</div> : null}
        </div>,
      );
    }
    case 'counter':
      return wrap(
        <div style={{ textAlign: 'center' }}>
          <AnimText text={v.value} anim="count" t={t - 0.2} hi={hi} color={acc} style={{ fontSize: tall ? 210 : 240, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 60px ${rgba(acc, 0.35)}` }} />
          {v.label ? <div style={{ fontSize: tall ? 54 : 56, fontWeight: 800, color: '#fff', marginTop: 24, opacity: tween(t, 0.6, 0.5) }}>{v.label}</div> : null}
          {v.sub ? <div style={{ fontSize: tall ? 32 : 30, fontWeight: 500, color: 'rgba(255,255,255,.75)', marginTop: 12, opacity: tween(t, 0.9, 0.5) }}>{v.sub}</div> : null}
        </div>,
      );
    case 'terminal': {
      let at = 0.4;
      const rows: React.ReactNode[] = [];
      v.lines.forEach((l, i) => {
        const start = at;
        const typed = Math.min(l.cmd.length, Math.floor(Math.max(0, t - start) / 0.045));
        at += l.cmd.length * 0.045 + 0.35;
        const outAt = at;
        const out = (l.out ?? '').split('\n').filter(Boolean);
        at += out.length * 0.2 + 0.3;
        if (t < start) return;
        rows.push(
          <div key={`c${i}`}>
            <span style={{ color: '#3fcf8e' }}>❯ </span>
            {codeTokens(l.cmd.slice(0, typed), acc)}
            {typed < l.cmd.length ? <span style={{ display: 'inline-block', width: '0.55em', height: '1.05em', background: 'rgba(255,255,255,.8)', verticalAlign: '-0.15em' }} /> : null}
          </div>,
        );
        out.forEach((o, j) => {
          if (t >= outAt + j * 0.2) rows.push(<div key={`o${i}-${j}`} style={{ color: /✓|done|ok/i.test(o) ? '#3fcf8e' : 'rgba(230,230,230,.7)' }}>{o}</div>);
        });
      });
      return wrap(
        <div style={{ width: '100%', maxWidth: tall ? undefined : 1300, minHeight: tall ? 900 : 560, borderRadius: 22, overflow: 'hidden', background: '#0b0d11', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 40px 100px rgba(0,0,0,.55)', opacity: tween(t, 0, 0.35) }}>
          <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 22px', background: '#16191f' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <div key={c} style={{ width: 15, height: 15, borderRadius: '50%', background: c }} />
            ))}
            <span style={{ marginLeft: 14, color: 'rgba(255,255,255,.5)', fontFamily: MONO, fontSize: 20 }}>{v.title ?? 'terminal'}</span>
          </div>
          <div style={{ padding: '24px 30px', fontFamily: MONO, fontSize: tall ? 30 : 30, lineHeight: 1.65, color: '#e8e9ec', whiteSpace: 'pre-wrap' }}>{rows}</div>
        </div>,
      );
    }
  }
  return null;
};
