// Compiles and runs the pure-Swift desktop tests (download destinations and
// the update-check fetch fallback). This does not launch the GUI, so it works
// in CI and on locked machines.
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
    path.join(root, 'desktop/UpdateCheck.swift'),
    path.join(root, 'desktop/UpdateChecksum.swift'),
    path.join(root, 'desktop/DownloadDestinationTest.swift'),
    '-o', binary,
  ], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });

  const serverPortBinary = path.join(work, 'server-port-test');
  execFileSync('/usr/bin/swiftc', [
    path.join(root, 'desktop/ServerPort.swift'),
    path.join(root, 'desktop/ServerPortTest.swift'),
    '-o', serverPortBinary,
  ], { stdio: 'inherit' });
  execFileSync(serverPortBinary, [], { stdio: 'inherit' });

  const windowGeometryBinary = path.join(work, 'window-geometry-test');
  execFileSync('/usr/bin/swiftc', [
    path.join(root, 'desktop/WindowGeometry.swift'),
    path.join(root, 'desktop/WindowGeometryTest.swift'),
    '-o', windowGeometryBinary,
  ], { stdio: 'inherit' });
  execFileSync(windowGeometryBinary, [], { stdio: 'inherit' });

  const updateBinary = path.join(work, 'update-fetch-test');
  execFileSync('/usr/bin/swiftc', [
    path.join(root, 'desktop/UpdateCheck.swift'),
    path.join(root, 'desktop/UpdateChecksum.swift'),
    path.join(root, 'desktop/UpdateManager.swift'),
    path.join(root, 'desktop/UpdateFetchTest.swift'),
    '-o', updateBinary,
  ], { stdio: 'inherit' });
  execFileSync(updateBinary, [], { stdio: 'inherit', env: { ...process.env } });
} finally {
  await fsp.rm(work, { recursive: true, force: true });
}
