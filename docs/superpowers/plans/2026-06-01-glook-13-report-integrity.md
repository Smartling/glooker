# GLOOK-13 Report-Integrity Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report degradation visible and prevent half-empty reports from shipping silently. Classify every SKIP, abort on widespread unknown SKIPs, surface a `run_metadata` payload that the UI can render as a badge or failure banner.

**Architecture:** Add an `IntegrityTracker` + `loadSkipClassifier()` + `evaluateIntegrity()` triad inside `runReport()`. Persist `run_metadata` as a JSON column on `reports`. Add a `report_skip_allowlist` table for known-expected persistent SKIPs (seeded with `@oshpak`). Expand `withRetry()` to cover transient 5xx + network errors; 404 stays non-retryable.

**Tech Stack:** Next.js 15 · TypeScript · Jest + ts-jest · MySQL/SQLite · @octokit/rest

**Source spec:** `docs/superpowers/specs/2026-06-01-glook-13-report-integrity-design.md`

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `schema.sql` | modify | Add `reports.run_metadata` column + `report_skip_allowlist` CREATE TABLE + seed `@oshpak` |
| `src/lib/db/mysql.ts` | modify | Idempotent `ALTER TABLE reports ADD COLUMN run_metadata` + create `report_skip_allowlist` + seed |
| `src/lib/db/sqlite.ts` | modify | Same for SQLite |
| `src/lib/report-runner/types.ts` | create | Shared types: `RunMetadata`, `SkippedMember`, `IntegrityError`, `SkipClassification` |
| `src/lib/report-runner/integrity-tracker.ts` | create | `IntegrityTracker` class — accumulates SKIPs + errors; snapshot/serialization |
| `src/lib/report-runner/skip-classifier.ts` | create | `loadSkipClassifier()` (2 SQL queries) + `evaluateIntegrity()` pure threshold logic |
| `src/lib/github.ts` | modify | Extend `withRetry()` to cover transient 5xx + network errors (404 stays non-retryable) |
| `src/lib/report-runner.ts` | modify | Wire tracker + classifier + evaluator into `runReport()`; persist `run_metadata`; conditionally mark report `failed` |
| `src/lib/report/service.ts` | modify | Surface `run_metadata` on `getReport()` |
| `src/components/IntegrityBadge.tsx` | create | Reusable badge + expandable detail panel + failed-state banner |
| `src/app/report/[id]/team/page.tsx` | modify | Wrap `{N} developers` with `<IntegrityBadge>`; render banner when `state='failed'` |
| `src/app/report/[id]/org/page.tsx` | modify | Same |
| `src/app/api/settings/skip-allowlist/route.ts` | create | GET (list + auto-flagged candidates), POST (add) |
| `src/app/api/settings/skip-allowlist/[login]/route.ts` | create | DELETE (remove) |
| `src/app/settings/page.tsx` | modify | New "Skip Allowlist" tab |
| `src/lib/__tests__/unit/integrity-tracker.test.ts` | create | Unit tests for the tracker |
| `src/lib/__tests__/unit/skip-classifier.test.ts` | create | Unit tests for `loadSkipClassifier` + `evaluateIntegrity` |
| `src/lib/__tests__/unit/github-retry.test.ts` | create | Unit tests for the expanded `withRetry()` |
| `src/lib/__tests__/unit/skip-allowlist-api.test.ts` | create | Unit tests for the allowlist API routes |

---

## Task 1: Schema — `reports.run_metadata` + `report_skip_allowlist`

**Files:**
- Modify: `schema.sql`
- Modify: `src/lib/db/mysql.ts`
- Modify: `src/lib/db/sqlite.ts`

- [ ] **Step 1: Update `schema.sql`**

Find the `CREATE TABLE IF NOT EXISTS reports` block. Add `run_metadata JSON NULL` column. After the reports CREATE, add the new `report_skip_allowlist` table:

```sql
CREATE TABLE IF NOT EXISTS reports (
  id           VARCHAR(36)  NOT NULL PRIMARY KEY,
  org          VARCHAR(255) NOT NULL,
  period_days  INT          NOT NULL,
  status       ENUM('pending','running','completed','failed','stopped') NOT NULL DEFAULT 'pending',
  error        TEXT         NULL,
  run_metadata JSON         NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP    NULL
);

CREATE TABLE IF NOT EXISTS report_skip_allowlist (
  github_login  VARCHAR(255) NOT NULL PRIMARY KEY,
  reason        TEXT         NOT NULL,
  added_by      VARCHAR(255) NULL,
  added_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO report_skip_allowlist (github_login, reason, added_by) VALUES
  ('oshpak', 'Private GitHub profile; not in org-visible members for non-mutual permissions', 'seed');
```

- [ ] **Step 2: Add idempotent runtime migrations in `src/lib/db/mysql.ts`**

Find the existing migrations block (search for `ALTER TABLE team_pulse_summaries ADD COLUMN projects`). Append after the last migration in that block:

```typescript
  // GLOOK-13: report integrity (run_metadata column + skip-allowlist table)
  await pool.execute('ALTER TABLE reports ADD COLUMN run_metadata JSON NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add run_metadata:', err);
  });
  await pool.execute(`CREATE TABLE IF NOT EXISTS report_skip_allowlist (
    github_login  VARCHAR(255) NOT NULL PRIMARY KEY,
    reason        TEXT         NOT NULL,
    added_by      VARCHAR(255) NULL,
    added_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).catch((err) => {
    console.error('[db/mysql] Failed to create report_skip_allowlist:', err);
  });
  await pool.execute(
    `INSERT IGNORE INTO report_skip_allowlist (github_login, reason, added_by) VALUES (?, ?, ?)`,
    ['oshpak', 'Private GitHub profile; not in org-visible members for non-mutual permissions', 'seed'],
  ).catch(() => {});
