// Formatting helpers (pure functions).

export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

export function formatFullDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  const units: Array<[number, string]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.345, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let value = diffSec;
  let unit = 'second';
  for (const [size, name] of units) {
    if (value < size) {
      unit = name;
      break;
    }
    value = Math.round(value / size);
    unit = name;
  }
  if (value < 60 && unit === 'second') return 'just now';
  const rounded = Math.max(1, value);
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
}

export function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
