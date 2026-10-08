/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx
// The KPI tile "Resolved {severity}": the count, "N dismissed · since {date}" (or "all time"), the
// † for carried-over CSV history and the "% of N raised are closed" line.
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import { ovCell, ovProps, ovTeam } from '../support/security-fixtures';

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
