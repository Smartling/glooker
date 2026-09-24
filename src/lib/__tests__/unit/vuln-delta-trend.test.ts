import { snapshotSets, pickBaseline, computeDelta, computeTrend } from '@/lib/vulnerabilities/aggregate';
import type { AlertFact, RepoFact, SnapshotRow } from '@/lib/vulnerabilities/types';

const R = (repoId: number, over: Partial<RepoFact> = {}): RepoFact => ({
  repoId, fullName: `o/r${repoId}`, team: 'T1', serviceTier: 'production', codebaseType: 'backend',
  archived: false, dependabotStatus: 'ok', dependabotStatusDetail: null, carriedResolvedCritical: 0, ...over,
});
const A = (repoId: number, n: number, over: Partial<AlertFact> = {}): AlertFact => ({
  repoId, number: n, htmlUrl: '', state: 'open', severity: 'critical', severityChangedAt: null, ghsaId: null, cveId: null,
  summary: null, cvssScore: null, epssPercentage: null, withdrawn: false, packageName: null, ecosystem: null, manifestPath: null,
  relationship: null, scope: null, createdAt: '2026-08-01T00:00:00Z', resolvedAt: null, dismissedReason: null,
  reopenedCount: 0, lastReopenedAt: null, missing: false, ...over,
});
const S = (over: Partial<SnapshotRow>): SnapshotRow => ({
  source: 'sync', syncId: 1, sourceFile: null, takenOn: '2026-09-15', measuredAt: '2026-09-15T10:00:00Z',
  repoId: 1, openCritical: 0, openHigh: 0, ...over,
});

describe('snapshotSets / pickBaseline', () => {
  const rows = [
    S({ source: 'csv-import', syncId: null, sourceFile: 'a.csv', takenOn: '2026-08-03', measuredAt: '2026-08-03T00:00:00Z' }),
    S({ syncId: 1, takenOn: '2026-09-15', measuredAt: '2026-09-15T10:00:00Z' }),
    S({ syncId: 2, takenOn: '2026-09-21', measuredAt: '2026-09-21T10:00:00Z' }),
    S({ syncId: 3, takenOn: '2026-09-22', measuredAt: '2026-09-22T10:00:00Z' }),
  ];
  const sets = snapshotSets(rows);
  const now = new Date('2026-09-22T12:00:00Z');
  it('last = the set before the latest', () => expect(pickBaseline(sets, 'last', now)?.key).toBe('sync:2'));
  it('7d = latest set at or before now−7d', () => expect(pickBaseline(sets, '7d', now)?.key).toBe('sync:1'));
  it('a date picks the latest set on or before that day', () => expect(pickBaseline(sets, '2026-08-31', now)?.key).toBe('csv:a.csv'));
  it('null when nothing qualifies', () => expect(pickBaseline(sets, '2026-01-01', now)).toBeNull());
});

