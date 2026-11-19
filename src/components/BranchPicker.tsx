// Branch combobox, ported from pr-helper render/editor.ts: a free-text input
// (wildcard source rules stay typable) plus a toggleable list of the
// repository's real branches, filtered by the typed text. Without branches
// (no PAT / failed read) it degrades to the plain input the editor had before.
import { useEffect, useRef, useState } from 'react';
import { useEscape } from '../hooks/use-escape';
import { IconChevronDown } from './icons';
import { t } from '../i18n';

export function filterBranches(branches: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...branches];
  return branches.filter((branch) => branch.toLowerCase().includes(needle));
}

export default function BranchPicker({ value, onChange, branches, placeholder, disabled, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  branches: string[] | null;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The open list joins the Escape stack above the editor, so Esc closes only
  // the list, not the whole editor.
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  const options = branches ? filterBranches(branches, value) : [];
  const showList = open && branches !== null && !disabled;
  return (
    <div className="branch-picker" ref={pickerRef}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-label={ariaLabel}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {branches ? (
        <button
          type="button"
          className="branch-picker-toggle"
          tabIndex={-1}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={showList}
          onClick={() => {
            if (showList) {
              setOpen(false);
            } else {
              inputRef.current?.focus();
              setOpen(true);
            }
          }}
        >
          <IconChevronDown width={12} height={12} />
        </button>
      ) : null}
      {showList ? (
        <div className="branch-options" role="listbox" aria-label={ariaLabel}>
          {options.length ? options.map((branch) => (
            <button
              key={branch}
              type="button"
              role="option"
              aria-selected={branch === value}
              className={branch === value ? 'is-active' : ''}
              onClick={() => {
                onChange(branch);
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              {branch}
            </button>
          )) : <p className="branch-options-empty">{t('No matching branches')}</p>}
        </div>
      ) : null}
    </div>
  );
}