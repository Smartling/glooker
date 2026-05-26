# GLOOK-10 PRs as First-Class Metric — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PRs / Week` time-series chart on the org and engineer pages, mirroring the existing `Commits / Week` chart.

**Architecture:** Single data-aggregator change (extend `WeeklyBucket.prs`) cascades to both pages, which each get one new `<TimelineChart>` invocation. No new endpoint, no schema change.

**Source spec:** `docs/superpowers/specs/2026-05-26-glook-10-prs-first-class-design.md`

---

## Task 1: Extend `aggregateWeekly()` with `prs` field (TDD)

**Files:**
- Modify: `src/lib/report/timeline.ts`
- Create: `src/lib/__tests__/unit/timeline.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/unit/timeline.test.ts
import { aggregateWeekly, weekKeyForDate } from '@/lib/report/timeline';

// Helpers — all rows belong to one of two weeks for clarity.
const MON_A = '2026-05-04T10:00:00Z';   // Monday week of 2026-05-04
const TUE_A = '2026-05-05T10:00:00Z';
const MON_B = '2026-05-11T10:00:00Z';   // Monday week of 2026-05-11

function row(opts: Partial<{ committed_at: string; pr_number: number | null }> = {}) {
  return {
    commit_sha: Math.random().toString(36).slice(2),
    committed_at: opts.committed_at ?? MON_A,
    lines_added: 0, lines_removed: 0, complexity: null,
    ai_co_authored: false, maybe_ai: false, type: null,
    github_login: 'alice',
    pr_number: 'pr_number' in opts ? opts.pr_number : null,
  };
}

describe('aggregateWeekly — prs field', () => {
  it('returns prs=0 when no rows have pr_number', () => {
    const out = aggregateWeekly([row(), row()]);
    expect(out).toHaveLength(1);
    expect(out[0].prs).toBe(0);
  });

  it('counts a single PR once even when it has multiple commits in the same week', () => {
    const out = aggregateWeekly([
      row({ pr_number: 42 }),
      row({ pr_number: 42 }),
      row({ pr_number: 42, committed_at: TUE_A }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].commits).toBe(3);
    expect(out[0].prs).toBe(1);
  });

  it('counts multiple distinct PRs in a single week', () => {
    const out = aggregateWeekly([
      row({ pr_number: 1 }),
      row({ pr_number: 2 }),
      row({ pr_number: 3 }),
    ]);
    expect(out[0].prs).toBe(3);
  });

  it('counts a PR in each week when its commits span two weeks', () => {
    const out = aggregateWeekly([
      row({ pr_number: 99, committed_at: MON_A }),
      row({ pr_number: 99, committed_at: MON_B }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].prs).toBe(1);
    expect(out[1].prs).toBe(1);
  });

  it('mixes pr_number rows and direct-push rows correctly', () => {
    const out = aggregateWeekly([
      row({ pr_number: 7 }),
      row({ pr_number: null }),   // direct push — contributes to commits, not prs
      row({ pr_number: 7 }),
      row({ pr_number: 8 }),
    ]);
    expect(out[0].commits).toBe(4);
    expect(out[0].prs).toBe(2);     // 7 and 8 distinct; null doesn't count
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- --testPathPatterns="timeline"
```
Expected: failures — `prs` is `undefined` on the returned buckets.

- [ ] **Step 3: Implement in `src/lib/report/timeline.ts`**

Two edits:

1. Add `prs: number` to the `WeeklyBucket` interface (just after `commits: number`):

```ts
export interface WeeklyBucket {
  week: string;
  commits: number;
  prs: number;           // NEW: distinct pr_number values that week
  linesAdded: number;
  // ... (rest unchanged)
}
```

