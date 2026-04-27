# Unmerged Work — Org Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface in-flight work on the Org Summary page — three KPI cards above the timeline charts and an `in_flight` slice/layer in the existing Commits-by-Type pie and stacked-types chart — by overriding the commit `type` server-side to `in_flight` for any commit currently classified as bare-branch.

**Architecture:** Pure additive feature on top of `feature/unmerged-work`. Server change in `src/lib/report/org.ts` adds a single new aggregation query to produce `unmergedSummary`, and overrides `type='in_flight'` on the timeline commits before weekly aggregation. The page consumes `unmergedSummary` to render KPI cards, and switches the pie's data source from `developers[].type_breakdown` to summed timeline weeks so the type override flows through. `TYPE_COLORS`/`TYPE_HEX`/`typeOrder` get one new entry — chart components are otherwise unchanged.

**Tech Stack:** Next.js 15 App Router (client component for org page), MySQL via `db.execute`, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-04-25-unmerged-work-org-charts-design.md`
**Branch:** `feature/unmerged-work-org-charts` (parented on `feature/unmerged-work`).

---

## Files map

- **Modify**
  - `src/lib/report/org.ts` — add bare-branch SHA fetch + type override + `unmergedSummary` aggregation
  - `src/app/report/[id]/org/page.tsx` — register `in_flight` color, switch pie data source, add KPI card row, add `in_flight` to `StackedTypesChart` `typeOrder`
- **Create**
  - `src/lib/__tests__/unit/org-unmerged-summary.test.ts` — unit tests for the new server-side logic

The org page is large but focused — KPI cards + chart consumers stay in the same file alongside the existing timeline section; no new component file is required.

---

## Task 1: Server — `unmergedSummary` aggregation + bare-branch type override

**Files:**
- Modify: `src/lib/report/org.ts`
- Create: `src/lib/__tests__/unit/org-unmerged-summary.test.ts`

- [ ] **Step 1: Write failing tests for the new behavior**

Create `src/lib/__tests__/unit/org-unmerged-summary.test.ts`:

```typescript
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import { getOrgReport } from '@/lib/report/org';
import db from '@/lib/db/index';

