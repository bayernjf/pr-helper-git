// Route-level HTTP tests. A real server is spawned against an isolated
// PR_HELPER_HOME and a temporary Git repository, so the tests exercise the
// full stack: HTTP parsing, validation, git invocation and JSON responses.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_KEEP_ENTRIES, AUDIT_ROTATE_BYTES } from './store.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverPath = path.join(projectRoot, 'server', 'main.mjs');

let tmpRoot;
let homeDir;
let repoDir;
let rebaseDir;
let serverProc;
let port;

function git(args, cwd, allowFailure = false) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  } catch (err) {
    if (allowFailure) return err.stdout || '';
    throw err;
  }
}

function writeFile(rel, content) {
  return fsp.writeFile(path.join(repoDir, rel), content, 'utf8');
}

beforeAll(async () => {
  tmpRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-routes-')));
  homeDir = path.join(tmpRoot, 'home');
  repoDir = path.join(tmpRoot, 'repo');
  rebaseDir = path.join(tmpRoot, 'rebase-repo');
  await fsp.mkdir(homeDir);
  await fsp.mkdir(repoDir);

  // Isolate global Git config so a machine-wide `commit.template` (or other
  // user settings) cannot leak into these assertions. Both the direct git
  // calls below and the spawned server inherit this environment.
  const globalConfig = path.join(tmpRoot, 'global.gitconfig');
  await fsp.writeFile(globalConfig, '', 'utf8');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;

  git(['init', '-b', 'main'], repoDir);
  git(['config', 'user.email', 'tester@example.com'], repoDir);
  git(['config', 'user.name', 'Tester'], repoDir);

  await writeFile('a.txt', 'alpha line\n');
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'initial commit'], repoDir);

  await writeFile('b.txt', 'bravo\n');
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'add b file'], repoDir);

  await fsp.mkdir(path.join(repoDir, 'src'));
  await writeFile('src/index.js', "console.log('start')\n");
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'add index'], repoDir);

  git(['checkout', '-b', 'feature'], repoDir);
  await writeFile('feature.txt', 'feature work content\n');
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'feature work'], repoDir);

  git(['checkout', 'main'], repoDir);
  git(['merge', '--no-ff', '--no-edit', 'feature'], repoDir);
  git(['tag', 'v1'], repoDir);

  // A second repository used to verify rebase state detection. Both branches
  // edit the same line so the rebase stops with a conflict.
  await fsp.mkdir(rebaseDir);
  git(['init', '-b', 'main'], rebaseDir);
  git(['config', 'user.email', 'tester@example.com'], rebaseDir);
  git(['config', 'user.name', 'Tester'], rebaseDir);
  await fsp.writeFile(path.join(rebaseDir, 'conflict.txt'), 'base\n', 'utf8');
  git(['add', '.'], rebaseDir);
  git(['commit', '-m', 'base commit'], rebaseDir);
  git(['checkout', '-b', 'side'], rebaseDir);
  await fsp.writeFile(path.join(rebaseDir, 'conflict.txt'), 'side change\n', 'utf8');
  git(['add', '.'], rebaseDir);
  git(['commit', '-m', 'side change'], rebaseDir);
  git(['checkout', 'main'], rebaseDir);
  await fsp.writeFile(path.join(rebaseDir, 'conflict.txt'), 'main change\n', 'utf8');
  git(['add', '.'], rebaseDir);
  git(['commit', '-m', 'main change'], rebaseDir);
  git(['rebase', 'side'], rebaseDir, true);

  await new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [serverPath, '--port=0'], {
      env: { ...process.env, GIT2_DEV: '1', PR_HELPER_HOME: homeDir },
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 15_000);
    serverProc.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const m = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        port = Number(m[1]);
        resolve();
      }
    });
    serverProc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  });
}, 60_000);

