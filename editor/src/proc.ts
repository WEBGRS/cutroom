// Stop a child process and everything it started
import { spawn, type ChildProcess } from 'node:child_process';

export function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') return void child.kill();
  // taskkill /t finds the tree while the parent lives; it relies on WMI, which can hang or fail silently,
  // so the child itself is killed directly afterwards if it is still there
  const direct = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  const tk = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  tk.on('exit', direct);
  tk.on('error', direct);
  tk.unref();
  setTimeout(direct, 3000).unref();
}
