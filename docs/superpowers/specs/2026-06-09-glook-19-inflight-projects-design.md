# GLOOK-19: Add In-Flight Work to Current Projects Cards

## Goal

Surface unmerged PRs and bare-branch commits in the "Current Projects" LLM clustering on both the per-team card (team page) and the org-wide card (home page), so both cards reflect what the team is actively working on — not just what has already shipped.

## Scope

Two independent surfaces share the same conceptual treatment but different code paths:

| Surface | Entry point | Prompt | Cache |
|---|---|---|---|
| Team-page per-team card | `src/lib/team-pulse/projects.ts` | `prompts/team-pulse-projects.txt` | `team_pulse_summaries` (keyed by `prompt_version`) |
| Home-page org-wide card | `src/app/api/project-insights/route.ts` | Inline system prompt | `report_comparisons` (keyed by `report_id_a = report_id_b`) |

The output type (`ProjectsCardItem` / `TeamProject`) and the `ProjectsCard` React component are unchanged.

---

## Section 1: Data Layer

### New Types (`src/lib/team-pulse/data.ts`)

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
```

### Extended `TeamProjectsInput`

Add two new fields to the existing interface:

```typescript
export interface TeamProjectsInput {
  commits: TeamProjectCommit[];
  jira_issues: TeamProjectJiraIssue[];
  team_members: string[];
  in_flight_prs: TeamProjectInflightPr[];       // new
  in_flight_branches: TeamProjectInflightBranch[]; // new
}
```

### `extractTeamProjectsData` (team-page)

Add two SQL queries after the existing commit/Jira fetches:

```sql
-- Top 30 open PRs for team members, ordered by size
SELECT repo, pr_title AS title, github_login AS author,
       COALESCE(pr_additions, 0) AS additions,
       COALESCE(pr_deletions, 0) AS deletions,
       is_draft
FROM unmerged_prs
WHERE report_id = ? AND github_login IN (...)
ORDER BY COALESCE(pr_additions, 0) + COALESCE(pr_deletions, 0) DESC
LIMIT 30
```

```sql
-- Top 10 bare branches (no PR) aggregated per repo+branch+author
SELECT repo, branch, github_login AS author,
       COUNT(*) AS commit_count,
       SUM(lines_added + lines_removed) AS lines
FROM unmerged_commits
WHERE report_id = ? AND github_login IN (...) AND pr_number IS NULL
GROUP BY repo, branch, github_login
ORDER BY lines DESC
LIMIT 10
```

`is_draft` normalised to `boolean` (MySQL returns `0`/`1`; SQLite returns same — coerce via `r.is_draft === 1 || r.is_draft === true`).

### Home-page (`src/app/api/project-insights/route.ts`)

Two new inline SQL queries against the latest completed report (no new shared types — route is self-contained):

```sql
SELECT repo, pr_title, github_login, pr_additions, pr_deletions, is_draft
FROM unmerged_prs
WHERE report_id = ?
ORDER BY COALESCE(pr_additions, 0) + COALESCE(pr_deletions, 0) DESC
LIMIT 30
```

```sql
SELECT repo, branch, github_login,
       COUNT(*) AS commit_count,
       SUM(lines_added + lines_removed) AS total_lines
FROM unmerged_commits
WHERE report_id = ? AND pr_number IS NULL
GROUP BY repo, branch, github_login
ORDER BY total_lines DESC
LIMIT 10
```

Results rendered into `userMessage` as a pipe-delimited block (see Section 2).

---

## Section 2: Prompt Changes

### In-flight block format

A shared rendering pattern used by both surfaces. When both lists are empty the block is omitted entirely (no heading, no empty section).

```
IN-FLIGHT WORK (open PRs + bare branches — not yet merged):

OPEN PRs (N):
repo|pr_title|author|+additions/-deletions|draft
acme/frontend|Add pagination to jobs table|alice|+340/-12|no
acme/backend|WIP: retry logic for BRZ connector|bob|+89/-4|yes

BARE BRANCHES (N):
repo|branch|author|commits|+lines/-lines
acme/infra|feat/k8s-autoscale|carol|7|+210/-30
```

### Team-page prompt (`prompts/team-pulse-projects.txt`)

Add placeholder `{{IN_FLIGHT_BLOCK}}` at the bottom of the template (after `JIRA ISSUES`).

Add one rule to the RULES section:
> Use IN-FLIGHT WORK to enrich clusters — mix open PRs and bare branches into existing projects where they clearly belong. If in-flight work represents a coherent new thread with no committed counterpart, create a project for it. Draft PRs are included; let their content guide you on whether they belong to an existing project or a new one.

Update `generateTeamProjects` in `src/lib/team-pulse/projects.ts` to render the block and pass it as `IN_FLIGHT_BLOCK` to `loadPrompt`.

### Home-page prompt (`src/app/api/project-insights/route.ts`)

Append the rendered block to `userMessage`. Add the same in-flight instruction to the inline system prompt (one sentence, matching the rule above).

---

## Section 3: Cache Invalidation

**Team-page:** Bump `PROMPT_VERSION` in `src/lib/team-pulse/service.ts` from `'v3-projects'` to `'v4-inflight'`. Old cache rows with `v3-projects` are automatically skipped on the next request.

**Home-page:** Store `_v: 2` in the cached `highlights_json` object. On cache read, if `data._v !== 2` treat as a cache miss and regenerate. New responses are stored with `_v: 2`.

---

## Section 4: Tests

**`src/lib/__tests__/unit/team-projects-data.test.ts`** — new tests:
- `in_flight_prs` populated from `unmerged_prs`, ordered by size, capped at 30
- `in_flight_branches` aggregates bare commits per branch, capped at 10
- Both fields are `[]` when no in-flight rows exist
- `is_draft` coerced to boolean correctly

**`src/lib/__tests__/unit/team-projects-generator.test.ts`** — new tests:
- Rendered prompt includes `IN-FLIGHT WORK` block when in-flight data is present
- Block is omitted when `in_flight_prs` and `in_flight_branches` are both empty

**Snapshot update:** After editing `prompts/team-pulse-projects.txt`, run `npm test -- -u` to update the snapshot in `prompts.test.ts`. Review the diff to confirm the new placeholder and rule are present.

**Home-page:** No new unit tests (consistent with existing coverage posture for this route). Cache `_v` check is straightforward.
