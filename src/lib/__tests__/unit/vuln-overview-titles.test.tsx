/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-overview-titles.test.tsx
// Every element on the Overview that truncates with an ellipsis carries its own full text as a title, so a cut-off label or
// caption can always be read. Swept per component over a populated state, not sampled, so a new truncating element without a
// title fails here.
import { render } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import OwnershipCard from '@/app/vulnerabilities/ownership-card';
import TrendCard from '@/app/vulnerabilities/trend-card';
import { ovBaseline, ovCell, ovDelta, ovDeltaTeam, ovProps, ovSeries, ovTeam, cell, repoRow, slot, summaryFixture, trendFixture } from '../support/security-fixtures';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

// Placeholders (an aria-hidden non-breaking space that reserves a line) have no text to read, so no title either.
const blank = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, '').trim() === '';
// The repository table's header label sits inside a button that carries the title.
const titledByButton = (el: Element) => el.parentElement?.tagName === 'BUTTON' && !!el.parentElement.getAttribute('title');

function untitled(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.truncate'))
    .filter(el => !blank(el) && !titledByButton(el) && !(el.getAttribute('title') ?? '').trim())
    .map(el => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}: ${(el.textContent ?? '').slice(0, 50)}`);
}

const carry = ovCell(5, { resolved: 8, dismissed: 1, pctClosed: 62, carriedResolved: 3, overdue: 2, dueSoon: 1 });
const populated = (extra: Parameters<typeof ovProps>[0] = {}) => ovProps({
  summary: {
    slaStatus: { critical: 'active', high: 'active' },
    pivot: { rows: [ovTeam('Payments', carry, ovCell(2, { overdue: 1 }), 1), ovTeam('Unassigned', ovCell(1), ovCell(0))], total: ovTeam('Total', carry, ovCell(2, { overdue: 1 }), 1) },
    delta: { critical: ovDelta(ovDeltaTeam('Total', 2, { other: 3 }), { baseline: ovBaseline('2026-09-29'), reposNotInBaseline: 2 }), high: ovDelta(null) },
  },
  data: { sparkline: slot(trendFixture([ovSeries('Payments', [[ago(40), 4], [ago(1), 6]])])) },
  ...extra,
});

describe('every truncating element has its own title', () => {
  it('the KPI tiles', () => {
    const { container } = render(<KpiTiles {...populated()} />);
    expect(container.querySelectorAll('.truncate').length).toBeGreaterThan(8);
    expect(untitled(container)).toEqual([]);
  });

  it('the KPI tiles with no baseline and an invalid policy', () => {
    const { container } = render(<KpiTiles {...ovProps({ summary: { slaPolicyInvalid: true, slaStatus: { critical: 'none', high: 'none' }, resolvedSince: { date: null, invalid: true } } })} />);
    expect(untitled(container)).toEqual([]);
  });

  it('the ownership card on the Owning teams tab', () => {
    const { container } = render(<OwnershipCard {...populated()} />);
    expect(container.querySelectorAll('.truncate').length).toBeGreaterThan(8);
    expect(untitled(container)).toEqual([]);
  });

  it('the ownership card on the Repositories tab, with a measured, a zero, a long-named and an unmeasured repository', () => {
    const rows = [
      repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 3, overdue: 1, dueSoon: 0, oldestOpenDays: 9, nextDue: { date: '2026-10-09', daysRemaining: 2 } }), high: cell({ open: 1, overdue: 0 }) }),
      repoRow('acme/quiet', 'A very long owning team name that cannot fit its column', { critical: cell({ open: 0, overdue: 0 }), high: cell({ open: 0, overdue: 0 }) }),
      repoRow('acme/legacy-batch', 'Platform', { critical: cell({ open: 4 }), unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' } }),
    ];
    const { container } = render(<OwnershipCard {...populated({ url: { own: 'repos' }, repos: rows })} />);
    expect(container.querySelectorAll('.truncate').length).toBeGreaterThan(10);
    expect(untitled(container)).toEqual([]);
  });

  it('the ownership card with a failed refresh of the team table (the note is one of the truncating cells)', () => {
    const { container } = render(<OwnershipCard {...populated({ teamSummary: slot(summaryFixture(), { errorText: "Couldn't load team table: x" }) })} />);
    expect(container.querySelector('[data-testid="team-table-refresh-note"]')).not.toBeNull();
    expect(untitled(container)).toEqual([]);
  });

  it('the ownership card while a team is selected and the repo table has a refresh note', () => {
    const p = populated({ url: { own: 'repos', team: 'Payments' }, repos: [repoRow('acme/a', 'Payments')] });
    p.data.repos = { ...p.data.repos, errorText: "Couldn't load repositories: x" };
    const { container } = render(<OwnershipCard {...p} />);
    expect(untitled(container)).toEqual([]);
  });

  it('the trend card, with a legend entry beyond the top 12 and a long team name', () => {
    const many = Array.from({ length: 14 }, (_, i) => ovSeries(i === 0 ? 'A very long owning team name that would otherwise take the whole row' : `Team ${String(i).padStart(2, '0')}`, [[ago(40), 14 - i], [ago(1), 14 - i]]));
    const { container } = render(<TrendCard {...ovProps({ data: { trend: slot(trendFixture(many)) } })} />);
    expect(container.querySelectorAll('.truncate').length).toBeGreaterThan(4);
    expect(untitled(container)).toEqual([]);
  });
});
