// The renderer copies its whole public folder into every bundle. Give it a folder of hard links to just what
// one project uses: its own folder, the shared fonts, music and sounds, and any project it points into with ../
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PUBLIC } from './store';

function linkTree(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    // Linked folders (junctions) are followed, so the renderer never has to recreate a link
    const real = e.isSymbolicLink() ? fs.realpathSync(s) : s;
    const st = e.isSymbolicLink() ? fs.statSync(real) : e;
    if (st.isDirectory()) linkTree(real, d);
    else if (st.isFile()) fs.linkSync(real, d);
  }
}

export function slimPublic(slug: string): { dir: string; cleanup: () => void } | null {
  let board = '';
  try {
    board = fs.readFileSync(path.join(PUBLIC, slug, 'storyboard.json'), 'utf8');
  } catch {
    return null;
  }
  const others = [...board.matchAll(/\.\.\/([\w-]+)\//g)].map((m) => m[1]);
  const names = [...new Set([slug, 'fonts', 'music', 'sfx', ...others])];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-pub-'));
  // Removing the folder removes only the links, never the files they point to
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  try {
    for (const n of names) if (fs.existsSync(path.join(PUBLIC, n))) linkTree(path.join(PUBLIC, n), path.join(dir, n));
    return { dir, cleanup };
  } catch {
    // Another drive (no hard links across volumes) or a locked file: render from the full folder instead
    cleanup();
    return null;
  }
}
