# PR Helper Git

A local-first Git workbench, bound to loopback by default, that combines the core experience of a
graphical Git client (GitKraken-like) with a lightweight pull-request control
tower (pr-helper-like). No cloud service is required and nothing is pushed to
GitHub by the application setup. This repository itself is hosted publicly at
`bayernjf/pr-helper-git`, so treat every committed file as world-readable; the
application never pushes it for you.

## Features

- **Bilingual UI (English / 中文)** — switch language in Settings. UI copy stays English in the
  components and is translated at render time by `src/i18n.ts` (dictionary + counted-string rules).

### Dashboard (full page)

- **Third top-level view** (`Dashboard | Git | Pull Requests`): card grid of every registered repository
  with branch chip, staged/unstaged/untracked pills, ↑ahead ↓behind, **open-PR count** (GitHub-hosted repos),
  last-commit line and freshness bar; conflicted repos sort first, pinned next, then a persisted sort order
  (name / recent / change count)
- Right-click card menu: open / pin / Reveal in Finder / Open in Terminal / Open in VS Code / remove from list
  (`POST /api/repos/open-external`, audited, registered repos only)
- **Background fetch-all** every 10 minutes while the page is open (toggle, persisted) + manual fetch-all +
  30-second status auto-refresh

### Git client (GitKraken-like core)

- **CI status dots on the commit graph** for open-PR head commits (check runs + statuses rolled up:
  failure > pending > success, pulsing while pending)
- **Image diffs** — HEAD vs working-tree previews side by side for 8 image extensions (`GET /api/raw`)
- **Commit-message history** (last 10, click to backfill), 50/72 first-line counter, amend toggle
  prefills the HEAD message, **Discard all** (unstaged reverted + untracked removed, with confirm)
- **Commit-message draft** persisted per repository (survives repo switches and reloads, cleared on commit)

- Register and switch between local repositories, or add a new one through a
  three-mode dialog: open an existing folder, clone a remote over a network
  transport, or initialise a brand-new repository. The list is persisted under
  `~/.pr-helper-git`.
- Open repositories panel: a filterable list of every registered repository
  showing its location, working-tree change counts, ahead/behind and current
  branch, with an active marker. Click a row to open it, or select several rows
  to fetch them in one batch, or pull them with `--ff-only` so a diverged or
  dirty repository fails cleanly instead of merging off-screen (a single
  failure never aborts the rest; the per-repository outcome is listed inline).
  Repositories can be pinned (kept first in the list, persisted locally), each
  row carries an activity bar coloured by the age of its last commit, and a
  header line aggregates changed files, unpushed and behind commits across every
  repository. A "With changes" filter narrows the list to repositories that need
  attention, and the status snapshot refreshes every 30 seconds while the panel
  stays open (status only — it never fetches or pulls).
- Scrollable commit graph rendered as SVG: colored branch lanes, smooth merge
  curves, distinct merge nodes, and color-coded badges for HEAD, local/remote
  branches and tags. Only rows around the viewport are mounted (with a small
  overscan), so a 1,000-commit history stays responsive while the scrollbar
  still spans the whole list.
- Filter the graph by message, author or hash with a live result count, and
  load history in pages beyond the first 200 commits (up to 1,000).
- Server-side history filters in a dedicated dialog: author pattern, message
  pattern and since/until calendar dates, so commits outside the loaded page
  are still searchable; invalid dates are rejected with a 400.
- Reset the current branch to any commit with soft, mixed or hard semantics
  (hard reset requires an explicit confirmation).
- Safely revert a commit without rewriting history: a normal commit becomes a
  new "Revert" commit, while reverting a merge commit asks for the mainline
  parent (`-m 1..N`) in a dialog. When a revert stops on conflicts the working
  tree is kept as-is: status reports `revertInProgress`, and an amber banner
  offers Continue (`git revert --continue`, refused while unmerged paths
  remain) or Abort (`git revert --abort`).
