/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-team-pivot.test.tsx
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import TeamPivot from '@/app/vulnerabilities/team-pivot';

const cell = (o: any = {}) => ({ open: 0, resolved: 0, dismissed: 0, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 0, ...o });
const rows = [
  { team: 'TeamA', critical: cell({ open: 6, resolved: 4, dismissed: 1, pctClosed: 40 }), high: cell({ open: 10 }), unmeasuredRepos: 2 },
  { team: 'Unassigned', critical: cell({ open: 1 }), high: cell(), unmeasuredRepos: 0 },
];
const total = { team: 'Total', critical: cell({ open: 7, resolved: 4, pctClosed: 40 }), high: cell({ open: 10 }), unmeasuredRepos: 2 };

it('renders severity bands, the dated Resolved caption, and — for null values', () => {
  render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
  expect(screen.getByText('CRITICAL')).toBeTruthy();
  expect(screen.getByText('HIGH')).toBeTruthy();
  expect(screen.getAllByText('since 2020-01-08').length).toBe(2);
  const unassigned = screen.getByText('Unassigned').closest('tr')!;
  expect(within(unassigned).getAllByText('—').length).toBeGreaterThan(0); // pctClosed null, overdue null
});

it('shows the unmeasured marker next to the critical Open value, not in the team-name cell, and the dismissed sub-count tooltip', () => {
  render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
  expect(screen.getAllByText(/2 repos unmeasured/).length).toBeGreaterThan(0);
  expect(screen.getByTitle('of which dismissed: 1')).toBeTruthy();
  const teamARow = screen.getByText('TeamA').closest('tr')!;
  const cells = teamARow.querySelectorAll('td');
  expect(within(cells[0]).queryByText(/repos unmeasured/)).toBeNull(); // not in the team-name cell
  expect(within(cells[1]).getByText('6')).toBeTruthy(); // critical Open cell
  expect(within(cells[1]).getByText(/2 repos unmeasured/)).toBeTruthy(); // marker sits right after it
});

