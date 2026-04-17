# Team Pulse Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-generated team pulse summary that shows activity changes, silent members, team focus, and alerts when a team filter is selected on the Team Summary page.

**Architecture:** New `src/lib/team-pulse/` module with data extraction (SQL), prompt building, and LLM service. Cached per (report_id, team_name) in a new DB table. API endpoint at `/api/report/[id]/team-pulse`. TeamPulseCard component on the Team Summary page, triggered by team filter + admin + period >= 14 days.

**Tech Stack:** TypeScript, MySQL/SQLite, OpenAI-compatible LLM via existing `llm-provider.ts`, SWR for frontend fetching, Tailwind CSS

---

### Task 1: Database Migration

**Files:**
- Modify: `src/lib/db/sqlite.ts`
- Modify: `src/lib/db/mysql.ts`

- [ ] **Step 1: Add SQLite table creation**

In `src/lib/db/sqlite.ts`, in the `SCHEMA` constant string (before the closing backtick), add:

```sql
CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    TEXT    NOT NULL,
  team_name    TEXT    NOT NULL,
  org          TEXT    NOT NULL,
  summary_text TEXT    NOT NULL,
  health_json  TEXT    NOT NULL,
  generated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, team_name)
);
```

- [ ] **Step 2: Add MySQL table creation**

In `src/lib/db/mysql.ts`, add a new schema constant and pool.execute call (same pattern as `EPIC_SUMMARIES_SCHEMA`):

```typescript
const TEAM_PULSE_SCHEMA = `
CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  report_id    VARCHAR(36)  NOT NULL,
  team_name    VARCHAR(255) NOT NULL,
  org          VARCHAR(255) NOT NULL,
  summary_text TEXT         NOT NULL,
  health_json  TEXT         NOT NULL,
  generated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_team_pulse (report_id, team_name)
);
`;
```

Add the execution after the existing table creations:

```typescript
pool.execute(TEAM_PULSE_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create team_pulse_summaries table:', err);
});
```

Also add `team_pulse_summaries` to the `conflictCols` map in `sqlite.ts`'s `translateSQL` function:

```typescript
team_pulse_summaries: 'report_id, team_name',
```

- [ ] **Step 3: Verify migration runs**

Run: `rm -f glooker.db && npm run dev` — check no errors. Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/sqlite.ts src/lib/db/mysql.ts
git commit -m "feat(team-pulse): add team_pulse_summaries table"
```

---

### Task 2: Create Prompt Template

**Files:**
- Create: `prompts/team-pulse-system.txt`

- [ ] **Step 1: Create the system prompt**

Create `prompts/team-pulse-system.txt`:

```
You are a concise engineering team lead assistant generating a daily pulse summary.

RULES:
- ONLY use data provided below. Do NOT infer, hallucinate, or add any data not explicitly given.
- Use @handles for developers.
- Be direct and scannable — short bullets, no fluff, no emoji.
- Compare individuals against their own prior-window baseline AND the team average where relevant.
- Flag anything >2x or <0.5x baseline.
- Keep under 350 words total.

OUTPUT STRUCTURE (use these exact headings):

## Activity Changes
Brief bullets: who's up, who's down, by how much, in what area.

## Silent Members
Who had zero commits in the current window. Note if they have review activity or other context.

## Team Focus (Past 2 Days)
- Projects/repos being worked on
- Type of work: features vs bugs vs infra vs docs
- PRs merged, Jira tickets resolved (if any)

## Alerts
Actionable items only. One line each. Flag: sudden silence, >3x surges (burnout risk), zero Jira completion, large diffs that need review.

TEAM: {{TEAM_NAME}}
WINDOW: {{CURRENT_WINDOW}} (current) vs {{PRIOR_WINDOW}} (prior)
TEAM AVERAGES (current window): {{TEAM_AVG_COMMITS}} commits, {{TEAM_AVG_PRS}} PRs per active member ({{ACTIVE_COUNT}} of {{TOTAL_COUNT}} active)

