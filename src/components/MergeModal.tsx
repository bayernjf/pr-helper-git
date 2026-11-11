import { useState } from 'react';
import { mergeRef, type MergeStrategy } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { IconMerge, IconX } from './icons';
import { t } from '../i18n';

interface Props {
  sourceRef: string;
  currentBranch: string;
  onClose: () => void;
}

interface StrategyOption {
  value: MergeStrategy;
  title: string;
  hint: string;
}

const OPTIONS: StrategyOption[] = [
  {
    value: 'default',
    title: 'Default merge',
    hint: 'Fast-forward when possible, otherwise create a merge commit.',
  },
  {
    value: 'no-ff',
    title: 'No fast-forward (--no-ff)',
    hint: 'Always create a merge commit, even when a fast-forward is possible.',
  },
  {
    value: 'ff-only',
    title: 'Fast-forward only (--ff-only)',
    hint: 'Fail if the branches cannot be fast-forwarded; no merge commit is made.',
  },
  {
    value: 'squash',
    title: 'Squash (--squash)',
    hint: 'Combine all incoming changes into staged changes without committing.',
  },
];

export default function MergeModal({ sourceRef, currentBranch, onClose }: Props) {
  const { activeRepo, runAction } = useApp();
  const [strategy, setStrategy] = useState<MergeStrategy>('default');
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  async function submit() {
    if (!activeRepo || busy) return;
    setBusy(true);
    const result = await runAction(
      mergeRef(activeRepo, sourceRef, strategy),
      strategy === 'squash' ? `Squashed ${sourceRef}` : `Merged ${sourceRef}`,
    );
    setBusy(false);
    if (result !== null) onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <IconMerge width={17} height={17} style={{ verticalAlign: -3, marginRight: 6 }} />
            {t("Merge")}{sourceRef} {t("into")}{currentBranch}
          </h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="merge-options" role="radiogroup" aria-label={t("Merge strategy")}>
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`merge-option${strategy === option.value ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name="merge-strategy"
                  value={option.value}
                  checked={strategy === option.value}
                  onChange={() => setStrategy(option.value)}
                />
                <span className="merge-option-text">
                  <span className="merge-option-title">{t(option.title)}</span>
                  <span className="merge-option-hint">{t(option.hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? t('Merging…') : t('Merge branches')}
          </button>
        </div>
      </div>
    </div>
  );
}
