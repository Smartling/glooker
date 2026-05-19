# GLOOK-4 Team Comparison View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Teams` tab on `/report/[id]/team` that ranks teams (instead of ICs) using a per-capita-then-apply impact score, plus two secondary impact columns, with full column parity to the existing IC table.

**Architecture:** Pure client-side aggregation. The page already fetches `/api/report/[id]` (devs) and `/api/teams?org=…` (team members). A new pure function `aggregateTeams(developers, teams) → TeamRow[]` runs inside a `useMemo` and feeds a new `<TeamTable />` component. The IC impact formula is extracted to a shared module so server and client use the same code.

**Tech Stack:** Next.js 15 / React 19, TypeScript, SWR, Jest + ts-jest. No DB migration; no new API endpoint.

**Source spec:** `docs/superpowers/specs/2026-05-19-glook-4-team-comparison-design.md`

---

## File map

- **New** `src/lib/impact-score.ts` — `computeImpactScore` (function moved verbatim, no behavior change).
- **New** `src/lib/teams/team-aggregator.ts` — `aggregateTeams(developers, teams) → TeamRow[]` pure function + `TeamRow` interface.
- **New** `src/lib/__tests__/unit/impact-score.test.ts` — pin numeric assertions on the extracted formula.
- **New** `src/lib/__tests__/unit/team-aggregator.test.ts` — full coverage of the aggregator.
- **New** `src/app/report/[id]/team/team-table.tsx` — `<TeamTable />` React component.
- **Modify** `src/lib/aggregator.ts` — replace the inline `computeImpactScore` with a re-export from `impact-score.ts` (preserves all existing import paths).
- **Modify** `src/app/report/[id]/team/page.tsx` — add `?view=` URL state, tab strip, conditional render, hide filter dropdown + dev-search + `TeamPulseCard` on the Teams tab.

## Conventions

- Frontend types use **snake_case** (matches `Developer` and `Team` in `team/page.tsx`). TeamRow follows the same convention.
- TDD for the two pure modules. Component tasks have manual smoke steps only (no RTL/Playwright in the repo).
- One small commit per task. Run `npm test` and `npx tsc --noEmit -p tsconfig.json` before each commit.

---

## Task 1: Extract `computeImpactScore` to its own module

**Files:**
- Create: `src/lib/impact-score.ts`
- Create: `src/lib/__tests__/unit/impact-score.test.ts`
- Modify: `src/lib/aggregator.ts` (remove inline definition, add `export { computeImpactScore } from './impact-score';`)

- [ ] **Step 1: Create the new module**

```ts
// src/lib/impact-score.ts
/**
 * Shared impact-score formula. Used by:
 *   - the report runner (server-side, per developer)
 *   - the team aggregator (client-side, per team via per-capita inputs)
 *
 * Keep this module pure — no I/O, no DB, no Next.js APIs — so both server
 * and client can import it without dragging server-only code into the bundle.
 */
export interface ImpactScoreInputs {
  totalCommits: number;
  totalPRs: number;
  avgComplexity: number;
  prPercentage: number;
  totalStoryPoints: number;
  totalJiraIssues: number;
  totalReviews: number;
}

export function computeImpactScore(s: ImpactScoreInputs): number {
  const jiraFactor = s.totalStoryPoints > 0
    ? Math.min(s.totalStoryPoints / 15, 1)
    : Math.min(s.totalJiraIssues / 10, 1);
  const raw =
    Math.min(s.totalCommits / 20, 1) * 2 +
    Math.min(s.totalPRs / 10, 1)     * 2.7 +
    (s.avgComplexity / 10)            * 3.5 +
    (s.prPercentage / 100)            * 1.1 +
    jiraFactor                        * 0.5 +
    Math.min(s.totalReviews / 15, 1)  * 0.5;
  return Math.round(raw * 10) / 10;
}
```

- [ ] **Step 2: Update `src/lib/aggregator.ts` to re-export and use the moved function**

Remove the inline `export function computeImpactScore(...)` definition (the entire block, currently around lines 27–43 of `src/lib/aggregator.ts`). At the top of `aggregator.ts`, add:

```ts
export { computeImpactScore, type ImpactScoreInputs } from './impact-score';
```

Verify the file still compiles by reading the new top and making sure the `computeImpactScore(...)` calls inside `aggregator.ts` (and `report-runner.ts`) still resolve through the re-export.

