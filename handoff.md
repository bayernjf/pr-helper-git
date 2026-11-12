# Handoff — pr-helper-git

A local Git GUI (GitKraken-like core) plus a lightweight GitHub PR control
tower (pr-helper-like core). The app itself runs entirely on loopback and
pushes nothing. This repository, however, **is** on GitHub as the public
`bayernjf/pr-helper-git` (renamed from `pr-helper-git2` on 2026-11-11); treat
every committed file as world-readable.


## Rename completion (2026-11-12)

The product repository is now `bayernjf/pr-helper-git` (PUBLIC, default branch
`main`); the old repository of the same name is `bayernjf/pr-helper-git-archive`
(PRIVATE, archived). The local checkout is `/Users/jiangfeng/000mycodes/pr-helper-git`
and pushes to `git@github.com:bayernjf/pr-helper-git.git`.

Runtime identifiers were renamed with one-shot migrations:
- data dir `~/.pr-helper-git2` -> `~/.pr-helper-git` (rename on first boot when
  the new dir is absent); current real dir is 0700, files 0600;
- localStorage namespace `pr-helper-git:*`, including pinned, draft, diff font,
  prefs, dashboard, active repo, browser PAT, commit history and clone parent;
- auth cookie `git2_token` -> `pr_helper_git_token`, with legacy cookie/header
  fallback; env vars `GIT2_*` remain readable as fallbacks;
- Tauri bundle id and download filename follow the new name.

Verification: lint, `typecheck:server`, 336 unit tests / 34 files, production
build, and E2E 144/144. CI is green through release commit `72e206a` (run `43253045248`, test + desktop).

The desktop shell was **frozen** at the time of this rename; it was unfrozen
later on the same day (see “Desktop unfrozen” below). The old Qoder session copy
under the `pr-helper-git2` project key was archived to
`000mycodes-backups/qoder-project-pr-helper-git2-20261112.tar.gz` and removed;
the new session key has the equivalent 2,836-record transcript.

Backups: `pr-helper-backup.sh` now targets the renamed checkout/data dir,
redacts secret fields, and pins `main`/`dev`/tags explicitly so the bundle HEAD
does not depend on the currently checked-out branch. The latest
`000mycodes-backups/pr-helper-git/source-*.bundle` is verified as a complete
history; check `git bundle list-heads` for the exact main ref.

## Release 0.2.6 (2026-11-12)

> **发布状态（2026-11-12 更新）**：draft 已 publish 为正式版（draft=false,
> prerelease=false, `releases/latest` = v0.2.6 — 应用内 Check for Updates
> 的"有更新"分支自此可实测）；dev 与 main 均在 0.2.6 + jsdom pin
> （266c039，测试计数在 Node 20/26 漂移下稳定为 337/34）。


`package.json` / `package-lock.json` are at **0.2.6**; `CHANGELOG.md` has the
`[0.2.6]` section. `v0.2.6` is an annotated tag on this release commit.

Scope: optional bundling of the official Node `22.23.5` macOS runtime
(`BUNDLE_NODE=1`), a lightweight **Check for Updates…** app-menu action backed
by GitHub `releases/latest`, separate signing of the nested Node with JIT
entitlements, a bundled-Node smoke check, and macOS CI exercising the bundled
distribution path.

Gates: lint, server typecheck, 337 unit tests / 34 files, build, E2E 144/144;
`desktop:native-test`, `BUNDLE_NODE=1 desktop:dist`, `BUNDLE_NODE=1
desktop:smoke` and `SHA256SUMS` verification. The app bundle reports
`CFBundleShortVersionString = 0.2.6`, contains Node `22.23.5` arm64, and is
about 114 MB. Launching it produced a server child process running from
`Contents/Resources/runtime/node`, not the system Node.

GUI: clicking **Check for Updates…** opened a native alert reading
`No releases found`, because no GitHub Release was published yet. The
“newer version” branch stays unverified until the first release exists.

Artifacts under `build/release`: `PR Helper Git-0.2.6-macos.zip` (36 MB),
`PR Helper Git-0.2.6-macos.dmg` (41 MB) and `SHA256SUMS`; all unsigned. No
Developer ID certificate or notary profile was available, so the nested-Node
signing path and notarization were not exercised.

## Release 0.2.5 (2026-11-12)

`package.json` / `package-lock.json` are at **0.2.5**; `CHANGELOG.md` has the
`[0.2.5]` section. `v0.2.5` is an annotated tag on this release commit.

Scope: desktop shell unfreeze (Swift `WKWebView`, no Electron/Tauri), native
folder picker feeding the existing Add repository modal, `WKDownload`
handling into `~/Downloads` with collision suffixes and Finder reveal, the
`desktop:dist` zip/dmg/`SHA256SUMS` pipeline with signing/notarization hooks,
the macOS 11.3 deployment target fix, desktop artifacts moved under `build/`,
macOS CI and headless download/bundle tests, and the distribution/handoff
documentation. Gates: lint, server typecheck, 337 unit tests / 34 files,
build, E2E 144/144; `desktop:native-test`, `desktop:dist`, `desktop:smoke`
and `SHA256SUMS` verification. GUI click-through verified the folder picker
prefill, first export, `-2` collision suffix and Finder reveal.

The local `build/release` artifacts are unsigned; no Developer ID
certificate or notary profile was available, so signing/notarization was not
exercised.

## Release 0.2.4 (2026-11-12)

`package.json` / `package-lock.json` are at **0.2.4**; `CHANGELOG.md` has the
`[0.2.4]` section. `v0.2.4` is an annotated tag on this release commit.

Scope: server path/credential/allowlist hardening, explicit `stage-all`
action, POST-only write routes, the `src/api.ts` per-domain split, further
UI subcomponent extraction, review-found frontend fixes and remaining i18n
coverage. Gates: lint, server typecheck, 336 unit tests / 34 files, build,
E2E 144/144; CI covers both `main` and `dev`.

## Documentation entry points (2026-11-12)

Added `AGENTS.md` (agent contract: branches, local-push policy, frozen
desktop, runtime identifiers, gates, release checklist, backup rules),
`CONTRIBUTING.md` (human/agent workflow) and `docs/README.md` (document map).
README now points to all three and corrects stale claims: the API client is
`src/api/` rather than `src/api.ts`, the repository has a GitHub remote and
CI runs on `main`/`dev`, and the documented environment variables use the
`PR_HELPER_GIT_*` names with legacy `GIT2_*` aliases.

Known caveat at the time: the shell matched only the legacy `GIT2_READY`
prefix while the server emitted `PR_HELPER_GIT_READY`. That mismatch was fixed
in the following desktop-unfreeze pass; the shell now accepts both prefixes.

## Desktop unfrozen (2026-11-12)

The desktop shell is maintained again. Scope for the first pass: keep the
Swift `WKWebView` shell (no Electron/Tauri), keep product behaviour in the
React client and Node server, and make the current app build against the
current release.

- The shell now sets `PR_HELPER_GIT_DESKTOP=1` and the legacy
  `GIT2_DESKTOP=1`, and accepts both `PR_HELPER_GIT_READY` and legacy
  `GIT2_READY` readiness lines.
- Added standard macOS menus (app, File, Edit, View, Window), a 900×600
  minimum window size, and external-link handling: non-localhost URLs open in
  the default browser instead of replacing the app view.
- Added **File > Open Repository…**: `NSOpenPanel` selects a folder and sends
  the path through the existing `git2:add-repo` event, so the web modal keeps
  owning registration rather than a second native flow.
- Added `WKDownloadDelegate`: web downloads (team config export and similar)
  land in `~/Downloads`, get a numeric suffix on name collisions, and reveal
  in Finder when finished. Minimum system is macOS 11.3 for this API.
- `scripts/desktop-build.mjs` now reads `CFBundleShortVersionString` from
  `package.json` (0.2.4 at this point) instead of the stale `0.1.0` literal.
- Added a server-render test for the desktop folder-picker prefill; unit
  baseline moved from 336 to **337 tests / 34 files**. Full gate: lint, server
  typecheck, 337 unit tests, build, E2E 144/144; desktop build and startup
  smoke also pass.
- Added `npm run desktop:dist`: zip + dmg + `SHA256SUMS` under
  `build/release/`. It signs with hardened runtime when
  `APPLE_SIGNING_IDENTITY` is set and notarizes/staples both artifacts when
  `APPLE_NOTARY_PROFILE` is set. `DESKTOP_BUNDLE_ID` switches the bundle id
  for distribution.
- Added `docs/desktop-distribution.md` for certificate setup, `notarytool`
  keychain profiles, verification and manual publishing.
- Extracted download destination naming into `desktop/DownloadDestination.swift`
  and added a headless Swift test for collisions, extensionless names,
  path-traversal input and the empty-name fallback.
- Added `desktop:smoke`, which verifies Info.plist version/bundle id, minimum
  system, icon, bundled client/server and the Mach-O executable without
  launching the GUI.
- CI now has a macOS job: native download test, unsigned `desktop:dist`,
  bundle smoke, and `SHA256SUMS` verification.
- Fixed the deployment target stamp: Swift compiled against the current SDK
  was producing `minos 27.2` while Info.plist promised 11.3. The build now
  passes `-target` and `MACOSX_DEPLOYMENT_TARGET=11.3`; `desktop:smoke` fails
  if the binary minos and `LSMinimumSystemVersion` disagree.
- `npm run desktop` builds `build/PR Helper Git.app`; the bundle starts the
  bundled server and was smoke-tested on this machine.
- GUI click-through on 2026-11-12: **File > Open Repository…** opened
  `NSOpenPanel`, selected `/Users/jiangfeng/000mycodes/pr-helper-git`, and
  prefilled that exact path in the existing Add repository modal. **Team >
  Export team config** wrote `~/Downloads/pr-helper-git-team.json`; a second
  export wrote `pr-helper-git-team-2.json` and Finder selected the new file.
  The exported JSON contained the repository registry and members only, with
  no tokens or GitHub PATs.

Still open for desktop: a real signed/notarized release needs a Developer ID
and Apple notary account.

Desktop artifacts live under `build/` (not `dist/`), so `npm run build` (Vite)
no longer wipes `PR Helper Git.app` or `release/`.

## Post-0.2.2 hardening (2026-11-11)

Security pass after the code review: admin-only server PAT/AI settings, no
server-PAT inheritance for members, sensitive-path guards on stage/commit/
move/remove/clean/stash/AI, 0700/0600 data permissions, serialized config
writes with corruption backup, cloned-URL audit sanitization, watcher
reconciliation after registry changes, and a dev-mode non-loopback bind guard.
Light-theme legacy tokens now alias the shared design tokens. `routes-git.mjs`
is now a 100-line dispatcher (repo guard + AI routes) over `routes-git-helpers`,
`routes-git-meta`, `routes-git-read` and `routes-git-write`; the write module
itself fans out to worktree / refs / history / files / network / stash. Unit suite is
336 tests / 34 files; E2E is 144 checks and is now part of CI. Server
`checkJs` is gated by `npm run typecheck:server` (`tsconfig.server.json`).

## Release 0.2.2 (2026-11-11)

`package.json` / `package-lock.json` are at **0.2.2**; `CHANGELOG.md` has the
`[0.2.2]` section and a fresh `[Unreleased]`. The repository is tagged locally
as `v0.2.2`. No remote was configured at release time, so the tag was local-only then;
it is now published — all three tags verified on the public
`bayernjf/pr-helper-git` remote on 2026-11-11.

Scope: server-side PAT storage; destructive-scenario E2E coverage (115 -> 136);
this repository is now the sole primary implementation, with `pr-helper-git`
archived.

## Release 0.2.1 (2026-11-10)

`package.json` / `package-lock.json` are at **0.2.1**; `CHANGELOG.md` has the
`[0.2.1]` section and a fresh `[Unreleased]`. The repository is tagged locally
as `v0.2.1`. No remote was configured at release time, so the tag was local-only then;
it is now published — all three tags verified on the public
`bayernjf/pr-helper-git` remote on 2026-11-11.

## Release 0.2.0 (2026-11-10)

