// Electron 44+ no longer downloads its binary on install; fetch it unless skipped (CI sets ELECTRON_SKIP_BINARY_DOWNLOAD)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const script = 'node_modules/electron/install.js';
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD || !fs.existsSync(script)) process.exit(0);
const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
process.exit(r.status ?? 0);