- Switch the graph's history scope between every branch (`--all`) and the
  current branch only, straight from the graph toolbar.
- Ref sidebar with collapsible local branches, remote branches, tags and stash
  groups; a right-click context menu exposes the full action set. A read-only
  Submodules group appears when the repository has submodules, showing git's
  four states (up to date, not initialized, checked-out commit differs,
  conflicted) with the pinned SHA and describe string.
- Checkout branches/tags, create branches (with a start point), rename and
  delete branches (safe delete, with an optional force delete), and merge a
  branch into the current branch.
- Create lightweight or annotated tags, delete tags, push a tag to a chosen
  remote, and push or delete a branch on the remote.
- Working-tree panel rendered as a collapsible folder tree with staged,
  unstaged and untracked groups; stage/unstage single files or everything,
  discard tracked changes, add an untracked path straight to `.gitignore`,
  and review syntax-colored diffs in unified or side-by-side split view, with
  the changed words of a replaced line highlighted in both modes.
- Commit with a message or amend the last commit, plus fetch, pull, push
  (upstream tracking supported), and stash create/apply/pop/drop.
- Open a file content viewer from the working tree or any commit: line-numbered
  contents from the working tree or a chosen ref, binary detection, a 1 MB size
  cap, a one-click git blame tab that attributes every line to its author and
  originating commit, and a file-history tab that follows the path across
  commits and can jump straight to any past revision.
- See branch divergence at a glance with ahead/behind badges (plus a red
  `gone` marker when the upstream ref was deleted on the remote), inspect a
  stash's patch before applying it, and copy a full commit hash with one click.
  The detail panel also reports the commit's signature verdict from git's
  `%G?` letter (verified, bad, unknown validity, unsigned, cannot be checked,
  expired, expired key, revoked key), which needs no signing key material —
  unsigned repositories simply read "Not signed". Every dialog also closes on
  Escape.
- Clean untracked files safely: a dry-run confirmation lists every path (files
  and directories) before removal, while ignored files such as `.env` are never
  touched.
- Bisect wizard from the command palette: start from a good and a bad commit
  (prefilled with the ends of the loaded history), mark the current commit
  good/bad, and reset back to the starting branch. State is read from git's
  own `BISECT_LOG` / `BISECT_START`, so a session survives a server restart.
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
- Resolve conflicts from a panel opened in the merge, rebase or revert banner:
  every unmerged path lists View, Use current (`checkout --ours`), Use incoming
  (`checkout --theirs`), Editor and Mark resolved (`git add -A`), with the
  remaining count updated after each choice. Editor opens the three-way merge
  editor (`ConflictEditorModal` + `src/lib/diff/conflict.ts`): conflict markers
  are parsed into regions, each region can take ours / theirs / both, the
  assembled result is editable, and saving uses the mtime optimistic lock and
  stages the file.
- Delete a tag directly on the shared remote (`push --delete`) behind a
  confirmation, while the local tag is left untouched.
- Revert a merge commit from the graph: a dialog asks which parent is the
  mainline (`-m 1..N`), since reverting a merge needs that explicit choice.
- Cherry-pick any commit from the graph context menu onto the current branch;
  a conflict is reported with the conflicted paths and leaves the repository in
  the cherry-picking state instead of silently aborting. Undo the newest commit
  on the current branch with a soft reset (`git reset --soft HEAD~1`, the
  changes stay staged).
- AI generation through any OpenAI-compatible `chat/completions` endpoint: a
  **Generate with AI** button drafts a Conventional-Commits message from the
  staged diff, and the new-PR dialog drafts a title plus Markdown description
  from `target..source`. The base URL, model and key are configured in Settings
  and stored server-side in `~/.pr-helper-git/config.json`; the key is never
  returned to the browser (the API only reports `hasKey`), and a test button
  verifies the endpoint before you rely on it.
