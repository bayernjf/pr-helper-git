// Migration discipline check (P1-6, ledger docs/pr-helper-migration.md §5):
// verifies the local OrbStack Postgres schema still matches the pinned
// pr-helper Supabase migration baseline (docs/archive/pr-helper-source/
// supabase/migrations/*.sql).
//
// The original pr-helper repo had no tools/check-migrations.sh (P1-6's source
// premise was wrong — re-scoped as a fresh implementation). This script:
//   1. Walks the pinned migration files in lexical order, tracking the set of
//      tables a faithful replay would leave behind (CREATE TABLE / DROP TABLE).
//   2. Reads the actual public-schema tables from the local database.
//   3. Reports missing / unexpected tables, plus row counts for the core
//      business tables.
//
// Usage: npm run check:migrations
// Env: PR_HELPER_GIT_DATABASE_URL (defaults to the local OrbStack instance).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = new URL('../../docs/archive/pr-helper-source/supabase/migrations/', import.meta.url).pathname;
const url = process.env.PR_HELPER_GIT_DATABASE_URL
  || 'postgres://postgres:localdev@127.0.0.1:54329/pr_helper';

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error(`check-migrations: no migration files found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

// A faithful replay of the pinned files, in order, leaves exactly this set of
// tables. Only CREATE TABLE / DROP TABLE / CREATE SCHEMA statements matter.
const expected = new Set();
let created = 0;
let dropped = 0;
for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_.]+)/gi)) {
    const name = m[1].replace(/^[a-zA-Z0-9_]+\./, '');
    if (!expected.has(name)) created += 1;
    expected.add(name);
  }
  for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-zA-Z0-9_.]+)/gi)) {
    const name = m[1].replace(/^[a-zA-Z0-9_]+\./, '');
    if (expected.delete(name)) dropped += 1;
  }
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
let actual;
try {
  actual = new Set((await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((r) => r.tablename));
} catch (err) {
  console.error(`check-migrations: cannot reach database (${url}): ${err.message}`);
  await sql.end({ timeout: 0 });
  process.exit(1);
}

const missing = [...expected].filter((t) => !actual.has(t)).sort();
const unexpected = [...actual].filter((t) => !expected.has(t) && !t.startsWith('_')).sort();

let failures = 0;
if (missing.length) {
  failures += missing.length;
  console.error(`MISSING (${missing.length}): ${missing.join(', ')}`);
}
if (unexpected.length) {
  console.error(`UNEXPECTED in DB, not in migrations (${unexpected.length}): ${unexpected.join(', ')}`);
}

// Row counts for the core business tables (0 is legal — e.g. on a fresh
// replay without data import — but the table must exist and be readable).
const CORE = [
  'pr_helper_users', 'pr_helper_workflows', 'workflow_stages', 'workflow_stage_states',
  'workflow_automation_actions', 'workflow_operation_audit_logs', 'github_webhook_deliveries',
];
const counts = [];
for (const table of CORE) {
  if (!actual.has(table)) continue;
  const [row] = await sql.unsafe(`SELECT count(*)::int AS n FROM "${table}"`);
  counts.push(`${table}=${row.n}`);
}

await sql.end({ timeout: 0 });
console.error(`migrations parsed: ${files.length} files, ${created} tables created, ${dropped} dropped`);
console.error(`schema: expected ${expected.size} tables, actual ${actual.size}`);
console.error(`core rows: ${counts.join(', ') || '(none)'}`);

if (failures > 0) {
  console.error(`check:migrations FAILED — ${failures} expected table(s) missing from local PG`);
  process.exit(1);
}
console.error('check:migrations OK — local schema covers the pinned migration baseline');
