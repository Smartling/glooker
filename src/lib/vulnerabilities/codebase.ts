import { getVulnConfig } from './config';
import type { CodebaseGroup, CodebaseGroups } from './types';

// Re-exported for server callers (queries.ts, aggregate.ts, sync.ts). Client (.tsx) code must
// import these from './codebase-labels' instead, so it never pulls config.ts's process.env
// parsing into the client bundle.
export { CODEBASE_GROUPS, CODEBASE_LABELS } from './codebase-labels';

export function codebaseGroupOf(codebaseType: string | null, groups: CodebaseGroups = getVulnConfig().codebaseGroups): Exclude<CodebaseGroup, 'all'> {
  if (codebaseType === null) return 'other';
  for (const g of ['backend', 'frontend', 'shared'] as const) {
    if (groups[g].includes(codebaseType)) return g;
  }
  return 'other';
}

export function inCodebaseView(codebaseType: string | null, view: CodebaseGroup): boolean {
  return view === 'all' || codebaseGroupOf(codebaseType) === view;
}

export function isInScope(tier: string | null, inScope: string = getVulnConfig().tierInScope): boolean {
  return tier === inScope;
}
