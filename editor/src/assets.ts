import { useEffect, useState } from 'react';

export interface Thumbs {
  url: string;
  // Separate tiles, joined into the strip `url` on arrival
  frames?: string[];
  interval: number;
  count: number;
  w: number;
  h: number;
  dur: number;
}

export interface Peaks {
  rate: number;
  p: number[];
}

const store = new Map<string, Promise<unknown>>();
const done = new Map<string, unknown>();

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = bad;
    i.src = src;
  });

// One horizontal strip from the tiles, so every thumbnail can use background-position
async function strip(t: Thumbs): Promise<Thumbs> {
  if (!t.frames?.length) return t;
  const imgs = await Promise.all(t.frames.map(load));
  const c = document.createElement('canvas');
  c.width = t.w * imgs.length;
  c.height = t.h;
  const g = c.getContext('2d')!;
  imgs.forEach((im, k) => g.drawImage(im, k * t.w, 0, t.w, t.h));
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  return { ...t, url: blob ? URL.createObjectURL(blob) : t.frames[0], count: blob ? imgs.length : 1 };
}

// Fetch once per URL, shared by every component that asks
export function useAsset<T>(url: string | null): T | null {
  const [v, setV] = useState<T | null>(url ? ((done.get(url) as T) ?? null) : null);
  useEffect(() => {
    if (!url) return setV(null);
    if (done.has(url)) return setV(done.get(url) as T);
    let alive = true;
    if (!store.has(url))
      store.set(
        url,
        fetch(url)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j && Array.isArray(j.frames) ? strip(j as Thumbs) : j))
          .then((j) => {
            done.set(url, j);
            return j;
          })
          .catch(() => null),
      );
    store.get(url)!.then((j) => alive && setV(j as T));
    return () => {
      alive = false;
    };
  }, [url]);
  return v;
}

export const thumbsUrl = (slug: string, src: string) => `/api/thumbs?slug=${encodeURIComponent(slug)}&src=${encodeURIComponent(src)}`;
export const peaksUrl = (publicPath: string) => `/api/peaks?path=${encodeURIComponent(publicPath)}`;
