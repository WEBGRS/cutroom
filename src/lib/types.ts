export type Format = 'wide' | 'tall';

// zh may mark highlights with [[...]]
export interface Line {
  zh: string;
  en?: string;
  say?: string;
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
  // lower = lower third, sticker = big emoji, box = highlight frame, arrow = pointer, blur = privacy blur
  kind: 'punch' | 'tag' | 'note' | 'lower' | 'sticker' | 'box' | 'arrow' | 'blur' | 'spot' | 'cinema';
  only?: Format;
  text: string;
  sub?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type Look = 'warm' | 'cool' | 'mono' | 'vintage' | 'vivid' | 'fade' | 'noir' | 'teal';
export type KenBurns = 'in' | 'out' | 'left' | 'right' | 'up' | 'down';

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
}

export interface CaptionStyle {
  off?: boolean;
  style?: 'box' | 'outline' | 'plain';
  pos?: 'bottom' | 'middle' | 'top';
  scale?: number;
  anim?: 'fade' | 'pop' | 'word' | 'karaoke' | 'typewriter';
}

// Screen Studio-style wrapper around recordings
export interface FrameStyle {
  radius?: number;
  shadow?: number;
  inset?: number;
  glow?: boolean;
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
}

export type Visual = ScreenVisual | ScrollVisual | TitleVisual | StatsVisual | ClipVisual | OutroVisual | FlowVisual | ImageVisual;

export type Transition = 'fade' | 'slide' | 'wipe' | 'flip' | 'clock' | 'iris' | 'push' | 'zoom' | 'dip' | 'none';
export type Dir = 'left' | 'right' | 'up' | 'down';

export interface BeatText {
  t: string;
  en?: string;
  n?: number;
}

export interface BeatGrid {
  bpm: number;
  period: number;
  beats: number[];
  downbeats: number[];
  duration: number;
}

export interface Scene {
  id: string;
  lines: Line[];
  beat?: BeatText[];
  visual: Visual;
  tall?: Visual;
  overlays?: Overlay[];
  minSec?: number;
  lead?: number;
  tail?: number;
  transition?: Transition;
  transDur?: number;
  transDir?: Dir;
  // Beat cut uses a 12-frame crossfade unless this names another transition
  beatTransition?: Transition;
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
}

export interface Storyboard {
  slug: string;
  title: string;
  titleEn?: string;
  header?: string;
  headerEn?: string;
  fps?: number;
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
  beat?: { music: string; startBar?: number; volume?: number };
  scenes: Scene[];
}

export interface VoiceClip {
  file: string;
  dur: number;
  text?: string;
}

export interface Timings {
  voice?: string;
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
  mode?: 'voice' | 'beat';
  grid?: BeatGrid;
  board?: Storyboard;
  timings?: Timings;
  captures?: Record<string, CaptureMeta>;
  images?: Record<string, { w: number; h: number }>;
};
