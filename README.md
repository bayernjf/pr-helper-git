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
- Server-side history filters in a dedicated dialog: author pattern, message
  pattern and since/until calendar dates, so commits outside the loaded page
  are still searchable; invalid dates are rejected with a 400.
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
  remote over a validated network URL, rename one, edit a remote's URL inline
  (including the separate push URL), or remove one, with every write audited.
- Browse the reference log (reflog) in a four-column modal to see every recent
  HEAD movement, and open an annotated tag's detail to read its tagger, date
  and message.
- Stash through an options dialog with an optional message and an
  include-untracked toggle, and fetch with `--prune` to drop stale remote
  refs, both from the command palette.
- Compare any two references in a dedicated modal: pick a base and a head to
  see the commits unique to each side (ahead/behind) and the renamed-aware
  file diff with per-file add/delete counts, with separate Commits and Files
  tabs.
- Point a local branch at a remote tracking branch (set-upstream), rename a
  remote while keeping its URLs, and filter the ref sidebar by name as
  branches, tags and stash entries grow.
- Toggle ignore-whitespace (`-w`) on the working diff so indentation-only
  changes drop out; the toggle stays available even when the diff is empty.
- Pick a merge strategy from a dedicated modal — default, `--no-ff` (always a
  merge commit), `--ff-only` (fail if a fast-forward is impossible) or
  `--squash` (stage incoming changes without committing).
- Checkout a remote branch without landing in a detached HEAD: the app creates
  a local branch that tracks the remote ref (or reuses an existing local
  branch of the same name).
- Choose how many diff context lines to show (`--unified`), create an empty
  commit with `--allow-empty` when nothing is staged, and create a branch
  without switching to it.
- Pull and push through split button groups with a caret: pull using the
  default merge or `--rebase`, and force-push with either `--force` or the
  safer `--force-with-lease`, each protected by an explicit confirmation.
- Abort a conflicted merge (`git merge --abort`) from an automatic banner that
  appears while a merge is in progress, and force-create a tag (`-f`) to
  overwrite an existing name from the create-tag dialog.
- Delete a tag directly on the shared remote (`push --delete`) behind a
  confirmation, while the local tag is left untouched.
- Revert a merge commit from the graph: a dialog asks which parent is the
  mainline (`-m 1..N`), since reverting a merge needs that explicit choice.
- Search the whole repository contents with `git grep` from a dedicated modal:
  results are grouped by file with line numbers, and an optional path narrows
  the scope, including a clear empty state.
- Rename or move any file through `git mv` (history is preserved and the
  change is staged), or delete a file from its row: tracked files use
  `git rm` while fully untracked files are removed directly, each behind a
  confirmation dialog.
- Filter the commit graph by path (`git log -- <path>`) so only commits that
  touched the chosen file or folder are shown, with the live count updated.
- Untracked files render a full diff straight away: the diff route detects
  them and runs `git diff --no-index /dev/null <file>`, marking the response
  as untracked instead of showing an empty pane.
- Rebase recovery: status detects `rebase-merge`/`rebase-apply` state, an
  amber banner offers Continue (`git rebase --continue`) and Abort
  (`git rebase --abort`), and the operation state is part of the status API.
- File watcher with server-sent events reloads the active repository instantly
  whenever the working tree changes on disk — no manual refresh needed. Lock
  files and in-flight temp objects are filtered so git's internal churn does
  not broadcast spurious events, and a background refresh never closes an open
  commit patch or file-viewer modal.
- Keyboard shortcuts (Cmd/Ctrl+K opens a fuzzy command palette for views,
  repositories and common actions, Cmd/Ctrl+1 and +2 switch views,
  Cmd/Ctrl+Shift+F focuses the filter, `r` refreshes, Cmd/Ctrl+Enter commits),
  a draggable work-panel height, and responsive breakpoints for narrow windows.
- Layout stays intact at every width: graph rows clip to a single line with the
  subject truncating instead of pushing the author/hash/date off-screen, dense
  ref badges scroll within their own strip rather than covering the subject,
  the top toolbar scrolls horizontally instead of wrapping its labels, and
  sidebar group headers never wrap.
- A React error boundary prevents a white screen if a component throws, and
  loading indicators cover the first load and every repository switch.
- Audit log viewer: every mutating request and GitHub proxy call is appended
  to a JSONL audit trail, and the in-app audit modal reads the most recent
  entries with success/failure markers, timestamps and collapsible raw JSON.
  The modal ships with a free-text filter (action and summary) and an
  outcome selector for all, success-only or failure-only entries, plus a
  no-match empty state. Filtering runs on the server over the whole retained
  file (up to 1,000 rows returned), so matches are not limited to a small
  loaded window; the text input is debounced while typing.
- Audit retention: once the JSONL file crosses 1.5 MB it is rotated
  atomically, keeping the newest entries that fit a 1 MB / 10,000-entry
  budget; corrupt lines are dropped and the rewritten file always stays
  below the trigger so ordinary appends never re-rotate.
