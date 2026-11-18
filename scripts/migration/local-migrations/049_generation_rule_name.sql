-- Local-only migration 049 (2026-11-19): named generation rules.
--
-- The cloud pr_helper_generation_rules table stores only content_hash +
-- content (rule names lived in the original client's localStorage). The
-- rules manager dialog needs server-side names, so this local-only column
-- carries them (same local-increment protocol as 048).

ALTER TABLE pr_helper_generation_rules ADD COLUMN IF NOT EXISTS name text;
