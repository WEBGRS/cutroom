// HTML scenes: any HTML page with seekable animation, played frame by frame (HyperFrames compositions included)

// Declared composition variable (HyperFrames `data-composition-variables`)
export interface HtmlVar {
  id: string;
  type?: string;
  label?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: unknown[];
}

export interface HtmlMeta {
  id?: string;
  w: number;
  h: number;
  dur?: number;
  vars: HtmlVar[];
  // data-composition-src files it mounts
  subs: string[];
  // Scripts and styles loaded from other sites (need internet at export)
  remote: string[];
}

// Runs inside the scene's iframe before the page's own scripts. Owns the clock: the page never plays by itself.
// Contract (same as HyperFrames): paused GSAP timelines on window.__timelines, finite CSS/WAAPI animations,
// timed elements with data-start/data-duration, Anime.js on __hfAnime, Lottie on __hfLottie, Three.js via hf-seek.
const RUNTIME = String.raw`(function () {
  var W = window, D = document;
  if (W.__cutroom) return;
  W.__timelines = W.__timelines || {};
  W.__hfAnime = W.__hfAnime || [];
  W.__hfLottie = W.__hfLottie || [];
  W.__hf = W.__hf || {};
  W.__hf.buildReady = W.__hf.buildReady || {};
  var VARS = __VARS__;
  W.__hfVariables = VARS;
  W.__hyperframes = W.__hyperframes || {};
  W.__hyperframes.getVariables = function () { return VARS; };
  var seed = 0x2545f491;
  Math.random = function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  var starts = new Map(), durs = new Map();
  function root() { return D.querySelector('[data-root="true"]') || D.querySelector('[data-composition-id]'); }
  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : null; }
  function byId(id) {
    return D.getElementById(id) || D.querySelector('[data-composition-id="' + (W.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  }
  // Start of the composition an element sits in (nested hosts other than the root)
  function compBase(el) {
    var r = root();
    for (var p = el.parentElement; p && p !== r; p = p.parentElement)
      if (p.hasAttribute('data-composition-id') && p.hasAttribute('data-start')) return start(p);
    return 0;
  }
  function start(el) {
    if (starts.has(el)) return starts.get(el);
    starts.set(el, 0);
    var v = 0;
    if (el !== root()) {
      var raw = (el.getAttribute('data-start') || '').trim();
      if (raw === '' || isFinite(Number(raw))) v = compBase(el) + (Number(raw) || 0);
      else {
        // "intro", "intro + 2", "intro - 0.5": after that clip ends
        var m = /^(.*?)(?:\s+([+-])\s+(\d*\.?\d+))?$/.exec(raw), ref = byId(m[1]);
        if (ref && ref !== el && ref.hasAttribute('data-start')) { var d = dur(ref); v = start(ref) + (d == null ? 0 : d); }
        if (m[2]) v += (m[2] === '-' ? -1 : 1) * Number(m[3]);
      }
    }
    starts.set(el, v);
    return v;
  }
  function dur(el) {
    if (durs.has(el)) return durs.get(el);
    var d = n(el.getAttribute('data-duration'));
    if (d == null) {
      if (el.tagName === 'IMG') d = 3;
      else if ((el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && isFinite(el.duration))
        d = (el.duration - (n(el.getAttribute('data-media-start')) || 0)) / (n(el.getAttribute('data-playback-rate')) || 1);
    }
    durs.set(el, d);
    return d;
  }
  function timedUp(el) {
    for (var p = el; p && p.nodeType === 1; p = p.parentElement) if (p.hasAttribute('data-start')) return p;
    return null;
  }
  function keyBase(k) {
    var all = D.querySelectorAll('[data-composition-id="' + (W.CSS && CSS.escape ? CSS.escape(k) : k) + '"]');
    var el = all[all.length - 1];
    return el && el !== root() ? start(el) : 0;
  }
  function size() {
    var r = root();
    return { w: (r && n(r.getAttribute('data-width'))) || 1920, h: (r && n(r.getAttribute('data-height'))) || 1080 };
  }
  function length() {
    var r = root(), d = r ? n(r.getAttribute('data-duration')) : null;
    if (d != null) return d;
    starts = new Map(); durs = new Map();
    d = 0;
    for (var k in W.__timelines) { var tl = W.__timelines[k]; if (tl && tl.duration) d = Math.max(d, keyBase(k) + tl.duration()); }
    D.querySelectorAll('[data-start]').forEach(function (el) { var x = dur(el); if (x != null && el !== r) d = Math.max(d, start(el) + x); });
    (D.getAnimations ? D.getAnimations() : []).forEach(function (a) {
      var c = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (c && isFinite(c.endTime)) d = Math.max(d, c.endTime / 1000);
    });
    return d || null;
  }
  function layout() {
    var r = root();
    if (!r) return;
    var s = size();
    r.style.width = s.w + 'px';
    r.style.height = s.h + 'px';
    if (getComputedStyle(r).position === 'static') r.style.position = 'relative';
    // Every composition root and host gets its pixel size, as HyperFrames stamps it
    D.querySelectorAll('[data-composition-id][data-width][data-height]').forEach(function (el) {
      if (el === r) return;
      if (!el.style.width) el.style.width = n(el.getAttribute('data-width')) + 'px';
      if (!el.style.height) el.style.height = n(el.getAttribute('data-height')) + 'px';
    });
    for (var c = r.firstElementChild; c; c = c.nextElementSibling) {
      if (!c.hasAttribute('data-start')) continue;
      var cs = getComputedStyle(c);
      if (cs.position === 'static' || cs.position === 'relative') c.style.position = 'absolute';
      c.style.top = c.style.top || '0px';
      c.style.left = c.style.left || '0px';
      if (!c.offsetWidth) c.style.width = '100%';
      if (!c.offsetHeight) c.style.height = '100%';
    }
  }
  function wait(test, ms) {
    return new Promise(function (ok) {
      var t0 = Date.now();
      (function tick() { if (test() || Date.now() - t0 > ms) ok(); else setTimeout(tick, 25); })();
    });
  }
  function ready() {
    var w = [];
    if (D.fonts && D.fonts.ready) w.push(D.fonts.ready);
    D.querySelectorAll('img').forEach(function (im) {
      if (!im.complete) w.push(new Promise(function (ok) { im.addEventListener('load', ok); im.addEventListener('error', ok); }));
    });
    D.querySelectorAll('video, audio').forEach(function (m) {
      m.muted = true;
      m.autoplay = false;
      m.preload = 'auto';
      if (!m.paused) m.pause();
      if (m.tagName === 'VIDEO' && m.readyState < 2) w.push(new Promise(function (ok) { m.addEventListener('loadeddata', ok); m.addEventListener('error', ok); }));
    });
    for (var k in W.__hf.buildReady) w.push(Promise.resolve(W.__hf.buildReady[k]).catch(function () {}));
    // A timeline registered after fonts load (or another async build) still counts
    var src = '';
    D.querySelectorAll('script:not([src]):not([data-cutroom-runtime])').forEach(function (s) { src += s.textContent; });
    if (/__timelines\s*(\[|\.)/.test(src)) w.push(wait(function () { return Object.keys(W.__timelines).length > 0; }, 6000));
    return Promise.race([Promise.all(w), new Promise(function (ok) { setTimeout(ok, 20000); })]).then(function () {
      layout();
      var s = size();
      return { w: s.w, h: s.h, dur: length() };
    });
  }
  function seek(t) {
    starts = new Map(); durs = new Map();
    var r = root();
    D.querySelectorAll('[data-start]').forEach(function (el) {
      if (el === r) return;
      var s = start(el), d = dur(el), on = t >= s && (d == null || t < s + d);
      // An attribute and a stylesheet rule, so the page's own visibility writes on the element survive
      if (on) el.removeAttribute('data-cr-off');
      else if (!el.hasAttribute('data-cr-off')) el.setAttribute('data-cr-off', '');
    });
    for (var k in W.__timelines) {
      var tl = W.__timelines[k];
      if (!tl || typeof tl.seek !== 'function') continue;
      if (tl.paused && !tl.paused()) tl.pause();
      tl.seek(Math.max(0, t - keyBase(k)), false);
    }
    // GSAP bakes an SVG element's origin into its matrix but drops its 0 0 origin after rewinding past a tween,
    // so a CSS transform-origin would shift it: scrubbing back must match playing forward
    D.querySelectorAll('[data-svg-origin]').forEach(function (el) {
      if (el.style.transformOrigin !== '0px 0px') el.style.transformOrigin = '0px 0px';
    });
    (D.getAnimations ? D.getAnimations() : []).forEach(function (a) {
      if (W.CSSTransition && a instanceof W.CSSTransition) return;
      var local = t, el = a.effect && a.effect.target;
      // CSS animations run on clip time, WAAPI on composition time
      if (el && W.CSSAnimation && a instanceof W.CSSAnimation) { var c = timedUp(el); if (c && c !== r) local = t - start(c); }
      try { a.pause(); a.currentTime = Math.max(0, local) * 1000; } catch (e) {}
    });
    W.__hfAnime.forEach(function (a) { try { if (a.pause) a.pause(); a.seek(t * 1000); } catch (e) {} });
    W.__hfLottie.forEach(function (a) {
      try {
        if (a.goToAndStop) a.goToAndStop(t * 1000, false);
        else if (a.setFrame && a.totalFrames && a.duration) a.setFrame(Math.min(a.totalFrames - 1, (t / a.duration) * a.totalFrames));
      } catch (e) {}
    });
    W.__hfThreeTime = t;
    try { W.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: t } })); } catch (e) {}
    var waits = [];
    D.querySelectorAll('video').forEach(function (v) {
      if (!v.paused) v.pause();
      var c = v.hasAttribute('data-start') ? v : timedUp(v), s = c && c !== r ? start(c) : 0;
      var at = Math.max(0, (t - s) * (n(v.getAttribute('data-playback-rate')) || 1) + (n(v.getAttribute('data-media-start')) || 0));
      if (isFinite(v.duration)) at = Math.min(at, Math.max(0, v.duration - 0.001));
      if (Math.abs(v.currentTime - at) < 0.0005) return;
      waits.push(new Promise(function (ok) {
        var done = function () { v.removeEventListener('seeked', done); ok(); };
        v.addEventListener('seeked', done);
        setTimeout(done, 4000);
        v.currentTime = at;
      }));
    });
    return waits.length ? Promise.all(waits) : null;
  }
  W.__cutroom = { ready: ready, seek: seek };
})();`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Page HTML plus the runtime, a <base> for its relative links and the variable values
export function prepareHtml(html: string, base: string, vars: Record<string, unknown> = {}): string {
  const json = JSON.stringify(vars).replace(/</g, '\\u003c');
  const head = `<base href="${esc(base)}"><style>html,body{margin:0}[data-cr-off]{visibility:hidden!important}</style><script data-cutroom-runtime>${RUNTIME.replace('__VARS__', () => json)}</script>`;
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (m) => m + head);
  if (/<html(\s[^>]*)?>/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

const ENT: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', '#39': "'", '#34': '"' };
const unent = (s: string) => s.replace(/&(quot|amp|apos|lt|gt|#39|#34);/g, (_, k: string) => ENT[k]);

// The whole opening tag around position i (quotes may hold ">")
function tagAt(html: string, i: number): string {
  const a = html.lastIndexOf('<', i);
  let q = '';
  for (let k = a + 1; k < html.length; k++) {
    const c = html[k];
    if (q) {
      if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return html.slice(a, k + 1);
  }
  return html.slice(a);
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = unent(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

// Size, length and variables from the composition root, read without a browser
export function htmlMeta(html: string): HtmlMeta {
  const at = html.search(/\sdata-root\s*=\s*["']?true/i) >= 0 ? html.search(/\sdata-root\s*=\s*["']?true/i) : html.search(/\sdata-composition-id\s*=/i);
  const root = at >= 0 ? attrs(tagAt(html, at)) : {};
  const htmlTag = /<html[\s>]/i.exec(html);
  const top = htmlTag ? attrs(tagAt(html, htmlTag.index + 1)) : {};
  const num = (s?: string) => (s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);
  let vars: HtmlVar[] = [];
  for (const raw of [root['data-composition-variables'], top['data-composition-variables']]) {
    if (!raw || vars.length) continue;
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) vars = v.filter((x) => x && typeof x.id === 'string');
    } catch {
      // unreadable declaration: no variables
    }
  }
  const subs = [...html.matchAll(/data-composition-src\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]);
  const remote = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)\s*=\s*["'](https?:)?\/\/([^"']+)["']/gi)].map((m) => `https://${m[2]}`);
  return { id: root['data-composition-id'], w: num(root['data-width']) ?? 1920, h: num(root['data-height']) ?? 1080, dur: num(root['data-duration']), vars, subs, remote };
}

// Current value of each declared variable: the scene's own value, else the declared default
export function varValues(meta: HtmlMeta, vars: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of meta.vars) out[v.id] = vars && vars[v.id] !== undefined ? vars[v.id] : v.default;
  return out;
}