afterAll(async () => {
  if (serverProc) serverProc.kill('SIGTERM');
  // Retry cleanup: on a heavily loaded machine a child can still release a
  // file when the recursive removal reaches its directory (ENOTEMPTY).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
      return;
    } catch (err) {
      if (err.code !== 'ENOTEMPTY' || attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

async function api(reqPath, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${reqPath}`, {
    headers: {
      'x-git2-token': 'dev-token',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...options,
  });
  let json = null;
  try {
    json = await res.json();
  } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const get = (p) => api(p);
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });
const q = (p) => encodeURIComponent(p);

describe('health and registry', () => {
  it('reports health', async () => {
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it('starts with an empty registry', async () => {
    const r = await get('/api/repos');
    expect(r.status).toBe(200);
    expect(r.json.repos).toEqual([]);
  });

  it('rejects an unregistered repository', async () => {
    const r = await get(`/api/status?repo=${q(repoDir)}`);
    expect(r.status).toBe(403);
  });

  it('registers a repository', async () => {
    const r = await post('/api/repos/add', { repo: repoDir });
    expect(r.status).toBe(200);
    expect(r.json.repos).toContain(repoDir);
  });

  it('rejects a folder without .git', async () => {
    const r = await post('/api/repos/add', { repo: homeDir });
    expect(r.status).toBe(400);
  });
});

describe('read routes', () => {
  it('returns clean status with idle operation state', async () => {
    const r = await get(`/api/status?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    expect(r.json.status.branch).toBe('main');
    expect(r.json.status.files).toEqual([]);
    expect(r.json.state.mergeInProgress).toBe(false);
    expect(r.json.state.rebaseInProgress).toBe(false);
  });

  it('lists the full commit history', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    expect(r.json.commits.length).toBeGreaterThanOrEqual(5);
    expect(r.json.commits[0].subject).toBe('Merge branch \'feature\'');
  });

  it('filters history by message', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}&message=${q('feature work')}`);
    expect(r.status).toBe(200);
    expect(r.json.commits).toHaveLength(1);
    expect(r.json.commits[0].subject).toBe('feature work');
  });

  it('filters history by author', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}&author=${q('Tester')}`);
    expect(r.status).toBe(200);
    expect(r.json.commits.length).toBeGreaterThanOrEqual(5);
  });

  it('filters history by date range', async () => {
    const future = await get(`/api/log?repo=${q(repoDir)}&since=${q('2030-01-01')}`);
    expect(future.json.commits).toHaveLength(0);
    const all = await get(`/api/log?repo=${q(repoDir)}&until=${q('2030-01-01')}`);
    expect(all.json.commits.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects malformed date filters', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}&since=${q('last week')}`);
    expect(r.status).toBe(400);
  });

  it('lists refs including branches and tags', async () => {
    const r = await get(`/api/refs?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    const names = r.json.refs.map((x) => x.name);
    expect(names).toContain('refs/heads/main');
    expect(names).toContain('refs/tags/v1');
  });

  it('diffs a modified tracked file', async () => {
    await fsp.writeFile(path.join(repoDir, 'a.txt'), 'alpha line\nsecond line\n', 'utf8');
    const r = await get(`/api/diff?repo=${q(repoDir)}&file=${q('a.txt')}`);
    expect(r.status).toBe(200);
    expect(r.json.untracked).toBe(false);
    expect(r.json.diff).toContain('+second line');
  });

  it('diffs an untracked file against /dev/null', async () => {
    await fsp.writeFile(path.join(repoDir, 'new.txt'), 'brand new file\n', 'utf8');
    const r = await get(`/api/diff?repo=${q(repoDir)}&file=${q('new.txt')}`);
    expect(r.status).toBe(200);
    expect(r.json.untracked).toBe(true);
    expect(r.json.diff).toContain('+brand new file');
  });

  it('searches content with grep, including empty results', async () => {
    const hit = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('bravo')}`);
    expect(hit.status).toBe(200);
    expect(hit.json.total).toBe(1);
    expect(hit.json.matches[0].path).toBe('b.txt');
    const miss = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('no-such-term-xyz')}`);
    expect(miss.status).toBe(200);
    expect(miss.json.total).toBe(0);
  });

  it('searches across every registered repository with grep-all', async () => {
    const hit = await get(`/api/grep-all?pattern=${q('bravo')}`);
    expect(hit.status).toBe(200);
    expect(hit.json.results).toHaveLength(1);
    expect(hit.json.results[0].repo).toBe(repoDir);
    expect(hit.json.results[0].matches[0].path).toBe('b.txt');
    expect(hit.json.total).toBe(1);
    expect(hit.json.truncated).toBe(false);
    const miss = await get(`/api/grep-all?pattern=${q('no-such-term-xyz')}`);
    expect(miss.status).toBe(200);
    expect(miss.json.total).toBe(0);
    const bad = await get('/api/grep-all');
    expect(bad.status).toBe(400);
  });

  it('reads the configured commit template and reports when missing', async () => {
    const none = await get(`/api/commit-template?repo=${q(repoDir)}`);
    expect(none.status).toBe(200);
    expect(none.json.configured).toBe(false);

    await fsp.writeFile(path.join(repoDir, 'template.txt'), 'Summary\n\nDetails go here.\n', 'utf8');
    git(['config', 'commit.template', 'template.txt'], repoDir);
    const r = await get(`/api/commit-template?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    expect(r.json.configured).toBe(true);
    expect(r.json.path).toBe('template.txt');
    expect(r.json.text).toContain('Details go here.');
    // Leave the config in place; later commit tests do not depend on it.
  });
});

