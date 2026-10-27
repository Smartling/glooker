# GLOOK-63 Team/Engineer Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Team page and Engineer page a "Current report / Past 90 days / Past 12 months" range picker whose figures are de-duplicated across overlapping daily reports, with an impact score whose volume caps scale with the period.

**Architecture:** A pure options module (`range-options.ts`) is shared by client and server. A server module (`src/lib/report/range.ts`) computes the range window and recomputes every developer figure straight from the canonical rows (`commit_analyses` one per sha, `jira_issues` one per key, new `pr_activity` one per PR). `getReport`/`getDevReport` keep their current code path byte-for-byte and only overlay range figures when `range !== 'current'`. Report runs (and a one-off backfill script) persist merged-PR rows plus a `pr_activity_coverage` ledger so PR caps scale only over days actually collected.

**Tech Stack:** Next.js 15 App Router, TypeScript, SWR, Jest + ts-jest (+ jsdom for `.tsx`), better-sqlite3 / mysql2, Octokit search API, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-10-27-glook-63-range-selector-design.md` (binding). Read it before any task.

## Global Constraints

- Range values are exactly `current`, `90d`, `12m`; URL key `range`; `useUrlState` with `history: 'replace'` and `scroll: false`; invalid URL value falls back to `current`; invalid API value returns HTTP 400.
- "Current report" must send no `range` parameter and run today's code path unchanged (same SQL, same order of `db.execute` calls, same figures).
- A range ends on the viewed report's end date (`completed_at`, else `created_at`) and starts 90 or 365 days before it.
- Volume caps scale as `cap × periodDays / 14`: commits 20, PRs 10, story points 15, Jira issues 10, reviews 15. Complexity and PR-% terms never scale. `periodDays` defaults to 14.
- De-dup rules: commits one row per `commit_sha` via `canonicalCommitIdsSql`, by `committed_at`; Jira one row per `issue_key`, by `resolved_at`; PRs distinct `(repo, pr_number)` in `pr_activity`, by `merged_at`.
- Team Pulse, the engineer's LLM summary/badges, and Claude Code spend/models/skills always stay on the current report and show a "Current report" label while a range is selected.
- New tables go in **all three** of `schema.sql`, `src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts`. **Never pin a charset/collation** on a MySQL table (`mysql-schema-fk-charset.test.ts` guards it). Neither new table has a foreign key to `reports`.
- Instants are ISO strings in `VARCHAR`, never `TIMESTAMP`, in new tables.
- Any new MySQL-specific SQL must work through `translateSQL()` in `db/sqlite.ts`; every new `ON DUPLICATE KEY UPDATE` table needs a `conflictCols` entry there.
- `DECIMAL`/`REAL` values may arrive as strings: always `Number()` before arithmetic or `.toFixed()`.
- Every exported handler in `src/app/api/**/route.ts` stays wrapped with `withRequestLog()`; cost-visibility stripping is unchanged.
- GLOOK-50 search trust rules are unchanged and the commit vs issue/PR asymmetry must **not** be unified: commit search stays strict; merged-PR search raises only on provable loss; kept-but-unproven figures go to `integrity.recordUnverified`. `total_prs` and `total_reviews` keep exactly the values they have today.
- Tests importing `github.ts` (directly or transitively) must first `jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }))` (factory form only).
- Tests that set `SQLITE_PATH`/`DB_TYPE` restore the prior values in `afterAll`.
- `.tsx` behavioural tests start with `/** @jest-environment jsdom */`.
- `src/app/**/page.tsx` files export only `default`; shared pieces live in sibling modules or `src/components/range/`.
- New tables need rows in `scripts/seed-data.ts` (and inserts in `scripts/seed.ts`).
- The org page keeps its own chart options (`90d`, `12m`, `all`).
- The backfill script never runs automatically; it uses the existing rate-limit/retry handling in `github.ts`.
- Out of scope: org summary KPIs/tables, MCP tools, making Pulse/summaries/spend follow the range, an "all time" option on these pages.

## Decisions

Where the spec left a detail open and the code forced a choice:

1. **Coverage columns are `since_date` / `until_date`, not `since` / `until`.** `UNTIL` is a MySQL reserved word. Both hold `YYYY-MM-DD` UTC dates, and the slice is half-open: `since_date` is included, `until_date` is not.
2. **`RANGE_OPTIONS` / `ReportRange` live in `src/lib/report/range-options.ts`, which is pure, and `range.ts` re-exports them.** `range.ts` imports `db`, and the client must not bundle that.
3. **Range windows are whole UTC days.** `until` is the UTC midnight after the end instant (exclusive), and `since = until − days`. SQL compares against `'YYYY-MM-DD'` strings. That compares correctly against MySQL `TIMESTAMP` and against SQLite's ISO or space-separated text.
4. **`computeImpactScore` takes `periodDays` and `prPeriodDays`.** `prPeriodDays` defaults to `periodDays`. If a scaled cap is `<= 0` (for example 0 measured days), its term is 0 instead of `NaN`/`Infinity`.
5. **The review search pages at `per_page: 100` and returns `{ reviews, prs, itemsComplete, unverified? }`.** `reviews` is still page 1's `total_count`, so `total_reviews` doesn't change. `unverified` is set exactly when it was before (page 1 untrustworthy). A page after the first that goes untrustworthy never raises, because the count is already known. It returns `itemsComplete: false`, and that only withholds coverage.
6. **A report's coverage slice is `[UTC date(since) + 1 day, UTC date(run start))`.** The review query uses `merged:>date` (exclusive) and the run continues past midnight, so both ends are trimmed to days that were fully searched.
7. **`pr_activity` rows are counted wherever `merged_at` falls in the range.** Only the PR/review caps use covered days. *(Controller ruling, overriding the draft per spec req. 9: missing PR data must never read as low activity.)* When `prPeriodDays <= 0`, the PR and review terms are dropped and the remaining raw score is rescaled by `MAX_RAW / (MAX_RAW - 2.7 - 0.5)`, where `MAX_RAW = 10.3` is the sum of all weights. The page says "No PR and review data in this range".
8. **Range developers who are absent from the current report get no `cc_*` fields.** Spend shows "–", never $0. Team cost is then `null` (hidden), as it is today.
9. **The team aggregator gets `periodDays` = `range.measuredDays` in a range, else `report.period_days`.**
10. **The backfill works in whole calendar months:** the last `--months` complete months before the current month, oldest first. The current month is left to report runs.
11. **MySQL key widths:** `org`/`github_login` `VARCHAR(128)`, `repo` `VARCHAR(200)`, `kind`/`source` `VARCHAR(16)`. This keeps the 5-column primary key under InnoDB's 3072-byte limit at 4 bytes per character.
12. **API routes read `range` via `new URL(req.url).searchParams`**, so they work with the plain `Request` objects that existing route tests build.

## Review Focus

1. **A historical report whose range reaches back before any report/PR data.** Expect "N of M days measured" and "No PR and review data in this range", with no `NaN` scores. Pinned in Task 6 (`measured_days 0 → impact finite`) and Task 1 (`periodDays 0`).
2. **A developer in the range but not in the current report.** They are listed with no spend fields, and the team cost reads "–". Pinned in Task 7 (service overlay test).
3. **Switching range while data loads.** The tables keep the previous rows (`keepPreviousData`) and the drill-down caches don't serve another range's rows. Pinned in Task 9 (cache key includes range).
4. **A `?range=` value with odd casing or junk (`90D`, `all`, empty).** The API returns 400 for anything but the three exact values and treats empty or missing as `current`. Pinned in Task 5 (`parseRange`) and Task 7 (route 400).
5. **A re-run backfill after a crash mid-slice.** Upserts must not duplicate rows, and the half-done slice has no coverage row, so it is redone. Pinned in Task 11.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/impact-score.ts` (modify) | scaled caps |
| `src/lib/teams/team-aggregator.ts` (modify) | `periodDays` param |
| `schema.sql`, `src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts` (modify) | `pr_activity`, `pr_activity_coverage` |
| `src/lib/pr-activity/store.ts` (create) | upsert PR rows, coverage ledger, report coverage slice |
| `src/lib/github.ts`, `src/lib/github-mock.ts` (modify) | paged review search, `until`, `fetchMergedPRs` |
| `src/lib/report-runner.ts` (modify) | write `pr_activity` + coverage, pass `periodDays` |
| `src/lib/report/range-options.ts` (create) | pure: options, labels, `parseRange`, `withRange`, `rangeNotes`, `RangeMeta` |
| `src/lib/report/timeline.ts` (modify) | `unionDayCount`, `measuredDaysInWindow` |
| `src/lib/report/range.ts` (create) | `rangeWindow`, `getRangeDeveloperStats`, `getRangeCommits`, `getRangeJiraIssues`, `loadReportRangeWindow` |
| `src/lib/report/service.ts`, `dev.ts`, `commits.ts` (modify) | range overlay |
| API routes `src/app/api/report/[id]/route.ts`, `dev/[login]/route.ts`, `commits/route.ts`, `jira-issues/route.ts` (modify) | `?range=` |
| `src/components/range/chart-range.ts` (moved), `RangePicker.tsx`, `CurrentReportLabel.tsx` (create) | shared picker UI |
| `src/app/report/[id]/org/page.tsx` (modify) | use shared picker |
| `src/app/report/[id]/team/page.tsx`, `team-table.tsx`, `dev-table.tsx` (modify) | Team page range |
| `src/app/report/[id]/dev/[login]/page.tsx` (modify) | Engineer page range |
| `src/lib/pr-activity/backfill.ts`, `scripts/backfill-prs.ts` (create), `package.json` | backfill |
| `scripts/seed-data.ts`, `scripts/seed.ts`, `CLAUDE.md` (modify) | seed + docs |

---

### Task 1: Period-scaled impact score

