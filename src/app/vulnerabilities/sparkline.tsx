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
import RefreshNote from './refresh-note';
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
  // The caption is the short form by spec, so it fits the narrowest tile at 1024px: the "Open {sev} ·" prefix is dropped
  // for a young history, because the tile's own label already names the severity. The caption's title holds this same text.
  const caption = diffDays(today, first) >= SPARK_FULL_DAYS
    ? `Open ${sev} · last ${SPARKLINE_DAYS} days`
    : `${points.length} measurements since ${displayDate(first, today)}`;
  return { kind: 'line', line: sparkLine(points, today), caption };
}

export interface SparklineProps {
  /** Undefined while loading, after an error with no data of its own, or while the request is unavailable. */
  points: readonly SparkPoint[] | undefined;
  sev: Severity;
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** panelError text when the request failed. With `points` it is a failed refresh: the line stays and the caption says so. */
  errorText?: string | null;
  /** The previous key's points are on screen while the new key loads: the slot dims. */
  stale?: boolean;
  /** The request answered `available: false` and there are no points: this text takes the slot's place. */
  unavailableText?: string | null;
}

/** The 24px slot and its caption line. Both keep their height in every state. */
export default function Sparkline({ points, sev, today, errorText = null, stale = false, unavailableText = null }: SparklineProps) {
  const model = points ? sparkModel(points, sev, today) : null;
  // Own points are never thrown away for an error: "Trend unavailable" covers the slot only when there is no line to draw.
  const failed = !points && !!errorText;
  const refreshFailed = !!points && !!errorText;
  // A failed refresh keeps the caption line for its note (RefreshNote, drawn below); otherwise the line holds the caption or the error.
  const caption = failed ? errorText : refreshFailed ? null : model?.caption ?? null;
  return (
    <div data-testid="sparkline" className={stale ? 'opacity-60' : undefined}>
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
        {failed && <span className="absolute inset-0 flex items-center text-[11px] text-gray-500">Trend unavailable</span>}
        {!points && !errorText && unavailableText && <span className="absolute inset-0 flex items-center text-[11px] text-gray-500">{unavailableText}</span>}
      </div>
      {/* No aria-hidden here: the line holds the live note, which has to stay in the accessibility tree to be announced. */}
      <div
        data-testid="sparkline-caption"
        className={`h-4 truncate text-[11px] leading-4 ${failed ? 'text-red-400' : 'text-gray-500'}`} title={(refreshFailed ? errorText : caption) ?? undefined}
      >
        {refreshFailed ? null : (caption ?? '\u00a0')}
        {/* Live: the sparkline owns the announcement for the sparkline request. */}
        <RefreshNote error={refreshFailed ? errorText : null} testId="sparkline-refresh-note" live className="leading-4" />
      </div>
    </div>
  );
}
