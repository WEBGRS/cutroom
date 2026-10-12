import React from 'react';

// 16px line icons, stroke follows currentColor
const P: Record<string, React.ReactNode> = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="4" y="3.5" width="2.6" height="9" rx=".6" fill="currentColor" stroke="none" />
      <rect x="9.4" y="3.5" width="2.6" height="9" rx=".6" fill="currentColor" stroke="none" />
    </>
  ),
  prev: (
    <>
      <path d="M12 4v8L6.5 8z" fill="currentColor" stroke="none" />
      <path d="M4.5 4v8" />
    </>
  ),
  next: (
    <>
      <path d="M4 4v8l5.5-4z" fill="currentColor" stroke="none" />
      <path d="M11.5 4v8" />
    </>
  ),
  split: (
    <>
      <circle cx="4.5" cy="4.5" r="2" />
      <circle cx="4.5" cy="11.5" r="2" />
      <path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2" />,
  undo: <path d="M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7" />,
  redo: <path d="m10.5 3.5 3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9" />,
  up: <path d="M8 13V3.5M4 7.5l4-4 4 4" />,
  down: <path d="M8 3v9.5M4 8.5l4 4 4-4" />,
  chev: <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />,
  minus: <path d="M3.5 8h9" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  fit: <path d="M2 3.5v9M14 3.5v9M4.5 8h7M6.5 6 4.5 8l2 2M9.5 6l2 2-2 2" />,
  export: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />,
  import: <path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />,
  folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  media: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="m2.5 11 3.5-3.5 2.5 2.5 2-2 3 3" />
      <circle cx="10.5" cy="6" r="1" />
    </>
  ),
  film: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M5 3v10M11 3v10M2 6.3h3M2 9.7h3M11 6.3h3M11 9.7h3" />
    </>
  ),
  cards: (
    <>
      <rect x="2" y="4.5" width="9" height="8" rx="1.5" />
      <path d="M5 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v6.5" />
    </>
  ),
  text: <path d="M3 4V3h10v1M8 3v10M6 13h4" />,
  trans: (
    <>
      <rect x="1.5" y="4" width="6" height="8" rx="1" />
      <rect x="8.5" y="4" width="6" height="8" rx="1" strokeDasharray="1.6 1.4" />
      <path d="M6 8h4M8.5 6.5 10 8 8.5 9.5" />
    </>
  ),
  filter: (
    <>
      <circle cx="6" cy="6.5" r="3.5" />
      <circle cx="10" cy="6.5" r="3.5" />
      <circle cx="8" cy="10" r="3.5" />
    </>
  ),
  music: (
    <>
      <path d="M6 12V3.5l7-1.5V10.5" />
      <circle cx="4.3" cy="12" r="1.8" />
      <circle cx="11.3" cy="10.5" r="1.8" />
    </>
  ),
  sfx: (
    <>
      <path d="M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5z" />
      <path d="M10.6 5.8a3.2 3.2 0 0 1 0 4.4M12.6 3.9a5.8 5.8 0 0 1 0 8.2" />
    </>
  ),
  cam: (
    <>
      <rect x="1.5" y="4.5" width="9" height="7" rx="1.5" />
      <path d="m10.5 7 4-2.2v6.4l-4-2.2" />
    </>
  ),
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />,
  screen: (
    <>
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" />
      <path d="M6 14h4M8 11v3" strokeLinecap="round" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" />
      <path d="M4 6.8h.01M6.3 6.8h.01M8.6 6.8h.01M10.9 6.8h.01M4.5 9.6h7" strokeLinecap="round" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4M8 4.9v.01" strokeLinecap="round" />
    </>
  ),
  mic: (
    <>
      <rect x="5.5" y="2" width="5" height="8" rx="2.5" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" />
    </>
  ),
  magnet: (
    <>
      <path d="M3.5 2.5h2.9v5.6a1.6 1.6 0 0 0 3.2 0V2.5h2.9v5.6a4.5 4.5 0 0 1-9 0z" strokeLinejoin="round" />
      <path d="M3.5 5.3h2.9M9.6 5.3h2.9" />
    </>
  ),
  bulb: (
    <>
      <path d="M5.6 10.4C4.4 9.5 3.7 8.2 3.7 6.8a4.3 4.3 0 0 1 8.6 0c0 1.4-.7 2.7-1.9 3.6-.4.3-.6.7-.6 1.1v.6H6.2v-.6c0-.4-.2-.8-.6-1.1z" strokeLinejoin="round" />
      <path d="M6.3 14.2h3.4" strokeLinecap="round" />
    </>
  ),
  download: <path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M2.5 11.5v2h11v-2" />,
  wait: <path className="spin" d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" strokeLinecap="round" />,
  beat: <path d="M1.5 8h2l1.5-4 2.5 9 2-7 1.5 2h3.5" />,
  sparkle: <path d="M8 2c.4 2.8 1.6 4.2 4.5 4.6-2.9.4-4.1 1.8-4.5 4.6-.4-2.8-1.6-4.2-4.5-4.6C6.4 6.2 7.6 4.8 8 2zM12.5 10.5c.2 1.2.7 1.8 2 2-1.3.2-1.8.8-2 2-.2-1.2-.7-1.8-2-2 1.3-.2 1.8-.8 2-2z" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path
        strokeLinejoin="round"
        d="M6.71 3.17L6.95 1.48L9.05 1.48L9.29 3.17A5 5 0 0 1 10.51 3.67L11.86 2.65L13.35 4.14L12.33 5.49A5 5 0 0 1 12.83 6.71L14.52 6.95L14.52 9.05L12.83 9.29A5 5 0 0 1 12.33 10.51L13.35 11.86L11.86 13.35L10.51 12.33A5 5 0 0 1 9.29 12.83L9.05 14.52L6.95 14.52L6.71 12.83A5 5 0 0 1 5.49 12.33L4.14 13.35L2.65 11.86L3.67 10.51A5 5 0 0 1 3.17 9.29L1.48 9.05L1.48 6.95L3.17 6.71A5 5 0 0 1 3.67 5.49L2.65 4.14L4.14 2.65L5.49 3.67A5 5 0 0 1 6.71 3.17Z"
      />
    </>
  ),
  wide: <rect x="1.5" y="4" width="13" height="8" rx="1.5" />,
  tall: <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />,
  cc: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
      <path d="M7 6.6a1.8 1.8 0 1 0 0 2.8M12 6.6a1.8 1.8 0 1 0 0 2.8" />
    </>
  ),
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7" />,
  warn: <path d="M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1" />,
  layers: <path d="m8 2 6 3.2-6 3.2-6-3.2zM2 8.2l6 3.2 6-3.2M2 11l6 3.2 6-3.2" />,
  board: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M6 6v7.5" />
    </>
  ),
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  target: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8 0.8v2.4M8 12.8v2.4M0.8 8h2.4M12.8 8h2.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z" />
    </>
  ),
};

export const Icon = ({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {P[name]}
  </svg>
);

// App mark: two clip rows and a playhead
export const Logo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
    <rect x="8" y="8" width="240" height="240" rx="56" fill="#3a66e8" />
    <rect x="40" y="78" width="100" height="42" rx="10" fill="#fff" />
    <rect x="148" y="78" width="68" height="42" rx="10" fill="#fff" fillOpacity=".55" />
    <rect x="40" y="136" width="66" height="42" rx="10" fill="#fff" fillOpacity=".55" />
    <rect x="114" y="136" width="102" height="42" rx="10" fill="#fff" />
    <rect x="123" y="58" width="9" height="142" rx="4.5" fill="#ff5a5f" />
  </svg>
);
