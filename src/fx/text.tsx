import React from 'react';
import { tokens, type Tok } from '../lib/timeline';
import { EASE, clamp01, hash, lerp, tween, type EaseName } from './ease';

// Per-unit start state; every unit eases from this to rest. Lengths in em, angles in degrees.
interface From {
  o?: number;
  x?: number;
  y?: number;
  s?: number;
  r?: number;
  rx?: number;
  blur?: number;
  ls?: number;
}

type Special = 'typewriter' | 'scramble' | 'decode' | 'glitch' | 'shimmer' | 'stagger' | 'slam' | 'explode' | 'swing' | 'stream' | 'wheel' | 'count' | 'highlight' | 'strike' | 'roll' | 'ticker' | 'flap' | 'weight' | 'reveal' | 'maskup';

export interface TextAnimDef {
  id: string;
  en: string;
  zh: string;
  // HyperFrames component the timing was taken from
  src: string;
  split: 'char' | 'word' | 'line' | 'all';
  dur: number;
  stagger: number;
  ease: EaseName;
  from: From;
  special?: Special;
  order?: 'start' | 'center';
  // Breaks the house style (pop/bounce or shake) when used for captions
  rule?: boolean;
  // Text format the effect expects, shown as a hint
  hint?: { en: string; zh: string };
}

