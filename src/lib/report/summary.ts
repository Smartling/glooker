import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import { getAppConfig } from '@/lib/app-config/service';
import { ReportNotFoundError } from './service';
import { DeveloperNotFoundError } from './dev';
import { dedupCommitsBySha } from './timeline';

interface UnmergedPrSummary { title: string; updatedAt: string; createdAt: string; draft: boolean; }
interface UnmergedCommitSummary { message: string; repo: string; committedAt: string; }

export function formatUnmergedWorkSection(
  openPrs: UnmergedPrSummary[],
  branchCommits: UnmergedCommitSummary[],
): string {
  if (openPrs.length === 0 && branchCommits.length === 0) return '';

  const daysAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));

  const lines: string[] = [];
  lines.push('Work in flight (NOT counted in impact score — these are unmerged):');

  if (openPrs.length > 0) {
    const top = [...openPrs]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
    lines.push(`- Open PRs: ${openPrs.length}`);
    for (const pr of top) {
      const age = daysAgo(pr.createdAt);
      const upd = daysAgo(pr.updatedAt);
      const draft = pr.draft ? ' [draft]' : '';
      lines.push(`  - "${pr.title}" (opened ${age}d ago, updated ${upd}d ago${draft})`);
    }
    if (openPrs.length > 5) lines.push(`  + ${openPrs.length - 5} more`);
  }

  if (branchCommits.length > 0) {
    const repos = Array.from(new Set(branchCommits.map(c => c.repo)));
    const top = [...branchCommits]
      .sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime())
      .slice(0, 3);
    lines.push(`- Commits on unmerged branches: ${branchCommits.length} across ${repos.length} repo${repos.length === 1 ? '' : 's'}`);
    for (const c of top) {
      lines.push(`  - "${c.message.split('\n')[0]}" (${daysAgo(c.committedAt)}d ago in ${c.repo})`);
    }
    if (branchCommits.length > 3) lines.push(`  + ${branchCommits.length - 3} more`);
  }

  lines.push('');
  lines.push('If this developer has substantial in-flight work AND modest shipped impact, nudge them to finish existing work before starting new.');
  lines.push('If in-flight work is minimal or shipped impact is already strong, do not mention it.');
  lines.push('Remember: in-flight work is NOT reflected in the impact score.');

  return lines.join('\n');
}

