/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import CalendarGrid, { calendarWeeks } from '@/app/activity/calendar-grid';

describe('calendarWeeks', () => {
  it('lays days out in Sunday-first columns, padding the first and last week', () => {
    const w = calendarWeeks('2026-11-04', '2026-11-10'); // Wed .. Tue
    expect(w).toEqual([
      [null, null, null, '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'],
      ['2026-11-08', '2026-11-09', '2026-11-10', null, null, null, null],
    ]);
  });

  it('covers a full year in 53 columns', () => {
    expect(calendarWeeks('2025-11-11', '2026-11-10')).toHaveLength(53);
  });
});

it('draws one cell per day with the shade from the team thresholds', () => {
  const { container } = render(
    <CalendarGrid start="2026-11-08" end="2026-11-10" days={{ '2026-11-08': 1, '2026-11-10': 9 }}
      thresholds={[1, 2, 3]} color="#00aa00" unit="commits" />,
  );
  const cells = [...container.querySelectorAll('rect')];
  expect(cells.map((c) => [c.getAttribute('data-day'), c.getAttribute('data-shade')])).toEqual([
    ['2026-11-08', '1'], ['2026-11-09', '0'], ['2026-11-10', '4'],
  ]);
  expect(cells[1].getAttribute('class')).toBe('fill-gray-800');
  expect(cells[2].textContent).toBe('2026-11-10: 9 commits');
});
