// Development launcher: runs the Vite dev server and the local API server
// together, with both processes sharing this process lifecycle.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;

const children = [
  spawn(node, [path.join(root, 'node_modules/vite/bin/vite.js')], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  }),
  spawn(node, [path.join(root, 'server/main.mjs')], {
    cwd: root,
    env: { ...process.env, GIT2_DEV: '1' },
    stdio: 'inherit',
  }),
];

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) shutdown(code);
  });
}
