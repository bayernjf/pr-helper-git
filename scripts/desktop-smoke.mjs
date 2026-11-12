// Verifies the assembled macOS bundle without launching the GUI. This is the
// CI-safe half of the desktop smoke test: it catches stale Info.plist fields,
// missing bundle resources and a missing native executable.
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appName = 'PR Helper Git';
const appPath = path.join(root, 'build', `${appName}.app`);
const contents = path.join(appPath, 'Contents');
const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
const expectedBundleId = process.env.DESKTOP_BUNDLE_ID || 'local.pr-helper-git';

function fail(message) {
  console.error(`[desktop-smoke] ${message}`);
  process.exit(1);
}

async function requireFile(file, label) {
  try {
    await fsp.access(file);
  } catch {
    fail(`missing ${label}: ${path.relative(root, file)}`);
  }
}

await requireFile(path.join(contents, 'Info.plist'), 'Info.plist');
await requireFile(path.join(contents, 'MacOS', appName), 'app executable');
await requireFile(path.join(contents, 'Resources', 'AppIcon.icns'), 'app icon');
await requireFile(path.join(contents, 'Resources', 'app', 'server', 'main.mjs'), 'bundled server');
await requireFile(path.join(contents, 'Resources', 'app', 'dist', 'index.html'), 'bundled client');

const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')], {
  encoding: 'utf8',
}));
if (info.CFBundleShortVersionString !== pkg.version) {
  fail(`version mismatch: plist ${info.CFBundleShortVersionString}, package ${pkg.version}`);
}
if (info.CFBundleIdentifier !== expectedBundleId) {
  fail(`bundle id mismatch: plist ${info.CFBundleIdentifier}, expected ${expectedBundleId}`);
}
if (info.LSMinimumSystemVersion !== '11.3') {
  fail(`unexpected LSMinimumSystemVersion: ${info.LSMinimumSystemVersion}`);
}

const fileInfo = execFileSync('/usr/bin/file', [path.join(contents, 'MacOS', appName)], { encoding: 'utf8' });
if (!fileInfo.includes('Mach-O')) fail(`native executable is not Mach-O: ${fileInfo.trim()}`);

const loadCommands = execFileSync('/usr/bin/otool', ['-l', path.join(contents, 'MacOS', appName)], {
  encoding: 'utf8',
});
const minos = /minos\s+([0-9.]+)/.exec(loadCommands)?.[1];
if (minos !== info.LSMinimumSystemVersion) {
  fail(`binary minos ${minos ?? 'missing'} does not match LSMinimumSystemVersion ${info.LSMinimumSystemVersion}`);
}

execFileSync(process.execPath, ['--check', path.join(contents, 'Resources', 'app', 'server', 'main.mjs')], {
  stdio: 'inherit',
});

console.log(
  `[desktop-smoke] bundle OK: ${appName} ${info.CFBundleShortVersionString} (${info.CFBundleIdentifier})`,
);
