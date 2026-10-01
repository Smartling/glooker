// GLOOK-58: the one commit-type map. Replaces TYPE_HEX/TYPE_COLORS (org page), TYPE_COLORS/
// TYPE_TEXT_COLORS (dev page) and TYPE_COLORS (team dev-table), so a palette change reaches every
// surface at once. Marks (bars, wedges, swatches) and badges (text on a fill) use separate tokens:
// a mark only needs 3:1 against the card, a badge's text needs 4.5:1 against its own fill.
// Class names are written out in full so Tailwind's content scan finds them.
import { toNum } from './chart-format';

export const COMMIT_TYPE_ORDER = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight'] as const;
export type CommitType = (typeof COMMIT_TYPE_ORDER)[number];

const COLOR: Record<CommitType, string> = {
  feature: 'var(--chart-type-feature)',
  bug: 'var(--chart-type-bug)',
  refactor: 'var(--chart-type-refactor)',
  infra: 'var(--chart-type-infra)',
  docs: 'var(--chart-type-docs)',
  test: 'var(--chart-type-test)',
  other: 'var(--chart-type-other)',
  in_flight: 'var(--chart-type-in-flight)',
};

const BG: Record<CommitType, string> = {
  feature: 'bg-chart-type-feature',
  bug: 'bg-chart-type-bug',
  refactor: 'bg-chart-type-refactor',
  infra: 'bg-chart-type-infra',
  docs: 'bg-chart-type-docs',
  test: 'bg-chart-type-test',
  other: 'bg-chart-type-other',
  in_flight: 'bg-chart-type-in-flight',
};

const BADGE: Record<CommitType, { bg: string; text: string }> = {
  feature: { bg: 'bg-chart-badge-feature-bg', text: 'text-chart-badge-feature-text' },
  bug: { bg: 'bg-chart-badge-bug-bg', text: 'text-chart-badge-bug-text' },
  refactor: { bg: 'bg-chart-badge-refactor-bg', text: 'text-chart-badge-refactor-text' },
  infra: { bg: 'bg-chart-badge-infra-bg', text: 'text-chart-badge-infra-text' },
  docs: { bg: 'bg-chart-badge-docs-bg', text: 'text-chart-badge-docs-text' },
  test: { bg: 'bg-chart-badge-test-bg', text: 'text-chart-badge-test-text' },
  other: { bg: 'bg-chart-badge-other-bg', text: 'text-chart-badge-other-text' },
  in_flight: { bg: 'bg-chart-badge-in-flight-bg', text: 'text-chart-badge-in-flight-text' },
};

export function normalizeType(t: string): CommitType {
  return (COMMIT_TYPE_ORDER as readonly string[]).includes(t) ? (t as CommitType) : 'other';
}

/** Mark colour (bars, wedges, lines, swatches). */
export function commitTypeColor(t: string): string {
  return COLOR[normalizeType(t)];
}

/** Mark colour as a background class, for HTML bar segments. */
export function commitTypeBg(t: string): string {
  return BG[normalizeType(t)];
}

/** Badge fill and text classes (text on a coloured fill, 4.5:1). */
export function commitTypeBadge(t: string): { bg: string; text: string } {
  return BADGE[normalizeType(t)];
}

/** Sum type counts across rows; unknown types count as other. */
export function foldTypes(list: Array<Record<string, unknown>>): Record<CommitType, number> {
  const out = Object.fromEntries(COMMIT_TYPE_ORDER.map(t => [t, 0])) as Record<CommitType, number>;
  for (const types of list) {
    for (const [t, n] of Object.entries(types ?? {})) out[normalizeType(t)] += toNum(n);
  }
  return out;
}

/**
 * Folded, non-zero [type, count] rows in fixed COMMIT_TYPE_ORDER (spec Decision 13). Never sorted by
 * count: the palette gate validates neighbours in this order, so any other order could put two
 * unchecked colours side by side (other and in_flight are always neighbours here).
 */
export function typeEntriesFrom(list: Array<Record<string, unknown>>): [CommitType, number][] {
  const folded = foldTypes(list);
  return COMMIT_TYPE_ORDER
    .filter(t => folded[t] > 0)
    .map(t => [t, folded[t]] as [CommitType, number]);
}
