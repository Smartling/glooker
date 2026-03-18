import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  const q = req.nextUrl.searchParams.get('q') || '';
  const source = req.nextUrl.searchParams.get('source'); // 'github' for fallback

  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  // Fallback: search GitHub org members
  if (source === 'github') {
    try {
      const { listOrgMembers } = await import('@/lib/github');
      const members = await listOrgMembers(org);
      const filtered = q
        ? members.filter((m: any) => m.login.toLowerCase().includes(q.toLowerCase()))
        : members;
      return NextResponse.json(
        filtered.slice(0, 20).map((m: any) => ({
          github_login: m.login,
          github_name: null,
          avatar_url: m.avatar_url || '',
        }))
      );
    } catch (err) {
      return NextResponse.json({ error: 'GitHub API error' }, { status: 500 });
    }
  }

  // Primary: pull from developer_stats (last 90 days), ordered by most recent report
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const [rows] = await db.execute(
    `SELECT ds.github_login, ds.github_name, ds.avatar_url, r.created_at
     FROM developer_stats ds
     JOIN reports r ON r.id = ds.report_id
     WHERE r.org = ? AND r.status = 'completed'
       AND r.created_at >= ?
     ORDER BY r.created_at DESC`,
    [org, cutoff],
  ) as [any[], any];

  // Deduplicate: keep the latest name/avatar per login
  const seen = new Map<string, any>();
  for (const row of rows) {
    if (!seen.has(row.github_login)) {
      seen.set(row.github_login, {
        github_login: row.github_login,
        github_name: row.github_name || null,
        avatar_url: row.avatar_url || null,
      });
    }
  }

  let devs = [...seen.values()];

  // Filter by query
  if (q) {
    const lower = q.toLowerCase();
    devs = devs.filter(d =>
      d.github_login.toLowerCase().includes(lower) ||
      (d.github_name || '').toLowerCase().includes(lower)
    );
  }

  const limit = Number(req.nextUrl.searchParams.get('limit')) || 0;
  return NextResponse.json(limit > 0 ? devs.slice(0, limit) : devs);
}
