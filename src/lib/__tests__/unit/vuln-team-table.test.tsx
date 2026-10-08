/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-team-table.test.tsx
// The ownership card's "Owning teams" tab (replaces vuln-team-pivot.test.tsx).
import { fireEvent, render, screen, within } from '@testing-library/react';
import TeamTable from '@/app/vulnerabilities/team-table';
import { TEAM_BAND_H, TEAM_COLHEAD_H, TEAM_FOOTNOTE_H, TEAM_HEAD_H, TEAM_ROW_H, Z } from '@/app/vulnerabilities/dimensions';
import { unmeasuredBadgeText } from '@/app/vulnerabilities/labels';
import type { SummaryData } from '@/app/vulnerabilities/api-types';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
import {
  ovBaseline, ovCell, ovDelta, ovDeltaTeam, ovNoBaseline, ovProps, ovTeam, slot, summaryFixture,
} from '../support/security-fixtures';

const NBSP = '\u00a0';

// Dates print through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });

const rowOf = (team: string) => screen.getByTestId(`team-row-${team}`);
const cellsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="cell"]')) as HTMLElement[];

const ROWS = [
  ovTeam('Payments', ovCell(6, { resolved: 4, dismissed: 1, pctClosed: 40, overdue: 2 }), ovCell(10, { resolved: 2, dismissed: 0, pctClosed: 17, overdue: null }), 2),
  ovTeam('Unassigned', ovCell(1, { overdue: null }), ovCell(0)),
];
const TOTAL = ovTeam('Total', ovCell(7, { resolved: 4, dismissed: 1, pctClosed: 36, overdue: 2 }), ovCell(10, { resolved: 2, pctClosed: 17 }), 2);
const pivot = (rows = ROWS, total = TOTAL) => ({ pivot: { rows, total } });
const table = (summary: Partial<SummaryData> = {}, url: Partial<SecurityViewProps['url']> = {}) =>
  ovProps({ summary: { ...pivot(), ...summary }, url });

