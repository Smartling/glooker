jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn(), requestStop: jest.fn() }));
jest.mock('@/lib/vulnerabilities/queries', () => ({
  getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(), getRepos: jest.fn(),
  REASON_DISABLED: 'Vulnerability tracking is not enabled on this Glooker instance.',
}));
import { callTool, MCP_TOOLS } from '@/lib/mcp/tools';
import { getAlerts, getSummary, getTrend, getCoverage, getRepos } from '@/lib/vulnerabilities/queries';
// Real aggregate output (not toy objects), so key-name drift is caught:
import { listAlerts, computePivot, computeTrend, computeCoverage, computeRepoRows } from '@/lib/vulnerabilities/aggregate';

const repo = { repoId: 1, fullName: 'o/r1', team: 'T1', serviceTier: 'production', codebaseType: 'backend', archived: false, dependabotStatus: 'ok', dependabotStatusDetail: null } as any;
const alert = { repoId: 1, number: 1, htmlUrl: 'u', state: 'open', severity: 'critical', severityChangedAt: null, ghsaId: 'G', cveId: 'C', summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false, packageName: 'p', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: null, createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false } as any;
const NOW = new Date('2026-09-22T12:00:00Z');
const syncBlock = { lastSuccessfulAt: '2026-09-22T10:00:00Z', stale: false, lastStatus: 'succeeded', running: false, issuesCount: 0, issues: [] };

// config.ts (unlike queries.ts) is NOT mocked in this file, so `isVulnerabilitiesEnabled()`
// reads the real process.env.VULNERABILITIES_ORG. Every existing test in this file expects
// the feature "on", so default it on here and restore whatever was there before.
const PRIOR_VULNERABILITIES_ORG = process.env.VULNERABILITIES_ORG;
beforeEach(() => { process.env.VULNERABILITIES_ORG = 'o'; });
afterAll(() => {
  if (PRIOR_VULNERABILITIES_ORG === undefined) delete process.env.VULNERABILITIES_ORG;
  else process.env.VULNERABILITIES_ORG = PRIOR_VULNERABILITIES_ORG;
});

it('emits snake_case keys everywhere (rows, sync block, pivot) — the names the descriptions promise', async () => {
  const la = listAlerts([alert], [repo], { codebase: 'backend', state: 'open' }, NOW);
  (getAlerts as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: { codebase: 'backend', state: 'open' }, ...la });
  const out: any = await callTool('list_vulnerabilities', {});
  expect(Object.keys(out).sort()).toEqual(['applied_filters', 'available', 'excluded_by_codebase', 'repos', 'rows', 'sync', 'total_count', 'truncated']);
  // the repo facet reaches MCP through the same toSnake() mapper; its keys are already snake_case.
  expect(out.repos).toEqual([{ repo: 'o/r1', count: 1 }]);
  expect(Object.keys(out.sync).sort()).toEqual(['issues', 'issues_count', 'last_status', 'last_successful_at', 'running', 'stale']);
  expect(Object.keys(out.rows[0]).sort()).toEqual([
    'age_days', 'clock_start', 'created_at', 'cve_id', 'cvss', 'days_remaining', 'dismissed_reason', 'due_date', 'ecosystem', 'epss',
    'ghsa_id', 'html_url', 'last_reopened_at', 'manifest_path', 'package_name', 'relationship', 'reopened_count', 'repo', 'resolved_at',
    'resolved_days_late', 'resolved_on_time', 'scope', 'severity', 'severity_changed_at', 'sla_policy_id', 'state', 'summary', 'team',
  ]);
  const pv = computePivot([alert], [repo], { codebase: 'backend', now: NOW });
  (getSummary as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, resolvedCountStartDate: '2020-01-08', pivot: pv, knownTeams: ['T1'] });
  const s: any = await callTool('get_vulnerability_summary', {});
  expect(s.resolved_count_start_date).toBe('2020-01-08');
  expect(Object.keys(s.pivot.rows[0]).sort()).toEqual(['critical', 'high', 'team', 'unmeasured_repos']);
  expect(Object.keys(s.pivot.rows[0].critical).sort()).toEqual(['carried_resolved', 'dismissed', 'due_soon', 'open', 'overdue', 'pct_closed', 'resolved']);
  expect(s.pivot.rows[0].team).toBe('T1'); // values (team names) are never rewritten
});

