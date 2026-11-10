// Three-way conflict merge editor (parity with pr-helper-git's merge editor):
// parse the working file's conflict markers into regions, decide per region
// (ours / theirs / both), edit the assembled result, then save (mtime
// optimistic lock) and stage the file.
import { useEffect, useMemo, useState } from 'react';
import { getFile, saveFile, stageFile } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { parseConflictMarkers, assembleResolved, hasConflictMarkers, type ConflictSegment, type RegionDecision } from '../lib/diff/conflict';
import { IconX } from './icons';
import { t, tp } from '../i18n';

export default function ConflictEditorModal({
  repo,
  path,
  onClose,
  onResolved,
}: {
  repo: string;
  path: string;
  onClose: () => void;
  onResolved?: () => void;
}) {
  const { toast, refresh } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<ConflictSegment[]>([]);
  const [decisions, setDecisions] = useState<RegionDecision[]>([]);
  const [edited, setEdited] = useState<string | null>(null);
  const [mtime, setMtime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  useEscape(onClose);

  // Load once: parse the working file's conflict regions. This must be an
  // effect, not useMemo — React may re-run a memo and StrictMode renders twice.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const file = await getFile(repo, path);
        if (cancelled) return;
        if (file.masked || file.binary || file.truncated) {
          setError(t('This file cannot be merged in the editor (masked, binary or too large).'));
          setLoading(false);
          return;
        }
        if (!hasConflictMarkers(file.content)) {
          setError(t('No conflict markers left in this file — mark it resolved instead.'));
          setLoading(false);
          return;
        }
        const parsed = parseConflictMarkers(file.content);
        setSegments(parsed);
        setDecisions(parsed.filter((s) => s.type === 'conflict').map(() => 'ours' as RegionDecision));
        setMtime(file.mtimeMs);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || String(err));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [repo, path]);

  const conflicts = useMemo(
    () => segments.filter((s): s is Extract<ConflictSegment, { type: 'conflict' }> => s.type === 'conflict'),
    [segments],
  );
  const regionCount = conflicts.length;

  const assembled = useMemo(() => {
    if (edited !== null) return edited;
    return assembleResolved(segments, decisions);
  }, [segments, decisions, edited]);

  function decide(index: number, decision: RegionDecision) {
    setEdited(null);
    setDecisions((prev) => prev.map((d, i) => (i === index ? decision : d)));
  }

  async function save() {
    setSaving(true);
    try {
      await saveFile(repo, path, assembled, mtime);
      await stageFile(repo, path, 'stage');
      await refresh();
      toast(`${path} ${t('saved and staged')}`, 'success');
      onResolved?.();
      onClose();
    } catch (err: any) {
      const message = err?.message || String(err);
      toast(message, 'error');
      if (err?.status === 409 || /mtime|changed/i.test(message)) {
        toast(t('The file changed on disk — reopening with the latest content.'), 'info');
        // Reload the freshest content; markers may already be gone.
        try {
          const file = await getFile(repo, path);
          setMtime(file.mtimeMs);
          if (hasConflictMarkers(file.content)) {
            const parsed = parseConflictMarkers(file.content);
            setSegments(parsed);
            setDecisions(parsed.filter((s) => s.type === 'conflict').map(() => 'ours' as RegionDecision));
            setEdited(null);
          } else {
            setError(t('No conflict markers left in this file — mark it resolved instead.'));
          }
        } catch { /* surface the next save error instead */ }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide conflict-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('Merge editor')}</h2>
          <span className="conflict-editor-path" title={path}>{path}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" aria-label={t('Close')} title={t('Close')} onClick={onClose}>
            <IconX />
          </button>
        </div>

        <div className="modal-body conflict-editor-body">
          {loading && <div className="list-empty">{t('Loading…')}</div>}
          {error && <div className="list-empty">{error}</div>}
          {!loading && !error && (
            <>
              <div className="conflict-editor-note">
                {tp('{count} conflict region(s) — pick a side per region, then fine-tune the assembled result below.', { count: regionCount })}
              </div>
              {conflicts.map((seg, i) => (
                <div className="conflict-region" key={`r${i}`}>
                  <div className="conflict-region-head">
                    <span>{t('Region')} {i + 1}/{regionCount}</span>
                    <span className="spacer" />
                    {(['ours', 'theirs', 'both'] as RegionDecision[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`btn btn-sm${decisions[i] === d ? ' btn-primary' : ''}`}
                        onClick={() => decide(i, d)}
                      >
                        {d === 'ours' ? t('Current side') : d === 'theirs' ? t('Incoming side') : t('Both')}
                      </button>
                    ))}
                  </div>
                  <div className="conflict-region-sides">
                    <pre className={`side ours${decisions[i] === 'ours' ? ' chosen' : ''}`}>{seg.region.ours || '—'}</pre>
                    <pre className={`side theirs${decisions[i] === 'theirs' ? ' chosen' : ''}`}>{seg.region.theirs || '—'}</pre>
                  </div>
                </div>
              ))}
              <div className="conflict-editor-result">
                <div className="field-label">{t('Assembled result (editable)')}</div>
                <textarea
                  value={assembled}
                  onChange={(e) => setEdited(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !!error || saving}
            onClick={save}
          >
            {saving ? t('Working…') : t('Save and stage')}
          </button>
        </div>
      </div>
    </div>
  );
}