describe('layout', () => {
  // Revert: drop the inline row height, the sticky positions or the layer, or use the card-shell class for the pinned rows.
  it('the header and the Total row are pinned inside the scrolling body, above the rows, on the chart surface', () => {
    render(<TeamTable {...table()} />);
    const root = screen.getByTestId('team-table');
    expect(root.className).toContain('overflow-auto');
    expect(root.className).toContain('h-full');
    const total = screen.getByTestId('team-total-row');
    const footer = total.parentElement as HTMLElement;
    expect(footer.className).toContain('sticky');
    expect(footer.className).toContain('bottom-0');
    expect(footer.className).toContain('bg-chart-surface');
    expect(footer.className).not.toContain('bg-gray-900');
    expect(footer.style.zIndex).toBe(String(Z.pinnedRows));
    const head = (root.firstElementChild as HTMLElement);
    expect(head.className).toContain('sticky');
    expect(head.className).toContain('top-0');
    expect(head.className).toContain('bg-chart-surface');
    expect(head.style.zIndex).toBe(String(Z.pinnedRows));
  });

  it('team rows and the Total row are TEAM_ROW_H tall', () => {
    render(<TeamTable {...table()} />);
    expect(rowOf('Payments').style.height).toBe(`${TEAM_ROW_H}px`);
    expect(screen.getByTestId('team-total-row').style.height).toBe(`${TEAM_ROW_H}px`);
  });

  // Revert: size the columns by content (auto), change the name track, a gap or minmax(0, 1fr) (the exact strings below fail).
  it('the grid template is shared by every row and does not change with the baseline caption', () => {
    const { unmount } = render(<TeamTable {...table()} />);
    const templateOf = () => [rowOf('Payments'), screen.getByTestId('team-total-row')].map(r => r.style.gridTemplateColumns);
    const without = templateOf();
    expect(new Set(without).size).toBe(1);
    unmount();
    const delta = { critical: ovDelta(ovDeltaTeam('Total', 1), { baseline: ovBaseline('2099-01-01') }), high: ovNoBaseline() };
    render(<TeamTable {...table({ delta })} />);
    expect(templateOf()).toEqual(without);
  });

  // Revert: size a track by content, change the 8px spacer, or take the Overdue column's track out.
  it.each([
    ['no Overdue column', { critical: 'none', high: 'none' }, 4, 4],
    ['critical Overdue only', { critical: 'active', high: 'none' }, 5, 4],
    ['high Overdue only', { critical: 'none', high: 'active' }, 4, 5],
    ['both Overdue columns', { critical: 'active', high: 'active' }, 5, 5],
  ] as const)('the exact grid template, %s: the name track, then each group\'s tracks around an 8px spacer', (_name, status, nC, nH) => {
    const policy = (['critical', 'high'] as const).filter(s => status[s] === 'active')
      .map(severity => ({ id: `${severity}-1`, severity, days: 7, effectiveFrom: '2020-01-08', until: null, pending: false }));
    render(<TeamTable {...table({ slaStatus: status as SummaryData['slaStatus'], policy: policy as SummaryData['policy'] })} />);
    const expected = `minmax(0, 1.6fr) repeat(${nC}, minmax(0, 1fr)) 8px repeat(${nH}, minmax(0, 1fr))`;
    for (const row of [rowOf('Payments'), screen.getByTestId('team-total-row')]) expect(row.style.gridTemplateColumns).toBe(expected);
  });

  // Revert: drop the inline heights (the header then takes its content's height, and the overflow rule's arithmetic is wrong).
  it('the pinned header is a TEAM_BAND_H band over a TEAM_COLHEAD_H column row, TEAM_HEAD_H in all', () => {
    render(<TeamTable {...table()} />);
    const head = screen.getByTestId('team-table').firstElementChild as HTMLElement;
    const [band, cols] = Array.from(head.children) as HTMLElement[];
    expect(band.style.height).toBe(`${TEAM_BAND_H}px`);
    expect(cols.style.height).toBe(`${TEAM_COLHEAD_H}px`);
    expect(TEAM_HEAD_H).toBe(TEAM_BAND_H + TEAM_COLHEAD_H);
  });

  // Revert: take the shadow class off the pinned Total row, or the gutter class off the scroll container. Class-only guards:
  // jsdom cannot paint, so the headless run checks the rendered shadow and that the columns do not move when the table scrolls.
  it('the pinned Total row has a shadow on its top edge, and the scrolling body reserves its scrollbar gutter', () => {
    render(<TeamTable {...table()} />);
    const footer = screen.getByTestId('team-total-row').parentElement as HTMLElement;
    expect(footer.className).toMatch(/shadow-\[0_-\d+px/);
    expect(screen.getByTestId('team-table').className).toContain('[scrollbar-gutter:stable]');
  });

  // Revert: read the Total's label from nothing else than the literal "Total".
  it('the Total row reads "Total", and "Total · all owning teams" while a team is selected (the rows above still list every team)', () => {
    const { rerender } = render(<TeamTable {...table()} />);
    expect(screen.getByTestId('team-total-label').textContent).toBe('Total');
    rerender(<TeamTable {...table({}, { team: 'Payments' })} />);
    const label = screen.getByTestId('team-total-label');
    expect(label.textContent).toBe('Total · all owning teams');
    expect(label.getAttribute('title')).toBe('Total · all owning teams');
    expect(label.className).toContain('truncate');
  });

  it('numeric cells use tabular digits', () => {
    render(<TeamTable {...table()} />);
    for (const c of cellsOf(rowOf('Payments')).slice(1, 5)) expect(c.className).toContain('tabular-nums');
  });

  it('a long owning-team name ends in an ellipsis and keeps the full name in its title', () => {
    const long = 'A very long owning team name that cannot fit in the first column';
    render(<TeamTable {...table(pivot([ovTeam(long, ovCell(1), ovCell(0))]))} />);
    const name = screen.getByText(long);
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe(long);
  });
});

describe('data source', () => {
  const scoped = { pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1))], total: ovTeam('Total', ovCell(3), ovCell(1)) } };
  const everyone = summaryFixture({ pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1)), ovTeam('Search', ovCell(7), ovCell(2))], total: ovTeam('Total', ovCell(10), ovCell(3)) } });

  // Revert: read props.summary (the team-scoped one) instead of data.teamSummary.
  it('lists every team from the unfiltered summary while the page is scoped to one team, and highlights the selected one', () => {
    const p = ovProps({ summary: scoped, url: { team: 'Payments' }, teamSummary: slot(everyone) });
    render(<TeamTable {...p} />);
    expect(rowOf('Payments').className).toContain('bg-accent/10');
    expect(rowOf('Search').className).not.toContain('bg-accent/10');
    expect(within(screen.getByTestId('team-total-row')).getByText('10')).toBeTruthy();
  });

  // Revert: take the delta from props.summary instead of the unfiltered summary.
  it('the Change column follows the unfiltered response, not the team-scoped one', () => {
    const unfilteredDelta = ovDelta(ovDeltaTeam('Total', 7), { baseline: ovBaseline('2099-01-01'), teams: [ovDeltaTeam('Payments', 5), ovDeltaTeam('Search', 2)] });
    const scopedDelta = ovDelta(ovDeltaTeam('Total', 1), { baseline: ovBaseline('2099-02-02'), teams: [ovDeltaTeam('Payments', 1)] });
    const p = ovProps({ summary: { ...scoped, delta: { critical: scopedDelta, high: ovNoBaseline() } }, url: { team: 'Payments' }, teamSummary: slot({ ...everyone, delta: { critical: unfilteredDelta, high: ovNoBaseline() } }) });
    render(<TeamTable {...p} />);
    expect(screen.getByText('vs Jan 1, 2099')).toBeTruthy();
    expect(screen.queryByText('vs Feb 2, 2099')).toBeNull();
    expect(within(rowOf('Payments')).getByText('▲ 5')).toBeTruthy();
    expect(within(rowOf('Search')).getByText('▲ 2')).toBeTruthy();
    expect(within(screen.getByTestId('team-total-row')).getByText('▲ 7')).toBeTruthy();
  });

  // Revert: render nothing until teamSummary resolves.
  it('falls back to the scoped summary while the unfiltered one is still loading', () => {
    const p = ovProps({ summary: scoped, url: { team: 'Payments' }, teamSummary: slot<SummaryData>(undefined, { loading: true }) });
    render(<TeamTable {...p} />);
    expect(rowOf('Payments')).toBeTruthy();
  });

  // Revert: let the error propagate to the page or hide it.
  it('shows the unfiltered request\'s error inside the table and nothing else', () => {
    const p = ovProps({ teamSummary: slot<SummaryData>(undefined, { error: new Error('x'), errorText: "Couldn't load team table: x", loading: false }) });
    render(<TeamTable {...p} />);
    expect(screen.getByTestId('team-table-error').textContent).toBe("Couldn't load team table: x");
    expect(screen.queryByTestId('team-total-row')).toBeNull();
  });

  it('dims while it shows the previous key\'s rows', () => {
    render(<TeamTable {...ovProps({ summary: pivot(), teamSummary: slot(summaryFixture(pivot()), { stale: true }) })} />);
    expect(screen.getByTestId('team-table').className).toContain('opacity-60');
  });
});

