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
import { readFileSync } from 'node:fs';
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
 * Fast path: the local OrbStack Postgres container ships a psql client. One
 * session can export every core table as a single json_agg row, avoiding the
 * read-only runner's per-table/per-page connection setup (which dominates a
 * full sync). The password is passed through the Docker client environment,
 * never on the command line; values are never printed.
 */
function readCloudTablesViaPsql(tables, attempt = 1) {
  const container = process.env.PR_HELPER_GIT_PSQL_CONTAINER || 'pr-helper-pg';
  const hostaddr = process.env.PR_HELPER_GIT_CLOUD_HOSTADDR;
  const conninfo = [
    `host=${cloud.host}`,
    `port=${cloud.port}`,
    `dbname=${cloud.database}`,
    `user=${cloud.user}`,
    ...(hostaddr ? [`hostaddr=${hostaddr}`] : []),
    'sslmode=require',
  ].join(' ');
  const args = [
    'exec', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE', container,
    'psql', conninfo, '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ];
  for (const table of tables) {
    args.push('-c', `SELECT '__TABLE__${table}'`);
    args.push('-c', `SELECT coalesce(json_agg(t), '[]'::json) FROM ${table} t`);
  }
  try {
    const out = execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: cloud.password, PGSSLMODE: 'require' },
    });

    const parsed = {};
    let current = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('__TABLE__')) {
        current = line.slice('__TABLE__'.length);
        parsed[current] = [];
        continue;
      }
      if (!current || line.trim() === '') continue;
      const rows = JSON.parse(line);
      if (!Array.isArray(rows)) throw new Error(`shadow-sync: unexpected payload for ${current}`);
      parsed[current] = rows;
    }
    for (const table of tables) {
      if (!parsed[table]) throw new Error(`shadow-sync: psql export missing ${table}`);
    }
    return parsed;
  } catch (err) {
    // The Supabase pooler rate-limits new clients after a burst of runner
    // connections. A short backoff and a fresh session usually succeeds; if
    // all attempts fail the caller falls back to the paged runner.
    if (attempt < 3) {
      execFileSync('sleep', [String(10 * attempt)]);
      return readCloudTablesViaPsql(tables, attempt + 1);
    }
    throw err;
  }
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
      const query = `SELECT * FROM ${table} LIMIT ${CLOUD_PAGE_SIZE} OFFSET ${offset}`;
      const out = execFileSync('node', [prhSql, query], {
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 256 * 1024 * 1024,
      });
      const page = JSON.parse(out);
      rows.push(...page);
      if (page.length < CLOUD_PAGE_SIZE) break;
    }
    return rows;
  } catch (err) {
    // Supabase's pooler occasionally stalls on a page. One bounded retry is
    // enough; the whole sync is still all-or-nothing because the local rebuild
    // starts only after every table has been fetched.
    if (attempt < 2 && (err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM')) {
      execFileSync('sleep', ['3']);
      return readCloudTable(table, attempt + 1);
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
    try {
      const t0 = Date.now();
      cloudRows = readCloudTablesViaPsql(SYNC_TABLES);
      const total = SYNC_TABLES.reduce((sum, table) => sum + cloudRows[table].length, 0);
      console.error(`  psql fast path: ${SYNC_TABLES.length} tables / ${total} rows (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error('  psql fast path unavailable after retries; falling back to per-table runner');
      cloudRows = {};
      for (const table of SYNC_TABLES) {
        const t0 = Date.now();
        cloudRows[table] = readCloudTable(table);
        console.error(`  read ${table}: ${cloudRows[table].length} rows (${Date.now() - t0}ms)`);
      }
    }
  }

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

    for (const table of SYNC_TABLES) {
      const rows = cloudRows[table];
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