`package.json` / `package-lock.json` are at **0.2.0**; `CHANGELOG.md` has the
`[0.2.0]` section and a fresh `[Unreleased]`. The repository is tagged locally
as `v0.2.0`. No remote was configured at release time, so the tag was local-only then;
it is now published — all three tags verified on the public
`bayernjf/pr-helper-git` remote on 2026-11-11.

## Interaction contract (2026-11-10)

`ToastProvider` and `ConfirmProvider` are the shared contract for both clients:
toasts last 3.6 s and carry a kind icon (`toast-info` / `toast-success` /
`toast-error`); confirmations use `aria-labelledby` / `aria-describedby`, accept
`{ danger, confirmLabel }`, and use `btn-danger` only for destructive actions.
Never call `window.confirm` — `DashboardPage` now uses `useConfirm()` too.

**Current target: web-first, desktop maintained.** Desktop was unfrozen on
2026-11-12. The shell stays thin: features target the browser UI, while Swift
owns only windowing, process lifetime and macOS integration. `desktop/main.swift`
and `npm run desktop` are active again; see “Desktop unfrozen” at the top.

## Scope

- GitKraken-like: repo registry, commit graph, refs (branches/tags/stash),
  stage/unstage, commit, amend, checkout, branch create/rename/delete, merge,
  reset (soft/mixed/hard), fetch/pull/push, clone and init (three-mode add
  dialog), tag create/delete (lightweight + annotated), remote branch
  push/delete, stash, unified + split diff viewer, folder-tree working panel,
  commit graph search, paginated history (load more), right-click context
  menu, keyboard shortcuts, resizable work panel, responsive layout,
  error boundary, loading states, SSE live refresh, safe revert (new commit,
  merge commits rejected, conflicts preserved with continue/abort instead of an
  automatic abort), add-to-.gitignore,
  push tag, history scope (all vs current branch), Cmd+K command palette,
  blob file viewer (working tree or any ref, binary detection, size cap),
  git blame (per-line author/commit, porcelain parser), git clean (dry-run
  preview then force-remove untracked, ignored files untouched), remote
  add/remove with name and URL validation, per-file history (follow a path
  across commits and jump to any revision), branch ahead/behind badges,
  stash patch viewer, copy commit hash, Escape to close every dialog,
  reference log (reflog) viewer, fetch with prune, stash with message and
  include-untracked, remote set-url editing, annotated tag details,
  two-reference comparison (ahead/behind commits and renamed-aware file
  diff with stats), branch set-upstream, remote rename, sidebar ref filter,
  ignore-whitespace diff toggle, merge strategies (default/no-ff/ff-only/
  squash) with a dedicated picker, smart remote-branch checkout that creates a
  tracking local branch (no detached HEAD), configurable diff context lines
  (--unified), empty commits (--allow-empty), and branch creation without
  switching (no-checkout), untracked-file diffs via `--no-index`, rebase
  state detection with continue/abort, and server-side author/message/date
  history filters, in-app audit log viewer (JSONL reader with success/failure
  markers, raw details, server-side text/outcome filters over the whole
  retained file and no-match empty state),
  in-app text-file editing with validated atomic saves
  (sensitive/NUL/1 MB guards), mtime-based stale-save rejection (409 with
  the draft preserved), audit log rotation (1.5 MB trigger, 1 MB / 10,000
  entry retention budget, atomic rewrite), and a 413 response for oversized
  request bodies with explicit keep-alive timeouts, per-hunk staging
  (server-side diff splice + `git apply --cached`, `MM` partial status,
  unstage via reverse apply), per-hunk discard (reverse apply to the
  working tree, index untouched), and editor keyboard shortcuts (Cmd/Ctrl+S
  save, Tab/Shift+Tab indent), a light theme with a persisted toggle
  (GitHub-style light token set, FOUC-free first paint), PR board filtering
  (number/title/author/branch/label/draft across every column), in-app new
  file creation (nested paths auto-create parent directories, then opens in
  the editor), and repository git config management (local/effective values
  for a whitelisted set of keys with per-type validation and unset-to-inherit),
  draggable sidebar and detail column widths (pointer and keyboard resizing,
  min/max clamps, persisted widths, ARIA separator role), and
  prefers-reduced-motion support (animations and transitions collapse to a
  near-instant state change).
- Desktop (macOS, zero third-party runtime) — **maintained since 2026-11-12**:
  a `swiftc`-compiled `WKWebView` shell (`desktop/main.swift`) bundled by
  `scripts/desktop-build.mjs` via `npm run desktop` into
  `build/PR Helper Git.app` (~1.5 MB). It locates the system Node.js at
  well-known paths, spawns the server on an ephemeral port with both desktop
  env names, accepts either readiness prefix, loads the one-time token URL,
  opens external links in the default browser, provides standard macOS menus,
  and terminates the server on window close. The bundle ships a generated
  `AppIcon.icns` (rendered by `desktop/make-icon.swift`, then scaled and
  packaged with the system sips/iconutil tools) referenced through
  `CFBundleIconFile`; the window remembers its frame across launches via
  `setFrameAutosaveName`, and `CFBundleShortVersionString` now follows
  `package.json`.
- pr-helper-like: PR board (open/merged/closed), per-user review state,
  create PR (incl. draft), draft → ready, PR detail with commits/files/checks,
  requested reviewers (view and request), issue comments (view, compose,
  inline edit and delete with confirmation, Cmd/Ctrl+Enter to post), review
  submission (comment/approve/request changes), merge PR
  (merge/squash/rebase), close/reopen, line-level review comments
  (inline composer on diff lines, RIGHT/LEFT side, outdated-comment group,
  threaded replies and edit/delete), and an editable PR description.
  PAT can be stored server-side (`/api/pat`, `hasServerPat`; the value never
  round-trips to clients) and injected into the GitHub proxy; a request-scoped
  `x-github-pat` header remains supported as a fallback.
- Hardening: nosniff on every response, strict CSP and no-referrer on the
  HTML entry, no-store for HTML, immutable long caching for hashed assets.
- Explicitly out of scope (historical — interactive rebase, cherry-pick,
  AI generation and the three-way merge editor listed here have all been
  implemented since): submodules, worktrees, GPG signing, GitHub App,
  webhooks, a database, web push and deploy gates.

## TODO

- [x] Project scaffold, configs, git init
- [x] Server: security, git runner, config store
- [x] Server: git read/write routes
- [x] Server: GitHub proxy
- [x] Server: branch rename, tag create/delete, amend, remote branch routes
- [x] Server: file watcher + SSE live refresh
- [x] Client: app shell, design system and typed API client
- [x] Client: inline SVG icon set and portal context menu
- [x] Client: commit graph, lane layout and live refresh
- [x] Client: ref sidebar with collapsible groups and full actions
- [x] Client: work panel with folder tree, split diff and amend
- [x] Client: PR board with review state, draft and detail view
- [x] Client: GraphQL draft-ready and merge endpoints
- [x] Test repository created, pushed, E2E verified and registered
- [x] Unit tests, build verification, README, atomic commits
- [x] Robustness: error boundary and loading states
- [x] Server: clone, init and reset routes with input validation
- [x] Client: three-mode Open/Clone/Init add dialog
- [x] Client: commit graph search, load more and reset menu
- [x] UX: shortcuts, resizable work panel, PR labels, responsive layout
- [x] Server: revert route (merge guard; conflicts preserved with continue/abort), ignore, push tag, log scope
- [x] Client: revert menu and history scope toggle
- [x] Client: gitignore action and push tag menu
- [x] Client: PR requested reviewers view and request
- [x] UX: Cmd+K command palette with fuzzy filter and keyboard nav
- [x] Third iteration: tests, build, E2E, docs, atomic commits
- [x] Server: file content route (ref-aware, binary detection, size cap)
- [x] Server: blame porcelain parser with unit tests
- [x] Server: clean route (dry-run + force, ignored files protected)
- [x] Server: remote add/remove routes with name/URL validation
- [x] Client: FileViewer with content/blame toggle, wired to work panel and commit detail
- [x] Client: clean button and remote management modal
- [x] Client: PR issue comments list and composer
- [x] Fourth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: file-history and stash-show routes
- [x] Server: branch ahead/behind via upstream:track
- [x] Client: FileViewer history tab with revision jump
- [x] Client: ahead/behind badges, stash patch viewer, copy hash, Escape hook
- [x] Fifth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: reflog route and parser, tag-show route and parser
- [x] Server: fetch prune, stash include-untracked, remote set-url routes
- [x] Client: reflog modal and entry, stash options modal, remote URL editing
- [x] Client: annotated tag details, fetch prune/reflog commands
- [x] Sixth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: compare route (two refs, ahead/behind commits + numstat files)
- [x] Server: branch set-upstream, remote rename, diff ignore-whitespace
- [x] Client: CompareModal with commits/files tabs and toolbar entry
- [x] Client: set-upstream picker, remote rename, sidebar filter, whitespace toggle
- [x] Seventh iteration: tests, build, E2E, docs, atomic commits
- [x] Server: merge strategies (no-ff/ff-only/squash), checkout remote tracking
- [x] Server: diff context lines (--unified), empty commit, branch no-checkout
- [x] Client: MergeModal with strategy picker, API helpers for new params
- [x] Client: diff context selector, empty-commit toggle, no-checkout checkbox
- [x] Eighth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: force push (force/force-with-lease), pull rebase, merge abort
- [x] Server: remote tag deletion, forced tag creation
- [x] Client: force-push confirm, pull rebase, merge abort entry, tag actions and API helpers
- [x] Ninth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: revert merge with mainline (-m), grep, mv, rm, log pathspec
- [x] Client: grep modal, file rename/delete, path filter, revert merge, API helpers
- [x] Tenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: untracked diff (no-index), rebase state, rebase continue/abort, log filters
- [x] Server: GitHub reviews allowlist; client: review composer, LogFilterModal, rebase banner
- [x] Route-level HTTP tests (real server, temp repo, isolated PR_HELPER_HOME)
- [x] Eleventh iteration: tests, build, E2E, docs, atomic commits
- [x] Server: readAudit store helper, GET /api/audit; client AuditModal + entry points
- [x] Server: POST /api/save with validation and atomic rename; client edit mode
- [x] Server: PATCH/DELETE comment allowlist; client inline comment edit/delete
- [x] Server: nosniff/CSP/referrer-policy and differentiated cache policy
- [x] Component render tests (renderToString, mock app context)
- [x] Twelfth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: audit rotation constants and rotateAudit with byte/entry budget
- [x] Server: mtime on /api/file, expectedMtime 409 guard on /api/save
- [x] Server: 413 body-cap response with Connection: close, keep-alive tuning
- [x] Client: FileViewer 409 handling, AuditModal text/outcome filters
- [x] Route tests for audit rotation and save/mtime/413 behavior
- [x] Thirteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: q/outcome query params on /api/audit, filtering over full file
- [x] Client: AuditModal drives server filters with debounced text input
- [x] Route tests for server-side audit filtering
- [x] Follow-up: tests, build, E2E, docs, atomic commits
- [x] Server: splitFilePatch/buildHunkPatch helpers, POST /api/stage-hunk
- [x] Client: DiffView hunk stage/unstage actions wired through runAction
- [x] Server: GET/POST pulls/:n/comments GitHub allowlist entries
- [x] Client: PrFileReview with line anchors, inline composer, outdated group
- [x] Client: FileViewer Cmd/Ctrl+S and Tab/Shift+Tab keyboard handling
- [x] Fourteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: POST /api/discard-hunk, PATCH/DELETE pulls/comments/:cid allowlist
- [x] Client: DiffView discard hunk, PrFileReview reply/edit/delete
- [x] Client: PR description section with inline edit
- [x] Fifteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: watcher filters lock/temp-object noise, exports isNoise
- [x] Client: CommitDetail effect keyed on hash, modal survives background refresh
- [x] Sixteenth iteration: watcher tests, full acceptance, docs, atomic commits
- [x] UI fixes: graph-row overflow, ref-badge horizontal scroll, no-wrap group heads and toolbar, repo-select text color
- [x] Client: commit graph keyboard navigation and listbox/option a11y with roving tabIndex
- [x] Client: global modal focus trap hook with focus return on close
- [x] Client: persistent per-repo UI preferences via localStorage (view, groups, panel height)
- [x] Server: /api/grep-all across every registered repository; client GlobalGrepModal
- [x] Server: /api/revert-batch (merge guard, oldest-first, abort on conflict); client multi-select batch bar
- [x] Client: pin local branches and sort by name or recent tip commit
- [x] Server: /api/commit-template (local/global, absolute home path); client message prefill
- [x] CI: GitHub Actions workflow running lint, test and build; resilient test timeouts
- [x] Client: aria-labels on icon-only controls, keyboard-shortcut help modal (? key)
- [x] Tooling: .nvmrc + engines pin, CI npm audit advisory, react-vendor chunk split
- [x] Server: cleanCommitMessage strips # comments on commit and amend (git strip mode)
- [x] Eighteenth iteration: full 115-test acceptance, build, docs, atomic commits
- [x] Project-level code review: grep option-injection, per-repo panel height
  restoration, graph space-key default, unused shortcut binding, malformed URI
  status (full 117-test acceptance, five atomic commits)
