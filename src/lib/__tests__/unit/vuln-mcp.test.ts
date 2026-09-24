jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn(), requestStop: jest.fn() }));
jest.mock('@/lib/vulnerabilities/queries', () => ({
  getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(),
  REASON_DISABLED: 'Vulnerability tracking is not enabled on this Glooker instance.',
}));
import { callTool, MCP_TOOLS } from '@/lib/mcp/tools';
import { getAlerts, getSummary, getTrend, getCoverage } from '@/lib/vulnerabilities/queries';
// Real aggregate output (not toy objects), so key-name drift is caught:
import { listAlerts, computePivot, computeTrend, computeCoverage } from '@/lib/vulnerabilities/aggregate';

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
    'ghsa_id', 'html_url', 'manifest_path', 'package_name', 'relationship', 'reopened_count', 'repo', 'resolved_at',
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
  for (const name of ['list_vulnerabilities', 'get_vulnerability_summary', 'get_vulnerability_trend', 'get_vulnerability_coverage']) {
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
it('surfaces config_errors on all four vulnerability tools', async () => {
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
    + 'Repos with open alerts that need tagging (missing tier, codebase-type or team property), repos outside the configured tracking scope, and in-scope repos whose Dependabot status is unmeasured.',
  );
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
