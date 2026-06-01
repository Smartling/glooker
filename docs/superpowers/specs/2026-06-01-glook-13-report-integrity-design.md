# GLOOK-13 — Harden report-runner against silent GitHub-API failures

## Goal

The 2026-05-28 09:00 ET scheduled report silently dropped 41 of 102 engineers due to a spike in GitHub 404s. The runner caught each error in a `try/catch`, logged `SKIP @<user>`, and shipped a half-empty report with `status = 'completed'`. Consumers couldn't tell that the report was degraded.

Make report degradation visible and prevent half-empty reports from shipping. Specifically:

1. Classify every SKIP as `expected` / `auto-flagged` / `unknown` so persistent legitimate skips (e.g. `@oshpak`) don't alarm.
2. Compute an integrity state at the end of each run from `unknown`-only counts.
3. Auto-abort the report when SKIPs cross a hard threshold; show a degraded badge when they cross a softer one.
4. Surface every SKIP + non-fatal error in a `run_metadata` JSON column so consumers can see exactly what happened.
5. Tighten the GitHub retry layer to cover transient 5xx + network errors without retrying 404 (the deterministic signal we depend on).

## Non-goals

- **GitHub-side investigation** (#1 in the Jira proposal) — ops, not engineering.
- **Splunk alerting** (#3 in the Jira proposal) — infra; out of scope for this PR.
- **Mid-run interrupt.** Threshold evaluation happens once after the gather loop. Simpler control flow; the LLM cost on a failed run is acceptable.
- **401 → immediate fatal abort.** Orthogonal hardening; can be a follow-up.
- **Retrying 404s.** 404 is the *signal*; retrying it would mask the very condition we need to surface.
- **Mid-PR refactor of `report-runner.ts`.** It's 600+ lines but the surgery here is additive (a tracker + classifier + threshold check); a structural cleanup is a separate concern.

## Architecture

```
runReport(reportId, org, days)
  │
  ├─► classifySkip = await loadSkipClassifier()         ← 2 SELECTs: allowlist + last-5-runs history
  │       returns (login) => 'expected' | 'auto-flagged' | 'unknown'
  │
  ├─► tracker = new IntegrityTracker({
  │       expectedCount: orgMembers.length,
  │       thresholds: { abortUnknownCount: 5, abortUnknownPct: 0.10,
  │                     degradedUnknownCount: 3, degradedUnknownPct: 0.05 }
  │   })
  │
  ├─► For each member m:
  │     ├── try: existing gather path (GitHub calls + LLM queueing)
  │     ├── catch L1: tracker.recordSkip(m.login, err.message, classifySkip(m.login))
  │     │             continue
  │     │
  │     ├── (within gather) L2 catches (openPRs, unmerged-commit-detail):
  │     │     tracker.recordError({ context, login: m.login, message })
  │     │     do NOT count toward SKIP threshold (member is kept with partial data)
  │     │
  │     └── (within github.ts) L3 catch in isShaInMergedPR:
  │             tracker.recordError({ context: 'sha-merge-check', sha, message })
  │             returns false as today
  │
  ├─► state = evaluateIntegrity(tracker)
  │
  ├─► persist run_metadata + update report status:
  │       state === 'failed':    UPDATE reports SET status='failed', error=<abortReason>, run_metadata=<json>
  │                              return (LLM cost paid, but consumer sees the failure)
  │       state === 'degraded':  UPDATE reports SET run_metadata=<json>  (status proceeds to 'completed')
  │       state === 'ok':        UPDATE reports SET run_metadata=<json>  (status proceeds to 'completed')
  │
  └─► (existing completion path)
```

**Threshold rationale** (from the 2026-05-28 incident data):

| Scenario | Unknown SKIPs | Org members | Pct  | State |
|---|---|---|---|---|
| 5/28 incident | 41 | 102 | 40.2% | `failed` (≥5 AND ≥10%) ✅ |
| Recent baseline (only `@oshpak` SKIPped) | 0 | 102 | 0% | `ok` ✅ |
| 4 unknown skips, 100 members | 4 | 100 | 4% | `degraded` (count ≥3) |
| 1 unknown, 100 members | 1 | 100 | 1% | `ok` |
| 7 unknown, 102 members | 7 | 102 | 6.9% | `degraded` (count ≥3; abort pct not met) |

The `AND` on abort prevents tiny orgs from auto-failing on a single SKIP; the `OR` on degraded keeps the warning sensitive.

## Data layer

### `report_skip_allowlist` (new table)

One row per persistently-expected SKIP.

```sql
CREATE TABLE IF NOT EXISTS report_skip_allowlist (
  github_login  VARCHAR(255) NOT NULL PRIMARY KEY,
  reason        TEXT         NOT NULL,
  added_by      VARCHAR(255) NULL,
  added_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed
INSERT IGNORE INTO report_skip_allowlist (github_login, reason, added_by) VALUES
  ('oshpak', 'Private GitHub profile; not in org-visible members for non-mutual permissions', 'seed');
```

Add to `schema.sql` and to both runtime DB modules (`src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts`) following the existing idempotent-migration pattern.

### `reports.run_metadata` (new column)

```sql
ALTER TABLE reports ADD COLUMN run_metadata JSON NULL;
```

Nullable so legacy rows keep working; UI treats `null` as `state: 'ok'` (no badge).

JSON shape:

```ts
interface RunMetadata {
  state: 'ok' | 'degraded' | 'failed';
  skipped: SkippedMember[];
  errors: IntegrityError[];
  expectedCount: number;
  thresholds: {
    abortUnknownCount: 5;
    abortUnknownPct: 0.10;
    degradedUnknownCount: 3;
    degradedUnknownPct: 0.05;
  };
  abortReason?: string;
}

type SkipClassification = 'expected' | 'auto-flagged' | 'unknown';

interface SkippedMember {
  login: string;
  reason: string;
  classification: SkipClassification;
}

interface IntegrityError {
  context: 'openPRs' | 'unmerged-commit-detail' | 'sha-merge-check' | 'other';
  login?: string;
  sha?: string;
  message: string;
}
```

### Classification

`loadSkipClassifier()` runs once at the top of each report, returns a closure used inline by `tracker.recordSkip()`. Two queries:

1. `SELECT github_login FROM report_skip_allowlist` → `allowlisted: Set<string>`
2. `SELECT run_metadata FROM reports WHERE status='completed' AND run_metadata IS NOT NULL ORDER BY completed_at DESC LIMIT 5` — aggregate SKIPped logins; any login appearing in `≥4` of the last 5 reports → `autoFlagged: Set<string>`.

Classifier:

```ts
classifySkip = (login: string): SkipClassification =>
  allowlisted.has(login)  ? 'expected' :
  autoFlagged.has(login)  ? 'auto-flagged' :
                            'unknown';
```

### Retry expansion in `withRetry()`

`src/lib/github.ts:98–126` today retries only on `403/429`. Expand to also retry on `5xx` and transient network errors. **404 is explicitly NOT retried.**

| Status / error | Today | Proposed |
|---|---|---|
| 403, 429 | retry w/ exp backoff (existing) | unchanged |
| 5xx (500, 502, 503, 504) | propagates | retry, 3 attempts, backoff 1s → 2s → 4s |
| Network (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ENOTFOUND`) | propagates | retry, same shallow backoff |
| 404 | propagates | unchanged (retry would mask the signal) |
| 401 | propagates | unchanged (future hardening) |

Shallow retry: 3 attempts × ≤4s ≈ 7s worst-case per call. Doesn't materially extend report runtime even on a degraded GitHub.

## API surface

| Endpoint | Verb | Auth | Shape change |
|---|---|---|---|
| `/api/report/[id]` | GET | unchanged | `report` adds `run_metadata: RunMetadata \| null` |
| `/api/settings/skip-allowlist` | GET | admin | returns `{ entries: AllowlistEntry[], autoFlaggedCandidates: string[] }` |
| `/api/settings/skip-allowlist` | POST | admin | body `{ github_login, reason }`; inserts |
| `/api/settings/skip-allowlist/[login]` | DELETE | admin | removes entry |

All mutations gated on `AUTH_ADMIN_GROUP` (existing pattern).

## UI layer

### `<IntegrityBadge>` component

```tsx
interface IntegrityBadgeProps {
  metadata: RunMetadata | null;
}
```

Behavior:

| `metadata.state` | Render |
|---|---|
| `null` (legacy) or `'ok'` | nothing (silent) |
| `'degraded'` | amber pill: `⚠ N partial` next to "N developers"; clicking expands a panel listing skipped users + reasons + non-fatal errors |
| `'failed'` | replaces the data view with a red banner: *"GitHub API degraded — N of M engineers couldn't be fetched. Likely upstream auth issue. Last successful report: {timestamp}. [Regenerate report]"* |

### Insertion points

- `src/app/report/[id]/team/page.tsx` — wrap the existing `{developers.length} developers` line; render error banner above the data section when `state === 'failed'`
- `src/app/report/[id]/org/page.tsx` — same treatment

### Auto-promotion nudge

When `report.run_metadata.skipped` contains any `classification: 'auto-flagged'` entries, the report header surfaces:

> *"`@<login>` has SKIPped 4+ of last 5 runs — [promote to allowlist]"* (links to Settings)

Only renders for users with admin role.

### Skip Allowlist section on Settings

Lives in `src/app/settings/page.tsx`. Lists current allowlist rows (login, reason, added_by, added_at). Inline add form (login + reason text). Inline remove button per row. Below that, an **Auto-flagged candidates** sub-section showing logins currently classified `auto-flagged` with a one-click "Promote" button (POSTs to the allowlist endpoint with `reason: 'auto-promoted after N consecutive SKIPs'`).

## Edge cases

| Case | Behavior |
|---|---|
| Org with 0 members | `expectedCount = 0`; `unknownPct = 0` by convention; state = `'ok'` |
| First report after deploy (no history rows) | Auto-flagged set is empty; classification falls back to allowlist + unknown |
| Allowlist contains a login no longer in the org | Harmless; classifier only acts when a SKIP happens |
| Same user SKIPped multiple times in one run | Recorded once (Set-based dedup in tracker); count = 1 |
| LLM analysis fails post-gather but pre-persist | Same as today (existing error path); `run_metadata` may not be persisted — acceptable, separate failure mode |
| Report aborted via threshold but `developer_stats` rows already partially inserted | UI source-of-truth is `reports.status='failed'` + the error banner; partial rows are ignored by the UI |
| `auto-flagged` user added to allowlist mid-run | No-op for current run; effective from the next report |
| Manual report run during a real GitHub outage | Same threshold logic; user sees `state='failed'` banner; can retry later |
| Two reports running concurrently (unlikely but possible) | Each loads its own classifier snapshot; isolated trackers; no cross-contamination |

## Tests

| Layer | What | Where |
|---|---|---|
| Unit — classifier | allowlist hits → `expected`; ≥4-of-5 → `auto-flagged`; otherwise → `unknown`; empty history; missing `run_metadata` columns gracefully ignored | `src/lib/__tests__/unit/skip-classifier.test.ts` |
| Unit — tracker | `recordSkip`/`recordError` accumulate; dedup logic; `.snapshot()` returns a frozen view; immutability | `src/lib/__tests__/unit/integrity-tracker.test.ts` |
| Unit — threshold | 5/28 incident shape → `failed`; baseline → `ok`; degraded scenarios | same file as tracker tests |
| Unit — retry | 5xx retried 3× then propagates; network error retried; 404 NOT retried; 403/429 existing behavior preserved | `src/lib/__tests__/unit/github-retry.test.ts` |
| Unit — runner | (a) all members succeed → `state='ok'`, no badge; (b) 41/102 unknown SKIPs → `state='failed'`, report row updated, `error` populated; (c) only `@oshpak` SKIPped → `state='ok'`, `skipped[0].classification='expected'`; (d) auto-flagged classification flows through `run_metadata` | extend `src/lib/__tests__/unit/report-runner.test.ts` if present, else create |
| Unit — settings API | allowlist GET/POST/DELETE; admin-only enforcement; auto-flagged candidates enumeration | `src/lib/__tests__/unit/skip-allowlist-api.test.ts` |
| Mock provider | No new mock — existing GitHub mock suffices; tests inject targeted errors via `jest.spyOn` | — |
| Visual / smoke | Manual via podman: trigger a report with mocked GitHub returning 404s for half the members; verify banner + badge + Settings UI | n/a (no RTL harness) |

## Files touched

**DB / runtime migrations**
- `schema.sql` — add `reports.run_metadata` column, add `report_skip_allowlist` table + seed
- `src/lib/db/mysql.ts` — idempotent `ALTER TABLE reports ADD COLUMN run_metadata` + create `report_skip_allowlist`
- `src/lib/db/sqlite.ts` — same

**Backend**
- `src/lib/github.ts` — extend `withRetry()` to cover 5xx + network errors (3 attempts × shallow backoff)
- `src/lib/report-runner/integrity-tracker.ts` — **new**: `IntegrityTracker` class
- `src/lib/report-runner/skip-classifier.ts` — **new**: `loadSkipClassifier()` + `evaluateIntegrity()`
- `src/lib/report-runner/types.ts` — **new**: `RunMetadata`, `SkippedMember`, `IntegrityError`, `SkipClassification`
- `src/lib/report-runner.ts` — wire tracker + classifier into the gather loop; threshold evaluation; persist `run_metadata`; conditionally mark report as `failed`
- `src/lib/report/service.ts` — surface `run_metadata` on report fetch
- `src/app/api/settings/skip-allowlist/route.ts` — **new**: GET/POST handlers
- `src/app/api/settings/skip-allowlist/[login]/route.ts` — **new**: DELETE handler

**Frontend**
- `src/components/IntegrityBadge.tsx` — **new**
- `src/app/report/[id]/team/page.tsx` — render badge + failed-state banner
- `src/app/report/[id]/org/page.tsx` — same
- `src/app/settings/page.tsx` — Skip Allowlist section + Auto-flagged candidates sub-section

**Tests** — files listed in the Tests table above.

## Open questions (none blocking)

- Should the auto-promotion nudge auto-dismiss after the user clicks "Promote"? — yes, the next render reads from the freshly-updated allowlist; nothing to design.
- Should we add an integrity badge to the Reports list page? — defer to a follow-up if useful.
