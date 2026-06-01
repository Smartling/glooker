import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin, extractUser } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const [rows] = await db.execute(
    `SELECT github_login, reason, added_by, added_at FROM report_skip_allowlist ORDER BY added_at ASC`,
  ) as [any[], any];

  // Compute auto-flagged candidates from the last 5 completed reports.
  const [recentRows] = await db.execute(
    `SELECT run_metadata FROM reports
      WHERE status = 'completed' AND run_metadata IS NOT NULL
      ORDER BY completed_at DESC LIMIT 5`,
  ) as [any[], any];

  const counts = new Map<string, number>();
  for (const r of recentRows) {
    let parsed: any = null;
    try {
      parsed = typeof r.run_metadata === 'string' ? JSON.parse(r.run_metadata) : r.run_metadata;
    } catch {
      continue;
    }
    const skipped: Array<{ login?: unknown }> = Array.isArray(parsed?.skipped) ? parsed.skipped : [];
    for (const s of skipped) {
      if (typeof s?.login === 'string') counts.set(s.login, (counts.get(s.login) ?? 0) + 1);
    }
  }
  const onAllowlist = new Set(rows.map((r: any) => r.github_login));
  const autoFlaggedCandidates = [...counts.entries()]
    .filter(([login, n]) => n >= 4 && !onAllowlist.has(login))
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
