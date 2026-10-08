import { computePivot, computeKpi, computeCoverage, computeRepoRows, listAlerts, knownTeams, isResolvedSinceStart, isSlaActive } from '@/lib/vulnerabilities/aggregate';
import type { TeamRow, RepoRow } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import type { AlertFact, RepoFact } from '@/lib/vulnerabilities/types';

// sla.ts/aggregate.ts now default to getVulnConfig().slaPolicy /
// .resolvedSince (both neutral-empty unless configured), instead of the old checked-in
// policy.ts constants. Every test in this file that (implicitly, via the default parameter)
// exercises a due date or a "resolved since" cutoff needs that configuration injected via env +
// __clearVulnConfigCache. Per the public-repo date convention, the file-wide default policy below
// is a *pending* one (a 2099-* effectiveFrom — "use 2099-* dates for examples"), never a plausible
// near-future date. computeDue doesn't care whether an entry is pending or active, so this alone
// still produces a real due date for every default-created alert (its clock anchors at the policy
// start, since every default createdAt in this file is a 2026 date, well before 2099); only the
// two tests that specifically need slaStatus === 'active' (real, non-null overdue/dueSoon on
// computePivot's output) override to a *past* policy (2020-01-08 — "past synthetic dates such as
// 2020-01-08 where a test needs a policy already in effect") for the duration of that one test.
const SYNTHETIC_POLICY = JSON.stringify([{ id: 'critical-2099-04', severity: 'critical', effectiveFrom: '2099-04-15', days: 7 }]);
const SYNTHETIC_ACTIVE_POLICY = JSON.stringify([{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 }]);
const SYNTHETIC_RESOLVED_SINCE = '2020-01-08';
const PRIOR_SLA_POLICY = process.env.VULNERABILITIES_SLA_POLICY;
const PRIOR_RESOLVED_SINCE = process.env.VULN_RESOLVED_SINCE;
beforeEach(() => {
  process.env.VULNERABILITIES_SLA_POLICY = SYNTHETIC_POLICY;
  process.env.VULN_RESOLVED_SINCE = SYNTHETIC_RESOLVED_SINCE;
  __clearVulnConfigCache();
});
afterEach(() => {
  if (PRIOR_SLA_POLICY === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = PRIOR_SLA_POLICY;
  if (PRIOR_RESOLVED_SINCE === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = PRIOR_RESOLVED_SINCE;
  __clearVulnConfigCache();
});
/** Switches to the "already active" synthetic policy for the rest of the current test only — the
 * next test's beforeEach resets back to the file default (SYNTHETIC_POLICY) regardless. Only the
 * two tests that need a real (non-null) overdue/dueSoon call this. */
function useActivePolicy(): void {
  process.env.VULNERABILITIES_SLA_POLICY = SYNTHETIC_ACTIVE_POLICY;
  __clearVulnConfigCache();
}

const R = (repoId: number, over: Partial<RepoFact> = {}): RepoFact => ({
  repoId, fullName: `o/r${repoId}`, team: 'T1', serviceTier: 'production', codebaseType: 'backend',
  archived: false, dependabotStatus: 'ok', dependabotStatusDetail: null, carriedResolvedCritical: 0, ...over,
});
const A = (repoId: number, n: number, over: Partial<AlertFact> = {}): AlertFact => ({
  repoId, number: n, htmlUrl: `u${n}`, state: 'open', severity: 'critical', severityChangedAt: null,
  ghsaId: `G${n}`, cveId: `CVE-${n}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false,
  packageName: 'pkg', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: null,
  createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false,
  ...over,
});
const NOW = new Date('2026-09-22T12:00:00Z');

const repos = [
  R(1), R(2, { team: 'T2' }), R(3, { team: null }), R(4, { codebaseType: 'frontend' }),
  R(5, { archived: true }), R(6, { dependabotStatus: 'error' }), R(7, { serviceTier: 'non-production', team: 'T9' }),
];
const alerts = [
  A(1, 1), A(1, 2, { state: 'fixed', resolvedAt: '2026-09-10T00:00:00Z' }),
  A(1, 3, { state: 'dismissed', resolvedAt: '2026-09-11T00:00:00Z', dismissedReason: 'tolerable_risk' }),
  A(1, 4, { state: 'fixed', resolvedAt: '2019-09-01T00:00:00Z' }),           // before the configured "since"
  A(1, 5, { state: 'fixed', resolvedAt: '2026-09-10T00:00:00Z', withdrawn: true }),
  A(1, 6, { missing: true }),
  A(2, 1, { severity: 'high' }),
  A(3, 1), A(4, 1), A(5, 1), A(5, 2, { state: 'fixed', resolvedAt: '2026-09-12T00:00:00Z' }), A(7, 1),
];

describe('computePivot (Backend view)', () => {
  // computePivot's default-parameter config read happens per call, not at module-collection time —
  // so this is recomputed in beforeEach (after the file-level beforeEach above has set env), not in
  // the describe body itself (which would run at collection time, before any hook).
  let rows: TeamRow[]; let total: TeamRow; let t1: TeamRow;
  beforeEach(() => {
    ({ rows, total } = computePivot(alerts, repos, { codebase: 'backend', now: NOW }));
    t1 = rows.find(r => r.team === 'T1')!;
  });

  it('counts open (excluding missing and archived) and resolved since start (excluding withdrawn and pre-start)', () => {
    expect(t1.critical.open).toBe(1);        // A(1,1); A(1,6) missing; A(5,1) archived
    expect(t1.critical.resolved).toBe(3);    // A(1,2), A(1,3), A(5,2)
    expect(t1.critical.dismissed).toBe(1);   // A(1,3)
    expect(t1.critical.pctClosed).toBe(75);  // 3 / (1 + 3)
  });
  it('makes Unassigned a real row and excludes frontend and non-production repos', () => {
    expect(rows.map(r => r.team).sort()).toEqual(['T1', 'T2', 'Unassigned']);
    expect(total.critical.open).toBe(2);     // A(1,1) + A(3,1)
  });
  it('Total % closed is computed from summed counts, not averaged across teams', () => {
    expect(total.critical.resolved).toBe(3);
    expect(total.critical.pctClosed).toBe(60); // 3 / (2 + 3); an average of team percentages would differ
  });
  it('pctClosed is null when the denominator is 0; overdue is null while the SLA is pending', () => {
    const t2 = rows.find(r => r.team === 'T2')!;
    expect(t2.critical.pctClosed).toBeNull();
    expect(t1.critical.overdue).toBeNull();
    expect(t2.high.overdue).toBeNull();
  });
  it('flags unmeasured repos on their team row and the total', () => {
    expect(t1.unmeasuredRepos).toBe(1);      // repo 6
    expect(total.unmeasuredRepos).toBe(1);
  });
});

it('overdue and dueSoon count once the SLA is active', () => {
  useActivePolicy(); // this test needs slaStatus === 'active', unlike the rest of the file
  const late = new Date('2026-09-15T00:00:00Z');
  const { total } = computePivot([A(1, 1)], [R(1)], { codebase: 'backend', now: late });
  expect(total.critical.overdue).toBe(1);    // due 2026-09-08 (clock at created_at: policy already active)
  const soon = new Date('2026-09-05T00:00:00Z');
  expect(computePivot([A(1, 1)], [R(1)], { codebase: 'backend', now: soon }).total.critical.dueSoon).toBe(1);
});

it('a reopened alert keeps its original clock: reopened after the due date → overdue immediately', () => {
  useActivePolicy(); // this test needs slaStatus === 'active', unlike the rest of the file
  const now = new Date('2026-09-15T00:00:00Z');
  const reopened = A(1, 1, { createdAt: '2026-09-01T00:00:00Z', reopenedCount: 1, lastReopenedAt: '2026-09-10T00:00:00Z' });
  expect(computePivot([reopened], [R(1)], { codebase: 'backend', now }).total.critical.overdue).toBe(1);
  const [row] = listAlerts([reopened], [R(1)], { codebase: 'backend', state: 'open' }, now).rows;
  expect(row).toMatchObject({ dueDate: '2026-09-08', daysRemaining: -7 });
});

it('counts every dependency scope; null is filterable as "unknown"', () => {
  const scoped = [A(1, 1, { scope: 'runtime' }), A(1, 2, { scope: 'development' }), A(1, 3, { scope: null })];
  expect(computePivot(scoped, [R(1)], { codebase: 'backend', now: NOW }).total.critical.open).toBe(3);
  expect(listAlerts(scoped, [R(1)], { codebase: 'backend', state: 'open', dependencyScope: 'unknown' }, NOW).totalCount).toBe(1);
  expect(listAlerts(scoped, [R(1)], { codebase: 'backend', state: 'open', dependencyScope: 'runtime' }, NOW).totalCount).toBe(1);
});

it('computeKpi counts open critical outside the view; null under All', () => {
  expect(computeKpi(alerts, repos, { codebase: 'backend', now: NOW }).openCriticalOtherCodebases).toBe(1); // repo 4
  expect(computeKpi(alerts, repos, { codebase: 'all', now: NOW }).openCriticalOtherCodebases).toBeNull();
});

it('computeKpi is team-scoped: repo 4 (the only out-of-view open critical) belongs to T1', () => {
  expect(computeKpi(alerts, repos, { codebase: 'backend', team: 'T2', now: NOW }).openCriticalOtherCodebases).toBe(0);
  expect(computeKpi(alerts, repos, { codebase: 'backend', team: 'T1', now: NOW }).openCriticalOtherCodebases).toBe(1);
});

it('computeCoverage lists needs-tagging, excluded-by-policy and unmeasured repos', () => {
  const c = computeCoverage(alerts, repos, {});
  expect(c.needsTagging.map(r => r.fullName)).toEqual(['o/r3']);
  expect(c.excludedByPolicy.map(r => [r.fullName, r.team])).toEqual([['o/r7', 'T9']]);
  expect(c.unmeasured.map(r => r.fullName)).toEqual(['o/r6']);
});

it('a dependabot-off repo counts as unmeasured (pivot and coverage), same as an error repo, and carries its status on the coverage row', () => {
  const rs = [
    R(10, { dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: x' }),
    R(11, { dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'Dependabot alerts are disabled for this repository.' }),
  ];
  const as = [A(10, 1), A(11, 1)];
  const { total } = computePivot(as, rs, { codebase: 'backend', now: NOW });
  expect(total.unmeasuredRepos).toBe(2);
  const c = computeCoverage(as, rs, {});
  expect(c.unmeasured.map(r => r.fullName).sort()).toEqual(['o/r10', 'o/r11']);
  const offRow = c.unmeasured.find(r => r.fullName === 'o/r11')!;
  expect(offRow.dependabotStatus).toBe('dependabot-off');
  const errRow = c.unmeasured.find(r => r.fullName === 'o/r10')!;
  expect(errRow.dependabotStatus).toBe('error');
});

describe('the repo facet on listAlerts', () => {
  const rs = [R(20, { team: 'T1' }), R(21, { team: 'T2' })];
  const as = [A(20, 1), A(20, 2), A(21, 1)];

  it('ignores the repo filter and the limit', () => {
    const withRepo = listAlerts(as, rs, { codebase: 'backend', state: 'open', repo: 'o/r20' }, NOW);
    expect(withRepo.repos).toEqual([{ repo: 'o/r20', count: 2 }, { repo: 'o/r21', count: 1 }]);
    const withLimit = listAlerts(as, rs, { codebase: 'backend', state: 'open', limit: 1 }, NOW);
    expect(withLimit.repos).toEqual([{ repo: 'o/r20', count: 2 }, { repo: 'o/r21', count: 1 }]);
  });

  it('respects every other filter: a team filter narrows it', () => {
    const r = listAlerts(as, rs, { codebase: 'backend', state: 'open', team: 'T2' }, NOW);
    expect(r.repos).toEqual([{ repo: 'o/r21', count: 1 }]);
  });

  it('sorts by count descending, then by name', () => {
    const rs2 = [R(30, { team: 'T1' }), R(31, { team: 'T1' }), R(32, { team: 'T1' })];
    const as2 = [A(30, 1), A(31, 1), A(31, 2), A(32, 1), A(32, 2)];
    const r = listAlerts(as2, rs2, { codebase: 'backend', state: 'open' }, NOW);
    expect(r.repos.map(x => x.repo)).toEqual(['o/r31', 'o/r32', 'o/r30']); // r31/r32 tie at 2, alphabetical; r30 is 1
  });
});

describe('carried resolved (archived repo, no stored alerts, imported CSV history)', () => {
  it("a qualifying repo's carry is added to its team's critical resolved and to the total, and pctClosed uses it", () => {
    const repo = R(40, { archived: true, carriedResolvedCritical: 6 });
    const { rows, total } = computePivot([], [repo], { codebase: 'backend', now: NOW });
    expect(rows[0].critical.resolved).toBe(6);
    expect(rows[0].critical.carriedResolved).toBe(6);
    expect(total.critical.resolved).toBe(6);
    expect(total.critical.carriedResolved).toBe(6);
    expect(total.critical.pctClosed).toBe(100); // 6 / (0 + 6)
  });

  it('an archived repo with a stored alert gets no carry, even though the field is nonzero', () => {
    const repo = R(41, { archived: true, carriedResolvedCritical: 5 });
    const storedAlert = [A(41, 1)]; // any stored row disqualifies it, regardless of state
    const { total } = computePivot(storedAlert, [repo], { codebase: 'backend', now: NOW });
    expect(total.critical.carriedResolved).toBe(0);
    expect(total.critical.resolved).toBe(0);
  });

  it('a non-archived repo gets no carry, even though the field is (wrongly) nonzero', () => {
    const repo = R(42, { archived: false, carriedResolvedCritical: 8 });
    const { total } = computePivot([], [repo], { codebase: 'backend', now: NOW });
    expect(total.critical.carriedResolved).toBe(0);
    expect(total.critical.resolved).toBe(0);
  });

  it('high resolved is unchanged by the carry — there is no high counterpart', () => {
    const repo = R(43, { archived: true, carriedResolvedCritical: 4 });
    const { total } = computePivot([], [repo], { codebase: 'backend', now: NOW });
    expect(total.high.resolved).toBe(0);
    expect(total.high.carriedResolved).toBe(0);
  });

  it('the carry respects the codebase and team view filters', () => {
    const backendRepo = R(44, { archived: true, carriedResolvedCritical: 2, team: 'T1' });
    const frontendRepo = R(45, { archived: true, carriedResolvedCritical: 9, codebaseType: 'frontend', team: 'T2' });
    const both = [backendRepo, frontendRepo];
    expect(computePivot([], both, { codebase: 'backend', now: NOW }).total.critical.carriedResolved).toBe(2);
    expect(computePivot([], both, { codebase: 'all', team: 'T2', now: NOW }).total.critical.carriedResolved).toBe(9);
  });
});

describe('listAlerts', () => {
  it('defaults to open, backend; reports total, truncation and what the codebase filter excluded', () => {
    const r = listAlerts(alerts, repos, { codebase: 'backend', state: 'open', limit: 1 }, NOW);
    expect(r.totalCount).toBe(3);             // A(1,1), A(2,1), A(3,1)
    expect(r.rows).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(r.excludedByCodebase).toBe(1);     // A(4,1) is frontend
  });
  it('rows carry SLA fields, age and state', () => {
    const [row] = listAlerts([A(1, 1)], [R(1)], { codebase: 'backend', state: 'open' }, NOW).rows;
    expect(row).toMatchObject({ repo: 'o/r1', team: 'T1', dueDate: '2099-04-22', daysRemaining: 26510, slaPolicyId: 'critical-2099-04', ageDays: 21, state: 'open' });
  });
  it('filters by team, package, created_since, due_before, overdue, reopened, ghsa and text search', () => {
    const all = (f: any, now = NOW) => listAlerts(alerts, repos, { codebase: 'all', state: 'open', ...f }, now).totalCount;
    expect(all({ team: 'T2' })).toBe(1);
    expect(all({ packageName: 'nope' })).toBe(0);
    expect(all({ createdSince: '2026-09-02' })).toBe(0);
    expect(all({ severity: 'critical', dueBefore: '2099-04-23' })).toBe(3);        // A(1,1), A(3,1), A(4,1): due 2099-04-22
    expect(all({ overdue: true })).toBe(0);                                          // SLA not active on NOW
    expect(all({ overdue: true }, new Date('2099-04-25T00:00:00Z'))).toBe(3);       // the three criticals
    expect(all({ reopened: true })).toBe(0);
    expect(all({ ghsa: 'G1' })).toBe(4);                                             // ghsaId is `G${n}`: open #1 alerts in repos 1–4
    expect(all({ ghsa: 'G2' })).toBe(0);                                             // A(1,2) is resolved
    expect(all({ q: 'o/r4' })).toBe(1);
  });
});

it('resolvedSince filters resolved alerts by resolution date', () => {
  const rs = [A(1, 1, { state: 'fixed', resolvedAt: '2026-09-10T00:00:00Z' }), A(1, 2, { state: 'fixed', resolvedAt: '2026-09-20T00:00:00Z' })];
  const r = listAlerts(rs, [R(1)], { codebase: 'backend', state: 'resolved', resolvedSince: '2026-09-15' }, NOW);
  expect(r.rows.map(x => x.cveId)).toEqual(['CVE-2']);
});

it('pivot rows are ordered by critical.open desc, then team name', () => {
  const reposX = [R(1, { team: 'B' }), R(2, { team: 'A' }), R(3, { team: 'C' })];
  const alertsX = [A(1, 1), A(1, 2), A(2, 1), A(3, 1), A(3, 2)]; // B: 2 open, A: 1 open, C: 2 open
  const { rows } = computePivot(alertsX, reposX, { codebase: 'backend', now: NOW });
  expect(rows.map(r => r.team)).toEqual(['B', 'C', 'A']); // B and C tie at 2 open, alphabetical; A trails at 1
});

it('listAlerts urgency order — soonest due first, then newest first among ties', () => {
  const dueSoonest = A(1, 1, { createdAt: '2026-01-01T00:00:00Z' });            // clock at policy start → due 2099-04-22
  const dueLater = A(1, 2, { severity: 'high', createdAt: '2026-01-01T00:00:00Z' }); // high has no SLA entry → no due date
  const highOlder = A(1, 3, { severity: 'high', createdAt: '2026-01-01T00:00:00Z' });
  const highNewer = A(1, 4, { severity: 'high', createdAt: '2026-06-01T00:00:00Z' });
  const r = listAlerts([dueSoonest, dueLater, highOlder, highNewer], [R(1)], { codebase: 'backend', state: 'open' }, NOW);
  // The critical alert (a real due date) sorts before every high alert (no due date, treated as
  // least urgent). Among the two ties without a due date, newest createdAt sorts first.
  expect(r.rows.map(x => x.cveId)).toEqual(['CVE-1', 'CVE-4', 'CVE-2', 'CVE-3']);
});

it('dueSoon is open with 0-7 days remaining; an overdue alert does not match dueSoon', () => {
  const soon = new Date('2099-04-18T00:00:00Z'); // A(1,1) due 2099-04-22 → 4 days remaining
  expect(listAlerts([A(1, 1)], [R(1)], { codebase: 'backend', state: 'open', dueSoon: true }, soon).totalCount).toBe(1);
  const late = new Date('2099-04-25T00:00:00Z'); // due 2099-04-22 → overdue, not due soon
  expect(listAlerts([A(1, 1)], [R(1)], { codebase: 'backend', state: 'open', dueSoon: true }, late).totalCount).toBe(0);
  expect(listAlerts([A(1, 1)], [R(1)], { codebase: 'backend', state: 'open', dueSoon: false }, late).totalCount).toBe(1);
});

it('knownTeams includes Unassigned and in-scope teams', () => {
  expect(knownTeams(repos)).toEqual(['T1', 'T2', 'Unassigned']);
});

describe('isResolvedSinceStart / resolvedSinceInvalid', () => {
  it('since = null (all time) counts an old resolution', () => {
    const a = A(1, 1, { state: 'fixed', resolvedAt: '2001-01-01T00:00:00Z' });
    expect(isResolvedSinceStart(a, null)).toBe(true);
  });
  it('a since date later than the resolution excludes it', () => {
    const a = A(1, 1, { state: 'fixed', resolvedAt: '2001-01-01T00:00:00Z' });
    expect(isResolvedSinceStart(a, '2099-01-01')).toBe(false);
  });

  it("the computeKpi tile (computePivot's total): an invalid VULN_RESOLVED_SINCE nulls resolved, pctClosed and dismissed for both severities", () => {
    // Amendment #4 ("the computeKpi null test"): Kpi (computeKpi's return type) has no
    // resolved/pctClosed field — the KPI tile on vulnerabilities-content.tsx reads those from
    // computePivot's total instead, so this is the test that amendment maps to. See the task
    // report's concerns section.
    process.env.VULN_RESOLVED_SINCE = 'not-a-date';
    __clearVulnConfigCache();
    const repo = R(50);
    const resolved = A(50, 2, { state: 'fixed', resolvedAt: '2026-09-10T00:00:00Z' });
    // Fix round 2 (Finding 4): dismissed is a subset of resolved, so it must go null too, even
    // though this alert's own dismissed count is genuinely nonzero — proving the null isn't just
    // "there happened to be nothing dismissed".
    const dismissed = A(50, 3, { state: 'dismissed', resolvedAt: '2026-09-11T00:00:00Z', dismissedReason: 'tolerable_risk' });
    const { total } = computePivot([A(50, 1), resolved, dismissed], [repo], { codebase: 'backend', now: NOW });
    expect(total.critical.resolved).toBeNull();
    expect(total.critical.pctClosed).toBeNull();
    expect(total.critical.dismissed).toBeNull();
    expect(total.high.resolved).toBeNull();
    expect(total.high.pctClosed).toBeNull();
    expect(total.high.dismissed).toBeNull();
    // The open count and carriedResolved stay real numbers — only resolved/pctClosed/dismissed go null.
    expect(total.critical.open).toBe(1);
  });
});

describe('isSlaActive (the one SLA gate)', () => {
  it('is false while a policy is pending or absent, and true from its first effective day', () => {
    // File default policy: critical-2099-04 (pending on NOW) and no high entry at all.
    expect(isSlaActive('critical', NOW)).toBe(false);
    expect(isSlaActive('high', NOW)).toBe(false);
    expect(isSlaActive('critical', new Date('2099-04-14T23:59:59Z'))).toBe(false);
    expect(isSlaActive('critical', new Date('2099-04-15T00:00:00Z'))).toBe(true);
    expect(isSlaActive('high', new Date('2099-04-15T00:00:00Z'))).toBe(false);
  });

  it('the pivot nulls overdue and dueSoon exactly when the gate is closed', () => {
    for (const [policy, active] of [[SYNTHETIC_POLICY, false], [SYNTHETIC_ACTIVE_POLICY, true]] as const) {
      process.env.VULNERABILITIES_SLA_POLICY = policy;
      __clearVulnConfigCache();
      const { total } = computePivot([A(1, 1)], [R(1)], { codebase: 'backend', now: NOW });
      expect(isSlaActive('critical', NOW)).toBe(active);
      expect(total.critical.overdue === null).toBe(!active);
      expect(total.critical.dueSoon === null).toBe(!active);
      expect(total.high.overdue).toBeNull(); // neither policy has a high entry
    }
  });
});

// ---------- computeRepoRows (GLOOK-64) ----------
// Both severities active since 2020-01-08: critical 7 days, high 9 days.
const SYNTHETIC_BOTH_ACTIVE_POLICY = JSON.stringify([
  { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
  { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
]);
function useBothActivePolicy(): void {
  process.env.VULNERABILITIES_SLA_POLICY = SYNTHETIC_BOTH_ACTIVE_POLICY;
  __clearVulnConfigCache();
}
const names = (rows: RepoRow[]) => rows.map(r => r.fullName);

describe('computeRepoRows', () => {
  const rs = [
    R(1, { fullName: 'o/a-low' }), R(2, { fullName: 'o/b-many' }), R(3, { fullName: 'o/c-high' }), R(4, { fullName: 'o/d-zero' }),
    R(5, { fullName: 'o/e-unmeasured', dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'Dependabot alerts are disabled for this repository.' }),
    R(6, { fullName: 'o/f-unmeasured-err', dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: x' }),
    R(7, { fullName: 'o/z-archived', archived: true, dependabotStatus: 'archived' }),
    R(8, { fullName: 'o/a-tie' }),
    R(9, { fullName: 'o/nonprod', serviceTier: 'non-production' }),
  ];
  const as = [
    A(1, 1),
    A(2, 1), A(2, 2), A(2, 3),
    A(3, 1, { severity: 'high' }), A(3, 2, { severity: 'high' }),
    A(5, 1), A(5, 2), A(5, 3), A(5, 4), A(5, 5),   // unmeasured, more open than any measured repo
    A(7, 1), A(8, 1), A(9, 1),
  ];

  it('orders measured rows by critical open, then high open, then name, and unmeasured rows last by name', () => {
    expect(names(computeRepoRows(as, rs, { codebase: 'backend', now: NOW }))).toEqual([
      'o/b-many',            // 3 critical
      'o/a-low', 'o/a-tie',  // 1 critical each: tie broken by name
      'o/c-high',            // 0 critical, 2 high
      'o/d-zero',            // nothing open: still listed
      'o/e-unmeasured',      // 5 stored critical, but unmeasured rows always come last
      'o/f-unmeasured-err',
    ]);
  });

  it('lists repos with no open alerts, and leaves out archived and out-of-scope repos', () => {
    const rows = computeRepoRows(as, rs, { codebase: 'backend', now: NOW });
    const zero = rows.find(r => r.fullName === 'o/d-zero')!;
    expect(zero.critical.open).toBe(0);
    expect(zero.high.open).toBe(0);
    expect(zero.critical.oldestOpenDays).toBeNull();
    expect(names(rows)).not.toContain('o/z-archived'); // archived: has open-looking alerts, contributes nothing
    expect(names(rows)).not.toContain('o/nonprod');    // outside the configured tracking scope
  });

  it('an unmeasured repo carries its stored counts and its status, never a zero', () => {
    const rows = computeRepoRows(as, rs, { codebase: 'backend', now: NOW });
    const off = rows.find(r => r.fullName === 'o/e-unmeasured')!;
    expect(off.critical.open).toBe(5);
    expect(off.unmeasured).toEqual({ status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' });
    const err = rows.find(r => r.fullName === 'o/f-unmeasured-err')!;
    expect(err.critical.open).toBe(0);
    expect(err.unmeasured).toEqual({ status: 'error', detail: 'HTTP 500: x' });
    expect(rows.find(r => r.fullName === 'o/a-low')!.unmeasured).toBeNull();
  });

  it('while no SLA is active, overdue, dueSoon and nextDue are null but open and oldestOpenDays still count', () => {
    const rows = computeRepoRows(as, rs, { codebase: 'backend', now: NOW }); // file default: critical pending, high none
    for (const r of rows) {
      for (const cell of [r.critical, r.high]) {
        expect(cell.overdue).toBeNull();
        expect(cell.dueSoon).toBeNull();
        expect(cell.nextDue).toBeNull();
      }
    }
    const many = rows.find(r => r.fullName === 'o/b-many')!;
    expect(many.critical.open).toBe(3);
    expect(many.critical.oldestOpenDays).toBe(21); // created 2026-09-01, NOW 2026-09-22
  });

  describe('with both SLAs active', () => {
    beforeEach(() => useBothActivePolicy());
    const slaRepos = [
      R(10, { fullName: 'o/sla' }), R(11, { fullName: 'o/today' }), R(12, { fullName: 'o/future' }), R(13, { fullName: 'o/late' }),
    ];
    const slaAlerts = [
      // critical, 7 days: due = created + 7. NOW is 2026-09-22.
      A(10, 1, { createdAt: '2026-09-01T00:00:00Z' }),  // due 09-08: 14 days overdue
      A(10, 2, { createdAt: '2026-09-10T00:00:00Z' }),  // due 09-17: 5 days overdue
      A(10, 3, { createdAt: '2026-09-17T00:00:00Z' }),  // due 09-24: in 2 days
      A(10, 4, { createdAt: '2026-09-20T00:00:00Z' }),  // due 09-27: in 5 days
      A(10, 5, { createdAt: '2026-09-22T00:00:00Z' }),  // due 09-29: in 7 days (still "due soon")
      // high, 9 days
      A(10, 6, { severity: 'high', createdAt: '2026-09-01T00:00:00Z' }), // due 09-10: overdue
      A(10, 7, { severity: 'high', createdAt: '2026-09-15T00:00:00Z' }), // due 09-24: in 2 days
      // never counted: resolved, and missing from the last sweep
      A(10, 8, { state: 'fixed', resolvedAt: '2026-09-05T00:00:00Z', createdAt: '2020-02-01T00:00:00Z' }),
      A(10, 9, { missing: true, createdAt: '2019-01-01T00:00:00Z' }),
      A(11, 1, { createdAt: '2026-09-15T00:00:00Z' }),  // due 09-22: today, 0 days left
      A(12, 1, { createdAt: '2026-09-23T00:00:00Z' }),  // created "tomorrow": age floors at 0; due 09-30, in 8 days
      A(13, 1, { createdAt: '2026-08-01T00:00:00Z' }),  // long overdue, nothing upcoming
    ];
    const rows = () => computeRepoRows(slaAlerts, slaRepos, { codebase: 'backend', now: NOW });
    const row = (n: string) => rows().find(r => r.fullName === n)!;

    it('counts overdue and due-soon per severity, with the same buckets as the pivot', () => {
      expect(row('o/sla').critical).toEqual({
        open: 5, overdue: 2, dueSoon: 3, oldestOpenDays: 21, nextDue: { date: '2026-09-24', daysRemaining: 2 },
      });
      expect(row('o/sla').high).toEqual({
        open: 2, overdue: 1, dueSoon: 1, oldestOpenDays: 21, nextDue: { date: '2026-09-24', daysRemaining: 2 },
      });
    });

    it('nextDue is the earliest due date that is not yet overdue, and includes today', () => {
      expect(row('o/today').critical.nextDue).toEqual({ date: '2026-09-22', daysRemaining: 0 });
      expect(row('o/today').critical.dueSoon).toBe(1);
      expect(row('o/future').critical.nextDue).toEqual({ date: '2026-09-30', daysRemaining: 8 });
      expect(row('o/future').critical.dueSoon).toBe(0);            // 8 days out is beyond the 7-day window
      expect(row('o/late').critical.nextDue).toBeNull();           // only overdue alerts
      expect(row('o/late').critical).toMatchObject({ open: 1, overdue: 1, dueSoon: 0 });
    });

    it('oldestOpenDays follows the alert list age rule: UTC days, floor 0, open alerts only', () => {
      expect(row('o/future').critical.oldestOpenDays).toBe(0);   // created after NOW → floored
      expect(row('o/sla').critical.oldestOpenDays).toBe(21);     // the 2020 fixed and 2019 missing alerts are ignored
      const [listed] = listAlerts([slaAlerts[0]], slaRepos, { codebase: 'backend', state: 'open' }, NOW).rows;
      expect(listed.ageDays).toBe(row('o/sla').critical.oldestOpenDays);
    });
  });

  it('honours codebase and team, groups a null codebase type under Other, and shows Unassigned', () => {
    const rs2 = [
      R(20, { fullName: 'o/fe', codebaseType: 'frontend', team: 'T2' }),
      R(21, { fullName: 'o/untyped', codebaseType: null, team: null }),
      R(22, { fullName: 'o/be' }),
    ];
    const as2 = [A(20, 1), A(21, 1), A(22, 1)];
    expect(names(computeRepoRows(as2, rs2, { codebase: 'frontend', now: NOW }))).toEqual(['o/fe']);
    const other = computeRepoRows(as2, rs2, { codebase: 'other', now: NOW });
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ fullName: 'o/untyped', team: 'Unassigned', codebaseGroup: 'other' });
    expect(names(computeRepoRows(as2, rs2, { codebase: 'all', team: 'T2', now: NOW }))).toEqual(['o/fe']);
    expect(computeRepoRows(as2, rs2, { codebase: 'all', now: NOW })).toHaveLength(3);
  });
});

describe('computeCoverage codebase option (GLOOK-64)', () => {
  const rs = [
    R(1, { fullName: 'o/be' }),
    R(2, { fullName: 'o/fe-untagged', codebaseType: 'frontend', team: null }),                                       // needs tagging: no team
    R(3, { fullName: 'o/untyped', codebaseType: null }),                                                             // needs tagging: no codebase type (Other and All)
    R(4, { fullName: 'o/fe-off', codebaseType: 'frontend', dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'off' }),
    R(5, { fullName: 'o/be-err', dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: x' }),
    R(6, { fullName: 'o/nonprod-fe', codebaseType: 'frontend', serviceTier: 'non-production' }),                     // excluded by policy
    R(7, { fullName: 'o/nonprod-be', serviceTier: 'non-production' }),                                               // excluded by policy
  ];
  const as = [A(1, 1), A(2, 1), A(3, 1), A(6, 1), A(7, 1)];
  const fn = (rows: Array<{ fullName: string }>) => rows.map(r => r.fullName);
  const lists = (codebase?: 'backend' | 'frontend' | 'shared' | 'other' | 'all') => {
    const c = computeCoverage(as, rs, { codebase });
    return { needsTagging: fn(c.needsTagging), excludedByPolicy: fn(c.excludedByPolicy), unmeasured: fn(c.unmeasured) };
  };

  it('filters all three lists by codebase group, placing a null codebase type under Other and All', () => {
    expect(lists('backend')).toEqual({ needsTagging: [], excludedByPolicy: ['o/nonprod-be'], unmeasured: ['o/be-err'] });
    expect(lists('frontend')).toEqual({ needsTagging: ['o/fe-untagged'], excludedByPolicy: ['o/nonprod-fe'], unmeasured: ['o/fe-off'] });
    expect(lists('other')).toEqual({ needsTagging: ['o/untyped'], excludedByPolicy: [], unmeasured: [] });
    expect(lists('shared')).toEqual({ needsTagging: [], excludedByPolicy: [], unmeasured: [] });
  });

  it('All, and no codebase option at all, return every repo', () => {
    const everything = {
      needsTagging: ['o/fe-untagged', 'o/untyped'], excludedByPolicy: ['o/nonprod-be', 'o/nonprod-fe'], unmeasured: ['o/be-err', 'o/fe-off'],
    };
    expect(lists('all')).toEqual(everything);
    expect(lists(undefined)).toEqual(everything);
  });

  it('combines with the team option', () => {
    const c = computeCoverage(as, rs, { codebase: 'frontend', team: 'Unassigned' });
    expect(fn(c.needsTagging)).toEqual(['o/fe-untagged']);
    expect(fn(c.unmeasured)).toEqual([]);
  });
});
