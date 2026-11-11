import db from '@/lib/db';
import { CALENDAR_DAYS, teamThresholds, type CalendarMetric, type CalendarResult, type CalendarRow } from './metrics';

export { METRICS, type CalendarMetric } from './metrics';

/**
 * Admin POC: per-engineer daily activity for the last 12 months, drawn as GitHub-style calendars.
 * Reads only the canonical tables (one row per commit sha / issue key) and pr_activity, so a
 * commit or issue that appears in several reports is counted once. Days are UTC.
 */

/** Each query returns (github_login, day 'YYYY-MM-DD', value) for logins IN (...) since a date. */
const QUERIES: Record<CalendarMetric, (inList: string) => string> = {
  commits: (l) => `SELECT github_login, SUBSTR(committed_at, 1, 10) AS day, COUNT(*) AS value
    FROM commit_canonical WHERE org = ? AND github_login IN (${l}) AND committed_at >= ?
    GROUP BY github_login, SUBSTR(committed_at, 1, 10)`,
  lines: (l) => `SELECT github_login, SUBSTR(committed_at, 1, 10) AS day, SUM(lines_added + lines_removed) AS value
    FROM commit_canonical WHERE org = ? AND github_login IN (${l}) AND committed_at >= ?
    GROUP BY github_login, SUBSTR(committed_at, 1, 10)`,
  jira: (l) => `SELECT github_login, SUBSTR(resolved_at, 1, 10) AS day, COUNT(*) AS value
    FROM jira_canonical WHERE org = ? AND github_login IN (${l}) AND resolved_at >= ?
    GROUP BY github_login, SUBSTR(resolved_at, 1, 10)`,
  story_points: (l) => `SELECT github_login, SUBSTR(resolved_at, 1, 10) AS day, SUM(COALESCE(story_points, 0)) AS value
    FROM jira_canonical WHERE org = ? AND github_login IN (${l}) AND resolved_at >= ?
    GROUP BY github_login, SUBSTR(resolved_at, 1, 10)`,
  prs: (l) => prQuery('authored', l),
  reviews: (l) => prQuery('reviewed', l),
};

function prQuery(kind: 'authored' | 'reviewed', l: string): string {
  return `SELECT github_login, SUBSTR(merged_at, 1, 10) AS day, COUNT(*) AS value
    FROM pr_activity WHERE org = ? AND kind = '${kind}' AND github_login IN (${l}) AND merged_at >= ?
    GROUP BY github_login, SUBSTR(merged_at, 1, 10)`;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function getTeamCalendar(
  org: string, logins: string[], metric: CalendarMetric, now: Date = new Date(),
): Promise<CalendarResult> {
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDate = new Date(endDate.getTime() - (CALENDAR_DAYS - 1) * 86_400_000);
  const start = isoDay(startDate);
  const rows = new Map<string, CalendarRow>(logins.map((login) => [login, { login, total: 0, days: {} }]));

  if (logins.length) {
    const [found] = await db.execute<any>(
      QUERIES[metric](logins.map(() => '?').join(',')),
      [org, ...logins, `${start} 00:00:00`],
    );
    for (const r of found) {
      const row = rows.get(String(r.github_login));
      const value = Number(r.value);
      if (!row || !r.day || !(value > 0)) continue;
      row.days[String(r.day)] = value;
      row.total += value;
    }
  }

  const all = [...rows.values()];
  return {
    metric, start, end: isoDay(endDate),
    thresholds: teamThresholds(all.flatMap((r) => Object.values(r.days))),
    rows: all.sort((a, b) => b.total - a.total || a.login.localeCompare(b.login)),
  };
}
