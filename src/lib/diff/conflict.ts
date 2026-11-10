// Conflict-marker parsing for the simplified merge resolver.
// Handles default (ours/theirs) and diff3 (ours/base/theirs) marker styles.

export type ConflictRegion = {
  ours: string;
  theirs: string;
  base: string | null;
};

export type ConflictSegment =
  | { type: 'text'; text: string }
  | { type: 'conflict'; region: ConflictRegion };

const OURS_RE = /^<{7}(?: .*)?$/;
const BASE_RE = /^\|{7}(?: .*)?$/;
const SEP_RE = /^={7}$/;
const THEIRS_RE = /^>{7}(?: .*)?$/;

/** Split working-file content into text and conflict segments. */
export function parseConflictMarkers(content: string): ConflictSegment[] {
  const segments: ConflictSegment[] = [];
  let text: string[] = [];
  let region: { ours: string[]; base: string[]; theirs: string[]; hasBase: boolean } | null = null;
  let side: 'ours' | 'base' | 'theirs' = 'ours';

  const pushText = () => {
    if (text.length > 0) {
      segments.push({ type: 'text', text: text.join('\n') });
      text = [];
    }
  };

  for (const line of content.split('\n')) {
    if (region === null && OURS_RE.test(line)) {
      pushText();
      region = { ours: [], base: [], theirs: [], hasBase: false };
      side = 'ours';
      continue;
    }
    if (region !== null && SEP_RE.test(line)) {
      side = 'theirs';
      continue;
    }
    if (region !== null && BASE_RE.test(line)) {
      side = 'base';
      region.hasBase = true;
      continue;
    }
    if (region !== null && THEIRS_RE.test(line)) {
      segments.push({
        type: 'conflict',
        region: {
          ours: region.ours.join('\n'),
          base: region.hasBase ? region.base.join('\n') : null,
          theirs: region.theirs.join('\n'),
        },
      });
      region = null;
      continue;
    }
    if (region !== null) {
      region[side].push(line);
    } else {
      text.push(line);
    }
  }
  pushText();
  return segments;
}

/** True when the working file contains conflict markers. */
export function hasConflictMarkers(content: string): boolean {
  return parseConflictMarkers(content).some((s) => s.type === 'conflict');
}

export type RegionDecision = 'ours' | 'theirs' | 'both';

/** Assemble the resolved text from per-region decisions. */
export function assembleResolved(segments: ConflictSegment[], decisions: RegionDecision[]): string {
  let regionIndex = 0;
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.type === 'text') {
      out.push(segment.text);
      continue;
    }
    const decision = decisions[regionIndex] ?? 'ours';
    const { ours, theirs } = segment.region;
    if (decision === 'ours') out.push(ours);
    else if (decision === 'theirs') out.push(theirs);
    else out.push([ours, theirs].filter((part) => part !== '').join('\n'));
    regionIndex += 1;
  }
  return out.join('\n');
}