```

- [ ] **Step 3: Add idempotent migrations in `src/lib/db/sqlite.ts`**

Find the equivalent migration block (search for `ALTER TABLE team_pulse_summaries ADD COLUMN projects TEXT`). Append:

```typescript
  // GLOOK-13: report integrity (run_metadata column + skip-allowlist table)
  try { db.exec('ALTER TABLE reports ADD COLUMN run_metadata TEXT'); } catch (_) {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS report_skip_allowlist (
      github_login  TEXT NOT NULL PRIMARY KEY,
      reason        TEXT NOT NULL,
      added_by      TEXT,
      added_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`);
  } catch (_) {}
  try {
    db.exec(`INSERT OR IGNORE INTO report_skip_allowlist (github_login, reason, added_by)
             VALUES ('oshpak', 'Private GitHub profile; not in org-visible members for non-mutual permissions', 'seed')`);
  } catch (_) {}
```

- [ ] **Step 4: Verify**

```bash
npm test 2>&1 | tail -6
```
Expected: all tests pass (the schema change is additive, no existing test should break).

- [ ] **Step 5: Commit**

```bash
git add schema.sql src/lib/db/mysql.ts src/lib/db/sqlite.ts
git commit -m "feat(db): reports.run_metadata + report_skip_allowlist (GLOOK-13)

Adds the canonical schema + idempotent runtime ALTERs for both
MySQL and SQLite. Seeds report_skip_allowlist with @oshpak (the
persistent expected SKIP)."
```

---

## Task 2: TS types

**Files:**
- Create: `src/lib/report-runner/types.ts`

- [ ] **Step 1: Create the file** with this exact content:

```typescript
// src/lib/report-runner/types.ts
//
// Shared types for the GLOOK-13 report-integrity feature. Lives in its own
// module so the tracker, classifier, runner, service, and React component
// can all import without circular deps.

export type SkipClassification = 'expected' | 'auto-flagged' | 'unknown';

export interface SkippedMember {
  /** github_login of the member that was dropped from the report */
  login: string;
  /** Raw error message captured at the L1 catch site (truncated to 500 chars) */
  reason: string;
  /** How the classifier categorized this skip — drives the threshold logic */
  classification: SkipClassification;
}

export interface IntegrityError {
  /** Which sub-operation failed (a member-kept partial-data condition, not a SKIP) */
  context: 'openPRs' | 'unmerged-commit-detail' | 'sha-merge-check' | 'other';
  /** Member login if the error is member-scoped */
  login?: string;
  /** Commit SHA if the error is commit-scoped (e.g. sha-merge-check) */
  sha?: string;
  /** Truncated error message (max 500 chars) */
  message: string;
}

export interface IntegrityThresholds {
  abortUnknownCount: 5;
  abortUnknownPct: 0.10;
  degradedUnknownCount: 3;
  degradedUnknownPct: 0.05;
}

export type IntegrityState = 'ok' | 'degraded' | 'failed';

export interface RunMetadata {
  state: IntegrityState;
  skipped: SkippedMember[];
  errors: IntegrityError[];
  /** Org member count at run start — denominator for percentage calculations */
  expectedCount: number;
  thresholds: IntegrityThresholds;
  /** Human-readable abort summary; populated only when state === 'failed' */
  abortReason?: string;
}

/** Canonical threshold constants used by `evaluateIntegrity()` and persisted into RunMetadata. */
export const DEFAULT_THRESHOLDS: IntegrityThresholds = {
  abortUnknownCount: 5,
  abortUnknownPct: 0.10,
  degradedUnknownCount: 3,
  degradedUnknownPct: 0.05,
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/report-runner/types.ts
git commit -m "feat(report-runner): integrity types (GLOOK-13)"
```

---

## Task 3: `IntegrityTracker` (TDD)

**Files:**
- Create: `src/lib/report-runner/integrity-tracker.ts`
- Create: `src/lib/__tests__/unit/integrity-tracker.test.ts`

- [ ] **Step 1: Write the failing test** at `src/lib/__tests__/unit/integrity-tracker.test.ts`:

```typescript
import { IntegrityTracker } from '@/lib/report-runner/integrity-tracker';
import { DEFAULT_THRESHOLDS } from '@/lib/report-runner/types';

describe('IntegrityTracker', () => {
  it('starts with empty skipped/errors arrays and the given expectedCount', () => {
    const t = new IntegrityTracker({ expectedCount: 102, thresholds: DEFAULT_THRESHOLDS });
    const snap = t.snapshot();
    expect(snap.expectedCount).toBe(102);
    expect(snap.skipped).toEqual([]);
    expect(snap.errors).toEqual([]);
    expect(snap.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('records a skip with classification', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordSkip('alice', 'github 404', 'unknown');
    const snap = t.snapshot();
    expect(snap.skipped).toEqual([{ login: 'alice', reason: 'github 404', classification: 'unknown' }]);
  });

  it('deduplicates skips by login (last-write-wins on classification)', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordSkip('alice', 'first error', 'unknown');
    t.recordSkip('alice', 'second error', 'expected');
    const snap = t.snapshot();
    expect(snap.skipped).toHaveLength(1);
    expect(snap.skipped[0].classification).toBe('expected');
    expect(snap.skipped[0].reason).toBe('second error');
  });

  it('truncates long reason / message strings to 500 chars', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    const long = 'x'.repeat(1000);
    t.recordSkip('alice', long, 'unknown');
    t.recordError({ context: 'openPRs', login: 'alice', message: long });
    const snap = t.snapshot();
    expect(snap.skipped[0].reason).toHaveLength(500);
    expect(snap.errors[0].message).toHaveLength(500);
  });

  it('records errors with context + optional login/sha', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordError({ context: 'openPRs', login: 'alice', message: 'ETIMEDOUT' });
    t.recordError({ context: 'sha-merge-check', sha: 'abc1234567', message: '403' });
    const snap = t.snapshot();
    expect(snap.errors).toEqual([
      { context: 'openPRs', login: 'alice', message: 'ETIMEDOUT' },
      { context: 'sha-merge-check', sha: 'abc1234567', message: '403' },
    ]);
  });

  it('snapshot returns a frozen, independent view (mutation does not affect tracker)', () => {
    const t = new IntegrityTracker({ expectedCount: 10, thresholds: DEFAULT_THRESHOLDS });
    t.recordSkip('alice', 'err', 'unknown');
    const snap1 = t.snapshot();
    expect(() => { (snap1.skipped as any).push({ login: 'bob', reason: 'x', classification: 'unknown' }); }).toThrow();
    const snap2 = t.snapshot();
    expect(snap2.skipped).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npm test -- --testPathPatterns="integrity-tracker" 2>&1 | tail -10
```
Expected: failure — `IntegrityTracker` not found.

- [ ] **Step 3: Implement `src/lib/report-runner/integrity-tracker.ts`**

```typescript
// src/lib/report-runner/integrity-tracker.ts
//
// GLOOK-13: accumulates SKIPs + non-fatal errors during a report run.
// One instance per runReport() call. Caller queries .snapshot() at the end
// of the gather loop to feed evaluateIntegrity() and persist into the
// reports.run_metadata column.

import type {
  IntegrityError,
  IntegrityThresholds,
  RunMetadata,
  SkipClassification,
  SkippedMember,
} from './types';

const MAX_MESSAGE_LENGTH = 500;

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LENGTH ? s.slice(0, MAX_MESSAGE_LENGTH) : s;
}

export interface IntegrityTrackerOptions {
  expectedCount: number;
  thresholds: IntegrityThresholds;
}

export class IntegrityTracker {
  /** Map keyed by github_login so duplicate skip records collapse (last-write-wins). */
  private readonly skipsByLogin = new Map<string, SkippedMember>();
  /** Errors appended in order; not deduped (could be many per member/sha). */
  private readonly errors: IntegrityError[] = [];
  readonly expectedCount: number;
  readonly thresholds: IntegrityThresholds;

  constructor(opts: IntegrityTrackerOptions) {
    this.expectedCount = opts.expectedCount;
    this.thresholds = opts.thresholds;
  }

  recordSkip(login: string, reason: string, classification: SkipClassification): void {
    this.skipsByLogin.set(login, {
      login,
      reason: truncate(reason),
      classification,
    });
  }

  recordError(err: IntegrityError): void {
    this.errors.push({
      ...err,
      message: truncate(err.message),
    });
  }

  /** Frozen snapshot for evaluator + persistence. Independent of tracker state. */
  snapshot(): Pick<RunMetadata, 'skipped' | 'errors' | 'expectedCount' | 'thresholds'> {
    return Object.freeze({
      skipped: Object.freeze([...this.skipsByLogin.values()]) as readonly SkippedMember[] as SkippedMember[],
      errors: Object.freeze([...this.errors]) as readonly IntegrityError[] as IntegrityError[],
      expectedCount: this.expectedCount,
      thresholds: this.thresholds,
    });
  }
}
```

- [ ] **Step 4: Run — confirm pass**

```bash
npm test -- --testPathPatterns="integrity-tracker" 2>&1 | tail -10
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-runner/integrity-tracker.ts src/lib/__tests__/unit/integrity-tracker.test.ts
git commit -m "feat(report-runner): IntegrityTracker (GLOOK-13)

Accumulates SKIPs + non-fatal errors during a report run; dedupes
skips by login (last-write-wins); truncates messages to 500 chars."
```

---

## Task 4: Skip classifier + threshold evaluator (TDD)

**Files:**
- Create: `src/lib/report-runner/skip-classifier.ts`
- Create: `src/lib/__tests__/unit/skip-classifier.test.ts`

- [ ] **Step 1: Write the failing test** at `src/lib/__tests__/unit/skip-classifier.test.ts`:

```typescript
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import db from '@/lib/db';
import { loadSkipClassifier, evaluateIntegrity } from '@/lib/report-runner/skip-classifier';
import { IntegrityTracker } from '@/lib/report-runner/integrity-tracker';
import { DEFAULT_THRESHOLDS } from '@/lib/report-runner/types';

const exec = db.execute as jest.Mock;

beforeEach(() => exec.mockReset());

describe('loadSkipClassifier', () => {
  it("returns 'expected' for logins in the allowlist", async () => {
    exec
      .mockResolvedValueOnce([[{ github_login: 'oshpak' }], []])
      .mockResolvedValueOnce([[], []]);
    const classify = await loadSkipClassifier();
    expect(classify('oshpak')).toBe('expected');
    expect(classify('alice')).toBe('unknown');
  });

  it("returns 'auto-flagged' for logins SKIPped in 4 of last 5 reports", async () => {
    const fiveRuns = [
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }, { login: 'alice' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      { run_metadata: JSON.stringify({ skipped: [{ login: 'bob' }] }) },
    ];
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([fiveRuns, []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('auto-flagged');
    expect(classify('alice')).toBe('unknown');
    expect(classify('bob')).toBe('unknown');
  });

  it("returns 'expected' before 'auto-flagged' when both apply", async () => {
    exec
      .mockResolvedValueOnce([[{ github_login: 'pat' }], []])
      .mockResolvedValueOnce([Array(5).fill({ run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) }), []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('expected');
  });

  it('handles empty history gracefully', async () => {
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);
    const classify = await loadSkipClassifier();
    expect(classify('alice')).toBe('unknown');
  });

  it('handles malformed run_metadata rows without crashing', async () => {
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[
        { run_metadata: 'not-json' },
        { run_metadata: null },
        { run_metadata: JSON.stringify({ skipped: [{ login: 'pat' }] }) },
      ], []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('unknown'); // 1/5 < 4 threshold
  });

  it('accepts pre-parsed objects (MySQL JSON driver path)', async () => {
    exec
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([Array(4).fill({ run_metadata: { skipped: [{ login: 'pat' }] } }), []]);
    const classify = await loadSkipClassifier();
    expect(classify('pat')).toBe('auto-flagged');
  });
});

describe('evaluateIntegrity', () => {
  function trackerWith(opts: { expectedCount: number; skips: Array<[string, 'expected'|'auto-flagged'|'unknown']> }): IntegrityTracker {
    const t = new IntegrityTracker({ expectedCount: opts.expectedCount, thresholds: DEFAULT_THRESHOLDS });
    for (const [login, classification] of opts.skips) t.recordSkip(login, 'err', classification);
    return t;
  }

  it("returns 'ok' when no SKIPs", () => {
    expect(evaluateIntegrity(trackerWith({ expectedCount: 100, skips: [] }))).toBe('ok');
  });

  it("returns 'ok' when only expected SKIPs (1 expected, 100 members)", () => {
    expect(evaluateIntegrity(trackerWith({ expectedCount: 100, skips: [['oshpak', 'expected']] }))).toBe('ok');
  });

  it("returns 'degraded' when unknown count crosses degraded count threshold (3 unknown, 100 members)", () => {
    expect(evaluateIntegrity(trackerWith({
      expectedCount: 100,
      skips: [['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown']],
    }))).toBe('degraded');
  });

  it("returns 'degraded' when unknown pct crosses 5% (5 unknown, 100 members; count=5≥3 OR pct=5%≥5%)", () => {
    const tracker = trackerWith({
      expectedCount: 100,
      skips: [['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown'], ['d', 'unknown'], ['e', 'unknown']],
    });
    // 5 unknown / 100 = 5%; both abort conditions require BOTH count≥5 AND pct≥10%, so abort needs ≥10
    expect(evaluateIntegrity(tracker)).toBe('degraded');
  });

  it("returns 'failed' on the 5/28 incident shape (41 unknown / 102 members ≈ 40%)", () => {
    const skips: Array<[string, 'unknown']> = Array.from({ length: 41 }, (_, i) => [`u${i}`, 'unknown']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 102, skips }))).toBe('failed');
  });

  it("respects AND logic for abort — 6 unknown / 100 members = 6% does NOT abort (pct<10%)", () => {
    const skips: Array<[string, 'unknown']> = Array.from({ length: 6 }, (_, i) => [`u${i}`, 'unknown']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 100, skips }))).toBe('degraded');
  });

  it("respects AND logic for abort — 4 unknown / 10 members = 40% does NOT abort (count<5)", () => {
    const skips: Array<[string, 'unknown']> = Array.from({ length: 4 }, (_, i) => [`u${i}`, 'unknown']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 10, skips }))).toBe('degraded');
  });

  it("handles expectedCount = 0 without divide-by-zero (returns 'ok')", () => {
    expect(evaluateIntegrity(trackerWith({ expectedCount: 0, skips: [] }))).toBe('ok');
  });

  it('classifies 1 expected + 3 unknown / 100 members as degraded (count threshold)', () => {
    expect(evaluateIntegrity(trackerWith({
      expectedCount: 100,
      skips: [['oshpak', 'expected'], ['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown']],
    }))).toBe('degraded');
  });

  it("does NOT count 'auto-flagged' against the threshold", () => {
    const skips: Array<[string, 'auto-flagged']> = Array.from({ length: 41 }, (_, i) => [`u${i}`, 'auto-flagged']);
    expect(evaluateIntegrity(trackerWith({ expectedCount: 102, skips }))).toBe('ok');
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npm test -- --testPathPatterns="skip-classifier" 2>&1 | tail -10
```
Expected: failure — module not found.

- [ ] **Step 3: Implement `src/lib/report-runner/skip-classifier.ts`**

```typescript
// src/lib/report-runner/skip-classifier.ts
//
// GLOOK-13: classifies SKIPs as expected/auto-flagged/unknown and evaluates
// the integrity state from a tracker snapshot.

import db from '@/lib/db';
import type { IntegrityTracker } from './integrity-tracker';
import type { IntegrityState, SkipClassification } from './types';

const AUTO_FLAG_RECENT_RUNS = 5;
const AUTO_FLAG_THRESHOLD = 4;

/**
 * Loads the allowlist + recent-history once and returns a synchronous
 * classifier closure that is hot during the report run.
 */
export async function loadSkipClassifier(): Promise<(login: string) => SkipClassification> {
  // 1. Allowlist
  const [allowlistRows] = await db.execute(
    `SELECT github_login FROM report_skip_allowlist`,
  ) as [any[], any];
  const allowlisted = new Set<string>(allowlistRows.map((r: any) => r.github_login));

  // 2. Last N completed reports' run_metadata
  const [recentRows] = await db.execute(
    `SELECT run_metadata FROM reports
      WHERE status = 'completed' AND run_metadata IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT ?`,
    [AUTO_FLAG_RECENT_RUNS],
  ) as [any[], any];

  const skipCountsByLogin = new Map<string, number>();
  for (const row of recentRows) {
    let parsed: any = null;
    try {
      parsed = typeof row.run_metadata === 'string'
        ? JSON.parse(row.run_metadata)
        : row.run_metadata;
    } catch {
      continue;
    }
    const skipped: Array<{ login?: unknown }> = Array.isArray(parsed?.skipped) ? parsed.skipped : [];
    for (const s of skipped) {
      if (typeof s?.login === 'string') {
        skipCountsByLogin.set(s.login, (skipCountsByLogin.get(s.login) ?? 0) + 1);
      }
    }
  }

  const autoFlagged = new Set<string>(
    [...skipCountsByLogin.entries()]
      .filter(([, n]) => n >= AUTO_FLAG_THRESHOLD)
      .map(([login]) => login),
  );

  return (login: string): SkipClassification =>
    allowlisted.has(login) ? 'expected' :
    autoFlagged.has(login) ? 'auto-flagged' :
    'unknown';
}

/**
 * Pure evaluator — given a tracker snapshot, returns the integrity state.
 * SUPERSEDED 2026-09-02 (GLOOK-48): counting only 'unknown' here is the
 * regression that let reports slide 65 -> 51 with integrity green, because
 * loadSkipClassifier() auto-flags chronic failures out of the numerator.
 * 'auto-flagged' now counts too — see countableSkips()/integrityCounts() in
 * report-runner/types.ts. The text below records the original design.
 *
 * Only unknown SKIPs count toward thresholds; expected + auto-flagged are
 * surfaced in run_metadata but ignored here.
 */
export function evaluateIntegrity(tracker: IntegrityTracker): IntegrityState {
  const snap = tracker.snapshot();
  const T = snap.thresholds;
  const unknownCount = snap.skipped.filter(s => s.classification === 'unknown').length;
  const expected = snap.expectedCount;
  const unknownPct = expected > 0 ? unknownCount / expected : 0;

  if (unknownCount >= T.abortUnknownCount && unknownPct >= T.abortUnknownPct) return 'failed';
  if (unknownCount >= T.degradedUnknownCount || unknownPct >= T.degradedUnknownPct) return 'degraded';
  return 'ok';
}
```

- [ ] **Step 4: Run — confirm pass**

```bash
npm test -- --testPathPatterns="skip-classifier" 2>&1 | tail -10
```
Expected: 15 tests pass (6 classifier + 9 evaluator).

- [ ] **Step 5: Type-check + full suite**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npm test 2>&1 | tail -8
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report-runner/skip-classifier.ts src/lib/__tests__/unit/skip-classifier.test.ts
git commit -m "feat(report-runner): skip classifier + threshold evaluator (GLOOK-13)

loadSkipClassifier() runs 2 SELECTs at the top of each report and
returns a hot closure (allowlist ⊃ auto-flagged ⊃ unknown). 
evaluateIntegrity() is pure: counts only unknown SKIPs against the
[SUPERSEDED by GLOOK-48 — auto-flagged counts as well, and allowlisted
members are removed from the denominator; see report-runner/types.ts]
abort (AND) and degraded (OR) thresholds defined in DEFAULT_THRESHOLDS."
```

---

## Task 5: Expand `withRetry()` to cover 5xx + network (TDD)

**Files:**
- Modify: `src/lib/github.ts`
- Create: `src/lib/__tests__/unit/github-retry.test.ts`

- [ ] **Step 1: Read the current `withRetry()`** in `src/lib/github.ts` around lines 98–126. It currently retries only on 403/429. We're adding 5xx + transient network error retries with shallow backoff, while keeping 404 non-retryable.

- [ ] **Step 2: Write the failing test** at `src/lib/__tests__/unit/github-retry.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { withRetry } from '@/lib/github';

// Speed up tests — we don't care about the wall-clock backoff, just the call counts.
jest.useFakeTimers({ doNotFake: ['nextTick'] });
afterEach(() => jest.clearAllTimers());

async function runWithImmediateTimers<T>(p: Promise<T>): Promise<T> {
  // Drain any scheduled setTimeouts (the sleep() calls inside withRetry).
  while (jest.getTimerCount() > 0) {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  }
  return p;
}

describe('withRetry — transient-error coverage (GLOOK-13)', () => {
  it('retries on 5xx server errors up to 3 attempts then propagates', async () => {
    const err500 = Object.assign(new Error('boom'), { status: 500 });
    const fn = jest.fn().mockRejectedValue(err500);
    const p = withRetry(fn).catch(e => e);
    const result = await runWithImmediateTimers(p);
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(result).toBe(err500);
  });

  it('retries on network errors (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND)', async () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']) {
      const err = Object.assign(new Error(`net ${code}`), { code });
      const fn = jest.fn().mockRejectedValue(err);
      const p = withRetry(fn).catch(e => e);
      await runWithImmediateTimers(p);
      expect(fn).toHaveBeenCalledTimes(4);
      fn.mockClear();
    }
  });

  it('does NOT retry on 404 (the deterministic signal that drives the threshold)', async () => {
    const err404 = Object.assign(new Error('not found'), { status: 404 });
    const fn = jest.fn().mockRejectedValue(err404);
    await expect(withRetry(fn)).rejects.toBe(err404);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 (auth)', async () => {
    const err401 = Object.assign(new Error('unauthorized'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(err401);
    await expect(withRetry(fn)).rejects.toBe(err401);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('preserves existing 403/429 rate-limit retry behaviour (uses retry-after header)', async () => {
    const err429 = Object.assign(new Error('rate'), {
      status: 429,
      response: { headers: { 'retry-after': '1' } },
    });
    const fn = jest.fn().mockRejectedValueOnce(err429).mockResolvedValue('ok');
    const p = withRetry(fn);
    const result = await runWithImmediateTimers(p);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe('ok');
  });

  it('returns the value on the first successful attempt (no retry)', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the value when a transient error succeeds on retry', async () => {
    const err500 = Object.assign(new Error('boom'), { status: 500 });
    const fn = jest.fn().mockRejectedValueOnce(err500).mockResolvedValue('ok');
    const p = withRetry(fn);
    const result = await runWithImmediateTimers(p);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe('ok');
  });
});
```

- [ ] **Step 3: Run — confirm failure**

```bash
npm test -- --testPathPatterns="github-retry" 2>&1 | tail -10
```
Expected: most tests fail (current implementation doesn't retry 5xx / network).

- [ ] **Step 4: Update `withRetry()`** in `src/lib/github.ts`

Find the existing function (around lines 98–126) and replace it with:

```typescript
const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);
const TRANSIENT_MAX_ATTEMPTS = 3;
const TRANSIENT_BACKOFF_MS = [1000, 2000, 4000]; // attempt 1, 2, 3

export async function withRetry<T>(
  fn: () => Promise<T>,
  log?: (msg: string) => void,
  maxRetries = 5,
): Promise<T> {
  let transientAttempt = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      const networkCode = err?.code as string | undefined;
      const isRateLimit = status === 403 || status === 429;
      const is5xx = typeof status === 'number' && status >= 500 && status < 600;
      const isNetwork = !!networkCode && NETWORK_ERROR_CODES.has(networkCode);

      // 1. Rate limit — existing behavior preserved (longer backoffs, header-aware)
      if (isRateLimit) {
        if (attempt === maxRetries) throw err;
        const retryAfter = err?.response?.headers?.['retry-after'];
        const resetEpoch = err?.response?.headers?.['x-ratelimit-reset'];
        let waitSec: number;
        if (retryAfter) {
          waitSec = Number(retryAfter) || 60;
        } else if (resetEpoch) {
          waitSec = Math.max(Number(resetEpoch) - Math.floor(Date.now() / 1000), 10);
        } else {
          waitSec = 30 * Math.pow(2, attempt);
        }
        log?.(`Rate limited (attempt ${attempt + 1}/${maxRetries}). Waiting ${waitSec}s…`);
        await sleep(waitSec * 1000);
        continue;
      }

      // 2. Transient 5xx + network — shallow shared budget (3 attempts × ≤4s)
      if (is5xx || isNetwork) {
        if (transientAttempt >= TRANSIENT_MAX_ATTEMPTS) throw err;
        const waitMs = TRANSIENT_BACKOFF_MS[transientAttempt] ?? 4000;
        const label = is5xx ? `HTTP ${status}` : `network ${networkCode}`;
        log?.(`Transient ${label} (attempt ${transientAttempt + 1}/${TRANSIENT_MAX_ATTEMPTS}). Retrying in ${waitMs}ms…`);
        await sleep(waitMs);
        transientAttempt++;
        attempt--; // transient retries don't consume the rate-limit budget
        continue;
      }

      // 3. Everything else (404, 401, validation errors, …) — propagate immediately.
      // 404 is the deterministic signal the threshold logic depends on.
      throw err;
    }
  }
  throw new Error('withRetry: unreachable');
}
```

Also export `withRetry` if it isn't already exported (search for `export` to confirm).

- [ ] **Step 5: Run — confirm pass**

```bash
npm test -- --testPathPatterns="github-retry" 2>&1 | tail -10
```
Expected: 7 tests pass.

- [ ] **Step 6: Full test suite (sanity — ensure existing retry callers still work)**

```bash
npm test 2>&1 | tail -8
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/__tests__/unit/github-retry.test.ts
git commit -m "feat(github): retry transient 5xx + network errors (GLOOK-13)