describe('getOrgReport unmerged-work integration', () => {
  const dbExec = db.execute as jest.Mock;

  beforeEach(() => { dbExec.mockReset(); });

  function mockBaselineQueries({
    org = 'acme',
    devs = [],
    reportIds = ['r1'],
    timelineCommits = [],
    bareBranchShas = [],
    unmergedAgg = null,
  }: {
    org?: string;
    devs?: any[];
    reportIds?: string[];
    timelineCommits?: any[];
    bareBranchShas?: string[];
    unmergedAgg?: { openPrCount: number; openPrDevCount: number; bareBranchCount: number; bareBranchDevCount: number; inFlightLinesAdded: number; inFlightLinesRemoved: number; } | null;
  }) {
    // 1. report metadata
    dbExec.mockResolvedValueOnce([[{ id: 'rep1', org, period_days: 14, status: 'completed', created_at: '2026-04-25', completed_at: '2026-04-25', cc_period_start: null, cc_period_end: null }], null]);
    // 2. developer_stats
    dbExec.mockResolvedValueOnce([devs, null]);
    // 3. all reportIds for org
    dbExec.mockResolvedValueOnce([reportIds.map(id => ({ id })), null]);
    // 4. timeline commits
    dbExec.mockResolvedValueOnce([timelineCommits, null]);
    // 5. bare-branch SHAs
    dbExec.mockResolvedValueOnce([bareBranchShas.map(sha => ({ commit_sha: sha })), null]);
    // 6. unmerged summary aggregation (single row OR empty)
    if (unmergedAgg) {
      dbExec.mockResolvedValueOnce([[unmergedAgg], null]);
    } else {
      dbExec.mockResolvedValueOnce([[{ openPrCount: 0, openPrDevCount: 0, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 0, inFlightLinesRemoved: 0 }], null]);
    }
  }

  it('returns unmergedSummary=null when no in-flight rows', async () => {
    mockBaselineQueries({ unmergedAgg: null });
    const result = await getOrgReport('rep1');
    expect(result.unmergedSummary).toBeNull();
  });

  it('returns unmergedSummary with counts when in-flight rows exist', async () => {
    mockBaselineQueries({
      unmergedAgg: {
        openPrCount: 62, openPrDevCount: 33,
        bareBranchCount: 4, bareBranchDevCount: 2,
        inFlightLinesAdded: 12431, inFlightLinesRemoved: 2118,
      },
    });
    const result = await getOrgReport('rep1');
    expect(result.unmergedSummary).toEqual({
      openPrCount: 62,
      openPrDevCount: 33,
      bareBranchCount: 4,
      bareBranchDevCount: 2,
      inFlightLinesAdded: 12431,
      inFlightLinesRemoved: 2118,
    });
  });

  it("overrides commit type to 'in_flight' for bare-branch SHAs", async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'aaa', github_login: 'alice', committed_at: '2026-04-20', lines_added: 10, lines_removed: 2, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
        { commit_sha: 'bbb', github_login: 'bob',   committed_at: '2026-04-20', lines_added: 5,  lines_removed: 1, complexity: 4, type: 'bug',     ai_co_authored: 0, maybe_ai: 0 },
      ],
      bareBranchShas: ['aaa'],
      unmergedAgg: { openPrCount: 0, openPrDevCount: 0, bareBranchCount: 1, bareBranchDevCount: 1, inFlightLinesAdded: 0, inFlightLinesRemoved: 0 },
    });
    const result = await getOrgReport('rep1');
    // The week containing aaa should show 1 in_flight commit and 1 bug; no feature.
    const allTypes = result.timeline.flatMap((w: any) => Object.entries(w.types));
    const typeCounts: Record<string, number> = {};
    for (const [t, c] of allTypes) typeCounts[t] = (typeCounts[t] || 0) + (c as number);
    expect(typeCounts.in_flight).toBe(1);
    expect(typeCounts.bug).toBe(1);
    expect(typeCounts.feature).toBeUndefined();
  });

  it('does not override type when bareBranchShas is empty', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'xxx', github_login: 'a', committed_at: '2026-04-20', lines_added: 1, lines_removed: 0, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      bareBranchShas: [],
      unmergedAgg: null,
    });
    const result = await getOrgReport('rep1');
    const allTypes = result.timeline.flatMap((w: any) => Object.entries(w.types));
    const typeCounts: Record<string, number> = {};
    for (const [t, c] of allTypes) typeCounts[t] = (typeCounts[t] || 0) + (c as number);
    expect(typeCounts.feature).toBe(1);
    expect(typeCounts.in_flight).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest src/lib/__tests__/unit/org-unmerged-summary.test.ts --ci`
Expected: FAIL — `result.unmergedSummary` is undefined and the type-override tests fail because the override hasn't been added yet.

- [ ] **Step 3: Modify `src/lib/report/org.ts`**

The current file ends with:

```typescript
  // 4. Weekly aggregation with trackDevs
  const timeline = aggregateWeekly(timelineCommits, { trackDevs: true });

  return { report: reportRows[0], developers, timeline, spendWindow };
}
```

Replace those final lines with:

```typescript
  // 4a. Override type='in_flight' for any commit currently classified as bare-branch.
  const [bareBranchRows] = await db.execute(
    `SELECT commit_sha FROM unmerged_work
     WHERE report_id = ? AND kind = 'bare_branch_commit'`,
    [reportId],
  ) as [any[], any];
  const bareBranchShas = new Set<string>(bareBranchRows.map((r: any) => r.commit_sha));
  if (bareBranchShas.size > 0) {
    for (const c of timelineCommits) {
      if (bareBranchShas.has(c.commit_sha)) c.type = 'in_flight';
    }
  }

  // 4b. Weekly aggregation with trackDevs
  const timeline = aggregateWeekly(timelineCommits, { trackDevs: true });

  // 4c. Unmerged-work summary KPI counts (single aggregation query).
  const [unmergedAggRows] = await db.execute(
    `SELECT
       SUM(CASE WHEN kind = 'open_pr' THEN 1 ELSE 0 END) AS openPrCount,
       COUNT(DISTINCT CASE WHEN kind = 'open_pr' THEN github_login END) AS openPrDevCount,
       SUM(CASE WHEN kind = 'bare_branch_commit' THEN 1 ELSE 0 END) AS bareBranchCount,
       COUNT(DISTINCT CASE WHEN kind = 'bare_branch_commit' THEN github_login END) AS bareBranchDevCount,
       COALESCE(SUM(CASE WHEN kind = 'open_pr' THEN pr_additions ELSE 0 END), 0) AS inFlightLinesAdded,
       COALESCE(SUM(CASE WHEN kind = 'open_pr' THEN pr_deletions ELSE 0 END), 0) AS inFlightLinesRemoved
     FROM unmerged_work
     WHERE report_id = ?`,
    [reportId],
  ) as [any[], any];

  const aggRow = unmergedAggRows[0] || {};
  const openPrCount = Number(aggRow.openPrCount || 0);
  const bareBranchCount = Number(aggRow.bareBranchCount || 0);
  const unmergedSummary = (openPrCount > 0 || bareBranchCount > 0)
    ? {
        openPrCount,
        openPrDevCount:       Number(aggRow.openPrDevCount || 0),
        bareBranchCount,
        bareBranchDevCount:   Number(aggRow.bareBranchDevCount || 0),
        inFlightLinesAdded:   Number(aggRow.inFlightLinesAdded || 0),
        inFlightLinesRemoved: Number(aggRow.inFlightLinesRemoved || 0),
      }
    : null;

  return { report: reportRows[0], developers, timeline, spendWindow, unmergedSummary };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/org-unmerged-summary.test.ts --ci`
Expected: PASS (4 tests).

Run full suite: `npm test -- --ci`
Expected: 503/503 pass (4 new tests + 499 existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/org.ts src/lib/__tests__/unit/org-unmerged-summary.test.ts
git commit -m "feat(unmerged-work): add unmergedSummary + bare-branch type override in getOrgReport"
```

