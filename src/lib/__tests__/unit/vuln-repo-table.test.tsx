/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-repo-table.test.tsx
// The ownership card's "Repositories" tab.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import RepoTable, { REPO_TEAM_COL_W } from '@/app/vulnerabilities/repo-table';
import { TEAM_ROW_H, Z } from '@/app/vulnerabilities/dimensions';
import { unmeasuredReason } from '@/app/vulnerabilities/labels';
import type { SummaryData, ReposData } from '@/app/vulnerabilities/api-types';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
import { cell, ovProps, repoRow, reposFixture, slot } from '../support/security-fixtures';

const NBSP = '\u00a0';
// Dates print through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });
const LONG_TEAM = 'A very long owning team name that cannot fit its column';
const ROWS = [
  repoRow('acme/checkout-api', 'Payments', {
    critical: cell({ open: 9, overdue: 8, dueSoon: 1, oldestOpenDays: 101, nextDue: { date: '2026-10-02', daysRemaining: 2 } }),
    high: cell({ open: 14, overdue: 7, dueSoon: 0, oldestOpenDays: 40, nextDue: null }),
  }),
  repoRow('acme/billing-worker', 'Payments', {
    critical: cell({ open: 2, overdue: 1, dueSoon: 0, oldestOpenDays: 18, nextDue: { date: '2026-10-07', daysRemaining: 0 } }),
    high: cell({ open: 1, overdue: 0, dueSoon: 0, oldestOpenDays: 5, nextDue: null }),
  }),
  repoRow('acme/ledger-service', 'Payments', { critical: cell({ open: 0, overdue: 0, dueSoon: 0 }), high: cell({ open: 0, overdue: 0, dueSoon: 0 }) }),
  repoRow('acme/search-index', LONG_TEAM, { critical: cell({ open: 0, overdue: 0, dueSoon: 0 }), high: cell({ open: 3, overdue: 0, dueSoon: 0, oldestOpenDays: 9 }) }),
  repoRow('acme/invoice-render', 'Payments', { critical: cell({ open: 8, overdue: 4 }), high: cell({ open: 5, overdue: 2 }), unmeasured: { status: 'dependabot-off', detail: null } }),
];

const policy = (severity: 'critical' | 'high', pending: boolean) => ({ id: `${severity}-1`, severity, days: 7, effectiveFrom: '2099-02-01', until: null, pending });
const ACTIVE = { slaStatus: { critical: 'active', high: 'active' } as SummaryData['slaStatus'], policy: [policy('critical', false), policy('high', false)] as unknown as SummaryData['policy'] };

function table(o: { rows?: typeof ROWS; summary?: Partial<SummaryData>; url?: Partial<SecurityViewProps['url']>; filter?: string; repos?: SecurityViewProps['data']['repos'] } = {}) {
  const p = ovProps({ summary: { ...ACTIVE, ...o.summary }, url: o.url, repos: o.rows ?? ROWS });
  if (o.repos) p.data.repos = o.repos;
  return { ...p, nameFilter: o.filter ?? '' };
}
const rowOf = (name: string) => screen.getByTestId(`repo-row-${name}`);
const cellsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="cell"]')) as HTMLElement[];
const headerNames = () => screen.getAllByRole('columnheader').map(h => h.textContent?.replace(/[↕↑↓]\uFE0E?/g, '').trim());
const order = () => screen.getAllByTestId(/^repo-row-/).map(r => r.getAttribute('data-testid')!.replace('repo-row-acme/', ''));

describe('columns follow the SLA state', () => {
  const all = ['Repository', 'Owning team', 'Open crit', 'Overdue crit', 'Open high', 'Overdue high', 'Oldest open', 'Next due'];
  const status = (critical: 'active' | 'pending' | 'none', high: 'active' | 'pending' | 'none') => ({
    slaStatus: { critical, high } as SummaryData['slaStatus'],
    policy: [...(critical === 'none' ? [] : [policy('critical', critical === 'pending')]), ...(high === 'none' ? [] : [policy('high', high === 'pending')])] as unknown as SummaryData['policy'],
  });

  // Revert: show an Overdue column whatever the state, or drop "Next due" when only one policy is active.
  it.each([
    ['both active', status('active', 'active'), false, all],
    ['critical active, high pending', status('active', 'pending'), false, all.filter(h => h !== 'Overdue high')],
    ['critical pending, high active', status('pending', 'active'), false, all.filter(h => h !== 'Overdue crit')],
    ['both pending', status('pending', 'pending'), false, all.filter(h => !/Overdue|Next due/.test(h))],
    ['none', status('none', 'none'), false, all.filter(h => !/Overdue|Next due/.test(h))],
    ['invalid', status('active', 'active'), true, all.filter(h => !/Overdue|Next due/.test(h))],
  ] as const)('%s', (_n, s, invalid, expected) => {
    render(<RepoTable {...table({ summary: { ...s, slaPolicyInvalid: invalid } })} />);
    expect(headerNames()).toEqual(expected);
    expect(cellsOf(rowOf('acme/checkout-api'))).toHaveLength(expected.length);
  });
});

