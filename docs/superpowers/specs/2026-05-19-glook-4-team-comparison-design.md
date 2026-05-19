# GLOOK-4 — Team Comparison View on Team Summary Page

## Goal

Add a way to compare teams against each other on the Team Summary page, using the same impact dimensions used for individual contributors, without inflating teams by raw size.

Today the Team Summary page (`/report/[id]/team`) ranks individual developers. Filtering by team narrows the ranking but does not surface how teams compare to each other. This feature adds a **Teams** tab on the same page that lists one row per team, sorted by team-level impact.

## Non-goals

- New navigation outside the Team Summary page (no `/teams` route).
- Server-side caching of team rollups (computed on the fly client-side).
- Team detail pages (clicking a team drills back into the existing Individuals view filtered by that team).
- Configuring teams (continues to live in Settings).
- Period-over-period trend on the team row (deferred — single-period comparison only in v1).

## Architecture

Pure client-side aggregation. The Team Summary page already fetches everything required:

- `/api/report/[id]` — the full developer list with per-dev impact scores and raw metrics.
- `/api/teams?org=<org>` — teams and their `members[]` (github_login array).

A new pure function `aggregateTeams(developers, teams)` produces the team rows. It runs inside a `useMemo` on the page, keyed by `[developers, teams]`. Aggregation across ~10 teams and ~80 devs is microseconds; no caching layer needed.

```
┌─────────────────────────┐    useSWR     ┌──────────────────────┐
│ /api/report/[id]        │──────────────▶│ developers[]         │
└─────────────────────────┘               └──────────────────────┘
                                                    │
┌─────────────────────────┐    useSWR              ▼
│ /api/teams?org=<org>    │──────────▶  ┌──────────────────────┐
└─────────────────────────┘             │ aggregateTeams()     │──▶ teamRows[]
                                        └──────────────────────┘
```

### Shared impact formula

`computeImpactScore` is extracted from `src/lib/aggregator.ts` into a new module **`src/lib/impact-score.ts`** so both server (per-dev impact at report run time) and client (team-level impact via per-capita-then-apply) call the same function. No drift.

## Team row shape

```ts
interface TeamRow {
  teamId: string;
  name: string;
  color: string;

  // Sizing
  size: number;          // authoritative count from team_members
  activeCount: number;   // devs in this team who had any stats this period
  members: { login: string; impactScore: number; totalCommits: number }[];

  // Aggregates — sums
  totalPRs: number;
  totalCommits: number;
  linesAdded: number;
  linesRemoved: number;
  totalJiraIssues: number;
  totalReviews: number;
  ccTotalCost: number;
  activeRepos: number;          // distinct count across team
  typeBreakdown: Record<string, number>;

  // Aggregates — commit-weighted ratios
  avgComplexity: number;        // ∑(complexity_i × commits_i) / ∑commits_i
  prPercentage: number;
  aiPercentage: number;

  // The three impact strategies
  impactWeighted: number;       // PRIMARY, default sort: per-capita-then-apply with authoritative size
  impactAvg: number;            // arithmetic mean of active devs' impact_score
  impactTotal: number;          // computeImpactScore(team-level sums) — same formula as a "mega-developer"
}
```

### Impact formulas

Given a team's active developers (those who appear in `developer_stats` for this report):

**(T) Total — sum-then-apply**

Sum the additive raw metrics across active devs (commits, PRs, jira, reviews); compute commit-weighted averages for the ratio metrics (complexity, PR%, AI%); run `computeImpactScore` on these team-level inputs.

Useful for "who shipped the most total output," but saturates fast because the IC formula's `min(x/N, 1)` caps engage at a single-developer scale.

**(A) Avg — average of individual impacts**

```
impactAvg = mean(impact_score for dev in activeDevs)
```

Reads as "how good is a typical contributor on this team." Penalizes large teams whose averages are dragged down by lower performers; rewards small teams of strong ICs.

**(W) Weighted — per-capita-then-apply (primary, default sort)**

```
percapita_commits   = totalCommits   / teamSize       // teamSize from team_members table
percapita_prs       = totalPRs       / teamSize
percapita_jira      = totalJiraIssues / teamSize
percapita_reviews   = totalReviews   / teamSize

impactWeighted = computeImpactScore({
  totalCommits:    percapita_commits,
  totalPRs:        percapita_prs,
  avgComplexity:   commit-weighted teamComplexity,
  prPercentage:    commit-weighted teamPrPct,
  totalJiraIssues: percapita_jira,
  totalReviews:    percapita_reviews,
})
```

Key choice: the **denominator is the authoritative team size from `team_members`**, not the count of devs who happened to ship anything this period. Inactive members still dilute per-capita. This is the most defensible primary sort:

- Single-member team → W = A = T = that dev's own impact (clean degenerate case).
- Squash vs no-squash commit conventions cancel out at the team level (same distortion applied to all teams).
- Larger teams are not automatically inflated; smaller teams of strong contributors are not automatically dominant.
- Inactive headcount realistically lowers per-capita output — by design.

## UI

### Tab strip

Add a segmented tab strip below the page header on `/report/[id]/team`, styled identically to the existing tabs on `/report/[id]/org` (underline-active, accent color).

```
[ Individuals ]   [ Teams ]
```

URL state: `?view=individuals | teams`, default `individuals` (preserves existing bookmarks). State is stored via `useUrlState` with `history: 'push'`.