it('renders — in the Δ cell for a team missing from an available delta', () => {
  const fullCell = (o: any = {}) => ({ open: 5, resolved: 5, dismissed: 0, pctClosed: 50, overdue: 0, dueSoon: 0, ...o });
  const rowsForTest = [
    { team: 'TeamA', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 },
  ];
  const totalForTest = { team: 'Total', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 };
  const deltaTeam = (team: string, deltaOpen: number) => ({ team, deltaOpen, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 });
  const delta = {
    // 'TeamA' is absent from `teams` — only 'OtherTeam' has a delta entry.
    critical: { available: true, baseline: null, reposNotInBaseline: 0, teams: [deltaTeam('OtherTeam', 3)], total: deltaTeam('Total', 3) },
    high: { available: true, baseline: null, reposNotInBaseline: 0, teams: [deltaTeam('OtherTeam', 0)], total: deltaTeam('Total', 0) },
  };
  render(<TeamPivot rows={rowsForTest as any} total={totalForTest as any} delta={delta as any} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
  const row = screen.getByText('TeamA').closest('tr')!;
  const cells = row.querySelectorAll('td');
  // cells: [team, crit-open, crit-Δ, crit-resolved, crit-%closed, crit-overdue, gap, high-open, high-Δ, ...]
  expect(cells[2].textContent).toBe('—');
});

it('has no Overdue column for high until the high SLA is active', () => {
  const { rerender } = render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
  expect(screen.getAllByText('Overdue').length).toBe(1);
  rerender(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={true} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
  expect(screen.getAllByText('Overdue').length).toBe(2);
});

describe('available delta rendering', () => {
  const fullCell = (o: any = {}) => ({ open: 5, resolved: 5, dismissed: 0, pctClosed: 50, overdue: 0, dueSoon: 0, ...o });
  const rowsForTest = [
    { team: 'TeamA', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 },
    { team: 'TeamB', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 },
  ];
  const totalForTest = { team: 'Total', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 };
  const deltaTeam = (team: string, deltaOpen: number) => ({ team, deltaOpen, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 });
  const delta = {
    critical: { available: true, baseline: null, reposNotInBaseline: 0, teams: [deltaTeam('TeamA', 12), deltaTeam('TeamB', -3)], total: deltaTeam('Total', 9) },
    high: { available: true, baseline: null, reposNotInBaseline: 0, teams: [deltaTeam('TeamA', 0), deltaTeam('TeamB', 0)], total: deltaTeam('Total', 0) },
  };

  it('renders a positive delta red and a negative delta green', () => {
    render(<TeamPivot rows={rowsForTest as any} total={totalForTest as any} delta={delta as any} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    const teamARow = screen.getByText('TeamA').closest('tr')!;
    const teamADelta = within(teamARow).getByText('+12');
    expect(teamADelta.className).toContain('text-red-400');
    const teamBRow = screen.getByText('TeamB').closest('tr')!;
    const teamBDelta = within(teamBRow).getByText('-3');
    expect(teamBDelta.className).toContain('text-green-400');
  });

  it('shows delta.total.deltaOpen on the Total row', () => {
    render(<TeamPivot rows={rowsForTest as any} total={totalForTest as any} delta={delta as any} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    const totalRow = screen.getByText('Total').closest('tr')!;
    expect(within(totalRow).getByText('+9')).toBeTruthy();
  });
});

describe('carried-resolved marker and footnote', () => {
  const rowsWithCarry = [
    { team: 'TeamA', critical: cell({ open: 5, resolved: 8, carriedResolved: 3 }), high: cell(), unmeasuredRepos: 0 },
    { team: 'Unassigned', critical: cell({ open: 1, resolved: 2 }), high: cell(), unmeasuredRepos: 0 },
  ];
  const totalWithCarry = { team: 'Total', critical: cell({ open: 6, resolved: 10, carriedResolved: 3 }), high: cell(), unmeasuredRepos: 0 };

  it('shows a † after the critical Resolved number for a row whose carriedResolved > 0, with the carry tooltip', () => {
    render(<TeamPivot rows={rowsWithCarry as any} total={totalWithCarry as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    const teamARow = screen.getByText('TeamA').closest('tr')!;
    expect(within(teamARow).getByText('†')).toBeTruthy();
    expect(within(teamARow).getByTitle('Includes 3 carried over from imported CSV history (archived repo with no alert data)')).toBeTruthy();
  });

  it('shows no † for a row whose carriedResolved is 0', () => {
    render(<TeamPivot rows={rowsWithCarry as any} total={totalWithCarry as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    const unassignedRow = screen.getByText('Unassigned').closest('tr')!;
    expect(within(unassignedRow).queryByText('†')).toBeNull();
  });

  it('shows the footnote line below the pivot when the total carriedResolved > 0', () => {
    render(<TeamPivot rows={rowsWithCarry as any} total={totalWithCarry as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.getByText('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.')).toBeTruthy();
  });

  it('shows neither marker nor footnote when nothing carries', () => {
    render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByText(/Resolved includes/)).toBeNull();
  });

  it('shows no † and no footnote when resolved is null (invalid start date) even though carriedResolved > 0', () => {
    const rowsInvalid = [
      { team: 'TeamA', critical: cell({ open: 5, resolved: null, carriedResolved: 3 }), high: cell(), unmeasuredRepos: 0 },
    ];
    const totalInvalid = { team: 'Total', critical: cell({ open: 5, resolved: null, carriedResolved: 3 }), high: cell(), unmeasuredRepos: 0 };
    render(<TeamPivot rows={rowsInvalid as any} total={totalInvalid as any} delta={null} highSlaActive={false} resolvedSince={{ date: null, invalid: true }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByText(/Resolved includes/)).toBeNull();
  });
});

describe('resolvedSince caption states (the Resolved column sub-header)', () => {
  it('a real date renders "since <date>"', () => {
    render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.getAllByText('since 2020-01-08').length).toBe(2);
  });
  it('date: null (VULN_RESOLVED_SINCE unset) renders "all time"', () => {
    render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: null, invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.getAllByText('all time').length).toBe(2);
  });
  it('invalid renders "since —"', () => {
    render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: null, invalid: true }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.getAllByText('since —').length).toBe(2);
  });
});

describe('delta baseline caption on the Δ column header', () => {
  const fullCell = (o: any = {}) => ({ open: 5, resolved: 5, dismissed: 0, pctClosed: 50, overdue: 0, dueSoon: 0, ...o });
  const rowsForTest = [{ team: 'TeamA', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 }];
  const totalForTest = { team: 'Total', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 };
  const baseline = (takenOn: string) => ({ source: 'sync' as const, key: 'sync:1', takenOn, measuredAt: `${takenOn}T06:00:00Z` });

  it('shows "vs <date>" under both Δ headers when both severities have an available delta with the same baseline', () => {
    const delta = {
      critical: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
      high: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
    };
    render(<TeamPivot rows={rowsForTest as any} total={totalForTest as any} delta={delta as any} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.getAllByText('vs 2099-01-01').length).toBe(2);
  });

  it('shows the caption only under the critical Δ header when high is unavailable (csv-import baseline)', () => {
    const delta = {
      critical: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
      high: { available: false, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
    };
    render(<TeamPivot rows={rowsForTest as any} total={totalForTest as any} delta={delta as any} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.getAllByText('vs 2099-01-01').length).toBe(1);
  });

  it('shows no caption under either Δ header when delta is null (no baseline picked)', () => {
    render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);
    expect(screen.queryByText(/^vs /)).toBeNull();
  });
});

describe('row selection', () => {
  it('clicking a row selects it, clicking the selected row clears it, and the selected row is highlighted', () => {
    const onSelectTeam = jest.fn();
    const { rerender } = render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={onSelectTeam} selectedTeam={null} />);
    fireEvent.click(screen.getByText('TeamA'));
    expect(onSelectTeam).toHaveBeenLastCalledWith('TeamA');

    rerender(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={onSelectTeam} selectedTeam="TeamA" />);
    const teamARow = screen.getByText('TeamA').closest('tr')!;
    expect(teamARow.className).toContain('bg-accent/10');

    fireEvent.click(screen.getByText('TeamA'));
    expect(onSelectTeam).toHaveBeenLastCalledWith(null);
  });
});

// ---------------------------------------------------------------------------------------------
// Layout stability: the Δ header's caption slot always renders. jsdom has no layout, so this
// guards structure only; the acceptance harness (pivot <th> x and width per action, incl. the
// csv-import baseline that never measures high) is the real check.
// ---------------------------------------------------------------------------------------------
describe('Δ caption slot is always present', () => {
  const fullCell = (o: any = {}) => ({ open: 5, resolved: 5, dismissed: 0, pctClosed: 50, overdue: 0, dueSoon: 0, ...o });
  const rowsForTest = [{ team: 'TeamA', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 }];
  const totalForTest = { team: 'Total', critical: fullCell(), high: fullCell(), unmeasuredRepos: 0 };
  const baseline = (takenOn: string) => ({ source: 'sync' as const, key: 'sync:1', takenOn, measuredAt: `${takenOn}T06:00:00Z` });
  const renderPivot = (delta: any) => render(<TeamPivot rows={rowsForTest as any} total={totalForTest as any} delta={delta} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={() => {}} selectedTeam={null} />);

  // Revert: render the caption only when there is one (`{deltaCaption && <div>…</div>}`).
  it('renders both slots as aria-hidden non-breaking spaces when there is no delta', () => {
    renderPivot(null);
    for (const sev of ['critical', 'high']) {
      const slot = screen.getByTestId(`pivot-delta-caption-${sev}`);
      expect(slot.textContent).toBe('\u00a0');
      expect(slot.getAttribute('aria-hidden')).toBe('true');
    }
  });

  // Revert: fall back to the placeholder for every severity (ignore `deltaCaption`), or share one
  // caption between the two severities instead of computing each from its own delta.
  it('holds "vs <date>" (not aria-hidden) for a severity with an available delta, and a placeholder for the other', () => {
    renderPivot({
      critical: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
      high: { available: false, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
    });
    const crit = screen.getByTestId('pivot-delta-caption-critical');
    expect(crit.textContent).toBe('vs 2099-01-01');
    expect(crit.hasAttribute('aria-hidden')).toBe(false);
    expect(screen.getByTestId('pivot-delta-caption-high').textContent).toBe('\u00a0');
  });

  // The slot carries the same width floor in every state (sized for "vs YYYY-MM-DD" at 10px), and
  // the numeric cells use tabular digits, so neither a baseline switch nor a changing value can
  // resize a column. Revert: drop `min-w-[…]` from the slot or `tabular-nums` from the cells.
  it('the caption slot has a min-width floor in both states, and numeric cells are tabular-nums', () => {
    const { unmount } = renderPivot(null);
    const empty = screen.getByTestId('pivot-delta-caption-critical').className;
    unmount();
    renderPivot({
      critical: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
      high: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
    });
    const floor = (cls: string) => cls.split(/\s+/).find(c => c.startsWith('min-w-'));
    expect(floor(empty)).toBeTruthy();
    expect(floor(screen.getByTestId('pivot-delta-caption-critical').className)).toBe(floor(empty));
    const cells = screen.getByText('TeamA').closest('tr')!.querySelectorAll('td');
    for (const i of [1, 2, 3, 4, 5]) expect(cells[i].className).toContain('tabular-nums'); // critical Open, Δ, Resolved, % closed, Overdue
  });

  // The Δ value sits in a span keyed by its text: in a right-aligned cell an in-place text edit moves
  // the text's start, which the browser's layout-shift API scores, while a remounted span is a new
  // object. jsdom keeps React's node reuse observable. Revert: drop `key={d ?? '—'}` from the span
  // (React then reuses the node and only edits its text).
  it('the Δ value span is a NEW node when its text changes', () => {
    const deltaTeam = (team: string, deltaOpen: number) => ({ team, deltaOpen, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0 });
    const withDelta = (open: number) => ({
      critical: { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [deltaTeam('TeamA', open)], total: deltaTeam('Total', open) },
      high: { available: false, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null },
    });
    const props = { rows: rowsForTest as any, total: totalForTest as any, highSlaActive: false, resolvedSince: { date: '2020-01-08', invalid: false }, onSelectTeam: () => {}, selectedTeam: null };
    const { rerender } = render(<TeamPivot {...props} delta={withDelta(12) as any} />);
    const teamARow = () => screen.getByText('TeamA').closest('tr')!;
    const before = within(teamARow()).getByText('+12');
    rerender(<TeamPivot {...props} delta={withDelta(5) as any} />);
    const after = within(teamARow()).getByText('+5');
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });
});