- [ ] **Step 3: Add pinned numeric tests**

```ts
// src/lib/__tests__/unit/impact-score.test.ts
import { computeImpactScore } from '@/lib/impact-score';

describe('computeImpactScore', () => {
  const base = {
    totalCommits: 0, totalPRs: 0, avgComplexity: 0,
    prPercentage: 0, totalStoryPoints: 0, totalJiraIssues: 0, totalReviews: 0,
  };

  it('returns 0 for an empty input', () => {
    expect(computeImpactScore(base)).toBe(0);
  });

  it('caps each additive term at its weight', () => {
    // commits cap at min(x/20, 1) * 2 = 2.0 when commits >= 20
    expect(computeImpactScore({ ...base, totalCommits: 100 })).toBe(2.0);
    // PRs cap at min(x/10, 1) * 2.7 = 2.7 when PRs >= 10
    expect(computeImpactScore({ ...base, totalPRs: 100 })).toBe(2.7);
    // reviews cap at min(x/15, 1) * 0.5 = 0.5 when reviews >= 15
    expect(computeImpactScore({ ...base, totalReviews: 100 })).toBe(0.5);
  });

  it('uses story points over jira issues when both are present', () => {
    // 15 SP saturates the jira term at 0.5; 2 issues alone would yield 0.1.
    expect(computeImpactScore({ ...base, totalStoryPoints: 15, totalJiraIssues: 2 })).toBe(0.5);
  });

  it('falls back to jira issues when story points is zero', () => {
    // 10 issues saturates: min(10/10, 1) * 0.5 = 0.5
    expect(computeImpactScore({ ...base, totalStoryPoints: 0, totalJiraIssues: 10 })).toBe(0.5);
  });

  it('rounds to one decimal place', () => {
    const score = computeImpactScore({ ...base, totalCommits: 7 }); // 0.7 from this term
    expect(score).toBe(0.7);
    expect(Number.isInteger(score * 10)).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPatterns="impact-score|aggregator"
```

Expected: all tests pass (including the existing `aggregator.test.ts` that already exercises `computeImpactScore`).

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/impact-score.ts src/lib/aggregator.ts src/lib/__tests__/unit/impact-score.test.ts
git commit -m "refactor(impact-score): extract computeImpactScore to dedicated module (GLOOK-4)

Same function, new home. Server-side aggregator continues to import it
through src/lib/aggregator.ts (re-export), so no callers change. Adds a
focused test file that pins the formula's numeric behavior, which the
upcoming team aggregator will rely on.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `TeamRow` type and `aggregateTeams` skeleton

**Files:**
- Create: `src/lib/teams/team-aggregator.ts`
- Create: `src/lib/__tests__/unit/team-aggregator.test.ts`

- [ ] **Step 1: Create the skeleton module**

```ts
// src/lib/teams/team-aggregator.ts
import { computeImpactScore } from '@/lib/impact-score';

/**
 * Snake-case to match the frontend `Developer` interface that already
 * flows out of /api/report/[id]. A TeamRow can therefore be rendered with
 * the same column components as a Developer row in the IC table.
 */
export interface TeamRow {
  team_id:           string;
  name:              string;
  color:             string;
  size:              number;          // authoritative count from team_members
  active_count:      number;          // devs in team_members who have stats this report
  members:           Array<{ github_login: string; impact_score: number; total_commits: number }>;

  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  total_jira_issues:  number;
  cc_total_cost:      number;
  active_repos_count: number;
  type_breakdown:     Record<string, number>;

  avg_complexity: number;             // commit-weighted
  pr_percentage:  number;             // commit-weighted
  ai_percentage:  number;             // commit-weighted

  impact_total:    number;            // (T) sum-then-apply
  impact_avg:      number;            // (A) arithmetic mean of active impact_score
  impact_weighted: number;            // (W) per-capita-then-apply, default sort
}

/** Inputs match the frontend types in src/app/report/[id]/team/page.tsx. */
export interface AggregatorDeveloper {
  github_login:       string;
  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  avg_complexity:     number;
  impact_score:       number;
  pr_percentage:      number;
  ai_percentage:      number;
  total_jira_issues?: number;
  cc_total_cost?:     number;
  type_breakdown:     Record<string, number>;
  active_repos:       string[];
}

export interface AggregatorTeam {
  id:      string;
  name:    string;
  color:   string;
  members: string[];                   // github_login values
}

export function aggregateTeams(
  _developers: AggregatorDeveloper[],
  _teams:      AggregatorTeam[],
): TeamRow[] {
  return [];
}
```