Extends withRetry() to cover 5xx HTTP + transient network errors
(ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND) with shallow backoff
(3 attempts × 1s/2s/4s). 404 stays non-retryable — that's the signal
the report-integrity threshold depends on. 403/429 rate-limit
behavior is unchanged."
```

---

## Task 6: Wire tracker + classifier + evaluator into `runReport()`

**Files:**
- Modify: `src/lib/report-runner.ts`

This is the most invasive task. We add:
1. Imports for the new modules.
2. `loadSkipClassifier()` call at the top of `runReport()` (right after the org-members list).
3. `IntegrityTracker` instantiation after we know `members.length`.
4. Wire `tracker.recordSkip(...)` into the L1 catch at line 408.
5. Wire `tracker.recordError(...)` into the L2 catches at lines 214 + 340.
6. Wire `tracker.recordError(...)` into the L3 catch in `isShaInMergedPR` (in `src/lib/github.ts`).
7. After the gather loop, call `evaluateIntegrity(tracker)` and persist `run_metadata`.
8. If state is `'failed'`, mark the report row as failed and return early.

- [ ] **Step 1: Add imports at the top of `src/lib/report-runner.ts`**

```typescript
import { IntegrityTracker } from './report-runner/integrity-tracker';
import { loadSkipClassifier, evaluateIntegrity } from './report-runner/skip-classifier';
import { DEFAULT_THRESHOLDS, type RunMetadata } from './report-runner/types';
```

- [ ] **Step 2: After the `members = await github.listOrgMembers(...)` line and before the per-member loop, instantiate the classifier + tracker.**

Find the line `const members = await github.listOrgMembers(org, log);` (around line 75). After the `updateProgress(reportId, { totalRepos: members.length, ... })` block immediately following it, insert:

```typescript
    // GLOOK-13: load skip classifier (allowlist + recent-history) and start the
    // integrity tracker. Both are scoped to this single run.
    const classifySkip = await loadSkipClassifier();
    const integrity = new IntegrityTracker({
      expectedCount: members.length,
      thresholds: DEFAULT_THRESHOLDS,
    });
