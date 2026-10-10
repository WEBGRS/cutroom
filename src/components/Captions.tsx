import React, { useMemo } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS } from '../lib/fonts';
import type { Layout } from '../lib/layout';
import { chunkLine, tokens, type Chunk, type Timeline, type Tok } from '../lib/timeline';
import type { CaptionStyle, Overlay, Theme } from '../lib/types';
import { Rich } from './Cards';

interface Cue {
  chunk: Chunk;
  en?: string;
  lineStart: number;
  lineEnd: number;
}

// Per-token reveal for caption animations: progress 0..1 across the chunk
function animToks(toks: Tok[], anim: CaptionStyle['anim'], prog: number, hi: string): React.ReactNode[] {
  const total = toks.reduce((a, t) => a + t.w, 0) || 1;
  const chars = toks.reduce((a, t) => a + t.s.length, 0) || 1;
  let acc = 0;
  let accChars = 0;
  return toks.map((t, i) => {
    const start = acc / total;
    acc += t.w;
    const c0 = accChars;
    accChars += t.s.length;
    const base: React.CSSProperties = t.hi ? { color: hi } : {};
    if (anim === 'word') return <span key={i} style={{ ...base, opacity: prog * 1.12 >= start ? 1 : 0 }}>{t.s}</span>;
    if (anim === 'karaoke') return <span key={i} style={{ color: prog >= start ? hi : 'rgba(255,255,255,.62)' }}>{t.s}</span>;
    if (anim === 'typewriter') {
      const n = Math.max(0, Math.min(t.s.length, Math.ceil(prog * 1.1 * chars) - c0));
      return (
        <span key={i} style={base}>
          {t.s.slice(0, n)}
          <span style={{ opacity: 0 }}>{t.s.slice(n)}</span>
        </span>
      );
    }
    return <span key={i} style={t.hi ? { color: hi } : undefined}>{t.s}</span>;
  });
}

const capTop = (layout: Layout, pos: CaptionStyle['pos']) => (pos === 'top' ? layout.H * (layout.H > layout.W ? 0.2 : 0.08) : pos === 'middle' ? layout.H * 0.46 : undefined);