- [ ] **Step 2: Add the smoke test**

```ts
// src/lib/__tests__/unit/team-aggregator.test.ts
import { aggregateTeams, type AggregatorDeveloper, type AggregatorTeam } from '@/lib/teams/team-aggregator';

const DEV_BASE: AggregatorDeveloper = {
  github_login: 'placeholder', total_prs: 0, total_commits: 0,
  lines_added: 0, lines_removed: 0, avg_complexity: 0, impact_score: 0,
  pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0,
  cc_total_cost: 0, type_breakdown: {}, active_repos: [],
};

const TEAM_BASE: AggregatorTeam = { id: 't1', name: 'T1', color: '#fff', members: [] };

describe('aggregateTeams', () => {
  it('returns an empty array for empty inputs', () => {
    expect(aggregateTeams([], [])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: 1 test passes.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teams/team-aggregator.ts src/lib/__tests__/unit/team-aggregator.test.ts
git commit -m "feat(teams): aggregateTeams skeleton + TeamRow type (GLOOK-4)

Empty implementation, ready for incremental TDD in the next tasks.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Sum aggregation across team members

**Files:**
- Modify: `src/lib/teams/team-aggregator.ts`
- Modify: `src/lib/__tests__/unit/team-aggregator.test.ts`

- [ ] **Step 1: Add failing tests for the sum-aggregated columns**

Append to `src/lib/__tests__/unit/team-aggregator.test.ts`:

```ts
describe('aggregateTeams — sum aggregation', () => {
  it('sums total_prs, total_commits, lines, jira, spend across active members', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_prs: 4, total_commits: 12, lines_added: 100, lines_removed: 30, total_jira_issues: 3, cc_total_cost: 0.5 },
      { ...DEV_BASE, github_login: 'b', total_prs: 2, total_commits: 8,  lines_added: 50,  lines_removed: 10, total_jira_issues: 1, cc_total_cost: 0.3 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.total_prs).toBe(6);
    expect(row.total_commits).toBe(20);
    expect(row.lines_added).toBe(150);
    expect(row.lines_removed).toBe(40);
    expect(row.total_jira_issues).toBe(4);
    expect(row.cc_total_cost).toBeCloseTo(0.8, 5);
  });

  it('treats missing optional fields as zero (total_jira_issues, cc_total_cost)', () => {
    const devs: AggregatorDeveloper[] = [{ ...DEV_BASE, github_login: 'a', total_commits: 5 }];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.total_jira_issues).toBe(0);
    expect(row.cc_total_cost).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: failures with `Cannot read properties of undefined (reading 'total_prs')` or equivalent — the result array is empty.

- [ ] **Step 3: Implement the iteration + sum logic**

Replace the body of `aggregateTeams` in `src/lib/teams/team-aggregator.ts`:

```ts
export function aggregateTeams(
  developers: AggregatorDeveloper[],
  teams:      AggregatorTeam[],
): TeamRow[] {
  const devByLogin = new Map(developers.map(d => [d.github_login, d]));

  const rows: TeamRow[] = [];
  for (const team of teams) {
    if (team.members.length === 0) {
      // orphan team — skip; log so it's visible during development
      if (typeof console !== 'undefined') console.warn(`[team-aggregator] team ${team.id} (${team.name}) has 0 members; skipping`);
      continue;
    }

    const activeDevs = team.members
      .map(login => devByLogin.get(login))
      .filter((d): d is AggregatorDeveloper => d !== undefined);

    let total_prs = 0, total_commits = 0, lines_added = 0, lines_removed = 0;
    let total_jira_issues = 0, cc_total_cost = 0;
    for (const d of activeDevs) {
      total_prs         += d.total_prs;
      total_commits     += d.total_commits;
      lines_added       += d.lines_added;
      lines_removed     += d.lines_removed;
      total_jira_issues += d.total_jira_issues ?? 0;
      cc_total_cost     += Number(d.cc_total_cost ?? 0);
    }

    rows.push({
      team_id: team.id,
      name:    team.name,
      color:   team.color,
      size:           team.members.length,
      active_count:   activeDevs.length,
      members:        activeDevs.map(d => ({ github_login: d.github_login, impact_score: Number(d.impact_score) || 0, total_commits: d.total_commits })),
      total_prs, total_commits, lines_added, lines_removed,
      total_jira_issues, cc_total_cost,
      active_repos_count: 0,           // implemented in a later task
      type_breakdown:     {},          // implemented in a later task
      avg_complexity: 0, pr_percentage: 0, ai_percentage: 0,
      impact_total: 0, impact_avg: 0, impact_weighted: 0,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: all `aggregateTeams` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teams/team-aggregator.ts src/lib/__tests__/unit/team-aggregator.test.ts
git commit -m "feat(teams): sum aggregation across team members (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Commit-weighted ratios (complexity, PR%, AI%)

**Files:**
- Modify: `src/lib/teams/team-aggregator.ts`
- Modify: `src/lib/__tests__/unit/team-aggregator.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('aggregateTeams — commit-weighted ratios', () => {
  it('weights complexity, pr_percentage, ai_percentage by per-dev commits', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_commits: 30, avg_complexity: 4, pr_percentage: 80, ai_percentage: 20 },
      { ...DEV_BASE, github_login: 'b', total_commits: 10, avg_complexity: 8, pr_percentage: 40, ai_percentage: 50 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    // (4*30 + 8*10) / 40 = 5.0
    expect(row.avg_complexity).toBeCloseTo(5.0, 5);
    // (80*30 + 40*10) / 40 = 70
    expect(row.pr_percentage).toBeCloseTo(70, 5);
    // (20*30 + 50*10) / 40 = 27.5
    expect(row.ai_percentage).toBeCloseTo(27.5, 5);
  });

  it('returns zero ratios when the team has zero commits', () => {
    const devs: AggregatorDeveloper[] = [{ ...DEV_BASE, github_login: 'a', avg_complexity: 5, pr_percentage: 100 }];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.avg_complexity).toBe(0);
    expect(row.pr_percentage).toBe(0);
    expect(row.ai_percentage).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: failures, because all three ratios still return 0.

- [ ] **Step 3: Implement weighted ratios**

In `src/lib/teams/team-aggregator.ts`, replace the line `avg_complexity: 0, pr_percentage: 0, ai_percentage: 0,` inside the `rows.push({...})` block with a small computation. Add this before the `rows.push`:

```ts
let weightedComplexity = 0, weightedPrPct = 0, weightedAiPct = 0;
for (const d of activeDevs) {
  weightedComplexity += d.avg_complexity * d.total_commits;
  weightedPrPct      += d.pr_percentage  * d.total_commits;
  weightedAiPct      += d.ai_percentage  * d.total_commits;
}
const avg_complexity = total_commits > 0 ? weightedComplexity / total_commits : 0;
const pr_percentage  = total_commits > 0 ? weightedPrPct      / total_commits : 0;
const ai_percentage  = total_commits > 0 ? weightedAiPct      / total_commits : 0;
```

Then in the `rows.push` literal, replace the zeros: `avg_complexity, pr_percentage, ai_percentage,`.

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: all `aggregateTeams` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teams/team-aggregator.ts src/lib/__tests__/unit/team-aggregator.test.ts
git commit -m "feat(teams): commit-weighted ratio aggregation (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: `type_breakdown` and `active_repos_count`

**Files:**
- Modify: `src/lib/teams/team-aggregator.ts`
- Modify: `src/lib/__tests__/unit/team-aggregator.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('aggregateTeams — type_breakdown and active_repos_count', () => {
  it('sums type_breakdown counts across active members', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', type_breakdown: { feature: 3, fix: 2 } },
      { ...DEV_BASE, github_login: 'b', type_breakdown: { feature: 1, docs: 4 } },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.type_breakdown).toEqual({ feature: 4, fix: 2, docs: 4 });
  });

  it('counts distinct active_repos across active members', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', active_repos: ['x', 'y'] },
      { ...DEV_BASE, github_login: 'b', active_repos: ['y', 'z'] },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.active_repos_count).toBe(3); // x, y, z
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: failures, because these still return `{}` and `0`.

- [ ] **Step 3: Implement both aggregations**

Inside the `for (const team of teams)` loop in `src/lib/teams/team-aggregator.ts`, before the `rows.push`:

```ts
const type_breakdown: Record<string, number> = {};
const repoSet = new Set<string>();
for (const d of activeDevs) {
  for (const [k, v] of Object.entries(d.type_breakdown ?? {})) {
    type_breakdown[k] = (type_breakdown[k] ?? 0) + v;
  }
  for (const r of d.active_repos ?? []) repoSet.add(r);
}
const active_repos_count = repoSet.size;
```

Then replace `active_repos_count: 0` and `type_breakdown: {}` in the `rows.push` literal with the computed variables.

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: all aggregator tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teams/team-aggregator.ts src/lib/__tests__/unit/team-aggregator.test.ts
git commit -m "feat(teams): type_breakdown sum + active_repos distinct count (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: The three impact strategies (T, A, W)

**Files:**
- Modify: `src/lib/teams/team-aggregator.ts`
- Modify: `src/lib/__tests__/unit/team-aggregator.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('aggregateTeams — impact strategies', () => {
  it('(A) impact_avg is the arithmetic mean of active devs impact_score', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', impact_score: 7.0, total_commits: 1 },
      { ...DEV_BASE, github_login: 'b', impact_score: 6.0, total_commits: 1 },
      { ...DEV_BASE, github_login: 'c', impact_score: 5.0, total_commits: 1 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b', 'c'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.impact_avg).toBe(6.0);
  });

  it('(T) impact_total runs the IC formula on sums', () => {
    // Two devs, 10 commits each → 20 total, saturates min(20/20,1)*2 = 2.0
    // Two devs, 5 PRs each → 10 total, saturates min(10/10,1)*2.7 = 2.7
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_commits: 10, total_prs: 5 },
      { ...DEV_BASE, github_login: 'b', total_commits: 10, total_prs: 5 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.impact_total).toBe(4.7); // 2.0 + 2.7
  });

  it('(W) impact_weighted divides additive metrics by team size, then runs the formula', () => {
    // size = 4, only 2 devs active with 10 commits each → per-capita = 20/4 = 5
    // min(5/20, 1) * 2 = 0.5; min(0/10,1) * 2.7 = 0
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'a', total_commits: 10 },
      { ...DEV_BASE, github_login: 'b', total_commits: 10 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a', 'b', 'inactive1', 'inactive2'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.size).toBe(4);
    expect(row.active_count).toBe(2);
    expect(row.impact_weighted).toBe(0.5);
  });

  it('single-member team where the dev IS active: W == T (per-capita-with-size-1 collapses to total)', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'solo', total_commits: 8, total_prs: 4, avg_complexity: 5, pr_percentage: 50, impact_score: 9.9 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['solo'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.impact_weighted).toBe(row.impact_total);
    // Note: row.impact_avg = solo.impact_score = 9.9, which may differ from
    //   impact_weighted because the persisted impact_score may have been
    //   computed with totalStoryPoints, which we do not have client-side.
    //   This is documented in the spec.
  });

  it('zero active devs: all three impact scores are 0', () => {
    const devs: AggregatorDeveloper[] = [];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['nobody1', 'nobody2'] }];
    const [row] = aggregateTeams(devs, teams);
    expect(row.size).toBe(2);
    expect(row.active_count).toBe(0);
    expect(row.impact_total).toBe(0);
    expect(row.impact_avg).toBe(0);
    expect(row.impact_weighted).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: failures — impacts are still 0.

- [ ] **Step 3: Implement the three strategies**

At the top of `src/lib/teams/team-aggregator.ts`, ensure `computeImpactScore` is imported (already added in Task 2). Then inside the `for (const team of teams)` loop, before the `rows.push`, compute:

```ts
const total_reviews = 0;  // not exposed via /api/report today; documented in spec
const total_story_points = 0; // ditto

const impact_total = computeImpactScore({
  totalCommits:     total_commits,
  totalPRs:         total_prs,
  avgComplexity:    avg_complexity,
  prPercentage:     pr_percentage,
  totalStoryPoints: total_story_points,
  totalJiraIssues:  total_jira_issues,
  totalReviews:     total_reviews,
});

const impact_avg = activeDevs.length === 0
  ? 0
  : Math.round((activeDevs.reduce((s, d) => s + (Number(d.impact_score) || 0), 0) / activeDevs.length) * 10) / 10;

const teamSize = team.members.length;
const impact_weighted = teamSize === 0
  ? 0
  : computeImpactScore({
      totalCommits:     total_commits     / teamSize,
      totalPRs:         total_prs         / teamSize,
      avgComplexity:    avg_complexity,
      prPercentage:     pr_percentage,
      totalStoryPoints: total_story_points / teamSize,
      totalJiraIssues:  total_jira_issues / teamSize,
      totalReviews:     total_reviews     / teamSize,
    });
```

Then in the `rows.push` literal, replace the three `impact_…: 0` entries with `impact_total, impact_avg, impact_weighted,`.

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: all aggregator tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teams/team-aggregator.ts src/lib/__tests__/unit/team-aggregator.test.ts
git commit -m "feat(teams): three impact strategies — sum-then-apply, avg, per-capita (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Multi-team membership + orphan handling

**Files:**
- Modify: `src/lib/__tests__/unit/team-aggregator.test.ts`

(No production code change — the existing implementation already handles these via the dev map and the orphan-team guard. Add the tests to lock the behavior in.)

- [ ] **Step 1: Add tests**

```ts
describe('aggregateTeams — edge cases', () => {
  it('counts a dev in every team they belong to (no de-duping for v1)', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'shared', total_commits: 10 },
    ];
    const teams: AggregatorTeam[] = [
      { ...TEAM_BASE, id: 't1', name: 'T1', members: ['shared'] },
      { ...TEAM_BASE, id: 't2', name: 'T2', members: ['shared'] },
    ];
    const rows = aggregateTeams(devs, teams);
    expect(rows).toHaveLength(2);
    expect(rows[0].total_commits).toBe(10);
    expect(rows[1].total_commits).toBe(10);
  });

  it('silently excludes devs that belong to no team', () => {
    const devs: AggregatorDeveloper[] = [
      { ...DEV_BASE, github_login: 'orphan', total_commits: 5 },
    ];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: [] }];
    const rows = aggregateTeams(devs, teams);
    expect(rows).toEqual([]);   // both the orphan dev and the 0-member team are excluded
  });

  it('skips teams that have zero members', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const teams: AggregatorTeam[] = [
      { ...TEAM_BASE, id: 't-empty', name: 'Empty', members: [] },
      { ...TEAM_BASE, id: 't-real',  name: 'Real',  members: ['a'] },
    ];
    const devs: AggregatorDeveloper[] = [{ ...DEV_BASE, github_login: 'a', total_commits: 1 }];
    const rows = aggregateTeams(devs, teams);
    expect(rows).toHaveLength(1);
    expect(rows[0].team_id).toBe('t-real');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- --testPathPatterns="team-aggregator"
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/unit/team-aggregator.test.ts
git commit -m "test(teams): lock multi-team, no-team, and orphan-team behavior (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: `<TeamTable />` component — skeleton with primary columns

**Files:**
- Create: `src/app/report/[id]/team/team-table.tsx`

Note: no tests in this task (project has no RTL/Playwright harness for client components per the spec). Manual smoke is documented at the end of the task.

- [ ] **Step 1: Create the component**

```tsx
// src/app/report/[id]/team/team-table.tsx
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { aggregateTeams, type AggregatorDeveloper, type AggregatorTeam, type TeamRow } from '@/lib/teams/team-aggregator';

interface TeamTableProps {
  developers: AggregatorDeveloper[];
  teams:      AggregatorTeam[];
  reportId:   string;
  canAct:     boolean;
}

type SortKey =
  | 'name' | 'size' | 'active_count' | 'total_prs' | 'total_commits'
  | 'lines_added' | 'avg_complexity' | 'pr_percentage' | 'ai_percentage'
  | 'total_jira_issues' | 'cc_total_cost'
  | 'impact_total' | 'impact_avg' | 'impact_weighted';

export default function TeamTable({ developers, teams, reportId, canAct }: TeamTableProps) {
  const router = useRouter();
  const rows = useMemo(() => aggregateTeams(developers, teams), [developers, teams]);

  const [sortKey, setSortKey] = useState<SortKey>('impact_weighted');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const hasJira  = rows.some(r => r.total_jira_issues > 0);
  const hasSpend = canAct && rows.some(r => r.cc_total_cost > 0);

  const sortedRows = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * sign;
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      if (av === bv) return a.name.localeCompare(b.name);
      return (av - bv) * sign;
    });
  }, [rows, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const onRowClick = (teamName: string) => {
    router.push(`/report/${reportId}/team?view=individuals&team=${encodeURIComponent(teamName)}`);
  };

  if (rows.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-8 text-gray-500 text-sm">
        No teams configured for this org. Add teams in Settings to compare.
      </div>
    );
  }

  const sortCaret = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
            <th className="px-4 py-3 w-[16%]"><button onClick={() => onSort('name')} className="hover:text-gray-300">Team{sortCaret('name')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('size')} className="hover:text-gray-300">Size{sortCaret('size')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('active_count')} className="hover:text-gray-300">Active{sortCaret('active_count')}</button></th>
            <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('total_prs')} className="hover:text-gray-300">PRs{sortCaret('total_prs')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('total_commits')} className="hover:text-gray-300">Commits{sortCaret('total_commits')}</button></th>
            <th className="px-4 py-3 text-right w-[8%]"><button onClick={() => onSort('lines_added')} className="hover:text-gray-300">Lines +/-{sortCaret('lines_added')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('avg_complexity')} className="hover:text-gray-300">Cmplx{sortCaret('avg_complexity')}</button></th>
            <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('pr_percentage')} className="hover:text-gray-300">PR%{sortCaret('pr_percentage')}</button></th>
            <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('ai_percentage')} className="hover:text-gray-300">AI%{sortCaret('ai_percentage')}</button></th>
            {hasJira  && <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('total_jira_issues')} className="hover:text-gray-300">Jira{sortCaret('total_jira_issues')}</button></th>}
            {hasSpend && <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('cc_total_cost')} className="hover:text-gray-300">Spend{sortCaret('cc_total_cost')}</button></th>}
            <th className="px-4 py-3 text-right w-[7%]" title="Per-capita-then-apply: team-level metrics ÷ team size, run through the IC impact formula"><button onClick={() => onSort('impact_weighted')} className="hover:text-gray-300">Impact (W){sortCaret('impact_weighted')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]" title="Arithmetic mean of active developers' impact scores"><button onClick={() => onSort('impact_avg')} className="hover:text-gray-300">(A){sortCaret('impact_avg')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]" title="Sum-then-apply: team-level totals run through the IC impact formula. Saturates fast — use as a context column, not a primary sort."><button onClick={() => onSort('impact_total')} className="hover:text-gray-300">(T){sortCaret('impact_total')}</button></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => (
            <tr
              key={row.team_id}
              onClick={() => onRowClick(row.name)}
              className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${row.active_count === 0 ? 'opacity-50' : ''}`}
            >
              <td className="px-4 py-3 font-medium text-white">
                <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: row.color }} />
                {row.name}
              </td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.size}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">
                {row.active_count}
                {row.active_count < row.size && <span className="text-amber-400/70 text-xs ml-1">−{row.size - row.active_count}</span>}
              </td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.total_prs}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.total_commits}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">
                <span className="text-green-400/80">+{row.lines_added}</span>
                <span className="text-gray-500 mx-1">/</span>
                <span className="text-red-400/80">−{row.lines_removed}</span>
              </td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.active_count > 0 ? row.avg_complexity.toFixed(1) : '—'}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.active_count > 0 ? `${Math.round(row.pr_percentage)}%` : '—'}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.active_count > 0 ? `${Math.round(row.ai_percentage)}%` : '—'}</td>
              {hasJira  && <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.total_jira_issues}</td>}
              {hasSpend && <td className="px-4 py-3 text-right text-gray-300 tabular-nums">${row.cc_total_cost.toFixed(2)}</td>}
              <td className="px-4 py-3 text-right text-white tabular-nums font-semibold">{row.impact_weighted.toFixed(1)}</td>
              <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{row.impact_avg.toFixed(1)}</td>
              <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{row.impact_total.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/report/\[id\]/team/team-table.tsx
git commit -m "feat(teams): TeamTable component with sortable columns + row click drill-down (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Wire the Teams tab into `team/page.tsx`

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`

