# GLOOK-19: In-Flight Work in Current Projects Cards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add open PRs and bare-branch commits to both the per-team Current Projects LLM clustering (team page) and the org-wide project insights card (home page), so both cards reflect work in progress alongside shipped work.

**Architecture:** Extend `TeamProjectsInput` with two new in-flight fields; fetch them in `extractTeamProjectsData` via two new SQL queries; render a compact pipe-delimited block in `generateTeamProjects` and pass it as `{{IN_FLIGHT_BLOCK}}` to the updated prompt template. Home-page route gets parallel inline treatment with a `_v: 2` cache-version guard. Bump team-page `PROMPT_VERSION` to `'v4-inflight'` to invalidate old cache rows.

**Tech Stack:** TypeScript, Next.js 15, Jest + ts-jest, SQLite (dev) + MySQL (prod), existing `db.execute` + `loadPrompt` patterns.

---

## File Map

| File | Change |
|---|---|
| `src/lib/team-pulse/data.ts` | Add `TeamProjectInflightPr`, `TeamProjectInflightBranch` types; extend `TeamProjectsInput`; add 2 SQL queries in `extractTeamProjectsData` |
| `src/lib/team-pulse/projects.ts` | Add `renderInflightBlock`; update `generateTeamProjects` short-circuit + prompt call |
| `prompts/team-pulse-projects.txt` | Add `{{IN_FLIGHT_BLOCK}}` placeholder + in-flight rule |
| `src/lib/team-pulse/service.ts` | Bump `PROMPT_VERSION` to `'v4-inflight'` |
| `src/app/api/project-insights/route.ts` | Add 2 SQL queries; inline `renderInsightsInflightBlock`; add in-flight to prompt and user message; add `_v: 2` cache guard |
| `src/lib/__tests__/unit/team-projects-data.test.ts` | Add 2 mock calls to existing tests; add 3 new in-flight tests |
| `src/lib/__tests__/unit/team-projects-generator.test.ts` | Add `in_flight_prs`/`in_flight_branches` to `baseInput()`; add 2 new in-flight block tests |

---

### Task 1: Extend TeamProjectsInput and extractTeamProjectsData (TDD)

**Files:**
- Modify: `src/lib/team-pulse/data.ts:313-376`
- Modify: `src/lib/__tests__/unit/team-projects-data.test.ts`

**Context:** `extractTeamProjectsData` currently runs 2 SQL queries (commits + jira). After this task it runs 4. Existing tests mock exactly 2 calls via `mockResolvedValueOnce` — they will break unless we add 2 more empty stubs. The `beforeEach` calls `exec.mockReset()` with no default, so any un-stubbed call throws.

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `src/lib/__tests__/unit/team-projects-data.test.ts` with:

