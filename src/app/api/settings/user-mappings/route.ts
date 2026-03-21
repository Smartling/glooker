import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getJiraClient } from '@/lib/jira';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org required' }, { status: 400 });

  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE org = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [org],
  ) as [any[], any];

  if (!reportRows.length) return NextResponse.json([]);

  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url FROM developer_stats WHERE report_id = ?`,
    [reportRows[0].id],
  ) as [any[], any];

  const [mappingRows] = await db.execute(
    `SELECT github_login, jira_account_id, jira_email FROM user_mappings WHERE org = ?`,
    [org],
  ) as [any[], any];

  const mappingsByLogin = new Map(
    mappingRows.map((r: any) => [r.github_login, { jira_account_id: r.jira_account_id, jira_email: r.jira_email }]),
  );

  const result = devRows.map((dev: any) => ({
    github_login: dev.github_login,
    github_name: dev.github_name,
    avatar_url: dev.avatar_url,
    jira_account_id: mappingsByLogin.get(dev.github_login)?.jira_account_id || null,
    jira_email: mappingsByLogin.get(dev.github_login)?.jira_email || null,
    mapped: mappingsByLogin.has(dev.github_login),
  }));

  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  const { org, github_login, jira_email } = await req.json();
  if (!org || !github_login) {
    return NextResponse.json({ error: 'org and github_login required' }, { status: 400 });
  }

  if (!jira_email) {
    await db.execute(`DELETE FROM user_mappings WHERE org = ? AND github_login = ?`, [org, github_login]);
    return NextResponse.json({ success: true, cleared: true });
  }

  const client = getJiraClient();
  if (!client) return NextResponse.json({ error: 'Jira not configured' }, { status: 400 });

  const user = await client.findUserByEmail(jira_email);
  if (!user) return NextResponse.json({ error: `No Jira user found for: ${jira_email}` }, { status: 404 });

  await db.execute(
    `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email, created_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE jira_account_id = VALUES(jira_account_id), jira_email = VALUES(jira_email)`,
    [org, github_login, user.accountId, jira_email],
  );

  return NextResponse.json({
    success: true,
    jira_account_id: user.accountId,
    jira_display_name: user.displayName,
    jira_email,
  });
}