```

- [ ] **Step 3: Wire the L1 catch (around line 408 — the `SKIP @user` log)**

Find the existing block:
```typescript
      } catch (err) {
        log(`SKIP @${member.login}: ${err instanceof Error ? err.message : String(err)}`);
      }
```

Replace with:
```typescript
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`SKIP @${member.login}: ${message}`);
        integrity.recordSkip(member.login, message, classifySkip(member.login));
      }
```

- [ ] **Step 4: Wire the L2 catch for openPRs (around line 214)**

Find the existing block:
```typescript
        } catch (err) {
          log(`@${member.login} openPRs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
```

Replace with:
```typescript
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`@${member.login} openPRs failed: ${message}`);
          integrity.recordError({ context: 'openPRs', login: member.login, message });
        }
```

- [ ] **Step 5: Wire the L2 catch for unmerged-commit-detail (around line 340)**

Find the existing block:
```typescript
            } catch (err) {
              log(`unmerged-commit detail failed for ${item.sha.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`);
            }
```

Replace with:
```typescript
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log(`unmerged-commit detail failed for ${item.sha.slice(0, 7)}: ${message}`);
              integrity.recordError({ context: 'unmerged-commit-detail', login: member.login, sha: item.sha, message });
            }
```

- [ ] **Step 6: After the gather loop completes (just before the existing post-loop activity, e.g., before `Promise.all(pendingLLM)` or before the Jira block), evaluate and persist.**

Find the line `await Promise.all(pendingLLM);` (around line 420). Just BEFORE this line, insert the threshold check. Then add the persistence logic at the END of the `try {` block, just before the existing `}` that closes runReport's main try.

Actually, the cleanest place is right after `await Promise.all(pendingLLM);` and before the Jira collection block. At that point, the gather loop is fully drained.

Insert after `await Promise.all(pendingLLM);` and before any subsequent work:

```typescript
    // GLOOK-13: evaluate integrity AFTER the gather loop is drained but BEFORE
    // we spend more time on Jira / report aggregation. On 'failed' we still
    // proceed to persist run_metadata (forensics), then short-circuit before
    // marking 'completed'.
    const integritySnapshot = integrity.snapshot();
    const integrityState = evaluateIntegrity(integrity);

    if (integrityState === 'failed') {
      const unknownCount = integritySnapshot.skipped.filter(s => s.classification === 'unknown').length;
      const expectedCount = integritySnapshot.expectedCount;
      const pct = expectedCount > 0 ? Math.round((unknownCount / expectedCount) * 100) : 0;
      const abortReason = `GitHub API degraded: ${unknownCount} of ${expectedCount} engineers couldn't be fetched (${pct}%). Likely upstream auth/permission regression.`;
      log(`ABORT (GLOOK-13): ${abortReason}`);

      const runMetadata: RunMetadata = {
        state: 'failed',
        skipped: integritySnapshot.skipped,
        errors: integritySnapshot.errors,
        expectedCount: integritySnapshot.expectedCount,
        thresholds: integritySnapshot.thresholds,
        abortReason,
      };
      await db.execute(
        `UPDATE reports SET status = 'failed', error = ?, run_metadata = ?, completed_at = NOW() WHERE id = ?`,
        [abortReason, JSON.stringify(runMetadata), reportId],
      );
      updateProgress(reportId, { status: 'failed', step: abortReason });
      return;
    }
```

- [ ] **Step 7: Persist `run_metadata` for ok/degraded outcomes at the end of the run.**

Find the existing block where the report is marked completed (search for `UPDATE reports SET status = 'completed'`). Just BEFORE that UPDATE, build the metadata and include it in the UPDATE:

```typescript
    // GLOOK-13: persist run_metadata for ok/degraded outcomes too.
    const runMetadata: RunMetadata = {
      state: integrityState,
      skipped: integritySnapshot.skipped,
      errors: integritySnapshot.errors,
      expectedCount: integritySnapshot.expectedCount,
      thresholds: integritySnapshot.thresholds,
    };
```

Then locate the existing UPDATE that marks the report completed:
```typescript
    await db.execute(
      `UPDATE reports SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [reportId],
    );
```

Replace with:
```typescript
    await db.execute(
      `UPDATE reports SET status = 'completed', run_metadata = ?, completed_at = NOW() WHERE id = ?`,
      [JSON.stringify(runMetadata), reportId],
    );
```

(If the existing UPDATE is split across multiple lines or has different exact text, adapt — but the only addition is `run_metadata = ?` plus the JSON payload as a bound parameter.)

- [ ] **Step 8: Wire the L3 catch in `src/lib/github.ts:733` (`isShaInMergedPR`).**

The L3 catch lives in `github.ts`, which doesn't have access to the runner's `integrity` tracker. The cleanest path: have `isShaInMergedPR` accept an optional `onError` callback the runner can pass.

Find the function (~line 718):
```typescript
export async function isShaInMergedPR(
  owner: string,
  repo:  string,
  sha:   string,
  log?:  (msg: string) => void,
): Promise<boolean> {
```

Update its signature + the catch:
```typescript
export async function isShaInMergedPR(
  owner: string,
  repo:  string,
  sha:   string,
  log?:  (msg: string) => void,
  onError?: (info: { sha: string; message: string }) => void,
): Promise<boolean> {
  try {
    const res: any = await withRetry(
      () => (getOctokit() as any).repos.listPullRequestsAssociatedWithCommit({
        owner, repo, commit_sha: sha,
      }),
      log,
    );
    return (res?.data || []).some((pr: any) => pr.merged_at != null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.(`isShaInMergedPR: ${owner}/${repo} ${sha.slice(0, 8)} failed (${message}); treating as not-merged`);
    onError?.({ sha, message });
    return false;
  }
}
```

Then in `report-runner.ts`, find calls to `isShaInMergedPR(...)` and pass the callback:

```typescript
await isShaInMergedPR(org, repo, sha, log, ({ sha, message }) =>
  integrity.recordError({ context: 'sha-merge-check', sha, message })
);
```

(Search for `isShaInMergedPR(` in `report-runner.ts` to find each call site — update each.)

- [ ] **Step 9: Type-check + tests**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
npm test 2>&1 | tail -8
```
Expected: clean. (If `isShaInMergedPR` is mocked anywhere, the mocks may need to match the new optional 5th arg — but optional params don't break call-site compatibility.)

- [ ] **Step 10: Commit**

```bash
git add src/lib/report-runner.ts src/lib/github.ts
git commit -m "feat(report-runner): wire integrity tracker + threshold abort (GLOOK-13)

L1/L2/L3 catches now record into IntegrityTracker. After the gather
loop, evaluateIntegrity() decides ok/degraded/failed; on failed we
write run_metadata + UPDATE reports.status='failed' and short-circuit
the rest of the run. ok/degraded paths persist run_metadata alongside
the existing 'completed' update."
```

---

## Task 7: Surface `run_metadata` on the report API

**Files:**
- Modify: `src/lib/report/service.ts`

- [ ] **Step 1: Update the `getReport()` SELECT** in `src/lib/report/service.ts` (around line 70). Replace:

```typescript
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, error, created_at, completed_at
     FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];
```

with:

```typescript
  const [reportRows] = await db.execute(
    `SELECT id, org, period_days, status, error, run_metadata, created_at, completed_at
     FROM reports WHERE id = ?`,
    [id],
  ) as [any[], any];
```

- [ ] **Step 2: Parse `run_metadata` in the response.** Just before the existing `return { report: reportRows[0], developers };`, add:

```typescript
  // GLOOK-13: deserialize run_metadata for the UI (legacy rows have NULL).
  const rawMeta = reportRows[0].run_metadata;
  if (rawMeta) {
    try {
      reportRows[0].run_metadata = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
    } catch {
      reportRows[0].run_metadata = null;
    }
  } else {
    reportRows[0].run_metadata = null;
  }
```

- [ ] **Step 3: Type-check + tests**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npm test 2>&1 | tail -8
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/report/service.ts
git commit -m "feat(report): surface run_metadata on getReport (GLOOK-13)"
```

---

## Task 8: `<IntegrityBadge>` component

**Files:**
- Create: `src/components/IntegrityBadge.tsx`

- [ ] **Step 1: Create the component** at `src/components/IntegrityBadge.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { RunMetadata, SkippedMember, IntegrityError } from '@/lib/report-runner/types';

export interface IntegrityBadgeProps {
  metadata: RunMetadata | null;
  /** Total developers in the visible report (denominator complement to expectedCount). */
  developerCount: number;
}

const PILL_BASE = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ml-2';

function classificationLabel(c: SkippedMember['classification']): string {
  return c === 'expected' ? 'expected' : c === 'auto-flagged' ? 'auto-flagged' : 'unknown';
}

export default function IntegrityBadge({ metadata, developerCount }: IntegrityBadgeProps) {
  const [open, setOpen] = useState(false);

  if (!metadata || metadata.state === 'ok') return null;

  if (metadata.state === 'failed') {
    return (
      <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 my-4">
        <div className="flex items-start gap-3">
          <span className="text-red-400 text-lg">⚠</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-red-300">GitHub API degraded — report is incomplete</h3>
            <p className="text-xs text-red-300/80 mt-1">{metadata.abortReason}</p>
            <p className="text-xs text-red-300/60 mt-2">
              {metadata.skipped.length} engineer(s) skipped, {metadata.errors.length} non-fatal error(s).
              Likely an upstream auth/permission regression — try regenerating later.
            </p>
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-2 text-xs underline text-red-300 hover:text-red-200"
            >
              {open ? 'Hide details' : 'Show details'}
            </button>
            {open && <IntegrityDetail skipped={metadata.skipped} errors={metadata.errors} />}
          </div>
        </div>
      </div>
    );
  }

  // degraded
  const unknownCount = metadata.skipped.filter(s => s.classification === 'unknown').length;
  const totalCount = metadata.skipped.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${PILL_BASE} bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors`}
        title="Click for details"
      >
        ⚠ {totalCount} partial{unknownCount > 0 ? ` (${unknownCount} unknown)` : ''}
      </button>
      {open && (
        <div className="mt-3 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <IntegrityDetail skipped={metadata.skipped} errors={metadata.errors} />
        </div>
      )}
    </>
  );
}

