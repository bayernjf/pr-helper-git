# PR Helper Git2

A local, loopback-only Git workbench that combines the core experience of a
graphical Git client (GitKraken-like) with a lightweight pull-request control
tower (pr-helper-like). No cloud service is required and nothing is pushed to
GitHub by the application setup.

## Features

### Git client (GitKraken-like core)

- Register and switch between local repositories, or add a new one through a
  three-mode dialog: open an existing folder, clone a remote over a network
  transport, or initialise a brand-new repository. The list is persisted under
  `~/.pr-helper-git2`.
- Scrollable commit graph rendered as SVG: colored branch lanes, smooth merge
  curves, distinct merge nodes, and color-coded badges for HEAD, local/remote
  branches and tags.
- Filter the graph by message, author or hash with a live result count, and
  load history in pages beyond the first 200 commits (up to 1,000).
- Reset the current branch to any commit with soft, mixed or hard semantics
  (hard reset requires an explicit confirmation).
- Safely revert a commit without rewriting history: a normal commit becomes a
  new "Revert" commit, merge commits are rejected (they need an explicit
  mainline), and a conflicting revert is automatically aborted so the working
  tree is never left half-finished.
- Switch the graph's history scope between every branch (`--all`) and the
  current branch only, straight from the graph toolbar.
- Ref sidebar with collapsible local branches, remote branches, tags and stash
  groups; a right-click context menu exposes the full action set.
- Checkout branches/tags, create branches (with a start point), rename and
  delete branches (safe delete, with an optional force delete), and merge a
  branch into the current branch.
- Create lightweight or annotated tags, delete tags, push a tag to a chosen
  remote, and push or delete a branch on the remote.
- Working-tree panel rendered as a collapsible folder tree with staged,
  unstaged and untracked groups; stage/unstage single files or everything,
  discard tracked changes, add an untracked path straight to `.gitignore`,
  and review syntax-colored diffs in unified or side-by-side split view.
- Commit with a message or amend the last commit, plus fetch, pull, push
  (upstream tracking supported), and stash create/apply/pop/drop.
- Open a file content viewer from the working tree or any commit: line-numbered
  contents from the working tree or a chosen ref, binary detection, a 1 MB size
  cap, a one-click git blame tab that attributes every line to its author and
  originating commit, and a file-history tab that follows the path across
  commits and can jump straight to any past revision.
- See branch divergence at a glance with ahead/behind badges, inspect a stash's
  patch before applying it, and copy a full commit hash with one click. Every
  dialog also closes on Escape.
- Clean untracked files safely: a dry-run confirmation lists every path (files
  and directories) before removal, while ignored files such as `.env` are never
  touched.
- Manage git remotes from a dedicated modal: inspect fetch/push URLs, add a
  remote over a validated network URL, edit a remote's URL inline (including
  the separate push URL), or remove one, with every write audited.
- Browse the reference log (reflog) in a four-column modal to see every recent
  HEAD movement, and open an annotated tag's detail to read its tagger, date
  and message.
- Stash through an options dialog with an optional message and an
  include-untracked toggle, and fetch with `--prune` to drop stale remote
  refs, both from the command palette.
- File watcher with server-sent events reloads the active repository instantly
  whenever the working tree changes on disk — no manual refresh needed.
- Keyboard shortcuts (Cmd/Ctrl+K opens a fuzzy command palette for views,
  repositories and common actions, Cmd/Ctrl+1 and +2 switch views,
  Cmd/Ctrl+Shift+F focuses the filter, `r` refreshes, Cmd/Ctrl+Enter commits),
  a draggable work-panel height, and responsive breakpoints for narrow windows.
- A React error boundary prevents a white screen if a component throws, and
  loading indicators cover the first load and every repository switch.

### Pull requests (pr-helper-like core)

- Three-column board: open, merged and closed, with a per-user review-state
  badge (approved, changes requested, comment only, none).
- Pull-request cards render their GitHub labels using each label's own color,
  alongside per-PR mergeability and check-run summaries.
- Create a pull request from any local branch, optionally as a draft, with a
  prefilled commit summary.
- Convert a draft to ready for review, inspect commits, files and check runs,
  view and request reviewers, then merge using squash, merge commit or rebase;
  close and reopen are also supported.
- Read and write issue comments inside the pull-request detail, with a composer
  that posts on Cmd/Ctrl+Enter and keeps the post button disabled until text is
  entered.
- Draft conversion and merging run through GitHub GraphQL (the REST merge
  endpoint is unavailable in some environments); the GitHub personal access
  token is stored only in the browser and sent through the local proxy, never
  written to disk.

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

Temporary repositories used for end-to-end testing are registered in
[test-repos.md](test-repos.md) with their local path and GitHub URL, so they can
be removed again on request.

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
| Git | `execFile('git', argv)` with parsers for porcelain v2, log, refs and blame |
| GitHub | REST allowlist proxy plus GraphQL merge/ready endpoints |

```
server/
  main.mjs           HTTP entry, token/cookie auth, static hosting, SSE
  security.mjs       path validation, ref validation, token checks
  git.mjs            git runner and pure output parsers
  store.mjs          registry persistence and audit log
  watcher.mjs        recursive file watcher and SSE broadcast hub
  routes-git.mjs     Git read/write API
  routes-github.mjs  GitHub proxy, GraphQL merge/ready, remote URL parsing
src/
  app-state.tsx      central data/state provider
  api.ts             typed API client
  components/        UI components, inline SVG icons, context menu, modals
  lib/               graph layout, formatting, file tree, diff, review, fuzzy (pure)
scripts/dev.mjs      parallel Vite + API launcher
```

## Checks

```bash
npm test           # Vitest unit tests
npm run lint       # tsc --noEmit
npm run build      # production build into dist/
```