it('get_vulnerability_summary carries carried_resolved through toSnake on both the team row and the total', async () => {
  const carriedRepo = { ...repo, repoId: 3, fullName: 'o/legacy-app', archived: true, carriedResolvedCritical: 7 };
  const pv = computePivot([], [carriedRepo], { codebase: 'backend', now: NOW });
  (getSummary as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, resolvedCountStartDate: '2020-01-08', pivot: pv, knownTeams: ['T1'] });
  const s: any = await callTool('get_vulnerability_summary', {});
  expect(s.pivot.rows[0].critical.carried_resolved).toBe(7);
  expect(s.pivot.total.critical.carried_resolved).toBe(7);
});

it('get_vulnerability_trend emits snake_case keys from real computeTrend output', async () => {
  const series = computeTrend(
    [{ source: 'sync', syncId: 1, sourceFile: null, takenOn: '2026-09-20', measuredAt: '2026-09-20T10:00:00Z', repoId: 1, openCritical: 2, openHigh: 0 }] as any,
    [repo], { codebase: 'backend', severity: 'critical' },
  );
  (getTrend as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: { codebase: 'backend', severity: 'critical' }, series });
  const out: any = await callTool('get_vulnerability_trend', {});
  expect(Object.keys(out).sort()).toEqual(['applied_filters', 'available', 'series', 'sync']);
  expect(out.series[0]).toEqual({ team: 'T1', points: [{ date: '2026-09-20', open: 2 }] });
});

it('get_vulnerability_coverage emits snake_case keys from real computeCoverage output', async () => {
  const untaggedRepo = { ...repo, repoId: 2, fullName: 'o/r2', team: null };
  const openAlert = { ...alert, repoId: 2 };
  const cov = computeCoverage([openAlert], [untaggedRepo], {});
  (getCoverage as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, ...cov });
  const out: any = await callTool('get_vulnerability_coverage', {});
  expect(Object.keys(out).sort()).toEqual(['applied_filters', 'available', 'excluded_by_policy', 'needs_tagging', 'sync', 'unmeasured']);
  expect(out.needs_tagging[0]).toMatchObject({ full_name: 'o/r2', open_critical: 1 });
});

it('descriptions state the unit is the alert and to check availability and staleness', () => {
  for (const name of ['list_vulnerabilities', 'get_vulnerability_summary', 'get_vulnerability_trend', 'get_vulnerability_coverage', 'list_vulnerability_repos']) {
    const t = MCP_TOOLS.find(x => x.name === name)!;
    expect(t.description).toMatch(/Dependabot alert/i);
    expect(t.description).toMatch(/available/);
    expect(t.description).toMatch(/stale/);
  }
});

// every vulnerability data response (and Unavailable) carries
// config_errors through MCP's toSnake — asserted on all four tools, plus the
// resolved_count_start_date: null default (proving a null value survives toSnake, not just a
// present one).
it('surfaces config_errors on all five vulnerability tools', async () => {
  const configErrors = [{ source: 'startup', variable: 'VULNERABILITIES_SLA_POLICY', rule: 'Invalid JSON in VULNERABILITIES_SLA_POLICY env var' }];

  (getAlerts as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, rows: [], totalCount: 0, truncated: false, excludedByCodebase: 0, configErrors });
  expect((await callTool('list_vulnerabilities', {}) as any).config_errors).toEqual(configErrors);

  (getSummary as jest.Mock).mockResolvedValue({
    available: true, sync: syncBlock, appliedFilters: {}, resolvedCountStartDate: null, pivot: computePivot([], [], { codebase: 'backend', now: NOW }),
    knownTeams: [], configErrors, slaPolicyInvalid: false,
  });
  const s: any = await callTool('get_vulnerability_summary', {});
  expect(s.config_errors).toEqual(configErrors);
  expect(s.resolved_count_start_date).toBeNull();
  expect(s.sla_policy_invalid).toBe(false);

  (getTrend as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, series: [], configErrors });
  expect((await callTool('get_vulnerability_trend', {}) as any).config_errors).toEqual(configErrors);

  (getCoverage as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, needsTagging: [], excludedByPolicy: [], unmeasured: [], configErrors });
  expect((await callTool('get_vulnerability_coverage', {}) as any).config_errors).toEqual(configErrors);

  (getRepos as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, rows: [], configErrors });
  expect((await callTool('list_vulnerability_repos', {}) as any).config_errors).toEqual(configErrors);
});

