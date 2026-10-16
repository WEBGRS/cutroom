// Ctrl+click pointing: turns whatever was clicked into a reference the AI can act on
import type { Scene } from '../../src/lib/types';
import type { EScene, ETimeline } from './model';
import { tr } from './i18n';

export interface AiRef {
  key: string;
  // Short chip text in the UI language
  label: string;
  // What the AI is told
  detail: string;
}

export interface PickContext {
  etl: ETimeline | null;
  scenes: Scene[];
  frame: number;
  fps: number;
  size: { w: number; h: number };
  sel: string | null;
}

const sec = (f: number, fps: number) => `${(f / fps).toFixed(2)} s`;
const clip = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plainText = (s: string) => s.replace(/\[\[|\]\]|\{\+\+|\{\+|\{-|\}/g, '');

function sceneDetail(e: EScene | undefined, sc: Scene | undefined, fps: number) {
  if (!sc) return 'an unknown scene';
  const where = e ? `, starts at ${sec(e.start, fps)}, ${sec(e.dur, fps)} long` : ', not in the current version';
  return `scene "${sc.id}" (${sc.visual.kind}${where})`;
}

// Elements that can be picked, innermost first
export const PICKABLE = '[data-pick], .sfx, .tlb, .tbadge, .clip, .cap, .vo, .mus, .frame, .lt, .item, .insp .row, .itabs button, .lib-tabs button, .top button, .top select, .transport button, .transport select, .tl-tools button';

export function resolvePick(target: Element, clientX: number, clientY: number, c: PickContext): { el: Element; ref: AiRef } | null {
  const el = target.closest(PICKABLE);
  if (!el || el.closest('.chat-input, .chat-refs, .modal, .menu-pop')) return null;
  const sceneOf = (id: string) => ({ e: c.etl?.scenes.find((s) => s.id === id), sc: c.scenes.find((s) => s.id === id) });

  // Preview: a point in the picture at the current time
  if (el.classList.contains('frame')) {
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const e = c.etl?.scenes.find((s) => c.frame >= s.start && c.frame < s.start + s.dur);
    const sc = e ? c.scenes.find((s) => s.id === e.id) : undefined;
    const rel = e ? (c.frame - e.start) / c.fps : 0;
    const hits = (sc?.overlays ?? [])
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => rel >= o.at && rel <= o.at + (o.dur ?? 1.6))
      .filter(({ o }) => {
        if (o.x === undefined || o.y === undefined) return true;
        const w = (o.w ?? 0.2) / 2 + 0.04;
        const h = (o.h ?? 0.15) / 2 + 0.04;
        return Math.abs(x - o.x) <= w && Math.abs(y - o.y) <= h;
      })
      .map(({ o, i }) => `overlay #${i + 1} (${o.kind}${o.text ? ` "${clip(o.text, 40)}"` : ''})`);
    const px = `x ${x.toFixed(2)}, y ${y.toFixed(2)}`;
    return {
      el,
      ref: {
        key: `pt:${c.frame}:${px}`,
        label: tr(`Preview ${(c.frame / c.fps).toFixed(1)} s · ${px}`, `画面 ${(c.frame / c.fps).toFixed(1)} 秒 · ${px}`),
        detail: `A point in the video preview at ${px} (fractions of the ${c.size.w}×${c.size.h} frame, from the top-left), at ${sec(c.frame, c.fps)} on the timeline, ${rel.toFixed(2)} s into ${sceneDetail(e, sc, c.fps)}.${hits.length ? ` Visible there: ${hits.join('; ')}.` : ''}`,
      },
    };
  }

  // Sound cue on the timeline or in the inspector: "scene:i" or "i" of the selected scene; library sounds: "lib:id"
  const sp = (el as HTMLElement).dataset?.pick?.split('|');
  if (sp?.[0] === 'sound') {
    const [, id, name] = sp;
    if (id.startsWith('lib:')) return { el, ref: { key: sp.join('|'), label: tr(`Sound: ${name}`, `音效：${name}`), detail: `The library sound effect "${name}" (id ${id.slice(4)}), not placed yet.` } };
    const [scn, i] = id.includes(':') ? id.split(':') : [c.sel ?? '', id];
    const { e, sc } = sceneOf(scn);
    const cue = sc?.sounds?.[Number(i)];
    return {
      el,
      ref: {
        key: `sound:${scn}:${i}`,
        label: tr(`Sound: ${name}`, `音效：${name}`),
        detail: `Sound effect #${Number(i) + 1} "${name}" (id ${cue?.id ?? '?'}, ${cue?.at ?? 0} s into ${sceneDetail(e, sc, c.fps)}${e?.sounds[Number(i)] ? `, ${sec(e.start + e.sounds[Number(i)].f, c.fps)} on the timeline` : ''}, volume ${cue?.vol ?? 1}); its data is sounds.${i} of scene "${scn}".`,
      },
    };
  }

  // Timeline badges: overlays, effects, camera moves, transitions
  const bsid = (el as HTMLElement).dataset?.scene;
  if (sp && bsid && ['overlay', 'fxbar', 'camera', 'trans'].includes(sp[0])) {
    const [kind, id, name] = sp;
    const { e, sc } = sceneOf(bsid);
    const where = sceneDetail(e, sc, c.fps);
    if (kind === 'overlay') {
      const o = sc?.overlays?.[Number(id)];
      return {
        el,
        ref: {
          key: `ov:${bsid}:${id}`,
          label: tr(`Overlay: ${clip(name, 22)}`, `叠加：${clip(name, 14)}`),
          detail: `Overlay #${Number(id) + 1} (${name}) in ${where}, from ${o?.at ?? 0} s for ${o?.dur ?? 1.6} s; its data is overlays.${id} of scene "${bsid}".`,
        },
      };
    }
    if (kind === 'fxbar') return { el, ref: { key: `fx:${bsid}`, label: tr(`Effects on ${bsid}`, `${bsid} 的特效`), detail: `The picture effects on ${where}: ${name}. They are the fx.* fields of that scene.` } };
    if (kind === 'camera') {
      const span = id.split('@')[1] ?? '';
      return {
        el,
        ref: {
          key: `cam:${id}`,
          label: tr(`Camera: ${clip(name, 22)}`, `运镜：${clip(name, 14)}`),
          detail: `A camera move in ${where}, ${span.replace('-', '–')} s into the scene: ${name}. Recording zooms come from visual.zoom ("auto" zooms on clicks, "off"), visual.base and visual.zooms [{at, end, x, y, scale}]; camera effects from fx.kenburns, fx.kbAmount, fx.drift, fx.focusIn, fx.stepped, fx.motionBlur, fx.shake, fx.fadeIn, fx.fadeOut.`,
        },
      };
    }
    return { el, ref: { key: `tr:${bsid}`, label: tr(`Transition: ${name}`, `转场：${name}`), detail: `The transition into ${where}: ${name} (field transition).` } };
  }

  // Timeline: scene clips, caption chips, voice clips, music
  const sid = (el as HTMLElement).dataset?.scene;
  if (sid && (el.classList.contains('cap') || el.classList.contains('vo'))) {
    const k = Number((el as HTMLElement).dataset.line);
    const { e, sc } = sceneOf(sid);
    const text = plainText(e?.lines[k]?.text ?? sc?.lines[k]?.zh ?? '');
    const what = el.classList.contains('vo') ? 'voice-over clip' : 'caption';
    return {
      el,
      ref: {
        key: `line:${sid}:${k}`,
        label: tr(`${el.classList.contains('vo') ? 'Voice' : 'Caption'}: ${clip(text, 22)}`, `${el.classList.contains('vo') ? '旁白' : '字幕'}：${clip(text, 14)}`),
        detail: `The ${what} for line ${k + 1} of ${sceneDetail(e, sc, c.fps)}: "${text}".`,
      },
    };
  }
  if (sid) {
    const { e, sc } = sceneOf(sid);
    return { el, ref: { key: `scene:${sid}`, label: tr(`Scene ${sid}`, `段落 ${sid}`), detail: `The whole ${sceneDetail(e, sc, c.fps)}.` } };
  }
  if (el.classList.contains('mus')) return { el, ref: { key: 'music', label: tr('Music track', '配乐'), detail: 'The background music track of this cut.' } };

  // Anything that declares what it is (effects, settings, overlays, lines)
  const pick = (el as HTMLElement).dataset?.pick;
  if (pick) {
    const [kind, id, name] = pick.split('|');
    const scene = c.sel ? `scene "${c.sel}"` : 'the project settings';
    switch (kind) {
      case 'effect': {
        const [cat, eid] = id.split(':');
        return { el, ref: { key: pick, label: tr(`Effect: ${name}`, `特效：${name}`), detail: `The library effect "${name}" (category ${cat}, id ${eid || '(default)'}).` } };
      }
      case 'field':
        return { el, ref: { key: `${pick}:${c.sel}`, label: tr(`Setting: ${name}`, `设置：${name}`), detail: `The setting "${name}"${id ? ` (path ${id})` : ''} of ${scene}.` } };
      case 'overlay':
        return { el, ref: { key: `${pick}:${c.sel}`, label: tr(`Overlay #${Number(id) + 1} ${name}`, `叠加 #${Number(id) + 1} ${name}`), detail: `Overlay #${Number(id) + 1} (${name}) in ${scene}; its data is overlays.${id}.` } };
      case 'line':
        return { el, ref: { key: `${pick}:${c.sel}`, label: tr(`Line ${Number(id) + 1}`, `第 ${Number(id) + 1} 句`), detail: `Line ${Number(id) + 1} of ${scene}${name ? `: "${plainText(name)}"` : ''}.` } };
    }
  }

  // Inspector rows: the label names the setting
  if (el.classList.contains('row')) {
    const label = el.querySelector('label')?.textContent?.trim() ?? '';
    const scene = c.sel ? `scene "${c.sel}"` : 'the project settings';
    return { el, ref: { key: `row:${label}:${c.sel}`, label: tr(`Setting: ${label}`, `设置：${label}`), detail: `The "${label}" setting of ${scene}.` } };
  }

  // Any other control: name it by its text or tooltip
  const name = ((el as HTMLElement).getAttribute('aria-label') || (el as HTMLElement).title || el.textContent || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return { el, ref: { key: `ui:${name}`, label: tr(`UI: ${clip(name, 20)}`, `界面：${clip(name, 14)}`), detail: `The editor control "${clip(name, 80)}" (the user is asking about the interface itself).` } };
}
