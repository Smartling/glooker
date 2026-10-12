/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-sparkline.test.tsx
// The KPI sparkline: stored measurements only, summed per date, with three history states.
import { render, screen } from '@testing-library/react';
import Sparkline, { sparkLine, sparkModel, sparkPoints, SPARK_FULL_DAYS } from '@/app/vulnerabilities/sparkline';
import { SPARK_H } from '@/app/vulnerabilities/dimensions';
import { SPARKLINE_DAYS } from '@/app/vulnerabilities/security-state';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

const TODAY = '2026-09-30';
const series: TrendSeries[] = [
  { team: 'Payments', points: [{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }] },
  { team: 'Search', points: [{ date: '2026-09-22', open: 1 }, { date: '2026-09-29', open: 1 }] },
];

describe('sparkPoints', () => {
  // Revert: take only the first series, or average instead of summing.
  it('sums every team per stored measurement date, oldest first', () => {
    expect(sparkPoints(series, null)).toEqual([{ date: '2026-09-22', open: 3 }, { date: '2026-09-29', open: 4 }]);
  });

  // Revert: ignore the team argument.
  it('with a team it sums only that team, so the line matches the team-scoped count beside it', () => {
    expect(sparkPoints(series, 'Payments')).toEqual([{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }]);
    expect(sparkPoints(series, 'Nobody')).toEqual([]);
  });

  it('coerces a string count from the database and merges teams that share a date', () => {
    const odd = [{ team: 'A', points: [{ date: '2026-09-29', open: '2' as unknown as number }] }, { team: 'B', points: [{ date: '2026-09-29', open: 5 }] }];
    expect(sparkPoints(odd, null)).toEqual([{ date: '2026-09-29', open: 7 }]);
  });
});

describe('sparkLine', () => {
  // Revert: space the points evenly instead of by date.
  it('places points by their date: a point a quarter of the way in time is a quarter of the way across', () => {
    const pts = [{ date: '2026-09-02', open: 0 }, { date: '2026-09-09', open: 4 }, { date: '2026-09-30', open: 8 }];
    const xs = sparkLine(pts, TODAY).split(' ').map(p => Number(p.split(',')[0]));
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeCloseTo(25, 1);
    expect(xs[2]).toBe(100);
  });

  it('keeps the line inside the 24px slot and puts a higher count higher up', () => {
    const ys = sparkLine([{ date: '2026-09-01', open: 1 }, { date: '2026-09-10', open: 9 }], TODAY).split(' ').map(p => Number(p.split(',')[1]));
    expect(ys[1]).toBeLessThan(ys[0]);
    for (const y of ys) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(SPARK_H); }
  });

  // Revert: change PAD, or scale y without it (the lowest point would sit on the slot's edge and be clipped).
  it('puts the lowest count 2px above the slot\'s bottom and the highest 2px below its top', () => {
    const ys = sparkLine([{ date: '2026-09-01', open: 1 }, { date: '2026-09-10', open: 9 }], TODAY).split(' ').map(p => Number(p.split(',')[1]));
    expect(ys).toEqual([SPARK_H - 2, 2]);
  });

  // Revert: end the x scale at the last point instead of at today.
  it('a line whose last point is before today stops short of the right edge: x runs from the first point to TODAY', () => {
    // 29 days from the first point to TODAY; the last point is 14 days in.
    const xs = sparkLine([{ date: '2026-09-01', open: 1 }, { date: '2026-09-15', open: 9 }], TODAY).split(' ').map(p => Number(p.split(',')[0]));
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeCloseTo((14 / 29) * 100, 2);
    expect(xs[1]).toBeLessThan(100);
  });

  it('a flat series is a line across the middle, never NaN', () => {
    const out = sparkLine([{ date: '2026-09-01', open: 4 }, { date: '2026-09-10', open: 4 }], TODAY);
    expect(out).not.toMatch(/NaN/);
    expect(out.split(' ').map(p => Number(p.split(',')[1]))).toEqual([SPARK_H / 2, SPARK_H / 2]);
  });
});

