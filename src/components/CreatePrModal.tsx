import { useMemo, useState } from 'react';
import { githubProxy } from '../api';
import { useApp } from '../app-state';
import { shortHash } from '../lib/format';
import type { Ref } from '../types';
import { useToast } from './ui';

export default function CreatePrModal({
  headRefs,
  onClose,
  onCreated,
}: {
  headRefs: Ref[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { pat, remote, status, commits } = useApp();
  const toast = useToast();

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
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!remote?.owner || !remote.repo) return;
    if (!title.trim() || !head || !base || head === base) {
      toast.error('Title is required and head/base must differ');
      return;
    }
    setSaving(true);
    try {
      await githubProxy(
        pat,
        `/repos/${remote.owner}/${remote.repo}/pulls`,
        'POST',
        { title: title.trim(), head, base, body },
      );
      toast.notify('Pull request created', 'success');
      onCreated();
    } catch (err: any) {
      toast.error(err.detail ? `${err.message}: ${err.detail}` : err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>New pull request</h3>
        <div className="form-row">
          <label htmlFor="pr-base">Base</label>
          <select id="pr-base" className="input" value={base} onChange={(e) => setBase(e.target.value)}>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="pr-head">Compare</label>
          <select id="pr-head" className="input" value={head} onChange={(e) => setHead(e.target.value)}>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="pr-title">Title</label>
          <input
            id="pr-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short imperative summary"
          />
        </div>
        <div className="form-row" style={{ gridTemplateColumns: '90px 1fr', alignItems: 'start' }}>
          <label htmlFor="pr-body" style={{ paddingTop: 7 }}>Description</label>
          <textarea
            id="pr-body"
            className="input"
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create pull request'}
          </button>
        </div>
      </form>
    </div>
  );
}
