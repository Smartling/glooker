# GLOOK-21: Avg Impact Score / Week Timeline Chart

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Active Developers / Week" chart on the org summary page with "Avg Impact Score / Week", sourced from completed reports in the DB.

**Architecture:** Add `avgImpact?: number` to `WeeklyBucket`. In `getOrgReport`, after building the commit-based timeline (including in-flight overlay), run one SQL query to fetch `AVG(impact_score)` per completed report for the org, bucket by week in JS using `weekKeyForDate`, average multiple reports in the same week, then merge into the existing timeline. Frontend swaps a single `valueKey` prop.

**Tech Stack:** TypeScript, Next.js 15, Jest + ts-jest, SQLite (dev) + MySQL (prod)

---

## File Map

| File | Change |
|---|---|
| `src/lib/report/timeline.ts` | Add `avgImpact?: number` to `WeeklyBucket` |
| `src/lib/report/org.ts` | Remove `trackDevs: true`, remove `activeDevs: 0` default, add SQL + merge logic |
| `src/lib/__tests__/unit/report-org.test.ts` | Replace `trackDevs` test; add two new avgImpact tests |
| `src/app/report/[id]/org/page.tsx` | Update `WeeklyData` interface; swap chart `valueKey` |

---

### Task 1: Add `avgImpact` to `WeeklyBucket` and clean up `activeDevs`

**Files:**
- Modify: `src/lib/report/timeline.ts`
- Modify: `src/lib/report/org.ts`

- [ ] **Step 1: Add `avgImpact` to `WeeklyBucket` interface**

In `src/lib/report/timeline.ts`, the `WeeklyBucket` interface currently ends at line ~18 with `inFlightLinesP95Removed`. Add `avgImpact` to it:

```typescript
export interface WeeklyBucket {
  week: string;
  commits: number;
  prs: number;
  avgLinesPerPr: number;
  linesAdded: number;
  linesRemoved: number;
  linesP95Added: number;
  linesP95Removed: number;
  avgComplexity: number;
  aiPercent: number;
  types: Record<string, number>;
  activeDevs?: number;
  inFlightLinesAdded?: number;
  inFlightLinesRemoved?: number;
  inFlightLinesP95Added?: number;
  inFlightLinesP95Removed?: number;
  avgImpact?: number;
}
```

- [ ] **Step 2: Remove `trackDevs: true` from `aggregateWeekly` call in `org.ts`**

In `src/lib/report/org.ts` at line 56, change:

```typescript
  const timeline = aggregateWeekly(timelineCommits, { trackDevs: true });
```

to:

```typescript
  const timeline = aggregateWeekly(timelineCommits);
```

- [ ] **Step 3: Remove `activeDevs: 0` from the in-flight overlay new-bucket template in `org.ts`**

The in-flight overlay (around line 88–106) creates a new bucket object for weeks that have in-flight commits but no merged commits. Remove the `activeDevs: 0` field from it:

```typescript
      bucket = {
        week: weekKey,
        commits: 0,
        prs: 0,
        avgLinesPerPr: 0,
        linesAdded: 0,
        linesRemoved: 0,
        linesP95Added: 0,
        linesP95Removed: 0,
        avgComplexity: 0,
        aiPercent: 0,
        types: {},
        inFlightLinesAdded: 0,
        inFlightLinesRemoved: 0,
        inFlightLinesP95Added: 0,
        inFlightLinesP95Removed: 0,
      };
```

- [ ] **Step 4: Run the existing tests to confirm nothing broke**

```bash
npm test -- --testPathPattern="report-org" --no-coverage
```

Expected: One test will FAIL — `'timeline uses trackDevs:true (has activeDevs field)'` — because `activeDevs` is no longer set. All other tests should PASS. That failing test will be replaced in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/timeline.ts src/lib/report/org.ts
git commit -m "feat(glook-21): add avgImpact to WeeklyBucket, remove trackDevs"
```

---

### Task 2: TDD — avgImpact SQL query and merge in `getOrgReport`

**Files:**
- Modify: `src/lib/__tests__/unit/report-org.test.ts`
- Modify: `src/lib/report/org.ts`

Context on the mock call order in `getOrgReport` tests: `mockDbExecute.mockResolvedValueOnce` calls are consumed in the order DB queries run. After Task 1's changes, the order is:
1. Report metadata (`SELECT ... FROM reports WHERE id = ?`)
2. Developer stats (`SELECT ... FROM developer_stats WHERE report_id = ?`)
3. All report IDs for org (`SELECT id FROM reports WHERE org = ?`)
4. Timeline commits (`SELECT ... FROM commit_analyses WHERE report_id IN (...)`)
5. **NEW** — Avg impact per report (added in this task)
6. In-flight overlay (`SELECT committed_at ... FROM unmerged_commits WHERE report_id = ?`)
7. Unmerged KPI aggregation (big multi-subquery)

The `beforeEach` sets `mockDbExecute.mockResolvedValue([[], null])` as the default for any call without a specific `mockResolvedValueOnce`. Existing tests that only mock 4 calls will hit the default `[[], null]` for calls 5+, which means `avgImpact` stays `undefined` — that's fine for tests that don't assert on it.

- [ ] **Step 1: Replace the `trackDevs` test and add two new avgImpact tests**

In `src/lib/__tests__/unit/report-org.test.ts`, find and replace the test block starting with `it('timeline uses trackDevs:true (has activeDevs field)'` (line 160) with these three tests:

```typescript
  it('does not set activeDevs on timeline buckets (trackDevs removed)', async () => {
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[commitRow], null]);

    const result = await getOrgReport('report-1');

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).not.toHaveProperty('activeDevs');
  });

  it('merges avgImpact into timeline bucket for the report completion week', async () => {
    // commitRow.committed_at = '2026-01-15T10:00:00Z' → week of 2026-01-13 (Mon)
    // completed_at below is also in that week
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[commitRow], null])
      .mockResolvedValueOnce([[{
        id: 'report-1',
        completed_at: '2026-01-15T12:00:00Z',
        avg_impact: '7.5',
      }], null]);

    const result = await getOrgReport('report-1');

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].avgImpact).toBeCloseTo(7.5);
  });

  it('averages avgImpact when multiple reports complete in the same week', async () => {
    // commitRow is week 2026-01-13; both reports below also land in that week
    mockDbExecute
      .mockResolvedValueOnce([[reportRow], null])
      .mockResolvedValueOnce([[devRow], null])
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])
      .mockResolvedValueOnce([[commitRow], null])
      .mockResolvedValueOnce([[
        { id: 'report-1', completed_at: '2026-01-14T12:00:00Z', avg_impact: '6.0' },
        { id: 'report-2', completed_at: '2026-01-16T12:00:00Z', avg_impact: '8.0' },
      ], null]);

    const result = await getOrgReport('report-1');

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].avgImpact).toBeCloseTo(7.0);
  });
