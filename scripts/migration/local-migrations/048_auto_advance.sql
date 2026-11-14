-- Local-only migration 048 (2026-11-14): persist the stage auto-advance flag.
--
-- Fixes a legacy pr-helper gap carried over by the faithful schema replay:
-- the cloud Supabase schema (all 47 migrations) has no auto_advance column,
-- so the 'auto-advance after merge' toggle never persisted (confirmed live —
-- the toggle drops on refresh). The local engine's setStageAutoAdvance and
-- the Phase 3 editor fully support the flag; this column gives it storage.
--
-- Registry impact: none (table set unchanged, column-level addition).
-- Recorded in docs/pr-helper-migration.md as D-015.

ALTER TABLE workflow_stages ADD COLUMN IF NOT EXISTS auto_advance boolean;