describe('headers (D14)', () => {
  // Revert: take whitespace-nowrap off a header button (the label wraps to two lines at 1024px), or put the glyph in the label's flex item.
  it('every header is one line with its sort glyph next to its text, and the label truncates before the glyph does', () => {
    render(<RepoTable {...table()} />);
    for (const h of screen.getAllByRole('columnheader')) {
      const button = within(h).getByRole('button');
      expect(button.className).toContain('whitespace-nowrap');
      const [label, glyph] = Array.from(button.children) as HTMLElement[];
      expect(label.className).toContain('truncate');
      expect(glyph.className).toContain('shrink-0');
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
    }
  });

  // Revert: size the Owning team track in fr again.
  it('the Owning team track is a fixed width, the same in the header and every row', () => {
    render(<RepoTable {...table()} />);
    const header = screen.getAllByRole('columnheader')[0].parentElement as HTMLElement;
    const second = (r: HTMLElement) => r.style.gridTemplateColumns.split(/ (?![^()]*\))/)[1];
    expect(REPO_TEAM_COL_W).toBe(150);
    expect(second(header)).toBe(`${REPO_TEAM_COL_W}px`);
    expect(second(rowOf('acme/checkout-api'))).toBe(`${REPO_TEAM_COL_W}px`);
    expect(second(screen.getByTestId('repo-footer'))).toBe(`${REPO_TEAM_COL_W}px`);
  });

  it('the Overdue labels are the short forms', () => {
    render(<RepoTable {...table()} />);
    expect(headerNames()).toContain('Overdue crit');
    expect(headerNames()).toContain('Overdue high');
  });
});

describe('measured rows', () => {
  it('shows the name with its codebase underneath, the owning team, the counts, oldest and next due', () => {
    render(<RepoTable {...table()} />);
    const cells = cellsOf(rowOf('acme/checkout-api')).map(c => c.textContent);
    expect(cells[0]).toBe('acme/checkout-apiBackend');
    expect(cells.slice(1)).toEqual(['Payments', '9', '8', '14', '7', '101d', 'Oct 2in 2d']);
  });

  it('a next due date of today reads "today"', () => {
    render(<RepoTable {...table()} />);
    expect(cellsOf(rowOf('acme/billing-worker'))[7].textContent).toBe('Oct 7today');
  });

  // Revert: render overdue zero in red, or an overdue above zero in grey.
  it('overdue above zero is bold red; zero is grey', () => {
    render(<RepoTable {...table()} />);
    const cells = cellsOf(rowOf('acme/checkout-api'));
    expect(cells[3].className).toContain('text-red-400');
    expect(cells[3].className).toContain('font-bold');
    expect(cellsOf(rowOf('acme/search-index'))[3].className).not.toContain('text-red-400');
  });

  // Revert: drop zero-alert repositories from the list, or leave them un-greyed.
  it('a repository with no open alerts is listed, greyed, with "· no open alerts" under its name and — for oldest and next due', () => {
    render(<RepoTable {...table()} />);
    const r = rowOf('acme/ledger-service');
    const cells = cellsOf(r);
    expect(cells[0].textContent).toBe('acme/ledger-serviceBackend · no open alerts');
    expect(cells[0].firstElementChild!.className).toContain('text-gray-500');
    expect(cells[1].className).toContain('text-gray-500');
    expect(cells[2].textContent).toBe('0');
    expect(cells[2].className).toContain('text-gray-600');
    expect(cells[6].textContent).toBe('—');
    expect(cells[7].textContent).toBe('—');
  });

  // Revert: render the team in a non-truncating element, or without its title.
  it('a long owning-team name ends in an ellipsis and carries the full name in its title', () => {
    render(<RepoTable {...table()} />);
    const team = cellsOf(rowOf('acme/search-index'))[1];
    expect(team.className).toContain('truncate');
    expect(team.className).toContain('min-w-0');
    expect(team.getAttribute('title')).toBe(LONG_TEAM);
  });

  it('a long repository name truncates and carries its title as well', () => {
    render(<RepoTable {...table()} />);
    const name = within(rowOf('acme/checkout-api')).getByText('acme/checkout-api');
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe('acme/checkout-api');
  });

  it('rows are TEAM_ROW_H tall', () => {
    render(<RepoTable {...table()} />);
    expect(rowOf('acme/checkout-api').style.height).toBe(`${TEAM_ROW_H}px`);
    expect(rowOf('acme/invoice-render').style.height).toBe(`${TEAM_ROW_H}px`);
  });
});

