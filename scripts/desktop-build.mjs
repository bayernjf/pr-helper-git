// Builds a self-contained macOS .app bundle with zero third-party UI/runtime
// dependencies. The bundle hosts the built client and the Node server, while
// a Swift-compiled WKWebView shell supplies the native window and manages the
// server process. Set BUNDLE_NODE=1 to include an official standalone Node.js
// runtime so the app does not depend on the machine's Node installation.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appName = 'PR Helper Git';
// The .app lives under build/ (not dist/) so `vite build` — which empties its
// outDir — cannot delete the assembled bundle.
const outApp = path.join(root, 'build', `${appName}.app`);
const contents = path.join(outApp, 'Contents');
const macosDir = path.join(contents, 'MacOS');
const resourcesDir = path.join(contents, 'Resources');
const appDir = path.join(resourcesDir, 'app');
const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
const buildNumber = process.env.BUILD_NUMBER || '1';
const bundleId = process.env.DESKTOP_BUNDLE_ID || 'local.pr-helper-git';
const bundleNode = process.env.BUNDLE_NODE === '1';
const nodeVersion = process.env.NODE_BUNDLE_VERSION || '22.23.5';
const nodeArch = process.arch === 'arm64' ? 'arm64' : 'x64';

const log = (msg) => console.log(`[desktop] ${msg}`);

async function copyTree(src, dest, filter) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    if (filter && filter(entry.name, entry.isDirectory())) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, filter);
    else if (entry.isFile()) await fsp.copyFile(from, to);
  }
}

// Downloads and verifies the official Node.js macOS tarball into an ignored
// build cache. Only `bin/node` and `LICENSE` are copied into the app.
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const data = await fsp.readFile(file);
  hash.update(data);
  return hash.digest('hex');
}

async function ensureBundledNode() {
  const archiveName = `node-v${nodeVersion}-darwin-${nodeArch}.tar.gz`;
  const cacheDir = path.join(root, 'build', 'node-cache', `v${nodeVersion}-darwin-${nodeArch}`);
  const extractedDir = path.join(cacheDir, `node-v${nodeVersion}-darwin-${nodeArch}`);
  const nodePath = path.join(extractedDir, 'bin', 'node');
  const licensePath = path.join(extractedDir, 'LICENSE');
  const archivePath = path.join(cacheDir, archiveName);

  if (
    (await fsp.stat(nodePath).catch(() => null))?.isFile() &&
    (await fsp.stat(licensePath).catch(() => null))?.isFile()
  ) {
    return { nodePath, licensePath };
  }

  await fsp.mkdir(cacheDir, { recursive: true });
  const baseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
  const shasums = await fetch(`${baseUrl}/SHASUMS256.txt`);
  if (!shasums.ok) throw new Error(`Node checksum download failed: HTTP ${shasums.status}`);
  const checksumLine = (await shasums.text())
    .split('\n')
    .find((line) => line.trim().endsWith(`  ${archiveName}`));
  if (!checksumLine) throw new Error(`No checksum for ${archiveName}`);
  const expected = checksumLine.trim().split(/\s+/)[0];

  let actual = null;
  if ((await fsp.stat(archivePath).catch(() => null))?.isFile()) {
    actual = await sha256File(archivePath);
  }
  if (actual !== expected) {
    log(`downloading Node ${nodeVersion} (${nodeArch})…`);
    const response = await fetch(`${baseUrl}/${archiveName}`);
    if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(archivePath, data);
    actual = await sha256File(archivePath);
    if (actual !== expected) throw new Error(`Node checksum mismatch: ${actual} != ${expected}`);
  }

  log(`verifying Node ${nodeVersion} (${nodeArch})…`);
  execFileSync('/usr/bin/tar', ['-xzf', archivePath, '-C', cacheDir], { stdio: 'inherit' });
  const nodeStat = await fsp.stat(nodePath).catch(() => null);
  if (!nodeStat?.isFile()) throw new Error(`Missing ${nodePath} after extraction`);
  const licenseStat = await fsp.stat(licensePath).catch(() => null);
  if (!licenseStat?.isFile()) throw new Error(`Missing ${licensePath} after extraction`);
  return { nodePath, licensePath };
}

// Renders the icon from the Swift source, scales every required size with the
// system sips tool and packages an .icns via iconutil — all zero-dependency
// macOS tools. The intermediate files live in a temp directory that is removed
// afterwards; only the finished .icns lands in the bundle.
async function buildIcon() {
  log('rendering app icon (swift + sips + iconutil)…');
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-icon-'));
  try {
    const source = path.join(work, 'icon-1024.png');
    execFileSync('/usr/bin/swift', [path.join(root, 'desktop/make-icon.swift'), source]);
    const iconSet = path.join(work, 'AppIcon.iconset');
    await fsp.mkdir(iconSet);
    const variants = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ];
    for (const [name, px] of variants) {
      execFileSync('/usr/bin/sips', ['-z', String(px), String(px), source, '--out', path.join(iconSet, name)]);
    }
    await fsp.mkdir(resourcesDir, { recursive: true });
    execFileSync('/usr/bin/iconutil', [
      '-c', 'icns', iconSet,
      '-o', path.join(resourcesDir, 'AppIcon.icns'),
    ]);
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${pkg.version}</string>
  <key>CFBundleVersion</key>
  <string>${buildNumber}</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.3</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
`;

// 1. Build the web client.
log('building client (vite build)…');
execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: root,
  stdio: 'inherit',
});

// 2. Reset and create the bundle skeleton.
log(`assembling ${path.relative(root, outApp)}`);
await fsp.rm(outApp, { recursive: true, force: true });
await fsp.mkdir(macosDir, { recursive: true });
await fsp.mkdir(appDir, { recursive: true });

// 3. Copy the server (tests excluded) and the built client. The dist filter
//    excludes this very bundle so it is never copied into itself.
await copyTree(
  path.join(root, 'server'),
  path.join(appDir, 'server'),
  (name) => name.endsWith('.test.mjs'),
);
await copyTree(
  path.join(root, 'dist'),
  path.join(appDir, 'dist'),
  (name, isDirectory) => isDirectory && name === `${appName}.app`,
);

// 4. Write Info.plist.
await fsp.writeFile(path.join(contents, 'Info.plist'), infoPlist, 'utf8');

// 5. Optionally bundle the official Node.js runtime.
if (bundleNode) {
  const { nodePath, licensePath } = await ensureBundledNode();
  const runtimeDir = path.join(resourcesDir, 'runtime');
  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.copyFile(nodePath, path.join(runtimeDir, 'node'));
  await fsp.chmod(path.join(runtimeDir, 'node'), 0o755);
  await fsp.copyFile(licensePath, path.join(runtimeDir, 'LICENSE'));
  const size = (await fsp.stat(path.join(runtimeDir, 'node'))).size;
  log(`bundled Node ${nodeVersion} (${nodeArch}, ${Math.round(size / 1024 / 1024)} MB)`);
}

// 6. Generate and place the application icon.
await buildIcon();

// 7. Compile the native shell into the bundle.
log('compiling native shell (swiftc)…');
const swiftArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
execFileSync(
  '/usr/bin/swiftc',
  [
    path.join(root, 'desktop/DownloadDestination.swift'),
    path.join(root, 'desktop/UpdateCheck.swift'),
    path.join(root, 'desktop/main.swift'),
    '-target', `${swiftArch}-apple-macos11.3`,
    '-o', path.join(macosDir, appName),
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: '11.3' },
  },
);

log(`done → ${outApp}`);