```typescript
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import db from '@/lib/db';
import { extractTeamProjectsData, type TeamProjectsInput } from '@/lib/team-pulse/data';

const exec = db.execute as jest.Mock;

beforeEach(() => exec.mockReset());

// Helper: stub all 4 DB calls with provided row arrays (default empty)
function stubCalls(
  commitRows: any[] = [],
  jiraRows: any[] = [],
  prRows: any[] = [],
  branchRows: any[] = [],
) {
  exec
    .mockResolvedValueOnce([commitRows, []])
    .mockResolvedValueOnce([jiraRows, []])
    .mockResolvedValueOnce([prRows, []])
    .mockResolvedValueOnce([branchRows, []]);
}

describe('extractTeamProjectsData', () => {
  it('returns empty input when team has no members', async () => {
    const result = await extractTeamProjectsData('r1', []);
    expect(result.commits).toEqual([]);
    expect(result.jira_issues).toEqual([]);
    expect(result.team_members).toEqual([]);
    expect(result.in_flight_prs).toEqual([]);
    expect(result.in_flight_branches).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('filters commits + jira to team members for this report', async () => {
    stubCalls(
      [
        { sha: 'aaa', repo: 'svc', pr_number: 1, commit_message: 'fix bug', github_login: 'alice', total_lines: 50, committed_at: '2026-05-20T10:00:00Z' },
        { sha: 'bbb', repo: 'svc', pr_number: null, commit_message: 'wip', github_login: 'bob', total_lines: 5, committed_at: '2026-05-21T10:00:00Z' },
      ],
      [{ issue_key: 'PROJ-1', project_key: 'PROJ', summary: 'Auth bug', github_login: 'alice', type: 'Bug', status: 'Done' }],
    );

    const result = await extractTeamProjectsData('r1', ['alice', 'bob']);

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].github_login).toBe('alice');
    expect(result.commits[0].message_first_line).toBe('fix bug');
    expect(result.commits[0].lines).toBe(50);
    expect(result.commits[1].lines).toBe(5);
    expect(result.jira_issues).toHaveLength(1);
    expect(result.team_members).toEqual(['alice', 'bob']);
    expect(result.in_flight_prs).toEqual([]);
    expect(result.in_flight_branches).toEqual([]);

    expect(exec).toHaveBeenCalledTimes(4);
    expect(exec.mock.calls[0][1][0]).toBe('r1');
    expect(exec.mock.calls[0][1].slice(1)).toEqual(['alice', 'bob']);
  });

  it('caps commits at 200 (most recent first)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      sha: `sha${i}`, repo: 'svc', pr_number: null,
      commit_message: `c${i}`, github_login: 'alice',
      total_lines: 1, committed_at: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    stubCalls(many);

    const result = await extractTeamProjectsData('r1', ['alice']);
    expect(result.commits).toHaveLength(200);
  });

  it('populates in_flight_prs with boolean is_draft coercion', async () => {
    stubCalls(
      [], // commits
      [], // jira
      [
        { repo: 'r1', title: 'Big feature', author: 'alice', additions: 300, deletions: 20, is_draft: 0 },
        { repo: 'r2', title: 'WIP: refactor', author: 'bob', additions: 50, deletions: 10, is_draft: 1 },
      ],
    );

    const result = await extractTeamProjectsData('r1', ['alice', 'bob']);

    expect(result.in_flight_prs).toHaveLength(2);
    expect(result.in_flight_prs[0]).toEqual({
      repo: 'r1', title: 'Big feature', author: 'alice',
      additions: 300, deletions: 20, is_draft: false,
    });
    expect(result.in_flight_prs[1]).toEqual({
      repo: 'r2', title: 'WIP: refactor', author: 'bob',
      additions: 50, deletions: 10, is_draft: true,
    });
  });

  it('populates in_flight_branches from bare unmerged commits', async () => {
    stubCalls(
      [], [], [], // commits, jira, prs empty
      [
        { repo: 'infra', branch: 'feat/k8s-autoscale', author: 'carol', commit_count: 7, lines: 240 },
      ],
    );

    const result = await extractTeamProjectsData('r1', ['carol']);

    expect(result.in_flight_branches).toHaveLength(1);
    expect(result.in_flight_branches[0]).toEqual({
      repo: 'infra', branch: 'feat/k8s-autoscale', author: 'carol',
      commit_count: 7, lines: 240,
    });
  });

  it('returns empty in_flight arrays when no in-flight data exists', async () => {
    stubCalls();
    const result = await extractTeamProjectsData('r1', ['alice']);
    expect(result.in_flight_prs).toEqual([]);
    expect(result.in_flight_branches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPatterns="team-projects-data" --no-coverage
```

