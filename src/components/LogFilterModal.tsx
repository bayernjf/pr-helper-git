import { useState } from 'react';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import type { LogFilters } from '../types';
import { IconX } from './icons';

interface Props {
  onClose: () => void;
}

export default function LogFilterModal({ onClose }: Props) {
  const { logFilters, setLogFilters } = useApp();
  const [draft, setDraft] = useState<Required<LogFilters>>({
    author: logFilters.author || '',
    message: logFilters.message || '',
    since: logFilters.since || '',
    until: logFilters.until || '',
  });
  useEscape(onClose);

  const activeCount = Object.values(logFilters).filter(Boolean).length;

  function update(key: keyof LogFilters, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    setLogFilters({ ...draft });
    onClose();
  }

  function clear() {
    setLogFilters({});
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} onSubmit={apply}>
        <div className="modal-header">
          <h2>Filter commit history</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="log-filter-author">Author</label>
            <input
              id="log-filter-author"
              value={draft.author}
              placeholder="Name or email pattern (--author)"
              onChange={(e) => update('author', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="log-filter-message">Message</label>
            <input
              id="log-filter-message"
              value={draft.message}
              placeholder="Commit message pattern (--grep)"
              onChange={(e) => update('message', e.target.value)}
            />
          </div>
          <div className="form-group form-row-2">
            <div>
              <label htmlFor="log-filter-since">Since</label>
              <input
                id="log-filter-since"
                type="date"
                value={draft.since}
                onChange={(e) => update('since', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="log-filter-until">Until</label>
              <input
                id="log-filter-until"
                type="date"
                value={draft.until}
                onChange={(e) => update('until', e.target.value)}
              />
            </div>
          </div>
          <div className="hint">Filters run on the server, so commits outside the loaded page are included.</div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={clear} disabled={activeCount === 0}>
            Clear filters
          </button>
          <button type="submit" className="btn btn-primary">Apply</button>
        </div>
      </form>
    </div>
  );
}