PER-MEMBER DATA:
{{MEMBER_DATA}}
```

- [ ] **Step 2: Commit**

```bash
git add prompts/team-pulse-system.txt
git commit -m "feat(team-pulse): add system prompt template"
```

---

### Task 3: Data Extraction Module

**Files:**
- Create: `src/lib/team-pulse/data.ts`
- Create: `src/lib/__tests__/unit/team-pulse-data.test.ts`

- [ ] **Step 1: Write tests for working day computation**

Create `src/lib/__tests__/unit/team-pulse-data.test.ts`:

```typescript
import { getWorkingDays } from '@/lib/team-pulse/data';

describe('getWorkingDays', () => {
  it('returns 4 working days ending before a Sunday', () => {
    // Apr 13 2026 is a Sunday
    const days = getWorkingDays(new Date('2026-04-13T00:00:00'), 4);
    expect(days).toEqual(['2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']);
  });

  it('returns 4 working days ending before a Saturday', () => {
    // Apr 11 2026 is a Saturday
    const days = getWorkingDays(new Date('2026-04-11T00:00:00'), 4);
    expect(days).toEqual(['2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']);
  });

  it('returns 4 working days ending before a Friday', () => {
    // Apr 10 2026 is a Friday (Thu)
    const days = getWorkingDays(new Date('2026-04-10T00:00:00'), 4);
    expect(days).toEqual(['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09']);
  });

  it('skips weekends', () => {
    // Apr 7 2026 is a Monday
    const days = getWorkingDays(new Date('2026-04-07T00:00:00'), 4);
    // Goes back: Apr 3 (Thu), Apr 2 (Wed), Apr 1 (Tue), Mar 31 (Mon)
    expect(days).toEqual(['2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="team-pulse-data"` — expected: FAIL (module not found).

- [ ] **Step 3: Implement the data module**

Create `src/lib/team-pulse/data.ts`:

```typescript
import db from '@/lib/db';

export interface MemberDayData {
  commits: number;
  prs: number;
  linesAdded: number;
  linesRemoved: number;
  avgComplexity: number;
  types: string;
  repos: string;
}

export interface MemberJiraData {
  issues: number;
  storyPoints: number;
}

export interface MemberWindowData {
  current: { commits: number; prs: number; linesAdded: number; linesRemoved: number; jiraIssues: number; storyPoints: number };
  prior: { commits: number; prs: number; linesAdded: number; linesRemoved: number; jiraIssues: number; storyPoints: number };
  currentRepos: string[];
  currentTypes: string[];
  totalReviews: number;
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
}

export function getWorkingDays(endDate: Date, count: number): string[] {
  const days: string[] = [];
  const d = new Date(endDate);
  while (days.length < count) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().split('T')[0]);
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
  const allDaysStr = allDays.map(d => `'${d}'`).join(',');
  const membersStr = teamMembers.map(m => `'${m}'`).join(',');

  // Commit data per member per day
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
    WHERE report_id = ? AND github_login IN (${membersStr}) AND DATE(committed_at) IN (${allDaysStr})
    GROUP BY github_login, DATE(committed_at)`,
    [reportId],
  ) as [any[], any];

  // Jira data per member per day
  const [jiraRows] = await db.execute(
    `SELECT github_login, DATE(resolved_at) as day, COUNT(*) as issues,
      COALESCE(SUM(story_points), 0) as story_points
    FROM jira_issues
    WHERE report_id = ? AND github_login IN (${membersStr}) AND DATE(resolved_at) IN (${allDaysStr})
    GROUP BY github_login, DATE(resolved_at)`,
    [reportId],
  ) as [any[], any];

  // Reviews per member (report-period total)
  const [reviewRows] = await db.execute(
    `SELECT github_login, total_reviews
    FROM developer_stats
    WHERE report_id = ? AND github_login IN (${membersStr})`,
    [reportId],
  ) as [any[], any];

  const reviewMap = new Map<string, number>();
  for (const r of reviewRows) reviewMap.set(r.github_login, Number(r.total_reviews) || 0);

  // Build per-day lookup
  const commitByMemberDay = new Map<string, Map<string, any>>();
  for (const row of commitRows) {
    if (!commitByMemberDay.has(row.github_login)) commitByMemberDay.set(row.github_login, new Map());
    commitByMemberDay.get(row.github_login)!.set(row.day, row);
  }

  const jiraByMemberDay = new Map<string, Map<string, any>>();
  for (const row of jiraRows) {
    if (!jiraByMemberDay.has(row.github_login)) jiraByMemberDay.set(row.github_login, new Map());
    jiraByMemberDay.get(row.github_login)!.set(row.day, row);
  }

  // Aggregate per member
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
      if (j) {
        current.jiraIssues += Number(j.issues);
        current.storyPoints += Number(j.story_points);
      }
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
      if (j) {
        prior.jiraIssues += Number(j.issues);
        prior.storyPoints += Number(j.story_points);
      }
    }

    members.set(login, {
      current,
      prior,
      currentRepos: [...reposSet],
      currentTypes: [...typesSet],
      totalReviews: reviewMap.get(login) || 0,
    });
  }

  // Team health indicators
  const activeMembers = [...members.entries()].filter(([, m]) => m.current.commits > 0);
  const activeCount = activeMembers.length;
  const totalCount = teamMembers.length;
  const teamAvgCommits = activeCount > 0
    ? Math.round(activeMembers.reduce((s, [, m]) => s + m.current.commits, 0) / activeCount * 10) / 10
    : 0;
  const teamAvgPrs = activeCount > 0
    ? Math.round(activeMembers.reduce((s, [, m]) => s + m.current.prs, 0) / activeCount * 10) / 10
    : 0;

  const totalCurrentCommits = [...members.values()].reduce((s, m) => s + m.current.commits, 0);
  const totalPriorCommits = [...members.values()].reduce((s, m) => s + m.prior.commits, 0);
  const trendingPct = totalPriorCommits > 0
    ? Math.round(((totalCurrentCommits - totalPriorCommits) / totalPriorCommits) * 100)
    : totalCurrentCommits > 0 ? 100 : 0;
  const trendDirection = trendingPct > 5 ? 'up' : trendingPct < -5 ? 'down' : 'stable';

  return {
    teamName: '', // Set by caller
    members,
    currentDays,
    priorDays,
    teamAvgCommits,
    teamAvgPrs,
    activeCount,
    totalCount,
    trendingPct,
    trendDirection,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest --testPathPatterns="team-pulse-data"` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-pulse/data.ts src/lib/__tests__/unit/team-pulse-data.test.ts
git commit -m "feat(team-pulse): add data extraction module with working day computation"
```

---

### Task 4: Prompt Builder

**Files:**
- Create: `src/lib/team-pulse/prompt.ts`

- [ ] **Step 1: Create the prompt builder**

Create `src/lib/team-pulse/prompt.ts`:

```typescript
import type { TeamPulseData } from './data';

export function buildTeamPulsePrompt(data: TeamPulseData): string {
  const lines: string[] = [];

  for (const [login, m] of data.members) {
    lines.push(`@${login}`);

    const cur = m.current;
    const pri = m.prior;

    if (cur.commits === 0 && pri.commits === 0) {
      lines.push(`  Current: NO ACTIVITY`);
      lines.push(`  Prior: NO ACTIVITY`);
      if (m.totalReviews > 0) lines.push(`  Context: ${m.totalReviews} PR reviews this report period.`);
    } else if (cur.commits === 0) {
      lines.push(`  Current: NO ACTIVITY`);
      lines.push(`  Prior: ${pri.commits} commits, ${pri.prs} PRs, +${pri.linesAdded}/-${pri.linesRemoved} lines`);
      lines.push(`  Delta: went silent.`);
      if (m.totalReviews > 0) lines.push(`  Context: ${m.totalReviews} PR reviews this report period.`);
    } else if (pri.commits === 0) {
      lines.push(`  Current: ${cur.commits} commits, ${cur.prs} PRs, +${cur.linesAdded}/-${cur.linesRemoved} lines | Repos: ${m.currentRepos.join(', ') || '—'} | Types: ${m.currentTypes.join(', ') || '—'}`);
      lines.push(`  Prior: NO ACTIVITY`);
      lines.push(`  Delta: returned from inactivity.`);
    } else {
      const commitDelta = Math.round(((cur.commits - pri.commits) / pri.commits) * 100);
      const prDelta = pri.prs > 0 ? Math.round(((cur.prs - pri.prs) / pri.prs) * 100) : cur.prs > 0 ? 100 : 0;
      lines.push(`  Current: ${cur.commits} commits, ${cur.prs} PRs, +${cur.linesAdded}/-${cur.linesRemoved} lines | Repos: ${m.currentRepos.join(', ') || '—'} | Types: ${m.currentTypes.join(', ') || '—'}`);
      lines.push(`  Prior: ${pri.commits} commits, ${pri.prs} PRs, +${pri.linesAdded}/-${pri.linesRemoved} lines`);
      lines.push(`  Delta: commits ${commitDelta >= 0 ? '+' : ''}${commitDelta}%, PRs ${prDelta >= 0 ? '+' : ''}${prDelta}%.`);
    }

    if (cur.jiraIssues > 0 || pri.jiraIssues > 0) {
      lines.push(`  Jira: ${cur.jiraIssues} resolved (current), ${pri.jiraIssues} resolved (prior). SP: ${cur.storyPoints}.`);
    }

    lines.push('');
  }

  const formatDays = (days: string[]) => days.map(d => {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }).join(', ');

  return JSON.stringify({
    TEAM_NAME: data.teamName,
    CURRENT_WINDOW: formatDays(data.currentDays),
    PRIOR_WINDOW: formatDays(data.priorDays),
    TEAM_AVG_COMMITS: String(data.teamAvgCommits),
    TEAM_AVG_PRS: String(data.teamAvgPrs),
    ACTIVE_COUNT: String(data.activeCount),
    TOTAL_COUNT: String(data.totalCount),
    MEMBER_DATA: lines.join('\n'),
  });
}
```

Note: this returns a JSON string of template variables, not the final prompt. The service will call `loadPrompt('team-pulse-system.txt', JSON.parse(vars))`.

- [ ] **Step 2: Commit**

```bash
git add src/lib/team-pulse/prompt.ts
git commit -m "feat(team-pulse): add prompt builder"
```

---

### Task 5: Service — Orchestration, LLM Call, Caching

**Files:**
- Create: `src/lib/team-pulse/service.ts`
- Create: `src/lib/team-pulse/index.ts`

- [ ] **Step 1: Create the service**

Create `src/lib/team-pulse/service.ts`:

```typescript
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import { extractTeamPulseData } from './data';
import { buildTeamPulsePrompt } from './prompt';

export interface TeamPulseResult {
  summary: string;
  health: {
    activeRatio: string;
    trending: string;
    trendDirection: 'up' | 'down' | 'stable';
  };
  generatedAt: string;
  cached: boolean;
}

export async function getTeamPulse(
  reportId: string,
  teamName: string,
  org: string,
  teamMembers: string[],
): Promise<TeamPulseResult> {
  // Check cache
  const [cached] = await db.execute(
    `SELECT summary_text, health_json, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ?`,
    [reportId, teamName],
  ) as [any[], any];

  if (cached.length > 0) {
    const row = cached[0];
    const health = typeof row.health_json === 'string' ? JSON.parse(row.health_json) : row.health_json;
    return {
      summary: row.summary_text,
      health,
      generatedAt: row.generated_at,
      cached: true,
    };
  }

  // Get report end date
  const [reportRows] = await db.execute(
    `SELECT created_at, period_days FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];

  if (!reportRows.length) throw new Error('Report not found');
  const reportEndDate = new Date(reportRows[0].created_at);

  // Extract data
  const data = await extractTeamPulseData(reportId, teamMembers, reportEndDate);
  data.teamName = teamName;

  // Build prompt
  const vars = JSON.parse(buildTeamPulsePrompt(data));
  const systemPrompt = loadPrompt('team-pulse-system.txt', vars);

  // Call LLM
  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.5,
    ...tokenLimit(1024),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the team pulse summary based on the data provided in the system prompt.' },
    ],
    ...extraBodyProps(),
    ...promptTag('team-pulse-system'),
  } as any);

  const summary = response.choices[0]?.message?.content || '';

  // Build health indicators
  const health = {
    activeRatio: `${data.activeCount}/${data.totalCount}`,
    trending: `${data.trendingPct >= 0 ? '+' : ''}${data.trendingPct}%`,
    trendDirection: data.trendDirection,
  };

  // Cache
  await db.execute(
    `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), generated_at = NOW()`,
    [reportId, teamName, org, summary, JSON.stringify(health)],
  );

  return { summary, health, generatedAt: new Date().toISOString(), cached: false };
}
```

- [ ] **Step 2: Create the index module**

Create `src/lib/team-pulse/index.ts`:

```typescript
export { getTeamPulse } from './service';
export type { TeamPulseResult } from './service';
export { getWorkingDays, extractTeamPulseData } from './data';
export { buildTeamPulsePrompt } from './prompt';
```

- [ ] **Step 3: Build and verify**

Run: `npm run build` — should compile.

- [ ] **Step 4: Commit**

```bash
git add src/lib/team-pulse/service.ts src/lib/team-pulse/index.ts
git commit -m "feat(team-pulse): add service with LLM call and caching"
```

---

### Task 6: API Endpoint

**Files:**
- Create: `src/app/api/report/[id]/team-pulse/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/report/[id]/team-pulse/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { getTeamPulse } from '@/lib/team-pulse';
import db from '@/lib/db';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const team = req.nextUrl.searchParams.get('team');
  const org = req.nextUrl.searchParams.get('org');

  if (!team || !org) {
    return NextResponse.json({ error: 'team and org query params required' }, { status: 400 });
  }

  // Check report period
  const [reportRows] = await db.execute(
    `SELECT period_days FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];

  if (!reportRows.length) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  if (reportRows[0].period_days < 14) {
    return NextResponse.json({ error: 'Report period must be at least 14 days for team pulse' }, { status: 400 });
  }

  // Get team members
  const [memberRows] = await db.execute(
    `SELECT tm.github_login
     FROM team_members tm
     JOIN teams t ON tm.team_id = t.id
     WHERE t.name = ? AND t.org = ?`,
    [team, org],
  ) as [any[], any];

  if (!memberRows.length) {
    return NextResponse.json({ error: 'Team not found or has no members' }, { status: 404 });
  }

  const members = memberRows.map((r: any) => r.github_login);

  try {
    const result = await getTeamPulse(id, team, org, members);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to generate team pulse: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
```

- [ ] **Step 2: Build and verify**

Run: `npm run build` — should compile.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/report/[id]/team-pulse/route.ts"
git commit -m "feat(team-pulse): add API endpoint"
```

---

### Task 7: TeamPulseCard UI Component

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`

- [ ] **Step 1: Add team name state and capture from filter**

The team filter currently sets `filterLogins` but doesn't track which team was selected. Add state to track the selected team name:

```typescript
const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
```

Update the team filter `onChange` to also capture the team name:

```typescript
onChange={e => {
  const team = teams.find(t => t.id === e.target.value);
  if (team) {
    setFilterLogins(new Set(team.members));
    setSelectedTeamName(team.name);
  }
  e.target.value = '';
}}
```

Also clear the team name when filters are cleared:

```typescript
// In the "Clear all" button:
onClick={() => { setFilterLogins(new Set()); setSelectedTeamName(null); }}
```

- [ ] **Step 2: Add the TeamPulseCard component**

Add this component inside the same file (after the imports, before the main export):

```typescript
import useSWR from 'swr'; // already imported
import { useAuth } from '@/app/auth-context'; // add if not present

function TeamPulseCard({ reportId, teamName, org, periodDays }: {
  reportId: string;
  teamName: string;
  org: string;
  periodDays: number;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(`team-pulse-collapsed-${teamName}`) === 'true';
    }
    return false;
  });

  const { data, isLoading, error } = useSWR(
    periodDays >= 14
      ? `/api/report/${reportId}/team-pulse?team=${encodeURIComponent(teamName)}&org=${encodeURIComponent(org)}`
      : null,
    { revalidateIfStale: false },
  );

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    sessionStorage.setItem(`team-pulse-collapsed-${teamName}`, String(next));
  };

  if (!data && !isLoading && !error) return null;

  const trendColor = data?.health?.trendDirection === 'up' ? 'text-green-400'
    : data?.health?.trendDirection === 'down' ? 'text-red-400'
    : 'text-gray-500';

  const trendArrow = data?.health?.trendDirection === 'up' ? '▲'
    : data?.health?.trendDirection === 'down' ? '▼'
    : '—';

  return (
    <div className="bg-gray-900 rounded-xl mb-4 overflow-hidden">
      <button
        onClick={toggleCollapse}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-semibold text-white">Team Pulse: {teamName}</span>
          {isLoading && <span className="text-xs text-gray-500 animate-pulse">Generating...</span>}
        </div>
        {data?.health && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">{data.health.activeRatio} active</span>
            <span className={trendColor}>{trendArrow} {data.health.trending}</span>
          </div>
        )}
      </button>
      {!collapsed && (
        <div className="px-5 pb-4 border-t border-gray-800">
          {isLoading && (
            <div className="py-6 text-center text-sm text-gray-500 animate-pulse">
              Generating team pulse...
            </div>
          )}
          {error && (
            <div className="py-4 text-center text-sm text-red-400">
              Failed to generate summary
            </div>
          )}
          {data?.summary && (
            <div className="prose prose-invert prose-sm max-w-none mt-3 text-sm text-gray-300 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderPulseMarkdown(data.summary) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function renderPulseMarkdown(md: string): string {
  return md
    .replace(/^## (.+)$/gm, '<h3 class="text-xs font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">$1</h3>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-gray-300 mb-1">$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/@(\w[\w-]*)/g, '<span class="text-accent-light font-medium">@$1</span>')
    .replace(/\n/g, '');
}
```

- [ ] **Step 3: Render the card when conditions are met**

In the TeamSummaryPage JSX, after the filter section and before the developer table, add:

```tsx
{/* Team Pulse */}
{canAct && selectedTeamName && activeReport && activeReport.period_days >= 14 && (
  <TeamPulseCard
    reportId={params.id}
    teamName={selectedTeamName}
    org={activeReport.org}
    periodDays={activeReport.period_days}
  />
)}
```

The `canAct` check requires importing `useAuth`:

```typescript
const { canAct } = useAuth();
```

- [ ] **Step 4: Build and verify**

Run: `npm run build` — should compile.

- [ ] **Step 5: Manual test**

Start the app, go to Team Summary, select a team from the filter dropdown. The pulse card should appear with a loading state, then show the LLM-generated summary.

- [ ] **Step 6: Commit**

```bash
git add "src/app/report/[id]/team/page.tsx"
git commit -m "feat(team-pulse): add TeamPulseCard to Team Summary page"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test` — all tests must pass.

- [ ] **Step 2: Run production build**

Run: `rm -rf .next && npm run build` — must compile cleanly.

- [ ] **Step 3: Manual smoke test**

1. Go to Team Summary for a 14-day report
2. Select a team filter → pulse card appears, generates summary
3. Navigate away and back → cached, instant render
4. Select a different team → new pulse generates
5. On a 3-day report → no pulse card (period too short)
6. As viewer (non-admin) → no pulse card
7. Without team filter → no pulse card

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "fix(team-pulse): fixups from smoke testing"
```
