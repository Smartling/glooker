/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-repo-rail.test.tsx
// The Alerts view's 260px repository rail: client re-sort, the SLA-gated OVERDUE figure, selection,
// unmeasured rows, the wrapping footer note (one of the three fixes beyond the handoff).
import { render, screen, fireEvent, within } from '@testing-library/react';
import RepoRail, { railSlaNote, railStat, sortRailRows } from '@/app/vulnerabilities/repo-rail';
import { RAIL_W } from '@/app/vulnerabilities/dimensions';
import { unmeasuredReason } from '@/app/vulnerabilities/labels';
import { REFRESH_FAILED_NOTE, UNAVAILABLE_TEXT } from '@/app/vulnerabilities/slot-view';
import {
  viewProps, slot, reposFixture, repoRow, cell, REPO_ROWS, AL_RAIL_ROWS, alSummary, type AlSlaKind,
} from '../support/security-fixtures';

// Dates print through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });

const bothActive = alSummary({ critical: 'active', high: 'active' });

function props(opts: { rows?: Parameters<typeof reposFixture>[0]; urlOver?: Record<string, unknown>; effectiveRepo?: string | null; summary?: ReturnType<typeof alSummary>; repos?: unknown } = {}) {
  const base = viewProps({ summary: opts.summary ?? bothActive });
  return {
    ...base,
    url: { ...base.url, ...(opts.urlOver ?? {}) },
    data: { ...base.data, repos: opts.repos ?? slot(reposFixture(opts.rows ?? AL_RAIL_ROWS)), effectiveRepo: opts.effectiveRepo ?? null },
  } as ReturnType<typeof viewProps>;
}
const REPO_ROWS_NO_HIGH = [
  repoRow('acme/ledger', 'Payments', { critical: cell({ open: 5 }), high: cell({ open: 0 }) }),
  repoRow('acme/audit-log', 'Platform', { critical: cell({ open: 2 }), high: cell({ open: 0 }) }),
];
const REPO_ROWS_NO_CRIT = [
  repoRow('acme/ledger', 'Payments', { critical: cell({ open: 0 }), high: cell({ open: 4 }) }),
  repoRow('acme/audit-log', 'Platform', { critical: cell({ open: 0 }), high: cell({ open: 1 }) }),
];
const railNames = () => screen.getAllByTestId('rail-row').map(el => el.getAttribute('data-repo'));
const row = (name: string) => screen.getAllByTestId('rail-row').find(el => el.getAttribute('data-repo') === name)!;

