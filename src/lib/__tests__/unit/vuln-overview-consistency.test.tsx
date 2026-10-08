/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-overview-consistency.test.tsx
// The Overview's three open counts come from different requests and different components: the Open tile (the team-scoped
// summary), the team table (the unfiltered summary) and the repositories footer (the scoped repository rows). One data set
// goes through the real computePivot and computeRepoRows, and for every owning team and Severity the three must agree,
// and agree with a count taken straight from the facts. The set holds an unmeasured repository that still has stored alerts.
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import TeamTable from '@/app/vulnerabilities/team-table';
import RepoTable from '@/app/vulnerabilities/repo-table';
import { kSev, type SeverityFilter } from '@/app/vulnerabilities/security-state';
import { unmeasuredBadgeText } from '@/app/vulnerabilities/labels';
import type { SummaryData } from '@/app/vulnerabilities/api-types';
import { computePivot, computeRepoRows } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import { ovProps, slot, summaryFixture } from '../support/security-fixtures';
import { OV_ALERTS, OV_FACTS_NOW, OV_REPOS, ovExpectedOpen } from '../support/security-overview-facts';

const POLICY = JSON.stringify([
  { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
  { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
]);
const PRIOR_POLICY = process.env.VULNERABILITIES_SLA_POLICY;
const PRIOR_SINCE = process.env.VULN_RESOLVED_SINCE;
beforeEach(() => {
  process.env.VULN_RESOLVED_SINCE = '2020-01-08';
  process.env.VULNERABILITIES_SLA_POLICY = POLICY;
  __clearVulnConfigCache();
  jest.useFakeTimers().setSystemTime(OV_FACTS_NOW);
});
afterEach(() => {
  jest.useRealTimers();
  if (PRIOR_SINCE === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = PRIOR_SINCE;
  if (PRIOR_POLICY === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = PRIOR_POLICY;
  __clearVulnConfigCache();
});

const SLA_BOTH: Partial<SummaryData> = {
  slaStatus: { critical: 'active', high: 'active' },
  policy: [
    { id: 'critical-2020-01', severity: 'critical', days: 7, effectiveFrom: '2020-01-08', until: null, pending: false },
    { id: 'high-2020-01', severity: 'high', days: 9, effectiveFrom: '2020-01-08', until: null, pending: false },
  ],
};

const text = (el: Element) => el.textContent ?? '';
const headerLabels = (row: HTMLElement) => Array.from(row.querySelectorAll('[role="columnheader"]')).map(h => text(h).replace(/[↕↑↓]︎?/g, '').replace(/\(dismissed\)|vs .*|No earlier.*/g, '').trim());
const cellsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="cell"]')).map(text);

function renderOverview(team: string | null, severity: SeverityFilter) {
  const opts = { codebase: 'backend' as const, now: OV_FACTS_NOW };
  const scoped = computePivot(OV_ALERTS, OV_REPOS, { ...opts, ...(team ? { team } : {}) });
  const everyone = computePivot(OV_ALERTS, OV_REPOS, opts);
  const rows = computeRepoRows(OV_ALERTS, OV_REPOS, { ...opts, ...(team ? { team } : {}) });
  const props = ovProps({
    summary: { ...SLA_BOTH, pivot: scoped },
    teamSummary: slot(summaryFixture({ ...SLA_BOTH, pivot: everyone })),
    repos: rows,
    url: { team, severity, kSev: kSev(severity) },
  });
  render(<><KpiTiles {...props} /><TeamTable {...props} /><RepoTable {...props} nameFilter="" /></>);
}

describe('the fixture is not vacuous', () => {
  it('has an unmeasured repository whose stored alerts are open, its team row, and teams that differ', () => {
    const rows = computeRepoRows(OV_ALERTS, OV_REPOS, { codebase: 'backend', now: OV_FACTS_NOW });
    const flaky = rows.find(r => r.fullName === 'acme/flaky')!;
    expect(flaky.unmeasured).not.toBeNull();
    expect(flaky.critical.open + flaky.high.open).toBeGreaterThan(0);
    const pivot = computePivot(OV_ALERTS, OV_REPOS, { codebase: 'backend', now: OV_FACTS_NOW });
    expect(pivot.rows.map(r => r.team).sort()).toEqual(['Payments', 'Platform', 'Search']);
    expect(pivot.rows.find(r => r.team === 'Search')!.unmeasuredRepos).toBe(1);
    // the rows sum to the total, per severity
    for (const sev of ['critical', 'high'] as const) expect(pivot.rows.reduce((n, r) => n + r[sev].open, 0)).toBe(pivot.total[sev].open);
    // and the independent count agrees with the aggregate
    expect(ovExpectedOpen('critical', null)).toBe(pivot.total.critical.open);
    expect(new Set([ovExpectedOpen('critical', 'Payments'), ovExpectedOpen('critical', 'Search'), ovExpectedOpen('critical', null)]).size).toBe(3);
  });
});

describe('the Open tile, the team row and the repositories footer agree', () => {
  const combos = ([null, 'Payments', 'Search'] as const).flatMap(t => (['both', 'critical', 'high'] as const).map(s => [t, s] as const));

  // Revert: leave an unmeasured repository's stored count out of the footer, read the team table from the scoped summary, or
  // read the tile from the unfiltered one: the three figures then differ for the team that owns the unmeasured repository.
  it.each(combos)('team=%s severity=%s', (team, severity) => {
    renderOverview(team, severity);
    const sev = kSev(severity);

    // Open tile
    const tile = Number(text(screen.getByTestId('kpi-open-value')).replace(/,/g, ''));
    expect(tile).toBe(ovExpectedOpen(sev, team));

    // Team row (the team's, or the Total row with no team): found by header text, since the columns follow the SLA state
    const heads = headerLabels(screen.getAllByRole('row').find(r => text(r).startsWith('Owning team'))!);
    const opens = heads.map((h, i) => (h === 'Open' ? i : -1)).filter(i => i >= 0);
    expect(opens).toHaveLength(2);
    const teamRow = team ? screen.getByTestId(`team-row-${team}`) : screen.getByTestId('team-total-row');
    const teamCells = cellsOf(teamRow);
    // Repositories footer: its cells are [label, ...columns], and the two leading headers (Repository, Owning team) share one cell
    const repoHeads = headerLabels(screen.getByTestId('repo-table').firstElementChild as HTMLElement);
    const footerCells = cellsOf(screen.getByTestId('repo-footer'));
    const footerOpen = { critical: footerCells[repoHeads.indexOf('Open crit') - 1], high: footerCells[repoHeads.indexOf('Open high') - 1] };
    const teamOpen = { critical: teamCells[opens[0]], high: teamCells[opens[1]] };

    for (const s of ['critical', 'high'] as const) {
      if (severity === 'both' || severity === s) {
        expect(teamOpen[s]).toBe(String(ovExpectedOpen(s, team)));
        expect(footerOpen[s]).toBe(String(ovExpectedOpen(s, team)));
      } else {
        expect(teamOpen[s]).toBe('–');
        expect(footerOpen[s]).toBe('–');
      }
    }
    expect(teamOpen[sev]).toBe(String(tile));
    expect(footerOpen[sev]).toBe(String(tile));
  });

  it('the team table lists every team whatever the selection, and the unmeasured repository\'s team row is present', () => {
    renderOverview('Payments', 'both');
    for (const t of ['Payments', 'Search', 'Platform']) expect(screen.getByTestId(`team-row-${t}`)).toBeTruthy();
    expect(within(screen.getByTestId('team-row-Search')).getByText(unmeasuredBadgeText(1))).toBeTruthy();
  });
});
