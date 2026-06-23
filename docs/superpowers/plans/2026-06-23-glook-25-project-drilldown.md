# GLOOK-25: Project Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline drill-down to project cards showing LLM-attributed Jiras (grouped by epic), PRs, and commits per project.

**Architecture:** Two tasks: (1) productionize the POC `project-insights/route.ts` (fix duplicate DB query, add linked_commits/prs badges, bump cache to `_v: 3`); (2) add inline expand with 3-tab panel to `ProjectsCard.tsx` using the new data fields.

**Tech Stack:** TypeScript, Next.js 15, React, Tailwind CSS, Jest + ts-jest

---

## File Map

| File | Change |
|---|---|
| `src/app/api/project-insights/route.ts` | Fix duplicate allCommitRows fetch; add linked_commits/prs to jira_details; bump cache to `_v: 3` |
| `src/components/ProjectsCard.tsx` | Add new types; inline expand panel with Jiras/PRs/Commits tabs |

---

### Task 1: Productionize `project-insights/route.ts`

**Files:**
- Modify: `src/app/api/project-insights/route.ts`

**Context:** The POC code is already in the working tree (uncommitted). It works but has two issues:
1. `allCommitRows` is fetched **twice** — once at line ~84 for the LLM prompt, and again inside the `try` block at line ~267 for enrichment. The second fetch is wasted; use the first.
2. `jira_details` objects don't include `linked_commits`/`linked_prs` (the commit-stat badges shown in the mockup). These should be computed during enrichment by counting how many commits have each Jira key in their message.
3. Cache version is still `_v: 2` — must be `_v: 3` to invalidate old rows that lack the new fields.
4. Cache read checks `data._v === 2` — must accept `_v === 3`.

- [ ] **Step 1: Fix the duplicate allCommitRows fetch and add linked_commits/prs**

Replace the entire content of `src/app/api/project-insights/route.ts` with the corrected version below. Key changes vs the POC:
- Remove the second `allCommitRows` fetch inside the `try` block; use the outer `allCommitRows` directly
- Build `commitBySha` and `commitsByPr` indexes from the outer `allCommitRows` (before the LLM call)
- Add `linked_commits`/`linked_prs` to each jira_detail by scanning `allCommitRows` for key references
- Change `_v: 2` → `_v: 3` in both cache read and cache write
- Remove the `devData` variable (was "developer stats" section; replaced by full commit data)

```typescript
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

  // Build indexes for enrichment (used after LLM response)
  const commitBySha = new Map<string, any>(
    allCommitRows.map((c: any) => [c.commit_sha, c]),
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
    const entry = commitsByJiraKey.get(key) ?? { commits: 0, prs: new Set() };
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

      // Enrich a single Jira key into a full detail object including commit stats
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

      const enrichedGroups = Array.isArray(p.groups)
        ? p.groups.map((g: any) => ({
            name: g.name,
            jira_details: (g.jira_keys || []).map(enrichKey),
          }))
        : [];

      return {
        ...p,
        jira_count: Array.isArray(p.jira_keys) ? p.jira_keys.length : 0,
        jira_details: Array.isArray(p.jira_keys) ? p.jira_keys.map(enrichKey) : [],
        groups: enrichedGroups,
        commits: projCommits.map((c: any) => ({
          sha: c.commit_sha?.slice(0, 7),
          repo: c.repo, msg: c.msg, pr: c.pr_number, login: c.github_login,
          added: Number(c.lines_added ?? 0), removed: Number(c.lines_removed ?? 0),
        })),
        prs: projPrs,
      };
    });

    // Also compute "Other" totals: jiras/PRs not attributed to any project
    const attributedJiraKeys = new Set(enrichedProjects.flatMap((p: any) => p.jira_keys ?? []));
    const attributedPrNums = new Set(enrichedProjects.flatMap((p: any) => p.pr_numbers ?? []).map(Number));
    const otherTotals = {
      jiras: jiraRows.filter((r: any) => !attributedJiraKeys.has(r.issue_key)).length,
      prs: [...prSummaryMap.keys()].filter(pr => !attributedPrNums.has(pr)).length,
    };

    const toCache = { _v: INSIGHTS_CACHE_VERSION, projects: enrichedProjects, untracked_work: parsed.untracked_work || [], otherTotals };
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
      totals,
      cached: false,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withRequestLog(getHandler);
```