describe('structure', () => {
  it('has the REPOSITORIES header, a count line and a "Filter by name" box', () => {
    render(<RepoRail {...props()} />);
    expect(screen.getByText('Repositories')).toBeTruthy();
    expect(screen.getByTestId('rail-meta').textContent).toBe('6 repos + 2 unmeasured');
    expect(screen.getByPlaceholderText('Filter by name')).toBeTruthy();
  });

  it('the first row reads "All repositories", or "All <team> repositories" with a team filter, with the scope\'s counts', () => {
    const { unmount } = render(<RepoRail {...props()} />);
    expect(screen.getByTestId('rail-all').textContent).toContain('All repositories');
    expect(screen.getByTestId('rail-all').textContent).toContain('25 crit · 14 high open');
    unmount();
    render(<RepoRail {...props({ urlOver: { team: 'Payments' } })} />);
    expect(screen.getByTestId('rail-all').textContent).toContain('All Payments repositories');
  });

  // Revert: feed the All row scopeOpenCount(rows, 'critical'/'high', null) regardless of Severity: under "High only" the row reads "0 high open" over hidden critical alerts.
  it.each([
    ['high', 'No open high alerts', 'no open high alerts', REPO_ROWS_NO_HIGH],
    ['critical', 'No open critical alerts', 'no open critical alerts', REPO_ROWS_NO_CRIT],
  ] as const)('the All row zeroes the hidden severity like the rows do: Severity "%s only" with none open reads "%s"', (severity, _l, expected, rows) => {
    render(<RepoRail {...props({ rows, urlOver: { severity } })} />);
    expect(screen.getByTestId('rail-all').textContent).toContain(expected);
    expect(screen.getByTestId('rail-all').textContent).not.toMatch(/\d+ (crit|high)/);
    // The rows read the same words.
    for (const r of screen.getAllByTestId('rail-counts')) expect(r.textContent).toBe(expected);
  });

  it('the All row under a narrowed Severity counts only that severity', () => {
    const { unmount } = render(<RepoRail {...props({ urlOver: { severity: 'critical' } })} />);
    expect(screen.getByTestId('rail-all').textContent).toContain('25 crit open');
    expect(screen.getByTestId('rail-all').textContent).not.toContain('high');
    unmount();
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(screen.getByTestId('rail-all').textContent).toContain('14 high open');
    expect(screen.getByTestId('rail-all').textContent).not.toContain('crit');
  });

  it.each([
    ['populated', props()],
    ['loading', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined) })],
    ['error', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('x'), errorText: "Couldn't load repositories: x" }) })],
    ['empty scope', props({ rows: [] })],
  ])('the %s rail is RAIL_W wide as an inline style', (_label, p) => {
    render(<RepoRail {...p} />);
    expect(screen.getByTestId('repo-rail').style.width).toBe(`${RAIL_W}px`);
  });

  it('loading reads "Loading…" and an error shows its text, with the All row and the footer still there', () => {
    const { unmount } = render(<RepoRail {...props({ repos: slot<ReturnType<typeof reposFixture>>(undefined) })} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByTestId('rail-all')).toBeTruthy();
    unmount();
    render(<RepoRail {...props({ repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('x'), errorText: "Couldn't load repositories: x" }) })} />);
    expect(screen.getByText("Couldn't load repositories: x")).toBeTruthy();
    expect(screen.getByTestId('rail-sla-note')).toBeTruthy();
  });

  it('an empty scope reads "No repositories in this scope."', () => {
    render(<RepoRail {...props({ rows: [] })} />);
    expect(screen.getByText('No repositories in this scope.')).toBeTruthy();
  });
});

describe('order: overdue, then open critical, then open high, then name; unmeasured last', () => {
  it('re-sorts the server order (which is by open critical) so a repository with more overdue comes first', () => {
    // The fixture is in SERVER order: ledger-service (5 critical) first. The rail must not keep it.
    expect(AL_RAIL_ROWS[0].fullName).toBe('acme/ledger-service');
    render(<RepoRail {...props()} />);
    expect(railNames()).toEqual([
      'acme/checkout-api',    // 4 overdue
      'acme/billing-worker',  // 1 overdue
      'acme/ledger-service',  // 0 overdue, 5 critical
      'acme/audit-log',       // 2 critical, 5 high
      'acme/zeta-jobs',       // the same figures, so by name
      'acme/quiet-service',   // nothing open
    ]);
  });

  it('Severity "High only" sorts by the visible severity: hidden critical counts as 0', () => {
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(railNames()).toEqual([
      'acme/checkout-api',    // 3 high overdue
      'acme/audit-log', 'acme/zeta-jobs',   // 5 high open
      'acme/billing-worker',  // 1 high open
      'acme/ledger-service', 'acme/quiet-service',   // nothing visible, by name
    ]);
  });

  it('Severity "Critical only" counts only critical overdue', () => {
    render(<RepoRail {...props({ urlOver: { severity: 'critical' } })} />);
    expect(railNames().slice(0, 3)).toEqual(['acme/checkout-api', 'acme/billing-worker', 'acme/ledger-service']);
  });

  it('unmeasured repositories come last, whatever their stored counts, ordered by name', () => {
    render(<RepoRail {...props()} />);
    const all = Array.from(screen.getByTestId('rail-list').querySelectorAll('[data-testid="rail-row"], [data-testid="rail-unmeasured"]'))
      .map(el => el.getAttribute('data-repo'));
    expect(all.slice(-2)).toEqual(['acme/invoice-render', 'acme/legacy-batch']);
    expect(all.slice(0, -2).every(n => !['acme/invoice-render', 'acme/legacy-batch'].includes(n!))).toBe(true);
  });

  it('sortRailRows is a pure function of rows, severity and the SLA state', () => {
    const sorted = sortRailRows(AL_RAIL_ROWS, 'both', bothActive).map(s => s.row.fullName);
    expect(sorted[0]).toBe('acme/checkout-api');
    expect(sorted).not.toContain('acme/invoice-render');
  });
});