- [x] Capability-gap audit: extracted all API routes and probed for real
  missing features (theme/filter/new-file/config), not name-only matches
- [x] Light theme with persisted toggle; define the missing --bg-elevated
  token (fix) discovered while theming
- [x] PR board filter search across all three columns
- [x] In-app new file creation with auto-created parent directories
- [x] Repository git config management (whitelist, validation, unset)
- [x] Twentieth iteration: full 121-test acceptance, build, docs, atomic commits
- [x] Native macOS desktop shell: GIT2_READY readiness line, Swift WKWebView
  process supervision, desktop-build bundler, shutdown hardening, E2E verified
- [x] UI/UX P0 pass: resizable sidebar/detail columns with persistence and
  ARIA separators, app icon and window frame memory, prefers-reduced-motion
- [x] Hover fix: lift the commit graph SVG above row hover/selected backgrounds
  so lanes and nodes stay visible (pointer-events and text unaffected)
- [x] Path integrity: core.quotePath=false for literal UTF-8 paths, porcelain
  type-2 rename parsing from the first path field, numstat rename resolution
- [x] Server hardening: bounded file reads, grep -z NUL-triple parsing, 120s
  fetch/pull/push timeout, proxied upstream errors, GraphQL timeouts, symlink
  repo roots, expanded sensitive patterns, CSP/cookie/asset-path fixes
- [x] Web async-race guards: stacked Escape handling, sequence tokens on repo
  loads/file lists/patch previews, one-time draft seeding, split-view header
  dedupe, paginated PR board and detail beyond the 30-item window
- [x] Desktop Node discovery across Homebrew/MacPorts/volta/asdf/nvm with a
  server-crash alert; GitHub remote recognition for SSH ports and trailing slash
- [x] Follow-up race guards on audit/compare/grep/PR-detail modals and shortcuts
- [x] Code-quality pass: pure state updaters (no side effects in updaters),
  redundant diff-effect dependency removed, untracked delete wording corrected,
  repo removal without a target rejected with 400, a single EventSource reading
  latest params from a ref, and an SVG favicon
- [x] Multi-repository panel (RepositoriesModal): one filterable list of every
  registered repository showing location, working-tree change counts,
  ahead/behind and the current branch, with an active marker; a row opens that
  repository and checkboxes enable a batch fetch across the selection
- [x] Conflicted multi-step operations keep their state: `detectRepoState()`
  reads `REVERT_HEAD`, revert stops on conflicts with 409 + conflict list,
  `/api/revert/continue` (GIT_EDITOR=true) and `/api/revert/abort` are
  separate actions, and the UI banner offers both
- [x] Minimal conflict resolution: `POST /api/conflict/resolve` accepts
  `ours` / `theirs` / `mark` per unmerged file (refuses non-conflicted paths),
  stages with `git add -A` so deletions count, and returns the remaining
  conflicts; ResolveConflictsModal is reachable from every merge/rebase/revert
  banner
- [x] Split-view pairing and word-level diff: `pairDiffRows()` zips deletions
  with additions inside a hunk, `wordSegmentsByRow()` highlights changed words
  in the unified view, and multi-line changed blocks no longer scatter
- [x] Grep results jump to the file at the hit line and highlight the literal
  search term; regex mode falls back to plain text when no literal match exists
- [x] Commit graph windowing: `windowRange()` mounts only the visible rows
  (8-row overscan), the SVG keeps its full height, `revealRow()` scrolls first
  and focuses on the next frame
- [x] Multi-repository batch pull: `POST /api/repos/pull` pulls registered
  repositories with `--ff-only` sequentially, reports per-repository outcome
  inline, and refuses an empty or unregistered selection
- [x] Ref parsing hardened: `git()` forces `LC_ALL=C` so `%(upstream:track)`
  stays parseable regardless of the machine locale, and `[gone]` upstreams
  surface as a red `gone` badge instead of looking in sync
- [x] Grep filters: `Ignore case` maps to `git grep -i` and a file glob
  (`:(glob)` pathspec) narrows results in both the per-repository and the
  cross-repository modal; invalid globs are rejected with 400
- [x] PR head checkout: `POST /api/pr/checkout` fetches `pull/<n>/head` into
  FETCH_HEAD and creates a local `pr-<n>` branch without switching; existing
  branches are refused with 409
- [x] Web-only decision: desktop development paused, checks limited to
  `npm test`, `npm run lint`, `npm run build`
- [x] M1 team-ready local instance: the startup token is the owner (admin);
  `server/actor.mjs` carries the request identity through AsyncLocalStorage so
  every audit entry records `user` and `role`; `server/identity.mjs` issues
  per-member tokens (SHA-256 at rest, plaintext shown once), lists and revokes
  them; the Team panel shows the signed-in identity, member management and
  one-time tokens; `GET/POST /api/team/config` exports and imports the
  repository registry plus member names without any secret; `DELETE` request
  bodies are now parsed so revocation works

## Delivery notes

- Current state (2026-11-08): 181 Vitest tests across 13 files are green,
  `npm run lint` and `npm run build` pass, and the working tree is clean after
  `d359a2c` (team identities) and `cfb40a0` (documentation).
  Everything below is local: `git remote -v` is empty, so the commits have
  never been pushed anywhere. This project is intentionally local-only for
  now; do not add a remote or push unless the user explicitly asks. Desktop
  packaging is frozen per the web-only decision; `dist/PR Helper Git.app`
  predates the latest web features.
  **(Superseded 2026-11-11: a remote now exists — the public
  `bayernjf/pr-helper-git`. The "no remote" statement above is a 2026-11-08
  snapshot, not current state. The "do not push unless asked" rule stands.)**
- Initial delivery: 16 atomic conventional commits on `main`; no git remote is
  configured and no push of this project was performed.
- Enhancement phase adds the features above; commits remain atomic conventional
  English commits authored by the configured user, with no co-author trailers.
- The initial suite held 47 Vitest tests (graph layout, formatting, security,
  git parsers, file tree, diff lines, review summaries, clone/folder
  validation, command palette fuzzy filter, blame porcelain parsing, reflog
  and tag-object parsing); later iterations added route-level HTTP tests,
  bringing the total to 181 across 13 files after the M1 team-identity work.
  The GitHub Actions workflow exists but does not run in practice because this
  repository has no remote; the local `npm test` / `npm run lint` /
  `npm run build` loop is the source of truth.
- Fourth iteration E2E in the browser: FileViewer shows working-tree and
  committed files with line numbers, binary detection and a 1 MB cap; the
  blame tab renders per-line author/short-sha/content (200 lines); clean
  previews two untracked items in a confirm dialog then removes the file and
  directory, restoring a clean tree; the remote modal lists origin and an
  add/remove cycle ends with only origin configured; the PR comments block
  shows the empty state, composer and Cmd/Ctrl+Enter hint, enabling the
  post button only with text (no comment was actually posted). Security
  checks confirm sensitive-file masking, path-traversal rejection, invalid
  ref rejection and non-network remote URL rejection.
- Fourth iteration findings: a real `git blame --porcelain` header carries an
  optional fourth field (number of groups), so the parser regex must allow it;
  the read-only `/api/remotes` route was originally placed after the
  `if (method !== 'POST') return null` boundary and could never serve GET
  requests, so it was moved into the read section.
- Fifth iteration E2E in the browser: the sidebar shows a green ↑200 badge on
  main; the FileViewer history tab lists 200 commits for bulk.txt and clicking
  an entry reloads the blob at that revision (header and contents update);
  Escape closes the file viewer and the stash dialog; a temporary stash renders
  its patch with colored hunk/add lines and is dropped afterwards; the copy
  hash button shows the "Commit hash copied" toast. Input validation rejects
  path traversal and bad/overflow stash indices. No external side effects.
- Fifth iteration finding: a lazy-load effect that listed its own loading flag
  in the dependency array could cancel itself (setLoading re-runs the effect,
  which then returns early), leaving an eternal "Loading" state. The effect
  now keys only on the mode and inputs and manages cancellation locally.
- Sixth iteration E2E in the browser: the reference log modal renders 232
  entries in a four-column grid (index, short hash, action, description) and
  closes on Escape; the stash options modal accepts a message and an
  include-untracked toggle, and a real stash with the toggle captured both a
  modified tracked file and a new untracked file, leaving a clean tree (the
  probe stash was dropped afterwards); the annotated tag detail modal shows
  tagger, email, date, target object and the "First tagged release" message;
  the remote modal edits origin's URL inline, the change was verified with
  `git remote get-url` and then restored to the original SSH URL; the
  command palette "Fetch and prune" command ran with `prune: true` in the
  audit log. No external side effects.
- Sixth iteration finding: the reflog parser regex must match the literal
  `@{` separator (`(.+?)@\{(\d+)\}`); an earlier non-greedy pattern that
  omitted the `@` captured the `@` into the ref name.
- Seventh iteration E2E in the browser: the Compare modal auto-runs with
  base=main/head=feature/login and reports 2 head-only commits, 206
  base-only commits and 6 changed files, matching `git rev-list --count`
  and `git diff --numstat` exactly; the Commits and Files tabs both render
  with colored status letters and add/delete counts. The sidebar "Set
  upstream" picker sets feature/quick's tracking branch (verified via
  `git rev-parse --abbrev-ref ...@{upstream}`) and was unset afterwards;
  the remote modal renames origin inline (URL preserved) and was restored;
  the ref filter narrows local/remote/tag/stash groups in real time; the
  ignore-whitespace toggle collapses an inline-only whitespace diff to
  "No diff available". No external side effects, tree left clean.
- Seventh iteration finding: when `-w` makes a diff empty, DiffView returns
  the empty hint and unmounted its own toolbar, leaving no way to switch the
  toggle back. The whitespace toggle was lifted to a persistent WorkPanel
  control above DiffView so it stays actionable regardless of diff content.
- Git behavior note: `-w` ignores inline whitespace changes but not the
  addition/removal of whole blank lines (that needs `--ignore-blank-lines`);
  E2E uses an inline-space change to verify the toggle.
- Eighth iteration E2E in the browser: the Merge modal opens from a local
  branch's "Merge into current" menu and shows four strategy cards with
  titles and hints; choosing `--no-ff` on a branch with one independent
  commit produced a real two-parent merge commit on main (audit recorded
  strategy=no-ff), then the tree was reset and the branch removed. Clicking
  the remote `origin/feature/login` checked out the existing local
  `feature/login` branch rather than a detached HEAD (verified with
  `git branch --show-current` and a detached count of 0). The diff context
  selector changed the hunk header from `@@ -47,7` (default 3) to
  `@@ -50 +50` (0) and `@@ -40,21` (10); the Allow-empty toggle enabled a
  "Commit (empty)" button that created a commit with no file changes (reset
  afterwards); the New branch modal's "without switching" checkbox created
  a branch while staying on main (branch deleted afterwards). All probes
  were cleaned and the tree returned to main/343f1a9/clean.
- Eighth iteration finding: parsing the optional diff context query with
  `Number(query.get('context'))` misfired when the parameter was absent,
  because `Number(null) === 0`, so every default diff silently became
  `--unified=0`. The route now parses context only when the parameter is
  actually present (`query.get('context') !== null`) and falls back to the
  default for missing or invalid values.