// GLOOK-43 Wave P fix round: a literal list of old (removed) vocabulary here re-planted those
// values in this public repo just to assert their absence. Pinning the exact current shipped
// text is an equivalent regression guard (a stray old term would fail the equality) without
// writing the old vocabulary anywhere. `codebase`/`team` are read off list_vulnerabilities'
// inputSchema rather than a separate export — VULN_FILTER_PROPS is spread into that schema
// (`{ ...VULN_FILTER_PROPS, state: ..., ... }`), and object spread copies each property's value
// (here, a nested description object) by reference, so this is the exact same object tools.ts
// built, not a copy that could drift silently.
it('VULN_FILTER_PROPS codebase/team descriptions and the coverage tool description match their exact shipped text', () => {
  const list = MCP_TOOLS.find(t => t.name === 'list_vulnerabilities')!;
  const coverage = MCP_TOOLS.find(t => t.name === 'get_vulnerability_coverage')!;
  expect(list.inputSchema.properties.codebase.description).toBe(
    'Page group: backend, frontend, shared, other or all (default backend); which codebase-type values count in each is set by the deployment.',
  );
  expect(list.inputSchema.properties.team.description).toBe(
    "The repo's team custom property value, or 'Unassigned'. Unknown values return an error listing known teams.",
  );
  expect(coverage.description).toBe(
    'Counts are Dependabot alerts, not CVEs: one CVE in five manifests is five alerts. '
    + 'Always check `available` (false means the feature is off or no sync has succeeded yet — say so, never report zeros) '
    + 'and `sync.stale` (true means the data is over 36h old — tell the user the date of `sync.last_successful_at`). '
    + 'Every data response carries config_errors; non-empty means results may be incomplete. '
    + 'Repos with open alerts that need tagging (missing tier, codebase-type or team property), repos outside the configured tracking scope, and in-scope repos whose Dependabot status is unmeasured. '
    + 'Filtered to the `codebase` group (default backend; pass `all` for every repository); a repository with no codebase type is grouped under Other, so it appears only with `codebase=other` or `codebase=all` (the default is `backend`).',
  );
  expect(coverage.inputSchema.properties.codebase).toBe(list.inputSchema.properties.codebase);
});

it('passes parsed filters (with defaults) to the query layer', async () => {
  (getAlerts as jest.Mock).mockResolvedValue({ available: true, rows: [], totalCount: 0, truncated: false, excludedByCodebase: 0 });
  await callTool('list_vulnerabilities', { team: 'T1' });
  expect((getAlerts as jest.Mock).mock.calls[0][0]).toMatchObject({ team: 'T1', codebase: 'backend', state: 'open' });
});

it('passes availability and unknown-team results through unchanged', async () => {
  (getSummary as jest.Mock).mockResolvedValue({ available: false, reason: 'No successful vulnerability sync yet.', sync: { lastSuccessfulAt: null, lastStatus: 'failed' } });
  expect(await callTool('get_vulnerability_summary', {})).toEqual({ available: false, reason: 'No successful vulnerability sync yet.', sync: { last_successful_at: null, last_status: 'failed' } });
  (getAlerts as jest.Mock).mockResolvedValue({ error: 'unknown team', known_teams: ['T1'] });
  expect(await callTool('list_vulnerabilities', { team: 'Z' })).toEqual({ error: 'unknown team', known_teams: ['T1'] });
});

