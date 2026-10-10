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
  minus: <path d="M3.5 8h9" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  fit: <path d="M2 3.5v9M14 3.5v9M4.5 8h7M6.5 6 4.5 8l2 2M9.5 6l2 2-2 2" />,
  export: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />,
  folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
};

export const Icon = ({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {P[name]}
  </svg>
);
