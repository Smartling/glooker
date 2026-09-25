import type { FetchedPropertiesResult, PropertyKeys, RawPropertyRow } from './types';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Maps GitHub custom-property rows to Glooker's internal fields using the configured keys.
 * Shared by the real and mock providers. */
export function mapPropertyRows(rows: RawPropertyRow[], keys: PropertyKeys): FetchedPropertiesResult {
  const keysSeen = { team: false, tier: false, codebase: false };
  const out = rows.map(r => {
    const p = new Map(r.properties.map(x => [x.property_name, x.value]));
    if (p.has(keys.team)) keysSeen.team = true;
    if (p.has(keys.tier)) keysSeen.tier = true;
    if (p.has(keys.codebase)) keysSeen.codebase = true;
    return {
      repoId: r.repoId, fullName: r.fullName,
      team: str(p.get(keys.team)), serviceTier: str(p.get(keys.tier)), codebaseType: str(p.get(keys.codebase)),
    };
  });
  return { rows: out, keysSeen };
}