function IntegrityDetail({ skipped, errors }: { skipped: SkippedMember[]; errors: IntegrityError[] }) {
  return (
    <div className="text-xs space-y-3 mt-2">
      {skipped.length > 0 && (
        <div>
          <p className="text-gray-400 font-semibold mb-1">Skipped engineers ({skipped.length})</p>
          <ul className="space-y-0.5 text-gray-300">
            {skipped.map(s => (
              <li key={s.login}>
                <span className="font-mono">@{s.login}</span>
                <span className="text-gray-500 ml-2">({classificationLabel(s.classification)})</span>
                <span className="text-gray-500 ml-2">— {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors.length > 0 && (
        <div>
          <p className="text-gray-400 font-semibold mb-1">Non-fatal errors ({errors.length})</p>
          <ul className="space-y-0.5 text-gray-300">
            {errors.slice(0, 50).map((e, i) => (
              <li key={i}>
                <span className="text-gray-500">[{e.context}]</span>
                {e.login && <span className="font-mono ml-1">@{e.login}</span>}
                {e.sha && <span className="font-mono ml-1">{e.sha.slice(0, 8)}</span>}
                <span className="text-gray-500 ml-2">— {e.message}</span>
              </li>
            ))}
            {errors.length > 50 && <li className="text-gray-500 italic">…and {errors.length - 50} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/IntegrityBadge.tsx
git commit -m "feat(ui): IntegrityBadge component (GLOOK-13)

Renders nothing for state='ok' (silent), an inline amber pill for
'degraded' (click-to-expand detail panel with skipped + errors),
or a full red banner for 'failed'."
```

---

## Task 9: Wire `<IntegrityBadge>` into the team + org report pages

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Team page — add the import.** Top of `src/app/report/[id]/team/page.tsx`:

```typescript
import IntegrityBadge from '@/components/IntegrityBadge';
import type { RunMetadata } from '@/lib/report-runner/types';
```

The existing `Report` interface (around line 30–40) needs `run_metadata`:

```typescript
interface Report {
  id:           string;
  org:          string;
  period_days:  number;
  status:       string;
  created_at:   string;
  completed_at: string | null;
  run_metadata?: RunMetadata | null;
}
```

- [ ] **Step 2: Team page — render the badge inline next to the developer count + a banner above the data.**

Find the existing header block (around lines 200–230). It has:

```tsx
            <span className="text-gray-500 text-sm ml-2">
              last {activeReport.period_days} days &middot; {developers.length} developers
            </span>
```

Replace with:

```tsx
            <span className="text-gray-500 text-sm ml-2">
              last {activeReport.period_days} days &middot; {developers.length} developers
            </span>
            <IntegrityBadge
              metadata={activeReport.run_metadata ?? null}
              developerCount={developers.length}
            />
```

For the **failed-state banner** — find the section directly below the header that wraps the developer table (search for `{developers.length > 0 ? (` or similar opening). Just above it (after the header, before the data), the failed-state banner from `<IntegrityBadge>` will render itself (the component returns a full banner for `state='failed'`); we additionally hide the data when failed:

Find the developer-table wrapper. It will look something like:

```tsx
{view === 'individuals' && (
  ...big tree...
)}
```

Wrap the data view in a conditional:

```tsx
{view === 'individuals' && activeReport?.run_metadata?.state !== 'failed' && (
  ...existing tree...
)}
```

And add a fallback when failed:

```tsx
{view === 'individuals' && activeReport?.run_metadata?.state === 'failed' && (
  <IntegrityBadge metadata={activeReport.run_metadata ?? null} developerCount={developers.length} />
)}
```

(Render the badge in BOTH places — once inline as a pill for degraded, once as the full banner for failed. The component handles both states.)

- [ ] **Step 3: Org page — same treatment.** Open `src/app/report/[id]/org/page.tsx`. Add the import (same lines as Step 1). Find the developer-count line (around line 158–165):

```tsx
            <p className="text-gray-500 mt-1">
              {report.period_days} days &middot; {developers.length} developers &middot; {new Date(report.created_at).toLocaleDateString(...)}
            </p>
```

Add the badge after it:

```tsx
            <p className="text-gray-500 mt-1">
              {report.period_days} days &middot; {developers.length} developers &middot; {new Date(report.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <IntegrityBadge metadata={report.run_metadata ?? null} developerCount={developers.length} />
```

If the org page also has a `Report` interface, extend it the same way (Step 1).

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
npm test 2>&1 | tail -5
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/report/[id]/team/page.tsx' 'src/app/report/[id]/org/page.tsx'
git commit -m "feat(report-page): wire IntegrityBadge into team + org pages (GLOOK-13)"
```

---

## Task 10: Skip-allowlist Settings API

**Files:**
- Create: `src/app/api/settings/skip-allowlist/route.ts`
- Create: `src/app/api/settings/skip-allowlist/[login]/route.ts`
- Create: `src/lib/__tests__/unit/skip-allowlist-api.test.ts`

- [ ] **Step 1: Write the failing test** at `src/lib/__tests__/unit/skip-allowlist-api.test.ts`:

```typescript
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/auth', () => ({
  __esModule: true,
  requireAdmin: jest.fn().mockResolvedValue(null),
  isAdmin: jest.fn().mockReturnValue(true),
  isAuthEnabled: jest.fn().mockReturnValue(false),
}));

import db from '@/lib/db';
import { GET, POST } from '@/app/api/settings/skip-allowlist/route';
import { DELETE } from '@/app/api/settings/skip-allowlist/[login]/route';

const exec = db.execute as jest.Mock;

function req(method: string, body?: any, url = 'http://localhost/api/settings/skip-allowlist'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => exec.mockReset());

describe('GET /api/settings/skip-allowlist', () => {
  it('returns entries + auto-flagged candidates', async () => {
    exec
      .mockResolvedValueOnce([[
        { github_login: 'oshpak', reason: 'private', added_by: 'seed', added_at: '2026-06-01' },
      ], []])
      .mockResolvedValueOnce([Array(4).fill({ run_metadata: JSON.stringify({ skipped: [{ login: 'newuser' }] }) }), []]);
    const res = await GET(req('GET') as any);
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].github_login).toBe('oshpak');
    expect(json.autoFlaggedCandidates).toContain('newuser');
  });
});

describe('POST /api/settings/skip-allowlist', () => {
  it('inserts a new entry', async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const res = await POST(req('POST', { github_login: 'flaky', reason: 'private account' }) as any);
    expect(res.status).toBe(200);
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT.*report_skip_allowlist/i),
      expect.arrayContaining(['flaky', 'private account']),
    );
  });

  it('rejects empty github_login', async () => {
    const res = await POST(req('POST', { github_login: '', reason: 'x' }) as any);
    expect(res.status).toBe(400);
  });

  it('rejects empty reason', async () => {
    const res = await POST(req('POST', { github_login: 'flaky', reason: '' }) as any);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/settings/skip-allowlist/[login]', () => {
  it('removes the entry', async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const res = await DELETE(req('DELETE', null, 'http://localhost/api/settings/skip-allowlist/flaky') as any, {
      params: Promise.resolve({ login: 'flaky' }),
    } as any);
    expect(res.status).toBe(200);
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE.*report_skip_allowlist/i),
      ['flaky'],
    );
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npm test -- --testPathPatterns="skip-allowlist-api" 2>&1 | tail -10
```
Expected: failure — routes don't exist.

- [ ] **Step 3: Implement `src/app/api/settings/skip-allowlist/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const [rows] = await db.execute(
    `SELECT github_login, reason, added_by, added_at FROM report_skip_allowlist ORDER BY added_at ASC`,
  ) as [any[], any];

  // Compute auto-flagged candidates from the last 5 completed reports.
  const [recentRows] = await db.execute(
    `SELECT run_metadata FROM reports
      WHERE status = 'completed' AND run_metadata IS NOT NULL
      ORDER BY completed_at DESC LIMIT 5`,
  ) as [any[], any];

  const counts = new Map<string, number>();
  for (const r of recentRows) {
    let parsed: any = null;
    try {
      parsed = typeof r.run_metadata === 'string' ? JSON.parse(r.run_metadata) : r.run_metadata;
    } catch {
      continue;
    }
    const skipped: Array<{ login?: unknown }> = Array.isArray(parsed?.skipped) ? parsed.skipped : [];
    for (const s of skipped) {
      if (typeof s?.login === 'string') counts.set(s.login, (counts.get(s.login) ?? 0) + 1);
    }
  }
  const onAllowlist = new Set(rows.map((r: any) => r.github_login));
  const autoFlaggedCandidates = [...counts.entries()]
    .filter(([login, n]) => n >= 4 && !onAllowlist.has(login))
    .map(([login]) => login);

  return NextResponse.json({ entries: rows, autoFlaggedCandidates });
}

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { github_login, reason } = await req.json();
  if (!github_login || typeof github_login !== 'string') {
    return NextResponse.json({ error: 'github_login required' }, { status: 400 });
  }
  if (!reason || typeof reason !== 'string') {
    return NextResponse.json({ error: 'reason required' }, { status: 400 });
  }

  // Extract admin login from auth header if present; null otherwise.
  const addedBy = req.headers.get('x-amzn-oidc-identity') || null;

  await db.execute(
    `INSERT INTO report_skip_allowlist (github_login, reason, added_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), added_by = VALUES(added_by), added_at = CURRENT_TIMESTAMP`,
    [github_login, reason, addedBy],
  );

  return NextResponse.json({ ok: true });
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
```

- [ ] **Step 4: Implement `src/app/api/settings/skip-allowlist/[login]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { login } = await params;
  await db.execute(
    `DELETE FROM report_skip_allowlist WHERE github_login = ?`,
    [login],
  );
  return NextResponse.json({ ok: true });
}

export const DELETE = withRequestLog(deleteHandler);
```

- [ ] **Step 5: Run — confirm pass**

```bash
npm test -- --testPathPatterns="skip-allowlist-api" 2>&1 | tail -10
```
Expected: 5 tests pass.

- [ ] **Step 6: Full type-check + suite**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npm test 2>&1 | tail -8
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/api/settings/skip-allowlist/route.ts' 'src/app/api/settings/skip-allowlist/[login]/route.ts' src/lib/__tests__/unit/skip-allowlist-api.test.ts
git commit -m "feat(api): skip-allowlist CRUD (GLOOK-13)

GET (entries + auto-flagged candidates), POST (add/upsert), DELETE.
Admin-only via requireAdmin(). Auto-flagged candidates computed from
the same last-5-runs query the report-runner classifier uses."
```

---

## Task 11: Skip-allowlist Settings UI tab

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Add a new tab id** to the existing `Tab` type at the top of the file. Find:

```typescript
type Tab = 'schedules' | 'teams' | 'app' | 'appearance' | 'cc-spend';
```

Change to:

```typescript
type Tab = 'schedules' | 'teams' | 'app' | 'appearance' | 'cc-spend' | 'skip-allowlist';
```

- [ ] **Step 2: Add the tab to the tab bar.** Find the `([` array of tab definitions and add:

```typescript
{ id: 'skip-allowlist' as Tab, label: 'Skip Allowlist', icon: '🚫', adminOnly: true },
```

(Place it between `cc-spend` and `appearance`.)

- [ ] **Step 3: Add the hash-validation list update.** Find the `['schedules', 'teams', 'app', 'appearance', 'cc-spend'].includes(hash)` and the `adminTabs` array — add `'skip-allowlist'` to both:

```typescript
const adminTabs = ['schedules', 'teams', 'app', 'cc-spend', 'skip-allowlist'];
...
if (['schedules', 'teams', 'app', 'appearance', 'cc-spend', 'skip-allowlist'].includes(hash)) {
```

- [ ] **Step 4: Add the tab content render.** Find the existing render block (search for `{activeTab === 'appearance' && <AppearanceTab />}`). Just above `appearance`, add:

```tsx
      {activeTab === 'skip-allowlist' && <SkipAllowlistTab />}
```

- [ ] **Step 5: Add the `SkipAllowlistTab` component** at the END of the file (before the default export's closing brace if it's the only top-level), or just as a sibling function:

```tsx
function SkipAllowlistTab() {
  const [entries, setEntries] = useState<Array<{ github_login: string; reason: string; added_by: string | null; added_at: string }>>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [login, setLogin] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/settings/skip-allowlist');
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries);
      setCandidates(data.autoFlaggedCandidates);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function add(loginToAdd: string, reasonToAdd: string) {
    await fetch('/api/settings/skip-allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_login: loginToAdd, reason: reasonToAdd }),
    });
    await load();
  }

  async function remove(loginToRemove: string) {
    await fetch(`/api/settings/skip-allowlist/${encodeURIComponent(loginToRemove)}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Skip Allowlist</h2>
      <p className="text-sm text-gray-400 mb-4">
        Engineers in this list always SKIP from report generation (e.g. private GitHub profiles).
        SKIPs of allowlisted users do not count toward the abort threshold.
      </p>

      {/* Add form */}
      <div className="bg-gray-900 rounded-lg p-4 mb-4 flex gap-2">
        <input
          type="text" placeholder="github_login" value={login}
          onChange={e => setLogin(e.target.value)}
          className="flex-1 px-3 py-2 bg-gray-800 text-white text-sm rounded border border-gray-700"
        />
        <input
          type="text" placeholder="reason (e.g. private profile)" value={reason}
          onChange={e => setReason(e.target.value)}
          className="flex-[2] px-3 py-2 bg-gray-800 text-white text-sm rounded border border-gray-700"
        />
        <button
          type="button"
          disabled={!login || !reason || loading}
          onClick={async () => { await add(login, reason); setLogin(''); setReason(''); }}
          className="px-4 py-2 bg-accent-dark text-white text-sm font-medium rounded disabled:opacity-50"
        >Add</button>
      </div>

      {/* Existing entries */}
      <div className="bg-gray-900 rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
            <tr><th className="px-4 py-2 text-left">Login</th><th className="px-4 py-2 text-left">Reason</th><th className="px-4 py-2 text-left">Added by</th><th className="px-4 py-2 text-left">Added at</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="text-gray-300">
            {entries.map(e => (
              <tr key={e.github_login} className="border-t border-gray-800">
                <td className="px-4 py-2 font-mono">@{e.github_login}</td>
                <td className="px-4 py-2">{e.reason}</td>
                <td className="px-4 py-2 text-gray-500">{e.added_by ?? '—'}</td>
                <td className="px-4 py-2 text-gray-500">{e.added_at}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => remove(e.github_login)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-gray-500 italic">No entries</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Auto-flagged candidates */}
      {candidates.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-300 mb-2">Auto-flagged candidates</h3>
          <p className="text-xs text-amber-200/80 mb-3">
            These users SKIPped on ≥4 of the last 5 reports. Promoting them stops them from
            counting toward the abort threshold and clears the warning.
          </p>
          <ul className="space-y-1">
            {candidates.map(c => (
              <li key={c} className="flex items-center justify-between text-sm">
                <span className="font-mono text-gray-200">@{c}</span>
                <button
                  type="button"
                  onClick={() => add(c, 'auto-promoted after 4+ consecutive SKIPs')}
                  className="text-xs px-2 py-1 bg-amber-500/20 text-amber-200 rounded hover:bg-amber-500/30"
                >Promote</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Type-check + build**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
npm run build 2>&1 | tail -10
```
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/settings/page.tsx'
git commit -m "feat(settings): Skip Allowlist tab (GLOOK-13)

Lists current allowlist entries, inline add/remove form, and an
'auto-flagged candidates' section listing logins that SKIPped on
4+ of the last 5 reports with a one-click 'Promote' action."
```

---

## Task 12: Local smoke test

Verify the full feature with podman (real MySQL + real LLM, but with an injected GitHub failure to trigger the threshold).

- [ ] **Step 1: Rebuild + replace container** (per the `/tmp` workaround in memory)

```bash
rsync -a --delete \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude='*.log' \
  --exclude=glooker.db --exclude='.env*' --exclude='.superpowers' \
  /Users/msogin/Desktop/claudecode/glooker/ /tmp/glooker-build/
podman build -f /tmp/glooker-build/Dockerfile -t localhost/glooker_app:latest /tmp/glooker-build/
podman stop glooker_app_1 || true; podman rm glooker_app_1 || true
podman-compose up -d
until curl -sf http://localhost:3000/api/health > /dev/null; do sleep 2; done
echo "Server ready"
```

- [ ] **Step 2: Verify the schema migration ran** by inspecting the DB:

```bash
podman exec glooker_mysql_1 mysql -uglooker -pglooker glooker -e "SHOW COLUMNS FROM reports LIKE 'run_metadata';"
podman exec glooker_mysql_1 mysql -uglooker -pglooker glooker -e "SELECT * FROM report_skip_allowlist;"
```

Expected: `run_metadata` column present (JSON); one row in `report_skip_allowlist` for `@oshpak`.

- [ ] **Step 3: Trigger a fresh report from the UI.** Open `http://localhost:3000`, click "Generate report" for an org, watch the run.

- [ ] **Step 4: After the run completes, inspect the persisted run_metadata:**

```bash
podman exec glooker_mysql_1 mysql -uglooker -pglooker glooker -e \
  "SELECT id, status, JSON_EXTRACT(run_metadata, '$.state') AS state,
   JSON_LENGTH(JSON_EXTRACT(run_metadata, '$.skipped')) AS skipped,
   JSON_LENGTH(JSON_EXTRACT(run_metadata, '$.errors')) AS errors
   FROM reports ORDER BY created_at DESC LIMIT 1;"
```

Expected: `state` = `"ok"` or `"degraded"` (depending on real GitHub state).

- [ ] **Step 5: Verify the UI** at `http://localhost:3000/report/<id>/team`:
  - [ ] If state is `'ok'`: no badge visible
  - [ ] If state is `'degraded'`: amber pill next to "N developers" — clicking expands the detail panel
  - [ ] If state is `'failed'`: red banner replaces the data view

- [ ] **Step 6: Verify the Skip Allowlist tab** at `http://localhost:3000/settings#skip-allowlist`:
  - [ ] `@oshpak` entry visible
  - [ ] Add a test entry (e.g. `flaky-user` / `test`), confirm it appears, remove it
  - [ ] Trigger another report and verify allowlist changes are honored (SKIPs of allowlisted users now classified `expected`)

- [ ] **Step 7: No commit needed** unless smoke surfaces a tweak.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Architecture (tracker + classifier + threshold inside `runReport`) | Tasks 3, 4, 6 |
| Schema migration (column + table + seed) | Task 1 |
| TS types in `report-runner/types.ts` | Task 2 |
| `IntegrityTracker` with snapshot + dedup + truncation | Task 3 |
| `loadSkipClassifier()` (allowlist + auto-flag) + `evaluateIntegrity()` | Task 4 |
| `withRetry()` covers 5xx + network; 404 still propagates | Task 5 |
| L1 / L2 / L3 catch wiring + threshold evaluation + abort path | Task 6 |
| API surfacing `run_metadata` | Task 7 |
| `<IntegrityBadge>` component (silent / pill / banner) | Task 8 |
| Page wire-ups (team + org) | Task 9 |
| Allowlist CRUD API (GET/POST/DELETE, admin-gated, auto-flagged candidates) | Task 10 |
| Skip Allowlist Settings tab + auto-promote one-click | Task 11 |
| Local smoke | Task 12 |
| Tests for: tracker, classifier, evaluator, retry, API | Tasks 3, 4, 5, 10 |

**Type consistency:**
- `SkipClassification`, `SkippedMember`, `IntegrityError`, `RunMetadata`, `IntegrityThresholds`, `DEFAULT_THRESHOLDS` defined in Task 2's `types.ts`. All other tasks import from there.
- `IntegrityTracker` defined in Task 3. Used by Task 4 (evaluator parameter), Task 6 (runner), and Task 10 (auto-flag computation).
- `loadSkipClassifier()` / `evaluateIntegrity()` defined in Task 4. Used by Task 6.
- `withRetry()` signature (the optional `onError` callback added in Task 6 Step 8 is on `isShaInMergedPR`, not `withRetry`) — no breaking changes.