- [ ] **Step 2: Run tests**

```bash
npm test --no-coverage
```

Expected: All tests pass. The route has no unit tests so no new failures. TypeScript should compile clean.

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v " 2\.ts"
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/project-insights/route.ts
git commit -m "feat(glook-25): productionize project-insights route — full commit/PR context, linked stats, _v:3"
```

---

### Task 2: Inline expand with 3-tab drill-down in `ProjectsCard.tsx`

**Files:**
- Modify: `src/components/ProjectsCard.tsx`

**Context:** `ProjectsCard` is a `'use client'` component used on both the home page (standalone) and the team page (collapsible). `ProjectsBody` renders the project list. After this task, each project row is clickable to expand an inline panel with three tabs: **Jiras** (grouped by epic) / **PRs** / **Commits**.

The component needs `useState` (for which project is expanded and which tab is active) and `useMemo` (already imported from GLOOK-23).

`ProjectsCardItem` already has `estimated_prs`, `jira_count`, `estimated_commits` from GLOOK-23. The new fields `jira_details`, `groups`, `prs`, `commits` are optional — existing callers (team page) won't pass them and the expand panel simply won't appear.

- [ ] **Step 1: Add new type definitions**

At the top of `src/components/ProjectsCard.tsx`, after the existing imports, add:

```typescript
export interface JiraDetail {
  key: string;
  summary: string | null;
  type: string | null;
  assignee: string | null;
  linked_commits?: number;
  linked_prs?: number;
}

export interface ProjectGroup {
  name: string;
  jira_details: JiraDetail[];
}

export interface PrDetail {
  pr: number;
  repo: string;
  login: string;
  msg: string;
  commits: number;
  added: number;
  removed: number;
}

