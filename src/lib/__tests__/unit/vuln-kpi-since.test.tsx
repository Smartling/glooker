/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-since.test.tsx
// The KPI tile "{Severity} since {date}": new / resolved (N dismissed) / reopened since the baseline.
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import { ovBaseline, ovDelta, ovDeltaTeam, ovNoBaseline, ovProps } from '../support/security-fixtures';

const tile = () => screen.getByTestId('kpi-since');
const total = (over: Partial<ReturnType<typeof ovDeltaTeam>> = {}) => ovDeltaTeam('Total', 2, { new: 4, resolved: 3, dismissed: 1, reopened: 2, ...over });
const withDelta = (d: ReturnType<typeof ovDelta>) => ovProps({ summary: { delta: { critical: d, high: ovNoBaseline() } } });
const NBSP = '\u00a0';
// The page prints dates through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates below read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });

describe('available delta', () => {
  it('titles the tile with the severity and the baseline date (a display date, the ISO date in the title), and lists new, resolved (dismissed) and reopened', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { baseline: ovBaseline('2026-09-29') }))} />);
    const label = within(tile()).getByText('critical since Sep 29');
    expect(label.getAttribute('title')).toBe('critical since Sep 29. Compared with the measurement taken on 2026-09-29');
    const text = tile().textContent ?? '';
    expect(text).toContain('new4');
    expect(text).toContain('resolved(1 dismissed)3');
    expect(text).toContain('reopened2');
  });

  // Revert: read the critical delta whatever kSev says.
  // Revert: drop the title on the label span.
  it('each figure row\'s label carries its full text as a title', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { baseline: ovBaseline('2026-09-29') }))} />);
    expect(within(tile()).getByText('new').getAttribute('title')).toBe('new');
    expect(within(tile()).getByText(/^resolved/).getAttribute('title')).toBe('resolved (1 dismissed)');
  });

  it('follows kSev: "High only" reads the high delta', () => {
    const p = ovProps({
      url: { severity: 'high', kSev: 'high' },
      summary: { delta: { critical: ovDelta(total()), high: ovDelta(total({ new: 9, resolved: 8, dismissed: 7, reopened: 6 })) } },
    });
    render(<KpiTiles {...p} />);
    expect(within(tile()).getByText('high since Sep 15')).toBeTruthy();
    expect(tile().textContent).toContain('new9');
  });

  // Revert: print the "vs <date>" caption again (the tile's own title already names the date).
  it('has no "vs <date>" caption: the slot stays, reading an aria-hidden non-breaking space', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { baseline: ovBaseline('2099-01-01') }))} />);
    const caption = screen.getByTestId('kpi-since-caption');
    expect(caption.textContent).toBe(NBSP);
    expect(caption.getAttribute('aria-hidden')).toBe('true');
    expect(tile().textContent).not.toMatch(/vs /);
    expect(within(tile()).getByText('critical since Jan 1, 2099')).toBeTruthy();
  });
});