export async function getDevSummary(reportId: string, login: string) {
  // Check cache first
  const [cached] = await db.execute(
    `SELECT summary_text, badges_json, generated_at FROM developer_summaries
     WHERE report_id = ? AND github_login = ?`,
    [reportId, login],
  ) as [any[], any];

  if (cached.length > 0) {
    return {
      summary: cached[0].summary_text,
      badges: typeof cached[0].badges_json === 'string'
        ? JSON.parse(cached[0].badges_json || '[]')
        : (cached[0].badges_json || []),
      generated_at: cached[0].generated_at,
      cached: true,
    };
  }

  // Gather data for the prompt
  const [reportRows] = await db.execute(
    `SELECT org, period_days FROM reports WHERE id = ?`, [reportId],
  ) as [any[], any];
  if (!reportRows.length) {
    throw new ReportNotFoundError(reportId);
  }
  const { org, period_days } = reportRows[0];

  // All devs ordered by impact (for rank + above devs)
  const [allDevs] = await db.execute(
    `SELECT github_login, github_name, total_prs, total_commits, lines_added, lines_removed,
            avg_complexity, impact_score, pr_percentage, ai_percentage, type_breakdown
     FROM developer_stats WHERE report_id = ? ORDER BY impact_score DESC`,
    [reportId],
  ) as [any[], any];

  const devIdx = allDevs.findIndex((d: any) => d.github_login === login);
  if (devIdx === -1) {
    throw new DeveloperNotFoundError(login);
  }

  const dev = allDevs[devIdx];
  const rank = devIdx + 1;
  const totalDevs = allDevs.length;

  // Devs above (up to 3 positions above)
  const devsAbove = allDevs.slice(Math.max(0, devIdx - 3), devIdx);

  // Get this dev's commits split by recent 7 days vs prior 7 days
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`, [org],
  ) as [any[], any];
  const reportIds = allReportIds.map((r: any) => r.id);

  let allCommits: any[] = [];
  if (reportIds.length > 0) {
    const placeholders = reportIds.map(() => '?').join(',');
    const [rows] = await db.execute(
      `SELECT commit_sha, committed_at, lines_added, lines_removed,
              complexity, type, ai_co_authored, maybe_ai
       FROM commit_analyses
       WHERE github_login = ? AND report_id IN (${placeholders})
       ORDER BY committed_at DESC`,
      [login, ...reportIds],
    ) as [any[], any];
    allCommits = dedupCommitsBySha(rows);
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const d14 = new Date(now.getTime() - 14 * 86400000);

  const recent7d = allCommits.filter(c => c.committed_at && new Date(c.committed_at) >= d7);
  const prior7d = allCommits.filter(c => c.committed_at && new Date(c.committed_at) >= d14 && new Date(c.committed_at) < d7);

  function weekStats(commits: any[]) {
    const count = commits.length;
    const lines = commits.reduce((s, c) => s + (Number(c.lines_added) || 0) + (Number(c.lines_removed) || 0), 0);
    const complexities = commits.filter(c => c.complexity != null).map(c => Number(c.complexity));
    const avgC = complexities.length ? (complexities.reduce((s, n) => s + n, 0) / complexities.length) : 0;
    const aiCount = commits.filter(c => c.ai_co_authored || c.maybe_ai).length;
    const aiPct = count > 0 ? Math.round((aiCount / count) * 100) : 0;
    const types: Record<string, number> = {};
    for (const c of commits) { if (c.type) types[c.type] = (types[c.type] || 0) + 1; }
    return { count, lines, avgComplexity: Math.round(avgC * 10) / 10, aiPct, types };
  }

  const recentStats = weekStats(recent7d);
  const priorStats = weekStats(prior7d);

  const [unmergedPrRows] = await db.execute(
    `SELECT pr_title, pr_created_at, pr_updated_at, is_draft
     FROM unmerged_prs
     WHERE report_id = ? AND github_login = ?`,
    [reportId, login],
  ) as [any[], any];

  const [unmergedCommitRows] = await db.execute(
    `SELECT commit_message, repo, committed_at
     FROM unmerged_commits
     WHERE report_id = ? AND github_login = ? AND pr_number IS NULL`,
    [reportId, login],
  ) as [any[], any];

  const unmergedPrs = unmergedPrRows.map((r: any) => ({
    title:     r.pr_title,
    createdAt: r.pr_created_at,
    updatedAt: r.pr_updated_at,
    draft:     Boolean(r.is_draft),
  }));
  const unmergedCommits = unmergedCommitRows.map((r: any) => ({
    message:     r.commit_message,
    repo:        r.repo,
    committedAt: r.committed_at,
  }));

  const unmergedSection = formatUnmergedWorkSection(unmergedPrs, unmergedCommits);

  // Build prompt
  const formatDev = (d: any, anonymous = false) => {
    const prefix = anonymous ? `rank #${d.rank || '?'}` : `@${d.github_login}`;
    const jiraStr = (d.total_jira_issues ?? 0) > 0 ? `, jiras=${d.total_jira_issues}` : '';
    return `${prefix}: commits=${d.total_commits}, PRs=${d.total_prs}, lines=${d.lines_added}+/${d.lines_removed}-, complexity=${Number(d.avg_complexity).toFixed(1)}, impact=${Number(d.impact_score).toFixed(1)}, PR%=${d.pr_percentage}, AI%=${d.ai_percentage}${jiraStr}`;
  };

  const rankLabel = rank === 1 ? '1st (top of leaderboard)' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `#${rank} of ${totalDevs}`;

  const systemPrompt = loadPrompt('report-summary-system.txt');

  const devsAboveSection = devsAbove.length > 0
    ? `Developers ranked above (anonymous, for comparison only):\n${devsAbove.map((d, i) => `  ${formatDev({ ...d, rank: rank - devsAbove.length + i }, true)}`).join('\n')}`
    : 'This developer is #1 — no one above them.';

  const userMessage = loadPrompt('report-summary-user.txt', {
    DEV_DISPLAY_NAME: dev.github_name || dev.github_login,
    DEV_LOGIN: dev.github_login,
    RANK_LABEL: rankLabel,
    PERIOD_DAYS: String(period_days),
    DEV_STATS: formatDev(dev),
    TYPES_BREAKDOWN: JSON.stringify(typeof dev.type_breakdown === 'string' ? JSON.parse(dev.type_breakdown || '{}') : (dev.type_breakdown || {})),
    RECENT_COUNT: String(recentStats.count),
    RECENT_LINES: String(recentStats.lines),
    RECENT_COMPLEXITY: String(recentStats.avgComplexity),
    RECENT_AI_PCT: String(recentStats.aiPct),
    RECENT_TYPES: JSON.stringify(recentStats.types),
    PRIOR_COUNT: String(priorStats.count),
    PRIOR_LINES: String(priorStats.lines),
    PRIOR_COMPLEXITY: String(priorStats.avgComplexity),
    PRIOR_AI_PCT: String(priorStats.aiPct),
    PRIOR_TYPES: JSON.stringify(priorStats.types),
    DEVS_ABOVE_SECTION: devsAboveSection,
    TOTAL_DEVS: String(totalDevs),
    UNMERGED_WORK_SECTION: unmergedSection,
  });

  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: getAppConfig().summary.temperature,
    ...tokenLimit(getAppConfig().summary.maxTokens),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    ...extraBodyProps(),
    ...promptTag('report-summary-system'),
  } as any);

  const content = response.choices[0].message.content;
  const raw = (Array.isArray(content) ? content.join('') : String(content ?? '{}'));
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  let parsed: { summary?: string; badges?: any[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { summary: cleaned, badges: [] };
  }

  const summary = parsed.summary || '';
  const badges = Array.isArray(parsed.badges) ? parsed.badges : [];

  // Save to DB
  await db.execute(
    `INSERT INTO developer_summaries (report_id, github_login, summary_text, badges_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       summary_text = VALUES(summary_text),
       badges_json = VALUES(badges_json),
       generated_at = NOW()`,
    [reportId, login, summary, JSON.stringify(badges)],
  );

  return { summary, badges, generated_at: new Date().toISOString(), cached: false };
}