- In-app file editor: working-tree text files open in an edit mode with a
  monospace textarea; saves are validated server-side (sensitive files,
  NUL bytes and a 1 MB cap are rejected) and written atomically via a
  temp-file rename, with every save recorded in the audit log. Each save
  carries the file's last-known mtime, and the server rejects a stale save
  with 409 if the file changed on disk, keeping the editor's draft intact.
  The editor binds Cmd/Ctrl+S to save without leaving the textarea, and
  Tab/Shift+Tab indent or outdent the current line instead of moving focus.
- Per-hunk staging: each hunk in the unified working-tree diff exposes a
  Stage hunk action (and Unstage hunk in the staged view). The server
  regenerates the authoritative diff, splices the chosen hunk and applies
  it to the index with `git apply --cached`, so a file can be partially
  staged without touching the rest of its changes. Untracked files keep
  whole-file staging, and a partially staged file is reported with the
  `MM` porcelain status.
- Per-hunk discard: the same hunk header offers Discard hunk, which
  reverse-applies the chosen hunk to the working tree only (`git apply
  -R`), leaving the index untouched so a single hunk can be reverted
  without restoring the whole file.
- Keyboard-driven commit graph with accessibility semantics: the graph is
  a single tab stop (`listbox`), rows are `option`s with a roving
  `tabIndex`, and Arrow Up/Down move the selection, Home/End jump to the
  first/last commit and Enter/Space open the detail, with a visible focus
  ring. Every modal is wrapped in a focus trap that cycles Tab and returns
  focus to the control that opened it on close.
- Persistent UI preferences in `localStorage` (one JSON object): the
  Git/PR view, collapsed sidebar groups, the work-panel height, and the
  branch pinning and sort order are all restored per repository after a
  reload, with safe fallbacks if storage is unavailable.
- Cross-repository search from a global `git grep` modal that runs the
  pattern across every registered repository (per-repo errors are
  isolated), grouping matches by repository and file with a 500-result cap.
- Multi-select commits in the graph with checkboxes to revert several
  commits in one oldest-first batch (merge commits are rejected and the
  batch aborts on conflict), or copy the selected SHAs, from a floating
  batch bar.
- Pin local branches to the top of the sidebar and sort the rest by name
  or by the most recent tip commit, with a pin badge marking fixed rows.
- Commit template support: the app reads the configured
  `commit.template` (local or global, including an absolute home-directory
  path) and prefills the commit message when the field is empty, without
  overwriting manual edits.

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
  entered. Existing comments can be edited (`PATCH`) or deleted (`DELETE`)
  inline, with a confirmation dialog before deletion.
- Submit a pull-request review from the detail modal — Comment, Approve or
  Request changes (the last requires a summary). Existing reviews are listed
  with their state, and one endpoint failing never blanks the whole modal.
- Line-level review comments: each file in the PR detail expands into its
  unified diff, where every line offers an inline comment action. Comments
  are posted through the local proxy using the modern `commit_id`/`path`/
  `line`/`side` parameters (`RIGHT` for added/context lines, `LEFT` for
  deletions), grouped on their line, and comments whose line no longer
  exists are collected in an outdated-comments section. Each comment card
  supports a threaded reply (`in_reply_to`), an inline edit and a delete
  through the flat `pulls/comments/:cid` endpoint.
- The PR description is rendered at the top of the detail and can be
  edited inline on open pull requests via `PATCH pulls/:n`, with an empty
  state when no description exists.
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
  `*.pfx`) have their diffs masked and cannot be discarded or edited from the
  UI, and the save endpoint rejects them independently.
- GitHub calls go through a method/path allowlist; the PAT travels in a request
  header and is never persisted. All write actions are appended to an audit log
  under `~/.pr-helper-git2/audit.log`, which is size-bounded by automatic
  rotation.
- Request bodies are capped at 256 KB; an oversized request receives a 413
  response with `Connection: close` before its socket is torn down, so the
  client never sees a bare connection reset. Keep-alive timeouts are tuned
  explicitly to avoid pooled-client races.
- Every response carries `X-Content-Type-Options: nosniff`. The HTML entry is
  served with a strict Content-Security-Policy, `Referrer-Policy: no-referrer`
  and `no-store`, while content-hashed assets use long-lived immutable caching.

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
npm test           # Vitest unit + route-level HTTP tests
npm run lint       # tsc --noEmit
npm run build      # production build into dist/
```

The same three steps run in CI on every push and pull request via the
GitHub Actions workflow in `.github/workflows/ci.yml`.

The route tests spawn a real server on an ephemeral port against a temporary
Git repository and an isolated `PR_HELPER_HOME`, covering the read/write Git
routes, validation failures, rebase-state detection, the SSE handshake,
audit rotation, server-side audit filtering, mtime-based stale-save
rejection (including the 413 body cap), cross-repository `grep-all`,
batch revert and the configured commit template. The isolated audit path is
always built from the server's home directory so tests can never touch the
real audit log, and an isolated `GIT_CONFIG_GLOBAL` keeps machine-wide
settings such as a global `commit.template` out of the assertions.
Component tests render key React components with `react-dom/server`
(`renderToString`) against a mock app context, covering empty states,
masked/binary handling and the toolbar and audit modal.

All checks are run with zero third-party runtime dependencies; the test and
build tooling is the only dev dependency set.