export const Captions: React.FC<{ tl: Timeline; layout: Layout; theme: Theme; en?: boolean; cs?: CaptionStyle }> = ({ tl, layout, theme, en, cs }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cues = useMemo(() => {
    const out: Cue[] = [];
    for (const s of tl.scenes)
      for (const l of s.lines) {
        const a = s.start + l.start;
        const max = en ? (layout.H > layout.W ? 16 : 26) : layout.maxChars;
        for (const c of chunkLine(l.main, max, a, l.dur)) out.push({ chunk: c, en: l.sub, lineStart: a, lineEnd: a + l.dur });
      }
    return out;
  }, [tl, layout.maxChars, layout.H, layout.W, en]);
  const cue = cues.find((c) => f >= c.chunk.start && f < c.chunk.start + c.chunk.dur);
  if (!cue || cs?.off) return null;
  const age = f - cue.chunk.start;
  const a = interpolate(age, [0, 3], [0.4, 1], { extrapolateRight: 'clamp' });
  const hi = theme.accent2 ?? theme.accent;
  if (cs) {
    const k = cs.scale ?? 1;
    const style = cs.style ?? 'box';
    const pop = cs.anim === 'pop' ? spring({ frame: age, fps, config: { damping: 12, stiffness: 180 }, durationInFrames: 12 }) : 1;
    const prog = age / Math.max(1, cue.chunk.dur);
    const top = capTop(layout, cs.pos);
    const box: React.CSSProperties = style === 'box' ? { background: 'rgba(8,10,18,.74)', borderRadius: 16, padding: `${layout.zh * 0.2 * k}px ${layout.zh * 0.5 * k}px ${layout.zh * 0.24 * k}px`, boxShadow: '0 10px 30px rgba(0,0,0,.25)' } : {};
    const shadow = style === 'outline' ? `${OUTLINE}, 0 8px 26px rgba(0,0,0,.5)` : style === 'plain' ? '0 2px 12px rgba(0,0,0,.75)' : undefined;
    return (
      <AbsoluteFill style={{ fontFamily: SANS, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, ...(top !== undefined ? { top } : { bottom: layout.H - layout.capY }), display: 'flex', justifyContent: 'center' }}>
          <div style={{ ...box, textAlign: 'center', maxWidth: layout.W * 0.88, transform: `scale(${0.82 + 0.18 * pop})`, opacity: cs.anim === 'fade' || !cs.anim ? a : Math.min(1, pop * 1.5) }}>
            <div style={{ fontSize: (en ? layout.zh * 0.86 : layout.zh) * k, fontWeight: 800, color: '#fff', lineHeight: 1.25, textShadow: shadow }}>{animToks(cue.chunk.toks, cs.anim, prog, hi)}</div>
            {cue.en ? <div style={{ fontSize: layout.en * k, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.3, marginTop: 4, textShadow: shadow }}>{cue.en}</div> : null}
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ fontFamily: SANS, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: layout.H - layout.capY, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: 'rgba(8,10,18,.74)', borderRadius: 16, padding: `${layout.zh * 0.2}px ${layout.zh * 0.5}px ${layout.zh * 0.24}px`, textAlign: 'center', maxWidth: layout.W * 0.88, boxShadow: '0 10px 30px rgba(0,0,0,.25)' }}>
          <div style={{ fontSize: en ? layout.zh * 0.86 : layout.zh, fontWeight: 800, color: '#fff', lineHeight: 1.25, opacity: a }}>
            {cue.chunk.toks.map((t, i) => (
              <span key={i} style={t.hi ? { color: hi } : undefined}>
                {t.s}
              </span>
            ))}
          </div>
          {cue.en ? <div style={{ fontSize: layout.en, fontWeight: 500, color: 'rgba(255,255,255,.78)', lineHeight: 1.3, marginTop: 4 }}>{cue.en}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Newer overlay kinds; null for the original punch/tag/note
function extraOverlay(o: Overlay, key: number, age: number, d: number, out: number, p: number, layout: Layout, theme: Theme, fps: number): React.ReactNode {
  const W = layout.W;
  const H = layout.H;
  const tall = H > W;
  const cx = (o.x ?? 0.5) * W;
  const cy = (o.y ?? 0.5) * H;
  const w = (o.w ?? 0.3) * W;
  const h = (o.h ?? 0.2) * H;
  switch (o.kind) {
    case 'lower':
      return (
        <div key={key} style={{ position: 'absolute', left: W * 0.06, top: (o.y ?? (tall ? 0.62 : 0.7)) * H, opacity: out * p, transform: `translateX(${(1 - p) * -60}px)`, display: 'flex', alignItems: 'stretch', boxShadow: '0 18px 50px rgba(0,0,0,.35)' }}>
          <div style={{ width: 12, background: theme.accent }} />
          <div style={{ background: 'rgba(255,255,255,.96)', padding: `${layout.zh * 0.22}px ${layout.zh * 0.5}px` }}>
            <div style={{ fontSize: layout.zh * 0.8, fontWeight: 900, color: '#111' }}>
              <Rich text={o.text} color={theme.accent} />
            </div>
            {o.sub ? <div style={{ fontSize: layout.zh * 0.42, fontWeight: 600, color: '#444', marginTop: 2 }}>{o.sub}</div> : null}
          </div>
        </div>
      );
    case 'sticker':
      return (
        <div key={key} style={{ position: 'absolute', left: cx, top: cy, transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * p}) rotate(-8deg)`, opacity: out * p, fontSize: layout.zh * 2.6, filter: 'drop-shadow(0 10px 20px rgba(0,0,0,.35))' }}>
          {o.text}
        </div>
      );
    case 'box':
      return (
        <div key={key} style={{ position: 'absolute', left: cx - w / 2, top: cy - h / 2, width: w, height: h, opacity: out * p, transform: `scale(${1.06 - 0.06 * p})`, border: `6px solid ${theme.accent}`, borderRadius: 16, boxShadow: `0 0 0 9999px rgba(0,0,0,${0.28 * p}), 0 0 34px ${theme.accent}` }}>
          {o.text ? <div style={{ position: 'absolute', left: -6, bottom: '100%', marginBottom: 10, background: theme.accent, color: '#fff', fontSize: layout.zh * 0.5, fontWeight: 800, padding: '4px 14px', borderRadius: 8, whiteSpace: 'nowrap' }}>{o.text}</div> : null}
        </div>
      );
    case 'arrow': {
      const tx = cx + (o.w ?? 0.14) * W;
      const ty = cy + (o.h ?? 0.12) * H;
      const len = Math.hypot(tx - cx, ty - cy);
      const ang = Math.atan2(cy - ty, cx - tx);
      const head = 26;
      return (
        <AbsoluteFill key={key} style={{ opacity: out }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <line x1={tx} y1={ty} x2={cx - Math.cos(ang) * head * 0.6} y2={cy - Math.sin(ang) * head * 0.6} stroke={theme.accent} strokeWidth={10} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
            {p > 0.7 ? <polygon points={`0,0 ${-head},${-head * 0.6} ${-head},${head * 0.6}`} fill={theme.accent} transform={`translate(${cx},${cy}) rotate(${(ang * 180) / Math.PI})`} /> : null}
          </svg>
          {o.text ? <div style={{ position: 'absolute', left: tx, top: ty, transform: 'translate(-10%, 10%)', background: theme.accent, color: '#fff', fontSize: layout.zh * 0.55, fontWeight: 800, padding: '6px 16px', borderRadius: 10, opacity: p, whiteSpace: 'nowrap' }}>{o.text}</div> : null}
        </AbsoluteFill>
      );
    }
    case 'blur':
      return <div key={key} style={{ position: 'absolute', left: cx - w / 2, top: cy - h / 2, width: w, height: h, borderRadius: 14, backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', background: 'rgba(255,255,255,.08)', opacity: out * Math.min(1, p * 2) }} />;
    case 'spot': {
      const r = (o.w ?? 0.12) * Math.min(W, H);
      const fadeIn = interpolate(age, [0, 0.3 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      return <AbsoluteFill key={key} style={{ opacity: out * fadeIn, background: `radial-gradient(circle at ${cx}px ${cy}px, rgba(0,0,0,0) ${r}px, rgba(0,0,0,.66) ${r + 2}px)` }} />;
    }
    case 'cinema': {
      // Cinematic title: blur-in, slow shrink, letter spacing settles
      const blur = interpolate(age, [0, 8], [14, 0], { extrapolateRight: 'clamp' });
      const k = interpolate(age, [0, d], [1.1, 1], { extrapolateRight: 'clamp' });
      const ls = interpolate(age, [0, d], [0.32, 0.14], { extrapolateRight: 'clamp' });
      return (
        <AbsoluteFill key={key} style={{ justifyContent: 'center', alignItems: 'center', opacity: out * Math.min(1, age / 6) }}>
          <div style={{ fontSize: tall ? 120 : 140, fontWeight: 900, color: '#fff', letterSpacing: `${ls}em`, transform: `scale(${k})`, filter: `blur(${blur}px)`, textShadow: '0 10px 40px rgba(0,0,0,.6)', textAlign: 'center' }}>
            <Rich text={o.text} color={theme.accent} />
          </div>
          {o.sub ? <div style={{ fontSize: tall ? 40 : 44, fontWeight: 600, color: 'rgba(255,255,255,.88)', marginTop: 14, letterSpacing: '0.3em' }}>{o.sub}</div> : null}
        </AbsoluteFill>
      );
    }
    default:
      return null;
  }
}

export const Overlays: React.FC<{ items: Overlay[]; layout: Layout; theme: Theme }> = ({ items, layout, theme }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily: SANS, pointerEvents: 'none' }}>
      {items.map((o, i) => {
        if (o.only && o.only !== (layout.H > layout.W ? 'tall' : 'wide')) return null;
        const a = Math.round(o.at * fps);
        const d = Math.round((o.dur ?? 1.6) * fps);
        if (f < a || f > a + d) return null;
        const p = spring({ frame: f - a, fps, config: { damping: 200 }, durationInFrames: 10 });
        const out = interpolate(f, [a + d - 8, a + d], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        if (o.kind === 'punch') {
          return (
            <AbsoluteFill key={i} style={{ justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ transform: `scale(${0.92 + 0.08 * p})`, opacity: out * p, background: theme.accent, color: '#fff', fontSize: layout.H > layout.W ? 120 : 132, fontWeight: 900, padding: '10px 48px 18px', borderRadius: 28, boxShadow: '0 30px 80px rgba(0,0,0,.45)', textAlign: 'center' }}>
                {o.text}
                {o.sub ? <div style={{ fontSize: 40, fontWeight: 600, opacity: 0.9 }}>{o.sub}</div> : null}
              </div>
            </AbsoluteFill>
          );
        }
        const tall = layout.H > layout.W;
        const extra = extraOverlay(o, i, f - a, d, out, p, layout, theme, fps);
        if (extra) return extra;
        const x = (o.x ?? 0.5) * layout.W;
        const y = (tall ? Math.max(0.2, Math.min(0.68, o.y ?? 0.15)) : o.y ?? 0.15) * layout.H;
        if (o.kind === 'tag') {
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${0.94 + 0.06 * p})`, opacity: out * p, background: '#fff', color: '#111', fontSize: layout.zh * 0.72, fontWeight: 800, padding: '10px 26px', borderRadius: 999, boxShadow: `0 14px 40px rgba(0,0,0,.35), 0 0 0 4px ${theme.accent}` }}>
              <Rich text={o.text} color={theme.accent} />
              {o.sub ? <span style={{ fontWeight: 500, opacity: 0.6, marginLeft: 12, fontSize: '0.7em' }}>{o.sub}</span> : null}
            </div>
          );
        }
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, opacity: out * p, transform: `translateX(${(1 - p) * -30}px)`, borderLeft: `8px solid ${theme.accent}`, background: 'rgba(8,10,18,.8)', color: '#fff', padding: '18px 28px', borderRadius: 12, fontSize: layout.zh * 0.66, fontWeight: 700, maxWidth: layout.W * 0.42 }}>
            <Rich text={o.text} color={theme.accent} />
            {o.sub ? <div style={{ fontSize: '0.62em', fontWeight: 500, opacity: 0.75, marginTop: 6 }}>{o.sub}</div> : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// Bottom progress bar with chapter names (scenes that set `chapter`)
export const ChapterBar: React.FC<{ tl: Timeline; layout: Layout; theme: Theme }> = ({ tl, layout, theme }) => {
  const f = useCurrentFrame();
  const chapters = tl.scenes.filter((s) => s.scene.chapter).map((s) => ({ name: s.scene.chapter!, at: Math.max(0, s.start) }));
  if (!chapters.length) return null;
  const { W } = layout;
  const total = Math.max(1, tl.total);
  const barH = 8;
  const cur = chapters.filter((c) => c.at <= f).pop();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: SANS }}>
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: W, height: barH, background: 'rgba(255,255,255,.18)' }}>
        <div style={{ width: `${(f / total) * 100}%`, height: '100%', background: theme.accent }} />
        {chapters.slice(1).map((c, i) => (
          <div key={i} style={{ position: 'absolute', left: (c.at / total) * W, top: 0, width: 3, height: barH, background: 'rgba(0,0,0,.6)' }} />
        ))}
      </div>
      {chapters.map((c, i) => (
        <div key={`n${i}`} style={{ position: 'absolute', left: (c.at / total) * W + 10, bottom: barH + 6, fontSize: layout.H > layout.W ? 24 : 20, fontWeight: 700, color: c === cur ? '#fff' : 'rgba(255,255,255,.55)', textShadow: '0 1px 6px rgba(0,0,0,.75)' }}>
          {c.name}
        </div>
      ))}
    </AbsoluteFill>
  );
};

