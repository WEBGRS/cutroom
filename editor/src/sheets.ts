// Contact sheets for review: frames joined into one image, at viewing size and at phone size
import fs from 'node:fs';
import path from 'node:path';
import type { Format } from '../../src/lib/types';
import { chromium } from 'playwright-core';
import { findBrowser } from './record';
import { lookDir } from './look';
import { reviewDir } from './stagefiles';

export async function tile(files: string[], labels: string[], out: string, cellW: number, cols: number): Promise<boolean> {
  const browser = findBrowser();
  if (!browser || !files.length) return false;
  const b = await chromium.launch({ ...browser, headless: true });
  try {
    const page = await b.newPage();
    const srcs = files.map((f) => `data:image/${/\.png$/i.test(f) ? 'png' : 'jpeg'};base64,${fs.readFileSync(f).toString('base64')}`);
    const data = await page.evaluate(
      async ({ srcs, labels, cellW, cols }) => {
        const imgs = await Promise.all(
          srcs.map(
            (s) =>
              new Promise<HTMLImageElement>((ok, bad) => {
                const i = new Image();
                i.onload = () => ok(i);
                i.onerror = bad;
                i.src = s;
              }),
          ),
        );
        const cellH = Math.round((cellW * imgs[0].naturalHeight) / imgs[0].naturalWidth);
        const c = document.createElement('canvas');
        c.width = cellW * Math.min(cols, imgs.length);
        c.height = cellH * Math.ceil(imgs.length / cols);
        const g = c.getContext('2d')!;
        g.fillStyle = '#000';
        g.fillRect(0, 0, c.width, c.height);
        g.font = '600 13px sans-serif';
        imgs.forEach((im, k) => {
          const x = (k % cols) * cellW;
          const y = Math.floor(k / cols) * cellH;
          g.drawImage(im, x, y, cellW, cellH);
          // A label stays inside its cell
          let text = labels[k] ?? '';
          while (text.length > 2 && g.measureText(text).width + 10 > cellW) text = `${text.slice(0, -2)}…`;
          const w = g.measureText(text).width + 10;
          g.fillStyle = 'rgba(0,0,0,.7)';
          g.fillRect(x, y, w, 20);
          g.fillStyle = '#ffd479';
          g.fillText(text, x + 5, y + 14);
        });
        return c.toDataURL('image/jpeg', 0.85).split(',')[1];
      },
      { srcs, labels, cellW, cols },
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    return true;
  } finally {
    await b.close();
  }
}

// look frames as contact sheets in the look folder: size 3 = 9 frames (16:9) or 10 (9:16) per image, size 2 = 4 at half size
export async function lineSheets(slug: string, shots: { file: string; label: string }[], format: Format, size: 2 | 3 = 3): Promise<{ file: string; from: number; to: number }[]> {
  const cols = format === 'tall' ? (size === 2 ? 4 : 5) : size;
  const per = format === 'tall' ? (size === 2 ? 4 : 10) : size * size;
  const cellW = format === 'tall' ? (size === 2 ? 390 : 300) : size === 2 ? 780 : 520;
  const out: { file: string; from: number; to: number }[] = [];
  for (let i = 0; i < shots.length; i += per) {
    const part = shots.slice(i, i + per);
    const file = path.resolve(lookDir(), `${slug}-sheet-${i / per + 1}.jpeg`);
    if (!(await tile(part.map((s) => s.file), part.map((s) => s.label), file, cellW, cols))) return [];
    out.push({ file, from: i + 1, to: i + part.length });
  }
  return out;
}

// Two sheets in the look folder (the AI can open them) and a copy in the project for the panel
export async function reviewSheets(slug: string, shots: { file: string; label: string }[], format: Format): Promise<{ sheet: string; phone: string } | null> {
  const cols = format === 'tall' ? 6 : 4;
  const files = shots.map((s) => s.file);
  const labels = shots.map((s) => s.label);
  const sheet = path.join(lookDir(), `${slug}-review-sheet.jpeg`);
  const phone = path.join(lookDir(), `${slug}-review-phone.jpeg`);
  if (!(await tile(files, labels, sheet, format === 'tall' ? 300 : 480, cols))) return null;
  await tile(files, labels, phone, 360, cols);
  fs.mkdirSync(reviewDir(slug), { recursive: true });
  fs.copyFileSync(sheet, path.join(reviewDir(slug), 'latest-sheet.jpeg'));
  fs.copyFileSync(phone, path.join(reviewDir(slug), 'latest-phone.jpeg'));
  return { sheet: path.resolve(sheet), phone: path.resolve(phone) };
}
