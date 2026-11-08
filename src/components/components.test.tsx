// Component smoke tests rendered with react-dom/server. renderToString never
// runs effects, so no network, local-storage or timer side effects occur;
// components that need the app context are wrapped with a mock provider.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../app-state';
import type { RepoBrief } from '../types';
import AuditModal from './AuditModal';
import CommitGraph from './CommitGraph';
import DiffView from './DiffView';
import ErrorBoundary from './ErrorBoundary';
import PrFileReview from './PrFileReview';
import RepositoriesModal from './RepositoriesModal';
import ResolveConflictsModal from './ResolveConflictsModal';
import Toolbar from './Toolbar';

function render(node: React.ReactNode): string {
  return renderToString(node);
}

function withApp(node: React.ReactNode, overrides: Record<string, unknown> = {}): string {
  const value = {
    repos: [],
    activeRepo: null,
    activeBrief: null,
    view: 'git',
    theme: 'dark',
    busy: false,
    selectRepo: () => {},
    setView: () => {},
    toggleTheme: () => {},
    runAction: async () => null,
    toast: () => {},
    ...overrides,
  };
  return render(createElement(AppContext.Provider, { value } as never, node));
}

const SAMPLE_DIFF = [
  'diff --git a/hello.txt b/hello.txt',
  'index 1111111..2222222 100644',
  '--- a/hello.txt',
  '+++ b/hello.txt',
  '@@ -1,2 +1,2 @@',
  ' context line',
  '-old line',
  '+new line',
].join('\n');

