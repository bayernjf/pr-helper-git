import { useState, type MouseEvent, type ReactNode } from 'react';
import { useEscape } from '../hooks/use-escape';
import { IconChevronDown, IconChevronRight, IconMore } from './icons';
import { t } from '../i18n';

export function GroupHead({
  label,
  count,
  open,
  onToggle,
  action,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="ref-group-head" style={{ paddingRight: 10 }}>
      <button type="button" className="ref-group-head" style={{ padding: 0, flex: 1 }} onClick={onToggle}>
        <span className="chev">{open ? <IconChevronDown width={13} height={13} /> : <IconChevronRight width={13} height={13} />}</span>
        {label}
        <span className="count">{count}</span>
      </button>
      {action}
    </div>
  );
}

export function Row({
  icon,
  name,
  current,
  badge,
  onOpen,
  onMenu,
}: {
  icon: ReactNode;
  name: string;
  current?: boolean;
  badge?: ReactNode;
  onOpen: () => void;
  onMenu: (e: MouseEvent) => void;
}) {
  return (
    <div className={`ref-row${current ? ' current' : ''}`} onClick={onOpen} title={name}>
      <span className="ref-icon">{icon}</span>
      <span className="ref-name">{name}</span>
      {badge}
      <button
        type="button"
        className="row-more"
        aria-label={`Actions for ${name}`}
        title={t("More actions")}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
      >
        <IconMore width={15} height={15} />
      </button>
    </div>
  );
}

export function RenameModal({
  current,
  onCancel,
  onSubmit,
}: {
  current: string;
  onCancel: () => void;
  onSubmit: (next: string) => void;
}) {
  const [value, setValue] = useState(current);
  useEscape(onCancel);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="modal-header"><h2>{t("Rename branch")}</h2></div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t("New name")}</label>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || value === current}>
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}
