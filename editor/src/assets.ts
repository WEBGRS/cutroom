import { useEffect, useState } from 'react';

export interface Thumbs {
  url: string;
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
