import db from '@/lib/db';

export interface MemberWindowData {
  current: { commits: number; prs: number; linesAdded: number; linesRemoved: number; jiraIssues: number; storyPoints: number };
  prior: { commits: number; prs: number; linesAdded: number; linesRemoved: number; jiraIssues: number; storyPoints: number };
  currentRepos: string[];
  currentTypes: string[];
  totalReviews: number;
}

export interface InflightOpenPrs {
  total: number;
  draft: number;
  ready: number;
  by_author: { login: string; count: number }[];   // top 5 desc
  by_repo:   { repo: string;  count: number }[];   // top 3 desc
  oldest_days: number;        // max(now - updated_at) across open PRs; 0 if none
  lines_added: number;
  lines_removed: number;
}

export interface InflightBranches {
  total_branches: number;
  total_commits: number;
}

export interface Inflight {
  open_prs: InflightOpenPrs;
  unmerged_branches: InflightBranches;
}

const EMPTY_INFLIGHT: Inflight = {
  open_prs: {
    total: 0, draft: 0, ready: 0,
    by_author: [], by_repo: [],
    oldest_days: 0, lines_added: 0, lines_removed: 0,
  },
  unmerged_branches: { total_branches: 0, total_commits: 0 },
};

interface InflightPrRow {
  github_login: string;
  repo: string;
  is_draft: 0 | 1 | boolean | null;
  pr_additions: number | null;
  pr_deletions: number | null;
  pr_updated_at: string | Date | null;
}

interface InflightCommitRow {
  github_login: string;
  repo: string;
  branch: string | null;
}

export function aggregateInflight(
  prRows: InflightPrRow[],
  commitRows: InflightCommitRow[],
  now: Date,
): Inflight {
  if (prRows.length === 0 && commitRows.length === 0) return EMPTY_INFLIGHT;

  let draft = 0;
  let ready = 0;
  let lines_added = 0;
  let lines_removed = 0;
  let oldest_ms = 0;
  const prByAuthor = new Map<string, number>();
  const prByRepo   = new Map<string, number>();

  for (const r of prRows) {
    if (r.is_draft === true || r.is_draft === 1) draft++;
    else ready++;
    lines_added   += Number(r.pr_additions ?? 0);
    lines_removed += Number(r.pr_deletions ?? 0);
    if (r.pr_updated_at) {
      const t = new Date(r.pr_updated_at).getTime();
      const age = now.getTime() - t;
      if (age > oldest_ms) oldest_ms = age;
    }
    prByAuthor.set(r.github_login, (prByAuthor.get(r.github_login) ?? 0) + 1);
    prByRepo.set(r.repo, (prByRepo.get(r.repo) ?? 0) + 1);
  }

  const oldest_days = oldest_ms > 0 ? Math.floor(oldest_ms / 86_400_000) : 0;

  const sortDesc = <T extends { count: number }>(items: T[], tieKey: (x: T) => string) =>
    items.sort((a, b) => b.count - a.count || tieKey(a).localeCompare(tieKey(b)));

  const by_author = sortDesc(
    [...prByAuthor].map(([login, count]) => ({ login, count })),
    x => x.login,
  ).slice(0, 5);

  const by_repo = sortDesc(
    [...prByRepo].map(([repo, count]) => ({ repo, count })),
    x => x.repo,
  ).slice(0, 3);

  const branchKeys = new Set<string>();
  for (const c of commitRows) branchKeys.add(`${c.repo} ${c.branch ?? ''}`);

  return {
    open_prs: {
      total: prRows.length,
      draft, ready,
      by_author, by_repo,
      oldest_days, lines_added, lines_removed,
    },
    unmerged_branches: {
      total_branches: branchKeys.size,
      total_commits: commitRows.length,
    },
  };
}

export interface TeamPulseData {
  teamName: string;
  members: Map<string, MemberWindowData>;
  currentDays: string[];
  priorDays: string[];
  teamAvgCommits: number;
  teamAvgPrs: number;
  activeCount: number;
  totalCount: number;
  trendingPct: number;
  trendDirection: 'up' | 'down' | 'stable';
  inflight: Inflight;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getWorkingDays(endDate: Date, count: number): string[] {
  const days: string[] = [];
  const d = new Date(endDate);
  while (days.length < count) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(formatLocalDate(d));
    }
  }
  return days.reverse();
}

