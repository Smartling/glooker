import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login');

  const conditions = ['report_id = ?'];
  const values: any[] = [id];

  if (login) {
    conditions.push('github_login = ?');
    values.push(login);
  }

  const [rows] = await db.execute(
    `SELECT issue_key, project_key, issue_type, summary, description,
            status, labels, story_points, original_estimate_seconds,
            issue_url, created_at, resolved_at
     FROM jira_issues
     WHERE ${conditions.join(' AND ')}
     ORDER BY resolved_at DESC`,
    values,
  ) as [any[], any];

  const issues = rows.map((r: any) => ({
    ...r,
    labels: typeof r.labels === 'string' ? JSON.parse(r.labels || '[]') : (r.labels || []),
    story_points: r.story_points != null ? Number(r.story_points) : null,
  }));

  return NextResponse.json(issues);
}
