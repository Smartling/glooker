'use client';

import { shadeFor } from '@/lib/activity-calendar/metrics';

const DAY_MS = 86_400_000;
const CELL = 11;
const GAP = 2;
const SHADE_OPACITY = [0, 0.3, 0.55, 0.8, 1];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days from `start` to `end` (inclusive, UTC) laid out in Sunday-first week columns, GitHub style. */
export function calendarWeeks(start: string, end: string): Array<Array<string | null>> {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  const weeks: Array<Array<string | null>> = [];
  let week: Array<string | null> = Array(new Date(first).getUTCDay()).fill(null);
  for (let t = first; t <= last; t += DAY_MS) {
    week.push(new Date(t).toISOString().slice(0, 10));
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  return weeks;
}

export default function CalendarGrid({ start, end, days, thresholds, color, unit, showMonths }: {
  start: string; end: string; days: Record<string, number>; thresholds: number[];
  color: string; unit: string; showMonths?: boolean;
}) {
  const weeks = calendarWeeks(start, end);
  const width = weeks.length * (CELL + GAP);
  const top = showMonths ? 12 : 0;
  return (
    <svg width={width} height={top + 7 * (CELL + GAP)} role="img" aria-label={`${unit} per day`} className="block">
      {showMonths && weeks.map((w, i) => {
        const firstOfMonth = w.find((d) => d?.endsWith('-01'));
        return firstOfMonth ? (
          <text key={`m${i}`} x={i * (CELL + GAP)} y={9} fontSize={9} className="fill-gray-500">
            {MONTHS[Number(firstOfMonth.slice(5, 7)) - 1]}
          </text>
        ) : null;
      })}
      {weeks.map((w, i) => w.map((day, j) => {
        if (!day) return null;
        const value = days[day] ?? 0;
        const shade = shadeFor(value, thresholds);
        return (
          <rect
            key={day} data-day={day} data-shade={shade}
            x={i * (CELL + GAP)} y={top + j * (CELL + GAP)} width={CELL} height={CELL} rx={2}
            className={shade ? undefined : 'fill-gray-800'}
            fill={shade ? color : undefined} fillOpacity={shade ? SHADE_OPACITY[shade] : undefined}
          >
            <title>{`${day}: ${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`}</title>
          </rect>
        );
      }))}
    </svg>
  );
}
