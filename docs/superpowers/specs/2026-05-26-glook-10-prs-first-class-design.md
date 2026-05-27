# GLOOK-10 — Surface PR count as a first-class metric in graphs

> **Scope note (post-implementation):** Initial design called for a single `PRs / Week` chart. During implementation the user requested a companion `Avg Lines Changed / PR` chart (sized to give the "throughput vs size" story), with a P95 outlier filter mirroring the existing Lines Changed chart's smoothing. Both ship together. This doc has been updated below to reflect what landed.

## Goal

PR count is the most heavily weighted contributor to the IC impact score (`min(PRs/10, 1) × 2.7`), but it's currently invisible in every time-series chart on the org and engineer pages. Add a `PRs / Week` chart **and a companion `Avg Lines Changed / PR (outliers excluded)` chart** on each page, mirroring the existing `Commits / Week` and `Lines Changed / Week` charts respectively, so the metric that drives impact is also visible in the time-series story — both as throughput (count) and as size (avg).

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
  prs: number;              // NEW: distinct pr_number values that week
  avgLinesPerPr: number;    // NEW: avg lines per PR active in week (outliers excluded)
  linesAdded: number;
  linesRemoved: number;
  // ... (rest unchanged)
}
```

**`prs`** — in the per-week accumulator, add `prNumbers: Set<string>` alongside the existing `activeDevs: Set<string>`. For each commit row: `if (c.pr_number != null) w.prNumbers.add(String(c.pr_number))`. Emit `prs: w.prNumbers.size`.

**`avgLinesPerPr`** — first-pass compute `prLineTotals: Map<pr_number, totalLines>` across all weeks. Derive a P95 threshold over distinct PRs using `sortedPrTotals[Math.ceil(N * 0.95) - 1]` (NOT `floor` — `floor` returns the max at N≤20 and the filter degenerates to a no-op). In the per-week accumulator, track `prNumbersP95: Set<string>` and `prLinesP95: number`; only add a commit's lines to these if its PR's total ≤ threshold. Emit `avgLinesPerPr = prNumbersP95.size > 0 ? round(prLinesP95 / prNumbersP95.size) : 0`.

**Semantic of `avgLinesPerPr`** — per-week slice of activity. A PR's *total* across all weeks decides whether it's an outlier (stable filter across the chart), but only the lines from this week's commits go into this week's numerator, and the denominator is the count of PRs active in this week. A 400-line PR split 200/200 across two weeks shows avg=200 in each; a 400-line PR landing in one week shows avg=400 there. This is "average per-PR activity in week W," not "size of the average PR overall."

### Definition

A "PR for the week" is **any merged PR whose commits landed in that week**. We dedupe by `pr_number`, so a PR with N commits in the same week counts as 1; a PR with commits spanning two weeks counts in each week's bucket (which is the right interpretation for a weekly chart — the PR was active in both weeks).

This matches the existing `COUNT(DISTINCT pr_number)` definition used by the team-pulse data pipeline (`src/lib/team-pulse/data.ts`) and the IC table's `total_prs` field — no new semantic to teach users.

### Why not a separate query / endpoint

The `commit_analyses` rows already carry `pr_number` and they're already passed through `aggregateWeekly()` on every page render. Counting them per week is a pure data-shape change, not a new fetch.

## UI layer

### Both pages: `org/page.tsx` and `dev/[login]/page.tsx`

1. Add `prs: number` and `avgLinesPerPr: number` to the local `WeeklyData` interface (mirrors `WeeklyBucket`).
2. Add **two new `<TimelineChart>` invocations** immediately after the existing `Commits / Week` chart:

```tsx
<TimelineChart data={timeline} valueKey="prs" label="PRs / Week" color="#06B6D4" />
<TimelineChart
  data={timeline}
  valueKey="avgLinesPerPr"
  label="Avg Lines Changed / PR (outliers excluded)"
  color="#EC4899"
  suffix=" lines"
/>
```

3. No `computeValue` or `inFlightValue` props — both are direct numeric fields.
4. Tooltip / scale / height inherit from `TimelineChart` defaults.

### Color choice

- `#06B6D4` (Tailwind cyan-500) for **PRs / Week** — distinct from `#A855F7` (purple-500) used by AI Assisted % on the same grid; earlier purple-400 (`#A78BFA`) was too close to the AI hue.
- `#EC4899` (Tailwind pink-500) for **Avg Lines Changed / PR** — reads as "size, not count," and doesn't collide with amber (used by Avg Complexity on the dev page).

### Placement

The new chart goes **immediately after** Commits/Week on both pages. Rationale: PRs and commits are conceptually the same axis (both are "shipped work units, counted per week"); pairing them visually reinforces that and lets the reader scan delta between volume-of-commits and volume-of-PRs at a glance.

## Tests

| Layer | What | Where |
|---|---|---|
| Unit — `prs` aggregation | Cases: rows with no `pr_number` → 0; duplicates → counted once; multiple distinct PRs; PR spanning two weeks → counted in each; mixed PR + direct-push rows. | `src/lib/__tests__/unit/timeline.test.ts` |
| Unit — `avgLinesPerPr` aggregation | Cases: zero PRs → 0; single-PR-multi-commit sum; avg across distinct PRs; direct-push lines excluded from numerator; integer rounding; **P95 outlier exclusion at N=20 boundary**; **degrades to no-filter at N<20**; **cross-week semantic lockdown** (per-week slice / per-week distinct count). | same file |
| Visual / interactive | None. Repo has no RTL/Playwright harness. Manual smoke. | n/a |

## Edge cases

| Case | Behavior |
|---|---|
| Week with 0 commits and 0 PRs | Renders as empty bar (same as Commits/Week handles the no-commits case today). |
| Commit row has `pr_number = null` (direct push) | Contributes to commits count, contributes 0 to PRs count, contributes 0 to `avgLinesPerPr` numerator. Correctly reflects: "this work landed without a PR." |
| Many small PRs in one week | PRs/Week bar is tall; Avg Lines/PR stays low. |
| PR with 50 commits across one week | Counted as 1 PR. Total of its lines / 1 = the avg. |
| Org-wide week has only in-flight commits (no shipped) | In-flight overlay creates a bucket with `prs: 0, avgLinesPerPr: 0` — both new charts render as zero, no NaN/undefined. |
| < 20 PRs in the lookback window | `avgLinesPerPr` P95 filter degenerates to no-filter (you can't meaningfully exclude top 5% of a tiny population). Chart shows raw average. |

## Files touched

- **Modify** `src/lib/report/timeline.ts` — `prs` + `avgLinesPerPr` on `WeeklyBucket`, accumulator state, PR-level P95 threshold.
- **Modify** `src/lib/report/org.ts` — add `pr_number` to the `commit_analyses` SELECT; zero-default `prs`/`avgLinesPerPr` in the in-flight overlay bucket initializer.
- **Modify** `src/lib/report/dev.ts` — add `pr_number` to the `commit_analyses` SELECT.
- **Modify** `src/app/report/[id]/org/page.tsx` — `WeeklyData` interface gains both fields; two new `<TimelineChart>` invocations after Commits/Week.
- **Modify** `src/app/report/[id]/dev/[login]/page.tsx` — same two changes.
- **Create** `src/lib/__tests__/unit/timeline.test.ts` — unit tests for both aggregations.
