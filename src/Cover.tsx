import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Backdrop } from './components/Chrome';
import { SANS } from './lib/fonts';
import { tokens } from './lib/timeline';
import type { Storyboard } from './lib/types';

export type CoverProps = {
  slug: string;
  aspect: '169' | '43' | '34' | '916';
  board?: Storyboard;
};

const shadow = '0 40px 120px rgba(0,0,0,.6)';

// Thumbnail: screenshot + huge two-line title
export const Cover: React.FC<CoverProps> = ({ slug, aspect, board }) => {
  if (!board?.cover) return null;
  const { title, sub, bg, bgTall, tag } = board.cover;
  const theme = board.theme;
  const portrait = aspect === '34' || aspect === '916';
  // Shrink the title to fit the longest line (CJK ~1em, Latin ~0.58em)
  const avail = { '169': 980, '43': 1240, '34': 930, '916': 930 }[aspect];
  const ems = Math.max(...title.split('\n').map((l) => [...l.replace(/\[\[|\]\]/g, '')].reduce((a, ch) => a + (/[⺀-鿿＀-￯]/.test(ch) ? 1 : 0.58), 0)));
  const size = Math.min({ '169': 150, '43': 140, '34': 140, '916': 150 }[aspect], Math.floor(avail / Math.max(1, ems)));
  const img = portrait ? bgTall ?? bg : bg;
  const place: Record<CoverProps['aspect'], React.CSSProperties> = {
    '169': { right: -140, top: 250, width: 1000, transform: 'rotate(-4deg)' },
    '43': { right: -160, top: 690, width: 1000, transform: 'rotate(-4deg)' },
    '34': bgTall ? { right: 70, top: 680, width: 640, transform: 'rotate(3deg)' } : { left: 60, bottom: 70, width: 960 },
    '916': bgTall ? { left: 140, top: 860, width: 800, transform: 'rotate(3deg)' } : { left: 60, bottom: 120, width: 960 },
  };
  const text: Record<CoverProps['aspect'], React.CSSProperties> = {
    '169': { left: 90, top: 290, right: 850 },
    '43': { left: 90, top: 170, right: 90 },
    '34': { left: 70, top: 110, right: 70 },
    '916': { left: 70, top: 200, right: 70 },
  };
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Backdrop theme={theme} />
      {img ? <Img src={staticFile(`${slug}/${img}`)} style={{ position: 'absolute', borderRadius: 28, boxShadow: shadow, ...place[aspect] }} /> : null}
      <div style={{ position: 'absolute', ...text[aspect] }}>
        {tag ? <div style={{ display: 'inline-block', background: theme.accent, color: '#fff', fontWeight: 900, fontSize: size * 0.34, padding: '8px 26px', borderRadius: 14, marginBottom: 28 }}>{tag}</div> : null}
        {title.split('\n').map((l, i) => (
          <div key={i} style={{ fontSize: size, fontWeight: 900, lineHeight: 1.12, color: '#fff', textShadow: '0 8px 30px rgba(0,0,0,.5)' }}>
            {tokens(l).map((t, k) => (
              <span key={k} style={t.hi ? { color: theme.accent2 ?? theme.accent } : undefined}>
                {t.s}
              </span>
            ))}
          </div>
        ))}
        {sub ? <div style={{ fontSize: size * 0.3, color: 'rgba(255,255,255,.88)', fontWeight: 600, marginTop: 24 }}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};
