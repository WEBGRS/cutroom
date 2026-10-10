// Desktop shell: starts the editor server (unless one is already running) and opens it in its own window
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8814);
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

async function ensureServer() {
  if (await listening(PORT)) return;
  // Electron's own Node runs the server; renders and the CLI inherit it
  server = spawn(process.execPath, [path.join(ROOT, 'editor', 'dist', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT) },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 80 && !(await listening(PORT)); i++) await new Promise((r) => setTimeout(r, 100));
}

async function createWindow() {
  await ensureServer();
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
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
}

app.setAppUserModelId('Cutroom');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => {
  if (!server?.pid) return;
  // Stop only the server this window started
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true });
  else server.kill();
});
