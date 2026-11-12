// Compiles and runs the pure-Swift download destination tests. This does not
// launch the GUI, so it works in CI and on locked machines.
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'prh-desktop-test-'));
try {
  const binary = path.join(work, 'download-destination-test');
  execFileSync('/usr/bin/swiftc', [
    path.join(root, 'desktop/DownloadDestination.swift'),
    path.join(root, 'desktop/DownloadDestinationTest.swift'),
    '-o', binary,
  ], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally {
  await fsp.rm(work, { recursive: true, force: true });
}
