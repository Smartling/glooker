import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin, extractUser } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { loadRecentSkipCounts, AUTO_FLAG_THRESHOLD } from '@/lib/report-runner/skip-classifier';

async function getHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const [rows] = await db.execute(
    `SELECT github_login, reason, added_by, added_at FROM report_skip_allowlist ORDER BY added_at ASC`,
  ) as [any[], any];

  // Compute auto-flagged candidates from the last 5 completed reports (shared helper).
  const counts = await loadRecentSkipCounts();
  const onAllowlist = new Set(rows.map((r: any) => r.github_login));
  const autoFlaggedCandidates = [...counts.entries()]
    .filter(([login, n]) => n >= AUTO_FLAG_THRESHOLD && !onAllowlist.has(login))
    .map(([login]) => login);

  return NextResponse.json({ entries: rows, autoFlaggedCandidates });
}

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { github_login, reason } = await req.json();
  const normalizedLogin = typeof github_login === 'string' ? github_login.trim() : '';
  if (!normalizedLogin) {
    return NextResponse.json({ error: 'github_login required' }, { status: 400 });
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'reason required' }, { status: 400 });
  }

  // Identity comes from the OIDC JWT in x-amzn-oidc-data, parsed by extractUser().
  const addedBy = extractUser(req.headers)?.email ?? null;

  await db.execute(
    `INSERT INTO report_skip_allowlist (github_login, reason, added_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by = VALUES(added_by), added_at = CURRENT_TIMESTAMP`,
    [normalizedLogin, reason, addedBy],
  );

  return NextResponse.json({ ok: true });
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