describe('sparkModel (0, 1 and 2+ measurements)', () => {
  // Revert: swap the messages, or draw a line for one point.
  it('0 measurements: "Not enough history yet" in the slot and "No measurements yet" as the caption', () => {
    expect(sparkModel([], 'critical', TODAY)).toEqual({ kind: 'none', message: 'Not enough history yet', caption: 'No measurements yet' });
  });

  it('1 measurement: "Not enough history yet" and "1 measurement so far (<display date>)"', () => {
    expect(sparkModel([{ date: '2026-09-30', open: 3 }], 'critical', TODAY))
      .toEqual({ kind: 'one', message: 'Not enough history yet', caption: '1 measurement so far (Sep 30)' });
  });

  // Revert: put the "Open <sev> ·" prefix back (at 1024px it cut the caption off before the date), or drop the count.
  it('2+ measurements under 90 days of history: "N measurements since <date>", with no severity prefix', () => {
    const m = sparkModel([{ date: '2026-09-22', open: 3 }, { date: '2026-09-29', open: 4 }], 'high', TODAY);
    expect(m.kind).toBe('line');
    expect(m.caption).toBe('2 measurements since Sep 22');
  });

  it('a history that started in an earlier year writes the year in its date', () => {
    // "today" is in 2031, a year the suite never runs in, so a caption that ignored the argument would fail.
    expect(sparkModel([{ date: '2031-01-02', open: 3 }, { date: '2031-01-05', open: 4 }], 'high', '2031-01-06').caption).toBe('2 measurements since Jan 2');
    expect(sparkModel([{ date: '2030-12-30', open: 3 }, { date: '2031-01-05', open: 4 }], 'high', '2031-01-06').caption).toBe('2 measurements since Dec 30, 2030');
    expect(sparkModel([{ date: '2030-12-30' , open: 3 }], 'high', '2031-01-06').caption).toBe('1 measurement so far (Dec 30, 2030)');
  });

  // Revert: compare with the wrong threshold (e.g. > instead of >=) or drop the branch.
  it(`history reaching back ${SPARK_FULL_DAYS} days or more reads "Open <sev> · last ${SPARKLINE_DAYS} days"`, () => {
    const edge = [{ date: '2026-07-08', open: 3 }, { date: '2026-09-29', open: 4 }]; // exactly 84 days before TODAY
    expect(sparkModel(edge, 'critical', TODAY).caption).toBe(`Open critical · last ${SPARKLINE_DAYS} days`);
    const short = [{ date: '2026-07-09', open: 3 }, { date: '2026-09-29', open: 4 }]; // 83 days
    expect(sparkModel(short, 'critical', TODAY).caption).toBe('2 measurements since Jul 9');
  });

  // Revert: hard-code 84 or "90 days" instead of deriving both from SPARKLINE_DAYS (the request window).
  it('the window is the one the sparkline request asks for', () => {
    expect(SPARKLINE_DAYS).toBe(90);
    expect(SPARK_FULL_DAYS).toBe(SPARKLINE_DAYS - 6);
  });
});