it('invalid filter → error object, not a throw', async () => {
  expect(await callTool('list_vulnerabilities', { codebase: 'mobile' })).toEqual({ error: expect.stringMatching(/codebase/) });
});

it('feature-off check runs before filter parsing: a bad filter with tracking disabled still reports unavailable, not a validation error', async () => {
  delete process.env.VULNERABILITIES_ORG;
  const callsBefore = (getAlerts as jest.Mock).mock.calls.length;
  try {
    expect(await callTool('list_vulnerabilities', { codebase: 'mobile' }))
      .toEqual({ available: false, reason: 'Vulnerability tracking is not enabled on this Glooker instance.' });
    expect((getAlerts as jest.Mock).mock.calls.length).toBe(callsBefore); // getAlerts was not called
  } finally {
    process.env.VULNERABILITIES_ORG = 'o';
  }
});

// ---------- GLOOK-64: list_vulnerability_repos, offset/sort, coverage codebase ----------
describe('list_vulnerability_repos', () => {
  const repoRows = (n: number) => computeRepoRows(
    Array.from({ length: n }, (_, i) => ({ ...alert, repoId: i + 1, number: 1, htmlUrl: `u${i}` })),
    Array.from({ length: n }, (_, i) => ({ ...repo, repoId: i + 1, fullName: `o/r${String(i + 1).padStart(3, '0')}`, carriedResolvedCritical: 0 })),
    { codebase: 'backend', now: NOW });
  const envelope = (rows: unknown[]) => ({ available: true, sync: syncBlock, appliedFilters: { codebase: 'backend' }, configErrors: [], rows });

  it('emits snake_case rows from real computeRepoRows output, plus total_count and truncated', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(1)));
    const out: any = await callTool('list_vulnerability_repos', {});
    expect(Object.keys(out).sort()).toEqual(['applied_filters', 'available', 'config_errors', 'rows', 'sync', 'total_count', 'truncated']);
    expect(Object.keys(out.rows[0]).sort()).toEqual(['codebase_group', 'critical', 'full_name', 'high', 'team', 'unmeasured']);
    expect(Object.keys(out.rows[0].critical).sort()).toEqual(['due_soon', 'next_due', 'oldest_open_days', 'open', 'overdue']);
    expect(out.rows[0]).toMatchObject({ full_name: 'o/r001', team: 'T1', codebase_group: 'backend', unmeasured: null });
    expect(out.rows[0].critical).toMatchObject({ open: 1, overdue: null, due_soon: null, next_due: null }); // no SLA policy in this file's env
    expect(out.truncated).toBe(false);
    expect(out.total_count).toBe(1);
  });

  it('cuts rows to limit (default 100, max 500 per page) and reports truncated and the exact total_count', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(120)));
    const dflt: any = await callTool('list_vulnerability_repos', {});
    expect(dflt.rows).toHaveLength(100);
    expect(dflt.truncated).toBe(true);
    expect(dflt.total_count).toBe(120);
    const two: any = await callTool('list_vulnerability_repos', { limit: 2 });
    expect(two.rows.map((r: any) => r.full_name)).toEqual(['o/r001', 'o/r002']);
    const big: any = await callTool('list_vulnerability_repos', { limit: 5000 });
    expect(big.rows).toHaveLength(120);
    expect(big.truncated).toBe(false);
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(600)));
    const capped: any = await callTool('list_vulnerability_repos', { limit: 5000 });
    expect(capped.rows).toHaveLength(500);
    expect(capped.truncated).toBe(true);
  });

  it('pages with offset: the next rows come back in order, and truncated follows offset + rows < total_count', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(120)));
    const names = (o: any) => o.rows.map((r: any) => r.full_name);
    const first: any = await callTool('list_vulnerability_repos', { limit: 50 });
    const second: any = await callTool('list_vulnerability_repos', { limit: 50, offset: 50 });
    const third: any = await callTool('list_vulnerability_repos', { limit: 50, offset: 100 });
    expect(names(first)[0]).toBe('o/r001');
    expect(names(second)).toHaveLength(50);
    expect(names(second)[0]).toBe('o/r051');
    expect(names(second)[49]).toBe('o/r100');
    expect([first.truncated, second.truncated, third.truncated]).toEqual([true, true, false]);
    expect(names(third)).toEqual(Array.from({ length: 20 }, (_, i) => `o/r${String(101 + i).padStart(3, '0')}`));
    expect([first.total_count, second.total_count, third.total_count]).toEqual([120, 120, 120]);
    // a page that ends exactly on the last row is not truncated
    const exact: any = await callTool('list_vulnerability_repos', { limit: 20, offset: 100 });
    expect(exact.rows).toHaveLength(20);
    expect(exact.truncated).toBe(false);
  });

  it('returns no rows, truncated false and the exact total_count when offset is at or past the end', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(3)));
    for (const offset of [3, 50]) {
      const out: any = await callTool('list_vulnerability_repos', { offset });
      expect(out.rows).toEqual([]);
      expect(out.truncated).toBe(false);
      expect(out.total_count).toBe(3);
    }
    expect(await callTool('list_vulnerability_repos', { offset: -1 })).toEqual({ error: expect.stringMatching(/offset/) });
  });

  it('echoes the applied limit and offset in applied_filters, without handing them to the query', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(3)));
    const dflt: any = await callTool('list_vulnerability_repos', {});
    expect(dflt.applied_filters).toEqual({ codebase: 'backend', limit: 100, offset: 0 });
    const paged: any = await callTool('list_vulnerability_repos', { limit: 2, offset: 1 });
    expect(paged.applied_filters).toEqual({ codebase: 'backend', limit: 2, offset: 1 });
    const capped: any = await callTool('list_vulnerability_repos', { limit: 5000 });
    expect(capped.applied_filters.limit).toBe(500); // the limit actually applied, not the one asked for
  });

  it('passes codebase and team to getRepos, and passes unavailable and unknown-team results through', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope([]));
    await callTool('list_vulnerability_repos', { codebase: 'all', team: 'T1' });
    expect((getRepos as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'all', team: 'T1' });
    (getRepos as jest.Mock).mockResolvedValue({ available: false, reason: 'No successful vulnerability sync yet.', sync: { lastSuccessfulAt: null } });
    expect(await callTool('list_vulnerability_repos', {})).toEqual({ available: false, reason: 'No successful vulnerability sync yet.', sync: { last_successful_at: null } });
    (getRepos as jest.Mock).mockResolvedValue({ error: 'unknown team', known_teams: ['T1'] });
    expect(await callTool('list_vulnerability_repos', { team: 'Z' })).toEqual({ error: 'unknown team', known_teams: ['T1'] });
  });

  it('reports unavailable when the feature is off, without calling getRepos', async () => {
    delete process.env.VULNERABILITIES_ORG;
    const before = (getRepos as jest.Mock).mock.calls.length;
    try {
      expect(await callTool('list_vulnerability_repos', { codebase: 'mobile' }))
        .toEqual({ available: false, reason: 'Vulnerability tracking is not enabled on this Glooker instance.' });
      expect((getRepos as jest.Mock).mock.calls.length).toBe(before);
    } finally {
      process.env.VULNERABILITIES_ORG = 'o';
    }
  });

  it('its description says what an unmeasured row and a null overdue mean, and how it differs from list_vulnerabilities', () => {
    const t = MCP_TOOLS.find(x => x.name === 'list_vulnerability_repos')!;
    expect(t.description).toMatch(/`unmeasured` set/);
    expect(t.description).toMatch(/stored count, which may be out of date/);
    expect(t.description).toMatch(/`overdue: null`.*SLA is not active/);
    expect(t.description).toMatch(/list_vulnerabilities/);
    expect(t.description).toMatch(/`repos` facet follows all list filters/);
    expect(Object.keys(t.inputSchema.properties).sort()).toEqual(['codebase', 'limit', 'offset', 'team']);
    expect(t.inputSchema.properties.offset).toMatchObject({ type: 'integer', minimum: 0 });
    expect(t.inputSchema.properties.offset.description).toMatch(/offset \+= limit while truncated is true/);
  });

  it('its description says the rows are capped per call, when they sum to the summary, and that unmeasured rows are cut first', () => {
    const t = MCP_TOOLS.find(x => x.name === 'list_vulnerability_repos')!;
    expect(t.description).not.toMatch(/every tracked/);
    expect(t.description).toMatch(/up to `limit` rows per call/);
    expect(t.description).toMatch(/only when `truncated` is false and the same `codebase` and `team` are passed/);
    expect(t.description).toMatch(/unmeasured rows last, so `limit` cuts them first/);
    expect(t.description).toMatch(/`offset`/);
    expect(t.description).toMatch(/no codebase type is grouped under Other.*`codebase=other` or `codebase=all`.*default is `backend`/);
  });
});

