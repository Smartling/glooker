# Unmerged Work — Org Charts Addendum

**Date:** 2026-04-25
**Status:** Approved for implementation planning
**Builds on:** `docs/superpowers/specs/2026-04-24-unmerged-work-design.md`

## 1. Goal

Extend the unmerged-work feature with an org-level surface. Show the in-flight totals as KPI cards above the existing timeline charts, and color in-flight commits as a distinct `in_flight` type in the existing Commits-by-Type visualizations so the in-flight share is visible alongside shipped work.

## 2. Why this design

The base feature (PR #32) tracks open PRs and bare-branch commits per developer in the `unmerged_work` table, surfaced on the Dev Detail page. The same data has org-level value: managers want to see how much work is in flight across the team without drilling into individual developers.

The cleanest way to surface in-flight commits on the existing charts is to treat "in-flight" as a commit type. Every commit already carries a `type` (feature/bug/refactor/infra/docs/test/other) used by the org-page pie and stacked-types charts. Override `type` to `in_flight` for any commit currently classified as bare-branch in the report's `unmerged_work` snapshot. The charts pick up the new value as a new colored slice/layer with no chart-machinery changes.

Verified during brainstorm against the latest local report (`74326e3e-bb3a-425f-9c3c-fa2b1d4da9d5`): 62 open PRs across 33 devs, 0 bare-branch commits. Sampled 15 of `msogin`'s and 5 other engineers' no-PR commits via `compareCommits` — all in default branch. The 0 bare-branch count is genuinely correct for this org's working style. The empty `in_flight` slice on the chart is meaningful information ("nothing orphaned").

## 3. Scope

### In-scope
- Three KPI cards added above the existing timeline charts on the org page: **Open PRs**, **Bare-branch commits**, **In-flight lines** (sum of open-PR additions/deletions).
- `in_flight` added to `TYPE_COLORS` and `TYPE_HEX` constants in the org page.
- Override the per-commit `type` to `in_flight` for any commit whose SHA is in `unmerged_work` (kind=`bare_branch_commit`) for the current report.
- KPI cards are shown only when the report has any unmerged-work data (gated by total count > 0). When zero, the row is hidden — same pattern the Dev Detail page uses.
- Manual verification task at end of implementation (see §8).

### Out of scope
- KPI cards on the team summary or dev detail pages (already covered by the dev-page list section).
- Time-series chart of "Open PRs / Week" or similar — deferred. The user explicitly chose to start broad and merge later only if useful.
- "Open PRs by Repo" panel — explicitly deferred per user.
- Admin gating — unmerged work is non-sensitive (no spend data) and visible to all viewers.

## 4. Data shape

The org API (`/api/report/[id]/org`) already returns `developers[]` and `timeline[]`. No new endpoint. Two extensions to `getOrgReport` in `src/lib/report/org.ts`:

### 4.1 Add an `unmergedSummary` field to the response

```typescript
unmergedSummary: {
  openPrCount:        number;     // count of unmerged_work rows with kind='open_pr'
  bareBranchCount:    number;     // count of unmerged_work rows with kind='bare_branch_commit'
  inFlightLinesAdded: number;     // sum of pr_additions across all open_pr rows
  inFlightLinesRemoved: number;   // sum of pr_deletions across all open_pr rows
}
```

Computed via a single aggregation query against `unmerged_work` filtered by `report_id = ?`.

### 4.2 Re-classify timeline commits as `in_flight`

The existing `getOrgReport` already runs:
```typescript
const [tlRows] = await db.execute(/* SELECT commits across all reports for org */);
timelineCommits = dedupCommitsBySha(tlRows);
```

Add a step after dedup, before `aggregateWeekly`:

```typescript
const [bareSha] = await db.execute(
  `SELECT commit_sha FROM unmerged_work
   WHERE report_id = ? AND kind = 'bare_branch_commit'`,
  [reportId],
) as [any[], any];
const bareSet = new Set(bareSha.map((r: any) => r.commit_sha));

for (const c of timelineCommits) {
  if (bareSet.has(c.commit_sha)) c.type = 'in_flight';
}
```

The override happens **only** for the current report's snapshot. Older reports' commits keep their original type (those commits would have shown bare-branch in their own snapshot but are now merged — semantically correct: the chart "tells the truth as of this report").

`aggregateWeekly` then naturally counts `in_flight` like any other type.

## 5. UI changes

File: `src/app/report/[id]/org/page.tsx`

### 5.1 Type registry

Add `in_flight` to both maps:

```typescript
const TYPE_COLORS: Record<string, string> = {
  feature: 'bg-blue-500', bug: 'bg-red-500', refactor: 'bg-purple-500',
  infra: 'bg-yellow-500', docs: 'bg-gray-500', test: 'bg-green-500',
  other: 'bg-gray-600',
  in_flight: 'bg-amber-400',
};
const TYPE_HEX: Record<string, string> = {
  feature: '#3B82F6', bug: '#EF4444', refactor: '#A855F7',
  infra: '#EAB308', docs: '#6B7280', test: '#22C55E',
  other: '#4B5563',
  in_flight: '#FBBF24',
};
```

The amber color is distinct from the existing palette — calls attention to "this is unmerged" without colliding with feature/bug/etc.

### 5.2 KPI card row

Inserted directly above the existing "Org Activity Over Time (weekly)" header. Shown only when `unmergedSummary && (openPrCount > 0 || bareBranchCount > 0)`.

```
┌───────────────────────┬───────────────────────┬──────────────────────────────────┐
│ OPEN PRS              │ BARE-BRANCH COMMITS   │ IN-FLIGHT LINES                  │
│ 62                    │ 0                     │ +12,431 / −2,118                 │
│ across 33 devs        │ no orphaned WIP       │ from open PRs                    │
└───────────────────────┴───────────────────────┴──────────────────────────────────┘
```

Sub-text on each card:
- Open PRs: `across N devs` where N = distinct `github_login` count for `kind='open_pr'`. Computed in the API.
- Bare-branch: `no orphaned WIP` when zero, else `across N devs`.
- In-flight lines: literal `from open PRs` (since we don't currently sum bare-branch lines into this tile to keep the meaning clear).

### 5.3 Pie chart legend

The existing `PieChart` reads `TYPE_HEX` directly via the `entries` it receives from `Object.entries(orgTypes).sort(...)`. With `in_flight` added to `TYPE_HEX`, the slice renders automatically. Legend label uses the literal string `in_flight` — match the existing pattern (no humanization on other types either).

### 5.4 Stacked types chart

The existing `StackedTypesChart` derives its color from `TYPE_HEX`. Adding `in_flight` to the `typeOrder` array (which currently lists `['feature','bug','refactor','infra','docs','test','other']`) makes the new layer render. Place `in_flight` last so it stacks on top:

```typescript
const typeOrder = ['feature','bug','refactor','infra','docs','test','other','in_flight'].filter(t => allTypes.has(t));
```

## 6. API contract change

`getOrgReport` returns one new key. Existing keys unchanged.

```typescript
// Before:
return { report, developers, timeline, spendWindow };

// After:
return { report, developers, timeline, spendWindow, unmergedSummary };
```

`unmergedSummary` is `null` when the report has no `unmerged_work` rows, so the UI can guard with a single null-check.

## 7. Testing

- **Unit test** in a new file `src/lib/__tests__/unit/org-unmerged-summary.test.ts`: given a mocked `db.execute` returning a known set of `unmerged_work` rows, assert `getOrgReport` returns the correct counts and sums. Cover the "no rows" path → `unmergedSummary` is null.
- **Type-override test** in the same file: given a `commit_analyses` row with `type='feature'` and a matching `unmerged_work` row with `kind='bare_branch_commit'`, assert that the timeline data has `type='in_flight'` for that commit.
- **No new integration test** required — the runner doesn't change. The existing `report-runner.test.ts` already covers the data-population side.
- **Snapshot tests**: none of the existing org-page tests render the chart visually. No snapshot changes expected.

## 8. Manual verification (final task)

After implementation, verify the bare-branch detection actually works against a real GitHub branch:

1. On `msogin`'s laptop, in the `glooker` repo, create a branch `verify-bare-branch-detection`, make a small commit (e.g., add a comment to a README), push the branch to `origin` **without** opening a PR.
2. Run a fresh report locally against `Smartling` org. Wait for it to complete.
3. Open the org summary page → confirm the KPI card shows `Bare-branch commits: ≥ 1`.
4. Open the Commits by Type pie → confirm an amber `in_flight` slice is visible.
5. Open `msogin`'s dev detail page → confirm the In-flight Work section shows the commit under "Branch Commits (not in default branch)".
6. Delete the test branch when done.

This step is owned by the user (`msogin`) since it requires their git credentials and the local report cycle. Goal is a sanity check that bare-branch detection finds new bare-branch commits — the latest local report (`74326e3e`) showed 0 bare-branch rows, which is expected for this org's working style but is worth verifying with a contrived example.

## 9. Out of scope / explicitly deferred

- Time-series version of in-flight metrics (e.g., "Open PRs / Week"). Defer until we have a felt need.
- Per-repo in-flight breakdown panel.
- Inclusion of bare-branch commit lines in the "In-flight lines" tile (currently only sums open-PR additions/deletions). Add later if zero bare-branch turns out to be unusual.

## 10. Open questions resolved during brainstorm

| Question | Decision |
|---|---|
| Snapshot KPI cards or time-series overlay? | KPI cards now, overlay considered later — Option A confirmed |
| How to surface in-flight on existing charts? | Treat as a new commit type `in_flight`, inheriting all chart machinery |
| Bucket open PRs by created or updated date? | N/A — no PR time-series chart in this scope |
| Admin gating? | None — same as Dev Detail page (non-sensitive data) |
| 0 bare-branch in the latest report — bug or correct? | Correct, verified via direct GitHub API sampling. Manual verification step (§8) added to confirm the detection path works end-to-end with a contrived case. |

---

## Addendum 2026-04-27: Replace bare-branch type override with open-PR overlay

**Why:** During implementation review, discovered that GitHub's commit search API returns commits from default branches only — branch-only commits (the basis of `bare_branch_commit` rows) and commits-inside-open-PRs never enter `commit_analyses`. As a result the bare-branch type override paints a near-empty slice and the substantial 600+ commits sitting inside open PRs are invisible to all charts.

**Change:** Stop overriding `type='in_flight'` on bare-branch commit SHAs. Instead, source the `in_flight` category from `unmerged_work` rows where `kind='open_pr'`:
- For each open-PR row, take its `pr_commits`, `pr_additions`, `pr_deletions`.
- Bucket by the week of `pr_updated_at`.
- Add `pr_commits` to that week's `commits` total AND `types.in_flight`.
- Add `pr_additions` / `pr_deletions` to that week's `linesAdded` / `linesRemoved` AND new fields `inFlightLinesAdded` / `inFlightLinesRemoved`.
- If the week didn't already exist in the timeline, create it.

**Visual semantics:** Bars on `Commits/Week` and `Lines Changed/Week` get **taller** — totals now reflect both shipped (`commit_analyses` rows) and in-flight (open-PR aggregates). Stacked: shipped at the bottom (existing color), in-flight at the top (amber `#FBBF24`). Pie + stacked-types charts pick up `in_flight` automatically via the type counts.

**Bare-branch tracking:** `unmerged_work.kind='bare_branch_commit'` rows remain in the schema. The `Bare-branch commits` KPI card stays. Only the chart override is removed — bare-branch commits aren't added to `in_flight` because they're not in `commit_analyses` (so they wouldn't show up in any timeline anyway, and adding them would double-count if they're ever surfaced).

**Bucket date:** `pr_updated_at` (last activity), not `pr_created_at`.

**Tests update:** The "overrides type to in_flight for bare-branch" test is replaced with: "open PRs contribute to `types.in_flight` and `inFlightLines*` per the week of `pr_updated_at`".
