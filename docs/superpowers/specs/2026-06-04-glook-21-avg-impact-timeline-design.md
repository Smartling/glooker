# GLOOK-21: Replace Active Devs Chart with Avg Impact Score / Week

## Goal

Replace the "Active Developers / Week" timeline chart on the org summary page with an "Avg Impact Score / Week" chart. Impact is sourced from completed reports (avg of `impact_score` across all developers per report), bucketed by week.

## Architecture

### Data Layer

**`src/lib/report/timeline.ts`**
- Add `avgImpact?: number` to `WeeklyBucket` interface (additive, optional — no cascade).

**`src/lib/report/org.ts`**
- Remove `trackDevs: true` from `aggregateWeekly` call (only consumer of activeDevs was the chart being replaced).
- Remove `activeDevs: 0` from the in-flight overlay bucket defaults.
- Add one new SQL query after the developer stats fetch:

```sql
SELECT r.id, r.completed_at, AVG(ds.impact_score) AS avg_impact
FROM reports r
JOIN developer_stats ds ON ds.report_id = r.id
WHERE r.org = ? AND r.status = 'completed'
GROUP BY r.id, r.completed_at
ORDER BY r.completed_at ASC
```

- Post-process in JS: bucket rows by week using existing `weekKeyForDate` helper. For weeks with multiple completed reports, average their per-report `avg_impact` values (average of averages — acceptable at this granularity).
- Merge `avgImpact` into existing `timeline` buckets by matching week key. Only merge into buckets that already exist (no new buckets created for report-only weeks with no commit activity).

### API Response

No shape change — `avgImpact` is a new optional field on each `WeeklyBucket` already in the response. Consumers that don't use it are unaffected.

### Frontend

**`src/app/report/[id]/org/page.tsx`**
- Add `avgImpact?: number` to the `WeeklyData` interface.
- Remove `activeDevs: number` from `WeeklyData`.
- Swap the chart:

```tsx
// Before
<TimelineChart data={timeline} valueKey="activeDevs" label="Active Developers / Week" color="#10B981" />

// After
<TimelineChart data={timeline} valueKey="avgImpact" label="Avg Impact Score / Week" color="#10B981" decimals={1} />
```

`TimelineChart` already handles `undefined`/missing values (bar height = 0), so weeks with no report run in the 90-day window render as empty bars.

The existing client-side `avgImpact` computed from `developers` (line ~110) is for the summary card display and is unrelated — no change needed there.

## Tests

**`src/lib/__tests__/unit/report-org.test.ts`**
- Replace `'timeline uses trackDevs:true (has activeDevs field)'` with a test asserting that `timeline[0].avgImpact` is a number when there is a completed report for the org.
- Add a test for the multi-report-same-week case: two completed reports in the same week → `avgImpact` equals their average.

## Edge Cases

- **Week with no completed report**: `avgImpact` is `undefined` on the bucket; chart renders a zero-height bar (existing TimelineChart behavior).
- **Week with multiple reports**: values are averaged. The granularity is weekly so this is acceptable.
- **Report with zero developers**: `AVG(impact_score)` returns NULL — coerce to 0 via `Number(row.avg_impact) || 0`.
- **SQLite compatibility**: query uses only standard SQL (`AVG`, `GROUP BY`, `ORDER BY`) — no MySQL-specific date functions. Week bucketing done in JS via `weekKeyForDate`.
