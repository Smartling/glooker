import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db';

export interface EpicRingStats {
  epicKey: string;
  totalJiras: number;
  resolvedJiras: number;
  remainingJiras: number;
  commitCount: number;
  devCount: number;
  linesAdded: number;
  linesRemoved: number;
  repos: string[];
  cached: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getEpicRingStats(epicKey: string, org: string): Promise<EpicRingStats> {
  // 1. Check epic_stats cache
  const [rows] = await db.execute(
    `SELECT total_jiras, resolved_jiras, remaining_jiras, commit_count, dev_count,
            lines_added, lines_removed, repos, generated_at
     FROM epic_stats WHERE epic_key = ? AND org = ?`,
    [epicKey, org],
  ) as [any[], any];

  if (rows.length > 0) {
    const row = rows[0];
    const generatedAt = new Date(row.generated_at);
    if (Date.now() - generatedAt.getTime() <= CACHE_TTL_MS) {
      return {
        epicKey,
        totalJiras: Number(row.total_jiras),
        resolvedJiras: Number(row.resolved_jiras),
        remainingJiras: Number(row.remaining_jiras),
        commitCount: Number(row.commit_count),
        devCount: Number(row.dev_count),
        linesAdded: Number(row.lines_added),
        linesRemoved: Number(row.lines_removed),
        repos: row.repos ? (typeof row.repos === 'string' ? JSON.parse(row.repos) : row.repos) : [],
        cached: true,
      };
    }
  }

  // 2. Cache miss: fetch Jira child issues
  const client = getJiraClient();
  if (!client) throw new Error('Jira is not configured');

  const children = await client.searchChildIssues(epicKey);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const resolved = children.filter(
    c => c.statusCategory === 'Done' && c.resolvedAt && c.resolvedAt.slice(0, 10) >= cutoffStr,
  );
  const remaining = children.filter(c => c.statusCategory !== 'Done');
  const allKeys = children.map(c => c.key);
  const assigneeEmails = [...new Set(
    children.map(c => c.assigneeEmail).filter((e): e is string => e !== null),
  )];

  // 3. Two-phase commit query (counts only, no full details)
  const stats = await getCommitCounts(epicKey, allKeys, assigneeEmails, org);

  const result: EpicRingStats = {
    epicKey,
    totalJiras: children.length,
    resolvedJiras: resolved.length,
    remainingJiras: remaining.length,
    commitCount: stats.commitCount,
    devCount: stats.devCount,
    linesAdded: stats.linesAdded,
    linesRemoved: stats.linesRemoved,
    repos: stats.repos,
    cached: false,
  };

  // 4. Upsert into epic_stats
  await db.execute(
    `INSERT INTO epic_stats (epic_key, org, total_jiras, resolved_jiras, remaining_jiras,
       commit_count, dev_count, lines_added, lines_removed, repos, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       total_jiras = VALUES(total_jiras), resolved_jiras = VALUES(resolved_jiras),
       remaining_jiras = VALUES(remaining_jiras), commit_count = VALUES(commit_count),
       dev_count = VALUES(dev_count), lines_added = VALUES(lines_added),
       lines_removed = VALUES(lines_removed), repos = VALUES(repos), generated_at = NOW()`,
    [
      epicKey, org,
      result.totalJiras, result.resolvedJiras, result.remainingJiras,
      result.commitCount, result.devCount,
      result.linesAdded, result.linesRemoved,
      JSON.stringify(result.repos),
    ],
  );

  return result;
}

export async function evictEpicStats(epicKey: string, org: string): Promise<void> {
  await db.execute(`DELETE FROM epic_stats WHERE epic_key = ? AND org = ?`, [epicKey, org]);
}

interface CommitCounts {
  commitCount: number;
  devCount: number;
  linesAdded: number;
  linesRemoved: number;
  repos: string[];
}

async function getCommitCounts(
  epicKey: string,
  childKeys: string[],
  assigneeEmails: string[],
  org: string,
): Promise<CommitCounts> {
  // Phase 1: Find repos and developers from commits that reference any issue key.
  const allKeys = [epicKey, ...childKeys];
  const likeClauses = allKeys.map(() => 'ca.commit_message LIKE ?').join(' OR ');
  const likeValues = allKeys.map(k => `%${k}%`);

  const [seedRows] = await db.execute(
    `SELECT DISTINCT ca.commit_sha, ca.repo, ca.github_login
     FROM commit_analyses ca
     JOIN reports r ON r.id = ca.report_id
     WHERE r.org = ? AND r.status = 'completed'
     AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
     AND (${likeClauses})`,
    [org, ...likeValues],
  ) as [any[], any];

  const seedRepos = new Set<string>();
  const seedLogins = new Set<string>();
  for (const row of seedRows) {
    seedRepos.add(row.repo);
    seedLogins.add(row.github_login);
  }

  // Also resolve Jira assignee emails to GitHub logins via user_mappings
  if (assigneeEmails.length > 0) {
    const placeholders = assigneeEmails.map(() => '?').join(',');
    const [mappings] = await db.execute(
      `SELECT github_login FROM user_mappings WHERE org = ? AND jira_email IN (${placeholders})`,
      [org, ...assigneeEmails],
    ) as [any[], any];
    for (const m of mappings) seedLogins.add(m.github_login);
  }

  // Phase 2: Count distinct commits by those developers in those repos.
  if (seedRepos.size === 0 && seedLogins.size === 0) {
    return { commitCount: 0, devCount: 0, linesAdded: 0, linesRemoved: 0, repos: [] };
  }

  const conditions: string[] = [];
  const params: any[] = [org];

  if (seedRepos.size > 0 && seedLogins.size > 0) {
    const repoPlaceholders = Array.from(seedRepos).map(() => '?').join(',');
    const loginPlaceholders = Array.from(seedLogins).map(() => '?').join(',');
    conditions.push(`(ca.repo IN (${repoPlaceholders}) AND ca.github_login IN (${loginPlaceholders}))`);
    params.push(...seedRepos, ...seedLogins);
  } else if (seedLogins.size > 0) {
    const loginPlaceholders = Array.from(seedLogins).map(() => '?').join(',');
    conditions.push(`ca.github_login IN (${loginPlaceholders})`);
    params.push(...seedLogins);
  }

  // Also include any commits that directly reference issue keys
  if (likeClauses) {
    conditions.push(`(${likeClauses})`);
    params.push(...likeValues);
  }

  const [rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.github_login, ca.lines_added, ca.lines_removed
     FROM commit_analyses ca
     JOIN reports r ON r.id = ca.report_id
     WHERE r.org = ? AND r.status = 'completed'
     AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
     AND (${conditions.join(' OR ')})`,
    params,
  ) as [any[], any];

  // Deduplicate by commit_sha
  const seen = new Set<string>();
  const repos = new Set<string>();
  const logins = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const row of rows) {
    if (seen.has(row.commit_sha)) continue;
    seen.add(row.commit_sha);
    repos.add(row.repo);
    logins.add(row.github_login);
    linesAdded += Number(row.lines_added);
    linesRemoved += Number(row.lines_removed);
  }

  return {
    commitCount: seen.size,
    devCount: logins.size,
    linesAdded,
    linesRemoved,
    repos: Array.from(repos).sort(),
  };
}
