// Styled dropdown replacing native <select> — native popups render white in
// dark themes and break the visual language. Same controlled API as a select:
//   <Dropdown value={v} onChange={setV} options={[{ value, label }]} id? />
// Keyboard: Enter/Space opens, ArrowUp/Down + Enter select, Esc closes.

import { useEffect, useId, useRef, useState } from 'react';

export type DropdownOption = { value: string; label: string };

export function Dropdown({
  value,
  onChange,
  options,
  id,
  className,
  disabled,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  id?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactId = useId();

  const current = options.find((o) => o.value === value);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the active option in view while navigating.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('.dropdown-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (option: DropdownOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (open) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[active];
      if (option) commit(option);
    }
  };

  return (
    <div className={`dropdown${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        id={id}
        className="dropdown-trigger"
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="dropdown-value">{current?.label ?? value}</span>
        <span className="dropdown-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="dropdown-menu"
          role="listbox"
          ref={menuRef}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              id={`${reactId}-opt-${i}`}
              aria-selected={o.value === value}
              className={`dropdown-item${i === active ? ' active' : ''}${o.value === value ? ' selected' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(o)}
            >
              {o.label}
            </div>
          ))}
          {options.length === 0 && <div className="dropdown-empty">—</div>}
        </div>
      )}
    </div>
  );
}
