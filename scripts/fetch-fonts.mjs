// Downloads Noto Sans SC (SIL Open Font License) used by captions and cards
import fs from 'node:fs';
const url = 'https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf';
const out = 'public/fonts/NotoSansSC-VF.ttf';
if (fs.existsSync(out)) {
  console.log('font already present');
} else {
  fs.mkdirSync('public/fonts', { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log(`saved ${out}`);
}