Expected: Multiple FAIL — `in_flight_prs` and `in_flight_branches` not found on result (property doesn't exist yet).

- [ ] **Step 3: Add types and SQL to `src/lib/team-pulse/data.ts`**

After the `TeamProjectsInput` interface (line 317) and before `extractTeamProjectsData`, add the two new interfaces. Then update the existing interface and function:

```typescript
export interface TeamProjectInflightPr {
  repo: string;
  title: string;
  author: string;
  additions: number;
  deletions: number;
  is_draft: boolean;
}

export interface TeamProjectInflightBranch {
  repo: string;
  branch: string;
  author: string;
  commit_count: number;
  lines: number;
}

export interface TeamProjectsInput {
  commits: TeamProjectCommit[];
  jira_issues: TeamProjectJiraIssue[];
  team_members: string[];
  in_flight_prs: TeamProjectInflightPr[];
  in_flight_branches: TeamProjectInflightBranch[];
}
```

Update the early-return in `extractTeamProjectsData` (line 323–325):

```typescript
  if (teamMembers.length === 0) {
    return { commits: [], jira_issues: [], team_members: [], in_flight_prs: [], in_flight_branches: [] };
  }
```

After the existing `jiraRows` query (after line 352), add the two new queries:

```typescript
  const [prRows] = await db.execute(
    `SELECT repo,
            pr_title    AS title,
            github_login AS author,
            COALESCE(pr_additions, 0) AS additions,
            COALESCE(pr_deletions, 0) AS deletions,
            is_draft
       FROM unmerged_prs
      WHERE report_id = ? AND github_login IN (${placeholders})
      ORDER BY COALESCE(pr_additions, 0) + COALESCE(pr_deletions, 0) DESC
      LIMIT 30`,
    [reportId, ...teamMembers],
  ) as [any[], any];

  const [branchRows] = await db.execute(
    `SELECT repo,
            branch,
            github_login          AS author,
            COUNT(*)              AS commit_count,
            SUM(lines_added + lines_removed) AS lines
       FROM unmerged_commits
      WHERE report_id = ? AND github_login IN (${placeholders}) AND pr_number IS NULL
      GROUP BY repo, branch, github_login
      ORDER BY lines DESC
      LIMIT 10`,
    [reportId, ...teamMembers],
  ) as [any[], any];
```

Update the return statement (currently line 371–375):

```typescript
  return {
    commits,
    jira_issues: jiraRows as TeamProjectJiraIssue[],
    team_members: [...teamMembers],
    in_flight_prs: (prRows as any[]).map(r => ({
      repo: String(r.repo ?? ''),
      title: String(r.title ?? ''),
      author: String(r.author ?? ''),
      additions: Number(r.additions ?? 0),
      deletions: Number(r.deletions ?? 0),
      is_draft: r.is_draft === 1 || r.is_draft === true,
    })),
    in_flight_branches: (branchRows as any[]).map(r => ({
      repo: String(r.repo ?? ''),
      branch: String(r.branch ?? ''),
      author: String(r.author ?? ''),
      commit_count: Number(r.commit_count ?? 0),
      lines: Number(r.lines ?? 0),
    })),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="team-projects-data" --no-coverage
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-pulse/data.ts src/lib/__tests__/unit/team-projects-data.test.ts
git commit -m "feat(glook-19): extend TeamProjectsInput with in-flight types + SQL queries"
```

---

### Task 2: Add renderInflightBlock and update generateTeamProjects (TDD)

**Files:**
- Modify: `src/lib/team-pulse/projects.ts`
- Modify: `src/lib/__tests__/unit/team-projects-generator.test.ts`

**Context:** `generateTeamProjects` currently short-circuits to `[]` when `commits` and `jira_issues` are both empty. We extend the short-circuit to also check the new in-flight fields. We add `renderInflightBlock` (module-private function) and pass its output as `IN_FLIGHT_BLOCK` to `loadPrompt`. The `baseInput()` factory in the test file must be updated to include the new fields — existing tests still pass because they leave in-flight arrays empty.

- [ ] **Step 1: Update `baseInput()` and write new failing tests**

At the top of `src/lib/__tests__/unit/team-projects-generator.test.ts`, update `baseInput` and add two new tests at the end of the `describe` block:

Update `baseInput()` to include the new fields:

```typescript
const baseInput = (): TeamProjectsInput => ({
  team_members: ['alice', 'bob'],
  commits: [
    { sha: 'a1', repo: 'r1', pr_number: 1, message_first_line: 'feat: x',
      github_login: 'alice', lines: 10, committed_at: '2026-05-20T10:00:00Z' },
    { sha: 'b1', repo: 'r1', pr_number: 2, message_first_line: 'fix: y',
      github_login: 'bob',   lines: 5,  committed_at: '2026-05-21T11:00:00Z' },
  ],
  jira_issues: [],
  in_flight_prs: [],
  in_flight_branches: [],
});
```

Add two new tests inside `describe('generateTeamProjects', ...)`:

```typescript
  it('includes IN-FLIGHT WORK block in prompt when in-flight data is present', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [{ name: 'P1', summary: 's', developers: ['alice'],
        jira_count: 0, estimated_commits: 1, estimated_prs: 1,
        last_activity: '2026-05-20T10:00:00Z' }],
    })));

    const input: TeamProjectsInput = {
      ...baseInput(),
      in_flight_prs: [
        { repo: 'r1', title: 'Add jobs pagination', author: 'alice', additions: 120, deletions: 5, is_draft: false },
      ],
      in_flight_branches: [],
    };

    await generateTeamProjects(input);

    const callArgs = (mockGetLLMClient.mock.results[0].value as any).chat.completions.create.mock.calls[0][0];
    const systemPrompt: string = callArgs.messages[0].content;
    expect(systemPrompt).toContain('IN-FLIGHT WORK');
    expect(systemPrompt).toContain('Add jobs pagination');
    expect(systemPrompt).toContain('OPEN PRs (1)');
  });

  it('omits IN-FLIGHT WORK block when in_flight_prs and in_flight_branches are empty', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [{ name: 'P1', summary: 's', developers: ['alice'],
        jira_count: 0, estimated_commits: 1, estimated_prs: 1,
        last_activity: '2026-05-20T10:00:00Z' }],
    })));

    await generateTeamProjects(baseInput());

    const callArgs = (mockGetLLMClient.mock.results[0].value as any).chat.completions.create.mock.calls[0][0];
    const systemPrompt: string = callArgs.messages[0].content;
    expect(systemPrompt).not.toContain('IN-FLIGHT WORK');
  });
```

- [ ] **Step 2: Run test to verify new tests fail**

```bash
npm test -- --testPathPatterns="team-projects-generator" --no-coverage
```

Expected: The two new tests FAIL (TypeScript error on `baseInput` since `TeamProjectsInput` now requires `in_flight_prs`/`in_flight_branches`, and prompt doesn't contain `IN-FLIGHT WORK` yet). Existing tests should still pass once `baseInput` is updated.

- [ ] **Step 3: Add `renderInflightBlock` and update `generateTeamProjects` in `src/lib/team-pulse/projects.ts`**

Add the import for the new types at the top (update the existing import line):

```typescript
import type { TeamProjectsInput, TeamProjectInflightPr, TeamProjectInflightBranch } from './data';
```

Add `renderInflightBlock` as a module-private function before `generateTeamProjects`:

```typescript
function renderInflightBlock(
  prs: TeamProjectInflightPr[],
  branches: TeamProjectInflightBranch[],
): string {
  if (prs.length === 0 && branches.length === 0) return '';
  const lines: string[] = ['IN-FLIGHT WORK (open PRs + bare branches — not yet merged):'];
  if (prs.length > 0) {
    lines.push('', `OPEN PRs (${prs.length}):`, 'repo|pr_title|author|+additions/-deletions|draft');
    for (const pr of prs) {
      lines.push(`${pr.repo}|${pr.title}|${pr.author}|+${pr.additions}/-${pr.deletions}|${pr.is_draft ? 'yes' : 'no'}`);
    }
  }
  if (branches.length > 0) {
    lines.push('', `BARE BRANCHES (${branches.length}):`, 'repo|branch|author|commits|lines');
    for (const b of branches) {
      lines.push(`${b.repo}|${b.branch}|${b.author}|${b.commit_count}|${b.lines}`);
    }
  }
  return lines.join('\n');
}
```

Update the short-circuit check in `generateTeamProjects` (currently checks only `commits` and `jira_issues`):

```typescript
  if (data.commits.length === 0 && data.jira_issues.length === 0 &&
      data.in_flight_prs.length === 0 && data.in_flight_branches.length === 0) {
    return [];
  }
```

Update the `loadPrompt` call in `generateTeamProjects` to pass the in-flight block:

```typescript
  const inflightBlock = renderInflightBlock(data.in_flight_prs, data.in_flight_branches);
  const systemPrompt = loadPrompt('team-pulse-projects.txt', {
    TEAM_NAME: teamName,
    TEAM_MEMBERS_JSON: JSON.stringify(data.team_members),
    COMMITS_JSON: JSON.stringify(data.commits),
    JIRA_ISSUES_JSON: JSON.stringify(data.jira_issues),
    IN_FLIGHT_BLOCK: inflightBlock,
  });
```

- [ ] **Step 4: Run tests — expect one specific failure**

```bash
npm test -- --testPathPatterns="team-projects-generator" --no-coverage
```

Expected: 8 PASS, 1 FAIL — only `'includes IN-FLIGHT WORK block in prompt when in-flight data is present'` fails. This is correct: `loadPrompt` uses `text.replaceAll('{{IN_FLIGHT_BLOCK}}', value)`, so until Task 3 adds `{{IN_FLIGHT_BLOCK}}` to the template, passing the key has no effect and the rendered prompt never contains `IN-FLIGHT WORK`. The "omits" test passes because the rendered template also doesn't contain `IN-FLIGHT WORK` (same reason). Task 3 will fix the remaining failure.

- [ ] **Step 5: Run full test suite to confirm no regressions beyond the expected failure**

```bash
npm test --no-coverage
```

Expected: 1 FAIL (`includes IN-FLIGHT WORK`), all others pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team-pulse/projects.ts src/lib/__tests__/unit/team-projects-generator.test.ts
git commit -m "feat(glook-19): renderInflightBlock + update generateTeamProjects prompt call"
```

---

### Task 3: Update prompt template, bump PROMPT_VERSION, update snapshot

**Files:**
- Modify: `prompts/team-pulse-projects.txt`
- Modify: `src/lib/team-pulse/service.ts`
- Update snapshot: run `npm test -- --testPathPatterns="prompts" -u`

**Context:** `prompts/team-pulse-projects.txt` has a Jest snapshot test in `prompts.test.ts` that asserts the exact file content. After editing the template, run `npm test -- --testPathPatterns="prompts" -u` to accept the new snapshot. Review the diff to confirm only the expected additions appear.

- [ ] **Step 1: Update `prompts/team-pulse-projects.txt`**

Add one rule to the RULES section (after the `last_activity` rule, before "Output is a JSON object"):

```
- Use IN-FLIGHT WORK to enrich clusters — mix open PRs and bare branches into existing projects where they clearly belong. If in-flight work represents a coherent new thread with no committed counterpart, create a project for it. Draft PRs are included.
```

Add at the very end of the file (after `{{JIRA_ISSUES_JSON}}`):

```

{{IN_FLIGHT_BLOCK}}
```

The final lines of the file should look like:

```
JIRA ISSUES:
{{JIRA_ISSUES_JSON}}

{{IN_FLIGHT_BLOCK}}
```

- [ ] **Step 2: Bump PROMPT_VERSION in `src/lib/team-pulse/service.ts`**

Change line 9:

```typescript
const PROMPT_VERSION = 'v4-inflight';
```

- [ ] **Step 3: Update the prompt snapshot**

```bash
npm test -- --testPathPatterns="prompts" --no-coverage -u
```

Expected: Snapshot updated. Output shows `1 snapshot updated`.

- [ ] **Step 4: Verify the snapshot diff shows only expected additions**

```bash
git diff src/lib/__tests__/unit/__snapshots__/
```

The diff should show: the new rule line, the `{{IN_FLIGHT_BLOCK}}` placeholder, and nothing else.

- [ ] **Step 5: Run full test suite**

```bash
npm test --no-coverage
```

Expected: All tests pass, including the 2 new generator tests (now that `{{IN_FLIGHT_BLOCK}}` is in the template).

- [ ] **Step 6: Commit**

```bash
git add prompts/team-pulse-projects.txt src/lib/team-pulse/service.ts src/lib/__tests__/unit/__snapshots__/
git commit -m "feat(glook-19): update team-pulse-projects prompt with in-flight block, bump PROMPT_VERSION"
```

---

### Task 4: Update project-insights route (home page)

**Files:**
- Modify: `src/app/api/project-insights/route.ts`

**Context:** This route is self-contained — it has its own inline LLM prompt, its own SQL queries, and caches results in `report_comparisons` (keyed by `report_id_a = report_id_b = report.id`). We add a `_v: 2` cache-version guard: if cached data lacks `_v: 2`, it's treated as stale and regenerated. New results are stored with `_v: 2`. No shared types with the team-pulse layer — the render function is inlined in this file.

- [ ] **Step 1: Add `renderInsightsInflightBlock` helper function**

Add this function to `src/app/api/project-insights/route.ts`, directly before the `async function getHandler()` declaration:

```typescript
function renderInsightsInflightBlock(prs: any[], branches: any[]): string {
  if (prs.length === 0 && branches.length === 0) return '';
  const lines: string[] = ['\nIN-FLIGHT WORK (open PRs + bare branches — not yet merged):'];
  if (prs.length > 0) {
    lines.push(`\nOPEN PRs (${prs.length}):`, 'repo|pr_title|author|+additions/-deletions|draft');
    for (const pr of prs) {
      const isDraft = pr.is_draft === 1 || pr.is_draft === true ? 'yes' : 'no';
      lines.push(`${pr.repo}|${pr.pr_title}|${pr.github_login}|+${Number(pr.pr_additions ?? 0)}/-${Number(pr.pr_deletions ?? 0)}|${isDraft}`);
    }
  }
  if (branches.length > 0) {
    lines.push(`\nBARE BRANCHES (${branches.length}):`, 'repo|branch|author|commits|lines');
    for (const b of branches) {
      lines.push(`${b.repo}|${b.branch}|${b.github_login}|${b.commit_count}|${b.total_lines}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 2: Update the cache-read guard to check `_v: 2`**

Find the cache check block:

```typescript
  if (cached.length > 0) {
    const data = typeof cached[0].highlights_json === 'string'
      ? JSON.parse(cached[0].highlights_json)
      : cached[0].highlights_json;
    return NextResponse.json({
      available: true,
      report: { id: report.id, org: report.org, periodDays: report.period_days, createdAt: report.created_at },
      ...data,
      cached: true,
    });
  }
```

Replace it with:

```typescript
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
    // _v !== 2: stale cache (no in-flight data) — fall through to regenerate
  }
```

- [ ] **Step 3: Add two in-flight SQL queries after the existing `noJiraCommits` query**

After the `noJiraCommits` query block, add:

```typescript
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

  const inflightBlock = renderInsightsInflightBlock(inflightPrRows, inflightBranchRows);
```

- [ ] **Step 4: Append in-flight block to `userMessage`**

Find the `userMessage` template literal. It currently ends with:

```typescript
  const userMessage = `JIRA ISSUES (${jiraRows.length} total):
${jiraData}

DEVELOPER STATS (login | commits | PRs):
${devData}

GITHUB COMMITS WITHOUT JIRA (top 30 by size):
${noJiraData}`;
```

Add the in-flight block:

```typescript
  const userMessage = `JIRA ISSUES (${jiraRows.length} total):
${jiraData}

DEVELOPER STATS (login | commits | PRs):
${devData}

GITHUB COMMITS WITHOUT JIRA (top 30 by size):
${noJiraData}${inflightBlock}`;
```

- [ ] **Step 5: Add in-flight instruction to the inline system prompt**

Find the `Rules:` section in `systemPrompt`. After the last existing rule (`- Return ONLY raw JSON`), add:

```
- If IN-FLIGHT WORK is present at the end of the user message, use it to enrich project identification — treat open PRs and bare branches as signals of ongoing work. Mix them into existing project clusters where they clearly fit, or create a project if in-flight work has no committed counterpart. Draft PRs are included.
```

- [ ] **Step 6: Store `_v: 2` in the cached result**

Find the cache write:

```typescript
    await db.execute(
      `INSERT INTO report_comparisons (report_id_a, report_id_b, highlights_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE highlights_json = VALUES(highlights_json), generated_at = NOW()`,
      [report.id, report.id, JSON.stringify(parsed)],
    );

    return NextResponse.json({
      available: true,
      report: { id: report.id, org: report.org, periodDays: report.period_days, createdAt: report.created_at },
      projects: parsed.projects || [],
      untracked_work: parsed.untracked_work || [],
      cached: false,
    });
```

Replace with:

```typescript
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
```

- [ ] **Step 7: Run the full test suite**

```bash
npm test --no-coverage
```

Expected: All tests pass. The project-insights route has no unit tests, so no new test failures are expected.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/project-insights/route.ts
git commit -m "feat(glook-19): add in-flight PRs + branches to project-insights route, cache v2"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run the full test suite one final time**

```bash
npm test --no-coverage
```

Expected: All tests pass.

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No errors. In particular, verify that `TeamProjectsInput` usage in `projects.ts` (the `data.in_flight_prs` / `data.in_flight_branches` access) and the updated `extractTeamProjectsData` return type are consistent.
