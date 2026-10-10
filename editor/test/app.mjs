// Desktop app smoke test: launches Electron hidden on a spare port, checks the editor loads, quits, checks cleanup
import { _electron as electron } from 'playwright';
import net from 'node:net';
import path from 'node:path';

const PORT = Number(process.env.APP_TEST_PORT ?? 8816);
const listening = () =>
  new Promise((ok) => {
    const s = net.connect(PORT, '127.0.0.1');
    s.on('connect', () => (s.destroy(), ok(true)));
    s.on('error', () => ok(false));
  });

if (await listening()) throw new Error(`port ${PORT} is busy; set APP_TEST_PORT`);
const results = [];
// VS Code terminals export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node
const env = { ...process.env, CUTROOM_HIDDEN: '1', PORT: String(PORT) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.resolve('app/main.cjs')], env });
try {
  const win = await app.firstWindow();
  await win.waitForSelector('.clip', { timeout: 40000 });
  results.push(`PASS window loads the editor (title "${await win.title()}")`);
  results.push((await listening()) ? 'PASS app started its own server' : 'FAIL no server');
  await win.screenshot({ path: path.resolve('.scratch/app-window.png') });
} catch (e) {
  results.push(`FAIL ${e.message}`);
} finally {
  await app.close();
}
await new Promise((r) => setTimeout(r, 2500));
results.push((await listening()) ? 'FAIL server still running after quit' : 'PASS server stopped with the app');
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