describe('write routes', () => {
  it('stages and unstages a single file', async () => {
    const staged = await post('/api/stage', { repo: repoDir, file: 'a.txt', action: 'stage' });
    expect(staged.status).toBe(200);
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'a.txt' && f.area === 'staged')).toBe(true);
    const unstaged = await post('/api/stage', { repo: repoDir, file: 'a.txt', action: 'unstage' });
    expect(unstaged.status).toBe(200);
    status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'a.txt' && f.area === 'staged')).toBe(false);
  });

  it('stages and unstages a single hunk', async () => {
    await writeFile(
      'hunk-test.txt',
      `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')}\n`,
    );
    git(['add', 'hunk-test.txt'], repoDir);
    git(['commit', '-m', 'add hunk test file'], repoDir);

    const lines = (await fsp.readFile(path.join(repoDir, 'hunk-test.txt'), 'utf8')).split('\n');
    lines[1] = 'CHANGED2';
    lines[14] = 'CHANGED15';
    await writeFile('hunk-test.txt', `${lines.join('\n')}`);

    const badAction = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 0, action: 'bogus',
    });
    expect(badAction.status).toBe(400);
    const outOfRange = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 5, action: 'stage',
    });
    expect(outOfRange.status).toBe(400);

    // Stage the second hunk only: CHANGED15 goes to the index, CHANGED2 stays.
    const r = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 1, action: 'stage',
    });
    expect(r.status).toBe(200);
    expect(r.json.hunkCount).toBe(2);
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    // Porcelain v2 reports a partially staged file as one entry with xy "MM".
    const entry = status.json.status.files.find((f) => f.path === 'hunk-test.txt');
    expect(entry.status).toBe('MM');
    expect(entry.area).toBe('staged');
    const cached = git(['show', ':hunk-test.txt'], repoDir);
    expect(cached).toContain('CHANGED15');
    expect(cached).not.toContain('CHANGED2');

    // Unstage the same hunk. The cached diff now contains one hunk, so its
    // index is 0 in the staged view; the index must return to the committed blob.
    const u = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 0, action: 'unstage',
    });
    expect(u.status).toBe(200);
    status = await get(`/api/status?repo=${q(repoDir)}`);
    const after = status.json.status.files.find((f) => f.path === 'hunk-test.txt');
    expect(after.area).toBe('unstaged');

    // Restore the committed file so later tests see a clean state.
    git(['restore', '--staged', '--', 'hunk-test.txt'], repoDir, true);
    git(['restore', '--', 'hunk-test.txt'], repoDir);
  });

  it('discards a single working-tree hunk without touching the index', async () => {
    await writeFile(
      'discard-hunk.txt',
      `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')}\n`,
    );
    git(['add', 'discard-hunk.txt'], repoDir);
    git(['commit', '-m', 'add discard hunk test file'], repoDir);

    const lines = (await fsp.readFile(path.join(repoDir, 'discard-hunk.txt'), 'utf8')).split('\n');
    lines[1] = 'CHANGED2';
    lines[14] = 'CHANGED15';
    await writeFile('discard-hunk.txt', `${lines.join('\n')}`);

    const noConfirm = await post('/api/discard-hunk', {
      repo: repoDir, file: 'discard-hunk.txt', hunk: 0,
    });
    expect(noConfirm.status).toBe(400);
    const outOfRange = await post('/api/discard-hunk', {
      repo: repoDir, file: 'discard-hunk.txt', hunk: 9, confirm: true,
    });
    expect(outOfRange.status).toBe(400);

    // Discard the first hunk: CHANGED2 is restored to the committed line,
    // while CHANGED15 remains in the working tree and the index is untouched.
    const r = await post('/api/discard-hunk', {
      repo: repoDir, file: 'discard-hunk.txt', hunk: 0, confirm: true,
    });
    expect(r.status).toBe(200);
    const onDisk = await fsp.readFile(path.join(repoDir, 'discard-hunk.txt'), 'utf8');
    expect(onDisk).not.toContain('CHANGED2');
    expect(onDisk).toContain('CHANGED15');
    // No staged changes: the index still holds the committed blob.
    const status = await get(`/api/status?repo=${q(repoDir)}`);
    const entry = status.json.status.files.find((f) => f.path === 'discard-hunk.txt');
    expect(entry.area).toBe('unstaged');

    git(['restore', '--', 'discard-hunk.txt'], repoDir);
  });

  it('commits staged changes and rejects empty messages', async () => {
    const bad = await post('/api/commit', { repo: repoDir, message: '   ' });
    expect(bad.status).toBe(400);
    await post('/api/stage', { repo: repoDir, file: 'a.txt', action: 'stage' });
    const before = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const r = await post('/api/commit', { repo: repoDir, message: 'extend a file' });
    expect(r.status).toBe(200);
    const after = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    expect(after).not.toBe(before);
  });

  it('strips comment lines from a commit message before committing', async () => {
    await fsp.writeFile(path.join(repoDir, 'note.txt'), 'note\n', 'utf8');
    await post('/api/stage', { repo: repoDir, file: 'note.txt', action: 'stage' });
    const message = 'Real subject\n\n# template comment\nReal body\n';
    const r = await post('/api/commit', { repo: repoDir, message });
    expect(r.status).toBe(200);
    const log = await get(`/api/log?repo=${q(repoDir)}`);
    const head = log.json.commits[0];
    expect(head.subject).toBe('Real subject');
    expect(head.body).toBe('Real body');
  });

  it('creates and deletes a branch without switching', async () => {
    const created = await post('/api/branch/create', { repo: repoDir, name: 'tmp-branch', noCheckout: true });
    expect(created.status).toBe(200);
    expect(created.json.switched).toBe(false);
    const deleted = await post('/api/branch/delete', { repo: repoDir, name: 'tmp-branch' });
    expect(deleted.status).toBe(200);
  });

  it('creates and deletes a tag', async () => {
    const created = await post('/api/tag/create', { repo: repoDir, name: 'tmp-tag' });
    expect(created.status).toBe(200);
    const deleted = await post('/api/tag/delete', { repo: repoDir, name: 'tmp-tag' });
    expect(deleted.status).toBe(200);
  });

  it('renames a file and moves it back', async () => {
    const moved = await post('/api/mv', { repo: repoDir, from: 'b.txt', to: 'b-renamed.txt' });
    expect(moved.status).toBe(200);
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'b-renamed.txt')).toBe(true);
    const back = await post('/api/mv', { repo: repoDir, from: 'b-renamed.txt', to: 'b.txt' });
    expect(back.status).toBe(200);
  });

  it('removes a tracked file and restores it', async () => {
    const removed = await post('/api/rm', { repo: repoDir, file: 'new.txt' });
    expect(removed.status).toBe(200);
    expect(removed.json.method).toBe('unlink');
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'new.txt')).toBe(false);
    await fsp.writeFile(path.join(repoDir, 'new.txt'), 'brand new file\n', 'utf8');
  });

  it('reverts an ordinary commit with a new revert commit', async () => {
    await fsp.writeFile(path.join(repoDir, 'revert-target.txt'), 'to be reverted\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add revert target'], repoDir);
    const head = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const r = await post('/api/revert', { repo: repoDir, sha: head });
    expect(r.status).toBe(200);
    const exists = await fsp.access(path.join(repoDir, 'revert-target.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('reverts several commits in one batch', async () => {
    await fsp.writeFile(path.join(repoDir, 'batch1.txt'), 'one\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add batch1'], repoDir);
    await fsp.writeFile(path.join(repoDir, 'batch2.txt'), 'two\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add batch2'], repoDir);
    const log = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits;
    const shas = [log[0].hash, log[1].hash]; // newest first
    const r = await post('/api/revert-batch', { repo: repoDir, shas });
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(2);
    for (const f of ['batch1.txt', 'batch2.txt']) {
      const exists = await fsp.access(path.join(repoDir, f)).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    }
  });

  it('rejects invalid batch revert payloads', async () => {
    const empty = await post('/api/revert-batch', { repo: repoDir, shas: [] });
    expect(empty.status).toBe(400);
    const bad = await post('/api/revert-batch', { repo: repoDir, shas: ['xyz', 'abc'] });
    expect(bad.status).toBe(400);
  });

  it('rejects hard reset without confirmation', async () => {
    const head = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const r = await post('/api/reset', { repo: repoDir, mode: 'hard', sha: head });
    expect(r.status).toBe(400);
  });

  it('rejects a merge revert without a mainline', async () => {
    const merge = (await get(`/api/log?repo=${q(repoDir)}&message=${q('Merge branch')}`)).json.commits[0];
    const r = await post('/api/revert', { repo: repoDir, sha: merge.hash });
    expect(r.status).toBe(400);
  });

  it('runs a soft reset to a previous commit', async () => {
    const head = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const parent = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[1].hash;
    const r = await post('/api/reset', { repo: repoDir, mode: 'soft', sha: parent });
    expect(r.status).toBe(200);
    // Restore the original branch position so later assertions stay valid.
    git(['reset', '--soft', head], repoDir);
  });
});

