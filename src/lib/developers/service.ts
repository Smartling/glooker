import db from '../db/index';

export interface ListDevelopersOpts {
  query?: string;
  limit?: number;
}

export async function listDevelopers(org: string, opts: ListDevelopersOpts = {}) {
  const { query, limit } = opts;
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

  if (query) {
    const lower = query.toLowerCase();
    devs = devs.filter(d =>
      d.github_login.toLowerCase().includes(lower) ||
      (d.github_name || '').toLowerCase().includes(lower)
    );
  }

  return limit && limit > 0 ? devs.slice(0, limit) : devs;
}

export async function listDevelopersFromGitHub(org: string, query?: string) {
  const { listOrgMembers } = await import('../github');
  const members = await listOrgMembers(org);
  const filtered = query
    ? members.filter((m: any) => m.login.toLowerCase().includes(query.toLowerCase()))
    : members;
  return filtered.slice(0, 20).map((m: any) => ({
    github_login: m.login,
    github_name: null,
    avatar_url: m.avatar_url || '',
  }));
}
