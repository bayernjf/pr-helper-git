import { useEscape } from '../hooks/use-escape';
import { IconX } from './icons';
import { t } from '../i18n';

interface ShortcutRow {
  keys: string[];
  description: string;
}
interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    rows: [
      { keys: ['⌘/Ctrl', 'K'], description: 'Open the command palette' },
      { keys: ['⌘/Ctrl', '1'], description: 'Switch to the Git view' },
      { keys: ['⌘/Ctrl', '2'], description: 'Switch to the Pull Requests view' },
      { keys: ['R'], description: 'Refresh the repository (when not typing)' },
      { keys: ['?'], description: 'Show this shortcut reference' },
      { keys: ['Esc'], description: 'Close the open dialog or menu' },
    ],
  },
  {
    title: 'Commit graph',
    rows: [
      { keys: ['↑', '↓'], description: 'Move the selection' },
      { keys: ['Home', 'End'], description: 'Jump to the first or last commit' },
      { keys: ['Enter', 'Space'], description: 'Open the commit detail' },
      { keys: ['⌘/Ctrl', 'Shift', 'F'], description: 'Focus the commit filter' },
      { keys: ['Shift', 'Enter'], description: 'Search commits in all branches (graph focused)' },
    ],
  },
  {
    title: 'Command palette',
    rows: [
      { keys: ['↑', '↓'], description: 'Move the highlight' },
      { keys: ['Enter'], description: 'Run the selected command' },
      { keys: ['Esc'], description: 'Close the palette' },
    ],
  },
  {
    title: 'File editor',
    rows: [
      { keys: ['⌘/Ctrl', 'S'], description: 'Save the file' },
      { keys: ['Tab', 'Shift+Tab'], description: 'Indent or outdent the current line' },
    ],
  },
  {
    title: 'Dialogs',
    rows: [
      { keys: ['Tab', 'Shift+Tab'], description: 'Cycle focus within the dialog' },
    ],
  },
];

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEscape(onClose);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("Keyboard shortcuts")} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("Keyboard shortcuts")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body shortcuts-body">
          {GROUPS.map((group) => (
            <div className="shortcuts-group" key={group.title}>
              <h3 className="shortcuts-title">{t(group.title)}</h3>
              {group.rows.map((row) => (
                <div className="shortcuts-row" key={row.description}>
                  <span className="shortcuts-keys">
                    {row.keys.map((k, i) => (
                      <kbd key={`${k}-${i}`} className="kbd">{k}</kbd>
                    ))}
                  </span>
                  <span className="shortcuts-desc">{t(row.description)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
    </div>
  );
}
