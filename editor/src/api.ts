import type { Doc } from './ops';

export interface Remote extends Doc {
  version: string;
}

export interface Job {
  slug: string;
  name: string;
  out: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  phase: string;
  tail: string[];
}

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok && r.status !== 409) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
};

export const getProjects = () => fetch('/api/projects').then((r) => json<string[]>(r));
export const getBoard = (slug: string) => fetch(`/api/board?slug=${slug}`, { cache: 'no-store' }).then((r) => json<Remote>(r));
export const getAssets = (slug: string) => fetch(`/api/assets?slug=${slug}`).then((r) => json<string[]>(r));

export async function putBoard(slug: string, doc: Doc, base: string, desc: string[], withTimings: boolean): Promise<{ version: string } | { conflict: Remote }> {
  const r = await fetch(`/api/board?slug=${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: doc.board, timings: withTimings ? doc.timings : undefined, base, desc }),
  });
  if (r.status === 409) return { conflict: await r.json() };
  return json<{ version: string }>(r);
}

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<any>(r));
export const startRender = (o: Record<string, string>) => post('/api/render', o) as Promise<Job>;
export const cancelRender = () => post('/api/render/cancel', {});
export const reveal = (file: string) => post('/api/reveal', { file });
