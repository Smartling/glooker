import { NextResponse } from 'next/server';
import { isAuthEnabled, extractUser } from '@/lib/auth';
import { resolveRequester } from '@/lib/cost-visibility';
import db from '@/lib/db';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  const requester = await resolveRequester(req.headers);
  // A null githubLogin with no admin still means "authenticated but unmapped".
  const user = extractUser(req.headers);
  if (!user) {
    return NextResponse.json({ enabled: true, user: null });
  }

  const role = requester.isAdmin ? 'admin' : 'viewer';

  // Name/avatar for display (unchanged query, keyed off the resolved login).
  let name: string | null = user.name || null;
  let avatarUrl: string | null = null;
  let team: { name: string; color: string } | null = null;

  if (requester.githubLogin) {
    const [displayRows] = await db.execute(
      `SELECT ds.github_name, ds.avatar_url
       FROM developer_stats ds
       LEFT JOIN reports r ON r.id = ds.report_id AND r.status = 'completed'
       WHERE ds.github_login = ?
       ORDER BY r.completed_at DESC
       LIMIT 1`,
      [requester.githubLogin],
    ) as [any[], any];
    if (displayRows.length) {
      name = user.name || displayRows[0].github_name || null;
      avatarUrl = displayRows[0].avatar_url || null;
    }

    const [teamRows] = await db.execute(
      `SELECT t.name AS team_name, t.color AS team_color
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.github_login = ? LIMIT 1`,
      [requester.githubLogin],
    ) as [any[], any];
    if (teamRows.length) team = { name: teamRows[0].team_name, color: teamRows[0].team_color };
  }

  return NextResponse.json({
    enabled: true,
    user: { email: user.email, githubLogin: requester.githubLogin, name, avatarUrl, team, role },
  });
}

export const GET = withRequestLog(getHandler);
