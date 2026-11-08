import db from '@/lib/db';
import { isCanonicalBuilt } from './state';
import { refreshCommitKeys, refreshJiraKeys } from './pick';

async function orgOf(tx: typeof db, reportId: string): Promise<string | null> {
  const [rows] = await tx.execute<any>(`SELECT org FROM reports WHERE id = ?`, [reportId]);
  return rows.length ? String(rows[0].org) : null;
}

/**
 * Mark a report completed and, if its org's canonical tables are built, refresh every key it
 * holds. One transaction: an upkeep failure fails the completion (the runner marks the report failed).
 */
export async function completeReport(reportId: string, runMetadataJson: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE reports SET status = 'completed', run_metadata = ?, completed_at = NOW() WHERE id = ?`,
      [runMetadataJson, reportId],
    );
    const org = await orgOf(tx as any, reportId);
    if (!org || !(await isCanonicalBuilt(org))) return;
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
  return db.transaction(async (tx) => {
    const org = await orgOf(tx as any, id);
    let shas: string[] = [];
    let keys: string[] = [];
    const built = org !== null && (await isCanonicalBuilt(org));
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