describe('rebase operation state', () => {
  it('registers the conflicted rebase repository', async () => {
    const r = await post('/api/repos/add', { repo: rebaseDir });
    expect(r.status).toBe(200);
  });

  it('detects the rebase in progress', async () => {
    const r = await get(`/api/status?repo=${q(rebaseDir)}`);
    expect(r.json.state.rebaseInProgress).toBe(true);
    expect(r.json.state.rebaseType).toMatch(/merge|apply/);
  });

  it('aborts the rebase and restores a clean state', async () => {
    const r = await post('/api/rebase/abort', { repo: rebaseDir });
    expect(r.status).toBe(200);
    const status = await get(`/api/status?repo=${q(rebaseDir)}`);
    expect(status.json.state.rebaseInProgress).toBe(false);
    expect(status.json.status.files).toEqual([]);
  });
});

describe('server-sent events', () => {
  it('sends a hello frame on connect', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { 'x-git2-token': 'dev-token' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"type":"hello"');
    reader.cancel();
  });
});

describe('audit log endpoint and retention', () => {
  it('returns entries newest first with a total', async () => {
    const r = await get('/api/audit?limit=50');
    expect(r.status).toBe(200);
    expect(r.json.entries.length).toBeLessThanOrEqual(50);
    expect(r.json.total).toBeGreaterThan(0);
    expect(r.json.entries.length).toBeGreaterThan(1);
    // newest first: timestamps must be non-increasing
    const times = r.json.entries.slice(0, 3).map((e) => e.at);
    expect(times[0] >= times[1]).toBe(true);
    expect(times[1] >= times[2]).toBe(true);
  });

  it('rejects a non-numeric or over-long limit', async () => {
    expect((await get('/api/audit?limit=abc')).status).toBe(400);
    expect((await get('/api/audit?limit=99999')).status).toBe(400);
  });

  it('honours a small limit and the 1000 cap', async () => {
    const one = await get('/api/audit?limit=1');
    expect(one.status).toBe(200);
    expect(one.json.entries).toHaveLength(1);
    const capped = await get('/api/audit?limit=1000');
    expect(capped.status).toBe(200);
    expect(capped.json.entries.length).toBeLessThanOrEqual(1000);
  });

  it('filters entries by text and outcome across the whole file', async () => {
    const auditFile = path.join(homeDir, 'audit.log');
    const at = (i) => new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString();
    const seed = [
      { at: at(0), ok: true, action: 'stage', repo: repoDir },
      { at: at(1), ok: false, action: 'stage', repo: repoDir },
      { at: at(2), ok: true, action: 'save', repo: repoDir, file: 'a.txt' },
      { at: at(3), ok: true, action: 'branch-create', repo: repoDir },
      { at: at(4), ok: true, action: 'save', repo: repoDir, file: 'b.txt' },
    ];
    await fsp.writeFile(auditFile, `${seed.map((e) => JSON.stringify(e)).join('\n')}\n`);

    const text = await get('/api/audit?limit=1000&q=stage');
    expect(text.status).toBe(200);
    expect(text.json.total).toBe(2);
    expect(text.json.entries.every((e) => e.action === 'stage')).toBe(true);
    // case-insensitive, and matches the summary fields (repo basename)
    const upper = await get('/api/audit?limit=1000&q=STAGE');
    expect(upper.json.total).toBe(2);

    const fails = await get('/api/audit?limit=1000&outcome=fail');
    expect(fails.json.total).toBe(1);
    expect(fails.json.entries[0].ok).toBe(false);
    expect(fails.json.entries[0].action).toBe('stage');

    const success = await get('/api/audit?limit=1000&outcome=ok');
    expect(success.json.total).toBe(4);
    expect(success.json.entries.every((e) => e.ok !== false)).toBe(true);

    const combined = await get('/api/audit?limit=1000&q=stage&outcome=fail');
    expect(combined.json.total).toBe(1);
    expect(combined.json.entries[0].action).toBe('stage');

    const noMatch = await get('/api/audit?limit=1000&q=nonexistent-action');
    expect(noMatch.status).toBe(200);
    expect(noMatch.json.total).toBe(0);
    expect(noMatch.json.entries).toEqual([]);

    // invalid parameters rejected at the route
    expect((await get('/api/audit?outcome=bogus')).status).toBe(400);
    expect((await get(`/api/audit?q=${'x'.repeat(101)}`)).status).toBe(400);
  });

  it('rotates the file once the size threshold is crossed', async () => {
    // The isolated audit path is built from the server's home dir; never use
    // the test process's configPaths(), which would resolve the real home when
    // PR_HELPER_HOME is not set in the vitest process.
    const auditFile = path.join(homeDir, 'audit.log');
    // Seed a valid JSONL file larger than the rotation threshold.
    const line = JSON.stringify({ at: new Date().toISOString(), action: 'seed' });
    const perLine = line.length + 1;
    const count = Math.ceil(AUDIT_ROTATE_BYTES / perLine) + 10;
    await fsp.writeFile(auditFile, `${(`${line}\n`).repeat(count)}`);
    expect((await fsp.stat(auditFile)).size).toBeGreaterThan(AUDIT_ROTATE_BYTES);

    // An audited write appends one line and triggers the rotation.
    await fsp.writeFile(path.join(repoDir, 'rot-trigger.txt'), 'rotate\n', 'utf8');
    const staged = await post('/api/stage', {
      repo: repoDir,
      action: 'stage',
      file: 'rot-trigger.txt',
    });
    expect(staged.status).toBe(200);

    expect((await fsp.stat(auditFile)).size).toBeLessThanOrEqual(AUDIT_ROTATE_BYTES);
    const r = await get('/api/audit?limit=1000');
    expect(r.status).toBe(200);
    expect(r.json.total).toBeLessThanOrEqual(AUDIT_KEEP_ENTRIES);
    expect(r.json.entries[0].action).toBe('stage');
  });
});