**Files:**
- Modify: `src/lib/impact-score.ts`
- Modify: `src/lib/report-runner.ts:127`, `src/lib/report-runner.ts:668`
- Modify: `src/lib/teams/team-aggregator.ts:58-61`, `:133-141`
- Test: `src/lib/__tests__/unit/impact-score.test.ts`, `src/lib/__tests__/unit/team-aggregator.test.ts`, `src/lib/__tests__/integration/report-runner.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `ImpactScoreInputs` gains `periodDays?: number; prPeriodDays?: number`; `export const BASE_PERIOD_DAYS = 14`; `computeImpactScore(s: ImpactScoreInputs): number` (unchanged signature); `aggregateTeams(developers: AggregatorDeveloper[], teams: AggregatorTeam[], periodDays?: number): TeamRow[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/unit/impact-score.test.ts` inside the `describe`:

```ts
  describe('periodDays scaling (GLOOK-63)', () => {
    const busy = {
      ...base, totalCommits: 20, totalPRs: 10, avgComplexity: 6, prPercentage: 80,
      totalStoryPoints: 15, totalJiraIssues: 3, totalReviews: 15,
    };

    it('periodDays 14 is identical to omitting it', () => {
      for (const s of [base, busy, { ...base, totalCommits: 7 }, { ...busy, totalStoryPoints: 0 }]) {
        expect(computeImpactScore({ ...s, periodDays: 14 })).toBe(computeImpactScore(s));
      }
    });

    it('28 days doubles every volume cap', () => {
      const at28 = computeImpactScore({ ...busy, periodDays: 28 });
      const doubled = computeImpactScore({
        ...busy, totalCommits: 10, totalPRs: 5, totalStoryPoints: 7.5, totalReviews: 7.5,
      });
      expect(at28).toBe(doubled);
      expect(computeImpactScore({ ...base, totalJiraIssues: 20, periodDays: 28 })).toBe(0.5);
      expect(computeImpactScore({ ...base, totalJiraIssues: 10, periodDays: 28 })).toBe(0.3); // 0.25 rounds to 0.3
    });

    it('does not scale the complexity and PR-% terms', () => {
      const ratiosOnly = { ...base, avgComplexity: 10, prPercentage: 100 };
      expect(computeImpactScore({ ...ratiosOnly, periodDays: 365 })).toBe(computeImpactScore(ratiosOnly));
    });

    it('prPeriodDays scales only the PR and review caps', () => {
      const s = { ...base, totalCommits: 20, totalPRs: 10, totalReviews: 15 };
      // commits capped at 20*28/14=40 → 0.5*2=1.0; PRs/reviews at 14 days → full 2.7 + 0.5
      expect(computeImpactScore({ ...s, periodDays: 28, prPeriodDays: 14 })).toBe(4.2);
    });

    it('a zero period contributes nothing instead of NaN', () => {
      const s = computeImpactScore({ ...busy, periodDays: 0, prPeriodDays: 14 });
      expect(Number.isFinite(s)).toBe(true);
    });

    it('no PR coverage drops the PR/review terms and rescales the rest, never penalising', () => {
      // commits full (2) + complexity 10 (3.5) + PR% 100 (1.1) + jira full (0.5) = 7.1 of 7.1 possible → 10.3
      const s = { ...base, totalCommits: 20, avgComplexity: 10, prPercentage: 100, totalJiraIssues: 10 };
      expect(computeImpactScore({ ...s, prPeriodDays: 0 })).toBe(10.3);
      expect(Number.isFinite(computeImpactScore({ ...s, periodDays: 0, prPeriodDays: 0 }))).toBe(true);
    });
  });
```

Append to `src/lib/__tests__/unit/team-aggregator.test.ts`:

```ts
describe('aggregateTeams — periodDays (GLOOK-63)', () => {
  it('scales impact_weighted caps with periodDays, default 14', () => {
    const devs: AggregatorDeveloper[] = [{ ...DEV_BASE, github_login: 'a', total_commits: 20 }];
    const teams: AggregatorTeam[] = [{ ...TEAM_BASE, members: ['a'] }];
    expect(aggregateTeams(devs, teams)[0].impact_weighted).toBe(2);
    expect(aggregateTeams(devs, teams, 14)[0].impact_weighted).toBe(2);
    expect(aggregateTeams(devs, teams, 28)[0].impact_weighted).toBe(1);
  });
});
```

Append to `src/lib/__tests__/integration/report-runner.test.ts` inside `describe('runReport', ...)`:

```ts
  it('scores with the report period (GLOOK-63): a 28-day report scales caps', async () => {
    const finalImpact = () => {
      const calls = mockDbExecute.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO developer_stats') && c[1][1] === 'alice',
      );
      return Number(calls[calls.length - 1][1][9]); // impact_score param
    };
    await runReport('r-14', 'my-org', 14);
    const at14 = finalImpact();
    mockDbExecute.mockClear();
    await runReport('r-28', 'my-org', 28);
    expect(finalImpact()).toBeLessThan(at14);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/unit/impact-score.test.ts src/lib/__tests__/unit/team-aggregator.test.ts src/lib/__tests__/integration/report-runner.test.ts`
Expected: FAIL. The 28-day assertions don't hold, and `aggregateTeams` ignores its third argument.

- [ ] **Step 3: Implement**

Replace the body of `src/lib/impact-score.ts` after the header comment:

```ts
export interface ImpactScoreInputs {
  totalCommits: number;
  totalPRs: number;
  avgComplexity: number;
  prPercentage: number;
  totalStoryPoints: number;
  totalJiraIssues: number;
  totalReviews: number;
  /** Days the volume figures cover. Caps scale as cap × periodDays / 14. Default 14. */
  periodDays?: number;
  /** Days the PR/review figures cover (GLOOK-63 PR coverage). Defaults to periodDays. */
  prPeriodDays?: number;
}

/** The period the fixed caps below were tuned for. */
export const BASE_PERIOD_DAYS = 14;

/** Sum of every term's weight: 2 + 2.7 + 3.5 + 1.1 + 0.5 + 0.5. */
const MAX_RAW = 10.3;

/** min(value / scaledCap, 1); a non-positive scaled cap (no measured days) contributes 0, never NaN. */
function capped(value: number, cap: number, days: number): number {
  const scaled = (cap * days) / BASE_PERIOD_DAYS;
  if (!(scaled > 0)) return 0;
  return Math.min(value / scaled, 1);
}

export function computeImpactScore(s: ImpactScoreInputs): number {
  const days = s.periodDays ?? BASE_PERIOD_DAYS;
  const prDays = s.prPeriodDays ?? days;
  const jiraFactor = s.totalStoryPoints > 0
    ? capped(s.totalStoryPoints, 15, days)
    : capped(s.totalJiraIssues, 10, days);
  const raw =
    capped(s.totalCommits, 20, days)  * 2 +
    capped(s.totalPRs, 10, prDays)    * 2.7 +
    (s.avgComplexity / 10)            * 3.5 +
    (s.prPercentage / 100)            * 1.1 +
    jiraFactor                        * 0.5 +
    capped(s.totalReviews, 15, prDays) * 0.5;
  // No PR coverage at all: drop the PR and review terms and rescale the rest,
  // so missing data never reads as low activity (GLOOK-63 spec req. 9).
  const scaled = prDays > 0 ? raw : raw * MAX_RAW / (MAX_RAW - 2.7 - 0.5);
  return Math.round(scaled * 10) / 10;
}
```

In `src/lib/report-runner.ts` replace both `s.impactScore = computeImpactScore(s);` (L127 and L668) with:

```ts
        s.impactScore = computeImpactScore({ ...s, periodDays: days });
```

In `src/lib/teams/team-aggregator.ts` change the signature and the weighted call:

```ts
export function aggregateTeams(
  developers: AggregatorDeveloper[],
  teams:      AggregatorTeam[],
  /** GLOOK-63: the period the developer figures cover — report.period_days, or range.measuredDays. */
  periodDays: number = 14,
): TeamRow[] {
```

and in the `computeImpactScore({ ... })` call add `periodDays,` after `totalReviews: total_reviews / teamSize,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/impact-score.test.ts src/lib/__tests__/unit/team-aggregator.test.ts src/lib/__tests__/unit/aggregator.test.ts src/lib/__tests__/integration/report-runner.test.ts`
Expected: PASS (existing aggregator tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/impact-score.ts src/lib/report-runner.ts src/lib/teams/team-aggregator.ts src/lib/__tests__/unit/impact-score.test.ts src/lib/__tests__/unit/team-aggregator.test.ts src/lib/__tests__/integration/report-runner.test.ts
git commit -m "GLOOK-63: scale impact-score volume caps with the period"
```

---

### Task 2: `pr_activity` tables, store and seed data

**Files:**
- Modify: `schema.sql` (append after `team_pulse_summaries`)
- Modify: `src/lib/db/mysql.ts` (constant next to `CC_MODEL_USAGE_SCHEMA` ~L188; execute next to L349)
- Modify: `src/lib/db/sqlite.ts` (schema block after `cc_model_usage` ~L375; `conflictCols` ~L581)
- Create: `src/lib/pr-activity/store.ts`
- Modify: `scripts/seed-data.ts`, `scripts/seed.ts`
- Test: `src/lib/__tests__/unit/pr-activity-store-db.test.ts`

**Interfaces:**
- Consumes: `PRInfo` type from `@/lib/github` (`{ number; title; repo; mergedAt }`).
- Produces (all from `@/lib/pr-activity/store`):
  - `type PrActivityKind = 'authored' | 'reviewed'`
  - `upsertPrActivity(org: string, login: string, kind: PrActivityKind, prs: PRInfo[]): Promise<number>` (rows written)
  - `recordPrCoverage(org: string, login: string, sinceDate: string, untilDate: string, source: 'report' | 'backfill'): Promise<void>`
  - `hasPrCoverage(org: string, login: string, sinceDate: string, untilDate: string): Promise<boolean>`
  - `reportCoverageSlice(since: Date, runStart: Date): { sinceDate: string; untilDate: string } | null`
  - Tables `pr_activity(org, github_login, kind, repo, pr_number, merged_at)` and `pr_activity_coverage(org, github_login, since_date, until_date, source)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/pr-activity-store-db.test.ts`:

```ts
// GLOOK-63: pr_activity / pr_activity_coverage through the REAL SQLite driver (translateSQL included).
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let store: typeof import('@/lib/pr-activity/store');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-pra-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  store = await import('@/lib/pr-activity/store');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});

const PR = { number: 7, title: 'x', repo: 'app', mergedAt: '2026-09-20T10:00:00Z' };

it('upserts one row per (org, login, kind, repo, pr_number), however often it is written', async () => {
  for (let i = 0; i < 3; i++) await store.upsertPrActivity('acme', 'alice', 'authored', [PR]);
  await store.upsertPrActivity('acme', 'alice', 'reviewed', [PR]);
  const [rows] = await db.execute(`SELECT kind, merged_at FROM pr_activity WHERE org = 'acme' ORDER BY kind`);
  expect(rows).toEqual([
    { kind: 'authored', merged_at: '2026-09-20T10:00:00.000Z' },
    { kind: 'reviewed', merged_at: '2026-09-20T10:00:00.000Z' },
  ]);
});

it('skips PRs with no repo or no merge time instead of writing junk rows', async () => {
  const n = await store.upsertPrActivity('acme', 'bob', 'authored', [
    { ...PR, repo: '' }, { ...PR, number: 8, mergedAt: '' }, { ...PR, number: 9 },
  ]);
  expect(n).toBe(1);
});

it('records coverage idempotently and reports it back', async () => {
  await store.recordPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01', 'backfill');
  await store.recordPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01', 'backfill');
  const [rows] = await db.execute(`SELECT COUNT(*) AS n FROM pr_activity_coverage`);
  expect(Number(rows[0].n)).toBe(1);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01')).toBe(true);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-08-01', '2026-09-01')).toBe(false);
});

describe('reportCoverageSlice', () => {
  it('trims to whole searched days: day after since, up to (excluding) the run-start day', () => {
    expect(store.reportCoverageSlice(new Date('2026-10-13T09:30:00Z'), new Date('2026-10-27T09:30:00Z')))
      .toEqual({ sinceDate: '2026-10-14', untilDate: '2026-10-27' });
  });
  it('returns null when no whole day was searched', () => {
    expect(store.reportCoverageSlice(new Date('2026-10-26T09:00:00Z'), new Date('2026-10-27T01:00:00Z'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/pr-activity-store-db.test.ts`
Expected: FAIL, "Cannot find module '@/lib/pr-activity/store'".

- [ ] **Step 3: Add the tables**

Append to `schema.sql`:

```sql
-- GLOOK-63: merged PRs authored/reviewed, one row per PR per developer. No FK to reports:
-- PR history outlives reports. merged_at is an ISO string.
CREATE TABLE IF NOT EXISTS pr_activity (
  org          VARCHAR(128) NOT NULL,
  github_login VARCHAR(128) NOT NULL,
  kind         VARCHAR(16)  NOT NULL,
  repo         VARCHAR(200) NOT NULL,
  pr_number    INT          NOT NULL,
  merged_at    VARCHAR(32)  NOT NULL,
  PRIMARY KEY (org, github_login, kind, repo, pr_number),
  KEY idx_pr_activity_org_merged (org, merged_at)
);

-- GLOOK-63: which (org, login, [since_date, until_date)) slices of PR data are complete.
-- Column names avoid UNTIL, a MySQL reserved word.
CREATE TABLE IF NOT EXISTS pr_activity_coverage (
  org          VARCHAR(128) NOT NULL,
  github_login VARCHAR(128) NOT NULL,
  since_date   VARCHAR(10)  NOT NULL,
  until_date   VARCHAR(10)  NOT NULL,
  source       VARCHAR(16)  NOT NULL,
  PRIMARY KEY (org, github_login, since_date, until_date)
);
```

In `src/lib/db/mysql.ts`, after `CC_MODEL_USAGE_SCHEMA`:

```ts
// GLOOK-63: PR activity + coverage ledger (also in schema.sql and sqlite.ts). No FK to reports, and
// no charset pin (see mysql-schema-fk-charset.test.ts).
const PR_ACTIVITY_SCHEMAS: string[] = [
  `CREATE TABLE IF NOT EXISTS pr_activity (
  org          VARCHAR(128) NOT NULL,
  github_login VARCHAR(128) NOT NULL,
  kind         VARCHAR(16)  NOT NULL,
  repo         VARCHAR(200) NOT NULL,
  pr_number    INT          NOT NULL,
  merged_at    VARCHAR(32)  NOT NULL,
  PRIMARY KEY (org, github_login, kind, repo, pr_number),
  KEY idx_pr_activity_org_merged (org, merged_at)
)`,
  `CREATE TABLE IF NOT EXISTS pr_activity_coverage (
  org          VARCHAR(128) NOT NULL,
  github_login VARCHAR(128) NOT NULL,
  since_date   VARCHAR(10)  NOT NULL,
  until_date   VARCHAR(10)  NOT NULL,
  source       VARCHAR(16)  NOT NULL,
  PRIMARY KEY (org, github_login, since_date, until_date)
)`,
];
```

and after the `CC_MODEL_USAGE_SCHEMA` execute (~L351):

```ts
  for (const ddl of PR_ACTIVITY_SCHEMAS) {
    await pool.execute(ddl).catch((err) => {
      console.error('[db/mysql] Failed to create a pr_activity table:', err);
    });
  }
```

In `src/lib/db/sqlite.ts` schema block, after the `cc_model_usage` table:

```sql
CREATE TABLE IF NOT EXISTS pr_activity (
  org          TEXT    NOT NULL,
  github_login TEXT    NOT NULL,
  kind         TEXT    NOT NULL,
  repo         TEXT    NOT NULL,
  pr_number    INTEGER NOT NULL,
  merged_at    TEXT    NOT NULL,
  PRIMARY KEY (org, github_login, kind, repo, pr_number)
);
CREATE INDEX IF NOT EXISTS idx_pr_activity_org_merged ON pr_activity(org, merged_at);

CREATE TABLE IF NOT EXISTS pr_activity_coverage (
  org          TEXT NOT NULL,
  github_login TEXT NOT NULL,
  since_date   TEXT NOT NULL,
  until_date   TEXT NOT NULL,
  source       TEXT NOT NULL,
  PRIMARY KEY (org, github_login, since_date, until_date)
);
```

and in `translateSQL`'s `conflictCols` add:

```ts
      pr_activity: 'org, github_login, kind, repo, pr_number',
      pr_activity_coverage: 'org, github_login, since_date, until_date',
```

- [ ] **Step 4: Write the store**

Create `src/lib/pr-activity/store.ts`:

```ts
import db from '@/lib/db';
import type { PRInfo } from '@/lib/github';

/** GLOOK-63: one row per merged PR a developer authored or reviewed. */
export type PrActivityKind = 'authored' | 'reviewed';

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Upsert PR rows; returns how many were written. Rows without a repo or a parseable merge time are skipped. */
export async function upsertPrActivity(
  org: string, login: string, kind: PrActivityKind, prs: PRInfo[],
): Promise<number> {
  let written = 0;
  for (const pr of prs) {
    const t = Date.parse(pr.mergedAt);
    if (!pr.repo || !Number.isFinite(t)) continue;
    await db.execute(
      `INSERT INTO pr_activity (org, github_login, kind, repo, pr_number, merged_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE merged_at = VALUES(merged_at)`,
      [org, login, kind, pr.repo, pr.number, new Date(t).toISOString()],
    );
    written++;
  }
  return written;
}

/** Record that [sinceDate, untilDate) of this login's PR data is complete. Idempotent. */
export async function recordPrCoverage(
  org: string, login: string, sinceDate: string, untilDate: string, source: 'report' | 'backfill',
): Promise<void> {
  await db.execute(
    `INSERT IGNORE INTO pr_activity_coverage (org, github_login, since_date, until_date, source)
     VALUES (?, ?, ?, ?, ?)`,
    [org, login, sinceDate, untilDate, source],
  );
}

export async function hasPrCoverage(
  org: string, login: string, sinceDate: string, untilDate: string,
): Promise<boolean> {
  const [rows] = await db.execute(
    `SELECT 1 AS hit FROM pr_activity_coverage
     WHERE org = ? AND github_login = ? AND since_date = ? AND until_date = ? LIMIT 1`,
    [org, login, sinceDate, untilDate],
  ) as [any[], any];
  return rows.length > 0;
}

/**
 * The whole UTC days a report run's PR searches provably covered. The review query is
 * `merged:>since-date` (exclusive) and the run keeps going past midnight, so we start the day after
 * since and stop before the run-start day. Returns null when that leaves no day.
 */
export function reportCoverageSlice(since: Date, runStart: Date): { sinceDate: string; untilDate: string } | null {
  const sinceDay = Math.floor(since.getTime() / DAY_MS) * DAY_MS + DAY_MS;
  const untilDay = Math.floor(runStart.getTime() / DAY_MS) * DAY_MS;
  if (!Number.isFinite(sinceDay) || !Number.isFinite(untilDay) || sinceDay >= untilDay) return null;
  return { sinceDate: isoDay(sinceDay), untilDate: isoDay(untilDay) };
}
```

- [ ] **Step 5: Seed data**

In `scripts/seed-data.ts`, after `seedCcModelUsage` population (before section for commits), add:

```ts
// ---------------------------------------------------------------------------
// GLOOK-63: pr_activity + pr_activity_coverage (no report_id: PR history outlives reports)
// ---------------------------------------------------------------------------

export const seedPrActivity: Record<string, any>[] = [];
export const seedPrActivityCoverage: Record<string, any>[] = [];
MOCK_DEVELOPERS.forEach((dev, i) => {
  const p = profiles[i];
  for (let n = 0; n < p.prs; n++) {
    seedPrActivity.push({
      org: MOCK_ORG, github_login: dev.githubLogin, kind: 'authored',
      repo: p.activeRepos[n % p.activeRepos.length], pr_number: 1000 + i * 100 + n,
      merged_at: new Date(Date.parse(`${dateDaysAgo(1 + ((n * 3) % 28))}T15:00:00Z`)).toISOString(),
    });
  }
  for (let n = 0; n < 4; n++) {
    seedPrActivity.push({
      org: MOCK_ORG, github_login: dev.githubLogin, kind: 'reviewed',
      repo: p.activeRepos[0], pr_number: 5000 + i * 100 + n,
      merged_at: new Date(Date.parse(`${dateDaysAgo(2 + n * 5)}T11:00:00Z`)).toISOString(),
    });
  }
  seedPrActivityCoverage.push({
    org: MOCK_ORG, github_login: dev.githubLogin,
    since_date: dateDaysAgo(29), until_date: dateDaysAgo(0), source: 'report',
  });
});
```

In `scripts/seed.ts` after the `cc_model_usage` seed line:

```ts
  await seed('pr_activity', data.seedPrActivity);
  await seed('pr_activity_coverage', data.seedPrActivityCoverage);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/pr-activity-store-db.test.ts src/lib/__tests__/unit/mysql-schema-fk-charset.test.ts src/lib/__tests__/unit/mysql-date-expressions.test.ts && npm run seed:reset`
Expected: PASS. The seed run prints `pr_activity: N rows` and `pr_activity_coverage: 8 rows`.

- [ ] **Step 7: Commit**

```bash
git add schema.sql src/lib/db/mysql.ts src/lib/db/sqlite.ts src/lib/pr-activity/store.ts scripts/seed-data.ts scripts/seed.ts src/lib/__tests__/unit/pr-activity-store-db.test.ts
git commit -m "GLOOK-63: pr_activity and pr_activity_coverage tables with store"
```

---

### Task 3: Paged review search and bounded PR searches in `github.ts`

**Files:**
- Modify: `src/lib/github.ts` (`GitHubProvider` ~L97-111; `searchUserMergedPRs` L715-801; `countReviewedPRs` L1005-1037; provider factory ~L1500)
- Modify: `src/lib/github-mock.ts:121-123`
- Test: `src/lib/__tests__/unit/github-reviewed-prs.test.ts`

**Interfaces:**
- Consumes: none from earlier tasks.
- Produces:
  - `export interface ReviewedPRsResult { reviews: number; prs: PRInfo[]; itemsComplete: boolean; unverified?: string }`
  - `export async function countReviewedPRs(org: string, user: string, since: Date, log?: (msg: string) => void, until?: Date): Promise<ReviewedPRsResult>`
  - `export async function searchUserMergedPRs(org: string, user: string, since: Date, log?: (msg: string) => void, until?: Date): Promise<{ prs: PRInfo[]; unverified?: string }>`
  - `GitHubProvider.countReviewedPRs` has the signature above; new `GitHubProvider.fetchMergedPRs(org, user, since, log?, until?)` is the same as `searchUserMergedPRs`.
  - When `until` is given, both queries use `merged:YYYY-MM-DD..YYYY-MM-DD` (inclusive). Without it, they are unchanged (`merged:>=` for authored, `merged:>` for reviewed).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/github-reviewed-prs.test.ts`:

```ts
// @octokit/rest is ESM-only; FACTORY-form mock required before the import.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { countReviewedPRs, searchUserMergedPRs, __setOctokitForTest } from '@/lib/github';

jest.useFakeTimers({ doNotFake: ['nextTick'], now: new Date('2026-10-27T12:00:00Z') });
afterEach(() => { jest.clearAllTimers(); __setOctokitForTest(null); });

/** Same pump as pr-search-false-skips.test.ts: drain 2.5s inter-page and retry sleeps. */
async function drain<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = p.then((v) => { settled = true; return v; }, (e) => { settled = true; throw e; });
  tracked.catch(() => {});
  for (let i = 0; i < 200 && !settled; i++) {
    jest.advanceTimersByTime(10_000);
    for (let j = 0; j < 10; j++) await Promise.resolve();
  }
  return tracked;
}

const SINCE = new Date('2026-10-13T00:00:00Z');
const item = (n: number) => ({
  number: n, title: `PR ${n}`,
  repository_url: 'https://api.github.com/repos/acme/app',
  pull_request: { merged_at: '2026-10-20T10:00:00Z' },
});
const page = (total: number, from: number, count: number, incomplete = false) => ({
  total_count: total, incomplete_results: incomplete,
  items: Array.from({ length: count }, (_, i) => item(from + i)),
});

function stubPages(pages: any[]) {
  const calls: any[] = [];
  __setOctokitForTest({
    search: {
      issuesAndPullRequests: async (args: any) => {
        calls.push(args);
        return { data: pages[Math.min(calls.length - 1, pages.length - 1)] };
      },
    },
  });
  return calls;
}

describe('countReviewedPRs (GLOOK-63)', () => {
  it('pages at per_page 100 and returns every reviewed PR', async () => {
    const calls = stubPages([page(150, 1, 100), page(150, 101, 50)]);
    const r = await drain(countReviewedPRs('acme', 'alice', SINCE));
    expect(calls.map(c => [c.per_page, c.page])).toEqual([[100, 1], [100, 2]]);
    expect(calls[0].q).toBe('org:acme is:pr is:merged reviewed-by:alice merged:>2026-10-13');
    expect(r.reviews).toBe(150);
    expect(r.prs).toHaveLength(150);
    expect(r.prs[0]).toEqual({ number: 1, title: 'PR 1', repo: 'app', mergedAt: '2026-10-20T10:00:00Z' });
    expect(r.itemsComplete).toBe(true);
    expect(r.unverified).toBeUndefined();
  });

  it('keeps the page-1 count as unverified when page 1 stays untrustworthy (unchanged GLOOK-50 rule)', async () => {
    stubPages([{ total_count: 3, incomplete_results: true, items: [] }]);
    const r = await drain(countReviewedPRs('acme', 'alice', SINCE));
    expect(r.reviews).toBe(3);
    expect(r.unverified).toMatch(/review-count search timed out \(total_count=3\)/);
    expect(r.itemsComplete).toBe(false);
  });

  it('a timed-out empty zero is still a kept, unverified zero', async () => {
    stubPages([{ total_count: 0, incomplete_results: true, items: [] }]);
    const r = await drain(countReviewedPRs('acme', 'bot', SINCE));
    expect(r).toMatchObject({ reviews: 0, prs: [], itemsComplete: false });
    expect(r.unverified).toBeDefined();
  });

  it('a later page going bad never raises: count kept, rows marked incomplete, no unverified', async () => {
    stubPages([page(150, 1, 100), { total_count: 150, incomplete_results: true, items: [] }]);
    const r = await drain(countReviewedPRs('acme', 'alice', SINCE));
    expect(r.reviews).toBe(150);
    expect(r.prs).toHaveLength(100);
    expect(r.itemsComplete).toBe(false);
    expect(r.unverified).toBeUndefined();
  });

  it('a bounded window uses an inclusive merged range', async () => {
    const calls = stubPages([page(0, 1, 0)]);
    await drain(countReviewedPRs('acme', 'alice', new Date('2026-03-01T00:00:00Z'), undefined, new Date('2026-03-31T00:00:00Z')));
    expect(calls[0].q).toBe('org:acme is:pr is:merged reviewed-by:alice merged:2026-03-01..2026-03-31');
  });
});

describe('searchUserMergedPRs with until (GLOOK-63)', () => {
  it('uses an inclusive merged range and keeps its raise-on-provable-loss rule', async () => {
    const calls = stubPages([page(2, 1, 2)]);
    const r = await drain(searchUserMergedPRs('acme', 'alice', new Date('2026-03-01T00:00:00Z'), undefined, new Date('2026-03-31T00:00:00Z')));
    expect(calls[0].q).toBe('org:acme type:pr is:merged author:alice merged:2026-03-01..2026-03-31');
    expect(r.prs).toHaveLength(2);

    stubPages([{ total_count: 4, incomplete_results: false, items: [] }]);
    await expect(drain(searchUserMergedPRs('acme', 'alice', SINCE))).rejects.toThrow(/counted 4 PRs but delivered none/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/github-reviewed-prs.test.ts`
Expected: FAIL. `countReviewedPRs` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/github.ts`:

(a) Add after the `UserActivity` interface:

```ts
/** GLOOK-63: reviewed PRs as rows, plus the review count that total_reviews has always stored. */
export interface ReviewedPRsResult {
  /** Page-1 total_count — the exact value total_reviews stored before GLOOK-63. */
  reviews: number;
  prs: PRInfo[];
  /** False when the rows fall short of `reviews` (timeout, cap). Withholds PR coverage only. */
  itemsComplete: boolean;
  unverified?: string;
}
```

(b) In `GitHubProvider` replace the `countReviewedPRs` line and add `fetchMergedPRs`:

```ts
  countReviewedPRs(org: string, user: string, since: Date, log?: (msg: string) => void, until?: Date): Promise<ReviewedPRsResult>;
  fetchMergedPRs(org: string, user: string, since: Date, log?: (msg: string) => void, until?: Date): Promise<{ prs: PRInfo[]; unverified?: string }>;
```

(c) Above `searchUserMergedPRs` add the shared helpers:

```ts
/** `merged:` clause. With `until`, an inclusive day range (backfill months); else the open-ended form each search always used. */
function mergedDateClause(since: Date, until: Date | undefined, op: '>=' | '>'): string {
  const s = since.toISOString().split('T')[0];
  if (!until) return `merged:${op}${s}`;
  return `merged:${s}..${until.toISOString().split('T')[0]}`;
}

function toPRInfos(items: any[] | undefined): PRInfo[] {
  const out: PRInfo[] = [];
  for (const item of items ?? []) {
    const repoFullName = (item.repository_url || '').split('/repos/')[1] || '';
    const repo = repoFullName.split('/')[1] || '';
    out.push({ number: item.number, title: item.title, repo, mergedAt: item.pull_request?.merged_at || '' });
  }
  return out;
}
```

(d) Change `searchUserMergedPRs` to `export async function searchUserMergedPRs(org, user, since, log?, until?: Date)`. Replace its `sinceStr`/`query` lines with:

```ts
  const query = `org:${org} type:pr is:merged author:${user} ${mergedDateClause(since, until, '>=')}`;
```

and replace the `for (const item of (data.items ?? []) as any[]) { ... prs.push(...) }` loop with `prs.push(...toPRInfos(data.items as any[]));`. Leave every trust branch exactly as it is.

(e) Replace the whole `countReviewedPRs` function with:

```ts
/**
 * GLOOK-63: merged PRs this user reviewed, paged at per_page 100 so each one can be stored in
 * pr_activity. Trust rules are the GLOOK-50 ones, unchanged: `reviews` is page 1's total_count (the
 * figure total_reviews has always stored). A page-1 result that stays untrustworthy is kept as
 * UNVERIFIED and never raised. A later page that goes bad cannot change the count, which is already
 * known, so it doesn't raise either. It only marks the rows incomplete, which withholds coverage.
 * Do not unify this with the commit search's strict policy.
 */
export async function countReviewedPRs(
  org: string,
  user: string,
  since: Date,
  log?: (msg: string) => void,
  until?: Date,
): Promise<ReviewedPRsResult> {
  const q = `org:${org} is:pr is:merged reviewed-by:${user} ${mergedDateClause(since, until, '>')}`;
  const prs: PRInfo[] = [];
  let reviews = 0;
  let page = 1;
  while (true) {
    await sleep(2500);
    const { data, trustworthy } = await searchPageWithRetry(
      'reviewed-prs', user, page,
      () => withRetry(
        () => getOctokit().search.issuesAndPullRequests({ q, per_page: SEARCH_PER_PAGE, page }),
        log,
      ),
      log,
    );
    if (page === 1) {
      reviews = data.total_count ?? 0;
      if (!trustworthy) {
        // A timed-out review count reads low and halves a scoring factor. Keep it, hand the caller the doubt.
        const unverified =
          `review-count search timed out (total_count=${reviews}); kept as unverified`;
        log?.(`[search] reviewed-prs @${user} UNVERIFIED ${unverified}`);
        return { reviews, prs: toPRInfos(data.items as any[]), itemsComplete: false, unverified };
      }
    } else if (!trustworthy) {
      log?.(`[search] reviewed-prs @${user} page=${page} untrustworthy; kept count ${reviews}, rows incomplete (${prs.length})`);
      return { reviews, prs, itemsComplete: false };
    }
    prs.push(...toPRInfos(data.items as any[]));
    if (prs.length >= Math.min(reviews, SEARCH_RESULT_CAP)) break;
    if ((data.items ?? []).length < SEARCH_PER_PAGE) break;
    page++;
  }
  return { reviews, prs, itemsComplete: prs.length >= reviews };
}
```

(f) In `getGitHubProvider()`'s real provider object add `fetchMergedPRs: searchUserMergedPRs,` after `countReviewedPRs,`.

In `src/lib/github-mock.ts` replace `countReviewedPRs` and add `fetchMergedPRs`:

```ts
    async countReviewedPRs(_org, _user, since) {
      const reviews = Math.floor(Math.random() * 15);
      const start = since.getTime();
      const prs = Array.from({ length: reviews }, (_, i) => ({
        number: 9000 + i, title: `Mock reviewed PR ${i}`, repo: 'api-gateway',
        mergedAt: new Date(start + (i + 1) * 3_600_000).toISOString(),
      }));
      return { reviews, prs, itemsComplete: true };
    },

    async fetchMergedPRs() {
      return { prs: [] };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/github-reviewed-prs.test.ts src/lib/__tests__/unit/pr-search-false-skips.test.ts src/lib/__tests__/unit/search-accounting.test.ts src/lib/__tests__/unit/search-timeout-recovery.test.ts && npx tsc --noEmit`
Expected: PASS, with no type errors. If `tsc` flags test stubs that build a full `GitHubProvider` object, add `fetchMergedPRs: jest.fn()` to those stubs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts src/lib/__tests__/unit/github-reviewed-prs.test.ts
git commit -m "GLOOK-63: page the review search and return PR rows; bounded merged windows"
```

---

### Task 4: Report runner writes `pr_activity` and coverage

**Files:**
- Modify: `src/lib/report-runner.ts` (member loop ~L188-250; run start ~L44)
- Test: `src/lib/__tests__/integration/report-runner.test.ts`

**Interfaces:**
- Consumes: `upsertPrActivity`, `recordPrCoverage`, `reportCoverageSlice` (Task 2); `ReviewedPRsResult` (Task 3).
- Produces: each run writes `pr_activity` rows (`authored` from `activity.prs`, `reviewed` from `countReviewedPRs(...).prs`), plus one `pr_activity_coverage` row (`source='report'`) per member whose PR searches were all trustworthy.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/__tests__/integration/report-runner.test.ts` (new `describe` at the end of the outer `describe('runReport')`):

```ts
  describe('pr_activity (GLOOK-63)', () => {
    const sqlCalls = (frag: string) =>
      mockDbExecute.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].includes(frag));
    const reviewed = { reviews: 1, prs: [{ number: 9, title: 'R', repo: 'other', mergedAt: '2025-01-16T00:00:00Z' }], itemsComplete: true };

    beforeEach(() => {
      mockListOrgMembers.mockResolvedValue([{ login: 'alice', avatarUrl: '' }]);
      mockCountReviewedPRs.mockReset();
      mockCountReviewedPRs.mockResolvedValue(reviewed);
    });
    afterEach(() => {
      mockCountReviewedPRs.mockReset();
      mockCountReviewedPRs.mockResolvedValue(0); // the file-level default other tests rely on
    });

    it('upserts authored and reviewed PR rows with the org', async () => {
      await runReport('rp1', 'my-org', 14);
      const rows = sqlCalls('INSERT INTO pr_activity').map((c: any[]) => c[1]);
      expect(rows).toEqual(expect.arrayContaining([
        ['my-org', 'alice', 'authored', 'my-repo', 1, '2025-01-15T00:00:00.000Z'],
        ['my-org', 'alice', 'reviewed', 'other', 9, '2025-01-16T00:00:00.000Z'],
      ]));
    });

    it('records a report coverage slice when both PR searches were trustworthy', async () => {
      await runReport('rp2', 'my-org', 14);
      const cov = sqlCalls('INTO pr_activity_coverage');
      expect(cov).toHaveLength(1);
      expect(cov[0][1][0]).toBe('my-org');
      expect(cov[0][1][1]).toBe('alice');
      expect(cov[0][1][4]).toBe('report');
    });

    it.each([
      ['merged-PR count unverified', () => mockFetchUserActivity.mockImplementation(async () => ({ commits: [], prs: [], prsUnverified: 'timed out' }))],
      ['review count unverified', () => mockCountReviewedPRs.mockResolvedValue({ ...reviewed, unverified: 'timed out' })],
      ['review rows incomplete', () => mockCountReviewedPRs.mockResolvedValue({ ...reviewed, itemsComplete: false })],
      ['review search threw', () => mockCountReviewedPRs.mockRejectedValue(new Error('boom'))],
    ])('writes no coverage when %s', async (_label, arrange) => {
      arrange();
      await runReport('rp3', 'my-org', 14);
      expect(sqlCalls('INTO pr_activity_coverage')).toHaveLength(0);
    });

    it('still records the review doubt on the unverified channel, as before', async () => {
      mockCountReviewedPRs.mockResolvedValue({ ...reviewed, unverified: 'timed out' });
      await runReport('rp4', 'my-org', 14);
      const done = sqlCalls(`status = 'completed'`).pop()!;
      const meta = JSON.parse(done[1][0]);
      expect(meta.unverified).toEqual([expect.objectContaining({ login: 'alice', field: 'reviews', kept: 1 })]);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts -t "pr_activity"`
Expected: FAIL. No `pr_activity` SQL is issued.

- [ ] **Step 3: Implement**

In `src/lib/report-runner.ts` add the import:

```ts
import { upsertPrActivity, recordPrCoverage, reportCoverageSlice } from './pr-activity/store';
```

Right after `const since = ...` (L44) add:

```ts
  // GLOOK-63: the whole days every member's PR searches provably covered this run.
  const prCoverageSlice = reportCoverageSlice(since, new Date());
```

In the member loop, directly after `prCounts.set(member.login, activity.prs.length);`:

```ts
        // GLOOK-63: persist merged PRs so ranges can count each PR once across overlapping reports.
        // Coverage is recorded only when every PR search for this member was trustworthy.
        let prSearchTrusted = !activity.prsUnverified;
        try {
          await upsertPrActivity(org, member.login, 'authored', activity.prs);
        } catch (err) {
          prSearchTrusted = false;
          log(`@${member.login}: pr_activity (authored) write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
```

Inside the existing review `try` block, after the `if (reviewResult.unverified) { ... }` block:

```ts
          if (reviewResult.unverified || reviewResult.itemsComplete !== true) prSearchTrusted = false;
          try {
            await upsertPrActivity(org, member.login, 'reviewed', reviewResult.prs ?? []);
          } catch (err) {
            prSearchTrusted = false;
            log(`@${member.login}: pr_activity (reviewed) write failed: ${err instanceof Error ? err.message : String(err)}`);
          }
```

In that block's `catch (err)`, add `prSearchTrusted = false;` as its first line. After the whole review try/catch:

```ts
        if (prSearchTrusted && prCoverageSlice) {
          await recordPrCoverage(org, member.login, prCoverageSlice.sinceDate, prCoverageSlice.untilDate, 'report')
            .catch((err) => log(`@${member.login}: pr coverage write failed: ${err instanceof Error ? err.message : String(err)}`));
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts src/lib/__tests__/unit/integrity-guard-regression.test.ts`
Expected: PASS (all existing runner tests too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-runner.ts src/lib/__tests__/integration/report-runner.test.ts
git commit -m "GLOOK-63: report runs write pr_activity and coverage"
```

---

### Task 5: Range options, window and measured-days math

**Files:**
- Create: `src/lib/report/range-options.ts`
- Create: `src/lib/report/range.ts` (window part only; SQL added in Task 6)
- Modify: `src/lib/report/timeline.ts` (add two exports after `coveredWeeksFromWindows`)
- Test: `src/lib/__tests__/unit/report-range.test.ts`

**Interfaces:**
- Consumes: `CoverageWindow`, `completedReportWindows` from `timeline.ts`.
- Produces:
  - `range-options.ts` (pure, client-safe): `RANGE_OPTIONS = ['current','90d','12m'] as const`; `type ReportRange`; `type ReportRangeKey = Exclude<ReportRange,'current'>`; `RANGE_LABELS: Record<ReportRange,string>`; `RANGE_DAYS: Record<ReportRangeKey, number>`; `parseRange(value: string | null | undefined): ReportRange | null`; `withRange(url: string, range: ReportRange): string`; `interface RangeMeta { key: ReportRangeKey; since: string; until: string; days: number; measuredDays: number; prCoveredSince: string | null }`; `rangeNotes(meta: RangeMeta | null | undefined): string[]`.
  - `timeline.ts`: `unionDayCount(intervals: Array<[number, number]>, startMs: number, endMs: number): number`; `measuredDaysInWindow(windows: CoverageWindow[], since: string, until: string): number`.
  - `range.ts`: re-exports everything from `range-options`; `interface RangeWindow { since: string; until: string; days: number }`; `rangeWindow(report: { completed_at?: unknown; created_at?: unknown }, range: ReportRangeKey): RangeWindow`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/report-range.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { RANGE_OPTIONS, parseRange, withRange, rangeNotes, type RangeMeta } from '@/lib/report/range-options';
import { rangeWindow } from '@/lib/report/range';
import { unionDayCount, measuredDaysInWindow, type CoverageWindow } from '@/lib/report/timeline';

const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe('range options', () => {
  it('offers current, 90d, 12m in that order', () => {
    expect(RANGE_OPTIONS).toEqual(['current', '90d', '12m']);
  });
  it('parseRange: missing/empty is current, exact values pass, anything else is invalid', () => {
    expect(parseRange(null)).toBe('current');
    expect(parseRange('')).toBe('current');
    expect(parseRange('90d')).toBe('90d');
    expect(parseRange('12m')).toBe('12m');
    for (const bad of ['90D', 'all', '30d', ' 90d']) expect(parseRange(bad)).toBeNull();
  });
  it('withRange adds nothing for current and appends correctly otherwise', () => {
    expect(withRange('/api/report/r1', 'current')).toBe('/api/report/r1');
    expect(withRange('/api/report/r1', '90d')).toBe('/api/report/r1?range=90d');
    expect(withRange('/x?login=a', '12m')).toBe('/x?login=a&range=12m');
  });
});

describe('rangeWindow', () => {
  it('ends the day after the report end date and spans exactly the range', () => {
    expect(rangeWindow({ completed_at: '2026-10-27T15:00:00Z', created_at: '2026-10-27T09:00:00Z' }, '90d'))
      .toEqual({ since: '2026-07-30', until: '2026-10-28', days: 90 });
    expect(rangeWindow({ completed_at: '2026-10-27T15:00:00Z' }, '12m'))
      .toEqual({ since: '2025-10-28', until: '2026-10-28', days: 365 });
  });
  it('falls back to created_at when completed_at is missing', () => {
    expect(rangeWindow({ completed_at: null, created_at: '2026-03-10T08:00:00Z' }, '90d').until).toBe('2026-03-11');
  });
});

describe('unionDayCount / measuredDaysInWindow', () => {
  it('counts whole UTC days in the union, clipped to the range', () => {
    // [Sep 1, Sep 11) ∪ [Sep 5, Sep 15) overlap → Sep 1..14 = 14 days; gap; [Sep 20, Sep 22) = 2 days
    const iv: Array<[number, number]> = [[D('2026-09-05'), D('2026-09-15')], [D('2026-09-01'), D('2026-09-11')], [D('2026-09-20'), D('2026-09-22')]];
    expect(unionDayCount(iv, D('2026-08-01'), D('2026-10-01'))).toBe(16);
    expect(unionDayCount(iv, D('2026-09-10'), D('2026-09-21'))).toBe(6); // Sep 10..14 + Sep 20
  });
  it('does not count a partly covered day', () => {
    expect(unionDayCount([[D('2026-09-01') + 3_600_000, D('2026-09-03') + 3_600_000]], 0, D('2027-01-01'))).toBe(1);
  });
  it('measured days come from report windows [completed_at − period, created_at]', () => {
    const w = (created: string, completed: string, periodDays: number): CoverageWindow =>
      ({ createdAt: new Date(created), completedAt: new Date(completed), periodDays });
    const windows = [
      w('2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z', 14),
      w('2026-10-02T12:00:00Z', '2026-10-02T13:00:00Z', 14),
      w('2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z', 14),
    ];
    expect(measuredDaysInWindow(windows, '2026-07-30', '2026-10-28')).toBe(15); // Sep 18 .. Oct 2
    expect(measuredDaysInWindow([], '2026-07-30', '2026-10-28')).toBe(0);
  });
});

describe('rangeNotes', () => {
  const meta: RangeMeta = { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 212, prCoveredSince: '2026-03-03' };
  it('says how many days were measured and from when PR data exists', () => {
    expect(rangeNotes(meta)).toEqual(['212 of 365 days measured', 'PR and review data from Mar 3']);
  });
  it('is silent when fully measured and covered', () => {
    expect(rangeNotes({ ...meta, measuredDays: 365, prCoveredSince: '2025-10-28' })).toEqual([]);
    expect(rangeNotes(null)).toEqual([]);
  });
  it('says when no PR data exists at all', () => {
    expect(rangeNotes({ ...meta, measuredDays: 365, prCoveredSince: null })).toEqual(['No PR and review data in this range']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/report-range.test.ts`
Expected: FAIL, "Cannot find module '@/lib/report/range-options'".

- [ ] **Step 3: Implement**

Create `src/lib/report/range-options.ts`:

```ts
/**
 * GLOOK-63: the Team/Engineer page date range. Pure, so client pages and server code share one
 * definition. `range.ts` (server, imports db) re-exports everything here.
 */
export const RANGE_OPTIONS = ['current', '90d', '12m'] as const;
export type ReportRange = typeof RANGE_OPTIONS[number];
export type ReportRangeKey = Exclude<ReportRange, 'current'>;

export const RANGE_LABELS: Record<ReportRange, string> = {
  current: 'Current report',
  '90d': 'Past 90 days',
  '12m': 'Past 12 months',
};

export const RANGE_DAYS: Record<ReportRangeKey, number> = { '90d': 90, '12m': 365 };

/** Missing or empty → 'current'; one of the exact values → itself; anything else → null (API: 400). */
export function parseRange(value: string | null | undefined): ReportRange | null {
  if (value == null || value === '') return 'current';
  return (RANGE_OPTIONS as readonly string[]).includes(value) ? (value as ReportRange) : null;
}

/** Current report sends no range parameter, so its requests stay byte-identical to before. */
export function withRange(url: string, range: ReportRange): string {
  if (range === 'current') return url;
  return `${url}${url.includes('?') ? '&' : '?'}range=${range}`;
}

/** Response `range` block. Dates are YYYY-MM-DD; `until` is exclusive. */
export interface RangeMeta {
  key: ReportRangeKey;
  since: string;
  until: string;
  days: number;
  measuredDays: number;
  /** Earliest day with PR/review coverage inside the range; null when there is none. */
  prCoveredSince: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
}

/** The notes shown next to the picker. Empty when nothing is missing. */
export function rangeNotes(meta: RangeMeta | null | undefined): string[] {
  if (!meta) return [];
  const notes: string[] = [];
  if (meta.measuredDays < meta.days) notes.push(`${meta.measuredDays} of ${meta.days} days measured`);
  if (meta.prCoveredSince == null) notes.push('No PR and review data in this range');
  else if (meta.prCoveredSince > meta.since) notes.push(`PR and review data from ${shortDay(meta.prCoveredSince)}`);
  return notes;
}
```

Append to `src/lib/report/timeline.ts` after `coveredWeeksFromWindows`:

```ts
/**
 * GLOOK-63: how many UTC days lie wholly inside the union of `intervals` AND inside
 * [startMs, endMs). Same "whole day" rule as coveredWeeksFromWindows, so a range's measured days
 * and the charts' covered weeks never disagree. Overlapping intervals count once.
 */
export function unionDayCount(intervals: Array<[number, number]>, startMs: number, endMs: number): number {
  const clipped = intervals
    .map(([s, e]) => [Math.max(s, startMs), Math.min(e, endMs)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s < e)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of clipped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let days = 0;
  for (const [s, e] of merged) days += Math.max(0, Math.floor(e / DAY_MS) - Math.ceil(s / DAY_MS));
  return days;
}

/** GLOOK-63: measured days in [since, until) (YYYY-MM-DD, until exclusive) from completed reports' windows. */
export function measuredDaysInWindow(windows: CoverageWindow[], since: string, until: string): number {
  const intervals: Array<[number, number]> = windows.map(({ completedAt, createdAt, periodDays }) =>
    [completedAt.getTime() - Number(periodDays) * DAY_MS, createdAt.getTime()]);
  return unionDayCount(intervals, Date.parse(`${since}T00:00:00Z`), Date.parse(`${until}T00:00:00Z`));
}
```

Create `src/lib/report/range.ts`:

```ts
import { RANGE_DAYS, type ReportRangeKey } from './range-options';

export * from './range-options';

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole UTC days; `until` is exclusive. */
export interface RangeWindow {
  since: string;
  until: string;
  days: number;
}

/**
 * GLOOK-63: a range ends on the report's end date (completed_at, else created_at) and starts 90 or
 * 365 days before. `until` is the UTC midnight after that date, so the end day is included.
 */
export function rangeWindow(
  report: { completed_at?: unknown; created_at?: unknown },
  range: ReportRangeKey,
): RangeWindow {
  let end = NaN;
  for (const v of [report.completed_at, report.created_at]) {
    if (v == null) continue;
    const t = new Date(v as string | number | Date).getTime();
    if (Number.isFinite(t)) { end = t; break; }
  }
  if (!Number.isFinite(end)) end = Date.now();
  const days = RANGE_DAYS[range];
  const untilMs = Math.floor(end / DAY_MS) * DAY_MS + DAY_MS;
  return { since: isoDay(untilMs - days * DAY_MS), until: isoDay(untilMs), days };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/report-range.test.ts src/lib/__tests__/unit/timeline.test.ts src/lib/__tests__/unit/report-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/range-options.ts src/lib/report/range.ts src/lib/report/timeline.ts src/lib/__tests__/unit/report-range.test.ts
git commit -m "GLOOK-63: range options, window and measured-days math"
```

---

### Task 6: `getRangeDeveloperStats` and range drill-down queries

**Files:**
- Modify: `src/lib/report/range.ts`
- Test: `src/lib/__tests__/unit/report-range-db.test.ts`

**Interfaces:**
- Consumes: `RangeWindow`, `rangeWindow` (Task 5); `canonicalCommitIdsSql`, `completedReportWindows`, `measuredDaysInWindow`, `unionDayCount` (`timeline.ts`); `computeImpactScore` (Task 1); `pr_activity`, `pr_activity_coverage` (Task 2).
- Produces (from `@/lib/report/range`):
  - `interface RangeDeveloperRow { github_login; github_name; avatar_url; total_prs; total_commits; lines_added; lines_removed; avg_complexity; impact_score; pr_percentage; ai_percentage; total_jira_issues; total_story_points; total_reviews; type_breakdown: Record<string, number>; active_repos: string[]; measured_days: number; pr_covered_days: number; pr_covered_since: string | null }`. All numbers are `number`.
  - `getRangeDeveloperStats(org: string, window: RangeWindow): Promise<RangeDeveloperRow[]>`, sorted by `impact_score` DESC, then `github_login`.
  - `getRangeCommits(org: string, login: string, window: RangeWindow): Promise<any[]>`. Columns are the Engineer page commit list's (`commit_sha, repo, commit_message, pr_number, pr_title, type, complexity, risk_level, impact_summary, lines_added, lines_removed, committed_at, ai_co_authored, ai_tool_name, maybe_ai`), newest first.
  - `getRangeJiraIssues(org: string, login: string | undefined, window: RangeWindow): Promise<any[]>`, with the same shape as `getJiraIssues`.
  - `loadReportRangeWindow(reportId: string, range: ReportRangeKey): Promise<{ org: string; window: RangeWindow } | null>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/report-range-db.test.ts`:

```ts
// GLOOK-63: range figures through the REAL SQLite driver. Each source counts an item once across
// overlapping reports and excludes items outside the range.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeImpactScore } from '@/lib/impact-score';

let dbPath: string;
let db: any;
let range: typeof import('@/lib/report/range');
let store: typeof import('@/lib/pr-activity/store');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;
const WINDOW = { since: '2026-07-30', until: '2026-10-28', days: 90 };

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-range-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  range = await import('@/lib/report/range');
  store = await import('@/lib/pr-activity/store');

  // Three overlapping daily reports inside the range, one old report outside it, one other org.
  const reports: Array<[string, string, string, string]> = [
    ['r0', 'acme', '2026-05-01T12:00:00Z', '2026-05-01T13:00:00Z'],
    ['r1', 'acme', '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z'],
    ['r2', 'acme', '2026-10-02T12:00:00Z', '2026-10-02T13:00:00Z'],
    ['r3', 'acme', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z'],
    ['x1', 'other', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z'],
  ];
  for (const [id, org, created, completed] of reports) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, ?, 14, 'completed', ?, ?)`,
      [id, org, created, completed],
    );
  }
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES ('r0', 'bob', 'Bob', '')`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES ('r0', 'alice', 'Old Alice', '')`);
  for (const id of ['r1', 'r2', 'r3']) {
    await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, avatar_url) VALUES (?, 'alice', ?, 'a.png')`, [id, `Alice ${id}`]);
  }
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name) VALUES ('x1', 'alice', 'Other')`);

  const commit = (rid: string, sha: string, at: string) => db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, type, lines_added, lines_removed, committed_at, pr_number, ai_co_authored, maybe_ai)
     VALUES (?, 'alice', 'app', ?, 4, 'feature', 10, 2, ?, 7, 0, 1)`, [rid, sha, at]);
  for (const id of ['r1', 'r2', 'r3']) await commit(id, 'aaa', '2026-09-20T10:00:00Z');
  await commit('r0', 'old', '2026-04-20T10:00:00Z');
  await commit('x1', 'zzz', '2026-09-20T10:00:00Z');

  const issue = (rid: string, key: string, at: string) => db.execute(
    `INSERT INTO jira_issues (report_id, github_login, jira_account_id, issue_key, story_points, resolved_at)
     VALUES (?, 'alice', 'acc', ?, 3, ?)`, [rid, key, at]);
  for (const id of ['r1', 'r2', 'r3']) await issue(id, 'J-1', '2026-09-21T10:00:00Z');
  await issue('r0', 'J-OLD', '2026-04-21T10:00:00Z');

  const pr = (n: number, at: string) => ({ number: n, title: 't', repo: 'app', mergedAt: at });
  for (let i = 0; i < 3; i++) await store.upsertPrActivity('acme', 'alice', 'authored', [pr(1, '2026-09-20T10:00:00Z')]);
  await store.upsertPrActivity('acme', 'alice', 'authored', [pr(2, '2026-04-01T10:00:00Z')]);
  await store.upsertPrActivity('acme', 'alice', 'reviewed', [pr(5, '2026-09-22T10:00:00Z')]);
  await store.upsertPrActivity('other', 'alice', 'authored', [pr(1, '2026-09-20T10:00:00Z')]);
  await store.recordPrCoverage('acme', 'alice', '2026-09-18', '2026-10-03', 'report');
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});

describe('getRangeDeveloperStats', () => {
  it('lists only developers in a report whose window overlaps the range', async () => {
    const rows = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(rows.map(r => r.github_login)).toEqual(['alice']);
    expect(rows[0].github_name).toBe('Alice r3'); // latest report's name
  });

  it('counts each commit, issue and PR once across three overlapping reports, excluding out-of-range items', async () => {
    const [a] = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(a).toMatchObject({
      total_commits: 1, lines_added: 10, lines_removed: 2, avg_complexity: 4,
      pr_percentage: 100, ai_percentage: 100, type_breakdown: { feature: 1 }, active_repos: ['app'],
      total_jira_issues: 1, total_story_points: 3,
      total_prs: 1, total_reviews: 1,
      measured_days: 15, pr_covered_days: 15, pr_covered_since: '2026-09-18',
    });
  });

  it('scores with measured days for volume and PR-covered days for PR/review caps', async () => {
    const [a] = await range.getRangeDeveloperStats('acme', WINDOW);
    expect(a.impact_score).toBe(computeImpactScore({
      totalCommits: 1, totalPRs: 1, avgComplexity: 4, prPercentage: 100,
      totalStoryPoints: 3, totalJiraIssues: 1, totalReviews: 1, periodDays: 15, prPeriodDays: 15,
    }));
  });

  it('a range with no measured days still scores finitely', async () => {
    // r0's window ends 2026-05-01 12:00, so it overlaps this one-day range but covers no whole day.
    const rows = await range.getRangeDeveloperStats('acme', { since: '2026-05-01', until: '2026-05-02', days: 1 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].measured_days).toBe(0);
    expect(rows.every(r => Number.isFinite(r.impact_score))).toBe(true);
  });
});

describe('range drill-downs', () => {
  it('getRangeCommits returns one row per commit, in range only', async () => {
    const rows = await range.getRangeCommits('acme', 'alice', WINDOW);
    expect(rows.map((r: any) => r.commit_sha)).toEqual(['aaa']);
  });
  it('getRangeJiraIssues returns one row per issue key, in range only', async () => {
    const rows = await range.getRangeJiraIssues('acme', 'alice', WINDOW);
    expect(rows.map((r: any) => r.issue_key)).toEqual(['J-1']);
    expect(rows[0].story_points).toBe(3);
    expect(Array.isArray(rows[0].labels)).toBe(true);
  });
  it('loadReportRangeWindow resolves the org and window from a report id', async () => {
    expect(await range.loadReportRangeWindow('r3', '90d')).toEqual({
      org: 'acme', window: range.rangeWindow({ completed_at: '2026-10-03T13:00:00Z' }, '90d'),
    });
    expect(await range.loadReportRangeWindow('missing', '90d')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/report-range-db.test.ts`
Expected: FAIL. `range.getRangeDeveloperStats is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/report/range.ts` (and add the imports at the top):

```ts
import db from '@/lib/db';
import { computeImpactScore } from '@/lib/impact-score';
import { canonicalCommitIdsSql, completedReportWindows, measuredDaysInWindow, unionDayCount } from './timeline';
```

```ts
export interface RangeDeveloperRow {
  github_login: string;
  github_name: string;
  avatar_url: string;
  total_prs: number;
  total_commits: number;
  lines_added: number;
  lines_removed: number;
  avg_complexity: number;
  impact_score: number;
  pr_percentage: number;
  ai_percentage: number;
  total_jira_issues: number;
  total_story_points: number;
  total_reviews: number;
  type_breakdown: Record<string, number>;
  active_repos: string[];
  measured_days: number;
  pr_covered_days: number;
  pr_covered_since: string | null;
}

const ORG_REPORTS = { subquery: 'SELECT id FROM reports WHERE org = ?' };
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** One jira_issues id per issue_key (the latest copy) among the org's reports. */
function canonicalJiraIdsSql(): string {
  return `SELECT MAX(id) AS id FROM jira_issues
          WHERE report_id IN (SELECT id FROM reports WHERE org = ?)
          GROUP BY issue_key`;
}

/**
 * GLOOK-63: every developer figure recomputed over [window.since, window.until), each source
 * de-duplicated by its own key (spec requirement 6). Developers are those with a developer_stats
 * row in any completed report whose search window overlaps the range (requirement 7).
 */
export async function getRangeDeveloperStats(org: string, window: RangeWindow): Promise<RangeDeveloperRow[]> {
  const sinceMs = dayMs(window.since);
  const untilMs = dayMs(window.until);

  const [reportRows] = await db.execute(
    `SELECT id, status, period_days, created_at, completed_at FROM reports WHERE org = ?`,
    [org],
  ) as [any[], any];
  const measuredDays = measuredDaysInWindow(completedReportWindows(reportRows), window.since, window.until);
  const overlapping = reportRows.filter((r: any) => {
    const [w] = completedReportWindows([r]);
    if (!w) return false;
    const start = w.completedAt.getTime() - Number(w.periodDays) * DAY_MS;
    const end = w.createdAt.getTime();
    return start < end && start < untilMs && end > sinceMs;
  });
  if (overlapping.length === 0) return [];

  const ids = overlapping.map((r: any) => r.id);
  const [devRows] = await db.execute(
    `SELECT ds.github_login, ds.github_name, ds.avatar_url, r.created_at
     FROM developer_stats ds JOIN reports r ON r.id = ds.report_id
     WHERE ds.report_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  ) as [any[], any];
  const people = new Map<string, { name: string; avatar: string; at: number }>();
  for (const d of devRows) {
    const at = new Date(d.created_at).getTime() || 0;
    const prev = people.get(d.github_login);
    if (!prev || at >= prev.at) people.set(d.github_login, { name: d.github_name || '', avatar: d.avatar_url || '', at });
  }

  const [commitRows] = await db.execute(
    `SELECT ca.github_login, ca.repo, ca.lines_added, ca.lines_removed, ca.complexity, ca.type,
            ca.ai_co_authored, ca.maybe_ai, ca.pr_number
     FROM commit_analyses ca
     JOIN (${canonicalCommitIdsSql(ORG_REPORTS)}) one ON one.id = ca.id
     WHERE ca.committed_at >= ? AND ca.committed_at < ?`,
    [org, window.since, window.until],
  ) as [any[], any];

  const [jiraRows] = await db.execute(
    `SELECT ji.github_login, ji.story_points
     FROM jira_issues ji
     JOIN (${canonicalJiraIdsSql()}) one ON one.id = ji.id
     WHERE ji.resolved_at >= ? AND ji.resolved_at < ?`,
    [org, window.since, window.until],
  ) as [any[], any];

  const [prRows] = await db.execute(
    `SELECT github_login, kind, COUNT(*) AS n FROM pr_activity
     WHERE org = ? AND merged_at >= ? AND merged_at < ?
     GROUP BY github_login, kind`,
    [org, window.since, window.until],
  ) as [any[], any];

  const [covRows] = await db.execute(
    `SELECT github_login, since_date, until_date FROM pr_activity_coverage
     WHERE org = ? AND until_date > ? AND since_date < ?`,
    [org, window.since, window.until],
  ) as [any[], any];

  type Acc = {
    commits: number; added: number; removed: number; cx: number; cxN: number; pr: number; ai: number;
    types: Record<string, number>; repos: Set<string>; issues: number; sp: number;
    prs: number; reviews: number; cov: Array<[number, number]>; covSince: string | null;
  };
  const acc = new Map<string, Acc>();
  const get = (login: string): Acc | undefined => {
    if (!people.has(login)) return undefined;
    let a = acc.get(login);
    if (!a) {
      a = { commits: 0, added: 0, removed: 0, cx: 0, cxN: 0, pr: 0, ai: 0, types: {}, repos: new Set(),
            issues: 0, sp: 0, prs: 0, reviews: 0, cov: [], covSince: null };
      acc.set(login, a);
    }
    return a;
  };
  for (const login of people.keys()) get(login);

  for (const c of commitRows) {
    const a = get(c.github_login); if (!a) continue;
    a.commits++;
    a.added += Number(c.lines_added) || 0;
    a.removed += Number(c.lines_removed) || 0;
    if (c.complexity != null) { a.cx += Number(c.complexity); a.cxN++; }
    if (c.pr_number != null) a.pr++;
    if (Number(c.ai_co_authored) || Number(c.maybe_ai)) a.ai++;
    if (c.type) a.types[c.type] = (a.types[c.type] || 0) + 1;
    if (c.repo) a.repos.add(c.repo);
  }
  for (const j of jiraRows) {
    const a = get(j.github_login); if (!a) continue;
    a.issues++;
    a.sp += Number(j.story_points) || 0;
  }
  for (const p of prRows) {
    const a = get(p.github_login); if (!a) continue;
    if (p.kind === 'authored') a.prs = Number(p.n) || 0;
    else if (p.kind === 'reviewed') a.reviews = Number(p.n) || 0;
  }
  for (const c of covRows) {
    const a = get(c.github_login); if (!a) continue;
    a.cov.push([dayMs(c.since_date), dayMs(c.until_date)]);
    const from = c.since_date > window.since ? c.since_date : window.since;
    if (a.covSince == null || from < a.covSince) a.covSince = from;
  }

  const rows: RangeDeveloperRow[] = [];
  for (const [login, a] of acc) {
    const p = people.get(login)!;
    const avgComplexity = a.cxN > 0 ? Math.round((a.cx / a.cxN) * 10) / 10 : 0;
    const prPercentage = a.commits > 0 ? Math.round((a.pr / a.commits) * 100) : 0;
    const aiPercentage = a.commits > 0 ? Math.round((a.ai / a.commits) * 100) : 0;
    const prCoveredDays = unionDayCount(a.cov, sinceMs, untilMs);
    rows.push({
      github_login: login, github_name: p.name, avatar_url: p.avatar,
      total_prs: a.prs, total_commits: a.commits, lines_added: a.added, lines_removed: a.removed,
      avg_complexity: avgComplexity,
      impact_score: computeImpactScore({
        totalCommits: a.commits, totalPRs: a.prs, avgComplexity, prPercentage,
        totalStoryPoints: a.sp, totalJiraIssues: a.issues, totalReviews: a.reviews,
        periodDays: measuredDays, prPeriodDays: prCoveredDays,
      }),
      pr_percentage: prPercentage, ai_percentage: aiPercentage,
      total_jira_issues: a.issues, total_story_points: a.sp, total_reviews: a.reviews,
      type_breakdown: a.types, active_repos: [...a.repos],
      measured_days: measuredDays, pr_covered_days: prCoveredDays, pr_covered_since: a.covSince,
    });
  }
  return rows.sort((x, y) => y.impact_score - x.impact_score || x.github_login.localeCompare(y.github_login));
}

/** GLOOK-63: this developer's commits in the range, one row per commit_sha. */
export async function getRangeCommits(org: string, login: string, window: RangeWindow): Promise<any[]> {
  const [rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.commit_message, ca.pr_number, ca.pr_title,
            ca.type, ca.complexity, ca.risk_level, ca.impact_summary,
            ca.lines_added, ca.lines_removed, ca.committed_at,
            ca.ai_co_authored, ca.ai_tool_name, ca.maybe_ai
     FROM commit_analyses ca
     JOIN (${canonicalCommitIdsSql(ORG_REPORTS, true)}) one ON one.id = ca.id
     WHERE ca.committed_at >= ? AND ca.committed_at < ?
     ORDER BY ca.committed_at DESC`,
    [login, org, window.since, window.until],
  ) as [any[], any];
  return rows;
}

/** GLOOK-63: resolved Jira issues in the range, one row per issue_key; same shape as getJiraIssues. */
export async function getRangeJiraIssues(org: string, login: string | undefined, window: RangeWindow): Promise<any[]> {
  const [rows] = await db.execute(
    `SELECT ji.issue_key, ji.project_key, ji.issue_type, ji.summary, ji.description,
            ji.status, ji.labels, ji.story_points, ji.original_estimate_seconds,
            ji.issue_url, ji.created_at, ji.resolved_at
     FROM jira_issues ji
     JOIN (${canonicalJiraIdsSql()}) one ON one.id = ji.id
     WHERE ji.resolved_at >= ? AND ji.resolved_at < ?${login ? ' AND ji.github_login = ?' : ''}
     ORDER BY ji.resolved_at DESC`,
    login ? [org, window.since, window.until, login] : [org, window.since, window.until],
  ) as [any[], any];
  return rows.map((r: any) => ({
    ...r,
    labels: typeof r.labels === 'string' ? JSON.parse(r.labels || '[]') : (r.labels || []),
    story_points: r.story_points != null ? Number(r.story_points) : null,
  }));
}

/** Report id → its org and range window; null when the report doesn't exist. */
export async function loadReportRangeWindow(
  reportId: string, range: ReportRangeKey,
): Promise<{ org: string; window: RangeWindow } | null> {
  const [rows] = await db.execute(
    `SELECT org, created_at, completed_at FROM reports WHERE id = ?`,
    [reportId],
  ) as [any[], any];
  if (!rows.length) return null;
  return { org: rows[0].org, window: rangeWindow(rows[0], range) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/report-range-db.test.ts src/lib/__tests__/unit/report-range.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/range.ts src/lib/__tests__/unit/report-range-db.test.ts
git commit -m "GLOOK-63: de-duplicated range developer stats and drill-downs"
```

---

### Task 7: Range in `getReport`, `getDevReport` and the API routes

**Files:**
- Modify: `src/lib/report/service.ts:99-145` (`getReport`)
- Modify: `src/lib/report/dev.ts:28,184-208` (`getDevReport`)
- Modify: `src/lib/report/commits.ts`
- Modify: `src/app/api/report/[id]/route.ts`, `src/app/api/report/[id]/dev/[login]/route.ts`, `src/app/api/report/[id]/commits/route.ts`, `src/app/api/report/[id]/jira-issues/route.ts`
- Test: `src/lib/__tests__/unit/report-range-service-db.test.ts`, `src/lib/__tests__/unit/report-range-routes.test.ts`

**Interfaces:**
- Consumes: `ReportRange`, `RangeMeta`, `parseRange`, `rangeWindow`, `getRangeDeveloperStats`, `getRangeCommits`, `getRangeJiraIssues`, `loadReportRangeWindow` (Tasks 5–6).
- Produces:
  - `getReport(id: string, range: ReportRange = 'current'): Promise<{ report; developers; range?: RangeMeta }>`
  - `getDevReport(reportId: string, login: string, range: ReportRange = 'current')`. In a range it returns the same object plus `range: RangeMeta`. `developer`, `allDevelopers` and `commits` become range figures; `developer` keeps the current report's `cc_total_cost`, `cc_requests` and `cc_skills_used`.
  - `getReportCommits(reportId: string, login: string, range: ReportRange = 'current')`
  - Every listed route accepts `?range=` and returns 400 `{ error: 'Invalid range' }` on an invalid value.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/report-range-service-db.test.ts`:

```ts
// GLOOK-63: getReport/getDevReport range overlay through the real SQLite driver.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let getReport: any;
let getDevReport: any;
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-range-svc-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ getReport } = await import('@/lib/report/service'));
  ({ getDevReport } = await import('@/lib/report/dev'));
  for (const [id, created, completed] of [['r1', '2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z'], ['r2', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z']]) {
    await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, 'acme', 14, 'completed', ?, ?)`, [id, created, completed]);
  }
  // carol only exists in the older r1; alice in both, with spend on r2.
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, total_commits, impact_score) VALUES ('r1', 'carol', 'Carol', 1, 1)`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, total_commits, impact_score) VALUES ('r1', 'alice', 'Alice', 1, 1)`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login, github_name, total_commits, impact_score, cc_total_cost, cc_requests, cc_skills_used) VALUES ('r2', 'alice', 'Alice', 1, 1, 250, 9, 4)`);
  await db.execute(`INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, lines_added, lines_removed, committed_at) VALUES ('r1', 'alice', 'app', 's1', 1, 0, '2026-09-10T10:00:00Z')`);
  await db.execute(`INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, lines_added, lines_removed, committed_at) VALUES ('r2', 'alice', 'app', 's2', 1, 0, '2026-09-30T10:00:00Z')`);
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});

it('current report: no range block and today\'s developer rows', async () => {
  const res = await getReport('r2');
  expect(res.range).toBeUndefined();
  expect(res.developers.map((d: any) => d.github_login)).toEqual(['alice']);
});

it('90d: range figures, current-report spend kept, absentee gets no cc fields', async () => {
  const res = await getReport('r2', '90d');
  expect(res.range).toMatchObject({ key: '90d', until: '2026-10-04', days: 90, prCoveredSince: null });
  expect(res.range.measuredDays).toBeGreaterThan(0);
  const alice = res.developers.find((d: any) => d.github_login === 'alice');
  const carol = res.developers.find((d: any) => d.github_login === 'carol');
  expect(alice).toMatchObject({ total_commits: 2, cc_total_cost: 250, cc_requests: 9 });
  expect(carol).toBeDefined();
  expect(carol).not.toHaveProperty('cc_total_cost');
});

it('getDevReport 90d: range KPIs, range commits, percentiles over range developers, spend from current', async () => {
  const res = await getDevReport('r2', 'alice', '90d');
  expect(res.developer).toMatchObject({ total_commits: 2, cc_total_cost: 250, cc_skills_used: 4 });
  expect(res.commits.map((c: any) => c.commit_sha)).toEqual(['s2', 's1']);
  expect(res.allDevelopers.map((d: any) => d.github_login).sort()).toEqual(['alice', 'carol']);
  expect(res.range.key).toBe('90d');
});

it('getDevReport current: unchanged (one report\'s commits, no range)', async () => {
  const res = await getDevReport('r2', 'alice');
  expect(res.commits.map((c: any) => c.commit_sha)).toEqual(['s2']);
  expect(res.range).toBeUndefined();
});
```

Create `src/lib/__tests__/unit/report-range-routes.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/service', () => ({
  getReport: jest.fn(async () => ({ report: { id: 'r1', org: 'acme' }, developers: [] })),
  deleteReport: jest.fn(),
  ReportNotFoundError: class ReportNotFoundError extends Error {},
}));
jest.mock('@/lib/report/dev', () => ({
  getDevReport: jest.fn(async () => ({ report: { id: 'r1', org: 'acme' }, developer: { github_login: 'alice' }, allDevelopers: [], models: [] })),
  DeveloperNotFoundError: class DeveloperNotFoundError extends Error {},
}));
jest.mock('@/lib/report/commits', () => ({ getReportCommits: jest.fn(async () => []) }));
jest.mock('@/lib/jira', () => ({ getJiraIssues: jest.fn(async () => []) }));
jest.mock('@/lib/report/range', () => ({
  ...jest.requireActual('@/lib/report/range-options'),
  loadReportRangeWindow: jest.fn(async () => ({ org: 'acme', window: { since: 'a', until: 'b', days: 90 } })),
  getRangeJiraIssues: jest.fn(async () => [{ issue_key: 'J-1' }]),
}));
jest.mock('@/lib/auth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({})),
  buildCostVisibility: jest.fn(async () => ({ canSeeCost: () => true })),
  stripDevCost: (d: any) => d,
  stripCostFields: (d: any) => d,
  stripModelCost: (m: any) => m,
  costCacheHeaders: () => ({}),
}));

import { GET as reportGET } from '@/app/api/report/[id]/route';
import { GET as devGET } from '@/app/api/report/[id]/dev/[login]/route';
import { GET as commitsGET } from '@/app/api/report/[id]/commits/route';
import { GET as jiraGET } from '@/app/api/report/[id]/jira-issues/route';
import { getReport } from '@/lib/report/service';
import { getDevReport } from '@/lib/report/dev';
import { getReportCommits } from '@/lib/report/commits';
import { getJiraIssues } from '@/lib/jira';
import { getRangeJiraIssues } from '@/lib/report/range';

const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: 'r1', login: 'alice', ...extra }) });
const req = (url: string) => {
  const r = new Request(`http://localhost${url}`) as any;
  r.nextUrl = new URL(r.url);
  return r;
};

beforeEach(() => jest.clearAllMocks());

it.each([
  ['report', () => reportGET(req('/api/report/r1?range=all'), p() as any)],
  ['dev', () => devGET(req('/api/report/r1/dev/alice?range=90D'), p() as any)],
  ['commits', () => commitsGET(req('/api/report/r1/commits?login=alice&range=x'), p() as any)],
  ['jira', () => jiraGET(req('/api/report/r1/jira-issues?login=alice&range=1y'), p() as any)],
])('%s route returns 400 on an invalid range', async (_n, call) => {
  const res = await call();
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'Invalid range' });
});

it('passes current when range is absent and the value when present', async () => {
  await reportGET(req('/api/report/r1'), p() as any);
  expect(getReport).toHaveBeenLastCalledWith('r1', 'current');
  await reportGET(req('/api/report/r1?range=12m'), p() as any);
  expect(getReport).toHaveBeenLastCalledWith('r1', '12m');
  await devGET(req('/api/report/r1/dev/alice?range=90d'), p() as any);
  expect(getDevReport).toHaveBeenLastCalledWith('r1', 'alice', '90d');
  await commitsGET(req('/api/report/r1/commits?login=alice&range=90d'), p() as any);
  expect(getReportCommits).toHaveBeenLastCalledWith('r1', 'alice', '90d');
});

it('jira-issues uses the per-report query for current and the range query otherwise', async () => {
  await jiraGET(req('/api/report/r1/jira-issues?login=alice'), p() as any);
  expect(getJiraIssues).toHaveBeenCalledWith('r1', 'alice');
  const res = await jiraGET(req('/api/report/r1/jira-issues?login=alice&range=90d'), p() as any);
  expect(getRangeJiraIssues).toHaveBeenCalledWith('acme', 'alice', { since: 'a', until: 'b', days: 90 });
  expect(await res.json()).toEqual([{ issue_key: 'J-1' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/unit/report-range-service-db.test.ts src/lib/__tests__/unit/report-range-routes.test.ts`
Expected: FAIL. `res.range` is undefined for `90d`, and the routes return 200.

- [ ] **Step 3: Implement the service overlay**

In `src/lib/report/service.ts` add the import:

```ts
import { rangeWindow, getRangeDeveloperStats, type ReportRange, type RangeMeta } from './range';
```

Change the signature to `export async function getReport(id: string, range: ReportRange = 'current')` and replace the final `return { report: reportRows[0], developers };` with:

```ts
  if (range === 'current') {
    return { report: reportRows[0], developers };
  }

  // GLOOK-63: recompute every developer figure over the range; spend stays on the current report.
  const window = rangeWindow(reportRows[0], range);
  const rows = await getRangeDeveloperStats(reportRows[0].org, window);
  const current = new Map(developers.map((d: any) => [d.github_login, d]));
  const rangeDevelopers = rows.map((r) => {
    const cur: any = current.get(r.github_login);
    return cur ? { ...r, cc_total_cost: cur.cc_total_cost, cc_requests: cur.cc_requests } : { ...r };
  });
  const covered = rows.map(r => r.pr_covered_since).filter((s): s is string => s != null).sort();
  const meta: RangeMeta = {
    key: range, since: window.since, until: window.until, days: window.days,
    measuredDays: rows[0]?.measured_days ?? 0,
    prCoveredSince: covered[0] ?? null,
  };
  return { report: reportRows[0], developers: rangeDevelopers, range: meta };
```

In `src/lib/report/dev.ts` add the import:

```ts
import { rangeWindow, getRangeDeveloperStats, getRangeCommits, type ReportRange, type RangeMeta } from './range';
```

Change the signature to `export async function getDevReport(reportId: string, login: string, range: ReportRange = 'current')`. Then turn the final `return { ... }` into `const base = { ... };` (identical contents) followed by:

```ts
  if (range === 'current') return base;

  // GLOOK-63: KPIs, percentiles and commit list over the range. Timeline, unmerged work, the LLM
  // summary and Claude Code spend/models/skills stay on the current report.
  const window = rangeWindow(reportRows[0], range);
  const rows = await getRangeDeveloperStats(org, window);
  const me = rows.find(r => r.github_login === login);
  if (!me) throw new DeveloperNotFoundError(login);
  const cur = base.developer;
  const covered = rows.map(r => r.pr_covered_since).filter((s): s is string => s != null).sort();
  const meta: RangeMeta = {
    key: range, since: window.since, until: window.until, days: window.days,
    measuredDays: me.measured_days, prCoveredSince: me.pr_covered_since ?? covered[0] ?? null,
  };
  return {
    ...base,
    developer: { ...me, cc_total_cost: cur.cc_total_cost, cc_requests: cur.cc_requests, cc_skills_used: cur.cc_skills_used },
    allDevelopers: rows,
    commits: await getRangeCommits(org, login, window),
    range: meta,
  };
```

Replace `src/lib/report/commits.ts` with:

```ts
import db from '../db/index';
import { getRangeCommits, loadReportRangeWindow, type ReportRange } from './range';

export async function getReportCommits(reportId: string, login: string, range: ReportRange = 'current') {
  if (range !== 'current') {
    const ctx = await loadReportRangeWindow(reportId, range);
    return ctx ? getRangeCommits(ctx.org, login, ctx.window) : [];
  }
  const [rows] = await db.execute(
    `SELECT commit_sha, repo, commit_message, type, complexity, risk_level,
            lines_added, lines_removed, committed_at
     FROM commit_analyses
     WHERE report_id = ? AND github_login = ?
     ORDER BY committed_at DESC`,
    [reportId, login],
  ) as [any[], any];
  return rows;
}
```

- [ ] **Step 4: Implement the routes**

`src/app/api/report/[id]/route.ts`: add `import { parseRange } from '@/lib/report/range-options';`. In `getHandler` before `try`:

```ts
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  if (!range) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
```

and change the call to `await getReport(id, range)`.

`src/app/api/report/[id]/dev/[login]/route.ts`: same import and two lines before `try`; call `getDevReport(id, login, range)`.

`src/app/api/report/[id]/commits/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getReportCommits } from '@/lib/report/commits';
import { parseRange } from '@/lib/report/range-options';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const login = search.get('login');
  if (!login) return NextResponse.json({ error: 'login is required' }, { status: 400 });
  const range = parseRange(search.get('range'));
  if (!range) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  return NextResponse.json(await getReportCommits(id, login, range));
}

export const GET = withRequestLog(getHandler);
```

`src/app/api/report/[id]/jira-issues/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getJiraIssues } from '@/lib/jira';
import { parseRange, loadReportRangeWindow, getRangeJiraIssues } from '@/lib/report/range';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const login = search.get('login') || undefined;
  const range = parseRange(search.get('range'));
  if (!range) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  if (range === 'current') return NextResponse.json(await getJiraIssues(id, login));
  const ctx = await loadReportRangeWindow(id, range);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await getRangeJiraIssues(ctx.org, login, ctx.window));
}

export const GET = withRequestLog(getHandler);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/report-range-service-db.test.ts src/lib/__tests__/unit/report-range-routes.test.ts src/lib/__tests__/unit/report-service.test.ts src/lib/__tests__/unit/report-dev.test.ts src/lib/__tests__/unit/cc-breakdown-dev-route.test.ts src/lib/__tests__/unit/report-cost-gating.test.ts src/lib/__tests__/unit/logger-enforcement.test.ts src/lib/__tests__/unit/commit-dedupe-db.test.ts`
Expected: PASS. The existing mock-sequenced `report-service`/`report-dev` tests are untouched, because the current path issues the same queries in the same order.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/service.ts src/lib/report/dev.ts src/lib/report/commits.ts "src/app/api/report/[id]/route.ts" "src/app/api/report/[id]/dev/[login]/route.ts" "src/app/api/report/[id]/commits/route.ts" "src/app/api/report/[id]/jira-issues/route.ts" src/lib/__tests__/unit/report-range-service-db.test.ts src/lib/__tests__/unit/report-range-routes.test.ts
git commit -m "GLOOK-63: range overlay in report services and API routes"
```

---

### Task 8: Shared range picker components; org page uses them

**Files:**
- Move: `src/app/report/[id]/org/chart-range.ts` → `src/components/range/chart-range.ts` (`git mv`, content unchanged)
- Create: `src/components/range/RangePicker.tsx`, `src/components/range/CurrentReportLabel.tsx`
- Modify: `src/app/report/[id]/org/page.tsx:18`, `:255-268`
- Modify: `src/lib/__tests__/unit/org-chart-range.test.ts:1` (import path)
- Test: `src/lib/__tests__/unit/range-picker.test.tsx`

**Interfaces:**
- Consumes: none.
- Produces:
  - `RangePicker<T extends string>(props: { options: readonly T[]; labels: Record<T, string>; value: T; onChange: (v: T) => void; ariaLabel: string })`, the default export of `@/components/range/RangePicker`.
  - `CurrentReportLabel()`, the default export of `@/components/range/CurrentReportLabel`. It renders the text "Current report".
  - `@/components/range/chart-range` exports exactly what the old org `chart-range.ts` did.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/range-picker.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RangePicker from '@/components/range/RangePicker';
import CurrentReportLabel from '@/components/range/CurrentReportLabel';
import { RANGE_OPTIONS, RANGE_LABELS } from '@/lib/report/range-options';
import { CHART_RANGES } from '@/components/range/chart-range';

it('renders one pressed button per option and reports clicks', () => {
  const onChange = jest.fn();
  render(<RangePicker options={RANGE_OPTIONS} labels={RANGE_LABELS} value="90d" onChange={onChange} ariaLabel="Date range" />);
  expect(screen.getByRole('group', { name: 'Date range' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Past 90 days' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Current report' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Past 12 months' }));
  expect(onChange).toHaveBeenCalledWith('12m');
});

it('the org chart options are unchanged after the move', () => {
  expect(CHART_RANGES).toEqual(['90d', '12m', 'all']);
});

it('labels per-report sections', () => {
  render(<CurrentReportLabel />);
  expect(screen.getByText('Current report')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/range-picker.test.tsx`
Expected: FAIL, "Cannot find module '@/components/range/RangePicker'".

- [ ] **Step 3: Implement**

```bash
mkdir -p src/components/range
git mv "src/app/report/[id]/org/chart-range.ts" src/components/range/chart-range.ts
```

Create `src/components/range/RangePicker.tsx`:

```tsx
'use client';

export interface RangePickerProps<T extends string> {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Segmented range control shared by the org charts (90d/12m/all) and the Team/Engineer pages (GLOOK-63). */
export default function RangePicker<T extends string>({ options, labels, value, onChange, ariaLabel }: RangePickerProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-md border border-gray-800 p-0.5 no-print">
      {options.map(o => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`px-2.5 py-1 text-xs rounded transition-colors ${value === o ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}
```

Create `src/components/range/CurrentReportLabel.tsx`:

```tsx
/** GLOOK-63: marks a section that stays on the current report while a date range is selected. */
export default function CurrentReportLabel() {
  return (
    <span className="ml-2 inline-flex items-center rounded border border-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
      Current report
    </span>
  );
}
```

In `src/app/report/[id]/org/page.tsx` change line 18 to:

```ts
import { CHART_RANGES, CHART_RANGE_LABELS, chartRangeDays, chartTicks, weekTickFormatter, type ChartRange } from '@/components/range/chart-range';
import RangePicker from '@/components/range/RangePicker';
```

and replace the `<div role="group" aria-label="Chart range" ...> ... </div>` block (~L255-268) with:

```tsx
            <RangePicker options={CHART_RANGES} labels={CHART_RANGE_LABELS} value={range} onChange={setRange} ariaLabel="Chart range" />
```

In `src/lib/__tests__/unit/org-chart-range.test.ts` change the import to `from '@/components/range/chart-range'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/range-picker.test.tsx src/lib/__tests__/unit/org-chart-range.test.ts src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/range "src/app/report/[id]/org/page.tsx" src/lib/__tests__/unit/org-chart-range.test.ts src/lib/__tests__/unit/range-picker.test.tsx
git commit -m "GLOOK-63: move the range picker to src/components/range"
```

---

### Task 9: Team page range

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`
- Modify: `src/app/report/[id]/team/team-table.tsx:8-24`
- Modify: `src/app/report/[id]/team/dev-table.tsx` (props L35-44; L216-245; `CommitCountWithTooltip` L322-358; `JiraCountWithTooltip` L415-450)
- Test: `src/lib/__tests__/unit/team-page-range.test.tsx`, `src/lib/__tests__/unit/dev-table-range.test.tsx`

**Interfaces:**
- Consumes: `RANGE_OPTIONS`, `RANGE_LABELS`, `ReportRange`, `RangeMeta`, `withRange`, `rangeNotes` (Task 5); `RangePicker`, `CurrentReportLabel` (Task 8); the `range` block of `/api/report/[id]` (Task 7); `aggregateTeams(..., periodDays)` (Task 1).
- Produces: `TeamTable` prop `periodDays?: number`; `DevTable` prop `range?: ReportRange` (default `'current'`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/team-page-range.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TeamSummaryPage from '@/app/report/[id]/team/page';

const mockKeys: string[] = [];
let mockSwrData: Record<string, unknown> = {};
let mockUrl: Record<string, unknown> = {};
const mockTableProps: { team?: any; dev?: any } = {};

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    if (key) mockKeys.push(key);
    return { data: key ? mockSwrData[key.split('?team=')[0].includes('team-pulse') ? 'pulse' : key] : undefined, isLoading: false, error: undefined };
  },
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'r1' }), useRouter: () => ({ push: () => undefined }) }));
jest.mock('@/lib/url-state', () => ({
  useUrlState: (s: { key: string; default: unknown }) => [s.key in mockUrl ? mockUrl[s.key] : s.default, () => undefined],
  useUrlBatch: () => (fn: () => void) => fn(),
}));
jest.mock('@/app/chat-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/IntegrityBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/runs/DataFreshness', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ProjectsCard', () => ({ __esModule: true, default: (p: any) => <div>{p.subtitle}</div> }));
jest.mock('@/components/PageHeader', () => ({ __esModule: true, default: (p: any) => <div>{p.meta}{p.actions}{p.children}</div> }));
jest.mock('@/app/report/[id]/team/team-table', () => ({ __esModule: true, default: (p: any) => { mockTableProps.team = p; return null; } }));
jest.mock('@/app/report/[id]/team/dev-table', () => ({ __esModule: true, default: (p: any) => { mockTableProps.dev = p; return null; } }));

const REPORT = { id: 'r1', org: 'acme', period_days: 14, status: 'completed', created_at: '2026-10-27T09:00:00Z', completed_at: '2026-10-27T10:00:00Z', run_metadata: null };
const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 1, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, type_breakdown: {}, active_repos: [] };

beforeEach(() => {
  mockKeys.length = 0;
  mockUrl = {};
  mockSwrData = {
    '/api/report/r1': { report: REPORT, developers: [DEV] },
    '/api/report/r1?range=12m': {
      report: REPORT, developers: [DEV],
      range: { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 212, prCoveredSince: '2026-03-03' },
    },
    '/api/teams?org=acme': [{ id: 't1', name: 'Core', color: '#fff', members: ['alice'] }],
    pulse: { summary: 'Pulse text', health: { activeRatio: '1/1', trending: 'flat', trendDirection: 'stable' } },
  };
});

it('Current report sends no range parameter and shows no notes or labels', () => {
  mockUrl = { team: 'Core' };
  render(<TeamSummaryPage />);
  expect(mockKeys).toContain('/api/report/r1');
  expect(mockKeys.some(k => k.includes('range='))).toBe(false);
  expect(screen.getByRole('button', { name: 'Current report' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText(/days measured/)).toBeNull();
  expect(mockTableProps.dev.range).toBe('current');
});

it('12 months fetches the range, shows the measured-days and PR notes, and labels per-report sections', () => {
  mockUrl = { range: '12m', team: 'Core', view: 'individuals' };
  render(<TeamSummaryPage />);
  expect(mockKeys).toContain('/api/report/r1?range=12m');
  expect(screen.getByText('212 of 365 days measured')).toBeTruthy();
  expect(screen.getByText('PR and review data from Mar 3')).toBeTruthy();
  // Team Pulse stays on the current report and says so.
  expect(screen.getByText(/Team Pulse: Core/).parentElement!.textContent).toContain('Current report');
  expect(mockTableProps.dev.range).toBe('12m');
});

it('the team table aggregates with the range\'s measured days', () => {
  mockUrl = { range: '12m', view: 'teams' };
  render(<TeamSummaryPage />);
  expect(mockTableProps.team.periodDays).toBe(212);
});
```

Create `src/lib/__tests__/unit/dev-table-range.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DevTable from '@/app/report/[id]/team/dev-table';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
jest.mock('@/lib/url-state', () => ({ useUrlState: (s: { default: unknown }) => [s.default, () => undefined] }));

const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 37, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0, type_breakdown: {}, active_repos: [] };

it('commit drill-down carries the range, and caches per range', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => [] }));
  (global as any).fetch = fetchMock;
  const { rerender } = render(<DevTable developers={[DEV]} reportId="r1" org="acme" filterLogins={new Set()} range="90d" />);
  await act(async () => { fireEvent.mouseEnter(screen.getByText('37')); });
  expect(fetchMock).toHaveBeenLastCalledWith('/api/report/r1/commits?login=alice&range=90d');
  rerender(<DevTable developers={[DEV]} reportId="r1" org="acme" filterLogins={new Set()} range="current" />);
  await act(async () => { fireEvent.mouseEnter(screen.getByText('37')); });
  expect(fetchMock).toHaveBeenLastCalledWith('/api/report/r1/commits?login=alice');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/unit/team-page-range.test.tsx src/lib/__tests__/unit/dev-table-range.test.tsx`
Expected: FAIL. There is no "Current report" button, and the drill-down URL has no range.

- [ ] **Step 3: Implement `dev-table.tsx` and `team-table.tsx`**

`dev-table.tsx`: add the import `import { withRange, type ReportRange } from '@/lib/report/range-options';`. Add `range?: ReportRange;` to `DevTableProps`, and destructure it as `range = 'current'` in `DevTable`. Pass `range={range}` to both `<CommitCountWithTooltip ...>` and `<JiraCountWithTooltip ...>`. In each tooltip's props, add `range` to the destructuring and `range: ReportRange;` to the type. Then:

In `CommitCountWithTooltip`:
```ts
    const key = `${reportId}:${range}:${login}`;
    ...
      const res = await fetch(withRange(`/api/report/${reportId}/commits?login=${encodeURIComponent(login)}`, range));
```
In `JiraCountWithTooltip`:
```ts
    const key = `jira:${reportId}:${range}:${login}`;
    ...
      const res = await fetch(withRange(`/api/report/${reportId}/jira-issues?login=${encodeURIComponent(login)}`, range));
```

`team-table.tsx`: add `periodDays?: number;` to `TeamTableProps`. Change the signature to `({ developers, teams, reportId, periodDays = 14 }: TeamTableProps)` and the memo to:

```ts
  const rows: TeamRow[] = useMemo(() => aggregateTeams(developers, teams, periodDays), [developers, teams, periodDays]);
```

- [ ] **Step 4: Implement the Team page**

In `src/app/report/[id]/team/page.tsx`, add the imports:

```ts
import RangePicker from '@/components/range/RangePicker';
import CurrentReportLabel from '@/components/range/CurrentReportLabel';
import { RANGE_OPTIONS, RANGE_LABELS, withRange, rangeNotes, type ReportRange, type RangeMeta } from '@/lib/report/range-options';
```

Replace the main-report fetch block with:

```ts
  // GLOOK-63: the date range. Current report sends no range param (today's request, unchanged).
  const [range, setRange] = useUrlState<ReportRange>({
    key: 'range',
    type: 'enum',
    values: RANGE_OPTIONS,
    default: 'current',
    history: 'replace',
    scroll: false,
  });

  // Main report data — keepPreviousData stops the tables blanking while a new range loads.
  const { data: reportData, isLoading } = useSWR(withRange(`/api/report/${params.id}`, range), { keepPreviousData: true });
  const developers: Developer[] = reportData?.developers ?? [];
  const activeReport: Report | null = reportData?.report ?? null;
  const rangeMeta: RangeMeta | null = range === 'current' ? null : (reportData?.range ?? null);
  const notes = rangeNotes(rangeMeta);
  const periodLabel = range === 'current' ? `${activeReport?.period_days ?? ''}d` : range;
```

Change both export functions' filename and title to use `periodLabel`. In `exportCsv`:

```ts
    a.download = `glooker_${report.org}_${periodLabel}_${new Date(report.created_at).toISOString().slice(0, 10)}.csv`;
```

and in `exportGoogleSheet`:

```ts
    const title = encodeURIComponent(`Glooker: ${report.org} (${periodLabel}) - ${new Date(report.created_at).toLocaleDateString()}`);
```

Change the `PageHeader` `meta` to:

```tsx
          meta={<>{range === 'current' ? `last ${activeReport.period_days} days` : RANGE_LABELS[range]} &middot; {developers.length} developers</>}
```

Insert directly above `{/* Tabs */}`:

```tsx
      {/* GLOOK-63: date range */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <RangePicker options={RANGE_OPTIONS} labels={RANGE_LABELS} value={range} onChange={setRange} ariaLabel="Date range" />
        {notes.map(n => <span key={n} className="text-xs text-gray-500">{n}</span>)}
      </div>
```

Pass the label into the per-report sections:

```tsx
        <TeamPulseCard
          reportId={params.id}
          teamName={selectedTeamName}
          org={activeReport.org}
          periodDays={activeReport.period_days}
          currentReportOnly={range !== 'current'}
        />
```

```tsx
            subtitle={`${selectedTeamName} · ${activeReport!.period_days}d${range !== 'current' ? ' · Current report' : ''}`}
```

```tsx
      <DevTable
        developers={developers}
        reportId={params.id}
        org={activeReport?.org ?? ''}
        filterLogins={filterLogins}
        range={range}
      />
```

```tsx
        <TeamTable
          developers={developers}
          teams={teams}
          reportId={params.id}
          periodDays={rangeMeta ? rangeMeta.measuredDays : activeReport.period_days}
        />
```

In `TeamPulseCard`, add `currentReportOnly` to the props (`currentReportOnly?: boolean`) and change the title span to:

```tsx
          <span className="text-sm font-semibold text-white">Team Pulse: {teamName}{currentReportOnly && <CurrentReportLabel />}</span>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/team-page-range.test.tsx src/lib/__tests__/unit/dev-table-range.test.tsx src/lib/__tests__/unit/team-aggregator.test.ts && npx tsc --noEmit`
Expected: PASS. `page.tsx` still exports only `default`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/report/[id]/team/page.tsx" "src/app/report/[id]/team/team-table.tsx" "src/app/report/[id]/team/dev-table.tsx" src/lib/__tests__/unit/team-page-range.test.tsx src/lib/__tests__/unit/dev-table-range.test.tsx
git commit -m "GLOOK-63: Team page date range"
```

---

### Task 10: Engineer page range

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx` (L103-170 data + weeks; header ~L198-200; usage card ~L257; summary header ~L359)
- Modify: `src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx:27` (url-state mock returns each schema's default)
- Test: `src/lib/__tests__/unit/dev-page-range.test.tsx`

**Interfaces:**
- Consumes: `RANGE_OPTIONS`, `RANGE_LABELS`, `ReportRange`, `RangeMeta`, `withRange`, `rangeNotes` (Task 5); `RangePicker`, `CurrentReportLabel` (Task 8); the `range` block of `/api/report/[id]/dev/[login]` (Task 7); `weekDomainEndingAt(anchor, days)` (existing).
- Produces: none for later tasks.

- [ ] **Step 1: Write the failing test**

In `src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx` replace line 27 with:

```ts
jest.mock('@/lib/url-state', () => ({ useUrlState: (s: { default: unknown }) => [s.default, () => undefined] }));
```

Create `src/lib/__tests__/unit/dev-page-range.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { weekDomainEndingAt } from '@/components/charts/chart-format';
import DevDetailPage from '@/app/report/[id]/dev/[login]/page';

const mockKeys: string[] = [];
const mockWeeks: string[][] = [];
let mockSwrData: Record<string, unknown> = {};
let mockRange: string = 'current';

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => { if (key) mockKeys.push(key); return { data: key ? mockSwrData[key] : undefined, isLoading: false, error: undefined }; },
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'r1', login: 'alice' }), useRouter: () => ({ push: () => undefined }) }));
jest.mock('@/lib/url-state', () => ({
  useUrlState: (s: { key: string; default: unknown }) => [s.key === 'range' ? mockRange : s.default, () => undefined],
}));
jest.mock('@/components/Breadcrumb', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/report/[id]/dev/[login]/usage-card', () => ({ ClaudeCodeUsageCard: () => <div>Claude Code usage</div> }));
jest.mock('@/components/charts/timeline-chart', () => ({ TimelineChart: (p: { weeks: string[] }) => { mockWeeks.push(p.weeks); return null; } }));
jest.mock('@/components/charts/lines-changed-chart', () => ({ LinesChangedChart: () => null }));
jest.mock('@/components/charts/stacked-types-chart', () => ({ StackedTypesChart: () => null }));
jest.mock('@/components/charts/commit-type-donut', () => ({ CommitTypeDonut: () => null }));

const ANCHOR = '2026-10-26';
const REPORT = { id: 'r1', org: 'acme', period_days: 14, status: 'completed', created_at: '2026-10-27T09:00:00Z', completed_at: '2026-10-27T10:00:00Z' };
const DEV = { github_login: 'alice', github_name: 'Alice', avatar_url: '', total_prs: 1, total_commits: 5, lines_added: 1, lines_removed: 0, avg_complexity: 1, impact_score: 1, pr_percentage: 0, ai_percentage: 0, total_jira_issues: 0, total_reviews: 0, type_breakdown: {}, active_repos: [] };
const TIMELINE = [{ week: '2026-10-19', commits: 1, prs: 1, avgLinesPerPr: 1, linesAdded: 1, linesRemoved: 0, avgComplexity: 1, aiPercent: 0, types: {} }, { week: ANCHOR, commits: 1, prs: 0, avgLinesPerPr: 0, linesAdded: 1, linesRemoved: 0, avgComplexity: 1, aiPercent: 0, types: {} }];
const body = (extra = {}) => ({ report: REPORT, developer: DEV, allDevelopers: [DEV], commits: [], timeline: TIMELINE, coveredWeeks: [], anchorWeek: ANCHOR, ...extra });

beforeEach(() => {
  mockKeys.length = 0; mockWeeks.length = 0;
  mockSwrData = {
    '/api/report/r1/dev/alice': body(),
    '/api/report/r1/dev/alice?range=12m': body({ range: { key: '12m', since: '2025-10-28', until: '2026-10-28', days: 365, measuredDays: 365, prCoveredSince: null } }),
    '/api/report/r1/dev/alice/summary': { summary: 'Good work', badges: [] },
  };
});

it('Current report: no range param, 90-day chart window, no labels', () => {
  mockRange = 'current';
  render(<DevDetailPage />);
  expect(mockKeys.some(k => k.includes('range='))).toBe(false);
  expect(mockWeeks[0]).toEqual(weekDomainEndingAt(ANCHOR, 90));
  expect(screen.queryAllByText('Current report').filter(e => e.tagName === 'SPAN')).toHaveLength(0);
});

it('12 months: range fetch, 12-month chart window, notes, and per-report sections labelled', () => {
  mockRange = '12m';
  render(<DevDetailPage />);
  expect(mockKeys).toContain('/api/report/r1/dev/alice?range=12m');
  expect(mockKeys).toContain('/api/report/r1/dev/alice/summary'); // summary stays per report
  expect(mockWeeks[0]).toEqual(weekDomainEndingAt(ANCHOR, 365));
  expect(screen.getByText('No PR and review data in this range')).toBeTruthy();
  // Performance Summary + Claude Code usage are both labelled.
  expect(screen.getAllByText('Current report').filter(e => e.tagName === 'SPAN').length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/unit/dev-page-range.test.tsx src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx`
Expected: FAIL on the 12-month case (no range key; 90-day weeks).

- [ ] **Step 3: Implement**

In `src/app/report/[id]/dev/[login]/page.tsx` add the imports:

```ts
import { useUrlState } from '@/lib/url-state';
import RangePicker from '@/components/range/RangePicker';
import CurrentReportLabel from '@/components/range/CurrentReportLabel';
import { RANGE_OPTIONS, RANGE_LABELS, withRange, rangeNotes, type ReportRange, type RangeMeta } from '@/lib/report/range-options';
```

At the top of `DevDetailPage`, after `useState` lines:

```ts
  // GLOOK-63: date range; Current report sends no range param.
  const [range, setRange] = useUrlState<ReportRange>({
    key: 'range',
    type: 'enum',
    values: RANGE_OPTIONS,
    default: 'current',
    history: 'replace',
    scroll: false,
  });
```

Replace the main dev fetch:

```ts
  const { data: devData, isLoading, error: devError } = useSWR(
    withRange(`/api/report/${params.id}/dev/${params.login}`, range),
    { keepPreviousData: true },
  );
```

After `const anchorWeek ...` add:

```ts
  const rangeMeta: RangeMeta | null = range === 'current' ? null : (devData?.range ?? null);
  const notes = rangeNotes(rangeMeta);
```

Change the Jira fetch key to:

```ts
    hasJira ? withRange(`/api/report/${params.id}/jira-issues?login=${params.login}`, range) : null,
```

Change the week domain:

```ts
  // GLOOK-63: Current report and 90 days keep today's 90-day view; 12 months shows 12 months.
  const weeks = weekDomainEndingAt(anchorWeek, range === '12m' ? 365 : 90);
```

In the header subtitle, replace `{report.period_days} days` with `{range === 'current' ? `${report.period_days} days` : RANGE_LABELS[range]}`. Directly after the header's closing `</div>` (the `bg-gray-900 rounded-xl p-6 mb-6` card), insert:

```tsx
      <div className="flex flex-wrap items-center gap-3 mb-4 no-print">
        <RangePicker options={RANGE_OPTIONS} labels={RANGE_LABELS} value={range} onChange={setRange} ariaLabel="Date range" />
        {notes.map(n => <span key={n} className="text-xs text-gray-500">{n}</span>)}
      </div>
```

Wrap the `<ClaudeCodeUsageCard ... />` element as:

```tsx
      {range !== 'current' && (
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Claude Code<CurrentReportLabel /></p>
      )}
      <ClaudeCodeUsageCard ... />
```

(keep its props unchanged), and change the Performance Summary header to:

```tsx
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Performance Summary{range !== 'current' && <CurrentReportLabel />}</p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/dev-page-range.test.tsx src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx src/lib/__tests__/unit/dev-usage-card.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/report/[id]/dev/[login]/page.tsx" src/lib/__tests__/unit/dev-page-range.test.tsx src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx
git commit -m "GLOOK-63: Engineer page date range"
```

---

### Task 11: PR backfill script and docs

**Files:**
- Create: `src/lib/pr-activity/backfill.ts`
- Create: `scripts/backfill-prs.ts`
- Modify: `package.json` (`scripts`)
- Modify: `CLAUDE.md` (Commands; Key architectural decisions)
- Test: `src/lib/__tests__/unit/pr-backfill-db.test.ts`

**Interfaces:**
- Consumes: `getGitHubProvider().fetchMergedPRs` / `.countReviewedPRs` with `until` (Task 3); `upsertPrActivity`, `recordPrCoverage`, `hasPrCoverage` (Task 2).
- Produces:
  - `monthSlices(months: number, now: Date): Array<{ since: string; until: string }>`: the last `months` complete calendar months, oldest first, `until` exclusive.
  - `backfillPrs(opts: { org: string; months: number; now?: Date; log?: (m: string) => void }): Promise<BackfillResult>`
  - `interface BackfillResult { done: number; skipped: number; failed: Array<{ login: string; since: string; until: string; error: string }> }`
  - `npm run backfill:prs -- --org <org> --months 12`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/pr-backfill-db.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
const mockFetchMergedPRs = jest.fn();
const mockCountReviewedPRs = jest.fn();
jest.mock('@/lib/github', () => ({
  getGitHubProvider: () => ({ fetchMergedPRs: mockFetchMergedPRs, countReviewedPRs: mockCountReviewedPRs }),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let backfill: typeof import('@/lib/pr-activity/backfill');
let store: typeof import('@/lib/pr-activity/store');
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;
const NOW = new Date('2026-10-27T12:00:00Z');

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-bf-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  backfill = await import('@/lib/pr-activity/backfill');
  store = await import('@/lib/pr-activity/store');
  await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES ('r1', 'acme', 14, 'completed', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')`);
  await db.execute(`INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES ('r0', 'acme', 14, 'completed', '2025-01-01T10:00:00Z', '2025-01-01T11:00:00Z')`);
  await db.execute(`INSERT INTO developer_stats (report_id, github_login) VALUES ('r1', 'alice'), ('r1', 'bob'), ('r0', 'ancient')`);
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* gone */ }
});
beforeEach(() => {
  mockFetchMergedPRs.mockReset().mockResolvedValue({ prs: [{ number: 1, title: 't', repo: 'app', mergedAt: '2026-09-10T10:00:00Z' }] });
  mockCountReviewedPRs.mockReset().mockResolvedValue({ reviews: 0, prs: [], itemsComplete: true });
});

it('monthSlices: last N complete months, oldest first, until exclusive', () => {
  expect(backfill.monthSlices(3, NOW)).toEqual([
    { since: '2026-07-01', until: '2026-08-01' },
    { since: '2026-08-01', until: '2026-09-01' },
    { since: '2026-09-01', until: '2026-10-01' },
  ]);
  expect(backfill.monthSlices(1, new Date('2026-01-15T00:00:00Z'))).toEqual([{ since: '2025-12-01', until: '2026-01-01' }]);
});

it('searches each in-period login month by month with an inclusive bounded window', async () => {
  const res = await backfill.backfillPrs({ org: 'acme', months: 1, now: NOW });
  expect(res).toEqual({ done: 2, skipped: 0, failed: [] });
  const [org, login, since, , until] = mockFetchMergedPRs.mock.calls[0];
  expect([org, login, since.toISOString(), until.toISOString()]).toEqual(['acme', 'alice', '2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z']);
  expect(mockFetchMergedPRs.mock.calls.map(c => c[1]).sort()).toEqual(['alice', 'bob']); // 'ancient' is out of period
  expect(await store.hasPrCoverage('acme', 'alice', '2026-09-01', '2026-10-01')).toBe(true);
});

it('resumes: a slice already in coverage is skipped without searching', async () => {
  const res = await backfill.backfillPrs({ org: 'acme', months: 1, now: NOW });
  expect(res).toEqual({ done: 0, skipped: 2, failed: [] });
  expect(mockFetchMergedPRs).not.toHaveBeenCalled();
});

it('a failed or unproven slice writes no coverage and is listed; others continue', async () => {
  mockFetchMergedPRs.mockImplementation(async (_o: string, login: string) => {
    if (login === 'alice') throw new Error('rate limited');
    return { prs: [] };
  });
  mockCountReviewedPRs.mockResolvedValue({ reviews: 2, prs: [], itemsComplete: false });
  const res = await backfill.backfillPrs({ org: 'acme', months: 2, now: NOW });
  expect(res.failed.map(f => [f.login, f.since])).toEqual(expect.arrayContaining([['alice', '2026-08-01'], ['bob', '2026-08-01']]));
  expect(res.failed.find(f => f.login === 'alice')!.error).toMatch(/rate limited/);
  expect(await store.hasPrCoverage('acme', 'alice', '2026-08-01', '2026-09-01')).toBe(false);
  expect(await store.hasPrCoverage('acme', 'bob', '2026-08-01', '2026-09-01')).toBe(false);
  expect(res.skipped).toBe(2); // September slices from the earlier run
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/pr-backfill-db.test.ts`
Expected: FAIL, "Cannot find module '@/lib/pr-activity/backfill'".

- [ ] **Step 3: Implement the backfill module**

Create `src/lib/pr-activity/backfill.ts`:

```ts
import db from '@/lib/db';
import { getGitHubProvider } from '@/lib/github';
import { upsertPrActivity, recordPrCoverage, hasPrCoverage } from './store';

const DAY_MS = 86_400_000;

export interface BackfillResult {
  done: number;
  skipped: number;
  failed: Array<{ login: string; since: string; until: string; error: string }>;
}

/** The last `months` COMPLETE calendar months before `now`'s month, oldest first; `until` is exclusive. */
export function monthSlices(months: number, now: Date): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = months; i >= 1; i--) {
    const start = new Date(Date.UTC(y, m - i, 1));
    const end = new Date(Date.UTC(y, m - i + 1, 1));
    out.push({ since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) });
  }
  return out;
}

/**
 * GLOOK-63: fill pr_activity for an org's developers, month by month, with the same two searches a
 * report runs (author: / reviewed-by:, is:merged, merged:<month>), going through github.ts's
 * rate-limit and retry handling. Idempotent: rows are upserted, and slices already in
 * pr_activity_coverage are skipped, so an interrupted run resumes. A slice whose searches weren't
 * provably complete gets no coverage row, so it is retried next time.
 */
export async function backfillPrs(opts: {
  org: string; months: number; now?: Date; log?: (m: string) => void;
}): Promise<BackfillResult> {
  const { org, months, now = new Date(), log = () => undefined } = opts;
  const slices = monthSlices(months, now);
  const result: BackfillResult = { done: 0, skipped: 0, failed: [] };
  if (slices.length === 0) return result;

  const [loginRows] = await db.execute(
    `SELECT DISTINCT ds.github_login
     FROM developer_stats ds JOIN reports r ON r.id = ds.report_id
     WHERE r.org = ? AND r.created_at >= ?
     ORDER BY ds.github_login`,
    [org, slices[0].since],
  ) as [any[], any];
  const logins: string[] = loginRows.map((r: any) => r.github_login);
  log(`Backfilling ${logins.length} developers × ${slices.length} months for ${org}`);

  const gh = getGitHubProvider();
  for (const login of logins) {
    for (const { since, until } of slices) {
      if (await hasPrCoverage(org, login, since, until)) { result.skipped++; continue; }
      const from = new Date(`${since}T00:00:00Z`);
      const lastDay = new Date(Date.parse(`${until}T00:00:00Z`) - DAY_MS);
      try {
        const authored = await gh.fetchMergedPRs(org, login, from, log, lastDay);
        const reviewed = await gh.countReviewedPRs(org, login, from, log, lastDay);
        await upsertPrActivity(org, login, 'authored', authored.prs);
        await upsertPrActivity(org, login, 'reviewed', reviewed.prs);
        const doubt = authored.unverified ?? reviewed.unverified
          ?? (reviewed.itemsComplete ? undefined : `review rows incomplete (${reviewed.prs.length} of ${reviewed.reviews})`);
        if (doubt) {
          result.failed.push({ login, since, until, error: `not provably complete: ${doubt}` });
          log(`@${login} ${since}: INCOMPLETE — ${doubt}`);
          continue;
        }
        await recordPrCoverage(org, login, since, until, 'backfill');
        result.done++;
        log(`@${login} ${since}: ${authored.prs.length} authored, ${reviewed.prs.length} reviewed`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        result.failed.push({ login, since, until, error });
        log(`@${login} ${since}: FAILED — ${error}`);
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Implement the CLI and npm script**

Create `scripts/backfill-prs.ts`:

```ts
// scripts/backfill-prs.ts — GLOOK-63 one-off PR history backfill. Never runs automatically.
// Run: npm run backfill:prs -- --org <org> --months 12
// Uses whatever database .env / .env.local / DB_TYPE point at, and GITHUB_TOKEN.
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: { org: { type: 'string' }, months: { type: 'string', default: '12' } },
  });
  const months = Number(values.months);
  if (!values.org || !Number.isInteger(months) || months < 1 || months > 36) {
    console.error('Usage: npm run backfill:prs -- --org <org> --months <1-36>');
    process.exit(1);
  }
  const { backfillPrs } = await import('../src/lib/pr-activity/backfill');
  const result = await backfillPrs({ org: values.org, months, log: (m) => console.log(m) });
  console.log(`\nDone: ${result.done} slices, skipped (already covered): ${result.skipped}, failed: ${result.failed.length}`);
  for (const f of result.failed) console.log(`  FAILED @${f.login} ${f.since}..${f.until}: ${f.error}`);
  process.exit(result.failed.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

In `package.json` `scripts`, add after `seed:reset`:

```json
    "backfill:prs": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/backfill-prs.ts",
```

- [ ] **Step 5: Document**

In `CLAUDE.md` under `## Commands` add:

```markdown
- `npm run backfill:prs -- --org <org> --months 12` — one-off GLOOK-63 backfill of `pr_activity` (merged PRs authored/reviewed) month by month; resumable, never runs automatically
```

Under `## Key architectural decisions` add:

```markdown
- **Team/Engineer date range (GLOOK-63, `src/lib/report/range.ts`)** — `current` (default, today's code path untouched), `90d`, `12m`. Range figures are recomputed from canonical rows, never summed across reports: commits one per `commit_sha` (`canonicalCommitIdsSql`), Jira one per `issue_key`, PRs one per `(repo, pr_number)` in `pr_activity`. `pr_activity` / `pr_activity_coverage` have no FK to `reports`; coverage rows (`since_date` inclusive, `until_date` exclusive — `UNTIL` is reserved in MySQL) are written only when a member's PR searches were trustworthy. Impact caps scale `cap × periodDays / 14`; in a range, volume caps use measured days (union of completed reports' windows) and PR/review caps use PR-covered days, so missing PR history never reads as low activity. The review search pages at 100 but `total_reviews` is still page 1's `total_count`; a bad later page only withholds coverage — do not fold it into the merged-PR raise policy. Team Pulse, LLM summaries and Claude Code spend stay on the current report.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/pr-backfill-db.test.ts && GITHUB_PROVIDER=mock npm run backfill:prs -- --org mock-org --months 1`
Expected: PASS. The mock run prints `Done: N slices ...` and exits 0 against the seeded SQLite DB.

- [ ] **Step 7: Full suite and commit**

Run: `npm test && npx tsc --noEmit`
Expected: all suites pass.

```bash
git add src/lib/pr-activity/backfill.ts scripts/backfill-prs.ts package.json CLAUDE.md src/lib/__tests__/unit/pr-backfill-db.test.ts
git commit -m "GLOOK-63: resumable PR history backfill script and docs"
```

---

## Self-Review

- **Spec coverage:**

  | Requirement | Task |
  |---|---|
  | R1 picker and URL state | Tasks 5, 8, 9, 10 |
  | R2 current unchanged | Tasks 7, 9, 10 (no range param; current path is code-identical) |
  | R3 window | Task 5 |
  | R4 Team table, developer table and exports | Task 9 |
  | R4 Engineer KPIs, percentiles, commits and chart | Tasks 7, 10 |
  | R5 labels | Tasks 9, 10 |
  | R6 de-dup | Task 6 |
  | R7 developer list | Task 6 |
  | R8 measured days | Tasks 5, 6, 9 |
  | R9 scaling | Task 1 (runner, team aggregator) and Task 6 (range) |
  | R10 PR rows | Tasks 3, 4 |
  | R11 coverage | Tasks 2, 4, 6 |
  | R12 backfill | Task 11 |
  | Schema in three places | Task 2 |
  | Drill-down routes | Task 7 (team drill-down via Task 9; engineer Jira via Task 10) |
  | Seed and docs | Tasks 2, 11 |

- **Placeholder scan:** every code step has concrete code. Where a step says "keep its props unchanged", it refers to an existing element whose code is not otherwise touched.
- **Type consistency:**
  - `ReportRange`, `ReportRangeKey`, `RangeMeta`, `RangeWindow`, `RangeDeveloperRow`, `ReviewedPRsResult`, `PrActivityKind` and `BackfillResult` are defined once and used with the same names.
  - The `countReviewedPRs(org, user, since, log?, until?)` and `fetchMergedPRs(org, user, since, log?, until?)` argument order matches across Tasks 3, 4 and 11.
- **Review Focus:** each of the five lines has a pinned test in the task named next to it.
