// Styled dropdown replacing native <select> — native popups render white in
// dark themes and break the visual language. Same controlled API as a select:
//   <Dropdown value={v} onChange={setV} options={[{ value, label }]} id? />
// Keyboard: Enter/Space opens, ArrowUp/Down + Enter select, Esc closes.

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type DropdownOption = { value: string; label: string };

type MenuPlacement = {
  left: number;
  width: number;
  up: boolean;
  top: number;
  bottom: number;
  maxHeight: number;
};

function measure(trigger: HTMLElement | null): MenuPlacement | null {
  if (!trigger) return null;
  const r = trigger.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const up = below < 200 && above > below;
  return {
    left: r.left,
    width: r.width,
    up,
    top: r.bottom + 4,
    bottom: window.innerHeight - r.top + 4,
    maxHeight: Math.max(120, Math.min(280, up ? above : below)),
  };
}

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
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactId = useId();

  const current = options.find((o) => o.value === value);

  // Close on outside click / Escape. The menu lives in a portal, so it is not
  // inside wrapRef and has to be checked separately.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
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

  // Keep the portaled menu anchored when the window or a scroll container moves.
  useEffect(() => {
    if (!open) return;
    const reposition = () => setPlacement(measure(wrapRef.current));
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  // Move focus into the menu when it opens so Arrow/Enter reach onMenuKey;
  // otherwise the trigger keeps focus and keyboard navigation is dead.
  useEffect(() => {
    if (open) menuRef.current?.focus();
  }, [open]);

  const commit = (option: DropdownOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  function toggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const next = measure(wrapRef.current);
    if (!next) return;
    setPlacement(next);
    setOpen(true);
  }

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (open) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
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
        onClick={toggle}
        onKeyDown={onTriggerKey}
      >
        <span className="dropdown-value">{current?.label ?? value}</span>
        <span className="dropdown-caret" aria-hidden="true">▾</span>
      </button>
      {open && placement && createPortal(
        <div
          className="dropdown-menu"
          role="listbox"
          ref={menuRef}
          tabIndex={-1}
          aria-activedescendant={`${reactId}-opt-${active}`}
          style={{
            position: 'fixed',
            left: placement.left,
            top: placement.up ? 'auto' : placement.top,
            bottom: placement.up ? placement.bottom : 'auto',
            minWidth: placement.width,
            maxHeight: placement.maxHeight,
            zIndex: 1200,
          }}
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (!wrapRef.current?.contains(next) && !menuRef.current?.contains(next)) setOpen(false);
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
        </div>,
        document.body,
      )}
    </div>
  );
}