- Interactive rebase from any commit in the graph context menu: the dialog
  lists every commit newer than the picked one and lets you reorder them,
  reword, squash, fix up, edit or drop each. The server re-reads the range and
  rejects a plan that is not a full permutation of it, so a commit can never
  disappear because it was left out; a dirty working tree or a range containing
  merge commits is refused outright, and a range that is already pushed warns
  about the force-push. A conflict stops the rebase and hands over to the
  existing continue/abort banner.
- Search the whole repository contents with `git grep` from a dedicated modal:
  results are grouped by file with line numbers, an optional path narrows the
  scope, a file glob (e.g. `*.ts`) narrows it by name, `Ignore case` maps to
  `git grep -i`, and clicking a match opens the file viewer scrolled to that
  line with the matched term highlighted.
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
- Appearance settings: dark / light / follow-system modes plus four accent
  presets (violet, ocean, forest, amber), persisted locally and applied before
  first paint; the toolbar button cycles dark → light → system.
- Server data maintenance in Settings: shows the data directory and file
  sizes, compacts the audit log on demand, and prunes registry entries whose
  paths no longer exist or are no longer Git worktrees (no files are deleted).
- Team use on one local instance (M1): the startup token belongs to the
  instance owner (`admin`). The Team panel creates additional members with
  their own one-time token, lists and revokes them, and exports/imports the
  team configuration (repository registry plus member names — no tokens, no
  PATs). Every audit entry carries the acting member's `user` and `role`, so
  a shared machine shows who staged, committed, pushed or changed settings.
  Member tokens are stored only as SHA-256 hashes; the plaintext is shown once.
  This is the "one copy per person" milestone: it does not yet provide a
  multi-writer queue for several people driving one working tree.
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
- Whole-history commit search: a dedicated dialog (toolbar, command palette,
  or Shift+Enter with the graph focused) searches every reachable ref —
  including branches the loaded graph page never showed. A bare query greps
  the message case-insensitively, `author:` narrows it to an author and
  `path:` to commits touching a file or directory. Results are capped at 30
  and selecting one jumps straight to that commit.
- Line-level staging: clicking a `+`/`-` line marks it, and the hunk header
  then offers Stage N lines (or Unstage N lines in the staged view). The
  server rebuilds a patch from just those lines, recomputing the `@@` counts,
  and keeps unselected changes that the index already holds as context — so
  selecting a subset of an interleaved hunk still applies cleanly instead of
  failing with "patch does not apply".
- Keyboard-driven commit graph with accessibility semantics: the graph is
  a single tab stop (`listbox`), rows are `option`s with a roving
  `tabIndex`, and Arrow Up/Down move the selection, Home/End jump to the
  first/last commit and Enter/Space open the detail, with a visible focus
  ring. Every modal is wrapped in a focus trap that cycles Tab and returns
  focus to the control that opened it on close. Icon-only controls carry
  `aria-label`s, and a keyboard-shortcut reference modal (toolbar button or
  the `?` key) lists every shortcut grouped by context.
- Persistent UI preferences in `localStorage` (one JSON object): the
  Git/PR view, collapsed sidebar groups, the work-panel height, and the
  branch pinning and sort order are all restored per repository after a
  reload, with safe fallbacks if storage is unavailable.
- Resizable three-pane layout: the sidebar and detail panels expose
  draggable edge separators (pointer or keyboard arrows, Shift for a larger
  step) that clamp to a minimum/maximum and persist their widths, with the
  ARIA `separator` role. The stylesheet also honors
  `prefers-reduced-motion`, collapsing every animation and transition to a
  near-instant change instead of disabling the underlying state updates.
- Cross-repository search from a global `git grep` modal that runs the
  pattern across every registered repository (per-repo errors are
  isolated), grouping matches by repository and file with a 500-result cap;
  the same case-insensitive and glob filters are available here.
- Fetch a pull request head locally: **Fetch PR branch** in the PR detail footer
  runs `git fetch origin pull/<n>/head` and creates a local `pr-<n>` branch at
  it without touching the working tree or current branch.