export interface CommitDetail {
  sha: string;
  repo: string;
  msg: string;
  pr: number | null;
  login: string;
  added: number;
  removed: number;
}
```

Add optional fields to `ProjectsCardItem`:

```typescript
export interface ProjectsCardItem {
  name: string;
  summary: string;
  developers: string[];
  jira_count: number;
  estimated_commits: number;
  estimated_prs: number;
  last_activity?: string;
  jira_details?: JiraDetail[];
  groups?: ProjectGroup[];
  prs?: PrDetail[];
  commits?: CommitDetail[];
}
```

- [ ] **Step 2: Add expand state and tab state to `ProjectsBody`**

`ProjectsBody` is a plain function (no hooks). Add `useState` for `expandedIdx` and `activeTab`:

```typescript
function ProjectsBody({
  projects,
  loading,
  emptyMessage,
  developerHref,
  variant,
  actualTotals,
}: { /* same as before */ }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'jiras' | 'prs' | 'commits'>('jiras');
  // ... rest of the function
```

`useState` is NOT yet imported in `ProjectsCard.tsx` — add it. Change the existing import line from:
```typescript
import { useMemo } from 'react';
```
to:
```typescript
import { useState, useMemo } from 'react';
```

- [ ] **Step 3: Make project rows expandable and add the drill-down panel**

Inside `sorted.map((p, i) => { ... })`, replace the current row `<div>` with:

```tsx
{sorted.map((p, i) => {
  const ago = timeAgo((p as TeamProject).last_activity);
  const totalVol = p.estimated_prs + p.jira_count + p.estimated_commits;
  const barPct = (totalVol / maxVolume) * 100;
  const isExpanded = expandedIdx === i;
  const hasDetail = !!(p.jira_details?.length || p.prs?.length || p.commits?.length);
  return (
    <div key={`${p.name}-${i}`}>
      {/* Project row — clickable if detail data is present */}
      <div
        className={`bg-white/[0.02] rounded-lg p-3 ${hasDetail ? 'cursor-pointer hover:bg-white/[0.035] transition-colors' : ''} ${isExpanded ? 'rounded-b-none' : ''}`}
        onClick={() => {
          if (!hasDetail) return;
          if (isExpanded) { setExpandedIdx(null); } else { setExpandedIdx(i); setActiveTab('jiras'); }
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-gray-600 w-4 shrink-0 text-right">{i + 1}</span>
            <span className="text-sm font-semibold text-white">{p.name}</span>
            {hasDetail && (
              <span className="text-gray-700 text-[10px] ml-1 transition-transform" style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 text-[11px] text-gray-500">
            <span>{p.jira_count} jiras</span>
            <span>~{p.estimated_commits} commits</span>
            <span>~{p.estimated_prs} PRs</span>
            {ago && <span className="text-gray-600">· {ago}</span>}
          </div>
        </div>

        {totalVol > 0 && (
          <div className="pl-6 mb-1.5">
            <div
              className="h-[5px] rounded-sm overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.05)' }}
              role="img"
              aria-label={`Volume: ${p.estimated_prs} PRs, ${p.jira_count} Jiras, ${p.estimated_commits} commits`}
            >
              <div className="h-full flex" style={{ width: `${barPct}%` }}>
                <div style={{ flex: p.estimated_prs, background: SEGMENT_COLORS.prs }} />
                <div style={{ flex: p.jira_count, background: SEGMENT_COLORS.jiras }} />
                <div style={{ flex: p.estimated_commits, background: SEGMENT_COLORS.commits }} />
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 pl-6 mb-1.5">{p.summary}</p>
        <div className="flex gap-1 pl-6 flex-wrap">
          {p.developers.map(d =>
            developerHref ? (
              <a key={d} href={developerHref(d)} className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity" style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>@{d}</a>
            ) : (
              <span key={d} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>@{d}</span>
            ),
          )}
        </div>
      </div>

      {/* Inline expand panel */}
      {isExpanded && hasDetail && (
        <div className="bg-white/[0.015] rounded-b-lg border-t border-white/[0.04] px-4 pb-4 pt-3">
          {/* Tabs */}
          <div className="flex gap-0 mb-3 border-b border-white/[0.07]">
            {(['jiras', 'prs', 'commits'] as const).map(tab => {
              const count = tab === 'jiras' ? (p.jira_details?.length ?? 0) : tab === 'prs' ? (p.prs?.length ?? 0) : (p.commits?.length ?? 0);
              if (count === 0) return null;
              return (
                <button
                  key={tab}
                  onClick={e => { e.stopPropagation(); setActiveTab(tab); }}
                  className={`text-[10px] px-3 pb-2 pt-1 border-b-2 -mb-px transition-colors ${activeTab === tab ? 'text-white border-accent' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
                >
                  {tab === 'jiras' ? 'Jiras' : tab === 'prs' ? 'PRs' : 'Commits'} ({count})
                </button>
              );
            })}
          </div>

          {/* Jiras tab */}
          {activeTab === 'jiras' && (
            <div className="space-y-3">
              {(p.groups?.length ? p.groups : [{ name: '', jira_details: p.jira_details ?? [] }]).map((g, gi) => (
                <div key={gi}>
                  {g.name && <p className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1.5">{g.name}</p>}
                  <div className="space-y-0">
                    {g.jira_details.slice(0, 8).map(j => (
                      <div key={j.key} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                        <span className="font-mono text-accent text-[9.5px] w-20 shrink-0">{j.key}</span>
                        <span className="text-gray-400 text-[10.5px] flex-1 truncate">{j.summary}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[9px] text-gray-600">{j.assignee ? `@${j.assignee.slice(0,8)}` : ''}</span>
                          {(j.linked_commits ?? 0) > 0 && (
                            <span className="text-[9px] font-mono bg-cyan-500/10 text-cyan-400 rounded px-1.5 py-0.5">{j.linked_commits}c&nbsp;{j.linked_prs}pr</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {g.jira_details.length > 8 && <p className="text-[9px] text-gray-700 pt-1">+ {g.jira_details.length - 8} more</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PRs tab */}
          {activeTab === 'prs' && (
            <div className="space-y-0">
              {(p.prs ?? []).slice(0, 12).map(pr => (
                <div key={pr.pr} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                  <span className="font-mono text-cyan-400 text-[9.5px] w-10 shrink-0">#{pr.pr}</span>
                  <span className="text-gray-400 text-[10.5px] flex-1 truncate">{pr.msg}</span>
                  <div className="flex items-center gap-1.5 shrink-0 text-[9px]">
                    <span className="text-gray-600">{pr.repo.split('/').pop()?.slice(0, 14)}</span>
                    <span className="text-gray-600">{pr.commits}c</span>
                    <span className="text-green-500/80">+{pr.added}</span>
                    <span className="text-red-500/80">-{pr.removed}</span>
                  </div>
                </div>
              ))}
              {(p.prs ?? []).length > 12 && <p className="text-[9px] text-gray-700 pt-1">+ {(p.prs ?? []).length - 12} more</p>}
            </div>
          )}

          {/* Commits tab */}
          {activeTab === 'commits' && (
            <div className="space-y-0">
              {(p.commits ?? []).slice(0, 12).map(c => (
                <div key={c.sha} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                  <span className="font-mono text-cyan-400 text-[9.5px] w-12 shrink-0">{c.sha}</span>
                  {c.pr && <span className="text-cyan-400/60 text-[9px] shrink-0">#{c.pr}</span>}
                  <span className="text-gray-400 text-[10.5px] flex-1 truncate">{c.msg}</span>
                  <div className="flex items-center gap-1.5 shrink-0 text-[9px]">
                    <span className="text-gray-600">{c.repo.split('/').pop()?.slice(0, 14)}</span>
                    <span className="text-green-500/80">+{c.added}</span>
                    <span className="text-red-500/80">-{c.removed}</span>
                  </div>
                </div>
              ))}
              {(p.commits ?? []).length > 12 && <p className="text-[9px] text-gray-700 pt-1">+ {(p.commits ?? []).length - 12} more</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 4: Run tests**

```bash
npm test --no-coverage
```

Expected: All tests pass.

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v " 2\.ts"
```

Expected: No TypeScript errors.

- [ ] **Step 5: Start local container and verify in browser**

Rebuild and restart the local container (native ARM build for Mac):

```bash
rsync -a --exclude='.next' --exclude='node_modules' --exclude='.git' --exclude='glooker.db' /Users/msogin/Desktop/claudecode/glooker/ /tmp/glooker-build/
podman build -t localhost/glooker_app:latest /tmp/glooker-build/
podman rm -f glooker_app_1
# run with same env vars as before
```

Open **http://localhost:3000** and:
- Verify project cards on the home page still sort by PRs+Jiras with volume bars ✓
- Click "AI Translation" project → inline panel opens with tabs
- Click **Jiras** tab → grouped by epic theme, cyan `2c 1pr` badges on issues with commits
- Click **PRs** tab → list of PR numbers with repo, commit count, lines changed
- Click **Commits** tab → list of commits with SHA, message, PR badge if linked
- Click the row again → panel closes
- Verify team page Current Projects card still works (no expand — `jira_details` absent)

- [ ] **Step 6: Commit**

```bash
git add src/components/ProjectsCard.tsx
git commit -m "feat(glook-25): inline drill-down with Jiras/PRs/Commits tabs on project cards"
```