2. In `aggregateWeekly()`:

   - Add `prNumbers: Set<string>;` to the inline `weeklyMap` value type (just after the existing `activeDevs: Set<string>;` line — the `Map<string, {...}>` type literal around lines 51–63).
   - In the `weeklyMap.set(weekKey, { ... })` initializer block (around lines 71–77), add `prNumbers: new Set(),` alongside `activeDevs: new Set(),`.
   - In the per-row body (around lines 80–96), after the existing `if (c.github_login) w.activeDevs.add(c.github_login);` line, add:

   ```ts
   if (c.pr_number != null) w.prNumbers.add(String(c.pr_number));
   ```

   - In the final `.map(w => { ... })` (around lines 101–116), add `prs: w.prNumbers.size,` to the emitted `bucket` literal (just after `commits: w.commits,`).

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --testPathPatterns="timeline"
```
Expected: all 5 tests pass.

- [ ] **Step 5: Full type check + suite**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```
Expected: clean. (If any other callers of `WeeklyBucket` constructed it manually they'd fail typecheck; none should.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/timeline.ts src/lib/__tests__/unit/timeline.test.ts
git commit -m "feat(timeline): add prs (distinct pr_number) to WeeklyBucket (GLOOK-10)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Wire `prs` into the org page

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Extend the local `WeeklyData` interface**

Find the `interface WeeklyData {` block (around lines 42–48). Add `prs: number;` just after `commits: number;`:

```ts
interface WeeklyData {
  week: string; commits: number; prs: number; linesAdded: number; linesRemoved: number;
  linesP95Added?: number; linesP95Removed?: number;
  avgComplexity: number; aiPercent: number; types: Record<string, number>; activeDevs: number;
  inFlightLinesAdded?: number; inFlightLinesRemoved?: number;
  inFlightLinesP95Added?: number; inFlightLinesP95Removed?: number;
}
```

- [ ] **Step 2: Add a new `<TimelineChart>` invocation**

Find the timeline grid (around lines 270–281). Add the new chart immediately after the existing Commits/Week chart and before the `activeDevs` chart:

```tsx
<TimelineChart
  data={timeline}
  valueKey="commits"
  label="Commits / Week"
  color="#3B82F6"
  inFlightValue={d => d.types?.in_flight ?? 0}
/>
<TimelineChart
  data={timeline}
  valueKey="prs"
  label="PRs / Week"
  color="#A78BFA"
/>
<TimelineChart data={timeline} valueKey="activeDevs" label="Active Developers / Week" color="#10B981" />
<LinesChangedChart data={timeline} />
<TimelineChart data={timeline} valueKey="aiPercent" label="AI Assisted %" color="#A855F7" suffix="%" />
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/report/\[id\]/org/page.tsx
git commit -m "feat(org-page): add PRs / Week chart alongside Commits / Week (GLOOK-10)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Wire `prs` into the engineer page

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`

- [ ] **Step 1: Extend the local `WeeklyData` interface**

Find the `interface WeeklyData {` block (around lines 59+). Add `prs: number;` just after `commits: number;`:

```ts
interface WeeklyData {
  week: string;
  commits: number;
  prs: number;
  linesAdded: number;
  linesRemoved: number;
  avgComplexity: number;
  // ... (rest unchanged — keep whatever is currently there)
}
```

- [ ] **Step 2: Add a new `<TimelineChart>` invocation**

Find the timeline grid (around lines 311–339). Add the new chart immediately after the existing Commits/Week chart:

```tsx
<TimelineChart
  data={timeline}
  valueKey="commits"
  label="Commits / Week"
  color="#3B82F6"
/>
<TimelineChart
  data={timeline}
  valueKey="prs"
  label="PRs / Week"
  color="#A78BFA"
/>
<TimelineChart
  data={timeline}
  valueKey="linesChanged"
  label="Lines Changed / Week"
  color="#10B981"
  computeValue={d => d.linesAdded + d.linesRemoved}
/>
{/* ... rest unchanged (Avg Complexity, AI %) ... */}
```

- [ ] **Step 3: Type check + test suite**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/report/[id]/dev/[login]/page.tsx'
git commit -m "feat(dev-page): add PRs / Week chart alongside Commits / Week (GLOOK-10)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Local smoke test

- [ ] **Step 1: Rebuild + replace container** (via /tmp workaround per repo memory)

```bash
rsync -a --delete \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude='*.log' \
  --exclude=glooker.db --exclude='.env*' --exclude='.superpowers' \
  /Users/msogin/Desktop/claudecode/glooker/ /tmp/glooker-build/
podman build -f /tmp/glooker-build/Dockerfile -t localhost/glooker_app:latest /tmp/glooker-build/
podman stop glooker_app_1 || true
podman rm   glooker_app_1 || true
podman-compose up -d --no-build app
until curl -sf http://localhost:3000/api/health > /dev/null; do sleep 2; done
echo "Server ready"
```

- [ ] **Step 2: Manually verify** at `http://localhost:3000/report/<id>/org`:

  1. The Org Activity Over Time grid now shows 5 charts (was 4): Commits, **PRs**, Active Developers, Lines Changed, AI Assisted %.
  2. The PRs / Week chart renders in purple (`#A78BFA`) with the same shape/scale as Commits.
  3. PR bar heights look sensible relative to commits (lower in most weeks, since a typical week has more commits than distinct PRs).

- [ ] **Step 3: Manually verify** at `http://localhost:3000/report/<id>/dev/<login>`:

  1. The Activity Over Time grid now shows 5 charts (was 4): Commits, **PRs**, Lines Changed, Avg Complexity, AI Assisted %.
  2. Same color and scale conventions hold.
  3. For a dev with few commits but many PRs (e.g. someone working on long-running feature branches like Andy from GLOOK-6), the PR chart should now meaningfully tell their story.

- [ ] **Step 4: No commit needed unless smoke surfaces a tweak.**

---

## Self-review notes

**Spec coverage:**
- ✓ `prs` field on `WeeklyBucket` — Task 1
- ✓ Distinct `pr_number` per week (deduped) — Task 1 test
- ✓ New chart on org page after Commits/Week — Task 2
- ✓ New chart on dev page after Commits/Week — Task 3
- ✓ Unit tests on the aggregator change — Task 1

**Color decision (`#A78BFA`):** The existing AI Assisted % chart uses `#A855F7` (purple-500) on both pages. The new chart uses `#A78BFA` (purple-400) — a noticeably lighter shade in the same hue family. If the side-by-side feels too similar in smoke, swap to `#EC4899` (pink-500) or `#06B6D4` (cyan-500) as a one-line fix.
