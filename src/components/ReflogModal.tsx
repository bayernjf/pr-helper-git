import { useEffect, useState } from 'react';
import { getReflog, type ReflogEntry } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { shortHash } from '../lib/format';
import { IconX } from './icons';

export default function ReflogModal({ onClose }: { onClose: () => void }) {
  const { activeRepo, toast } = useApp();
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEscape(onClose);

  useEffect(() => {
    if (!activeRepo) return;
    let cancelled = false;
    setLoading(true);
    getReflog(activeRepo)
      .then((res) => { if (!cancelled) setEntries(res.entries); })
      .catch((err) => { if (!cancelled) toast(err.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeRepo, toast]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Reference log</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body no-pad">
          {loading ? (
            <div className="list-empty">Loading reflog…</div>
          ) : entries.length === 0 ? (
            <div className="list-empty">No reflog entries.</div>
          ) : (
            <div className="reflog-list">
              {entries.map((entry) => (
                <div className="reflog-item" key={`${entry.ref}-${entry.index}`}>
                  <span className="reflog-index">@{entry.index}</span>
                  <span className="reflog-hash">{shortHash(entry.hash)}</span>
                  <span className="reflog-action">{entry.action}</span>
                  <span className="reflog-desc">{entry.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
