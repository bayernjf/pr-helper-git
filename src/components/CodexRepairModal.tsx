// Codex repair dialog (P3-5 tail, mirroring pr-helper's showCodexRepairDialog):
// collects the failed-runs repair context markdown from the engine route and
// presents it for copying into Codex, with the Actions page one click away.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '../lib/errors';
import { repairContext } from '../api/flows';
import { t } from '../i18n';
import { IconX } from './icons';

type Phase =
  | { kind: 'collecting' }
  | { kind: 'ready'; markdown: string; pullUrl: string | null }
  | { kind: 'error'; message: string };

export default function CodexRepairModal({ workflowId, stageIndex, source, pullNumber, onClose }: {
  workflowId: string;
  stageIndex: number;
  source?: string;
  pullNumber?: number | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'collecting' });
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    repairContext({ workflowId, stageIndex, source: source ?? undefined, pullNumber: pullNumber ?? undefined })
      .then((payload) => {
        if (!alive) return;
        const markdown = (payload as { markdown?: string }).markdown;
        if (!markdown) throw new Error((payload as { message?: string }).message || t('repair error: empty context'));
        setPhase({ kind: 'ready', markdown, pullUrl: (payload as { pullUrl?: string }).pullUrl ?? null });
      })
      .catch((err) => {
        if (alive) setPhase({ kind: 'error', message: errorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [workflowId, stageIndex, source, pullNumber]);

  async function copy() {
    if (phase.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(phase.markdown);
      // The original toasts on copy success; keep the lightweight equivalent.
      // eslint-disable-next-line no-alert
      window.alert(t('repair context copied'));
    } catch {
      // Clipboard may be denied — the textarea is selectable by hand.
      textRef.current?.select();
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <div className="modal-header">
          <h2>{t('Codex repair context')}</h2>
          <button type="button" className="m-icon-btn" aria-label={t('Close')} onClick={onClose}>
            <IconX width={18} height={18} />
          </button>
        </div>
        <div className="modal-body">
          {phase.kind === 'collecting' ? (
            <p className="editor-hint">{t('Collecting the failed runs context…')}</p>
          ) : phase.kind === 'error' ? (
            <div className="drawer-error">{phase.message}</div>
          ) : (
            <>
              <p className="editor-hint">{t('Copy this context into Codex to draft the fix; the Actions page lists the failed runs.')}</p>
              {phase.pullUrl ? (
                <a className="text-link" target="_blank" rel="noreferrer" href={phase.pullUrl}>{t('Open the pull request on GitHub')}</a>
              ) : null}
              <textarea ref={textRef} readOnly value={phase.markdown} rows={12} className="repair-context" />
              <div className="takeover-ops">
                <button type="button" className="drawer-btn primary small" onClick={() => void copy()}>
                  {t('Copy context')}
                </button>
                <button type="button" className="drawer-btn small" onClick={onClose}>
                  {t('Close')}
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