export const TEXT_ANIMS: TextAnimDef[] = [
  { id: 'fadeup', en: 'Fade up', zh: '逐词上浮', src: 'staggered-fade-up', split: 'word', dur: 0.3, stagger: 0.055, ease: 'power3.out', from: { o: 0, y: 0.3, s: 0.92, blur: 0.07 } },
  { id: 'blurin', en: 'Blur in', zh: '模糊显现', src: 'blur-in', split: 'word', dur: 0.36, stagger: 0.04, ease: 'power3.out', from: { o: 0, y: 0.11, blur: 0.14 } },
  { id: 'softblur', en: 'Soft blur', zh: '柔焦整体', src: 'soft-blur-in', split: 'all', dur: 0.8, stagger: 0, ease: 'power3.out', from: { o: 0, y: 0.35, blur: 0.27 } },
  { id: 'focus', en: 'Focus pull', zh: '对焦拉清', src: 'focus-blur-resolve', split: 'word', dur: 0.52, stagger: 0.05, ease: 'power3.out', from: { o: 0, s: 1.08, blur: 0.22 } },
  { id: 'rise', en: 'Letter rise', zh: '逐字升起', src: 'per-word-rise', split: 'char', dur: 0.5, stagger: 0.03, ease: 'power3.out', from: { o: 0, y: 0.55, blur: 0.12 } },
  { id: 'lettersup', en: 'Letters up', zh: '字母弹起', src: 'bottom-up-letters', split: 'char', dur: 0.48, stagger: 0.025, ease: 'back.out', from: { o: 0, y: 0.6 }, rule: true },
  { id: 'lettersdown', en: 'Letters down', zh: '字母落下', src: 'top-down-letters', split: 'char', dur: 0.22, stagger: 0.035, ease: 'power3.out', from: { o: 0, y: -0.57 } },
  { id: 'lines', en: 'Line slide', zh: '逐行滑入', src: 'line-by-line-slide', split: 'line', dur: 0.34, stagger: 0.14, ease: 'power3.out', from: { o: 0, x: -0.5, y: 0.25, blur: 0.08 } },
  { id: 'tracking', en: 'Tracking in', zh: '字距收拢', src: 'tracking-in', split: 'all', dur: 0.9, stagger: 0, ease: 'power3.out', from: { o: 0, ls: 0.45, y: 0.15 } },
  { id: 'pop', en: 'Pop in', zh: '弹出', src: 'number-pop-in', split: 'word', dur: 0.4, stagger: 0.06, ease: 'back.out', from: { o: 0, y: 0.32, s: 0.82, blur: 0.11 }, rule: true },
  { id: 'flip3d', en: '3D flip', zh: '3D 翻入', src: 'stagger-cascade', split: 'char', dur: 0.5, stagger: 0.03, ease: 'power3.out', from: { o: 0, rx: 90 } },
  { id: 'zoomin', en: 'Zoom in', zh: '放大浮现', src: 'pull-back-reveal', split: 'all', dur: 0.6, stagger: 0, ease: 'expo.out', from: { o: 0, s: 0.7, blur: 0.1 } },
  { id: 'calm', en: 'Calm', zh: '平静淡入', src: 'titlecard-calm', split: 'all', dur: 1, stagger: 0, ease: 'power2.out', from: { o: 0, y: 0.25 } },
  { id: 'maskup', en: 'Mask rise', zh: '遮罩上升', src: 'line-swap', split: 'word', dur: 0.6, stagger: 0.06, ease: 'power4.out', from: {}, special: 'maskup' },
  { id: 'reveal', en: 'Wipe reveal', zh: '擦出文字', src: 'colorama-wipe', split: 'all', dur: 0.7, stagger: 0, ease: 'power3.inOut', from: {}, special: 'reveal' },
  { id: 'typewriter', en: 'Typewriter', zh: '打字机', src: 'typewriter', split: 'char', dur: 0, stagger: 0.045, ease: 'none', from: {}, special: 'typewriter' },
  { id: 'scramble', en: 'Scramble', zh: '乱码锁定', src: 'scramble-reveal', split: 'char', dur: 0, stagger: 0.04, ease: 'none', from: {}, special: 'scramble' },
  { id: 'decode', en: 'Decode', zh: '矩阵解码', src: 'matrix-decode', split: 'char', dur: 0.18, stagger: 0.035, ease: 'power2.out', from: { o: 0, y: 0.16 }, special: 'decode' },
  { id: 'glitch', en: 'RGB glitch', zh: 'RGB 故障', src: 'rgb-glitch-text', split: 'all', dur: 0.05, stagger: 0, ease: 'none', from: { o: 0 }, special: 'glitch' },
  { id: 'shimmer', en: 'Shimmer', zh: '流光扫过', src: 'text-shimmer', split: 'all', dur: 0.4, stagger: 0, ease: 'power2.out', from: { o: 0, y: 0.15 }, special: 'shimmer' },
  { id: 'stagger', en: 'Rise + shimmer', zh: '上浮加流光', src: 'text-stagger', split: 'word', dur: 0.54, stagger: 0.09, ease: 'power3.out', from: { o: 0, y: 0.65, blur: 0.19 }, special: 'stagger' },
  { id: 'slam', en: 'Slam', zh: '重锤砸入', src: 'headline-slam', split: 'all', dur: 0.42, stagger: 0, ease: 'expo.out', from: { o: 0, s: 1.6 }, special: 'slam', rule: true },
  { id: 'explode', en: 'Assemble', zh: '碎字聚合', src: 'char-slam-explode', split: 'char', dur: 0.6, stagger: 0.012, ease: 'back.out', from: { o: 0 }, special: 'explode', order: 'center', rule: true },
  { id: 'swing', en: 'Pendulum', zh: '吊牌摆动', src: 'pendulum-swing', split: 'all', dur: 0.3, stagger: 0, ease: 'power2.out', from: { o: 0 }, special: 'swing' },
  { id: 'stream', en: 'AI stream', zh: 'AI 流式输出', src: 'streaming-text', split: 'word', dur: 0, stagger: 0.07, ease: 'none', from: {}, special: 'stream' },
  { id: 'wheel', en: 'Digit wheel', zh: '数字滚轮', src: 'number-wheel', split: 'char', dur: 1.1, stagger: 0.05, ease: 'power3.out', from: {}, special: 'wheel', hint: { en: 'Digits roll to their value', zh: '数字逐位滚到目标值' } },
  { id: 'count', en: 'Count up', zh: '数字递增', src: 'count-up', split: 'all', dur: 1.6, stagger: 0, ease: 'power2.out', from: {}, special: 'count', hint: { en: 'Counts the first number, e.g. 12,800+', zh: '从 0 数到文字里的第一个数，例如 12,800+' } },
  { id: 'highlight', en: 'Marker', zh: '马克笔划重点', src: 'marker-highlight', split: 'all', dur: 0.45, stagger: 0, ease: 'power3.out', from: { o: 0, y: 0.15 }, special: 'highlight', hint: { en: 'Marks the [[bracketed]] words', zh: '给 [[双括号]] 里的词划重点' } },
  { id: 'strike', en: 'Strike + replace', zh: '划掉替换', src: 'strikethrough-replace', split: 'all', dur: 0.3, stagger: 0, ease: 'power2.out', from: { o: 0 }, special: 'strike', hint: { en: 'old|new', zh: '旧词|新词' } },
  { id: 'roll', en: 'Word roll', zh: '滚动换词', src: 'kinetic-type-swap', split: 'all', dur: 0.32, stagger: 0, ease: 'power4.out', from: {}, special: 'roll', hint: { en: 'one|two|three: rolls and lands on the last', zh: '甲|乙|丙：依次滚过，停在最后一个' } },
  { id: 'ticker', en: 'Ticker lock', zh: '老虎机定格', src: 'ticker-takeover', split: 'all', dur: 0.3, stagger: 0, ease: 'expo.out', from: {}, special: 'ticker', hint: { en: 'one|two|three: spins and locks on the last', zh: '甲|乙|丙：快速转动后锁定最后一个' } },
  { id: 'flap', en: 'Split-flap', zh: '机场翻牌', src: 'split-flap-board', split: 'char', dur: 0, stagger: 0.025, ease: 'none', from: {}, special: 'flap' },
  { id: 'weight', en: 'Weight wave', zh: '字重波浪', src: 'weight-wave', split: 'char', dur: 1.4, stagger: 0, ease: 'none', from: {}, special: 'weight' },
];

