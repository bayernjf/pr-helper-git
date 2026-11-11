// Builds a self-contained macOS .app bundle with zero third-party runtime
// dependencies. The bundle hosts the built client and the Node server, while
// a Swift-compiled WKWebView shell supplies the native window and manages the
// already-installed Node.js process.
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appName = 'PR Helper Git';
const outApp = path.join(root, 'dist', `${appName}.app`);
const contents = path.join(outApp, 'Contents');
const macosDir = path.join(contents, 'MacOS');
const resourcesDir = path.join(contents, 'Resources');
const appDir = path.join(resourcesDir, 'app');

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
  <string>local.pr-helper-git</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
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

// 5. Generate and place the application icon.
await buildIcon();

// 6. Compile the native shell into the bundle.
log('compiling native shell (swiftc)…');
execFileSync(
  '/usr/bin/swiftc',
  [path.join(root, 'desktop/main.swift'), '-o', path.join(macosDir, appName)],
  { stdio: 'inherit' },
);

log(`done → ${outApp}`);
