// Desktop shell: starts the editor server (unless one is already running) and opens it in its own window
const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// The installed app gets its own port, so it never attaches to a dev server
const PORT = Number(process.env.PORT || (app.isPackaged ? 8824 : 8814));
let server = null;

const listening = (port) =>
  new Promise((ok) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => {
      s.destroy();
      ok(true);
    });
    s.on('error', () => ok(false));
  });

// Installed copies keep projects, settings and exports in Documents\Cutroom
function prepareData() {
  if (!app.isPackaged && !process.env.CUTROOM_DATA) return null;
  const data = process.env.CUTROOM_DATA || path.join(app.getPath('documents'), 'Cutroom');
  fs.mkdirSync(path.join(data, '.editor'), { recursive: true });
  // Shared assets are copied (not linked: Remotion's bundler can't recreate links without admin rights),
  // and refreshed when the app version changes
  const stamp = path.join(data, '.editor', 'assets-version');
  let have = '';
  try {
    have = fs.readFileSync(stamp, 'utf8').trim();
  } catch {
    // First run
  }
  if (have !== app.getVersion()) {
    for (const name of ['fonts', 'music', 'sfx', '_fx']) {
      const src = path.join(ROOT, 'public', name);
      const dst = path.join(data, name);
      if (!fs.existsSync(src)) continue;
      try {
        if (fs.lstatSync(dst).isSymbolicLink()) fs.unlinkSync(dst);
      } catch {
        // Not there yet
      }
      fs.cpSync(src, dst, { recursive: true, force: true });
    }
    // An existing demo project gets the narration added in 0.3.0 and the HTML pages added in 0.4.0; files already there are left alone
    const demoSrc = path.join(ROOT, 'public', 'showcase');
    const demoDst = path.join(data, 'showcase');
    if (fs.existsSync(demoDst))
      for (const f of ['timings.json', 'timings-en.json', 'vo', 'scenes']) {
        const s = path.join(demoSrc, f);
        const d = path.join(demoDst, f);
        if (fs.existsSync(s) && !fs.existsSync(d)) fs.cpSync(s, d, { recursive: true });
      }
    fs.writeFileSync(stamp, app.getVersion());
  }
  // First run: a demo project to explore
  const demo = path.join(data, 'showcase');
  if (!fs.existsSync(demo) && fs.existsSync(path.join(ROOT, 'public', 'showcase'))) fs.cpSync(path.join(ROOT, 'public', 'showcase'), demo, { recursive: true });
  // Language picked in the installer, until one is chosen in the app
  const settingsFile = path.join(data, '.editor', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    // First run
  }
  if (!settings.lang) {
    try {
      const lang = fs.readFileSync(path.join(process.resourcesPath, 'install-lang.txt'), 'utf8').trim();
      if (lang === 'zh' || lang === 'en') fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, lang }, null, 2));
    } catch {
      // Installed without the language page (or from source)
    }
  }
  return data;
}

async function ensureServer() {
  if (await listening(PORT)) return true;
  const data = prepareData();
  // Electron's own Node runs the server; renders and the CLI inherit it
  // Server output goes to a log in the data folder, for troubleshooting
  const logFd = data ? fs.openSync(path.join(data, '.editor', 'server.log'), 'w') : 'ignore';
  server = spawn(process.execPath, [path.join(ROOT, 'editor', 'dist', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), ...(data ? { VS_DATA: data } : {}) },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  // First start can be slow (assets just copied, antivirus scanning them)
  for (let i = 0; i < 400 && !(await listening(PORT)); i++) await new Promise((r) => setTimeout(r, 100));
  return listening(PORT);
}

async function createWindow() {
  const up = await ensureServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    title: 'Cutroom',
    backgroundColor: '#0c0d10',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    // Tests run the app without flashing a window on the desktop
    show: !process.env.CUTROOM_HIDDEN,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const fail = (why) =>
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="background:#0c0d10;color:#e8e9ec;font:15px Segoe UI,sans-serif;padding:40px"><h2>Cutroom could not start its editor service</h2><p>${why}</p><p>Close this window and open Cutroom again. If it keeps happening, another program may be using port ${PORT}.</p></body>`)}`);
  if (!up) return fail(`Nothing answered on port ${PORT} after 40 seconds.`);
  await win.loadURL(`http://127.0.0.1:${PORT}/`).catch((e) => fail(String(e.message || e)));
}

app.setAppUserModelId('Cutroom');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => {
  if (!server?.pid) return;
  // Stop only the server this window started; taskkill /t can fail silently (it needs WMI), so kill it directly too
  if (process.platform === 'win32') {
    const tk = spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true });
    tk.on('exit', () => server.exitCode === null && server.kill());
    tk.on('error', () => server.kill());
  } else server.kill();
});