- Third iteration E2E in the browser: command palette opens on Cmd+K, fuzzy
  filter narrows results, arrow/enter/escape work and a command switches views;
  history scope returns 213 (all) vs 209 (current) commits; revert rejects a
  merge with 400, reverts HEAD cleanly into a new commit, and left a conflicting
  revert untouched (this iteration asserted the then-current auto-abort; the
  route later switched to 409 + continue/abort); gitignore adds once (duplicate is a
  no-op) and ignores the file; push tag rejects bad names and a missing remote
  without any external push. All temporary changes were reset/removed.
- Tooling finding: `scripts/dev.mjs` spawns the API server without `--watch`,
  so server-side edits require a dev restart; the client is hot-reloaded by
  Vite. The RefSidebar menu opens from the row's "more" button, not context
  menu; the commit graph menu does open on right-click.
- Second iteration E2E in the browser: error boundary panel, loading bar,
  init and clone (auto-registered), soft/hard reset semantics, search filter
  with result count, load-more paging (200 → 213, matching `git log --all`),
  view-switch and search shortcuts, Cmd+Enter commit, panel drag resize and
  minimum clamp. All destructive checks were reset back to the baseline
  afterwards.
- E2E was run against a real private repository through the browser: graph
  forks/merge nodes, SSE auto refresh, stage/commit/push, draft creation,
  in-app ready conversion and all three merge methods.
- Environment finding: in this environment the REST `pulls/:n/merge` and
  PATCH `draft:false` calls fail (404 / silently ignored); the server therefore
  performs both via GitHub GraphQL (`mergePullRequest`,
  `markPullRequestReadyForReview`).
- Test repository registry lives in `test-repos.md`; nothing there is deleted
  without an explicit request.
- Ninth iteration scope: force push (`--force` / `--force-with-lease`), pull
  rebase, merge abort, remote tag deletion and forced tag creation. Two
  pseudo-gaps were ruled out by reading the code: stash pop already exists
  (`/api/stash/apply` with `drop:true`, plus a menu item) and local branch
  push/set-upstream actions are already complete.
- Ninth iteration backend: `/api/push` accepts a whitelisted `force` mode
  (force / force-with-lease), both requiring `confirm:true` (else 400);
  unknown values are ignored and fall back to a normal push. `/api/pull`
  takes a `rebase` boolean (`pull --rebase` vs default `pull --no-edit`).
  New `/api/merge/abort` runs `git merge --abort`. `/api/tag/create`
  inserts `-f` for both annotated and lightweight tags. New
  `/api/tag/delete-remote` runs `push <remote> --delete <name>` with
  confirmation and remote-name validation. All audit entries record the
  new force/rebase fields.
- Ninth iteration E2E in the browser: Pull/Push render as split button
  groups with a caret; the Pull menu lists merge/rebase and the Push menu
  lists normal/lease/force. The two force items open distinct confirm
  dialogs (lease notes the safety check; force warns it can discard
  commits and recommends lease) and were cancelled, so no remote was
  rewritten. A conflicting merge auto-surfaced a red "Merge in progress"
  banner via SSE; clicking "Abort merge" restored the clean tree and the
  banner disappeared. The tag menu shows "Delete remote tag" with a
  confirm dialog (cancelled); the Create-tag modal has a "Force overwrite
  (-f)" checkbox. No console errors. The real success paths of force
  push and remote tag deletion were not triggered; their command forms
  were verified earlier with `--dry-run` and stale-lease rejection.
- Tag recovery note: verifying force-create temporarily repointed local
  `v0.1.0` from its original annotated object (c0e7dc2, peeled f2910c1)
  to the main HEAD; it was fully restored with
  `git fetch origin refs/tags/v0.1.0:refs/tags/v0.1.0 --force` and now
  matches the remote. All temporary branches (tmp-conflict, tmp-abort,
  tmp-pull-rebase, etc.) were deleted; the test repo returned to
  main/343f1a9/clean, ahead 200 / behind 2.
- Tenth iteration scope: revert a merge commit (`-m` mainline), repository
  content search (`git grep`), file rename/move (`git mv`), file delete
  (`git rm`/unlink) and commit-graph path filtering (`git log -- path`).
  All five were confirmed as real gaps by reading the code: the revert
  route hard-rejected merge commits, no grep route existed, file rows had
  only stage/unstage/view/ignore/discard actions, and the log route had no
  pathspec. None is on the excluded high-level feature list.
- Tenth iteration backend: `/api/revert` reads the parent count via
  `rev-list --parents -n 1`; for a merge it requires an integer
  `mainline` in 1..parentCount (missing/out-of-range -> 400) and inserts
  `-m <mainline>`, while ordinary commits keep the old behaviour. `/api/log`
  accepts an optional validated `path` and appends `-- <path>`. New GET
  `/api/grep` runs `grep -I -n --untracked <pattern> [-- path]`, parsing
  each line on the first two colons only (exit 1 = empty result). New
  POST `/api/mv` runs `git mv <from> <to>`. New POST `/api/rm` first
  checks `git ls-files`: tracked files use `git rm [-f]`, fully untracked
  files are unlinked after `resolveInside` (responses carry a `method`
  field). All write paths are audited.
- Tenth iteration defects found and fixed during E2E: (1) the porcelain
  v2 rename parser swapped the names — the real row is
  `R100 <new-path>\t<old-path>`, so the current path is the first token
  and `renamedFrom` the second; a unit test now covers it. (2) The SSE
  effect's dependency array omitted `logPath`, so a file-change refresh
  used the stale empty path and overwrote filtered results; `logPath` is
  now a dependency. (3) `git rm` cannot remove a fully untracked file
  even with `-f` ("pathspec did not match"), hence the git/unlink split
  above.
- Tenth iteration E2E in the browser: GrepModal returned grouped matches
  with line numbers and a clean empty state; the path filter narrowed the
  graph to one commit for `src/index.js` and 200 for `bulk.txt`, and
  cleared back to 200; the Rename modal performed a staged `git mv`
  (shown as `RM old -> new`); the Delete confirm removed both an untracked
  file (unlink) and a tracked file (staged `D`); right-clicking the merge
  opened RevertMergeModal with Parent 1/2 and produced
  `Revert "merge ui feature"`. No console errors. All temporary commits,
  branches and probes were removed; the test repo returned to
  main/343f1a9/clean.
- Eleventh iteration scope: untracked-file diff preview, rebase recovery
  (continue/abort plus state detection), server-side history filters,
  pull-request review submission and route-level HTTP tests. All five were
  confirmed as real gaps by reading the code: plain `git diff` returns
  nothing for untracked files, no rebase routes existed (the pull --rebase
  path could leave an unrecoverable rebase), the graph search only covered
  the loaded page, the GitHub allowlist had no POST reviews entry, and the
  48 existing tests covered no HTTP routes.
- Eleventh iteration backend: the git runner now supports per-call env and
  preserves stdout on non-zero exits. `/api/diff` detects untracked files
  via porcelain and runs `git diff --no-index -- /dev/null <file>` (exit 1
  is a valid diff), returning an `untracked` flag. `/api/status` adds a
  `state` object from `detectRepoState` (MERGE_HEAD, rebase-merge,
  rebase-apply). New `/api/rebase/continue` (GIT_EDITOR=true) and
  `/api/rebase/abort`. `/api/log` accepts validated `author`, `message`,
  `since`, `until` (ISO calendar dates only; bad values -> 400).
  `routes-github.mjs` allowlists POST `pulls/:n/reviews`. `store.mjs`
  honors a `PR_HELPER_HOME` override for test isolation.
- Eleventh iteration defects found and fixed during E2E: (1) the provider
  stored only the inner porcelain object and discarded the sibling
  `state` field, so no component could read rebase/merge state;
  loadRepoData now attaches `state` onto the stored status. (2) GitHub
  returns 404 on `requested-reviewers` when nobody is requested, and the
  Promise.all detail load rejected on the first failure, blanking every
  section; the modal now uses Promise.allSettled with per-endpoint
  fallbacks.
