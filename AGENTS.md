# AGENTS.md

Instructions for AI agents and automated contributors working in this repository.
Read this before changing code, branches, docs, releases, or backups. If it
conflicts with an explicit instruction from the user, the user's instruction
wins; otherwise this file is the default contract.

## Project

`pr-helper-git` is a local-first Git and GitHub PR workbench:

- React 19 + TypeScript client, built by Vite.
- Node.js built-in `http` server, zero third-party runtime dependencies.
- Single-user, loopback-first; no database, no container runtime.
- Tier 1 in `bayjf/docs/PROJECT-TIER-CONVENTION.md` (not Tier 0/0.5).
- Desktop shell is maintained again, but stays thin: product behaviour lives
  in the React client and Node server; Swift owns only the window, process
  lifetime and macOS integration.

## Non-negotiables

- Work only inside `/Users/jiangfeng/000mycodes/pr-helper-git` and the backup
  root `/Users/jiangfeng/000mycodes-backups`.
- Long-lived branches are `main` (production) and `dev` (work). Do not create
  feature branches unless the user asks. Commit on `dev`; integrate through a
  `dev -> main` PR.
- Default to **local commits only**. Push only when the user explicitly asks.
  When a push is requested, wait for the resulting CI run before calling the
  task complete.
- Keep the desktop shell thin. Do not duplicate web features or business logic
  in Swift; native work is limited to windowing, process lifetime, menus,
  external-link handling and packaging. Do not add a second feature surface
  that the web UI cannot exercise.
- Do not reintroduce: containers, worktrees, submodule writes, GPG signing,
  GitHub App OAuth, webhooks, a database, web push, or deployment gates.
- Runtime names are `~/.pr-helper-git`, localStorage `pr-helper-git:*`,
  cookie `pr_helper_git_token`, env `PR_HELPER_GIT_*`. Legacy `GIT2_*` names
  remain as compatibility fallbacks; never remove them without a migration
  and an explicit user decision.
- Never print, log, or commit tokens, PATs, AI keys, cookie values, or
  `config.json` contents. Backups must redact secret-shaped fields.

## Layout

```text
src/                    React client
  api/                  typed API client, split by domain
  components/           UI components and modals
  lib/                  pure helpers and storage keys
server/                 Node HTTP server and Git/GitHub routes
  main.mjs              entry, auth, static hosting, SSE
  routes-git*.mjs       Git API dispatcher and domain modules
  routes-github.mjs     GitHub REST allowlist and GraphQL merge helpers
e2e/run.sh              curl-driven E2E against a throwaway server
scripts/                dev launcher and desktop build
desktop/                thin Swift WKWebView shell (no feature logic)
docs/                   long-lived reference docs
handoff.md              delivery ledger, scope, release history, lessons
CHANGELOG.md            user-visible changes per release
```

## Commands

```bash
npm ci                    # reproducible install (Node 22, see .nvmrc)
npm run dev               # Vite :5173 + API :4789
npm start                 # production-style single-port server

npm run lint              # tsc --noEmit
npm run typecheck:server  # checkJs over server/*.mjs
npm test                  # Vitest unit + route tests
npm run build             # production build into dist/
npm run desktop           # macOS-only: build build/PR Helper Git.app
BUNDLE_NODE=1 npm run desktop # same app with official Node 22 inside
npm run desktop:native-test # macOS-only: pure Swift download-path tests (no GUI)
npm run desktop:smoke     # verify the assembled bundle without launching it
npm run desktop:dist      # macOS-only: zip/dmg/checksums (signs when configured)
BUNDLE_NODE=1 npm run desktop:dist # distribution artifacts with Node
npm run e2e               # real loopback server + curl assertions
```

Full gate before a release or a PR:

```bash
npm run lint && npm run typecheck:server && npm test && npm run build && npm run e2e
```

Desktop gate (macOS only, when `desktop/` or the build script changes):

```bash
npm run desktop:native-test
npm run desktop
npm run desktop:smoke
plutil -p "build/PR Helper Git.app/Contents/Info.plist" | grep CFBundleShortVersionString
otool -l "build/PR Helper Git.app/Contents/MacOS/PR Helper Git" | grep -A2 LC_BUILD_VERSION
```

The macOS CI job runs `desktop:native-test`, `BUNDLE_NODE=1 desktop:dist`,
`BUNDLE_NODE=1 desktop:smoke`, then verifies `build/release/SHA256SUMS`.

Use `BUNDLE_NODE=1` for artifacts intended for another Mac. The default
`npm run desktop` uses the host's Node installation and is enough for local
development.