describe('hidden severity', () => {
  // Revert: leave a hidden severity's figures in, or use the em dash.
  it('"Critical only" shows – in the high columns, rows and footer, and dims and locks their headers', () => {
    render(<RepoTable {...table({ url: { severity: 'critical', kSev: 'critical' } })} />);
    expect(cellsOf(rowOf('acme/checkout-api')).map(c => c.textContent)).toEqual(['acme/checkout-apiBackend', 'Payments', '9', '8', '–', '–', '101d', 'Oct 2in 2d']);
    const footer = cellsOf(screen.getByTestId('repo-footer')).map(c => c.textContent);
    expect(footer[3]).toBe('–');
    expect(footer[4]).toBe('–');
    const openHigh = screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith('Open high'))!;
    expect(openHigh.className).toContain('opacity-[0.35]');
    expect((within(openHigh).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  // Revert: decide "no open alerts" from both severities, or drop the severity from the wording (a high-only repository would
  // read as clean under "Critical only").
  it('"no open alerts" follows the shown severities and names the severity that is empty', () => {
    const criticalOnly = repoRow('acme/critical-only', 'Payments', { critical: cell({ open: 2, overdue: 0, dueSoon: 0 }), high: cell({ open: 0, overdue: 0, dueSoon: 0 }) });
    const { unmount } = render(<RepoTable {...table({ url: { severity: 'critical', kSev: 'critical' } })} />);
    expect(cellsOf(rowOf('acme/search-index'))[0].textContent).toBe('acme/search-indexBackend · no open critical alerts');
    unmount();
    render(<RepoTable {...table({ rows: [...ROWS, criticalOnly], url: { severity: 'high', kSev: 'high' } })} />);
    expect(cellsOf(rowOf('acme/critical-only'))[0].textContent).toBe('acme/critical-onlyBackend · no open high alerts');
    // A repository with something open under that severity carries no such text.
    expect(cellsOf(rowOf('acme/search-index'))[0].textContent).toBe('acme/search-indexBackend');
  });

  it('"High only" combines only the high figures for oldest open', () => {
    render(<RepoTable {...table({ url: { severity: 'high', kSev: 'high' } })} />);
    expect(cellsOf(rowOf('acme/checkout-api'))[6].textContent).toBe('40d');
  });
});

describe('unmeasured repositories', () => {
  // Revert: show the stored counts, or word the band differently.
  it('are listed last as a hatched band, with their open counts unknown and no stored figure on screen', () => {
    render(<RepoTable {...table()} />);
    const r = rowOf('acme/invoice-render');
    const band = within(r).getByTestId('repo-unmeasured-band');
    expect(band.textContent).toBe('▲ UNMEASURED · DEPENDABOT OFF — alert counts unknown, not zero');
    expect(band.className).toContain('vuln-hatch');
    expect(r.textContent).not.toMatch(/\b8\b|\b5\b/);
    expect(order()[order().length - 1]).toBe('invoice-render');
  });

  it('the band spans every numeric column in every SLA state', () => {
    for (const s of [ACTIVE, { slaStatus: { critical: 'none', high: 'none' } as SummaryData['slaStatus'], policy: [] as SummaryData['policy'] }]) {
      const { unmount } = render(<RepoTable {...table({ summary: s })} />);
      const n = screen.getAllByRole('columnheader').length - 2;
      expect(screen.getByTestId('repo-unmeasured-band').style.gridColumn).toBe(`span ${n}`);
      unmount();
    }
  });

  // Revert: word the reason locally again (the band then reads a different text from the drawer and the rail).
  it('an error status names its detail, in capitals, the drawer\'s wording; with no detail it reads "STATUS CHECK FAILED"', () => {
    const rows = [repoRow('acme/legacy', 'Platform', { unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' } })];
    const { unmount } = render(<RepoTable {...table({ rows })} />);
    expect(screen.getByTestId('repo-unmeasured-band').textContent).toBe('▲ UNMEASURED · HTTP 500: STATUS CHECK FAILED — alert counts unknown, not zero');
    expect(screen.getByTestId('repo-unmeasured-band').textContent).toContain(unmeasuredReason({ status: 'error', detail: 'HTTP 500: status check failed' }).toUpperCase());
    expect(rowOf('acme/legacy').getAttribute('title')).toBe('Open counts unknown (HTTP 500: status check failed). Click for details.');
    unmount();
    render(<RepoTable {...table({ rows: [repoRow('acme/legacy', 'Platform', { unmeasured: { status: 'error', detail: null } })] })} />);
    expect(screen.getByTestId('repo-unmeasured-band').textContent).toBe('▲ UNMEASURED · STATUS CHECK FAILED — alert counts unknown, not zero');
  });

  // Revert: send the click to selectRepoRow like a measured row.
  it('a click opens the drawer with the row and does not open the repository\'s alerts', () => {
    const p = table();
    render(<RepoTable {...p} />);
    const r = rowOf('acme/invoice-render');
    fireEvent.click(r);
    expect(p.openDrawer).toHaveBeenCalledWith(r);
    expect(p.url.selectRepoRow).not.toHaveBeenCalled();
  });

  it('sits last and ignores sorting in both directions', () => {
    render(<RepoTable {...table()} />);
    const header = screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith('Repository'))!;
    fireEvent.click(within(header).getByRole('button'));
    expect(order()[order().length - 1]).toBe('invoice-render');
    fireEvent.click(within(header).getByRole('button'));
    expect(order()[order().length - 1]).toBe('invoice-render');
  });
});

describe('row click', () => {
  // Revert: call setRepo or setTeam instead, or drop the team.
  it('opens the repository\'s alerts with its owning team via url.selectRepoRow, on click and Enter', () => {
    const p = table();
    render(<RepoTable {...p} />);
    fireEvent.click(rowOf('acme/checkout-api'));
    expect(p.url.selectRepoRow).toHaveBeenLastCalledWith({ fullName: 'acme/checkout-api', team: 'Payments' });
    fireEvent.keyDown(rowOf('acme/ledger-service'), { key: 'Enter' });
    expect(p.url.selectRepoRow).toHaveBeenLastCalledWith({ fullName: 'acme/ledger-service', team: 'Payments' });
    expect(p.url.setRepo).not.toHaveBeenCalled();
    expect(p.url.setTeam).not.toHaveBeenCalled();
  });

  it('"Unassigned" is a valid owning team', () => {
    const p = table({ rows: [repoRow('acme/orphan', 'Unassigned', { critical: cell({ open: 1, overdue: 0 }) })] });
    render(<RepoTable {...p} />);
    fireEvent.click(rowOf('acme/orphan'));
    expect(p.url.selectRepoRow).toHaveBeenCalledWith({ fullName: 'acme/orphan', team: 'Unassigned' });
  });
});

// Task 3.8 ruling: a row's Enter/Space handler calls preventDefault(), which cancels the native click of any control nested in the row,
// so it must act only on keys pressed on the row itself.
describe('keys on a control inside a row', () => {
  // Revert: drop the `e.target !== e.currentTarget` guard from the row's onKeyDown.
  it.each(['Enter', ' '])('a measured row ignores %j pressed inside it: no action, and the default is not cancelled', key => {
    const p = table();
    render(<RepoTable {...p} />);
    const inner = cellsOf(rowOf('acme/checkout-api'))[0];
    expect(fireEvent.keyDown(inner, { key })).toBe(true);
    expect(p.url.selectRepoRow).not.toHaveBeenCalled();
    // The row itself still acts, and cancels the default (so Space does not scroll the card).
    expect(fireEvent.keyDown(rowOf('acme/checkout-api'), { key })).toBe(false);
    expect(p.url.selectRepoRow).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('an unmeasured row ignores %j pressed inside it: no action, and the default is not cancelled', key => {
    const p = table();
    render(<RepoTable {...p} />);
    const band = screen.getByTestId('repo-unmeasured-band');
    expect(fireEvent.keyDown(band, { key })).toBe(true);
    expect(p.openDrawer).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(rowOf('acme/invoice-render'), { key })).toBe(false);
    expect(p.openDrawer).toHaveBeenCalledTimes(1);
    expect(p.openDrawer).toHaveBeenCalledWith(rowOf('acme/invoice-render'));
  });
});

describe('scroller and focus (B2, B3, B8)', () => {
  // Revert: drop the scroll padding: a keyboard-focused row scrolls under the pinned header or the pinned footer.
  it('pads its scroll area by the 40px pinned header and the pinned footer (its row plus the 1px border)', () => {
    render(<RepoTable {...table()} />);
    const style = screen.getByTestId('repo-table').style;
    expect(style.scrollPaddingTop).toBe('40px');
    expect(style.scrollPaddingBottom).toBe(`${TEAM_ROW_H + 1}px`);
    expect(screen.getAllByRole('row')[0].style.height).toBe('40px');
  });

  // Revert: drop the gutter class: the columns narrow the moment the table starts to scroll.
  it('reserves its scrollbar gutter, like the team table', () => {
    render(<RepoTable {...table()} />);
    expect(screen.getByTestId('repo-table').className).toContain('[scrollbar-gutter:stable]');
  });

  // Revert: drop the focus-visible classes from either row kind.
  it('a focused row, measured or unmeasured, draws an inset ring', () => {
    render(<RepoTable {...table()} />);
    for (const name of ['acme/checkout-api', 'acme/invoice-render']) {
      const cls = rowOf(name).className;
      for (const c of ['focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-inset', 'focus-visible:ring-accent/50']) expect(cls).toContain(c);
    }
  });
});

describe('titles on truncating text (B4)', () => {
  // Revert: drop a title.
  it('every header button, the codebase line under a name, the footer label and the footer note carry their full text', () => {
    render(<RepoTable {...table()} />);
    for (const b of screen.getAllByRole('columnheader').map(h => within(h).getByRole('button'))) {
      expect(b.getAttribute('title')).toBe(b.textContent!.replace(/[↕↑↓]\uFE0E?/g, '').trim());
    }
    const sub = within(rowOf('acme/ledger-service')).getByText(/no open alerts/);
    expect(sub.getAttribute('title')).toBe(sub.textContent);
    const label = cellsOf(screen.getByTestId('repo-footer'))[0].firstElementChild as HTMLElement;
    expect(label.getAttribute('title')).toBe(label.textContent);
    const note = within(screen.getByTestId('repo-footer-note')).getByText('1 unmeasured: totals include stored counts');
    expect(note.className).toContain('truncate');
    expect(note.getAttribute('title')).toBe(note.textContent);
  });
});

describe('footer', () => {
  const footer = () => screen.getByTestId('repo-footer');

  it('reads "Total · N repos" with no team and sums open and overdue over every row, the unmeasured one\'s stored counts included', () => {
    render(<RepoTable {...table()} />);
    const cells = cellsOf(footer());
    expect(cells[0].textContent).toContain('Total · 4 repos');
    // crit open 9+2+0+0 + the unmeasured row's stored 8 = 19, overdue 9+4 = 13, high 14+1+0+3 + 5 = 23, overdue 7+2 = 9;
    // oldest (max 101d) and next due (Oct 2) come from the measured rows only
    expect(cells.slice(1).map(c => c.textContent)).toEqual(['19', '13', '23', '9', '101d', 'Oct 2in 2d']);
  });

  it('reads "{Team} total · N repos" when the rows were fetched for an owning team', () => {
    render(<RepoTable {...table({ url: { team: 'Payments' }, repos: slot(reposFixture(ROWS, { codebase: 'backend', team: 'Payments' })) })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Payments total · 4 repos');
  });

  // Revert: read the label from url.team: Search's name then sits under Payments' rows while the new rows load.
  it('names the scope of the ROWS on screen, not url.team: previous team\'s rows (stale) under a newly selected team read "Payments total"', () => {
    const rows = table({ url: { team: 'Search' }, repos: slot(reposFixture(ROWS, { codebase: 'backend', team: 'Payments' }), { stale: true }) });
    const { unmount } = render(<RepoTable {...rows} />);
    expect(cellsOf(footer())[0].textContent).toContain('Payments total · 4 repos');
    expect(cellsOf(footer())[0].textContent).not.toContain('Search');
    unmount();
    // The reverse: a team was cleared, the all-teams rows are not here yet.
    render(<RepoTable {...table({ url: { team: null }, repos: slot(reposFixture(ROWS, { codebase: 'backend', team: 'Payments' }), { stale: true }) })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Payments total');
    cleanup();
    render(<RepoTable {...table({ url: { team: 'Payments' }, repos: slot(reposFixture(ROWS, { codebase: 'backend' }), { stale: true }) })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Total · 4 repos');
    expect(cellsOf(footer())[0].textContent).not.toContain('Payments');
  });

  it('a singular repository reads "1 repo"', () => {
    render(<RepoTable {...table({ rows: [ROWS[0]] })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Total · 1 repo');
  });

  it('the second line says how many are unmeasured, and is a reserved empty line when none are', () => {
    const { unmount } = render(<RepoTable {...table()} />);
    expect(screen.getByTestId('repo-footer-note').textContent).toBe('1 unmeasured: totals include stored counts');
    unmount();
    render(<RepoTable {...table({ rows: [ROWS[0]] })} />);
    const note = screen.getByTestId('repo-footer-note');
    expect(note.textContent).toBe(NBSP);
    expect(note.getAttribute('aria-hidden')).toBeNull();   // not toggled: the line also holds the refresh note
  });

  // Revert: leave the label "Total" while a filter is applied.
  it('reads "Matching" while the name filter is in use, and the second line names the filter', () => {
    render(<RepoTable {...table({ filter: 'ledger' })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Matching · 1 repo');
    expect(screen.getByTestId('repo-footer-note').textContent).toBe('name contains “ledger”');
    expect(order()).toEqual(['ledger-service']);
  });

  // Revert: drop the shadow class (jsdom cannot paint, so the class is what is checked; headless runs check the paint).
  it('has the same soft shadow on its top edge as the team table\'s Total row, so scrolled-away rows show', () => {
    render(<RepoTable {...table()} />);
    expect((footer().parentElement as HTMLElement).className).toMatch(/shadow-\[0_-\d+px/);
  });

  // Revert: derive the footer's colour with a string replace on the row's class (a zero and a "—" lose their grey by accident).
  it('the footer is white and bold for every figure: a zero and a missing figure too; a row greys the same ones', () => {
    const rows = [repoRow('acme/quiet', 'Payments', { critical: cell({ open: 0, overdue: 0 }), high: cell({ open: 0, overdue: null }) })];
    render(<RepoTable {...table({ rows })} />);
    const foot = cellsOf(footer());
    // [label, open crit, overdue crit, open high, overdue high, oldest, next due]
    for (const c of foot.slice(1, 5)) {
      expect(c.className).toContain('text-white');
      expect(c.className).not.toContain('text-gray-600');
    }
    expect(foot[4].textContent).toBe('—');
    for (const c of cellsOf(rowOf('acme/quiet')).slice(2, 6)) expect(c.className).toContain('text-gray-600');
  });

  it('is pinned to the bottom of the scrolling body on the chart surface, above the rows', () => {
    render(<RepoTable {...table()} />);
    const pinned = footer().parentElement as HTMLElement;
    expect(pinned.className).toContain('sticky');
    expect(pinned.className).toContain('bottom-0');
    expect(pinned.className).toContain('bg-chart-surface');
    expect(pinned.className).not.toContain('bg-gray-900');
    expect(pinned.style.zIndex).toBe(String(Z.pinnedRows));
    expect(screen.getByTestId('repo-table').className).toContain('overflow-auto');
  });

  it('the header row is pinned to the top the same way', () => {
    render(<RepoTable {...table()} />);
    const head = screen.getAllByRole('row')[0];
    expect(head.className).toContain('sticky');
    expect(head.className).toContain('top-0');
    expect(head.className).toContain('bg-chart-surface');
    expect(head.style.zIndex).toBe(String(Z.pinnedRows));
  });
});

describe('sorting', () => {
  const header = (label: string) => screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith(label))!;
  const click = (label: string) => fireEvent.click(within(header(label)).getByRole('button'));

  it('starts in server order, drawn as "Open crit ↓" in the accent colour; a first click on it goes ascending, then descending again', () => {
    render(<RepoTable {...table()} />);
    expect(order()).toEqual(['checkout-api', 'billing-worker', 'search-index', 'ledger-service', 'invoice-render']);
    expect(header('Open crit').textContent).toContain('↓');
    expect(header('Open crit').getAttribute('aria-sort')).toBe('descending');
    expect(header('Open crit').querySelector('.text-accent-light')).not.toBeNull();
    expect(header('Open high').textContent).toContain('↕');
    click('Open crit');
    expect(header('Open crit').textContent).toContain('↑');
    expect(header('Open crit').getAttribute('aria-sort')).toBe('ascending');
    expect(order().slice(0, 2)).toEqual(['ledger-service', 'search-index']);
    click('Open crit');
    expect(header('Open crit').textContent).toContain('↓');
    expect(order()[0]).toBe('checkout-api');
  });

  // Revert: draw the default on Open crit whatever Severity says, or leave every header ↕.
  it('under "High only" the default indicator is on Open high', () => {
    render(<RepoTable {...table({ url: { severity: 'high', kSev: 'high' } })} />);
    expect(header('Open high').textContent).toContain('↓');
    expect(header('Open high').getAttribute('aria-sort')).toBe('descending');
    expect(header('Open crit').getAttribute('aria-sort')).toBe('none');
    expect(order()[0]).toBe('checkout-api'); // 14 open high
    click('Open high');
    expect(header('Open high').textContent).toContain('↑');
  });

  // Revert: nextSort(s, ...) with the raw (null) state.
  it('a first click on another header starts in that header\'s own direction, and the default header goes back to ↕', () => {
    render(<RepoTable {...table()} />);
    click('Repository');
    expect(header('Open crit').textContent).toContain('↕');
    expect(header('Repository').getAttribute('aria-sort')).toBe('ascending');
  });

  // Revert: sort a missing "oldest" as zero.
  it('a missing figure sorts last in both directions, ties by name', () => {
    render(<RepoTable {...table()} />);
    click('Oldest open');
    expect(order().slice(0, 4)).toEqual(['checkout-api', 'billing-worker', 'search-index', 'ledger-service']);
    click('Oldest open');
    expect(order().slice(0, 4)).toEqual(['search-index', 'billing-worker', 'checkout-api', 'ledger-service']);
  });

  it('the name column starts ascending', () => {
    render(<RepoTable {...table()} />);
    click('Repository');
    expect(order().slice(0, 4)).toEqual(['billing-worker', 'checkout-api', 'ledger-service', 'search-index']);
  });

  it('Next due starts with the soonest date', () => {
    render(<RepoTable {...table()} />);
    click('Next due');
    expect(order().slice(0, 2)).toEqual(['checkout-api', 'billing-worker']);
  });
});

describe('states', () => {
  it('shows the request\'s error and nothing else', () => {
    render(<RepoTable {...table({ repos: slot<ReposData>(undefined, { error: new Error('x'), errorText: "Couldn't load repositories: x", loading: false }) })} />);
    expect(screen.getByTestId('repo-table-error').textContent).toBe("Couldn't load repositories: x");
    expect(screen.queryByTestId('repo-table')).toBeNull();
  });

  it('shows Loading… before the first response', () => {
    render(<RepoTable {...table({ repos: slot<ReposData>(undefined, { loading: true }) })} />);
    expect(screen.getByTestId('repo-table-loading').textContent).toBe('Loading…');
  });

  it('an empty scope says so and still has its header and footer', () => {
    render(<RepoTable {...table({ rows: [] })} />);
    expect(screen.getByText('No repositories in this scope.')).toBeTruthy();
    expect(cellsOf(screen.getByTestId('repo-footer'))[0].textContent).toContain('Total · 0 repos');
  });

  it('a filter that matches nothing says so', () => {
    render(<RepoTable {...table({ filter: 'zzz' })} />);
    expect(screen.getByText('No repositories match “zzz”.')).toBeTruthy();
  });

  it('dims while it shows the previous key\'s rows', () => {
    render(<RepoTable {...table({ repos: slot(reposFixture(ROWS), { stale: true }) })} />);
    expect(screen.getByTestId('repo-table').className).toContain('opacity-60');
  });

  // Revert: check errorText before data (the old order): a failed refresh then replaces good rows with the error.
  it('a failed refresh of the same request keeps the rows and puts a small red note on the footer\'s reserved line', () => {
    render(<RepoTable {...table({ repos: slot(reposFixture(ROWS), { error: new Error('x'), errorText: "Couldn't load repositories: x" }) })} />);
    expect(order()).toHaveLength(4 + 1);
    expect(screen.queryByTestId('repo-table-error')).toBeNull();
    const note = screen.getByTestId('repo-refresh-note');
    expect(note.textContent).toBe("Couldn't refresh · showing last load");
    expect(note.className).toContain('text-red-400');
    expect(note.getAttribute('title')).toBe("Couldn't load repositories: x");
    const line = screen.getByTestId('repo-footer-note');
    // the scope note follows it on the same line (one unmeasured row in ROWS), and the line keeps its fixed height
    expect(line.textContent).toBe("Couldn't refresh · showing last load · 1 unmeasured: totals include stored counts");
    expect(within(line).getByText('1 unmeasured: totals include stored counts').getAttribute('title')).toBe('1 unmeasured: totals include stored counts');
    expect(line.className).toContain('h-4');
    expect(line.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByTestId('repo-table').className).not.toContain('opacity-60');
  });

  it('the refresh note alone fills the reserved line when there is no scope note, and is an empty, silent slot while the refresh has not failed', () => {
    const { unmount } = render(<RepoTable {...table({ rows: [ROWS[0]], repos: slot(reposFixture([ROWS[0]]), { errorText: "Couldn't load repositories: x" }) })} />);
    expect(screen.getByTestId('repo-footer-note').textContent).toBe("Couldn't refresh · showing last load");
    unmount();
    render(<RepoTable {...table({ rows: [ROWS[0]] })} />);
    expect(screen.getByTestId('repo-refresh-note').textContent).toBe('');
    // Never aria-hidden (it is not toggled), and not live: the strip announces a failed refresh of the repos slot.
    expect(screen.getByTestId('repo-footer-note').getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByTestId('repo-refresh-note').getAttribute('role')).toBeNull();
  });

  it('says so when the request answered "not available", instead of loading forever', () => {
    const unavailable = { available: false as const, reason: 'No sync has run yet.' };
    render(<RepoTable {...table({ repos: slot<ReposData>(undefined, { unavailable, loading: false }) })} />);
    const el = screen.getByTestId('repo-table-unavailable');
    expect(el.textContent).toBe('Not available yet');
    expect(el.getAttribute('title')).toBe('No sync has run yet.');
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('counts (A3) and a missing overdue figure (A4)', () => {
  // Revert: print String(n) / the raw count instead of going through dash().
  it('every count goes through the page\'s one formatter: 1,234 in a cell, the footer sums, and the repo count', () => {
    const big = [
      repoRow('acme/big-a', 'Payments', { critical: cell({ open: 1234, overdue: 1100 }), high: cell({ open: 2345, overdue: 2000 }) }),
      repoRow('acme/big-b', 'Payments', { critical: cell({ open: 1, overdue: 1 }), high: cell({ open: 1, overdue: 1 }) }),
    ];
    const many = Array.from({ length: 1000 }, (_, i) => repoRow(`acme/r${i}`, 'Payments'));
    const { unmount } = render(<RepoTable {...table({ rows: big })} />);
    expect(cellsOf(rowOf('acme/big-a')).slice(2).map(c => c.textContent).slice(0, 4)).toEqual(['1,234', '1,100', '2,345', '2,000']);
    expect(cellsOf(screen.getByTestId('repo-footer')).slice(1, 5).map(c => c.textContent)).toEqual(['1,235', '1,101', '2,346', '2,001']);
    unmount();
    render(<RepoTable {...table({ rows: many })} />);
    expect(cellsOf(screen.getByTestId('repo-footer'))[0].textContent).toContain('Total · 1,000 repos');
  });

  it('the unmeasured count in the footer note is grouped too', () => {
    const rows = [repoRow('acme/ok', 'Payments'), ...Array.from({ length: 1000 }, (_, i) => repoRow(`acme/u${i}`, 'Payments', { unmeasured: { status: 'error', detail: null } }))];
    render(<RepoTable {...table({ rows })} />);
    expect(screen.getByTestId('repo-footer-note').textContent).toBe('1,000 unmeasured: totals include stored counts');
  });

  // Revert: `String(v.overCrit ?? 0)` (a null overdue read as a zero the row does not know).
  it('a null overdue renders "—", never "0", in a row and in the footer; a real zero still reads 0', () => {
    const rows = [
      repoRow('acme/unknown', 'Payments', { critical: cell({ open: 2, overdue: null }), high: cell({ open: 1, overdue: null }) }),
      repoRow('acme/zero', 'Payments', { critical: cell({ open: 2, overdue: 0 }), high: cell({ open: 1, overdue: 0 }) }),
    ];
    // cells: [name, team, open crit, overdue crit, open high, overdue high, oldest, next due]
    const { unmount } = render(<RepoTable {...table({ rows })} />);
    expect(cellsOf(rowOf('acme/unknown')).slice(2, 6).map(c => c.textContent)).toEqual(['2', '—', '1', '—']);
    expect(cellsOf(rowOf('acme/zero')).slice(2, 6).map(c => c.textContent)).toEqual(['2', '0', '1', '0']);
    expect(cellsOf(screen.getByTestId('repo-footer')).slice(1, 5).map(c => c.textContent)).toEqual(['4', '0', '2', '0']);
    unmount();
    render(<RepoTable {...table({ rows: [rows[0]] })} />);
    expect(cellsOf(screen.getByTestId('repo-footer')).slice(1, 5).map(c => c.textContent)).toEqual(['2', '—', '1', '—']);
  });
});
