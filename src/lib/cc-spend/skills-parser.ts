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

const toCount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function extractSkillsEntries(row: Record<string, any> | null | undefined): SkillsProductUsage[] {
  const out: SkillsProductUsage[] = [];

  const visit = (node: any, pathSegments: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    if (pathSegments.length > 0 && (USED_KEY in node || DISTINCT_KEY in node)) {
      const used = toCount(node[USED_KEY]);
      const distinct = toCount(node[DISTINCT_KEY]);
      // Absence means "no usage" — skipping zeros keeps the table small and
      // makes a present row meaningful.
      if (used > 0 || distinct > 0) {
        out.push({ product: pathSegments.map(s => s.replace(/_metrics$/, '')).join('.'), used, distinct });
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