Before publishing a desktop build, run `npm run desktop:dist` and verify the
artifacts and checksums. Signing/notarization env vars and certificate setup
are documented in `docs/desktop-distribution.md`.

E2E uses port `18774`, token `dev-token`, and an isolated `PR_HELPER_HOME`;
it never reads or writes `~/.pr-helper-git`.

## Workflow

1. Check state:

   ```bash
   git status -sb
   git branch --show-current
   git log --oneline -5
   ```

2. Work on `dev`. Read the relevant code before editing; keep the change scoped.
3. Add or update tests when behaviour changes. Do not loosen an existing
   assertion just to make a failure disappear.
4. Run the full gate.
5. Commit with a Conventional Commit message, for example:

   ```text
   fix(server): reject percent-encoded parent segments
   refactor(ui): extract commit graph rows
   test(e2e): assert the pulled commit by SHA
   chore(release): 0.2.4
   ```

6. For integration, open a `dev -> main` PR, wait for checks, then merge.
   Do not rewrite `main` history.

## Release checklist

1. `git checkout dev`, `git merge --ff-only origin/main`, clean tree.
2. `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and lock).
3. Add a new `## [X.Y.Z] - YYYY-MM-DD` section at the top of `CHANGELOG.md`.
4. Add a `## Release X.Y.Z` section to `handoff.md` with scope and gates.
5. Run the full gate, then commit `chore(release): X.Y.Z` and push `dev`
   (only with explicit push approval).
6. Open and merge the release PR; confirm `main` and `dev` point at the same
   merge commit.
7. Create an **annotated** tag on the release commit, not on the merge commit:

   ```bash
   git tag -a vX.Y.Z <release-commit> -m "pr-helper-git vX.Y.Z — <summary>"
   git push origin vX.Y.Z
   ```

8. Refresh the backup and verify the bundle heads include `main`, `dev`, and
   the new tag:

   ```bash
   bash /Users/jiangfeng/000mycodes-backups/pr-helper-backup.sh
   git bundle list-heads <latest.bundle> | grep -E 'refs/heads/(main|dev)|refs/tags/vX.Y.Z'
   ```

## Documentation duties

- Behaviour, setup, security, or checks change: update `README.md`.
- User-visible change or release: update `CHANGELOG.md`.
- Release, major refactor, migration, or lesson learned: update `handoff.md`.
- Process or agent contract change: update `AGENTS.md` / `CONTRIBUTING.md`.
- Long-lived architecture/reference material: add it under `docs/` and link it
  from `docs/README.md`.
- Keep version numbers consistent across `package.json`, `package-lock.json`,
  `CHANGELOG.md`, and `handoff.md`.

## Verification baseline

As of the pr-helper migration Phase 1/2 work (2026-11-14):

- unit/route tests: **959 tests / 44 files** (includes the migrated pr-helper
  engine test nets: 418 store invariants in `server/workflows-store.test.ts`,
  workflow-rows / github-api / ai-credentials suites in `server/`, 143
  automation domain tests plus 13 flow-board semantics tests under
  `src/lib/automation/`, and 7 control-tower route tests in `server/flows.test.ts`)
- E2E: **144 passed / 0 failed**
- build: passes
- CI: `main` and `dev` both green; workflow runs Linux test and macOS desktop jobs

`jsdom` is pinned to exact `26.1.0` (do not `npm update` across majors): the
host's Node drifts between 20.x and 26.x, jsdom 31 requires Node ≥22.22 and
crashes at import under Node 20 (undici), while Node ≥22 also shadows jsdom's
`window.localStorage` with an undefined experimental global — both handled by
this pin plus `src/test-setup.ts`. If the reported test-file count suddenly
drops by ~6, check these two before anything else.

Update these numbers when the baseline changes. Historical numbers in
`handoff.md` are records, not the current baseline.

## Desktop compatibility

The shell sets `PR_HELPER_GIT_DESKTOP=1` and the legacy `GIT2_DESKTOP=1`, and
accepts both `PR_HELPER_GIT_READY` and legacy `GIT2_READY`. The server still
accepts the legacy environment name. Do not remove either side of this
compatibility bridge without a migration and an explicit user decision.

Desktop changes must keep the app a thin wrapper over the same web client and
server. Native work may add windowing, menus, folder pickers, downloads and
external-link handling, but registration/feature flows stay in the web UI.
After changing `desktop/` or `scripts/desktop-build.mjs`, run
`npm run desktop` and verify the bundle version matches `package.json`.
`DESKTOP_BUNDLE_ID` is for distribution builds; do not change the local
default `local.pr-helper-git` without an explicit user decision, because it
changes the app container and preferences.
