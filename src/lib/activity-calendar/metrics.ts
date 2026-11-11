/** Client-safe pieces of the activity calendar (no DB import). */

export const METRICS = ['commits', 'lines', 'jira', 'story_points', 'prs', 'reviews'] as const;
export type CalendarMetric = typeof METRICS[number];

export const METRIC_LABELS: Record<CalendarMetric, string> = {
  commits: 'Commits',
  lines: 'Lines changed',
  jira: 'Jira issues resolved',
  story_points: 'Story points',
  prs: 'PRs merged',
  reviews: 'PR reviews',
};

export const CALENDAR_DAYS = 365;

export interface CalendarRow { login: string; total: number; days: Record<string, number> }
export interface CalendarResult {
  metric: CalendarMetric;
  start: string;           // first day shown, inclusive (UTC)
  end: string;             // last day shown, inclusive (UTC)
  thresholds: number[];    // upper bounds of shades 1..3; above the last is shade 4
  rows: CalendarRow[];     // sorted by total, highest first
}

/**
 * Shade thresholds shared by the whole team, so the same shade means the same amount on every row:
 * quartiles of the team's non-zero days.
 */
export function teamThresholds(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  return [q(0.25), q(0.5), q(0.75)];
}

/** 0 = no activity, 1..4 = shades. */
export function shadeFor(value: number, thresholds: number[]): number {
  if (!(value > 0)) return 0;
  const i = thresholds.findIndex((t) => value <= t);
  return i === -1 ? 4 : i + 1;
}

