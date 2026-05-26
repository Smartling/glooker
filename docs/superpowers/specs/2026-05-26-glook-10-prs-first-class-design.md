# GLOOK-10 — Surface PR count as a first-class metric in graphs

## Goal

PR count is the most heavily weighted contributor to the IC impact score (`min(PRs/10, 1) × 2.7`), but it's currently invisible in every time-series chart on the org and engineer pages. Add a `PRs / Week` chart on each page, mirroring the existing `Commits / Week` chart, so the metric that drives impact is also visible in the time-series story.

## Non-goals

- **Recomputing or redesigning the impact formula itself.** Out of scope; separate concern.
- **Adding PR data to non-time-series charts** (the per-repo bar, the commit-type pie, the complexity chart, etc.). Those measure different dimensions; the PRs/Week chart satisfies the ticket's "wherever a commits time-series is rendered, a parallel PRs time-series is rendered" criterion.
- **Refactoring the duplicated inline `TimelineChart` component** out of org/page.tsx and dev/[login]/page.tsx into a shared component. Tempting, but a separate concern — this PR keeps the existing inline-duplication pattern intact and just adds another chart invocation per page.
- **Per-developer rankings.** The org page's developer ranking table (line 296) and spend table (line 1102) already render a PRs column — verified during exploration. No change there.
- **In-flight (open) PR overlay on the new chart.** In-flight is already a separate KPI card surface; mixing shipped vs in-flight PR series on one chart is a separate UX decision.

## Architecture

```
                                                            ┌────────────────────┐
commit_analyses rows ─► aggregateWeekly() ─► WeeklyBucket[] │  prs: number  ◄── NEW
                            (timeline.ts)                   │  commits, lines…   │
                                                            └────────────────────┘
                                                                      │
                                                ┌─────────────────────┼─────────────────────┐
                                                ▼                                           ▼
                                  /api/report/[id] (org)                      /api/report/[id]/dev/[login]
                                                │                                           │
                                                ▼                                           ▼
                                org/page.tsx WeeklyData                     dev/page.tsx WeeklyData
                                                │                                           │
                                                ▼                                           ▼
                                 <TimelineChart valueKey="commits" />         <TimelineChart valueKey="commits" />
                                 <TimelineChart valueKey="prs" />  ◄── NEW    <TimelineChart valueKey="prs" />  ◄── NEW
```

Single change at the data-aggregator level cascades through both pages naturally.

## Data layer

### `src/lib/report/timeline.ts`

Extend the `WeeklyBucket` interface and the `aggregateWeekly()` implementation:

```ts
export interface WeeklyBucket {
  week: string;
  commits: number;
  prs: number;           // NEW: distinct pr_number values that week
  linesAdded: number;
  linesRemoved: number;
  // ... (rest unchanged)
}
```

Implementation: in the per-week accumulator, add a `prNumbers: Set<string>` alongside the existing `activeDevs: Set<string>`. For each commit row:

```ts
if (c.pr_number != null) w.prNumbers.add(String(c.pr_number));
```

Emit `prs: w.prNumbers.size` from the final `.map(...)`.

### Definition

A "PR for the week" is **any merged PR whose commits landed in that week**. We dedupe by `pr_number`, so a PR with N commits in the same week counts as 1; a PR with commits spanning two weeks counts in each week's bucket (which is the right interpretation for a weekly chart — the PR was active in both weeks).

This matches the existing `COUNT(DISTINCT pr_number)` definition used by the team-pulse data pipeline (`src/lib/team-pulse/data.ts`) and the IC table's `total_prs` field — no new semantic to teach users.

### Why not a separate query / endpoint

The `commit_analyses` rows already carry `pr_number` and they're already passed through `aggregateWeekly()` on every page render. Counting them per week is a pure data-shape change, not a new fetch.

## UI layer

### Both pages: `org/page.tsx` and `dev/[login]/page.tsx`

1. Add `prs: number` to the local `WeeklyData` interface (mirrors `WeeklyBucket`).
2. Add **one new `<TimelineChart>` invocation** immediately after the existing `Commits / Week` chart:

```tsx
<TimelineChart
  data={timeline}
  valueKey="prs"
  label="PRs / Week"
  color="#A78BFA"   // purple-400 — distinct from greens (commits) and amber (lines)
/>
```

3. No `computeValue` or `inFlightValue` props — `prs` is a direct numeric field.
4. Tooltip / scale / height all inherit from the existing `TimelineChart` defaults.

### Color choice

`#A78BFA` (Tailwind purple-400). Reasoning:
- Greens are already taken by commits / lines-added.
- Ambers / reds are lines-removed.
- Blues are sometimes used for AI%.
- Purple sits cleanly in the unused part of the existing palette and won't clash on either page.

### Placement

The new chart goes **immediately after** Commits/Week on both pages. Rationale: PRs and commits are conceptually the same axis (both are "shipped work units, counted per week"); pairing them visually reinforces that and lets the reader scan delta between volume-of-commits and volume-of-PRs at a glance.

## Tests

| Layer | What | Where |
|---|---|---|
| Unit — aggregator | `aggregateWeekly()` emits `prs` = distinct `pr_number` count per week. Cases: rows with no `pr_number` → 0; rows with duplicate `pr_number` → counted once; rows with multiple distinct PRs → all counted; PR spanning two weeks → counted in each. | New file `src/lib/__tests__/unit/timeline.test.ts` (no existing tests on `timeline.ts`; verified via `ls`). |
| Visual / interactive | None. Repo has no RTL/Playwright harness; the chart is a copy of an existing chart with a different field. Manual smoke. | n/a |

## Edge cases

| Case | Behavior |
|---|---|
| Week with 0 commits and 0 PRs | Renders as empty bar (same as Commits/Week handles the no-commits case today). |
| Commit row has `pr_number = null` (direct push) | Contributes to commits count, contributes 0 to PRs count. Correctly reflects: "this work landed without a PR." |
| Many small PRs in one week | Bar is tall — same visual treatment as a high commit count. |
| PR with 50 commits across one week | Counted as 1 PR — distinct on pr_number. The volume is visible in the Commits/Week chart; this chart specifically tells the story of PR throughput, not commit volume per PR. |

## Files touched

- **Modify** `src/lib/report/timeline.ts` — `prs` field on `WeeklyBucket`, `prNumbers` set in the accumulator, `prs: w.prNumbers.size` in the final map.
- **Modify** `src/app/report/[id]/org/page.tsx` — `WeeklyData` interface gains `prs`; one new `<TimelineChart>` invocation after Commits/Week.
- **Modify** `src/app/report/[id]/dev/[login]/page.tsx` — same two changes.
- **Modify or Create** `src/lib/__tests__/unit/timeline.test.ts` — unit tests for the new `prs` aggregation.
