import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { runReport, requestStop } from '@/lib/report-runner';
import { initProgress, updateProgress, getProgress } from '@/lib/progress-store';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ReportNotFoundError extends Error {
  constructor(id: string) {
    super(`Report not found: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export class ReportNotRunningError extends Error {
  constructor(id: string) {
    super(`Report is not running: ${id}`);
    this.name = 'ReportNotRunningError';
  }
}

export class ReportAlreadyCompletedError extends Error {
  constructor(id: string) {
    super(`Report already completed: ${id}`);
    this.name = 'ReportAlreadyCompletedError';
  }
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function listReports() {
  const [rows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at
     FROM reports
     ORDER BY created_at DESC
     LIMIT 20`,
  ) as [any[], any];
  return rows;
}

export async function createReport(input: {
  org: string;
  periodDays: number;
  testMode?: boolean;
}): Promise<string> {
  const { org, periodDays, testMode = false } = input;
  const id = uuidv4();

  await db.execute(
    `INSERT INTO reports (id, org, period_days, status) VALUES (?, ?, ?, 'pending')`,
    [id, org, periodDays],
  );

  initProgress(id);

  // Fire and forget — no await
  runReport(id, org, Number(periodDays), false, Boolean(testMode)).catch(console.error);

  return id;
}

export async function getReport(id: string) {
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, error, created_at, completed_at
     FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!reportRows.length) {
    throw new ReportNotFoundError(id);
  }

  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url,
            total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage, type_breakdown, active_repos
     FROM developer_stats
     WHERE report_id = ?
     ORDER BY impact_score DESC`,
    [id],
  ) as [any[], any];

  // SQLite stores JSON columns as TEXT — parse them back to objects
  const developers = devRows.map((row: any) => ({
    ...row,
    type_breakdown: typeof row.type_breakdown === 'string'
      ? JSON.parse(row.type_breakdown || '{}')
      : (row.type_breakdown || {}),
    active_repos: typeof row.active_repos === 'string'
      ? JSON.parse(row.active_repos || '[]')
      : (row.active_repos || []),
  }));

  return {
    report: reportRows[0],
    developers,
  };
}

export async function deleteReport(id: string): Promise<void> {
  // ON DELETE CASCADE handles developer_stats and commit_analyses
  const [result] = await db.execute(
    `DELETE FROM reports WHERE id = ?`,
    [id],
  ) as [any, any];

  if (result.affectedRows === 0) {
    throw new ReportNotFoundError(id);
  }
}

export async function getReportProgress(id: string) {
  const progress = getProgress(id);
  if (progress) {
    return progress;
  }

  // Fallback: reconstruct progress from DB
  const [rows] = await db.execute(
    `SELECT status, error FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!rows.length) {
    throw new ReportNotFoundError(id);
  }

  const report = rows[0] as { status: string; error: string | null };

  // If DB says running, count completed developers to show real progress
  if (report.status === 'running') {
    const [devRows] = await db.execute(
      `SELECT COUNT(*) as completed FROM developer_stats WHERE report_id = ?`,
      [id],
    ) as [any[], any];
    const completed = Number((devRows[0] as any)?.completed || 0);

    return {
      status:              'running' as const,
      step:                completed > 0 ? `Analyzing... (${completed} developers done from DB)` : 'Running...',
      totalRepos:          0,
      processedRepos:      0,
      totalDevelopers:     0,
      completedDevelopers: completed,
      logs:                [] as string[],
    };
  }

  return {
    status:              report.status,
    step:                report.status,
    totalRepos:          0,
    processedRepos:      0,
    totalDevelopers:     0,
    completedDevelopers: 0,
    error:               report.error || undefined,
    logs:                [] as string[],
  };
}

export async function stopReport(id: string): Promise<void> {
  const [rows] = await db.execute(
    `SELECT status FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!rows.length) {
    throw new ReportNotFoundError(id);
  }

  if (rows[0].status !== 'running') {
    throw new ReportNotRunningError(id);
  }

  requestStop(id);
  await db.execute(
    `UPDATE reports SET status = 'stopped', error = 'Stopped by user' WHERE id = ?`,
    [id],
  );
  updateProgress(id, { status: 'failed', step: 'Stopped by user', error: 'Stopped by user' });
}

export async function resumeReport(id: string): Promise<void> {
  const [rows] = await db.execute(
    `SELECT id, org, period_days, status FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!rows.length) {
    throw new ReportNotFoundError(id);
  }

  const report = rows[0];
  if (report.status === 'completed') {
    throw new ReportAlreadyCompletedError(id);
  }

  // Reset status
  await db.execute(
    `UPDATE reports SET status = 'running', error = NULL WHERE id = ?`,
    [id],
  );

  initProgress(id);

  // Fire and forget with resume flag
  runReport(id, report.org, report.period_days, true).catch(console.error);
}
