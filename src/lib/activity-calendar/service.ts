import db from '@/lib/db';
import { CALENDAR_DAYS, teamThresholds, type CalendarMetric, type CalendarResult, type CalendarRow } from './metrics';

export { METRICS, type CalendarMetric } from './metrics';

/**
 * Per-engineer daily activity for the last 12 months, drawn as GitHub-style calendars (admins see
 * every team, developers their own; see access.ts). Reads only the canonical tables (one row per
 * commit sha / issue key) and pr_activity, so a commit or issue that appears in several reports is
 * counted once. Days are UTC whatever the MySQL session time zone is: TIMESTAMP columns are
 * bucketed by their epoch seconds, and pr_activity.merged_at is already a UTC ISO string.
 * Logins are matched case-insensitively, the same as access.ts.
 */

const isMySQL = () => process.env.DB_TYPE === 'mysql';

/** UTC day of a TIMESTAMP column, as a day number since 1970-01-01 (converted to 'YYYY-MM-DD' below). */
const dayNumber = (col: string) => isMySQL()
  ? `FLOOR(UNIX_TIMESTAMP(${col}) / 86400)`
  : `CAST(strftime('%s', ${col}) / 86400 AS INTEGER)`;
/** [start, end) bounds on a TIMESTAMP column. On MySQL the bounds are epoch seconds, so the comparison
 *  happens in the session zone on both sides and stays index-friendly. */
const timestampRange = (col: string) => isMySQL()
  ? `${col} >= FROM_UNIXTIME(?) AND ${col} < FROM_UNIXTIME(?)`
  : `${col} >= ? AND ${col} < ?`;

type Query = { sql: (inList: string) => string; dayIsNumber: boolean };

function timestampQuery(table: string, col: string, value: string): Query {
  return {
    dayIsNumber: true,
    sql: (l) => `SELECT LOWER(github_login) AS login, ${dayNumber(col)} AS day, ${value} AS value
      FROM ${table} WHERE org = ? AND LOWER(github_login) IN (${l}) AND ${timestampRange(col)}
      GROUP BY LOWER(github_login), ${dayNumber(col)}`,
  };
}

// pr_activity has no review timestamp, so reviews are dated by the PR's merge day (the label says so).
function prQuery(kind: 'authored' | 'reviewed'): Query {
  return {
    dayIsNumber: false,
    sql: (l) => `SELECT LOWER(github_login) AS login, SUBSTR(merged_at, 1, 10) AS day, COUNT(*) AS value
      FROM pr_activity WHERE org = ? AND kind = '${kind}' AND LOWER(github_login) IN (${l})
        AND merged_at >= ? AND merged_at < ?
      GROUP BY LOWER(github_login), SUBSTR(merged_at, 1, 10)`,
  };
}

const QUERIES: Record<CalendarMetric, Query> = {
  commits: timestampQuery('commit_canonical', 'committed_at', 'COUNT(*)'),
  lines: timestampQuery('commit_canonical', 'committed_at', 'SUM(lines_added + lines_removed)'),
  jira: timestampQuery('jira_canonical', 'resolved_at', 'COUNT(*)'),
  story_points: timestampQuery('jira_canonical', 'resolved_at', 'SUM(COALESCE(story_points, 0))'),
  prs: prQuery('authored'),
  reviews: prQuery('reviewed'),
};

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function getTeamCalendar(
  org: string, logins: string[], metric: CalendarMetric, now: Date = new Date(),
): Promise<CalendarResult> {
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDate = new Date(endDate.getTime() - (CALENDAR_DAYS - 1) * DAY_MS);
  const afterEnd = new Date(endDate.getTime() + DAY_MS); // exclusive upper bound, so totals match the grid
  const start = isoDay(startDate);
  // Keyed by lowercased login; the row keeps the login as the team stores it.
  const rows = new Map<string, CalendarRow>(logins.map((login) => [login.toLowerCase(), { login, name: '', avatarUrl: '', total: 0, days: {} }]));
  const keys = [...rows.keys()];

  if (keys.length) {
    const inList = keys.map(() => '?').join(',');
    // Name and avatar from the member's latest report in this org within the calendar window (bounded
    // so the scan doesn't grow with report history). The avatar must be the stored
    // avatars.githubusercontent.com URL: github.com/<login>.png redirects off-host and the CSP blocks it.
    const [people] = await db.execute<any>(
      `SELECT ds.github_login, ds.github_name, ds.avatar_url, r.created_at
       FROM developer_stats ds JOIN reports r ON r.id = ds.report_id
       WHERE r.org = ? AND r.created_at >= ? AND LOWER(ds.github_login) IN (${inList})`,
      [org, `${start} 00:00:00`, ...keys],
    );
    const latest = new Map<string, number>();
    for (const p of people) {
      const row = rows.get(String(p.github_login).toLowerCase());
      const at = new Date(p.created_at).getTime() || 0;
      if (!row || at < (latest.get(row.login) ?? -1)) continue;
      latest.set(row.login, at);
      row.name = p.github_name || '';
      row.avatarUrl = p.avatar_url || '';
    }

    const query = QUERIES[metric];
    const bounds = !query.dayIsNumber ? [start, isoDay(afterEnd)]
      : isMySQL() ? [startDate.getTime() / 1000, afterEnd.getTime() / 1000]
      : [`${start} 00:00:00`, `${isoDay(afterEnd)} 00:00:00`];
    const [found] = await db.execute<any>(query.sql(inList), [org, ...keys, ...bounds]);
    for (const r of found) {
      const row = rows.get(String(r.login).toLowerCase());
      const value = Number(r.value);
      if (!row || r.day == null || !(value > 0)) continue;
      const day = query.dayIsNumber ? isoDay(new Date(Number(r.day) * DAY_MS)) : String(r.day);
      row.days[day] = (row.days[day] ?? 0) + value;
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