describe('rows', () => {
  it('shows the CRITICAL and HIGH bands, the figures, and — for a missing percentage or overdue', () => {
    render(<TeamTable {...table()} />);
    expect(screen.getByTestId('team-band-critical').textContent).toBe('CRITICAL');
    expect(screen.getByTestId('team-band-high').textContent).toBe('HIGH');
    const payments = cellsOf(rowOf('Payments')).map(c => c.textContent);
    expect(payments[0]).toContain('Payments');
    expect(payments[1]).toBe('6');
    expect(payments[3]).toContain('4');
    expect(payments[4]).toBe('40%');
    expect(cellsOf(rowOf('Unassigned')).some(c => c.textContent === '—')).toBe(true);
  });

  // Revert: put the dismissed count only in the cell text, or drop the title.
  it('the Resolved cell shows the dismissed count and carries it in its title', () => {
    render(<TeamTable {...table()} />);
    expect(within(rowOf('Payments')).getByTitle('of which dismissed: 1')).toBeTruthy();
    expect(within(rowOf('Payments')).getByText('(1)')).toBeTruthy();
  });

  // Revert: put the owning-team header text or its tooltip back to "Team".
  it('the first header reads "Owning team" and says it is not a Glooker team', () => {
    render(<TeamTable {...table()} />);
    const header = screen.getByRole('columnheader', { name: /Owning team/ });
    expect(header.getAttribute('title')).toBe("The repository's team custom property — not a Glooker team");
  });
});

