import { useMemo, useState } from 'react';
import { githubProxy, generatePrDescription } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { shortHash } from '../lib/format';
import type { Ref } from '../types';
import { IconX } from './icons';
import { Dropdown } from './Dropdown';
import { t } from '../i18n';

interface Props {
  headRefs: Ref[];
  onClose: () => void;
  onCreated: () => void;
}

export default function CreatePrModal({ headRefs, onClose, onCreated }: Props) {
  const { pat, remote, status, commits, toast, activeRepo } = useApp();
  useEscape(onClose);

  const [generating, setGenerating] = useState(false);

  // Ask the local server to draft a title + description from target..source.
  async function handleGenerate() {
    if (!activeRepo || !head || !base || head === base) return;
    setGenerating(true);
    try {
      const res = await generatePrDescription(activeRepo, head, base);
      if (!title.trim() && res.title) setTitle(res.title);
      if (res.body) setBody(res.body);
    } catch (err: any) {
      toast(err.detail ? `${err.message}: ${err.detail}` : err.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

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
      toast(t("Pull request created"), 'success');
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
          <h2>{t("New pull request")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pr-base">{t("Base")}</label>
              <Dropdown
                id="pr-base"
                value={base}
                onChange={setBase}
                options={branches.map((b) => ({ value: b, label: b }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="pr-head">{t("Compare")}</label>
              <Dropdown
                id="pr-head"
                value={head}
                onChange={setHead}
                options={branches.map((b) => ({ value: b, label: b }))}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="pr-title">{t("Title")}</label>
            <input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Short imperative summary")}
            />
          </div>
          <div className="form-group">
            <div className="label-row">
              <label htmlFor="pr-body">{t("Description")}</label>
              <button
                type="button"
                className="btn btn-small"
                disabled={generating || !head || !base || head === base}
                onClick={handleGenerate}
              >
                {generating ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
            <textarea
              id="pr-body"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            {t("Open as draft (not ready for review)")}</label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
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
