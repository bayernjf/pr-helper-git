# Documentation map

Start with the document that matches your question. Do not read all of
`handoff.md` first; it is a chronological ledger, not a tutorial.

## Read by role

| You are... | Start here |
|---|---|
| New to the product | [`README.md`](../README.md) — features, setup, security, architecture, checks |
| About to change code | [`CONTRIBUTING.md`](../CONTRIBUTING.md) — branch, commit, PR, gates, release |
| An AI agent | [`AGENTS.md`](../AGENTS.md) — hard constraints and required workflow |
| Looking for current release state | [`CHANGELOG.md`](../CHANGELOG.md) and the top of [`handoff.md`](../handoff.md) |
| Looking for why a decision was made | [`handoff.md`](../handoff.md) — delivery notes, lessons, historical batches |
| Looking for parity history with the archived product | [`parity-archive.md`](parity-archive.md) |
| Looking for E2E fixture repositories | [`test-repos.md`](../test-repos.md) |

## Documents

| File | What it is | When to update |
|---|---|---|
| `README.md` | User-facing overview: features, quick start, security model, architecture, checks | Behaviour, setup, security, or gates change |
| `CONTRIBUTING.md` | Human/agent development workflow: setup, branches, commits, PRs, release, docs, backups | Process changes |
| `AGENTS.md` | Hard contract for AI agents: scope, non-negotiables, commands, release checklist, baseline | Agent constraints or baseline change |
| `CHANGELOG.md` | Keep a Changelog release notes, newest first | Every release; user-visible changes |
| `handoff.md` | Chronological delivery ledger: per-release scope, migrations, lessons, historical batches | Release, migration, major refactor, or durable lesson |
| `docs/parity-archive.md` | Record of cross-repo parity work with the archived product | Parity work changes |
| `docs/archive/` | Frozen historical material; do not append new decisions here | Only when archiving |
| `test-repos.md` | Local fixture repositories used by E2E | Fixture path or URL changes |
| `design/tokens.css` | Design token source for themes and accents | Visual token changes |

## Source-of-truth rules

- **Current behaviour**: code plus `README.md`. If they disagree, the code
  wins and the README is stale.
- **Current release**: `package.json` version, `CHANGELOG.md` section, and the
  newest annotated tag should agree.
- **History and rationale**: `handoff.md`. Treat old numbers there as a record
  of that moment, not as the current baseline.
- **Process**: `AGENTS.md` and `CONTRIBUTING.md`. If a workflow changes, update
  these first, then the docs that reference them.
- **Do not** create a second competing roadmap or status file. Put release
  state in `CHANGELOG.md`, chronology in `handoff.md`, and durable reference
  material under `docs/`.

## Maintenance checklist

When you change something, ask:

1. Does `README.md` still describe the behaviour accurately?
2. Does `CHANGELOG.md` need an entry?
3. Does `handoff.md` need a release or delivery note?
4. Did the test baseline change (unit count, E2E count)?
5. Did a process or agent constraint change?
6. Is there a new long-lived reference that needs an entry in this file?

Keep links relative and verify they resolve before committing.