describe('unmeasured badge', () => {
  // Revert: put the badge in the critical Open cell, or let the click reach the row.
  it('sits under the team name, opens the drawer with the button, and does not select the team', () => {
    const p = table();
    render(<TeamTable {...p} />);
    const badge = within(rowOf('Payments')).getByRole('button', { name: /2 unmeasured/ });
    expect(cellsOf(rowOf('Payments'))[0].contains(badge)).toBe(true);
    fireEvent.click(badge);
    expect(p.openDrawer).toHaveBeenCalledWith(badge);
    expect(p.url.selectTeamRow).not.toHaveBeenCalled();
  });

  it('appears only for a team with unmeasured repositories, and on the Total row with the total', () => {
    render(<TeamTable {...table()} />);
    expect(within(rowOf('Unassigned')).queryByText(/unmeasured/)).toBeNull();
    expect(within(screen.getByTestId('team-total-row')).getByText(unmeasuredBadgeText(2))).toBeTruthy();
    expect(unmeasuredBadgeText(2)).toBe('▲ 2 unmeasured repos');
  });
});

describe('change column', () => {
  const total = ovDeltaTeam('Total', 9);
  const avail = ovDelta(total, { teams: [ovDeltaTeam('Payments', 12), ovDeltaTeam('Unassigned', -3)] });

  // Revert: colour by sign the other way, or drop the arrows.
  it('a rise is red with ▲, a fall is green with ▼, no change is a grey 0', () => {
    const rows = [...ROWS, ovTeam('Search', ovCell(2), ovCell(0))];
    render(<TeamTable {...table({
      pivot: { rows, total: TOTAL },
      delta: { critical: ovDelta(total, { teams: [ovDeltaTeam('Payments', 12), ovDeltaTeam('Unassigned', -3), ovDeltaTeam('Search', 0)] }), high: ovNoBaseline() },
    }, {})} />);
    expect(within(rowOf('Payments')).getByText('▲ 12').className).toContain('text-red-400');
    expect(within(rowOf('Unassigned')).getByText('▼ 3').className).toContain('text-green-400');
    // The Change cell of a team whose delta is 0: the text is "0", in grey (not red, not green).
    const zero = cellsOf(rowOf('Search'))[2].firstElementChild as HTMLElement;
    expect(zero.textContent).toBe('0');
    expect(zero.className).toContain('text-gray-600');
    expect(zero.className).not.toMatch(/text-(red|green)-400/);
  });

  it('the Total row shows the delta total', () => {
    render(<TeamTable {...table({ delta: { critical: avail, high: ovNoBaseline() } })} />);
    expect(within(screen.getByTestId('team-total-row')).getByText('▲ 9')).toBeTruthy();
  });

  // Revert: render 0 or blank for a team absent from an available delta.
  it('a team missing from an available delta reads —', () => {
    const d = ovDelta(total, { teams: [ovDeltaTeam('Unassigned', 1)] });
    render(<TeamTable {...table({ delta: { critical: d, high: ovNoBaseline() } })} />);
    expect(cellsOf(rowOf('Payments'))[2].textContent).toBe('—');
  });

  // Revert: reuse the same span node so only its text changes.
  it('the value is a NEW node when its text changes (a baseline switch does not move a right-aligned figure)', () => {
    const withDelta = (n: number) => table({ delta: { critical: ovDelta(total, { teams: [ovDeltaTeam('Payments', n)] }), high: ovNoBaseline() } });
    const { rerender } = render(<TeamTable {...withDelta(12)} />);
    const before = within(rowOf('Payments')).getByText('▲ 12');
    rerender(<TeamTable {...withDelta(5)} />);
    const after = within(rowOf('Payments')).getByText('▲ 5');
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });
});