describe('the OVERDUE figure', () => {
  it('shows "N OVERDUE" summed over the visible severities with an active SLA, and nothing when it is 0', () => {
    render(<RepoRail {...props()} />);
    expect(within(row('acme/checkout-api')).getByTestId('rail-overdue').textContent).toBe('4 OVERDUE');
    expect(within(row('acme/billing-worker')).getByTestId('rail-overdue').textContent).toBe('1 OVERDUE');
    expect(within(row('acme/ledger-service')).queryByTestId('rail-overdue')).toBeNull();
    expect(screen.queryByText(/^0 OVERDUE/)).toBeNull();
  });

  it('Severity "Critical only" drops the high overdue, and "High only" drops the critical overdue', () => {
    const { unmount } = render(<RepoRail {...props({ urlOver: { severity: 'critical' } })} />);
    expect(within(row('acme/checkout-api')).getByTestId('rail-overdue').textContent).toBe('1 OVERDUE');
    unmount();
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(within(row('acme/checkout-api')).getByTestId('rail-overdue').textContent).toBe('3 OVERDUE');
    expect(within(row('acme/billing-worker')).queryByTestId('rail-overdue')).toBeNull();
  });

  it.each<[AlSlaKind, AlSlaKind, string | null]>([
    ['active', 'active', '4 OVERDUE'],
    ['active', 'pending', '1 OVERDUE'],
    ['pending', 'active', '3 OVERDUE'],
    ['none', 'none', null],
    ['pending', 'pending', null],
    ['invalid', 'invalid', null],
  ])('critical %s, high %s: checkout-api reads %s', (critical, high, expected) => {
    // The rows still carry overdue figures: the SLA state, not the row, decides whether one is shown.
    render(<RepoRail {...props({ summary: alSummary({ critical, high }) })} />);
    const el = within(row('acme/checkout-api')).queryByTestId('rail-overdue');
    expect(el?.textContent ?? null).toBe(expected);
  });
});

describe('row content', () => {
  it('shows "N crit · N high open" and the owning team only when no team filter is set', () => {
    const { unmount } = render(<RepoRail {...props()} />);
    expect(within(row('acme/billing-worker')).getByTestId('rail-counts').textContent).toBe('2 crit · 1 high open');
    expect(row('acme/billing-worker').textContent).toContain('Owning team: Payments');
    unmount();
    render(<RepoRail {...props({ urlOver: { team: 'Payments' } })} />);
    expect(row('acme/billing-worker').textContent).not.toContain('Owning team');
  });

  it('a hidden severity is left out of the counts', () => {
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(within(row('acme/billing-worker')).getByTestId('rail-counts').textContent).toBe('1 high open');
  });

  it('a repository with no open alerts is greyed and says "no open alerts"', () => {
    render(<RepoRail {...props()} />);
    const quiet = row('acme/quiet-service');
    expect(within(quiet).getByTestId('rail-counts').textContent).toBe('no open alerts');
    expect(quiet.innerHTML).toContain('text-gray-500');
    expect(quiet.innerHTML).not.toContain('text-gray-200');
    expect(row('acme/checkout-api').innerHTML).toContain('text-gray-200');
  });

  // Revert: ignore Severity in the empty text (a repository with only critical alerts reads clean under "High only").
  it('under a narrowed Severity the empty text names it: "no open critical alerts" / "no open high alerts"', () => {
    const { unmount } = render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    // ledger-service has only critical alerts open: it is empty under "High only", but not clean.
    expect(within(row('acme/ledger-service')).getByTestId('rail-counts').textContent).toBe('no open high alerts');
    expect(within(row('acme/quiet-service')).getByTestId('rail-counts').textContent).toBe('no open high alerts');
    unmount();
    render(<RepoRail {...props({ urlOver: { severity: 'critical' } })} />);
    expect(within(row('acme/quiet-service')).getByTestId('rail-counts').textContent).toBe('no open critical alerts');
    expect(within(row('acme/ledger-service')).getByTestId('rail-counts').textContent).toBe('5 crit open');
  });

  it('railStat treats a row whose only open alerts are of a hidden severity as empty', () => {
    const r = repoRow('acme/x', 'Payments', { critical: cell({ open: 4, overdue: 2 }), high: cell() });
    expect(railStat(r, 'high', bothActive)).toEqual({ crit: 0, high: 0, overdue: 0, total: 0 });
    expect(railStat(r, 'both', bothActive)).toEqual({ crit: 4, high: 0, overdue: 2, total: 4 });
  });
});

