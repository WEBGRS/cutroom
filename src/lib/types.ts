export type Format = 'wide' | 'tall';

// zh may mark highlights with [[...]]
export interface Line {
  zh: string;
  en?: string;
  // Spoken form when it differs from the caption (zh / en)
  say?: string;
  sayEn?: string;
  at?: TimeRef;
}

// Time refs: seconds, or "@mark" / "@mark+1.5" resolved from capture events
export type TimeRef = number | string;

export interface ZoomKey {
  at: TimeRef;
  end: TimeRef;
  x: number;
  y: number;
  scale?: number;
}

export interface Overlay {
  at: number;
  dur?: number;
  // lower = lower third, sticker = big emoji, box = highlight frame, arrow = pointer, blur = privacy blur; the rest are in src/fx/overlays.tsx
  kind: 'punch' | 'tag' | 'note' | 'lower' | 'sticker' | 'box' | 'arrow' | 'blur' | 'spot' | 'cinema' | (string & {});
  only?: Format;
  text: string;
  sub?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  // Lower-third look, text animation, colour override, size multiplier, numeric value
  style?: string;
  anim?: string;
  color?: string;
  size?: number;
  value?: number;
  // Dark backing behind text, for text over bright footage
  plate?: boolean;
  // Image overlay: project file, entrance, rotation in degrees, gentle bob after landing
  src?: string;
  enter?: 'pop' | 'rise' | 'slide' | 'spin' | 'fade';
  rot?: number;
  float?: boolean;
}

export type Look = 'warm' | 'cool' | 'mono' | 'vintage' | 'vivid' | 'fade' | 'noir' | 'teal';
export type KenBurns = 'in' | 'out' | 'left' | 'right' | 'up' | 'down' | 'reveal';

// Per-scene effects; every field optional, absent = untouched
export interface Fx {
  look?: Look;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  hue?: number;
  blur?: number;
  vignette?: number;
  grain?: number;
  leak?: number;
  letterbox?: number;
  kenburns?: KenBurns;
  kbAmount?: number;
  motionBlur?: boolean;
  ripple?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  shake?: number;
  dim?: number;
  // Ported from HyperFrames: lens/grade passes and camera moves
  chroma?: number;
  glitch?: number;
  crt?: number;
  duotone?: string;
  bloom?: number;
  pixelate?: number;
  posterize?: number;
  drift?: number;
  focusIn?: number;
  stepped?: number;
}

export interface CaptionStyle {
  off?: boolean;
  style?: 'box' | 'outline' | 'plain';
  pos?: 'bottom' | 'middle' | 'top';
  scale?: number;
  anim?: 'fade' | 'pop' | 'word' | 'karaoke' | 'typewriter' | (string & {});
}

// Screen Studio-style wrapper around recordings
export interface FrameStyle {
  radius?: number;
  shadow?: number;
  inset?: number;
  glow?: boolean;
}

// A sound from the effect library (src/fx/sounds.ts): `at` seconds into the scene, or "@mark" on a screen recording
export interface SoundCue {
  id: string;
  at: TimeRef;
  // 1 = library level
  vol?: number;
}

export interface Sfx {
  whoosh?: boolean;
  click?: boolean;
  pop?: boolean;
  volume?: number;
}

export type Frame = 'window' | 'phone' | 'bare';

export interface ScreenVisual {
  kind: 'screen';
  src: string;
  from?: TimeRef;
  to?: TimeRef;
  rate?: number;
  zoom?: 'auto' | 'off';
  zooms?: ZoomKey[];
  base?: number;
  url?: string;
  cursor?: boolean;
  frame?: Frame;
}

export interface ScrollVisual {
  kind: 'scroll';
  src: string;
  from?: number;
  to?: number;
  url?: string;
  frame?: Frame;
}

export interface TitleVisual {
  kind: 'title';
  title: string;
  sub?: string;
  kicker?: string;
  bg?: string;
  // Text animation for the title (src/fx/text.tsx); absent = the classic per-word rise
  anim?: string;
}

export interface StatsVisual {
  kind: 'stats';
  title?: string;
  items: { value: string; label: string; en?: string }[];
}

export interface ClipVisual {
  kind: 'clip';
  src: string;
  from?: number;
  rate?: number;
  fit?: 'contain' | 'cover';
  frame?: Frame;
  ar?: number;
  url?: string;
  muted?: boolean;
  // Which part stays in view when cropped to fill (0..1 from the left / top; reframe sets it)
  pos?: [number, number];
}

export interface OutroVisual {
  kind: 'outro';
  title: string;
  url?: string;
  repo?: string;
  lines?: string[];
}

export interface FlowVisual {
  kind: 'flow';
  title?: string;
  cols: { label: string; sub?: string }[][];
}

export interface ImageVisual {
  kind: 'image';
  src: string;
  fit?: 'contain' | 'cover';
  frame?: Frame;
  url?: string;
  pos?: [number, number];
}

