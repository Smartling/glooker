import { getJiraClient } from '@/lib/jira/client';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import db from '@/lib/db';

export interface UntrackedCommit {
  sha: string;
  repo: string;
  author: string;
  message: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface WorkGroup {
  name: string;
  summary: string;
  commits: UntrackedCommit[];
}

export interface UntrackedTeam {
  name: string;
  color: string;
  groups: WorkGroup[];
  totalCommits: number;
}

export interface UntrackedResult {
  teams: UntrackedTeam[];
  cached: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getUntrackedWork(org: string, forceRefresh: boolean): Promise<UntrackedResult> {
  // 1. Get all child issue key prefixes from tracked epics (one batch Jira call)
  //    Also get repos from cached epic summaries for better exclusion
  const excludedPrefixes = await getTrackedIssuePrefixes();
  const excludedRepos = await getTrackedEpicRepos(org, excludedPrefixes);

  // 2. Get all teams with members
  const [teamRows] = await db.execute(
    `SELECT t.id, t.name, t.color FROM teams t WHERE t.org = ? ORDER BY t.name`,
    [org],
  ) as [any[], any];

  const teams: Array<{ id: string; name: string; color: string; members: string[] }> = [];
  for (const t of teamRows) {
    const [members] = await db.execute(
      `SELECT github_login FROM team_members WHERE team_id = ?`,
      [t.id],
    ) as [any[], any];
    if (members.length > 0) {
      teams.push({ id: t.id, name: t.name, color: t.color, members: members.map((m: any) => m.github_login) });
    }
  }

  const results: UntrackedTeam[] = [];

  // Process all teams in parallel
  const teamResults = await Promise.allSettled(teams.map(async (team) => {
    if (!forceRefresh) {
      const cached = await getCachedUntracked(team.name, org);
      if (cached) {
        return { name: team.name, color: team.color, groups: cached.groups, totalCommits: cached.totalCommits };
      }
    }

    const commits = await getTeamUntrackedCommits(team.members, org, excludedPrefixes, excludedRepos);
    if (commits.length === 0) return null;

    const groups = await clusterCommits(team.name, commits);
    await storeUntracked(team.name, org, groups, commits.length);
    return { name: team.name, color: team.color, groups, totalCommits: commits.length };
  }));

  for (const result of teamResults) {
    if (result.status === 'fulfilled' && result.value && result.value.groups.length > 0) {
      results.push(result.value);
    } else if (result.status === 'rejected') {
      console.error('[untracked] Team processing failed:', result.reason);
    }
  }

  return { teams: results, cached: false };
}

/**
 * Fetch all child issues for all tracked SPS epics in one batch query,
 * then extract unique Jira project key prefixes (e.g., PARSER, DT, DELTA, TQCT).
 * These prefixes are used to exclude commits from the "untracked" bucket.
 */
async function getTrackedIssuePrefixes(): Promise<string[]> {
  const client = getJiraClient();
  if (!client) return ['SPS'];

  const jql = process.env.JIRA_PROJECTS_JQL;
  if (!jql) return ['SPS'];

  try {
    // Get all tracked epics
    const epics = await client.searchEpics(jql);
    const epicKeys = epics.map(e => e.key);
    if (epicKeys.length === 0) return ['SPS'];

    // Batch query: get all child issues for all epics at once
    // Using searchEpics which does paginated JQL and returns keys
    const inClause = epicKeys.map(k => `"${k}"`).join(',');
    const childJql = `parent in (${inClause}) ORDER BY key`;
    const childResults = await client.searchEpics(childJql);

    // Extract unique project key prefixes
    const prefixes = new Set<string>();
    prefixes.add('SPS');
    for (const child of childResults) {
      const prefix = child.key.split('-')[0];
      if (prefix) prefixes.add(prefix);
    }
    for (const epic of epics) {
      const prefix = epic.key.split('-')[0];
      if (prefix) prefixes.add(prefix);
    }

    console.log(`[untracked] Excluding commits matching ${prefixes.size} Jira prefixes: ${Array.from(prefixes).join(', ')}`);
    return Array.from(prefixes);
  } catch (err) {
    console.error('[untracked] Failed to fetch tracked issue prefixes:', err);
    return ['SPS'];
  }
}

interface RawCommit {
  sha: string;
  repo: string;
  author: string;
  message: string;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Get repos associated with tracked epics. Uses two sources:
 * 1. Cached epic_summaries table (if populated from user expanding epics)
 * 2. Commits that reference tracked issue prefixes (always available)
 * Only excludes repos that appear in ≤3 epics (widely shared repos like "tms" are kept).
 */
async function getTrackedEpicRepos(org: string, prefixes: string[]): Promise<string[]> {
  const repoCounts = new Map<string, number>();

  // Source 1: cached epic summaries
  const [cacheRows] = await db.execute(
    `SELECT repos FROM epic_summaries WHERE org = ?`,
    [org],
  ) as [any[], any];

  for (const row of cacheRows) {
    const repos: string[] = row.repos
      ? (typeof row.repos === 'string' ? JSON.parse(row.repos) : row.repos)
      : [];
    for (const r of repos) {
      repoCounts.set(r, (repoCounts.get(r) || 0) + 1);
    }
  }

  // Source 2: repos from commits that reference tracked issue prefixes
  // This catches repos even when epic summaries haven't been generated yet
  if (prefixes.length > 0) {
    const likeClauses = prefixes.flatMap(() => ['ca.commit_message LIKE ?', 'ca.commit_message LIKE ?']).join(' OR ');
    const likeValues = prefixes.flatMap(p => [`%${p}-%`, `%${p} %`]);

    const [repoRows] = await db.execute(
      `SELECT ca.repo, COUNT(DISTINCT ca.commit_sha) as cnt
       FROM commit_analyses ca
       JOIN reports r ON r.id = ca.report_id
       WHERE r.org = ? AND r.status = 'completed'
       AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       AND (${likeClauses})
       GROUP BY ca.repo
       HAVING cnt >= 3`,
      [org, ...likeValues],
    ) as [any[], any];

    for (const row of repoRows) {
      // Count as 1 "epic" since we don't know which epic it belongs to
      repoCounts.set(row.repo, (repoCounts.get(row.repo) || 0) + 1);
    }
  }

  // Only exclude repos that appear in ≤3 epics (avoid widely shared repos)
  const exclusiveRepos = Array.from(repoCounts.entries())
    .filter(([, count]) => count <= 3)
    .map(([repo]) => repo);

  if (exclusiveRepos.length > 0) {
    console.log(`[untracked] Excluding ${exclusiveRepos.length} epic-associated repos: ${exclusiveRepos.join(', ')}`);
  }
  return exclusiveRepos;
}

async function getTeamUntrackedCommits(members: string[], org: string, excludedPrefixes: string[], excludedRepos: string[]): Promise<RawCommit[]> {
  const memberPlaceholders = members.map(() => '?').join(',');

  // Build exclusion: NOT LIKE '%PREFIX-%' AND NOT LIKE '%PREFIX %' for each prefix
  // Covers both "SPS-123" and "SPS 123" patterns. MySQL LIKE is case-insensitive by default.
  const prefixClauses = excludedPrefixes
    .flatMap(() => ['ca.commit_message NOT LIKE ?', 'ca.commit_message NOT LIKE ?'])
    .join(' AND ');
  const prefixValues = excludedPrefixes.flatMap(p => [`%${p}-%`, `%${p} %`]);

  // Build repo exclusion
  let repoClause = '';
  let repoValues: string[] = [];
  if (excludedRepos.length > 0) {
    const repoPlaceholders = excludedRepos.map(() => '?').join(',');
    repoClause = `AND ca.repo NOT IN (${repoPlaceholders})`;
    repoValues = excludedRepos;
  }

  const [rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.github_login, LEFT(ca.commit_message, 120) as msg,
            ca.lines_added, ca.lines_removed
     FROM commit_analyses ca
     JOIN reports r ON r.id = ca.report_id
     WHERE r.org = ? AND r.status = 'completed'
     AND ca.github_login IN (${memberPlaceholders})
     AND ca.committed_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
     AND ${prefixClauses}
     ${repoClause}
     GROUP BY ca.commit_sha, ca.repo, ca.github_login, ca.commit_message, ca.lines_added, ca.lines_removed`,
    [org, ...members, ...prefixValues, ...repoValues],
  ) as [any[], any];

  // Deduplicate by commit_sha
  const seen = new Set<string>();
  const result: RawCommit[] = [];
  for (const r of rows) {
    if (seen.has(r.commit_sha)) continue;
    seen.add(r.commit_sha);
    result.push({
      sha: r.commit_sha,
      repo: r.repo,
      author: r.github_login,
      message: r.msg,
      linesAdded: Number(r.lines_added),
      linesRemoved: Number(r.lines_removed),
    });
  }
  return result;
}

async function clusterCommits(teamName: string, commits: RawCommit[]): Promise<WorkGroup[]> {
  // Include short SHA in prompt so LLM can reference specific commits
  const shortShaLen = 8;
  const commitLines = commits.map(c =>
    `${c.sha.slice(0, shortShaLen)} | ${c.repo} | ${c.author} | ${c.message} | +${c.linesAdded} | -${c.linesRemoved}`
  ).join('\n');

  const prompt = loadPrompt('untracked-work-system.txt', {
    TEAM_NAME: teamName,
    COMMITS: commitLines,
  });

  const client = await getLLMClient();

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.3,
    ...tokenLimit(4096),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'user', content: prompt },
    ],
    ...extraBodyProps(),
    ...promptTag('untracked-work-system'),
  } as any);

  const raw = response.choices[0]?.message?.content || '{}';
  const finishReason = response.choices[0]?.finish_reason || 'unknown';
  console.log(`[untracked] LLM response for ${teamName}: ${raw.length} chars, finish_reason=${finishReason}, prompt=${prompt.length} chars, commits=${commits.length}`);
  if (finishReason === 'length') {
    console.warn(`[untracked] LLM output truncated for ${teamName} — response cut off at ${raw.length} chars`);
  }
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Build SHA lookup for mapping LLM groups back to actual commits
  const commitBySha = new Map<string, UntrackedCommit>();
  for (const c of commits) {
    commitBySha.set(c.sha.slice(0, shortShaLen), c);
    commitBySha.set(c.sha, c); // also full SHA in case LLM returns it
  }

  try {
    const parsed = JSON.parse(cleaned);
    const claimed = new Set<string>();
    const groups: WorkGroup[] = [];

    for (const g of (parsed.groups || [])) {
      const groupCommits: UntrackedCommit[] = [];
      for (const sha of (g.commit_shas || [])) {
        const commit = commitBySha.get(sha);
        if (commit && !claimed.has(commit.sha)) {
          claimed.add(commit.sha);
          groupCommits.push(commit);
        }
      }
      groups.push({
        name: String(g.name || 'Unknown'),
        summary: String(g.summary || ''),
        commits: groupCommits,
      });
    }

    // Assign unclaimed commits — first try matching by repo to existing groups, then "Other"
    const unclaimed = commits.filter(c => !claimed.has(c.sha));
    if (unclaimed.length > 0) {
      // Build repo→group mapping from claimed commits
      const repoToGroup = new Map<string, WorkGroup>();
      for (const g of groups) {
        for (const c of g.commits) {
          if (!repoToGroup.has(c.repo)) repoToGroup.set(c.repo, g);
        }
      }

      const stillUnclaimed: UntrackedCommit[] = [];
      for (const c of unclaimed) {
        const group = repoToGroup.get(c.repo);
        if (group) {
          group.commits.push(c);
        } else {
          stillUnclaimed.push(c);
        }
      }

      if (stillUnclaimed.length > 0) {
        const otherGroup = groups.find(g => g.name.toLowerCase().includes('other') || g.name.toLowerCase().includes('maintenance'));
        if (otherGroup) {
          otherGroup.commits.push(...stillUnclaimed);
        } else {
          groups.push({ name: 'Other', summary: `${stillUnclaimed.length} additional commits.`, commits: stillUnclaimed });
        }
      }
    }

    // Remove empty groups
    return groups.filter(g => g.commits.length > 0);
  } catch (err) {
    // LLM failed to return valid JSON — put all commits in one group
    console.error(`[untracked] JSON parse failed for ${teamName}: ${err}. Raw (last 200 chars): ...${raw.slice(-200)}`);
    return [{ name: 'All work', summary: `${commits.length} commits.`, commits }];
  }
}

async function getCachedUntracked(teamName: string, org: string): Promise<{ groups: WorkGroup[]; totalCommits: number } | null> {
  const [rows] = await db.execute(
    `SELECT groups_json, total_commits, generated_at FROM untracked_summaries WHERE team_name = ? AND org = ?`,
    [teamName, org],
  ) as [any[], any];

  if (rows.length === 0) return null;

  const row = rows[0];
  const generatedAt = new Date(row.generated_at);
  if (Date.now() - generatedAt.getTime() > CACHE_TTL_MS) return null;

  const groups = typeof row.groups_json === 'string' ? JSON.parse(row.groups_json) : row.groups_json;
  return { groups, totalCommits: Number(row.total_commits) };
}

async function storeUntracked(teamName: string, org: string, groups: WorkGroup[], totalCommits: number): Promise<void> {
  await db.execute(
    `INSERT INTO untracked_summaries (team_name, org, groups_json, total_commits, generated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       groups_json = VALUES(groups_json),
       total_commits = VALUES(total_commits),
       generated_at = NOW()`,
    [teamName, org, JSON.stringify(groups), totalCommits],
  );
}
