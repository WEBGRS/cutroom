// Editor preferences (Settings page), kept in this browser / app window
import { useEffect, useState } from 'react';

export interface Prefs {
  // Help text under panels, the chat's tips and suggestions
  hints: boolean;
  // Editing
  imageSec: number;
  imagePush: boolean;
  newTransition: string;
  overlaySec: number;
  followPlayhead: boolean;
  // Dragged edges, cues and the playhead snap to cuts, marks, captions and each other
  snap: boolean;
  lanes: { overlays: boolean; effects: boolean; camera: boolean; sfx: boolean };
  // Preview
  loop: boolean;
  volume: number;
  // Export button
  exportPreset: 'mp4' | '2x' | 'gif' | 'prores';
  // Claude Code model ('' = its default)
  claudeModel: string;
}

export const DEFAULT_PREFS: Prefs = {
  hints: false,
  imageSec: 3,
  imagePush: true,
  newTransition: 'fade',
  overlaySec: 1.6,
  followPlayhead: true,
  snap: true,
  lanes: { overlays: true, effects: true, camera: true, sfx: true },
  loop: false,
  volume: 1,
  exportPreset: 'mp4',
  claudeModel: '',
};

const KEY = 'cutroom-prefs';

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // The chat's model choice used to live on its own
    if (v.claudeModel === undefined) v.claudeModel = localStorage.getItem('vs-chat-model') ?? '';
    return { ...DEFAULT_PREFS, ...v, lanes: { ...DEFAULT_PREFS.lanes, ...(v.lanes ?? {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
}

let current: Prefs = typeof window === 'undefined' ? DEFAULT_PREFS : load();
const subs = new Set<(p: Prefs) => void>();

export const getPrefs = () => current;

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch, lanes: { ...current.lanes, ...(patch.lanes ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: lasts until the window closes
  }
  subs.forEach((f) => f(current));
}

export function resetPrefs() {
  current = DEFAULT_PREFS;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Private mode
  }
  subs.forEach((f) => f(current));
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    subs.add(setP);
    setP(current);
    return () => {
      subs.delete(setP);
    };
  }, []);
  return p;
}
