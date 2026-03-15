import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login');
  if (!login) {
    return NextResponse.json({ error: 'login is required' }, { status: 400 });
  }

  const [rows] = await db.execute(
    `SELECT commit_sha, repo, commit_message, type, complexity, risk_level,
            lines_added, lines_removed, committed_at
     FROM commit_analyses
     WHERE report_id = ? AND github_login = ?
     ORDER BY committed_at DESC`,
    [id, login],
  ) as [any[], any];

  return NextResponse.json(rows);
}
