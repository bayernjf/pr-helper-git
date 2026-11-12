# Desktop distribution

The desktop app is a thin Swift `WKWebView` shell around the same React client
and Node server. Local development only needs `npm run desktop`; this document
covers the optional path from a local `.app` to a signed, notarized release.

## What the build produces

`npm run desktop:dist` runs the desktop build, then writes artifacts under
`dist/release/`:

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
2. Signs the app with hardened runtime and a timestamp.
3. Verifies the signature with `codesign --verify --deep --strict`.
4. Creates a zip, submits it to `notarytool`, staples the app, and recreates the
   zip with the stapled app.
5. Creates the dmg, submits it to `notarytool`, and staples the dmg.
6. Writes `SHA256SUMS`.

If `APPLE_SIGNING_IDENTITY` is set but `APPLE_NOTARY_PROFILE` is not, the app is
signed but not notarized; the script says so explicitly.

## Verify before publishing

```bash
npm run desktop:native-test
npm run desktop:smoke
codesign --verify --deep --strict --verbose=2 "dist/PR Helper Git.app"
otool -l "dist/PR Helper Git.app/Contents/MacOS/PR Helper Git" | grep -A2 LC_BUILD_VERSION
xcrun stapler validate "dist/PR Helper Git.app"
spctl -a -vv "dist/PR Helper Git.app"
unzip -t "dist/release/PR Helper Git-<version>-macos.zip"
hdiutil verify "dist/release/PR Helper Git-<version>-macos.dmg"
(cd dist/release && shasum -a 256 -c SHA256SUMS)
```

The CI workflow runs `desktop:native-test`, an unsigned `desktop:dist` and
`desktop:smoke` on a macOS runner, then checks `SHA256SUMS`. It does not have
Apple signing credentials, so the signed/notarized path still needs one release
run on a machine with the certificate and notary profile.

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

- The app still uses the Node.js installed on the machine; a distributed build
  does not bundle a Node runtime. A recipient must have Node 22 available at a
  well-known path or the app reports that Node was not found.
- Signing uses hardened runtime without extra entitlements. WKWebView content
  runs in WebKit's own process; if a future macOS build reports a JIT failure
  inside the app process, add `com.apple.security.cs.allow-jit` in a local
  entitlements file and pass it to `codesign`.
- The desktop shell has no auto-update mechanism. Distribute a new version and
  let the user replace the app.
- Local unsigned builds and distribution builds can use different bundle ids;
  preferences are intentionally separate.
