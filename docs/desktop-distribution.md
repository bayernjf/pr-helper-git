# Desktop distribution

The desktop app is a thin Swift `WKWebView` shell around the same React client
and Node server. Local development only needs `npm run desktop`; this document
covers the optional path from a local `.app` to a signed, notarized release.

## What the build produces

`npm run desktop:dist` runs the desktop build, then writes artifacts under
`build/release/`:

- `PR Helper Git-<version>-macos.zip` — zipped `.app` for direct download;
- `PR Helper Git-<version>-macos.dmg` — disk image;
- `SHA256SUMS` — SHA-256 for both artifacts.

The default bundle id is `local.pr-helper-git`. That is intentional for a
local-only build: changing it creates a different app container, so the
`WKWebView` localStorage preferences and saved window frame do not carry over.

## Local unsigned build

```bash
npm run desktop:dist
```

Without `APPLE_SIGNING_IDENTITY`, the script produces unsigned artifacts and
prints a warning. The app is usable locally, but another Mac may require a
one-time Gatekeeper approval under **System Settings → Privacy & Security**.

## Bundling Node.js

A local build uses the machine's Node.js. A distribution build should include
the official runtime so the recipient does not need Node installed:

```bash
BUNDLE_NODE=1 npm run desktop:dist
```

`desktop-build.mjs` downloads the official
`node-v<version>-darwin-<arch>.tar.gz` from `nodejs.org/dist`, verifies it
against `SHASUMS256.txt`, caches it under `build/node-cache/`, and copies only
`bin/node` and `LICENSE` into `Contents/Resources/runtime`. The default is
Node `22.23.5`; override with `NODE_BUNDLE_VERSION` only when intentionally
changing the runtime.

The shell resolves `Contents/Resources/runtime/node` first and falls back to a
system Node installation. `desktop:smoke` checks the runtime license, version
(`>= 22`) and Mach-O format. The resulting app is about 114 MB instead of
about 1.5 MB.

## Signed and notarized build

Prerequisites:

- Apple Developer Program membership.
- A **Developer ID Application** certificate in the login keychain.
- Xcode command-line tools (`codesign`, `notarytool`, `stapler`).
- A notarytool keychain profile; do not put the password in this repository or
  in shell history.

Find the signing identity:

```bash
security find-identity -v -p codesigning
```

Store notary credentials once:

```bash
xcrun notarytool store-credentials "pr-helper-git" \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

Build with a distribution bundle id and signing identity:

```bash
DESKTOP_BUNDLE_ID=com.bayernjf.pr-helper-git \
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
APPLE_NOTARY_PROFILE=pr-helper-git \
BUILD_NUMBER="$(git rev-list --count HEAD)" \
npm run desktop:dist
```

What the script does:

1. Builds the app and writes the version from `package.json` into
   `CFBundleShortVersionString`.
2. If a bundled Node runtime is present, signs it first with
   `desktop/node.entitlements` (JIT and unsigned executable memory), using
   hardened runtime and a timestamp.
3. Signs the outer app without `--deep`, so the nested Node signature and its
   entitlements are preserved.
4. Verifies the signature with `codesign --verify --deep --strict`.
5. Creates a zip, submits it to `notarytool`, staples the app, and recreates the
   zip with the stapled app.
6. Creates the dmg, submits it to `notarytool`, and staples the dmg.
7. Writes `SHA256SUMS`.

If `APPLE_SIGNING_IDENTITY` is set but `APPLE_NOTARY_PROFILE` is not, the app is
signed but not notarized; the script says so explicitly.

## Verify before publishing

```bash
npm run desktop:native-test
npm run desktop:smoke
codesign --verify --deep --strict --verbose=2 "build/PR Helper Git.app"
otool -l "build/PR Helper Git.app/Contents/MacOS/PR Helper Git" | grep -A2 LC_BUILD_VERSION
xcrun stapler validate "build/PR Helper Git.app"
spctl -a -vv "build/PR Helper Git.app"
unzip -t "build/release/PR Helper Git-<version>-macos.zip"
hdiutil verify "build/release/PR Helper Git-<version>-macos.dmg"
(cd build/release && shasum -a 256 -c SHA256SUMS)
```

The CI workflow runs `desktop:native-test`, `BUNDLE_NODE=1 desktop:dist` and
`BUNDLE_NODE=1 desktop:smoke` on a macOS runner, then checks `SHA256SUMS`. It
does not have Apple signing credentials, so the signed/notarized path still
needs one release run on a machine with the certificate and notary profile.

`LC_BUILD_VERSION minos` must read `11.3` to match `LSMinimumSystemVersion`.
The build script passes an explicit `-target`/`MACOSX_DEPLOYMENT_TARGET`;
without it, Swift on a newer macOS can stamp a much newer minos into the binary.

## Publishing

The current project policy is local commits and manual releases. For a public
release:

1. Finish the release checklist in `AGENTS.md`; tag the release commit.
2. Build with a stable distribution bundle id and both signing variables.
3. Attach the zip, dmg and `SHA256SUMS` to the release.
4. Publish checksums next to the artifacts, not inside the app bundle.

Do not commit the `.app`, zip, dmg, certificates, keychain profiles, Apple ID,
team password, or app-specific password. `dist/` is already ignored.

## Known limits

- The default local app uses the Node.js installed on the machine. Distribution
  builds can set `BUNDLE_NODE=1` to carry the official Node 22 runtime; a build
  without it still reports that Node was not found if the recipient has no
  supported installation.
- Signing uses hardened runtime; when a bundled Node is present it also gets
  JIT and unsigned-executable-memory entitlements. The outer app has no extra
  entitlements because WKWebView content runs in WebKit's own process. If a
  future macOS build reports a separate JIT failure in the app process, add
  the relevant entitlement to the outer signing step.
- The desktop shell has only a lightweight **Check for Updates…** action: it
  reads the latest GitHub Release and offers the release page. It does not
  download, replace, or roll back the app; a full auto-updater still needs a
  stable feed, signing/notarization and a rollback plan.
- Local unsigned builds and distribution builds can use different bundle ids;
  preferences are intentionally separate.
