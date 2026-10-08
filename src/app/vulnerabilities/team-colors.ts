// GLOOK-58 Decision 11: trend colours follow the team, not its rank, so a team keeps its colour
// across syncs and when the page filter narrows the chart. Build the map from the UNFILTERED
// series. Spec Decision 11: at most 12 teams have alerts; beyond that, the 12 with the most open
// alerts (latest point, ties by name) get slots 1..12 in name order and the rest share "other".
// In that fallback a team entering or leaving the top 12 can shift other teams' slots.
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { toNum } from '@/components/charts/chart-format';

export const OTHER_TEAM_COLOR = 'var(--vuln-series-other)';
/** How many teams get a palette colour (the rest share "other"); the trend card's footnote prints it. */
export const TEAM_COLOR_SLOTS = 12;
const SLOTS = TEAM_COLOR_SLOTS;

/** The open count at a team's latest stored point (0 with no points): the one number colours and the legend both rank by. */
export const latestOpen = (s: TrendSeries): number => toNum(s.points[s.points.length - 1]?.open);

export function assignTeamColors(series: TrendSeries[]): Record<string, string> {
  const latest = new Map<string, number>();
  for (const s of series) latest.set(s.team, latestOpen(s));
  const byName = (a: string, b: string) => a.localeCompare(b);
  const chosen = [...latest.keys()]
    .sort((a, b) => (latest.get(b)! - latest.get(a)!) || byName(a, b))
    .slice(0, SLOTS)
    .sort(byName);
  const out: Record<string, string> = {};
  for (const team of latest.keys()) out[team] = OTHER_TEAM_COLOR;
  chosen.forEach((team, i) => { out[team] = `var(--vuln-series-${i + 1})`; });
  return out;
}
