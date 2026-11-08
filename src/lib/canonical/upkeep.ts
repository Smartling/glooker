import db from '@/lib/db';
import { refreshCommitKeys, refreshJiraKeys } from './pick';

/** Org lookup on the pool, outside any transaction, so it never takes a snapshot. */
async function orgOf(reportId: string): Promise<string | null> {
  const [rows] = await db.execute<any>(`SELECT org FROM reports WHERE id = ?`, [reportId]);
  return rows.length ? String(rows[0].org) : null;
}

/**
 * Serialise upkeep per org. This MUST be the first statement in the transaction: under MySQL's
 * REPEATABLE READ the read view is created at the first consistent read, so taking the row lock
 * first means the later pick SELECT sees everything committed before the lock was granted. A
 * second completion/deletion (or a rebuild, which rewrites the same canonical_builds row) waits
 * here instead of re-inserting a stale pick from an old snapshot. Returns whether the org is built.
 */
async function lockBuild(tx: any, org: string | null): Promise<boolean> {
  if (!org) return false;
  const [rows] = await tx.execute(`SELECT org FROM canonical_builds WHERE org = ? FOR UPDATE`, [org]);
  return rows.length > 0;
}

/**
 * Mark a report completed and, if its org's canonical tables are built, refresh every key it
 * holds. One transaction: an upkeep failure fails the completion (the runner marks the report failed).
 */
export async function completeReport(reportId: string, runMetadataJson: string): Promise<void> {
  const org = await orgOf(reportId);
  await db.transaction(async (tx) => {
    const built = await lockBuild(tx, org);
    await tx.execute(
      `UPDATE reports SET status = 'completed', run_metadata = ?, completed_at = NOW() WHERE id = ?`,
      [runMetadataJson, reportId],
    );
    if (!built || !org) return;
    const [shaRows] = await tx.execute<any>(
      `SELECT DISTINCT commit_sha FROM commit_analyses WHERE report_id = ?`, [reportId]);
    const [keyRows] = await tx.execute<any>(
      `SELECT DISTINCT issue_key FROM jira_issues WHERE report_id = ?`, [reportId]);
    await refreshCommitKeys(tx, org, shaRows.map((r: any) => String(r.commit_sha)));
    await refreshJiraKeys(tx, org, keyRows.map((r: any) => String(r.issue_key)));
  });
}

/** Delete a report (cascading to its rows) and re-pick the keys it was canonical for. */
export async function deleteReportWithUpkeep(id: string): Promise<number> {
  const org = await orgOf(id);
  return db.transaction(async (tx) => {
    const built = await lockBuild(tx, org);
    let shas: string[] = [];
    let keys: string[] = [];
    if (built) {
      const [s] = await tx.execute<any>(`SELECT commit_sha FROM commit_canonical WHERE report_id = ?`, [id]);
      const [k] = await tx.execute<any>(`SELECT issue_key FROM jira_canonical WHERE report_id = ?`, [id]);
      shas = s.map((r: any) => String(r.commit_sha));
      keys = k.map((r: any) => String(r.issue_key));
    }
    const [result] = (await tx.execute(`DELETE FROM reports WHERE id = ?`, [id])) as [any, any];
    if (built && org) {
      await refreshCommitKeys(tx, org, shas);
      await refreshJiraKeys(tx, org, keys);
    }
    return Number(result.affectedRows);
  });
}