- Multi-select commits in the graph with checkboxes to revert several
  commits in one oldest-first batch (merge commits are rejected and the
  batch aborts on conflict), or copy the selected SHAs, from a floating
  batch bar.
- Pin local branches to the top of the sidebar and sort the rest by name
  or by the most recent tip commit, with a pin badge marking fixed rows.
- Commit template support: the app reads the configured
  `commit.template` (local or global, including an absolute home-directory
  path) and prefills the commit message when the field is empty, without
  overwriting manual edits. On commit and amend, message cleanup mirrors
  git's `strip` mode: `#` comment lines are removed, trailing whitespace
  trimmed and blank lines collapsed, so template comments are never committed.
- The production build splits the React runtime into a separate cacheable
  chunk from the application code, and the Node version is pinned via
  `.nvmrc` and the `engines` field.

### Pull requests (pr-helper-like core)

- Three-column board: open, merged and closed, with a per-user review-state
  badge (approved, changes requested, comment only, none).
- Pull-request cards render their GitHub labels using each label's own color,
  alongside per-PR mergeability and check-run summaries.
- Create a pull request from any local branch, optionally as a draft, with a
  prefilled commit summary.
- Merge gating: the PR panel merges check runs *and* classic commit statuses
  (Jenkins-style CI), warns before merging when any gate failed, and reads the
  base branch's protection settings (404 = unprotected) to call out missing
  protection and required status checks.
- Convert a draft to ready for review, inspect commits, files and check runs,",
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
  endpoint is unavailable in some environments). The GitHub personal access
  token can be stored server-side through `/api/pat` and never round-trips to
  the browser; a request-scoped `x-github-pat` header remains supported as a
  fallback. In server-side mode the token lives in
  `~/.pr-helper-git/config.json`, never in the repository or a log.

### Phone view (`/m`)

Opening `/m` (or any URL with `?mobile=1`) renders a read-only, single-column
layout built for a phone: one sticky bar with repository picker, refresh and
language toggle, then branch + ahead/behind, staged/unstaged/untracked counts,
an 80-commit list. When the working tree is dirty the same screen lists every
changed file (status letter, path, staged/unstaged/untracked), and tapping one
shows that file's diff. Tapping a commit opens a full-screen sheet with author,
date, signature verdict, body, changed files (`+n/-n`) and the per-file diff.
There is no staging, commit, push or rebase control in this view.

`/m?repo=<path>&commit=<sha>` deep-links straight to one commit of one repository.

The server binds `127.0.0.1` by default. For phone access set
`GIT2_HOST=0.0.0.0` (or a specific LAN/Tailscale address) and restart, or keep
the default and use an SSH port forward. Only do this on a private network
(Tailscale/ZeroTier/WireGuard); never forward the port from a router or expose
it publicly. The one-time token in the URL is still the only credential.

### Deliberately out of scope

Worktrees, adding or updating submodules (status is read-only), creating GPG
signatures (verification is supported), GitHub App OAuth, webhooks, a
database, web push and deployment gates.
Conflicts are handled per file from the in-app panel (Use current / Use
incoming / Mark resolved) plus the three-way merge editor for
region-by-region resolution.

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

## Desktop app (macOS, frozen)

> Desktop development is paused. New features target the browser UI and are not
> adapted to the native shell; the checked-in bundle predates them. Use
> `npm run dev` / `npm start` for current behaviour.

A native macOS desktop build is available without bundling any third-party
runtime. It uses the system `WKWebView` (no embedded Chromium) and a
`swiftc`-compiled native shell, and it reuses the Node.js already installed on
the machine.

```bash
npm run desktop   # builds dist/PR Helper Git2.app
```

Double-click the app (or run `open "dist/PR Helper Git2.app"`). The shell:

- resolves Node.js at the common install locations (Homebrew under
  `/opt/homebrew/bin/node`, then `/usr/local/bin/node`) because a GUI-launched
  process inherits a minimal `PATH`;
