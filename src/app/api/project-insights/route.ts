import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit } from '@/lib/llm-provider';
import { withRequestLog } from '@/lib/logger';
import { renderInflightBlock } from '@/lib/team-pulse/render';
import type { TeamProjectInflightPr, TeamProjectInflightBranch } from '@/lib/team-pulse/data';

const INSIGHTS_CACHE_VERSION = 3;

async function getHandler() {
  const [latestRows] = await db.execute(
    `SELECT id, org, period_days, created_at FROM reports
     WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
    [],
  ) as [any[], any];
  if (!latestRows.length) return NextResponse.json({ available: false });
  const report = latestRows[0];

  const [jiraCount] = await db.execute(
    `SELECT COUNT(*) as cnt FROM jira_issues WHERE report_id = ?`,
    [report.id],
  ) as [any[], any];
  if (!jiraCount[0]?.cnt || Number(jiraCount[0].cnt) === 0) {
    return NextResponse.json({ available: false });
  }

  const [totalsRows] = await db.execute(
    `SELECT COALESCE(SUM(total_commits), 0) AS commits, COALESCE(SUM(total_prs), 0) AS prs
     FROM developer_stats WHERE report_id = ?`,
    [report.id],
  ) as [any[], any];
  const totals = {
    commits: Number(totalsRows[0]?.commits ?? 0),
    prs:     Number(totalsRows[0]?.prs ?? 0),
    jiras:   Number(jiraCount[0]?.cnt ?? 0),
  };

  const [cached] = await db.execute(
    `SELECT highlights_json FROM report_comparisons WHERE report_id_a = ? AND report_id_b = ?`,
    [report.id, report.id],
  ) as [any[], any];
  if (cached.length > 0) {
    let data: any = null;
    try {
      data = typeof cached[0].highlights_json === 'string'
        ? JSON.parse(cached[0].highlights_json)
        : cached[0].highlights_json;
    } catch { /* malformed — fall through */ }
    if (data && !Array.isArray(data) && data._v === INSIGHTS_CACHE_VERSION) {
      const { _v: _, ...rest } = data;
      return NextResponse.json({
        available: true,
        report: { id: report.id, org: report.org, periodDays: report.period_days, createdAt: report.created_at },
        ...rest,
        totals,
        cached: true,
      });
    }
    // _v !== INSIGHTS_CACHE_VERSION: stale cache — fall through to regenerate.
  }

  // ── Fetch all data once ──────────────────────────────────────────────────
  const [jiraRows] = await db.execute(
    `SELECT issue_key, project_key, issue_type, github_login, LEFT(summary, 80) as summary
     FROM jira_issues WHERE report_id = ? ORDER BY project_key, issue_key`,
    [report.id],
  ) as [any[], any];

  const [allCommitRows] = await db.execute(
    `SELECT commit_sha, pr_number, repo, github_login,
            LEFT(commit_message, 80) AS msg,
            lines_added, lines_removed, committed_at
     FROM commit_analyses WHERE report_id = ? ORDER BY committed_at DESC`,
    [report.id],
  ) as [any[], any];

  // Build indexes for enrichment (used after LLM response — no second DB fetch needed).
  // Keyed by 7-char prefix because that is what the LLM prompt sends and returns.
  const commitBySha = new Map<string, any>(
    allCommitRows.map((c: any) => [c.commit_sha?.slice(0, 7), c]),
  );
  const commitsByPr = new Map<number, any[]>();
  for (const c of allCommitRows) {
    if (!c.pr_number) continue;
    const arr = commitsByPr.get(c.pr_number) ?? [];
    arr.push(c);
    commitsByPr.set(c.pr_number, arr);
  }
  // For linked_commits/prs badges: count commits whose message contains each Jira key
  const commitsByJiraKey = new Map<string, { commits: number; prs: Set<number> }>();
  for (const c of allCommitRows) {
    const match = (c.msg as string)?.match(/[A-Z]+-\d+/);
    if (!match) continue;
    const key = match[0];
    const entry = commitsByJiraKey.get(key) ?? { commits: 0, prs: new Set<number>() };
    entry.commits++;
    if (c.pr_number) entry.prs.add(c.pr_number);
    commitsByJiraKey.set(key, entry);
  }

  // ── Build LLM inputs ─────────────────────────────────────────────────────
  const jiraData = jiraRows.map((r: any) =>
    `${r.issue_key}|${r.project_key}|${r.issue_type || ''}|${r.github_login}|${r.summary || ''}`
  ).join('\n');

  const commitData = allCommitRows.map((c: any) =>
    `${c.commit_sha?.slice(0,7)}|${c.pr_number ?? ''}|${c.repo}|${c.github_login}|${(c.msg || '').replace(/\|/g, ' ')}|+${c.lines_added ?? 0}/-${c.lines_removed ?? 0}`
  ).join('\n');

  const prSummaryMap = new Map<number, any>();
  for (const c of allCommitRows) {
    if (!c.pr_number) continue;
    const ex = prSummaryMap.get(c.pr_number);
    if (ex) {
      ex.commits++;
      ex.added += Number(c.lines_added ?? 0);
      ex.removed += Number(c.lines_removed ?? 0);
    } else {
      prSummaryMap.set(c.pr_number, {
        pr: c.pr_number, repo: c.repo, login: c.github_login,
        commits: 1, added: Number(c.lines_added ?? 0), removed: Number(c.lines_removed ?? 0),
        msg: (c.msg || '').split('\n')[0].slice(0, 80).replace(/\|/g, ' '),
      });
    }
  }
  const prData = [...prSummaryMap.values()]
    .map(p => `${p.pr}|${p.repo}|${p.login}|${p.commits}c|+${p.added}/-${p.removed}|${p.msg}`)
    .join('\n');

  const noJiraData = allCommitRows
    .filter((c: any) => !c.pr_number)
    .slice(0, 30)
    .map((c: any) => `${c.repo}|${c.github_login}|${(c.msg || '').slice(0, 60)}`).join('\n');

  const [inflightPrRows] = await db.execute(
    `SELECT repo, pr_title, github_login, is_draft,
            COALESCE(pr_additions, 0) AS pr_additions,
            COALESCE(pr_deletions, 0) AS pr_deletions
       FROM unmerged_prs WHERE report_id = ?
      ORDER BY COALESCE(pr_additions, 0) + COALESCE(pr_deletions, 0) DESC LIMIT 30`,
    [report.id],
  ) as [any[], any];
  const [inflightBranchRows] = await db.execute(
    `SELECT repo, branch, github_login,
            COUNT(*) AS commit_count, SUM(lines_added + lines_removed) AS total_lines
       FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL
      GROUP BY repo, branch, github_login ORDER BY total_lines DESC LIMIT 10`,
    [report.id],
  ) as [any[], any];
  const inflightPrs: TeamProjectInflightPr[] = inflightPrRows.map((r: any) => ({
    repo: String(r.repo ?? ''), title: String(r.pr_title ?? ''), author: String(r.github_login ?? ''),
    additions: Number(r.pr_additions ?? 0), deletions: Number(r.pr_deletions ?? 0),
    is_draft: r.is_draft === 1 || r.is_draft === true,
  }));
  const inflightBranches: TeamProjectInflightBranch[] = inflightBranchRows.map((r: any) => ({
    repo: String(r.repo ?? ''), branch: String(r.branch ?? ''), author: String(r.github_login ?? ''),
    commit_count: Number(r.commit_count ?? 0), lines: Number(r.total_lines ?? 0),
  }));
  const inflightBlock = renderInflightBlock(inflightPrs, inflightBranches);

  // ── LLM call ─────────────────────────────────────────────────────────────
  const systemPrompt = `You are an engineering analytics assistant. Analyze Jira issues, all GitHub commits, and all PRs from a single report period to identify the top projects the team is working on.

You will receive:
1. Jira issues: key|project_key|type|developer|summary
2. All commits: sha|pr_number|repo|developer|message|+add/-remove  (commit messages often contain Jira keys — use this to link commits to issues)
3. PR summaries: pr_number|repo|developer|commit_count|+add/-remove|first_message
4. Untracked work (commits with no PR): repo|developer|message

Your task:
1. Identify the top 10 ACTUAL projects being worked on. Use ALL three signals — Jira issues, commit messages, and PR titles — to cluster related work. Name projects descriptively (e.g. "Keycloak 26 Migration", not "AUT").
2. For each project ENUMERATE exactly what you are attributing to it:
   - jira_keys: all Jira keys from JIRA ISSUES that belong to this cluster
   - groups: group those jira_keys into 2-4 named epic themes
   - pr_numbers: all PR numbers from PR SUMMARIES that belong to this cluster
   - commit_shas: any commit SHAs (7-char prefix) from UNTRACKED WORK that belong to this cluster
3. Write a one-sentence summary of what the project achieves.
4. Identify up to 5 significant GitHub efforts with NO Jira tickets (from untracked work).

IMPORTANT: Each Jira key and each PR number must appear in exactly ONE project. No duplicates.

Return JSON:
{
  "projects": [
    {
      "name": "Descriptive Project Name",
      "developers": ["login1", "login2"],
      "summary": "One sentence about what this project achieves",
      "jira_keys": ["PROJ-123", "PROJ-456"],
      "groups": [{ "name": "Epic theme name", "jira_keys": ["PROJ-123"] }],
      "pr_numbers": [101, 102, 103],
      "commit_shas": ["abc1234", "def5678"]
    }
  ],
  "untracked_work": [
    { "name": "Descriptive name", "repo": "repo-name", "developers": ["login1"], "commits": 10, "summary": "What this is about" }
  ]
}

Rules:
- Cluster by feature, not by Jira project key prefix
- Each Jira key and each PR number appears in exactly ONE project
- jira_keys: only keys from JIRA ISSUES; pr_numbers: only numbers from PR SUMMARIES; commit_shas: only 7-char SHAs from UNTRACKED WORK
- Keep summaries under 20 words
- Return ONLY raw JSON`;

  const userMessage = `JIRA ISSUES (${jiraRows.length} total):
${jiraData}

ALL COMMITS (${allCommitRows.length} total — sha|pr|repo|developer|message|+add/-remove):
${commitData}

PR SUMMARIES (${prSummaryMap.size} total — pr|repo|developer|commits|+add/-remove|message):
${prData}

UNTRACKED WORK (commits with no PR):
${noJiraData}${inflightBlock}`;

  try {
    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.3,
      ...tokenLimit(12000),
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

    // ── Enrich each project using the pre-built indexes ───────────────────
    const jiraByKey = new Map(jiraRows.map((r: any) => [r.issue_key, r]));

    // Hoisted so it can also be used for the "Other" row details below.
    const enrichKey = (key: string) => {
      const r = jiraByKey.get(key);
      const stats = commitsByJiraKey.get(key);
      return {
        key,
        summary: r?.summary ?? null,
        type: r?.issue_type ?? null,
        assignee: r?.github_login ?? null,
        linked_commits: stats?.commits ?? 0,
        linked_prs: stats?.prs.size ?? 0,
      };
    };

    const enrichedProjects = (parsed.projects || []).map((p: any) => {
      const llmPrNums = new Set<number>((p.pr_numbers ?? []).map(Number));
      const llmShas = new Set<string>(p.commit_shas ?? []);

      // Gather all commits: by SHA (bare commits) + by PR number
      const projCommitMap = new Map<string, any>();
      for (const sha of llmShas) {
        const c = commitBySha.get(sha);
        if (c) projCommitMap.set(sha, c);
      }
      for (const prNum of llmPrNums) {
        for (const c of commitsByPr.get(prNum) ?? []) {
          projCommitMap.set(c.commit_sha, c);
        }
      }
      const projCommits = [...projCommitMap.values()]
        .sort((a, b) => new Date(b.committed_at).getTime() - new Date(a.committed_at).getTime())
        .slice(0, 20);

      // Derive distinct PRs from attributed commits
      const prMap = new Map<number, { pr: number; repo: string; login: string; msg: string; commits: number; added: number; removed: number }>();
      for (const c of projCommitMap.values()) {
        if (!c.pr_number) continue;
        const ex = prMap.get(c.pr_number);
        if (ex) {
          ex.commits++;
          ex.added += Number(c.lines_added ?? 0);
          ex.removed += Number(c.lines_removed ?? 0);
        } else {
          prMap.set(c.pr_number, {
            pr: c.pr_number, repo: c.repo, login: c.github_login,
            msg: (c.msg as string)?.split('\n')[0]?.slice(0, 80) ?? '',
            commits: 1, added: Number(c.lines_added ?? 0), removed: Number(c.lines_removed ?? 0),
          });
        }
      }
      const projPrs = [...prMap.values()]
        .sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
        .slice(0, 20);

      const enrichedGroups = Array.isArray(p.groups)
        ? p.groups.map((g: any) => ({
            name: g.name,
            jira_details: (g.jira_keys || []).map(enrichKey),
          }))
        : [];

      const enrichedCommits = projCommits.map((c: any) => ({
        sha: c.commit_sha?.slice(0, 7),
        repo: c.repo, msg: c.msg, pr: c.pr_number, login: c.github_login,
        added: Number(c.lines_added ?? 0), removed: Number(c.lines_removed ?? 0),
      }));

      return {
        ...p,
        jira_count: Array.isArray(p.jira_keys) ? p.jira_keys.length : 0,
        // Keep estimated_commits/prs for backward compat with ProjectsCard bar/sort logic.
        // Derived from the attributed arrays rather than LLM estimation.
        estimated_commits: projCommits.length,
        estimated_prs: projPrs.length,
        jira_details: Array.isArray(p.jira_keys) ? p.jira_keys.map(enrichKey) : [],
        groups: enrichedGroups,
        commits: enrichedCommits,
        prs: projPrs,
      };
    });

    // Compute "Other" — jiras/PRs not attributed to any project
    const attributedJiraKeys = new Set<string>(enrichedProjects.flatMap((p: any) => p.jira_keys ?? []));
    const attributedPrNums = new Set<number>(enrichedProjects.flatMap((p: any) => (p.pr_numbers ?? []).map(Number)));

    const otherJiraDetails = jiraRows
      .filter((r: any) => !attributedJiraKeys.has(r.issue_key))
      .map((r: any) => enrichKey(r.issue_key));

    const otherPrs = [...prSummaryMap.values()]
      .filter(p => !attributedPrNums.has(p.pr))
      .sort((a, b) => (b.added + b.removed) - (a.added + a.removed));

    const otherTotals = { jiras: otherJiraDetails.length, prs: otherPrs.length };
    const otherDetails = { jira_details: otherJiraDetails, prs: otherPrs };

    const toCache = { _v: INSIGHTS_CACHE_VERSION, projects: enrichedProjects, untracked_work: parsed.untracked_work || [], otherTotals, otherDetails };
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
      otherTotals,
      otherDetails,
      totals,
      cached: false,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withRequestLog(getHandler);
