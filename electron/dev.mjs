import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteEntry = resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const devUrl = 'http://127.0.0.1:5173/';

const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

let desktop;
let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  desktop?.kill();
  vite.kill();
  process.exitCode = exitCode;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('exit', (code) => {
  if (!stopping) stop(code || 1);
});

async function waitForVite() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(devUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('Vite did not start at ' + devUrl);
}

try {
  await waitForVite();
  desktop = spawn(electron, ['.'], {
    cwd: projectRoot,
    env: { ...process.env, XITOMATL_DESKTOP_DEV: '1' },
    stdio: 'inherit',
  });
  desktop.on('exit', (code) => stop(code || 0));
} catch (error) {
  console.error(error);
  stop(1);
}