- [ ] **Step 1: Add the URL state, tab strip, and conditional render**

Edit `src/app/report/[id]/team/page.tsx`:

1. Add an import near the existing imports:

```ts
import TeamTable from './team-table';
```

2. Where other `useUrlState` calls live (find the existing block — likely around lines 60-90), add:

```ts
const [view, setView] = useUrlState<'individuals' | 'teams'>({
  key: 'view',
  type: 'enum',
  values: ['individuals', 'teams'] as const,
  default: 'individuals',
  history: 'push',
});
```

3. Locate the JSX section just below the page title and any global filter/header (i.e. ABOVE the existing team-filter dropdown and dev-search). Add the tab strip:

```tsx
<div className="border-b border-gray-800 mb-6">
  <div className="flex gap-6">
    <button
      onClick={() => setView('individuals')}
      className={`pb-2 text-sm font-medium transition-colors ${view === 'individuals' ? 'text-white border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300'}`}
    >Individuals</button>
    <button
      onClick={() => setView('teams')}
      className={`pb-2 text-sm font-medium transition-colors ${view === 'teams' ? 'text-white border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300'}`}
    >Teams</button>
  </div>
</div>
```

4. Wrap the existing filter dropdown + dev-search autocomplete + `TeamPulseCard` + IC developer table in a conditional. Find each one and prefix with `{view === 'individuals' && (...)}` (or wrap a section). Example:

