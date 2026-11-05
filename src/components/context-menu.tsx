import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  id?: string;
  label?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

// Portal-based context menu with viewport edge correction.
export function ContextMenu({ x, y, items, title, onSelect, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (x + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    setPos({ left, top });
  }, [x, y]);

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {title && <div className="ctx-title">{title}</div>}
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="ctx-sep" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.id) onSelect(item.id);
            }}
          >
            {item.icon && <span className="ctx-icon">{item.icon}</span>}
            <span className="ctx-label">{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
