// Starts the desktop app. Clears ELECTRON_RUN_AS_NODE, which VS Code terminals inherit and which turns Electron into plain Node.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(here, 'main.cjs')], { env, stdio: 'inherit', detached: process.argv.includes('--detach') });
if (process.argv.includes('--detach')) child.unref();
else child.on('close', (code) => process.exit(code ?? 0));
