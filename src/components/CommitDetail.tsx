import { useApp } from '../app-state';
import { formatFullDate, shortHash } from '../lib/format';

export default function CommitDetail() {
  const { commits, selectedHash, selectCommit } = useApp();
  const commit = commits.find((c) => c.hash === selectedHash);

  if (!commit) {
    return (
      <aside className="commit-detail">
        <p className="modal-detail">Select a commit in the graph to inspect its metadata.</p>
      </aside>
    );
  }

  return (
    <aside className="commit-detail">
      <h3>{commit.subject}</h3>

      <div className="detail-row">
        <div className="detail-label">Commit</div>
        <div className="detail-value">{commit.hash}</div>
      </div>

      <div className="detail-row">
        <div className="detail-label">Author</div>
        <div className="detail-value">
          {commit.authorName} &lt;{commit.authorEmail}&gt;
        </div>
      </div>

      <div className="detail-row">
        <div className="detail-label">Date</div>
        <div className="detail-value">{formatFullDate(commit.date)}</div>
      </div>

      {commit.parents.length > 0 && (
        <div className="detail-row">
          <div className="detail-label">Parents</div>
          {commit.parents.map((p) => (
            <button
              key={p}
              type="button"
              className="btn detail-value"
              style={{ marginBottom: 4, fontFamily: 'var(--mono)' }}
              onClick={() => selectCommit(p)}
            >
              {shortHash(p)}
            </button>
          ))}
        </div>
      )}

      {commit.body && (
        <div className="detail-row">
          <div className="detail-label">Message body</div>
          <div className="detail-pre">{commit.body}</div>
        </div>
      )}
    </aside>
  );
}
