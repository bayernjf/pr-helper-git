// Route-level HTTP tests. A real server is spawned against an isolated
// PR_HELPER_HOME and a temporary Git repository, so the tests exercise the
// full stack: HTTP parsing, validation, git invocation and JSON responses.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
}, 30_000);

afterAll(async () => {
  if (serverProc) serverProc.kill('SIGTERM');
  await fsp.rm(tmpRoot, { recursive: true, force: true });
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