### Individuals tab (current behavior, unchanged)

The existing developer table renders here. The team-filter dropdown and dev-search autocomplete continue to work as today.

### Teams tab

Renders `<TeamTable />` (new component, `src/app/report/[id]/team/team-table.tsx`).

**Columns** — parity with the IC table plus team-only signals:

| Col | Source | Notes |
|-----|--------|-------|
| Team | `name` | Colored swatch using `team.color`. |
| Size | `team_members` count | Authoritative; inactive members count. |
| Active | `activeCount` | Shown as e.g. `5` or `11 −1` when some members did not ship. |
| PRs | sum | |
| Commits | sum | |
| Lines +/- | sums | Same "+L / −L" rendering as IC table. |
| Cmplx | commit-weighted | |
| PR% | commit-weighted | |
| AI% | commit-weighted | |
| Jira | sum | Column hidden if no team has any Jira issues, matching IC behavior. |
| Spend | sum | Column hidden when `!canAct`, matching IC behavior. |
| Types | summed `type_breakdown` | Same mini-bar component as IC. |
| Impact (W) | per-capita-then-apply | **Default sort** desc. Bold weight in cell. |
| Impact (A) | mean of active impacts | |
| Impact (T) | sum-then-apply | |

**Sort behavior**: every column header is a button; click toggles the active column's direction (or sets it). Default `sortBy = 'impactWeighted'`, `sortDir = 'desc'`. Tiebreaker: team name asc.

**Row interaction**: clicking a team row routes to `?view=individuals&team=<name>` (URL-encoded). The Individuals tab already supports this via the existing team-filter URL state — no new logic needed there.

### Components hidden on Teams tab

- The team-filter dropdown and developer-search autocomplete (irrelevant; the whole table is a team comparison).
- `TeamPulseCard` (it's scoped to one selected team).

### Loading / empty / edge states

- **First render, data still fetching** → match the Individuals tab's loading behavior on the same page (no table until data is ready is fine; add a skeleton only if Individuals already has one).
- **Org has no teams configured** → empty-state block: *"No teams configured for this org. Add teams in Settings to compare."* — no table rendered.
- **Team with 0 active devs** → row rendered with `−` placeholders for ratios and `0`s for sums; impact columns show `0.0`; row text dimmed to make idle teams visually distinct from working teams.
- **Team size = 0** (orphan in DB) → row skipped entirely; logged to console.

## Edge cases

| Case | Behavior |
|---|---|
| Dev belongs to multiple teams | Counted in every team they're a member of. Documented in a tooltip on the `Team` column header: *"A developer in multiple teams contributes to each team's totals."* No de-duping for v1. |
| Dev belongs to no team | Silently excluded (consistent with how the existing team filter behaves). |
| Latest report not completed | Tab strip disabled; existing loading/error state renders. |
| API failure | Existing SWR error UI renders; no new failure paths introduced. |
| Squash vs no-squash commit conventions | Per-capita math is scale-invariant in this dimension; bias cancels across teams. Documented in the (W) column tooltip. |

## Files touched

- **New**: `src/lib/impact-score.ts` — extracted `computeImpactScore` (function move, no logic change).
- **New**: `src/lib/teams/team-aggregator.ts` — `aggregateTeams(developers, teams)` pure function.
- **New**: `src/app/report/[id]/team/team-table.tsx` — `<TeamTable />` component.
- **Modified**: `src/lib/aggregator.ts` — re-export `computeImpactScore` from `impact-score.ts` (or replace internal usage with a re-import) to preserve the existing import path.
- **Modified**: `src/app/report/[id]/team/page.tsx` — add the `view` URL state, the tab strip, conditional rendering of `<TeamTable />` vs the current developer table, hide filter dropdowns + TeamPulseCard on the Teams tab.

## Tests

| Layer | File | Coverage |
|---|---|---|
| **Pure logic** | `src/lib/__tests__/unit/team-aggregator.test.ts` | `aggregateTeams()` — sum aggregation, commit-weighted ratios, all three impact strategies, divide-by-zero guard (size = 0), multi-team membership double-counting, team with no active devs, authoritative-size vs active-count gap reporting, single-member team identity (W = A = T = dev's impact). |
| **Formula identity** | `src/lib/__tests__/unit/impact-score.test.ts` | Move/refresh existing coverage on `computeImpactScore` after the extraction. Pin numeric expectations on a handful of canonical inputs. |
| **Visual / interactive** | n/a | Out of scope; project has no RTL/Playwright harness today. Page risk is in the data layer, which is fully unit-tested. |

## Open questions (none blocking implementation)

- Should multi-team developers be de-duplicated against each row? Deferred — v1 ships with double-counting and a tooltip.
- Period-over-period trend arrow on the team row? Deferred — v1 is single-period.
- Should "(no team)" devs be surfaced in a synthetic bottom row? Decided **no** for v1 (silently excluded, matching existing filter behavior).

## Hand-off

This spec is intended for two follow-up workflows:

1. **Visual design polish** — the user has requested handing off to *Claude Design* for visual treatment of the new tab/table. Implementation will follow whatever Claude Design produces, scoped to the column set and interaction model defined above.
2. **Implementation plan** — once the spec is approved (and visual design returns), a plan will be drafted via `superpowers:writing-plans` and executed.