describe('selection', () => {
  it('tints the selected row, shows × and marks it pressed; the All row is not selected then', () => {
    render(<RepoRail {...props({ effectiveRepo: 'acme/audit-log' })} />);
    const sel = row('acme/audit-log');
    expect(sel.getAttribute('aria-pressed')).toBe('true');
    expect(sel.className).toContain('bg-accent/10');
    expect(sel.textContent).toContain('×');
    expect(screen.getByTestId('rail-all').getAttribute('aria-pressed')).toBe('false');
    expect(row('acme/zeta-jobs').getAttribute('aria-pressed')).toBe('false');
    expect(row('acme/zeta-jobs').textContent).not.toContain('×');
  });

  it('with no repository the All row is the tinted one', () => {
    render(<RepoRail {...props()} />);
    expect(screen.getByTestId('rail-all').className).toContain('bg-accent/10');
    expect(screen.getByTestId('rail-all').getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking a row calls url.setRepo with that repository and nothing else on the URL', () => {
    const p = props();
    render(<RepoRail {...p} />);
    fireEvent.click(row('acme/audit-log'));
    expect(p.url.setRepo).toHaveBeenCalledTimes(1);
    expect(p.url.setRepo).toHaveBeenCalledWith('acme/audit-log');
    // A rail click is a replace of `repo` only: no history entry, no view or team change.
    expect(p.url.selectRepoRow).not.toHaveBeenCalled();
    expect(p.url.setTeam).not.toHaveBeenCalled();
    expect(p.url.setView).not.toHaveBeenCalled();
  });

  it('clicking the selected row (its ×) or the All row clears the repository', () => {
    const p = props({ effectiveRepo: 'acme/audit-log' });
    render(<RepoRail {...p} />);
    fireEvent.click(row('acme/audit-log'));
    expect(p.url.setRepo).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByTestId('rail-all'));
    expect(p.url.setRepo).toHaveBeenLastCalledWith(null);
    expect(p.url.setRepo).toHaveBeenCalledTimes(2);
  });
});

describe('unmeasured rows', () => {
  it('are hatched, read "UNMEASURED · <reason>", show no counts, and open the drawer from the clicked element', () => {
    const p = props();
    render(<RepoRail {...p} />);
    const off = screen.getAllByTestId('rail-unmeasured').find(el => el.getAttribute('data-repo') === 'acme/invoice-render')!;
    const err = screen.getAllByTestId('rail-unmeasured').find(el => el.getAttribute('data-repo') === 'acme/legacy-batch')!;
    expect(off.className).toContain('vuln-hatch');
    expect(off.textContent).toContain('Unmeasured · Dependabot off');
    expect(err.textContent).toContain('Unmeasured · HTTP 500: status check failed');
    // The rail's style is capitals (CSS), over the one shared wording.
    expect(off.querySelector('.uppercase')!.textContent).toBe(`Unmeasured · ${unmeasuredReason({ status: 'dependabot-off', detail: null })}`);
    expect(off.textContent).not.toMatch(/crit|high|\d+ open/);
    fireEvent.click(off);
    expect(p.openDrawer).toHaveBeenCalledWith(off);
    expect(p.url.setRepo).not.toHaveBeenCalled();
  });

});

describe('the name filter', () => {
  it('filters measured and unmeasured rows by name, updates the count, and says so when nothing matches', () => {
    render(<RepoRail {...props()} />);
    const box = screen.getByPlaceholderText('Filter by name');
    fireEvent.change(box, { target: { value: 'LEDGER' } });
    expect(railNames()).toEqual(['acme/ledger-service']);
    expect(screen.getByTestId('rail-meta').textContent).toBe('1 repo');
    fireEvent.change(box, { target: { value: 'invoice' } });
    expect(screen.queryAllByTestId('rail-row')).toHaveLength(0);
    expect(screen.getAllByTestId('rail-unmeasured')).toHaveLength(1);
    expect(screen.getByTestId('rail-meta').textContent).toBe('0 repos + 1 unmeasured');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('No repositories match “zzz”.')).toBeTruthy();
  });
});

