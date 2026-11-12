// Builds a distributable macOS artifact. Local-only builds work without any
// Apple credentials; setting APPLE_SIGNING_IDENTITY turns on hardened-runtime
// signing, and APPLE_NOTARY_PROFILE adds notarization + stapling.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appName = 'PR Helper Git';
const appPath = path.join(root, 'dist', `${appName}.app`);
const releaseDir = path.join(root, 'dist', 'release');
const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const buildNumber = process.env.BUILD_NUMBER || '1';
const bundleId = process.env.DESKTOP_BUNDLE_ID || 'local.pr-helper-git';
const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '';
const notaryProfile = process.env.APPLE_NOTARY_PROFILE?.trim() || '';
const skipBuild = process.argv.includes('--skip-build');

const log = (msg) => console.log(`[desktop-dist] ${msg}`);

function run(command, args, extraEnv = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

if (notaryProfile && !identity) {
  throw new Error('APPLE_NOTARY_PROFILE requires APPLE_SIGNING_IDENTITY.');
}

log(`version ${version}, bundle ${bundleId}, build ${buildNumber}`);
if (!skipBuild) {
  log('building app…');
  run(process.execPath, [path.join(root, 'scripts/desktop-build.mjs')], {
    DESKTOP_BUNDLE_ID: bundleId,
    BUILD_NUMBER: buildNumber,
  });
} else if (!fs.existsSync(appPath)) {
  throw new Error(`Missing ${appPath}; run without --skip-build first.`);
}

await fsp.mkdir(releaseDir, { recursive: true });

if (identity) {
  log(`signing with ${identity}`);
  run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--options', 'runtime',
    '--timestamp',
    '--sign', identity,
    appPath,
  ]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
} else {
  log('no APPLE_SIGNING_IDENTITY; producing unsigned local artifact');
}

const zipPath = path.join(releaseDir, `${appName}-${version}-macos.zip`);
const dmgPath = path.join(releaseDir, `${appName}-${version}-macos.dmg`);

async function makeZip(target) {
  await fsp.rm(target, { force: true });
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, target]);
}

await makeZip(zipPath);

if (notaryProfile) {
  log(`notarizing with keychain profile ${notaryProfile}`);
  run('/usr/bin/xcrun', [
    'notarytool',
    'submit',
    zipPath,
    '--wait',
    '--keychain-profile', notaryProfile,
  ]);
  log('stapling the app');
  run('/usr/bin/xcrun', ['stapler', 'staple', appPath]);
  run('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
  // Recreate the zip so the Release asset contains the stapled app.
  await makeZip(zipPath);
} else if (identity) {
  log('APPLE_NOTARY_PROFILE is not set; signed but not notarized');
}

log('creating dmg');
await fsp.rm(dmgPath, { force: true });
run('/usr/bin/hdiutil', [
  'create',
  '-volname', appName,
  '-srcfolder', appPath,
  '-ov',
  '-format', 'UDZO',
  dmgPath,
]);
process.stdout.write('\n');

if (notaryProfile) {
  log('notarizing the dmg');
  run('/usr/bin/xcrun', [
    'notarytool',
    'submit',
    dmgPath,
    '--wait',
    '--keychain-profile', notaryProfile,
  ]);
  run('/usr/bin/xcrun', ['stapler', 'staple', dmgPath]);
  run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath]);
}

const checksumLines = [];
for (const file of [zipPath, dmgPath]) {
  checksumLines.push(`${await sha256(file)}  ${path.basename(file)}`);
}
const checksumPath = path.join(releaseDir, 'SHA256SUMS');
await fsp.writeFile(checksumPath, `${checksumLines.join('\n')}\n`, 'utf8');

log(`artifacts in ${path.relative(root, releaseDir)}:`);
for (const file of [zipPath, dmgPath, checksumPath]) {
  log(`  ${path.relative(root, file)}`);
}
if (!identity || !notaryProfile) {
  log('local artifacts only: signing/notarization was not fully enabled');
}