export const TallHeader: React.FC<{ title: string; en?: string; theme: Theme }> = ({ title, en, theme }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', fontFamily: SANS, padding: '0 50px' }}>
    <div style={{ fontSize: 68, fontWeight: 900, color: '#fff', lineHeight: 1.15, textShadow: '0 0 4px rgba(0,0,0,.85), 0 6px 30px rgba(0,0,0,.5)' }}>
      <Rich text={title} color={theme.accent2 ?? theme.accent} />
    </div>
    {en ? <div style={{ fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,.92)', marginTop: 4, textShadow: '0 0 3px rgba(0,0,0,.9), 0 2px 10px rgba(0,0,0,.6)' }}>{en}</div> : null}
  </div>
);

const OUTLINE = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]].map(([x, y]) => `${x}px ${y}px 0 rgba(0,0,0,.85)`).join(', ');

// Beat-cut on-screen text: big phrases that pop in on their beat
export const BeatCaptions: React.FC<{ tl: Timeline; layout: Layout; theme: Theme; period: number; cs?: CaptionStyle }> = ({ tl, layout, theme, period, cs }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tall = layout.H > layout.W;
  let cur: { main: string; sub?: string; start: number; end: number } | null = null;
  for (const s of tl.scenes)
    for (const l of s.lines) {
      const a = s.start + l.start;
      if (f >= a && f < a + l.dur) cur = { main: l.main, sub: l.sub, start: a, end: a + l.dur };
    }
  if (!cur || !cur.main.trim() || cs?.off) return null;
  const age = f - cur.start;
  const fadeIn = interpolate(age, [0, 5], [0, 1], { extrapolateRight: 'clamp' });
  const out = interpolate(f, [cur.end - 5, cur.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // One line only: shrink long phrases to fit the width
  const ems = [...cur.main.replace(/\[\[|\]\]/g, '')].reduce((a, ch) => a + (/[⺀-鿿＀-￯]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.58), 0);
  const size = Math.min(tall ? 86 : 96, Math.floor((layout.W - 100) / Math.max(1, ems)));
  const hi = theme.accent2 ?? theme.accent;
  if (cs) {
    const k = cs.scale ?? 1;
    const pop = cs.anim === 'pop' ? spring({ frame: age, fps, config: { damping: 12, stiffness: 180 }, durationInFrames: 12 }) : 1;
    const top = capTop(layout, cs.pos);
    const box: React.CSSProperties = cs.style === 'box' ? { background: 'rgba(8,10,18,.74)', borderRadius: 18, padding: '8px 28px 12px', display: 'inline-block' } : {};
    const shadow = cs.style === 'plain' ? '0 2px 12px rgba(0,0,0,.75)' : cs.style === 'box' ? undefined : `${OUTLINE}, 0 10px 34px rgba(0,0,0,.55)`;
    return (
      <AbsoluteFill style={{ fontFamily: SANS, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 40, right: 40, ...(top !== undefined ? { top } : { bottom: tall ? 340 : 96 }), textAlign: 'center', whiteSpace: 'nowrap', opacity: Math.min(fadeIn, out), transform: `scale(${0.82 + 0.18 * pop})` }}>
          <div style={box}>
            <div style={{ fontSize: size * k, fontWeight: 900, color: '#fff', lineHeight: 1.15, textShadow: shadow, letterSpacing: '0.01em' }}>{animToks(tokens(cur.main), cs.anim, age / Math.max(1, cur.end - cur.start), hi)}</div>
            {cur.sub ? <div style={{ fontSize: (tall ? 30 : 32) * k, fontWeight: 700, color: 'rgba(255,255,255,.92)', marginTop: 10, textShadow: shadow }}>{cur.sub}</div> : null}
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ fontFamily: SANS, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 40, right: 40, bottom: tall ? 340 : 96, textAlign: 'center', whiteSpace: 'nowrap', opacity: Math.min(fadeIn, out) }}>
        <div style={{ fontSize: size, fontWeight: 900, color: '#fff', lineHeight: 1.15, textShadow: `${OUTLINE}, 0 10px 34px rgba(0,0,0,.55)`, letterSpacing: '0.01em' }}>
          {tokens(cur.main).map((t, i) => (
            <span key={i} style={t.hi ? { color: hi } : undefined}>
              {t.s}
            </span>
          ))}
        </div>
        {cur.sub ? <div style={{ fontSize: tall ? 30 : 32, fontWeight: 700, color: 'rgba(255,255,255,.92)', marginTop: 10, textShadow: OUTLINE }}>{cur.sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};