describe('footer', () => {
  it('reads "Sorted by overdue, then open critical" above the SLA explanation', () => {
    render(<RepoRail {...props()} />);
    const footer = screen.getByText('Sorted by overdue, then open critical').parentElement!;
    expect(footer.textContent).toContain('Overdue counts critical and high');
  });

  it('the SLA explanation wraps instead of truncating (fix 1 beyond the handoff)', () => {
    render(<RepoRail {...props({ summary: alSummary({ critical: 'active', high: 'pending' }) })} />);
    const note = screen.getByTestId('rail-sla-note');
    expect(note.textContent).toBe('Overdue counts critical only · high: SLA starts Feb 1, 2099');
    for (const clipping of ['truncate', 'whitespace-nowrap', 'text-ellipsis', 'overflow-hidden']) {
      expect(note.className.split(/\s+/)).not.toContain(clipping);
    }
    expect(note.className).toContain('whitespace-normal');
    expect(note.className).toContain('break-words');
  });

  // Revert: print the "No active SLA policy" catch-all again (it hides which state each severity is in), or drop the "SLA" from a
  // state that has no SLA header above it.
  it.each<[AlSlaKind, AlSlaKind, string]>([
    ['active', 'active', 'Overdue counts critical and high'],
    ['active', 'pending', 'Overdue counts critical only · high: SLA starts Feb 1, 2099'],
    ['active', 'none', 'Overdue counts critical only · high: no SLA policy yet'],
    ['pending', 'active', 'Overdue counts high only · critical: SLA starts Feb 1, 2099'],
    ['none', 'active', 'Overdue counts high only · critical: no SLA policy yet'],
    ['none', 'none', 'No SLA policy yet · no overdue counts'],
    ['pending', 'pending', 'SLA starts Feb 1, 2099 · no overdue counts'],
    ['invalid', 'invalid', "SLA policy can't be read · no overdue counts"],
    ['pending', 'none', 'Critical: SLA starts Feb 1, 2099 · high: no SLA policy yet · no overdue counts'],
    ['none', 'pending', 'Critical: no SLA policy yet · high: SLA starts Feb 1, 2099 · no overdue counts'],
  ])('critical %s, high %s: "%s"', (critical, high, expected) => {
    expect(railSlaNote(alSummary({ critical, high }))).toBe(expected);
    render(<RepoRail {...props({ summary: alSummary({ critical, high }) })} />);
    expect(screen.getByTestId('rail-sla-note').textContent).toBe(expected);
  });

  // Revert: ignore Severity in railSlaNote (under "Critical only" the footer would still talk about high).
  it.each<[string, AlSlaKind, AlSlaKind, string]>([
    ['critical', 'active', 'active', 'Overdue counts critical only'],
    ['critical', 'active', 'pending', 'Overdue counts critical only'],
    ['high', 'active', 'active', 'Overdue counts high only'],
    ['high', 'pending', 'active', 'Overdue counts high only'],
    ['critical', 'pending', 'active', 'SLA starts Feb 1, 2099 · no overdue counts'],
    ['critical', 'none', 'active', 'No SLA policy yet · no overdue counts'],
    ['high', 'active', 'none', 'No SLA policy yet · no overdue counts'],
    ['high', 'active', 'invalid', "SLA policy can't be read · no overdue counts"],
  ])('under Severity "%s only", critical %s and high %s: "%s", never a word about the hidden severity', (severity, critical, high, expected) => {
    const sla = alSummary({ critical, high });
    expect(railSlaNote(sla, severity as 'critical' | 'high')).toBe(expected);
    render(<RepoRail {...props({ summary: sla, urlOver: { severity } })} />);
    expect(screen.getByTestId('rail-sla-note').textContent).toBe(expected);
  });
});

describe('with the plain REPO_ROWS fixture', () => {
  it('lists every repository once and keeps the server order when nothing is overdue', () => {
    render(<RepoRail {...props({ rows: REPO_ROWS, summary: alSummary({ critical: 'none', high: 'none' }) })} />);
    expect(railNames()).toEqual(['acme/checkout-api', 'acme/ledger', 'acme/search-index']);
    expect(screen.getAllByTestId('rail-unmeasured')).toHaveLength(1);
  });
});

