# Contributing

`pr-helper-git` is a single-maintainer, local-first project, but changes follow
the same reviewable flow whether they come from a person or an agent. Read
[AGENTS.md](AGENTS.md) for the hard constraints; this file covers the day-to-day
workflow.

## Setup

Requirements: Node.js 22 (see `.nvmrc`), npm, and Git.

```bash
npm ci
npm run dev
```

`npm run dev` starts Vite on `http://127.0.0.1:5173` and the API on port
`4789`. For a production-style single-port run:

```bash
npm run build
npm start
```

## Branches

Only two long-lived branches are used:

| Branch | Purpose |
|---|---|
| `main` | production / release state |
| `dev` | day-to-day work |

Work on `dev`. Integrate through a `dev -> main` pull request. Do not rewrite
`main` history and do not create feature branches unless the user explicitly
asks.

Before starting:

```bash
git checkout dev
git status -sb
git merge --ff-only origin/main   # keep dev current
```

## Commits

Use Conventional Commits and keep each commit focused:

```text
feat(compare): select arbitrary commits and the worktree
fix(server): reject percent-encoded parent segments
refactor(ui): extract sidebar row components
test(e2e): assert the pulled commit by SHA
docs: add agent and contribution guides
chore(release): 0.2.4
ci: run checks on the dev branch too
```

Rules:

- One logical change per commit; avoid mixing refactor and behaviour changes.
- Mention the affected area in the scope: `server`, `ui`, `api`, `e2e`, `docs`.
- Do not commit generated `dist/` output, local data, tokens, PATs, or keys.
- Default to local commits; push only when the user asks.

## Quality gates

Run the full gate before a PR or release:

```bash
npm run lint
npm run typecheck:server
npm test
npm run build
npm run e2e
```

Expected baseline at release `0.2.4`: **337 unit tests / 34 files**, **E2E
144/144**, build passes. If your change moves the baseline, update
`README.md`, `AGENTS.md`, and the relevant release notes.

E2E starts a real server on port `18774` with an isolated `PR_HELPER_HOME`; it
never touches `~/.pr-helper-git`.

## Desktop builds

The macOS shell is part of the deliverable again, but it stays thin: features
live in the web UI and server, while Swift owns windowing, process lifetime,
the menu and external links.

```bash
npm run desktop
```

This is macOS-only and needs the Xcode command-line tools (`swiftc`, `sips`,
`iconutil`) plus Node. It is not part of the default Linux CI loop; the CI
workflow has a macOS job that runs the native test, builds the bundle and runs
the smoke check. Run these locally whenever `desktop/` or the build scripts
change:

```bash
npm run desktop:native-test
npm run desktop
npm run desktop:smoke
```

Then confirm `CFBundleShortVersionString` in the bundle matches `package.json`.

For a distributable artifact:

```bash
npm run desktop:dist
```

This writes a zip, a dmg and `SHA256SUMS` under `build/release/`. Without Apple
credentials it is unsigned and local-only. Signing and notarization are
configured with `APPLE_SIGNING_IDENTITY` and `APPLE_NOTARY_PROFILE`; see
[`docs/desktop-distribution.md`](docs/desktop-distribution.md).

## Pull requests

1. Push `dev` only after explicit approval.
2. Open a PR with `main` as base and `dev` as head.
3. Use a Conventional Commit-style title and include:
   - what changed and why;
   - user-visible impact;
   - the gates you ran and their results;
   - migration or compatibility notes, if any.
4. Wait for CI on the PR head. Do not merge with failing checks.
5. Merge with a merge commit so the release history remains traceable.
6. After merge, confirm `main` and `dev` point at the same merge commit.

## Code rules

### Client

- TypeScript is strict; do not introduce `any`. Use the existing
  `errorMessage` / `errorDetail` / `errorStatus` helpers for unknown errors.
- Put typed API calls in `src/api/` by domain; do not recreate a monolithic
  `src/api.ts`.
- Use design tokens from `design/tokens.css`; avoid hardcoded colours.
- User-facing strings go through `t()` / `tp()` in `src/i18n.ts`. Keep both
  Chinese and English entries.
- Prefer extracting a focused component or pure helper over growing an
  already-large component.

### Server

- Server files are ESM `.mjs` with `checkJs`; keep `npm run typecheck:server`
  green.
- Git commands use `execFile` with fixed argv arrays. Never pass user input
  through a shell.
- Normalize and validate repo-relative paths; reject traversal and
  percent-encoded bypasses.
- Write routes must be POST; do not add a GET write path.
- GitHub calls go through the method/path allowlist. Do not widen it without
  tests.
- Keep responses JSON-shaped and consistent with existing `ok` / `fail` /
  `gitFail` helpers.

### Tests

- Add a route test for new server behaviour and an E2E assertion when the
  behaviour is user-visible.
- Keep the E2E fixture repositories self-contained; do not depend on a
  developer's real repositories.
- For ordering-sensitive Git assertions, assert the target commit or use a
  precise filter instead of relying on "the newest line".

## Release

1. Ensure `dev` is clean and current with `origin/main`.
2. Bump `package.json` and `package-lock.json`:

   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```

3. Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md`.
4. Add `## Release X.Y.Z` to `handoff.md` (scope, gates, compatibility).
5. Run the full gate.
6. Commit `chore(release): X.Y.Z`, push `dev` with approval, open and merge the
   release PR.
7. Tag the release commit with an annotated tag and push it:

   ```bash
   git tag -a vX.Y.Z <release-commit> -m "pr-helper-git vX.Y.Z — <summary>"
   git push origin vX.Y.Z
   ```

8. Run the backup and verify `main`, `dev`, and the new tag in the bundle.

## Documentation

| Change | Update |
|---|---|
| Feature, setup, security, checks | `README.md` |
| User-visible change / release | `CHANGELOG.md` |
| Release, migration, major refactor, lesson | `handoff.md` |
| Process, agent constraints | `AGENTS.md` / `CONTRIBUTING.md` |
| Long-lived reference | `docs/` + `docs/README.md` |

The version must match across `package.json`, `package-lock.json`,
`CHANGELOG.md`, and `handoff.md`.

## Backups

Backups live under `/Users/jiangfeng/000mycodes-backups`. Use the project
script rather than hand-building bundles:

```bash
bash /Users/jiangfeng/000mycodes-backups/pr-helper-backup.sh
```

The script copies the data directory with secret-shaped fields redacted and
pins `main`, `dev`, and tags explicitly. Verify the latest bundle:

```bash
git bundle list-heads <latest.bundle> | grep -E 'refs/heads/(main|dev)|refs/tags/'
```

Never place tokens, PATs, AI keys, or unredacted `config.json` in a backup.