// Card scenes from src/fx/cards.tsx
export interface ChartVisual {
  kind: 'chart';
  title?: string;
  unit?: string;
  items: { label: string; value: number }[];
}
export interface CodeVisual {
  kind: 'code';
  title?: string;
  code: string;
}
export interface ChatVisual {
  kind: 'chat';
  title?: string;
  messages: { me?: boolean; name?: string; text: string }[];
}
export interface QuoteVisual {
  kind: 'quote';
  text: string;
  author?: string;
  role?: string;
  rating?: number;
}
export interface ChecklistVisual {
  kind: 'checklist';
  title?: string;
  items: string[];
}
export interface NotifsVisual {
  kind: 'notifs';
  items: { app: string; title: string; body?: string }[];
}
export interface FlapVisual {
  kind: 'flap';
  title?: string;
  rows: string[];
}
export interface CompareVisual {
  kind: 'compare';
  a: string;
  b: string;
  labelA?: string;
  labelB?: string;
}
export interface CounterVisual {
  kind: 'counter';
  value: string;
  label?: string;
  sub?: string;
}
export interface TerminalVisual {
  kind: 'terminal';
  title?: string;
  lines: { cmd: string; out?: string }[];
}

// An HTML page with seekable animation (a HyperFrames composition, or CSS/WAAPI/GSAP motion), in project/<src>
export interface HtmlVisual {
  kind: 'html';
  src: string;
  // Seconds into the page's own timeline where the scene starts
  from?: number;
  fit?: 'contain' | 'cover';
  frame?: Frame;
  url?: string;
  // Values for the page's declared variables (data-composition-variables)
  vars?: Record<string, string | number | boolean>;
}

export type Visual = HtmlVisual | ScreenVisual | ScrollVisual | TitleVisual | StatsVisual | ClipVisual | OutroVisual | FlowVisual | ImageVisual | ChartVisual | CodeVisual | ChatVisual | QuoteVisual | ChecklistVisual | NotifsVisual | FlapVisual | CompareVisual | CounterVisual | TerminalVisual;

export type Transition = 'fade' | 'slide' | 'wipe' | 'flip' | 'clock' | 'iris' | 'push' | 'zoom' | 'dip' | 'none' | (string & {});
export type Dir = 'left' | 'right' | 'up' | 'down';

export interface Scene {
  id: string;
  // Shot design: what this shot shows and how it is made (page or app, actions, camera), for people and the assistant
  shot?: string;
  lines: Line[];
  visual: Visual;
  tall?: Visual;
  overlays?: Overlay[];
  sounds?: SoundCue[];
  minSec?: number;
  lead?: number;
  tail?: number;
  transition?: Transition;
  transDur?: number;
  transDir?: Dir;
  only?: Format;
  fx?: Fx;
  // Starts a chapter (shown on the chapter bar)
  chapter?: string;
}

export interface Theme {
  accent: string;
  accent2?: string;
  bg?: [string, string];
  // Image behind everything instead of the gradient
  wallpaper?: string;
  wallBlur?: number;
  // Animated backdrop pattern (src/fx/backgrounds.tsx)
  bgFx?: string;
}

export interface Storyboard {
  slug: string;
  title: string;
  titleEn?: string;
  header?: string;
  headerEn?: string;
  fps?: number;
  // Size the video is made for; the editor opens in it
  format?: Format;
  theme: Theme;
  music?: { src: string; volume?: number; duck?: number; fadeIn?: number; fadeOut?: number };
  captions?: CaptionStyle;
  frame?: FrameStyle;
  sfx?: Sfx;
  // Frosted-glass stats/flow cards
  glass?: boolean;
  // Progress bar with chapter names along the bottom
  chapterBar?: boolean;
  cover?: { title: string; sub?: string; bg?: string; bgTall?: string; tag?: string };
  scenes: Scene[];
}

export interface VoiceClip {
  file: string;
  dur: number;
  // Caption (zh) the clip was made for; spoken = the exact text read, when it differs by language
  text?: string;
  spoken?: string;
  voice?: string;
}

export interface Timings {
  voice?: string;
  lang?: string;
  scenes: Record<string, VoiceClip[]>;
}

export interface CaptureEvent {
  t: number;
  type: 'move' | 'down' | 'up' | 'click' | 'key' | 'mark' | 'zoom' | 'unzoom' | 'scroll';
  x?: number;
  y?: number;
  name?: string;
  scale?: number;
}

export interface CaptureMeta {
  width: number;
  height: number;
  fps: number;
  dpr?: number;
  mobile?: boolean;
  duration: number;
  events: CaptureEvent[];
}

export type Props = {
  slug: string;
  format: Format;
  variant?: 'default' | 'clean';
  voice?: 'on' | 'off';
  lang?: 'zh' | 'en';
  board?: Storyboard;
  timings?: Timings;
  captures?: Record<string, CaptureMeta>;
  images?: Record<string, { w: number; h: number }>;
  // Bumped by the editor when project files change, so HTML scenes reload
  rev?: number;
  // 'picture': the image and the sound inside it only, for finishing in another editor
  parts?: 'all' | 'picture';
};
