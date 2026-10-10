// Records the demo screen capture: node editor/demo/capture.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
import { record } from '../../tools/capture.mjs';

const site = pathToFileURL(fileURLToPath(new URL('./site/index.html', import.meta.url))).href;
const outDir = fileURLToPath(new URL('../../public/showcase/cap/', import.meta.url));

await record('planner', { url: site, outDir, viewport: { width: 1280, height: 720 }, dpr: 1.5, crf: 20, gpu: false }, async (r) => {
  await r.goto(site);
  await r.until('#list li');
  await r.start();
  await r.wait(600);
  await r.click('#q');
  r.mark('type');
  await r.type('Edit with Cutroom');
  await r.wait(300);
  await r.click('#add');
  r.mark('add');
  await r.wait(1200);
  await r.click('#list li:nth-child(2) .box');
  r.mark('check');
  await r.wait(900);
  await r.click('#list li:nth-child(3) .box');
  await r.wait(1000);
  await r.click('.tabs button[data-f="done"]');
  r.mark('filter');
  await r.wait(1600);
});
