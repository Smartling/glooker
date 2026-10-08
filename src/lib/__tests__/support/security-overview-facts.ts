// src/lib/__tests__/support/security-overview-facts.ts
// One self-consistent set of repositories and alerts for the Overview's cross-section test: it is fed through the REAL
// computePivot and computeRepoRows, so the team table, the repositories footer and the Open tile can be compared on
// numbers that came from one data set. Invented names only (acme/..., Payments, Search, Platform): this repository is public.
import type { AlertFact, RepoFact, Severity } from '@/lib/vulnerabilities/types';

export const OV_FACTS_NOW = new Date('2026-09-22T12:00:00Z');

const repo = (repoId: number, fullName: string, team: string, over: Partial<RepoFact> = {}): RepoFact => ({
  repoId, fullName, team, serviceTier: 'production', codebaseType: 'backend', archived: false,
  dependabotStatus: 'ok', dependabotStatusDetail: null, carriedResolvedCritical: 0, ...over,
});

const alert = (repoId: number, number: number, severity: Severity, over: Partial<AlertFact> = {}): AlertFact => ({
  repoId, number, htmlUrl: `https://example.test/${repoId}/${number}`, state: 'open', severity, severityChangedAt: null,
  ghsaId: `GHSA-${repoId}-${number}`, cveId: `CVE-${repoId}-${number}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false,
  packageName: 'pkg', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
  createdAt: '2026-09-10T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false,
  ...over,
});

/** `n` open alerts of one severity in one repository. */
const open = (repoId: number, severity: Severity, n: number, first = 1): AlertFact[] =>
  Array.from({ length: n }, (_, i) => alert(repoId, first + i, severity, { createdAt: `2026-09-${String(1 + ((first + i) % 20)).padStart(2, '0')}T00:00:00Z` }));

export const OV_REPOS: RepoFact[] = [
  repo(1, 'acme/checkout-api', 'Payments'),
  repo(2, 'acme/ledger', 'Payments'),
  repo(3, 'acme/quiet', 'Payments'),                                                                                   // nothing open
  repo(4, 'acme/search-index', 'Search'),
  repo(5, 'acme/flaky', 'Search', { dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: status check failed' }), // unmeasured, but its stored alerts are still counted
  repo(6, 'acme/build-tools', 'Platform'),
];

export const OV_ALERTS: AlertFact[] = [
  ...open(1, 'critical', 3), ...open(1, 'high', 2, 10),
  ...open(2, 'critical', 1), alert(2, 50, 'critical', { state: 'fixed', resolvedAt: '2026-09-12T00:00:00Z' }),
  ...open(4, 'critical', 2), ...open(4, 'high', 4, 10),
  ...open(5, 'critical', 3), ...open(5, 'high', 1, 10),
  ...open(6, 'critical', 4), ...open(6, 'high', 3, 10),
];

/** The independent count: open alerts of `severity`, in scope, of one team (or of every team). Reads the facts, not the aggregate. */
export function ovExpectedOpen(severity: Severity, team: string | null): number {
  const teamOf = new Map(OV_REPOS.map(r => [r.repoId, r.team]));
  return OV_ALERTS.filter(a => a.state === 'open' && !a.missing && a.severity === severity && (team === null || teamOf.get(a.repoId) === team)).length;
}