- spawns the bundled server on an ephemeral port with `GIT2_DESKTOP=1` and
  reads the machine-readable `GIT2_READY {"port","token"}` line;
- points the `WKWebView` at the one-time token URL, which sets the HttpOnly
  cookie, and keeps a persistent website data store so localStorage
  preferences survive restarts;
- terminates the server when the window closes. On shutdown the server closes
  all keep-alive and SSE sockets immediately, and the shell force-kills the
  process after a bounded wait if it does not exit;
- ships a generated `AppIcon.icns` (rendered from `desktop/make-icon.swift`
  and packaged with the system sips/iconutil tools) referenced through
  `CFBundleIconFile`, and remembers the window position and size across
  launches via `setFrameAutosaveName`, centering only on the first run.

The resulting bundle is about 1.2 MB. An unsigned, locally built app may
need a one-time Gatekeeper approval under **System Settings → Privacy &
Security**.

## Security model

- The server binds `127.0.0.1` by default. Setting `GIT2_HOST` to a LAN/Tailscale
  address is an explicit opt-in (see “Mobile / phone view”); in development
  (`GIT2_DEV=1`) a non-loopback bind is refused unless
  `GIT2_ALLOW_INSECURE_DEV_HOST=1` is set, because the dev token is fixed.
  In production it generates a random
  per-process token that is exchanged for an HttpOnly, SameSite=Strict cookie.
  That token is the owner (admin) identity. Member tokens are random 192-bit
  values stored only as SHA-256 hashes in `config.json`; they are accepted
  through the same `?token=` bootstrap URL and can be revoked from the Team
  panel without restarting the server.
- Server-side settings require the owner: storing/removing the server PAT and
  changing/testing the AI endpoint/key are admin-only. A member without their
  own `x-github-pat` never inherits the server-stored PAT. The data directory
  is `0700` and `config.json`/`audit.log` are `0600`.
- Git is invoked with `execFile` and fixed argv arrays — user input is never
  passed to a shell. Repo-relative paths are normalized and checked with
  `realpath` so symlinks cannot escape the repository root.
- Sensitive files (`.env`, `.env.*`, `id_rsa*`, `*.key`, `*.pem`, `*.p12`,
  `*.pfx`) have their diffs masked and are blocked from discard/edit/save as
  well as staging, commit, move, remove, `clean`, untracked stash and AI
  commit-message generation. The path check is independent of the UI.
- GitHub calls go through a method/path allowlist. A PAT can be stored
  server-side (`/api/pat`) and injected into the proxy; the value never
  round-trips to the browser. A request-scoped `x-github-pat` header remains
  supported as a fallback. All write actions are appended to an audit log
  under `~/.pr-helper-git/audit.log`, which is size-bounded by automatic
  rotation.
- The AI key lives in `~/.pr-helper-git/config.json` on the server and is
  never echoed back: the config endpoint returns only `hasKey`, so a compromised
  browser session cannot read the credential. The base URL must be a valid
  http(s) URL without embedded credentials; plain `http://` is accepted only
  for localhost model servers, and a changed base URL clears the stored key.
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
| Desktop | Swift `WKWebView` shell (`desktop/main.swift`), icon rendered by `desktop/make-icon.swift`, bundled by `scripts/desktop-build.mjs` |
| Git | `execFile('git', argv)` with parsers for porcelain v2, log, refs and blame |
| GitHub | REST allowlist proxy plus GraphQL merge/ready endpoints |

