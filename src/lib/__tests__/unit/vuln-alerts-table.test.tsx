/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-table.test.tsx
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import AlertsTable, { alertFilterQuery, AlertsPanel, alertsSlotMinHeight, alertsBodyMinHeight, ALERT_COL_W, TABLE_MIN_W, ROW_H, HEAD_H, LINE_H, PAGE_ROWS } from '@/app/vulnerabilities/alerts-table';
import { listAlerts } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';

const R = (repoId: number, team: string) => ({ repoId, fullName: `o/r${repoId}`, team, serviceTier: 'production', codebaseType: 'backend', archived: false, dependabotStatus: 'ok', dependabotStatusDetail: null }) as any;
const A = (repoId: number, n: number, over: any = {}) => ({ repoId, number: n, htmlUrl: `u${repoId}${n}`, state: 'open', severity: 'critical', severityChangedAt: null, ghsaId: `G${n}`, cveId: `CVE-${repoId}${n}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false, packageName: 'pkg', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: null, createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false, ...over });
const F = { state: 'open' as const, overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', repo: null as string | null };

it('renders an overdue alert red with a negative countdown (synthetic configured policy, now after the due date)', () => {
  // computeDue's default policy now comes from getVulnConfig().slaPolicy
  // (neutral-empty unless configured), not the deleted policy.ts constant — inject a policy
  // that's already in effect (past synthetic date 2020-01-08, per the public-repo date
  // convention — never a plausible near-future one; see vuln-aggregate.test.ts).
  const PRIOR = process.env.VULNERABILITIES_SLA_POLICY;
  process.env.VULNERABILITIES_SLA_POLICY = JSON.stringify([{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 }]);
  __clearVulnConfigCache();
  try {
    const { rows, totalCount, truncated } = listAlerts([A(1, 1)], [R(1, 'Zeta')], { codebase: 'backend', state: 'open' }, new Date('2026-09-15T00:00:00Z'));
    render(<AlertsTable rows={rows} totalCount={totalCount} truncated={truncated} filters={F} onFiltersChange={() => {}} />);
    const due = screen.getByText('2026-09-08 (-7d)');
    expect(due.className).toContain('text-red-400');
  } finally {
    if (PRIOR === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = PRIOR;
    __clearVulnConfigCache();
  }
});

it('filter chips report immediately; search debounces ~300ms after the last keystroke', () => {
  jest.useFakeTimers();
  try {
    const onChange = jest.fn();
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={onChange} />);
    fireEvent.click(screen.getByText('Overdue'));
    expect(onChange).toHaveBeenLastCalledWith({ ...F, overdue: true });

    const input = screen.getByPlaceholderText('Search CVE, GHSA, package, repo');
    fireEvent.change(input, { target: { value: 'lodash' } });
    // The input reflects the keystroke immediately, but onFiltersChange must not fire yet.
    expect((input as HTMLInputElement).value).toBe('lodash');
    expect(onChange).toHaveBeenLastCalledWith({ ...F, overdue: true });

    act(() => { jest.advanceTimersByTime(300); });
    expect(onChange).toHaveBeenLastCalledWith({ ...F, q: 'lodash' });
  } finally {
    jest.useRealTimers();
  }
});

it('Repo and Owning team columns sort independently', () => {
  const { rows } = listAlerts([A(1, 1), A(2, 1)], [R(1, 'Zeta'), R(2, 'Alpha')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
  render(<AlertsTable rows={rows} totalCount={2} truncated={false} filters={F} onFiltersChange={() => {}} />);
  fireEvent.click(screen.getByText('Owning team'));
  const body = screen.getAllByRole('row').slice(1);
  expect(within(body[0]).getByText('Alpha')).toBeTruthy();
  fireEvent.click(screen.getByText('Repo'));
  expect(within(screen.getAllByRole('row').slice(1)[0]).getByText('r1')).toBeTruthy();
});

it('alertFilterQuery maps UI filters to the API parameters', () => {
  expect(alertFilterQuery({ ...F, overdue: true, reopened: true, runtimeOnly: true, q: 'x' }))
    .toBe('state=open&overdue=true&reopened=true&dependency_scope=runtime&q=x');
  // "Due ≤ 7d" sends the due_soon filter, not a due_before cutoff — due_before
  // used to also match already-overdue alerts (any due date before the cutoff, past or future).
  expect(alertFilterQuery({ ...F, dueSoon: true })).toBe('state=open&due_soon=true');
});

// repo is local alert-filter state, like the chips — not URL, not page-wide.
it('alertFilterQuery includes repo when set', () => {
  expect(alertFilterQuery({ ...F, repo: 'acme/one' })).toBe('state=open&repo=acme%2Fone');
  expect(alertFilterQuery(F)).toBe('state=open');
});

it('choosing Resolved disables the time-based chips and clears overdue/dueSoon', () => {
  const onChange = jest.fn();
  const { rerender } = render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={{ ...F, overdue: true }} onFiltersChange={onChange} />);
  fireEvent.click(screen.getByText('Resolved'));
  expect(onChange).toHaveBeenCalledWith({ ...F, overdue: false, dueSoon: false, state: 'resolved' });

  rerender(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={{ ...F, state: 'resolved' }} onFiltersChange={onChange} />);
  expect((screen.getByText('Overdue') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Due ≤ 7d') as HTMLButtonElement).disabled).toBe(true);
});

it('Overdue and Due ≤ 7d are mutually exclusive — turning one on turns the other off', () => {
  const onChange = jest.fn();
  const { rerender } = render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={{ ...F, dueSoon: true }} onFiltersChange={onChange} />);
  fireEvent.click(screen.getByText('Overdue'));
  expect(onChange).toHaveBeenLastCalledWith({ ...F, overdue: true, dueSoon: false });

  rerender(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={{ ...F, overdue: true }} onFiltersChange={onChange} />);
  fireEvent.click(screen.getByText('Due ≤ 7d'));
  expect(onChange).toHaveBeenLastCalledWith({ ...F, overdue: false, dueSoon: true });
});

it('flushes a pending debounced search on unmount instead of dropping it', () => {
  jest.useFakeTimers();
  try {
    const onChange = jest.fn();
    const { unmount } = render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={onChange} />);
    const input = screen.getByPlaceholderText('Search CVE, GHSA, package, repo');
    fireEvent.change(input, { target: { value: 'lodash' } });
    unmount();
    expect(onChange).toHaveBeenCalledWith({ ...F, q: 'lodash' });
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(300); });
    expect(onChange).toHaveBeenCalledTimes(1); // the timer never fired again post-unmount
  } finally {
    jest.useRealTimers();
  }
});

it('unmounting after the debounce already fired does not call onFiltersChange a second time', () => {
  jest.useFakeTimers();
  try {
    const onChange = jest.fn();
    // No rerender with an updated `filters` prop after the debounce fires — the parent hasn't
    // picked up the change yet, which is exactly the case that must not double-send.
    const { unmount } = render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={onChange} />);
    const input = screen.getByPlaceholderText('Search CVE, GHSA, package, repo');
    fireEvent.change(input, { target: { value: 'lodash' } });
    act(() => { jest.advanceTimersByTime(300); });
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('unmounting with nothing typed does not call onFiltersChange', () => {
  const onChange = jest.fn();
  const { unmount } = render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={onChange} />);
  unmount();
  expect(onChange).not.toHaveBeenCalled();
});

it('a stale table dims only the table container, not the search input or the chips', () => {
  const { rows } = listAlerts([A(1, 1)], [R(1, 'Zeta')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
  render(<AlertsTable rows={rows} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} stale />);
  const input = screen.getByPlaceholderText('Search CVE, GHSA, package, repo');
  expect(input.closest('.opacity-60')).toBeNull();
  const overdueChip = screen.getByText('Overdue');
  expect(overdueChip.closest('.opacity-60')).toBeNull();
  const table = screen.getByRole('table');
  expect(table.closest('.opacity-60')).not.toBeNull();
});

it('opacity-60 is absent when the table is not stale', () => {
  const { rows } = listAlerts([A(1, 1)], [R(1, 'Zeta')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
  const { container } = render(<AlertsTable rows={rows} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
  expect(container.querySelector('.opacity-60')).toBeNull();
});

// all fetched rows (up to 200) used to render at once, pushing the Coverage panel far down
// the page. AlertsTable now shows only the first `visible` (starting at 20) of the sorted rows,
// with a "Show 20 more" button and a "Showing N of M" count line — separate from the existing
// "N alerts." total (API totalCount) and truncation-note line, which stay as-is.
function alertRow(i: number, overrides: Partial<import('@/lib/vulnerabilities/aggregate').AlertRow> = {}) {
  return {
    repo: `acme/repo-${String(i).padStart(3, '0')}`, team: 'T1', severity: 'critical' as const, severityChangedAt: null,
    cveId: `CVE-${i}`, ghsaId: null, summary: null, cvss: null, epss: null,
    packageName: 'pkg', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: 'runtime',
    createdAt: '2026-09-01T00:00:00Z', ageDays: 1, clockStart: null, dueDate: null, daysRemaining: null,
    slaPolicyId: null, state: 'open' as const, dismissedReason: null, resolvedAt: null,
    resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, htmlUrl: `u${i}`,
    ...overrides,
  };
}

describe('pagination (show 20, then "Show 20 more")', () => {
  it('renders the first 20 of 45 loaded rows, with "Showing 20 of 45" and a "Show 20 more" button', () => {
    const rows = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    render(<AlertsTable rows={rows} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    expect(screen.getAllByRole('row')).toHaveLength(21); // 1 header + 20 body rows
    expect(screen.getByText('Showing 20 of 45')).toBeTruthy();
    expect(screen.getByText('Show 20 more')).toBeTruthy();
  });

  it('one click reveals 40; a second click reveals 45 and hides the button', () => {
    const rows = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    render(<AlertsTable rows={rows} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByText('Show 20 more'));
    expect(screen.getAllByRole('row')).toHaveLength(41);
    expect(screen.getByText('Showing 40 of 45')).toBeTruthy();
    fireEvent.click(screen.getByText('Show 20 more'));
    expect(screen.getAllByRole('row')).toHaveLength(46);
    expect(screen.getByText('Showing 45 of 45')).toBeTruthy();
    expect(screen.queryByText('Show 20 more')).toBeNull();
  });

  it('sorting applies to all 45 loaded rows before slicing — a row at original position 44 that sorts first appears on the first page', () => {
    const rows = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    rows[44] = alertRow(46, { repo: 'aaa/first' }); // last original position, sorts first by repo
    render(<AlertsTable rows={rows} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByText(/^Repo/));
    const body = screen.getAllByRole('row').slice(1);
    expect(within(body[0]).getByText('first')).toBeTruthy();
  });

  // DELIBERATELY CHANGED (layout-stability decision (b)): this used to assert that a new `rows`
  // identity reset the visible count to 20. The page size the user expanded to now PERSISTS across
  // filter changes (the reserved slot height follows it, so a filter change never shrinks the panel
  // under a scrolled page); only a reload resets it. Revert that (re-add the `prevRows` reset) and
  // this test fails: it would read "Showing 20 of 45".
  it('a new `rows` prop (identity change) KEEPS the expanded page size (only a reload resets it)', () => {
    const rowsA = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    const { rerender } = render(<AlertsTable rows={rowsA} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByText('Show 20 more'));
    expect(screen.getByText('Showing 40 of 45')).toBeTruthy();
    const rowsB = Array.from({ length: 45 }, (_, i) => alertRow(i + 101));
    rerender(<AlertsTable rows={rowsB} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    expect(screen.getByText('Showing 40 of 45')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(41);
  });

  // DELIBERATELY CHANGED (decision (b)); replaces "pagination resets to 20 synchronously when new
  // rows arrive". The observable now: after expanding, a SHORTER result shows all of its rows with
  // the count clamped to what is loaded ("Showing 5 of 5", never "Showing 40 of 5"), and the
  // reserved height still follows the expanded page size. Reverts that fail it: `shown = visible`
  // (the count line reads "Showing 40 of 5"); re-adding a reset of `visible` when `rows` changes, or
  // sizing the reservation from the loaded rows instead of `visible` (the slot minHeight drops back
  // to the 20-row value, or fails to grow after "Show 20 more").
  it('after expanding, a shorter result clamps the count line to the loaded rows and keeps the reserved height', () => {
    const rowsA = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    const { rerender } = render(<AlertsTable rows={rowsA} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const minHeight = () => parseInt((screen.getByTestId('alerts-slot') as HTMLElement).style.minHeight, 10);
    const twentyRows = minHeight();
    fireEvent.click(screen.getByText('Show 20 more')); // visible -> 40
    const expanded = minHeight();
    // Literal arithmetic, not alertsSlotMinHeight(40): the constant must not be compared to itself.
    expect(expanded).toBeGreaterThan(twentyRows);
    expect(expanded).toBeGreaterThanOrEqual(HEAD_H + 40 * ROW_H + 2 * LINE_H);
    const rowsB = Array.from({ length: 5 }, (_, i) => alertRow(i + 101));
    rerender(<AlertsTable rows={rowsB} totalCount={5} truncated={false} filters={F} onFiltersChange={() => {}} />);
    expect(screen.getByText('Showing 5 of 5')).toBeTruthy();
    expect(screen.queryByText('Show 20 more')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect(minHeight()).toBe(expanded); // unchanged after the shorter rerender
  });

  // Revert: drop the `Math.min(v + PAGE_ROWS, sorted.length)` clamp in the "Show 20 more" handler
  // (plain `v + PAGE_ROWS`): two clicks on 45 rows then reserve 60 rows of height, not 45.
  it('two "Show 20 more" clicks on 45 rows reserve the height of 45 rows, not 60 (visible is clamped)', () => {
    const rows = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    render(<AlertsTable rows={rows} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByText('Show 20 more'));
    fireEvent.click(screen.getByText('Show 20 more'));
    expect(screen.getByText('Showing 45 of 45')).toBeTruthy();
    const slot = screen.getByTestId('alerts-slot') as HTMLElement;
    expect(slot.style.minHeight).toBe(`${alertsSlotMinHeight(45)}px`);
    expect(slot.style.minHeight).not.toBe(`${alertsSlotMinHeight(60)}px`);
    expect(parseInt(slot.style.minHeight, 10)).toBeLessThan(HEAD_H + 60 * ROW_H);
  });
});

// before any SLA is active (critical starts on the configured effectiveFrom, high has no
// policy entry yet), Overdue and Due ≤ 7d always returned an empty list with no hint why. Both
// chips are now also disabled whenever no severity's slaStatus is 'active', with a hint next to
// them computed generically from `policy` (each entry's `pending` flag, as returned by
// policyWindows()) — never hardcoded, so a policy change updates it.
describe('time chips disabled with a hint while no SLA is active', () => {
  const pendingPolicy = [{ id: 'critical-2020-01', severity: 'critical' as const, effectiveFrom: '2020-01-08', days: 9, until: null, pending: true }];

  it('every severity pending, with a critical entry on 2020-01-08: both chips disabled, hint reads "Due dates start 2020-01-08"', () => {
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={() => {}}
      slaStatus={{ critical: 'pending', high: 'none' }} policy={pendingPolicy} />);
    expect((screen.getByText('Overdue') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Due ≤ 7d') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Due dates start 2020-01-08')).toBeTruthy();
  });

  it('critical active: the chips are enabled and there is no hint', () => {
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={() => {}}
      slaStatus={{ critical: 'active', high: 'none' }} policy={pendingPolicy} />);
    expect((screen.getByText('Overdue') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Due ≤ 7d') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Due dates start/)).toBeNull();
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  it('an empty policy with \'none\' everywhere: hint reads "No SLA policy yet"', () => {
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={() => {}}
      slaStatus={{ critical: 'none', high: 'none' }} policy={[]} />);
    expect((screen.getByText('Overdue') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Due ≤ 7d') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No SLA policy yet')).toBeTruthy();
  });

  it('clears overdue/dueSoon if somehow set while no SLA is active', () => {
    const onChange = jest.fn();
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={{ ...F, overdue: true }} onFiltersChange={onChange}
      slaStatus={{ critical: 'pending', high: 'none' }} policy={pendingPolicy} />);
    expect(onChange).toHaveBeenCalledWith(F);
  });

  it('missing slaStatus (existing direct renders) behaves as before: chips stay enabled, no hint', () => {
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={() => {}} />);
    expect((screen.getByText('Overdue') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Due dates start/)).toBeNull();
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  // an invalid VULNERABILITIES_SLA_POLICY parses to an empty policy
  // (config.ts), which is indistinguishable from a genuinely empty one unless policyInvalid is
  // checked first — an invalid policy must never read as "no policy configured yet".
  it('an invalid policy: hint reads "SLA policy configuration is invalid" instead of "No SLA policy yet"', () => {
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={() => {}}
      slaStatus={{ critical: 'none', high: 'none' }} policy={[]} policyInvalid />);
    expect((screen.getByText('Overdue') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('SLA policy configuration is invalid')).toBeTruthy();
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });
});

// the repo dropdown's options come from the alerts response's `repos` facet (every repo
// matching every filter except `repo` itself, ignoring `limit`), never from the
// (possibly truncated, possibly filtered-by-repo-already) loaded rows.
describe('repo dropdown', () => {
  const repoFacet = [{ repo: 'acme/one', count: 5 }, { repo: 'acme/two', count: 2 }, { repo: 'acme/three', count: 1 }];

  it('options come from the facet, not the loaded rows — 3 facet repos with rows from only 1 of them still shows 3 options', () => {
    const { rows } = listAlerts([A(1, 1)], [R(1, 'Zeta')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
    render(<AlertsTable rows={rows} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} repos={repoFacet} />);
    const select = screen.getByLabelText('Repo') as HTMLSelectElement;
    expect(select.options.length).toBe(4); // "All repos" + 3
    expect(select.disabled).toBe(false);
    expect(screen.getByText('one (5)')).toBeTruthy();
    expect(screen.getByText('two (2)')).toBeTruthy();
    expect(screen.getByText('three (1)')).toBeTruthy();
  });

  it('selecting a repo sends repo=<full name>', () => {
    const onChange = jest.fn();
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={onChange} repos={repoFacet} />);
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'acme/two' } });
    expect(onChange).toHaveBeenCalledWith({ ...F, repo: 'acme/two' });
  });

  it('choosing "All repos" clears the filter', () => {
    const onChange = jest.fn();
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={{ ...F, repo: 'acme/two' }} onFiltersChange={onChange} repos={repoFacet} />);
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ ...F, repo: null });
  });

  it('never empty-and-enabled: with no facet available yet, the select is disabled', () => {
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const select = screen.getByLabelText('Repo') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options.length).toBe(1); // "All repos" only
  });
});

// a facet covers every filter EXCEPT `repo` (see the comment above), so toggling another
// filter (Resolved, Reopened, Runtime only, or search) can drop the selected repo out of the facet
// while filters.repo stays set. The select must not silently fall back to "All repos" in that
// case — that would hide the reason the list looks empty while repo=X is still being sent.
describe('repo dropdown keeps a stale selection visible', () => {
  const repoFacet = [{ repo: 'acme/one', count: 5 }, { repo: 'acme/two', count: 2 }];

  it('renders the selected-but-missing repo as an extra "(0)" option, selected, and keeps sending repo=', () => {
    const filters = { ...F, repo: 'acme/three' };
    render(<AlertsTable rows={[]} totalCount={0} truncated={false} filters={filters} onFiltersChange={() => {}} repos={repoFacet} />);
    const select = screen.getByLabelText('Repo') as HTMLSelectElement;
    expect(select.value).toBe('acme/three');
    expect(screen.getByText('three (0)')).toBeTruthy();
    // The dropdown doesn't clear the selection itself — the next alerts request still carries it.
    expect(alertFilterQuery(filters)).toContain('repo=acme%2Fthree');
  });
});

describe('AlertsPanel', () => {
  const filtersProp = { filters: F, onFiltersChange: () => {} };

  it('no data yet and validating shows "Loading…" with no "Updating…" label', () => {
    render(<AlertsPanel data={undefined} error={undefined} isLoading {...filtersProp} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('an error hides the "Updating…" label even when stale data would otherwise show it', () => {
    const { rows } = listAlerts([A(1, 1)], [R(1, 'Zeta')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
    render(<AlertsPanel data={{ rows, totalCount: 1, truncated: false }} error={new Error('boom')} isLoading {...filtersProp} />);
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(screen.getByText(/Couldn't load alerts/)).toBeTruthy();
    // previously good rows must not show under the error — the case with
    // data present matters most, since a stale-but-real row could otherwise be mistaken for
    // current data. 'r1' probes a row (R(1, ...) -> repo 'o/r1', rendered as the last path
    // segment), and the "N alerts." text probes the count line.
    expect(screen.queryByText('r1')).toBeNull();
    expect(screen.queryByText(/1 alerts\./)).toBeNull();
  });

  it('stale data (isLoading with data present) shows the "Updating…" label and the table', () => {
    const { rows } = listAlerts([A(1, 1)], [R(1, 'Zeta')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
    render(<AlertsPanel data={{ rows, totalCount: 1, truncated: false }} error={undefined} isLoading {...filtersProp} />);
    expect(screen.getByText('Updating…')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    // positive control for the same probes used in the error-with-data test
    // below — with no error, the row and count line DO render, so a probe that finds nothing under
    // error is actually detecting the error, not a broken query.
    expect(screen.getByText('r1')).toBeTruthy();
    expect(screen.getByText(/1 alerts\./)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Layout stability (GLOOK-43 follow-up). The rule: a page-filter change may change what the alerts
// slot SHOWS, never its size. jsdom has no layout engine, so everything below is a regression guard
// on structure, classes and inline styles: it proves the mechanism is in place, not that the page
// does not jump. The real check is the browser acceptance harness (headless Chrome, layout-shift
// API and scrollHeight per action). Each test names the revert that makes it fail.
// ---------------------------------------------------------------------------------------------
describe('alerts slot: fixed geometry', () => {
  const LONG_PKG = '@synthetic-scope/an-extremely-long-package-name-that-overflows-the-package-column-2099';
  const LONG_REASON = 'A very long dismissal reason typed into the dismissal comment box by a maintainer, going on and on.';
  const tds = (tr: HTMLElement) => Array.from(tr.querySelectorAll('td')) as HTMLElement[];
  const longRow = () => alertRow(1, {
    packageName: LONG_PKG, ecosystem: 'npm', team: 'Team With A Long Name', repo: 'o/a-repo-with-a-fairly-long-short-name',
    state: 'dismissed' as const, dismissedReason: LONG_REASON, dueDate: '2099-01-01', daysRemaining: 12,
    cveId: 'CVE-2099-12345', cvss: 9.8, reopenedCount: 1, scope: 'development',
  });

  // Revert: drop the `title` (or the whitespace-nowrap / text-ellipsis classes) from a truncatable
  // cell, add a title to Age / Sev / Scope, or put "reopened" back in the CVE title / drop it from
  // the State title.
  it('every truncatable cell carries its full text as a title plus nowrap + ellipsis; Sev, Age and Scope carry no title', () => {
    render(<AlertsTable rows={[longRow()]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const cells = tds(screen.getAllByRole('row')[1]);
    // columns: Sev, CVE, Package, Repo, Team, Age, Due, Scope, State
    expect(cells).toHaveLength(9);
    expect(cells[1].getAttribute('title')).toBe('CVE-2099-12345 9.8'); // "reopened" lives in the State cell now
    expect(cells[2].getAttribute('title')).toBe(`${LONG_PKG} (npm)`);
    expect(cells[3].getAttribute('title')).toBe('a-repo-with-a-fairly-long-short-name');
    expect(cells[4].getAttribute('title')).toBe('Team With A Long Name');
    expect(cells[6].getAttribute('title')).toBe('—'); // a dismissed row with no resolvedOnTime
    expect(cells[8].getAttribute('title')).toBe(`dismissed · ${LONG_REASON} · reopened`);
    for (const i of [1, 2, 3, 4, 6, 8]) {
      expect(cells[i].className).toContain('whitespace-nowrap');
      expect(cells[i].className).toContain('text-ellipsis');
      expect(cells[i].className).toContain('overflow-hidden');
    }
    for (const i of [0, 5, 7]) {
      expect(cells[i].hasAttribute('title')).toBe(false);
      expect(cells[i].className).toContain('whitespace-nowrap'); // still pinned to one line
    }
  });

  // Revert: drop `title={dueText}` from the Due cell (or build it from anything but the due text).
  it('an open row with a due date puts the due text in the Due title; a row with no SLA titles "no SLA"', () => {
    render(<AlertsTable rows={[alertRow(1, { dueDate: '2099-01-01', daysRemaining: 12 }), alertRow(2)]} totalCount={2} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(tds(body[0])[6].getAttribute('title')).toBe('2099-01-01 (12d)');
    expect(tds(body[1])[6].getAttribute('title')).toBe('no SLA');
  });

  // Revert: drop `truncate` from the id link or `shrink-0` from the CVSS score, or move the reopened
  // badge back into the CVE cell. The id is the part that is allowed to be cut.
  it('the CVE cell: the id link truncates, the CVSS score is shrink-0, and the reopened badge is not in this cell', () => {
    render(<AlertsTable rows={[longRow()]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const cell = tds(screen.getAllByRole('row')[1])[1];
    const link = cell.querySelector('a') as HTMLElement;
    expect(link.className).toContain('truncate');
    expect(screen.getByText('9.8').className).toContain('shrink-0');
    expect(link.parentElement!.className).toContain('flex');
    expect(cell.textContent).not.toContain('reopened');
  });

  // USER DECISION: the reopened badge moved from the CVE cell into the State cell, which is a flex row
  // whose state text truncates and whose badge never does (resolved-then-reopened rows included).
  // Revert: put the badge back in the CVE cell, drop `shrink-0` from the badge or `min-w-0 truncate`
  // from the state text, or drop "· reopened" from the State title.
  it('the State cell: the state text truncates, the reopened badge is shrink-0 and last, and the title ends with "· reopened"', () => {
    render(<AlertsTable rows={[longRow(), alertRow(2, { state: 'fixed' as const, resolvedOnTime: true, reopenedCount: 2 }), alertRow(3)]} totalCount={3} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const body = screen.getAllByRole('row').slice(1);
    for (const tr of body.slice(0, 2)) {
      const state = tds(tr)[8];
      const badge = within(state).getByText('reopened');
      expect(state.contains(badge)).toBe(true);
      expect(badge.className).toContain('shrink-0');
      expect(badge.className).toContain('leading-none');
      const flex = badge.parentElement as HTMLElement;
      expect(flex.className).toContain('flex');
      expect(flex.lastElementChild).toBe(badge);
      expect(flex.firstElementChild!.className).toContain('min-w-0');
      expect(flex.firstElementChild!.className).toContain('truncate');
      expect(state.getAttribute('title')).toMatch(/ · reopened$/);
    }
    expect(tds(body[1])[8].getAttribute('title')).toBe('fixed · reopened');
    // a row that was never reopened has no badge and no suffix
    expect(within(tds(body[2])[8]).queryByText('reopened')).toBeNull();
    expect(tds(body[2])[8].getAttribute('title')).toBe('open');
    expect(tds(body[2])[1].textContent).not.toContain('reopened');
  });

  // A null package must render nothing (as on main), never the text "null", in the cell or its title.
  // Revert: build pkgText from the raw template with no null guard.
  // Matches origin/main, which rendered `{r.packageName}{ecosystem}`: a null package shows only the
  // ecosystem. Revert: interpolate `r.packageName` without `?? ''`, which prints "null".
  it('a null packageName shows only the ecosystem, never the text "null"', () => {
    render(<AlertsTable rows={[alertRow(1, { packageName: null, ecosystem: 'npm' })]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const cell = tds(screen.getAllByRole('row')[1])[2];
    expect(cell.textContent).toBe(' (npm)');
    expect(cell.getAttribute('title')).not.toContain('null');
    expect(screen.getAllByRole('row')[1].textContent).not.toContain('null');
  });

  it('a null packageName with no ecosystem renders an empty Package cell with no title', () => {
    render(<AlertsTable rows={[alertRow(1, { packageName: null, ecosystem: null })]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const cell = tds(screen.getAllByRole('row')[1])[2];
    expect(cell.textContent).toBe('');
    expect(cell.hasAttribute('title')).toBe(false);
  });

  // Rows are keyed by position (`key={i}`), so a filter change repaints row N in place instead of
  // sliding the same alert up the page (which the layout-shift API scores). jsdom keeps React's node
  // reuse observable. Revert: key the rows by alert (`key={r.htmlUrl}`).
  it('the first body row is the same DOM node across a rerender with different rows', () => {
    const base = { totalCount: 3, truncated: false, filters: F, onFiltersChange: () => {} };
    const { container, rerender } = render(<AlertsTable rows={[alertRow(1), alertRow(2), alertRow(3)]} {...base} />);
    const first = container.querySelector('tbody tr') as HTMLElement;
    expect(first.textContent).toContain('CVE-1');
    rerender(<AlertsTable rows={[alertRow(11), alertRow(12), alertRow(13)]} {...base} />);
    const after = container.querySelector('tbody tr') as HTMLElement;
    expect(after.textContent).toContain('CVE-11');
    expect(after).toBe(first);
  });

  // Revert: drop `style={{ height: ROW_H }}` from the <tr>, the fixed leading from the cells, or
  // `leading-none` from a badge. (Whether the browser then renders exactly ROW_H is what the
  // harness's "every alerts tr equals ROW_H" gate checks.)
  it('every body row and the header row carry an inline pinned height; cells have a fixed leading; badges are leading-none', () => {
    render(<AlertsTable rows={[longRow(), alertRow(2, { severity: 'high' as const })]} totalCount={2} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const rows = screen.getAllByRole('row');
    expect(rows[0].style.height).toBe(`${HEAD_H}px`);
    for (const tr of rows.slice(1)) {
      expect(tr.style.height).toBe(`${ROW_H}px`);
      for (const td of tds(tr)) expect(td.className).toContain('leading-4');
    }
    for (const th of Array.from(rows[0].querySelectorAll('th'))) {
      expect(th.className).toContain('whitespace-nowrap');
      expect(th.className).toContain('leading-4');
    }
    expect(screen.getByText('CRIT').className).toContain('leading-none');
    expect(screen.getByText('HIGH').className).toContain('leading-none');
  });

  // Revert: remove the <colgroup>, `table-fixed`, or a <col> width. Package is the one flexible
  // column, so it is the one <col> with no width.
  it('one <col> per <th>, every <col> except Package has a width, and the table is table-fixed', () => {
    render(<AlertsTable rows={[alertRow(1)]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const table = screen.getByRole('table');
    const cols = Array.from(table.querySelectorAll('col')) as HTMLElement[];
    const ths = Array.from(table.querySelectorAll('th'));
    expect(cols).toHaveLength(ths.length);
    const packageIdx = ths.findIndex(th => th.textContent === 'Package');
    expect(packageIdx).toBeGreaterThanOrEqual(0);
    cols.forEach((c, i) => {
      if (i === packageIdx) expect(c.style.width).toBe('');
      else expect(parseInt(c.style.width, 10)).toBeGreaterThan(0);
    });
    expect(table.className).toContain('table-fixed');
    expect(table.style.minWidth).toBe(`${TABLE_MIN_W}px`);
  });

  // Each <col> must carry the width of the header at its own index. Revert: swap two <col> widths
  // (e.g. Sev and CVE), which the count-only test above cannot see.
  it('each <col> width matches the ALERT_COL_W entry of the <th> at the same index', () => {
    render(<AlertsTable rows={[alertRow(1)]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const table = screen.getByRole('table');
    const cols = Array.from(table.querySelectorAll('col')) as HTMLElement[];
    const ths = Array.from(table.querySelectorAll('th'));
    const keyOf: Record<string, keyof typeof ALERT_COL_W | null> = {
      'Sev': 'sev', 'CVE / advisory': 'cve', 'Package': null, 'Repo': 'repo', 'Owning team': 'team', 'Age': 'age', 'Due': 'due', 'Scope': 'scope', 'State': 'state',
    };
    expect(ths.map(th => th.textContent)).toEqual(Object.keys(keyOf));
    ths.forEach((th, i) => {
      const key = keyOf[th.textContent!];
      expect(key).not.toBeUndefined();
      expect(cols[i].style.width).toBe(key === null ? '' : `${ALERT_COL_W[key!]}px`);
    });
  });

  // Hard rule: no horizontal scroll of the alerts table at a viewport >= 1024px, where the panel
  // content is ~950px (a classic 15px scrollbar included). This guards the width BUDGET: a
  // change that widens a column past it fails here instead of only in the browser.
  it('the table minimum width fits a 1024px viewport (<= 951px of content, ~950px, classic scrollbar included)', () => {
    expect(TABLE_MIN_W).toBeLessThanOrEqual(951);
    expect(Object.keys(ALERT_COL_W)).toHaveLength(8); // 9 columns, Package flexible
  });

  // Presence guard only: the inline value compares the constant to itself, so it cannot prove the
  // browser renders that height. The harness ("alerts-slot height" and scrollHeight gates) does.
  // Revert: drop the inline minHeight/minWidth from the slot.
  it('the slot has an inline reservation: header + a full page of rows + both lines, and the table min-width', () => {
    render(<AlertsTable rows={[alertRow(1)]} totalCount={1} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const slot = screen.getByTestId('alerts-slot');
    expect(slot.style.minHeight).toBe(`${alertsSlotMinHeight(PAGE_ROWS)}px`);
    expect(parseInt(slot.style.minHeight, 10)).toBeGreaterThanOrEqual(HEAD_H + PAGE_ROWS * ROW_H + 2 * LINE_H);
    expect(slot.style.minWidth).toBe(`${TABLE_MIN_W}px`);
    // the slot sits INSIDE the horizontal scroll wrapper, so the reservation excludes its scrollbar
    expect(slot.parentElement!.className).toContain('overflow-x-auto');
  });

  // The body region has its own floor (header + a full page of rows), so the count line and the
  // footnote below it do not slide up when a result is shorter. Reverts that fail it: remove the
  // alerts-body wrapper or its inline minHeight, render a branch outside it, or move the count line
  // inside it (it would then sit right under the rows again).
  it('alerts-body carries the floor, wraps the loading / error / table branches, and precedes the count line', () => {
    const base = { totalCount: 0, truncated: false, filters: F, onFiltersChange: () => {} };
    const { rerender } = render(<AlertsTable rows={[]} {...base} loading />);
    const body = screen.getByTestId('alerts-body') as HTMLElement;
    const check = (probe: () => HTMLElement) => {
      expect(screen.getByTestId('alerts-body')).toBe(body);
      expect(body.style.minHeight).toBe(`${alertsBodyMinHeight(PAGE_ROWS)}px`);
      expect(parseInt(body.style.minHeight, 10)).toBeGreaterThanOrEqual(HEAD_H + PAGE_ROWS * ROW_H);
      expect(body.contains(probe())).toBe(true);
      const line = screen.getByTestId('alerts-count-line');
      expect(body.contains(line)).toBe(false);
      expect(body.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };
    check(() => screen.getByText('Loading…'));
    rerender(<AlertsTable rows={[alertRow(1)]} {...base} totalCount={1} />);
    check(() => screen.getByRole('table'));
    rerender(<AlertsTable rows={[]} {...base} error="Couldn't load alerts" />);
    check(() => screen.getByText("Couldn't load alerts"));
    // and its floor follows the expanded page size, like the slot's
    rerender(<AlertsTable rows={Array.from({ length: 45 }, (_, i) => alertRow(i + 1))} {...base} totalCount={45} />);
    fireEvent.click(screen.getByText('Show 20 more'));
    expect(parseInt(body.style.minHeight, 10)).toBeGreaterThanOrEqual(HEAD_H + 40 * ROW_H);
    expect(body.style.minHeight).toBe(`${alertsBodyMinHeight(40)}px`);
  });

  // The slot keeps the table's min-width below ~950px, so the message would sit at the slot's left
  // edge, off-screen. Revert: drop `sticky left-0` or the viewport-bounded max width from the wrapper.
  // The slot's height is unaffected (the wrapper sits inside alerts-body, which has the floor).
  it('the loading and error text sits in a sticky left-0 box bounded to the viewport width', () => {
    const base = { rows: [] as any[], totalCount: 0, truncated: false, filters: F, onFiltersChange: () => {} };
    const { rerender } = render(<AlertsTable {...base} loading />);
    const expectBox = (text: string) => {
      const box = screen.getByText(text).parentElement as HTMLElement;
      expect(box.className).toContain('sticky');
      expect(box.className).toContain('left-0');
      expect(box.className).toContain('max-w-[calc(100vw-4rem)]');
      expect(screen.getByTestId('alerts-body').contains(box)).toBe(true);
    };
    expectBox('Loading…');
    rerender(<AlertsTable {...base} error="Couldn't load alerts" />);
    expectBox("Couldn't load alerts");
  });

  // Revert: render the loading / error / empty branches outside the slot (or as a different element).
  it('the slot is the same DOM node across loading, populated, error and empty renders, each with the reservation', () => {
    const base = { totalCount: 0, truncated: false, filters: F, onFiltersChange: () => {} };
    const { rerender } = render(<AlertsTable rows={[]} {...base} loading />);
    const slot = screen.getByTestId('alerts-slot');
    const expectSlot = () => {
      expect(screen.getByTestId('alerts-slot')).toBe(slot);
      expect(slot.style.minHeight).toBe(`${alertsSlotMinHeight(PAGE_ROWS)}px`);
      expect(slot.style.minWidth).toBe(`${TABLE_MIN_W}px`);
    };
    expectSlot();
    rerender(<AlertsTable rows={[alertRow(1)]} {...base} totalCount={1} />);
    expectSlot();
    expect(screen.getByRole('table')).toBeTruthy();
    rerender(<AlertsTable rows={[]} {...base} error="Couldn't load alerts" />);
    expectSlot();
    expect(screen.queryByRole('table')).toBeNull();
    rerender(<AlertsTable rows={[]} {...base} />);
    expectSlot();
    expect(screen.getAllByRole('row')).toHaveLength(1); // the empty result is the header row alone: no message row
  });
});

describe('alerts slot: count line and footnote always occupy their lines', () => {
  const props = { filters: F, onFiltersChange: () => {} };
  const line = () => screen.getByTestId('alerts-count-line');
  const foot = () => screen.getByTestId('alerts-footnote');

  // Revert: render the count line only when sorted.length > 20 (the old behaviour).
  it('reads "Showing 5 of 5" when N equals M and "Showing 0 of 0" for an empty result', () => {
    const { rerender } = render(<AlertsTable rows={Array.from({ length: 5 }, (_, i) => alertRow(i + 1))} totalCount={5} truncated={false} {...props} />);
    expect(line().textContent).toBe('Showing 5 of 5');
    expect(line().hasAttribute('aria-hidden')).toBe(false);
    rerender(<AlertsTable rows={[]} totalCount={0} truncated={false} {...props} />);
    expect(line().textContent).toBe('Showing 0 of 0');
  });

  // Revert: drop the `placeholder ?` branch on the count line or the footnote (an error would then
  // read "Showing 0 of 0" and "0 alerts.").
  it('is an empty aria-hidden placeholder (a non-breaking space) in the loading and error states, never a fake "Showing 0 of 0"', () => {
    const { rerender } = render(<AlertsTable rows={[]} totalCount={0} truncated={false} {...props} loading />);
    expect(line().textContent).toBe('\u00a0');
    expect(line().getAttribute('aria-hidden')).toBe('true');
    expect(foot().textContent).toBe('\u00a0');
    expect(foot().getAttribute('aria-hidden')).toBe('true');
    rerender(<AlertsTable rows={[]} totalCount={0} truncated={false} {...props} error="boom" />);
    expect(line().textContent).toBe('\u00a0');
    expect(foot().textContent).toBe('\u00a0');
    expect(screen.queryByText(/Showing 0 of 0/)).toBeNull();
  });

  // Revert: give the count line no fixed height/padding, or move its spacing to a margin.
  it('both lines carry an inline LINE_H height, nowrap, and padding (not margin) for their spacing', () => {
    render(<AlertsTable rows={Array.from({ length: 45 }, (_, i) => alertRow(i + 1))} totalCount={45} truncated={false} {...props} />);
    for (const el of [line(), foot()]) {
      expect(el.style.height).toBe(`${LINE_H}px`);
      expect(el.className).toContain('whitespace-nowrap');
      expect(el.className).toContain('pt-1');
      expect(el.className).not.toMatch(/(^|\s)m[tb]-/);
    }
    // "Show 20 more" sits ON the count line, so the line is the same height with or without it
    expect(within(line()).getByText('Show 20 more')).toBeTruthy();
  });

  // The count line must not clip the "Show 20 more" focus ring. Revert: put `overflow-hidden` (or
  // any overflow clip) back on the count line. Its height stays fixed either way.
  it('the count line does not clip overflow (so the button focus ring shows) and keeps its fixed height', () => {
    render(<AlertsTable rows={Array.from({ length: 45 }, (_, i) => alertRow(i + 1))} totalCount={45} truncated={false} {...props} />);
    expect(line().className).not.toMatch(/overflow-/);
    expect(line().style.height).toBe(`${LINE_H}px`);
    expect(foot().style.height).toBe(`${LINE_H}px`);
  });

  // COPY CHANGE. Old: "Showing 200 of 340 alerts." (its denominator conflicted with the count line's
  // own "Showing 20 of 200"). Revert: restore the old truncated wording.
  it('the footnote reads "200 of 340 alerts loaded." when truncated and "340 alerts." when not', () => {
    const { rerender } = render(<AlertsTable rows={Array.from({ length: 200 }, (_, i) => alertRow(i + 1))} totalCount={340} truncated {...props} />);
    expect(foot().textContent).toBe('200 of 340 alerts loaded. Counts are Dependabot alerts, not CVEs.');
    expect(line().textContent).toContain('Showing 20 of 200');
    rerender(<AlertsTable rows={Array.from({ length: 5 }, (_, i) => alertRow(i + 1))} totalCount={340} truncated={false} {...props} />);
    expect(foot().textContent).toBe('340 alerts. Counts are Dependabot alerts, not CVEs.');
  });
});

describe('Repo select: fixed width', () => {
  const facet = [{ repo: 'acme/one', count: 5 }, { repo: 'acme/a-repo-with-a-much-longer-name', count: 12 }];
  const base = { rows: [] as any[], totalCount: 0, truncated: false, onFiltersChange: () => {} };

  // Revert: drop `w-48` / `shrink-0` (the select then sizes to its longest facet option and the
  // search input, which is flex-1, absorbs the change and slides the Team select).
  it('carries w-48 and shrink-0, so its width does not depend on the facet', () => {
    render(<AlertsTable {...base} filters={F} repos={facet} />);
    const select = screen.getByLabelText('Repo');
    expect(select.className).toContain('w-48');
    expect(select.className).toContain('shrink-0');
  });

  // Revert: drop `title` from the Repo select, or derive it from anything but the selected label.
  it("its title is the selected option's label (the closed select truncates it)", () => {
    const { rerender } = render(<AlertsTable {...base} filters={F} repos={facet} />);
    expect(screen.getByLabelText('Repo').getAttribute('title')).toBe('All repos');
    rerender(<AlertsTable {...base} filters={{ ...F, repo: 'acme/a-repo-with-a-much-longer-name' }} repos={facet} />);
    expect(screen.getByLabelText('Repo').getAttribute('title')).toBe('a-repo-with-a-much-longer-name (12)');
    rerender(<AlertsTable {...base} filters={{ ...F, repo: 'acme/gone' }} repos={facet} />);
    expect(screen.getByLabelText('Repo').getAttribute('title')).toBe('gone (0)');
  });
});
