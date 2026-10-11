// Break a video into shots: cut points, lengths, camera moves, keyframes, and a page that plays any shot
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC } from './store';
import { grayFrames, still } from './media';
import { MOVE_NAMES, classifyMove, detectCuts, estimateMotion, type CameraMove, type Motion } from './shotdetect';

const W = 96;
const H = 54;

export interface Shot {
  i: number;
  start: number;
  end: number;
  dur: number;
  move: CameraMove;
  pan: number;
  tilt: number;
  zoom: number;
  activity: number;
  // Project-relative stills at 10%, 50% and 90% of the shot
  keys: string[];
  text?: string;
}

export interface ShotReport {
  name: string;
  source: string;
  video: string;
  duration: number;
  fps: number;
  shots: Shot[];
  stats: { count: number; mean: number; median: number; min: number; max: number; perMinute: number; moves: Partial<Record<CameraMove, number>> };
  made: string;
}

const safe = (s: string) => s.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9一-龥-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video';

// Cues from an .srt or .vtt next to the video
function readSubs(file: string): { a: number; b: number; text: string }[] {
  const base = file.replace(/\.[^.]+$/, '');
  const sub = ['.srt', '.vtt', '.zh.srt', '.en.srt'].map((e) => base + e).find((f) => fs.existsSync(f));
  if (!sub) return [];
  const t = (s: string) => {
    const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`) : 0;
  };
  const out: { a: number; b: number; text: string }[] = [];
  for (const block of fs.readFileSync(sub, 'utf8').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const k = lines.findIndex((l) => l.includes('-->'));
    if (k < 0) continue;
    const [a, b] = lines[k].split('-->');
    const text = lines.slice(k + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) out.push({ a: t(a), b: t(b), text });
  }
  return out;
}

async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn));
}

export async function analyzeShots(o: { slug: string; file: string; name?: string; sensitivity?: number; log?: (s: string) => void }): Promise<{ report: ShotReport; dir: string }> {
  const log = o.log ?? (() => undefined);
  const file = path.resolve(fs.existsSync(path.join(PUBLIC, o.slug, o.file)) ? path.join(PUBLIC, o.slug, o.file) : o.file);
  if (!fs.existsSync(file)) throw new Error(`no such video: ${o.file}`);
  const name = safe(o.name ?? path.basename(file));
  const dir = path.join(PUBLIC, o.slug, 'ref', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'k'), { recursive: true });
  // The page plays the video from the project folder: link (or copy) it in unless it is already there
  const projectDir = path.resolve(PUBLIC, o.slug);
  let video: string;
  if (file.startsWith(projectDir + path.sep)) video = path.relative(projectDir, file).replace(/\\/g, '/');
  else {
    const dest = path.join(dir, `source${path.extname(file).toLowerCase()}`);
    try {
      fs.linkSync(file, dest);
    } catch {
      fs.copyFileSync(file, dest);
    }
    video = path.relative(projectDir, dest).replace(/\\/g, '/');
  }
  log(`decoding ${path.basename(file)} …`);
  const probeFps = 30;
  const { frames, fps, duration } = await grayFrames(file, W, H, probeFps);
  if (frames.length < 2) throw new Error('the video is too short to analyse');
  log(`${frames.length} frames; finding cuts …`);
  const cuts = detectCuts(frames, W, H, fps, { sensitivity: o.sensitivity });
  const subs = readSubs(file);
  const total = frames.length / fps;
  const shots: Shot[] = cuts.map((c, i) => {
    const next = i + 1 < cuts.length ? cuts[i + 1] : frames.length;
    const ms: Motion[] = [];
    for (let t = c + 2; t + 2 < next - 1; t += 2) ms.push(estimateMotion(frames[t], frames[t + 2], W, H));
    const mv = classifyMove(ms, W, H);
    const start = c / fps;
    const end = i + 1 < cuts.length ? next / fps : Math.max(total, duration);
    const text = subs.filter((s) => s.b > start + 0.05 && s.a < end - 0.05).map((s) => s.text).join(' ');
    return { i: i + 1, start, end, dur: end - start, move: mv.move, pan: mv.pan, tilt: mv.tilt, zoom: mv.zoom, activity: mv.activity, keys: [], ...(text ? { text } : {}) };
  });
  log(`${shots.length} shots; grabbing keyframes …`);
  await inBatches(shots, 4, async (s) => {
    for (const [k, f] of [0.1, 0.5, 0.9].entries()) {
      const rel = `k/${String(s.i).padStart(3, '0')}-${'abc'[k]}.jpg`;
      await still(file, Math.min(s.end - 0.02, s.start + s.dur * f), path.join(dir, rel));
      s.keys.push(`ref/${name}/${rel}`);
    }
  });
  const durs = shots.map((s) => s.dur);
  const sorted = [...durs].sort((a, b) => a - b);
  const moves: Partial<Record<CameraMove, number>> = {};
  for (const s of shots) moves[s.move] = (moves[s.move] ?? 0) + 1;
  const report: ShotReport = {
    name,
    source: file,
    video,
    duration: Math.max(total, duration),
    fps,
    shots,
    stats: { count: shots.length, mean: durs.reduce((a, b) => a + b, 0) / durs.length, median: sorted[sorted.length >> 1], min: sorted[0], max: sorted[sorted.length - 1], perMinute: (shots.length - 1) / (Math.max(total, duration) / 60), moves },
    made: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(dir, 'index.html'), reportPage(report));
  return { report, dir };
}

export const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

// Plain-text summary for the CLI and the AI
export function summary(r: ShotReport, dir: string, lang: 'en' | 'zh' = 'en'): string {
  const s = r.stats;
  const zh = lang === 'zh';
  const mv = (m: CameraMove) => MOVE_NAMES[m][zh ? 1 : 0];
  const lines = [
    `${r.name}: ${fmt(r.duration)}, ${s.count} shots; average ${s.mean.toFixed(2)} s, median ${s.median.toFixed(2)} s, shortest ${s.min.toFixed(2)} s, longest ${s.max.toFixed(2)} s; ${s.perMinute.toFixed(1)} cuts a minute`,
    `camera: ${Object.entries(s.moves).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${mv(m as CameraMove)} ${n}`).join(', ')}`,
    ...r.shots.map((x) => `#${String(x.i).padEnd(3)} ${fmt(x.start)}  ${x.dur.toFixed(2).padStart(5)} s  ${mv(x.move).padEnd(12)}  ${path.resolve(dir, '..', '..', x.keys[1])}${x.text ? `  "${x.text.slice(0, 60)}"` : ''}`),
    `page: ${path.join(dir, 'index.html')}; with the editor running it is at /${path.basename(path.resolve(dir, '..', '..'))}/ref/${r.name}/index.html (click a shot to play it)`,
  ];
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Light page: stats, the video, a strip of shots and a table; clicking a shot plays just that shot
function reportPage(r: ShotReport): string {
  const data = JSON.stringify({ ...r, source: path.basename(r.source), names: MOVE_NAMES }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.name)} · shots</title>
<style>
  :root { --bg: #f6f7f9; --card: #fff; --ink: #14161a; --ink2: #3c424d; --line: #dde1e7; --accent: #3b6ef5; --hi: #e8efff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, "Noto Sans SC", sans-serif; }
  header { padding: 18px 24px 8px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 22px; }
  h1 { margin: 0; font-size: 20px; }
  .stat b { font-size: 17px; margin-right: 4px; font-variant-numeric: tabular-nums; }
  main { display: grid; grid-template-columns: minmax(320px, 46%) 1fr; gap: 18px; padding: 8px 24px 24px; align-items: start; }
  .left { position: sticky; top: 12px; }
  video { width: 100%; background: #000; border-radius: 10px; display: block; }
  .strip { display: flex; height: 26px; margin-top: 10px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); cursor: pointer; }
  .strip div { border-right: 1px solid rgba(0,0,0,.25); min-width: 2px; }
  .strip div.on { outline: 2px solid var(--accent); outline-offset: -2px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; color: var(--ink2); font-size: 12.5px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
  th { font-size: 12.5px; color: var(--ink2); font-weight: 600; background: #fafbfc; }
  tr.shot { cursor: pointer; }
  tr.shot:hover { background: #f3f6fb; }
  tr.shot.on { background: var(--hi); }
  td.keys img { width: 96px; height: 54px; object-fit: cover; border-radius: 4px; margin-right: 3px; vertical-align: middle; }
  td.num, td.time, td.dur { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12.5px; white-space: nowrap; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } .left { position: static; } td.keys img:not(:nth-child(2)) { display: none; } }
  @media (max-width: 520px) { header, main { padding-left: 12px; padding-right: 12px; } th, td { padding: 6px 5px; } td.keys img { width: 72px; height: 40px; } .chip { white-space: normal; } }
</style>
</head>
<body>
<header></header>
<main>
  <div class="left"><video controls preload="auto"></video><div class="strip"></div><div class="legend"></div></div>
  <table><thead></thead><tbody></tbody></table>
</main>
<script>
const R = ${data};
const zh = /^zh/.test(navigator.language);
const T = (en, cn) => (zh ? cn : en);
const COLORS = { static: '#c9ced8', 'pan-left': '#7aa7ff', 'pan-right': '#4f86f7', 'tilt-up': '#9a8cf0', 'tilt-down': '#7c6be6', push: '#f2a65a', pull: '#e48a3c', handheld: '#e2737a', busy: '#66c2a5' };
const name = (m) => R.names[m][zh ? 1 : 0];
const fmt = (t) => Math.floor(t / 60) + ':' + (t % 60).toFixed(2).padStart(5, '0');
const s = R.stats;
document.querySelector('header').innerHTML = '<h1>' + R.name + '</h1>' + [
  [s.count, T('shots', '个镜头')], [fmt(R.duration), T('long', '总长')], [s.mean.toFixed(2) + ' s', T('average', '平均')], [s.median.toFixed(2) + ' s', T('median', '中位')],
  [s.min.toFixed(2) + ' / ' + s.max.toFixed(2) + ' s', T('shortest / longest', '最短 / 最长')], [s.perMinute.toFixed(1), T('cuts a minute', '次切换/分钟')],
].map(([v, l]) => '<span class="stat"><b>' + v + '</b>' + l + '</span>').join('');
const video = document.querySelector('video');
video.src = '../../' + R.video.split('/').map(encodeURIComponent).join('/');
const strip = document.querySelector('.strip');
const legend = document.querySelector('.legend');
legend.innerHTML = Object.keys(s.moves).map((m) => '<span><i style="background:' + COLORS[m] + '"></i>' + name(m) + ' ' + s.moves[m] + '</span>').join('');
document.querySelector('thead').innerHTML = '<tr><th>#</th><th>' + T('Keyframes', '关键帧') + '</th><th>' + T('Start', '开始') + '</th><th>' + T('Length', '时长') + '</th><th>' + T('Camera', '运镜') + '</th>' + (R.shots.some((x) => x.text) ? '<th>' + T('Words', '台词') + '</th>' : '') + '</tr>';
const tbody = document.querySelector('tbody');
let stopAt = null;
// Checked every frame while playing, so a shot stops at its own end (timeupdate fires only every ~250 ms)
const watch = () => {
  if (stopAt === null) return;
  if (video.currentTime >= stopAt - 0.06) { video.pause(); video.currentTime = Math.max(0, stopAt - 0.05); stopAt = null; return; }
  requestAnimationFrame(watch);
};
const play = (x) => { video.currentTime = x.start + 0.01; stopAt = x.end; video.play().then(() => requestAnimationFrame(watch)); };
for (const x of R.shots) {
  const b = document.createElement('div');
  b.style.flex = x.dur + ' 0 0'; b.style.background = COLORS[x.move]; b.title = '#' + x.i + ' ' + x.dur.toFixed(2) + ' s · ' + name(x.move);
  b.onclick = () => play(x);
  strip.append(b); x.bar = b;
  const tr = document.createElement('tr');
  tr.className = 'shot';
  tr.innerHTML = '<td class="num">' + x.i + '</td><td class="keys">' + x.keys.map((k) => '<img loading="lazy" src="../../' + k + '" alt="">').join('') + '</td><td class="time">' + fmt(x.start) + '</td><td class="dur">' + x.dur.toFixed(2) + ' s</td><td><span class="chip" style="background:' + COLORS[x.move] + '33">' + name(x.move) + '</span></td>' + (R.shots.some((y) => y.text) ? '<td>' + (x.text || '').replace(/</g, '&lt;') + '</td>' : '');
  tr.onclick = () => play(x);
  tbody.append(tr); x.row = tr;
}
let cur = null;
video.addEventListener('timeupdate', () => {
  const t = video.currentTime;
  const x = R.shots.find((y) => t >= y.start && t < y.end) || null;
  if (x === cur) return;
  if (cur) { cur.row.classList.remove('on'); cur.bar.classList.remove('on'); }
  cur = x;
  if (x) { x.row.classList.add('on'); x.bar.classList.add('on'); }
});
video.addEventListener('seeking', () => { if (video.paused) stopAt = null; });
</script>
</body>
</html>
`;
}
