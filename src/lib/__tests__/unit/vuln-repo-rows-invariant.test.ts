// GLOOK-64: the repository rows must sum to the team pivot, per team and per severity, for every
// filter combination. Fixtures are invented (no real org data) and cover every row kind: a
// zero-alert repo, an unmeasured repo that still has stored open alerts, an archived repo with
// alerts, an out-of-scope repo, a repo with no team and a repo with no codebase type.
import { computePivot, computeRepoRows, computeCodebaseCounts, listAlerts } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import { CODEBASE_GROUPS } from '@/lib/vulnerabilities/codebase-labels';
import type { AlertFact, RepoFact, CodebaseGroup, Severity } from '@/lib/vulnerabilities/types';

const NOW = new Date('2026-09-22T12:00:00Z');
const POLICY_BOTH_ACTIVE = JSON.stringify([
  { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
  { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
]);
const POLICY_CRITICAL_ONLY = JSON.stringify([{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 }]);
const PRIOR_POLICY = process.env.VULNERABILITIES_SLA_POLICY;
const PRIOR_SINCE = process.env.VULN_RESOLVED_SINCE;
const usePolicy = (policy: string | undefined) => {
  if (policy === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = policy;
  __clearVulnConfigCache();
};
beforeEach(() => { process.env.VULN_RESOLVED_SINCE = '2020-01-08'; usePolicy(POLICY_BOTH_ACTIVE); });
afterEach(() => {
  if (PRIOR_SINCE === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = PRIOR_SINCE;
  usePolicy(PRIOR_POLICY);
});

const repo = (repoId: number, fullName: string, over: Partial<RepoFact> = {}): RepoFact => ({
  repoId, fullName, team: 'Payments', serviceTier: 'production', codebaseType: 'backend', archived: false,
  dependabotStatus: 'ok', dependabotStatusDetail: null, carriedResolvedCritical: 0, ...over,
});
const alert = (repoId: number, number: number, over: Partial<AlertFact> = {}): AlertFact => ({
  repoId, number, htmlUrl: `https://example.test/${repoId}/${number}`, state: 'open', severity: 'critical', severityChangedAt: null,
  ghsaId: `GHSA-${repoId}-${number}`, cveId: `CVE-${repoId}-${number}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false,
  packageName: 'pkg', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
  createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false,
  ...over,
});

const REPOS: RepoFact[] = [
  repo(1, 'acme/checkout-api', { team: 'Payments' }),
  repo(2, 'acme/ledger', { team: 'Payments' }),
  repo(3, 'acme/search-indexer', { team: 'Search' }),
  repo(4, 'acme/search-ui', { team: 'Search', codebaseType: 'frontend' }),
  repo(5, 'acme/orphan', { team: null }),
  repo(6, 'acme/shared-kit', { team: 'Search', codebaseType: 'shared' }),
  repo(7, 'acme/untyped', { team: null, codebaseType: null }),
  repo(8, 'acme/quiet', { team: 'Payments' }),                                                                      // no alerts at all
  repo(9, 'acme/flaky', { team: 'Search', dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: boom' }),   // unmeasured, stored open alerts
  repo(10, 'acme/silent', { team: 'Payments', dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'off' }), // unmeasured, no alerts
  repo(11, 'acme/legacy', { team: 'Payments', archived: true, dependabotStatus: 'archived' }),                      // archived (the sync writes 'archived')
  repo(12, 'acme/internal', { team: 'Platform', serviceTier: 'non-production' }),                                   // outside the tracking scope
  repo(13, 'acme/kiosk', { team: 'Platform', codebaseType: 'mobile' }),                                             // a codebase type no group claims → Other
];
const NO_ALERT_REPOS = new Set([8, 10]);
const ALERTS: AlertFact[] = [
  ...REPOS.filter(r => !NO_ALERT_REPOS.has(r.repoId)).flatMap(r => {
    const n = (r.repoId % 4) + 2; // 2..5 open alerts per repo
    return Array.from({ length: n }, (_, i) => alert(r.repoId, i + 1, {
      severity: (i + r.repoId) % 3 === 0 ? 'high' : 'critical',
      // days 1..21 of September: a spread of overdue, due-soon and later alerts under both 7- and 9-day policies
      createdAt: `2026-09-${String(1 + ((i * 5 + r.repoId * 3) % 21)).padStart(2, '0')}T00:00:00Z`,
    }));
  }),
  // the due-soon window's edges: due exactly DUE_SOON_DAYS days out (7 under the 7-day critical policy: counted) and
  // 8 days out (high, 9-day policy: not yet due soon)
  alert(1, 93, { severity: 'critical', createdAt: '2026-09-22T00:00:00Z' }),
  alert(1, 94, { severity: 'high', createdAt: '2026-09-21T00:00:00Z' }),
  alert(1, 90, { state: 'fixed', resolvedAt: '2026-09-10T00:00:00Z' }),
  alert(1, 91, { missing: true }),
  alert(3, 92, { state: 'dismissed', resolvedAt: '2026-09-11T00:00:00Z', dismissedReason: 'tolerable_risk' }),
];

const CODEBASES: CodebaseGroup[] = ['backend', 'frontend', 'shared', 'other', 'all'];
const TEAMS: Array<string | undefined> = [undefined, 'Payments', 'Search', 'Unassigned', 'Platform'];
const SEVS: Severity[] = ['critical', 'high'];

/** A pivot cell that is null (SLA inactive) must be null in every repository row; otherwise the rows must add up to it. */
function expectRowsMatchCell<T>(rows: T[], figure: (r: T) => number | null, pivotCell: number | null): void {
  if (pivotCell === null) {
    expect(rows.every(r => figure(r) === null)).toBe(true);
  } else {
    expect(rows.reduce((n, r) => n + (figure(r) as number), 0)).toBe(pivotCell);
  }
}

describe('the fixtures are not vacuous', () => {
  it('exercise overdue, due-soon, unmeasured-with-alerts, zero-alert and every kind of exclusion', () => {
    const { total } = computePivot(ALERTS, REPOS, { codebase: 'all', now: NOW });
    expect(total.critical.open).toBeGreaterThan(5);
    expect(total.high.open).toBeGreaterThan(5);
    expect(total.critical.overdue).toBeGreaterThan(0);
    expect(total.critical.dueSoon).toBeGreaterThan(0);
    expect(total.high.overdue).toBeGreaterThan(0);
    expect(total.high.dueSoon).toBeGreaterThan(0);
    expect(total.unmeasuredRepos).toBe(2);
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    const flaky = rows.find(r => r.fullName === 'acme/flaky')!;
    expect(flaky.critical.open + flaky.high.open).toBeGreaterThan(0);
    expect(rows.find(r => r.fullName === 'acme/quiet')).toMatchObject({ critical: { open: 0 }, high: { open: 0 } });
    expect(rows.map(r => r.fullName)).not.toContain('acme/legacy');
    expect(rows.map(r => r.fullName)).not.toContain('acme/internal');
  });
});

describe('repository rows sum to the team pivot (GLOOK-64 invariant)', () => {
  const combos = CODEBASES.flatMap(c => TEAMS.map(t => [c, t] as const));
  it.each(combos)('codebase=%s team=%s: open, overdue and dueSoon sum per team and severity; unmeasured rows count to unmeasuredRepos', (codebase, team) => {
    const { rows: teamRows } = computePivot(ALERTS, REPOS, { codebase, team, now: NOW });
    const repoRows = computeRepoRows(ALERTS, REPOS, { codebase, team, now: NOW });
    // every repository row belongs to a pivot row, so no repository can be missing from the comparison
    for (const r of repoRows) expect(teamRows.map(t => t.team)).toContain(r.team);
    for (const t of teamRows) {
      const mine = repoRows.filter(r => r.team === t.team);
      for (const sev of SEVS) {
        expectRowsMatchCell(mine, r => r[sev].open, t[sev].open);
        expectRowsMatchCell(mine, r => r[sev].overdue, t[sev].overdue);
        expectRowsMatchCell(mine, r => r[sev].dueSoon, t[sev].dueSoon);
      }
      expect(mine.filter(r => r.unmeasured).length).toBe(t.unmeasuredRepos);
    }
  });

  it('is null in both places when a severity SLA is inactive: a critical-only policy leaves high null in rows and pivot', () => {
    usePolicy(POLICY_CRITICAL_ONLY);
    const { total } = computePivot(ALERTS, REPOS, { codebase: 'all', now: NOW });
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    expect(total.high.overdue).toBeNull();
    expect(total.high.dueSoon).toBeNull();
    expect(rows.every(r => r.high.overdue === null && r.high.dueSoon === null && r.high.nextDue === null)).toBe(true);
    expect(total.critical.overdue).not.toBeNull();
    expect(rows.every(r => r.critical.overdue !== null)).toBe(true);
  });

  it('is null in both places when there is no policy at all', () => {
    usePolicy(undefined);
    const { total } = computePivot(ALERTS, REPOS, { codebase: 'all', now: NOW });
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    for (const sev of SEVS) {
      expect(total[sev].overdue).toBeNull();
      expect(rows.every(r => r[sev].overdue === null && r[sev].dueSoon === null)).toBe(true);
    }
  });
});

describe('independent cross-check through listAlerts', () => {
  it("each repository row's open equals the open-alert totalCount of listAlerts for that repo and severity, unmeasured repos included", () => {
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) {
      for (const sev of SEVS) {
        const listed = listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: r.fullName, severity: sev }, NOW);
        expect(listed.totalCount).toBe(r[sev].open);
      }
    }
    const flaky = rows.find(r => r.fullName === 'acme/flaky')!;
    expect(flaky.unmeasured).not.toBeNull();
    expect(listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: 'acme/flaky' }, NOW).totalCount).toBe(flaky.critical.open + flaky.high.open);
  });

  it('overdue per repository equals the overdue-filtered list for that repository', () => {
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    for (const r of rows) {
      for (const sev of SEVS) {
        const listed = listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: r.fullName, severity: sev, overdue: true }, NOW);
        expect(listed.totalCount).toBe(r[sev].overdue);
      }
    }
  });

  it('dueSoon per repository equals the dueSoon-filtered list for that repository, and the check is not vacuous', () => {
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    let dueSoonSeen = 0;
    for (const r of rows) {
      for (const sev of SEVS) {
        const listed = listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: r.fullName, severity: sev, dueSoon: true }, NOW);
        expect(listed.totalCount).toBe(r[sev].dueSoon);
        dueSoonSeen += listed.totalCount;
      }
    }
    expect(dueSoonSeen).toBeGreaterThan(0);
    // at least one repository has a due-soon alert in each severity, so neither severity is checked against zero only
    for (const sev of SEVS) expect(rows.some(r => (r[sev].dueSoon ?? 0) > 0)).toBe(true);
  });
});

describe('computeCodebaseCounts', () => {
  it.each(TEAMS)('team=%s: counts[c] equals the pivot total open for codebase c, for both severities', (team) => {
    const counts = computeCodebaseCounts(ALERTS, REPOS, { team, now: NOW });
    expect(Object.keys(counts).sort()).toEqual([...CODEBASE_GROUPS].sort());
    for (const c of CODEBASES) {
      const { total } = computePivot(ALERTS, REPOS, { codebase: c, team, now: NOW });
      expect(counts[c]).toEqual({ critical: total.critical.open, high: total.high.open });
    }
  });

  it('ignores the codebase filter but honours team, and counts a null codebase type under other and all', () => {
    const unassigned = computeCodebaseCounts(ALERTS, REPOS, { team: 'Unassigned', now: NOW });
    // acme/orphan (backend) and acme/untyped (no codebase type) are the Unassigned repos.
    expect(unassigned.backend.critical + unassigned.backend.high).toBeGreaterThan(0);
    expect(unassigned.other.critical + unassigned.other.high).toBeGreaterThan(0); // acme/untyped
    expect(unassigned.frontend).toEqual({ critical: 0, high: 0 });
    const all = computeCodebaseCounts(ALERTS, REPOS, { now: NOW });
    expect(all.all.critical).toBe(all.backend.critical + all.frontend.critical + all.shared.critical + all.other.critical);
    expect(all.all.high).toBe(all.backend.high + all.frontend.high + all.shared.high + all.other.high);
  });
});
