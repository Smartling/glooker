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
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const resolved = children.filter(
    c => c.statusCategory === 'Done' && c.resolvedAt && c.resolvedAt.slice(0, 10) >= cutoffStr,
  );
  const remaining = children.filter(c => c.statusCategory !== 'Done');
  const allKeys = children.map(c => c.key);

  // 3. Two-phase commit query (counts only, no full details)
  const stats = await getCommitCounts(epicKey, allKeys, org);

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
  org: string,
): Promise<CommitCounts> {
  const allKeys = [epicKey, ...childKeys];
  const likeClauses = allKeys.map(() => 'ca.commit_message LIKE ?').join(' OR ');
  const likeValues = allKeys.map(k => `%${k}%`);

  // Phase 1: commits that directly reference the epic or any child issue key.
  // No DISTINCT — the combine loop below dedupes by commit_sha.
  const [phase1Rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.pr_number, ca.github_login,
            ca.lines_added, ca.lines_removed
     FROM commit_analyses ca
     JOIN reports r ON r.id = ca.report_id
     WHERE r.org = ? AND r.status = 'completed'
       AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       AND (${likeClauses})`,
    [org, ...likeValues],
  ) as [any[], any];

  if (phase1Rows.length === 0) {
    return { commitCount: 0, devCount: 0, linesAdded: 0, linesRemoved: 0, repos: [] };
  }

  // Phase 2: same-PR siblings of phase-1 commits. A PR usually addresses one
  // logical work item, so commits in the same PR are part of the same effort
  // even if a teammate's follow-up commit doesn't repeat the key in its message.
  //
  // We deliberately do NOT widen by repo×author: that previously pulled in
  // every commit a Jira assignee made in any seed repo, which conflated
  // unrelated work (e.g. SPS-662 was attributing 414 commits with zero direct
  // SPS-662 references — pure assignee+repo bleed).
  const prTuples: Array<{ repo: string; prNumber: number }> = [];
  const seenTuple = new Set<string>();
  for (const row of phase1Rows) {
    if (row.pr_number == null) continue;
    const key = `${row.repo}#${row.pr_number}`;
    if (seenTuple.has(key)) continue;
    seenTuple.add(key);
    prTuples.push({ repo: row.repo, prNumber: Number(row.pr_number) });
  }

  let phase2Rows: any[] = [];
  if (prTuples.length > 0) {
    const tupleConds = prTuples.map(() => '(ca.repo = ? AND ca.pr_number = ?)').join(' OR ');
    const tupleParams: any[] = [];
    for (const t of prTuples) tupleParams.push(t.repo, t.prNumber);
    const [rows] = await db.execute(
      `SELECT ca.commit_sha, ca.repo, ca.github_login, ca.lines_added, ca.lines_removed
       FROM commit_analyses ca
       JOIN reports r ON r.id = ca.report_id
       WHERE r.org = ? AND r.status = 'completed'
         AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         AND (${tupleConds})`,
      [org, ...tupleParams],
    ) as [any[], any];
    phase2Rows = rows;
  }

  // Combine + dedupe by SHA. Phase-1 rows with a non-null pr_number are a
  // subset of Phase 2 (their PR was added to prTuples and Phase 2 re-queries
  // those PRs). Phase-1 rows with null pr_number are NOT in Phase 2. Processing
  // Phase 1 first keeps its line counts authoritative for either case.
  const seen = new Set<string>();
  const repos = new Set<string>();
  const logins = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const rowSet of [phase1Rows, phase2Rows]) {
    for (const row of rowSet) {
      if (seen.has(row.commit_sha)) continue;
      seen.add(row.commit_sha);
      repos.add(row.repo);
      logins.add(row.github_login);
      linesAdded += Number(row.lines_added) || 0;
      linesRemoved += Number(row.lines_removed) || 0;
    }
  }

  return {
    commitCount: seen.size,
    devCount: logins.size,
    linesAdded,
    linesRemoved,
    repos: Array.from(repos).sort(),
  };
}
