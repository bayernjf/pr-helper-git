// PR reference chip (P3-14 / M-F19): hover/focus shows the full URL with an
// explicit open link; clicking the chip copies the URL. This mirrors the
// original pr-helper `pr-reference.ts` behaviour without its global DOM
// listeners, so the chip can be rendered anywhere in React.
import { useState } from 'react';
import { t } from '../i18n';
import { useToast } from './ui';

function fallbackCopy(value: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export default function PullReference({ url, label }: { url: string; label?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const copy = async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = fallbackCopy(url);
    if (copied) toast.notify(t('PR link copied'));
    else toast.error(t('Copy failed'));
  };

  return (
    <span
      className="pr-ref-wrap"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className="pr-ref"
        aria-label={t('Copy PR link')}
        onClick={(event) => { event.stopPropagation(); void copy(); }}
      >
        {label ?? url}
      </button>
      {open ? (
        <span className="pr-ref-tip" role="tooltip">
          <code>{url}</code>
          <a href={url} target="_blank" rel="noreferrer">{t('Open PR')}</a>
        </span>
      ) : null}
    </span>
  );
}