```
server/
  main.mjs           HTTP entry, token/cookie auth, static hosting, SSE
  actor.mjs          AsyncLocalStorage request identity for audit attribution
  ai.mjs             AI config, prompt builders and OpenAI-compatible completion
  identity.mjs       owner/member tokens, hashed member store, team config
  security.mjs       path validation, ref validation, token checks
  git.mjs            git runner and pure output parsers
  store.mjs          registry persistence and audit log
  watcher.mjs        recursive file watcher and SSE broadcast hub
  routes-git.mjs     Git API dispatcher: repo guard, AI routes, module fan-out
  routes-git-helpers.mjs  Shared validation, repo brief, sensitive-path and rebase helpers
  routes-git-meta.mjs     Health, audit, storage, repo registry, PAT, users, team endpoints
  routes-git-read.mjs     Read-only history/status/diff/grep/config endpoints
  routes-git-write.mjs    Write dispatcher: worktree, refs, history, files, network, stash
  routes-git-write-worktree.mjs  Stage/commit/checkout/PR checkout/amend
  routes-git-write-refs.mjs      Branch, tag and remote writes
  routes-git-write-history.mjs   Merge, rebase, bisect, reset, cherry-pick, revert
  routes-git-write-files.mjs     Conflict resolve, ignore, mv, rm, save, clean
  routes-git-write-network.mjs   Tag push, fetch, pull, push
  routes-git-write-stash.mjs     Stash create/apply/drop
  routes-github.mjs  GitHub proxy, GraphQL merge/ready, remote URL parsing
src/
  app-state.tsx      central data/state provider
  api.ts             typed API client
  components/        UI components, inline SVG icons, context menu, modals
  hooks/             resize, escape, focus-trap and keyboard interaction hooks
  lib/               graph layout, formatting, file tree, diff, review, fuzzy (pure)
scripts/dev.mjs      parallel Vite + API launcher
scripts/desktop-build.mjs  Vite build + Swift compile into a macOS .app bundle
desktop/main.swift   native WKWebView window and Node process supervision
desktop/make-icon.swift  CoreGraphics icon renderer feeding the .icns build
```

## Checks

```bash
npm test           # Vitest unit + route-level HTTP tests (335 tests, 34 files)
npm run lint       # tsc --noEmit
npm run typecheck:server  # checkJs over server/*.mjs
npm run build      # production build into dist/
npm run e2e        # E2E: real loopback server + curl assertions (144 checks)
```

`npm run desktop` still exists but is frozen with desktop development; it is not
part of the regular check loop.

`npm run e2e` starts the server on port 18774 with `GIT2_DEV=1` (token
`dev-token`) and `PR_HELPER_HOME` pointed at a throwaway directory, so it never
reads or writes `~/.pr-helper-git`. It builds the fixture repositories itself
and covers auth, repository registration, status/log/refs reads, stage → commit
→ undo, hunk/line-precise staging, branch/tag/stash, grep, compare, reverts,
merge conflicts (resolve → commit, abort), interactive rebase (drop, conflict →
abort), push/pull against a bare remote, GitHub proxy guards and the audit
trail. Flat 1:1 with `e2e/run.sh` in
`pr-helper-git`.

The same three steps are configured in the GitHub Actions workflow in
`.github/workflows/ci.yml`. This repository intentionally has no remote, so the
workflow does not run in practice; the local commands above are the source of
truth until a remote is explicitly requested.

The route tests spawn a real server on an ephemeral port against a temporary
Git repository and an isolated `PR_HELPER_HOME`, covering the read/write Git
routes, validation failures, rebase/revert-state detection, conflicted revert
continue/abort, per-file conflict resolution, batch repository pull from a
local origin, the SSE handshake, audit rotation, server-side audit filtering,
team identity (owner/member tokens, revocation, audit attribution, team config
export/import), mtime-based stale-save rejection (including the 413 body cap), cross-repository
`grep-all`, batch revert and the configured commit template. The isolated audit
path is always built from the server's home directory so tests can never touch
the real audit log, and an isolated `GIT_CONFIG_GLOBAL` keeps machine-wide
settings such as a global `commit.template` out of the assertions.
Component tests render key React components with `react-dom/server`
(`renderToString`) against a mock app context, covering empty states,
masked/binary handling, the conflict panel and the toolbar and audit modal.

All checks are run with zero third-party runtime dependencies; the test and
build tooling is the only dev dependency set.