describe('light theme', () => {
  // Revert: put the card-shell class on the rail, a row or the search box: the light remap's border would resize a fixed-height row.
  it.each([
    ['populated', props()],
    ['loading', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined) })],
    ['error', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('x'), errorText: "Couldn't load repositories: x" }) })],
    ['empty scope', props({ rows: [] })],
  ])('the %s rail uses no card-shell class (bg-gray-900) anywhere inside it', (_label, p) => {
    const { container } = render(<RepoRail {...p} />);
    expect(container.querySelector('.bg-gray-900')).toBeNull();
  });
});

describe('slot view (the standing slot-view rule)', () => {
  type Rows = ReturnType<typeof reposFixture>;
  const withSlot = (s: ReturnType<typeof slot<Rows>>) => props({ repos: s });

  // Revert: ignore `stale` (or read it as "no data"): the previous key's rows would look current.
  it('a stale slot keeps its rows, dimmed to 0.6, with no note', () => {
    render(<RepoRail {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { stale: true, loading: false }))} />);
    expect(railNames()).toHaveLength(6);
    expect(screen.getByTestId('rail-list').style.opacity).toBe('0.6');
    expect(screen.queryByTestId('rail-refresh-note')).toBeNull();
  });

  it('a fresh slot is not dimmed', () => {
    render(<RepoRail {...props()} />);
    expect(screen.getByTestId('rail-list').style.opacity).toBe('1');
  });

  // Revert: show the error instead of the rows, or drop the note.
  it('a same-key refresh that failed keeps the rows and adds "Couldn\'t refresh · showing last load"', () => {
    render(<RepoRail {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { errorText: "Couldn't load repositories: boom", error: new Error('boom') }))} />);
    expect(railNames()).toHaveLength(6);
    expect(screen.getByTestId('rail-refresh-note').textContent).toBe(REFRESH_FAILED_NOTE);
    expect(screen.getByTestId('rail-refresh-note').className).toContain('text-red-400');
    expect(screen.getByTestId('repo-rail').textContent).not.toContain("Couldn't load repositories");
    expect(screen.getByTestId('repo-rail').style.width).toBe(`${RAIL_W}px`);
  });

  // Revert: render the slot only while the note shows, or inside the scrolling list: rows and the header would move.
  it('the note sits in a reserved line outside the list that is there with or without it, so showing it moves nothing', () => {
    const { rerender } = render(<RepoRail {...props()} />);
    const reserved = screen.getByTestId('rail-note-slot');
    expect(reserved.className).toContain('h-4');
    expect(reserved.children).toHaveLength(0);
    expect(screen.getByTestId('rail-list').contains(reserved)).toBe(false);
    rerender(<RepoRail {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { errorText: 'x' }))} />);
    expect(screen.getByTestId('rail-note-slot')).toBe(reserved);
    expect(screen.getByTestId('rail-refresh-note').parentElement).toBe(reserved);
    expect(railNames()).toEqual(['acme/checkout-api', 'acme/billing-worker', 'acme/ledger-service', 'acme/audit-log', 'acme/zeta-jobs', 'acme/quiet-service']);
  });

  // Revert: leave an unavailable slot on "Loading…".
  it('no rows and an unavailable answer: its short message, never "Loading…"', () => {
    const unavailable = { available: false as const, reason: 'No sync has run yet.' };
    render(<RepoRail {...withSlot(slot<Rows>(undefined, { unavailable, loading: false }))} />);
    const el = screen.getByTestId('rail-unavailable');
    expect(el.textContent).toBe(UNAVAILABLE_TEXT);
    expect(el.getAttribute('title')).toBe('No sync has run yet.');
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByTestId('rail-all')).toBeTruthy();
  });

  it('own rows beat an unavailable flag left on the slot', () => {
    render(<RepoRail {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { unavailable: { available: false as const, reason: 'old' } }))} />);
    expect(railNames()).toHaveLength(6);
    expect(screen.queryByTestId('rail-unavailable')).toBeNull();
  });
});