export const textAnim = (id?: string) => TEXT_ANIMS.find((a) => a.id === id);

// Total seconds an animation needs before the text is at rest
export function animLength(id: string | undefined, text: string): number {
  const a = textAnim(id);
  if (!a) return 0;
  const n = Math.max(1, [...text.replace(/\[\[|\]\]/g, '')].filter((c) => c.trim()).length);
  if (a.special === 'roll' || a.special === 'ticker') return text.split('|').length * (a.special === 'ticker' ? 0.18 : 0.55) + 0.4;
  return a.dur + a.stagger * n + 0.3;
}

interface Unit {
  key: string;
  s: string;
  hi: boolean;
  // Index among animated units
  i: number;
}
interface Word {
  units: Unit[];
  space?: boolean;
}

// Lines of words; each word holds its animated units (chars or itself)
function layoutUnits(text: string, split: TextAnimDef['split']): { lines: Word[][]; n: number } {
  let n = 0;
  const lines = text.split('\n').map((line, li) => {
    const toks: Tok[] = tokens(line);
    const words: Word[] = [];
    let lineIdx = -1;
    toks.forEach((t, ti) => {
      if (!t.s.trim()) return words.push({ units: [{ key: `${li}-${ti}`, s: t.s, hi: t.hi, i: -1 }], space: true });
      if (split === 'char') {
        const chars = Array.from(t.s);
        words.push({ units: chars.map((c, ci) => ({ key: `${li}-${ti}-${ci}`, s: c, hi: t.hi, i: n++ })) });
      } else if (split === 'word') words.push({ units: [{ key: `${li}-${ti}`, s: t.s, hi: t.hi, i: n++ }] });
      else {
        if (split === 'line' && lineIdx < 0) lineIdx = n++;
        words.push({ units: [{ key: `${li}-${ti}`, s: t.s, hi: t.hi, i: split === 'line' ? lineIdx : 0 }] });
      }
    });
    return words;
  });
  if (split === 'all') n = 1;
  return { lines, n };
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?';
const MATRIX = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ01234589';
const FLAP = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function unitStyle(a: TextAnimDef, k: number): React.CSSProperties {
  const f = a.from;
  const inv = 1 - k;
  const tf: string[] = [];
  const x = (f.x ?? 0) * inv;
  const y = (f.y ?? 0) * inv;
  if (x || y) tf.push(`translate(${x}em, ${y}em)`);
  if (f.s !== undefined) tf.push(`scale(${lerp(f.s, 1, k)})`);
  if (f.r) tf.push(`rotate(${f.r * inv}deg)`);
  if (f.rx) tf.push(`perspective(4em) rotateX(${f.rx * inv}deg)`);
  const st: React.CSSProperties = {};
  if (f.o !== undefined) st.opacity = lerp(f.o, 1, k);
  if (tf.length) st.transform = tf.join(' ');
  if (f.blur) st.filter = inv > 0.001 ? `blur(${f.blur * inv}em)` : undefined;
  if (f.ls !== undefined) st.letterSpacing = `${f.ls * inv}em`;
  return st;
}

// Format a count-up value with the target's separators and decimals
function countText(text: string, k: number): string {
  const m = /^([^\d]*)([\d,]+(?:\.\d+)?)([\s\S]*)$/.exec(text);
  if (!m) return text;
  const raw = m[2].replace(/,/g, '');
  const dec = raw.includes('.') ? raw.split('.')[1].length : 0;
  const v = Number(raw) * k;
  const s = dec ? v.toFixed(dec) : Math.round(v).toString();
  const withSep = m[2].includes(',') ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
  return m[1] + withSep + m[3];
}

export interface AnimTextProps {
  text: string;
  anim?: string;
  // Seconds since the text appeared
  t: number;
  color?: string;
  hi: string;
  style?: React.CSSProperties;
}

// Text with one of TEXT_ANIMS applied; no anim = static text
export const AnimText: React.FC<AnimTextProps> = ({ text, anim, t, color = '#fff', hi, style }) => {
  const a = textAnim(anim);
  const base: React.CSSProperties = { color, ...style };
  if (!a) return <div style={base}>{renderStatic(text, hi)}</div>;
  switch (a.special) {
    case 'count': {
      const k = tween(t, 0, a.dur, a.ease);
      const land = clamp01((t - a.dur) / 0.12);
      const back = clamp01((t - a.dur - 0.12) / 0.14);
      const s = 1 + 0.07 * land - 0.07 * back;
      return <div style={{ ...base, opacity: clamp01(t / 0.25), transform: `scale(${s})` }}>{renderStatic(countText(text, k), hi)}</div>;
    }
    case 'strike': {
      const [oldT, newT = ''] = text.split('|');
      const line = tween(t, 0.3, 0.28, 'power2.out');
      const nk = tween(t, 0.54, 0.3, 'power2.out');
      return (
        <div style={{ ...base, opacity: clamp01(t / 0.2) }}>
          <span style={{ position: 'relative', opacity: 1 - 0.45 * line }}>
            {renderStatic(oldT, hi)}
            <span style={{ position: 'absolute', left: '-0.05em', right: '-0.05em', top: '52%', height: '0.09em', background: hi, transform: `scaleX(${line})`, transformOrigin: 'left', borderRadius: '0.05em' }} />
          </span>
          {newT ? (
            <span style={{ display: 'inline-block', marginLeft: '0.35em', opacity: nk, transform: `translateY(${(1 - nk) * 0.19}em)`, color: hi }}>{renderStatic(newT, hi)}</span>
          ) : null}
        </div>
      );
    }
    case 'roll':
    case 'ticker': {
      const words = text.split('|').map((w) => w.trim()).filter(Boolean);
      const step = a.special === 'ticker' ? 0.16 : 0.55;
      const n = words.length;
      // Ticker accelerates then settles; roll keeps a steady beat
      const at = (i: number) => (a.special === 'ticker' ? 0.15 + step * Math.pow(i, 1.25) : 0.15 + i * step);
      const lockAt = at(n - 1);
      const flash = a.special === 'ticker' ? 1 - clamp01((t - lockAt) / 0.34) : 0;
      return (
        <div style={{ ...base, opacity: clamp01(t / 0.2) }}>
          <span style={{ display: 'inline-grid', overflow: 'hidden', verticalAlign: 'bottom', paddingBottom: '0.08em' }}>
            {words.map((w, i) => {
              const inK = i === 0 ? 1 : tween(t, at(i), a.special === 'ticker' ? 0.12 : 0.32, i === n - 1 ? a.ease : 'power4.out');
              const outK = i === n - 1 ? 0 : tween(t, at(i + 1), a.special === 'ticker' ? 0.1 : 0.22, 'power4.in');
              const y = (1 - inK) * 112 - outK * 112;
              const last = i === n - 1 && t >= lockAt;
              return (
                <span key={i} style={{ gridArea: '1 / 1', transform: `translateY(${y}%) scale(${last ? 1 + 0.14 * flash : 1})`, opacity: inK > 0 && outK < 1 ? 1 : 0, color: last && a.special === 'ticker' ? hi : undefined, textShadow: flash > 0 && last ? `0 0 ${0.4 * flash}em ${hi}` : undefined }}>
                  {renderStatic(w, hi)}
                </span>
              );
            })}
          </span>
        </div>
      );
    }
    case 'reveal': {
      const k = tween(t, 0.05, a.dur, a.ease);
      const edge = k < 1 ? `linear-gradient(90deg, #000 ${k * 100 - 6}%, transparent ${k * 100 + 6}%)` : undefined;
      return <div style={{ ...base, WebkitMaskImage: edge, maskImage: edge }}>{renderStatic(text, hi)}</div>;
    }
    case 'glitch': {
      const on = t > 0.1 && t < 0.46;
      const ph = Math.floor((t - 0.1) / 0.06) % 2 === 0 ? 1 : -1;
      const d = on ? 0.09 * ph : 0;
      return (
        <div style={{ ...base, opacity: t > 0 ? 1 : 0, textShadow: on ? `${d}em 0 0 rgba(255,40,80,.85), ${-d}em 0 0 rgba(40,220,255,.85)` : undefined, transform: on ? `skewX(${ph * 4}deg) translateX(${ph * 0.02}em)` : undefined }}>
          {renderStatic(text, hi)}
        </div>
      );
    }
    case 'swing': {
      const ang = t < 0 ? 14 : 14 * Math.exp(-2.2 * t) * Math.cos(2 * Math.PI * 1.05 * t);
      return <div style={{ ...base, opacity: clamp01(t / 0.2), transform: `rotate(${ang}deg)`, transformOrigin: '50% -0.6em' }}>{renderStatic(text, hi)}</div>;
    }
    case 'slam': {
      const k = tween(t, 0, a.dur, a.ease);
      const sh = t - a.dur;
      const frame = sh >= 0 && sh < 0.1 ? Math.floor(sh / 0.033) : -1;
      const off = [[0.06, -0.03], [-0.04, 0.02], [0, 0]][frame] ?? [0, 0];
      return <div style={{ ...base, opacity: clamp01(k * 1.4), transform: `translate(${off[0]}em, ${off[1]}em) scale(${lerp(1.6, 1, k)})` }}>{renderStatic(text, hi)}</div>;
    }
    case 'shimmer':
      return <ShimmerText a={a} text={text} t={t} base={base} hi={hi} split="all" />;
    case 'stagger':
      return <ShimmerText a={a} text={text} t={t} base={base} hi={hi} split="word" />;
  }
  return <div style={base}>{renderUnits(a, text, t, hi)}</div>;
};

function renderStatic(text: string, hi: string) {
  return text.split('\n').map((line, li) => (
    <React.Fragment key={li}>
      {li ? <br /> : null}
      {tokens(line).map((tk, i) => (
        <span key={i} style={tk.hi ? { color: hi } : undefined}>
          {tk.s}
        </span>
      ))}
    </React.Fragment>
  ));
}

const ShimmerText: React.FC<{ a: TextAnimDef; text: string; t: number; base: React.CSSProperties; hi: string; split: 'all' | 'word' }> = ({ a, text, t, base, hi, split }) => {
  const { lines } = layoutUnits(text, split);
  const color = (base.color as string) ?? '#fff';
  return (
    <div style={base}>
      {lines.map((words, li) => (
        <React.Fragment key={li}>
          {li ? <br /> : null}
          {words.map((w) =>
            w.units.map((u) => {
              if (u.i < 0) return <span key={u.key}>{u.s}</span>;
              const idx = split === 'all' ? 0 : u.i;
              const k = tween(t, idx * a.stagger, a.dur, a.ease);
              const sweepStart = split === 'all' ? 0.5 : 0.75 + idx * 0.04;
              const sw = tween(t, sweepStart, split === 'all' ? 1.1 : 0.72, 'sine.inOut');
              const c = u.hi ? hi : color;
              const active = sw > 0 && sw < 1;
              return (
                <span
                  key={u.key}
                  style={{
                    display: 'inline-block',
                    whiteSpace: 'pre',
                    ...unitStyle(a, k),
                    ...(active
                      ? { backgroundImage: `linear-gradient(100deg, ${c} 38%, #ffffff 50%, ${c} 62%)`, backgroundSize: '260% 100%', backgroundPosition: `${(1 - sw) * 100}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
                      : { color: c }),
                  }}
                >
                  {u.s}
                </span>
              );
            }),
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

function renderUnits(a: TextAnimDef, text: string, t: number, hi: string) {
  const { lines, n } = layoutUnits(text, a.split);
  const mid = (n - 1) / 2;
  const order = (i: number) => (a.order === 'center' ? Math.abs(i - mid) : i);
  // AI stream: words land in uneven bursts
  const streamAt: number[] = [];
  if (a.special === 'stream') {
    let tt = 0.1;
    for (let i = 0; i < n; ) {
      const burst = 1 + Math.floor(hash(i, 7) * 3);
      for (let j = 0; j < burst && i < n; j++, i++) streamAt[i] = tt;
      tt += 0.1 + hash(i, 3) * 0.16;
    }
  }
  const unit = (u: Unit) => {
    if (u.i < 0) return <span key={u.key}>{u.s}</span>;
    const start = order(u.i) * a.stagger;
    const color = u.hi ? hi : undefined;
    switch (a.special) {
      case 'typewriter': {
        const shown = t >= start;
        const last = shown && (u.i === n - 1 || t < (u.i + 1) * a.stagger);
        return (
          <React.Fragment key={u.key}>
            <span style={{ color, opacity: shown ? 1 : 0 }}>{u.s}</span>
            {last ? <span style={{ display: 'inline-block', width: '0.08em', height: '0.95em', margin: '0 -0.04em', verticalAlign: '-0.1em', background: hi, opacity: Math.floor(t / 0.27) % 2 === 0 ? 1 : 0 }} /> : null}
          </React.Fragment>
        );
      }
      case 'scramble': {
        const lock = 0.2 + start;
        const ch = t >= lock || !u.s.trim() ? u.s : GLYPHS[Math.floor(hash(u.i, Math.floor(t * 15)) * GLYPHS.length)];
        return (
          <span key={u.key} style={{ color: t >= lock ? color : 'rgba(255,255,255,.55)', opacity: t >= 0 ? 1 : 0, display: 'inline-block', minWidth: '0.55em', textAlign: 'center' }}>
            {ch}
          </span>
        );
      }
      case 'decode': {
        const k = tween(t, start, a.dur, a.ease);
        const lock = start + 0.28;
        const ch = t >= lock ? u.s : MATRIX[Math.floor(hash(u.i, Math.floor(t * 20)) * MATRIX.length)];
        return (
          <span key={u.key} style={{ display: 'inline-block', ...unitStyle(a, k), color: t >= lock ? color : '#5dffa8', minWidth: '0.55em', textAlign: 'center' }}>
            {ch}
          </span>
        );
      }
      case 'stream': {
        const at = streamAt[u.i] ?? 0;
        const k = clamp01((t - at) / 0.27);
        return (
          <span key={u.key} style={{ opacity: t >= at ? 1 : 0, color: k < 1 ? `color-mix(in srgb, #767676 ${(1 - k) * 100}%, ${color ?? 'currentColor'})` : color }}>
            {u.s}
          </span>
        );
      }
      case 'explode': {
        const k = tween(t, start, a.dur, a.ease);
        const inv = 1 - k;
        const x = (hash(u.i, 1) - 0.5) * 7 * inv;
        const y = (hash(u.i, 2) - 0.5) * 3.2 * inv;
        const r = (hash(u.i, 3) - 0.5) * 120 * inv;
        return (
          <span key={u.key} style={{ display: 'inline-block', whiteSpace: 'pre', color, opacity: clamp01(0.25 + k), transform: `translate(${x}em, ${y}em) rotate(${r}deg) scale(${lerp(0.5, 1, k)})` }}>
            {u.s}
          </span>
        );
      }
      case 'wheel': {
        if (!/\d/.test(u.s)) return <span key={u.key} style={{ color, opacity: clamp01(t / 0.3) }}>{u.s}</span>;
        const d = Number(u.s);
        const k = tween(t, start, a.dur, a.ease);
        const y = -(10 + d) * k;
        return (
          <span key={u.key} style={{ display: 'inline-block', height: '1.15em', overflow: 'hidden', verticalAlign: 'bottom', color }}>
            <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${y * 1.15}em)` }}>
              {Array.from({ length: 20 }, (_, i) => (
                <span key={i} style={{ height: '1.15em', lineHeight: '1.15em' }}>
                  {i % 10}
                </span>
              ))}
            </span>
          </span>
        );
      }
      case 'flap': {
        const target = u.s.toUpperCase();
        const ti = FLAP.indexOf(target);
        const steps = ti < 0 ? 8 : Math.min(12, Math.max(3, ti));
        const step = Math.floor((t - start) / 0.04);
        const done = step >= steps;
        const ch = t < start ? ' ' : done ? u.s : ti < 0 ? FLAP[1 + Math.floor(hash(u.i, step) * 36)] : FLAP[Math.max(0, ti - steps + step)];
        const flip = done ? 0 : ((t - start) % 0.04) / 0.04;
        return (
          <span key={u.key} style={{ display: 'inline-block', position: 'relative', minWidth: '0.72em', margin: '0 0.04em', padding: '0.04em 0.06em', textAlign: 'center', background: 'linear-gradient(#1c1f26 0 49%, #0f1115 51% 100%)', borderRadius: '0.08em', color: color ?? '#f5f1e6', boxShadow: 'inset 0 -0.02em 0 rgba(255,255,255,.06)', transform: `perspective(3em) rotateX(${flip * 50}deg)` }}>
            {ch === ' ' ? ' ' : ch}
          </span>
        );
      }
      case 'weight': {
        const crest = lerp(-2, n + 2, clamp01(t / a.dur));
        const g = Math.exp(-Math.pow(u.i - crest, 2) / 3);
        const passed = clamp01((crest - u.i) / 2);
        const w = Math.round(lerp(300, 900, Math.max(g, passed)));
        return (
          <span key={u.key} style={{ display: 'inline-block', whiteSpace: 'pre', color, fontWeight: w, fontVariationSettings: `'wght' ${w}`, opacity: clamp01(t / 0.2 + passed), transform: `skewX(${-8 * g}deg)` }}>
            {u.s}
          </span>
        );
      }
      case 'maskup': {
        const k = tween(t, start, a.dur, a.ease);
        return (
          <span key={u.key} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', paddingBottom: '0.06em' }}>
            <span style={{ display: 'inline-block', whiteSpace: 'pre', color, transform: `translateY(${(1 - k) * 110}%)` }}>{u.s}</span>
          </span>
        );
      }
      case 'highlight': {
        const k = tween(t, 0, a.dur, a.ease);
        const mark = u.hi ? tween(t, 0.45 + start, 0.55, 'power2.out') : 0;
        return (
          <span key={u.key} style={{ display: 'inline-block', whiteSpace: 'pre', ...unitStyle(a, k), backgroundImage: u.hi ? `linear-gradient(transparent 52%, ${hi} 52%, ${hi} 90%, transparent 90%)` : undefined, backgroundSize: `${mark * 100}% 100%`, backgroundRepeat: 'no-repeat' }}>
            {u.s}
          </span>
        );
      }
    }
    const k = tween(t, start, a.dur, a.ease);
    return (
      <span key={u.key} style={{ display: 'inline-block', whiteSpace: 'pre', color, ...unitStyle(a, k) }}>
        {u.s}
      </span>
    );
  };
  return lines.map((words, li) => (
    <React.Fragment key={li}>
      {li ? <br /> : null}
      {a.split === 'line' || a.split === 'all' ? (
        <span style={{ display: 'inline-block', whiteSpace: 'pre-wrap', ...unitStyle(a, tween(t, order(words.find((w) => !w.space)?.units[0].i ?? 0) * a.stagger, a.dur, a.ease)) }}>
          {words.map((w) => w.units.map((u) => <span key={u.key} style={u.hi ? { color: hi } : undefined}>{u.s}</span>))}
        </span>
      ) : (
        words.map((w, wi) =>
          w.space ? (
            unit(w.units[0])
          ) : w.units.length > 1 ? (
            <span key={wi} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
              {w.units.map(unit)}
            </span>
          ) : (
            unit(w.units[0])
          ),
        )
      )}
    </React.Fragment>
  ));
}

// Shared ease lookup for other effect modules
export { EASE };