describe('header captions', () => {
  const baseline = (takenOn: string) => ovBaseline(takenOn);

  // Revert: share one caption between the two severities, or print the ISO date in the caption.
  it('shows "vs <display date>" under both Change headers, and under one only when the other is unavailable; the ISO date rides in the title', () => {
    const both = { critical: ovDelta(ovDeltaTeam('Total', 1), { baseline: baseline('2099-01-01') }), high: ovDelta(ovDeltaTeam('Total', 1), { baseline: baseline('2099-01-01') }) };
    const { unmount } = render(<TeamTable {...table({ delta: both })} />);
    expect(screen.getAllByText('vs Jan 1, 2099')).toHaveLength(2);
    expect(screen.getAllByText('vs Jan 1, 2099')[0].getAttribute('title')).toBe('Change in open alerts since the measurement taken on 2099-01-01');
    unmount();
    const oneOnly = { critical: both.critical, high: ovDelta(null, { baseline: baseline('2099-01-01') }) };
    render(<TeamTable {...table({ delta: oneOnly })} />);
    expect(screen.getAllByText('vs Jan 1, 2099')).toHaveLength(1);
    expect(screen.getByText('No measurement on or before Jan 1, 2099')).toBeTruthy();
  });

  it('with no baseline at all both headers say "No earlier measurement yet" (and the slot is never empty)', () => {
    render(<TeamTable {...table({ delta: { critical: ovNoBaseline(), high: ovNoBaseline() } })} />);
    expect(screen.getAllByText('No earlier measurement yet')).toHaveLength(2);
  });

  // Revert: change Resolved's title from the shared resolvedCaption.
  it('the Resolved header names the start date, "all time" or an invalid date in its title', () => {
    const cases: Array<[SummaryData['resolvedSince'], string]> = [
      [{ date: '2020-01-08', invalid: false }, 'Resolved since Jan 8, 2020'],
      [{ date: null, invalid: false }, 'Resolved all time'],
      [{ date: null, invalid: true }, 'Resolved since —'],
    ];
    for (const [resolvedSince, title] of cases) {
      const { unmount } = render(<TeamTable {...table({ resolvedSince })} />);
      expect(screen.getAllByRole('columnheader').filter(h => h.getAttribute('title') === title)).toHaveLength(2);
      unmount();
    }
  });
});

describe('Overdue columns per SLA state', () => {
  const policy = (severity: 'critical' | 'high', pending: boolean) => ({ id: `${severity}-1`, severity, days: 7, effectiveFrom: '2099-02-01', until: null, pending });
  /** The Open and Overdue headers in document order: where an Overdue column sits says which group it belongs to. */
  const openAndOverdue = () => screen.queryAllByRole('columnheader')
    .map(h => h.textContent ?? '').filter(t => t.startsWith('Open') || t.startsWith('Overdue')).map(t => (t.startsWith('Open') ? 'Open' : 'Overdue'));

  // Revert: render an Overdue column whatever the state, key it off anything but slaActive, or give the high group critical's column.
  it.each([
    ['active', { critical: 'active', high: 'active' }, [policy('critical', false), policy('high', false)], false, ['Open', 'Overdue', 'Open', 'Overdue']],
    ['critical only active', { critical: 'active', high: 'none' }, [policy('critical', false)], false, ['Open', 'Overdue', 'Open']],
    ['high only active', { critical: 'none', high: 'active' }, [policy('high', false)], false, ['Open', 'Open', 'Overdue']],
    ['pending', { critical: 'pending', high: 'pending' }, [policy('critical', true), policy('high', true)], false, ['Open', 'Open']],
    ['none', { critical: 'none', high: 'none' }, [], false, ['Open', 'Open']],
    ['invalid (parses as none)', { critical: 'none', high: 'none' }, [], true, ['Open', 'Open']],
    ['invalid wins over a stale active status', { critical: 'active', high: 'active' }, [policy('critical', false), policy('high', false)], true, ['Open', 'Open']],
  ] as const)('%s: headers %s', (_name, slaStatus, pol, invalid, headers) => {
    render(<TeamTable {...table({ slaStatus: slaStatus as SummaryData['slaStatus'], policy: pol as unknown as SummaryData['policy'], slaPolicyInvalid: invalid })} />);
    expect(openAndOverdue()).toEqual(headers);
    // The cells follow the headers: a row has 1 (name) + 4 per group + one per active Overdue column.
    expect(cellsOf(rowOf('Payments'))).toHaveLength(1 + 8 + headers.filter(h => h === 'Overdue').length);
  });

  // Revert: key the high group's Overdue column off the critical state.
  it('high only active: the Overdue cell is the LAST cell of the row and reads the high figure', () => {
    render(<TeamTable {...table({
      pivot: { rows: [ovTeam('Payments', ovCell(5, { overdue: null }), ovCell(4, { overdue: 3 }))], total: TOTAL },
      slaStatus: { critical: 'none', high: 'active' }, policy: [policy('high', false)] as unknown as SummaryData['policy'],
    })} />);
    const cells = cellsOf(rowOf('Payments'));
    expect(cells).toHaveLength(10);
    expect(cells[9].textContent).toBe('3');
    expect(cells[9].className).toContain('text-red-400');
  });

  it('an overdue count above zero is bold red, zero is grey', () => {
    render(<TeamTable {...table({ pivot: { rows: [ovTeam('Payments', ovCell(5, { overdue: 2 }), ovCell(1, { overdue: 0 }))], total: TOTAL }, slaStatus: { critical: 'active', high: 'active' } })} />);
    const cells = cellsOf(rowOf('Payments'));
    expect(cells[5].textContent).toBe('2');
    expect(cells[5].className).toContain('text-red-400');
    expect(cells[10].textContent).toBe('0');
    expect(cells[10].className).not.toContain('text-red-400');
  });
});

