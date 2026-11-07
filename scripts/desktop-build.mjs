// Builds a self-contained macOS .app bundle with zero third-party runtime
// dependencies. The bundle hosts the built client and the Node server, while
// a Swift-compiled WKWebView shell supplies the native window and manages the
// already-installed Node.js process.
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appName = 'PR Helper Git2';
const outApp = path.join(root, 'dist', `${appName}.app`);
const contents = path.join(outApp, 'Contents');
const macosDir = path.join(contents, 'MacOS');
const appDir = path.join(contents, 'Resources', 'app');

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

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>local.pr-helper-git2</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
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

// 5. Compile the native shell into the bundle.
log('compiling native shell (swiftc)…');
execFileSync(
  '/usr/bin/swiftc',
  [path.join(root, 'desktop/main.swift'), '-o', path.join(macosDir, appName)],
  { stdio: 'inherit' },
);

log(`done → ${outApp}`);