```

- [ ] **Step 2: Run tests to verify they fail as expected**

```bash
npm test -- --testPathPattern="report-org" --no-coverage
```

Expected: The two new avgImpact tests FAIL (avgImpact is undefined). The `not.toHaveProperty('activeDevs')` test should already PASS (from Task 1's cleanup).

- [ ] **Step 3: Add the SQL query and merge logic in `getOrgReport`**

In `src/lib/report/org.ts`, insert the following block **after** the in-flight overlay sort (after `timeline.sort((a, b) => a.week.localeCompare(b.week));`, around line 129):

```typescript
  // 4b. Avg impact per completed report, bucketed by week and merged into timeline.
  // Uses weekKeyForDate (same helper as aggregateWeekly) so week keys align.
  const [impactRows] = await db.execute(
    `SELECT r.id, r.completed_at, AVG(ds.impact_score) AS avg_impact
     FROM reports r
     JOIN developer_stats ds ON ds.report_id = r.id
     WHERE r.org = ? AND r.status = 'completed'
     GROUP BY r.id, r.completed_at
     ORDER BY r.completed_at ASC`,
    [org],
  ) as [any[], any];

  const impactSumByWeek = new Map<string, { sum: number; count: number }>();
  for (const row of impactRows) {
    if (!row.completed_at) continue;
    const weekKey = weekKeyForDate(new Date(row.completed_at));
    const val = Number(row.avg_impact) || 0;
    const entry = impactSumByWeek.get(weekKey) ?? { sum: 0, count: 0 };
    entry.sum += val;
    entry.count++;
    impactSumByWeek.set(weekKey, entry);
  }

  const timelineByWeek = new Map<string, any>(timeline.map(w => [w.week, w]));
  for (const [week, { sum, count }] of impactSumByWeek.entries()) {
    const bucket = timelineByWeek.get(week);
    if (bucket) bucket.avgImpact = sum / count;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="report-org" --no-coverage
```

Expected: All tests PASS, including the two new avgImpact tests.

- [ ] **Step 5: Run the full test suite**

```bash
npm test --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/__tests__/unit/report-org.test.ts src/lib/report/org.ts
git commit -m "feat(glook-21): avgImpact SQL query + week-bucket merge in getOrgReport"
```

---

### Task 3: Update frontend — swap chart and fix WeeklyData type

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Update `WeeklyData` interface**

In `src/app/report/[id]/org/page.tsx`, find the `WeeklyData` interface (around line 44). It currently has `activeDevs: number`. Replace `activeDevs` with `avgImpact`:

```typescript
interface WeeklyData {
  week: string; commits: number; prs: number; avgLinesPerPr: number; linesAdded: number; linesRemoved: number;
  linesP95Added?: number; linesP95Removed?: number;
  avgComplexity: number; aiPercent: number; types: Record<string, number>; avgImpact?: number;
  inFlightLinesAdded?: number; inFlightLinesRemoved?: number;
  inFlightLinesP95Added?: number; inFlightLinesP95Removed?: number;
}
```

- [ ] **Step 2: Swap the chart**

Find the `TimelineChart` that renders `activeDevs` (around line 295):

```tsx
<TimelineChart data={timeline} valueKey="activeDevs" label="Active Developers / Week" color="#10B981" />
```

Replace it with:

```tsx
<TimelineChart data={timeline} valueKey="avgImpact" label="Avg Impact Score / Week" color="#10B981" decimals={1} />
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 4: Verify in the browser**

Start the dev server:

```bash
npm run dev
```

Open the org summary page for any report that has completed data. Confirm:
- The "Active Developers / Week" chart is gone.
- A new "Avg Impact Score / Week" chart appears in its place showing decimal values (e.g., 7.3).
- The chart renders correctly with the 90-day window filter and the existing `TimelineChart` tooltip.
- All other 5 charts are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/app/report/[id]/org/page.tsx
git commit -m "feat(glook-21): swap activeDevs chart for avgImpact in org summary"
```
