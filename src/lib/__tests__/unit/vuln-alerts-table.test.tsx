/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-table.test.tsx
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import AlertsTable, { alertFilterQuery, AlertsPanel } from '@/app/vulnerabilities/alerts-table';
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

it('Repo and Team columns sort independently', () => {
  const { rows } = listAlerts([A(1, 1), A(2, 1)], [R(1, 'Zeta'), R(2, 'Alpha')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
  render(<AlertsTable rows={rows} totalCount={2} truncated={false} filters={F} onFiltersChange={() => {}} />);
  fireEvent.click(screen.getByText('Team'));
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

  it('a new `rows` prop (identity change) resets the visible count to 20', () => {
    const rowsA = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    const { rerender } = render(<AlertsTable rows={rowsA} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByText('Show 20 more'));
    expect(screen.getByText('Showing 40 of 45')).toBeTruthy();
    const rowsB = Array.from({ length: 45 }, (_, i) => alertRow(i + 101));
    rerender(<AlertsTable rows={rowsB} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    expect(screen.getByText('Showing 20 of 45')).toBeTruthy();
  });

  // pagination resets to 20 when new `rows` arrive, as a render-time adjustment. What this test
  // can and cannot catch: RTL's `rerender` runs inside `act()`, which also flushes passive effects
  // before the assertion, so the one-frame overshoot of the old `useEffect(() => setVisible(20),
  // [rows])` version is NOT observable here (verified: the test still passes against it). It does
  // catch a reset that is asynchronous (e.g. deferred to a timer) or missing altogether.
  it('pagination resets to 20 synchronously when new rows arrive (no async deferral)', () => {
    const rowsA = Array.from({ length: 45 }, (_, i) => alertRow(i + 1));
    const { rerender } = render(<AlertsTable rows={rowsA} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    fireEvent.click(screen.getByText('Show 20 more')); // visible -> 40
    expect(screen.getByText('Showing 40 of 45')).toBeTruthy();
    const rowsB = Array.from({ length: 45 }, (_, i) => alertRow(i + 101));
    rerender(<AlertsTable rows={rowsB} totalCount={45} truncated={false} filters={F} onFiltersChange={() => {}} />);
    const dataRowCount = screen.getAllByRole('row').length - 1; // minus the header row
    expect(dataRowCount).toBeLessThanOrEqual(20);
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
