// Multi-word AND matching used by the command palette. Every
// whitespace-separated term must appear in the searchable text. The match
// is case-insensitive and order-independent across terms.
export function matchesCommand(searchText: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = searchText.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