describe('Sparkline component', () => {
  // Revert: drop the inline height from the slot in any state.
  it('keeps the 24px slot and a caption line in every state: loading, error, 0, 1 and 2+ measurements', () => {
    const states: Array<{ points: Array<{ date: string; open: number }> | undefined; errorText?: string }> = [
      { points: undefined },
      { points: undefined, errorText: "Couldn't load trend: HTTP 500" },
      { points: [] },
      { points: [{ date: '2026-09-29', open: 2 }] },
      { points: [{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }] },
    ];
    for (const s of states) {
      const { unmount } = render(<Sparkline points={s.points} sev="critical" today={TODAY} errorText={s.errorText} />);
      expect(screen.getByTestId('sparkline-slot').style.height).toBe(`${SPARK_H}px`);
      expect(screen.getByTestId('sparkline-caption').className).toContain('h-4');
      unmount();
    }
  });

  it('draws one polyline for 2+ measurements and none for fewer', () => {
    const { container, rerender } = render(<Sparkline points={[{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }]} sev="critical" today={TODAY} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    rerender(<Sparkline points={[{ date: '2026-09-29', open: 2 }]} sev="critical" today={TODAY} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    expect(screen.getByText('Not enough history yet')).toBeTruthy();
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('1 measurement so far (Sep 29)');
  });

  // Revert: drop the title, or put the severity prefix back in front of the count.
  it('the caption carries its full text as a title, and truncates rather than wrapping, so a narrow tile never grows', () => {
    render(<Sparkline points={[{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }]} sev="critical" today={TODAY} />);
    const cap = screen.getByTestId('sparkline-caption');
    expect(cap.textContent).toBe('2 measurements since Sep 22');
    expect(cap.getAttribute('title')).toBe(cap.textContent);
    expect(cap.className).toContain('truncate');
    // Long enough to read in full in the narrowest tile (~190px at 11px): the date is the last thing a cut-off would lose.
    expect(cap.textContent!.length).toBeLessThanOrEqual(30);
  });

  const LINE = [{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }];

  // Revert: key the error overlay and the caption on errorText alone (the old order): the line is thrown away for the error.
  it('a failed refresh with its own points keeps the line and shows a red caption; "Trend unavailable" is only for no points', () => {
    const { container, rerender } = render(<Sparkline points={LINE} sev="critical" today={TODAY} errorText="Couldn't load trend: HTTP 500" />);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(screen.queryByText('Trend unavailable')).toBeNull();
    const cap = screen.getByTestId('sparkline-caption');
    expect(cap.textContent).toBe("Couldn't refresh · showing last load");
    const note = screen.getByTestId('sparkline-refresh-note');
    expect(cap.contains(note)).toBe(true);
    expect(note.className).toContain('text-red-400');
    expect(note.getAttribute('title')).toBe("Couldn't load trend: HTTP 500");
    expect(cap.getAttribute('title')).toBe("Couldn't load trend: HTTP 500");
    rerender(<Sparkline points={undefined} sev="critical" today={TODAY} errorText="Couldn't load trend: HTTP 500" />);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    expect(screen.getByText('Trend unavailable')).toBeTruthy();
  });

  // Revert: mount the note only while the refresh has failed, or leave the caption aria-hidden around it.
  it('the refresh note is a live region that is in the page, empty, before any failure, and owns the sparkline request\'s announcement', () => {
    const { rerender } = render(<Sparkline points={LINE} sev="critical" today={TODAY} />);
    const note = screen.getByTestId('sparkline-refresh-note');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toBe('');
    rerender(<Sparkline points={LINE} sev="critical" today={TODAY} errorText="Couldn't load trend: HTTP 500" />);
    expect(screen.getByTestId('sparkline-refresh-note')).toBe(note);
    expect(note.textContent).toBe("Couldn't refresh · showing last load");
    expect(note.className).toContain('text-xs');
    expect(note.className).toContain('truncate');
    // With a failed refresh the caption's own text gives the line to the note.
    expect(screen.getByTestId('sparkline-caption').textContent).toBe("Couldn't refresh · showing last load");
  });

  it('a failure with no points is the error itself in the caption (not the refresh note), and keeps the 16px line', () => {
    render(<Sparkline points={undefined} sev="critical" today={TODAY} errorText="Couldn't load trend: HTTP 500" />);
    expect(screen.getByTestId('sparkline-refresh-note').textContent).toBe('');
    expect(screen.getByTestId('sparkline-caption').className).toContain('h-4');
  });

  // Revert: drop the dim.
  it('dims while the previous key\'s points are on screen, and not otherwise', () => {
    const { rerender } = render(<Sparkline points={LINE} sev="critical" today={TODAY} stale />);
    expect(screen.getByTestId('sparkline').className).toContain('opacity-60');
    rerender(<Sparkline points={LINE} sev="critical" today={TODAY} />);
    expect(screen.getByTestId('sparkline').className).not.toContain('opacity-60');
  });

  it('an unavailable answer with no points shows its text in the slot, keeping the 24px slot and the caption line', () => {
    render(<Sparkline points={undefined} sev="critical" today={TODAY} unavailableText="Not available yet" />);
    expect(screen.getByText('Not available yet')).toBeTruthy();
    expect(screen.getByTestId('sparkline-slot').style.height).toBe(`${SPARK_H}px`);
    expect(screen.getByTestId('sparkline-caption').className).toContain('h-4');
  });

  it('while loading the caption is a non-breaking space; after an error it shows the message in red', () => {
    const { rerender } = render(<Sparkline points={undefined} sev="critical" today={TODAY} />);
    const cap = screen.getByTestId('sparkline-caption');
    expect(cap.textContent).toBe('\u00a0');
    // Not aria-hidden: the line also holds the live refresh note, which has to stay in the accessibility tree.
    expect(cap.getAttribute('aria-hidden')).toBeNull();
    rerender(<Sparkline points={undefined} sev="critical" today={TODAY} errorText="Couldn't load trend: HTTP 500" />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe("Couldn't load trend: HTTP 500");
    expect(screen.getByTestId('sparkline-caption').className).toContain('text-red-400');
  });
});
