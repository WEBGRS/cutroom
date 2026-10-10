// GSAP-named easing curves, so timings ported from HyperFrames recipes keep their feel
export type EaseName =
  | 'none'
  | 'power1.out'
  | 'power2.out'
  | 'power3.out'
  | 'power4.out'
  | 'power1.in'
  | 'power2.in'
  | 'power3.in'
  | 'power4.in'
  | 'power1.inOut'
  | 'power2.inOut'
  | 'power3.inOut'
  | 'expo.out'
  | 'expo.in'
  | 'expo.inOut'
  | 'sine.inOut'
  | 'sine.out'
  | 'back.out'
  | 'circ.out'
  | 'elastic.out';

const pin = (k: number) => (t: number) => Math.pow(t, k);
const pout = (k: number) => (t: number) => 1 - Math.pow(1 - t, k);
const pinout = (k: number) => (t: number) => (t < 0.5 ? Math.pow(2 * t, k) / 2 : 1 - Math.pow(2 - 2 * t, k) / 2);

export const EASE: Record<EaseName, (t: number) => number> = {
  none: (t) => t,
  'power1.out': pout(2),
  'power2.out': pout(3),
  'power3.out': pout(4),
  'power4.out': pout(5),
  'power1.in': pin(2),
  'power2.in': pin(3),
  'power3.in': pin(4),
  'power4.in': pin(5),
  'power1.inOut': pinout(2),
  'power2.inOut': pinout(3),
  'power3.inOut': pinout(4),
  'expo.out': (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  'expo.in': (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  'expo.inOut': (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  'sine.inOut': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  'sine.out': (t) => Math.sin((t * Math.PI) / 2),
  // back.out(1.7)
  'back.out': (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  'circ.out': (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  'elastic.out': (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Progress of a tween that starts at `start` seconds and lasts `dur` seconds, eased
export const tween = (t: number, start: number, dur: number, ease: EaseName = 'power2.out') => EASE[ease](clamp01((t - start) / Math.max(1e-6, dur)));

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// Deterministic pseudo-random in [0,1) from integer seeds
export const hash = (...n: number[]) => {
  let h = 2166136261;
  for (const x of n) {
    h ^= Math.floor(x * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
};