export async function extractTeamPulseData(
  reportId: string,
  teamMembers: string[],
  reportEndDate: Date,
): Promise<TeamPulseData> {
  const allDays = getWorkingDays(reportEndDate, 4);
  const priorDays = allDays.slice(0, 2);
  const currentDays = allDays.slice(2, 4);
  const memberPlaceholders = teamMembers.map(() => '?').join(',');
  const dayPlaceholders = allDays.map(() => '?').join(',');

  const [commitRows] = await db.execute(
    `SELECT github_login, DATE(committed_at) as day,
      COUNT(*) as commits,
      COUNT(DISTINCT pr_number) as prs,
      SUM(lines_added) as lines_added,
      SUM(lines_removed) as lines_removed,
      ROUND(AVG(complexity), 1) as avg_complexity,
      GROUP_CONCAT(DISTINCT type ORDER BY type) as types,
      GROUP_CONCAT(DISTINCT repo ORDER BY repo) as repos
    FROM commit_analyses
    WHERE report_id = ? AND github_login IN (${memberPlaceholders}) AND DATE(committed_at) IN (${dayPlaceholders})
    GROUP BY github_login, DATE(committed_at)`,
    [reportId, ...teamMembers, ...allDays],
  ) as [any[], any];

  const [jiraRows] = await db.execute(
    `SELECT github_login, DATE(resolved_at) as day, COUNT(*) as issues,
      COALESCE(SUM(story_points), 0) as story_points
    FROM jira_issues
    WHERE report_id = ? AND github_login IN (${memberPlaceholders}) AND DATE(resolved_at) IN (${dayPlaceholders})
    GROUP BY github_login, DATE(resolved_at)`,
    [reportId, ...teamMembers, ...allDays],
  ) as [any[], any];

  const [reviewRows] = await db.execute(
    `SELECT github_login, total_reviews
    FROM developer_stats
    WHERE report_id = ? AND github_login IN (${memberPlaceholders})`,
    [reportId, ...teamMembers],
  ) as [any[], any];

  const reviewMap = new Map<string, number>();
  for (const r of reviewRows) reviewMap.set(r.github_login, Number(r.total_reviews) || 0);

  const commitByMemberDay = new Map<string, Map<string, any>>();
  for (const row of commitRows) {
    if (!commitByMemberDay.has(row.github_login)) commitByMemberDay.set(row.github_login, new Map());
    // MySQL returns DATE() as a Date object; convert to YYYY-MM-DD string for map lookup
    const dayStr = row.day instanceof Date ? formatLocalDate(row.day) : String(row.day).split('T')[0];
    commitByMemberDay.get(row.github_login)!.set(dayStr, row);
  }

  const jiraByMemberDay = new Map<string, Map<string, any>>();
  for (const row of jiraRows) {
    if (!jiraByMemberDay.has(row.github_login)) jiraByMemberDay.set(row.github_login, new Map());
    const dayStr = row.day instanceof Date ? formatLocalDate(row.day) : String(row.day).split('T')[0];
    jiraByMemberDay.get(row.github_login)!.set(dayStr, row);
  }

  const members = new Map<string, MemberWindowData>();
  for (const login of teamMembers) {
    const current = { commits: 0, prs: 0, linesAdded: 0, linesRemoved: 0, jiraIssues: 0, storyPoints: 0 };
    const prior = { commits: 0, prs: 0, linesAdded: 0, linesRemoved: 0, jiraIssues: 0, storyPoints: 0 };
    const reposSet = new Set<string>();
    const typesSet = new Set<string>();

    for (const day of currentDays) {
      const c = commitByMemberDay.get(login)?.get(day);
      if (c) {
        current.commits += Number(c.commits);
        current.prs += Number(c.prs);
        current.linesAdded += Number(c.lines_added);
        current.linesRemoved += Number(c.lines_removed);
        if (c.repos) c.repos.split(',').forEach((r: string) => reposSet.add(r));
        if (c.types) c.types.split(',').forEach((t: string) => typesSet.add(t));
      }
      const j = jiraByMemberDay.get(login)?.get(day);
      if (j) { current.jiraIssues += Number(j.issues); current.storyPoints += Number(j.story_points); }
    }

    for (const day of priorDays) {
      const c = commitByMemberDay.get(login)?.get(day);
      if (c) {
        prior.commits += Number(c.commits);
        prior.prs += Number(c.prs);
        prior.linesAdded += Number(c.lines_added);
        prior.linesRemoved += Number(c.lines_removed);
      }
      const j = jiraByMemberDay.get(login)?.get(day);
      if (j) { prior.jiraIssues += Number(j.issues); prior.storyPoints += Number(j.story_points); }
    }

    members.set(login, { current, prior, currentRepos: [...reposSet], currentTypes: [...typesSet], totalReviews: reviewMap.get(login) || 0 });
  }

  const activeMembers = [...members.entries()].filter(([, m]) => m.current.commits > 0);
  const activeCount = activeMembers.length;
  const totalCount = teamMembers.length;
  const teamAvgCommits = activeCount > 0 ? Math.round(activeMembers.reduce((s, [, m]) => s + m.current.commits, 0) / activeCount * 10) / 10 : 0;
  const teamAvgPrs = activeCount > 0 ? Math.round(activeMembers.reduce((s, [, m]) => s + m.current.prs, 0) / activeCount * 10) / 10 : 0;
  const totalCurrentCommits = [...members.values()].reduce((s, m) => s + m.current.commits, 0);
  const totalPriorCommits = [...members.values()].reduce((s, m) => s + m.prior.commits, 0);
  const trendingPct = totalPriorCommits > 0 ? Math.round(((totalCurrentCommits - totalPriorCommits) / totalPriorCommits) * 100) : totalCurrentCommits > 0 ? 100 : 0;
  const trendDirection: 'up' | 'down' | 'stable' = trendingPct > 5 ? 'up' : trendingPct < -5 ? 'down' : 'stable';

  return { teamName: '', members, currentDays, priorDays, teamAvgCommits, teamAvgPrs, activeCount, totalCount, trendingPct, trendDirection, inflight: EMPTY_INFLIGHT };
}