- Eleventh iteration E2E in the browser: an untracked file rendered its
  full no-index diff; the LogFilterModal with message "bulk commit 200"
  narrowed the graph to 1 of 1 and cleared back to 200; a real conflicted
  rebase showed the amber banner with Continue/Abort and Abort restored
  a clean main; a temporary PR (#4) was created, a COMMENT review was
  submitted (verified via API and rendered in the Reviews section), then
  the PR was closed, the remote branch deleted and the test repo reset to
  343f1a9. No console errors.
- Eleventh iteration verification: 77 Vitest tests passed across 9 files
  (including 29 route tests); `tsc --noEmit` was clean; `vite build`
  transformed 68 modules (JS 341.49 KB, CSS 39.06 KB).
- Twelfth iteration scope: audit log reading, in-app file editing/saving,
  PR comment edit/delete, security response headers and component render
  tests. All five were confirmed as real gaps by reading the code: the
  audit trail was write-only, FileViewer was read-only, comments could be
  posted but not changed, static responses carried no security or cache
  headers, and no component-level render test existed.
- Twelfth iteration backend: `store.mjs` adds `readAudit(limit)` which
  parses the JSONL (bad lines skipped, ENOENT -> empty) newest-first.
  New read-only `GET /api/audit` (limit 1..1000). New `POST /api/save`
  rejects sensitive paths, non-string content, NUL bytes and sizes over
  1 MB, then writes a sibling temp file and renames atomically; every
  save is audited. `routes-github.mjs` adds DELETE to the method set and
  allowlists PATCH/DELETE on `issues/comments/:cid`.
- Twelfth iteration defect found and fixed during E2E: GitHub locates a
  single issue comment at `/repos/:o/:r/issues/comments/:cid` (no issue
  number); the nested `issues/:n/comments/:cid` form returns 404 upstream.
  The allowlist and client paths were corrected to the flat form, and the
  audit trail records both the initial 404 probes and the final 200/204.
- Twelfth iteration E2E in the browser: the audit modal listed 200 of
  6855 entries with markers and raw details; an untracked scratch file
  was edited and saved (verified on disk and in the audit); a temporary
  PR (#5) was created, its first comment was edited inline and its
  second deleted through the confirm dialog, then the PR was closed, the
  remote branch deleted and the test repo reset to 343f1a9. Header
  checks over a production instance confirmed nosniff on every response,
  CSP/no-store on HTML and immutable caching on hashed assets.
- Current verification: 85 Vitest tests pass across 10 files (including 8
  new component render tests); `tsc --noEmit` is clean; `vite build`
  transforms 69 modules (JS 347.71 KB / gzip 101.15 KB, CSS 41.45 KB /
  gzip 7.59 KB). Dev server stopped; ports 5173, 4789 and 4791 are free;
  localStorage holds only `git2-active-repo`; the product work tree is
  otherwise clean.
- Post-iteration repository maintenance (user-confirmed): the
  git2-e2e-test divergence (ahead 200 bulk commits / behind 2 real
  commits from merged PR #3) was resolved with a non-destructive
  `--no-ff` merge of origin/main (no conflicts: bulk work only touched
  bulk.txt, the remote feature added src/settings.js) and pushed, so
  local main and origin/main now converge with no ahead/behind. Stale
  branches were cleaned up: feature/settings (merge commit), feature/quick
  (local-only, fully contained), and feature/login + feature/ui (squash
  merged via PRs #1/#2; final file contents proven identical to main)
  were deleted both locally and on the remote. The repo now has only
  main. Hello-World remains a clean octocat clone; git2-init-check
  remains an empty repo with no remote; this product repo deliberately
  stays without a remote.
- Thirteenth iteration scope: audit log retention/rotation, stale-save
  prevention via mtime, route-level tests for /api/audit and /api/save,
  and AuditModal filtering. All four were confirmed as real gaps by
  reading the code: the JSONL audit trail grew unbounded, concurrent
  saves could silently overwrite each other, neither route had dedicated
  tests, and the audit modal could not be narrowed.
- Thirteenth backend: `store.mjs` exports AUDIT_ROTATE_BYTES (1.5 MB),
  AUDIT_TARGET_BYTES (1 MB) and AUDIT_KEEP_ENTRIES (10,000); appendAudit
  stats after each write and calls rotateAudit when the trigger is crossed.
  rotateAudit parses valid lines, walks newest-first under both the byte
  budget and the entry cap, and atomically replaces the file via a temp
  rename; the result is always under the trigger so ordinary appends never
  re-rotate. `/api/file` returns `mtimeMs` for working-tree blobs (null
  for ref/masked views); `/api/save` accepts an optional finite
  `expectedMtime` and returns 409 when the current stat differs or the
  file vanished, with a successful save returning the new `mtimeMs`.
- Thirteenth defects found and fixed during testing: (1) oversized request
  bodies were destroyed inside readJsonBody, so clients saw a bare
  ECONNRESET; the parser now signals tooLarge and the server flushes a
  413 JSON response with `Connection: close` before destroying the socket,
  which also prevents the pooled keep-alive socket from being reused.
  (2) Default server keep-alive timing could race pooled clients; the
  server now sets keepAliveTimeout 60s and headersTimeout 65s.
- Thirteenth testing incident: an early version of the rotation test
  derived the audit path from the test process's configPaths(), but the
  vitest process had no PR_HELPER_HOME set, so it resolved to the real
  `~/.pr-helper-git2/audit.log`; the test's truncating writeFile replaced
  the existing 8,299-line audit history with synthetic seed lines, and no
  backup or local snapshot existed, so the prior audit history could not be
  recovered. The test now builds the audit path explicitly from the
  isolated server home directory, and the real audit log starts empty.
  No source code, credentials or repository data were affected; the loss
  is limited to the diagnostic audit trail.
- Thirteenth E2E in the browser: against a 30-entry seeded audit trail,
  the text filter narrowed the list to 6 stage entries, the failures
  selector to 4 entries all marked "!", the success selector to 26
  entries all marked "✓", and a combined no-match query rendered the
  empty state; the seed data was removed afterwards.
- Current verification: 93 Vitest tests pass across 10 files (37 route
  tests, including 8 new); `tsc --noEmit` is clean; `vite build`
  transforms 69 modules (JS 348.67 KB / gzip 101.47 KB, CSS 41.91 KB /
  gzip 7.63 KB). Dev server stopped; ports 5173 and 4789 are free; the
  real audit log is empty and accrues anew under the retention policy.
- Follow-up scope (server-side audit filtering): the client-side filter
  only covered the loaded 200-entry window, so older retained entries
  could never be matched. `/api/audit` now accepts `q` (trimmed,
  case-insensitive substring over the same action/summary fields the
  modal displays, capped at 100 chars) and `outcome` (`all`/`ok`/`fail`,
  invalid value -> 400); `readAudit` applies the filters over every
  retained entry before taking the limit window, so `total` reports the
  full match count across the file. The modal now requests up to 1,000
  rows, debounces text typing by 300 ms, and distinguishes "no records"
  from "no matches" based on whether filters are active.
- Follow-up E2E in the browser: against a 250-entry seeded file, the
  unfiltered modal rendered all 250 rows; `q=save` returned 25 matches
  with the request carrying `q=save`; `outcome=fail` returned 23 failures
  spread across the whole file (including entries beyond the old 200-row
  window), proving whole-file coverage; a combined no-match query showed
  the empty state. Seed data removed afterwards.
- Updated verification: 94 Vitest tests pass across 10 files (38 route
  tests); `tsc --noEmit` is clean; `vite build` transforms 69 modules
  (JS 348.65 KB / gzip 101.56 KB, CSS 41.91 KB / gzip 7.63 KB). Dev
  server stopped and ports free; the real audit log remains empty.
- Fourteenth scope: a fresh capability-gap audit (66 endpoints extracted
  from source, 20 keyword probes) confirmed three real gaps — missing
  editor keyboard shortcuts, no line-level review comments, and
  whole-file-only staging — while bisect/fsck/LFS/milestones/reactions
  and similar niche items were explicitly rejected.
- Fourteenth implementation: `splitFilePatch`/`buildHunkPatch` pure
  helpers in git.mjs split a single-file unified diff into its header
  and hunks; the new POST /api/stage-hunk regenerates the authoritative
  diff server side, splices the requested hunk and applies it to the
  index via `git apply --cached` (unstage uses `-R`), with index-range
  validation and audit entries. DiffView renders Stage/Unstage hunk
  buttons in the unified view and runs them through runAction so the
  data refresh keeps the diff pane in sync.
- Fourteenth review comments: the GitHub allowlist gains GET/POST
  pulls/:n/comments; the new PrFileReview component expands a PR file
  into its unified diff, anchors an inline composer to any line and
  posts the modern commit_id/path/line/side payload (RIGHT for
  adds/context, LEFT for deletions), grouping comments per line and
  collecting orphaned comments as outdated.
- Fourteenth E2E: browser verified two-hunk stage (index held only the
  second change, `MM` porcelain status), unstage back to a clean
  split, Tab/Shift+Tab indentation and Cmd+S save (editor closes,
  toast confirms). The inline-comment proxy was verified against the
  real API through a temporary PR: 201 for both RIGHT and LEFT
  comments, GET returned them; the PR, comments and branches were
  then deleted and scratch repos removed.
- Fourteenth verification: 99 Vitest tests pass across 10 files (39
  route tests, 5 new); `tsc --noEmit` is clean; `vite build`
  transforms 70 modules (JS 354.07 KB / gzip 103.11 KB, CSS 44.27 KB
  / gzip 8.00 KB). Dev server stopped and ports free; no scratch
  repositories remain registered.
- Fifteenth scope: a fresh audit of 67 endpoints found four real flow
  gaps — the PR body was never rendered, review comments could not be
  replied to or edited/deleted, and only whole-file discard existed;
  niche items (stash branch, check-run logs, suggested changes, syntax
  highlighting) were explicitly rejected.
- Fifteenth implementation: POST /api/discard-hunk reuses the diff
  splice and reverse-applies the chosen hunk to the working tree
  without touching the index; the GitHub allowlist adds PATCH/DELETE
  on the flat pulls/comments/:cid path. The review cards gain Reply
  (in_reply_to only), Edit (PATCH) and Delete (confirm dialog), and
  the modal gains a Description section with inline editing via
  PATCH pulls/:n.
- Fifteenth E2E: browser verified Discard hunk on a two-hunk change
  (first hunk restored, second remains, index stays clean). Through
  the local proxy against a temporary PR: top-level comment 201,
  threaded reply 201 with in_reply_to set, comment PATCH 200,
  description PATCH 200, comment DELETE 204 and a GET confirming
  zero comments remained. The PR, branches and scratch repos were
  removed afterwards.
- Fifteenth verification: 100 Vitest tests pass across 10 files (40
  route tests, one new); `tsc --noEmit` is clean; `vite build`
  transforms 70 modules (JS 353.98 KB / gzip 103.09 KB, CSS 44.27 KB
  / gzip 8.00 KB). Dev server stopped and ports free; no scratch
  repositories remain registered.
- Sixteenth scope: while preparing the product demo, the commit patch modal
  was observed opening and closing within ~200ms. Root cause: the recursive
  file watcher watches .git too, so transient index.lock create/delete pairs
  (from background git activity) broadcast repo-changed frames; the SSE
  handler reloaded the repo, recreating commit objects, and CommitDetail's
  effect, keyed on the commit object identity, reset the patch state.
- Sixteenth fix: watcher.mjs now exports isNoise and ignores .lock files,
  in-flight tmp_obj_* objects and node_modules/dist events while keeping
  meaningful HEAD/refs/index changes. CommitDetail keys its load effect on
  the selected hash and active repo instead of the commit object, so a
  background refresh that keeps the same commit no longer closes the modal.
- Sixteenth E2E: browser verified the patch modal now stays open and the
  SSE stream emits only the hello frame with no spurious repo-changed.
- Sixteenth verification: 106 Vitest tests pass across 11 files (new
  watcher.test.mjs with 6 isNoise cases); tsc clean; vite build transforms
  70 modules (JS 358.58 KB / gzip 103.96 KB, CSS 44.60 KB / gzip 8.06 KB).
  Note: overlapping vitest runs produced index.lock contention and flaky
  403 failures; ensure prior test runs have exited before rerunning.
- Seventeenth scope: a wide-viewport screenshot of the Hello-World graph
  showed several layout defects — commit rows pushed the trailing date off
  the right edge (hard-clipped), dense ref badges on the merge row crowded
  out the subject, and at narrow widths the sidebar group headers wrapped
  ("LOCAL/BRANCHES") while the top toolbar wrapped its "Pull Requests" label
  and overlapped the Git button.
- Seventeenth fix (styles.css only): .graph-row clips overflow and .graph-body
  gets width:100%/min-width:0 so the subject shrinks and ellipsizes while
  author/hash/date stay fixed and fully visible; .ref-badges becomes a
  self-scrolling strip (flex 0 1, hidden scrollbar) so badges never cover the
  subject; the top toolbar scrolls horizontally with nowrap labels instead of
  wrapping; the graph filter toolbar wraps cleanly; .ref-group-head is
  nowrap so section headers stay on one line.
- Seventeenth verification: browser measured zero row overflow at 1860, 1000
  and 786px (all dates visible), and at 600px the badge strip scrolls and the
  subject keeps a minimum width rather than being clipped mid-label. 106 Vitest
  tests pass across 11 files; tsc clean; vite build transforms 70 modules
  (JS 358.58 KB / gzip 103.96 KB, CSS 45.18 KB / gzip 8.16 KB).
- Nineteenth scope: a project-level, file-by-file code review (not a gap
  audit) covering correctness, security, robustness, React usage, resource/
  race handling and test blind spots. The server's core security model held
  up: fixed-argv execFile with no shell, timing-safe token comparison,
  realpath-guarded path containment, a fixed GitHub proxy target with
  method/path allowlist, and SSE ping/close cleanup. Five real issues were
  fixed in atomic commits.
- Nineteenth fixes: (1) grep patterns were passed as bare positional args,
  so a dash-prefixed pattern (e.g. '--foo') was misread as a git option in
  both /api/grep and /api/grep-all; now declared via `-e`. (2) WorkPanel
  panelHeight was lazily initialized from the per-repo preference only on
  mount and never re-read on a repository switch, so the first repo's height
  leaked into every later repo; an activeRepo effect now restores it.
  (3) CommitGraph Space/Enter activation returned before preventDefault, so
  Space scrolled the page. (4) use-shortcuts destructured an unused `view`
  and kept it in the effect deps, needlessly recreating the listener.
  (5) A malformed static URI made decodeURIComponent throw and surfaced as
  500; it is now a local 400. Two new route tests cover the dash pattern and
  malformed URI; the panel-height effect was verified in the browser
  (220 -> 520 -> 220 across switches) since SSR tests never run effects.
- Nineteenth design note (left unchanged): the commit message draft is
  component state shared across repositories, so a non-empty draft carries
  over on a repo switch and also suppresses template prefill. Clearing it
  would be a behavior change that could discard a deliberate in-progress
  draft, so the current behavior is retained; the textarea stays visible
  before every commit, letting the user catch a mismatched message.
- Twentieth scope: a capability-gap audit (extract every route, keyword-probe
  for real gaps, then read the implementation) identified four features worth
  adding under the zero-dependency product boundary: light theme, PR board
  filtering, in-app new file creation, and git config management. All were
  delivered as atomic commits; a separate fix defined the never-declared
  --bg-elevated token that eleven existing rules referenced.
- Twentieth backend: GET/POST /api/config reads local and effective values
  for a whitelisted set of keys and writes repository-local config only.
  Arbitrary keys are rejected (core.sshCommand/alias/include/... can execute
  or escape), enum/email/branch values are validated, and an empty value
  unsets the local override (git exit 5 for an already-missing key is a
  successful no-op). /api/save now mkdir-recursively before writing so a
  nested new-file path works; the directory is already inside the validated
  path and mkdir is a no-op for existing-file edits.
- Twentieth verification: 121 Vitest tests pass across 11 files (four new
  config route tests); tsc clean; vite build output (react-vendor 223.09 KB /
  gzip 69.19 KB, app 153.54 KB / gzip 39.27 KB, CSS 51.98 KB / gzip 9.30 KB,
  76 modules). A fresh browser tab reports zero console errors/warnings; the
  throwaway test repo was restored to its empty state and the work tree is
  clean with no remote configured.
- Desktop decision: the product is already a local loopback server plus a web
  UI, so a desktop version only needs a native window, double-click launch and
  process supervision. Electron (~150 MB runtime) and Tauri (Rust toolchain)
  were rejected to preserve the zero-runtime-dependency design; the chosen
  shell uses system WKWebView and swiftc and reuses the installed Node.js,
  yielding a bundle under 1 MB.
- Desktop backend: in GIT2_DESKTOP mode the server prints a machine-readable
  GIT2_READY line with the ephemeral port and token. Shutdown now calls
  server.closeAllConnections() (keep-alive/SSE sockets) and a new
  stopAllWatching() closes every watcher, with a forced-exit safety net; the
  old signal handlers waited for long-lived clients and could stall.
- Desktop shell: the Swift AppDelegate resolves Node at well-known paths
  (GUI PATH omits Homebrew), spawns the bundled server, parses GIT2_READY on a
  serial queue, loads the token URL in a persistent WKWebView, and on
  termination waits up to 3 seconds before SIGKILL. E2E via open/quit confirms
  the shell and node start, establish five connections, and both exit with no
  lingering process; 121 tests and tsc stay green.
- UI/UX P0 pass scope: three confirmed gaps from the design review — fixed
  column widths, no app icon/window memory, and no reduced-motion support.
  Column resizing uses a reusable `useResizable` hook (`src/hooks/use-resizable.ts`)
  driving edge-mounted `.col-resize` separators; both pointer and keyboard
  (arrows, Shift for a larger step) paths clamp to a range and persist
  `sidebarWidth`/`detailWidth`, while no inline width is applied until the user
  first resizes so the responsive media queries keep working. The icon is
  rendered at build time from `desktop/make-icon.swift` and packaged to
  `AppIcon.icns` with system sips/iconutil (no checked-in binary, no new
  dependency); the Swift shell calls `setFrameAutosaveName` and keeps `center()`
  only for first-run placement.
- UI/UX P0 verification: browser checked both separators' ARIA attributes,
  keyboard resize and direction (sidebar ArrowRight widens, detail ArrowLeft
  widens), reload restoration, min/max clamps and a synthetic pointer sequence;
  a second desktop launch restored the saved frame (position 67,51 rather than
  centered) and open/quit still leaves no lingering shell or node process. All
  121 Vitest tests pass across 11 files, tsc is clean, vite build succeeds, and
  the rebuilt bundle is ~1.2 MB with the icon in Contents/Resources.
- Post-P0 hardening phase (eleven atomic commits) opened with a reported hover
  defect: the graph SVG and absolutely positioned rows shared an auto z-index,
  so an opaque row hover/selected background painted over the left lanes and
  nodes; the SVG now sits above the rows while remaining pointer-events-none.
  A sequence of correctness fixes followed: literal UTF-8 paths and reliable
  rename parsing (quotePath, porcelain type-2, numstat resolution), bounded file
  reads and grep -z parsing, longer network timeouts, symlink-aware repo roots,
  expanded sensitive-file masking, stacked Escape and sequence-token race guards
  across the modals, paginated PR collections, desktop Node discovery across
  version managers, and SSH-port/trailing-slash remote recognition.
- A fresh file-by-file bug audit then read every server module, all 35 client
  components and the pure helper libraries. Eight candidates were verified
  against the real source and ranked by severity. The single P1 (a slow
  repository load overwriting a newly selected repo) and the no-newline diff
  parsing had already been closed by the sequence-token work; the remaining
  real items were fixed in four atomic commits: side effects removed from
  setState updaters (a StrictMode double-invocation hazard), a redundant status
  dependency that re-fetched the diff on every background refresh, an untracked
  delete confirmation that wrongly claimed a staged deletion (the server unlinks
  untracked files directly), and repo removal now returns 400 instead of writing
  a repo:null audit entry. The EventSource was also reduced to one connection
  that reads the latest reload parameters from a ref, removing the event-loss
  window from reconnecting on every log-option change.
- The only theoretical item deliberately left unchanged is SSE write back
  pressure: there is a single loopback client sending tiny frames, and the
  existing try/catch removes a faulting client, so asynchronous drain logic
  would add complexity without practical benefit.
- Current verification: 140 Vitest tests pass across 12 files (the new 400
  rejection adds one route test); tsc is clean; vite build transforms 77 modules
  and now copies the checked-in SVG favicon (public/favicon.svg) into dist,
  eliminating the /favicon.ico 404. The dev server is stopped and ports 5173 and
  4789 are free; the product work tree is clean and still has no git remote.
- Multi-repository panel: a requested "Open repositories" view replaced the
  dropdown-only switching. The existing GET /api/repos already returned a full
  per-repository brief (branch, upstream, ahead/behind, staged/unstaged/
  untracked, last commit, error), so no server change was needed; the new
  RepositoriesModal renders those briefs in a filterable grid. A row opens the
  repository and closes the panel, while row checkboxes plus a select-all control
  drive a batch fetch that runs with Promise.allSettled so one failing remote
  cannot abort the rest, then refreshes and reports the fetched/failed counts.
  Browser testing covered filtering, the batch fetch (two /api/fetch 200s) and
  row switching; the server-side socket count confirms a single live SSE
  connection (the extra dev-only EventSource is the StrictMode mount/cleanup
  mount pair, whose first socket is closed by the effect cleanup).
- Updated verification: 144 Vitest tests pass across 12 files (four new
  RepositoriesModal render tests); tsc is clean; vite build transforms 78
  modules. The dev server is stopped and ports 5173 and 4789 are free; the work
  tree still has no git remote.

## 2026-11-08 cross-repo parity round

- Ported AI generation from pr-helper-git: `server/ai.mjs`, `/api/ai/config|test|commit-message|pr-description`,
  Settings AI section, "Generate with AI" in the commit form and the new-PR dialog.
  The key lives in `~/.pr-helper-git2/config.json` and is never returned (only `hasKey`).
- Added `/api/cherry-pick` (409 + conflicted paths, state preserved) and `/api/undo-commit`
  (soft reset), both in the commit-graph context menu.
- Fixed `parseGrepLines`: `git grep -n -z` records are `path\0line\0text\n`, so splitting on NUL
  in triples misaligned every match after the first. Now parsed record-by-record.
- Tests: 196 (15 files) (historical baseline). Remaining parity backlog at the time: `../pr-helper-git/PARITY.md` — now closed (0 functional gaps).

### 2026-11-08 repository panel round

- `src/lib/repo-sort.ts`: `activityLevel` / `relativeAge` / `sortRepos` /
  `summarizeRepos`, with 9 unit tests. Kept pure so the panel rules are testable
  without a DOM.
- RepositoriesModal: pin (localStorage `pr-helper-git2-pinned`), activity bar,
  aggregate header, "With changes" filter, manual refresh and a 30s auto refresh
  that only re-reads `git status` (never fetches or pulls).
- Tests: 205 (16 files).

### 2026-11-08 line-level staging

- `server/patch-lines.mjs`: `parseHunk` + `buildLineSelectionPatch(header,
  hunk, selected, action)`. The rebuild keeps context, converts unselected
  changes that the target side already holds into context (removals when
  staging, additions when unstaging) and drops the rest — a naive rebuild fails
  with "patch does not apply" whenever selected and unselected changes share a
  hunk.
- `POST /api/stage-lines` with `{ repo, file, hunk, lines[], action }`; validates
  indexes against the parsed hunk, caps the selection, audits both outcomes.
- DiffView: click a changed line to mark it, hunk header shows Stage/Unstage N
  lines + Clear; selection resets when the diff reloads.
- Tests: 215 (17 files), including two integration cases that stage/unstage a
  single line with real `git apply`.

### 2026-11-08 whole-history commit search

- `server/search-commits.mjs#buildCommitSearch(q, {limit})` is pure: it decides
  the mode from the `author:` / `path:` prefix, rejects empty/overlong/multi-line
  queries and returns the exact `git log --all --date-order --max-count=N -i`
  argv. `GET /api/search-commits` maps the result to `parseLog`.
- UI: `CommitSearchModal` (message / author / path, prefix buttons that write the
  prefix into the box, click a row to jump to the commit). Entries: toolbar
  button, command palette (`git2:search-commits`), Shift+Enter from the graph.
- Tests: 222 (18 files) — 6 pure/integration cases in `search-commits.test.mjs`
  (the integration one proves `--all` reaches an unmerged branch) plus 1 HTTP
  case in `routes.test.mjs`.

### 2026-11-08 interactive rebase

- `server/rebase-todo.mjs` keeps the planning logic pure: `validateRebasePlan`
  accepts only a full permutation of the range (a missing hash is reported as
  `plan omits <hash>`, never silently dropped), `applyTodoPlan` rewrites the
  todo file matched by one-way hash prefixes and preserves the comment block,
  `resolveRewordMessage` applies reword messages and refuses to touch a
  `# This is a combination of N commits` squash file.
- Two shims drive git: `rebase-sequence.mjs` (`GIT_SEQUENCE_EDITOR`, reads
  `GIT2_REBASE_PLAN`, exits 1 on a bad plan so git aborts) and `rebase-msg.mjs`
  (`GIT_EDITOR`, reads `GIT2_REWORD_STATE`, never exits non-zero). `GIT_DIR` is
  not exported to the editor, so the reword queue lives in our own state file.
- Routes: `GET /api/rebase/plan` (commits + dirty/merges/upstream/pushed) and
  `POST /api/rebase/interactive`; dirty tree, merge commits and an in-progress
  multi-step operation are 409, an invalid plan is 400, a conflict returns
  `200 { conflicted: true }` and leaves the rebase banner in charge.
- UI: `RebaseModal` with per-row action select, up/down reordering,
  reword inputs and the three guardrails; entry point is the commit context
  menu (a root commit means `--root`).
- Note for the next route added to `routes-git.mjs`: every GET handler must sit
  above `if (method !== 'POST') return null;` (~line 1249), otherwise it 404s.
- Tests: 237 (19 files) — 12 pure cases in `rebase-todo.test.mjs` plus 3 HTTP
  cases that really rewrite history, prove an omitted commit is rejected and a
  dirty tree is refused.

### 2026-11-08 CI gates + branch protection warnings

- `server/github-allowlist.mjs` now owns the PAT proxy allowlist (moved out of
  `routes-github.mjs` so it can be unit-tested without loading the HTTP layer).
  Two endpoints were added: `commits/:sha/status` (classic statuses, which a
  Jenkins-only repo reports instead of check runs) and
  `branches/:branch/protection` (404 = unprotected).
- `PrDetailModal` fetches both alongside the existing detail calls and merges
  statuses into the check list (`pending` has no conclusion, anything but
  `success` counts as failed). A failing gate adds a confirm dialog before the
  ordinary merge confirmation; the CI summary above the merge options shows the
  failing count, the unprotected-branch warning, or the required-check count.
- Tests: 240 (20 files) — `github-allowlist.test.mjs` 3 cases pin the new
  endpoints and prove `PUT`/`DELETE` protection and `/actions/runs` stay
  rejected, plus traversal paths.

### 2026-11-08 Bilingual UI (i18n)

- New `src/i18n.ts`: `ZH` dictionary keyed by the English source string (~300 entries), `t()`,
  `tp()` for `{placeholder}` text, count rules (`"12 commits"` → `"12 次提交"`), `getLocale/setLocale`
  persisted through `lib/prefs` (`locale`), plus `useLocale()` built on `useSyncExternalStore`.
- `App.tsx` calls `useLocale()` so switching re-renders the whole tree; the language selector lives
  at the top of `SettingsModal`.
- Component copy was converted mechanically: JSX text nodes / `title` / `placeholder` / `aria-label`
  / `alt` props and `toast('…')` / `setStatus('…')` literals now go through `t("…")`. Counted strings
  that are assembled at runtime (commits, repositories, matches, lines, selected) use `t(\`…\`)`
  backed by the count rules.
- `src/i18n.test.ts` (5 tests): en/zh switching, unknown-key fallback, count rules, `tp`, and a
  source scan asserting every `t("…")` key used in `src/**` exists in `ZH`.
- Known limits: server/API error text and raw Git output stay English; user data (branch names,
  commit subjects, file paths) is never translated because only exact dictionary keys are substituted.

### 2026-11-08 HTTP E2E smoke suite

- New `e2e/run.sh` (+ `npm run e2e`): boots `server/main.mjs --port=18774` with
  `GIT2_DEV=1` (fixed `dev-token`) and `PR_HELPER_HOME` in a throwaway dir, then
  drives the real HTTP API with curl. 60 checks covering auth/traversal,
  repo registration, status/log/refs/file reads, stage → commit → undo,
  branch/tag/stash, grep, compare, rebase plan, cherry-pick, merge, GitHub
  proxy guards (missing PAT 401 / allowlist 403) and audit.
- Quirks encoded in the suite: GET routes take `?repo=`, writes take `body.repo`;
  `GET /api/file` expects `file=` (not `path=`); `POST /api/merge` expects
  `ref=`; `stash-list` returns `entries`; `rebase/plan` rejects `HEAD~2`
  (`~` is outside the ref charset) so the suite passes a resolved SHA.

### 2026-11-08 E2E deepened to 101 checks

- Added conflict and history-rewriting coverage: merge conflict → resolve
  (`ours`) → commit, merge conflict → abort, interactive rebase `drop`,
  rebase conflict → abort, single and batch reverts, hunk / line-precise
  staging (`stage-hunk`, `stage-lines`), push/pull against a bare remote and
  force-push confirmation guard.
- Harness fix: `contains()` used `echo … | grep -q`, and `grep -q` exiting on
  the first match sent SIGPIPE to the writer, which `set -o pipefail` reported
  as a failure — a flaky red. It now greps a here-string.
- Product fixes found by the suite: a conflicted merge now returns 409 with the
  conflict list (it used to be a generic 400), and `POST /api/commit` is
  allowed to finish a merge whose resolution left the index identical to HEAD
  (`ours`), instead of failing with "nothing staged to commit".

### 2026-11-08 Chinese walkthrough and translation sweep

Ran the bilingual build in a browser against a throwaway repository and read
every panel in Chinese. The dictionary covered rendered keys, but plenty of
copy was still a raw literal (toolbar actions, work-panel controls, graph
filters, modal labels, shortcut help, command palette, team/repo panels, PR
detail counters, relative timestamps). All of those are now routed through
`t()`/`tp()` and translated; `formatRelative` and `relativeAge` emit Chinese
units instead of `3m ago`.

Toasts raised by `runAction` and the error messages the API returns are now
translated too (`src/components/ui.tsx` renders through the dictionary and
`runAction` translates `err.message` before appending the raw git detail), so a
Chinese user sees Chinese outcomes and Chinese failure headlines.

Known gaps: audit action names and raw git/GitHub output (branch names, commit
subjects, git stderr detail) stay exactly as git reports them.

### 2026-11-09 Audit action labels, changelog

Audit entries used the server's action identifier verbatim (`repo-add`,
`stash-create`, …), so a Chinese audit panel showed English identifiers.
`auditAction()` in `src/i18n.ts` maps 50 of them to Chinese labels and passes
unknown ones through; the English UI keeps the raw identifier because that is
what the audit log and its filter use. Covered by one new `i18n.test.ts` case
(250 tests / 21 files).

Also added the first `CHANGELOG.md`, back-filled with the 0.1.0 feature set and
the unreleased fixes (merge conflict contract, translation sweep, toasts, audit
labels, no-wrap toggles).

### 2026-11-09 Commit graph keyboard parity

The graph already had `role=listbox`, `role=option`, `aria-selected` and
arrow/Home/End/Enter, but it still differed from the vanilla client: no
PageUp/PageDown, no Escape, and no `aria-activedescendant`. Those three are in
now, with row ids (`commit-row-<hash>`) so the active option can be named.

The decision math lives in `src/lib/graph-nav.ts` (`nextCommitIndex`,
`pageSizeForViewport`) so it can be unit-tested without mounting React; the
component keeps the DOM part (selection, focus, reveal, scrolling). Tested at
three levels: 6 unit cases for the math, 4 jsdom interaction cases that render
the real component and press keys against `selectCommit`, and 2 SSR cases that
assert the listbox/option/`aria-activedescendant` markup. `jsdom` is now a dev
dependency here too.

### 2026-11-09 Commit signature verification

`GET /api/signature?repo=..&sha=..` runs `git log -1 --format=%G?%x00%GS%x00%GK`
and returns `{sha, status, signer, key, verified}`. `%G?` letters are mapped to
copy in the detail panel (G verified, B bad, U unknown, N unsigned, E cannot
check, X/Y expired, R revoked). The letter comes from git alone — no key
material is needed — so repositories with no signing key still get a truthful
"Not signed" instead of an error. Two route tests pin the unsigned path and the
400 on a malformed sha.

### 2026-11-09 Submodule status panel

`GET /api/submodules?repo=..` runs `git submodule status --recursive` and returns
`{entries:[{state,sha,path,describe}]}` through `parseSubmoduleStatus`, which
keeps the one-character state prefix (space clean, `-` not initialized, `+`
checked-out commit differs, `U` conflict). The sidebar renders a read-only
"Submodules" group only when a repo actually has submodules, colour-coded by
state. Covered by a parser test with all four prefixes, a route test for the
empty repository, and one E2E check.

### 2026-11-09 Bisect wizard

The last parity candidate. `GET /api/bisect` reads git's own marker files
(`$(git rev-parse --git-path BISECT_LOG)` and `BISECT_START`) instead of keeping
state in memory, so a running bisect survives a server restart; it also reports
the current candidate commit and the good/bad counts parsed from the log.
`POST /api/bisect/start` runs `git bisect start`, then `bisect bad <sha>` /
`bisect good <sha>`; a failure mid-way best-effort resets so HEAD is not left
detached. `POST /api/bisect/mark` and `/reset` refuse when no session is active,
and reset verified to restore the original branch (`main`). Covered by three
route tests against a real fixture repo plus five E2E checks (start → active →
reset → cleared → branch restored).

### 2026-11-09 Read-only phone view (/m)

After measuring the desktop layout at 390 px (scrollWidth 619, graph squeezed
to 70 px, working panel 0 px wide) the phone case was handled with a separate
read-only view instead of a responsive rewrite.

- `src/components/MobileApp.tsx` — sticky repo picker / refresh / language
  toggle, branch + ahead/behind, staged/unstaged/untracked chips, 80-commit
  list, full-screen commit sheet (author, date, `%G?` signature, body, files
  with `+n/-n`, per-file diff). No mutating endpoints are called.
- `src/main.tsx` — `/m` or `?mobile=1` renders `MobileApp`, everything else
  keeps the desktop app.
- `server/main.mjs` — extensionless `GET` misses now fall back to
  `dist/index.html`, so `/m` works in the production server.
- `src/styles.css` — `.m-*` block with 44 px touch targets, sticky header,
  `env(safe-area-inset-*)`, `100dvh`.
- Tests: `src/components/mobile.test.tsx` (jsdom, stubbed fetch, list → commit
  → file diff). E2E: `/m` responds 200 and returns the app entry
  (109/109).

- Follow-up in the same round: the phone view lists working-tree changes
  (tap → `/api/diff` for that file), and the server accepts `GIT2_HOST` for
  non-loopback binding (default unchanged); `src/components/mobile.test.tsx`
  now covers both the commit flow and the working-tree diff.

Baseline at 0.2.1: 287 unit tests / 27 files, E2E 115/115.
Current working-tree baseline: 336 / 34, E2E 144/144 (0.2.2 release was 287 / 27).
2026-11-10 appearance + maintenance wave: SettingsModal gained dark/light/system modes
and four accent presets (violet/ocean/forest/amber), applied before first paint and
persisted in `git2-prefs`; the toolbar button now cycles three modes with a monitor icon.
The same Settings modal shows the data directory + file sizes and calls
`POST /api/maintenance/audit-rotate` / `POST /api/maintenance/prune-repos` after a
confirm dialog; `pruneRepos()` drops registry entries whose `.git` disappeared.
`GET /api/storage` backs the sizes. Tests: 3 new route tests; E2E +6 maintenance checks.
2026-11-10 parity wave: Dashboard full-page view (open-PR counts, external open, remove UI,
background fetch-all), graph CI dots, image diffs (/api/raw), commit history + 50/72 counter,
amend prefill, discard-all, draft persistence. The remaining conflict 3-way editor landed in
the same round (`ConflictEditorModal` + `src/lib/diff/conflict.ts`), so no functional gaps
remain in pr-helper-git's PARITY.md.
Note: the phone view supports `/m?repo=<path>&commit=<sha>` deep links (README §Phone view).

2026-11-10: PR real-network validation (list/detail/create/merge/close-reopen/comments/reviews/
labels/reviewers/line-comments/draft-ready/protection-read) is **blocked on a user-provided PAT** —
all PR capabilities remain validated at route/offline level only (PARITY.md known limitation).
Record the validation outcome here once it runs.

## Lessons inherited from pr-helper-git (pre-archive, 2026-11-11)

Engineering knowledge worth keeping now that the old `pr-helper-git` is archived as `pr-helper-git-archive`:

1. **bash nested quotes shred JSON**: payloads written as `-d "{\"a\":…}"` inside
   `$( )` lose content to brace expansion (server receives fragments → invalid
   JSON). Build payloads with `printf … |` at runtime (see both e2e scripts).
2. **`REBASE_HEAD` is NOT a live-rebase signal** — an aborted rebase leaves the
   file behind. Detect a live rebase via the `rebase-merge`/`rebase-apply`
   directories only. Same class of bug: a conflicted single-commit revert
   writes `REVERT_HEAD` (pr-helper-git exposes it as `status.reverting`).
3. **Check `engines` when installing test deps**: `jsdom@31` requires Node
   ≥22.22 while `jsdom@26` requires ≥18 — on a Node 20 machine 7 test files
   silently failed to load, making suite counts look right but run less. And
   on Node ≥26, Node's experimental `globalThis.localStorage` (undefined
   without `--localstorage-file`) SHADOWS jsdom's inside vitest — fixed by
   `src/test-setup.ts` (in-memory polyfill via `test.setupFiles`).
4. **Multi-instance config safety**: web + desktop run side by side. git2's
   store reads the file on every call + writes via tmp+rename (keep this
   style); pr-helper-git needed mtime invalidation to avoid one instance
   erasing the other's settings.
5. **Server-side PAT model** (adopted this round): the token may live in
   `~/.pr-helper-git2/config.json` and is injected into the GitHub proxy
   context server-side; the browser never sees it. pr-helper-git's original
   design — worth keeping as the default for shared machines.
6. **Desktop shell engineering** (archived in `docs/archive/pr-helper-git-desktop/`):
   `--port=0` + machine-readable port line handshake, tray open/quit, dock
   reopen, child server killed on exit, `find_node()` multi-path discovery,
   fatal-error osascript dialog.
7. **`core.quotepath=off` is not enough**: git still C-quotes `"` and control
   characters. pr-helper-git needed a dedicated `c-quote.mjs` decoder; check
   git2's path parsing before assuming raw paths are safe.
8. **Refresh fingerprints must include content, not counts**: file paths +
   ahead/behind + remote/tags/stashes. Counts-only produced ghost WIP rows and
   defeated auto-fetch; opening a repo must reset the cached fingerprint.
9. **Removing an import requires checking transitive callers**: dropping `fs`
   broke `isGitWorktree` (`fs.lstatSync`); a try/catch turned it into a silent
   `false`, so every repo operation failed with "invalid repo path".
10. **`parsePorcelainV2` has two field layouts**: git 2.51 separates ordinary
    fields with spaces but uses a tab before the rename path — handle both.

### 继承的产品约束与暂缓项（2026-11-11 已从 ZCode 项目记忆迁入）

以下约束于 2026-11-11 自 pr-helper-git 旧项目的 ZCode 记忆
（`~/.zcode/cli/memories/projects/pr-helper-git-29beae1193885890/`，6 条，当日已
删除）迁入，现为本仓库的正式约束。迁入时已逐项 grep 确认 README / handoff /
CHANGELOG / docs 对这些主题为 0 命中，无重复记录。

- **产品定位**：本地自用工具，**不上生产**（用户 2026-11-10 明确）。手机端只在
  **局域网**内访问，不做公网 / Tailscale / 反代组网。
- **由此不做的事**：TLS、公网反代、CSP 收紧等加固类工作与部署文档，除非用户要求；
  局域网内明文 HTTP + token 可接受。这条直接影响权限矩阵与移动端验收的取舍。
- **备份**：统一放 `/Users/jiangfeng/000mycodes-backups`，一键脚本
  `bash pr-helper-backup.sh`（先 commit，bundle 不含未提交内容）。Docker 仅换机 /
  NAS 场景需要，日常不用。
- **设计 token**：编辑 `design/tokens.json` 后跑 **`node scripts/sync-tokens.mjs`**
  （`TARGETS` 只写 git2）。⚠️ 旧记忆写的 `npm run tokens` 在本仓库**不存在**，
  package.json 无该 script，已按脚本头部注释校正。
- **用户决策偏好（跨项目）**：不要追求最简实现，以核心 / 基本功能做对为准，UI 要
  设计得好看（2026-11-05 原话：「后续遇到要决策的点，不要追求最简单的实现方式，
  以核心功能，基本功能为准，UI也要设计的好看点」）。
- **迭代节奏（跨项目）**：用户会在建议收敛后继续说「继续」；照做并找出真实改进，
  但确实枯竭时要诚实说明，不要镀金。
- **暂缓功能**：图拖拽（branch→commit 的 checkout/merge/rebase、commit→branch
  的 cherry-pick）**维持 park**。2026-11-11 复核：同等能力已由右键菜单覆盖
  （`CommitGraph.tsx` menuItems 含 cherry-pick / interactive rebase from here，
  `RefSidebar.tsx` menuItems 含 Checkout / Merge into current），拖拽只是换手势；
  且图行已有单击选中 / 右键菜单 / 批量勾选三套手势，加拖拽有劫持风险。
- **对比模式：原 park 记录已过期**（迁自旧项目，对 git2 不成立）。2026-11-11
  复核：branch vs branch **早已实现**（Toolbar「Compare two references」→
  `CompareModal.tsx` + `/api/compare`），且 `validateRefSpec` 本就接受 7–40 位
  hex，后端已支持任意 commit。真实缺口只有两个 UI 口子：选不到任意 commit、
  没有「工作区」选项。用户 2026-11-11 批准补完这两个口子，**当日已交付**：
  - 服务端：`:worktree` 伪引用（`COMPARE_WORKTREE`，`:` 在 git ref 名里非法故不会
    撞名）可作任意一侧；作 base 时 diff 反向（同一暂存新增从 `A` 变 `D`），两侧
    同时为工作区或 `:worktree-ish` 一律 400；工作区侧没有自己的提交，两个提交
    列表按 HEAD 算且为空；响应新增 `untracked`（`ls-files --others
    --exclude-standard`，不计入 diff）。
  - 客户端：新增 `RefPicker.tsx` 组合框，可搜引用 / 已加载提交的主题与 hint，
    也可直接敲 7–40 位 SHA 选未加载的提交（列表上限 80 行 + sticky 截断提示）；
    新增「工作区」选项、base/head 交换按钮、未跟踪文件计数与分组；任一侧为
    工作区时自动落到「文件」页（提交页按构造为空）。
  - 闸门（`fnm exec --using=22.23.1`）：lint 0、typecheck:server 0、
    **336 单测 / 34 文件**、build ok、**E2E 144/144**。浏览器实测：dev 42/42、
    **生产构建** 42/42（0 console error / 0 失败请求）、中文 15/15；
    1280×900 / 1280×620 / 1280×450 / 390×844 / 390×500 / 390×420 六种视口下
    弹层均无裁切、截断提示始终可见。
  - 目检（不是数字）抓出两个真缺陷并已修：① 560px 宽的弹层撑破 `.modal` 的
    滚动盒，聚焦输入框会把标题和 BASE 标签横向滚出视野 → 弹层改为锚定整个
    picker 行；② 矮视口下弹层被裁 0.5px、截断提示要滚动才看得到 → `.modal-compare`
    固定高度框架 + `clamp()` 弹层高度 + sticky 页脚。
  - **未扩大范围**：390 宽下页面级横向溢出是既有现象，把 HEAD 的样式表换回实时
    页面复测可复现（HEAD 748px vs 当前 693px），源头是 toolbar 的
    `.btn-group`/`.segmented`，`styles.css` 已注明其横向滚动是设计意图。
- **显示名：现阶段用 `PR Helper Git`（去掉「2」）**。用户 2026-11-11 决定
  （原话「pr-helper-git吧」「现阶段就用这个」）。`index.html:7` 的 `<title>`
  （浏览器标签 / 手机加到主屏时的名字，`/m` 手机视图共用同一个 shell）与
  `server/main.mjs:304-305` 的启动横幅均已改名。
  - **2026-11-12 扩展为运行时标识符改名**：`package.json` name、数据目录
    `~/.pr-helper-git`、localStorage `pr-helper-git:*` 命名空间、cookie
    `pr_helper_git_token`、环境变量 `PR_HELPER_GIT_*`、Tauri bundle id 均已切换，
    并带一次性迁移。
  - **兼容读取**：旧 cookie `git2_token` / 旧 header `x-git2-token` / 旧环境变量
    `GIT2_*` 仍可读；旧 localStorage 键在首次加载时复制到新键后删除；旧数据目录
    在新目录不存在时于首次启动 rename。设置页显示的是迁移后的真实路径。
  - **GitHub 仓库名同日一并改了**（用户明确要求）：归档仓
    `bayernjf/pr-helper-git` → **`bayernjf/pr-helper-git-archive`**，产品仓
    `bayernjf/pr-helper-git2` → **`bayernjf/pr-helper-git`**。归档仓是
    read-only，GitHub 拒绝直接改名（403），故按「解除归档 → 改名 → 立刻重新
    归档」三步执行，可见性全程 PRIVATE，收尾已复验回到 archived=true。
    复验：归档 main `18413da` + 5 tag 完好；产品 main `63e10c3` 未变；
    新旧两个 URL 的 `git ls-remote` 都可达（GitHub 保留旧名重定向）。
  - **本地 `origin` 已切到新 URL** `git@github.com:bayernjf/pr-helper-git.git`
    （2026-11-12 切换并复验 `ls-remote`）；旧 URL 的重定向仍由 GitHub 保留。
  - **产品仓是 PUBLIC**（`bayernjf/pr-helper-git`，2026-11-11 pushedAt 10:01Z）。
    本文档与 README 里「local-only / no remote / never pushed」的旧说法**与事实
    不符**，已就地更正；仓库是否转私有属用户决策，未擅自更改。
  - **冻结的 desktop 壳未改**：`desktop/main.swift:204,221` 与
    `scripts/desktop-build.mjs:12` 仍是旧显示名；desktop 已冻结、无法验证，
    故不在本次范围。注意 `main.swift:207` 的 `setFrameAutosaveName` 是
    **持久化键**不是显示名，改它会重置已保存的窗口位置。
  - 验证：隔离实例 + headless Chromium **8/8**（标签名、served HTML、
    390 宽 `/m`、设置页数据目录未变、0 console error / 0 失败请求）。
    并做反向变异证明检查能红：把 `dist/index.html` 标题改回 Git2 后 4 条转红，
    随后按 sha256 还原（`244ee7a9…`）并复测 8/8。

## pr-helper-git 本地清理（2026-11-11 全部执行，本地已归零）

背景：pr-helper-git 于 2026-11-10 推 GitHub（PRIVATE + ARCHIVED）并完成资产迁移。
原本地目录按 A6 约定保留一个发布周期（「到期后执行，不要提前」）；2026-11-11
用户逐项明确批准提前清理，反悔期由用户覆盖。

已删除（本地不再有任何 pr-helper-git 副本）：

- [x] 完整副本 `pr-helper-git-archive/`（4.3M）。删前核验：dirty=0、未推送 commit=0、
      `git ls-remote origin main` = `18413da` 与本地 HEAD 一致、
      `source-20261111-0021.bundle` 试克隆还原 144 commit / 5 tag
- [x] 空壳目录 `pr-helper-git/`（4.0K，仅 README-ARCHIVED.md）。删前以
      `lsof -a -d cwd -Fn` 精确匹配确认无进程锚定，`lsof +D` 无打开文件
- [x] 旧数据目录 `~/.pr-helper-git/`：`audit.log`（2071 条）、`repos.json`、
      `settings.json`（含 40 字符 `ghp_` classic PAT，login `bayernjf`）及空目录本身。
      前两者删前与备份副本 sha256 相同，且已核验不含凭据（68 处 40 位十六进制全部
      落在 `commit`/`good`/`bad`/`shas[]` 等 git 对象字段）
- [x] 旧实现的 4 个本地测试仓：`git-demo-playground`、`git-notes`、`git-sync-test`、
      `git-clone-ui-test`（删前均 dirty=0）
- [x] 冷备份目录 `000mycodes-backups/pr-helper-git/`（9.7M / 16 项：10 个 source
      bundle、2 个测试仓 bundle、旧数据 3 副本、RESTORE.md）

不可逆后果（用户在列明后果的选项下选择全删）：

- `git-demo-playground`（19 commit，HEAD `a691fdd`）与 `git-notes`（3 commit，
  HEAD `7de9549`）**无远端**，其唯一副本 testrepo bundle 已随备份目录删除，
  22 个 commit 永久丢失。`git-sync-test` / `git-clone-ui-test` 的远端
  `bayernjf/pr-helper-git-sync-test` 保留，可 re-clone
- 旧 `v0.6.1` annotated tag 对象 `9726fd6`（该 tag 后移至 `efd54b8`）仅存在于
  `source-20261110-2007.bundle`，已随之删除；其指向的 commit `951c7f4` 在 GitHub
  归档仓中仍在。删前已核验：9 个旧 source bundle 的 71 个 ref 中 70 个被最新 bundle 覆盖
- 旧审计 2071 条（2026-11-05→11-10）已无副本

唯一恢复源：GitHub 归档仓 **`bayernjf/pr-helper-git-archive`**（PRIVATE + ARCHIVED）。
2026-11-11 核验：main = `18413da`，5 个 tag 齐全（v0.3.0–v0.6.1，sha 与原最新 bundle 一致）。
⚠️ 该仓 2026-11-11 由 `bayernjf/pr-helper-git` 改名而来（用户要求，为把
`pr-helper-git` 这个名字让给产品仓）。**旧地址 `bayernjf/pr-helper-git` 现在指向
公开的产品仓，不再是归档仓**——任何旧书签 / 旧记录里的归档地址都要换成
`pr-helper-git-archive`。改名后已复验 main 与 5 个 tag 均完好。

凭据处置（2026-11-11 用户决定：**不吊销**，此项已关闭）：

- [x] 旧 `settings.json` 里那串 40 字符 `ghp_` classic PAT：**本地副本已删，
      GitHub 侧保留**。用户明确「这三个 token 是我要用的」。当天登录 GitHub
      核到账号下共 3 串 classic token，全部在用：`GitHub CLI`、
      `Visual Studio Code`、`job-agent GITHUB_TOKEN`。
      本机 `gh auth token` 同样是 40 字符 `ghp_`，与旧项目那串特征一致，
      且旧记忆记载其来源就是 `gh auth token`，因此**很可能是同一串**
      （判别实验未做完，不下确定结论）。吊销会打断 gh CLI，故不做。
      ⚠️ 后续会话不要再把这串当作「待吊销的泄漏凭据」去删除。
      git2 不依赖它：服务端 `config.json` 无 `github.token`，代码里也没有
      `gh`/环境变量回退；git 传输走 SSH（`git_protocol: ssh`），不受影响。

保留、不属于 pr-helper-git：`pr-helper`、`pr-helper-landing`（独立活项目）、
git2 现役测试仓（`git-e2e-test`、`git-init-check`、`Hello-World`；前两个于
2026-11-12 去掉「2」改名，GitHub 仓同步改名）、
git2 内继承资产（`docs/archive/pr-helper-git-desktop/`、`docs/parity-archive.md`）。