describe('hidden severity', () => {
  // Revert: leave the hidden severity's figures in, or use the em dash.
  it('"High only" shows – (en dash) in every critical column, the Total row included, and dims its headers to 35%', () => {
    render(<TeamTable {...table({ slaStatus: { critical: 'active', high: 'active' } }, { severity: 'high', kSev: 'high' })} />);
    for (const row of [rowOf('Payments'), screen.getByTestId('team-total-row')]) {
      const cells = cellsOf(row);
      expect(cells.slice(1, 6).map(c => c.textContent)).toEqual(['–', '–', '–', '–', '–']);
      expect(cells.slice(6, 10).map(c => c.textContent)).not.toContain('–');
    }
    expect(screen.getByTestId('team-band-critical').className).toContain('opacity-[0.35]');
    expect(screen.getByTestId('team-band-high').className).not.toContain('opacity-[0.35]');
    const openCrit = screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith('Open'))!;
    expect(openCrit.className).toContain('opacity-[0.35]');
  });

  it('"Critical only" hides the high columns the same way', () => {
    render(<TeamTable {...table({}, { severity: 'critical', kSev: 'critical' })} />);
    expect(cellsOf(rowOf('Payments')).slice(-4).map(c => c.textContent)).toEqual(['–', '–', '–', '–']);
    expect(screen.getByTestId('team-band-high').className).toContain('opacity-[0.35]');
  });

  it('with both severities shown nothing is dimmed or replaced', () => {
    render(<TeamTable {...table()} />);
    expect(screen.queryAllByText('–')).toHaveLength(0);
    expect(document.querySelector('.opacity-\\[0\\.35\\]')).toBeNull();
  });
});

describe('† marker and footnote', () => {
  const CARRY = 'Includes 3 carried over from imported CSV history (archived repo with no alert data)';
  const withCarry = {
    pivot: {
      rows: [ovTeam('Payments', ovCell(5, { resolved: 8, carriedResolved: 3 }), ovCell(0)), ovTeam('Unassigned', ovCell(1, { resolved: 2 }), ovCell(0))],
      total: ovTeam('Total', ovCell(6, { resolved: 10, carriedResolved: 3 }), ovCell(0)),
    },
  };

  it('a † with the carry title after the critical Resolved number of a row whose carriedResolved > 0', () => {
    render(<TeamTable {...table(withCarry)} />);
    expect(within(rowOf('Payments')).getByText('†').getAttribute('title')).toBe(CARRY);
    expect(within(rowOf('Unassigned')).queryByText('†')).toBeNull();
  });

  it('the footnote sits under the Total row when the total carriedResolved > 0', () => {
    render(<TeamTable {...table(withCarry)} />);
    const note = screen.getByTestId('team-table-footnote');
    expect(note.textContent).toBe('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.');
    expect(note.parentElement).toBe(screen.getByTestId('team-total-row').parentElement);
    // A fixed one-line height, so the overflow rule's arithmetic (and the pinned footer's height) holds.
    expect(note.style.height).toBe(`${TEAM_FOOTNOTE_H}px`);
    expect(note.className).toContain('truncate');
  });

  it('neither marker nor footnote when nothing carries', () => {
    render(<TeamTable {...table()} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByTestId('team-table-footnote')).toBeNull();
  });

  // Revert: key the marker off carriedResolved alone.
  it('neither when resolved is null (invalid start date) even though carriedResolved > 0', () => {
    const invalid = { pivot: { rows: [ovTeam('Payments', ovCell(5, { resolved: null, dismissed: null, carriedResolved: 3 }), ovCell(0))], total: ovTeam('Total', ovCell(5, { resolved: null, dismissed: null, carriedResolved: 3 }), ovCell(0)) }, resolvedSince: { date: null, invalid: true } };
    render(<TeamTable {...table(invalid)} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByTestId('team-table-footnote')).toBeNull();
  });
});

