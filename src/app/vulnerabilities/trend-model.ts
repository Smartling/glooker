// src/app/vulnerabilities/trend-model.ts
// GLOOK-64: the trend card's pure rules: the x-axis domain, the rows a chart draws, the "not enough
// history" messages and the legend. No React and no server imports. Points are placed by their actual
// date; nothing here fills a gap or rebuilds history from alert timestamps.
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { addDays, diffDays } from '@/lib/vulnerabilities/time';
import { toNum } from '@/components/charts/chart-format';
import type { TrendRange } from './security-state';
import { displayDate } from './labels';
import { assignTeamColors, OTHER_TEAM_COLOR } from './team-colors';

const DAY_MS = 86_400_000;

/** The All range always spans at least this many days, so two nearby points do not fill the plot. */
export const TREND_MIN_SPAN_DAYS = 7;
/** A history younger than this shows the "History starts ..." note. */
export const SHORT_HISTORY_DAYS = 14;

export const TREND_RANGES: ReadonlyArray<readonly [TrendRange, string]> = [
  ['all', 'All time'], ['1y', 'Last year'], ['90d', 'Last 90 days'], ['30d', 'Last 30 days'],
];
const RANGE_DAYS: Record<Exclude<TrendRange, 'all'>, number> = { '30d': 30, '90d': 90, '1y': 365 };

/** Days since the epoch, as the chart's numeric x value. */
export const dayNumber = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
export const isoOfDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

const allDates = (series: readonly TrendSeries[]): string[] =>
  [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();

/**
 * The x-axis span. "All" runs from the first point to today and never spans less than
 * TREND_MIN_SPAN_DAYS; the other ranges run from today minus 30, 90 or 365 days to today. A point
 * after today (a skewed clock) extends the end rather than falling off the plot.
 */
export function trendDomain(range: TrendRange, series: readonly TrendSeries[], today: string): { start: string; end: string } {
  const dates = allDates(series);
  const last = dates[dates.length - 1];
  const end = last && last > today ? last : today;
  if (range !== 'all') return { start: addDays(today, -RANGE_DAYS[range]), end };
  const floor = addDays(end, -TREND_MIN_SPAN_DAYS);
  return { start: dates[0] && dates[0] < floor ? dates[0] : floor, end };
}

/** Evenly spaced whole-day ticks across the domain, first and last included. */
export function trendTicks(start: string, end: string, count = 5): number[] {
  const a = dayNumber(start);
  const b = dayNumber(end);
  return Array.from({ length: count }, (_, i) => Math.round(a + ((b - a) * i) / (count - 1)));
}

export interface TrendRow { t: number; date: string; values: Record<string, number> }

/** One row per date that has a point in a drawn series, keyed by team (names may contain dots). */
export function trendRows(drawn: readonly TrendSeries[]): TrendRow[] {
  const byDate = new Map<string, TrendRow>();
  for (const s of drawn) {
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { t: dayNumber(p.date), date: p.date, values: {} };
      row.values[s.team] = toNum(p.open);
      byDate.set(p.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t);
}

export interface TrendStatus {
  /** Stored measurements in range: distinct dates across ALL teams, whichever team is drawn. */
  measurements: number;
  /** Shown instead of the chart when there are fewer than two. */
  message: { title: string; sub: string } | null;
  /** Shown over a chart whose history is short. */
  note: string | null;
}

export function trendStatus(series: readonly TrendSeries[], range: TrendRange, today: string): TrendStatus {
  const dates = allDates(series);
  if (dates.length === 0) {
    return {
      measurements: 0,
      message: { title: 'No measurements yet', sub: range === 'all' ? 'History starts at the first sync.' : 'No measurements in this range.' },
      note: null,
    };
  }
  if (dates.length === 1) {
    return {
      measurements: 1,
      message: { title: 'Not enough history yet', sub: `1 measurement so far (${displayDate(dates[0], today)}). The line appears after the next sync.` },
      note: null,
    };
  }
  // The note says where history starts, which only the All range can claim.
  const young = range === 'all' && diffDays(today, dates[0]) < SHORT_HISTORY_DAYS;
  return {
    measurements: dates.length,
    message: null,
    note: young ? `History starts ${displayDate(dates[0], today)} (first sync) · ${dates.length} measurements` : null,
  };
}

export interface LegendEntry {
  label: string;
  color: string;
  /** Open count at the team's latest point; for "Other", the sum over its teams. */
  open: number;
  /** The tooltip: the team's name, or for "Other" every name it stands for. */
  title: string;
  /** Teams this entry stands for. */
  teams: string[];
  /** Dimmed to 0.4 because another team is selected. */
  dimmed: boolean;
  selected: boolean;
}

const latestOpen = (s: TrendSeries): number => toNum(s.points[s.points.length - 1]?.open);

/**
 * Every owning team, always: the top 12 by open count (the ones assignTeamColors gives a colour) each
 * with their own entry, then one "Other · N teams" entry for the rest. Selecting a team never removes
 * an entry, so the legend's height does not change; the others are marked dimmed instead.
 */
export function buildLegend(series: readonly TrendSeries[], selected: string | null): LegendEntry[] {
  const colors = assignTeamColors([...series]);
  const ranked = [...series].sort((a, b) => latestOpen(b) - latestOpen(a) || a.team.localeCompare(b.team));
  const entry = (teams: TrendSeries[], label: string, color: string, title: string): LegendEntry => ({
    label, color, title, teams: teams.map(s => s.team), open: teams.reduce((n, s) => n + latestOpen(s), 0),
    dimmed: selected !== null && !teams.some(s => s.team === selected),
    selected: selected !== null && teams.some(s => s.team === selected),
  });
  const named = ranked.filter(s => colors[s.team] !== OTHER_TEAM_COLOR);
  const rest = ranked.filter(s => colors[s.team] === OTHER_TEAM_COLOR);
  const out = named.map(s => entry([s], s.team, colors[s.team], s.team));
  if (rest.length) {
    out.push(entry(rest, `Other · ${rest.length} ${rest.length === 1 ? 'team' : 'teams'}`, OTHER_TEAM_COLOR, rest.map(s => s.team).sort((a, b) => a.localeCompare(b)).join(', ')));
  }
  return out;
}