```tsx
{view === 'individuals' && (
  <>
    {/* existing filter dropdown */}
    {/* existing dev-search autocomplete */}
    {/* existing TeamPulseCard */}
    {/* existing developer table IIFE */}
  </>
)}
```

5. After the `view === 'individuals'` block, add:

```tsx
{view === 'teams' && developers && teams && activeReport && (
  <TeamTable
    developers={developers}
    teams={teams}
    reportId={params.id}
    canAct={canAct}
  />
)}
```

(Use whatever names are already in scope in the file for the developer list, team list, and report — the names above are placeholders; match the existing variable names in the file.)

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: every test passes (the changes are page-level and not covered by unit tests; this run confirms we did not break unrelated code).

- [ ] **Step 4: Commit**

```bash
git add src/app/report/\[id\]/team/page.tsx
git commit -m "feat(teams): add Teams tab on Team Summary page (GLOOK-4)

URL-stated ?view=individuals|teams, defaults to individuals. Existing
filter dropdown, dev-search, and TeamPulseCard render only on the
individuals tab.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Local smoke test

- [ ] **Step 1: Rebuild the local container**

```bash
cd /Users/msogin/Desktop/claudecode/glooker
podman-compose up -d --build app
podman stop glooker_app_1 && podman rm glooker_app_1
podman-compose up -d app
until curl -sf http://localhost:3000/api/health > /dev/null; do sleep 2; done
echo Server ready
```

- [ ] **Step 2: Manually verify** (open the latest report at `http://localhost:3000/report/<id>/team`):

  1. The tabs `[ Individuals ]   [ Teams ]` are visible at the top of the page.
  2. `?view=individuals` (default) — page looks identical to before, all interactions still work.
  3. Click `Teams` — URL becomes `?view=teams`, the table swaps to one row per team. Default sort: Impact (W) desc. Filter dropdown / dev search / TeamPulseCard are hidden.
  4. Click any column header — sort flips direction (caret toggles ▼/▲). Click a different column — switches sort key.
  5. Click a team row — navigates to `?view=individuals&team=<name>`, returns to the IC view filtered to that team.
  6. Bookmark `?view=teams` and hard-reload — page restores to the Teams tab.
  7. `Active` column shows e.g. `11 −1` when a team has inactive members; the row is not visually dimmed in this case. A team where every member is inactive (if any in your data) appears with `−` placeholders for ratios and `0`s for sums; the row is at 50% opacity.
  8. Spend column visible if you're admin and any team has spend > 0; hidden otherwise. Same for Jira.

- [ ] **Step 3: Run the full test + typecheck one more time**

```bash
npm test
npx tsc --noEmit -p tsconfig.json
```

Both clean.

- [ ] **Step 4: Final commit (only if any manual-test-driven tweaks were made)**

```bash
git add -p
git commit -m "fix(teams): manual-smoke adjustments (GLOOK-4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If no changes were needed, skip this step.

---

## Notes on the spec invariant

The spec asserts *"Single-member team → W = A = T = that dev's own impact"*. In the implementation:

- **W and T are equal** for a single-member team (per-capita-with-size-1 collapses to total) — Task 6 test pins this.
- **A may differ from W/T by up to ~0.5** if the dev's persisted `impact_score` was computed with `totalStoryPoints > 0`. Story points is not exposed via `/api/report` today and is therefore zero in the client-side recomputation. This is the only correctness caveat in v1 and is documented in the spec.

If this caveat becomes a problem, the smallest fix is to add `total_story_points` to the SELECT in `src/lib/report/service.ts` (the column already lives on `developer_stats` once persisted; today it is in-memory only at report-run time — a separate small change).
