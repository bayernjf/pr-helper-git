import { useMemo, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import { shortHash } from '../lib/format';
import type { Ref } from '../types';
import { IconX } from './icons';

interface Props {
  headRefs: Ref[];
  onClose: () => void;
  onCreated: () => void;
}

export default function CreatePrModal({ headRefs, onClose, onCreated }: Props) {
  const { pat, remote, status, commits, toast } = useApp();

  const branches = useMemo(
    () => headRefs.filter((r) => r.name.startsWith('refs/heads/')).map((r) => r.shortName),
    [headRefs],
  );
  const defaultBase = branches.find((b) => b === 'main') || branches.find((b) => b === 'master') || branches[0] || '';

  const [head, setHead] = useState(status?.branch || branches[0] || '');
  const [base, setBase] = useState(defaultBase);
  const [title, setTitle] = useState('');
  const defaultBody = useMemo(() => {
    const lines = commits
      .filter((c) => c.subject)
      .slice(0, 15)
      .map((c) => `- ${c.subject} (${shortHash(c.hash)})`);
    return `## Summary\n\n${lines.join('\n') || '- '}\n`;
  }, [commits]);
  const [body, setBody] = useState(defaultBody);
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!remote?.owner || !remote.repo) return;
    if (!title.trim() || !head || !base || head === base) return;
    setSaving(true);
    try {
      await githubProxy(
        pat,
        `/repos/${remote.owner}/${remote.repo}/pulls`,
        'POST',
        { title: title.trim(), head, base, body, draft },
      );
      toast('Pull request created', 'success');
      onCreated();
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>New pull request</h2>
          <button type="button" className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pr-base">Base</label>
              <select id="pr-base" value={base} onChange={(e) => setBase(e.target.value)}>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pr-head">Compare</label>
              <select id="pr-head" value={head} onChange={(e) => setHead(e.target.value)}>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="pr-title">Title</label>
            <input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short imperative summary"
            />
          </div>
          <div className="form-group">
            <label htmlFor="pr-body">Description</label>
            <textarea
              id="pr-body"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Open as draft (not ready for review)
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !title.trim() || !head || !base || head === base}
          >
            {saving ? 'Creating…' : 'Create pull request'}
          </button>
        </div>
      </form>
    </div>
  );
}
