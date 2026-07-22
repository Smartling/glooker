import db from '@/lib/db';

/** Resolve a report id: validate an explicit id, or fall back to the latest completed report. */
export async function resolveReportId(reportId?: string): Promise<{ id: string } | { error: string }> {
  if (reportId) {
    const [rows] = await db.execute(
      `SELECT id FROM reports WHERE id = ?`, [reportId],
    ) as [any[], any];
    if (!rows.length) return { error: `report not found: ${reportId}` };
    return { id: rows[0].id };
  }
  const [rows] = await db.execute(
    `SELECT id FROM reports WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [],
  ) as [any[], any];
  if (!rows.length) return { error: 'no completed reports' };
  return { id: rows[0].id };
}
