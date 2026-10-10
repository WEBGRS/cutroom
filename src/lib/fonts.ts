import { continueRender, delayRender, staticFile } from 'remotion';

export const SANS = '"Noto Sans SC", "Microsoft YaHei", sans-serif';
export const MONO = '"Cascadia Code", Consolas, monospace';

// Load bundled CJK variable font once
const handle = delayRender('font');
const face = new FontFace('Noto Sans SC', `url(${staticFile('fonts/NotoSansSC-VF.ttf')}) format('truetype')`, { weight: '100 900' });
face
  .load()
  .then(() => {
    document.fonts.add(face);
    continueRender(handle);
  })
  .catch((e) => {
    console.error(e);
    continueRender(handle);
  });
