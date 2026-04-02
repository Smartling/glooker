import { getJiraClient } from '@/lib/jira/client';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import { getAppConfig } from '@/lib/app-config/service';
import db from '@/lib/db';
import { getEpicRingStats, evictEpicStats } from './epic-stats';

export interface CommitDetail {
  sha: string;
  repo: string;
  author: string;
  message: string;
  linesAdded: number;
  linesRemoved: number;
  prNumber: number | null;
  prTitle: string | null;
  committedAt: string;
}

export interface EpicSummaryResult {
  epicKey: string;
  summary: string;
  stats: {
    jiraResolved: number;
    jiraRemaining: number;
    commitCount: number;
    linesAdded: number;
    linesRemoved: number;
    repos: string[];
  };
  commits: CommitDetail[];
  generatedAt: string;
  cached: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getEpicSummary(
  epicKey: string,
  epicSummaryText: string,
  org: string,
  forceRefresh: boolean,
): Promise<EpicSummaryResult> {
  // 1. On force refresh, evict both caches before recomputing
  if (forceRefresh) {
    await evictEpicStats(epicKey, org);
    await db.execute(
      `DELETE FROM epic_summaries WHERE epic_key = ? AND org = ?`,
      [epicKey, org],
    );
  }

  // 2. Get stats from the stats service (cached or fresh)
  const ringStats = await getEpicRingStats(epicKey, org);

  const stats = {
    jiraResolved: ringStats.resolvedJiras,
    jiraRemaining: ringStats.remainingJiras,
    commitCount: ringStats.commitCount,
    linesAdded: ringStats.linesAdded,
    linesRemoved: ringStats.linesRemoved,
    repos: ringStats.repos,
  };

  // 3. Fetch Jira child data (task titles needed for the LLM prompt)
  const { resolved, remaining, allKeys, assigneeEmails } = await getJiraChildData(epicKey);

  // 4. Fetch commit details for the expand view
  const commits = await getCommitDetails(epicKey, allKeys, assigneeEmails, org);

  // 5. Check epic_summaries cache for LLM summary (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedSummary(epicKey, org);
    if (cached) {
      cached.commits = commits;
      cached.stats = stats; // use fresh stats from stats service
      return cached;
    }
  }

  // 6. Generate summary via LLM
  const summaryText = await generateSummary(epicKey, epicSummaryText, resolved, remaining, {
    commitCount: ringStats.commitCount,
    linesAdded: ringStats.linesAdded,
    linesRemoved: ringStats.linesRemoved,
    repos: ringStats.repos,
  });

  // 7. Store in epic_summaries cache
  await storeSummary(epicKey, org, summaryText, stats);

