import db, { type DB } from '@/lib/db';

/** Max keys / ids bound per statement. */
export const CANONICAL_BATCH = 500;

const COMPLETED = `(SELECT id FROM reports WHERE org = ? AND status = 'completed')`;

const COMMIT_COLS =
  'commit_sha, analysis_id, report_id, github_login, repo, committed_at, lines_added, lines_removed, ' +
  'complexity, type, ai_co_authored, ai_tool_name, maybe_ai, pr_number, pr_title, risk_level, ' +
  'commit_message, impact_summary';
const COMMIT_SRC =
  'commit_sha, id, report_id, github_login, repo, committed_at, lines_added, lines_removed, ' +
  'complexity, type, ai_co_authored, ai_tool_name, maybe_ai, pr_number, pr_title, risk_level, ' +
  'commit_message, impact_summary';

const JIRA_COLS =
  'issue_key, issue_id, report_id, github_login, project_key, issue_type, summary, description, status, ' +
  'labels, story_points, original_estimate_seconds, issue_url, created_at, resolved_at';
const JIRA_SRC =
  'issue_key, id, report_id, github_login, project_key, issue_type, summary, description, status, ' +
  'labels, story_points, original_estimate_seconds, issue_url, created_at, resolved_at';

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CANONICAL_BATCH) out.push(xs.slice(i, i + CANONICAL_BATCH));
  return out;
}

const marks = (n: number) => Array(n).fill('?').join(',');

function toMap(rows: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r.k), Number(r.id));
  return m;
}

// Prefer an analysed copy (highest id among them), else the highest id.
const commitPickSql = (keyFilter: string) =>
  `SELECT ca.commit_sha AS k,
          COALESCE(MAX(CASE WHEN ca.complexity IS NOT NULL THEN ca.id END), MAX(ca.id)) AS id
   FROM commit_analyses ca
   WHERE ca.report_id IN ${COMPLETED}${keyFilter}
   GROUP BY ca.commit_sha`;

const jiraPickSql = (keyFilter: string) =>
  `SELECT ji.issue_key AS k, MAX(ji.id) AS id
   FROM jira_issues ji
   WHERE ji.report_id IN ${COMPLETED}${keyFilter}
   GROUP BY ji.issue_key`;

export async function expectedCommitPicks(org: string, q: DB = db): Promise<Map<string, number>> {
  const [rows] = await q.execute<any>(commitPickSql(''), [org]);
  return toMap(rows);
}

export async function expectedJiraPicks(org: string, q: DB = db): Promise<Map<string, number>> {
  const [rows] = await q.execute<any>(jiraPickSql(''), [org]);
  return toMap(rows);
}

export async function insertCommitsByIds(tx: DB, org: string, ids: number[]): Promise<void> {
  for (const batch of chunks(ids)) {
    await tx.execute(
      `INSERT INTO commit_canonical (org, ${COMMIT_COLS})
       SELECT ?, ${COMMIT_SRC} FROM commit_analyses WHERE id IN (${marks(batch.length)})`,
      [org, ...batch],
    );
  }
}

export async function insertJiraByIds(tx: DB, org: string, ids: number[]): Promise<void> {
  for (const batch of chunks(ids)) {
    await tx.execute(
      `INSERT INTO jira_canonical (org, ${JIRA_COLS})
       SELECT ?, ${JIRA_SRC} FROM jira_issues WHERE id IN (${marks(batch.length)})`,
      [org, ...batch],
    );
  }
}

/** Delete the keys for the org, re-pick among its completed copies, insert the picks. */
export async function refreshCommitKeys(tx: DB, org: string, shas: string[]): Promise<void> {
  for (const batch of chunks(shas)) {
    const inList = marks(batch.length);
    await tx.execute(
      `DELETE FROM commit_canonical WHERE org = ? AND commit_sha IN (${inList})`,
      [org, ...batch],
    );
    const [rows] = await tx.execute<any>(
      commitPickSql(` AND ca.commit_sha IN (${inList})`),
      [org, ...batch],
    );
    await insertCommitsByIds(tx, org, [...toMap(rows).values()]);
  }
}

export async function refreshJiraKeys(tx: DB, org: string, keys: string[]): Promise<void> {
  for (const batch of chunks(keys)) {
    const inList = marks(batch.length);
    await tx.execute(
      `DELETE FROM jira_canonical WHERE org = ? AND issue_key IN (${inList})`,
      [org, ...batch],
    );
    const [rows] = await tx.execute<any>(
      jiraPickSql(` AND ji.issue_key IN (${inList})`),
      [org, ...batch],
    );
    await insertJiraByIds(tx, org, [...toMap(rows).values()]);
  }
}