describe('computeDelta', () => {
  const set = { source: 'sync' as const, key: 'sync:1', takenOn: '2026-09-15', measuredAt: '2026-09-15T10:00:00Z' };
  const repos = [R(1), R(2), R(9)];
  const baselineRows = [S({ repoId: 1, openCritical: 3 }), S({ repoId: 2, openCritical: 1 })]; // repo 9 not in baseline
  const alerts = [
    A(1, 1),                                                            // open throughout
    A(1, 2, { createdAt: '2026-09-18T00:00:00Z' }),                      // new
    A(1, 3, { state: 'fixed', resolvedAt: '2026-09-19T00:00:00Z' }),     // resolved in window
    A(1, 4, { lastReopenedAt: '2026-09-20T00:00:00Z', reopenedCount: 1 }), // reopened
    A(1, 5, { missing: true }),                                         // was open, now missing → other
    A(2, 1, { state: 'dismissed', resolvedAt: '2026-09-19T00:00:00Z' }), // resolved (dismissed)
    A(9, 1),                                                            // repo not in baseline: excluded
  ];
  const d = computeDelta(alerts, repos, baselineRows, set, { codebase: 'backend', severity: 'critical' });
  const t1 = d.teams.find(t => t.team === 'T1')!;
  it('every figure matches an independently computed literal', () => {
    // Baseline 4 open (repo1: 3, repo2: 1). Now open in compared repos: A(1,1), A(1,2), A(1,4) = 3.
    // new: A(1,2). resolved: A(1,3), A(2,1) (dismissed). reopened: A(1,4). A(1,5) went missing → other −1.
    expect(t1).toEqual({ team: 'T1', deltaOpen: -1, new: 1, resolved: 2, dismissed: 1, reopened: 1, other: -1 });
    expect(d.total).toEqual({ team: 'Total', deltaOpen: -1, new: 1, resolved: 2, dismissed: 1, reopened: 1, other: -1 });
    expect(d.reposNotInBaseline).toBe(1); // repo 9
  });
  it('a CSV baseline is "no measurement" outside Backend + critical', () => {
    const csv = { ...set, source: 'csv-import' as const, key: 'csv:a.csv' };
    expect(computeDelta(alerts, repos, baselineRows, csv, { codebase: 'frontend', severity: 'critical' }).available).toBe(false);
    expect(computeDelta(alerts, repos, baselineRows, csv, { codebase: 'backend', severity: 'high' }).available).toBe(false);
    expect(computeDelta(alerts, repos, baselineRows, csv, { codebase: 'backend', severity: 'critical' }).available).toBe(true);
  });
  it('no baseline set → unavailable', () => {
    expect(computeDelta(alerts, repos, [], null, { codebase: 'backend', severity: 'critical' }).available).toBe(false);
  });

  it('a null openHigh on a sync baseline is a data error, not "zero" — the repo is excluded and counted as not-in-baseline', () => {
    // A sync snapshot always computes open_high, so null here can only be a data error.
    const highBaseline = [S({ repoId: 1, openCritical: 0, openHigh: null }), S({ repoId: 2, openCritical: 0, openHigh: 2 })];
    const d = computeDelta(alerts, repos, highBaseline, set, { codebase: 'backend', severity: 'high' });
    expect(d.available).toBe(true);
    // inView = repo1, repo2, repo9 (all backend/production). Excluded: repo1 (null openHigh) and
    // repo9 (no baseline row at all) → reposNotInBaseline = 2, not 1.
    expect(d.reposNotInBaseline).toBe(2);
  });
});

describe('computeTrend', () => {
  const repos = [R(1), R(2, { team: 'T2' }), R(3, { codebaseType: 'frontend' })];
  const rows = [
    S({ source: 'csv-import', syncId: null, sourceFile: 'a.csv', takenOn: '2026-08-03', measuredAt: '2026-08-03T00:00:00Z', repoId: 1, openCritical: 5, openHigh: null }),
    S({ syncId: 7, takenOn: '2026-09-14', measuredAt: '2026-09-14T10:00:00Z', repoId: 1, openCritical: 4 }),
    S({ syncId: 7, takenOn: '2026-09-14', measuredAt: '2026-09-14T10:00:00Z', repoId: 2, openCritical: 2 }),
    S({ syncId: 8, takenOn: '2026-09-14', measuredAt: '2026-09-14T15:00:00Z', repoId: 1, openCritical: 3 }), // later same day wins
    S({ syncId: 8, takenOn: '2026-09-14', measuredAt: '2026-09-14T15:00:00Z', repoId: 2, openCritical: 2 }),
    S({ syncId: 8, takenOn: '2026-09-14', measuredAt: '2026-09-14T15:00:00Z', repoId: 3, openCritical: 9 }),
    // A CSV for the same day as a sync must lose to the sync, even though it was "measured" at 00:00 of that day:
    S({ source: 'csv-import', syncId: null, sourceFile: 'b.csv', takenOn: '2026-09-14', measuredAt: '2026-09-14T00:00:00Z', repoId: 1, openCritical: 99, openHigh: null }),
  ];
  it('one open-count point per team per day, latest set that day, CSV only for Backend+critical', () => {
    const t = computeTrend(rows, repos, { codebase: 'backend', severity: 'critical' });
    expect(t.find(s => s.team === 'T1')!.points).toEqual([{ date: '2026-08-03', open: 5 }, { date: '2026-09-14', open: 3 }]);
    expect(t.find(s => s.team === 'T2')!.points).toEqual([{ date: '2026-09-14', open: 2 }]);
    const high = computeTrend(rows, repos, { codebase: 'backend', severity: 'high' });
    expect(high.find(s => s.team === 'T1')!.points.map(p => p.date)).toEqual(['2026-09-14']);
  });
});
