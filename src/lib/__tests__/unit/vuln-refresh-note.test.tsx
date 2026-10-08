/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-refresh-note.test.tsx
// The one "Couldn't refresh · showing last load" note (refresh-note.tsx) and who announces it. A live region (role="status")
// is on the note that owns its request uniquely, so one failed request is announced once: not twice (two notes for the same
// repos slot) and not never.
import { render, screen } from '@testing-library/react';
import RefreshNote from '@/app/vulnerabilities/refresh-note';
import AlertsStrip from '@/app/vulnerabilities/alerts-strip';
import RepoRail from '@/app/vulnerabilities/repo-rail';
import AlertList from '@/app/vulnerabilities/alert-list';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import OwnershipCard from '@/app/vulnerabilities/ownership-card';
import TrendCard from '@/app/vulnerabilities/trend-card';
import { REFRESH_FAILED_NOTE } from '@/app/vulnerabilities/slot-view';
import { fixChartSize } from '../setup/chart-size';
import {
  viewProps, ovProps, slot, reposFixture, alertsFixture, alAlertRows, trendFixture, summaryFixture, ovSeries, ovTeam, ovCell, alSummary, AL_RAIL_ROWS,
} from '../support/security-fixtures';

fixChartSize();

describe('RefreshNote', () => {
  it('is an empty block with no title while nothing has failed', () => {
    render(<RefreshNote error={null} testId="n" />);
    const el = screen.getByTestId('n');
    expect(el.textContent).toBe('');
    expect(el.getAttribute('title')).toBeNull();
    expect(el.getAttribute('role')).toBeNull();
  });

  // Revert: print the error text instead of the shared wording, or drop the title.
  it('reads the shared wording, red, 12px, cut with an ellipsis, with the failed request\'s error text in its title', () => {
    render(<RefreshNote error="Couldn't load x: boom" testId="n" />);
    const el = screen.getByTestId('n');
    expect(el.textContent).toBe(REFRESH_FAILED_NOTE);
    expect(el.getAttribute('title')).toBe("Couldn't load x: boom");
    for (const c of ['text-xs', 'text-red-400', 'truncate', 'min-w-0']) expect(el.className.split(/\s+/)).toContain(c);
  });

  it('is a status region only when asked, and takes placement classes without losing its own', () => {
    const { rerender } = render(<RefreshNote error="x" testId="n" live className="absolute right-3 top-0" />);
    const el = screen.getByTestId('n');
    expect(el.getAttribute('role')).toBe('status');
    for (const c of ['absolute', 'right-3', 'top-0', 'text-xs', 'text-red-400', 'truncate']) expect(el.className.split(/\s+/)).toContain(c);
    rerender(<RefreshNote error="x" testId="n" />);
    expect(screen.getByTestId('n').getAttribute('role')).toBeNull();
  });
});

describe('one live note per failed request', () => {
  const failed = { error: new Error('boom'), errorText: "Couldn't load: boom" };
  const statusIds = () => screen.queryAllByRole('status').map(el => el.getAttribute('data-testid'));

  // Revert: make the rail's note live too (the strip already is): the failed repos request is then announced twice.
  it('Alerts view: the repos slot is announced by the strip alone, the alerts request by the list; the rail stays silent', () => {
    const p = viewProps({ summary: alSummary({ critical: 'active', high: 'active' }) });
    const props = {
      ...p,
      data: { ...p.data, repos: slot(reposFixture(AL_RAIL_ROWS), failed), alerts: slot(alertsFixture(alAlertRows(3), 3), failed) },
    };
    render(<><AlertsStrip {...props} /><RepoRail {...props} /><AlertList {...props} /></>);
    // All three notes show the failure ...
    for (const id of ['strip-refresh-note', 'rail-refresh-note', 'alert-refresh-note']) expect(screen.getByTestId(id).textContent).toBe(REFRESH_FAILED_NOTE);
    // ... and exactly two requests are announced, each once.
    expect(statusIds().sort()).toEqual(['alert-refresh-note', 'strip-refresh-note']);
  });

  it('Alerts view: with nothing failed the two live regions are present and empty', () => {
    const props = viewProps({ summary: alSummary({ critical: 'active', high: 'active' }) });
    render(<><AlertsStrip {...props} /><RepoRail {...props} /><AlertList {...props} /></>);
    expect(statusIds().sort()).toEqual(['alert-refresh-note', 'strip-refresh-note']);
    for (const el of screen.getAllByRole('status')) expect(el.textContent).toBe('');
  });

  // Revert: make the repository table's note live: the Overview's repos failure has no owner of its own (the strip is on the other view).
  it('Overview: the team table, the trend card and the sparkline are announced; the repositories tab\'s note is silent', () => {
    const teamSummary = slot(summaryFixture({ pivot: { rows: [ovTeam('Payments', ovCell(2), ovCell(1))], total: ovTeam('Total', ovCell(2), ovCell(1)) } }), failed);
    const ts = ovProps({
      teamSummary,
      data: { trend: slot(trendFixture([ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]])]), failed), sparkline: slot(trendFixture([ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]])]), failed) },
    });
    const { unmount } = render(<><KpiTiles {...ts} /><OwnershipCard {...ts} /><TrendCard {...ts} /></>);
    expect(statusIds().sort()).toEqual(['sparkline-refresh-note', 'team-table-refresh-note', 'trend-refresh-note']);
    unmount();
    const rp = ovProps({ url: { own: 'repos' }, data: { repos: slot(reposFixture(AL_RAIL_ROWS), failed) } });
    render(<OwnershipCard {...rp} />);
    expect(screen.getByTestId('repo-refresh-note').textContent).toBe(REFRESH_FAILED_NOTE);
    expect(screen.queryAllByRole('status').map(el => el.getAttribute('data-testid'))).not.toContain('repo-refresh-note');
  });
});