describe('list_vulnerabilities offset and sort, and the summary and coverage additions', () => {
  it('forwards offset and sort to getAlerts as validated filters', async () => {
    (getAlerts as jest.Mock).mockResolvedValue({ available: true, rows: [], totalCount: 0, truncated: false, excludedByCodebase: 0 });
    await callTool('list_vulnerabilities', { offset: 20, sort: 'due:desc', limit: 10 });
    expect((getAlerts as jest.Mock).mock.calls[0][0]).toMatchObject({ offset: 20, sort: 'due:desc', limit: 10 });
    expect(await callTool('list_vulnerabilities', { sort: 'cvss:desc' })).toEqual({ error: expect.stringMatching(/sort must be/) });
    expect(await callTool('list_vulnerabilities', { offset: -1 })).toEqual({ error: expect.stringMatching(/offset/) });
  });

  it('documents offset and sort in the schema and states the facet-versus-rows difference in the description', () => {
    const t = MCP_TOOLS.find(x => x.name === 'list_vulnerabilities')!;
    expect(Object.keys(t.inputSchema.properties)).toEqual(expect.arrayContaining(['offset', 'sort']));
    expect(t.description).toMatch(/`offset`/);
    expect(t.description).toMatch(/severity, advisory, repo, age, due, state/);
    expect(t.description).toMatch(/always come last/);
    expect(t.description).toMatch(/use list_vulnerability_repos/);
  });

  it('the sort schema states what each direction means, so a caller does not have to guess', () => {
    const t = MCP_TOOLS.find(x => x.name === 'list_vulnerabilities')!;
    const d: string = t.inputSchema.properties.sort.description;
    expect(d).toMatch(/age:desc = oldest first/);
    expect(d).toMatch(/due:asc = soonest due first/);
    expect(d).toMatch(/severity:asc = critical first/);
    expect(d).toMatch(/always come last/);
  });

  it('get_vulnerability_coverage forwards codebase to getCoverage', async () => {
    (getCoverage as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, needsTagging: [], excludedByPolicy: [], unmeasured: [] });
    await callTool('get_vulnerability_coverage', { codebase: 'frontend', team: 'T1' });
    expect((getCoverage as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'frontend', team: 'T1' });
  });

  it('get_vulnerability_coverage without a codebase asks for backend, like every other tool (codebase=all is the opt-out)', async () => {
    (getCoverage as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, needsTagging: [], excludedByPolicy: [], unmeasured: [] });
    await callTool('get_vulnerability_coverage', {});
    expect((getCoverage as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'backend' });
    await callTool('get_vulnerability_coverage', { codebase: 'all' });
    expect((getCoverage as jest.Mock).mock.calls[1][0]).toMatchObject({ codebase: 'all' });
  });

  it('get_vulnerability_summary carries codebase_counts through toSnake', async () => {
    const codebaseCounts = { backend: { critical: 2, high: 1 }, frontend: { critical: 0, high: 0 }, shared: { critical: 0, high: 0 }, other: { critical: 0, high: 0 }, all: { critical: 2, high: 1 } };
    (getSummary as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, codebaseCounts });
    const s: any = await callTool('get_vulnerability_summary', {});
    expect(s.codebase_counts).toEqual(codebaseCounts);
    expect(MCP_TOOLS.find(x => x.name === 'get_vulnerability_summary')!.description).toMatch(/`codebase_counts`/);
  });
});
