// Seeds vulnerability data by running the real sync against the mock provider (GLOOK-43),
// plus a failed run and backend-only CSV-style history for the trend.
export async function seedVulnerabilities(db: any) {
  const [existingSyncs] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_syncs');
  // B4: also check for CSV-import snapshot history, not just syncs — an interrupted run could
  // otherwise have written one but not the other, and re-running `npm run seed` would double the
  // CSV history (`seed:reset` is still the way to rebuild from scratch).
  const [existingCsv] = await db.execute(`SELECT COUNT(*) AS n FROM vulnerability_repo_snapshots WHERE source = 'csv-import'`);
  if (Number(existingSyncs[0].n) > 0 || Number(existingCsv[0].n) > 0) { console.log('  vulnerabilities: already seeded, skipping'); return; }
  const { createMockGitHubProvider } = await import('../src/lib/github-mock');
  const { insertRunningSync, runSync } = await import('../src/lib/vulnerabilities/sync');
  const { toIsoSecond } = await import('../src/lib/vulnerabilities/time');
  const { isInScope, codebaseGroupOf } = await import('../src/lib/vulnerabilities/codebase');
  const { MOCK_ORG, MOCK_VULN_REPOS } = await import('./mock-identities');
  const provider = createMockGitHubProvider();
  const day = (d: number) => new Date(Date.now() - d * 86400000);

  // Backend-only CSV history for the Backend trend (8 weekly points before the first sync). Scope
  // and grouping are config-driven (GLOOK-43 Wave P), not hardcoded strings, so this fixture stays
  // correct as the configured tier/groups change — matching how aggregate.ts/queries.ts/sync.ts
  // express the same two checks everywhere else.
  const backend = MOCK_VULN_REPOS.filter(r => isInScope(r.serviceTier) && codebaseGroupOf(r.codebaseType) === 'backend');
  for (let w = 8; w >= 1; w--) {
    const takenOn = day(w * 7 + 2).toISOString().slice(0, 10);
    for (const r of backend) {
      await db.execute(
        `INSERT INTO vulnerability_repo_snapshots (org, source, sync_id, source_file, taken_on, measured_at, repo_id, full_name, team_at_time, archived, open_critical, resolved_critical_since_start)
         VALUES (?, 'csv-import', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [MOCK_ORG, `mock-${takenOn}.csv`, takenOn, toIsoSecond(`${takenOn}T00:00:00Z`), r.repoId, `${MOCK_ORG}/${r.name}`, r.team, r.archived ? 1 : 0, 4 + w + (r.repoId % 3), 10 - w]);
    }
  }
  // Two real syncs 3 and 2 days ago (> 36h → the page shows STALE); the second produces a reopen,
  // a missing alert and a new alert.
  for (const d of [3, 2]) {
    const id = await insertRunningSync(MOCK_ORG, 'schedule', null, day(d));
    const outcome = await runSync(id, MOCK_ORG, provider, { now: () => day(d), log: () => {} });
    if (outcome.status === 'failed') {
      throw new Error(`seedVulnerabilities: sync ${id} failed against the mock provider: ${JSON.stringify(outcome.issues)}`);
    }
  }
  // The LATEST run failed → the page shows the failed banner while serving the last good run.
  const failedAt = toIsoSecond(day(1));
  await db.execute(
    `INSERT INTO vulnerability_syncs (org, trigger_kind, triggered_by, status, started_at, finished_at, issues)
     VALUES (?, 'manual', 'admin@mock', 'failed', ?, ?, ?)`,
    [MOCK_ORG, failedAt, failedAt, JSON.stringify([{ kind: 'fetch', message: 'mock: token cannot read org Dependabot alerts' }])]);
  console.log('  vulnerabilities: 2 syncs + 1 failed run + 8 weeks of backend history');
}
