// Shadow-period data sync (D-018, P5-1 infrastructure): mirrors the live
// cloud pr-helper Supabase data into the local Postgres so the local engine's
// shadow observations compare against the same inputs the cloud acts on.
//
// Direction: Supabase (read-only, owner's db.env credentials) → local PG.
// Strategy: TRUNCATE the mirror tables, then bulk-insert the cloud rows inside
// one transaction — a full rebuild keeps the local side a faithful mirror for
// the shadow period while a failed insert rolls back instead of leaving a
// half-empty mirror.
//
// Local-only extras: migration 048 added `workflow_stages.auto_advance`, which
// the cloud schema does not have. The sync snapshots that column before the
// rebuild and restores it afterwards, so D-015 settings survive a mirror sync.
// A few tables carry local-only encrypted/preference state (AI credentials are
// encrypted with the local AI_CREDENTIALS_ENCRYPTION_KEY; encrypted sync and
// push subscriptions are local state): those tables are also snapshotted and
// restored rather than replaced with cloud ciphertext the local process cannot
// decrypt.
//
// Credentials: ~/.config/pr-helper/db.env (DATABASE_URL → Supabase readonly
// role). Local: PR_HELPER_GIT_DATABASE_URL or the OrbStack default.
// Values are never printed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const TABLES = [
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
  'pr_helper_ai_automation_credentials',
  'pr_helper_push_subscriptions',
  'pr_helper_notification_deliveries',
  'pr_helper_encrypted_sync',
  'pr_helper_encrypted_sync_history',
  'reconciliation_leases',
  'data_retention_runs',
  'reconciliation_runs',
];

// Telemetry/delivery logs are not shadow-comparison inputs. They are large
// (reconciliation_runs was 59k rows at the 2026-11-14 snapshot; webhook
// deliveries 26k) and would make a daily sync take hours over the read-only
// pooler. Core daily sync covers the workflow/automation/audit mirror; use
// `--full` for an explicit one-off full copy.
const TELEMETRY_TABLES = new Set([
  'github_webhook_deliveries',
  'pr_helper_notification_deliveries',
  'data_retention_runs',
  'reconciliation_runs',
]);

const FULL_SYNC = process.argv.includes('--full');
const SNAPSHOT_SYNC = process.argv.includes('--snapshot');
const SNAPSHOT_FILE = process.env.PR_HELPER_GIT_SHADOW_SNAPSHOT
  || `${process.env.HOME}/000mycodes-backups/pr-helper-git/supabase-export-20261113.json`;
const SYNC_TABLES = FULL_SYNC ? TABLES : TABLES.filter((table) => !TELEMETRY_TABLES.has(table));

// Keep local-owned encrypted/preference rows out of the cloud overwrite.
const PRESERVE_LOCAL_TABLES = [
  'pr_helper_ai_automation_credentials',
  'pr_helper_encrypted_sync',
  'pr_helper_encrypted_sync_history',
  'pr_helper_push_subscriptions',
];

// Keep each INSERT well under PostgreSQL's parameter limit. Large tables
// (workflow_automation_actions, events) otherwise produce one oversized
// statement that can fail with "too many parameters".
const INSERT_CHUNK_SIZE = 500;

/**
 * Explicit-id inserts (snapshot import or delta) do not advance a table's
 * serial sequence. Without this reset the next engine write reuses an id and
 * fails with a duplicate-key error — for example the audit row written by a
 * workflow PUT. Only tables that actually have a serial `id` are touched.
 */
async function resetSequences(tx, tables) {
  const reset = [];
  for (const table of tables) {
    // Some mirror tables use a composite key and have no id column at all
    // (workflow_stages is the canonical case); asking pg_get_serial_sequence
    // for a missing column is an error, not a null result.
    const hasId = await tx`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'id'`;
    if (!hasId.length) continue;
    const seq = await tx`SELECT pg_get_serial_sequence(${'public.' + table}, 'id') AS seq`;
    if (!seq[0]?.seq) continue;
    const max = await tx`SELECT max(id)::text AS max FROM ${tx(table)}`;
    if (!max[0]?.max) continue;
    await tx`SELECT setval(${seq[0].seq}, ${max[0].max}, true)`;
    reset.push(table);
  }
  return reset;
}
// Cloud reads are paged too: a single `SELECT *` over the large audit/action
// tables can take minutes and exceed the runner's subprocess timeout. 500
// rows per page keeps every round-trip bounded; the shadow source is
// effectively read-only during a sync, so offset paging is sufficient here.
const CLOUD_PAGE_SIZE = 500;

function readDbEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*)"?$/);
    if (m && m[2] && m[2] !== '[SENSITIVE]') out[m[1]] = m[2];
  }
  return out;
}

const dbEnv = readDbEnv(`${process.env.HOME}/.config/pr-helper/db.env`);
const cloudUrl = dbEnv.DATABASE_URL;
if (!cloudUrl) {
  console.error('shadow-sync: no DATABASE_URL in ~/.config/pr-helper/db.env');
  process.exit(1);
}
const cloud = parseCloudUrl(cloudUrl);
const localUrl = process.env.PR_HELPER_GIT_DATABASE_URL
  || 'postgres://postgres:localdev@127.0.0.1:54329/pr_helper';

// --only=t1,t2 limits the run to a subset (session pooler queries on large
// tables can take minutes; partial syncs let the core mirror stay fresh).
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlySet = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

const local = postgres(localUrl, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });

function parseCloudUrl(url) {
  const body = url.replace(/^postgres(ql)?:\/\//, '');
  const at = body.lastIndexOf('@');
  if (at < 0) throw new Error('shadow-sync: DATABASE_URL is not a postgres URL');
  const credentials = body.slice(0, at);
  const user = credentials.split(':')[0];
  const password = credentials.slice(user.length + 1);
  const [hostPort, rawDatabase] = body.slice(at + 1).split('/');
  const [host, port] = hostPort.split(':');
  return {
    host,
    port: port || '5432',
    database: (rawDatabase || 'postgres').split('?')[0],
    user,
    password,
  };
}

/**
 * Cloud reads go through the owner's verified readonly runner
 * (~/.local/bin/prh-sql.mjs) as a subprocess: the session pooler is flaky
 * under long-lived in-process connections (P0-3 lesson), and this runner's
 * hand-split URL parsing + connection options are battle-tested.
 */
function readCloudTable(table, attempt = 1) {
  const prhSql = `${process.env.HOME}/.local/bin/prh-sql.mjs`;
  const rows = [];

  try {
    for (let offset = 0; ; offset += CLOUD_PAGE_SIZE) {
      const query = `SELECT * FROM ${table} ORDER BY 1 LIMIT ${CLOUD_PAGE_SIZE} OFFSET ${offset}`;
      const out = execFileSync('node', [prhSql, query], {
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 256 * 1024 * 1024,
      });
      const page = JSON.parse(out);
      rows.push(...page);
      if (page.length < CLOUD_PAGE_SIZE) break;
    }
    return rows;
  } catch (err) {
    // Supabase's pooler occasionally stalls or closes a page connection. One
    // bounded retry is enough; the whole sync is still all-or-nothing because
    // the local rebuild starts only after every table has been fetched.
    if (attempt < 3) {
      execFileSync('sleep', ['3']);
      return readCloudTable(table, attempt + 1);
    }
    throw err;
  }
}

function readCloudTableSince(table, minId, attempt = 1) {
  const prhSql = `${process.env.HOME}/.local/bin/prh-sql.mjs`;
  const rows = [];
  try {
    for (let offset = 0; ; offset += CLOUD_PAGE_SIZE) {
      const query = `SELECT * FROM ${table} WHERE id > ${Number(minId)} ORDER BY 1 LIMIT ${CLOUD_PAGE_SIZE} OFFSET ${offset}`;
      const out = execFileSync('node', [prhSql, query], {
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 256 * 1024 * 1024,
      });
      const page = JSON.parse(out);
      rows.push(...page);
      if (page.length < CLOUD_PAGE_SIZE) break;
    }
    return rows;
  } catch (err) {
    // Same pooler-stall retry as readCloudTable: the top-up must not kill an
    // otherwise-complete sync; the local rebuild still starts only after
    // every read has landed.
    if (attempt < 3) {
      execFileSync('sleep', ['3']);
      return readCloudTableSince(table, minId, attempt + 1);
    }
    throw err;
  }
}

const counts = [];

try {
  const skipped = TABLES.filter((table) => !SYNC_TABLES.includes(table));
  console.error(`shadow-sync: ${FULL_SYNC ? 'full' : 'core'} mode (${SYNC_TABLES.length}/${TABLES.length} tables)`);
  if (skipped.length) console.error(`  skipped telemetry: ${skipped.join(', ')}`);

  // Read EVERYTHING from the source first; only when all tables are fetched
  // does the local rebuild run — a read failure leaves the local mirror
  // untouched.
  let cloudRows;
  if (SNAPSHOT_SYNC) {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
    if (!snapshot?.tables || typeof snapshot.tables !== 'object') {
      throw new Error(`shadow-sync: invalid snapshot ${SNAPSHOT_FILE}`);
    }
    cloudRows = {};
    for (const table of SYNC_TABLES) {
      cloudRows[table] = Array.isArray(snapshot.tables[table]) ? snapshot.tables[table] : [];
    }
    const total = SYNC_TABLES.reduce((sum, table) => sum + cloudRows[table].length, 0);
    console.error(`  snapshot ${SNAPSHOT_FILE} (${snapshot.exportedAt || 'unknown time'}): ${SYNC_TABLES.length} tables / ${total} rows`);
    if (Array.isArray(snapshot.failed) && snapshot.failed.length) {
      console.error(`  snapshot failed tables (ignored by core sync): ${snapshot.failed.join(', ')}`);
    }
  } else {
    cloudRows = {};
    for (const table of SYNC_TABLES) {
      const t0 = Date.now();
      cloudRows[table] = readCloudTable(table);
      console.error(`  read ${table}: ${cloudRows[table].length} rows (${Date.now() - t0}ms)`);
    }
  }

  // automation_actions are read after automation_runs, so a run created while
  // the sync is in flight can be referenced by an action but absent from the
  // earlier runs page. Top up only the new run ids; this is a few rows, not a
  // second full read of the 3.6k-row table.
  const automationRuns = cloudRows.workflow_automation_runs || [];
  if (!SNAPSHOT_SYNC && automationRuns.length) {
    const maxRunId = Math.max(...automationRuns.map((row) => Number(row.id) || 0));
    const newerRuns = readCloudTableSince('workflow_automation_runs', maxRunId);
    if (newerRuns.length) {
      cloudRows.workflow_automation_runs.push(...newerRuns);
      console.error(`  workflow_automation_runs: topped up ${newerRuns.length} new rows (id > ${maxRunId})`);
    }
  }

  // If the cloud deleted a parent between paginated reads (or a snapshot
  // predates a run), keep the mirror referentially valid rather than aborting
  // the whole rebuild: drop the few child rows whose parent is absent and log
  // them. The next sync picks the pair up once the cloud is consistent.
  const runIds = new Set((cloudRows.workflow_automation_runs || []).map((row) => String(row.id)));
  const actionRows = cloudRows.workflow_automation_actions || [];
  const orphanActions = actionRows.filter((row) => !runIds.has(String(row.run_id)));
  if (orphanActions.length) {
    cloudRows.workflow_automation_actions = actionRows.filter((row) => runIds.has(String(row.run_id)));
    console.error(`  workflow_automation_actions: dropped ${orphanActions.length} rows with missing run`);
  }

  // Early reads used unordered LIMIT/OFFSET pages, so a scan could return the
  // same row on two pages; explicit-id inserts then failed the local primary
  // key. Drop exact duplicates before the rebuild, and log how many were seen.
  for (const table of SYNC_TABLES) {
    const rows = cloudRows[table];
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
      const key = Object.prototype.hasOwnProperty.call(row, 'id') ? `id:${row.id}` : JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
    if (unique.length !== rows.length) {
      console.error(`  ${table}: dropped ${rows.length - unique.length} duplicate rows`);
      cloudRows[table] = unique;
    }
  }

  // Keep the freshly fetched rows so a local-schema/insert problem can be
  // retried with `--snapshot` without another 15-minute cloud read. The file
  // contains mirror data, so it is written owner-only and never printed.
  const latestSnapshot = `${process.env.HOME}/.pr-helper-git/shadow-latest.json`;
  writeFileSync(latestSnapshot, JSON.stringify({ exportedAt: new Date().toISOString(), tables: cloudRows }), { encoding: 'utf8', mode: 0o600 });
  console.error(`  wrote ${latestSnapshot}`);

  // One transaction for the whole rebuild: either the mirror is fully
  // replaced or the previous mirror survives. The auto_advance snapshot is
  // taken before truncation and restored after insertion.
  const localAdvance = await local.begin(async (tx) => {
    const savedAdvance = await tx`
      SELECT user_id, workflow_id, stage_id, auto_advance
      FROM workflow_stages
      WHERE auto_advance IS NOT NULL`;

    const savedLocalTables = {};
    for (const table of PRESERVE_LOCAL_TABLES) {
      savedLocalTables[table] = await tx`SELECT * FROM ${tx(table)}`;
    }

    for (const table of SYNC_TABLES) {
      await tx`TRUNCATE TABLE ${tx(table)} CASCADE`;
    }

    // Local schema has deliberately diverged from the cloud schema (for
    // example workflow_stages keeps a composite key and dropped the cloud
    // id column). Project cloud rows onto the local column set so a full
    // mirror can still be rebuilt without inventing local-only values.
    const localColumns = await tx`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`;
    const allowedByTable = new Map();
    for (const { table_name, column_name } of localColumns) {
      if (!allowedByTable.has(table_name)) allowedByTable.set(table_name, new Set());
      allowedByTable.get(table_name).add(column_name);
    }

    for (const table of SYNC_TABLES) {
      const allowed = allowedByTable.get(table);
      if (!allowed || allowed.size === 0) throw new Error(`shadow-sync: local table ${table} has no columns`);
      const dropped = new Set();
      const rows = cloudRows[table].map((row) => {
        const filtered = {};
        for (const [key, value] of Object.entries(row)) {
          if (allowed.has(key)) filtered[key] = value;
          else dropped.add(key);
        }
        return filtered;
      });
      if (dropped.size) console.error(`  ${table}: dropped cloud-only columns ${[...dropped].join(', ')}`);
      for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
        await tx`INSERT INTO ${tx(table)} ${tx(chunk)}`;
      }
    }

    // Put local-owned state back, replacing whatever cloud rows occupied these
    // tables (including the empty-local-state case).
    for (const table of PRESERVE_LOCAL_TABLES) {
      await tx`DELETE FROM ${tx(table)}`;
      const rows = savedLocalTables[table];
      for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
        await tx`INSERT INTO ${tx(table)} ${tx(chunk)}`;
      }
    }

    for (const row of savedAdvance) {
      await tx`
        UPDATE workflow_stages
        SET auto_advance = ${row.auto_advance}
        WHERE user_id = ${row.user_id}
          AND workflow_id = ${row.workflow_id}
          AND stage_id = ${row.stage_id}`;
    }

    const sequences = await resetSequences(tx, SYNC_TABLES);

    return {
      savedAdvance: savedAdvance.length,
      sequences,
      preserved: Object.fromEntries(PRESERVE_LOCAL_TABLES.map((table) => [table, savedLocalTables[table].length])),
    };
  });

  for (const table of SYNC_TABLES) {
    counts.push(`${table}=${cloudRows[table].length} (source)`);
  }

  console.error(`shadow-sync ${new Date().toISOString()}`);
  console.error(counts.join('\n'));
  console.error(`preserved workflow_stages.auto_advance rows: ${localAdvance.savedAdvance}`);
  console.error(`preserved local-state tables: ${JSON.stringify(localAdvance.preserved)}`);
  console.error(`reset sequences: ${localAdvance.sequences.join(', ') || 'none'}`);
  console.error('shadow-sync: mirror updated');
} catch (err) {
  console.error(`shadow-sync failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await local.end({ timeout: 0 }).catch(() => undefined);
}