  return {
    epicKey,
    summary: summaryText,
    stats,
    commits,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
}

async function getCachedSummary(epicKey: string, org: string): Promise<EpicSummaryResult | null> {
  const [rows] = await db.execute(
    `SELECT summary_text, jira_resolved, jira_remaining, commit_count,
            lines_added, lines_removed, repos, generated_at
     FROM epic_summaries
     WHERE epic_key = ? AND org = ?`,
    [epicKey, org],
  ) as [any[], any];

  if (rows.length === 0) return null;

  const row = rows[0];
  const generatedAt = new Date(row.generated_at);
  if (Date.now() - generatedAt.getTime() > CACHE_TTL_MS) return null;

  return {
    epicKey,
    summary: row.summary_text,
    stats: {
      jiraResolved: Number(row.jira_resolved),
      jiraRemaining: Number(row.jira_remaining),
      commitCount: Number(row.commit_count),
      linesAdded: Number(row.lines_added),
      linesRemoved: Number(row.lines_removed),
      repos: row.repos ? (typeof row.repos === 'string' ? JSON.parse(row.repos) : row.repos) : [],
    },
    commits: [], // populated by caller from live DB query
    generatedAt: generatedAt.toISOString(),
    cached: true,
  };
}

export async function getJiraChildData(epicKey: string) {
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
  const assigneeEmails = [...new Set(
    children.map(c => c.assigneeEmail).filter((e): e is string => e !== null),
  )];

  return { resolved, remaining, allKeys, assigneeEmails };
}

export async function getCommitDetails(
  epicKey: string,
  childKeys: string[],
  assigneeEmails: string[],
  org: string,
): Promise<CommitDetail[]> {
  // Phase 1: Find repos and developers from commits that reference any issue key.
  const allKeys = [epicKey, ...childKeys];
  const likeClauses = allKeys.map(() => 'ca.commit_message LIKE ?').join(' OR ');
  const likeValues = allKeys.map(k => `%${k}%`);

  const [seedRows] = await db.execute(
    `SELECT DISTINCT ca.commit_sha, ca.repo, ca.github_login, ca.lines_added, ca.lines_removed
     FROM commit_analyses ca
     JOIN reports r ON r.id = ca.report_id
     WHERE r.org = ? AND r.status = 'completed'
     AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
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

  // Phase 2: Get ALL commits by those developers in those repos in the 14-day window.
  if (seedRepos.size === 0 && seedLogins.size === 0) {
    return [];
  }

  const conditions: string[] = [];
  const params: any[] = [org];

  if (seedRepos.size > 0 && seedLogins.size > 0) {
    const repoPlaceholders = Array.from(seedRepos).map(() => '?').join(',');
    const loginPlaceholders = Array.from(seedLogins).map(() => '?').join(',');
    conditions.push(`(ca.repo IN (${repoPlaceholders}) AND ca.github_login IN (${loginPlaceholders}))`);
    params.push(...seedRepos, ...seedLogins);
  } else if (seedLogins.size > 0) {
    // Only have logins (from Jira assignees), search all their commits
    const loginPlaceholders = Array.from(seedLogins).map(() => '?').join(',');
    conditions.push(`ca.github_login IN (${loginPlaceholders})`);
    params.push(...seedLogins);
  }

  // Also include any commits that directly reference issue keys (from phase 1 seed)
  if (likeClauses) {
    conditions.push(`(${likeClauses})`);
    params.push(...likeValues);
  }

  const [rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.github_login, ca.commit_message,
            ca.lines_added, ca.lines_removed, ca.pr_number, ca.pr_title, ca.committed_at
     FROM commit_analyses ca
     JOIN reports r ON r.id = ca.report_id
     WHERE r.org = ? AND r.status = 'completed'
     AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
     AND (${conditions.join(' OR ')})
     ORDER BY ca.committed_at DESC`,
    params,
  ) as [any[], any];

  // Deduplicate by commit_sha (same commit appears in multiple reports)
  const seen = new Set<string>();
  const commits: CommitDetail[] = [];

  for (const row of rows) {
    if (seen.has(row.commit_sha)) continue;
    seen.add(row.commit_sha);
    commits.push({
      sha: row.commit_sha,
      repo: row.repo,
      author: row.github_login,
      message: row.commit_message || '',
      linesAdded: Number(row.lines_added),
      linesRemoved: Number(row.lines_removed),
      prNumber: row.pr_number || null,
      prTitle: row.pr_title || null,
      committedAt: row.committed_at ? new Date(row.committed_at).toISOString() : '',
    });
  }

  return commits;
}

async function generateSummary(
  epicKey: string,
  epicSummaryText: string,
  resolved: Array<{ key: string; summary: string }>,
  remaining: Array<{ key: string; summary: string }>,
  stats: { commitCount: number; linesAdded: number; linesRemoved: number; repos: string[] },
): Promise<string> {
  const resolvedList = resolved.length > 0
    ? resolved.map(r => `${r.key}: ${r.summary}`).join('\n')
    : '(none)';
  const remainingTitles = remaining.length > 0
    ? remaining.map(r => r.summary).join(', ')
    : '(none)';
  const net = stats.linesAdded - stats.linesRemoved;

  const prompt = loadPrompt('epic-summary-system.txt', {
    EPIC_KEY: epicKey,
    EPIC_SUMMARY: epicSummaryText,
    RESOLVED_TASKS: resolvedList,
    REMAINING_COUNT: String(remaining.length),
    REMAINING_TITLES: remainingTitles,
    COMMIT_COUNT: String(stats.commitCount),
    REPOS: stats.repos.join(', ') || '(none)',
    LINES_ADDED: String(stats.linesAdded),
    LINES_REMOVED: String(stats.linesRemoved),
    LINES_NET: String(net),
  });

  const client = await getLLMClient();
  const config = getAppConfig();

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: config.summary.temperature,
    ...tokenLimit(config.summary.maxTokens),
    messages: [
      { role: 'user', content: prompt },
    ],
    ...extraBodyProps(),
  } as any);

  const content = response.choices[0]?.message?.content || '';
  return (Array.isArray(content) ? content.join('') : String(content)).trim();
}

async function storeSummary(
  epicKey: string,
  org: string,
  summaryText: string,
  stats: EpicSummaryResult['stats'],
): Promise<void> {
  await db.execute(
    `INSERT INTO epic_summaries (epic_key, org, summary_text, jira_resolved, jira_remaining,
       commit_count, lines_added, lines_removed, repos, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       summary_text = VALUES(summary_text),
       jira_resolved = VALUES(jira_resolved),
       jira_remaining = VALUES(jira_remaining),
       commit_count = VALUES(commit_count),
       lines_added = VALUES(lines_added),
       lines_removed = VALUES(lines_removed),
       repos = VALUES(repos),
       generated_at = NOW()`,
    [epicKey, org, summaryText, stats.jiraResolved, stats.jiraRemaining,
     stats.commitCount, stats.linesAdded, stats.linesRemoved, JSON.stringify(stats.repos)],
  );
}
