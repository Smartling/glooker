// src/app/vulnerabilities/sparkline.tsx
'use client';
// GLOOK-64: the 24px sparkline under the Open tile's count. It draws only STORED measurements (one
// point per sync or imported run), never a series rebuilt from alert timestamps, and it is summed
// from the unscoped trend response so a selected team costs no extra request.
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import { diffDays } from '@/lib/vulnerabilities/time';
import { toNum } from '@/components/charts/chart-format';
import { SPARK_H } from './dimensions';
import { displayDate } from './labels';
import { SPARKLINE_DAYS } from './security-state';

export interface SparkPoint { date: string; open: number }

/**
 * One point per stored measurement date: the open counts of every team on that date, summed. With a
 * team, only that team's series is summed, so the line matches the (team-scoped) count beside it.
 */
export function sparkPoints(series: readonly TrendSeries[], team: string | null): SparkPoint[] {
  const byDate = new Map<string, number>();
  for (const s of series) {
    if (team !== null && s.team !== team) continue;
    for (const p of s.points) byDate.set(p.date, (byDate.get(p.date) ?? 0) + toNum(p.open));
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, open]) => ({ date, open }));
}

/**
 * The request starts SPARKLINE_DAYS back, so a line whose first point is within 6 days of that start
 * "covers the window" and reads "last 90 days"; a younger one says how many measurements it has.
 */
export const SPARK_FULL_DAYS = SPARKLINE_DAYS - 6;
const WIDTH = 100;
const PAD = 2;

/** SVG `points` for a polyline in a 100 x SPARK_H box: x by date (first point to today), y by open count. */
export function sparkLine(points: readonly SparkPoint[], today: string): string {
  if (points.length === 0) return '';
  const first = points[0].date;
  const last = points[points.length - 1].date;
  const span = Math.max(1, diffDays(last > today ? last : today, first));
  const values = points.map(p => p.open);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) => (max === min ? SPARK_H / 2 : SPARK_H - PAD - ((v - min) / (max - min)) * (SPARK_H - 2 * PAD));
  return points.map(p => `${((diffDays(p.date, first) / span) * WIDTH).toFixed(2)},${y(p.open).toFixed(2)}`).join(' ');
}

export type SparkModel =
  | { kind: 'none'; message: string; caption: string }
  | { kind: 'one'; message: string; caption: string }
  | { kind: 'line'; line: string; caption: string };

export function sparkModel(points: readonly SparkPoint[], sev: Severity, today: string): SparkModel {
  if (points.length === 0) return { kind: 'none', message: 'Not enough history yet', caption: 'No measurements yet' };
  if (points.length === 1) {
    return { kind: 'one', message: 'Not enough history yet', caption: `1 measurement so far (${displayDate(points[0].date, today)})` };
  }
  const first = points[0].date;
  // The short caption drops the "Open {sev} ·" prefix: the tile's own title already names the severity, and the longer
  // wording was cut off at 1024px. The full text is also the caption's title.
  const caption = diffDays(today, first) >= SPARK_FULL_DAYS
    ? `Open ${sev} · last ${SPARKLINE_DAYS} days`
    : `${points.length} measurements since ${displayDate(first, today)}`;
  return { kind: 'line', line: sparkLine(points, today), caption };
}

export interface SparklineProps {
  /** Undefined while loading or after an error. */
  points: readonly SparkPoint[] | undefined;
  sev: Severity;
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** panelError text when the request failed. */
  errorText?: string | null;
}

/** The 24px slot and its caption line. Both keep their height in every state. */
export default function Sparkline({ points, sev, today, errorText = null }: SparklineProps) {
  const model = points ? sparkModel(points, sev, today) : null;
  const caption = errorText ?? model?.caption ?? null;
  return (
    <div data-testid="sparkline">
      <div data-testid="sparkline-slot" className="relative text-gray-400" style={{ height: SPARK_H }}>
        {model?.kind === 'line' && (
          <svg
            viewBox={`0 0 100 ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={model.caption}
            className="absolute inset-0 w-full overflow-visible" style={{ height: SPARK_H }}
          >
            <polyline
              points={model.line} fill="none" stroke="currentColor" strokeWidth={1.5}
              vectorEffect="non-scaling-stroke" strokeLinejoin="round"
            />
          </svg>
        )}
        {(model?.kind === 'none' || model?.kind === 'one') && (
          <span className="absolute inset-0 flex items-center text-[11px] text-gray-500">{model.message}</span>
        )}
        {errorText && <span className="absolute inset-0 flex items-center text-[11px] text-gray-500">Trend unavailable</span>}
      </div>
      <div
        data-testid="sparkline-caption" aria-hidden={caption ? undefined : true}
        className={`h-4 truncate text-[11px] leading-4 ${errorText ? 'text-red-400' : 'text-gray-500'}`} title={caption ?? undefined}
      >
        {caption ?? ' '}
      </div>
    </div>
  );
}
