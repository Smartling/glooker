/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx
// The KPI tile "Resolved {severity}": the count, "N dismissed · since {date}" (or "all time"), the
// † for carried-over CSV history and the "% of N raised are closed" line.
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import { computePivot } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import { ovCell, ovProps, ovTeam } from '../support/security-fixtures';
import { alertFact, OV_ALERTS, OV_FACTS_NOW, OV_REPOS } from '../support/security-overview-facts';

const tile = () => screen.getByTestId('kpi-resolved');
const NBSP = '\u00a0';
const pivot = (critical: ReturnType<typeof ovCell>, high = ovCell(3)) => ({ pivot: { rows: [], total: ovTeam('Total', critical, high) } });
const CARRY_TITLE = 'Includes 3 carried over from imported CSV history (archived repo with no alert data)';

describe('count and caption', () => {
  it('a real start date reads "N dismissed · since <date>", with the % closed line', () => {
    render(<KpiTiles {...ovProps({ summary: pivot(ovCell(19, { resolved: 25, dismissed: 4, pctClosed: 57 })) })} />);
    expect(within(tile()).getByText('Resolved critical')).toBeTruthy();
    expect(within(tile()).getByText('25')).toBeTruthy();
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('4 dismissed · since Jan 8, 2020');
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('57% of 44 raised are closed');
  });

  // Revert: drop the "all time" branch (resolvedCaption's date: null case).
  it('with no resolved-count start date it reads "N dismissed · all time"', () => {
    render(<KpiTiles {...ovProps({ summary: { resolvedSince: { date: null, invalid: false }, ...pivot(ovCell(2, { resolved: 6, dismissed: 1, pctClosed: 75 })) } })} />);
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('1 dismissed · all time');
  });

  // Revert: print the raw count of raised alerts.
  it('the raised count in the % closed line is grouped', () => {
    render(<KpiTiles {...ovProps({ summary: pivot(ovCell(1000, { resolved: 234, dismissed: 1, pctClosed: 19 })) })} />);
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('19% of 1,234 raised are closed');
  });

  // Revert: render a number for a null resolved, or keep the date for an invalid start.
  it('an invalid start date shows — for the value, the dismissed count and % closed, and "since —"', () => {
    const critical = ovCell(12, { resolved: null, dismissed: null, pctClosed: null, carriedResolved: 7 });
    render(<KpiTiles {...ovProps({ summary: { resolvedSince: { date: null, invalid: true }, ...pivot(critical) } })} />);
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('— dismissed · since —');
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('— closed');
    expect(within(tile()).getByText('—')).toBeTruthy();
  });

  it('nothing raised yet reads "None raised yet", never "0% of 0"', () => {
    render(<KpiTiles {...ovProps({ summary: pivot(ovCell(0, { resolved: 0, dismissed: 0, pctClosed: null })) })} />);
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('None raised yet');
  });

  // Revert: read `critical` whatever kSev says.
  it('follows kSev: "High only" shows the high figures', () => {
    const p = ovProps({ url: { severity: 'high', kSev: 'high' }, summary: pivot(ovCell(1, { resolved: 9 }), ovCell(4, { resolved: 6, dismissed: 2, pctClosed: 60 })) });
    render(<KpiTiles {...p} />);
    expect(within(tile()).getByText('Resolved high')).toBeTruthy();
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('2 dismissed · since Jan 8, 2020');
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('60% of 10 raised are closed');
  });
});

