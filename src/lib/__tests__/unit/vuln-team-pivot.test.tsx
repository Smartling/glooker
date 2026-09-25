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

describe('row selection', () => {
  it('clicking a row selects it, clicking the selected row clears it, and the selected row is highlighted', () => {
    const onSelectTeam = jest.fn();
    const { rerender } = render(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={onSelectTeam} selectedTeam={null} />);
    fireEvent.click(screen.getByText('TeamA'));
    expect(onSelectTeam).toHaveBeenLastCalledWith('TeamA');

    rerender(<TeamPivot rows={rows as any} total={total as any} delta={null} highSlaActive={false} resolvedSince={{ date: '2020-01-08', invalid: false }} onSelectTeam={onSelectTeam} selectedTeam="TeamA" />);
    const teamARow = screen.getByText('TeamA').closest('tr')!;
    expect(teamARow.className).toContain('bg-indigo-500/10');

    fireEvent.click(screen.getByText('TeamA'));
    expect(onSelectTeam).toHaveBeenLastCalledWith(null);
  });
});
