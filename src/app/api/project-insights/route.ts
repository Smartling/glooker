import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit } from '@/lib/llm-provider';
import { withRequestLog } from '@/lib/logger';
import { renderInflightBlock } from '@/lib/team-pulse/render';
import type { TeamProjectInflightPr, TeamProjectInflightBranch } from '@/lib/team-pulse/data';

async function getHandler() {
  // Find latest completed report
  const [latestRows] = await db.execute(
    `SELECT id, org, period_days, created_at FROM reports
     WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
    [],
  ) as [any[], any];

  if (!latestRows.length) return NextResponse.json({ available: false });
  const report = latestRows[0];

  // Check if Jira data exists for this report
  const [jiraCount] = await db.execute(
    `SELECT COUNT(*) as cnt FROM jira_issues WHERE report_id = ?`,
    [report.id],
  ) as [any[], any];

  if (!jiraCount[0]?.cnt || Number(jiraCount[0].cnt) === 0) {
    return NextResponse.json({ available: false });
  }

  // Check cache (reuse report_comparisons table — use report.id for both a and b to distinguish from real comparisons)
  // Real comparisons always have different a and b. Project insights use same id for both.
  const [cached] = await db.execute(
    `SELECT highlights_json FROM report_comparisons WHERE report_id_a = ? AND report_id_b = ?`,
    [report.id, report.id],
  ) as [any[], any];

  if (cached.length > 0) {
    const data = typeof cached[0].highlights_json === 'string'
      ? JSON.parse(cached[0].highlights_json)
      : cached[0].highlights_json;
    if (data._v === 2) {
      const { _v: _, ...rest } = data;
      return NextResponse.json({
        available: true,
        report: { id: report.id, org: report.org, periodDays: report.period_days, createdAt: report.created_at },
        ...rest,
        cached: true,
      });
    }
    // _v !== 2: stale cache (no in-flight data) — fall through to regenerate.
    // Once all active orgs have a _v:2 row this guard becomes pure overhead;
    // safe to remove after all legacy rows have naturally expired or been overwritten.
  }

  // Gather data for LLM
  // 1. All Jira issues (compact)
  const [jiraRows] = await db.execute(
    `SELECT issue_key, project_key, issue_type, github_login, LEFT(summary, 80) as summary
     FROM jira_issues WHERE report_id = ? ORDER BY project_key, issue_key`,
    [report.id],
  ) as [any[], any];

  const jiraData = jiraRows.map((r: any) =>
    `${r.issue_key}|${r.project_key}|${r.issue_type || ''}|${r.github_login}|${r.summary || ''}`
  ).join('\n');

  // 2. Developer stats
  const [devStats] = await db.execute(
    `SELECT github_login, total_commits, total_prs FROM developer_stats WHERE report_id = ? ORDER BY github_login`,
    [report.id],
  ) as [any[], any];

  const devData = devStats.map((d: any) => `${d.github_login}\t${d.total_commits}\t${d.total_prs}`).join('\n');

  // 3. Commits without Jira (top 30 by lines changed)
  const [noJiraCommits] = await db.execute(
    `SELECT ca.repo, ca.github_login, LEFT(ca.commit_message, 60) as msg
     FROM commit_analyses ca
     WHERE ca.report_id = ?
       AND ca.github_login NOT IN (SELECT DISTINCT github_login FROM jira_issues WHERE report_id = ?)
     ORDER BY ca.lines_added + ca.lines_removed DESC
     LIMIT 30`,
    [report.id, report.id],
  ) as [any[], any];

  const noJiraData = noJiraCommits.map((c: any) => `${c.repo}|${c.github_login}|${c.msg || ''}`).join('\n');

  // In-flight: open PRs (top 30 by size)
  const [inflightPrRows] = await db.execute(
    `SELECT repo, pr_title, github_login, is_draft,
            COALESCE(pr_additions, 0) AS pr_additions,
            COALESCE(pr_deletions, 0) AS pr_deletions
       FROM unmerged_prs
      WHERE report_id = ?
      ORDER BY COALESCE(pr_additions, 0) + COALESCE(pr_deletions, 0) DESC
      LIMIT 30`,
    [report.id],
  ) as [any[], any];

  // In-flight: bare branches (top 10 by total lines)
  const [inflightBranchRows] = await db.execute(
    `SELECT repo, branch, github_login,
            COUNT(*) AS commit_count,
            SUM(lines_added + lines_removed) AS total_lines
       FROM unmerged_commits
      WHERE report_id = ? AND pr_number IS NULL
      GROUP BY repo, branch, github_login
      ORDER BY total_lines DESC
      LIMIT 10`,
    [report.id],
  ) as [any[], any];

  // Map raw DB rows to the shared typed interface so renderInflightBlock
  // handles formatting and length-capping consistently across both surfaces.
  const inflightPrs: TeamProjectInflightPr[] = inflightPrRows.map((r: any) => ({
    repo: String(r.repo ?? ''),
    title: String(r.pr_title ?? ''),
    author: String(r.github_login ?? ''),
    additions: Number(r.pr_additions ?? 0),
    deletions: Number(r.pr_deletions ?? 0),
    is_draft: r.is_draft === 1 || r.is_draft === true,
  }));
  const inflightBranches: TeamProjectInflightBranch[] = inflightBranchRows.map((r: any) => ({
    repo: String(r.repo ?? ''),
    branch: String(r.branch ?? ''),
    author: String(r.github_login ?? ''),
    commit_count: Number(r.commit_count ?? 0),
    lines: Number(r.total_lines ?? 0),
  }));
  const inflightBlock = renderInflightBlock(inflightPrs, inflightBranches);

  const systemPrompt = `You are an engineering analytics assistant. Analyze Jira issues and GitHub commits from a single report period to identify the top projects the team is working on.

You will receive:
1. Jira issues: key|project_key|type|developer|summary
2. Developer stats: login, total_commits, total_prs
3. GitHub commits with no Jira coverage: repo|developer|message

Your task:
1. Identify the top 10 ACTUAL projects being worked on. Cluster related Jira issues and commits into logical projects. Name them descriptively using the actual feature/product names from issues (e.g. "Braze Content Blocks Migration", not "BRZ" or "Braze Connector").
2. For each project: list developers, total jiras, and estimate commits/PRs attributed to this project (use developer stats and proportional allocation based on issue count).
3. Write a one-sentence summary of what the project achieves.
4. Identify up to 5 significant GitHub efforts with NO Jira tickets.

Return JSON:
{
  "projects": [
    {
      "name": "Descriptive Project Name",
      "developers": ["login1", "login2"],
      "summary": "One sentence about what this project achieves",
      "jira_count": 5,
      "estimated_commits": 30,
      "estimated_prs": 12
    }
  ],
  "untracked_work": [
    {
      "name": "Descriptive name for the work",
      "repo": "repo-name",
      "developers": ["login1"],
      "commits": 10,
      "summary": "What this work appears to be about"
    }
  ]
}

Rules:
- Be specific in project names — use actual feature/product names from the issues
- Don't just group by Jira project key — look at what's actually being built
- A single Jira project might contain multiple distinct projects
- For estimated_commits/prs: if a dev has 50 commits and works on 2 projects with equal issues, attribute ~25 each
- Keep summaries under 20 words
- Return ONLY raw JSON
- If IN-FLIGHT WORK is present at the end of the user message, use it to enrich project identification — treat open PRs and bare branches as signals of ongoing work. Mix them into existing project clusters where they clearly fit, or create a project if in-flight work has no committed counterpart. Draft PRs are included.`;
  // Note: the in-flight instruction lives in systemPrompt while the in-flight data
  // is in userMessage. This follows the standard system/user role separation for
  // instructions vs data. The team-page surface embeds both in the system prompt
  // template (team-pulse-projects.txt) — the difference is cosmetic for LLM behaviour.

  const userMessage = `JIRA ISSUES (${jiraRows.length} total):
${jiraData}

DEVELOPER STATS (login | commits | PRs):
${devData}

GITHUB COMMITS WITHOUT JIRA (top 30 by size):
${noJiraData}${inflightBlock}`;

  try {
    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.3,
      ...tokenLimit(2048),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ...extraBodyProps(),
    } as any);

    const raw = response.choices[0].message.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch { parsed = { projects: [], untracked_work: [] }; }

    const toCache = { _v: 2, projects: parsed.projects || [], untracked_work: parsed.untracked_work || [] };
    await db.execute(
      `INSERT INTO report_comparisons (report_id_a, report_id_b, highlights_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE highlights_json = VALUES(highlights_json), generated_at = NOW()`,
      [report.id, report.id, JSON.stringify(toCache)],
    );

    return NextResponse.json({
      available: true,
      report: { id: report.id, org: report.org, periodDays: report.period_days, createdAt: report.created_at },
      projects: toCache.projects,
      untracked_work: toCache.untracked_work,
      cached: false,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withRequestLog(getHandler);