describe('DiffView', () => {
  it('shows the empty hint before any selection', () => {
    const html = withApp(<DiffView result={null} />);
    expect(html).toContain('Select a file to review its changes.');
    expect(html).toContain('diff-empty');
  });

  it('masks sensitive files', () => {
    const html = withApp(<DiffView result={{ path: '.env', diff: '', masked: true, truncated: false }} />);
    // SSR inserts comment nodes between text and expressions; assert separately.
    expect(html).toContain('.env');
    expect(html).toContain('is sensitive');
  });

  it('reports a missing diff', () => {
    const html = withApp(<DiffView result={{ path: 'a.txt', diff: '', masked: false, truncated: false }} />);
    expect(html).toContain('No diff available for this file.');
  });

  it('renders unified rows with add/delete classes', () => {
    const html = withApp(
      <DiffView result={{ path: 'hello.txt', diff: SAMPLE_DIFF, masked: false, truncated: false }} />,
    );
    expect(html).toContain('hello.txt');
    expect(html).toContain('diff-line add');
    expect(html).toContain('diff-line del');
    expect(html).toContain('context line');
    // Changed words are split into spans, so assert the parts, not the whole
    // line: "new" and " line" render separately.
    expect(html).toMatch(/word-(add|del)">(new|old)/);
    // The unified view highlights the changed words of a replaced line.
    expect(html).toContain('word-del');
    expect(html).toContain('word-add');
  });

  it('renders hunk stage/unstage buttons only with a repo', () => {
    const without = withApp(
      <DiffView result={{ path: 'hello.txt', diff: SAMPLE_DIFF, masked: false, truncated: false }} />,
    );
    expect(without).not.toContain('hunk-btn');

    const stage = withApp(
      <DiffView
        result={{ path: 'hello.txt', diff: SAMPLE_DIFF, masked: false, truncated: false }}
        repo="/tmp/repo"
      />,
    );
    expect(stage).toContain('Stage hunk');
    expect(stage).toContain('Discard hunk');

    const unstage = withApp(
      <DiffView
        result={{ path: 'hello.txt', diff: SAMPLE_DIFF, masked: false, truncated: false }}
        repo="/tmp/repo"
        staged
      />,
    );
    expect(unstage).toContain('Unstage hunk');
    // Discard only acts on the working tree; the staged view never shows it.
    expect(unstage).not.toContain('Discard hunk');
  });
});

describe('PrFileReview', () => {
  const patch = [
    '@@ -1,2 +1,2 @@',
    ' context line',
    '-old line',
    '+new line',
  ].join('\n');

  it('renders the diff and attached review comments', () => {
    const html = withApp(
      <PrFileReview
        file={{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1, patch }}
        comments={[{
          id: 7,
          user: { login: 'alice', avatar_url: '' },
          body: 'please rename this',
          path: 'src/app.ts',
          line: 2,
          original_line: 2,
          side: 'RIGHT',
          commit_id: 'abc',
          in_reply_to_id: null,
          created_at: '2026-11-01T00:00:00Z',
          author_association: 'OWNER',
        }]}
        headSha="abc123"
        base="/repos/o/r/pulls/1"
        canComment
        onPosted={() => {}}
        onChanged={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(html).toContain('new line');
    expect(html).toContain('please rename this');
    expect(html).toContain('alice');
    expect(html).toContain('Reply');
    expect(html).toContain('Edit');
    expect(html).toContain('Delete');
  });
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    const html = render(
      <ErrorBoundary>
        <div className="child-marker">healthy subtree</div>
      </ErrorBoundary>,
    );
    expect(html).toContain('child-marker');
    expect(html).toContain('healthy subtree');
  });
});

describe('ResolveConflictsModal', () => {
  it('lists unmerged files with both side actions', () => {
    const html = withApp(
      <ResolveConflictsModal repo="/tmp/repo" onClose={() => {}} />,
      { status: { branch: 'main', files: [{ path: 'one.txt', status: 'unmerged', area: 'unmerged' }] } },
    );
    expect(html).toContain('Resolve conflicts');
    expect(html).toContain('one.txt');
    expect(html).toContain('Use current');
    expect(html).toContain('Use incoming');
    expect(html).toContain('Mark resolved');
  });

  it('explains how to continue when nothing is left', () => {
    const html = withApp(
      <ResolveConflictsModal repo="/tmp/repo" onClose={() => {}} />,
      { status: { branch: 'main', files: [] } },
    );
    expect(html).toContain('No conflicted files remain');
  });
});

describe('AuditModal', () => {
  it('renders the title and initial loading state', () => {
    const html = withApp(<AuditModal onClose={() => {}} />);
    expect(html).toContain('Audit log');
    expect(html).toContain('Loading audit trail…');
  });
});

describe('Toolbar', () => {
  it('shows the no-repository state', () => {
    const html = withApp(<Toolbar />);
    expect(html).toContain('No repository');
    expect(html).toContain('no repository');
    expect(html).toContain('Fetch');
    expect(html).toContain('Pull');
    expect(html).toContain('Push');
  });

  it('renders the active branch pill for a registered repo', () => {
    const html = withApp(<Toolbar />, {
      activeRepo: '/tmp/example',
      activeBrief: { path: '/tmp/example', name: 'example', branch: 'main', ahead: 2, behind: 0 },
    });
    expect(html).toContain('main');
    // renderToString places comment nodes between the arrow and the number.
    expect(html).toMatch(/↑<!-- -->2/);
  });
});

describe('RepositoriesModal', () => {
  const SAMPLE_REPOS: RepoBrief[] = [
    {
      path: '/Users/me/code/alpha',
      name: 'alpha',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      staged: 1,
      unstaged: 2,
      untracked: 1,
      lastCommit: { at: '2026-11-01T00:00:00Z', subject: 'hello' },
      error: null,
    },
    {
      path: '/Users/me/code/beta',
      name: 'beta',
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      lastCommit: null,
      error: null,
    },
    {
      path: '/Users/me/code/gamma',
      name: 'gamma',
      branch: 'dev',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      lastCommit: null,
      error: 'boom',
    },
  ];

  const renderWith = (overrides: Record<string, unknown> = {}) =>
    withApp(<RepositoriesModal onClose={() => {}} />, { refresh: async () => {}, ...overrides });

  it('shows the empty state when no repositories are registered', () => {
    const html = renderWith();
    expect(html).toContain('Open repositories');
    expect(html).toContain('No repositories yet');
  });

  it('renders each repository with location, branch and active marker', () => {
    const html = renderWith({ repos: SAMPLE_REPOS, activeRepo: '/Users/me/code/alpha' });
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('/Users/me/code');
    expect(html).toContain('main');
    expect(html).toContain('dev');
    expect(html).toContain('active');
  });

  it('reports detached HEAD, dirty counts and ahead/behind', () => {
    const html = renderWith({ repos: SAMPLE_REPOS });
    expect(html).toContain('detached');
    expect(html).toContain('c-staged');
    expect(html).toMatch(/↑<!-- -->1/);
    expect(html).toMatch(/↓<!-- -->2/);
  });

  it('flags an unavailable repository', () => {
    const html = renderWith({ repos: SAMPLE_REPOS });
    expect(html).toContain('unavailable');
  });
});

describe('CommitGraph accessibility', () => {
  const commits = [
    { hash: 'aaaa1111', parents: [], authorName: 'A', authorEmail: 'a@x', date: '2026-11-01T00:00:00Z', subject: 'first', body: '' },
    { hash: 'bbbb2222', parents: ['aaaa1111'], authorName: 'B', authorEmail: 'b@x', date: '2026-11-02T00:00:00Z', subject: 'second', body: '' },
  ];

  function graphHtml(selectedHash: string | null): string {
    return withApp(<CommitGraph />, {
      commits,
      selectedHash,
      selectCommit: () => {},
      currentRepo: '/tmp/repo',
      toast: () => {},
      loadMore: () => {},
      logLimit: 50,
      logScope: 'current',
      setLogScope: () => {},
      logPath: '',
      setLogPath: () => {},
      logFilters: {},
      repoLoading: false,
      status: null,
      refs: [],
      runAction: async () => null,
    });
  }

  it('declares a listbox and marks each commit row as an option', () => {
    const html = graphHtml(null);
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Commit history"');
    expect(html).toContain('role="option"');
    expect(html).toContain('id="commit-row-aaaa1111"');
    expect(html).toContain('id="commit-row-bbbb2222"');
    expect(html).toContain('aria-selected="false"');
    expect(html).not.toContain('aria-activedescendant');
  });

  it('points aria-activedescendant at the selected row', () => {
    const html = graphHtml('bbbb2222');
    expect(html).toContain('aria-activedescendant="commit-row-bbbb2222"');
    expect(html).toContain('aria-selected="true"');
  });
});