describe('"N repos not in baseline"', () => {
  // Revert: join the count back onto the caption, or render the line conditionally.
  it('0 repos: the line holds only an aria-hidden non-breaking space', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { reposNotInBaseline: 0 }))} />);
    const repos = screen.getByTestId('kpi-since-repos');
    expect(repos.textContent).toBe(NBSP);
    expect(repos.getAttribute('aria-hidden')).toBe('true');
  });

  it('3 repos: the count sits on its own line', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { reposNotInBaseline: 3 }))} />);
    expect(screen.getByTestId('kpi-since-repos').textContent).toBe('3 repos not in baseline');
    expect(screen.getByTestId('kpi-since-repos').hasAttribute('aria-hidden')).toBe(false);
  });

  // Revert: gate the line on `d.available` alone: a delta that says available but has no total (dashes in the tile) still printed a count.
  it('is not shown when the delta has no usable total (available, but no total or no baseline), whatever count it carries', () => {
    const noTotal = ovDelta(null, { available: true, reposNotInBaseline: 4 });
    const noBaseline = ovDelta(total(), { baseline: null, reposNotInBaseline: 4 });
    for (const d of [noTotal, noBaseline]) {
      const { unmount } = render(<KpiTiles {...withDelta(d)} />);
      expect(screen.getByTestId('kpi-since-repos').textContent).toBe(NBSP);
      expect(screen.getByTestId('kpi-since-repos').getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  // Revert: show the count for an unavailable delta too.
  it('is not shown when the delta is unavailable, even if it carries a count', () => {
    render(<KpiTiles {...withDelta(ovDelta(null, { available: false, reposNotInBaseline: 5 }))} />);
    expect(screen.getByTestId('kpi-since-repos').textContent).toBe(NBSP);
  });
});

describe('"other ±N"', () => {
  // Revert: drop the truncation or the title.
  it('is shown on one truncated line with the full text in its title', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ other: 4 })))} />);
    const el = screen.getByTestId('kpi-since-other');
    expect(el.textContent).toBe('other +4');
    expect(el.className).toContain('truncate');
    expect(el.getAttribute('title')).toBe('other +4: change in open alerts not explained by new, resolved or reopened');
    expect(el.hasAttribute('aria-hidden')).toBe(false);
  });

  // Revert: print the raw numbers (signed(), dismissed, repos not in baseline) instead of going through dash().
  it('every count in the tile is grouped: dismissed, "other" and repositories not in baseline', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ dismissed: 1234, resolved: 2345, other: 3456 }), { reposNotInBaseline: 4567 }))} />);
    expect(tile().textContent).toContain('resolved(1,234 dismissed)2,345');
    expect(screen.getByTestId('kpi-since-other').textContent).toBe('other +3,456');
    expect(screen.getByTestId('kpi-since-repos').textContent).toBe('4,567 repos not in baseline');
  });

  it('shows the sign of a negative remainder', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ other: -2 })))} />);
    expect(screen.getByTestId('kpi-since-other').textContent).toBe('other -2');
  });

  // Revert: render the line for zero too.
  it('is not shown when it is zero: the slot holds an aria-hidden non-breaking space', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ other: 0 })))} />);
    const el = screen.getByTestId('kpi-since-other');
    expect(el.textContent).toBe(NBSP);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('unavailable delta', () => {
  // Revert: keep the old copy ("no measurement for this view before ...") or always name a date.
  it('a null baseline reads "No earlier measurement yet" and shows dashes', () => {
    render(<KpiTiles {...withDelta(ovNoBaseline())} />);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('No earlier measurement yet');
    expect(within(tile()).getByText('critical since baseline')).toBeTruthy();
    expect(within(tile()).getAllByText('—')).toHaveLength(3);
  });

  it('a known baseline that does not measure this view reads "No measurement on or before <date>"', () => {
    render(<KpiTiles {...withDelta(ovDelta(null, { baseline: ovBaseline('2099-01-01') }))} />);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('No measurement on or before Jan 1, 2099');
    expect(screen.getByTestId('kpi-since-caption').getAttribute('title')).toBe('No measurement on or before Jan 1, 2099');
  });

  // Revert: choose the available branch on `available` alone and dereference total.
  it('an available delta with a null total takes the unavailable branch: no throw, dashes, no NaN', () => {
    render(<KpiTiles {...withDelta(ovDelta(null, { available: true, baseline: ovBaseline('2099-01-01') }))} />);
    expect(within(tile()).getAllByText('—')).toHaveLength(3);
    expect(tile().textContent).not.toMatch(/NaN|undefined|null/);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('No measurement on or before Jan 1, 2099');
  });
});

describe('fixed shape', () => {
  // Revert: drop a reserved slot's fixed height (h-4) or let it wrap (truncate) in either branch.
  it('every reserved line has the same height and truncation classes whether the delta is available or not', () => {
    const slots = ['kpi-since-other', 'kpi-since-caption', 'kpi-since-repos'];
    const classes = () => slots.map(id => screen.getByTestId(id).className);
    const { unmount } = render(<KpiTiles {...withDelta(ovDelta(total({ other: 1 }), { reposNotInBaseline: 2 }))} />);
    const available = classes();
    unmount();
    render(<KpiTiles {...withDelta(ovNoBaseline())} />);
    expect(classes()).toEqual(available);
    for (const c of available) { expect(c).toContain('h-4'); expect(c).toContain('truncate'); }
  });

  it('the three figure rows are single fixed-height lines whose label truncates', () => {
    render(<KpiTiles {...withDelta(ovDelta(total()))} />);
    const rows = Array.from(tile().querySelectorAll('div.h-5'));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.querySelector('.truncate')).not.toBeNull();
  });
});
