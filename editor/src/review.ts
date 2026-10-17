// The independent reviewer's instructions and request; it never sees how the video was made
import http from 'node:http';
import path from 'node:path';
import { checklistText } from './stagefiles';
import { L } from './settings';

export const REVIEWER_SYSTEM = `You review a software demo video as an independent critic. You did not make it and you don't know how it was made. You get its brief, the chosen plan it follows when there is one (its look, palette, fonts and motion personality: judge V against it), its shot table and contact sheets of rendered frames (a normal-size sheet and a phone-size sheet; each frame is labelled with its scene and time; "a|b −0.1 s" and "a|b +0.2 s" are the two sides of the cut from scene a to scene b).

Check every group:
${checklistText()}

Answer in this exact form and nothing else:
- first line: ready or revise
- a line "scope: …" saying what you actually looked at (e.g. "whole cut, 12 middles + 22 cut frames, stills only")
- a line "scores: P 8 F 7 V 9 B 8 D 10 A 7 Q 6 M 8 T 9" (1–10 per group; A from what the table says when you can't hear it, and say so)
- then numbered problems, most serious first, each: scene id, time, what is wrong, the concrete fix.
One hard failure (personal or customer data visible, a must-show feature missing, an unreadable caption) means revise whatever the scores. Don't praise, don't soften, don't mention cost or effort. Stills can't show motion: name any motion you couldn't judge.`;

export function reviewerUser(o: { brief: string; table: string; scope: string; images: string[]; files: boolean; partial?: boolean; plan?: string | null }): string {
  const pics = o.files ? `Open each of these images with the Read tool before answering:\n${o.images.map((p) => `- ${p}`).join('\n')}` : 'The contact sheets are attached.';
  // A sample shows a few scenes: what lies outside them is not missing
  const sample = o.partial ? `\nThis is a sample (${o.scope}), not the whole cut: judge only these scenes; features and scenes outside them are not missing.\n` : '';
  const plan = o.plan?.trim() ? `<chosen plan>\n${o.plan.trim()}\n</chosen plan>\n\n` : '';
  return `<brief>\n${o.brief.trim() || '(no brief.md)'}\n</brief>\n\n${plan}<shot table>\n${o.table.trim()}\n</shot table>\n\nScope of the sheets: ${o.scope}\n${sample}\n${pics}`;
}

// Only files inside the look folder may be shown to the reviewer
export function safeImages(paths: string[], dir: string): string[] {
  const root = path.resolve(dir) + path.sep;
  return paths.map((p) => path.resolve(p)).filter((p) => p.startsWith(root));
}

// The request text is built here from the confined image list, never taken from the client
export function reviewRequest(o: { brief: string; table: string; scope: string; images: string[]; dir: string; files: boolean; partial?: boolean; plan?: string | null }): { user: string; images: string[] } {
  const images = safeImages(o.images, o.dir);
  return { user: reviewerUser({ brief: o.brief, table: o.table, scope: o.scope, images, files: o.files, partial: o.partial, plan: o.plan }), images };
}

export type ReviewReply = { text?: string; unavailable?: string; error?: string };

// The CLI's call to the editor's reviewer route: node:http waits as long as it is told (fetch gives up on headers after 5 min)
export function callReviewer(server: string, body: object, ms = 16 * 60_000): Promise<ReviewReply> {
  return new Promise((resolve) => {
    let req: http.ClientRequest;
    try {
      req = http.request(new URL('/api/review/run', server), { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (out += d));
        res.on('error', (e) => resolve({ error: e.message }));
        res.on('end', () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            resolve({ error: `HTTP ${res.statusCode}: ${out.trim().slice(0, 300) || 'no answer'}` });
          }
        });
      });
    } catch (e) {
      return resolve({ error: (e as Error).message });
    }
    const wait = ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${ms / 1000} s`;
    req.setTimeout(ms, () => req.destroy(new Error(`the reviewer did not answer within ${wait}`)));
    req.on('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ECONNREFUSED' ? { unavailable: `the editor is not running at ${server}` } : { error: e.message }));
    req.end(JSON.stringify(body));
  });
}

// An empty answer is not a verdict
export function reviewAnswer(text: string): { text: string } | { unavailable: string } {
  return text.trim() ? { text } : { unavailable: L('The reviewer returned nothing', '审片没有返回内容') };
}