describe('† marker and footnote', () => {
  const carried = (over = {}) => ovProps({ summary: pivot(ovCell(5, { resolved: 8, dismissed: 1, pctClosed: 62, carriedResolved: 3, ...over })) });

  // Revert: key the marker off something other than carriedResolved > 0.
  it('a † with the carry tooltip and the footnote when carriedResolved > 0', () => {
    render(<KpiTiles {...carried()} />);
    expect(within(tile()).getByText('†').getAttribute('title')).toBe(CARRY_TITLE);
    const note = screen.getByTestId('kpi-resolved-footnote');
    expect(note.textContent).toBe('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.');
    expect(note.hasAttribute('aria-hidden')).toBe(false);
    expect(note.getAttribute('title')).toBe(note.textContent);
  });

  it('no † and an empty reserved footnote line when nothing carries', () => {
    render(<KpiTiles {...carried({ carriedResolved: 0 })} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByTitle(CARRY_TITLE)).toBeNull();
    const note = screen.getByTestId('kpi-resolved-footnote');
    expect(note.textContent).toBe(NBSP);
    expect(note.getAttribute('aria-hidden')).toBe('true');
  });

  // Revert: key the marker off carriedResolved alone (an invalid start date would then show a count nobody can trust).
  it('no † and no footnote when resolved is null (invalid start date), even though carriedResolved > 0', () => {
    render(<KpiTiles {...ovProps({ summary: { resolvedSince: { date: null, invalid: true }, ...pivot(ovCell(12, { resolved: null, dismissed: null, pctClosed: null, carriedResolved: 7 })) } })} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.getByTestId('kpi-resolved-footnote').textContent).toBe(NBSP);
  });
});

describe('"— of N raised are closed" cannot be reached', () => {
  const ENV = process.env.VULN_RESOLVED_SINCE;
  afterEach(() => {
    if (ENV === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = ENV;
    __clearVulnConfigCache();
  });

  // The tile prints "— of N raised" only for resolved !== null, raised > 0 and a null pctClosed. The aggregate emits a null
  // pctClosed only when resolved is null (an invalid start date) or nothing was raised (open + resolved = 0), so the branch is
  // dead. This pins that on real computePivot output: if the aggregate ever starts returning null for another reason, this fails
  // and the tile needs a guard.
  it.each([['a valid start date', '2020-01-08'], ['no start date', undefined], ['an invalid start date', 'not-a-date']] as const)('computePivot with %s', (_name, since) => {
    if (since === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = since;
    __clearVulnConfigCache();
    const alerts = [
      ...OV_ALERTS,
      alertFact(1, 90, 'critical', { state: 'fixed', resolvedAt: '2026-09-12T00:00:00Z' }),
      alertFact(4, 91, 'high', { state: 'dismissed', resolvedAt: '2026-09-11T00:00:00Z', dismissedReason: 'tolerable_risk' }),
    ];
    const repos = [...OV_REPOS, { ...OV_REPOS[0], repoId: 7, fullName: 'acme/empty', team: 'Docs' }]; // a team with nothing raised at all
    for (const team of [undefined, 'Payments', 'Docs']) {
      const { rows, total } = computePivot(alerts, repos, { codebase: 'backend', team, now: OV_FACTS_NOW });
      for (const row of [...rows, total]) {
        for (const sev of ['critical', 'high'] as const) {
          const c = row[sev];
          if (c.pctClosed === null) expect(c.resolved === null || c.open + c.resolved === 0).toBe(true);
          // and the tile, given this very cell, never prints the dead branch
          const { unmount } = render(<KpiTiles {...ovProps({ url: { severity: sev, kSev: sev }, summary: { pivot: { rows: [], total: { ...total, [sev]: c } } } })} />);
          expect(screen.getByTestId('kpi-resolved-closed').textContent).not.toMatch(/^—.* of /);
          unmount();
        }
      }
    }
  });
});

describe('titles (B4)', () => {
  // Revert: drop either title.
  it('the dismissed line and the % closed line carry their full text', () => {
    render(<KpiTiles {...ovProps({ summary: pivot(ovCell(19, { resolved: 25, dismissed: 4, pctClosed: 57 })) })} />);
    for (const id of ['kpi-resolved-since', 'kpi-resolved-closed']) {
      expect(screen.getByTestId(id).getAttribute('title')).toBe(screen.getByTestId(id).textContent);
    }
    expect(screen.getByTestId('kpi-resolved-closed').getAttribute('title')).toBe('57% of 44 raised are closed');
  });
});

describe('fixed shape', () => {
  // Revert: drop h-4 or truncate from one of the reserved lines.
  it('the dismissed line, the footnote slot and the % line are single fixed-height lines', () => {
    render(<KpiTiles {...ovProps()} />);
    for (const id of ['kpi-resolved-since', 'kpi-resolved-footnote', 'kpi-resolved-closed']) {
      expect(screen.getByTestId(id).className).toContain('h-4');
      expect(screen.getByTestId(id).className).toContain('truncate');
    }
  });
});
