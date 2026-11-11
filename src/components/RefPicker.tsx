// Combobox for one side of a comparison. A plain dropdown cannot express "use a
// commit that is not in the list", so the trigger is an input: typing filters
// refs and loaded commits, and a bare 7–40 hex string becomes selectable even
// when that commit was never loaded into the graph.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { t, tp } from '../i18n';

export type RefPickerOption = {
  value: string;
  label: string;
  hint?: string;
  group: string;
};

// Rendering every loaded commit (up to 1000) would make the popup sluggish;
// the truncation note tells the user to narrow the query instead.
const MAX_VISIBLE = 80;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function RefPicker({
  value,
  onChange,
  options,
  id,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: RefPickerOption[];
  id?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reactId = useId();

  const selected = options.find((o) => o.value === value);

  const { items, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? options.filter((o) => `${o.label} ${o.value} ${o.hint ?? ''}`.toLowerCase().includes(q))
      : options;
    const sha = query.trim().toLowerCase();
    const typed: RefPickerOption[] = SHA_RE.test(sha) && !options.some((o) => o.value === sha)
      ? [{ value: sha, label: sha, hint: t('Use this commit'), group: t('Commit') }]
      : [];
    const all = [...typed, ...matched];
    return { items: all.slice(0, MAX_VISIBLE), total: all.length };
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.dropdown-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function openList() {
    setOpen(true);
    setQuery('');
    setActive(0);
  }

  function pick(option: RefPickerOption) {
    setOpen(false);
    setQuery('');
    if (option.value !== value) onChange(option.value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      setActive((a) => (e.key === 'ArrowDown'
        ? Math.min(a + 1, items.length - 1)
        : Math.max(a - 1, 0)));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) return openList();
      const option = items[active];
      if (option) pick(option);
      return;
    }
    if (e.key === 'Escape' && open) {
      // Close the popup only. Stopping propagation keeps the dialog's own
      // Escape handler from closing the whole modal on the same keypress.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery('');
      return;
    }
    if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div className="dropdown ref-picker" ref={wrapRef}>
      <div className="ref-picker-control">
        <input
          id={id}
          role="combobox"
          className="dropdown-trigger ref-picker-input"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${reactId}-list`}
          aria-activedescendant={open && items[active] ? `${reactId}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={open ? query : (selected?.label ?? value)}
          placeholder={selected?.label ?? t('Ref, commit or SHA…')}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => { if (!open) openList(); }}
          onClick={() => { if (!open) openList(); }}
          onKeyDown={onKeyDown}
        />
        <span className="dropdown-caret ref-picker-caret" aria-hidden="true">▾</span>
      </div>
      {open && (
        <div
          className="dropdown-menu ref-picker-menu"
          role="listbox"
          id={`${reactId}-list`}
          ref={listRef}
          tabIndex={-1}
        >
          {items.map((o, i) => (
            <Fragment key={`${o.group}:${o.value}`}>
              {(i === 0 || items[i - 1].group !== o.group) && (
                <div className="ref-picker-group" role="presentation">{o.group}</div>
              )}
              <div
                role="option"
                id={`${reactId}-opt-${i}`}
                aria-selected={o.value === value}
                className={`dropdown-item ref-picker-item${i === active ? ' active' : ''}${o.value === value ? ' selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                <span className="ref-picker-label">{o.label}</span>
                {o.hint && <span className="ref-picker-hint">{o.hint}</span>}
              </div>
            </Fragment>
          ))}
          {items.length === 0 && <div className="dropdown-empty">{t('No match.')}</div>}
          {total > items.length && (
            <div className="ref-picker-more">
              {tp('{count} more — keep typing to narrow.', { count: total - items.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}