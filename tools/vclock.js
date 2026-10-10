// Virtual clock injected before page scripts: rAF, timers, Date, performance.now, CSS/WAAPI animations
(() => {
  if (window.__vt) return;
  const RealDate = Date;
  const perfBase = performance.now();
  const dateBase = RealDate.now();
  let now = 0;
  let rafId = 0;
  let timerId = 0;
  let raf = new Map();
  const timers = new Map();
  const starts = new WeakMap();

  performance.now = () => perfBase + now;
  class VDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(dateBase + now);
      else super(...a);
    }
    static now() {
      return dateBase + now;
    }
  }
  window.Date = VDate;

  window.requestAnimationFrame = (cb) => {
    raf.set(++rafId, cb);
    return rafId;
  };
  window.cancelAnimationFrame = (id) => raf.delete(id);
  const add = (fn, ms, args, every) => {
    timers.set(++timerId, { fn, at: now + Math.max(0, Number(ms) || 0), args, every });
    return timerId;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, 0);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, Math.max(1, Number(ms) || 0));
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  if (window.requestIdleCallback) {
    window.requestIdleCallback = (fn) => add(() => fn({ didTimeout: false, timeRemaining: () => 10 }), 1, [], 0);
    window.cancelIdleCallback = (id) => timers.delete(id);
  }

  const css = document.createElement('style');
  css.textContent = '*{scroll-behavior:auto!important}';
  const inject = () => (document.head || document.documentElement).appendChild(css);
  if (document.documentElement) inject();
  else document.addEventListener('DOMContentLoaded', inject);

  const runTimers = (target) => {
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every;
      else timers.delete(id);
      try {
        typeof t.fn === 'function' ? t.fn(...t.args) : (0, eval)(t.fn);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const syncAnimations = () => {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (a.timeline && a.timeline !== document.timeline) continue;
      if (!starts.has(a)) {
        starts.set(a, now - (a.currentTime || 0));
        a.pause();
      }
      try {
        a.currentTime = now - starts.get(a);
      } catch (e) {}
    }
  };

  // Looping autoplay clips (hover previews, background loops) follow virtual time instead of the wall clock
  const mediaStart = new WeakMap();
  const syncMedia = () => {
    for (const v of document.querySelectorAll('video')) {
      if (!v.loop || !v.autoplay) continue;
      if (!mediaStart.has(v)) mediaStart.set(v, now);
      if (!v.paused) v.pause();
      if (v.duration > 0) {
        const t = ((now - mediaStart.get(v)) / 1000) % v.duration;
        if (Math.abs(v.currentTime - t) > 0.001) v.currentTime = t;
      }
    }
  };

  window.__vt = {
    // Resolves once synced clips have decoded the frame they were moved to
    mediaReady() {
      const busy = [...document.querySelectorAll('video')].filter((v) => v.loop && v.autoplay && (v.seeking || v.readyState < 2));
      return Promise.all(busy.map((v) => new Promise((done) => {
        v.addEventListener('seeked', done, { once: true });
        v.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 1500);
      })));
    },
    get now() {
      return now;
    },
    advance(ms) {
      const target = now + ms;
      runTimers(target);
      now = target;
      const cbs = raf;
      raf = new Map();
      for (const cb of cbs.values()) {
        try {
          cb(perfBase + now);
        } catch (e) {
          console.error(e);
        }
      }
      syncAnimations();
      syncMedia();
      return now;
    },
  };
})();
