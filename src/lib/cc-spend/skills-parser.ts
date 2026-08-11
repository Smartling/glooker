/**
 * Skills counts arrive scattered across per-product buckets on each
 * /v1/organizations/analytics/users row, not as one top-level field, and the set
 * of buckets grows over time. So rather than mapping known fields, walk the row
 * and emit an entry wherever a node carries either skills counter. A new product
 * bucket is then picked up with no code change.
 *
 * Note chat reports only `distinct_skills_used_count` (no total), so its `used`
 * is legitimately 0.
 */
export interface SkillsProductUsage {
  product: string;
  used: number;
  distinct: number;
}

const USED_KEY = 'skills_used_count';
const DISTINCT_KEY = 'distinct_skills_used_count';

/**
 * Matches cc_skills_usage.product's MySQL column width (VARCHAR(191), the
 * widest safely indexable under utf8mb4). `product` is a dotted walk path with
 * no length ceiling by design (see the module doc comment), so an unusually
 * deep bucket is truncated here — applied identically to both DB backends —
 * rather than left to fail only on MySQL, whose column has an actual cap
 * where SQLite's TEXT column does not.
 */
const MAX_PRODUCT_LENGTH = 191;

const toCount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function extractSkillsEntries(row: Record<string, any> | null | undefined): SkillsProductUsage[] {
  const out: SkillsProductUsage[] = [];

  const visit = (node: any, pathSegments: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    // If any immediate child also carries a counter, this node is an
    // intermediate bucket (e.g. `office_metrics` wrapping `office_metrics.excel`)
    // rather than the leaf the counter actually describes. Emitting both would
    // double-count: only the deepest node carrying counters is emitted.
    const childHasCounters = Object.values(node).some(
      (v) => v && typeof v === 'object' && !Array.isArray(v) && (USED_KEY in v || DISTINCT_KEY in v),
    );

    if (pathSegments.length > 0 && !childHasCounters && (USED_KEY in node || DISTINCT_KEY in node)) {
      const used = toCount(node[USED_KEY]);
      const distinct = toCount(node[DISTINCT_KEY]);
      // Absence means "no usage" — skipping zeros keeps the table small and
      // makes a present row meaningful.
      if (used > 0 || distinct > 0) {
        const product = pathSegments.map(s => s.replace(/_metrics$/, '')).join('.').slice(0, MAX_PRODUCT_LENGTH);
        out.push({ product, used, distinct });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value, [...pathSegments, key]);
      }
    }
  };

  visit(row, []);
  return out;
}
