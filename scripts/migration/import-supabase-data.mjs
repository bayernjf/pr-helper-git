// One-time migration data import: reads the Supabase export JSON
// (000mycodes-backups/pr-helper-git/supabase-export-*.json) and writes every
// table into the local Postgres created by the 47-migration replay.
//
// Usage: node scripts/migration/import-supabase-data.mjs <export.json>
//
// Column types are read from information_schema, so jsonb/object/array values
// are encoded correctly and scalar columns stay scalars. Tables are inserted
// in FK-safe order (users -> workflows -> children). Failures are recorded
// per table and reported at the end; a failed table leaves the database
// untouched for that table (INSERTs are single-statement).
//
// This script is part of the pr-helper migration ledger
// (docs/pr-helper-migration.md, task P1-3). It is idempotent per run only
// when the target tables are empty — do not re-run on populated tables.

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const [exportPath] = process.argv.slice(2);
if (!exportPath) {
  console.error('usage: node scripts/migration/import-supabase-data.mjs <export.json>');
  process.exit(1);
}
const data = JSON.parse(readFileSync(exportPath, 'utf8'));

const url = process.env.PR_HELPER_GIT_DATABASE_URL || 'postgres://postgres:localdev@127.0.0.1:54329/pr_helper';
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });

// FK-safe insert order (parents before children); anything not listed goes last.
const ORDER = [
  'pr_helper_users',
  'pr_helper_workflows',
  'workflow_stages',
  'workflow_deployment_configs',
  'workflow_stage_states',
  'workflow_stage_events',
  'workflow_stage_deployments',
  'workflow_stage_deployment_runs',
  'workflow_versions',
  'workflow_runs',
  'workflow_automation_runs',
  'workflow_automation_actions',
  'pr_helper_generation_rules',
  'workflow_operation_audit_logs',
  'github_webhook_deliveries',
  'pr_helper_teams',
  'pr_helper_team_members',
  'pr_helper_team_workflows',
  'pr_helper_push_subscriptions',
  'pr_helper_notification_deliveries',
  'pr_helper_encrypted_sync',
  'pr_helper_encrypted_sync_history',
  'reconciliation_leases',
  'data_retention_runs',
  'reconciliation_runs',
];

const tables = Object.keys(data.tables);
const ordered = [
  ...ORDER.filter((t) => tables.includes(t)),
  ...tables.filter((t) => !ORDER.includes(t)),
];

const types = {};
for (const t of ordered) {
  const cols = await sql.unsafe(
    `select column_name, data_type from information_schema.columns where table_name = $1 and table_schema = 'public'`,
    [t],
  );
  types[t] = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
}

const results = [];
const failed = [];
for (const t of ordered) {
  const rows = data.tables[t];
  if (!rows || rows.length === 0) {
    console.error(`  ${t}: 0 rows (skip)`);
    continue;
  }
  try {
    for (const row of rows) {
      const cols = Object.keys(row).filter((k) => k in types[t]);
      const values = cols.map((k) => {
        const v = row[k];
        if (types[t][k] === 'jsonb' && (v && typeof v === 'object')) return JSON.stringify(v);
        if (types[t][k] === 'jsonb' && typeof v === 'string' && v.trim().startsWith('{')) return v;
        return v;
      });
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');
      await sql.unsafe(`insert into "${t}" (${colList}) values (${placeholders})`, values);
    }
    console.error(`  ${t}: ${rows.length} inserted`);
    results.push(`${t}: ${rows.length}`);
  } catch (err) {
    failed.push(`${t}: ${err.message}`);
    console.error(`  ${t} FAILED: ${err.message}`);
  }
}

await sql.end({ timeout: 0 });
console.error(`IMPORT DONE: ${results.length} tables ok, ${failed.length} failed`);
if (failed.length) {
  console.error(failed.join('\n'));
  process.exit(1);
}