describe('row selection', () => {
  // Revert: toggle in the component (call selectTeamRow(null) for the selected row), or call setTeam.
  it('a click, and Enter, call url.selectTeamRow with the team; the selected row is highlighted and marked ×', () => {
    const p = table();
    const { rerender } = render(<TeamTable {...p} />);
    fireEvent.click(within(rowOf('Payments')).getByText('Payments'));
    expect(p.url.selectTeamRow).toHaveBeenLastCalledWith('Payments');
    fireEvent.keyDown(rowOf('Unassigned'), { key: 'Enter' });
    expect(p.url.selectTeamRow).toHaveBeenLastCalledWith('Unassigned');

    const selected = table({}, { team: 'Payments' });
    selected.url.selectTeamRow = p.url.selectTeamRow;
    rerender(<TeamTable {...selected} />);
    expect(rowOf('Payments').className).toContain('bg-accent/10');
    expect(rowOf('Payments').getAttribute('title')).toBe('Clear the Owning team filter');
    expect(within(rowOf('Payments')).getByText('×')).toBeTruthy();
    fireEvent.click(rowOf('Payments'));
    expect(p.url.selectTeamRow).toHaveBeenLastCalledWith('Payments');
    expect(p.url.setTeam).not.toHaveBeenCalled();
  });

  it('the Total row is not clickable', () => {
    const p = table();
    render(<TeamTable {...p} />);
    fireEvent.click(screen.getByTestId('team-total-row'));
    expect(p.url.selectTeamRow).not.toHaveBeenCalled();
  });
});

describe('sorting', () => {
  const rows = [ovTeam('Alpha', ovCell(2), ovCell(7)), ovTeam('Beta', ovCell(5), ovCell(1)), ovTeam('Gamma', ovCell(3), ovCell(4))];
  const order = () => screen.getAllByTestId(/^team-row-/).map(r => r.getAttribute('data-testid')!.replace('team-row-', ''));
  const openHeader = (n: number) => screen.getAllByRole('columnheader').filter(h => h.textContent?.startsWith('Open'))[n];

  it('starts in server order with no active header, then sorts a column descending, then ascending, with the arrow and aria-sort', () => {
    render(<TeamTable {...table(pivot(rows, TOTAL))} />);
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(openHeader(0).getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(openHeader(0)).getByRole('button'));
    expect(order()).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(openHeader(0).getAttribute('aria-sort')).toBe('descending');
    expect(openHeader(0).textContent).toContain('↓');
    fireEvent.click(within(openHeader(0)).getByRole('button'));
    expect(order()).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(openHeader(0).textContent).toContain('↑');
  });

  // Revert: sort the Total row with the others.
  it('the Total row stays last whatever the sort', () => {
    render(<TeamTable {...table(pivot(rows, TOTAL))} />);
    fireEvent.click(within(openHeader(0)).getByRole('button'));
    const all = Array.from(screen.getByTestId('team-table').querySelectorAll('[data-testid^="team-row-"], [data-testid="team-total-row"]')).map(r => r.getAttribute('data-testid'));
    expect(all[all.length - 1]).toBe('team-total-row');
  });

  // Revert: leave the hidden severity's headers clickable.
  it('a hidden severity\'s headers cannot be sorted', () => {
    render(<TeamTable {...table(pivot(rows, TOTAL), { severity: 'high', kSev: 'high' })} />);
    expect((within(openHeader(0)).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(openHeader(0).textContent).not.toMatch(/[↕↑↓]/);
    expect((within(openHeader(1)).getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the name column sorts ascending first', () => {
    render(<TeamTable {...table(pivot([rows[1], rows[2], rows[0]], TOTAL))} />);
    fireEvent.click(screen.getByRole('button', { name: /Owning team/ }));
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