describe('file save endpoint', () => {
  const scratch = 'save-scratch.txt';

  beforeAll(async () => {
    await fsp.writeFile(path.join(repoDir, scratch), 'initial content\n', 'utf8');
  });

  it('exposes the working-tree mtime', async () => {
    const r = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    expect(r.status).toBe(200);
    expect(typeof r.json.mtimeMs).toBe('number');
    expect(r.json.content).toBe('initial content\n');
    expect(r.json.ref).toBeNull();
  });

  it('saves content atomically and returns the new mtime', async () => {
    const before = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    const r = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: 'updated content\n',
      expectedMtime: before.json.mtimeMs,
    });
    expect(r.status).toBe(200);
    expect(r.json.bytes).toBe(Buffer.byteLength('updated content\n'));
    expect(typeof r.json.mtimeMs).toBe('number');
    expect(r.json.mtimeMs).not.toBe(before.json.mtimeMs);
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe('updated content\n');
  });

  it('rejects invalid and sensitive payloads', async () => {
    const base = { repo: repoDir, file: scratch };
    expect((await post('/api/save', { ...base, content: 123 })).status).toBe(400);
    expect((await post('/api/save', { ...base, content: 'bad\0byte' })).status).toBe(400);
    // The global 256 KB body cap binds before the route's 1 MB content check,
    // so an oversized payload is rejected with 413 rather than a reset.
    expect((await post('/api/save', {
      ...base,
      content: 'x'.repeat(1024 * 1024 + 1),
    })).status).toBe(413);
    expect((await post('/api/save', {
      repo: repoDir,
      file: '.env',
      content: 'X=1\n',
    })).status).toBe(403);
    expect((await post('/api/save', {
      repo: repoDir,
      file: 'src',
      content: 'x',
    })).status).toBe(400);
  });

  it('rejects a stale save with 409 and accepts the fresh mtime', async () => {
    const loaded = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    // Change the file outside the app.
    await fsp.writeFile(path.join(repoDir, scratch), 'external change\n', 'utf8');
    const stale = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: 'app change\n',
      expectedMtime: loaded.json.mtimeMs,
    });
    expect(stale.status).toBe(409);
    // The external content must survive the rejected save.
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe('external change\n');

    const fresh = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    const ok = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: 'app change\n',
      expectedMtime: fresh.json.mtimeMs,
    });
    expect(ok.status).toBe(200);
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe('app change\n');
  });
});
