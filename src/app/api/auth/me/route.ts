import { NextResponse } from 'next/server';
import { extractUser, isAuthEnabled } from '@/lib/auth';
import db from '@/lib/db';

export async function GET(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  const user = extractUser(req.headers);
  if (!user) {
    return NextResponse.json({ enabled: true, user: null });
  }

  // Look up GitHub identity via jira_email
  const [identityRows] = await db.execute(
    `SELECT um.github_login, ds.github_name, ds.avatar_url
     FROM user_mappings um
     LEFT JOIN developer_stats ds ON ds.github_login = um.github_login
     LEFT JOIN reports r ON r.id = ds.report_id AND r.status = 'completed'
     WHERE um.jira_email = ?
     ORDER BY r.completed_at DESC
     LIMIT 1`,
    [user.email],
  ) as [any[], any];

  if (!identityRows.length) {
    return NextResponse.json({
      enabled: true,
      user: { email: user.email, githubLogin: null, name: null, avatarUrl: null, team: null },
    });
  }

  const identity = identityRows[0];

  // Look up team
  let team: { name: string; color: string } | null = null;
  if (identity.github_login) {
    const [teamRows] = await db.execute(
      `SELECT t.name AS team_name, t.color AS team_color
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.github_login = ?
       LIMIT 1`,
      [identity.github_login],
    ) as [any[], any];

    if (teamRows.length) {
      team = { name: teamRows[0].team_name, color: teamRows[0].team_color };
    }
  }

  return NextResponse.json({
    enabled: true,
    user: {
      email: user.email,
      githubLogin: identity.github_login || null,
      name: identity.github_name || null,
      avatarUrl: identity.avatar_url || null,
      team,
    },
  });
}