---

## Task 2: Page — register `in_flight` color and stacked-chart layer

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Extend `TYPE_COLORS` and `TYPE_HEX` (lines 9-17)**

Replace the two const declarations with:

```typescript
const TYPE_COLORS: Record<string, string> = {
  feature:   'bg-blue-500',
  bug:       'bg-red-500',
  refactor:  'bg-purple-500',
  infra:     'bg-yellow-500',
  docs:      'bg-gray-500',
  test:      'bg-green-500',
  other:     'bg-gray-600',
  in_flight: 'bg-amber-400',
};

const TYPE_HEX: Record<string, string> = {
  feature:   '#3B82F6',
  bug:       '#EF4444',
  refactor:  '#A855F7',
  infra:     '#EAB308',
  docs:      '#6B7280',
  test:      '#22C55E',
  other:     '#4B5563',
  in_flight: '#FBBF24',
};
```

- [ ] **Step 2: Add `in_flight` to `StackedTypesChart` `typeOrder` (around line 360)**

Find:

```typescript
  const typeOrder = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other'].filter(t => allTypes.has(t));
```

Replace with:

```typescript
  const typeOrder = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight'].filter(t => allTypes.has(t));
```

(Order matters — `in_flight` last → top of the stack so the unmerged layer is visually called out.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx"
git commit -m "feat(unmerged-work): add in_flight commit type to type registry + stacked chart"
```

---

## Task 3: Page — switch pie data source to weekly timeline so `in_flight` flows through

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

The pie chart currently aggregates `developers[].type_breakdown`, which is computed at report-runner time and does NOT see the per-commit `in_flight` override (that only happens in the timeline path). Switch to summing `timeline[].types` instead — `in_flight` is already applied there via Task 1.

- [ ] **Step 1: Replace the `orgTypes` builder (lines 84-91)**

Find:

```typescript
  // Type breakdown across all developers
  const orgTypes: Record<string, number> = {};
  for (const d of developers) {
    for (const [type, count] of Object.entries(d.type_breakdown || {})) {
      orgTypes[type] = (orgTypes[type] || 0) + count;
    }
  }
  const typeEntries = Object.entries(orgTypes).sort((a, b) => b[1] - a[1]);
  const totalTyped = typeEntries.reduce((s, [, c]) => s + c, 0);
```

Replace with:

```typescript
  // Type breakdown — sum across all timeline weeks. timeline already has the
  // per-commit in_flight override applied server-side in getOrgReport, so the
  // pie inherits the in_flight slice automatically.
  const orgTypes: Record<string, number> = {};
  for (const week of timeline) {
    for (const [type, count] of Object.entries(week.types || {})) {
      orgTypes[type] = (orgTypes[type] || 0) + (count as number);
    }
  }
  const typeEntries = Object.entries(orgTypes).sort((a, b) => b[1] - a[1]);
  const totalTyped = typeEntries.reduce((s, [, c]) => s + c, 0);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: clean.

- [ ] **Step 3: Run the suite**

Run: `npm test -- --ci`
Expected: 503/503 pass (no new tests but ensure nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx"
git commit -m "feat(unmerged-work): aggregate pie data from timeline so in_flight slice renders"
```

---

## Task 4: Page — add KPI card row above the timeline charts

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Read `unmergedSummary` from the API response**

Inside `OrgDetailPage`, alongside the other destructured fields (look for `const developers: Developer[] = data?.developers ?? [];`), add:

```typescript
  const unmergedSummary: {
    openPrCount: number;
    openPrDevCount: number;
    bareBranchCount: number;
    bareBranchDevCount: number;
    inFlightLinesAdded: number;
    inFlightLinesRemoved: number;
  } | null = data?.unmergedSummary ?? null;
```

- [ ] **Step 2: Add KPI cards above the "Org Activity Over Time" timeline section**

Locate the existing timeline section header — it looks like:

```tsx
      {/* Timeline Charts */}
      {timeline.length >= 2 && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Org Activity Over Time (weekly)</p>
```

Directly **above** the `{/* Timeline Charts */}` comment (and below whatever section currently lives there — probably the spend tab or the Type Breakdown row), insert:

```tsx
      {/* In-flight Work KPI cards */}
      {unmergedSummary && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">In-flight Work</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Open PRs</p>
              <p className="text-2xl font-bold text-amber-400">{unmergedSummary.openPrCount.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-1">across {unmergedSummary.openPrDevCount} dev{unmergedSummary.openPrDevCount === 1 ? '' : 's'}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bare-branch commits</p>
              <p className="text-2xl font-bold text-amber-400">{unmergedSummary.bareBranchCount.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-1">
                {unmergedSummary.bareBranchCount === 0
                  ? 'no orphaned WIP'
                  : `across ${unmergedSummary.bareBranchDevCount} dev${unmergedSummary.bareBranchDevCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">In-flight lines</p>
              <p className="text-2xl font-bold">
                <span className="text-green-400">+{unmergedSummary.inFlightLinesAdded.toLocaleString()}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-red-400">−{unmergedSummary.inFlightLinesRemoved.toLocaleString()}</span>
              </p>
              <p className="text-xs text-gray-600 mt-1">from open PRs</p>
            </div>
          </div>
        </div>
      )}
```

If the spec section uses a tab navigation (Impact / Spend), this block belongs inside the **Impact** tab content alongside the other shipped-work charts. Position it directly above the Timeline Charts section so the KPIs read first.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx"
git commit -m "feat(unmerged-work): add In-flight Work KPI cards on org page"
```

---

## Task 5: End-to-end verification + manual bare-branch sanity check

This task is a series of manual steps the implementer (or user) runs. No code changes.

- [ ] **Step 1: Full test suite**

Run: `npm test -- --ci`
Expected: 503/503 pass.

- [ ] **Step 2: Production build**

```bash
rm -rf .next
npm run build
```

Expected: clean compile of all routes.

- [ ] **Step 3: Rebuild + redeploy local container**

```bash
podman-compose build app
AUTH_ENABLED=true AUTH_TEST_USER=admin AUTH_ADMIN_GROUP=glooker-admins podman-compose up -d --force-recreate app
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/health
```

Expected: HTTP 200.

- [ ] **Step 4: Smoke-test the org API against the latest report**

```bash
curl -s "http://localhost:3000/api/report/74326e3e-bb3a-425f-9c3c-fa2b1d4da9d5/org" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('unmergedSummary:', d.get('unmergedSummary'))"
```

Expected output (since this report has 62 open_pr and 0 bare_branch_commit rows):

```
unmergedSummary: {'openPrCount': 62, 'openPrDevCount': 33, 'bareBranchCount': 0, 'bareBranchDevCount': 0, 'inFlightLinesAdded': <some number>, 'inFlightLinesRemoved': <some number>}
```

- [ ] **Step 5: Visual verification in browser**

Visit http://localhost:3000/report/74326e3e-bb3a-425f-9c3c-fa2b1d4da9d5/org. Confirm:
- "In-flight Work" KPI card row appears above "Org Activity Over Time"
- `Open PRs: 62 across 33 devs`
- `Bare-branch commits: 0 — no orphaned WIP`
- `In-flight lines: +X / −Y from open PRs`
- Pie chart legend has no `in_flight` slice (since bare-branch is 0)
- Stacked Commit Types Over Time has no `in_flight` layer (same reason)

- [ ] **Step 6: Manual bare-branch verification (final check, owned by user)**

This is the spec §8 verification — confirms the bare-branch detection path actually works against a real GitHub branch.

a. In the `glooker` repo (NOT this `glooker-deploy`), on `msogin`'s machine:

```bash
cd /Users/msogin/Desktop/claudecode/glooker
git checkout main
git pull
git checkout -b verify-bare-branch-detection
echo "// bare-branch verification — delete me" >> README.md
git add README.md
git commit -m "test: bare-branch verification — delete me"
git push -u origin verify-bare-branch-detection
```

**Do NOT open a PR.** Leave the branch sitting on origin without a PR.

b. Generate a fresh report from the Glooker UI (any 14-day window for `Smartling`). Wait for completion.

c. Open the new report's org page. Confirm:
- KPI card now shows `Bare-branch commits: ≥ 1` (your new commit, plus any others that happen to qualify)
- `Bare-branch commits: across 1 dev` (or however many)
- Pie chart shows an amber `in_flight` slice
- Stacked Commit Types Over Time chart shows an amber layer in the most recent week

d. Open `msogin`'s dev detail page on that report. Confirm the "In-flight Work" section shows "Branch Commits (not in default branch)" with your `test: bare-branch verification — delete me` commit listed.

e. Cleanup:

```bash
git checkout main
git push origin --delete verify-bare-branch-detection
git branch -D verify-bare-branch-detection
```

If any of (c) or (d) fail, report back with what you saw — the bare-branch detection has a bug.

- [ ] **Step 7: Push branch + open PR**

```bash
git push -u origin feature/unmerged-work-org-charts
gh pr create --title "feat(unmerged-work): expose in-flight work on org charts" \
  --body "Implements docs/superpowers/specs/2026-04-25-unmerged-work-org-charts-design.md. Builds on top of #32 (feature/unmerged-work). Wait for #32 to merge before merging this."
```

Note: do NOT push until the user has confirmed the local manual verification (Step 6) passes. This is per the user's standing preference (memory: feedback_no_push_before_test).

---

## Self-review notes

### Spec coverage
- §3 (KPI cards) → Task 4
- §3 (in_flight in pie) → Task 1 (server override) + Task 2 (color) + Task 3 (data source switch)
- §3 (in_flight in stacked chart) → Task 1 (server override) + Task 2 (color + typeOrder)
- §3 (manual verification) → Task 5 Step 6
- §4 (`unmergedSummary` shape) → Task 1
- §4 (timeline override) → Task 1
- §5 (TYPE constants, KPI card layout, pie & stacked semantics) → Tasks 2-4
- §6 (API contract — one new key, null when empty) → Task 1
- §7 (unit tests for summary + override + null path) → Task 1 step 1
- §8 (manual verification flow) → Task 5 Step 6

### Type / name consistency
- `unmergedSummary` shape used identically in: server return (Task 1), test assertions (Task 1), page destructuring (Task 4 step 1), KPI card render (Task 4 step 2). All use camelCase fields: `openPrCount`, `openPrDevCount`, `bareBranchCount`, `bareBranchDevCount`, `inFlightLinesAdded`, `inFlightLinesRemoved`.
- `in_flight` (snake_case) used in: TYPE_COLORS, TYPE_HEX, typeOrder, server-side override. All consistent.
- The pie data source switch in Task 3 is necessary because `developers[].type_breakdown` is computed at report-runner time and never sees the override; only the timeline path sees it.

### YAGNI checks
- No new chart component — reusing existing `PieChart`, `StackedTypesChart`.
- No admin gating — spec explicitly says none.
- No new API endpoint — extending `getOrgReport`.
- Single aggregation query for the KPI — avoids 4 separate roundtrips.

### Frequent commits
- 5 task-level commits + 1 PR push. Each task produces a self-contained working state.
