# PR Helper Git2

A local, loopback-only Git workbench that combines the core experience of a
graphical Git client (GitKraken-like) with a lightweight pull-request control
tower (pr-helper-like). No cloud service is required and nothing is pushed to
GitHub by the application setup.

## Features

### Git client (GitKraken-like core)

- Register and switch between local repositories; the list is persisted under
  `~/.pr-helper-git2`.
- Scrollable commit graph rendered as SVG: colored branch lanes, merge curves,
  commit nodes, and badges for HEAD, local/remote branches and tags.
- Ref sidebar with local branches, remote branches, tags and the latest stash.
- Checkout branches/tags, create branches (with a start point), delete branches
  (safe delete, with an optional force delete), and merge a branch into the
  current branch.
- Working-tree panel with staged, unstaged and untracked groups; stage/unstage
  single files or everything, discard tracked changes, and review syntax-colored
  diffs.
- Commit with a message, plus fetch, pull, push (upstream tracking supported),
  and stash create/apply/pop/drop.

### Pull requests (pr-helper-like core)

- Three-column board: open, merged and closed.
- Per-PR mergeability and check-run summaries.
- Create a pull request from any local branch with a prefilled commit summary.
- Inspect check runs, then merge using squash, merge commit or rebase; close and
  reopen are also supported.
- The GitHub personal access token is stored only in the browser and sent
  through the local proxy; the server never writes it to disk.

### Deliberately out of scope

Interactive rebase, cherry-pick, submodules, worktrees, GPG signing, conflict
resolution UI, GitHub App OAuth, webhooks, a database, web push, deployment
gates and AI generation.

## Quick start

```bash
npm install
npm run dev      # Vite app on http://127.0.0.1:5173 + API on :4789
```

For a single-port production-style run:

```bash
npm run build
npm start        # prints a one-time token URL, e.g. http://127.0.0.1:4789/?token=...
```

Use **+ Add repository…** in the toolbar to register a local Git folder.

## Security model

- The server binds to `127.0.0.1` only. In production it generates a random
  per-process token that is exchanged for an HttpOnly, SameSite=Strict cookie.
- Git is invoked with `execFile` and fixed argv arrays — user input is never
  passed to a shell. Repo-relative paths are normalized and checked with
  `realpath` so symlinks cannot escape the repository root.
- Sensitive files (`.env`, `.env.*`, `id_rsa*`, `*.key`, `*.pem`, `*.p12`,
  `*.pfx`) have their diffs masked and cannot be discarded from the UI.
- GitHub calls go through a method/path allowlist; the PAT travels in a request
  header and is never persisted. All write actions are appended to an audit log
  under `~/.pr-helper-git2/audit.log`.

## Architecture

| Layer | Implementation |
| --- | --- |
| Client | React 19 + TypeScript, Vite build, plain CSS |
| Server | Node.js built-in `http`, zero runtime dependencies |
| Git | `execFile('git', argv)` with parsers for porcelain v2, log and refs |
| GitHub | REST API proxy with an endpoint allowlist |

```
server/
  main.mjs           HTTP entry, token/cookie auth, static hosting
  security.mjs       path validation, ref validation, token checks
  git.mjs            git runner and pure output parsers
  store.mjs          registry persistence and audit log
  routes-git.mjs     Git read/write API
  routes-github.mjs  GitHub proxy and remote URL parsing
src/
  app-state.tsx      central data/state provider
  api.ts             typed API client
  components/        UI components
  lib/               graph layout and formatting (pure, tested)
scripts/dev.mjs      parallel Vite + API launcher
```

## Checks

```bash
npm test           # Vitest unit tests
npm run lint       # tsc --noEmit
npm run build      # production build into dist/
```
