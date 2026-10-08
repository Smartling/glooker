# GLOOK-64 Security Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team lead can see every repository their owning team owns that has open critical or high Dependabot alerts, with counts per repository, and open one repository's alerts, by rebuilding the Security page (`/vulnerabilities`) to the approved v7 design.

**Architecture:** Wave 1 adds the data the page reads: repository rows that sum exactly to the team pivot, codebase counts, server-side alert sort and offset, `GET /api/vulnerabilities/repos` and an MCP tool. Wave 2 replaces the page composer with a thin one over page-local state, URL and data modules (one SWR key per region, one URL schema, one SLA-state helper) and builds the sticky bar, the drawer and the header; Waves 3 and 4 fill the Overview and Alerts slots with components whose sizes are exported constants. Wave 5 rewrites the reference document and proves the whole branch, including a headless-Chrome measurement at 1024px and 1440px in dark and light.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind, SWR, Recharts 3, Jest + ts-jest (+ jsdom), SQLite/MySQL.

**Spec:** `docs/superpowers/specs/2026-10-07-glook-64-security-page-redesign-design.md`

## Global Constraints

- **Public repository.** "No internal details in code, tests, fixtures, docs, specs, plans or commit messages. Use invented names (`acme/checkout-api`, "Payments") and the synthetic policy from `npm run dev:mock`."
- **Counting rules are unchanged.** "An unmeasured repository's stored alerts still count in team rows, totals, % closed and the trend. Its open count is shown as unknown, never as zero." Every total that counts alerts includes those stored counts, the Repositories footer's open and overdue sums among them.
- **Delta and baseline logic stay exactly as today.** "The page does not change how a baseline is picked."
- **`src/app/themes.ts` is not changed.** "The design's colour roles map onto existing theme values. Only colours the app lacks are added."
- **`PageHeader` and `DataFreshness` stay unchanged**, "because the org and team report pages use them"; the stale tag, the banner and the coverage line are page-local children.
- **`page.tsx` keeps exporting only its default**, per the root `CLAUDE.md`; every new component is page-local.
- **Every API route handler is wrapped in `withRequestLog()`**, including the new `GET /api/vulnerabilities/repos`; `logger-enforcement.test.ts` enforces it.
- **No SQL `LIMIT` or `OFFSET` from JS numbers.** "Sorting and slicing stay in memory in `listAlerts`. There is no SQL `LIMIT` or `OFFSET`, because of the MySQL binding pitfall."
- **Owning team is not a Glooker team.** "The repository `team` custom property ("Owning team") is never joined to Glooker's people-based `teams`."
- **No reconstructed history.** "History comes only from stored measurements (`vulnerability_repo_snapshots`). It is never reconstructed from alert timestamps."
- **One PR, no merge between Wave 2 and Wave 4.** Waves 1-5 ship as one PR; do not merge or deploy between Wave 2 and Wave 4, because the page is a shell until Waves 3-4 fill it.
- **Fixed sizes** (spec, "Dimensions and typography"): page container max width 1280px, padding 32 / 24 / 40, gap 24; KPI tile row 178px; ownership card body 330px (tables scroll inside, header and Total row pinned); team table rows 50px; Alerts summary strip 72px; Alerts card 776px; alert rows 56px, 10 per page, so the list area is 560px; repository rail 260px; trend plot 220px; sparkline slot 24px; drawer 460px wide, at most 92% of the viewport; header coverage line minimum height 22px.
- **Light theme `--warn` is `#8f5f00`** (dark `#d29922`): the handoff's `#9a6700` measured 4.23:1 on `--warn-bg`, below the 4.5:1 floor, and `#8f5f00` is 4.80:1.

## Conventions

- **Commands** are written as plain `npx jest <path> --maxWorkers=3` (one file), `npx jest --maxWorkers=3` (the full suite; CI uses 3 workers), `npx tsc --noEmit` and `npm run build`. This plan names no Node version and no filesystem path. The implementer's brief supplies the local environment.
- **Commit messages** start with `GLOOK-64: ` and a one-line summary. Append the attribution trailer your harness specifies.
- **Internal-name guard.** Step 5 of every task runs this line after `git add` and before `git commit`: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1`. Each wave's exit check runs the same line over the whole wave, with `git diff origin/main...HEAD` in place of `git diff --cached`. `INTERNAL_NAMES` is the maintainers' private pattern of company, host and people names and real policy values. It lives in the implementer's environment and is never written in this plan or in the repository. The guard passes only when `grep` finds nothing (exit status 1). Run the Step 5 lines one at a time: if the guard fails, do not run `git commit`.

## Review Focus

Five situations decide whether this change is right. Each names the task that builds it and the test that pins it, so a reviewer can start from the test.

1. **A bookmarked URL whose repository or team no longer exists** (renamed, archived, re-tagged) shows an inline "Repository not found" or "Clear team filter", never a page-level 400.
   - Repository: Task 2.7, `vuln-use-security-data.test.tsx` › "a repo absent from the loaded rows is not-found, and its alerts are never requested again" and "a repo the alerts API rejects ("repo not tracked") becomes not-found without a page-level error, and is not resent"; Task 4.5, `vuln-alert-list.test.tsx` › repository not found › "shows "Repository not found · Show all repositories" inside the list area, with the controls still mounted"; Task 4.7, `vuln-alerts-view.test.tsx` › "a repository that cannot be shown" (three tests, including "raises no page error").
   - Team: Task 2.11, `vuln-security-page.test.tsx` › "an unknown team shows the 400's message, the known teams and "Clear team filter", which clears the team".
2. **More than 500 alerts under Resolved or Open + resolved, paged with tied due dates**, produce no duplicated or skipped rows across pages.
   - Task 1.7, `vuln-aggregate.test.ts` › "listAlerts pages never repeat or skip a row (more than 500 matches, tied due dates)" for Open, and "listAlerts pages never repeat or skip a row under Resolved and Open + resolved (more than 500 matches, tied values)" for the other two states (620 alerts, every sort key in both directions, input order reversed). Task 4.7, `vuln-alerts-view.test.tsx` › "a page past the end after the result shrank lands on the last page" covers the client side of the same paging.
3. **A deployment with no SLA policy, a pending one, or an invalid one** shows the state on every SLA surface; the Overdue and Due ≤ 7d toggles are disabled with the hint; no overdue figure is printed.
   - Task 2.3, `vuln-sla-state.test.ts` (the one definition of the four states); Task 3.6, `vuln-kpi-sla.test.tsx` › "active policy", "pending", "none", "invalid"; Task 3.8, `vuln-team-table.test.tsx` › "Overdue columns per SLA state"; Task 3.9, `vuln-repo-table.test.tsx` › "columns follow the SLA state"; Task 4.3, `vuln-alerts-strip.test.tsx` › "the SLA tail, per state, for each severity"; Task 4.4, `vuln-repo-rail.test.tsx` › "the OVERDUE figure" and "footer"; Task 4.5, `vuln-alert-list.test.tsx` › "Due column, per SLA state" and "Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active"; Task 4.7, `vuln-alerts-view.test.tsx` › "SLA states reach every Alerts-view consumer from one summary".
4. **A team with an unmeasured repository that still holds stored alerts** reads the same open count in the team row, the Alerts strip, the rail's "All" row, the Alerts tab, the Repositories footer and the list total.
   - Task 1.3, `vuln-repo-rows-invariant.test.ts` › "independent cross-check through listAlerts" (the rows sum to the pivot, and each repository's `open` equals the `totalCount` of its own alert list, with an unmeasured repository that has stored alerts), and Task 1.11, `vuln-seed-repo-rows.test.ts` › "independent cross-check: each row's open equals getAlerts' open total for that repo, unmeasured repos included"; Task 3.7, `vuln-ownership-model.test.ts` › repoTotals › "with the unmeasured rows passed too, open and overdue include their stored counts; count, oldest and next due do not"; Task 3.9, `vuln-repo-table.test.tsx` › footer › "reads "Total · N repos" with no team and sums open and overdue over every row, the unmeasured one's stored counts included"; Task 3.10, `vuln-ownership-card.test.tsx` › "a team with an unmeasured repository that still holds stored alerts reads the same open counts in its team row and in the Repositories footer"; Task 4.7, `vuln-alerts-view.test.tsx` › "one source for every count" (strip, rail "All" row and Alerts tab read the same rows, an unmeasured row's stored count included).
5. **Light theme at 1024px**: the fixed heights hold (a card's border and shadow must not grow the rows inside it), and there is no horizontal scroll.
   - The light remap gives `.bg-gray-900` a border and a shadow, so only card shells may use it. Task 3.8, `vuln-team-table.test.tsx` › layout, and Task 3.9, `vuln-repo-table.test.tsx` (pinned header and footer rows use `bg-chart-surface`, not `bg-gray-900`); Task 4.2, `vuln-pager.test.tsx` › light theme; Task 4.4, `vuln-repo-rail.test.tsx` › light theme; Task 4.5, `vuln-alert-list.test.tsx` › light theme; Task 2.9, `vuln-coverage-drawer.test.tsx` › light theme (nothing inside these uses the card-shell class).
   - jsdom cannot measure layout, so Task 5.4 Step 6 measures the production build at 1024px and 1440px in dark and light (every fixed height, `scrollWidth - innerWidth` equal to 0, and the left edges of the coverage-line items, the "Repositories" tab and the strip blocks unchanged through every interaction), and each wave's exit check repeats the part it owns.

---

## Wave 1: Data layer, API and MCP

Wave 1 builds everything the redesigned Security page reads, and nothing the page renders. It extracts the SLA gate shared by the team pivot and the new repository rows, adds `computeRepoRows` (one row per in-scope, non-archived repository, summing exactly to the team pivot) and `computeCodebaseCounts`, gives coverage a `codebase` scope, adds `lastReopenedAt` to alert rows, adds server-side `sort` and `offset` to the alert list, and exposes the repository rows through `getRepos` and `GET /api/vulnerabilities/repos`. It ends with the MCP tool `list_vulnerability_repos` and the description updates, and with the mock fixtures (a zero-alert repository, an unmeasured repository that still has stored alerts, and 13 owning teams plus `Unassigned`) that later waves and `npm run dev:mock` use. Delta and baseline logic are not touched (spec Decision 7). The end state of all eleven tasks was built and run in a scratch copy of the repository at plan time: the full Jest suite passed (210 suites, 2219 tests) and `npx tsc --noEmit` was clean. The code blocks in this wave were checked against that copy line by line; the per-task fail-then-pass steps were reasoned from the code, not replayed one task at a time, so the implementer must still run each task's Step 2 and Step 4. Three deliberate regressions were run against the key tests and failed them (see the "revert that fails" notes).

### Wave 1 contract for Wave 2

This is what the page waves consume. Every name and shape below is produced by a task in this wave.

**HTTP (camelCase JSON).**

- `GET /api/vulnerabilities/repos?codebase=&team=` returns one of:
  - `{ available: true, sync: SyncStatusInfo, appliedFilters: { codebase: CodebaseGroup; team?: string }, configErrors: ConfigError[], rows: RepoRow[] }`;
  - `{ available: false, reason, sync?, configErrors? }` (no sync yet);
  - HTTP 400 `{ error: 'unknown team', known_teams: string[] }`;
  - HTTP 404 `{ error: 'not found' }` when the feature is off.
  `codebase` defaults to `backend` when omitted. Every other parameter is validated by the shared parser (a bad value is a 400) and then ignored. All rows are returned; there is no `limit`.
- `RepoRow` and `RepoSevCell` (exported from `@/lib/vulnerabilities/aggregate`, safe to `import type` in client code):

  ```ts
  interface RepoSevCell {
    open: number;
    overdue: number | null;          // null unless this severity's SLA is active
    dueSoon: number | null;          // null unless this severity's SLA is active
    oldestOpenDays: number | null;   // null when open is 0
    nextDue: { date: string; daysRemaining: number } | null; // null unless SLA active and something is due in >= 0 days
  }
  interface RepoRow {
    fullName: string; team: string;  // team is 'Unassigned' when the repo has none
    codebaseGroup: 'backend' | 'frontend' | 'shared' | 'other';
    critical: RepoSevCell; high: RepoSevCell;
    unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null;
  }
  ```

  Server row order: measured rows by `critical.open` desc, `high.open` desc, `fullName`; then unmeasured rows by `fullName`. The rail's "overdue first" order (spec, "Rail rows") is therefore a client-side re-sort of these rows. An unmeasured row carries its stored `open` counts; the UI must render them as unknown.
- `GET /api/vulnerabilities/summary` gains `codebaseCounts: Record<'backend'|'frontend'|'shared'|'other'|'all', { critical: number; high: number }>`. It ignores the `codebase` parameter and honours `team`.
- `GET /api/vulnerabilities/alerts` gains two query parameters and one row field:
  - `offset` (non-negative integer, default 0) and `sort` (`<key>:<asc|desc>`, key one of `severity`, `advisory`, `repo`, `age`, `due`, `state`). Both are echoed in `appliedFilters` exactly as sent (`sort` as the string, e.g. `"due:asc"`).
  - `truncated` now means `offset + rows.length < totalCount`. `totalCount` is always the full match count, also when `offset >= totalCount` (then `rows` is `[]`). The `repos` facet is not affected by `offset` or `sort`. `limit` (max 500) applies per page.
  - Sort keys compare: `severity` (asc = critical first), `advisory` (`cveId` else `ghsaId`, text order), `repo` (full name), `age` (`ageDays`, asc = youngest first), `due` (`dueDate`, `YYYY-MM-DD`), `state` (open, fixed, dismissed, auto_dismissed). A row with no value for the key (no advisory id, no due date) sorts last in both directions. Ties always break by repository name, then alert number, in ascending order, whichever direction was asked for.
  - Each `AlertRow` gains `lastReopenedAt: string | null` (ISO instant).
- `GET /api/vulnerabilities/coverage` gains `codebase`. **Behaviour change:** `codebase` defaults to `backend` like every other route, so a caller that omits it now gets the Backend lists, where it used to get every codebase. `appliedFilters` is now `{ codebase, team? }`. The old page calls coverage without `codebase`, so until Wave 2 replaces the page its coverage panel is Backend-scoped; Wave 2's new page must always send `codebase`.

**TypeScript exports.**

- `@/lib/vulnerabilities/aggregate`: `isSlaActive(sev, now)`, `computeRepoRows`, `RepoRow`, `RepoSevCell`, `computeCodebaseCounts`, `CodebaseCounts`, and the extended `AlertFilters` (`offset?: number; sort?: AlertSortSpec`) and `AlertRow`.
- `@/lib/vulnerabilities/alert-sort` (new, no imports, **client-safe**): `ALERT_SORT_KEYS`, `AlertSortKey`, `AlertSortDir`, `AlertSortSpec` (the template type `` `${AlertSortKey}:${AlertSortDir}` ``), `parseAlertSort`. The page builds `sort=` values from these without importing server config.
- `@/lib/vulnerabilities/queries`: `getRepos(f, now?)`.

**MCP (snake_case).** New tool `list_vulnerability_repos` with inputs `codebase`, `team`, `limit` (default 100, max 500) returns `{ available, sync, applied_filters, config_errors, rows, total_count, truncated }`. `list_vulnerabilities` gains inputs `offset` and `sort`. `get_vulnerability_coverage` gains input `codebase`. `get_vulnerability_summary` carries `codebase_counts`.

**Fixtures.** `MOCK_VULN_REPOS` (`scripts/mock-identities.ts`) gains 12 repositories, 10 new owning teams (13 in the Backend view with the existing ones, plus `Unassigned`: 14 pivot rows), a zero-alert repository `quiet-service` and `stale-scanner`, which `seedVulnerabilities` flags `dependabot-off` after the syncs while it keeps its stored alerts.

---

### Task 1.1: Shared SLA gate (`isSlaActive`)

**Files:**
- Modify: `src/lib/vulnerabilities/aggregate.ts` (extract the "is this severity's SLA active" check out of `finish()`)
- Test: `src/lib/__tests__/unit/vuln-aggregate.test.ts`

**Interfaces:**
- Consumes: `slaStatus(sev, now)` from `./sla` (already imported in `aggregate.ts`); the test file's existing helpers `R`, `A`, `NOW`, `SYNTHETIC_POLICY`, `SYNTHETIC_ACTIVE_POLICY` and its file-level `beforeEach`/`afterEach` that set `VULNERABILITIES_SLA_POLICY` and call `__clearVulnConfigCache`.
- Produces: `export function isSlaActive(sev: Severity, now: Date): boolean` in `@/lib/vulnerabilities/aggregate`. `finish()` calls it, and Task 1.2's `computeRepoRows` calls it, so the pivot and the repository rows cannot disagree about when overdue and due-soon are null.

- [ ] **Step 1: Write the failing test**

In `src/lib/__tests__/unit/vuln-aggregate.test.ts`, replace the first import line (`import { computePivot, computeKpi, computeCoverage, listAlerts, knownTeams, isResolvedSinceStart } from '@/lib/vulnerabilities/aggregate';`) with:

```ts
import { computePivot, computeKpi, computeCoverage, listAlerts, knownTeams, isResolvedSinceStart, isSlaActive } from '@/lib/vulnerabilities/aggregate';
```

Append at the end of the file:

```ts
describe('isSlaActive (the one SLA gate)', () => {
  it('is false while a policy is pending or absent, and true from its first effective day', () => {
    // File default policy: critical-2099-04 (pending on NOW) and no high entry at all.
    expect(isSlaActive('critical', NOW)).toBe(false);
    expect(isSlaActive('high', NOW)).toBe(false);
    expect(isSlaActive('critical', new Date('2099-04-14T23:59:59Z'))).toBe(false);
    expect(isSlaActive('critical', new Date('2099-04-15T00:00:00Z'))).toBe(true);
    expect(isSlaActive('high', new Date('2099-04-15T00:00:00Z'))).toBe(false);
  });

  it('the pivot nulls overdue and dueSoon exactly when the gate is closed', () => {
    for (const [policy, active] of [[SYNTHETIC_POLICY, false], [SYNTHETIC_ACTIVE_POLICY, true]] as const) {
      process.env.VULNERABILITIES_SLA_POLICY = policy;
      __clearVulnConfigCache();
      const { total } = computePivot([A(1, 1)], [R(1)], { codebase: 'backend', now: NOW });
      expect(isSlaActive('critical', NOW)).toBe(active);
      expect(total.critical.overdue === null).toBe(!active);
      expect(total.critical.dueSoon === null).toBe(!active);
      expect(total.high.overdue).toBeNull(); // neither policy has a high entry
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts --maxWorkers=3`
Expected: FAIL, both new tests with `isSlaActive is not a function` (the export does not exist yet).

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/aggregate.ts`, directly above `const emptyAcc = (): SevAcc => ...`, add:

```ts
/**
 * The one SLA gate (GLOOK-64). A severity's overdue / due-soon / next-due figures exist only while
 * its policy is `active` (not `pending`, not `none`). `finish()` below and `computeRepoRows` both
 * call this, so the team pivot and the repository rows can never disagree about when those
 * figures are null.
 */
export function isSlaActive(sev: Severity, now: Date): boolean { return slaStatus(sev, now) === 'active'; }
```

In `finish()`, replace `const active = slaStatus(sev, now) === 'active';` with:

```ts
  const active = isSlaActive(sev, now);
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-sla.test.ts --maxWorkers=3`
Expected: PASS (the pivot's existing overdue/dueSoon tests are the regression guard that `finish()` still behaves the same).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/aggregate.ts src/lib/__tests__/unit/vuln-aggregate.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: extract the shared SLA-active gate"
```

---

### Task 1.2: `computeRepoRows`

**Files:**
- Modify: `src/lib/vulnerabilities/aggregate.ts` (import `codebaseGroupOf`; add the types, the function, and a shared age helper)
- Test: `src/lib/__tests__/unit/vuln-aggregate.test.ts`

**Interfaces:**
- Consumes: `isSlaActive` (Task 1.1); inside `aggregate.ts`: `viewRepos`, `isOpen`, `isUnmeasured`, `teamOf`, `computeDue`, `daysRemaining`, `diffDays`, `utcDate`. In the test file: `R`, `A`, `NOW`, `useActivePolicy`, and the file-level env scaffolding.
- Produces (exact names, exported from `@/lib/vulnerabilities/aggregate`):

  ```ts
  export interface RepoSevCell { open: number; overdue: number | null; dueSoon: number | null; oldestOpenDays: number | null; nextDue: { date: string; daysRemaining: number } | null }
  export interface RepoRow { fullName: string; team: string; codebaseGroup: Exclude<CodebaseGroup, 'all'>; critical: RepoSevCell; high: RepoSevCell; unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null }
  export function computeRepoRows(alerts: AlertFact[], repos: RepoFact[], opts: { codebase: CodebaseGroup; team?: string; now: Date }): RepoRow[]
  ```

  Also an internal `ageDaysBetween(createdAt, endDate)` that `toAlertRow` now uses too, so the alert list's `ageDays` and the rows' `oldestOpenDays` share one rule.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/unit/vuln-aggregate.test.ts`, replace the first two import lines with:

```ts
import { computePivot, computeKpi, computeCoverage, computeRepoRows, listAlerts, knownTeams, isResolvedSinceStart, isSlaActive } from '@/lib/vulnerabilities/aggregate';
import type { TeamRow, RepoRow } from '@/lib/vulnerabilities/aggregate';
```

Append at the end of the file:

```ts
// ---------- computeRepoRows (GLOOK-64) ----------
// Both severities active since 2020-01-08: critical 7 days, high 9 days.
const SYNTHETIC_BOTH_ACTIVE_POLICY = JSON.stringify([
  { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
  { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
]);
function useBothActivePolicy(): void {
  process.env.VULNERABILITIES_SLA_POLICY = SYNTHETIC_BOTH_ACTIVE_POLICY;
  __clearVulnConfigCache();
}
const names = (rows: RepoRow[]) => rows.map(r => r.fullName);

describe('computeRepoRows', () => {
  const rs = [
    R(1, { fullName: 'o/a-low' }), R(2, { fullName: 'o/b-many' }), R(3, { fullName: 'o/c-high' }), R(4, { fullName: 'o/d-zero' }),
    R(5, { fullName: 'o/e-unmeasured', dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'Dependabot alerts are disabled for this repository.' }),
    R(6, { fullName: 'o/f-unmeasured-err', dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: x' }),
    R(7, { fullName: 'o/z-archived', archived: true, dependabotStatus: 'archived' }),
    R(8, { fullName: 'o/a-tie' }),
    R(9, { fullName: 'o/nonprod', serviceTier: 'non-production' }),
  ];
  const as = [
    A(1, 1),
    A(2, 1), A(2, 2), A(2, 3),
    A(3, 1, { severity: 'high' }), A(3, 2, { severity: 'high' }),
    A(5, 1), A(5, 2), A(5, 3), A(5, 4), A(5, 5),   // unmeasured, more open than any measured repo
    A(7, 1), A(8, 1), A(9, 1),
  ];

  it('orders measured rows by critical open, then high open, then name, and unmeasured rows last by name', () => {
    expect(names(computeRepoRows(as, rs, { codebase: 'backend', now: NOW }))).toEqual([
      'o/b-many',            // 3 critical
      'o/a-low', 'o/a-tie',  // 1 critical each: tie broken by name
      'o/c-high',            // 0 critical, 2 high
      'o/d-zero',            // nothing open: still listed
      'o/e-unmeasured',      // 5 stored critical, but unmeasured rows always come last
      'o/f-unmeasured-err',
    ]);
  });

  it('lists repos with no open alerts, and leaves out archived and out-of-scope repos', () => {
    const rows = computeRepoRows(as, rs, { codebase: 'backend', now: NOW });
    const zero = rows.find(r => r.fullName === 'o/d-zero')!;
    expect(zero.critical.open).toBe(0);
    expect(zero.high.open).toBe(0);
    expect(zero.critical.oldestOpenDays).toBeNull();
    expect(names(rows)).not.toContain('o/z-archived'); // archived: has open-looking alerts, contributes nothing
    expect(names(rows)).not.toContain('o/nonprod');    // outside the configured tracking scope
  });

  it('an unmeasured repo carries its stored counts and its status, never a zero', () => {
    const rows = computeRepoRows(as, rs, { codebase: 'backend', now: NOW });
    const off = rows.find(r => r.fullName === 'o/e-unmeasured')!;
    expect(off.critical.open).toBe(5);
    expect(off.unmeasured).toEqual({ status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' });
    const err = rows.find(r => r.fullName === 'o/f-unmeasured-err')!;
    expect(err.critical.open).toBe(0);
    expect(err.unmeasured).toEqual({ status: 'error', detail: 'HTTP 500: x' });
    expect(rows.find(r => r.fullName === 'o/a-low')!.unmeasured).toBeNull();
  });

  it('while no SLA is active, overdue, dueSoon and nextDue are null but open and oldestOpenDays still count', () => {
    const rows = computeRepoRows(as, rs, { codebase: 'backend', now: NOW }); // file default: critical pending, high none
    for (const r of rows) {
      for (const cell of [r.critical, r.high]) {
        expect(cell.overdue).toBeNull();
        expect(cell.dueSoon).toBeNull();
        expect(cell.nextDue).toBeNull();
      }
    }
    const many = rows.find(r => r.fullName === 'o/b-many')!;
    expect(many.critical.open).toBe(3);
    expect(many.critical.oldestOpenDays).toBe(21); // created 2026-09-01, NOW 2026-09-22
  });

  describe('with both SLAs active', () => {
    beforeEach(() => useBothActivePolicy());
    const slaRepos = [
      R(10, { fullName: 'o/sla' }), R(11, { fullName: 'o/today' }), R(12, { fullName: 'o/future' }), R(13, { fullName: 'o/late' }),
    ];
    const slaAlerts = [
      // critical, 7 days: due = created + 7. NOW is 2026-09-22.
      A(10, 1, { createdAt: '2026-09-01T00:00:00Z' }),  // due 09-08: 14 days overdue
      A(10, 2, { createdAt: '2026-09-10T00:00:00Z' }),  // due 09-17: 5 days overdue
      A(10, 3, { createdAt: '2026-09-17T00:00:00Z' }),  // due 09-24: in 2 days
      A(10, 4, { createdAt: '2026-09-20T00:00:00Z' }),  // due 09-27: in 5 days
      A(10, 5, { createdAt: '2026-09-22T00:00:00Z' }),  // due 09-29: in 7 days (still "due soon")
      // high, 9 days
      A(10, 6, { severity: 'high', createdAt: '2026-09-01T00:00:00Z' }), // due 09-10: overdue
      A(10, 7, { severity: 'high', createdAt: '2026-09-15T00:00:00Z' }), // due 09-24: in 2 days
      // never counted: resolved, and missing from the last sweep
      A(10, 8, { state: 'fixed', resolvedAt: '2026-09-05T00:00:00Z', createdAt: '2020-02-01T00:00:00Z' }),
      A(10, 9, { missing: true, createdAt: '2019-01-01T00:00:00Z' }),
      A(11, 1, { createdAt: '2026-09-15T00:00:00Z' }),  // due 09-22: today, 0 days left
      A(12, 1, { createdAt: '2026-09-23T00:00:00Z' }),  // created "tomorrow": age floors at 0; due 09-30, in 8 days
      A(13, 1, { createdAt: '2026-08-01T00:00:00Z' }),  // long overdue, nothing upcoming
    ];
    const rows = () => computeRepoRows(slaAlerts, slaRepos, { codebase: 'backend', now: NOW });
    const row = (n: string) => rows().find(r => r.fullName === n)!;

    it('counts overdue and due-soon per severity, with the same buckets as the pivot', () => {
      expect(row('o/sla').critical).toEqual({
        open: 5, overdue: 2, dueSoon: 3, oldestOpenDays: 21, nextDue: { date: '2026-09-24', daysRemaining: 2 },
      });
      expect(row('o/sla').high).toEqual({
        open: 2, overdue: 1, dueSoon: 1, oldestOpenDays: 21, nextDue: { date: '2026-09-24', daysRemaining: 2 },
      });
    });

    it('nextDue is the earliest due date that is not yet overdue, and includes today', () => {
      expect(row('o/today').critical.nextDue).toEqual({ date: '2026-09-22', daysRemaining: 0 });
      expect(row('o/today').critical.dueSoon).toBe(1);
      expect(row('o/future').critical.nextDue).toEqual({ date: '2026-09-30', daysRemaining: 8 });
      expect(row('o/future').critical.dueSoon).toBe(0);            // 8 days out is beyond the 7-day window
      expect(row('o/late').critical.nextDue).toBeNull();           // only overdue alerts
      expect(row('o/late').critical).toMatchObject({ open: 1, overdue: 1, dueSoon: 0 });
    });

    it('oldestOpenDays follows the alert list age rule: UTC days, floor 0, open alerts only', () => {
      expect(row('o/future').critical.oldestOpenDays).toBe(0);   // created after NOW → floored
      expect(row('o/sla').critical.oldestOpenDays).toBe(21);     // the 2020 fixed and 2019 missing alerts are ignored
      const [listed] = listAlerts([slaAlerts[0]], slaRepos, { codebase: 'backend', state: 'open' }, NOW).rows;
      expect(listed.ageDays).toBe(row('o/sla').critical.oldestOpenDays);
    });
  });

  it('honours codebase and team, groups a null codebase type under Other, and shows Unassigned', () => {
    const rs2 = [
      R(20, { fullName: 'o/fe', codebaseType: 'frontend', team: 'T2' }),
      R(21, { fullName: 'o/untyped', codebaseType: null, team: null }),
      R(22, { fullName: 'o/be' }),
    ];
    const as2 = [A(20, 1), A(21, 1), A(22, 1)];
    expect(names(computeRepoRows(as2, rs2, { codebase: 'frontend', now: NOW }))).toEqual(['o/fe']);
    const other = computeRepoRows(as2, rs2, { codebase: 'other', now: NOW });
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ fullName: 'o/untyped', team: 'Unassigned', codebaseGroup: 'other' });
    expect(names(computeRepoRows(as2, rs2, { codebase: 'all', team: 'T2', now: NOW }))).toEqual(['o/fe']);
    expect(computeRepoRows(as2, rs2, { codebase: 'all', now: NOW })).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts --maxWorkers=3`
Expected: FAIL, every `computeRepoRows` test with `computeRepoRows is not a function`. The earlier tests in the file still pass.

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/aggregate.ts`:

1. Change the codebase import to add `codebaseGroupOf`:

```ts
import { inCodebaseView, isInScope, codebaseGroupOf } from './codebase';
```

2. Insert this block immediately after the closing brace of `computePivot` and before `export interface Kpi { ... }`:

```ts
export interface RepoSevCell {
  open: number;
  overdue: number | null;          // null unless this severity's SLA is active
  dueSoon: number | null;          // null unless this severity's SLA is active
  oldestOpenDays: number | null;   // max age of open alerts; same age rule as toAlertRow (ageDays, UTC days, floor 0)
  nextDue: { date: string; daysRemaining: number } | null; // earliest due >= 0 days out; null unless SLA active
}
export interface RepoRow {
  fullName: string; team: string; codebaseGroup: Exclude<CodebaseGroup, 'all'>;
  critical: RepoSevCell;
  high: RepoSevCell;
  unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null;
}
interface RepoSevAcc { open: number; overdue: number; dueSoon: number; oldest: number | null; next: { date: string; daysRemaining: number } | null }
const emptyRepoAcc = (): RepoSevAcc => ({ open: 0, overdue: 0, dueSoon: 0, oldest: null, next: null });

/**
 * GLOOK-64: one row per in-scope, non-archived repository in the view (including repositories with
 * no open alerts), built on the same viewRepos / isOpen / computeDue as computePivot so that, per
 * team and severity, the rows sum to the pivot cell (open, overdue, dueSoon) and the rows with
 * `unmeasured` set count to the team's `unmeasuredRepos`. An unmeasured repository carries its
 * STORED counts (that is what keeps the sums exact); the UI renders them as unknown.
 * Row order is fixed here: measured rows by critical open desc, high open desc, then name; then
 * unmeasured rows by name.
 */
export function computeRepoRows(alerts: AlertFact[], repos: RepoFact[], opts: { codebase: CodebaseGroup; team?: string; now: Date }): RepoRow[] {
  const inView = viewRepos(repos, opts.codebase, opts.team);
  const today = opts.now.toISOString().slice(0, 10);
  const acc = new Map<number, { critical: RepoSevAcc; high: RepoSevAcc }>();
  for (const r of inView.values()) if (!r.archived) acc.set(r.repoId, { critical: emptyRepoAcc(), high: emptyRepoAcc() });
  for (const a of alerts) {
    const r = inView.get(a.repoId);
    const both = acc.get(a.repoId);
    if (!r || !both || !isOpen(a, r)) continue;
    const c = both[a.severity];
    c.open++;
    const age = ageDaysBetween(a.createdAt, today);
    if (c.oldest === null || age > c.oldest) c.oldest = age;
    const due = computeDue(a);
    if (!due) continue;
    const d = daysRemaining(due.dueDate, opts.now);
    if (d < 0) { c.overdue++; continue; }
    if (d <= 7) c.dueSoon++;
    if (c.next === null || d < c.next.daysRemaining) c.next = { date: due.dueDate, daysRemaining: d };
  }
  const cell = (x: RepoSevAcc, sev: Severity): RepoSevCell => {
    const active = isSlaActive(sev, opts.now);
    return {
      open: x.open, overdue: active ? x.overdue : null, dueSoon: active ? x.dueSoon : null,
      oldestOpenDays: x.oldest, nextDue: active ? x.next : null,
    };
  };
  const rows: RepoRow[] = [...inView.values()].filter(r => !r.archived).map(r => {
    const x = acc.get(r.repoId)!;
    return {
      fullName: r.fullName, team: teamOf(r), codebaseGroup: codebaseGroupOf(r.codebaseType),
      critical: cell(x.critical, 'critical'), high: cell(x.high, 'high'),
      unmeasured: isUnmeasured(r) ? { status: r.dependabotStatus as 'error' | 'dependabot-off', detail: r.dependabotStatusDetail } : null,
    };
  });
  const byName = (a: RepoRow, b: RepoRow) => a.fullName.localeCompare(b.fullName);
  const measured = rows.filter(r => !r.unmeasured)
    .sort((a, b) => b.critical.open - a.critical.open || b.high.open - a.high.open || byName(a, b));
  const unmeasured = rows.filter(r => r.unmeasured).sort(byName);
  return [...measured, ...unmeasured];
}
```

3. Directly above `function toAlertRow(`, add the shared age rule:

```ts
/** Whole UTC days from an alert's creation to `endDate` (YYYY-MM-DD), floored at 0. One rule for the
 * alert list's `ageDays` and the repository rows' `oldestOpenDays`. */
function ageDaysBetween(createdAt: string, endDate: string): number { return Math.max(0, diffDays(endDate, utcDate(createdAt))); }
```

4. In `toAlertRow`, replace the whole line `createdAt: a.createdAt, ageDays: Math.max(0, diffDays(ageEnd, utcDate(a.createdAt))),` with:

```ts
    createdAt: a.createdAt, ageDays: ageDaysBetween(a.createdAt, ageEnd),
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS (41 tests in the file at this point: 31 before the wave, plus 2 from Task 1.1 and 8 here) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/aggregate.ts src/lib/__tests__/unit/vuln-aggregate.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: computeRepoRows, one row per repository with per-severity SLA figures"
```

---

### Task 1.3: Repository-row invariant tests and the listAlerts cross-check

**Files:**
- Create: `src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts`

**Interfaces:**
- Consumes: `computePivot`, `computeRepoRows`, `listAlerts` from `@/lib/vulnerabilities/aggregate` (Tasks 1.1, 1.2); `__clearVulnConfigCache` from `@/lib/vulnerabilities/config`.
- Produces: the guard for spec invariants 1 to 3 (rows sum to the pivot per team and severity; overdue and due-soon are null in both places when a policy is inactive; unmeasured rows count to `unmeasuredRepos`), plus the independent `listAlerts` cross-check. Task 1.4 appends the `computeCodebaseCounts` tests to this same file.

This task adds tests only: the code under test exists after Task 1.2, so Step 2 proves the tests bite with a deliberate regression instead of watching them fail.

- [ ] **Step 1: Write the tests**

Create `src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts`:

```ts
// GLOOK-64: the repository rows must sum to the team pivot, per team and per severity, for every
// filter combination. Fixtures are invented (no real org data) and cover every row kind: a
// zero-alert repo, an unmeasured repo that still has stored open alerts, an archived repo with
// alerts, an out-of-scope repo, a repo with no team and a repo with no codebase type.
import { computePivot, computeRepoRows, listAlerts } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import type { AlertFact, RepoFact, CodebaseGroup, Severity } from '@/lib/vulnerabilities/types';

const NOW = new Date('2026-09-22T12:00:00Z');
const POLICY_BOTH_ACTIVE = JSON.stringify([
  { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
  { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
]);
const POLICY_CRITICAL_ONLY = JSON.stringify([{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 }]);
const PRIOR_POLICY = process.env.VULNERABILITIES_SLA_POLICY;
const PRIOR_SINCE = process.env.VULN_RESOLVED_SINCE;
const usePolicy = (policy: string | undefined) => {
  if (policy === undefined) delete process.env.VULNERABILITIES_SLA_POLICY; else process.env.VULNERABILITIES_SLA_POLICY = policy;
  __clearVulnConfigCache();
};
beforeEach(() => { process.env.VULN_RESOLVED_SINCE = '2020-01-08'; usePolicy(POLICY_BOTH_ACTIVE); });
afterEach(() => {
  if (PRIOR_SINCE === undefined) delete process.env.VULN_RESOLVED_SINCE; else process.env.VULN_RESOLVED_SINCE = PRIOR_SINCE;
  usePolicy(PRIOR_POLICY);
});

const repo = (repoId: number, fullName: string, over: Partial<RepoFact> = {}): RepoFact => ({
  repoId, fullName, team: 'Payments', serviceTier: 'production', codebaseType: 'backend', archived: false,
  dependabotStatus: 'ok', dependabotStatusDetail: null, carriedResolvedCritical: 0, ...over,
});
const alert = (repoId: number, number: number, over: Partial<AlertFact> = {}): AlertFact => ({
  repoId, number, htmlUrl: `https://example.test/${repoId}/${number}`, state: 'open', severity: 'critical', severityChangedAt: null,
  ghsaId: `GHSA-${repoId}-${number}`, cveId: `CVE-${repoId}-${number}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false,
  packageName: 'pkg', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
  createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false,
  ...over,
});

const REPOS: RepoFact[] = [
  repo(1, 'acme/checkout-api', { team: 'Payments' }),
  repo(2, 'acme/ledger', { team: 'Payments' }),
  repo(3, 'acme/search-indexer', { team: 'Search' }),
  repo(4, 'acme/search-ui', { team: 'Search', codebaseType: 'frontend' }),
  repo(5, 'acme/orphan', { team: null }),
  repo(6, 'acme/shared-kit', { team: 'Search', codebaseType: 'shared' }),
  repo(7, 'acme/untyped', { team: null, codebaseType: null }),
  repo(8, 'acme/quiet', { team: 'Payments' }),                                                                      // no alerts at all
  repo(9, 'acme/flaky', { team: 'Search', dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: boom' }),   // unmeasured, stored open alerts
  repo(10, 'acme/silent', { team: 'Payments', dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'off' }), // unmeasured, no alerts
  repo(11, 'acme/legacy', { team: 'Payments', archived: true, dependabotStatus: 'archived' }),                      // archived (the sync writes 'archived')
  repo(12, 'acme/internal', { team: 'Platform', serviceTier: 'non-production' }),                                   // outside the tracking scope
  repo(13, 'acme/kiosk', { team: 'Platform', codebaseType: 'mobile' }),                                             // a codebase type no group claims → Other
];
const NO_ALERT_REPOS = new Set([8, 10]);
const ALERTS: AlertFact[] = [
  ...REPOS.filter(r => !NO_ALERT_REPOS.has(r.repoId)).flatMap(r => {
    const n = (r.repoId % 4) + 2; // 2..5 open alerts per repo
    return Array.from({ length: n }, (_, i) => alert(r.repoId, i + 1, {
      severity: (i + r.repoId) % 3 === 0 ? 'high' : 'critical',
      // days 1..21 of September: a spread of overdue, due-soon and later alerts under both 7- and 9-day policies
      createdAt: `2026-09-${String(1 + ((i * 5 + r.repoId * 3) % 21)).padStart(2, '0')}T00:00:00Z`,
    }));
  }),
  alert(1, 90, { state: 'fixed', resolvedAt: '2026-09-10T00:00:00Z' }),
  alert(1, 91, { missing: true }),
  alert(3, 92, { state: 'dismissed', resolvedAt: '2026-09-11T00:00:00Z', dismissedReason: 'tolerable_risk' }),
];

const CODEBASES: CodebaseGroup[] = ['backend', 'frontend', 'shared', 'other', 'all'];
const TEAMS: Array<string | undefined> = [undefined, 'Payments', 'Search', 'Unassigned', 'Platform'];
const SEVS: Severity[] = ['critical', 'high'];

/** A pivot cell that is null (SLA inactive) must be null in every repository row; otherwise the rows must add up to it. */
function expectRowsMatchCell<T>(rows: T[], figure: (r: T) => number | null, pivotCell: number | null): void {
  if (pivotCell === null) {
    expect(rows.every(r => figure(r) === null)).toBe(true);
  } else {
    expect(rows.reduce((n, r) => n + (figure(r) as number), 0)).toBe(pivotCell);
  }
}

describe('the fixtures are not vacuous', () => {
  it('exercise overdue, due-soon, unmeasured-with-alerts, zero-alert and every kind of exclusion', () => {
    const { total } = computePivot(ALERTS, REPOS, { codebase: 'all', now: NOW });
    expect(total.critical.open).toBeGreaterThan(5);
    expect(total.high.open).toBeGreaterThan(5);
    expect(total.critical.overdue).toBeGreaterThan(0);
    expect(total.critical.dueSoon).toBeGreaterThan(0);
    expect(total.high.overdue).toBeGreaterThan(0);
    expect(total.high.dueSoon).toBeGreaterThan(0);
    expect(total.unmeasuredRepos).toBe(2);
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    const flaky = rows.find(r => r.fullName === 'acme/flaky')!;
    expect(flaky.critical.open + flaky.high.open).toBeGreaterThan(0);
    expect(rows.find(r => r.fullName === 'acme/quiet')).toMatchObject({ critical: { open: 0 }, high: { open: 0 } });
    expect(rows.map(r => r.fullName)).not.toContain('acme/legacy');
    expect(rows.map(r => r.fullName)).not.toContain('acme/internal');
  });
});

describe('repository rows sum to the team pivot (GLOOK-64 invariant)', () => {
  const combos = CODEBASES.flatMap(c => TEAMS.map(t => [c, t] as const));
  it.each(combos)('codebase=%s team=%s: open, overdue and dueSoon sum per team and severity; unmeasured rows count to unmeasuredRepos', (codebase, team) => {
    const { rows: teamRows } = computePivot(ALERTS, REPOS, { codebase, team, now: NOW });
    const repoRows = computeRepoRows(ALERTS, REPOS, { codebase, team, now: NOW });
    // every repository row belongs to a pivot row, so no repository can be missing from the comparison
    for (const r of repoRows) expect(teamRows.map(t => t.team)).toContain(r.team);
    for (const t of teamRows) {
      const mine = repoRows.filter(r => r.team === t.team);
      for (const sev of SEVS) {
        expectRowsMatchCell(mine, r => r[sev].open, t[sev].open);
        expectRowsMatchCell(mine, r => r[sev].overdue, t[sev].overdue);
        expectRowsMatchCell(mine, r => r[sev].dueSoon, t[sev].dueSoon);
      }
      expect(mine.filter(r => r.unmeasured).length).toBe(t.unmeasuredRepos);
    }
  });

  it('is null in both places when a severity SLA is inactive: a critical-only policy leaves high null in rows and pivot', () => {
    usePolicy(POLICY_CRITICAL_ONLY);
    const { total } = computePivot(ALERTS, REPOS, { codebase: 'all', now: NOW });
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    expect(total.high.overdue).toBeNull();
    expect(total.high.dueSoon).toBeNull();
    expect(rows.every(r => r.high.overdue === null && r.high.dueSoon === null && r.high.nextDue === null)).toBe(true);
    expect(total.critical.overdue).not.toBeNull();
    expect(rows.every(r => r.critical.overdue !== null)).toBe(true);
  });

  it('is null in both places when there is no policy at all', () => {
    usePolicy(undefined);
    const { total } = computePivot(ALERTS, REPOS, { codebase: 'all', now: NOW });
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    for (const sev of SEVS) {
      expect(total[sev].overdue).toBeNull();
      expect(rows.every(r => r[sev].overdue === null && r[sev].dueSoon === null)).toBe(true);
    }
  });
});

describe('independent cross-check through listAlerts', () => {
  it("each repository row's open equals the open-alert totalCount of listAlerts for that repo and severity, unmeasured repos included", () => {
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) {
      for (const sev of SEVS) {
        const listed = listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: r.fullName, severity: sev }, NOW);
        expect(listed.totalCount).toBe(r[sev].open);
      }
    }
    const flaky = rows.find(r => r.fullName === 'acme/flaky')!;
    expect(flaky.unmeasured).not.toBeNull();
    expect(listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: 'acme/flaky' }, NOW).totalCount).toBe(flaky.critical.open + flaky.high.open);
  });

  it('overdue per repository equals the overdue-filtered list for that repository', () => {
    const rows = computeRepoRows(ALERTS, REPOS, { codebase: 'all', now: NOW });
    for (const r of rows) {
      for (const sev of SEVS) {
        const listed = listAlerts(ALERTS, REPOS, { codebase: 'all', state: 'open', repo: r.fullName, severity: sev, overdue: true }, NOW);
        expect(listed.totalCount).toBe(r[sev].overdue);
      }
    }
  });
});
```

- [ ] **Step 2: Run it, then prove it bites**

Run: `npx jest src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts --maxWorkers=3`
Expected: PASS (30 tests: 25 filter combinations, the vacuity guard, 2 null-policy tests and 2 cross-checks).

Then make one temporary regression in `src/lib/vulnerabilities/aggregate.ts` and run `npx jest src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts src/lib/__tests__/unit/vuln-aggregate.test.ts --maxWorkers=3`:

- In `computeRepoRows`, change `if (!r || !both || !isOpen(a, r)) continue;` to `if (!r || !both || !isOpen(a, r) || isUnmeasured(r)) continue;` (unmeasured repos stop carrying their stored counts).

Expected with the regression: FAIL (8 tests in these two files failed when planned: the sums per team, the cross-check on `acme/flaky`, and `an unmeasured repo carries its stored counts`). Revert the change before committing (`git diff src/lib/vulnerabilities/aggregate.ts` must show nothing).

- [ ] **Step 3: Implement**

Nothing to implement; the code under test is Task 1.2's.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts src/lib/__tests__/unit/vuln-aggregate.test.ts --maxWorkers=3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: pin the repository-row sum invariant and its listAlerts cross-check"
```

---

### Task 1.4: `computeCodebaseCounts` and `summary.codebaseCounts`

**Files:**
- Modify: `src/lib/vulnerabilities/aggregate.ts` (import `CODEBASE_GROUPS`; add the function)
- Modify: `src/lib/vulnerabilities/queries.ts` (import it; `getSummary` returns `codebaseCounts`)
- Test: `src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts`, `src/lib/__tests__/unit/vuln-queries.test.ts`

**Interfaces:**
- Consumes: inside `aggregate.ts`: `isOpen`, `isInScope`, `teamOf`, `codebaseGroupOf` (imported in Task 1.2). In the tests: `ALERTS`, `REPOS`, `NOW`, `TEAMS`, `CODEBASES` from Task 1.3's file; `seedOk`, `f`, `NOW`, `db`, `q` from `vuln-queries.test.ts`.
- Produces: `export type CodebaseCounts = Record<CodebaseGroup, { critical: number; high: number }>` and `export function computeCodebaseCounts(alerts, repos, opts: { team?: string; now: Date }): CodebaseCounts` in `@/lib/vulnerabilities/aggregate`; `getSummary(f)` now returns `codebaseCounts: CodebaseCounts` (HTTP: `GET /api/vulnerabilities/summary`, MCP: `codebase_counts`). In `vuln-queries.test.ts`, two SQL helpers `repoRowSql(id, name, over?)` and `alertSql(repoId, n, severity?, createdAt?)` that Tasks 1.5, 1.8 and 1.9 reuse.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts`, replace the first two imports with:

```ts
import { computePivot, computeRepoRows, computeCodebaseCounts, listAlerts } from '@/lib/vulnerabilities/aggregate';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';
import { CODEBASE_GROUPS } from '@/lib/vulnerabilities/codebase-labels';
```

Append at the end of that file:

```ts
describe('computeCodebaseCounts', () => {
  it.each(TEAMS)('team=%s: counts[c] equals the pivot total open for codebase c, for both severities', (team) => {
    const counts = computeCodebaseCounts(ALERTS, REPOS, { team, now: NOW });
    expect(Object.keys(counts).sort()).toEqual([...CODEBASE_GROUPS].sort());
    for (const c of CODEBASES) {
      const { total } = computePivot(ALERTS, REPOS, { codebase: c, team, now: NOW });
      expect(counts[c]).toEqual({ critical: total.critical.open, high: total.high.open });
    }
  });

  it('ignores the codebase filter but honours team, and counts a null codebase type under other and all', () => {
    const unassigned = computeCodebaseCounts(ALERTS, REPOS, { team: 'Unassigned', now: NOW });
    // acme/orphan (backend) and acme/untyped (no codebase type) are the Unassigned repos.
    expect(unassigned.backend.critical + unassigned.backend.high).toBeGreaterThan(0);
    expect(unassigned.other.critical + unassigned.other.high).toBeGreaterThan(0); // acme/untyped
    expect(unassigned.frontend).toEqual({ critical: 0, high: 0 });
    const all = computeCodebaseCounts(ALERTS, REPOS, { now: NOW });
    expect(all.all.critical).toBe(all.backend.critical + all.frontend.critical + all.shared.critical + all.other.critical);
    expect(all.all.high).toBe(all.backend.high + all.frontend.high + all.shared.high + all.other.high);
  });
});
```

In `src/lib/__tests__/unit/vuln-queries.test.ts`, append at the end of the file (these two helpers are reused by later tasks):

```ts
// ---------- GLOOK-64 helpers and tests ----------
const repoRowSql = (id: number, name: string, over: { team?: string | null; tier?: string; codebase?: string | null; archived?: number; status?: string; detail?: string | null } = {}) => db.execute(
  `INSERT INTO vulnerability_repos (repo_id, org, full_name, team, service_tier, codebase_type, archived, dependabot_status, dependabot_status_detail, first_seen_at, last_seen_at)
   VALUES (?,'o',?,?,?,?,?,?,?,'2026-09-22T10:00:00Z','2026-09-22T10:00:00Z')`,
  [id, name, over.team === undefined ? 'T1' : over.team, over.tier ?? 'production', over.codebase === undefined ? 'backend' : over.codebase,
    over.archived ?? 0, over.status ?? 'ok', over.detail ?? null]);
const alertSql = (repoId: number, n: number, severity: 'critical' | 'high' = 'critical', createdAt = '2026-09-01T00:00:00Z') => db.execute(
  `INSERT INTO vulnerability_alerts (repo_id, number, org, html_url, state, severity, created_at, first_seen_sync_id, last_seen_sync_id)
   VALUES (?,?,'o',?,'open',?,?,1,1)`, [repoId, n, `u${repoId}-${n}`, severity, createdAt]);

describe('getSummary codebaseCounts', () => {
  it('counts open critical and high per codebase group, ignores the codebase filter and honours team; a null codebase type counts under other and all', async () => {
    await seedOk(); // o/r1: T1 backend, 1 critical
    await repoRowSql(2, 'o/r2', { team: 'T2', codebase: 'frontend' }); await alertSql(2, 1, 'high');
    await repoRowSql(3, 'o/r3', { team: 'T1', codebase: null }); await alertSql(3, 1);
    const zero = { critical: 0, high: 0 };
    const all = await q.getSummary(f({ codebase: 'frontend' }), NOW); // the filter must not change the counts
    expect(all.codebaseCounts).toEqual({
      backend: { critical: 1, high: 0 }, frontend: { critical: 0, high: 1 }, shared: zero, other: { critical: 1, high: 0 }, all: { critical: 2, high: 1 },
    });
    expect((await q.getSummary(f({ team: 'T1' }), NOW)).codebaseCounts).toEqual({
      backend: { critical: 1, high: 0 }, frontend: zero, shared: zero, other: { critical: 1, high: 0 }, all: { critical: 2, high: 0 },
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts src/lib/__tests__/unit/vuln-queries.test.ts --maxWorkers=3`
Expected: FAIL: `computeCodebaseCounts is not a function` in the invariant file, and `codebaseCounts` is `undefined` in the queries test.

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/aggregate.ts`, extend the codebase import:

```ts
import { inCodebaseView, isInScope, codebaseGroupOf, CODEBASE_GROUPS } from './codebase';
```

Insert immediately after the closing brace of `computeKpi` and before `export interface CoverageRow {`:

```ts
export type CodebaseCounts = Record<CodebaseGroup, { critical: number; high: number }>;

/**
 * GLOOK-64: open critical and high alerts per codebase group, for the page's Codebase options.
 * It ignores the `codebase` filter (every option must show its own count) and honours `team`.
 * A repository with no codebase type counts under `other` and `all`, exactly as `inCodebaseView`
 * places it, so `counts[c]` equals the pivot's total open for `codebase = c`.
 */
export function computeCodebaseCounts(alerts: AlertFact[], repos: RepoFact[], opts: { team?: string; now: Date }): CodebaseCounts {
  const counts = Object.fromEntries(CODEBASE_GROUPS.map(g => [g, { critical: 0, high: 0 }])) as CodebaseCounts;
  const byId = new Map(repos.map(r => [r.repoId, r]));
  for (const a of alerts) {
    const r = byId.get(a.repoId);
    if (!r || !isInScope(r.serviceTier) || !isOpen(a, r)) continue;
    if (opts.team && teamOf(r) !== opts.team) continue;
    counts[codebaseGroupOf(r.codebaseType)][a.severity]++;
    counts.all[a.severity]++;
  }
  return counts;
}
```

In `src/lib/vulnerabilities/queries.ts`, add `computeCodebaseCounts` to the import list from `./aggregate`:

```ts
import {
  computePivot, computeKpi, computeCoverage, computeCodebaseCounts, listAlerts, computeDelta, computeTrend, snapshotSets, pickBaseline, knownTeams, teamOf, setKey,
  pickTrendSets,
} from './aggregate';
```

In `getSummary`, directly after the `kpi: computeKpi(...)` line, add:

```ts
    // GLOOK-64: open critical/high per codebase group, ignoring `codebase` (every option shows its own count), honouring `team`.
    codebaseCounts: computeCodebaseCounts(p.alerts, p.repos, { team: f.team, now }),
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts src/lib/__tests__/unit/vuln-queries.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/aggregate.ts src/lib/vulnerabilities/queries.ts src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts src/lib/__tests__/unit/vuln-queries.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: per-codebase open counts on the summary"
```

---

### Task 1.5: Coverage gains `codebase`

**Files:**
- Modify: `src/lib/vulnerabilities/aggregate.ts` (`computeCoverage` option)
- Modify: `src/lib/vulnerabilities/queries.ts` (`getCoverage` passes and echoes it)
- Test: `src/lib/__tests__/unit/vuln-aggregate.test.ts` (new pure tests), `src/lib/__tests__/unit/vuln-queries.test.ts` (two existing tests change, one test is added)

**Interfaces:**
- Consumes: `inCodebaseView` (already imported in `aggregate.ts`); in `vuln-aggregate.test.ts` the existing `R`, `A`, `computeCoverage` import; `repoRowSql`, `alertSql`, `seedOk`, `f`, `NOW`, `q` in `vuln-queries.test.ts` (Task 1.4 added the SQL helpers).
- Produces: `computeCoverage(alerts, repos, opts: { team?: string; codebase?: CodebaseGroup })` (`codebase` optional: `undefined` means every codebase, so direct callers and existing tests keep working); `getCoverage(f)` filters its three lists by `f.codebase` and echoes `appliedFilters: { codebase, team? }`. The route file `src/app/api/vulnerabilities/coverage/route.ts` is unchanged: `parseVulnFilters` already parses `codebase`. **Behaviour change** (also in the wave contract): omitting `codebase` now means `backend`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/unit/vuln-aggregate.test.ts`:

```ts
describe('computeCoverage codebase option (GLOOK-64)', () => {
  const rs = [
    R(1, { fullName: 'o/be' }),
    R(2, { fullName: 'o/fe-untagged', codebaseType: 'frontend', team: null }),                                       // needs tagging: no team
    R(3, { fullName: 'o/untyped', codebaseType: null }),                                                             // needs tagging: no codebase type (Other and All)
    R(4, { fullName: 'o/fe-off', codebaseType: 'frontend', dependabotStatus: 'dependabot-off', dependabotStatusDetail: 'off' }),
    R(5, { fullName: 'o/be-err', dependabotStatus: 'error', dependabotStatusDetail: 'HTTP 500: x' }),
    R(6, { fullName: 'o/nonprod-fe', codebaseType: 'frontend', serviceTier: 'non-production' }),                     // excluded by policy
    R(7, { fullName: 'o/nonprod-be', serviceTier: 'non-production' }),                                               // excluded by policy
  ];
  const as = [A(1, 1), A(2, 1), A(3, 1), A(6, 1), A(7, 1)];
  const fn = (rows: Array<{ fullName: string }>) => rows.map(r => r.fullName);
  const lists = (codebase?: 'backend' | 'frontend' | 'shared' | 'other' | 'all') => {
    const c = computeCoverage(as, rs, { codebase });
    return { needsTagging: fn(c.needsTagging), excludedByPolicy: fn(c.excludedByPolicy), unmeasured: fn(c.unmeasured) };
  };

  it('filters all three lists by codebase group, placing a null codebase type under Other and All', () => {
    expect(lists('backend')).toEqual({ needsTagging: [], excludedByPolicy: ['o/nonprod-be'], unmeasured: ['o/be-err'] });
    expect(lists('frontend')).toEqual({ needsTagging: ['o/fe-untagged'], excludedByPolicy: ['o/nonprod-fe'], unmeasured: ['o/fe-off'] });
    expect(lists('other')).toEqual({ needsTagging: ['o/untyped'], excludedByPolicy: [], unmeasured: [] });
    expect(lists('shared')).toEqual({ needsTagging: [], excludedByPolicy: [], unmeasured: [] });
  });

  it('All, and no codebase option at all, return every repo', () => {
    const everything = {
      needsTagging: ['o/fe-untagged', 'o/untyped'], excludedByPolicy: ['o/nonprod-be', 'o/nonprod-fe'], unmeasured: ['o/be-err', 'o/fe-off'],
    };
    expect(lists('all')).toEqual(everything);
    expect(lists(undefined)).toEqual(everything);
  });

  it('combines with the team option', () => {
    const c = computeCoverage(as, rs, { codebase: 'frontend', team: 'Unassigned' });
    expect(fn(c.needsTagging)).toEqual(['o/fe-untagged']);
    expect(fn(c.unmeasured)).toEqual([]);
  });
});
```

In `src/lib/__tests__/unit/vuln-queries.test.ts`:

1. In the test `appliedFilters echoes only the fields each endpoint consumes`, replace the coverage line

```ts
  expect((await q.getCoverage(f({ codebase: 'frontend', team: 'T1' }), NOW)).appliedFilters).toEqual({ team: 'T1' });
```

with:

```ts
  expect((await q.getCoverage(f({ codebase: 'frontend', team: 'T1' }), NOW)).appliedFilters).toEqual({ codebase: 'frontend', team: 'T1' });
```

2. In the test `getCoverage success path flags an untagged repo needing tagging`, replace

```ts
  const r = await q.getCoverage(f(), NOW);
  expect(r.available).toBe(true);
  expect(r.needsTagging.map((x: any) => x.fullName)).toEqual(['o/r3']);
});
```

with (the fixture repo `o/r3` has no codebase type, so it belongs to Other and All, not to the default Backend view):

```ts
  // o/r3 has no codebase type, so it belongs to Other and All; the default Backend view does not list it.
  const r = await q.getCoverage(f({ codebase: 'all' }), NOW);
  expect(r.available).toBe(true);
  expect(r.needsTagging.map((x: any) => x.fullName)).toEqual(['o/r3']);
  expect((await q.getCoverage(f({ codebase: 'other' }), NOW)).needsTagging.map((x: any) => x.fullName)).toEqual(['o/r3']);
  expect((await q.getCoverage(f({ codebase: 'backend' }), NOW)).needsTagging).toEqual([]);
});
```

3. Append at the end of the file:

```ts
describe('getCoverage codebase', () => {
  it('scopes the three lists by codebase and echoes it', async () => {
    await seedOk();
    await repoRowSql(2, 'o/fe-unmeasured', { codebase: 'frontend', status: 'error', detail: 'HTTP 500: x' });
    await repoRowSql(3, 'o/untyped', { codebase: null, team: null }); await alertSql(3, 1);
    const be = await q.getCoverage(f({ codebase: 'backend' }), NOW);
    expect(be.unmeasured).toEqual([]);
    expect(be.needsTagging).toEqual([]);
    const fe = await q.getCoverage(f({ codebase: 'frontend' }), NOW);
    expect(fe.unmeasured.map((x: any) => x.fullName)).toEqual(['o/fe-unmeasured']);
    const all = await q.getCoverage(f({ codebase: 'all' }), NOW);
    expect(all.unmeasured.map((x: any) => x.fullName)).toEqual(['o/fe-unmeasured']);
    expect(all.needsTagging.map((x: any) => x.fullName)).toEqual(['o/untyped']);
    expect(all.appliedFilters).toEqual({ codebase: 'all' });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-queries.test.ts --maxWorkers=3`
Expected: FAIL: in `vuln-aggregate.test.ts` the `backend` and `frontend` lists still contain every repo (the option is ignored); in `vuln-queries.test.ts` the echoed `appliedFilters` lacks `codebase` and the Backend coverage still lists `o/untyped` and the frontend repo.

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/aggregate.ts`, change the `computeCoverage` signature to:

```ts
export function computeCoverage(alerts: AlertFact[], repos: RepoFact[], opts: { team?: string; codebase?: CodebaseGroup }): Coverage {
```

and replace the line `const teamOk = (r: RepoFact) => !opts.team || teamOf(r) === opts.team;` with:

```ts
  // GLOOK-64: `codebase` is optional here (undefined = every codebase), so direct callers that never
  // scoped by codebase keep their behaviour; getCoverage always passes the parsed filter.
  const teamOk = (r: RepoFact) => (!opts.team || teamOf(r) === opts.team)
    && (opts.codebase === undefined || inCodebaseView(r.codebaseType, opts.codebase));
```

(`inCodebaseView` already places a null codebase type under Other and All.)

In `src/lib/vulnerabilities/queries.ts`, replace the body of `getCoverage`'s return with:

```ts
  return { available: true as const, sync: p.sync, appliedFilters: pickApplied(f, ['codebase', 'team']), configErrors: p.configErrors,
    ...computeCoverage(p.alerts, p.repos, { team: f.team, codebase: f.codebase }) };
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-queries.test.ts src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-facts-cache-race.test.ts --maxWorkers=3`
Expected: PASS (the aggregate tests that call `computeCoverage(alerts, repos, {})` keep passing because `codebase` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/aggregate.ts src/lib/vulnerabilities/queries.ts src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-queries.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: scope the coverage lists by codebase"
```

---

### Task 1.6: `AlertRow.lastReopenedAt`

**Files:**
- Modify: `src/lib/vulnerabilities/aggregate.ts` (`AlertRow` type, `toAlertRow`)
- Modify: `src/lib/__tests__/unit/vuln-alerts-table.test.tsx` (fixture must satisfy the new required field)
- Modify: `src/lib/__tests__/unit/vuln-mcp.test.ts` (exact row key list)
- Test: `src/lib/__tests__/unit/vuln-aggregate.test.ts`

**Interfaces:**
- Consumes: `AlertFact.lastReopenedAt: string | null` (already on the fact and mapped by `db-helpers.ts`).
- Produces: `AlertRow.lastReopenedAt: string | null` (ISO instant; the list shows it as a UTC date in "reopened {date}"); MCP rows gain `last_reopened_at`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/unit/vuln-aggregate.test.ts`:

```ts
describe('AlertRow.lastReopenedAt (GLOOK-64)', () => {
  it('carries the latest reopen instant, and null for an alert that was never reopened', () => {
    const reopened = A(1, 1, { reopenedCount: 2, lastReopenedAt: '2026-09-10T08:30:00Z' });
    const plain = A(1, 2);
    const { rows } = listAlerts([reopened, plain], [R(1)], { codebase: 'backend', state: 'open' }, NOW);
    expect(rows.find(r => r.cveId === 'CVE-1')!.lastReopenedAt).toBe('2026-09-10T08:30:00Z');
    expect(rows.find(r => r.cveId === 'CVE-2')!.lastReopenedAt).toBeNull();
  });
});
```

In `src/lib/__tests__/unit/vuln-mcp.test.ts`, in the test `emits snake_case keys everywhere`, replace the line

```ts
    'ghsa_id', 'html_url', 'manifest_path', 'package_name', 'relationship', 'reopened_count', 'repo', 'resolved_at',
```

with:

```ts
    'ghsa_id', 'html_url', 'last_reopened_at', 'manifest_path', 'package_name', 'relationship', 'reopened_count', 'repo', 'resolved_at',
```

In `src/lib/__tests__/unit/vuln-alerts-table.test.tsx`, in the `alertRow` helper, replace

```ts
    resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, htmlUrl: `u${i}`,
```

with (this fixture is typed as `AlertRow[]` by its callers, and `npx tsc --noEmit` fails without the field; the file is retired in Wave 2):

```ts
    resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, lastReopenedAt: null, htmlUrl: `u${i}`,
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-mcp.test.ts --maxWorkers=3`
Expected: FAIL: `lastReopenedAt` is `undefined` (aggregate), and the MCP key list lacks `last_reopened_at`.

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/aggregate.ts`, in `interface AlertRow`, replace `resolvedOnTime: boolean | null; resolvedDaysLate: number | null; reopenedCount: number; htmlUrl: string;` with:

```ts
  resolvedOnTime: boolean | null; resolvedDaysLate: number | null; reopenedCount: number;
  /** ISO instant of the latest reopen, or null; the list shows it as a UTC date in "reopened {date}". */
  lastReopenedAt: string | null; htmlUrl: string;
```

In `toAlertRow`, replace `reopenedCount: a.reopenedCount, htmlUrl: a.htmlUrl,` with:

```ts
    reopenedCount: a.reopenedCount, lastReopenedAt: a.lastReopenedAt, htmlUrl: a.htmlUrl,
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-mcp.test.ts src/lib/__tests__/unit/vuln-alerts-table.test.tsx --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/aggregate.ts src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-mcp.test.ts src/lib/__tests__/unit/vuln-alerts-table.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: alert rows carry lastReopenedAt"
```

---

### Task 1.7: Alert list `sort` and `offset` in `listAlerts`

**Files:**
- Create: `src/lib/vulnerabilities/alert-sort.ts`
- Modify: `src/lib/vulnerabilities/aggregate.ts` (`AlertFilters`, sorting, paging)
- Test: `src/lib/__tests__/unit/vuln-aggregate.test.ts`

**Interfaces:**
- Consumes: `AlertRow.lastReopenedAt` and the rest of `AlertRow` (Task 1.6); the test file's `R`, `A`, `NOW`, `useActivePolicy` (critical-only policy active since 2020, so critical alerts have a due date and high alerts have none).
- Produces:
  - `@/lib/vulnerabilities/alert-sort` (no imports, client-safe): `ALERT_SORT_KEYS = ['severity','advisory','repo','age','due','state'] as const`, `type AlertSortKey`, `type AlertSortDir = 'asc' | 'desc'`, `type AlertSortSpec = \`${AlertSortKey}:${AlertSortDir}\``, `parseAlertSort(raw: string): { key: AlertSortKey; dir: AlertSortDir } | null`.
  - `AlertFilters` gains `offset?: number` and `sort?: AlertSortSpec`.
  - `listAlerts` behaviour per the spec table: closed sort keys, nulls last in both directions, tie-break repository name then alert number always applied last and never reversed, no `sort` = soonest due then severity then newest plus the tie-break, `offset` default 0, `offset >= total` gives empty `rows` and the exact `totalCount`, `truncated = offset + rows.length < totalCount`, `limit` capped at 500 per page, the `repos` facet untouched.
  - The alert number is **not** added to `AlertRow` (it would change the exact MCP key list); sorting works on `{ row, number }` pairs internally.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/unit/vuln-aggregate.test.ts`, replace the line `import type { TeamRow, RepoRow } from '@/lib/vulnerabilities/aggregate';` with:

```ts
import type { TeamRow, RepoRow, AlertRow } from '@/lib/vulnerabilities/aggregate';
import { ALERT_SORT_KEYS } from '@/lib/vulnerabilities/alert-sort';
import type { AlertSortSpec } from '@/lib/vulnerabilities/alert-sort';
```

Append at the end of the file:

```ts
// ---------- listAlerts sort and offset (GLOOK-64) ----------
describe('listAlerts sort', () => {
  // Critical policy only, effective since 2020: critical alerts have a due date (created + 7 days), high alerts have none.
  beforeEach(() => useActivePolicy());
  const rs = [R(1), R(2), R(3)];
  const as = [
    A(1, 1, { createdAt: '2026-09-01T00:00:00Z', cveId: 'CVE-2026-0003' }),                  // x: age 21, due 09-08
    A(2, 1, { createdAt: '2026-09-15T00:00:00Z', cveId: 'CVE-2026-0001' }),                  // y: age 7,  due 09-22
    A(3, 1, { severity: 'high', createdAt: '2026-09-10T00:00:00Z', cveId: null, ghsaId: 'GHSA-zzzz' }), // z: age 12, no due date
    A(3, 2, { state: 'fixed', resolvedAt: '2026-09-12T00:00:00Z', createdAt: '2026-09-05T00:00:00Z', cveId: null, ghsaId: null }), // w: resolved, no advisory id, age 7, due 09-12
  ];
  const label = (r: AlertRow) => r.cveId ?? r.ghsaId ?? 'no-advisory';
  const order = (sort?: AlertSortSpec) => listAlerts(as, rs, { codebase: 'backend', state: 'all', sort }, NOW).rows.map(label);
  const X = 'CVE-2026-0003'; const Y = 'CVE-2026-0001'; const Z = 'GHSA-zzzz'; const W = 'no-advisory';

  it.each([
    ['severity:asc', [X, Y, W, Z]],      // critical first; ties by repo, then alert number
    ['severity:desc', [Z, X, Y, W]],     // high first; the tie-break is NOT reversed
    ['advisory:asc', [Y, X, Z, W]],      // cve id, else ghsa id; no id last
    ['advisory:desc', [Z, X, Y, W]],     // no id still last
    ['repo:asc', [X, Y, Z, W]],          // z and w share a repo: alert number decides
    ['repo:desc', [Z, W, Y, X]],         // repo reversed, alert number not
    ['age:asc', [Y, W, Z, X]],           // y and w are both 7 days: repo decides
    ['age:desc', [X, Z, Y, W]],          // still y before w
    ['due:asc', [X, W, Y, Z]],           // no due date (z) last
    ['due:desc', [Y, W, X, Z]],          // z still last
    ['state:asc', [X, Y, Z, W]],         // open, then fixed
    ['state:desc', [W, X, Y, Z]],
  ] as Array<[AlertSortSpec, string[]]>)('%s', (sort, expected) => {
    expect(order(sort)).toEqual(expected);
  });

  it('without a sort keeps the urgency order (soonest due, severity, newest), then repo and alert number', () => {
    // x is due first, then y. z (open, no due date) and w (resolved) both have no days remaining, so severity decides: critical w before high z.
    expect(order()).toEqual([X, Y, W, Z]);
    const ties = [A(2, 1), A(1, 2), A(1, 1)]; // identical createdAt and severity, so only the tie-break orders them
    const rows = listAlerts(ties, [R(1), R(2)], { codebase: 'backend', state: 'open' }, NOW).rows;
    expect(rows.map(r => `${r.repo}#${r.cveId}`)).toEqual(['o/r1#CVE-1', 'o/r1#CVE-2', 'o/r2#CVE-1']);
  });
});

describe('listAlerts offset, limit and truncated', () => {
  const rs = [R(1)];
  const three = [A(1, 3), A(1, 1), A(1, 2)]; // default order falls through to alert number: CVE-1, CVE-2, CVE-3
  const page = (over: object) => listAlerts(three, rs, { codebase: 'backend', state: 'open', ...over }, NOW);

  it('skips offset rows before the limit applies, and truncated means rows remain after this page', () => {
    expect(page({ limit: 2, offset: 0 })).toMatchObject({ totalCount: 3, truncated: true });
    expect(page({ limit: 2, offset: 0 }).rows.map(r => r.cveId)).toEqual(['CVE-1', 'CVE-2']);
    expect(page({ limit: 2, offset: 1 }).rows.map(r => r.cveId)).toEqual(['CVE-2', 'CVE-3']);
    expect(page({ limit: 2, offset: 1 }).truncated).toBe(false);
    expect(page({ limit: 1, offset: 2 }).truncated).toBe(false);
    expect(page({ limit: 1, offset: 1 }).truncated).toBe(true);
  });

  it('an offset at or past the total returns no rows, the exact total and truncated false', () => {
    for (const offset of [3, 4, 999]) {
      const r = page({ offset });
      expect(r.rows).toEqual([]);
      expect(r.totalCount).toBe(3);
      expect(r.truncated).toBe(false);
    }
  });

  it('the repo facet ignores offset and sort', () => {
    const plain = page({});
    const paged = page({ offset: 2, limit: 1, sort: 'age:desc' });
    expect(paged.repos).toEqual(plain.repos);
    expect(paged.repos).toEqual([{ repo: 'o/r1', count: 3 }]);
  });
});

describe('listAlerts pages never repeat or skip a row (more than 500 matches, tied due dates)', () => {
  const rs = Array.from({ length: 7 }, (_, i) => R(i + 1));
  // 620 open alerts; only 3 distinct created dates, so due dates (and every other sort value) tie massively.
  const all = Array.from({ length: 620 }, (_, i) => A((i % 7) + 1, 100 + Math.floor(i / 7), {
    createdAt: `2026-09-${String(1 + (i % 3)).padStart(2, '0')}T00:00:00Z`,
    severity: i % 5 === 0 ? 'high' as const : 'critical' as const,
  }));
  const reversed = [...all].reverse();
  const key = (r: AlertRow) => `${r.repo}#${r.cveId}`;
  function walk(input: typeof all, sort: AlertSortSpec | undefined, limit: number): string[] {
    const out: string[] = [];
    for (let offset = 0; ; offset += limit) {
      const r = listAlerts(input, rs, { codebase: 'backend', state: 'open', limit, offset, sort }, NOW);
      expect(r.totalCount).toBe(620);
      out.push(...r.rows.map(key));
      if (!r.truncated) break;
    }
    return out;
  }

  it('limit 500 (the cap) then the remaining 120', () => {
    const first = listAlerts(all, rs, { codebase: 'backend', state: 'open', limit: 5000 }, NOW);
    expect(first.rows).toHaveLength(500);
    expect(first.truncated).toBe(true);
    const second = listAlerts(all, rs, { codebase: 'backend', state: 'open', limit: 5000, offset: 500 }, NOW);
    expect(second.rows).toHaveLength(120);
    expect(second.truncated).toBe(false);
    expect(new Set([...first.rows, ...second.rows].map(key)).size).toBe(620);
  });

  it.each([undefined, ...ALERT_SORT_KEYS.flatMap(k => [`${k}:asc` as const, `${k}:desc` as const])])('sort=%s: 100-row pages cover all 620 alerts exactly once, in an order independent of the input order', (sort) => {
    const forward = walk(all, sort, 100);
    expect(forward).toHaveLength(620);
    expect(new Set(forward).size).toBe(620);
    expect(walk(reversed, sort, 100)).toEqual(forward);
  });
});

describe('listAlerts pages never repeat or skip a row under Resolved and Open + resolved (more than 500 matches, tied values)', () => {
  const rs = Array.from({ length: 7 }, (_, i) => R(i + 1));
  // 620 alerts with three distinct created dates and two distinct resolved dates, so every sort value ties massively.
  // Under `resolved` all 620 are fixed. Under `all` every second alert is open and the rest are fixed (310 + 310).
  const make = (everyOtherOpen: boolean) => Array.from({ length: 620 }, (_, i) => A((i % 7) + 1, 100 + Math.floor(i / 7), {
    createdAt: `2026-09-${String(1 + (i % 3)).padStart(2, '0')}T00:00:00Z`,
    severity: i % 5 === 0 ? 'high' as const : 'critical' as const,
    ...(everyOtherOpen && i % 2 === 0 ? {} : { state: 'fixed' as const, resolvedAt: `2026-09-1${i % 2}T00:00:00Z` }),
  }));
  const key = (r: AlertRow) => `${r.repo}#${r.cveId}`;
  function walk(input: AlertFact[], state: 'resolved' | 'all', sort: AlertSortSpec | undefined): string[] {
    const out: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const r = listAlerts(input, rs, { codebase: 'backend', state, limit: 100, offset, sort }, NOW);
      expect(r.totalCount).toBe(620);
      out.push(...r.rows.map(key));
      if (!r.truncated) break;
    }
    return out;
  }

  // Revert: drop the tie-break (repository name, then alert number) from the comparator, or apply it only when the state is open.
  it.each([
    ...(['resolved', 'all'] as const).flatMap(state => [undefined, ...ALERT_SORT_KEYS.flatMap(k => [`${k}:asc` as const, `${k}:desc` as const])].map(sort => [state, sort] as const)),
  ])('state=%s sort=%s: 100-row pages cover all 620 alerts exactly once, in an order independent of the input order', (state, sort) => {
    const input = make(state === 'all');
    const forward = walk(input, state, sort);
    expect(forward).toHaveLength(620);
    expect(new Set(forward).size).toBe(620);
    expect(walk([...input].reverse(), state, sort)).toEqual(forward);
  });
});
```

Revert that fails these: deleting the `x.row.repo.localeCompare(y.row.repo) || x.number - y.number` tie-break in Step 3 (15 of these tests fail, because the pages depend on input order); making the null checks direction-dependent (`return sort.dir === 'asc' ? 1 : -1`) fails the `advisory:desc` and `due:desc` cases.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts --maxWorkers=3`
Expected: FAIL: the whole file fails to load (`Cannot find module '@/lib/vulnerabilities/alert-sort'`).

- [ ] **Step 3: Implement**

Create `src/lib/vulnerabilities/alert-sort.ts`:

```ts
// Client-safe (no imports): the alert list's sort contract, shared by the parser, the aggregation
// and the page, so the page can build `sort=<key>:<dir>` without pulling in server-only config.
export const ALERT_SORT_KEYS = ['severity', 'advisory', 'repo', 'age', 'due', 'state'] as const;
export type AlertSortKey = (typeof ALERT_SORT_KEYS)[number];
export type AlertSortDir = 'asc' | 'desc';
/** The one wire format: `<key>:<asc|desc>`, e.g. `due:asc`. */
export type AlertSortSpec = `${AlertSortKey}:${AlertSortDir}`;

export function parseAlertSort(raw: string): { key: AlertSortKey; dir: AlertSortDir } | null {
  const m = /^([a-z]+):(asc|desc)$/.exec(raw);
  if (!m || !(ALERT_SORT_KEYS as readonly string[]).includes(m[1])) return null;
  return { key: m[1] as AlertSortKey, dir: m[2] as AlertSortDir };
}
```

In `src/lib/vulnerabilities/aggregate.ts`:

1. Add after the `./time` import:

```ts
import { parseAlertSort } from './alert-sort';
import type { AlertSortKey, AlertSortSpec } from './alert-sort';
```

2. In `interface AlertFilters`, replace the final `limit?: number;` with:

```ts
  limit?: number;
  /** Rows to skip before `limit` applies (default 0). Paging is in memory, never SQL OFFSET. */
  offset?: number;
  /** `<key>:<asc|desc>`, validated by parseVulnFilters. Absent = soonest due, then severity, then newest. */
  sort?: AlertSortSpec;
```

3. Replace the whole `listAlerts` function (from `export function listAlerts(` up to the line before `// ---------- Baseline, delta, trend ----------`) with:

```ts
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1 };
const STATE_RANK: Record<AlertState, number> = { open: 0, fixed: 1, dismissed: 2, auto_dismissed: 3 };
/** An alert row paired with its alert number, which the row itself doesn't carry but the tie-break needs. */
interface Hit { row: AlertRow; number: number }

/** What each sort key compares. null sorts last in both directions. */
function sortValue(h: Hit, key: AlertSortKey): string | number | null {
  const r = h.row;
  switch (key) {
    case 'severity': return SEVERITY_RANK[r.severity];   // asc = critical first
    case 'advisory': return r.cveId ?? r.ghsaId;
    case 'repo': return r.repo;
    case 'age': return r.ageDays;                         // asc = youngest first
    case 'due': return r.dueDate;                         // YYYY-MM-DD; null = no SLA applies
    case 'state': return STATE_RANK[r.state];             // asc = open, fixed, dismissed, auto_dismissed
  }
}

function compareValues(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

/** The total order for the alert list: the chosen sort (or today's urgency order), then, always last
 * and never reversed, repository full name and alert number, so equal rows never swap between pages. */
function compareHits(x: Hit, y: Hit, sort: ReturnType<typeof parseAlertSort>): number {
  if (sort) {
    const a = sortValue(x, sort.key);
    const b = sortValue(y, sort.key);
    if (a === null && b !== null) return 1;   // nulls last, handled before direction is applied
    if (b === null && a !== null) return -1;
    if (a !== null && b !== null) {
      const c = compareValues(a, b);
      if (c !== 0) return sort.dir === 'asc' ? c : -c;
    }
  } else {
    // Most urgent first: soonest due, then severity, then newest.
    const urgency = (x.row.daysRemaining ?? 1e9) - (y.row.daysRemaining ?? 1e9)
      || (x.row.severity === y.row.severity ? 0 : x.row.severity === 'critical' ? -1 : 1)
      || y.row.createdAt.localeCompare(x.row.createdAt);
    if (urgency !== 0) return urgency;
  }
  return x.row.repo.localeCompare(y.row.repo) || x.number - y.number;
}

export function listAlerts(alerts: AlertFact[], repos: RepoFact[], f: AlertFilters, now: Date): AlertListResult {
  const byId = new Map(repos.map(r => [r.repoId, r]));
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const offset = Math.max(Math.floor(f.offset ?? 0), 0);
  const sort = f.sort ? parseAlertSort(f.sort) : null;
  const hits: Hit[] = [];
  let excludedByCodebase = 0;
  for (const a of alerts) {
    const r = byId.get(a.repoId);
    if (!r) continue;
    if (matches(a, r, f, now, false)) hits.push({ row: toAlertRow(a, r, now), number: a.number });
    else if (f.codebase !== 'all' && matches(a, r, f, now, true)) excludedByCodebase++;
  }
  hits.sort((x, y) => compareHits(x, y, sort));
  const rows = hits.slice(offset, offset + limit).map(h => h.row);
  return {
    rows, totalCount: hits.length, truncated: offset + rows.length < hits.length, excludedByCodebase,
    repos: repoFacet(alerts, byId, f, now),
  };
}

```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-aggregate.test.ts src/lib/__tests__/unit/vuln-owning-team-label.test.tsx src/lib/__tests__/unit/vuln-repo-rows-invariant.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS and no type errors. The existing test `listAlerts urgency order` keeps passing unchanged: its two tied rows now tie-break by alert number, which is the order the old stable sort happened to give.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/alert-sort.ts src/lib/vulnerabilities/aggregate.ts src/lib/__tests__/unit/vuln-aggregate.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: sort and offset for the alert list, with a total order"
```

---

### Task 1.8: `parseVulnFilters` validates `offset` and `sort`; `getAlerts` echoes them

**Files:**
- Modify: `src/lib/vulnerabilities/filters.ts`
- Modify: `src/lib/vulnerabilities/queries.ts` (`ALERT_FILTER_KEYS`)
- Test: `src/lib/__tests__/unit/vuln-filters.test.ts`, `src/lib/__tests__/unit/vuln-queries.test.ts`

**Interfaces:**
- Consumes: `ALERT_SORT_KEYS`, `parseAlertSort`, `AlertSortSpec` from `@/lib/vulnerabilities/alert-sort` (Task 1.7); `AlertFilters.offset/sort` (Task 1.7); `repoRowSql`, `alertSql`, `seedOk`, `f`, `NOW`, `q` in `vuln-queries.test.ts` (Task 1.4).
- Produces: `ParsedFilters` gains `offset?: number` and `sort?: AlertSortSpec` (they come from `AlertFilters`). `parseVulnFilters({ offset, sort })`: `offset` must match `^\d+$` and be a safe integer (error `offset must be a non-negative integer`); `sort` must be exactly `<key>:<asc|desc>` with a key from `ALERT_SORT_KEYS` (error `sort must be <key>:<asc|desc> with key one of severity, advisory, repo, age, due, state`). Both are left `undefined` when absent. `getAlerts(f).appliedFilters` includes `offset` and `sort` when given (echoed as validated; `sort` is the string).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/unit/vuln-filters.test.ts`:

```ts
describe('offset and sort (GLOOK-64)', () => {
  it('default to undefined, and accept a non-negative integer offset in string or number form', () => {
    expect(parseVulnFilters({})).toMatchObject({ ok: true, value: { offset: undefined, sort: undefined } });
    expect(parseVulnFilters({ offset: '0' })).toMatchObject({ ok: true, value: { offset: 0 } });
    expect(parseVulnFilters({ offset: '20' })).toMatchObject({ ok: true, value: { offset: 20 } });
    expect(parseVulnFilters({ offset: 40 })).toMatchObject({ ok: true, value: { offset: 40 } }); // MCP passes numbers
  });

  it.each(['-1', '1.5', '1e3', 'abc', ' ', '0x10', '9007199254740993'])('rejects offset %p', (offset) => {
    expect(parseVulnFilters({ offset })).toEqual({ ok: false, error: 'offset must be a non-negative integer' });
  });

  it.each(['severity', 'advisory', 'repo', 'age', 'due', 'state'])('accepts sort=%s:asc and :desc and echoes the validated string', (key) => {
    expect(parseVulnFilters({ sort: `${key}:asc` })).toMatchObject({ ok: true, value: { sort: `${key}:asc` } });
    expect(parseVulnFilters({ sort: `${key}:desc` })).toMatchObject({ ok: true, value: { sort: `${key}:desc` } });
  });

  it.each(['due', 'due:', 'due:up', ':asc', 'cvss:asc', 'Due:asc', 'due:ASC', 'due:asc:desc', 'due asc'])('rejects sort %p with the list of valid keys', (sort) => {
    expect(parseVulnFilters({ sort })).toEqual({
      ok: false, error: 'sort must be <key>:<asc|desc> with key one of severity, advisory, repo, age, due, state',
    });
  });
});
```

Append to `src/lib/__tests__/unit/vuln-queries.test.ts`:

```ts
describe('getAlerts offset and sort through the database', () => {
  it('pages without repeats, reports the exact total past the end, and echoes offset and sort in appliedFilters', async () => {
    await seedOk(); // o/r1 #1
    await alertSql(1, 2, 'critical', '2026-09-02T00:00:00Z');
    await alertSql(1, 3, 'high', '2026-09-03T00:00:00Z');
    const page1 = await q.getAlerts(f({ limit: 2, offset: 0, sort: 'severity:asc' }), NOW);
    const page2 = await q.getAlerts(f({ limit: 2, offset: 2, sort: 'severity:asc' }), NOW);
    expect(page1.rows).toHaveLength(2);
    expect(page1.truncated).toBe(true);
    expect(page2.rows).toHaveLength(1);
    expect(page2.truncated).toBe(false);
    expect(page2.rows[0].severity).toBe('high');
    expect(page1.totalCount).toBe(3);
    expect(page1.appliedFilters).toMatchObject({ limit: 2, offset: 0, sort: 'severity:asc' });
    const past = await q.getAlerts(f({ limit: 2, offset: 10 }), NOW);
    expect(past.rows).toEqual([]);
    expect(past.totalCount).toBe(3);
    expect(past.truncated).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-filters.test.ts src/lib/__tests__/unit/vuln-queries.test.ts --maxWorkers=3`
Expected: FAIL: `offset`/`sort` are not parsed (`value.offset` is `undefined`, bad values are accepted), and `appliedFilters` lacks `offset` and `sort`.

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/filters.ts`, add two imports after `import { CODEBASE_GROUPS } from './codebase';`:

```ts
import { ALERT_SORT_KEYS, parseAlertSort } from './alert-sort';
import type { AlertSortSpec } from './alert-sort';
```

Insert directly before the line `const overdue = parseBool('overdue', pick(input, 'overdue'));`:

```ts
  // GLOOK-64: paging and ordering of the alert list. offset is a plain non-negative integer string
  // (the regex rejects "-1", "1.5", "1e3" and blanks); sort is exactly `<key>:<asc|desc>` with a key
  // from the closed ALERT_SORT_KEYS list. Both are echoed in appliedFilters exactly as validated.
  const offsetRaw = pick(input, 'offset');
  if (offsetRaw !== undefined && (!/^\d+$/.test(offsetRaw) || !Number.isSafeInteger(Number(offsetRaw)))) {
    return { ok: false, error: 'offset must be a non-negative integer' };
  }
  const offset = offsetRaw === undefined ? undefined : Number(offsetRaw);
  const sortRaw = pick(input, 'sort');
  if (sortRaw !== undefined && parseAlertSort(sortRaw) === null) {
    return { ok: false, error: `sort must be <key>:<asc|desc> with key one of ${ALERT_SORT_KEYS.join(', ')}` };
  }
  const sort = sortRaw as AlertSortSpec | undefined;
```

In the returned `value`, replace `codebase, state, severity, baseline, limit,` with:

```ts
      codebase, state, severity, baseline, limit, offset, sort,
```

In `src/lib/vulnerabilities/queries.ts`, replace the `ALERT_FILTER_KEYS` constant with:

```ts
const ALERT_FILTER_KEYS = [
  'codebase', 'state', 'team', 'repo', 'severity', 'overdue', 'dueSoon', 'dueBefore', 'createdSince',
  'resolvedSince', 'dependencyScope', 'cve', 'ghsa', 'packageName', 'q', 'reopened', 'limit', 'offset', 'sort',
] as const;
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-filters.test.ts src/lib/__tests__/unit/vuln-queries.test.ts src/lib/__tests__/unit/vuln-api.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/filters.ts src/lib/vulnerabilities/queries.ts src/lib/__tests__/unit/vuln-filters.test.ts src/lib/__tests__/unit/vuln-queries.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: validate and echo offset and sort for the alerts query"
```

---

### Task 1.9: `getRepos` and `GET /api/vulnerabilities/repos`

**Files:**
- Modify: `src/lib/vulnerabilities/queries.ts` (import `computeRepoRows`; add `getRepos`)
- Create: `src/app/api/vulnerabilities/repos/route.ts`
- Test: `src/lib/__tests__/unit/vuln-queries.test.ts`, `src/lib/__tests__/unit/vuln-api.test.ts`

**Interfaces:**
- Consumes: `computeRepoRows` (Task 1.2); inside `queries.ts`: `prepare`, `failed`, `pickApplied`, `ParsedFilters`; `withFilters` from `src/app/api/vulnerabilities/_shared.ts`; `withRequestLog` from `@/lib/logger`; in the tests: `repoRowSql`, `alertSql`, `seedOk`, `f`, `NOW`, `q`, `db` (Task 1.4).
- Produces: `export async function getRepos(f: ParsedFilters, now?: Date)` returning `{ available: true; sync; appliedFilters: { codebase; team? }; configErrors; rows: RepoRow[] }`, or the same `Unavailable` / `UnknownFilter` payloads as every other query; the route `GET /api/vulnerabilities/repos` (wrapped in `withRequestLog`, uses `withFilters`: 404 when the feature is off, 400 on a bad parameter or an unknown team with `known_teams`). `limit` is parsed by the shared parser but not applied: the route returns every row.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/unit/vuln-queries.test.ts`:

```ts
describe('getRepos', () => {
  async function seedRepos() {
    await seedOk(); // o/r1: T1, backend, one open critical
    await repoRowSql(2, 'o/r2');                                                                   // no alerts
    await repoRowSql(3, 'o/r3', { team: 'T2', status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' });
    await alertSql(3, 1); await alertSql(3, 2, 'high');                                            // unmeasured, stored open alerts
    await repoRowSql(4, 'o/r4', { archived: 1, status: 'archived' }); await alertSql(4, 1);         // archived: never a row
    await repoRowSql(5, 'o/r5', { codebase: 'frontend' }); await alertSql(5, 1);                    // another codebase group
  }

  it('returns the envelope with every in-scope repo of the view: zero-alert repos listed, unmeasured last with stored counts, archived left out', async () => {
    await seedRepos();
    const r = await q.getRepos(f(), NOW);
    expect(Object.keys(r).sort()).toEqual(['appliedFilters', 'available', 'configErrors', 'rows', 'sync']);
    expect(r.available).toBe(true);
    expect(r.sync).toMatchObject({ lastSuccessfulAt: '2026-09-22T10:00:00Z', stale: false });
    expect(r.appliedFilters).toEqual({ codebase: 'backend' });
    expect(r.configErrors).toEqual([]);
    expect(r.rows.map((x: any) => x.fullName)).toEqual(['o/r1', 'o/r2', 'o/r3']);
    expect(r.rows[1].critical.open).toBe(0);
    expect(r.rows[2]).toMatchObject({
      team: 'T2', critical: { open: 1 }, high: { open: 1 },
      unmeasured: { status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' },
    });
  });

  it('honours codebase and team, echoes only those two filters, and ignores every other filter including limit', async () => {
    await seedRepos();
    expect((await q.getRepos(f({ codebase: 'frontend' }), NOW)).rows.map((x: any) => x.fullName)).toEqual(['o/r5']);
    expect((await q.getRepos(f({ codebase: 'all', team: 'T2' }), NOW)).rows.map((x: any) => x.fullName)).toEqual(['o/r3']);
    const noisy = await q.getRepos(f({ state: 'resolved', severity: 'high', repo: 'o/r1', limit: 1, offset: 5, overdue: true }), NOW);
    expect(noisy.appliedFilters).toEqual({ codebase: 'backend' });
    expect(noisy.rows).toHaveLength(3); // limit is not applied here; the MCP tool cuts rows itself
  });

  it('an unknown team returns the known teams; no successful sync and feature-off are unavailable', async () => {
    await seedRepos();
    expect(await q.getRepos(f({ team: 'Nope' }), NOW)).toEqual({ error: 'unknown team', known_teams: ['T1', 'T2'] });
    await db.execute('DELETE FROM vulnerability_syncs');
    q.__clearVulnFactsCache();
    expect(await q.getRepos(f(), NOW)).toMatchObject({ available: false, reason: 'No successful vulnerability sync yet.' });
    delete process.env.VULNERABILITIES_ORG;
    try {
      expect(await q.getRepos(f(), NOW)).toEqual({ available: false, reason: 'Vulnerability tracking is not enabled on this Glooker instance.', configErrors: [] });
    } finally {
      process.env.VULNERABILITIES_ORG = 'o';
    }
  });

  it('its rows agree with the summary pivot and with getAlerts, through the real database', async () => {
    await seedRepos();
    const rows = (await q.getRepos(f({ codebase: 'all' }), NOW)).rows;
    const pivot = (await q.getSummary(f({ codebase: 'all' }), NOW)).pivot;
    for (const t of pivot.rows) {
      const mine = rows.filter((x: any) => x.team === t.team);
      expect(mine.reduce((n: number, x: any) => n + x.critical.open, 0)).toBe(t.critical.open);
      expect(mine.reduce((n: number, x: any) => n + x.high.open, 0)).toBe(t.high.open);
      expect(mine.filter((x: any) => x.unmeasured).length).toBe(t.unmeasuredRepos);
    }
    for (const row of rows) {
      const listed = await q.getAlerts(f({ codebase: 'all', repo: row.fullName }), NOW);
      expect(listed.totalCount).toBe(row.critical.open + row.high.open);
    }
  });
});
```

In `src/lib/__tests__/unit/vuln-api.test.ts`:

1. In the `jest.mock('@/lib/vulnerabilities/queries', ...)` factory, replace `getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(), listSyncs: jest.fn(),` with:

```ts
    getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(), getRepos: jest.fn(), listSyncs: jest.fn(),
```

2. Replace the line `import { GET as coverage } from '@/app/api/vulnerabilities/coverage/route';` with:

```ts
import { GET as coverage } from '@/app/api/vulnerabilities/coverage/route';
import { GET as repos } from '@/app/api/vulnerabilities/repos/route';
```

3. Replace `import { getSummary, getTrend, getAlerts, getCoverage, listSyncs,` with `import { getSummary, getTrend, getAlerts, getCoverage, getRepos, listSyncs,` (keep the rest of that import line as is).

4. In `GETS`, replace `['summary', summary], ['trend', trend], ['alerts', alerts], ['coverage', coverage], ['syncs', syncs],` with:

```ts
  ['summary', summary], ['trend', trend], ['alerts', alerts], ['coverage', coverage], ['repos', repos], ['syncs', syncs],
```

5. In the test `every GET is readable by a non-admin`, replace `for (const fn of [getSummary, getTrend, getAlerts, getCoverage, listSyncs])` with `for (const fn of [getSummary, getTrend, getAlerts, getCoverage, getRepos, listSyncs])`.

6. Append at the end of the file:

```ts
describe('GET repos (GLOOK-64)', () => {
  it('returns the query layer envelope unchanged', async () => {
    const envelope = { available: true, sync: { stale: false }, appliedFilters: { codebase: 'backend' }, configErrors: [], rows: [{ fullName: 'acme/checkout-api' }] };
    (getRepos as jest.Mock).mockResolvedValue(envelope);
    const res = await repos(req('/api/vulnerabilities/repos'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(envelope);
  });

  it('passes codebase and team through the shared parser', async () => {
    (getRepos as jest.Mock).mockResolvedValue({ available: true });
    await repos(req('/api/vulnerabilities/repos?codebase=all&team=Payments'));
    expect((getRepos as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'all', team: 'Payments' });
  });

  it('400s with the known teams for an unknown team, and on a parameter the shared parser rejects', async () => {
    (getRepos as jest.Mock).mockResolvedValue({ error: 'unknown team', known_teams: ['Payments'] });
    const res = await repos(req('/api/vulnerabilities/repos?team=Nope'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown team', known_teams: ['Payments'] });
    // Same convention as coverage: parameters the route does not apply are still validated.
    expect((await repos(req('/api/vulnerabilities/repos?severity=medium'))).status).toBe(400);
    expect((await repos(req('/api/vulnerabilities/repos?codebase=mobile'))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-queries.test.ts src/lib/__tests__/unit/vuln-api.test.ts --maxWorkers=3`
Expected: FAIL: `q.getRepos is not a function`, and the API test file cannot resolve `@/app/api/vulnerabilities/repos/route`.

- [ ] **Step 3: Implement**

In `src/lib/vulnerabilities/queries.ts`, add `computeRepoRows` to the `./aggregate` import list (next to `computeCodebaseCounts`):

```ts
  computePivot, computeKpi, computeCoverage, computeRepoRows, computeCodebaseCounts, listAlerts, computeDelta, computeTrend, snapshotSets, pickBaseline, knownTeams, teamOf, setKey,
```

Add directly after the `getCoverage` function:

```ts
/**
 * GLOOK-64: one row per in-scope, non-archived repository in the view, with per-severity open /
 * overdue / due-soon counts (see computeRepoRows for the sum invariant against the team pivot).
 * Every row is returned: `limit` is parsed by the shared filter parser but deliberately not applied
 * here (the page needs all rows); the MCP tool applies its own limit around this function.
 */
export async function getRepos(f: ParsedFilters, now: Date = new Date()) {
  const p = await prepare(f, now);
  if (failed(p)) return p;
  return { available: true as const, sync: p.sync, appliedFilters: pickApplied(f, ['codebase', 'team']), configErrors: p.configErrors,
    rows: computeRepoRows(p.alerts, p.repos, { codebase: f.codebase, team: f.team, now }) };
}
```

Create `src/app/api/vulnerabilities/repos/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { getRepos } from '@/lib/vulnerabilities/queries';
import { withFilters } from '../_shared';

async function getHandler(req: NextRequest) { return withFilters(req, f => getRepos(f)); }
export const GET = withRequestLog(getHandler);
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-queries.test.ts src/lib/__tests__/unit/vuln-api.test.ts src/lib/__tests__/unit/logger-enforcement.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS (`logger-enforcement.test.ts` confirms the new route imports `withRequestLog`) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vulnerabilities/queries.ts src/app/api/vulnerabilities/repos/route.ts src/lib/__tests__/unit/vuln-queries.test.ts src/lib/__tests__/unit/vuln-api.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: getRepos and GET /api/vulnerabilities/repos"
```

---

### Task 1.10: MCP tool `list_vulnerability_repos` and description updates

**Files:**
- Modify: `src/lib/mcp/tools.ts`
- Test: `src/lib/__tests__/unit/vuln-mcp.test.ts`, `src/lib/__tests__/unit/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `getRepos` (Task 1.9); `parseVulnFilters` (Task 1.8: `offset`, `sort`); `vulnCall`, `VULN_COMMON`, `VULN_FILTER_PROPS`, `toSnake` in `tools.ts`; in the tests: `repo`, `alert`, `NOW`, `syncBlock`, `callTool`, `MCP_TOOLS` of `vuln-mcp.test.ts`.
- Produces:
  - tool `list_vulnerability_repos`, inputs `codebase`, `team` (from `VULN_FILTER_PROPS`) and `limit` (default 100, max 500). Output: `{ available, sync, applied_filters, config_errors, rows, total_count, truncated }` (snake_case; `rows[].critical|high` carry `open, overdue, due_soon, oldest_open_days, next_due`, and each row carries `full_name, team, codebase_group, unmeasured`). The cut by `limit` happens in the tool handler (`limitRepoRows`), never in `getRepos`. `total_count` is an addition to the spec's "rows and `truncated`": without it a caller cannot tell how many rows `truncated` hides.
  - `list_vulnerabilities` documents `offset` and `sort` and the facet-versus-rows difference; `get_vulnerability_coverage` gains `codebase` (input and description); `get_vulnerability_summary`'s description mentions `codebase_counts`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/unit/mcp-tools.test.ts`, in `EXPECTED`, replace

```ts
    'list_vulnerabilities', 'get_vulnerability_summary', 'get_vulnerability_trend', 'get_vulnerability_coverage',
  ];
```

with:

```ts
    'list_vulnerabilities', 'get_vulnerability_summary', 'get_vulnerability_trend', 'get_vulnerability_coverage',
    'list_vulnerability_repos',
  ];
```

In `src/lib/__tests__/unit/vuln-mcp.test.ts`:

1. In the `jest.mock('@/lib/vulnerabilities/queries', ...)` factory, replace `getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(),` with:

```ts
  getSummary: jest.fn(), getTrend: jest.fn(), getAlerts: jest.fn(), getCoverage: jest.fn(), getRepos: jest.fn(),
```

2. Replace the two imports

```ts
import { getAlerts, getSummary, getTrend, getCoverage } from '@/lib/vulnerabilities/queries';
```
```ts
import { listAlerts, computePivot, computeTrend, computeCoverage } from '@/lib/vulnerabilities/aggregate';
```

with:

```ts
import { getAlerts, getSummary, getTrend, getCoverage, getRepos } from '@/lib/vulnerabilities/queries';
```
```ts
import { listAlerts, computePivot, computeTrend, computeCoverage, computeRepoRows } from '@/lib/vulnerabilities/aggregate';
```

3. In `descriptions state the unit is the alert...`, replace the `for (const name of [...])` line with:

```ts
  for (const name of ['list_vulnerabilities', 'get_vulnerability_summary', 'get_vulnerability_trend', 'get_vulnerability_coverage', 'list_vulnerability_repos']) {
```

4. Rename `surfaces config_errors on all four vulnerability tools` to `surfaces config_errors on all five vulnerability tools`, and at the end of that test (after the `get_vulnerability_coverage` assertion) add:

```ts

  (getRepos as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, rows: [], configErrors });
  expect((await callTool('list_vulnerability_repos', {}) as any).config_errors).toEqual(configErrors);
```

5. In the exact-text test `VULN_FILTER_PROPS codebase/team descriptions and the coverage tool description match their exact shipped text`, replace

```ts
    + 'Repos with open alerts that need tagging (missing tier, codebase-type or team property), repos outside the configured tracking scope, and in-scope repos whose Dependabot status is unmeasured.',
  );
```

with:

```ts
    + 'Repos with open alerts that need tagging (missing tier, codebase-type or team property), repos outside the configured tracking scope, and in-scope repos whose Dependabot status is unmeasured. '
    + 'Filtered to the `codebase` group (default backend; pass `all` for every repository); a repository with no codebase type counts under other and all.',
  );
  expect(coverage.inputSchema.properties.codebase).toBe(list.inputSchema.properties.codebase);
```

6. Append at the end of the file:

```ts

// ---------- GLOOK-64: list_vulnerability_repos, offset/sort, coverage codebase ----------
describe('list_vulnerability_repos', () => {
  const repoRows = (n: number) => computeRepoRows(
    Array.from({ length: n }, (_, i) => ({ ...alert, repoId: i + 1, number: 1, htmlUrl: `u${i}` })),
    Array.from({ length: n }, (_, i) => ({ ...repo, repoId: i + 1, fullName: `o/r${String(i + 1).padStart(3, '0')}`, carriedResolvedCritical: 0 })),
    { codebase: 'backend', now: NOW });
  const envelope = (rows: unknown[]) => ({ available: true, sync: syncBlock, appliedFilters: { codebase: 'backend' }, configErrors: [], rows });

  it('emits snake_case rows from real computeRepoRows output, plus total_count and truncated', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(1)));
    const out: any = await callTool('list_vulnerability_repos', {});
    expect(Object.keys(out).sort()).toEqual(['applied_filters', 'available', 'config_errors', 'rows', 'sync', 'total_count', 'truncated']);
    expect(Object.keys(out.rows[0]).sort()).toEqual(['codebase_group', 'critical', 'full_name', 'high', 'team', 'unmeasured']);
    expect(Object.keys(out.rows[0].critical).sort()).toEqual(['due_soon', 'next_due', 'oldest_open_days', 'open', 'overdue']);
    expect(out.rows[0]).toMatchObject({ full_name: 'o/r001', team: 'T1', codebase_group: 'backend', unmeasured: null });
    expect(out.rows[0].critical).toMatchObject({ open: 1, overdue: null, due_soon: null, next_due: null }); // no SLA policy in this file's env
    expect(out.truncated).toBe(false);
    expect(out.total_count).toBe(1);
  });

  it('applies limit (default 100, max 500) and reports truncated; the underlying query is never given a limit to apply', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(120)));
    const dflt: any = await callTool('list_vulnerability_repos', {});
    expect(dflt.rows).toHaveLength(100);
    expect(dflt.truncated).toBe(true);
    expect(dflt.total_count).toBe(120);
    const two: any = await callTool('list_vulnerability_repos', { limit: 2 });
    expect(two.rows.map((r: any) => r.full_name)).toEqual(['o/r001', 'o/r002']);
    const big: any = await callTool('list_vulnerability_repos', { limit: 5000 });
    expect(big.rows).toHaveLength(120);
    expect(big.truncated).toBe(false);
    (getRepos as jest.Mock).mockResolvedValue(envelope(repoRows(600)));
    const capped: any = await callTool('list_vulnerability_repos', { limit: 5000 });
    expect(capped.rows).toHaveLength(500);
    expect(capped.truncated).toBe(true);
  });

  it('passes codebase and team to getRepos, and passes unavailable and unknown-team results through', async () => {
    (getRepos as jest.Mock).mockResolvedValue(envelope([]));
    await callTool('list_vulnerability_repos', { codebase: 'all', team: 'T1' });
    expect((getRepos as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'all', team: 'T1' });
    (getRepos as jest.Mock).mockResolvedValue({ available: false, reason: 'No successful vulnerability sync yet.', sync: { lastSuccessfulAt: null } });
    expect(await callTool('list_vulnerability_repos', {})).toEqual({ available: false, reason: 'No successful vulnerability sync yet.', sync: { last_successful_at: null } });
    (getRepos as jest.Mock).mockResolvedValue({ error: 'unknown team', known_teams: ['T1'] });
    expect(await callTool('list_vulnerability_repos', { team: 'Z' })).toEqual({ error: 'unknown team', known_teams: ['T1'] });
  });

  it('reports unavailable when the feature is off, without calling getRepos', async () => {
    delete process.env.VULNERABILITIES_ORG;
    const before = (getRepos as jest.Mock).mock.calls.length;
    try {
      expect(await callTool('list_vulnerability_repos', { codebase: 'mobile' }))
        .toEqual({ available: false, reason: 'Vulnerability tracking is not enabled on this Glooker instance.' });
      expect((getRepos as jest.Mock).mock.calls.length).toBe(before);
    } finally {
      process.env.VULNERABILITIES_ORG = 'o';
    }
  });

  it('its description says what an unmeasured row and a null overdue mean, and how it differs from list_vulnerabilities', () => {
    const t = MCP_TOOLS.find(x => x.name === 'list_vulnerability_repos')!;
    expect(t.description).toMatch(/`unmeasured` set/);
    expect(t.description).toMatch(/stored count, which may be out of date/);
    expect(t.description).toMatch(/`overdue: null`.*SLA is not active/);
    expect(t.description).toMatch(/list_vulnerabilities/);
    expect(t.description).toMatch(/`repos` facet follows all list filters/);
    expect(Object.keys(t.inputSchema.properties).sort()).toEqual(['codebase', 'limit', 'team']);
  });
});

describe('list_vulnerabilities offset and sort, and the summary and coverage additions', () => {
  it('forwards offset and sort to getAlerts as validated filters', async () => {
    (getAlerts as jest.Mock).mockResolvedValue({ available: true, rows: [], totalCount: 0, truncated: false, excludedByCodebase: 0 });
    await callTool('list_vulnerabilities', { offset: 20, sort: 'due:desc', limit: 10 });
    expect((getAlerts as jest.Mock).mock.calls[0][0]).toMatchObject({ offset: 20, sort: 'due:desc', limit: 10 });
    expect(await callTool('list_vulnerabilities', { sort: 'cvss:desc' })).toEqual({ error: expect.stringMatching(/sort must be/) });
    expect(await callTool('list_vulnerabilities', { offset: -1 })).toEqual({ error: expect.stringMatching(/offset/) });
  });

  it('documents offset and sort in the schema and states the facet-versus-rows difference in the description', () => {
    const t = MCP_TOOLS.find(x => x.name === 'list_vulnerabilities')!;
    expect(Object.keys(t.inputSchema.properties)).toEqual(expect.arrayContaining(['offset', 'sort']));
    expect(t.description).toMatch(/`offset`/);
    expect(t.description).toMatch(/severity, advisory, repo, age, due, state/);
    expect(t.description).toMatch(/always come last/);
    expect(t.description).toMatch(/use list_vulnerability_repos/);
  });

  it('get_vulnerability_coverage forwards codebase to getCoverage', async () => {
    (getCoverage as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, needsTagging: [], excludedByPolicy: [], unmeasured: [] });
    await callTool('get_vulnerability_coverage', { codebase: 'frontend', team: 'T1' });
    expect((getCoverage as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'frontend', team: 'T1' });
  });

  it('get_vulnerability_coverage without a codebase asks for backend, like every other tool (codebase=all is the opt-out)', async () => {
    (getCoverage as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, needsTagging: [], excludedByPolicy: [], unmeasured: [] });
    await callTool('get_vulnerability_coverage', {});
    expect((getCoverage as jest.Mock).mock.calls[0][0]).toMatchObject({ codebase: 'backend' });
    await callTool('get_vulnerability_coverage', { codebase: 'all' });
    expect((getCoverage as jest.Mock).mock.calls[1][0]).toMatchObject({ codebase: 'all' });
  });

  it('get_vulnerability_summary carries codebase_counts through toSnake', async () => {
    const codebaseCounts = { backend: { critical: 2, high: 1 }, frontend: { critical: 0, high: 0 }, shared: { critical: 0, high: 0 }, other: { critical: 0, high: 0 }, all: { critical: 2, high: 1 } };
    (getSummary as jest.Mock).mockResolvedValue({ available: true, sync: syncBlock, appliedFilters: {}, codebaseCounts });
    const s: any = await callTool('get_vulnerability_summary', {});
    expect(s.codebase_counts).toEqual(codebaseCounts);
    expect(MCP_TOOLS.find(x => x.name === 'get_vulnerability_summary')!.description).toMatch(/`codebase_counts`/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-mcp.test.ts src/lib/__tests__/unit/mcp-tools.test.ts --maxWorkers=3`
Expected: FAIL: `list_vulnerability_repos` is an unknown tool (`{ error: 'unknown tool: ... }`), the registry lists four vulnerability tools, and the exact coverage description differs.

- [ ] **Step 3: Implement**

In `src/lib/mcp/tools.ts`:

1. Replace the vulnerabilities import line with:

```ts
import { getSummary as getVulnSummary, getTrend as getVulnTrend, getAlerts as getVulnAlerts, getCoverage as getVulnCoverage, getRepos as getVulnRepos, REASON_DISABLED as VULN_REASON_DISABLED } from '@/lib/vulnerabilities/queries';
```

2. Insert directly above `export const MCP_TOOLS: McpTool[] = [`:

```ts
// GLOOK-64: the repos tool is the only vulnerability tool whose query returns every row and lets the
// tool layer cut it (the page's HTTP route needs all rows). `limit` defaults to 100, max 500, like
// list_vulnerabilities; an unavailable or error result passes through untouched.
function limitRepoRows(r: any, limit: number | undefined) {
  if (!r || !Array.isArray(r.rows)) return r;
  const n = Math.min(Math.max(limit ?? 100, 1), 500);
  return { ...r, rows: r.rows.slice(0, n), totalCount: r.rows.length, truncated: r.rows.length > n };
}

```

3. In the `list_vulnerabilities` entry, replace the `description:` expression with (the first line is the existing text ending in `...to help pick a \`repo\` filter. ` plus a trailing space, then two new lines):

```ts
    description: VULN_COMMON + 'Lists critical/high Dependabot alerts with SLA fields (due_date, days_remaining — negative means overdue, sla_policy_id), age, state, dismissed_reason and a link. Use for "our new CVEs" (created_since) and "what is due" (due_before / overdue). Returns total_count and truncated. The response also includes `repos` (per-repo counts under the current filters, ignoring `repo`) to help pick a `repo` filter. '
      + 'Page with `limit` and `offset` (offset default 0; `truncated` is true when offset + rows is below total_count) and order with `sort` = `<key>:<asc|desc>`, key one of severity, advisory, repo, age, due, state; rows without a value for the key (for example no due date) always come last, and ties are broken by repo then alert number, so pages never repeat or skip a row. '
      + 'Each row carries `last_reopened_at`. The `repos` facet follows every list filter (state, severity, overdue, ...) and is not affected by offset or sort, so it is not a per-repository open count: for open critical and high counts per repository, including repositories with none, use list_vulnerability_repos.',
```

and in the same entry's `inputSchema.properties`, replace the `limit` line with these three:

```ts
      limit: { type: 'number', description: 'default 100, max 500 (per page)' },
      offset: { type: 'number', description: 'rows to skip before limit applies; default 0' },
      sort: { type: 'string', description: 'severity|advisory|repo|age|due|state, then :asc or :desc (for example due:asc). Default: soonest due, then severity, then newest.' },
```

4. In the `get_vulnerability_summary` entry, replace the last description line

```ts
      + '`sla_policy_invalid` true means the SLA policy configuration is invalid and no SLA applies (so `sla_status` \'none\' does not mean "no policy"); `resolved_count_start_date` null means all time; when `resolved_count_invalid` is true, `resolved` and `pct_closed` are null.',
```

with:

```ts
      + '`sla_policy_invalid` true means the SLA policy configuration is invalid and no SLA applies (so `sla_status` \'none\' does not mean "no policy"); `resolved_count_start_date` null means all time; when `resolved_count_invalid` is true, `resolved` and `pct_closed` are null. '
      + '`codebase_counts` gives open critical and high counts for every codebase group (and `all`), ignoring the `codebase` filter but honouring `team`.',
```

5. Replace the whole `get_vulnerability_coverage` entry's `description` end and `inputSchema` (keep `name` and `handler`):

```ts
    description: VULN_COMMON + 'Repos with open alerts that need tagging (missing tier, codebase-type or team property), repos outside the configured tracking scope, and in-scope repos whose Dependabot status is unmeasured. '
      + 'Filtered to the `codebase` group (default backend; pass `all` for every repository); a repository with no codebase type counts under other and all.',
    inputSchema: { type: 'object', properties: { codebase: VULN_FILTER_PROPS.codebase, team: VULN_FILTER_PROPS.team } },
```

6. Add a fifth entry at the end of `MCP_TOOLS`, after the `get_vulnerability_coverage` entry (inside the array):

```ts
  {
    name: 'list_vulnerability_repos',
    description: VULN_COMMON + 'Lists every tracked, non-archived repository in the scope with its owning team, codebase group and, per severity (`critical`, `high`), `open` alerts, `overdue` and `due_soon` counts, `oldest_open_days` and `next_due` ({date, days_remaining}: the earliest due date that is not yet overdue). '
      + 'Repositories with no open alerts are included, with `open: 0`. `overdue: null` (and `due_soon`, `next_due` null) means that severity\'s SLA is not active, not zero. '
      + 'A row with `unmeasured` set (Dependabot status `error` or `dependabot-off`) has `open` equal to the stored count, which may be out of date: report it as unknown, not as a verified number. '
      + 'Rows are ordered by open critical, then open high, then repo name, with unmeasured rows last; for each team and severity the rows sum to that team\'s open, overdue and due_soon in get_vulnerability_summary. '
      + 'Differs from list_vulnerabilities: that tool\'s `repos` facet follows all list filters (state, severity, overdue, ...) and counts the alerts matching them, while these rows always give OPEN counts per repository for the codebase and team scope. '
      + 'Returns `rows`, `total_count` and `truncated` (true when there are more rows than `limit`).',
    inputSchema: { type: 'object', properties: {
      codebase: VULN_FILTER_PROPS.codebase, team: VULN_FILTER_PROPS.team,
      limit: { type: 'number', description: 'default 100, max 500' },
    } },
    handler: (a) => vulnCall(a, async f => limitRepoRows(await getVulnRepos(f), f.limit)),
  },
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-mcp.test.ts src/lib/__tests__/unit/mcp-tools.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools.ts src/lib/__tests__/unit/vuln-mcp.test.ts src/lib/__tests__/unit/mcp-tools.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: MCP list_vulnerability_repos, offset/sort docs, coverage codebase"
```

---

### Task 1.11: Mock fixtures for the new states (zero-alert repo, unmeasured with stored alerts, 13 owning teams plus Unassigned)

**Files:**
- Modify: `scripts/mock-identities.ts` (`MockVulnRepo` fields, 12 new repositories)
- Modify: `src/lib/github-mock.ts` (`noAlerts` support in `mockAlerts`)
- Modify: `scripts/seed-vulnerabilities.ts` (post-sync unmeasured flag)
- Test: `src/lib/__tests__/unit/vuln-mock-provider.test.ts`, `src/lib/__tests__/unit/vuln-seed-repo-rows.test.ts` (new)

**Interfaces:**
- Consumes: `getRepos`, `getSummary`, `getAlerts`, `__clearVulnFactsCache` from `@/lib/vulnerabilities/queries` (Tasks 1.4, 1.9); `seedVulnerabilities(db)` from `scripts/seed-vulnerabilities`; `createMockGitHubProvider` from `@/lib/github-mock`.
- Produces:
  - `MockVulnRepo` gains optional `noAlerts?: boolean` and `unmeasuredAfterSeed?: 'error' | 'dependabot-off'`.
  - `MOCK_VULN_REPOS` gains ids 9011 to 9022: ten repositories with ten new invented owning teams (`Payments`, `Search`, `Identity`, `Messaging`, `Observability`, `Analytics`, `Media`, `Storage`, `Mobile`, `Compliance`), `quiet-service` (9021, `Platform`, `noAlerts: true`: a measured repo with nothing open), and `stale-scanner` (9022, `Search`, `unmeasuredAfterSeed: 'dependabot-off'`). With the existing teams the Backend view lists 13 owning teams plus `Unassigned`, which is 14 pivot rows (more than the page's 12 distinct colours).
  - These owning teams are repository property values only. They are **not** added to `MOCK_TEAMS` (people-based teams): the repository `team` property is never joined to Glooker's `teams`.
  - **Why `stale-scanner` is flagged by the seed and not by the mock sweep:** `sync.ts` writes status `ok` for every repo that has alerts in the sweep and only status-checks zero-alert repos, so no sweep can produce "unmeasured with stored alerts". `seedVulnerabilities` therefore runs one `UPDATE vulnerability_repos SET dependabot_status ...` after its syncs. The next sync run in mock mode resets that repo to `ok`. SLA states are not covered by these fixtures: `npm run dev:mock` already sets both policies active since 2020; pending/none/invalid are covered by unit fixtures and the policy env var.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/unit/vuln-mock-provider.test.ts`:

```ts

// GLOOK-64 fixtures: a repo with nothing open, and one that stays flagged unmeasured while keeping alerts.
it('quiet-service returns zero alerts but a healthy status, so a sync leaves it measured with nothing open', async () => {
  const p = createMockGitHubProvider();
  const repos = await p.listOrgReposForVulns('mock-org');
  const quiet = repos.find(r => r.fullName.endsWith('quiet-service'))!;
  const s1 = await p.listOrgDependabotAlerts('mock-org');
  expect(s1.some(a => a.repoId === quiet.repoId)).toBe(false);
  expect(await p.getRepoDependabotStatus(quiet.fullName)).toEqual({ status: 'ok' });
});

it('stale-scanner returns alerts like any other repo; the seed, not the sweep, marks it unmeasured afterwards', async () => {
  const p = createMockGitHubProvider();
  const repos = await p.listOrgReposForVulns('mock-org');
  const stale = repos.find(r => r.fullName.endsWith('stale-scanner'))!;
  const s1 = await p.listOrgDependabotAlerts('mock-org');
  expect(s1.some(a => a.repoId === stale.repoId && a.state === 'open')).toBe(true);
  expect(await p.getRepoDependabotStatus(stale.fullName)).toEqual({ status: 'ok' });
});

it('the owning teams are repository property values, not people teams', async () => {
  const { MOCK_VULN_REPOS, MOCK_TEAMS } = await import('../../../../scripts/mock-identities');
  const owning = new Set(MOCK_VULN_REPOS.filter(r => r.serviceTier === 'production' && r.team).map(r => r.team));
  expect(owning.size).toBeGreaterThanOrEqual(13); // more than the page's 12 distinct colours
  for (const t of ['Payments', 'Search', 'Identity', 'Messaging', 'Observability', 'Analytics', 'Media', 'Storage', 'Mobile', 'Compliance']) {
    expect(MOCK_TEAMS.map(m => m.name)).not.toContain(t);
  }
});
```

Create `src/lib/__tests__/unit/vuln-seed-repo-rows.test.ts`:

```ts
// GLOOK-64: the dev:mock fixtures. Runs the real seed (two syncs against the mock GitHub provider,
// then the unmeasured-with-alerts flag) into a throwaway SQLite database, and checks that the seeded
// data exercises every repository-row state AND that the repository rows still sum to the team pivot.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) })); // queries → scheduler → github.ts
import fs from 'fs'; import os from 'os'; import path from 'path';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';

// The values `npm run dev:mock` sets: both severities have an SLA that took effect in 2020, and the
// Backend group claims both `backend` and `api` repos.
const DEV_MOCK_ENV = {
  VULNERABILITIES_ORG: 'mock-org',
  VULNERABILITIES_SLA_POLICY: JSON.stringify([
    { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 7 },
    { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 9 },
  ]),
  VULN_CODEBASE_GROUPS: JSON.stringify({ backend: ['backend', 'api'], frontend: ['frontend'], shared: ['shared'] }),
  SQLITE_PATH: '', DB_TYPE: 'sqlite',
} as Record<string, string>;
const prior: Record<string, string | undefined> = {};
let dbPath: string;
let q: any;
const f = (over: object = {}) => ({ codebase: 'backend', state: 'open', baseline: 'last', ...over });

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-seed-vuln-')), 'test.db');
  DEV_MOCK_ENV.SQLITE_PATH = dbPath;
  for (const k of Object.keys(DEV_MOCK_ENV)) { prior[k] = process.env[k]; process.env[k] = DEV_MOCK_ENV[k]; }
  __clearVulnConfigCache();
  const db = (await import('@/lib/db')).default;
  q = await import('@/lib/vulnerabilities/queries');
  const { seedVulnerabilities } = await import('../../../../scripts/seed-vulnerabilities');
  await seedVulnerabilities(db);
  q.__clearVulnFactsCache();
}, 60_000);
afterAll(() => {
  for (const k of Object.keys(DEV_MOCK_ENV)) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
  __clearVulnConfigCache();
  try { fs.unlinkSync(dbPath); } catch { /* the file may already be gone */ }
});

it('seeds every repository-row state the page needs', async () => {
  const { rows } = await q.getRepos(f({ codebase: 'all' }));
  const byName = (n: string) => rows.find((r: any) => r.fullName === `mock-org/${n}`);
  // a repo with nothing open: listed, with zero counts
  expect(byName('quiet-service')).toMatchObject({ critical: { open: 0 }, high: { open: 0 }, unmeasured: null });
  // an unmeasured repo that still has stored open alerts: the stored count is carried, the status says it may be stale
  const stale = byName('stale-scanner');
  expect(stale.unmeasured).toEqual({ status: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' });
  expect(stale.critical.open + stale.high.open).toBeGreaterThan(0);
  // an unmeasured repo with no alerts at all, and unmeasured rows come last
  expect(byName('flaky-service').unmeasured).toMatchObject({ status: 'error' });
  const firstUnmeasured = rows.findIndex((r: any) => r.unmeasured);
  expect(rows.slice(firstUnmeasured).every((r: any) => r.unmeasured)).toBe(true);
  // an archived repo is never a row
  expect(byName('legacy-billing')).toBeUndefined();
  // both SLAs are active in dev:mock, so the overdue columns exist
  expect(rows.some((r: any) => r.critical.overdue !== null && r.high.overdue !== null)).toBe(true);
});

it('seeds 13 owning teams plus Unassigned in the Backend view: 14 pivot rows, more than the 12 the page can colour', async () => {
  const { pivot } = await q.getSummary(f());
  expect(pivot.rows).toHaveLength(14);
  expect(pivot.rows.map((t: any) => t.team)).toEqual(expect.arrayContaining(['Payments', 'Compliance', 'Unassigned']));
});

describe('the seeded repository rows sum to the team pivot', () => {
  const combos = [['backend', undefined], ['all', undefined], ['backend', 'Search'], ['all', 'Platform'], ['all', 'Unassigned'], ['frontend', undefined]] as const;
  it.each(combos)('codebase=%s team=%s', async (codebase, team) => {
    const { rows: teams } = (await q.getSummary(f({ codebase, team }))).pivot;
    const repoRows = (await q.getRepos(f({ codebase, team }))).rows;
    expect(teams.length).toBeGreaterThan(0);
    for (const t of teams) {
      const mine = repoRows.filter((r: any) => r.team === t.team);
      for (const sev of ['critical', 'high'] as const) {
        for (const fig of ['open', 'overdue', 'dueSoon'] as const) {
          expect(t[sev][fig]).not.toBeNull(); // dev:mock activates both SLAs
          expect(mine.reduce((n: number, r: any) => n + r[sev][fig], 0)).toBe(t[sev][fig]);
        }
      }
      expect(mine.filter((r: any) => r.unmeasured).length).toBe(t.unmeasuredRepos);
    }
  });

  it("independent cross-check: each row's open equals getAlerts' open total for that repo, unmeasured repos included", async () => {
    const rows = (await q.getRepos(f({ codebase: 'all' }))).rows;
    for (const row of rows) {
      const listed = await q.getAlerts(f({ codebase: 'all', repo: row.fullName }));
      expect(listed.totalCount).toBe(row.critical.open + row.high.open);
    }
  });

  it('codebaseCounts[c] equals the pivot total open for codebase c', async () => {
    const { codebaseCounts } = await q.getSummary(f());
    for (const c of ['backend', 'frontend', 'shared', 'other', 'all']) {
      const { pivot } = await q.getSummary(f({ codebase: c }));
      expect(codebaseCounts[c]).toEqual({ critical: pivot.total.critical.open, high: pivot.total.high.open });
    }
  });
});
```

(The invariant's third part, unmeasured rows counting to `unmeasuredRepos`, holds for the seeded data because the sync writes status `archived` for archived repos, so no archived repo is counted as unmeasured by the pivot. If a future fixture stores an archived repo with status `error`, `computePivot` would count it while `computeRepoRows` excludes it.)

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-mock-provider.test.ts src/lib/__tests__/unit/vuln-seed-repo-rows.test.ts --maxWorkers=3`
Expected: FAIL: `quiet-service`/`stale-scanner` are not in the mock repository list (`repos.find(...)` is `undefined`), the owning-team count is 4, and the seeded `getRepos` has no `quiet-service` row.

- [ ] **Step 3: Implement**

In `scripts/mock-identities.ts`, replace the `MockVulnRepo` interface and the `MOCK_VULN_REPOS` array (from the line `// GLOOK-43: repos for vulnerability mock data.` through the closing `];` of `MOCK_VULN_REPOS`, directly above `export interface MockTeam {`) with:

```ts
// GLOOK-43: repos for vulnerability mock data. `team` is the repo custom property — a string, not a teams row,
// so the owning teams below are deliberately NOT in MOCK_TEAMS (people-based teams) and never joined to it.
export interface MockVulnRepo {
  repoId: number; name: string; team: string | null; serviceTier: string | null; codebaseType: string | null;
  archived: boolean; statusCheck?: 'error' | 'dependabot-off';
  /** GLOOK-64: the mock sweep returns no alerts for this repo, but its status check is healthy (a repo with nothing open). */
  noAlerts?: boolean;
  /** GLOOK-64: after the seed's syncs ran, flag this repo unmeasured WHILE KEEPING its stored alerts.
   * A sync never produces that state on its own (a repo with alerts in the sweep is written 'ok'), so
   * seed-vulnerabilities.ts sets it with one UPDATE; the next mock-mode sync resets it to 'ok'. */
  unmeasuredAfterSeed?: 'error' | 'dependabot-off';
}
export const MOCK_VULN_REPOS: MockVulnRepo[] = [
  { repoId: 9001, name: 'api-service',     team: 'Platform', serviceTier: 'production',      codebaseType: 'backend',        archived: false },
  { repoId: 9002, name: 'billing-service', team: 'Growth',   serviceTier: 'production',      codebaseType: 'api',            archived: false },
  { repoId: 9003, name: 'web-app',         team: 'Frontend', serviceTier: 'production',      codebaseType: 'frontend',       archived: false },
  { repoId: 9004, name: 'shared-lib',      team: 'Platform', serviceTier: 'production',      codebaseType: 'shared',         archived: false },
  { repoId: 9005, name: 'legacy-billing',  team: 'Growth',   serviceTier: 'production',      codebaseType: 'backend',        archived: true },
  { repoId: 9006, name: 'untagged-tool',   team: null,       serviceTier: null,              codebaseType: null,             archived: false },
  { repoId: 9007, name: 'research-bench',  team: 'Research', serviceTier: 'non-production',  codebaseType: 'backend',        archived: false },
  { repoId: 9008, name: 'flaky-service',   team: 'Research', serviceTier: 'production',      codebaseType: 'backend',        archived: false, statusCheck: 'error' },
  { repoId: 9009, name: 'orphan-service',  team: null,       serviceTier: 'production',      codebaseType: 'backend',        archived: false },
  // GLOOK-43: a repo with Dependabot alerts turned off — unmeasured like
  // flaky-service, but must never show up as a sync issue or make a run partial.
  { repoId: 9010, name: 'silent-service',  team: 'Platform', serviceTier: 'production',      codebaseType: 'backend',        archived: false, statusCheck: 'dependabot-off' },
  // GLOOK-64: ten more owning teams, so the Backend view lists more than 12 (the page gives the top 12 their own
  // colour and groups the rest as "Other"). Names are invented.
  { repoId: 9011, name: 'checkout-api',      team: 'Payments',      serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9012, name: 'search-indexer',    team: 'Search',        serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9013, name: 'identity-gateway',  team: 'Identity',      serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9014, name: 'notification-hub',  team: 'Messaging',     serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9015, name: 'metrics-collector', team: 'Observability', serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9016, name: 'etl-runner',        team: 'Analytics',     serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9017, name: 'media-transcoder',  team: 'Media',         serviceTier: 'production', codebaseType: 'api',     archived: false },
  { repoId: 9018, name: 'storage-broker',    team: 'Storage',       serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9019, name: 'mobile-bff',        team: 'Mobile',        serviceTier: 'production', codebaseType: 'backend', archived: false },
  { repoId: 9020, name: 'policy-engine',     team: 'Compliance',    serviceTier: 'production', codebaseType: 'backend', archived: false },
  // GLOOK-64: a repo with nothing open, to exercise the greyed zero-alert rows.
  { repoId: 9021, name: 'quiet-service',     team: 'Platform',      serviceTier: 'production', codebaseType: 'backend', archived: false, noAlerts: true },
  // GLOOK-64: unmeasured WITH stored alerts: the open count is unknown, not zero.
  { repoId: 9022, name: 'stale-scanner',     team: 'Search',        serviceTier: 'production', codebaseType: 'backend', archived: false, unmeasuredAfterSeed: 'dependabot-off' },
];

```

In `src/lib/github-mock.ts`, in `mockAlerts`, replace

```ts
    // flaky-service and silent-service return no alerts, so the sync status-checks them and marks
    // them unmeasured (error and dependabot-off respectively).
    if (r.statusCheck === 'error' || r.statusCheck === 'dependabot-off') continue;
```

with:

```ts
    // flaky-service and silent-service return no alerts, so the sync status-checks them and marks
    // them unmeasured (error and dependabot-off respectively). A `noAlerts` repo returns none too,
    // but its status check is healthy, so it is measured and simply has nothing open.
    if (r.statusCheck === 'error' || r.statusCheck === 'dependabot-off' || r.noAlerts) continue;
```

In `scripts/seed-vulnerabilities.ts`, insert directly above the line `  // The LATEST run failed → the page shows the failed banner while serving the last good run.`:

```ts
  // GLOOK-64: flag the repos the fixture wants unmeasured-with-stored-alerts. This runs AFTER the syncs on
  // purpose: a sync writes 'ok' for any repo that has alerts in its sweep, so it can never produce this
  // state itself. The next mock-mode sync resets these repos to 'ok'.
  for (const r of MOCK_VULN_REPOS.filter(x => x.unmeasuredAfterSeed)) {
    const detail = r.unmeasuredAfterSeed === 'error' ? 'HTTP 500: mock status check failure' : 'Dependabot alerts are disabled for this repository.';
    await db.execute(
      `UPDATE vulnerability_repos SET dependabot_status = ?, dependabot_status_detail = ? WHERE org = ? AND repo_id = ?`,
      [r.unmeasuredAfterSeed, detail, MOCK_ORG, r.repoId]);
  }
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-mock-provider.test.ts src/lib/__tests__/unit/vuln-seed-repo-rows.test.ts src/lib/__tests__/unit/seed-vulnerabilities.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS (20 tests at plan time: 8 in the provider file, 10 in the new seed file, 2 in `seed-vulnerabilities.test.ts`) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/mock-identities.ts scripts/seed-vulnerabilities.ts src/lib/github-mock.ts src/lib/__tests__/unit/vuln-mock-provider.test.ts src/lib/__tests__/unit/vuln-seed-repo-rows.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: mock fixtures for zero-alert, unmeasured-with-alerts and 13 owning teams plus Unassigned"
```

---

### Wave 1 test rewrite map

| Old test file and test | Fate | Intent that must survive |
|---|---|---|
| `vuln-queries.test.ts` › `getCoverage success path flags an untagged repo needing tagging` | Updated in place (Task 1.5): it now asks for `codebase: 'all'`, and adds Other and Backend assertions. | An in-scope repo with open alerts and a missing property still shows under "needs tagging". The fixture repo has no codebase type, which the new default Backend scope would hide. |
| `vuln-queries.test.ts` › `appliedFilters echoes only the fields each endpoint consumes` | Updated in place (Task 1.5): coverage echoes `{ codebase, team }`. | Each endpoint echoes exactly the filters it applies. |
| `vuln-mcp.test.ts` › `emits snake_case keys everywhere...` | Updated in place (Task 1.6): the exact row key list gains `last_reopened_at`. | MCP row keys are exactly the documented snake_case names. |
| `vuln-mcp.test.ts` › `VULN_FILTER_PROPS codebase/team descriptions and the coverage tool description match their exact shipped text` | Updated in place (Task 1.10): new pinned coverage text, plus a check that coverage shares the `codebase` schema object. | No stray vocabulary enters the shared descriptions; the pinned text is the regression guard. |
| `vuln-mcp.test.ts` › `descriptions state the unit is the alert...` and `surfaces config_errors on all four vulnerability tools` | Extended to five tools (Task 1.10). | Every vulnerability tool tells agents to check `available` and `stale` and carries `config_errors`. |
| `mcp-tools.test.ts` › `registers exactly the expected tools with unique names` | Updated in place (Task 1.10): `list_vulnerability_repos` joins `EXPECTED`. | The registry contains exactly the shipped tools, with unique names. |
| `vuln-api.test.ts` (mock factory, `GETS`, non-admin read test) | Updated in place (Task 1.9): `getRepos` mocked, `repos` joins `GETS`. | Every GET route 404s when the feature is off and is readable by a non-admin. |
| `vuln-alerts-table.test.tsx` (`alertRow` fixture) | Fixture updated (Task 1.6): `lastReopenedAt: null`. No assertion changes. The file is retired in Wave 2 with `alerts-table.tsx`. | The fixture must satisfy `AlertRow` or `npx tsc --noEmit` and `next build` fail. |
| `vuln-aggregate.test.ts` › `listAlerts urgency order...` | Unchanged and still green: its two tied rows now tie-break by alert number, the order the old stable sort gave. | Default order is soonest due, then severity, then newest. |
| `vuln-owning-team-label.test.tsx`, `vuln-content-*.test.tsx`, `vuln-coverage-panel.test.tsx` | Unchanged. They mock `/api/vulnerabilities/coverage` by URL, so the new `codebase` default does not reach them; Wave 2 rewrites them with the page. | n/a in this wave. |

### Wave 1 exit check

Run from the repository root.

1. `npx tsc --noEmit` returns no output. (Run `npx tsc --noEmit` before the full suite: `next build` type-checks test files, and ts-jest does not.)
2. `npx jest src/lib/__tests__/unit/vuln src/lib/__tests__/unit/mcp-tools.test.ts src/lib/__tests__/unit/logger-enforcement.test.ts src/lib/__tests__/unit/seed-vulnerabilities.test.ts --maxWorkers=3` passes. At plan time this command matched 51 suites and 645 tests including the new ones.
3. `npx jest --maxWorkers=3` passes in full (at plan time, against the tree this wave was built on: 210 suites, 2219 tests; counts will differ if `main` moved).
4. The internal-name guard on the whole wave: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff origin/main...HEAD | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1` succeeds (grep finds nothing). `INTERNAL_NAMES` is the maintainers' private list of company, host and people names and real policy values; it lives in the implementer's environment and is never written in this plan or in the repository. The invented names used here are `acme/*`, `o/*`, `mock-org`, and the owning teams `Payments`, `Search`, `Identity`, `Messaging`, `Observability`, `Analytics`, `Media`, `Storage`, `Mobile`, `Compliance`.
5. `git diff origin/main...HEAD -- src/lib/vulnerabilities/aggregate.ts` shows no change inside `pickBaseline`, `snapshotSets`, `pickTrendSets`, `computeDelta`, `computeTrend` (Decision 7).
6. `git diff origin/main...HEAD --stat -- src/lib/vulnerabilities/sync.ts` prints nothing (the sync is untouched: two-phase sync, `missing_since`, the completeness guard and `withheld_since` keep their behaviour).
7. `rm -rf .next && npm run build` succeeds (adds the repos route; not run during planning because Wave 1 does not touch any page).
8. Documentation: this wave edits no documentation file. `docs/vulnerabilities-page.md` and the root `CLAUDE.md` are updated in Wave 5, once the whole page exists.

## Wave 2: Page shell, state and data modules, URL state, styling tokens

**Goal.** Replace the page's composer (`vulnerabilities-content.tsx`) with a thin one built on four new foundations: the theme tokens and utilities (Task 2.1), the layout constants (2.2), the URL/list state (2.4, 2.6) and the data hook that owns every SWR key (2.7). On top of them this wave builds the page-wide chrome: the sticky filter bar with view tabs (2.8), the coverage drawer (2.9) and the header children (2.10). It also creates the six **slot modules** that Waves 3 and 4 fill (2.11). After this wave the page is fully navigable: filters, view switching, header, drawer, error and recovery states all work, and the Overview and Alerts views render reserved-height boxes where Waves 3 and 4 put their content. The old `team-pivot.tsx`, `trend-chart.tsx` and `alerts-table.tsx` are left in place and untouched (Waves 3 and 4 delete them with their tests); `coverage-panel.tsx` and `policy-panel.tsx` are deleted here. Waves 1-5 ship as one PR; do not merge or deploy between Wave 2 and Wave 4, because the page is a shell until Waves 3-4 fill it.

**Assumptions about Wave 1 (state them when reviewing).** Wave 1 delivers exactly the spec's Architecture sections 1 to 3. This wave therefore assumes:

- `RepoRow` and `RepoSevCell` are exported from `src/lib/vulnerabilities/aggregate.ts` (the spec shows them under "Data layer (`aggregate.ts`)" but names no file; `SevCell`, `TeamRow` and `AlertRow` already live there).
- `getRepos` is exported from `src/lib/vulnerabilities/queries.ts` and returns `{ available: true, sync, appliedFilters, configErrors, rows }`, with `appliedFilters` echoing `codebase` and (when set) `team`.
- `GET /api/vulnerabilities/repos`, the summary's `codebaseCounts`, the alerts `offset` and `sort` parameters and the coverage `codebase` parameter exist as the spec defines them.
- `src/lib/vulnerabilities/alert-sort.ts` exports `ALERT_SORT_KEYS`, `AlertSortKey`, `AlertSortDir`, `AlertSortSpec` and `parseAlertSort` (Wave 1, no imports, so client code may import values from it), and `aggregate.ts` exports `CodebaseCounts`. This wave imports and re-exports those names; it never redefines them.

Client code in this wave imports server modules with `import type` only (`aggregate.ts` pulls in `config.ts`, which reads `process.env`).

### Wave 2 public interface (the contract for Waves 3 and 4)

Everything below lives in `src/app/vulnerabilities/` unless a path says otherwise. Task numbers say where each name is created. Waves 3 and 4 may rely on these names and shapes exactly.

**Slot modules (created as stubs in Task 2.11; Waves 3 and 4 MODIFY them, they do not create them).** Each default-exports a component taking `SecurityViewProps`.

| File | Default export | Fills | Wave | Carries (the element's `data-testid` = the constant that sizes it) |
|---|---|---|---|---|
| `kpi-tiles.tsx` | `KpiTiles` | Overview KPI row, `KPI_ROW_H` (178px) | 3 | outer `kpi-tiles` height = `KPI_ROW_H` |
| `ownership-card.tsx` | `OwnershipCard` | Overview team table and repositories table | 3 | inner `ownership-card-body` height = `OWNERSHIP_BODY_H`; the outer `ownership-card` has no fixed height (its tabs and filter sit above the body) |
| `trend-card.tsx` | `TrendCard` | Overview trend chart | 3 | inner `trend-plot` height = `TREND_PLOT_H`; the outer `trend-card` has no fixed height (its title and range control sit above the plot) |
| `alerts-strip.tsx` | `AlertsStrip` | Alerts summary strip, `ALERTS_STRIP_H` (72px) | 4 | outer `alerts-strip` height = `ALERTS_STRIP_H` |
| `repo-rail.tsx` | `RepoRail` | Alerts rail, `RAIL_W` (260px) | 4 | outer `repo-rail` width = `RAIL_W` |
| `alert-list.tsx` | `AlertList` | Alerts list column, pager and filters (rest of the 776px card) | 4 | inner `alert-list-rows` height = `ALERT_LIST_H`; the outer `alert-list` has no fixed height |

The composer's own card shell carries `alerts-card` height = `ALERTS_CARD_H`.

**Rule: a `*_BODY_H` or `*_PLOT_H` constant is asserted only on the body or plot element** (`ownership-card-body`, `trend-plot`), never on the slot's outer element: the outer card also holds its header, so the constant would not describe its height. A wave that fills a slot keeps the `data-testid` AND the inline height on the element named in the Carries column.

`pager.tsx` is NOT created by this wave (the spec lists it with the shell, but only the alert list uses it); Wave 4 creates it.

```ts
// view-props.ts  (Task 2.11)
export interface SecurityViewProps {
  summary: SummaryData;           // the scoped summary, always available:true here
  data: SecurityData;             // every data slot (see below)
  url: SecurityUrl;               // URL values and handlers
  list: AlertListController;      // alert-list state; list.list is the EFFECTIVE (sanitised) state
  openDrawer: OpenDrawer;         // open the coverage drawer
}
```

The composer lays the views out. Overview is `<KpiTiles/> <OwnershipCard/> <TrendCard/>` stacked with gap `PAGE_GAP`. Alerts is `<AlertsStrip/>` above a card shell (`bg-gray-900 rounded-xl overflow-hidden grid`, inline `height: ALERTS_CARD_H`, a two-column grid of `RAIL_W` px and `minmax(0, 1fr)`) holding `<RepoRail/>` and `<AlertList/>`. Waves 3 and 4 change only their own slot files unless they add a prop.

**Types (`api-types.ts`, Task 2.5).** `SummaryData`, `ReposData`, `CoverageData`, `AlertsData`, `TrendData` (each the `available: true` member of the matching `queries.ts` function's return type), `UnavailableData` and `Slot<T>` (re-exported by `use-security-data.ts`).

**`dimensions.ts` (Task 2.2).** Named constants, all in px unless noted:
`PAGE_MAX_W` 1280, `PAGE_PAD` `{ top: 32, x: 24, bottom: 40 }`, `PAGE_GAP` 24, `KPI_ROW_H` 178, `OWNERSHIP_BODY_H` 330, `TEAM_ROW_H` 50, `ALERTS_STRIP_H` 72, `ALERTS_CARD_H` 776, `ALERT_ROW_H` 56, `ALERT_PAGE_SIZE` 10, `ALERT_LIST_H` 560, `RAIL_W` 260, `TREND_PLOT_H` 220, `SPARK_H` 24, `DRAWER_W` 460, `DRAWER_MAX_W` `'92vw'`, `COVERAGE_LINE_MIN_H` 22, `SELECT_W` `{ codebase: 220, team: 170, severity: 140, baseline: 118, date: 128 }`, `FILTER_ROW_GAP` 8, `COMPARE_LABEL_W` 68, `BAR_ROW_H` 36, `BAR_PAD_Y` 6, `FILTER_BAR_H` 84, `RESET_SLOT_W` 116, `FILTER_ROW_W` (sum of the filter row), `Z` `{ pinnedRows: 10, stickyBar: 20, drawer: 40 }`, and `TYPE` (class-string constants for the typography table: `title`, `kpiValue`, `sectionLabel`, `tableHeader`, `body`, `secondary`, `card`, `control`, `badge`).
Waves 3 and 4 apply heights as inline `style` from these constants, on the element named in the slot table's Carries column, in every branch (loading, error, empty, populated). Pinned table headers and Total rows use `zIndex: Z.pinnedRows`.

**`sla-state.ts` (Task 2.3).** The one place the four SLA states are decided and worded, so the tile, strip, rail, columns and drawer cannot disagree.

```ts
export type SlaState =
  | { kind: 'active' }
  | { kind: 'pending'; startsOn: string | null }
  | { kind: 'none' }
  | { kind: 'invalid' };
export const SLA_NONE_LABEL = 'No SLA policy yet';
export const SLA_INVALID_LABEL = "SLA policy can't be read";
export const slaPendingLabel = (startsOn: string | null) => `Starts ${startsOn ?? 'later'}`;
export function slaState(sev: Severity, s: SlaSource): SlaState;          // invalid wins over none
export function slaStateLabel(st: SlaState): string | null;               // null when active
export function slaActive(sev: Severity, s: SlaSource): boolean;          // overdue/due columns exist only when true
export function anySlaActive(s: SlaSource): boolean;                      // "Next due" column; time toggles
// SlaSource = { slaStatus: Record<Severity, 'pending'|'active'|'none'>; slaPolicyInvalid: boolean;
//               policy: Array<{ severity: string; effectiveFrom: string; pending: boolean }> }  (a SummaryData satisfies it)
```
The invalid state renders in red (`text-red-400`); the others in muted grey.

**`security-state.ts` (Tasks 2.4 and 2.6).**

```ts
export type SecurityView = 'overview' | 'alerts';
export type OwnTab = 'teams' | 'repos';
export type SeverityFilter = 'both' | 'critical' | 'high';
export type TrendRange = '30d' | '90d' | '1y' | 'all';
export const VIEW_SCHEMA, OWN_SCHEMA, CODEBASE_SCHEMA, TEAM_SCHEMA, REPO_SCHEMA,
  SEVERITY_SCHEMA, BASELINE_SCHEMA, RANGE_SCHEMA;        // UrlSchema consts, all scroll:false
export const kSev: (s: SeverityFilter) => Severity;       // 'high' only for 'high', else 'critical'
export type { CodebaseCounts };            // re-exported from @/lib/vulnerabilities/aggregate (Wave 1), never redefined
export const codebaseOptionCount: (c: CodebaseCounts | undefined, g: CodebaseGroup, s: SeverityFilter) => number | null;
export const scopeOpenCount: (rows: readonly RepoRow[], s: SeverityFilter, repo: string | null) => number;
   // sums open counts under Severity, INCLUDING an unmeasured row's stored count, so it equals the alert
   // list's totalCount when status is open and no other list filter is set
export const trendSince: (range: TrendRange, now: Date) => string | null;   // null for 'all'
export const SPARKLINE_DAYS = 90;
export const sparklineSince: (now: Date) => string;                         // today - SPARKLINE_DAYS, UTC
export const sanitiseBaseline: (raw: string) => string;                     // anything invalid becomes 'last'
export const keepTopDelta: (contentTop: number, barBottom: number) => number;   // <= 0, never scrolls down

export interface SecurityUrl {            // useSecurityUrl()
  view: SecurityView; own: OwnTab; codebase: CodebaseGroup; team: string | null; repo: string | null;
  severity: SeverityFilter; baseline: string /* sanitised */; range: TrendRange; kSev: Severity;
  setView(v: SecurityView): void;         // push
  setOwn(o: OwnTab): void;                // push
  setSeverity(s: SeverityFilter): void;
  setBaseline(b: string): void;
  setRange(r: TrendRange): void;
  setCodebase(c: CodebaseGroup): void;    // writes repo: null in the SAME URL write
  setTeam(t: string | null): void;        // writes repo: null in the SAME URL write
  clearRepo(): void;                      // "Show all repositories"
  selectTeamRow(team: string): void;      // Overview team row: toggles the team; selecting also sets own='repos' (push); never changes view
  selectRepoRow(row: { fullName: string; team: string }): void;   // Overview Repositories-tab rows ONLY: one push, view='alerts', team=row.team, repo=row.fullName ('Unassigned' is valid)
  setRepo(repo: string | null): void;     // rail rows INSIDE the Alerts view: writes only repo, a replace (no history entry)
  resetFilters(): void;                   // codebase, team, severity, baseline, repo -> defaults; never changes view
  isDefault: { codebase: boolean; team: boolean; severity: boolean; baseline: boolean; repo: boolean; all: boolean };
}
export type SecurityScope = Pick<SecurityUrl, 'codebase' | 'team' | 'repo' | 'severity' | 'baseline' | 'range'>;
export function useSecurityUrl(): SecurityUrl;

export type AlertStatus = 'open' | 'resolved' | 'all';
// Re-exported from @/lib/vulnerabilities/alert-sort (Wave 1), never redefined:
export { ALERT_SORT_KEYS }; export type { AlertSortKey, AlertSortDir, AlertSortSpec };
export const ALERT_SORT_FIRST_DIR: Record<AlertSortKey, AlertSortDir>;   // age: 'desc'; severity, advisory, repo, due, state: 'asc'
export interface AlertListState {
  status: AlertStatus; overdue: boolean; dueSoon: boolean; reopened: boolean; runtimeOnly: boolean;
  q: string; page: number /* 1-based */;
  sort: { key: AlertSortKey; dir: AlertSortDir } | null;   // null = server default order, no active header
}
export const DEFAULT_ALERT_LIST: AlertListState;           // open, no filters, sort null, page 1
export function sanitiseAlertList(l: AlertListState, ctx: { anySlaActive: boolean }): AlertListState;   // the list as it may be sent
export function alertsQueryString(i: { codebase: CodebaseGroup; team: string | null; repo: string | null; severity: SeverityFilter; list: AlertListState; anySlaActive: boolean }): string;
export interface AlertListController {    // useAlertList(scope)
  list: AlertListState;                   // via SecurityViewProps this is the EFFECTIVE state (see use-security-data)
  setStatus(s: AlertStatus): void;        // 'resolved' clears overdue and dueSoon
  toggleOverdue(): void;                  // turning on clears dueSoon
  toggleDueSoon(): void;                  // turning on clears overdue
  toggleReopened(): void; toggleRuntimeOnly(): void;
  setQuery(q: string): void;              // call after the debounce; the hook does not debounce
  setSort(key: AlertSortKey): void;       // same key flips direction; a new key starts in ALERT_SORT_FIRST_DIR[key]
  setPage(page: number): void;
}
// Every setter except setPage resets page to 1. A scope change (codebase, team, repo, severity) resets it in
// the SAME render (state adjustment during render), so the first alerts request after it already has offset 0.
export function useAlertList(scope: { codebase: CodebaseGroup; team: string | null; repo: string | null; severity: SeverityFilter }): AlertListController;
```

A name Wave 1 defines (`ALERT_SORT_KEYS`, `AlertSortKey`, `AlertSortDir`, `AlertSortSpec`, `CodebaseCounts`) is imported or re-exported by this wave, never redefined; the wire `sort` value is built as an `AlertSortSpec`.

`sort: null` means the server's default order (soonest due, then severity, then newest) with no active header. The first click on a header uses `ALERT_SORT_FIRST_DIR`: Age starts descending (oldest alert first), every other key ascending; clicking the active header again reverses it.

URL keys (spec section 5): `view` (overview|alerts, push), `own` (teams|repos, push), `codebase` (replace), `team` (replace), `repo` (replace), `severity` (both|critical|high, replace), `baseline` (last|7d|30d|YYYY-MM-DD, replace), `range` (30d|90d|1y|all, replace). Every schema is declared `scroll: false`. The old `sev` key is not read anywhere.

**`use-security-data.ts` (Task 2.7).**

```ts
// Slot<T> is defined in api-types.ts (Task 2.5) and re-exported from this module.
export interface Slot<T> {
  data: T | undefined;                    // the available:true payload, or undefined
  unavailable: UnavailableData | undefined;
  error: unknown;
  errorText: string | null;               // panelError(error, label)
  loading: boolean;                       // key never resolved and nothing to show
  stale: boolean;                         // previous key's data is on screen while the new key loads
}
export interface SecurityData {
  summary: Slot<SummaryData>;             // codebase, team, baseline
  teamSummary: Slot<SummaryData>;         // codebase, baseline (never team): the team table
  coverage: Slot<CoverageData>;           // codebase, team
  repos: Slot<ReposData>;                 // codebase, team: Repositories tab, rail, strip, tab count, header meta
  trend: Slot<TrendData>;                 // codebase, severity=kSev, since from range; no team
  sparkline: Slot<TrendData>;             // codebase, severity=kSev, since = today-90d; no team
  alerts: Slot<AlertsData>;               // undefined data while repoStatus is 'not-found'
  repoStatus: 'none' | 'pending' | 'ok' | 'not-found';
  effectiveRepo: string | null;           // repo when status is pending or ok, else null
  effectiveList: AlertListState;          // the sanitised list actually sent
  keys: { summary: string; teamSummary: string; coverage: string; repos: string; trend: string; sparkline: string; alerts: string | null };
}
export function useSecurityData(scope: SecurityScope, listState: AlertListState): SecurityData;
```

Wave 4 renders the inline "Repository not found · Show all repositories" state when `data.repoStatus === 'not-found'` (button calls `url.clearRepo()`), and never shows a page-level error for it. The sparkline is summed by Wave 3 (`sparkline.tsx`) from `data.sparkline.data.series`, filtered to `url.team` when set.

**Drawer (`coverage-drawer.tsx`, Task 2.9).** `export type OpenDrawer = (opener?: HTMLElement | null) => void;` Callers pass the clicked element (`onClick={e => openDrawer(e.currentTarget)}`) so focus can return to it on close. With no argument it uses `document.activeElement`. Open state is local, never in the URL.

**Styling (`globals.css`, Task 2.1).** Tokens `--warn`, `--warn-bg`, `--warn-line`, `--crit-tint`, `--high-tint` on `:root` and under `[data-theme-mode="light"]`. Utilities: `text-warn`, `bg-warn-bg`, `border-warn-line`, `bg-crit-tint`, `bg-high-tint`, and `vuln-hatch` (the hatched unmeasured band: diagonal stripes over `--warn-bg`; use it for the rail's unmeasured rows, the Repositories tab band and the drawer rows). Token to class mapping from the spec: crit `text-red-400`, high `text-orange-400`, good `text-green-400`, grid `--chart-grid`, accent-fg `text-accent-light`. Cards use `bg-gray-900` (shell only). Pinned headers, Total rows, rail rows, alert rows and drawer rows use `bg-chart-surface` or a plain `var()`, with no border.

**Test support (`src/lib/__tests__/support/`, Task 2.5).** `security-nav-mock.ts` exports `createNavigationMock(initialSearch?)` (reactive `next/navigation` with recorded `push`/`replace` calls including options). Use it as `jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());`, then `const nav = () => jest.requireMock('next/navigation') as any` and `nav().__resetSearch('team=Payments')` and `nav().__calls` (`{ kind: 'push' | 'replace'; url: string; opts: unknown }[]`). `security-fixtures.ts` exports `SYNC_AT`, `cell`, `repoRow`, `REPO_ROWS`, `syncInfo`, `teamRow`, `summaryFixture`, `reposFixture`, `coverageFixture`, `coverageRow`, `trendFixture`, `alertRow`, `alertsFixture`, `slot`, `SwrFresh`, `RouteName`, `Reply`, `Route`, `fetchRouter`, `callsTo` (Task 2.5) and `viewProps` (Task 2.11). Every builder returns the real response type from `api-types.ts` with `Partial<...>` overrides, so a fixture that drifts from the API fails `npx tsc --noEmit`; the alerts and trend routes echo the request in `appliedFilters`. `viewProps(over?)` returns a complete `SecurityViewProps` for slot tests: the slots come from `slot(...)`, `summaryFixture`, `reposFixture(REPO_ROWS)` and the other builders, every `SecurityUrl` and `AlertListController` member is a `jest.fn()`, `list.list` is `DEFAULT_ALERT_LIST` and `openDrawer` is a `jest.fn()`. Waves 3 and 4 extend these files rather than copy them.

**Ordering and paging ownership.** Rows arrive in server order (critical-open desc, high-open desc, name; unmeasured last). Wave 4 owns the rail order (overdue, then open critical, then open high, then name; unmeasured last). Wave 3 owns the Repositories-table header sorts; unmeasured rows stay last and ignore sorting. Wave 4's `AlertList` clamps the page: if `rows.length === 0 && totalCount > 0 && list.page > 1`, call `list.setPage(Math.ceil(totalCount / ALERT_PAGE_SIZE))`.

**Hand-off checklist for Waves 3 and 4.** Task 2.11 deletes the old composer's tests, so each sub-case below has no test until the named wave writes it. The old assertions stay readable with `git show main:<path>`.

*Wave 3 (`kpi-tiles`, `ownership-card`):*
- "N repos not in baseline" on its own line under the new / resolved / reopened tile, only when the delta is available and `reposNotInBaseline > 0`; the caption beside it ("vs {date}") stays unchanged.
- The unavailable-baseline caption, with the new copy: "No earlier measurement yet" when `delta.baseline` is null (this is the null-baseline fallback: it names no date), and "No measurement on or before {date}" when a baseline date is known but the delta has no total. It replaces the old "no measurement for this view before {date}".
- The null-total guard: an `available` delta whose `total` is null renders the unavailable caption and a dash, and never throws or prints NaN.
- The "other ±N" suffix on the new / resolved / reopened figures: shown only when `total.other !== 0`, kept to one line (truncated), with the full text in the element's `title`.
- The † marker and footnote (ownership card, and the Resolved KPI tile): the marker with the carry title on a row whose `carriedResolved > 0`; the footnote under the table when the Total's `carriedResolved > 0`; neither when `resolved` is null (invalid start date) or nothing carries.

*Consumers of `sla-state` (every consumer has a test per SLA state: active, pending, none, invalid):*
- Wave 3: the SLA tile, and the overdue columns of both tables (Owning teams and Repositories).
- Wave 4: the alerts strip, the rail, the alert list's Due column, and the Overdue and Due ≤ 7d toggles.
- The toggles keep today's disabled-with-hint behaviour while no severity's SLA is active. The hint comes from the SLA state (invalid first, then pending, then none): pending reads "Due dates start {date}" (the earliest start), none reads "No SLA policy yet", invalid reads `slaStateLabel`'s "SLA policy can't be read". The toggles are also cleared (by `sanitiseAlertList`) when no SLA is active, so a disabled toggle never reads as on.

*Wave 4 (`alert-list`):* typed search text is applied, not dropped, when the user switches view or clicks a chip inside the 300ms debounce window, and a pending debounce flushes on unmount.

### Task 2.1: Theme tokens, utility classes and the `--warn` contrast guard

**Files:**
- Modify: `src/app/globals.css` (five variables in the existing `:root` block and in the existing `[data-theme-mode="light"]` block; hand-written utilities next to `.focus\:border-accent-dark:focus`)
- Create: `src/lib/__tests__/unit/vuln-security-tokens-css.test.ts`
- Create: `src/lib/__tests__/unit/vuln-warn-contrast.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: CSS variables `--warn`, `--warn-bg`, `--warn-line`, `--crit-tint`, `--high-tint` (dark on `:root`, light under `[data-theme-mode="light"]`); classes `.text-warn`, `.bg-warn-bg`, `.border-warn-line`, `.bg-crit-tint`, `.bg-high-tint`, `.vuln-hatch`.

Why hand-written classes and not `tailwind.config.ts` colours: `globals.css` already holds the theme-variable utilities (`.bg-accent`, `.text-accent-light`); the config's `chart` colours exist only because chart code needs them.

Two facts the implementer must not "fix":
1. The spec lists light `--warn` as `#9a6700`. That value measures 4.23:1 on the light `--warn-bg` (`#fbefc6`), below the 4.5:1 floor. The spec says to darken it if the pair fails, so the light value is `#8f5f00` (4.80:1 on the wash, at least 5.27:1 on every light body background).
2. The new variables go INSIDE the existing first bare `:root {` block and the existing bare `[data-theme-mode="light"] {` block. `extractBlock` in the CSS tests only finds the first match of each selector, so a second `:root {` block would be invisible to them.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/unit/vuln-security-tokens-css.test.ts
// GLOOK-64: the Security page tokens exist for dark (:root) AND light (the bare
// [data-theme-mode="light"] block) with the spec's values, and the utility classes read them.
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

function extractBlock(source: string, selectorLine: RegExp): string {
  const lines = source.split('\n');
  const start = lines.findIndex(l => selectorLine.test(l.trim()));
  if (start === -1) throw new Error(`selector not found: ${selectorLine}`);
  let depth = 0;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i]);
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (i > start && depth <= 0) break;
  }
  return out.join('\n');
}

const dark = extractBlock(css, /^:root\s*{$/);
// The bare selector exactly, not one of the many `[data-theme-mode="light"] .foo {` rules.
const light = extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/);

const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
function token(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`--${name} not defined in the block`);
  return norm(m[1]);
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const DARK = {
  warn: '#d29922', 'warn-bg': 'rgba(210,153,34,.11)', 'warn-line': 'rgba(210,153,34,.45)',
  'crit-tint': 'rgba(239,68,68,.045)', 'high-tint': 'rgba(251,146,60,.04)',
};
const LIGHT = {
  'warn-bg': '#fbefc6', 'warn-line': 'rgba(154,103,0,.32)', 'crit-tint': '#fef7f7', 'high-tint': '#fffaf5',
};

it('defines the five tokens at :root with the spec dark values', () => {
  for (const [name, value] of Object.entries(DARK)) expect(token(dark, name)).toBe(value);
});

it('defines the five tokens under the bare light block with the spec light values', () => {
  for (const [name, value] of Object.entries(LIGHT)) expect(token(light, name)).toBe(value);
});

it('light --warn is a 6-digit hex no lighter than the spec value #9a6700 (darkened to pass contrast, never lightened)', () => {
  const v = token(light, 'warn');
  expect(v).toMatch(/^#[0-9a-f]{6}$/);
  expect(luminance(v)).toBeLessThanOrEqual(luminance('#9a6700'));
});

describe('utility classes read the tokens', () => {
  const UTILITIES: Array<[string, RegExp]> = [
    ['.text-warn', /\.text-warn\s*\{\s*color:\s*var\(--warn\);\s*\}/],
    ['.bg-warn-bg', /\.bg-warn-bg\s*\{\s*background-color:\s*var\(--warn-bg\);\s*\}/],
    ['.border-warn-line', /\.border-warn-line\s*\{\s*border-color:\s*var\(--warn-line\);\s*\}/],
    ['.bg-crit-tint', /\.bg-crit-tint\s*\{\s*background-color:\s*var\(--crit-tint\);\s*\}/],
    ['.bg-high-tint', /\.bg-high-tint\s*\{\s*background-color:\s*var\(--high-tint\);\s*\}/],
  ];
  it.each(UTILITIES)('%s', (_name, re) => {
    expect(css).toMatch(re);
  });

  it('.vuln-hatch layers --warn-line stripes over the --warn-bg wash', () => {
    expect(css).toMatch(/\.vuln-hatch\s*\{[^}]*background-color:\s*var\(--warn-bg\)[^}]*repeating-linear-gradient\([^}]*var\(--warn-line\)[^}]*\}/);
  });
});
```

```ts
// src/lib/__tests__/unit/vuln-warn-contrast.test.ts
// GLOOK-64: --warn is used as text (the "UNMEASURED" and "STALE" tags, 11px+), so it needs WCAG AA
// 4.5:1 on its own wash (--warn-bg) and on every body background of its mode. Pattern copied from
// vuln-series-contrast.test.ts, extended to parse the dark mode's rgba() wash and composite it over
// each body background before measuring.
import fs from 'fs';
import path from 'path';
import { THEMES } from '@/app/themes';

const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

function extractBlock(source: string, selectorLine: RegExp): string {
  const lines = source.split('\n');
  const start = lines.findIndex(l => selectorLine.test(l.trim()));
  if (start === -1) throw new Error(`selector not found: ${selectorLine}`);
  let depth = 0;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i]);
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (i > start && depth <= 0) break;
  }
  return out.join('\n');
}

type Rgba = [number, number, number, number];

function tokenValue(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`--${name} not defined in the block`);
  return m[1].trim();
}

function parseColor(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(v);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`unsupported colour: ${v}`);
}

/** fg drawn over an opaque bg. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]: Rgba): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}
function contrast(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const blocks = {
  dark: extractBlock(css, /^:root\s*{$/),
  light: extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/),
};
const bodyBgs: Record<'dark' | 'light', string[]> = { dark: [], light: [] };
for (const t of THEMES) bodyBgs[t.mode].push(t.bodyBg);

const MIN_CONTRAST = 4.5;

describe('the contrast helper itself', () => {
  it("detects the failure the spec anticipated: its light value #9a6700 on #fbefc6 is below 4.5:1", () => {
    expect(contrast(parseColor('#9a6700'), parseColor('#fbefc6'))).toBeLessThan(MIN_CONTRAST);
  });
  it('composites the dark wash over the body background before measuring', () => {
    const wash = over(parseColor('rgba(210,153,34,.11)'), parseColor('#0F0F0F'));
    expect(wash[0]).toBeGreaterThan(15); // lighter than the plain #0F0F0F background
  });
  it('has dark and light body backgrounds to check against', () => {
    expect(bodyBgs.dark.length).toBeGreaterThan(0);
    expect(bodyBgs.light.length).toBeGreaterThan(0);
  });
});

describe.each(['dark', 'light'] as const)('--warn text contrast in %s mode', mode => {
  const warn = parseColor(tokenValue(blocks[mode], 'warn'));
  const warnBg = parseColor(tokenValue(blocks[mode], 'warn-bg'));

  it.each(bodyBgs[mode])('on the --warn-bg wash over body background %s', bg => {
    const page = parseColor(bg);
    expect(contrast(warn, over(warnBg, page))).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it.each(bodyBgs[mode])('directly on body background %s', bg => {
    expect(contrast(warn, parseColor(bg))).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx jest src/lib/__tests__/unit/vuln-security-tokens-css.test.ts src/lib/__tests__/unit/vuln-warn-contrast.test.ts --maxWorkers=3`
Expected: FAIL. The tokens test throws "--warn not defined in the block"; the contrast test throws the same from `tokenValue` while building the `describe.each` cases.

- [ ] **Step 3: Implement**

In `src/app/globals.css`, add the dark tokens at the end of the first `:root` block. Replace

```css
  --chart-accent-deep: var(--accent-dark);
}
```

(the line is unique: the light block ends with `var(--accent);`) with

```css
  --chart-accent-deep: var(--accent-dark);

  /* GLOOK-64: Security page tokens. --warn is the muted amber for "unmeasured" and "stale"; it is
     used as text, so vuln-warn-contrast.test.ts holds it to 4.5:1 on --warn-bg and on every body
     background. --crit-tint / --high-tint are the faint washes behind the critical and high column
     groups. */
  --warn: #d29922;
  --warn-bg: rgba(210,153,34,.11);
  --warn-line: rgba(210,153,34,.45);
  --crit-tint: rgba(239,68,68,.045);
  --high-tint: rgba(251,146,60,.04);
}
```

Then the light tokens at the end of the bare `[data-theme-mode="light"]` block. Replace

```css
  /* Decision 16: accent-dark is darker on light themes, i.e. louder, so Deep equals Vivid here. */
  --chart-accent-deep: var(--accent);
}
```

with

```css
  /* Decision 16: accent-dark is darker on light themes, i.e. louder, so Deep equals Vivid here. */
  --chart-accent-deep: var(--accent);

  /* GLOOK-64: Security page tokens (light). The design's #9a6700 measured 4.23:1 on --warn-bg
     (#fbefc6), under the 4.5:1 text floor, so --warn is darkened to #8f5f00 (4.80:1 on the wash,
     at least 5.27:1 on every light body background). */
  --warn: #8f5f00;
  --warn-bg: #fbefc6;
  --warn-line: rgba(154,103,0,.32);
  --crit-tint: #fef7f7;
  --high-tint: #fffaf5;
}
```

Then add the utilities directly after the line `.focus\:border-accent-dark:focus { border-color: var(--accent-dark); }`:

```css

/* GLOOK-64: Security page utilities. Same convention as the accent utilities above: a plain class
   reading a theme variable, so the dark and light values switch without a per-mode rule. */
.text-warn { color: var(--warn); }
.bg-warn-bg { background-color: var(--warn-bg); }
.border-warn-line { border-color: var(--warn-line); }
.bg-crit-tint { background-color: var(--crit-tint); }
.bg-high-tint { background-color: var(--high-tint); }
/* The hatched band for unmeasured repositories (rail, Repositories tab, coverage drawer). */
.vuln-hatch {
  background-color: var(--warn-bg);
  background-image: repeating-linear-gradient(135deg, var(--warn-line) 0, var(--warn-line) 1px, transparent 1px, transparent 7px);
}
```

- [ ] **Step 4: Run the tests and the neighbouring CSS guards**

Run: `npx jest src/lib/__tests__/unit/vuln-security-tokens-css.test.ts src/lib/__tests__/unit/vuln-warn-contrast.test.ts src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/vuln-trend-colors-css.test.ts src/lib/__tests__/unit/vuln-series-contrast.test.ts --maxWorkers=3`
Expected: PASS (all five files). Reverting the light `--warn` to `#9a6700` fails the "on the --warn-bg wash" light case; deleting a token from either block fails the exact-value tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/lib/__tests__/unit/vuln-security-tokens-css.test.ts src/lib/__tests__/unit/vuln-warn-contrast.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Security page theme tokens, utilities and --warn contrast guard"
```

### Task 2.2: Layout and typography constants

**Files:**
- Create: `src/app/vulnerabilities/dimensions.ts`
- Test: `src/lib/__tests__/unit/vuln-security-dimensions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the constants listed under "`dimensions.ts`" in the Wave 2 public interface (exact names below).

This module exists so the spec's Dimensions table is written once. Every layout test in Waves 2 to 4 compares a rendered inline style against these names, so a height can only change in one place. The test below pins the values to the spec table: changing a constant fails it until the spec changes too. That is a deliberate drift guard, not a behaviour test, and it also checks two relationships that are behaviour (the filter row fits at 1024px; the z-index layers stack in the order the spec requires).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/unit/vuln-security-dimensions.test.ts
import {
  PAGE_MAX_W, PAGE_PAD, PAGE_GAP, KPI_ROW_H, OWNERSHIP_BODY_H, TEAM_ROW_H, ALERTS_STRIP_H, ALERTS_CARD_H,
  ALERT_ROW_H, ALERT_PAGE_SIZE, ALERT_LIST_H, RAIL_W, TREND_PLOT_H, SPARK_H, DRAWER_W, DRAWER_MAX_W,
  COVERAGE_LINE_MIN_H, SELECT_W, FILTER_ROW_GAP, COMPARE_LABEL_W, BAR_ROW_H, BAR_PAD_Y, FILTER_BAR_H,
  RESET_SLOT_W, FILTER_ROW_W, Z, TYPE,
} from '@/app/vulnerabilities/dimensions';

it('matches the spec Dimensions table', () => {
  expect(PAGE_MAX_W).toBe(1280);
  expect(PAGE_PAD).toEqual({ top: 32, x: 24, bottom: 40 });
  expect(PAGE_GAP).toBe(24);
  expect(KPI_ROW_H).toBe(178);
  expect(OWNERSHIP_BODY_H).toBe(330);
  expect(TEAM_ROW_H).toBe(50);
  expect(ALERTS_STRIP_H).toBe(72);
  expect(ALERTS_CARD_H).toBe(776);
  expect(ALERT_ROW_H).toBe(56);
  expect(ALERT_PAGE_SIZE).toBe(10);
  expect(RAIL_W).toBe(260);
  expect(TREND_PLOT_H).toBe(220);
  expect(SPARK_H).toBe(24);
  expect(DRAWER_W).toBe(460);
  expect(DRAWER_MAX_W).toBe('92vw');
  expect(COVERAGE_LINE_MIN_H).toBe(22);
  expect(SELECT_W).toEqual({ codebase: 220, team: 170, severity: 140, baseline: 118, date: 128 });
});

it('derives the list area from the row height and page size (56px x 10 = 560px)', () => {
  expect(ALERT_LIST_H).toBe(560);
  expect(ALERT_LIST_H).toBe(ALERT_ROW_H * ALERT_PAGE_SIZE);
});

it('the sticky bar is two fixed rows plus its padding', () => {
  expect(FILTER_BAR_H).toBe(2 * BAR_ROW_H + 2 * BAR_PAD_Y);
});

it('the filter row (selects, the Compare to label, the date slot and the gaps) fits one line at a 1024px viewport minus page padding and a 15px scrollbar', () => {
  const sum = SELECT_W.codebase + SELECT_W.team + SELECT_W.severity + COMPARE_LABEL_W + SELECT_W.baseline + SELECT_W.date + 5 * FILTER_ROW_GAP;
  expect(FILTER_ROW_W).toBe(sum);
  expect(FILTER_ROW_W).toBeLessThanOrEqual(1024 - 2 * PAGE_PAD.x - 15);
  expect(RESET_SLOT_W).toBeGreaterThan(0);
});

it('layers stack as the spec requires: pinned table rows < sticky bar < drawer', () => {
  expect(Z.pinnedRows).toBeLessThan(Z.stickyBar);
  expect(Z.stickyBar).toBeLessThan(Z.drawer);
});

it('typography classes carry the spec sizes, weights, tracking and radii', () => {
  expect(TYPE.title).toBe('text-2xl font-bold');                       // 24px, 700
  expect(TYPE.kpiValue).toContain('text-[22px]');
  expect(TYPE.kpiValue).toContain('font-bold');                        // 22px, 700
  expect(TYPE.sectionLabel).toBe('text-xs font-semibold uppercase tracking-[0.08em]');   // 12px, 600, 0.08em
  expect(TYPE.tableHeader).toBe('text-[11px] font-semibold uppercase tracking-[0.06em]'); // 11px, 600, 0.06em
  expect(TYPE.body).toBe('text-sm');                                   // 14px
  expect(TYPE.secondary).toBe('text-xs');                              // 12px
  expect(TYPE.card).toBe('rounded-xl');                                // 12px
  expect(TYPE.control).toBe('rounded-md');                             // 6px
  expect(TYPE.badge).toBe('rounded');                                  // 4px
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-security-dimensions.test.ts --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/dimensions'".

- [ ] **Step 3: Implement**

```ts
// src/app/vulnerabilities/dimensions.ts
// GLOOK-64: the Security page's fixed sizes, written once from the spec's "Dimensions and
// typography" table. Tests compare rendered inline styles against these names, so a layout number
// changes in exactly one place. Not a page.tsx file, so it may export freely.

// Page container: max width 1280, padding 32 / 24 / 40 (top / sides / bottom), gap 24.
export const PAGE_MAX_W = 1280;
export const PAGE_PAD = { top: 32, x: 24, bottom: 40 } as const;
export const PAGE_GAP = 24;

// Overview.
export const KPI_ROW_H = 178;
export const OWNERSHIP_BODY_H = 330;   // tables scroll inside it; header row and Total row stay pinned
export const TEAM_ROW_H = 50;
export const TREND_PLOT_H = 220;
export const SPARK_H = 24;

// Alerts.
export const ALERTS_STRIP_H = 72;
export const ALERTS_CARD_H = 776;
export const ALERT_ROW_H = 56;
export const ALERT_PAGE_SIZE = 10;
export const ALERT_LIST_H = ALERT_ROW_H * ALERT_PAGE_SIZE; // 560
export const RAIL_W = 260;

// Drawer and header.
export const DRAWER_W = 460;
export const DRAWER_MAX_W = '92vw';
export const COVERAGE_LINE_MIN_H = 22;

// Sticky bar. Selects have fixed widths; each is shrink-0 and truncates with a title attribute.
export const SELECT_W = { codebase: 220, team: 170, severity: 140, baseline: 118, date: 128 } as const;
export const FILTER_ROW_GAP = 8;
export const COMPARE_LABEL_W = 68;
export const BAR_ROW_H = 36;
export const BAR_PAD_Y = 6;
export const FILTER_BAR_H = 2 * BAR_ROW_H + 2 * BAR_PAD_Y; // 84: view tabs row + filters row
export const RESET_SLOT_W = 116;
/** Codebase, Owning team, Severity, "Compare to" label, Compare select, date slot, and 5 gaps. */
export const FILTER_ROW_W =
  SELECT_W.codebase + SELECT_W.team + SELECT_W.severity + COMPARE_LABEL_W + SELECT_W.baseline + SELECT_W.date + 5 * FILTER_ROW_GAP;

/** Layer order: tables' pinned rows < sticky bar < drawer. Apply as inline `zIndex`. */
export const Z = { pinnedRows: 10, stickyBar: 20, drawer: 40 } as const;

/** Typography and radii from the spec, as full class strings (Tailwind scans this file). */
export const TYPE = {
  title: 'text-2xl font-bold',
  kpiValue: 'text-[22px] leading-7 font-bold',
  sectionLabel: 'text-xs font-semibold uppercase tracking-[0.08em]',
  tableHeader: 'text-[11px] font-semibold uppercase tracking-[0.06em]',
  body: 'text-sm',
  secondary: 'text-xs',
  card: 'rounded-xl',
  control: 'rounded-md',
  badge: 'rounded',
} as const;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/__tests__/unit/vuln-security-dimensions.test.ts --maxWorkers=3`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/dimensions.ts src/lib/__tests__/unit/vuln-security-dimensions.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Security page layout constants"
```

### Task 2.3: SLA state helper (the four states, one definition)

**Files:**
- Create: `src/app/vulnerabilities/sla-state.ts`
- Test: `src/lib/__tests__/unit/vuln-sla-state.test.ts`

**Interfaces:**
- Consumes: `Severity` from `@/lib/vulnerabilities/types`.
- Produces: `SlaState`, `SlaSource`, `slaState`, `slaStateLabel`, `slaActive`, `anySlaActive`, `SLA_NONE_LABEL`, `SLA_INVALID_LABEL`, `slaPendingLabel` (signatures in the Wave 2 public interface).

The spec requires four SLA states (active, pending "Starts {date}", none "No SLA policy yet", invalid "SLA policy can't be read" in red) on the SLA tile, the strip, the rail, the overdue columns and the drawer. Without one helper, five components would each re-derive them. The rule the old page already encoded and this keeps: an invalid `VULNERABILITIES_SLA_POLICY` parses to an empty policy, so `slaStatus` reads `'none'` for both severities. `slaPolicyInvalid` must therefore be checked first, so an invalid policy never reads as merely empty.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/unit/vuln-sla-state.test.ts
import { slaState, slaStateLabel, slaActive, anySlaActive, SLA_NONE_LABEL, SLA_INVALID_LABEL, slaPendingLabel, type SlaSource } from '@/app/vulnerabilities/sla-state';

const src = (over: Partial<SlaSource> = {}): SlaSource => ({
  slaStatus: { critical: 'active', high: 'none' },
  slaPolicyInvalid: false,
  policy: [{ severity: 'critical', effectiveFrom: '2020-01-08', pending: false }],
  ...over,
});

it('active: no label, and the overdue columns exist', () => {
  expect(slaState('critical', src())).toEqual({ kind: 'active' });
  expect(slaStateLabel(slaState('critical', src()))).toBeNull();
  expect(slaActive('critical', src())).toBe(true);
});

it('none: "No SLA policy yet", and no overdue column', () => {
  const st = slaState('high', src());
  expect(st).toEqual({ kind: 'none' });
  expect(slaStateLabel(st)).toBe(SLA_NONE_LABEL);
  expect(SLA_NONE_LABEL).toBe('No SLA policy yet');
  expect(slaActive('high', src())).toBe(false);
});

it('pending: "Starts <earliest pending effectiveFrom for THAT severity>"', () => {
  const s = src({
    slaStatus: { critical: 'active', high: 'pending' },
    policy: [
      { severity: 'critical', effectiveFrom: '2020-01-08', pending: false },
      { severity: 'high', effectiveFrom: '2099-03-01', pending: true },
      { severity: 'high', effectiveFrom: '2099-02-01', pending: true },
      { severity: 'critical', effectiveFrom: '2098-01-01', pending: true },
    ],
  });
  expect(slaState('high', s)).toEqual({ kind: 'pending', startsOn: '2099-02-01' });
  expect(slaStateLabel(slaState('high', s))).toBe('Starts 2099-02-01');
  expect(slaPendingLabel('2099-02-01')).toBe('Starts 2099-02-01');
  expect(slaActive('high', s)).toBe(false);
});

it('invalid wins over none for BOTH severities: an invalid policy never reads as merely empty', () => {
  const s = src({ slaStatus: { critical: 'none', high: 'none' }, slaPolicyInvalid: true, policy: [] });
  for (const sev of ['critical', 'high'] as const) {
    expect(slaState(sev, s)).toEqual({ kind: 'invalid' });
    expect(slaStateLabel(slaState(sev, s))).toBe(SLA_INVALID_LABEL);
    expect(slaActive(sev, s)).toBe(false);
  }
  expect(SLA_INVALID_LABEL).toBe("SLA policy can't be read");
});

it('anySlaActive is true when either severity is active, false otherwise (pending counts as not active)', () => {
  expect(anySlaActive(src())).toBe(true);
  expect(anySlaActive(src({ slaStatus: { critical: 'none', high: 'active' } }))).toBe(true);
  expect(anySlaActive(src({ slaStatus: { critical: 'pending', high: 'none' } }))).toBe(false);
  expect(anySlaActive(src({ slaStatus: { critical: 'active', high: 'active' }, slaPolicyInvalid: true }))).toBe(false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-sla-state.test.ts --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/sla-state'".

- [ ] **Step 3: Implement**

```ts
// src/app/vulnerabilities/sla-state.ts
// GLOOK-64: the one place the four SLA states are decided and worded (spec: "SLA policy per
// severity"). The SLA tile, the alerts strip, the rail, the overdue/due columns and the coverage
// drawer all read it, so they cannot disagree. Pure: no React, no server imports.
import type { Severity } from '@/lib/vulnerabilities/types';

export type SlaState =
  | { kind: 'active' }
  | { kind: 'pending'; startsOn: string | null }
  | { kind: 'none' }
  | { kind: 'invalid' };

/** The slice of the summary response these helpers read. A SummaryData satisfies it. */
export interface SlaSource {
  slaStatus: Record<Severity, 'pending' | 'active' | 'none'>;
  slaPolicyInvalid: boolean;
  policy: Array<{ severity: string; effectiveFrom: string; pending: boolean }>;
}

export const SLA_NONE_LABEL = 'No SLA policy yet';
export const SLA_INVALID_LABEL = "SLA policy can't be read";
export const slaPendingLabel = (startsOn: string | null) => `Starts ${startsOn ?? 'later'}`;

export function slaState(sev: Severity, s: SlaSource): SlaState {
  // An invalid VULNERABILITIES_SLA_POLICY parses to an empty policy, so slaStatus reads 'none' for
  // both severities. Check invalid first or it would read as merely empty.
  if (s.slaPolicyInvalid) return { kind: 'invalid' };
  const status = s.slaStatus[sev];
  if (status === 'active') return { kind: 'active' };
  if (status === 'pending') {
    const dates = s.policy.filter(p => p.severity === sev && p.pending).map(p => p.effectiveFrom).sort();
    return { kind: 'pending', startsOn: dates[0] ?? null };
  }
  return { kind: 'none' };
}

/** The user-facing text for a non-active state; null when active (the caller shows figures). */
export function slaStateLabel(st: SlaState): string | null {
  switch (st.kind) {
    case 'active': return null;
    case 'pending': return slaPendingLabel(st.startsOn);
    case 'none': return SLA_NONE_LABEL;
    case 'invalid': return SLA_INVALID_LABEL;
  }
}

/** An overdue column (and a due-soon figure) exists only while this severity's policy is active. */
export function slaActive(sev: Severity, s: SlaSource): boolean {
  return slaState(sev, s).kind === 'active';
}

/** True when at least one severity is active: the "Next due" column, and the Overdue / Due ≤ 7d toggles. */
export function anySlaActive(s: SlaSource): boolean {
  return slaActive('critical', s) || slaActive('high', s);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/__tests__/unit/vuln-sla-state.test.ts --maxWorkers=3`
Expected: PASS (5 tests). Removing the `slaPolicyInvalid` check fails the invalid test.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/sla-state.ts src/lib/__tests__/unit/vuln-sla-state.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: shared SLA state helper for the four policy states"
```

### Task 2.4: `security-state.ts`, pure part: URL schemas, `kSev`, sanitising rules, query builder

**Files:**
- Create: `src/app/vulnerabilities/security-state.ts`
- Test: `src/lib/__tests__/unit/vuln-security-state.test.ts`

**Interfaces:**
- Consumes: `ALERT_PAGE_SIZE` from `./dimensions` (Task 2.2); `RepoRow` and `CodebaseCounts` (types only) from `@/lib/vulnerabilities/aggregate` (Wave 1); `ALERT_SORT_KEYS`, `AlertSortKey`, `AlertSortDir`, `AlertSortSpec` from `@/lib/vulnerabilities/alert-sort` (Wave 1, client-safe: it has no imports); `UrlSchema`, `readValue` from `@/lib/url-state` (existing).
- Produces: the pure half of the "`security-state.ts`" block in the Wave 2 public interface: the eight `*_SCHEMA` consts, `SecurityView`, `OwnTab`, `SeverityFilter`, `TrendRange`, `kSev`, `codebaseOptionCount`, `scopeOpenCount`, `trendSince`, `SPARKLINE_DAYS`, `sparklineSince`, `sanitiseBaseline`, `keepTopDelta`, `AlertStatus`, `ALERT_SORT_FIRST_DIR`, `AlertListState`, `DEFAULT_ALERT_LIST`, `sanitiseAlertList`, `alertsQueryString`; and the RE-EXPORTS `CodebaseCounts`, `ALERT_SORT_KEYS`, `AlertSortKey`, `AlertSortDir`, `AlertSortSpec`. Task 2.6 adds the two hooks to this same file.

**A name Wave 1 defines is imported or re-exported here, never redefined.** A second definition of the sort keys or of `CodebaseCounts` would drift silently from the one the server validates against. Only `alert-sort.ts` (no imports) may be imported for a value; `aggregate.ts` pulls in server config, so it is imported with `import type` and re-exported with `export type`.

Rules carried over from today's page and encoded here:
- Overdue and Due ≤ 7d are mutually exclusive (both set keeps `overdue`).
- Sorting: each header key has a first direction (`ALERT_SORT_FIRST_DIR`: Age starts descending, so the oldest alert comes first; every other key starts ascending), and `sort: null` means the server's default order with no active header.
- Resolved status disables and clears both time toggles.
- Both time toggles are cleared when no SLA is active.
- A hand-edited `?baseline=` that is not `last`, `7d`, `30d` or a real calendar date becomes `last`. The summary route answers an invalid baseline with a 400, which the page treats as a full-page error, so the URL value must never reach the request. The calendar check is re-implemented here because `filters.ts` imports server config.
- The page never sends `severity=both`. The old `?sev=` key is never read.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/unit/vuln-security-state.test.ts
import { readValue } from '@/lib/url-state';
import {
  VIEW_SCHEMA, OWN_SCHEMA, CODEBASE_SCHEMA, TEAM_SCHEMA, REPO_SCHEMA, SEVERITY_SCHEMA, BASELINE_SCHEMA, RANGE_SCHEMA,
  kSev, codebaseOptionCount, scopeOpenCount, trendSince, sparklineSince, sanitiseBaseline, keepTopDelta,
  DEFAULT_ALERT_LIST, sanitiseAlertList, alertsQueryString, ALERT_SORT_KEYS, ALERT_SORT_FIRST_DIR, type AlertListState,
} from '@/app/vulnerabilities/security-state';
import { ALERT_SORT_KEYS as SERVER_SORT_KEYS, parseAlertSort } from '@/lib/vulnerabilities/alert-sort';
import { repoRow, cell } from '../support/security-fixtures';

const SCHEMAS = [VIEW_SCHEMA, OWN_SCHEMA, CODEBASE_SCHEMA, TEAM_SCHEMA, REPO_SCHEMA, SEVERITY_SCHEMA, BASELINE_SCHEMA, RANGE_SCHEMA];

describe('URL schemas (spec section 5)', () => {
  it.each([
    ['view', VIEW_SCHEMA, 'overview', 'push'],
    ['own', OWN_SCHEMA, 'teams', 'push'],
    ['codebase', CODEBASE_SCHEMA, 'backend', 'replace'],
    ['team', TEAM_SCHEMA, null, 'replace'],
    ['repo', REPO_SCHEMA, null, 'replace'],
    ['severity', SEVERITY_SCHEMA, 'both', 'replace'],
    ['baseline', BASELINE_SCHEMA, 'last', 'replace'],
    ['range', RANGE_SCHEMA, 'all', 'replace'],
  ] as const)('%s: default %s, history %s', (key, schema, def, history) => {
    expect(schema.key).toBe(key);
    expect(schema.default).toBe(def);
    expect(schema.history).toBe(history);
  });

  it('every key is declared scroll:false', () => {
    for (const s of SCHEMAS) expect(s.scroll).toBe(false);
  });

  it('no schema reads the retired `sev` key, and an old ?sev=high link reads as the default severity', () => {
    expect(SCHEMAS.map(s => s.key)).not.toContain('sev');
    expect(readValue(new URLSearchParams('sev=high'), SEVERITY_SCHEMA)).toBe('both');
    expect(kSev(readValue(new URLSearchParams('sev=high'), SEVERITY_SCHEMA))).toBe('critical');
  });

  it('enum keys fall back to their default for a hand-edited value', () => {
    expect(readValue(new URLSearchParams('view=bogus'), VIEW_SCHEMA)).toBe('overview');
    expect(readValue(new URLSearchParams('own=bogus'), OWN_SCHEMA)).toBe('teams');
    expect(readValue(new URLSearchParams('codebase=bogus'), CODEBASE_SCHEMA)).toBe('backend');
    expect(readValue(new URLSearchParams('severity=bogus'), SEVERITY_SCHEMA)).toBe('both');
    expect(readValue(new URLSearchParams('range=bogus'), RANGE_SCHEMA)).toBe('all');
  });
});

describe('kSev', () => {
  it('is critical unless Severity is "High only"', () => {
    expect(kSev('both')).toBe('critical');
    expect(kSev('critical')).toBe('critical');
    expect(kSev('high')).toBe('high');
  });
});

describe('sanitiseBaseline', () => {
  it.each(['last', '7d', '30d', '2026-09-15'])('keeps %s', v => expect(sanitiseBaseline(v)).toBe(v));
  it.each(['garbage', '', '2026-02-30', '2026-9-1', '14d', '2026-09-15T00:00:00Z'])('maps %j to last', v => expect(sanitiseBaseline(v)).toBe('last'));
});

describe('trendSince and sparklineSince (UTC day arithmetic)', () => {
  const now = new Date('2026-09-23T12:34:56Z');
  it('trendSince: all is null; 30d/90d/1y are today minus 30/90/365 days', () => {
    expect(trendSince('all', now)).toBeNull();
    expect(trendSince('30d', now)).toBe('2026-08-24');
    expect(trendSince('90d', now)).toBe('2026-06-25');
    expect(trendSince('1y', now)).toBe('2025-09-23');
  });
  it('sparklineSince is always today minus 90 days', () => {
    expect(sparklineSince(now)).toBe('2026-06-25');
  });
});

describe('codebaseOptionCount follows Severity (the count shown on each Codebase option)', () => {
  const counts = {
    backend: { critical: 5, high: 3 }, frontend: { critical: 2, high: 0 }, shared: { critical: 0, high: 0 },
    other: { critical: 1, high: 1 }, all: { critical: 8, high: 4 },
  };
  it('both sums critical and high; critical-only and high-only pick one', () => {
    expect(codebaseOptionCount(counts, 'backend', 'both')).toBe(8);
    expect(codebaseOptionCount(counts, 'backend', 'critical')).toBe(5);
    expect(codebaseOptionCount(counts, 'backend', 'high')).toBe(3);
    expect(codebaseOptionCount(counts, 'all', 'both')).toBe(12);
  });
  it('is null while the counts have not loaded', () => {
    expect(codebaseOptionCount(undefined, 'backend', 'both')).toBeNull();
  });
});

describe('scopeOpenCount (the Alerts tab count)', () => {
  const rows = [
    repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 3 }), high: cell({ open: 1 }) }),
    repoRow('acme/ledger', 'Payments', { critical: cell({ open: 2 }), high: cell({ open: 0 }) }),
    // Unmeasured: its stored count still appears in the alert list, so it must count here too.
    repoRow('acme/legacy-batch', 'Platform', { critical: cell({ open: 4 }), high: cell({ open: 2 }), unmeasured: { status: 'error', detail: 'x' } }),
  ];
  it('sums open counts under Severity, including an unmeasured row\'s stored count', () => {
    expect(scopeOpenCount(rows, 'both', null)).toBe(12);
    expect(scopeOpenCount(rows, 'critical', null)).toBe(9);
    expect(scopeOpenCount(rows, 'high', null)).toBe(3);
  });
  it('narrows to the selected repository', () => {
    expect(scopeOpenCount(rows, 'both', 'acme/checkout-api')).toBe(4);
    expect(scopeOpenCount(rows, 'critical', 'acme/legacy-batch')).toBe(4);
  });
});

describe('sort keys and first directions (Wave 1 owns the keys; the page owns where each header starts)', () => {
  it('ALERT_SORT_KEYS is the very array the server validates against, not a copy', () => {
    expect(ALERT_SORT_KEYS).toBe(SERVER_SORT_KEYS);
  });
  it('every key has a first direction; Age starts descending (oldest first) and the rest ascending', () => {
    expect(Object.keys(ALERT_SORT_FIRST_DIR).sort()).toEqual([...ALERT_SORT_KEYS].sort());
    expect(ALERT_SORT_FIRST_DIR).toEqual({ severity: 'asc', advisory: 'asc', repo: 'asc', age: 'desc', due: 'asc', state: 'asc' });
  });
  it('the sort value alertsQueryString puts on the wire is one the server parser accepts, for every key and direction', () => {
    const base = { codebase: 'backend' as const, team: null, repo: null, severity: 'both' as const, anySlaActive: true };
    for (const key of ALERT_SORT_KEYS) {
      for (const dir of ['asc', 'desc'] as const) {
        const wire = new URLSearchParams(alertsQueryString({ ...base, list: { ...DEFAULT_ALERT_LIST, sort: { key, dir } } })).get('sort');
        expect(parseAlertSort(wire as string)).toEqual({ key, dir });
      }
    }
  });
  it('no sort in the list state sends no sort parameter (the server default order)', () => {
    const base = { codebase: 'backend' as const, team: null, repo: null, severity: 'both' as const, anySlaActive: true };
    expect(new URLSearchParams(alertsQueryString({ ...base, list: DEFAULT_ALERT_LIST })).has('sort')).toBe(false);
  });
});

describe('keepTopDelta (scroll up only)', () => {
  it('scrolls up just enough that the content starts at the bar bottom', () => {
    expect(keepTopDelta(20, 84)).toBe(-64);
  });
  it('never scrolls down: content already below the bar gives 0', () => {
    expect(keepTopDelta(84, 84)).toBe(0);
    expect(keepTopDelta(300, 84)).toBe(0);
  });
});

describe('sanitiseAlertList', () => {
  const on: AlertListState = { ...DEFAULT_ALERT_LIST, overdue: true, dueSoon: true };
  it('keeps only Overdue when both time toggles are set (they are mutually exclusive)', () => {
    const out = sanitiseAlertList(on, { anySlaActive: true });
    expect(out.overdue).toBe(true);
    expect(out.dueSoon).toBe(false);
  });
  it('Resolved status clears both time toggles', () => {
    const out = sanitiseAlertList({ ...on, status: 'resolved' }, { anySlaActive: true });
    expect([out.overdue, out.dueSoon]).toEqual([false, false]);
  });
  it('Open + resolved keeps the toggles', () => {
    expect(sanitiseAlertList({ ...on, status: 'all' }, { anySlaActive: true }).overdue).toBe(true);
  });
  it('clears both toggles when no SLA is active', () => {
    const out = sanitiseAlertList(on, { anySlaActive: false });
    expect([out.overdue, out.dueSoon]).toEqual([false, false]);
  });
  it('clamps the page to a positive integer', () => {
    expect(sanitiseAlertList({ ...DEFAULT_ALERT_LIST, page: 0 }, { anySlaActive: true }).page).toBe(1);
    expect(sanitiseAlertList({ ...DEFAULT_ALERT_LIST, page: 2.7 }, { anySlaActive: true }).page).toBe(2);
  });
});

describe('alertsQueryString', () => {
  const base = { codebase: 'backend' as const, team: null, repo: null, severity: 'both' as const, list: DEFAULT_ALERT_LIST, anySlaActive: true };
  it('default scope: no severity, no team, first page of 10', () => {
    expect(alertsQueryString(base)).toBe('codebase=backend&state=open&limit=10&offset=0');
  });
  it('omits severity for "both" and never sends the text "both"', () => {
    expect(alertsQueryString(base)).not.toContain('severity');
    expect(alertsQueryString(base)).not.toContain('both');
  });
  it('sends a single severity as is', () => {
    expect(new URLSearchParams(alertsQueryString({ ...base, severity: 'high' })).get('severity')).toBe('high');
  });
  it('offset is (page - 1) x 10', () => {
    const p = new URLSearchParams(alertsQueryString({ ...base, list: { ...DEFAULT_ALERT_LIST, page: 3 } }));
    expect(p.get('limit')).toBe('10');
    expect(p.get('offset')).toBe('20');
  });
  it('maps every list filter to the API parameter names', () => {
    const p = new URLSearchParams(alertsQueryString({
      ...base, codebase: 'frontend', team: 'Search & Co', repo: 'acme/search-index', severity: 'critical',
      list: { ...DEFAULT_ALERT_LIST, status: 'all', overdue: true, reopened: true, runtimeOnly: true, q: 'lodash', sort: { key: 'due', dir: 'desc' } },
    }));
    expect(Object.fromEntries(p.entries())).toEqual({
      codebase: 'frontend', team: 'Search & Co', repo: 'acme/search-index', severity: 'critical', state: 'all',
      overdue: 'true', reopened: 'true', dependency_scope: 'runtime', q: 'lodash', limit: '10', offset: '0', sort: 'due:desc',
    });
  });
  it('uses due_soon for the Due ≤ 7d toggle', () => {
    const p = new URLSearchParams(alertsQueryString({ ...base, list: { ...DEFAULT_ALERT_LIST, dueSoon: true } }));
    expect(p.get('due_soon')).toBe('true');
    expect(p.has('overdue')).toBe(false);
  });
  it('sanitises at build time: both toggles never reach the request, Resolved and no-SLA drop them', () => {
    const both = { ...DEFAULT_ALERT_LIST, overdue: true, dueSoon: true };
    const p1 = new URLSearchParams(alertsQueryString({ ...base, list: both }));
    expect([p1.get('overdue'), p1.has('due_soon')]).toEqual(['true', false]);
    const p2 = new URLSearchParams(alertsQueryString({ ...base, list: { ...both, status: 'resolved' } }));
    expect([p2.has('overdue'), p2.has('due_soon')]).toEqual([false, false]);
    const p3 = new URLSearchParams(alertsQueryString({ ...base, anySlaActive: false, list: both }));
    expect([p3.has('overdue'), p3.has('due_soon')]).toEqual([false, false]);
  });
});
```

The test imports fixtures from `../support/security-fixtures`. Task 2.5 creates that file; to keep this task self-contained, create it FIRST in this step with only the two helpers this test needs, then Task 2.5 extends it:

```ts
// src/lib/__tests__/support/security-fixtures.ts  (created here with two helpers; Task 2.5 extends it)
import type { RepoRow, RepoSevCell } from '@/lib/vulnerabilities/aggregate';

export const cell = (over: Partial<RepoSevCell> = {}): RepoSevCell => ({
  open: 0, overdue: null, dueSoon: null, oldestOpenDays: null, nextDue: null, ...over,
});

export const repoRow = (fullName: string, team: string, over: Partial<RepoRow> = {}): RepoRow => ({
  fullName, team, codebaseGroup: 'backend', critical: cell(), high: cell(), unmeasured: null, ...over,
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-security-state.test.ts --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/security-state'".

- [ ] **Step 3: Implement**

```ts
// src/app/vulnerabilities/security-state.ts
'use client';
// GLOOK-64: the Security page's URL schemas, the severity rule, the sanitising rules for
// hand-edited input, and the alert-list query builder. This task is the pure half; Task 2.6 adds
// the two hooks (useSecurityUrl, useAlertList) to this file.
//
// Client-safe: type-only imports from aggregate.ts (it pulls in server config), and the calendar
// check below is re-implemented because filters.ts also imports server config.
import type { UrlSchema } from '@/lib/url-state';
import type { CodebaseGroup, Severity } from '@/lib/vulnerabilities/types';
import type { CodebaseCounts, RepoRow } from '@/lib/vulnerabilities/aggregate';
import { ALERT_SORT_KEYS, type AlertSortDir, type AlertSortKey, type AlertSortSpec } from '@/lib/vulnerabilities/alert-sort';
import { addDays } from '@/lib/vulnerabilities/time';
import { CODEBASE_GROUPS } from '@/lib/vulnerabilities/codebase-labels';
import { ALERT_PAGE_SIZE } from './dimensions';

export type SecurityView = 'overview' | 'alerts';
export type OwnTab = 'teams' | 'repos';
export type SeverityFilter = 'both' | 'critical' | 'high';
export type TrendRange = '30d' | '90d' | '1y' | 'all';

// Wave 1 owns these names. They are re-exported so the page's modules import from one place; a
// local copy would drift from what the server validates against.
export { ALERT_SORT_KEYS };
export type { AlertSortKey, AlertSortDir, AlertSortSpec, CodebaseCounts };

// ── URL schemas (spec section 5). Module-level consts: useUrlState keys off schema fields, so the
// same object must be used at every call site. `scroll: false` on every key keeps the viewport still.
export const VIEW_SCHEMA: UrlSchema<SecurityView> = { key: 'view', type: 'enum', values: ['overview', 'alerts'], default: 'overview', history: 'push', scroll: false };
export const OWN_SCHEMA: UrlSchema<OwnTab> = { key: 'own', type: 'enum', values: ['teams', 'repos'], default: 'teams', history: 'push', scroll: false };
export const CODEBASE_SCHEMA: UrlSchema<CodebaseGroup> = { key: 'codebase', type: 'enum', values: CODEBASE_GROUPS, default: 'backend', history: 'replace', scroll: false };
export const TEAM_SCHEMA: UrlSchema<string | null> = { key: 'team', type: 'string', default: null, history: 'replace', scroll: false };
export const REPO_SCHEMA: UrlSchema<string | null> = { key: 'repo', type: 'string', default: null, history: 'replace', scroll: false };
export const SEVERITY_SCHEMA: UrlSchema<SeverityFilter> = { key: 'severity', type: 'enum', values: ['both', 'critical', 'high'], default: 'both', history: 'replace', scroll: false };
export const BASELINE_SCHEMA: UrlSchema<string> = { key: 'baseline', type: 'string', default: 'last', history: 'replace', scroll: false };
export const RANGE_SCHEMA: UrlSchema<TrendRange> = { key: 'range', type: 'enum', values: ['30d', '90d', '1y', 'all'], default: 'all', history: 'replace', scroll: false };

/** The severity the KPI tiles, sparkline and trend use: critical, unless Severity is "High only". */
export const kSev = (s: SeverityFilter): Severity => (s === 'high' ? 'high' : 'critical');

/** The count on a Codebase option: follows Severity (and, server-side, the Owning team). */
export function codebaseOptionCount(counts: CodebaseCounts | undefined, group: CodebaseGroup, severity: SeverityFilter): number | null {
  const c = counts?.[group];
  if (!c) return null;
  return severity === 'critical' ? c.critical : severity === 'high' ? c.high : c.critical + c.high;
}

/** Open alerts under Severity for the rows in scope (optionally one repository). An unmeasured
 * row's stored count is included on purpose: the alert list does not exclude unmeasured
 * repositories, so this equals the list's totalCount when status is open and no other list filter
 * is set. */
export function scopeOpenCount(rows: readonly RepoRow[], severity: SeverityFilter, repo: string | null): number {
  let n = 0;
  for (const r of rows) {
    if (repo && r.fullName !== repo) continue;
    if (severity !== 'high') n += r.critical.open;
    if (severity !== 'critical') n += r.high.open;
  }
  return n;
}

const TREND_RANGE_DAYS = { '30d': 30, '90d': 90, '1y': 365 } as const;
/** `all` sends no `since`; every other range is today minus 30/90/365 days (UTC). */
export function trendSince(range: TrendRange, now: Date): string | null {
  if (range === 'all') return null;
  return addDays(now.toISOString().slice(0, 10), -TREND_RANGE_DAYS[range]);
}
/** The KPI sparkline is always the last 90 days, whatever the trend card's Range says. */
export const SPARKLINE_DAYS = 90;
export function sparklineSince(now: Date): string {
  return addDays(now.toISOString().slice(0, 10), -SPARKLINE_DAYS);
}

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** A hand-edited baseline that the API would reject (HTTP 400, which blanks the page) becomes 'last'. */
export function sanitiseBaseline(raw: string): string {
  return raw === 'last' || raw === '7d' || raw === '30d' || isCalendarDate(raw) ? raw : 'last';
}

/** View switch: how far to scroll (always <= 0) so the content starts right under the sticky bar.
 * Both arguments are viewport-relative y positions from getBoundingClientRect. */
export function keepTopDelta(contentTop: number, barBottom: number): number {
  return contentTop < barBottom ? contentTop - barBottom : 0;
}

// ── Alert-list state. Local state, not URL (spec section 5); lives here because the data hook owns
// the alerts SWR key and needs it.
export type AlertStatus = 'open' | 'resolved' | 'all';

/** The direction a header starts in when it is first clicked. Age starts descending (oldest alert
 * first, the order a triage list wants); every other key starts ascending. Clicking the active
 * header again reverses it. */
export const ALERT_SORT_FIRST_DIR: Record<AlertSortKey, AlertSortDir> = {
  severity: 'asc', advisory: 'asc', repo: 'asc', age: 'desc', due: 'asc', state: 'asc',
};

export interface AlertListState {
  status: AlertStatus;
  overdue: boolean;
  dueSoon: boolean;
  reopened: boolean;
  runtimeOnly: boolean;
  q: string;
  /** null = the server's default order (soonest due, then severity, then newest), no active header. */
  sort: { key: AlertSortKey; dir: AlertSortDir } | null;
  /** 1-based. */
  page: number;
}
export const DEFAULT_ALERT_LIST: AlertListState = {
  status: 'open', overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', sort: null, page: 1,
};

/** The list as it may actually be sent. Applied at request-build time, so a bad combination never
 * costs a wasted request. */
export function sanitiseAlertList(l: AlertListState, ctx: { anySlaActive: boolean }): AlertListState {
  const page = Number.isFinite(l.page) ? Math.max(1, Math.floor(l.page)) : 1;
  // Resolved has no due date, and with no active SLA there is nothing to be overdue against.
  const timeAllowed = l.status !== 'resolved' && ctx.anySlaActive;
  const overdue = timeAllowed && l.overdue;
  // Overdue and Due ≤ 7d are disjoint buckets; the API rejects both together. Keep Overdue.
  const dueSoon = timeAllowed && l.dueSoon && !overdue;
  return { ...l, overdue, dueSoon, page };
}

export interface AlertsQueryInput {
  codebase: CodebaseGroup;
  team: string | null;
  repo: string | null;
  severity: SeverityFilter;
  list: AlertListState;
  anySlaActive: boolean;
}

/** The alerts request's query string. `severity` is omitted for "both" (never `severity=both`). */
export function alertsQueryString(i: AlertsQueryInput): string {
  const l = sanitiseAlertList(i.list, { anySlaActive: i.anySlaActive });
  const p = new URLSearchParams({ codebase: i.codebase });
  if (i.team) p.set('team', i.team);
  if (i.repo) p.set('repo', i.repo);
  if (i.severity !== 'both') p.set('severity', i.severity);
  p.set('state', l.status);
  if (l.overdue) p.set('overdue', 'true');
  if (l.dueSoon) p.set('due_soon', 'true');
  if (l.reopened) p.set('reopened', 'true');
  if (l.runtimeOnly) p.set('dependency_scope', 'runtime');
  if (l.q) p.set('q', l.q);
  p.set('limit', String(ALERT_PAGE_SIZE));
  p.set('offset', String((l.page - 1) * ALERT_PAGE_SIZE));
  if (l.sort) {
    const sort: AlertSortSpec = `${l.sort.key}:${l.sort.dir}`;
    p.set('sort', sort);
  }
  return p.toString();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/__tests__/unit/vuln-security-state.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS; `tsc` clean. (`tsc` needs Wave 1's `RepoRow` export in `aggregate.ts`; if Wave 1 has not landed, this is the first place it shows.)

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/security-state.ts src/lib/__tests__/unit/vuln-security-state.test.ts src/lib/__tests__/support/security-fixtures.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Security URL schemas, severity rule and alert query builder"
```

### Task 2.5: Test support (reactive navigation mock, fixtures, fetch router)

**Files:**
- Create: `src/lib/__tests__/support/security-nav-mock.ts`
- Modify: `src/lib/__tests__/support/security-fixtures.ts` (created in Task 2.4 with two helpers; replace with the full file below)
- Create: `src/app/vulnerabilities/api-types.ts` (the response types the typed fixtures return; created here, not in Task 2.7, so `npx tsc --noEmit` passes at the end of this task)
- Test: `src/lib/__tests__/unit/vuln-security-support.test.tsx`

**Interfaces:**
- Consumes: `RepoRow`, `RepoSevCell` (Wave 1); `AlertRow`, `CoverageRow`, `DeltaResult`, `SevCell`, `TeamRow` (`@/lib/vulnerabilities/aggregate`, existing); `SyncStatusInfo`, `getSummary`, `getRepos`, `getCoverage`, `getAlerts`, `getTrend`, `Unavailable` (`@/lib/vulnerabilities/queries`, type-only; `getRepos` is Wave 1).
- Produces: `SummaryData`, `ReposData`, `CoverageData`, `AlertsData`, `TrendData`, `UnavailableData` and `Slot<T>` (from `api-types.ts`); `createNavigationMock`; the fixtures `SYNC_AT`, `cell`, `repoRow`, `REPO_ROWS`, `syncInfo`, `teamRow`, `summaryFixture`, `reposFixture`, `coverageFixture`, `coverageRow`, `trendFixture`, `alertRow`, `alertsFixture`, `slot`, `SwrFresh`, `RouteName`, `Reply`, `Route`, `fetchRouter`, `callsTo` (all described in the Wave 2 public interface). Every builder returns the real response type, with `Partial<...>` overrides.

Why these exist: five old suites each copy a 25-line `next/navigation` mock, and none of them record the options (`{ scroll: false }`) or whether a write was a push or a replace. Every Wave 2 to 4 test that checks URL writes needs both, and the old approach of mocking `@/lib/url-state` with only `useUrlState` cannot work once the page calls `useUrlBatch`. Files under `src/lib/__tests__/support/` are not matched by `testMatch`, so Jest does not run them as tests (the existing `setup/` folder works the same way).

The builders are typed with the real response shapes (`SummaryData`, `ReposData`, ...) rather than `any`, so a fixture that drifts from the API fails `npx tsc --noEmit` instead of letting a test pass against a payload the server never sends. A delta with no baseline to compare against is `{ available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null }`. The alerts and trend routes echo the request's parameters in `appliedFilters`, as the real routes do, so a test that reads `appliedFilters` sees realistic values.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-support.test.tsx
// The support modules are test infrastructure, but every URL-state test in Waves 2 to 4 trusts
// them, so their own behaviour is pinned here: a mock that silently dropped the options argument
// or the push/replace distinction would make those tests pass for the wrong reason.
import { renderHook, act } from '@testing-library/react';
import { createNavigationMock } from '../support/security-nav-mock';
import { fetchRouter, callsTo, REPO_ROWS, summaryFixture, slot } from '../support/security-fixtures';

describe('createNavigationMock', () => {
  it('records push and replace with their options and re-renders subscribers with the new search', () => {
    const nav = createNavigationMock('a=1');
    const { result } = renderHook(() => ({ router: nav.useRouter(), params: nav.useSearchParams() }));
    expect(result.current.params.get('a')).toBe('1');

    act(() => result.current.router.push('/vulnerabilities?view=alerts', { scroll: false }));
    expect(nav.__calls).toEqual([{ kind: 'push', url: '/vulnerabilities?view=alerts', opts: { scroll: false } }]);
    expect(result.current.params.get('view')).toBe('alerts');

    act(() => result.current.router.replace('/vulnerabilities'));
    expect(nav.__calls[1]).toEqual({ kind: 'replace', url: '/vulnerabilities', opts: undefined });
    expect(result.current.params.has('view')).toBe(false);
  });

  it('__resetSearch sets the search and clears the recorded calls', () => {
    const nav = createNavigationMock();
    const { result } = renderHook(() => nav.useSearchParams());
    act(() => nav.useRouter().push('/vulnerabilities?x=1'));
    expect(nav.__calls).toHaveLength(1);
    act(() => nav.__resetSearch('team=Payments'));
    expect(nav.__calls).toHaveLength(0);
    expect(result.current.get('team')).toBe('Payments');
  });
});

describe('fetchRouter', () => {
  it('answers by route name, echoes the applied filters from the URL, and honours a status', async () => {
    const f = fetchRouter({ alerts: { status: 400, body: { error: 'unknown repo' } } });

    const ok = await f('/api/vulnerabilities/repos?codebase=frontend&team=Search');
    expect(ok.ok).toBe(true);
    const body = await ok.json();
    expect(body.appliedFilters).toEqual({ codebase: 'frontend', team: 'Search' });
    expect(body.rows).toHaveLength(REPO_ROWS.length);

    const bad = await f('/api/vulnerabilities/alerts?codebase=backend');
    expect([bad.ok, bad.status]).toEqual([false, 400]);
    expect(await bad.json()).toEqual({ error: 'unknown repo' });

    expect(callsTo(f, 'repos')).toHaveLength(1);
    expect(callsTo(f, 'alerts')[0].searchParams.get('codebase')).toBe('backend');
  });

  it('a route may be a function of the URL (and async)', async () => {
    const f = fetchRouter({ summary: async url => ({ body: { team: url.searchParams.get('team') } }) });
    const res = await f('/api/vulnerabilities/summary?team=Search');
    expect(await res.json()).toEqual({ team: 'Search' });
  });

  it('the alerts and trend routes echo the request as realistic appliedFilters (camelCase keys, numeric limit and offset, boolean flags)', async () => {
    const f = fetchRouter();
    const alerts = await (await f('/api/vulnerabilities/alerts?codebase=frontend&state=all&limit=10&offset=20&sort=due:asc&due_soon=true')).json();
    expect(alerts.appliedFilters).toEqual({ codebase: 'frontend', state: 'all', limit: 10, offset: 20, sort: 'due:asc', dueSoon: true });
    const trend = await (await f('/api/vulnerabilities/trend?codebase=shared&severity=high&since=2026-06-25')).json();
    expect(trend.appliedFilters).toEqual({ codebase: 'shared', severity: 'high', since: '2026-06-25' });
  });
});

describe('typed builders', () => {
  it('summaryFixture is a healthy payload; a delta with no baseline has the exact "unavailable" shape the caption code reads', () => {
    const s = summaryFixture();
    expect(s.delta.critical).toEqual({ available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null });
    expect(s.pivot.total.critical.open).toBe(10);
    expect(summaryFixture({ org: 'other' }).org).toBe('other');
    expect(summaryFixture({ org: 'other' }).knownTeams).toEqual(s.knownTeams);
  });

  it('slot(): data in hand is neither loading nor stale; no data is loading unless overridden', () => {
    expect(slot('x')).toMatchObject({ data: 'x', loading: false, stale: false, errorText: null });
    expect(slot<string>(undefined)).toMatchObject({ data: undefined, loading: true });
    expect(slot<string>(undefined, { loading: false, errorText: 'boom' })).toMatchObject({ loading: false, errorText: 'boom' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-security-support.test.tsx --maxWorkers=3`
Expected: FAIL with "Cannot find module '../support/security-nav-mock'".

- [ ] **Step 3: Implement**

```ts
// src/lib/__tests__/support/security-nav-mock.ts
// A reactive stand-in for next/navigation. push/replace update the search string and re-render
// every component that called useSearchParams(), the same round trip the real router makes, and
// each call is recorded with its options so tests can assert push vs replace and `scroll: false`.
//
// Use it as:
//   jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
//   const nav = () => jest.requireMock('next/navigation') as ReturnType<typeof createNavigationMock>;
//   nav().__resetSearch('team=Payments');   // call inside act() if a component is mounted
import React from 'react';

export interface NavCall { kind: 'push' | 'replace'; url: string; opts: unknown }

export function createNavigationMock(initialSearch = '') {
  let currentSearch = initialSearch;
  const listeners = new Set<() => void>();
  const calls: NavCall[] = [];
  const notify = () => listeners.forEach(l => l());
  const navigate = (kind: NavCall['kind'], url: string, opts?: unknown) => {
    calls.push({ kind, url, opts });
    currentSearch = url.includes('?') ? url.split('?')[1] : '';
    notify();
  };
  return {
    useRouter: () => ({
      push: (url: string, opts?: unknown) => navigate('push', url, opts),
      replace: (url: string, opts?: unknown) => navigate('replace', url, opts),
    }),
    useSearchParams: () => {
      const [, force] = React.useReducer((c: number) => c + 1, 0);
      React.useEffect(() => {
        listeners.add(force);
        return () => { listeners.delete(force); };
      }, []);
      return new URLSearchParams(currentSearch);
    },
    usePathname: () => '/vulnerabilities',
    __resetSearch: (qs: string) => { currentSearch = qs; calls.length = 0; notify(); },
    __calls: calls,
  };
}
```

```ts
// src/app/vulnerabilities/api-types.ts
// GLOOK-64: the response shapes the page reads, derived from the query functions themselves so
// the page cannot drift from the API. Type-only imports: queries.ts reads the database and
// process.env, and must never reach the client bundle.
import type { getSummary, getRepos, getCoverage, getAlerts, getTrend, Unavailable } from '@/lib/vulnerabilities/queries';

type Ok<F extends (...args: any[]) => Promise<unknown>> = Extract<Awaited<ReturnType<F>>, { available: true }>;

export type SummaryData = Ok<typeof getSummary>;
export type ReposData = Ok<typeof getRepos>;
export type CoverageData = Ok<typeof getCoverage>;
export type AlertsData = Ok<typeof getAlerts>;
export type TrendData = Ok<typeof getTrend>;
/** The 200 "not available yet" envelope every data route can return (no sync yet, feature off). */
export type UnavailableData = Unavailable;

/** One data slot as `useSecurityData` (Task 2.7) returns it. Defined here so the test fixtures can
 * type `slot()` without importing a module a later task creates; `use-security-data.ts` re-exports it. */
export interface Slot<T> {
  /** The available:true payload, or undefined. */
  data: T | undefined;
  unavailable: UnavailableData | undefined;
  error: unknown;
  /** panelError(error, label): "Couldn't load <label>: <message>", or null. */
  errorText: string | null;
  /** The key has never resolved and there is nothing to show. */
  loading: boolean;
  /** The previous key's data is on screen while the new key loads (isLoading with data in hand). */
  stale: boolean;
}
```

```ts
// src/lib/__tests__/support/security-fixtures.ts
// Shared fixtures for the Security page tests. Invented names only (acme/..., Payments, Search,
// Platform): this repository is public. Every builder returns the real response type from
// api-types.ts, so a test fixture that drifts from the API fails `tsc` instead of passing quietly.
import React from 'react';
import { SWRConfig } from 'swr';
import type { AlertRow, CoverageRow, DeltaResult, RepoRow, RepoSevCell, SevCell, TeamRow } from '@/lib/vulnerabilities/aggregate';
import type { SyncStatusInfo } from '@/lib/vulnerabilities/queries';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import type { AlertsData, CoverageData, ReposData, Slot, SummaryData, TrendData } from '@/app/vulnerabilities/api-types';

export const SYNC_AT = '2026-09-22T06:00:00Z';

export const cell = (over: Partial<RepoSevCell> = {}): RepoSevCell => ({
  open: 0, overdue: null, dueSoon: null, oldestOpenDays: null, nextDue: null, ...over,
});

export const repoRow = (fullName: string, team: string, over: Partial<RepoRow> = {}): RepoRow => ({
  fullName, team, codebaseGroup: 'backend', critical: cell(), high: cell(), unmeasured: null, ...over,
});

/** Open totals: critical 3+2+1+4 = 10, high 1+0+2+0 = 3 (the unmeasured row's stored 4 is included). */
export const REPO_ROWS: RepoRow[] = [
  repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 3, overdue: 1, dueSoon: 0 }), high: cell({ open: 1 }) }),
  repoRow('acme/ledger', 'Payments', { critical: cell({ open: 2, overdue: 0, dueSoon: 1 }), high: cell({ open: 0 }) }),
  repoRow('acme/search-index', 'Search', { critical: cell({ open: 1, overdue: 0, dueSoon: 0 }), high: cell({ open: 2 }) }),
  repoRow('acme/legacy-batch', 'Platform', {
    critical: cell({ open: 4 }), high: cell(), unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' },
  }),
];

export const syncInfo = (over: Partial<SyncStatusInfo> = {}): SyncStatusInfo => ({
  stale: false, lastSuccessfulAt: SYNC_AT, lastStatus: 'succeeded', running: false, issuesCount: 0, issues: [], ...over,
});

const sevCell = (open: number, over: Partial<SevCell> = {}): SevCell => ({
  open, resolved: 0, dismissed: 0, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 0, ...over,
});
export const teamRow = (team: string, critical: number, high: number): TeamRow => ({
  team, critical: sevCell(critical), high: sevCell(high), unmeasuredRepos: 0,
});

/** A delta with no baseline to compare against. */
const NO_DELTA: DeltaResult = { available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null };

export function summaryFixture(over: Partial<SummaryData> = {}): SummaryData {
  return {
    available: true, org: 'acme', sync: syncInfo(), appliedFilters: { codebase: 'backend', baseline: 'last' }, configErrors: [],
    resolvedCountStartDate: '2020-01-08', resolvedCountInvalid: false, resolvedSince: { date: '2020-01-08', invalid: false },
    scope: { property: 'service_tier', value: 'production' },
    policy: [{ id: 'critical-2020-01', severity: 'critical', days: 9, effectiveFrom: '2020-01-08', until: null, pending: false }],
    slaPolicyInvalid: false,
    slaStatus: { critical: 'active', high: 'none' },
    pivot: { rows: [teamRow('Payments', 5, 1), teamRow('Search', 1, 2)], total: teamRow('Total', 10, 3) },
    kpi: { openCriticalOtherCodebases: null },
    delta: { critical: NO_DELTA, high: NO_DELTA },
    knownTeams: ['Payments', 'Platform', 'Search', 'Unassigned'],
    codebaseCounts: {
      backend: { critical: 10, high: 3 }, frontend: { critical: 2, high: 1 }, shared: { critical: 0, high: 0 },
      other: { critical: 0, high: 0 }, all: { critical: 12, high: 4 },
    },
    ...over,
  };
}

export const reposFixture = (
  rows: RepoRow[], applied: ReposData['appliedFilters'] = { codebase: 'backend' }, over: Partial<ReposData> = {},
): ReposData => ({
  available: true, sync: syncInfo(), appliedFilters: applied, configErrors: [], rows, ...over,
});

export const coverageFixture = (over: Partial<CoverageData> = {}): CoverageData => ({
  available: true, sync: syncInfo(), appliedFilters: { codebase: 'backend' }, configErrors: [],
  needsTagging: [], excludedByPolicy: [], unmeasured: [], ...over,
});

/** A coverage-list row. The defaults describe an unmeasured repository; override what a test needs. */
export const coverageRow = (over: Partial<CoverageRow> = {}): CoverageRow => ({
  repoId: 1, fullName: 'acme/legacy-batch', serviceTier: 'production', codebaseType: 'backend', team: 'Platform',
  openCritical: 0, openHigh: 0, detail: null, dependabotStatus: 'error', ...over,
});

export const trendFixture = (
  series: TrendData['series'] = [], applied: TrendData['appliedFilters'] = { codebase: 'backend', severity: 'critical' },
): TrendData => ({
  available: true, sync: syncInfo(), appliedFilters: applied, configErrors: [], series,
});

/** An alert-list row (a critical, open, not yet due alert). Override what a test needs. */
export const alertRow = (over: Partial<AlertRow> = {}): AlertRow => ({
  repo: 'acme/checkout-api', team: 'Payments', severity: 'critical', severityChangedAt: null,
  cveId: 'CVE-2026-0001', ghsaId: 'GHSA-aaaa-bbbb-cccc', summary: 'Prototype pollution in lodash', cvss: 9.8, epss: null,
  packageName: 'lodash', ecosystem: 'npm', manifestPath: 'package.json', relationship: 'direct', scope: 'runtime',
  createdAt: '2026-09-10T00:00:00Z', ageDays: 12, clockStart: '2026-09-10T00:00:00Z', dueDate: '2026-09-19', daysRemaining: 4,
  slaPolicyId: 'critical-2020-01', state: 'open', dismissedReason: null, resolvedAt: null,
  resolvedOnTime: null, resolvedDaysLate: null, reopenedCount: 0, lastReopenedAt: null,
  htmlUrl: 'https://example.invalid/acme/checkout-api/security/dependabot/1', ...over,
});

export const alertsFixture = (
  rows: AlertRow[] = [], totalCount: number = rows.length,
  applied: AlertsData['appliedFilters'] = { codebase: 'backend', state: 'open', limit: 10, offset: 0 },
): AlertsData => ({
  available: true, sync: syncInfo(), appliedFilters: applied, configErrors: [],
  rows, totalCount, truncated: false, excludedByCodebase: 0, repos: [],
});

/** A data slot as useSecurityData returns it (Task 2.7), for component tests that pass slots directly. */
export function slot<T>(data: T | undefined, over: Partial<Slot<T>> = {}): Slot<T> {
  return { data, unavailable: undefined, error: undefined, errorText: null, loading: data === undefined, stale: false, ...over };
}

/** A fresh SWR cache per test, with no dedupe window (otherwise a second test sees the first one's data). */
export function SwrFresh({ children }: { children: React.ReactNode }) {
  return React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);
}

export type RouteName = 'summary' | 'repos' | 'coverage' | 'trend' | 'alerts';
export type Reply = { status?: number; body: unknown };
export type Route = Reply | ((url: URL) => Reply | Promise<Reply>);

/** The codebase and team a request carried, as the repos and coverage routes echo them. */
const scopeApplied = (url: URL): ReposData['appliedFilters'] => {
  const a: ReposData['appliedFilters'] = { codebase: (url.searchParams.get('codebase') ?? 'backend') as CodebaseGroup };
  const team = url.searchParams.get('team');
  if (team) a.team = team;
  return a;
};

/** What the alerts route echoes: every request parameter under its camelCase name, with the
 * numeric ones as numbers and the flags as booleans. The one cast stands for the server's parser. */
const alertsApplied = (url: URL): AlertsData['appliedFilters'] => {
  const out: Record<string, unknown> = {};
  const camel: Record<string, string> = { due_soon: 'dueSoon', dependency_scope: 'dependencyScope' };
  url.searchParams.forEach((v, k) => {
    out[camel[k] ?? k] = k === 'limit' || k === 'offset' ? Number(v) : v === 'true' ? true : v;
  });
  return out as AlertsData['appliedFilters'];
};

/** What the trend route echoes: codebase, severity and, when sent, since. */
const trendApplied = (url: URL): TrendData['appliedFilters'] => {
  const a: TrendData['appliedFilters'] = {
    codebase: (url.searchParams.get('codebase') ?? 'backend') as CodebaseGroup,
    severity: url.searchParams.get('severity') === 'high' ? 'high' : 'critical',
  };
  const since = url.searchParams.get('since');
  if (since) a.since = since;
  return a;
};

/**
 * A fetch mock that answers /api/vulnerabilities/<name> by route name. Defaults are healthy
 * responses; pass a route to override one. A route may be a { status, body } or a function of the
 * request URL (sync or async), which is how a test serves different answers per key or holds a
 * response back until it releases a gate.
 */
export function fetchRouter(routes: Partial<Record<RouteName, Route>> = {}) {
  const defaults: Record<RouteName, Route> = {
    summary: url => ({ body: summaryFixture({ appliedFilters: { ...scopeApplied(url), baseline: url.searchParams.get('baseline') ?? 'last' } }) }),
    repos: url => ({ body: reposFixture(REPO_ROWS, scopeApplied(url)) }),
    coverage: url => ({ body: coverageFixture({ appliedFilters: scopeApplied(url) }) }),
    trend: url => ({ body: trendFixture([], trendApplied(url)) }),
    alerts: url => ({ body: alertsFixture([], 0, alertsApplied(url)) }),
  };
  const merged = { ...defaults, ...routes };
  return jest.fn(async (input: string) => {
    const url = new URL(String(input), 'http://localhost');
    const name = url.pathname.split('/').pop() as RouteName;
    const route = merged[name];
    if (!route) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as unknown as Response;
    const reply = typeof route === 'function' ? await route(url) : route;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.body } as unknown as Response;
  });
}

/** The URLs a fetch mock received for one route, parsed. */
export const callsTo = (fetchMock: jest.Mock, name: RouteName): URL[] =>
  fetchMock.mock.calls
    .map(([u]) => new URL(String(u), 'http://localhost'))
    .filter(u => u.pathname.endsWith(`/${name}`));
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-security-support.test.tsx src/lib/__tests__/unit/vuln-security-state.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS (the state test still passes with the full fixtures file); `tsc` clean, which proves every typed builder matches the real response type.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/api-types.ts src/lib/__tests__/support/security-nav-mock.ts src/lib/__tests__/support/security-fixtures.ts src/lib/__tests__/unit/vuln-security-support.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: reactive navigation mock, response types and typed fixtures for Security page tests"
```

### Task 2.6: `useSecurityUrl` and `useAlertList` (the clearing handlers and list state)

**Files:**
- Modify: `src/app/vulnerabilities/security-state.ts` (swap one import, append two interfaces and two hooks)
- Test: `src/lib/__tests__/unit/vuln-security-hooks.test.tsx`

**Interfaces:**
- Consumes: the Task 2.4 schemas and types; `useUrlState`, `useUrlBatch` from `@/lib/url-state` (existing); `createNavigationMock` (Task 2.5).
- Produces: `SecurityUrl`, `SecurityScope`, `useSecurityUrl`, `AlertListController`, `useAlertList` (shapes in the Wave 2 public interface).

Behaviour the tests pin (each from the spec's Interactions table or "Stale repository"):
1. `setCodebase` and `setTeam` write `repo: null` in the SAME `useUrlBatch` call, so there is exactly one URL write and never an intermediate URL with the new scope and the old repo.
2. `selectTeamRow` sets the team and switches the ownership card to Repositories (`own=repos`, a push), never touches `view`, and a second click on the selected team clears it.
3. `selectRepoRow` is one push: `view=alerts`, `team` = the repository's team (`Unassigned` is valid), `repo`. The team and repo are written with the RAW setters, because the clearing `setTeam` would null the repo.
4. `setRepo` selects a repository from inside the Alerts view (a rail row) as a replace that writes only `repo`. `selectRepoRow` always writes `view`, and `useUrlBatch` pushes whenever a push-declared key is written (even with an unchanged value), so using it for rail clicks would add a history entry per click and Back would walk through every repository the user clicked.
5. `resetFilters` resets Codebase, Owning team, Severity, Compare to and the repository, and never changes `view`, `own` or `range`.
6. The list resets to page 1 for any list-filter change, and for any scope change in the same render (a state adjustment during render, not an effect), so the first alerts request after a scope change already has `offset=0`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-hooks.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useSecurityUrl, useAlertList, type SeverityFilter } from '@/app/vulnerabilities/security-state';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;
const params = (url: string) => new URL(url, 'http://x').searchParams;

beforeEach(() => { nav().__resetSearch(''); });

describe('useSecurityUrl: reading', () => {
  it('reads defaults from an empty URL', () => {
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current).toMatchObject({
      view: 'overview', own: 'teams', codebase: 'backend', team: null, repo: null,
      severity: 'both', baseline: 'last', range: 'all', kSev: 'critical',
    });
    expect(result.current.isDefault).toEqual({ codebase: true, team: true, severity: true, baseline: true, repo: true, all: true });
  });

  it('kSev follows Severity: high only gives high; the retired ?sev= key is ignored', () => {
    nav().__resetSearch('severity=high');
    expect(renderHook(() => useSecurityUrl()).result.current.kSev).toBe('high');
    nav().__resetSearch('sev=high');
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current.severity).toBe('both');
    expect(result.current.kSev).toBe('critical');
  });

  it('a hand-edited baseline the API would reject reads as last', () => {
    nav().__resetSearch('baseline=garbage');
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current.baseline).toBe('last');
    expect(result.current.isDefault.baseline).toBe(true);
  });

  it('isDefault.all is false when the repository alone is set (Reset filters clears it)', () => {
    nav().__resetSearch('repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    expect(result.current.isDefault.repo).toBe(false);
    expect(result.current.isDefault.all).toBe(false);
  });
});

describe('useSecurityUrl: clearing handlers write ONE URL', () => {
  it('setCodebase writes the codebase and clears repo in the same replace, with scroll:false', () => {
    nav().__resetSearch('repo=acme%2Fledger&team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setCodebase('frontend'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    expect(calls[0].opts).toEqual({ scroll: false });
    const p = params(calls[0].url);
    expect(p.get('codebase')).toBe('frontend');
    expect(p.has('repo')).toBe(false);
    expect(p.get('team')).toBe('Payments');
  });

  it('setTeam writes the team and clears repo in the same replace', () => {
    nav().__resetSearch('repo=acme%2Fledger&team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setTeam('Search'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    const p = params(calls[0].url);
    expect(p.get('team')).toBe('Search');
    expect(p.has('repo')).toBe(false);
  });

  it('setTeam(null) removes the team key', () => {
    nav().__resetSearch('team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setTeam(null));
    expect(params(nav().__calls[0].url).has('team')).toBe(false);
  });

  it('clearRepo removes only the repo', () => {
    nav().__resetSearch('repo=acme%2Fledger&team=Payments&view=alerts');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.clearRepo());
    const p = params(nav().__calls[0].url);
    expect(p.has('repo')).toBe(false);
    expect(p.get('team')).toBe('Payments');
    expect(p.get('view')).toBe('alerts');
  });
});

describe('useSecurityUrl: row selection and history', () => {
  it('selectTeamRow sets the team and own=repos in ONE push, clears the repo and never touches the view', () => {
    nav().__resetSearch('repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectTeamRow('Payments'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('push');
    expect(calls[0].opts).toEqual({ scroll: false });
    const p = params(calls[0].url);
    expect(p.get('team')).toBe('Payments');
    expect(p.get('own')).toBe('repos');
    expect(p.has('view')).toBe(false);
    expect(p.has('repo')).toBe(false);
  });

  it('selecting the selected team again clears it with a replace and leaves the ownership tab alone', () => {
    nav().__resetSearch('team=Payments&own=repos');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectTeamRow('Payments'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    const p = params(calls[0].url);
    expect(p.has('team')).toBe(false);
    expect(p.get('own')).toBe('repos');
  });

  it('selectRepoRow is one push: view=alerts, the repository and ITS team (the team write must not clear the repo)', () => {
    nav().__resetSearch('team=Payments&repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectRepoRow({ fullName: 'acme/search-index', team: 'Search' }));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('push');
    const p = params(calls[0].url);
    expect(p.get('view')).toBe('alerts');
    expect(p.get('team')).toBe('Search');
    expect(p.get('repo')).toBe('acme/search-index');
  });

  it('setRepo (a rail row inside the Alerts view) writes only repo, as a replace: no history entry, view and team untouched', () => {
    nav().__resetSearch('view=alerts&team=Payments');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setRepo('acme/ledger'));
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    expect(calls[0].opts).toEqual({ scroll: false });
    const p = params(calls[0].url);
    expect(p.get('repo')).toBe('acme/ledger');
    expect(p.get('view')).toBe('alerts');
    expect(p.get('team')).toBe('Payments');
  });

  it('selectRepoRow accepts Unassigned as a team', () => {
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.selectRepoRow({ fullName: 'acme/orphan', team: 'Unassigned' }));
    expect(params(nav().__calls[0].url).get('team')).toBe('Unassigned');
  });

  it('setView and setOwn push; the other setters replace', () => {
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.setView('alerts'));
    expect(nav().__calls[0].kind).toBe('push');
    act(() => result.current.setOwn('repos'));
    expect(nav().__calls[1].kind).toBe('push');
    act(() => result.current.setSeverity('high'));
    expect(nav().__calls[2].kind).toBe('replace');
    act(() => result.current.setBaseline('7d'));
    expect(nav().__calls[3].kind).toBe('replace');
    act(() => result.current.setRange('90d'));
    expect(nav().__calls[4].kind).toBe('replace');
    for (const c of nav().__calls) expect(c.opts).toEqual({ scroll: false });
  });

  it('resetFilters clears the five filters in one replace and never changes the view, ownership tab or range', () => {
    nav().__resetSearch('view=alerts&own=repos&range=1y&codebase=frontend&team=Payments&severity=high&baseline=7d&repo=acme%2Fledger');
    const { result } = renderHook(() => useSecurityUrl());
    act(() => result.current.resetFilters());
    const calls = nav().__calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('replace');
    expect(Object.fromEntries(params(calls[0].url).entries())).toEqual({ view: 'alerts', own: 'repos', range: '1y' });
  });
});

describe('useAlertList', () => {
  const scope: { codebase: CodebaseGroup; team: string | null; repo: string | null; severity: SeverityFilter } =
    { codebase: 'backend', team: null, repo: null, severity: 'both' };

  it('starts on the first page of open alerts with no filters', () => {
    const { result } = renderHook(() => useAlertList(scope));
    expect(result.current.list).toEqual({ status: 'open', overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', sort: null, page: 1 });
  });

  it('Resolved clears both time toggles; Overdue and Due ≤ 7d switch each other off', () => {
    const { result } = renderHook(() => useAlertList(scope));
    act(() => result.current.toggleOverdue());
    expect(result.current.list).toMatchObject({ overdue: true, dueSoon: false });
    act(() => result.current.toggleDueSoon());
    expect(result.current.list).toMatchObject({ overdue: false, dueSoon: true });
    act(() => result.current.toggleOverdue());
    expect(result.current.list).toMatchObject({ overdue: true, dueSoon: false });
    act(() => result.current.setStatus('resolved'));
    expect(result.current.list).toMatchObject({ status: 'resolved', overdue: false, dueSoon: false });
  });

  it('a header starts in its own first direction (Age descending, the rest ascending), clicking it again reverses, a new key starts in its own first direction', () => {
    const { result } = renderHook(() => useAlertList(scope));
    expect(result.current.list.sort).toBeNull();   // no header active: the server's default order
    act(() => result.current.setSort('age'));
    expect(result.current.list.sort).toEqual({ key: 'age', dir: 'desc' });
    act(() => result.current.setSort('age'));
    expect(result.current.list.sort).toEqual({ key: 'age', dir: 'asc' });
    act(() => result.current.setSort('due'));
    expect(result.current.list.sort).toEqual({ key: 'due', dir: 'asc' });
    act(() => result.current.setSort('age'));
    expect(result.current.list.sort).toEqual({ key: 'age', dir: 'desc' });   // back to Age: first direction again, not the old one
  });

  it.each([['severity', 'asc'], ['advisory', 'asc'], ['repo', 'asc'], ['age', 'desc'], ['due', 'asc'], ['state', 'asc']] as const)(
    'the first click on %s sorts %s', (key, dir) => {
      const { result } = renderHook(() => useAlertList(scope));
      act(() => result.current.setSort(key));
      expect(result.current.list.sort).toEqual({ key, dir });
    });

  it('every list-filter setter resets the page to 1; setPage does not', () => {
    const { result } = renderHook(() => useAlertList(scope));
    const calls: Array<[string, () => void]> = [
      ['setStatus', () => result.current.setStatus('all')],
      ['toggleOverdue', () => result.current.toggleOverdue()],
      ['toggleDueSoon', () => result.current.toggleDueSoon()],
      ['toggleReopened', () => result.current.toggleReopened()],
      ['toggleRuntimeOnly', () => result.current.toggleRuntimeOnly()],
      ['setQuery', () => result.current.setQuery('lodash')],
      ['setSort', () => result.current.setSort('repo')],
    ];
    for (const [name, call] of calls) {
      act(() => result.current.setPage(4));
      expect(result.current.list.page).toBe(4);
      act(() => call());
      expect([name, result.current.list.page]).toEqual([name, 1]);
    }
  });

  it('a scope change resets the page in the SAME render: no render ever pairs the new scope with the old page', () => {
    const seen: Array<[string | null, number]> = [];
    const { result, rerender } = renderHook(p => {
      const c = useAlertList(p);
      seen.push([p.team, c.list.page]);
      return c;
    }, { initialProps: scope });
    act(() => result.current.setPage(3));
    expect(result.current.list.page).toBe(3);

    seen.length = 0;
    rerender({ ...scope, team: 'Search' });
    expect(result.current.list.page).toBe(1);
    expect(seen.filter(([team, page]) => team === 'Search' && page !== 1)).toEqual([]);
  });

  it.each([
    ['codebase', { ...scope, codebase: 'frontend' as const }],
    ['repo', { ...scope, repo: 'acme/ledger' }],
    ['severity', { ...scope, severity: 'high' as const }],
  ])('a %s change also resets the page', (_name, next) => {
    const { result, rerender } = renderHook(p => useAlertList(p), { initialProps: scope });
    act(() => result.current.setPage(3));
    rerender(next);
    expect(result.current.list.page).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-security-hooks.test.tsx --maxWorkers=3`
Expected: FAIL with "useSecurityUrl is not a function" (and the same for `useAlertList`).

- [ ] **Step 3: Implement**

In `src/app/vulnerabilities/security-state.ts`, replace the import line

```ts
import type { UrlSchema } from '@/lib/url-state';
```

with

```ts
import { useState } from 'react';
import { useUrlBatch, useUrlState, type UrlSchema } from '@/lib/url-state';
```

Then append to the end of the file:

```ts
// ── Hooks ──────────────────────────────────────────────────────────────────────────────────────

export interface SecurityUrl {
  view: SecurityView;
  own: OwnTab;
  codebase: CodebaseGroup;
  team: string | null;
  repo: string | null;
  severity: SeverityFilter;
  /** Already sanitised: a hand-edited value the API would reject reads as 'last'. */
  baseline: string;
  range: TrendRange;
  kSev: Severity;
  setView(v: SecurityView): void;
  setOwn(o: OwnTab): void;
  setSeverity(s: SeverityFilter): void;
  setBaseline(b: string): void;
  setRange(r: TrendRange): void;
  /** Writes `repo: null` in the same URL write: the selected repository belongs to the old scope. */
  setCodebase(c: CodebaseGroup): void;
  /** Writes `repo: null` in the same URL write. */
  setTeam(t: string | null): void;
  /** Select (or clear, with null) a repository from INSIDE the Alerts view, i.e. a rail row. Writes only
   * `repo`, as a replace: no history entry, `view` and `team` untouched. Use selectRepoRow for the
   * Overview Repositories-tab rows instead (that one is a push to the Alerts view). */
  setRepo(repo: string | null): void;
  /** "Show all repositories". */
  clearRepo(): void;
  /** Overview team row. Selecting sets the team and switches the card to Repositories (a push);
   * clicking the selected team again clears it. Never changes the view. */
  selectTeamRow(team: string): void;
  /** Repository row: one push to the Alerts view with that repository and its owning team. */
  selectRepoRow(row: { fullName: string; team: string }): void;
  /** Codebase, Owning team, Severity, Compare to and the repository back to defaults. Never changes the view. */
  resetFilters(): void;
  isDefault: { codebase: boolean; team: boolean; severity: boolean; baseline: boolean; repo: boolean; all: boolean };
}

export type SecurityScope = Pick<SecurityUrl, 'codebase' | 'team' | 'repo' | 'severity' | 'baseline' | 'range'>;

/** Handlers are recreated on every render; consumers must not depend on their identity. */
export function useSecurityUrl(): SecurityUrl {
  const batch = useUrlBatch();
  const [view, setViewRaw] = useUrlState(VIEW_SCHEMA);
  const [own, setOwnRaw] = useUrlState(OWN_SCHEMA);
  const [codebase, setCodebaseRaw] = useUrlState(CODEBASE_SCHEMA);
  const [team, setTeamRaw] = useUrlState(TEAM_SCHEMA);
  const [repo, setRepoRaw] = useUrlState(REPO_SCHEMA);
  const [severity, setSeverityRaw] = useUrlState(SEVERITY_SCHEMA);
  const [rawBaseline, setBaselineRaw] = useUrlState(BASELINE_SCHEMA);
  const [range, setRangeRaw] = useUrlState(RANGE_SCHEMA);
  const baseline = sanitiseBaseline(rawBaseline);

  const isDefault = {
    codebase: codebase === 'backend',
    team: team === null,
    severity: severity === 'both',
    baseline: baseline === 'last',
    repo: repo === null,
    all: false,
  };
  isDefault.all = isDefault.codebase && isDefault.team && isDefault.severity && isDefault.baseline && isDefault.repo;

  return {
    view, own, codebase, team, repo, severity, baseline, range, kSev: kSev(severity),
    setView: setViewRaw,
    setOwn: setOwnRaw,
    setSeverity: setSeverityRaw,
    setBaseline: setBaselineRaw,
    setRange: setRangeRaw,
    setCodebase: c => batch(() => { setCodebaseRaw(c); setRepoRaw(null); }),
    setTeam: t => batch(() => { setTeamRaw(t); setRepoRaw(null); }),
    setRepo: setRepoRaw,
    clearRepo: () => setRepoRaw(null),
    selectTeamRow: next => batch(() => {
      if (team === next) {
        setTeamRaw(null);
      } else {
        setTeamRaw(next);
        setOwnRaw('repos'); // `own` is declared push, so this batch pushes a history entry
      }
      setRepoRaw(null);
    }),
    // Raw setters, in this order, on purpose: the wrapped setTeam above also writes repo: null.
    selectRepoRow: row => batch(() => {
      setViewRaw('alerts');
      setTeamRaw(row.team);
      setRepoRaw(row.fullName);
    }),
    resetFilters: () => batch(() => {
      setCodebaseRaw('backend');
      setTeamRaw(null);
      setSeverityRaw('both');
      setBaselineRaw('last');
      setRepoRaw(null);
    }),
    isDefault,
  };
}

export interface AlertListController {
  /** The list state. Via SecurityViewProps this is the EFFECTIVE (sanitised) state. */
  list: AlertListState;
  /** 'resolved' clears overdue and dueSoon. */
  setStatus(s: AlertStatus): void;
  /** Turning Overdue on turns Due ≤ 7d off. */
  toggleOverdue(): void;
  /** Turning Due ≤ 7d on turns Overdue off. */
  toggleDueSoon(): void;
  toggleReopened(): void;
  toggleRuntimeOnly(): void;
  /** Call after the caller's own debounce; this hook does not debounce. */
  setQuery(q: string): void;
  /** The same key flips the direction; a new key starts in its ALERT_SORT_FIRST_DIR direction. */
  setSort(key: AlertSortKey): void;
  setPage(page: number): void;
}

/**
 * The alert list's local state (not URL). Every setter except setPage resets the page to 1. A change
 * of the page-wide scope (codebase, team, repo, severity) resets it too, in the SAME render: the state
 * is adjusted during render rather than in an effect, so the very first alerts request after the
 * change already has offset=0 (an effect would let one request out with the new scope and the old
 * page). The returned `list.page` is already 1 in that render's own pass for the same reason.
 */
export function useAlertList(scope: { codebase: CodebaseGroup; team: string | null; repo: string | null; severity: SeverityFilter }): AlertListController {
  const [stored, setStored] = useState<AlertListState>(DEFAULT_ALERT_LIST);
  const scopeKey = JSON.stringify([
    scope.codebase, scope.team, scope.repo, scope.severity,
    stored.status, stored.overdue, stored.dueSoon, stored.reopened, stored.runtimeOnly, stored.q, stored.sort,
  ]);
  const [prevKey, setPrevKey] = useState(scopeKey);
  const reset = prevKey !== scopeKey;
  if (reset) {
    setPrevKey(scopeKey);
    if (stored.page !== 1) setStored(s => (s.page === 1 ? s : { ...s, page: 1 }));
  }
  const list = reset && stored.page !== 1 ? { ...stored, page: 1 } : stored;

  const patch = (p: Partial<AlertListState>) => setStored(s => ({ ...s, ...p, page: 1 }));
  return {
    list,
    setStatus: status => setStored(s => ({
      ...s, status, page: 1,
      ...(status === 'resolved' ? { overdue: false, dueSoon: false } : {}),
    })),
    toggleOverdue: () => setStored(s => ({ ...s, overdue: !s.overdue, dueSoon: s.overdue ? s.dueSoon : false, page: 1 })),
    toggleDueSoon: () => setStored(s => ({ ...s, dueSoon: !s.dueSoon, overdue: s.dueSoon ? s.overdue : false, page: 1 })),
    toggleReopened: () => setStored(s => ({ ...s, reopened: !s.reopened, page: 1 })),
    toggleRuntimeOnly: () => setStored(s => ({ ...s, runtimeOnly: !s.runtimeOnly, page: 1 })),
    setQuery: q => patch({ q }),
    setSort: key => setStored(s => ({
      ...s, page: 1,
      sort: s.sort?.key === key ? { key, dir: s.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: ALERT_SORT_FIRST_DIR[key] },
    })),
    setPage: page => setStored(s => ({ ...s, page: Math.max(1, Math.floor(page)) })),
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-security-hooks.test.tsx src/lib/__tests__/unit/vuln-security-state.test.ts src/lib/__tests__/unit/url-state-hook.test.ts --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS; `tsc` clean. Reverting any of these fails a named test: dropping `setRepoRaw(null)` from `setCodebase` fails "setCodebase writes the codebase and clears repo in the same replace"; calling the wrapped `setTeam` inside `selectRepoRow` fails "selectRepoRow is one push"; replacing the render-time reset with an effect fails the "SAME render" test; making every new key start 'asc' fails "the first click on age sorts desc".

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/security-state.ts src/lib/__tests__/unit/vuln-security-hooks.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: useSecurityUrl clearing handlers and useAlertList"
```

### Task 2.7: `use-security-data.ts` (every SWR key in one place)

**Files:**
- Create: `src/app/vulnerabilities/use-security-data.ts`
- Test: `src/lib/__tests__/unit/vuln-use-security-data.test.tsx`

**Interfaces:**
- Consumes: `fetcher`, `vulnSwrOptions`, `panelError` from `./format` (existing, unchanged); `SecurityScope`, `AlertListState`, `alertsQueryString`, `sanitiseAlertList`, `kSev`, `trendSince`, `sparklineSince` from `./security-state` (Tasks 2.4, 2.6); `anySlaActive` from `./sla-state` (Task 2.3); `SummaryData`, `ReposData`, `CoverageData`, `AlertsData`, `TrendData`, `UnavailableData`, `Slot` from `./api-types` (Task 2.5); the `repos` route (Wave 1).
- Produces: `Slot<T>` (re-exported from `./api-types`), `SecurityKeys`, `SecurityData`, `securityKeys(scope, now)`, `useSecurityData(scope, listState)` (shapes in the Wave 2 public interface).

The spec's data-flow table, as keys (all with `keepPreviousData`):

| Slot | Request | Parameters |
|---|---|---|
| `summary` | `/summary` | `codebase`, `baseline`, `team` |
| `teamSummary` | `/summary` | `codebase`, `baseline` (never `team`; with no team its key is byte-identical to `summary`'s, so the two dedupe into one request) |
| `coverage` | `/coverage` | `codebase`, `team` |
| `repos` | `/repos` | `codebase`, `team` |
| `trend` | `/trend` | `codebase`, `severity=kSev`, `since` from `range` (none for `all`); no `team` |
| `sparkline` | `/trend` | `codebase`, `severity=kSev`, `since` = today minus 90 days; no `team` |
| `alerts` | `/alerts` | `codebase`, `team`, `repo`, `severity` (omitted for both), list filters, `limit=10`, `offset`, `sort`; `null` while the repo is `not-found` |

Behaviours beyond the keys, each pinned by a test below:
- **Stale repository.** `repoStatus` is `none` (no repo), `pending` (rows not yet authoritative for this scope; alerts are requested), `ok`, or `not-found`. "Absent from the loaded rows" only counts when the `repos` envelope's `appliedFilters` match the current codebase and team and the slot is not stale. `keepPreviousData` shows the previous scope's rows while the new ones load, and judging by those would mark a valid repo as not found after a Back navigation. A repo the alerts API rejects (`error.info.error` of `unknown repo` or `repo not tracked`) is remembered per `codebase + team + repo`, so the page never sends it again; the memory is cleared when the sync time changes. In both cases the alerts key becomes `null` and nothing raises the page-level error.
- **Refetch on sync change.** The summary, the team table and the repos rows are separate requests; a sync landing between them leaves them disagreeing. When their settled responses carry different `sync.lastSuccessfulAt`, the older ones are refetched, once per distinct disagreement (so a server that keeps answering with an old time cannot loop). The `handled` signature is belt and braces for a disagreement that reappears after a transient flip; the test below pins the no-loop outcome, not that internal guard.
- **Sanitising at key-build time.** The effective list (`effectiveList`) is what is sent, and the baseline arrives already sanitised from `useSecurityUrl`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-use-security-data.test.tsx
// Real SWR against a routed fetch mock: the assertions are on the requests the page would make.
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import {
  useSecurityUrl, useAlertList, sparklineSince, trendSince,
  type SecurityUrl, type AlertListController,
} from '@/app/vulnerabilities/security-state';
import { useSecurityData, type SecurityData } from '@/app/vulnerabilities/use-security-data';
import { SwrFresh, fetchRouter, callsTo, summaryFixture, reposFixture, alertsFixture, alertRow, syncInfo, REPO_ROWS } from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;

let latest: { url: SecurityUrl; list: AlertListController; data: SecurityData };
function Probe() {
  const url = useSecurityUrl();
  const list = useAlertList({ codebase: url.codebase, team: url.team, repo: url.repo, severity: url.severity });
  const data = useSecurityData(url, list.list);
  latest = { url, list, data };
  return null;
}

function mount(search = '', routes: Parameters<typeof fetchRouter>[0] = {}) {
  nav().__resetSearch(search);
  const fetchMock = fetchRouter(routes);
  (global as any).fetch = fetchMock;
  render(<SwrFresh><Probe /></SwrFresh>);
  return fetchMock;
}

const allLoaded = () => waitFor(() => {
  const d = latest.data;
  expect(d.summary.data && d.repos.data && d.coverage.data && d.trend.data && d.sparkline.data && d.alerts.data).toBeTruthy();
});
const searches = (f: jest.Mock, name: Parameters<typeof callsTo>[1]) => callsTo(f, name).map(u => u.search);

describe('keys (the spec data-flow table)', () => {
  it('default scope: one summary request (the two summary keys dedupe), coverage and repos by codebase, two trend requests, first alerts page', async () => {
    const f = mount('');
    await allLoaded();
    expect(searches(f, 'summary')).toEqual(['?codebase=backend&baseline=last']);
    expect(searches(f, 'coverage')).toEqual(['?codebase=backend']);
    expect(searches(f, 'repos')).toEqual(['?codebase=backend']);
    expect(searches(f, 'trend').sort()).toEqual([
      '?codebase=backend&severity=critical',
      `?codebase=backend&severity=critical&since=${sparklineSince(new Date())}`,
    ].sort());
    expect(searches(f, 'alerts')).toEqual(['?codebase=backend&state=open&limit=10&offset=0']);
  });

  it('with a team: summary, coverage, repos and alerts carry it; the team table summary, trend and sparkline never do', async () => {
    const f = mount('team=Payments');
    await allLoaded();
    expect(searches(f, 'summary').sort()).toEqual([
      '?codebase=backend&baseline=last',
      '?codebase=backend&baseline=last&team=Payments',
    ]);
    expect(searches(f, 'coverage')).toEqual(['?codebase=backend&team=Payments']);
    expect(searches(f, 'repos')).toEqual(['?codebase=backend&team=Payments']);
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.has('team')).toBe(false);
    expect(callsTo(f, 'alerts')[0].searchParams.get('team')).toBe('Payments');
  });

  it('Severity "both" sends no severity to the alert list and never sends the text "both" anywhere; trend and sparkline use critical', async () => {
    const f = mount('');
    await allLoaded();
    expect(callsTo(f, 'alerts')[0].searchParams.has('severity')).toBe(false);
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.get('severity')).toBe('critical');
    for (const [url] of f.mock.calls) expect(String(url)).not.toContain('severity=both');
  });

  it('High only: the alert list, trend and sparkline all use high', async () => {
    const f = mount('severity=high');
    await allLoaded();
    expect(callsTo(f, 'alerts')[0].searchParams.get('severity')).toBe('high');
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.get('severity')).toBe('high');
  });

  it('the old ?sev=high key is ignored: critical everywhere, no severity on the list', async () => {
    const f = mount('sev=high');
    await allLoaded();
    expect(callsTo(f, 'alerts')[0].searchParams.has('severity')).toBe(false);
    for (const u of callsTo(f, 'trend')) expect(u.searchParams.get('severity')).toBe('critical');
  });

  it('the sparkline is fixed at 90 days back whatever Range says; the trend follows Range; neither carries the team', async () => {
    const f = mount('team=Payments&range=30d');
    await allLoaded();
    const trends = callsTo(f, 'trend');
    expect(trends.filter(u => u.searchParams.get('since') === sparklineSince(new Date()))).toHaveLength(1);
    expect(trends.filter(u => u.searchParams.get('since') === trendSince('30d', new Date()))).toHaveLength(1);
    for (const u of trends) expect(u.searchParams.has('team')).toBe(false);
  });

  it('range=all sends no since on the trend, but the sparkline still has its 90-day since', async () => {
    const f = mount('');
    await allLoaded();
    const sinces = callsTo(f, 'trend').map(u => u.searchParams.get('since')).sort();
    expect(sinces).toEqual([null, sparklineSince(new Date())].sort());
  });

  it('a hand-edited baseline the API would reject is replaced by last before the request', async () => {
    const f = mount('baseline=garbage');
    await allLoaded();
    for (const u of callsTo(f, 'summary')) expect(u.searchParams.get('baseline')).toBe('last');
  });

  it('list filters, page and sort reach the alerts request with the API parameter names', async () => {
    const f = mount('');
    await allLoaded();
    act(() => { latest.list.toggleReopened(); });
    act(() => { latest.list.setSort('due'); });
    act(() => { latest.list.setPage(3); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('offset') === '20')).toBe(true));
    const last = callsTo(f, 'alerts').find(u => u.searchParams.get('offset') === '20')!;
    expect(last.searchParams.get('reopened')).toBe('true');
    expect(last.searchParams.get('sort')).toBe('due:asc');
    expect(last.searchParams.get('limit')).toBe('10');
  });

  it('a scope change resets the page: the first alerts request carrying the new team has offset 0', async () => {
    const f = mount('');
    await allLoaded();
    act(() => { latest.list.setPage(3); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('offset') === '20')).toBe(true));
    act(() => { latest.url.setTeam('Search'); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('team') === 'Search')).toBe(true));
    const first = callsTo(f, 'alerts').find(u => u.searchParams.get('team') === 'Search')!;
    expect(first.searchParams.get('offset')).toBe('0');
    expect(first.searchParams.has('repo')).toBe(false);
  });
});

describe('sanitising at key-build time', () => {
  it('with no active SLA, an Overdue toggle never reaches the request and the effective list shows it off', async () => {
    const f = mount('', { summary: { body: summaryFixture({ slaStatus: { critical: 'none', high: 'none' } }) } });
    await allLoaded();
    act(() => { latest.list.toggleOverdue(); });
    await act(async () => { await Promise.resolve(); });
    expect(latest.data.effectiveList.overdue).toBe(false);
    for (const u of callsTo(f, 'alerts')) expect(u.searchParams.has('overdue')).toBe(false);
  });

  it('with an active SLA the same toggle is sent', async () => {
    const f = mount('');
    await allLoaded();
    act(() => { latest.list.toggleOverdue(); });
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('overdue') === 'true')).toBe(true));
    expect(latest.data.effectiveList.overdue).toBe(true);
  });
});

describe('keepPreviousData', () => {
  it('keeps the previous summary on screen (stale) while the next key loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('', {
      summary: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: summaryFixture({ org: frontend ? 'frontend-org' : 'acme' }) };
      },
    });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('acme'));
    act(() => { latest.url.setCodebase('frontend'); });
    await waitFor(() => expect(latest.data.summary.stale).toBe(true));
    expect(latest.data.summary.data?.org).toBe('acme');
    expect(latest.data.summary.loading).toBe(false);
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.summary.data?.org).toBe('frontend-org'));
    expect(latest.data.summary.stale).toBe(false);
  });

  it('the alerts key keeps the previous rows on screen (stale) while a changed list filter loads the next ones', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('', {
      alerts: async url => {
        const reopened = url.searchParams.get('reopened') === 'true';
        if (reopened) await gate;
        return { body: alertsFixture([alertRow({ cveId: reopened ? 'CVE-2026-2222' : 'CVE-2026-1111' })]) };
      },
    });
    await waitFor(() => expect(latest.data.alerts.data?.rows[0].cveId).toBe('CVE-2026-1111'));
    act(() => { latest.list.toggleReopened(); });   // a list filter changes the alerts key
    await waitFor(() => expect(latest.data.alerts.stale).toBe(true));
    expect(latest.data.alerts.data?.rows[0].cveId).toBe('CVE-2026-1111');   // the previous rows stay on screen
    expect(latest.data.alerts.loading).toBe(false);
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.alerts.data?.rows[0].cveId).toBe('CVE-2026-2222'));
    expect(latest.data.alerts.stale).toBe(false);
  });
});

describe('the stale-repository state', () => {
  it('a repo absent from the loaded rows is not-found, and its alerts are never requested again', async () => {
    const f = mount('repo=acme%2Fghost');
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    const before = callsTo(f, 'alerts').length;
    act(() => { latest.list.toggleReopened(); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(callsTo(f, 'alerts')).toHaveLength(before);
    expect(latest.data.keys.alerts).toBeNull();
    expect(latest.data.alerts.data).toBeUndefined();
    expect(latest.data.effectiveRepo).toBeNull();
    expect(latest.data.summary.error).toBeUndefined();
  });

  it('a repo the alerts API rejects ("repo not tracked") becomes not-found without a page-level error, and is not resent', async () => {
    const f = mount('repo=acme%2Fledger', {
      alerts: { status: 400, body: { error: 'repo not tracked', repo: 'acme/ledger', service_tier: 'staging' } },
    });
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
    expect(latest.data.summary.error).toBeUndefined();
    const before = callsTo(f, 'alerts').length;
    act(() => { latest.list.toggleRuntimeOnly(); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(callsTo(f, 'alerts')).toHaveLength(before);
  });

  it('a repo present in the rows is ok and is sent as the alerts repo', async () => {
    const f = mount('repo=acme%2Fledger');
    await waitFor(() => expect(latest.data.repoStatus).toBe('ok'));
    expect(latest.data.effectiveRepo).toBe('acme/ledger');
    expect(callsTo(f, 'alerts').some(u => u.searchParams.get('repo') === 'acme/ledger')).toBe(true);
  });

  it('rows from the previous scope never mark a repo not-found while the new rows load (Back navigation)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mount('repo=acme%2Fledger', {
      repos: async url => {
        const frontend = url.searchParams.get('codebase') === 'frontend';
        if (frontend) await gate;
        return { body: reposFixture(frontend ? [] : REPO_ROWS, { codebase: frontend ? 'frontend' : 'backend' }) };
      },
    });
    await waitFor(() => expect(latest.data.repoStatus).toBe('ok'));
    act(() => { nav().__resetSearch('codebase=frontend&repo=acme%2Fledger'); });
    await waitFor(() => expect(latest.data.repos.stale).toBe(true));
    expect(latest.data.repoStatus).toBe('pending');
    await act(async () => { release(); });
    await waitFor(() => expect(latest.data.repoStatus).toBe('not-found'));
  });

  it('a plain alerts failure (500) is shown in the alerts slot and does not touch repoStatus or the summary', async () => {
    mount('', { alerts: { status: 500, body: { error: 'Internal Server Error' } } });
    await waitFor(() => expect(latest.data.alerts.errorText).toContain('Internal Server Error'));
    expect(latest.data.repoStatus).toBe('none');
    expect(latest.data.summary.error).toBeUndefined();
  });
});

describe('refetch on sync change', () => {
  it('when the summary and the repos rows disagree on the sync time, the older summary is refetched once and the page settles', async () => {
    let summaryCalls = 0;
    const f = mount('', {
      summary: () => {
        summaryCalls += 1;
        return { body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: summaryCalls === 1 ? '2026-09-22T06:00:00Z' : '2026-09-23T06:00:00Z' }) }) };
      },
      repos: () => ({
        body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: '2026-09-23T06:00:00Z' }) }),
      }),
    });
    await waitFor(() => expect(callsTo(f, 'summary')).toHaveLength(2));
    await waitFor(() => expect(latest.data.summary.data?.sync.lastSuccessfulAt).toBe('2026-09-23T06:00:00Z'));
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(callsTo(f, 'summary')).toHaveLength(2);   // refetched once, then agreed: no loop
    expect(callsTo(f, 'repos')).toHaveLength(1);     // the newer one is left alone
  });

  it('a server that keeps answering with the old time does not cause a refetch loop', async () => {
    const f = mount('', {
      summary: { body: summaryFixture({ sync: syncInfo({ lastSuccessfulAt: '2026-09-22T06:00:00Z' }) }) },
      repos: () => ({
        body: reposFixture(REPO_ROWS, { codebase: 'backend' }, { sync: syncInfo({ lastSuccessfulAt: '2026-09-23T06:00:00Z' }) }),
      }),
    });
    await allLoaded();
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(callsTo(f, 'summary').length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-use-security-data.test.tsx --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/use-security-data'".

- [ ] **Step 3: Implement**

```ts
// src/app/vulnerabilities/use-security-data.ts
'use client';
// GLOOK-64: every SWR key the Security page uses, in one place (spec section 4, "Data flow").
// Every key uses keepPreviousData, so a scope change keeps rendering the previous key's data
// (`stale: true`) instead of blanking the section while the new key loads.
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher, vulnSwrOptions, panelError } from './format';
import type { SummaryData, ReposData, CoverageData, AlertsData, TrendData, UnavailableData, Slot } from './api-types';
import {
  alertsQueryString, kSev, sanitiseAlertList, sparklineSince, trendSince,
  type AlertListState, type SecurityScope,
} from './security-state';
import { anySlaActive } from './sla-state';

const BASE = '/api/vulnerabilities';
const SWR_OPTS = { keepPreviousData: true, ...vulnSwrOptions };

// `Slot` is defined in api-types.ts (the test fixtures need it earlier); consumers import it from here too.
export type { Slot };

export interface SecurityKeys {
  summary: string;
  teamSummary: string;
  coverage: string;
  repos: string;
  trend: string;
  sparkline: string;
}

export type RepoStatus = 'none' | 'pending' | 'ok' | 'not-found';

export interface SecurityData {
  summary: Slot<SummaryData>;
  teamSummary: Slot<SummaryData>;
  coverage: Slot<CoverageData>;
  repos: Slot<ReposData>;
  trend: Slot<TrendData>;
  sparkline: Slot<TrendData>;
  alerts: Slot<AlertsData>;
  repoStatus: RepoStatus;
  effectiveRepo: string | null;
  effectiveList: AlertListState;
  keys: SecurityKeys & { alerts: string | null };
}

/** The six keys that do not depend on the alert list. Pure, so tests can compute expectations. */
export function securityKeys(scope: SecurityScope, now: Date): SecurityKeys {
  const sev = kSev(scope.severity);

  // The team table's summary is NEVER scoped to the team (selecting a row would otherwise collapse
  // the table to that one row). Param order matches the scoped key, so with no team the two keys are
  // byte-identical and SWR dedupes them into one request.
  const summaryParams = new URLSearchParams({ codebase: scope.codebase, baseline: scope.baseline });
  const teamSummary = `${BASE}/summary?${summaryParams.toString()}`;
  if (scope.team) summaryParams.set('team', scope.team);
  const summary = `${BASE}/summary?${summaryParams.toString()}`;

  const scoped = new URLSearchParams({ codebase: scope.codebase });
  if (scope.team) scoped.set('team', scope.team);

  // Trend and sparkline are unscoped by team: the page filters the series client-side so a team
  // keeps its colour and the sparkline can be summed for a team without a second request.
  const trendKey = (since: string | null) => {
    const p = new URLSearchParams({ codebase: scope.codebase, severity: sev });
    if (since) p.set('since', since);
    return `${BASE}/trend?${p.toString()}`;
  };

  return {
    summary,
    teamSummary,
    coverage: `${BASE}/coverage?${scoped.toString()}`,
    repos: `${BASE}/repos?${scoped.toString()}`,
    trend: trendKey(trendSince(scope.range, now)),
    sparkline: trendKey(sparklineSince(now)),
  };
}

function toSlot<T>(label: string, r: { data?: unknown; error?: unknown; isLoading: boolean }): Slot<T> {
  const payload = r.data as { available?: boolean } | undefined;
  const data = payload && payload.available === true ? (payload as unknown as T) : undefined;
  const unavailable = payload && payload.available === false ? (payload as unknown as UnavailableData) : undefined;
  return {
    data, unavailable, error: r.error, errorText: panelError(r.error, label),
    loading: r.isLoading && !payload,
    stale: r.isLoading && !!payload,
  };
}

const EMPTY_SLOT: Slot<never> = { data: undefined, unavailable: undefined, error: undefined, errorText: null, loading: false, stale: false };

/** The alerts API's "your repo parameter is wrong" answers: not a page problem. */
function isRepoRejection(err: unknown): boolean {
  const e = (err as { info?: { error?: unknown } } | null)?.info?.error;
  return e === 'unknown repo' || e === 'repo not tracked';
}

const syncAt = (d: { sync?: { lastSuccessfulAt: string | null } } | undefined): string | null => d?.sync?.lastSuccessfulAt ?? null;

export function useSecurityData(scope: SecurityScope, listState: AlertListState): SecurityData {
  const keys = securityKeys(scope, new Date());

  const summary = useSWR(keys.summary, fetcher, SWR_OPTS);
  const teamSummary = useSWR(keys.teamSummary, fetcher, SWR_OPTS);
  const coverage = useSWR(keys.coverage, fetcher, SWR_OPTS);
  const repos = useSWR(keys.repos, fetcher, SWR_OPTS);
  const trend = useSWR(keys.trend, fetcher, SWR_OPTS);
  const sparkline = useSWR(keys.sparkline, fetcher, SWR_OPTS);

  const summarySlot = toSlot<SummaryData>('summary', summary);
  const teamSummarySlot = toSlot<SummaryData>('team table', teamSummary);
  const coverageSlot = toSlot<CoverageData>('coverage', coverage);
  const reposSlot = toSlot<ReposData>('repositories', repos);
  const trendSlot = toSlot<TrendData>('trend', trend);
  const sparklineSlot = toSlot<TrendData>('trend', sparkline);

  // Sanitise at key-build time: a bad combination never costs a wasted request. Until the summary
  // loads, assume an SLA is active (nothing to clear yet).
  const slaActive = summarySlot.data ? anySlaActive(summarySlot.data) : true;
  const effectiveList = sanitiseAlertList(listState, { anySlaActive: slaActive });

  // ── Stale repository ───────────────────────────────────────────────────────────────────────────
  const repoKey = scope.repo ? `${scope.codebase}\u0000${scope.team ?? ''}\u0000${scope.repo}` : null;
  const [rejectedKey, setRejectedKey] = useState<string | null>(null);
  const applied = reposSlot.data?.appliedFilters as { codebase?: string; team?: string } | undefined;
  // Only rows that belong to THIS scope can say a repo is absent: keepPreviousData otherwise shows
  // the previous scope's rows, and judging by them would mark a valid repo as not found.
  const rowsAreForThisScope = !!reposSlot.data && !reposSlot.stale
    && applied?.codebase === scope.codebase && (applied?.team ?? null) === scope.team;
  let repoStatus: RepoStatus = 'none';
  if (scope.repo) {
    if (repoKey !== null && rejectedKey === repoKey) repoStatus = 'not-found';
    else if (rowsAreForThisScope) repoStatus = reposSlot.data!.rows.some(r => r.fullName === scope.repo) ? 'ok' : 'not-found';
    else repoStatus = 'pending';
  }

  const alertsKey = repoStatus === 'not-found'
    ? null
    : `${BASE}/alerts?${alertsQueryString({
        codebase: scope.codebase, team: scope.team, repo: scope.repo, severity: scope.severity,
        list: effectiveList, anySlaActive: slaActive,
      })}`;
  const alerts = useSWR(alertsKey, fetcher, SWR_OPTS);
  const alertsSlot: Slot<AlertsData> = alertsKey === null ? EMPTY_SLOT : toSlot<AlertsData>('alerts', alerts);

  // Remember a repo the API rejected, per scope, so it is never sent again.
  const alertsError = alerts.error;
  useEffect(() => {
    if (repoKey && isRepoRejection(alertsError)) setRejectedKey(repoKey);
  }, [alertsError, repoKey]);

  // ── Sync time ──────────────────────────────────────────────────────────────────────────────────
  const settled = <T extends { sync?: { lastSuccessfulAt: string | null } }>(s: Slot<T>) =>
    s.data && !s.stale && !s.loading ? syncAt(s.data) : null;
  const summaryAt = settled(summarySlot);
  const teamAt = settled(teamSummarySlot);
  const reposAt = settled(reposSlot);

  // A new sync clears the "rejected" memory: the repo may be tracked now.
  const prevSummaryAt = useRef<string | null>(null);
  useEffect(() => {
    if (prevSummaryAt.current && summaryAt && prevSummaryAt.current !== summaryAt) setRejectedKey(null);
    if (summaryAt) prevSummaryAt.current = summaryAt;
  }, [summaryAt]);

  // The summary and repos requests can straddle a sync. When their settled responses disagree,
  // refetch the older ones, once per distinct disagreement (a server that keeps answering with an
  // old time must not make this loop).
  const handled = useRef('');
  const summaryMutate = summary.mutate;
  const teamMutate = teamSummary.mutate;
  const reposMutate = repos.mutate;
  useEffect(() => {
    const seen = [summaryAt, teamAt, reposAt].filter((t): t is string => t !== null);
    if (seen.length < 2) return;
    const newest = seen.reduce((a, b) => (a > b ? a : b));
    if (seen.every(t => t === newest)) return;
    const signature = `${summaryAt}|${teamAt}|${reposAt}`;
    if (handled.current === signature) return;
    handled.current = signature;
    // Keyed by SWR key: with no team the two summary keys are one cache entry, refetched once.
    const refresh = new Map<string, () => unknown>();
    if (summaryAt && summaryAt !== newest) refresh.set(keys.summary, summaryMutate);
    if (teamAt && teamAt !== newest) refresh.set(keys.teamSummary, teamMutate);
    if (reposAt && reposAt !== newest) refresh.set(keys.repos, reposMutate);
    refresh.forEach(run => { void run(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the settled sync times only
  }, [summaryAt, teamAt, reposAt]);

  return {
    summary: summarySlot,
    teamSummary: teamSummarySlot,
    coverage: coverageSlot,
    repos: reposSlot,
    trend: trendSlot,
    sparkline: sparklineSlot,
    alerts: alertsSlot,
    repoStatus,
    effectiveRepo: repoStatus === 'pending' || repoStatus === 'ok' ? scope.repo : null,
    effectiveList,
    keys: { ...keys, alerts: alertsKey },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-use-security-data.test.tsx src/lib/__tests__/unit/vuln-security-hooks.test.tsx --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS; `tsc` clean (this is where a Wave 1 mismatch in `getRepos`' return type would surface).

Named reverts: dropping `keepPreviousData` from the shared options fails both keepPreviousData tests (the alerts one reads `rows` of `undefined`); giving `teamSummary` the team fails "with a team: ... never do"; dropping `keepPreviousData` fails "keeps the previous summary"; judging `repoStatus` without the `appliedFilters`/`stale` guard fails "rows from the previous scope never mark a repo not-found".

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/use-security-data.ts src/lib/__tests__/unit/vuln-use-security-data.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: use-security-data owns every SWR key, stale-repo state and sync refetch"
```

### Task 2.8: View tabs and the sticky filter bar

**Files:**
- Create: `src/app/vulnerabilities/view-tabs.tsx`
- Create: `src/app/vulnerabilities/filter-bar.tsx`
- Test: `src/lib/__tests__/unit/vuln-filter-bar.test.tsx`

**Interfaces:**
- Consumes: the constants in `dimensions.ts` (Task 2.2); `SecurityUrl`, `CodebaseCounts`, `SeverityFilter`, `codebaseOptionCount` from `./security-state` (Tasks 2.4, 2.6); `CODEBASE_GROUPS`, `CODEBASE_LABELS` from `@/lib/vulnerabilities/codebase-labels` (existing).
- Produces:
  - `ViewTabs` (default export) with `ViewTabsProps = { view: SecurityView; onChange: (v: SecurityView) => void; alertsCount: number | null }`.
  - `FilterBar` (default export) with `FilterBarProps = { url: FilterBarUrl; teams: readonly string[]; codebaseCounts: CodebaseCounts | undefined; alertsCount: number | null; baselinePrefill: string; barRef?: Ref<HTMLDivElement> }`, where `FilterBarUrl` is `Pick<SecurityUrl, 'view' | 'codebase' | 'team' | 'severity' | 'baseline' | 'isDefault' | 'setView' | 'setCodebase' | 'setTeam' | 'setSeverity' | 'setBaseline' | 'resetFilters'>`. `FilterBar` renders the whole sticky bar, tabs included.

Layout (a decision this plan makes, because the design handoff is not in the repository): the bar is **two fixed rows** at every width, not one row that wraps. Row 1: the view tabs on the left and the reserved "Reset filters" slot on the right. Row 2: Codebase, Owning team, Severity, the "Compare to" label, the Compare select, and the reserved date slot. The row-2 widths total `FILTER_ROW_W` (884px), which fits at 1024px; a single row of tabs plus filters would not (the Task 2.2 test pins this). Because both rows have fixed heights and both reserved slots always render (hidden with `invisible`, never removed), the bar's height is `FILTER_BAR_H` (84px) in every filter state.

Behaviours:
- A non-default filter gets the accent treatment (`border-accent text-accent-light`).
- "Reset filters" is visible only when `url.isDefault.all` is false; the button stays in the DOM when hidden (`invisible`, `disabled`, `tabIndex -1`, `aria-hidden`).
- Choosing "A date…" writes a concrete date (`baselinePrefill`) to the URL immediately, otherwise the select, whose value is derived from the URL, would snap back. The date input is always rendered inside its reserved slot and is `invisible` and `disabled` unless the baseline is a date.
- Codebase options read `Backend · 8`: the count follows Severity (and the server applies the Owning team); a null count (summary not loaded) shows the label alone.
- The sticky bar's background is `var(--body-bg, #0F0F0F)` (the theme sets `--body-bg`), its z-index is `Z.stickyBar`, and it extends over the page padding with a negative horizontal margin so scrolling content never shows in the gutters.
- Each select is `shrink-0`, has a fixed inline width from `SELECT_W`, truncates its text, and carries a `title` attribute with the full selected label.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-filter-bar.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import FilterBar, { type FilterBarProps } from '@/app/vulnerabilities/filter-bar';
import { FILTER_BAR_H, SELECT_W, RESET_SLOT_W, BAR_ROW_H, Z } from '@/app/vulnerabilities/dimensions';

const DEFAULTS = { codebase: true, team: true, severity: true, baseline: true, repo: true, all: true };
const COUNTS = {
  backend: { critical: 5, high: 3 }, frontend: { critical: 2, high: 0 }, shared: { critical: 0, high: 0 },
  other: { critical: 1, high: 1 }, all: { critical: 8, high: 4 },
};

function props(over: Partial<FilterBarProps['url']> = {}, rest: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    url: {
      view: 'overview', codebase: 'backend', team: null, severity: 'both', baseline: 'last', isDefault: DEFAULTS,
      setView: jest.fn(), setCodebase: jest.fn(), setTeam: jest.fn(), setSeverity: jest.fn(), setBaseline: jest.fn(), resetFilters: jest.fn(),
      ...over,
    },
    teams: ['Payments', 'Search', 'Unassigned'],
    codebaseCounts: COUNTS,
    alertsCount: 13,
    baselinePrefill: '2026-09-08',
    ...rest,
  };
}

describe('layout stability', () => {
  it('every select has a fixed inline width, is shrink-0, truncates and carries a title', () => {
    render(<FilterBar {...props({ team: 'A very long owning team name that cannot fit in 170 pixels' })} />);
    const expected: Array<[string, number]> = [
      ['Codebase', SELECT_W.codebase], ['Owning team', SELECT_W.team], ['Severity', SELECT_W.severity], ['Compare to', SELECT_W.baseline],
    ];
    for (const [label, width] of expected) {
      const el = screen.getByLabelText(label) as HTMLSelectElement;
      expect(el.style.width).toBe(`${width}px`);
      expect(el.className).toContain('shrink-0');
      expect(el.className).toContain('truncate');
      expect(el.getAttribute('title')).toBeTruthy();
    }
    expect(screen.getByLabelText('Owning team').getAttribute('title')).toBe('A very long owning team name that cannot fit in 170 pixels');
  });

  it('the bar keeps the same height, the same slot classes and the same slot widths whether Reset and the date input are hidden or shown', () => {
    const hidden = render(<FilterBar {...props()} />);
    const bar1 = screen.getByTestId('security-bar');
    const snap = () => ({
      barHeight: screen.getByTestId('security-bar').style.height,
      rowHeights: Array.from(screen.getByTestId('security-bar').children).map(c => (c as HTMLElement).style.height),
      resetClass: screen.getByTestId('reset-slot').className,
      resetWidth: (screen.getByTestId('reset-slot') as HTMLElement).style.width,
      dateClass: screen.getByTestId('date-slot').className,
      dateWidth: (screen.getByTestId('date-slot') as HTMLElement).style.width,
      // Hidden, not removed: both controls exist in every state.
      hasResetButton: !!screen.queryByText('Reset filters'),
      hasDateInput: !!screen.queryByLabelText('Compare to date'),
    });
    const before = snap();
    expect(before.barHeight).toBe(`${FILTER_BAR_H}px`);
    expect(before.rowHeights).toEqual([`${BAR_ROW_H}px`, `${BAR_ROW_H}px`]);
    expect(before.resetWidth).toBe(`${RESET_SLOT_W}px`);
    expect(before.dateWidth).toBe(`${SELECT_W.date}px`);
    expect([before.hasResetButton, before.hasDateInput]).toEqual([true, true]);
    expect(bar1).toBeTruthy();
    hidden.unmount();

    render(<FilterBar {...props({
      codebase: 'frontend', team: 'Payments', severity: 'high', baseline: '2026-09-15',
      isDefault: { codebase: false, team: false, severity: false, baseline: false, repo: true, all: false },
    })} />);
    expect(snap()).toEqual(before);
  });

  it('is sticky at the top with the body background variable and a z-index between pinned rows and the drawer', () => {
    render(<FilterBar {...props()} />);
    const bar = screen.getByTestId('security-bar');
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.top).toBe('0px');
    expect(bar.style.zIndex).toBe(String(Z.stickyBar));
    expect(bar.getAttribute('style')).toContain('background: var(--body-bg, #0F0F0F)');
  });
});

describe('Reset filters', () => {
  it('stays in the DOM but hidden (invisible, disabled, out of the tab order) when every filter is at its default', () => {
    render(<FilterBar {...props()} />);
    const btn = screen.getByText('Reset filters') as HTMLButtonElement;
    expect(btn.className).toContain('invisible');
    expect(btn.disabled).toBe(true);
    expect(btn.tabIndex).toBe(-1);
    expect(btn.getAttribute('aria-hidden')).toBe('true');
  });

  it('is visible when any filter differs and calls resetFilters', () => {
    const resetFilters = jest.fn();
    render(<FilterBar {...props({ resetFilters, isDefault: { ...DEFAULTS, team: false, all: false }, team: 'Payments' })} />);
    const btn = screen.getByText('Reset filters') as HTMLButtonElement;
    expect(btn.className).not.toContain('invisible');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  it('appears when only the selected repository differs (Reset clears it too)', () => {
    render(<FilterBar {...props({ isDefault: { ...DEFAULTS, repo: false, all: false } })} />);
    expect((screen.getByText('Reset filters') as HTMLButtonElement).className).not.toContain('invisible');
  });
});

describe('accent treatment', () => {
  it('a non-default select gets the accent border and text; a default one does not', () => {
    render(<FilterBar {...props({ codebase: 'frontend', isDefault: { ...DEFAULTS, codebase: false, all: false } })} />);
    expect(screen.getByLabelText('Codebase').className).toContain('border-accent');
    expect(screen.getByLabelText('Codebase').className).toContain('text-accent-light');
    expect(screen.getByLabelText('Severity').className).not.toContain('border-accent');
  });
});

describe('Codebase options', () => {
  it('show the open count under Severity: critical + high, critical only, high only', () => {
    const { rerender } = render(<FilterBar {...props()} />);
    expect(screen.getByRole('option', { name: 'Backend · 8' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'All · 12' })).toBeTruthy();
    rerender(<FilterBar {...props({ severity: 'critical' })} />);
    expect(screen.getByRole('option', { name: 'Backend · 5' })).toBeTruthy();
    rerender(<FilterBar {...props({ severity: 'high' })} />);
    expect(screen.getByRole('option', { name: 'Backend · 3' })).toBeTruthy();
  });

  it('show the label alone while the counts have not loaded', () => {
    render(<FilterBar {...props({}, { codebaseCounts: undefined })} />);
    expect(screen.getByRole('option', { name: 'Backend' })).toBeTruthy();
  });
});

describe('controls call the url handlers', () => {
  it('Codebase, Owning team and Severity', () => {
    const url = props().url;
    render(<FilterBar {...props({}, {})} url={url} />);
    fireEvent.change(screen.getByLabelText('Codebase'), { target: { value: 'frontend' } });
    expect(url.setCodebase).toHaveBeenCalledWith('frontend');
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    expect(url.setTeam).toHaveBeenCalledWith('Search');
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: '' } });
    expect(url.setTeam).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    expect(url.setSeverity).toHaveBeenCalledWith('high');
  });

  it('lists the severity choices as Critical + high / Critical only / High only', () => {
    render(<FilterBar {...props()} />);
    const sev = screen.getByLabelText('Severity');
    expect(within(sev).getAllByRole('option').map(o => o.textContent)).toEqual(['Critical + high', 'Critical only', 'High only']);
  });
});

describe('Compare to', () => {
  it('7 days and 30 days write the preset; the date input stays hidden', () => {
    const url = props().url;
    render(<FilterBar {...props({}, {})} url={url} />);
    fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: '7d' } });
    expect(url.setBaseline).toHaveBeenCalledWith('7d');
    expect(screen.getByLabelText('Compare to date').className).toContain('invisible');
    expect((screen.getByLabelText('Compare to date') as HTMLInputElement).disabled).toBe(true);
  });

  it('"A date…" immediately writes the pre-filled date, so the select cannot snap back', () => {
    const url = props().url;
    render(<FilterBar {...props({}, { baselinePrefill: '2026-09-08' })} url={url} />);
    fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: 'date' } });
    expect(url.setBaseline).toHaveBeenCalledWith('2026-09-08');
  });

  it('with a date baseline the select reads "A date…" and the date input is visible, enabled and filled', () => {
    render(<FilterBar {...props({ baseline: '2026-09-15', isDefault: { ...DEFAULTS, baseline: false, all: false } })} />);
    expect((screen.getByLabelText('Compare to') as HTMLSelectElement).value).toBe('date');
    const input = screen.getByLabelText('Compare to date') as HTMLInputElement;
    expect(input.value).toBe('2026-09-15');
    expect(input.className).not.toContain('invisible');
    expect(input.disabled).toBe(false);
    expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('changing the date writes it; clearing the input is ignored', () => {
    const url = props({ baseline: '2026-09-15', isDefault: { ...DEFAULTS, baseline: false, all: false } }).url;
    render(<FilterBar {...props({}, {})} url={url} />);
    const input = screen.getByLabelText('Compare to date');
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    expect(url.setBaseline).toHaveBeenCalledWith('2026-09-01');
    (url.setBaseline as jest.Mock).mockClear();
    fireEvent.change(input, { target: { value: '' } });
    expect(url.setBaseline).not.toHaveBeenCalled();
  });
});

describe('view tabs', () => {
  it('shows Overview and Alerts with the open count, marks the active tab and calls setView on click', () => {
    const url = props({ view: 'alerts' }).url;
    render(<FilterBar {...props({}, { alertsCount: 1234 })} url={url} />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const alerts = screen.getByRole('tab', { name: /^Alerts/ });
    expect(alerts.getAttribute('aria-selected')).toBe('true');
    expect(overview.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('alerts-tab-count').textContent).toBe('1,234');
    fireEvent.click(overview);
    expect(url.setView).toHaveBeenCalledWith('overview');
  });

  it('keeps the count slot (with a minimum width) while the count is unknown', () => {
    render(<FilterBar {...props({}, { alertsCount: null })} />);
    const slot = screen.getByTestId('alerts-tab-count');
    expect(slot.textContent).toBe('');
    expect(slot.className).toContain('min-w-[28px]');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-filter-bar.test.tsx --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/filter-bar'".

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/view-tabs.tsx
'use client';
import type { SecurityView } from './security-state';
import { BAR_ROW_H, TYPE } from './dimensions';

export interface ViewTabsProps {
  view: SecurityView;
  onChange: (v: SecurityView) => void;
  /** The open count under Severity for the current scope; null until the repos rows load. */
  alertsCount: number | null;
}

const TABS: ReadonlyArray<{ id: SecurityView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'alerts', label: 'Alerts' },
];

export default function ViewTabs({ view, onChange, alertsCount }: ViewTabsProps) {
  return (
    <div role="tablist" aria-label="Security views" className="flex items-center gap-1" style={{ height: BAR_ROW_H }}>
      {TABS.map(t => {
        const selected = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`security-tab-${t.id}`}
            aria-selected={selected}
            aria-controls="security-view-panel"
            onClick={() => onChange(t.id)}
            className={`h-full px-3 text-sm font-medium border-b-2 ${selected ? 'border-accent text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            {t.label}
            {t.id === 'alerts' && (
              // The slot always renders with a minimum width, so the tab does not change size when the count arrives.
              <span data-testid="alerts-tab-count" className={`ml-2 inline-block min-w-[28px] px-1.5 text-center text-xs bg-chart-surface text-gray-300 ${TYPE.badge}`}>
                {alertsCount === null ? '' : alertsCount.toLocaleString('en-US')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

```tsx
// src/app/vulnerabilities/filter-bar.tsx
'use client';
import type { Ref } from 'react';
import { CODEBASE_GROUPS, CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import { codebaseOptionCount, type CodebaseCounts, type SecurityUrl, type SeverityFilter } from './security-state';
import ViewTabs from './view-tabs';
import { BAR_PAD_Y, BAR_ROW_H, COMPARE_LABEL_W, FILTER_BAR_H, FILTER_ROW_GAP, PAGE_PAD, RESET_SLOT_W, SELECT_W, TYPE, Z } from './dimensions';

export type FilterBarUrl = Pick<
  SecurityUrl,
  'view' | 'codebase' | 'team' | 'severity' | 'baseline' | 'isDefault'
  | 'setView' | 'setCodebase' | 'setTeam' | 'setSeverity' | 'setBaseline' | 'resetFilters'
>;

export interface FilterBarProps {
  url: FilterBarUrl;
  /** summary.knownTeams */
  teams: readonly string[];
  /** summary.codebaseCounts; undefined until the summary loads. */
  codebaseCounts: CodebaseCounts | undefined;
  alertsCount: number | null;
  /** The date "A date…" writes immediately (the current baseline's date, else a week ago). */
  baselinePrefill: string;
  barRef?: Ref<HTMLDivElement>;
}

const SEVERITY_OPTIONS: ReadonlyArray<[SeverityFilter, string]> = [
  ['both', 'Critical + high'], ['critical', 'Critical only'], ['high', 'High only'],
];
const COMPARE_OPTIONS = [['last', 'Last sync'], ['7d', '7 days'], ['30d', '30 days'], ['date', 'A date…']] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const selectClass = (nonDefault: boolean) =>
  `shrink-0 h-7 px-2 text-xs truncate border bg-chart-surface ${TYPE.control} ${nonDefault ? 'border-accent text-accent-light' : 'border-gray-700 text-gray-300'}`;

export default function FilterBar({ url, teams, codebaseCounts, alertsCount, baselinePrefill, barRef }: FilterBarProps) {
  const isDate = DATE_RE.test(url.baseline);
  const compareValue = isDate ? 'date' : url.baseline;
  const today = new Date().toISOString().slice(0, 10);
  const codebaseLabel = (g: (typeof CODEBASE_GROUPS)[number]) => {
    const n = codebaseOptionCount(codebaseCounts, g, url.severity);
    return n === null ? CODEBASE_LABELS[g] : `${CODEBASE_LABELS[g]} · ${n.toLocaleString('en-US')}`;
  };
  const severityLabel = SEVERITY_OPTIONS.find(([v]) => v === url.severity)?.[1] ?? '';
  const compareLabel = COMPARE_OPTIONS.find(([v]) => v === compareValue)?.[1] ?? '';

  return (
    <div
      ref={barRef}
      data-testid="security-bar"
      className="box-border flex flex-col"
      style={{
        position: 'sticky', top: 0, zIndex: Z.stickyBar,
        background: 'var(--body-bg, #0F0F0F)',
        height: FILTER_BAR_H, paddingTop: BAR_PAD_Y, paddingBottom: BAR_PAD_Y,
        // Extend over the page padding so scrolling content never shows in the gutters.
        marginLeft: -PAGE_PAD.x, marginRight: -PAGE_PAD.x, paddingLeft: PAGE_PAD.x, paddingRight: PAGE_PAD.x,
        boxShadow: '0 1px 0 var(--chart-grid)',
      }}
    >
      <div className="flex items-center justify-between" style={{ height: BAR_ROW_H }}>
        <ViewTabs view={url.view} onChange={url.setView} alertsCount={alertsCount} />
        {/* Reserved slot: the button is hidden, never removed, so the row does not change. */}
        <div data-testid="reset-slot" className="flex shrink-0 justify-end" style={{ width: RESET_SLOT_W }}>
          <button
            type="button"
            onClick={() => url.resetFilters()}
            disabled={url.isDefault.all}
            tabIndex={url.isDefault.all ? -1 : 0}
            aria-hidden={url.isDefault.all ? true : undefined}
            className={`text-xs text-accent-light hover:text-accent-lighter ${url.isDefault.all ? 'invisible' : ''}`}
          >
            Reset filters
          </button>
        </div>
      </div>

      <div className="flex items-center" style={{ height: BAR_ROW_H, gap: FILTER_ROW_GAP }}>
        <select
          aria-label="Codebase"
          value={url.codebase}
          title={codebaseLabel(url.codebase)}
          onChange={e => url.setCodebase(e.target.value as (typeof CODEBASE_GROUPS)[number])}
          className={selectClass(!url.isDefault.codebase)}
          style={{ width: SELECT_W.codebase }}
        >
          {CODEBASE_GROUPS.map(g => <option key={g} value={g}>{codebaseLabel(g)}</option>)}
        </select>

        <select
          aria-label="Owning team"
          value={url.team ?? ''}
          title={url.team ?? 'All owning teams'}
          onChange={e => url.setTeam(e.target.value || null)}
          className={selectClass(!url.isDefault.team)}
          style={{ width: SELECT_W.team }}
        >
          <option value="">All owning teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          aria-label="Severity"
          value={url.severity}
          title={severityLabel}
          onChange={e => url.setSeverity(e.target.value as SeverityFilter)}
          className={selectClass(!url.isDefault.severity)}
          style={{ width: SELECT_W.severity }}
        >
          {SEVERITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <span className="shrink-0 text-xs text-gray-400" style={{ width: COMPARE_LABEL_W }}>Compare to</span>
        <select
          aria-label="Compare to"
          value={compareValue}
          title={compareLabel}
          onChange={e => {
            const v = e.target.value;
            // "A date…" must write a concrete date now: the select's value is derived from the URL.
            url.setBaseline(v === 'date' ? baselinePrefill : v);
          }}
          className={selectClass(!url.isDefault.baseline)}
          style={{ width: SELECT_W.baseline }}
        >
          {COMPARE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        {/* Reserved slot: the input is always rendered, hidden unless the baseline is a date. */}
        <div data-testid="date-slot" className="shrink-0" style={{ width: SELECT_W.date }}>
          <input
            type="date"
            aria-label="Compare to date"
            value={isDate ? url.baseline : ''}
            max={today}
            disabled={!isDate}
            tabIndex={isDate ? 0 : -1}
            onChange={e => { if (e.target.value) url.setBaseline(e.target.value); }}
            className={`${selectClass(isDate)} w-full ${isDate ? '' : 'invisible'}`}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-filter-bar.test.tsx --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS; `tsc` clean.

Named reverts: removing the `invisible` slot (rendering Reset or the date input conditionally) fails "the bar keeps the same height, the same slot classes ..." because `getByTestId('reset-slot')`/`'date-slot'` content and classes differ; dropping `shrink-0` or the inline width from a select fails "every select has a fixed inline width"; making "A date…" write nothing fails "immediately writes the pre-filled date".

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/view-tabs.tsx src/app/vulnerabilities/filter-bar.tsx src/lib/__tests__/unit/vuln-filter-bar.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: view tabs and sticky filter bar with reserved slots"
```

### Task 2.9: Coverage and policy drawer (replaces `coverage-panel.tsx` and `policy-panel.tsx`)

**Files:**
- Create: `src/app/vulnerabilities/coverage-drawer.tsx`
- Test: `src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx`

**Interfaces:**
- Consumes: `Slot` from `./use-security-data` and `SummaryData`, `CoverageData` from `./api-types` (Task 2.7); `slaState`, `slaStateLabel` from `./sla-state` (Task 2.3); `DRAWER_W`, `DRAWER_MAX_W`, `Z`, `TYPE` from `./dimensions` (Task 2.2); `resolvedCaption` from `./format` (existing).
- Produces:
  - `export type OpenDrawer = (opener?: HTMLElement | null) => void;`
  - `export function useCoverageDrawer(): { open: boolean; opener: HTMLElement | null; openDrawer: OpenDrawer; closeDrawer: () => void }`
  - `default export CoverageDrawer` with `CoverageDrawerProps = { open: boolean; onClose: () => void; opener: HTMLElement | null; coverage: Slot<CoverageData>; summary: SummaryData }`.

The drawer is page-wide (the header coverage line, the Overview unmeasured rows and the rail's unmeasured badge all open it), which is why it lives in this wave. Contract from the spec:
- `role="dialog"`, `aria-modal="true"`, labelled by its title. Opening focuses the close button; Tab and Shift+Tab stay inside while open.
- Esc closes. The Esc listener exists only while the drawer is open (nothing is attached when closed). The backdrop and the × also close.
- Closing returns focus to the element that opened it (the caller passes `e.currentTarget` to `openDrawer`; with no argument the hook falls back to `document.activeElement`).
- Width 460px, at most 92vw; its z-index (`Z.drawer`) is above the sticky bar. Open state is local to the page, never in the URL.
- It follows the Codebase and Owning team filters (the `coverage` request carries both). Groups: Unmeasured (hatched rows, open counts unknown, never a number: the API carries the stored count, the UI must not show it), Needs tagging (counted under "Unassigned"), Excluded by policy (not counted); then the policy, labelled "From deployment configuration".
- Carried over from the old panels: a `dependabot-off` row reads "Dependabot off" while an `error` row shows its GitHub detail; an invalid policy never reads as empty; the "Resolved counted ..." and "scope: ..." captions stay.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import CoverageDrawer, { useCoverageDrawer, type CoverageDrawerProps } from '@/app/vulnerabilities/coverage-drawer';
import { DRAWER_W, DRAWER_MAX_W, Z } from '@/app/vulnerabilities/dimensions';
import type { CoverageData } from '@/app/vulnerabilities/api-types';
import { coverageFixture, coverageRow as row, summaryFixture, slot } from '../support/security-fixtures';

function base(over: Partial<CoverageDrawerProps> = {}): CoverageDrawerProps {
  return {
    open: true, onClose: jest.fn(), opener: null,
    coverage: slot(coverageFixture()),
    summary: summaryFixture(),
    ...over,
  };
}

describe('dialog contract', () => {
  it('renders nothing and attaches no key listener while closed', () => {
    const add = jest.spyOn(document, 'addEventListener');
    render(<CoverageDrawer {...base({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
  });

  it('is a modal dialog labelled by its title, and focuses the close button on open', () => {
    render(<CoverageDrawer {...base()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = within(dialog).getByRole('heading', { name: 'Coverage & policy' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('is 460px wide, at most 92vw, above the sticky bar', () => {
    render(<CoverageDrawer {...base()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.width).toBe(`${DRAWER_W}px`);
    expect(dialog.style.maxWidth).toBe(DRAWER_MAX_W);
    const root = dialog.parentElement as HTMLElement;
    expect(root.style.zIndex).toBe(String(Z.drawer));
    expect(Z.drawer).toBeGreaterThan(Z.stickyBar);
  });

  it('Esc closes; the listener is attached only while open and removed on close', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    const onClose = jest.fn();
    const { rerender } = render(<CoverageDrawer {...base({ onClose })} />);
    const attached = add.mock.calls.filter(([type]) => type === 'keydown');
    expect(attached).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<CoverageDrawer {...base({ onClose, open: false })} />);
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown');
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(attached[0][1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the backdrop and the × both close', () => {
    const onClose = jest.fn();
    render(<CoverageDrawer {...base({ onClose })} />);
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closing returns focus to the element that opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<CoverageDrawer {...base({ opener })} />);
    expect(document.activeElement).not.toBe(opener);
    rerender(<CoverageDrawer {...base({ opener, open: false })} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last', () => {
    render(<CoverageDrawer {...base({ coverage: slot(coverageFixture({ needsTagging: [row({ repoId: 2, fullName: 'acme/ledger', openCritical: 1 })] })) })} />);
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href]'));
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe('coverage groups', () => {
  it('an unmeasured row never shows its stored open count: it reads "Open counts unknown"', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({ unmeasured: [row({ openCritical: 7, openHigh: 3 })] })),
    })} />);
    const unmeasured = screen.getByRole('region', { name: /^Unmeasured/ });
    expect(within(unmeasured).getByText('acme/legacy-batch')).toBeTruthy();
    expect(within(unmeasured).getByText('Open counts unknown')).toBeTruthy();
    expect(unmeasured.textContent).not.toMatch(/\b7\b/);
    expect(unmeasured.textContent).not.toMatch(/\b3\b/);
    expect(within(unmeasured).getByRole('listitem').className).toContain('vuln-hatch');
  });

  it('a dependabot-off row reads "Dependabot off" and an error row shows the GitHub detail', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({
        unmeasured: [
          row({ repoId: 1, fullName: 'acme/off-repo', dependabotStatus: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' }),
          row({ repoId: 2, fullName: 'acme/err-repo', dependabotStatus: 'error', detail: 'HTTP 500: status check failed' }),
        ],
      })),
    })} />);
    expect(screen.getByText('Dependabot off')).toBeTruthy();
    expect(screen.getByText('HTTP 500: status check failed')).toBeTruthy();
    expect(screen.queryByText('Dependabot alerts are disabled for this repository.')).toBeNull();
  });

  it('Needs tagging and Excluded rows show their open counts and the counting rule for the group', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({
        needsTagging: [row({ repoId: 3, fullName: 'acme/untagged', team: null, serviceTier: null, openCritical: 2, openHigh: 1 })],
        excludedByPolicy: [row({ repoId: 4, fullName: 'acme/staging-tools', serviceTier: 'staging', openCritical: 1, openHigh: 0 })],
      })),
    })} />);
    const tagging = screen.getByRole('region', { name: /^Needs tagging/ });
    expect(within(tagging).getByText('2 crit · 1 high')).toBeTruthy();
    expect(within(tagging).getByText(/Counted under “Unassigned”/)).toBeTruthy();
    expect(within(tagging).getByText(/Unassigned · — \/ backend/)).toBeTruthy();
    const excluded = screen.getByRole('region', { name: /^Excluded by policy/ });
    expect(within(excluded).getByText('1 crit · 0 high')).toBeTruthy();
    expect(within(excluded).getByText(/Not counted/)).toBeTruthy();
  });

  it('an empty group still renders, reading None', () => {
    render(<CoverageDrawer {...base()} />);
    for (const name of [/^Unmeasured/, /^Needs tagging/, /^Excluded by policy/]) {
      expect(within(screen.getByRole('region', { name })).getByText('None')).toBeTruthy();
    }
  });

  it('shows the load error and the loading state instead of the groups', () => {
    const { rerender } = render(<CoverageDrawer {...base({ coverage: slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }) })} />);
    expect(screen.getByText("Couldn't load coverage: boom")).toBeTruthy();
    rerender(<CoverageDrawer {...base({ coverage: slot<CoverageData>(undefined, { loading: true }) })} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});

describe('policy ("From deployment configuration")', () => {
  it('lists the windows, the resolved caption and the scope caption', () => {
    render(<CoverageDrawer {...base()} />);
    const policy = screen.getByRole('region', { name: /From deployment configuration/ });
    expect(within(policy).getByText(/critical-2020-01 · 9 days · 2020-01-08 → open-ended/)).toBeTruthy();
    expect(within(policy).getByText(/Resolved counted since 2020-01-08/)).toBeTruthy();
    expect(within(policy).getByText(/scope: service_tier = production/)).toBeTruthy();
  });

  it('resolved caption: unset start date reads "all time"; an invalid one reads "since —"', () => {
    const { rerender } = render(<CoverageDrawer {...base({ summary: summaryFixture({ resolvedSince: { date: null, invalid: false } }) })} />);
    expect(screen.getByText(/Resolved counted all time/)).toBeTruthy();
    rerender(<CoverageDrawer {...base({ summary: summaryFixture({ resolvedSince: { date: null, invalid: true } }) })} />);
    expect(screen.getByText(/Resolved counted since —/)).toBeTruthy();
  });

  it('the default (healthy) fixture reads Critical SLA "active", with neither the "none" nor the "invalid" wording on that line', () => {
    render(<CoverageDrawer {...base()} />);
    const critical = screen.getByTestId('sla-critical');
    expect(critical.textContent).toBe('Critical SLA: active');
    expect(critical.textContent).not.toContain('No SLA policy yet');
    expect(critical.textContent).not.toContain("SLA policy can't be read");
    // The default fixture has no high-severity policy, so that line carries the "none" wording: the
    // state is decided per severity, not once for the page.
    expect(screen.getByTestId('sla-high').textContent).toBe('High SLA: No SLA policy yet');
  });

  it('shows each severity in its own SLA state: active, pending ("Starts <date>"), none', () => {
    render(<CoverageDrawer {...base({
      summary: summaryFixture({
        slaStatus: { critical: 'pending', high: 'none' },
        policy: [{ id: 'critical-2099-01', severity: 'critical', days: 9, effectiveFrom: '2099-01-01', until: null, pending: true }],
      }),
    })} />);
    const policy = screen.getByRole('region', { name: /From deployment configuration/ });
    expect(within(policy).getByText('Starts 2099-01-01')).toBeTruthy();
    expect(within(policy).getByText('No SLA policy yet')).toBeTruthy();
  });

  it('an invalid policy reads "SLA policy can\'t be read" in red for both severities and never "No SLA policy yet"', () => {
    render(<CoverageDrawer {...base({
      summary: summaryFixture({ slaPolicyInvalid: true, policy: [], slaStatus: { critical: 'none', high: 'none' } }),
    })} />);
    const invalid = screen.getAllByText("SLA policy can't be read");
    expect(invalid).toHaveLength(2);
    for (const el of invalid) expect(el.className).toContain('text-red-400');
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });
});

describe('useCoverageDrawer', () => {
  it('opens with the given opener, keeps it through close, and falls back to the active element', () => {
    const { result } = renderHook(() => useCoverageDrawer());
    expect(result.current.open).toBe(false);
    const button = document.createElement('button');
    document.body.appendChild(button);
    act(() => result.current.openDrawer(button));
    expect(result.current.open).toBe(true);
    expect(result.current.opener).toBe(button);
    act(() => result.current.closeDrawer());
    expect(result.current.open).toBe(false);
    expect(result.current.opener).toBe(button);

    button.focus();
    act(() => result.current.openDrawer());
    expect(result.current.opener).toBe(button);
    button.remove();
  });
});

describe('light theme', () => {
  // Revert: give a row, a group or the footer the card-shell class: the light remap's border would resize it.
  it('only the dialog itself uses the card-shell class (bg-gray-900); the rows and groups use the chart surface', () => {
    const full = slot(coverageFixture({ unmeasured: [row({ repoId: 1 })], needsTagging: [row({ repoId: 2 })], excludedByPolicy: [row({ repoId: 3 })] }));
    render(<CoverageDrawer {...base({ coverage: full })} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('bg-gray-900');
    expect(dialog.querySelector('.bg-gray-900')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/coverage-drawer'".

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/coverage-drawer.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoverageData, SummaryData } from './api-types';
import type { Slot } from './use-security-data';
import { slaState, slaStateLabel } from './sla-state';
import { resolvedCaption } from './format';
import { DRAWER_MAX_W, DRAWER_W, TYPE, Z } from './dimensions';

/** Open the drawer. Pass the clicked element (`e.currentTarget`) so focus can return to it on
 * close; without one the hook falls back to `document.activeElement`. */
export type OpenDrawer = (opener?: HTMLElement | null) => void;

export function useCoverageDrawer(): { open: boolean; opener: HTMLElement | null; openDrawer: OpenDrawer; closeDrawer: () => void } {
  const [state, setState] = useState<{ open: boolean; opener: HTMLElement | null }>({ open: false, opener: null });
  const openDrawer: OpenDrawer = opener => setState({
    open: true,
    opener: opener ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null),
  });
  // The opener is kept after close: the drawer's effect cleanup needs it to return focus.
  const closeDrawer = () => setState(s => ({ ...s, open: false }));
  return { open: state.open, opener: state.opener, openDrawer, closeDrawer };
}

export interface CoverageDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The element that opened the drawer; focus returns to it on close. */
  opener: HTMLElement | null;
  coverage: Slot<CoverageData>;
  summary: SummaryData;
}

type Row = CoverageData['needsTagging'][number];

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TITLE_ID = 'coverage-drawer-title';

const unmeasuredReason = (r: Row) => (r.dependabotStatus === 'dependabot-off' ? 'Dependabot off' : (r.detail ?? 'Status check failed'));
const meta = (r: Row) => `${r.team ?? 'Unassigned'} · ${r.serviceTier ?? '—'} / ${r.codebaseType ?? '—'}`;
const repoLink = (r: Row) => (
  <a className="text-accent-light hover:text-accent-lighter" href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer">{r.fullName}</a>
);

function Group({ title, count, note, children }: { title: string; count: number; note: string; children: React.ReactNode }) {
  const id = `coverage-group-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="mb-5">
      <h3 id={id} className={`${TYPE.sectionLabel} text-gray-300`}>{title} · {count}</h3>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
      <ul className="mt-2 space-y-1.5">
        {count === 0 ? <li className="text-xs text-gray-500">None</li> : children}
      </ul>
    </section>
  );
}

export default function CoverageDrawer({ open, onClose, opener, coverage, summary }: CoverageDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Attached only while open. Esc closes; Tab and Shift+Tab wrap inside the panel.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = !!active && panelRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, opener]);

  if (!open) return null;
  const c = coverage.data;

  return (
    <div className="fixed inset-0" style={{ zIndex: Z.drawer }}>
      <div data-testid="drawer-backdrop" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="absolute right-0 top-0 bottom-0 flex flex-col bg-gray-900 border-l border-gray-800 shadow-xl"
        style={{ width: DRAWER_W, maxWidth: DRAWER_MAX_W }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 id={TITLE_ID} className="text-base font-semibold text-white">Coverage &amp; policy</h2>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="px-2 text-lg leading-none text-gray-400 hover:text-white">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {coverage.errorText ? (
            <p className="text-xs text-red-400">{coverage.errorText}</p>
          ) : !c ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : (
            <>
              <Group title="Unmeasured" count={c.unmeasured.length}
                note="Open counts unknown, not zero. Their resolved alerts and measured history still count.">
                {c.unmeasured.map(r => (
                  <li key={r.repoId} className={`vuln-hatch px-2.5 py-2 text-xs ${TYPE.control}`}>
                    <div>{repoLink(r)}</div>
                    <div className="text-gray-400">{meta(r)}</div>
                    <div className="text-warn">{unmeasuredReason(r)}</div>
                    <div className="text-gray-400">Open counts unknown</div>
                  </li>
                ))}
              </Group>
              <Group title="Needs tagging" count={c.needsTagging.length} note="Counted under “Unassigned” until tagged.">
                {c.needsTagging.map(r => (
                  <li key={r.repoId} className={`bg-chart-surface px-2.5 py-2 text-xs ${TYPE.control}`}>
                    <div>{repoLink(r)}</div>
                    <div className="text-gray-400">{meta(r)}</div>
                    <div className="text-gray-300">{`${r.openCritical} crit · ${r.openHigh} high`}</div>
                  </li>
                ))}
              </Group>
              <Group title="Excluded by policy" count={c.excludedByPolicy.length} note="Not counted anywhere on this page.">
                {c.excludedByPolicy.map(r => (
                  <li key={r.repoId} className={`bg-chart-surface px-2.5 py-2 text-xs ${TYPE.control}`}>
                    <div>{repoLink(r)}</div>
                    <div className="text-gray-400">{meta(r)}</div>
                    <div className="text-gray-300">{`${r.openCritical} crit · ${r.openHigh} high`}</div>
                  </li>
                ))}
              </Group>
            </>
          )}

          <section aria-labelledby="coverage-policy-title" className="mt-2">
            <h3 id="coverage-policy-title" className={`${TYPE.sectionLabel} text-gray-300`}>From deployment configuration</h3>
            <div className="mt-2 space-y-1 text-xs text-gray-300">
              {(['critical', 'high'] as const).map(sev => {
                const st = slaState(sev, summary);
                const label = slaStateLabel(st);
                return (
                  <div key={sev} data-testid={`sla-${sev}`}>
                    {sev === 'critical' ? 'Critical' : 'High'} SLA:{' '}
                    {label === null
                      ? <span>active</span>
                      : <span className={st.kind === 'invalid' ? 'text-red-400' : 'text-gray-500'}>{label}</span>}
                  </div>
                );
              })}
              {summary.policy.map(p => (
                <div key={p.id}>
                  {p.id} · {p.days} days · {p.effectiveFrom} → {p.until ?? 'open-ended'}{' '}
                  {p.pending && <span className="text-warn">pending</span>}
                </div>
              ))}
              <div className="text-gray-500">Resolved counted {resolvedCaption(summary.resolvedSince)} · scope: {summary.scope.property} = {summary.scope.value}</div>
              <div className="text-gray-500">Archiving a repo drops its open alerts but keeps its resolved ones, which raises % closed.</div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
```

`coverage-panel.tsx`, `policy-panel.tsx` and their two tests are NOT deleted here: the old composer still imports the panels until Task 2.11 rewrites it, and Task 2.11 deletes all four files together. Their intents are already covered by the new tests above (mapped in the Wave 2 test rewrite map).

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx --maxWorkers=3`
Expected: PASS.

Named reverts: attaching the key listener while closed fails "renders nothing and attaches no key listener while closed"; not returning focus fails "closing returns focus to the element that opened it"; rendering `openCritical` in an unmeasured row fails "never shows its stored open count"; checking `slaStatus` before `slaPolicyInvalid` (in Task 2.3) fails the invalid-policy test here.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/coverage-drawer.tsx src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: coverage and policy drawer replaces the two panels"
```

### Task 2.10: Page header children (meta line, stale tag, failed banner, coverage line, config banner)

**Files:**
- Create: `src/app/vulnerabilities/security-header.tsx`
- Test: `src/lib/__tests__/unit/vuln-security-header.test.tsx`

**Interfaces:**
- Consumes: `PageHeader` (`@/components/PageHeader`, unchanged) and `DataFreshness` (`@/components/runs/DataFreshness`, unchanged); `Slot` (Task 2.7); `SummaryData`, `ReposData`, `CoverageData` (Task 2.7); `OpenDrawer` (Task 2.9); `COVERAGE_LINE_MIN_H`, `TYPE` (Task 2.2); `CODEBASE_LABELS` (existing).
- Produces:
  - `default export SecurityHeader` with `SecurityHeaderProps = { summary: SummaryData; repos: Slot<ReposData>; coverage: Slot<CoverageData>; codebase: CodebaseGroup; summaryStale: boolean; openDrawer: OpenDrawer; now?: Date }`.
  - `securityMeta({ codebase, scopeValue, repoCount, teamCount })`, `staleHours(lastSuccessfulAt, now)`, `ConfigErrorBanner`, `CoverageLine` (named exports; `ConfigErrorBanner` is also used by the composer's unavailable page in Task 2.11), and the slot widths `COVERAGE_BADGE_SLOT_W` (136), `COVERAGE_EXCLUDED_SLOT_W` (72) and `COVERAGE_TAGGING_SLOT_W` (104), which the header's test imports.

Why page-local pieces: `PageHeader` and `DataFreshness` stay unchanged because the org and team report pages use them. `PageHeader` renders `meta` inside a `<p>`, so a banner cannot go there (a block element inside a paragraph is invalid); the stale tag, the failed banner, the config banner and the coverage line are therefore passed as `PageHeader`'s `children`. `PageHeader`'s root has `mb-6`, and the page container already spaces its children by `PAGE_GAP`, so the header is wrapped in a div with `[&>div]:mb-0` to avoid a 48px gap.

Content rules (spec "What the page does"):
- Title: `Security · {org}` (the existing title).
- Meta line: `{Codebase label} · N {scope value} repositories · N owning teams`, for example "Backend · 11 production repositories · 4 owning teams". The scope label comes from `summary.scope.value`, never a literal. It does NOT say "synced daily". The counts come from the `repos` rows for the current Codebase and Owning team (the summary carries no repository count and its `knownTeams` ignores the codebase), so while a team is selected the line describes that team's scope. While the rows load it reads `{Codebase label} · {scope value} repositories`, so `PageHeader`'s meta slot is never empty.
- Stale tag: `▲ STALE · {h}H` (whole hours since the last successful sync), shown when `sync.stale`, in the `--warn` tokens.
- Failed banner: when the latest sync failed, a red box with a "!" icon, the standing text and the first issue's message.
- Coverage line: minimum height 22px, so it does not shrink when the unmeasured badge disappears. It shows the unmeasured badge (only when the count is above zero), Excluded and Needs tagging counts, and "Coverage & policy →". Both the badge and the link open the drawer with the clicked element as the opener. A filter change must never move a control, so each item that can change width has a reserved slot: the badge's slot (`COVERAGE_BADGE_SLOT_W`, 136px) is always rendered and is `visibility: hidden` when the count is zero, and the two counts sit in minimum-width slots (`COVERAGE_EXCLUDED_SLOT_W` 72px, `COVERAGE_TAGGING_SLOT_W` 104px, sized for two-digit counts), so the items after each keep their x position.
- "Sync history →" is the `PageHeader` action.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-header.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import SecurityHeader, { securityMeta, staleHours, ConfigErrorBanner, CoverageLine, COVERAGE_BADGE_SLOT_W, COVERAGE_EXCLUDED_SLOT_W, COVERAGE_TAGGING_SLOT_W, type SecurityHeaderProps } from '@/app/vulnerabilities/security-header';
import { COVERAGE_LINE_MIN_H } from '@/app/vulnerabilities/dimensions';
import type { CoverageData, Slot } from '@/app/vulnerabilities/api-types';
import { summaryFixture, reposFixture, REPO_ROWS, repoRow, coverageFixture, coverageRow, slot, syncInfo } from '../support/security-fixtures';

const NOW = new Date('2026-09-23T12:00:00Z');
function props(over: Partial<SecurityHeaderProps> = {}): SecurityHeaderProps {
  return {
    summary: summaryFixture(),
    repos: slot(reposFixture(REPO_ROWS)),
    coverage: slot(coverageFixture()),
    codebase: 'backend', summaryStale: false, openDrawer: jest.fn(), now: NOW,
    ...over,
  };
}
const unmeasuredRow = coverageRow({ repoId: 9, openCritical: 4, detail: 'x' });

describe('securityMeta', () => {
  it('reads "<Codebase> · N <scope> repositories · N owning teams", with the scope label as data', () => {
    expect(securityMeta({ codebase: 'backend', scopeValue: 'production', repoCount: 11, teamCount: 4 }))
      .toBe('Backend · 11 production repositories · 4 owning teams');
    expect(securityMeta({ codebase: 'all', scopeValue: 'live', repoCount: 3, teamCount: 2 })).toBe('All · 3 live repositories · 2 owning teams');
  });
  it('uses singular forms for one', () => {
    expect(securityMeta({ codebase: 'shared', scopeValue: 'production', repoCount: 1, teamCount: 1 }))
      .toBe('Shared libraries · 1 production repository · 1 owning team');
  });
  it('without counts (rows still loading) it is never empty and carries no number', () => {
    expect(securityMeta({ codebase: 'backend', scopeValue: 'production', repoCount: null, teamCount: null })).toBe('Backend · production repositories');
  });
});

describe('staleHours', () => {
  it('is the whole hours since the last successful sync, never negative', () => {
    expect(staleHours('2026-09-21T18:00:00Z', NOW)).toBe(42);
    expect(staleHours('2026-09-23T11:30:00Z', NOW)).toBe(0);
    expect(staleHours('2026-09-24T00:00:00Z', NOW)).toBe(0);
  });
});

describe('SecurityHeader', () => {
  it('shows the title with the org, the meta line from the repos rows and the scope value, and never "synced daily"', () => {
    render(<SecurityHeader {...props()} />);
    expect(screen.getByText('Security · acme')).toBeTruthy();
    // REPO_ROWS: 4 repositories across 3 owning teams (Payments, Search, Platform).
    expect(screen.getByText('Backend · 4 production repositories · 3 owning teams')).toBeTruthy();
    expect(screen.getByTestId('security-header').textContent).not.toMatch(/synced daily/i);
  });

  it('counts Unassigned as an owning team: a repository with no team still counts toward the owning teams', () => {
    render(<SecurityHeader {...props({ repos: slot(reposFixture([...REPO_ROWS, repoRow('acme/orphan', 'Unassigned')])) })} />);
    // REPO_ROWS: 4 repositories across Payments, Search and Platform; the orphan adds a fifth repository and a fourth team.
    expect(screen.getByText('Backend · 5 production repositories · 4 owning teams')).toBeTruthy();
  });

  it('the scope label follows summary.scope.value', () => {
    render(<SecurityHeader {...props({ summary: summaryFixture({ scope: { property: 'service_tier', value: 'live' } }) })} />);
    expect(screen.getByText(/4 live repositories/)).toBeTruthy();
  });

  it('wraps PageHeader so its mb-6 does not stack on the page gap', () => {
    render(<SecurityHeader {...props()} />);
    expect(screen.getByTestId('security-header').className).toContain('[&>div]:mb-0');
  });

  it('shows the stale tag with the whole hours since the sync, and no tag when not stale', () => {
    const stale = syncInfo({ stale: true, lastSuccessfulAt: '2026-09-21T18:00:00Z' });
    const { rerender } = render(<SecurityHeader {...props({ summary: summaryFixture({ sync: stale }) })} />);
    expect(screen.getByTestId('stale-tag').textContent).toBe('▲ STALE · 42H');
    rerender(<SecurityHeader {...props()} />);
    expect(screen.queryByTestId('stale-tag')).toBeNull();
  });

  it('shows the failed-sync banner with a "!" icon and the first issue; it is not inside the meta paragraph', () => {
    const failed = syncInfo({ lastStatus: 'failed', issues: [{ kind: 'sync', message: 'token expired' }] });
    render(<SecurityHeader {...props({ summary: summaryFixture({ sync: failed }) })} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('The latest sync failed; showing data from the last good sync.');
    expect(banner.textContent).toContain('token expired');
    expect(within(banner).getByText('!')).toBeTruthy();
    expect(banner.closest('p')).toBeNull();
  });

  it('no banner when the latest sync did not fail', () => {
    render(<SecurityHeader {...props()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the freshness label, the Sync history action and the Updating… indicator', () => {
    const { rerender } = render(<SecurityHeader {...props()} />);
    expect(screen.getByText(/last successful sync/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sync history/ }).getAttribute('href')).toBe('/reports?tab=syncs');
    expect(screen.queryByText('Updating…')).toBeNull();
    rerender(<SecurityHeader {...props({ summaryStale: true })} />);
    expect(screen.getByText('Updating…')).toBeTruthy();
  });

  it('renders the config-error banner under the header', () => {
    render(<SecurityHeader {...props({ summary: summaryFixture({ configErrors: [{ source: 'startup', variable: 'VULN_X', rule: 'VULN_X entry 1: bad' }] }) })} />);
    expect(screen.getByText('VULN_X entry 1: bad')).toBeTruthy();
  });
});

describe('CoverageLine', () => {
  it('keeps its 22px minimum height in every state: loading, error, loaded with the badge, loaded without it', () => {
    const states = [
      slot<CoverageData>(undefined),
      slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }),
      slot(coverageFixture({ unmeasured: [unmeasuredRow] })),
      slot(coverageFixture()),
    ];
    for (const s of states) {
      const { unmount } = render(<CoverageLine coverage={s} openDrawer={jest.fn()} />);
      expect(screen.getByTestId('coverage-line').style.minHeight).toBe(`${COVERAGE_LINE_MIN_H}px`);
      unmount();
    }
  });

  // Revert: render the badge only when the count is above zero (no slot): the items after it slide left and right.
  it('reserves the badge slot in every state, with its width fixed and hidden when there is nothing to show', () => {
    const states: Array<[Slot<CoverageData>, string]> = [
      [slot<CoverageData>(undefined), 'hidden'],
      [slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }), 'hidden'],
      [slot(coverageFixture()), 'hidden'],
      [slot(coverageFixture({ unmeasured: [unmeasuredRow] })), 'visible'],
    ];
    for (const [s, visibility] of states) {
      const { unmount } = render(<CoverageLine coverage={s} openDrawer={jest.fn()} />);
      const reserved = screen.getByTestId('coverage-badge-slot');
      expect(reserved.style.minWidth).toBe(`${COVERAGE_BADGE_SLOT_W}px`);
      expect(reserved.style.visibility).toBe(visibility);
      unmount();
    }
  });

  // Revert: drop the min-width: "Needs tagging" and the link slide by a digit's width when a count changes.
  it('the excluded and needs-tagging counts sit in slots with a minimum width, whatever the counts', () => {
    for (const [excluded, tagging] of [[0, 0], [3, 1], [12, 11]]) {
      const { unmount } = render(<CoverageLine coverage={slot(coverageFixture({
        excludedByPolicy: Array.from({ length: excluded }, (_, i) => ({ ...unmeasuredRow, repoId: 100 + i })),
        needsTagging: Array.from({ length: tagging }, (_, i) => ({ ...unmeasuredRow, repoId: 200 + i })),
      }))} openDrawer={jest.fn()} />);
      expect(screen.getByTestId('coverage-excluded').style.minWidth).toBe(`${COVERAGE_EXCLUDED_SLOT_W}px`);
      expect(screen.getByTestId('coverage-excluded').textContent).toBe(`Excluded ${excluded}`);
      expect(screen.getByTestId('coverage-tagging').style.minWidth).toBe(`${COVERAGE_TAGGING_SLOT_W}px`);
      expect(screen.getByTestId('coverage-tagging').textContent).toBe(`Needs tagging ${tagging}`);
      unmount();
    }
  });

  it('shows the unmeasured badge only when there are unmeasured repositories, and opens the drawer from the clicked element', () => {
    const openDrawer = jest.fn();
    const { rerender } = render(<CoverageLine coverage={slot(coverageFixture({ unmeasured: [unmeasuredRow, { ...unmeasuredRow, repoId: 10 }] }))} openDrawer={openDrawer} />);
    const badge = screen.getByRole('button', { name: /UNMEASURED/ });
    expect(badge.textContent).toBe('▲ 2 UNMEASURED');
    fireEvent.click(badge);
    expect(openDrawer).toHaveBeenCalledWith(badge);
    rerender(<CoverageLine coverage={slot(coverageFixture())} openDrawer={openDrawer} />);
    expect(screen.queryByRole('button', { name: /UNMEASURED/ })).toBeNull();
  });

  it('shows the excluded and needs-tagging counts and a "Coverage & policy →" link that opens the drawer', () => {
    const openDrawer = jest.fn();
    render(<CoverageLine coverage={slot(coverageFixture({
      excludedByPolicy: [{ ...unmeasuredRow, repoId: 1 }, { ...unmeasuredRow, repoId: 2 }, { ...unmeasuredRow, repoId: 3 }],
      needsTagging: [{ ...unmeasuredRow, repoId: 4 }],
    }))} openDrawer={openDrawer} />);
    expect(screen.getByText('Excluded 3')).toBeTruthy();
    expect(screen.getByText('Needs tagging 1')).toBeTruthy();
    const link = screen.getByRole('button', { name: 'Coverage & policy →' });
    fireEvent.click(link);
    expect(openDrawer).toHaveBeenCalledWith(link);
  });

  it('a coverage error shows its text and keeps the link', () => {
    render(<CoverageLine coverage={slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false })} openDrawer={jest.fn()} />);
    expect(screen.getByText("Couldn't load coverage: boom")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coverage & policy →' })).toBeTruthy();
  });
});

describe('ConfigErrorBanner (carried over)', () => {
  it('renders nothing when there are no errors', () => {
    const { container } = render(<ConfigErrorBanner errors={[]} />);
    expect(container.textContent).toBe('');
    const { container: c2 } = render(<ConfigErrorBanner errors={undefined} />);
    expect(c2.textContent).toBe('');
  });
  it('lists a startup entry\'s rule with no "clears after" text', () => {
    render(<ConfigErrorBanner errors={[{ source: 'startup', variable: 'VULN_X', rule: 'VULN_X entry 1: bad' }]} />);
    expect(screen.getByText('VULN_X entry 1: bad')).toBeTruthy();
    expect(screen.queryByText(/clears after/)).toBeNull();
  });
  it('adds "clears after the next successful sync (as of …)" for a sync-sourced entry', () => {
    render(<ConfigErrorBanner errors={[{ source: 'sync', variable: 'VULN_Y', rule: 'VULN_Y: unseen', at: '2026-09-22T06:00:00Z' }]} />);
    expect(screen.getByText(/VULN_Y: unseen — clears after the next successful sync \(as of 2026-09-22T06:00:00Z\)/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-security-header.test.tsx --maxWorkers=3`
Expected: FAIL with "Cannot find module '@/app/vulnerabilities/security-header'".

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/security-header.tsx
'use client';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import DataFreshness from '@/components/runs/DataFreshness';
import { CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import type { SummaryData, ReposData, CoverageData } from './api-types';
import type { Slot } from './use-security-data';
import type { OpenDrawer } from './coverage-drawer';
import { COVERAGE_LINE_MIN_H, TYPE } from './dimensions';

/** "Backend · 11 production repositories · 4 owning teams". The scope value is data
 * (`summary.scope.value`), never a literal. Without counts it is still a full line. */
export function securityMeta(i: { codebase: CodebaseGroup; scopeValue: string; repoCount: number | null; teamCount: number | null }): string {
  const head = `${CODEBASE_LABELS[i.codebase]} · `;
  if (i.repoCount === null || i.teamCount === null) return `${head}${i.scopeValue} repositories`;
  const repos = `${i.repoCount.toLocaleString('en-US')} ${i.scopeValue} ${i.repoCount === 1 ? 'repository' : 'repositories'}`;
  const teams = `${i.teamCount.toLocaleString('en-US')} owning ${i.teamCount === 1 ? 'team' : 'teams'}`;
  return `${head}${repos} · ${teams}`;
}

export function staleHours(lastSuccessfulAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(lastSuccessfulAt)) / 3_600_000));
}

/**
 * The one place that renders the `configErrors` channel every prepare()-based response carries
 * (carried over unchanged from the old page). A `source: 'sync'` entry names when it will clear
 * itself, since the next successful sync overwrites it; a `source: 'startup'` entry clears only on
 * the next restart with the variable fixed.
 */
export function ConfigErrorBanner({ errors }: { errors?: Array<{ source: string; variable: string; rule: string; at?: string }> }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div className="text-xs text-red-400 border border-red-900 rounded p-2 space-y-0.5">
      {errors.map((e, i) => (
        <div key={i}>{e.rule}{e.source === 'sync' ? ` — clears after the next successful sync (as of ${e.at})` : ''}</div>
      ))}
    </div>
  );
}

/** Slot widths, in px, sized for counts of up to two digits in the page's font. The unmeasured badge's
 * slot is always rendered, and the two counts sit in slots too, so the items after each keep their place
 * when a filter change moves a count between zero and non-zero or between one digit and two. */
export const COVERAGE_BADGE_SLOT_W = 136;
export const COVERAGE_EXCLUDED_SLOT_W = 72;
export const COVERAGE_TAGGING_SLOT_W = 104;

/** Unmeasured badge, excluded and needs-tagging counts, and the drawer link. The minimum height keeps
 * the line from shrinking when the badge disappears, and the badge's slot keeps its width. */
export function CoverageLine({ coverage, openDrawer }: { coverage: Slot<CoverageData>; openDrawer: OpenDrawer }) {
  const c = coverage.data;
  const unmeasured = c?.unmeasured.length ?? 0;
  return (
    <div
      data-testid="coverage-line"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400"
      style={{ minHeight: COVERAGE_LINE_MIN_H }}
    >
      <span
        data-testid="coverage-badge-slot"
        className="inline-flex shrink-0"
        style={{ minWidth: COVERAGE_BADGE_SLOT_W, visibility: unmeasured > 0 ? 'visible' : 'hidden' }}
      >
        {unmeasured > 0 && (
          <button
            type="button"
            onClick={e => openDrawer(e.currentTarget)}
            className={`inline-flex items-center gap-1 border border-warn-line bg-warn-bg text-warn px-1.5 py-0.5 font-semibold ${TYPE.badge}`}
          >
            ▲ {unmeasured} UNMEASURED
          </button>
        )}
      </span>
      {c && (
        <>
          <span data-testid="coverage-excluded" className="shrink-0" style={{ minWidth: COVERAGE_EXCLUDED_SLOT_W }}>Excluded {c.excludedByPolicy.length}</span>
          <span data-testid="coverage-tagging" className="shrink-0" style={{ minWidth: COVERAGE_TAGGING_SLOT_W }}>Needs tagging {c.needsTagging.length}</span>
        </>
      )}
      {coverage.errorText && <span className="text-red-400">{coverage.errorText}</span>}
      <button type="button" onClick={e => openDrawer(e.currentTarget)} className="text-accent-light hover:text-accent-lighter">
        Coverage &amp; policy →
      </button>
    </div>
  );
}

export interface SecurityHeaderProps {
  summary: SummaryData;
  repos: Slot<ReposData>;
  coverage: Slot<CoverageData>;
  codebase: CodebaseGroup;
  /** The summary is showing the previous key's data while the new one loads. */
  summaryStale: boolean;
  openDrawer: OpenDrawer;
  /** Injected for tests; defaults to the current time. */
  now?: Date;
}

export default function SecurityHeader({ summary, repos, coverage, codebase, summaryStale, openDrawer, now }: SecurityHeaderProps) {
  const rows = repos.data?.rows;
  const meta = securityMeta({
    codebase,
    scopeValue: summary.scope.value,
    repoCount: rows ? rows.length : null,
    teamCount: rows ? new Set(rows.map(r => r.team)).size : null,
  });
  const sync = summary.sync;
  const failed = sync.lastStatus === 'failed';
  const showStale = sync.stale && !!sync.lastSuccessfulAt;

  return (
    // PageHeader's root carries mb-6; the page container already spaces its children, so zero it here.
    <div data-testid="security-header" className="[&>div]:mb-0">
      <PageHeader
        title={`Security · ${summary.org}`}
        meta={meta}
        freshness={(
          <DataFreshness
            label="last successful sync"
            at={sync.lastSuccessfulAt}
            stale={sync.stale}
            // Label only: the failed banner is page-local (below), full width, not squeezed into this row.
            latestFailed={false}
            failedText=""
          />
        )}
        badges={summaryStale ? <span className="text-[11px] text-accent-light">Updating…</span> : undefined}
        actions={<Link href="/reports?tab=syncs" className="text-xs text-accent-light hover:text-accent-lighter">Sync history →</Link>}
      >
        <div className="flex flex-col gap-2">
          {showStale && (
            <div>
              <span data-testid="stale-tag" className={`inline-block border border-warn-line bg-warn-bg text-warn px-1.5 py-0.5 text-xs font-semibold ${TYPE.badge}`}>
                {`▲ STALE · ${staleHours(sync.lastSuccessfulAt as string, now ?? new Date())}H`}
              </span>
            </div>
          )}
          {failed && (
            <div role="alert" className="flex items-start gap-2 text-xs text-red-400 border border-red-900 rounded-md p-2">
              <span aria-hidden="true" className="shrink-0 w-4 h-4 rounded-full border border-red-400 flex items-center justify-center text-[10px] leading-none font-bold">!</span>
              <span>The latest sync failed; showing data from the last good sync. {sync.issues?.[0]?.message}</span>
            </div>
          )}
          <ConfigErrorBanner errors={summary.configErrors} />
          <CoverageLine coverage={coverage} openDrawer={openDrawer} />
        </div>
      </PageHeader>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/lib/__tests__/unit/vuln-security-header.test.tsx src/lib/__tests__/unit/data-freshness.test.tsx --maxWorkers=3 && npx tsc --noEmit`
Expected: PASS (`data-freshness.test.tsx` is included to prove `PageHeader` and `DataFreshness` are untouched); `tsc` clean (the old composer and its panels are still in place until Task 2.11).

Named reverts: removing `minHeight` from the coverage line fails "keeps its 22px minimum height in every state"; rendering the badge only when the count is above zero (no slot) fails "reserves the badge slot in every state"; dropping the count slots' `minWidth` fails "the excluded and needs-tagging counts sit in slots with a minimum width"; putting the banner in `meta` fails "it is not inside the meta paragraph" (`closest('p')` would find `PageHeader`'s `<p>`); hard-coding "production" in the meta fails "the scope label follows summary.scope.value".

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/security-header.tsx src/lib/__tests__/unit/vuln-security-header.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Security page header children (meta, stale tag, failed banner, coverage line)"
```

### Task 2.11: The thin composer, the six slot modules, and retiring the old composer's tests

**Files:**
- Create: `src/app/vulnerabilities/view-props.ts`
- Create (slot stubs that Waves 3 and 4 MODIFY): `src/app/vulnerabilities/kpi-tiles.tsx`, `ownership-card.tsx`, `trend-card.tsx`, `alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx`
- Modify: `src/app/vulnerabilities/vulnerabilities-content.tsx` (full rewrite as the thin composer; `trendSince` and `TrendRange` move out of it into `security-state.ts`)
- Delete: `src/app/vulnerabilities/coverage-panel.tsx`, `src/app/vulnerabilities/policy-panel.tsx`
- Modify: `src/lib/__tests__/support/security-fixtures.ts` (add `viewProps`; imports and function shown in Step 3)
- Delete (old tests, replaced per the Wave 2 test rewrite map): `vuln-content-b1`, `vuln-content-config-errors`, `vuln-content-error`, `vuln-content-pivot-unfiltered`, `vuln-content-repo-reset`, `vuln-content-resolved-caption`, `vuln-content-scroll`, `vuln-content-team-dropdown`, `vuln-content-team-line`, `vuln-content-trend-colors`, `vuln-content-trend-range`, `vuln-alerts-keep-previous-data`, `vuln-coverage-panel`, `vuln-policy-panel` (all `.test.tsx` under `src/lib/__tests__/unit/`)
- Test: `src/lib/__tests__/unit/vuln-security-page.test.tsx`, `src/lib/__tests__/unit/vuln-security-view-props.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2.1 to 2.10; `DEFAULT_ALERT_LIST`, `SecurityUrl`, `AlertListController` (Tasks 2.4, 2.6); `SecurityData` (Task 2.7).
- Produces:
  - `SecurityViewProps` (in `view-props.ts`, shape in the Wave 2 public interface).
  - `viewProps(over?)` in `security-fixtures.ts`: a complete `SecurityViewProps` for slot tests (healthy data in every slot, `jest.fn()` for every handler).
  - The six slot modules, each `export default function X(props: SecurityViewProps)`, rendering reserved-height boxes with the `data-testid`s of the slot table (`kpi-tiles`, `ownership-card` with `ownership-card-body`, `trend-card` with `trend-plot`, `alerts-strip`, `repo-rail`, `alert-list` with `alert-list-rows`). Waves 3 and 4 replace the body of each; the `data-testid` and the inline height from `dimensions.ts` must survive on the element the slot table names (the body or plot for the ownership and trend cards, never the outer card).
  - `default export VulnerabilitiesContent` (unchanged name and import path; `page.tsx` is untouched).

Composition (what the composer owns):
- the page container: max width `PAGE_MAX_W`, padding `PAGE_PAD`, a column with gap `PAGE_GAP`; no ancestor of the sticky bar sets `overflow`, or `position: sticky` would silently stop working;
- `<SecurityHeader>`, then `<FilterBar>` (a direct child of the container, a sibling of the view content), then the view panel (`role="tabpanel"`), then `<CoverageDrawer>`;
- Overview: `<KpiTiles/> <OwnershipCard/> <TrendCard/>`; Alerts: `<AlertsStrip/>` above the card shell holding `<RepoRail/> <AlertList/>`;
- the scroll-up-only rule on a view switch (a layout effect on `view`, skipped on first mount so Back is covered too);
- the full-page states carried over from today: summary failing (never half a page of stale numbers, even with `keepPreviousData` data in hand), the unknown-team recovery ("Clear team filter", checked before the plain error), and the "unavailable" page with the config banner and the failed-sync line.

The Alerts tab count is `scopeOpenCount(rows, severity, effectiveRepo)` over the `repos` rows. The "A date…" pre-fill is the current baseline's `takenOn` for `kSev`, else today minus 7 days (UTC); the spec says only "pre-filled with a date", so this is a choice, reported.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-page.test.tsx
// The composed page against a routed fetch mock and the reactive navigation mock.
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';
import {
  KPI_ROW_H, OWNERSHIP_BODY_H, TREND_PLOT_H, ALERTS_STRIP_H, ALERTS_CARD_H, ALERT_LIST_H, RAIL_W,
  PAGE_MAX_W, PAGE_PAD, PAGE_GAP, FILTER_BAR_H, Z,
} from '@/app/vulnerabilities/dimensions';
import { SwrFresh, fetchRouter, summaryFixture, coverageFixture, coverageRow, syncInfo } from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;
const params = (url: string) => new URL(url, 'http://x').searchParams;

function mount(search = '', routes: Parameters<typeof fetchRouter>[0] = {}) {
  nav().__resetSearch(search);
  const fetchMock = fetchRouter(routes);
  (global as any).fetch = fetchMock;
  render(<SwrFresh><VulnerabilitiesContent /></SwrFresh>);
  return fetchMock;
}

const rect = (top: number, bottom: number) =>
  ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('page frame', () => {
  it('has the spec max width and padding, laid out as a column with the page gap', async () => {
    mount('');
    const page = await screen.findByTestId('security-page');
    expect(page.style.maxWidth).toBe(`${PAGE_MAX_W}px`);
    expect([page.style.paddingTop, page.style.paddingRight, page.style.paddingBottom, page.style.paddingLeft])
      .toEqual([`${PAGE_PAD.top}px`, `${PAGE_PAD.x}px`, `${PAGE_PAD.bottom}px`, `${PAGE_PAD.x}px`]);
    expect(page.style.gap).toBe(`${PAGE_GAP}px`);
  });

  it("the sticky bar is a direct child of the container, sticky at the top, and the composer's own ancestors set no overflow", async () => {
    mount('');
    const bar = await screen.findByTestId('security-bar');
    expect(bar.parentElement).toBe(screen.getByTestId('security-page'));
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.top).toBe('0px');
    expect(bar.style.zIndex).toBe(String(Z.stickyBar));
    // jsdom only has the composer's own wrappers and the test container above the bar. The page's real
    // layout ancestors (app shell, `main`) are checked by the headless-Chrome measurement in the exit check.
    for (let el = bar.parentElement; el && el !== document.body; el = el.parentElement) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/overflow/);
      expect(el.className).not.toMatch(/overflow/);
    }
  });

  it('the bar keeps its height when a team is chosen (selecting a team never shifts the page)', async () => {
    mount('');
    const bar = await screen.findByTestId('security-bar');
    expect(bar.style.height).toBe(`${FILTER_BAR_H}px`);
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    await waitFor(() => expect(nav().__calls.length).toBeGreaterThan(0));
    expect(screen.getByTestId('security-bar').style.height).toBe(`${FILTER_BAR_H}px`);
  });
});

describe('views', () => {
  it('Overview stacks the KPI row, the ownership card and the trend card at their spec heights, with the page gap', async () => {
    mount('');
    expect((await screen.findByTestId('kpi-tiles')).style.height).toBe(`${KPI_ROW_H}px`);
    // The body and the plot carry the fixed heights. The outer cards hold their own headers, so they set none.
    expect(screen.getByTestId('ownership-card-body').style.height).toBe(`${OWNERSHIP_BODY_H}px`);
    expect(screen.getByTestId('ownership-card').style.height).toBe('');
    expect(screen.getByTestId('trend-plot').style.height).toBe(`${TREND_PLOT_H}px`);
    expect(screen.getByTestId('trend-card').style.height).toBe('');
    expect(screen.queryByTestId('alerts-strip')).toBeNull();
    expect(screen.getByRole('tabpanel').style.gap).toBe(`${PAGE_GAP}px`);
  });

  it('Alerts shows the 72px strip above a 776px card holding the 260px rail and the 560px list area', async () => {
    mount('view=alerts');
    expect((await screen.findByTestId('alerts-strip')).style.height).toBe(`${ALERTS_STRIP_H}px`);
    const card = screen.getByTestId('alerts-card');
    expect(card.style.height).toBe(`${ALERTS_CARD_H}px`);
    expect(card.style.gridTemplateColumns).toContain(`${RAIL_W}px`);
    expect(within(card).getByTestId('repo-rail').style.width).toBe(`${RAIL_W}px`);
    expect(within(card).getByTestId('alert-list-rows').style.height).toBe(`${ALERT_LIST_H}px`);
    expect(screen.queryByTestId('kpi-tiles')).toBeNull();
  });

  it('clicking a view tab pushes a history entry with scroll:false and swaps the view', async () => {
    mount('');
    fireEvent.click(await screen.findByRole('tab', { name: /^Alerts/ }));
    await waitFor(() => expect(screen.getByTestId('alerts-strip')).toBeTruthy());
    const call = nav().__calls.find((c: any) => params(c.url).get('view') === 'alerts');
    expect(call.kind).toBe('push');
    expect(call.opts).toEqual({ scroll: false });
  });
});

describe('Alerts tab count', () => {
  it('sums open counts under Severity over the repos rows, including the unmeasured row\'s stored count', async () => {
    mount('');
    const count = await screen.findByTestId('alerts-tab-count');
    await waitFor(() => expect(count.textContent).toBe('13'));   // critical 10 + high 3
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('10'));
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('3'));
  });

  it('narrows to the selected repository', async () => {
    mount('repo=acme%2Fledger');
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('2'));
  });
});

describe('filters write the URL without scrolling and without switching the view', () => {
  it.each([
    ['Codebase', 'frontend', 'codebase'],
    ['Owning team', 'Search', 'team'],
    ['Severity', 'high', 'severity'],
    ['Compare to', '7d', 'baseline'],
  ])('%s -> %s: one replace with scroll:false, view untouched', async (label, value, key) => {
    mount('view=alerts');
    fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    const call = nav().__calls[0];
    expect(call.kind).toBe('replace');
    expect(call.opts).toEqual({ scroll: false });
    const p = params(call.url);
    expect(p.get(key)).toBe(value);
    expect(p.get('view')).toBe('alerts');
  });

  it('changing Codebase clears the selected repository in the same write and keeps the view and team', async () => {
    mount('view=alerts&team=Payments&repo=acme%2Fledger');
    fireEvent.change(await screen.findByLabelText('Codebase'), { target: { value: 'frontend' } });
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    const p = params(nav().__calls[0].url);
    expect(p.has('repo')).toBe(false);
    expect(p.get('codebase')).toBe('frontend');
    expect(p.get('view')).toBe('alerts');
    expect(p.get('team')).toBe('Payments');
  });

  it('Reset filters clears the five filters and never changes the view', async () => {
    mount('view=alerts&codebase=frontend&team=Search&severity=high');
    fireEvent.click(await screen.findByText('Reset filters'));
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    expect(Object.fromEntries(params(nav().__calls[0].url).entries())).toEqual({ view: 'alerts' });
  });

  it('choosing a team puts team=<name> into the summary, coverage, repos and alerts requests', async () => {
    const f = mount('');
    fireEvent.change(await screen.findByLabelText('Owning team'), { target: { value: 'Search' } });
    await waitFor(() => {
      const urls = f.mock.calls.map(([u]) => String(u));
      for (const route of ['summary', 'coverage', 'repos']) {
        expect(urls.some(u => u.includes(`/${route}?`) && u.includes('team=Search'))).toBe(true);
      }
    });
  });

  it('the Owning team select shows the team already in the URL', async () => {
    mount('team=Payments');
    await waitFor(() => expect((screen.getByLabelText('Owning team') as HTMLSelectElement).value).toBe('Payments'));
  });
});

describe('scroll-up-only on a view switch', () => {
  it('scrolls up just enough that the content starts under the bar, and never scrolls down', async () => {
    const scrollBy = jest.fn();
    (window as any).scrollBy = scrollBy;
    let panelTop = 20;
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-testid') === 'security-bar') return rect(0, FILTER_BAR_H);
      if (this.getAttribute('role') === 'tabpanel') return rect(panelTop, panelTop + 500);
      return rect(0, 0);
    });
    mount('');
    fireEvent.click(await screen.findByRole('tab', { name: /^Alerts/ }));
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith(0, 20 - FILTER_BAR_H));

    scrollBy.mockClear();
    panelTop = 400;   // the content is already below the bar
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => expect(nav().__calls.length).toBe(2));
    await act(async () => { await Promise.resolve(); });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not scroll on first mount, even when the data is already cached so the page renders on the very first pass', async () => {
    // A shared SWR cache: the second mount finds the summary already cached, so the bar and the
    // panel exist during the first layout effect. Without the "skip first mount" guard that effect
    // would measure them and scroll.
    const cache = new Map();
    const Shared = ({ children }: { children: React.ReactNode }) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
    );
    nav().__resetSearch('view=alerts');
    (global as any).fetch = fetchRouter();
    const first = render(<Shared><VulnerabilitiesContent /></Shared>);
    await screen.findByTestId('alerts-strip');
    first.unmount();

    const scrollBy = jest.fn();
    (window as any).scrollBy = scrollBy;
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => rect(-500, -400));
    render(<Shared><VulnerabilitiesContent /></Shared>);
    expect(screen.getByTestId('alerts-strip')).toBeTruthy();   // rendered synchronously from the cache
    await act(async () => { await Promise.resolve(); });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('coverage drawer from the header', () => {
  it('the unmeasured badge opens the drawer and Esc closes it, returning focus to the badge', async () => {
    mount('', {
      coverage: { body: coverageFixture({ unmeasured: [coverageRow({ repoId: 9, openCritical: 4, detail: 'x' })] }) },
    });
    const badge = await screen.findByRole('button', { name: /UNMEASURED/ });
    fireEvent.click(badge);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(badge);
  });
});

describe('full-page states carried over from today', () => {
  it('an unknown team shows the 400\'s message, the known teams and "Clear team filter", which clears the team', async () => {
    mount('team=Z', { summary: { status: 400, body: { error: 'unknown team', known_teams: ['T1', 'T2'] } } });
    expect(await screen.findByText('unknown team')).toBeTruthy();
    expect(screen.getByText(/Known teams: T1, T2/)).toBeTruthy();
    fireEvent.click(screen.getByText('Clear team filter'));
    await waitFor(() => expect(params(nav().__calls[0].url).has('team')).toBe(false));
  });

  it('a summary error with no data yet shows the plain error line, not the page', async () => {
    mount('', { summary: { status: 500, body: { error: 'Internal Server Error' } } });
    expect(await screen.findByText("Couldn't load summary: Internal Server Error")).toBeTruthy();
    expect(screen.queryByTestId('security-bar')).toBeNull();
  });

  it('a summary error WITH data in hand still fails the page visibly, not a banner over stale figures', async () => {
    mount('', {
      summary: url => (url.searchParams.get('team') === 'Search'
        ? { status: 500, body: { error: 'Internal Server Error' } }
        : { body: summaryFixture() }),
    });
    expect(await screen.findByText('Security · acme')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    expect(await screen.findByText("Couldn't load summary: Internal Server Error")).toBeTruthy();
    expect(screen.queryByText('Security · acme')).toBeNull();
  });

  it('the unknown-team page wins over the plain error line when both could apply', async () => {
    mount('', {
      summary: url => (url.searchParams.get('team') === 'Search'
        ? { status: 400, body: { error: 'unknown team', known_teams: ['T1'] } }
        : { body: summaryFixture() }),
    });
    expect(await screen.findByText('Security · acme')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    expect(await screen.findByText('unknown team')).toBeTruthy();
    expect(screen.getByText(/Known teams: T1/)).toBeTruthy();
  });

  it('the unavailable page shows the reason, the config banner, the failed-sync line and the Sync history link', async () => {
    mount('', {
      summary: { body: {
        available: false, reason: 'No successful vulnerability sync yet.',
        sync: syncInfo({ lastStatus: 'failed', lastSuccessfulAt: null, issues: [{ kind: 'sync', message: 'boom' }] }),
        configErrors: [{ source: 'startup', variable: 'VULN_X', rule: 'VULN_X entry 1: bad' }],
      } },
    });
    expect(await screen.findByText('No successful vulnerability sync yet.')).toBeTruthy();
    expect(screen.getByText('VULN_X entry 1: bad')).toBeTruthy();
    expect(screen.getByText('The last sync failed: boom')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sync history/ }).getAttribute('href')).toBe('/reports?tab=syncs');
  });

  it('shows Loading… before the summary resolves', () => {
    nav().__resetSearch('');
    (global as any).fetch = jest.fn(() => new Promise(() => {}));
    render(<SwrFresh><VulnerabilitiesContent /></SwrFresh>);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
```

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-view-props.test.tsx
// viewProps() is the props builder every Wave 3 and Wave 4 slot test starts from, so it is pinned
// against the real hooks: a builder that lacked a member the hooks return would let a slot test pass
// against a shape the page never gives it.
import { render, renderHook, screen } from '@testing-library/react';
import { useAlertList, useSecurityUrl } from '@/app/vulnerabilities/security-state';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import OwnershipCard from '@/app/vulnerabilities/ownership-card';
import TrendCard from '@/app/vulnerabilities/trend-card';
import AlertsStrip from '@/app/vulnerabilities/alerts-strip';
import RepoRail from '@/app/vulnerabilities/repo-rail';
import AlertList from '@/app/vulnerabilities/alert-list';
import { viewProps } from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());

describe('viewProps', () => {
  it('has exactly the url and list members the real hooks return', () => {
    const url = renderHook(() => useSecurityUrl()).result.current;
    const list = renderHook(() => useAlertList({ codebase: 'backend', team: null, repo: null, severity: 'both' })).result.current;
    const p = viewProps();
    expect(Object.keys(p.url).sort()).toEqual(Object.keys(url).sort());
    expect(Object.keys(p.list).sort()).toEqual(Object.keys(list).sort());
  });

  it('every handler is a jest mock, so a test can assert a call without a router or a hook', () => {
    const p = viewProps();
    const handlers = [...Object.values(p.url), ...Object.values(p.list), p.openDrawer].filter(v => typeof v === 'function');
    expect(handlers.length).toBeGreaterThan(15);
    for (const h of handlers) expect(jest.isMockFunction(h)).toBe(true);
  });

  it('an override replaces one member and leaves the rest of the healthy defaults', () => {
    const openDrawer = jest.fn();
    const p = viewProps({ openDrawer });
    expect(p.openDrawer).toBe(openDrawer);
    expect(p.summary.org).toBe('acme');
    expect(p.data.repos.data?.rows.length).toBeGreaterThan(0);
    expect(p.list.list.page).toBe(1);
  });

  it('every slot module accepts it and renders its test id', () => {
    render(<>
      <KpiTiles {...viewProps()} /><OwnershipCard {...viewProps()} /><TrendCard {...viewProps()} />
      <AlertsStrip {...viewProps()} /><RepoRail {...viewProps()} /><AlertList {...viewProps()} />
    </>);
    for (const id of ['kpi-tiles', 'ownership-card', 'trend-card', 'alerts-strip', 'repo-rail', 'alert-list']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3`
Expected: FAIL. The old composer renders none of the new structure ("Unable to find an element by: [data-testid="security-page"]"), and `viewProps` is not exported from the fixtures file.

- [ ] **Step 3: Implement**

First the shared props type and the six slot stubs. Each stub is real, rendering code: it reserves the spec's size so the layout is stable before the content exists, and it keeps its `data-testid`s. The ownership and trend stubs put the fixed height on an inner body or plot element and leave the outer section without one, because the real cards hold a header above the body.

```ts
// src/app/vulnerabilities/view-props.ts
import type { SummaryData } from './api-types';
import type { SecurityData } from './use-security-data';
import type { AlertListController, SecurityUrl } from './security-state';
import type { OpenDrawer } from './coverage-drawer';

/** What the composer hands to every view slot. A slot reads what it needs and ignores the rest. */
export interface SecurityViewProps {
  /** The scoped summary (codebase, team, baseline); always available:true here. */
  summary: SummaryData;
  /** Every data slot: summary, teamSummary, coverage, repos, trend, sparkline, alerts, repoStatus. */
  data: SecurityData;
  /** URL values and the handlers that write them. */
  url: SecurityUrl;
  /** The alert-list state; `list.list` is the EFFECTIVE (sanitised) state that was sent. */
  list: AlertListController;
  openDrawer: OpenDrawer;
}
```

```tsx
// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H } from './dimensions';

/** Slot for the Overview KPI tiles. Reserves the spec's 178px row; the tiles replace this body. */
export default function KpiTiles(_props: SecurityViewProps) {
  return <section aria-label="Key figures" data-testid="kpi-tiles" style={{ height: KPI_ROW_H }} />;
}
```

```tsx
// src/app/vulnerabilities/ownership-card.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { OWNERSHIP_BODY_H } from './dimensions';

/** Slot for the ownership card (Owning teams and Repositories tabs). Reserves the 330px body; the tabs sit above it. */
export default function OwnershipCard(_props: SecurityViewProps) {
  return (
    <section aria-label="Ownership" data-testid="ownership-card">
      <div data-testid="ownership-card-body" style={{ height: OWNERSHIP_BODY_H }} />
    </section>
  );
}
```

```tsx
// src/app/vulnerabilities/trend-card.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { TREND_PLOT_H } from './dimensions';

/** Slot for the trend chart card. Reserves the 220px plot; the card's own header sits above it. */
export default function TrendCard(_props: SecurityViewProps) {
  return (
    <section aria-label="Trend" data-testid="trend-card">
      <div data-testid="trend-plot" style={{ height: TREND_PLOT_H }} />
    </section>
  );
}
```

```tsx
// src/app/vulnerabilities/alerts-strip.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { ALERTS_STRIP_H } from './dimensions';

/** Slot for the Alerts summary strip. Reserves the 72px strip. */
export default function AlertsStrip(_props: SecurityViewProps) {
  return <section aria-label="Alerts summary" data-testid="alerts-strip" style={{ height: ALERTS_STRIP_H }} />;
}
```

```tsx
// src/app/vulnerabilities/repo-rail.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { RAIL_W } from './dimensions';

/** Slot for the repository rail. The card's grid gives it its 260px column. */
export default function RepoRail(_props: SecurityViewProps) {
  return <aside aria-label="Repositories" data-testid="repo-rail" style={{ width: RAIL_W }} />;
}
```

```tsx
// src/app/vulnerabilities/alert-list.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { ALERT_LIST_H } from './dimensions';

/** Slot for the alert list column (filters, rows, pager). Reserves the 560px list area (10 rows of 56px). */
export default function AlertList(_props: SecurityViewProps) {
  return (
    <section aria-label="Alerts" data-testid="alert-list" className="min-w-0">
      <div data-testid="alert-list-rows" style={{ height: ALERT_LIST_H }} />
    </section>
  );
}
```

Then `viewProps` in the fixtures file. It needs types from this task and from Tasks 2.4 to 2.7, which is why it is added here and not in Task 2.5. In `src/lib/__tests__/support/security-fixtures.ts`, add these three imports below the existing ones:

```ts
// add to src/lib/__tests__/support/security-fixtures.ts (below the existing imports)
import { DEFAULT_ALERT_LIST } from '@/app/vulnerabilities/security-state';
import type { SecurityData } from '@/app/vulnerabilities/use-security-data';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
```

Then append this function at the end of the file:

```ts
// append to src/lib/__tests__/support/security-fixtures.ts
/**
 * A complete SecurityViewProps for slot tests: healthy data in every slot, no alert-list filters,
 * and a jest.fn() for every handler, so a test asserts a call without wiring a router or a hook.
 * Pass `over` to replace any top-level member (for example a `data` with a loading slot).
 */
export function viewProps(over: Partial<SecurityViewProps> = {}): SecurityViewProps {
  const summary = summaryFixture();
  const data: SecurityData = {
    summary: slot(summary), teamSummary: slot(summary), coverage: slot(coverageFixture()),
    repos: slot(reposFixture(REPO_ROWS)), trend: slot(trendFixture()), sparkline: slot(trendFixture()),
    alerts: slot(alertsFixture()), repoStatus: 'none', effectiveRepo: null, effectiveList: DEFAULT_ALERT_LIST,
    keys: { summary: '', teamSummary: '', coverage: '', repos: '', trend: '', sparkline: '', alerts: null },
  };
  return {
    summary,
    data,
    url: {
      view: 'overview', own: 'teams', codebase: 'backend', team: null, repo: null, severity: 'both', baseline: 'last',
      range: 'all', kSev: 'critical',
      setView: jest.fn(), setOwn: jest.fn(), setSeverity: jest.fn(), setBaseline: jest.fn(), setRange: jest.fn(),
      setCodebase: jest.fn(), setTeam: jest.fn(), setRepo: jest.fn(), clearRepo: jest.fn(),
      selectTeamRow: jest.fn(), selectRepoRow: jest.fn(), resetFilters: jest.fn(),
      isDefault: { codebase: true, team: true, severity: true, baseline: true, repo: true, all: true },
    },
    list: {
      list: DEFAULT_ALERT_LIST,
      setStatus: jest.fn(), toggleOverdue: jest.fn(), toggleDueSoon: jest.fn(), toggleReopened: jest.fn(),
      toggleRuntimeOnly: jest.fn(), setQuery: jest.fn(), setSort: jest.fn(), setPage: jest.fn(),
    },
    openDrawer: jest.fn(),
    ...over,
  };
}
```

Then the composer (full replacement of `src/app/vulnerabilities/vulnerabilities-content.tsx`):

```tsx
// src/app/vulnerabilities/vulnerabilities-content.tsx
'use client';
import { useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { addDays } from '@/lib/vulnerabilities/time';
import { panelError } from './format';
import { keepTopDelta, scopeOpenCount, useAlertList, useSecurityUrl } from './security-state';
import { useSecurityData } from './use-security-data';
import SecurityHeader, { ConfigErrorBanner } from './security-header';
import FilterBar from './filter-bar';
import CoverageDrawer, { useCoverageDrawer } from './coverage-drawer';
import KpiTiles from './kpi-tiles';
import OwnershipCard from './ownership-card';
import TrendCard from './trend-card';
import AlertsStrip from './alerts-strip';
import RepoRail from './repo-rail';
import AlertList from './alert-list';
import type { SecurityViewProps } from './view-props';
import { ALERTS_CARD_H, PAGE_GAP, PAGE_MAX_W, PAGE_PAD, RAIL_W } from './dimensions';

// Longhands, not the `padding` shorthand: each side is then an inspectable inline style.
const PAGE_PADDING = {
  paddingTop: PAGE_PAD.top, paddingRight: PAGE_PAD.x, paddingBottom: PAGE_PAD.bottom, paddingLeft: PAGE_PAD.x,
} as const;

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto" style={{ maxWidth: PAGE_MAX_W, ...PAGE_PADDING }}>{children}</div>;
}

/**
 * The thin composer: URL state, data and the drawer's open state live in hooks; each region of the
 * page is its own module. Only the page chrome, the view switch and the full-page states are here.
 */
export default function VulnerabilitiesContent() {
  const url = useSecurityUrl();
  const alertList = useAlertList({ codebase: url.codebase, team: url.team, repo: url.repo, severity: url.severity });
  const data = useSecurityData(url, alertList.list);
  const drawer = useCoverageDrawer();
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevView = useRef(url.view);

  // Switching view: if the user has scrolled past the top of the content, scroll up just enough
  // that it starts right under the sticky bar. Never scrolls down. Keyed on `view` and skipped on
  // first mount, so Back and Forward are covered as well.
  useLayoutEffect(() => {
    if (prevView.current === url.view) return;
    prevView.current = url.view;
    const bar = barRef.current;
    const panel = panelRef.current;
    if (!bar || !panel) return;
    const delta = keepTopDelta(panel.getBoundingClientRect().top, bar.getBoundingClientRect().bottom);
    if (delta !== 0) window.scrollBy(0, delta);
  }, [url.view]);

  const { summary } = data;

  // For any summary error other than an unknown team the page fails visibly with one error line,
  // whether or not `summary` still holds data: keepPreviousData would otherwise keep rendering the
  // previous key's figures under the new label. The filters live in the URL, so a reload recovers.
  if (summary.error) {
    const info = (summary.error as { info?: { error?: string; known_teams?: string[] } } | null)?.info;
    if (info?.known_teams) {
      return (
        <Shell>
          <h1 className="text-lg font-semibold text-white">Security</h1>
          <p className="text-sm text-red-400 mt-2">{info.error}</p>
          <p className="text-xs text-gray-500 mt-1">Known teams: {info.known_teams.join(', ')}</p>
          {url.team && (
            <button className="text-xs text-accent-light mt-3 inline-block" onClick={() => url.setTeam(null)}>
              Clear team filter
            </button>
          )}
        </Shell>
      );
    }
    return <Shell><div className="text-red-400 text-sm">{panelError(summary.error, 'summary')}</div></Shell>;
  }
  if (summary.unavailable) {
    const u = summary.unavailable;
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">Security</h1>
        <p className="text-sm text-gray-400 mt-2">{u.reason}</p>
        <div className="mt-2"><ConfigErrorBanner errors={u.configErrors} /></div>
        {u.sync?.lastStatus === 'failed' && <p className="text-sm text-red-400 mt-1">The last sync failed: {u.sync.issues?.[0]?.message}</p>}
        <Link href="/reports?tab=syncs" className="text-xs text-accent-light mt-3 inline-block">Sync history →</Link>
      </Shell>
    );
  }
  const s = summary.data;
  if (!s) return <Shell><div className="text-gray-500 text-sm">Loading…</div></Shell>;

  const viewProps: SecurityViewProps = {
    summary: s,
    data,
    url,
    list: { ...alertList, list: data.effectiveList },
    openDrawer: drawer.openDrawer,
  };
  const alertsCount = data.repos.data ? scopeOpenCount(data.repos.data.rows, url.severity, data.effectiveRepo) : null;
  const baselinePrefill = s.delta[url.kSev].baseline?.takenOn ?? addDays(new Date().toISOString().slice(0, 10), -7);

  return (
    <div data-testid="security-page" className="mx-auto flex flex-col" style={{ maxWidth: PAGE_MAX_W, ...PAGE_PADDING, gap: PAGE_GAP }}>
      <SecurityHeader
        summary={s}
        repos={data.repos}
        coverage={data.coverage}
        codebase={url.codebase}
        summaryStale={summary.stale}
        openDrawer={drawer.openDrawer}
      />
      <FilterBar
        barRef={barRef}
        url={url}
        teams={s.knownTeams ?? []}
        codebaseCounts={s.codebaseCounts}
        alertsCount={alertsCount}
        baselinePrefill={baselinePrefill}
      />
      <div
        ref={panelRef}
        id="security-view-panel"
        role="tabpanel"
        aria-labelledby={`security-tab-${url.view}`}
        className="flex flex-col"
        style={{ gap: PAGE_GAP }}
      >
        {url.view === 'overview' ? (
          <>
            <KpiTiles {...viewProps} />
            <OwnershipCard {...viewProps} />
            <TrendCard {...viewProps} />
          </>
        ) : (
          <>
            <AlertsStrip {...viewProps} />
            <div
              data-testid="alerts-card"
              className="bg-gray-900 rounded-xl overflow-hidden grid"
              style={{ height: ALERTS_CARD_H, gridTemplateColumns: `${RAIL_W}px minmax(0, 1fr)` }}
            >
              <RepoRail {...viewProps} />
              <AlertList {...viewProps} />
            </div>
          </>
        )}
      </div>
      <CoverageDrawer open={drawer.open} onClose={drawer.closeDrawer} opener={drawer.opener} coverage={data.coverage} summary={s} />
    </div>
  );
}
```

Finally retire the replaced modules and tests (`git rm` stages the deletions):

```bash
git rm src/app/vulnerabilities/coverage-panel.tsx src/app/vulnerabilities/policy-panel.tsx
cd src/lib/__tests__/unit
git rm vuln-content-b1.test.tsx vuln-content-config-errors.test.tsx vuln-content-error.test.tsx \
  vuln-content-pivot-unfiltered.test.tsx vuln-content-repo-reset.test.tsx vuln-content-resolved-caption.test.tsx \
  vuln-content-scroll.test.tsx vuln-content-team-dropdown.test.tsx vuln-content-team-line.test.tsx \
  vuln-content-trend-colors.test.tsx vuln-content-trend-range.test.tsx vuln-alerts-keep-previous-data.test.tsx \
  vuln-coverage-panel.test.tsx vuln-policy-panel.test.tsx
cd -
```

The deleted tests are still on `main`. Waves 3 and 4 recreate the intents that belong to them (see the Wave 2 test rewrite map) and can read the old assertions with `git show main:src/lib/__tests__/unit/<file>`.

- [ ] **Step 4: Run the page test, then the whole suite**

Run: `npx jest src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3`
Expected: PASS.

Run: `npx tsc --noEmit && npx jest --maxWorkers=3`
Expected: `tsc` clean; the full suite PASS (the surviving old modules `team-pivot`, `trend-chart`, `alerts-table` and their tests are untouched and still pass).

Named reverts: moving a fixed height back onto the outer `ownership-card` or `trend-card` (leaving the inner body or plot without one) fails "Overview stacks the KPI row ..."; dropping `useLayoutEffect`'s `prevView` guard fails "does not scroll on first mount"; clamping `keepTopDelta` wrongly (allowing positive deltas) fails "never scrolls down"; setting `overflow-hidden` on the page container fails "the composer's own ancestors set no overflow"; moving the bar into the view panel fails "a direct child of the container".

- [ ] **Step 5: Commit**

```bash
git add -A src/app/vulnerabilities src/lib/__tests__/unit src/lib/__tests__/support
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: thin Security page composer, six view slots, old composer tests retired"
```

### Wave 2 test rewrite map

Every existing test below is under `src/lib/__tests__/unit/`. "Wave 3" and "Wave 4" mean the recreate-this-intent hand-off: Task 2.11 deletes the old file, so the intent is uncovered until that wave lands it. The old assertions stay readable with `git show main:src/lib/__tests__/unit/<file>`. The sub-cases that are easiest to lose (repos not in baseline, the unavailable-baseline caption, the null-total guard, "other ±N", the † footnote, the SLA state of every consumer, the typed-text flush) are listed in the Wave 2 public interface under "Hand-off checklist for Waves 3 and 4"; each is a test its wave must write.

| Old test file | Fate | Intent that must survive, and where it lives now |
|---|---|---|
| `vuln-content-b1.test.tsx` | Deleted in 2.11 | Header shows the org: `vuln-security-header` "shows the title with the org...". The alerts subtitle "filtered by the codebase chips and team row above" is retired with its copy (v7 has no such line). **Wave 3** `kpi-tiles`: the open-critical delta is red for a positive delta, green for a negative one and grey for zero (`deltaClass` in `format.ts`); the "Resolved" tile shows the † marker and its title "Includes N carried over from imported CSV history (archived repo with no alert data)" when `carriedResolved > 0` and no marker at 0. **Wave 4** `alert-list`: the list dims and shows "Updating…" while `data.alerts.stale` is true, and neither otherwise. |
| `vuln-content-config-errors.test.tsx` | Deleted in 2.11 | Banner absent / startup entry / sync-sourced entry "clears after the next successful sync (as of ...)": `vuln-security-header` "ConfigErrorBanner (carried over)". Banner on the unavailable page: `vuln-security-page` "the unavailable page ...". **Wave 3** `kpi-tiles`: an empty policy reads "No SLA policy yet" and an invalid policy never reads as empty, via `slaState`/`slaStateLabel` (new copy: "SLA policy can't be read"). |
| `vuln-content-error.test.tsx` | Deleted in 2.11 | Unknown-team page with the known teams and "Clear team filter"; summary error with data in hand fails the page; unknown-team page wins over the plain error; summary error with no data: `vuln-security-page` "full-page states carried over from today". A failing alerts request shows its error instead of "Loading…" forever: `vuln-use-security-data` "a plain alerts failure ..." (slot level) and **Wave 4** `alert-list` (renders `data.alerts.errorText` inside the card, controls still mounted). The search input and its typed value survive a filter change while the next fetch is pending: **Wave 4** `alert-list` (local typed value plus a debounce into `list.setQuery`). |
| `vuln-content-pivot-unfiltered.test.tsx` | Deleted in 2.11 | The team table is never scoped to the team, and with no team only one summary request is made: `vuln-use-security-data` "default scope ..." and "with a team ...". **Wave 3** `ownership-card`/`kpi-tiles`: with a team selected the KPI shows the team-scoped number (`data.summary`) while the table still lists every team (`data.teamSummary`); the table's change column follows the unfiltered response; while `data.teamSummary` is still loading (deep link with a team) the table falls back to `data.summary`; if the unfiltered request errors the table shows the error and the rest of the page still renders. |
| `vuln-content-repo-reset.test.tsx` | Deleted in 2.11 | The selected repository is now URL state. Changing team or codebase clears it in the same write and the next alerts request carries no repo and offset 0: `vuln-security-hooks` ("setCodebase ...", "setTeam ...", "a scope change resets the page in the SAME render"), `vuln-use-security-data` "a scope change resets the page ...", `vuln-security-page` "changing Codebase clears the selected repository ...". |
| `vuln-content-resolved-caption.test.tsx` | Deleted in 2.11 | **Wave 3** `kpi-tiles`: "Resolved critical since <date>" / "all time" (spec copy: "N dismissed · all time") / invalid shows "—" for value, % closed and dismissed; the `vs <date>` baseline caption on the open and new/resolved/reopened tiles; "N repos not in baseline" on its own line (caption unchanged); the unavailable-baseline caption in its new copy ("No earlier measurement yet" for a null baseline, "No measurement on or before {date}" otherwise; the old "no measurement for this view before {date}" is retired); the null-total guard (an available delta with `total: null`); the "other ±N" suffix, truncated to one line with the full text in `title`; no † when `resolved` is null; the tiles keep a fixed shape (caption slots always present as an aria-hidden non-breaking space, the figure line truncates with a `title`). The `resolvedCaption` and `deltaBaselineCaption` helpers stay in `format.ts` (`vuln-format.test.ts` is unchanged). |
| `vuln-content-scroll.test.tsx` | Deleted in 2.11 | Every control writes with `scroll:false`: `vuln-security-page` "filters write the URL without scrolling ..." (Codebase, Owning team, Severity, Compare to) plus `vuln-security-state` "every key is declared scroll:false". A team row click: `vuln-security-hooks` "selectTeamRow ..." and **Wave 3** `ownership-card` (clicking a row calls `url.selectTeamRow`). The range control: **Wave 3** `trend-card` (calls `url.setRange`). |
| `vuln-content-team-dropdown.test.tsx` | Deleted in 2.11 | Choosing a team puts `team=` into the summary, coverage, repos and alerts requests: `vuln-security-page` "choosing a team puts team=<name> into ...". "All owning teams" clears the filter: `vuln-filter-bar` "Codebase, Owning team and Severity" (value `''` gives `null`). The select shows the URL's team: `vuln-security-page` "the Owning team select shows the team already in the URL". |
| `vuln-content-team-line.test.tsx` | Deleted in 2.11 (the line no longer exists in v7) | Selecting or clearing a team never shifts the layout, and a long name truncates with its title: `vuln-filter-bar` "the bar keeps the same height ..." and "every select has a fixed inline width ..."; `vuln-security-page` "the bar keeps its height when a team is chosen". Clearing: `vuln-filter-bar` "Reset filters". |
| `vuln-content-trend-colors.test.tsx` | Deleted in 2.11 | **Wave 3** `trend-card`: colours are computed from the UNFILTERED series (`assignTeamColors(data.trend.data.series)`) and passed with the team-filtered series, so a team keeps its colour when the filter narrows the chart. |
| `vuln-content-trend-range.test.tsx` | Deleted in 2.11; `trendSince` and `TrendRange` moved from `vulnerabilities-content.tsx` to `security-state.ts` | `trendSince` arithmetic: `vuln-security-state` "trendSince and sparklineSince". Default sends no `since`; a range sends `since` and sets `range` in the URL: `vuln-use-security-data` ("range=all ...", "the sparkline is fixed at 90 days ...") and **Wave 3** `trend-card` (the range select calls `url.setRange`). |
| `vuln-alerts-keep-previous-data.test.tsx` | Deleted in 2.11 | **Wave 4** `alert-list`: the search input stays mounted and focused across a filter-driven refetch (the key keeps `keepPreviousData` in `use-security-data`; the list must not unmount its input while `data.alerts.stale` is true or `data.alerts.loading` is true). |
| `vuln-coverage-panel.test.tsx` | Deleted in 2.11 with `coverage-panel.tsx` | A `dependabot-off` row reads "Dependabot off" and an `error` row shows its detail: `vuln-coverage-drawer` "a dependabot-off row reads ...". The old list title "Unmeasured (Dependabot status error or off)" is retired; the drawer's group is "Unmeasured · N". |
| `vuln-policy-panel.test.tsx` | Deleted in 2.11 with `policy-panel.tsx` | Resolved caption (date / all time / "since —"), scope caption, empty vs invalid policy, an invalid policy never shows "No SLA policy yet": `vuln-coverage-drawer` "policy (From deployment configuration)". Copy changes: invalid text is now "SLA policy can't be read" (was "SLA policy configuration is invalid — see the error above"); the "high · SLA not yet active" line is replaced by one SLA line per severity. |
| `vuln-owning-team-label.test.tsx` | Kept; not broken by Wave 2 | Its `TeamPivot` half is **Wave 3**'s to move when `team-pivot.tsx` is replaced; its `AlertsTable` half is retired with `alerts-table.tsx` in **Wave 4**. The dropdown's "Owning team" label and "All owning teams" option are now covered by `vuln-filter-bar`. |
| `url-state-hook.test.ts`, `url-state-serialize.test.ts` | Unchanged | `url-state.ts` needs no change (spec section 5); they run in the exit check. |
| `data-freshness.test.tsx` | Unchanged | Guards that `PageHeader` and `DataFreshness` are untouched. |
| `vuln-series-contrast.test.ts`, `vuln-trend-colors-css.test.ts`, `chart-tokens-css.test.ts` | Unchanged | The `--vuln-series-*` and `--chart-*` tokens are not touched. **Wave 3** swaps `trend-chart.tsx` for `trend-card.tsx` and `sparkline.tsx` in `chart-tokens-css.test.ts`'s `REFERENCING_FILES` and in `chart-no-literal-colors.test.ts`'s `EXTRA` list and exact-list assertion. |
| `vuln-team-pivot.test.tsx`, `vuln-trend-chart.test.tsx`, `vuln-alerts-table.test.tsx` | Unchanged in Wave 2 | Their modules stay until Waves 3 and 4 replace them. **Wave 3** carries the `carried-resolved marker and footnote` describe of `vuln-team-pivot.test.tsx` (the † marker and footnote, the ownership card's job) and the overdue-column-per-SLA-state cases to `ownership-card`. **Wave 4** carries the `time chips disabled with a hint while no SLA is active` describe of `vuln-alerts-table.test.tsx` (the toggles' disabled-with-hint behaviour, now from `slaState`) and the mutual-exclusion case to `alert-list`. |

New test files this wave adds: `vuln-security-tokens-css`, `vuln-warn-contrast`, `vuln-security-dimensions`, `vuln-sla-state`, `vuln-security-state`, `vuln-security-support`, `vuln-security-hooks`, `vuln-use-security-data`, `vuln-filter-bar`, `vuln-coverage-drawer`, `vuln-security-header`, `vuln-security-page`, `vuln-security-view-props`.

### Wave 2 exit check

All commands run in the repository root.

1. The wave's own tests:
   `npx jest src/lib/__tests__/unit/vuln-security-tokens-css.test.ts src/lib/__tests__/unit/vuln-warn-contrast.test.ts src/lib/__tests__/unit/vuln-security-dimensions.test.ts src/lib/__tests__/unit/vuln-sla-state.test.ts src/lib/__tests__/unit/vuln-security-state.test.ts src/lib/__tests__/unit/vuln-security-support.test.tsx src/lib/__tests__/unit/vuln-security-hooks.test.tsx src/lib/__tests__/unit/vuln-use-security-data.test.tsx src/lib/__tests__/unit/vuln-filter-bar.test.tsx src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx src/lib/__tests__/unit/vuln-security-header.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3`
2. The unchanged guards this wave could disturb:
   `npx jest src/lib/__tests__/unit/url-state-hook.test.ts src/lib/__tests__/unit/url-state-serialize.test.ts src/lib/__tests__/unit/data-freshness.test.tsx src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/vuln-trend-colors-css.test.ts src/lib/__tests__/unit/vuln-series-contrast.test.ts src/lib/__tests__/unit/logger-enforcement.test.ts --maxWorkers=3`
3. Types and the full suite: `npx tsc --noEmit` then `npx jest --maxWorkers=3` (all suites pass; CI uses 3 workers).
4. Production build, from a clean cache: `rm -rf .next && npm run build` (the new files must not break `page.tsx`'s default-only export rule; `page.tsx` itself is unchanged).
5. The internal-name guard on the whole wave: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff origin/main...HEAD | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1` succeeds (grep finds nothing). `INTERNAL_NAMES` is the maintainers' private pattern of company, host and people names and real policy values; it lives in the implementer's environment and is never written in this plan or in the repository. New files use only `acme/...`, Payments, Search and Platform.
6. Headless-Chrome shell measurement (the harness lives outside the repository, as today). At 1024px and 1440px, in the default dark theme and one light theme, against `npm run dev:mock`, check on `/vulnerabilities` and `/vulnerabilities?view=alerts`:
   - the sticky bar is 84px tall in every state: filters at defaults, every filter non-default, the date input shown and hidden, "Reset filters" shown and hidden; its top is 0 after scrolling and it paints above the scrolling content;
   - no horizontal scroll: `document.documentElement.scrollWidth <= window.innerWidth`;
   - no ancestor of the sticky bar, up to `html` and including the app shell and `main`, computes an `overflow` other than `visible` (jsdom cannot see those ancestors, so the page test only covers the composer's own);
   - the header card's height does not change when the unmeasured badge disappears (switch Codebase to one with no unmeasured repositories) because the coverage line holds 22px, and the coverage line's items (badge slot, Excluded, Needs tagging, the link) keep the same x position through every filter change;
   - no layout shift while changing Codebase, Owning team, Severity and Compare to (the layout-shift API reports 0 for the bar and the header);
   - the drawer is 460px wide (at most 92vw), covers the sticky bar, and Esc returns focus to the element that opened it;
   - a view switch while scrolled past the content top moves the scroll position up only, and not at all when the content is already below the bar.
7. Documentation: this wave edits no documentation file. `docs/vulnerabilities-page.md` and the root `CLAUDE.md` are updated in Wave 5, once the whole page exists.

## Wave 3: Overview view

**Goal.** Fill the three Overview slots that Wave 2 reserved: the KPI row (`kpi-tiles.tsx`, with the new `sparkline.tsx`), the ownership card (`ownership-card.tsx`, with its Owning teams and Repositories tabs) and the trend card (`trend-card.tsx`). Each slot keeps the height Wave 2 gave it (`KPI_ROW_H`, `OWNERSHIP_BODY_H`, `TREND_PLOT_H`) in every state. The wave ends by deleting `team-pivot.tsx`, `trend-chart.tsx` and their tests and by pointing the two chart guard tests at the new chart modules. After this wave the Overview is complete; the Alerts view is still Wave 4's.

**What this wave consumes (all from Wave 2, unchanged).** `SecurityViewProps` (`summary`, `data`, `url`, `list`, `openDrawer`), `Slot<T>`, the `dimensions.ts` constants (`KPI_ROW_H`, `OWNERSHIP_BODY_H`, `TEAM_ROW_H`, `TREND_PLOT_H`, `SPARK_H`, `Z`, `TYPE`), `sla-state.ts` (`slaState`, `slaStateLabel`, `slaActive`, `anySlaActive`), `security-state.ts` (`SPARKLINE_DAYS`, `TrendRange`, `SeverityFilter`, `OwnTab`), `format.ts` (`dash`, `signed`, `deltaBaselineCaption`, `resolvedCaption`), `team-colors.ts` (`assignTeamColors`, `OTHER_TEAM_COLOR`), the styling utilities from Task 2.1 (`vuln-hatch`, `text-warn`, `bg-warn-bg`, `border-warn-line`, `bg-crit-tint`, `bg-high-tint`) and the test support (`viewProps`, `slot`, `summaryFixture`, `reposFixture`, `trendFixture`, `repoRow`, `cell`, `REPO_ROWS`). It reads `data.summary` (via `props.summary`), `data.teamSummary`, `data.repos`, `data.trend` and `data.sparkline`, and calls `url.selectTeamRow`, `url.selectRepoRow`, `url.setOwn`, `url.setRange` and `openDrawer(element)`. It never writes the URL itself and never toggles a team: `selectTeamRow` does that.

**Files this wave creates.** Besides the three stubs it modifies, the wave creates `sparkline.tsx` (named in the spec) and four page-local helper modules that keep the rules testable without a DOM: `overview-format.ts` (change sentences and the † wording), `ownership-model.ts` (hidden severity, sorting, repository rows and totals), `trend-model.ts` (axis domain, rows, history messages, legend) and the two table components `team-table.tsx` and `repo-table.tsx` that `ownership-card.tsx` composes. Shared test fixtures are only appended to `security-fixtures.ts`, and every new name starts with `ov` (Wave 4 appends `al` names).

**Decisions this wave makes where the spec is silent** (each is tested; change one by changing its test):

1. **Dates.** Sentences and titles use the month and day ("▲ 2 more than on Sep 29", "Critical since Sep 29"), the same formatter as the chart axis. Column header captions keep the ISO form ("vs 2026-09-29"), which `deltaBaselineCaption` already produces and Wave 2 left unchanged.
2. **"No measurement on or before {date}"** names the baseline set's own date (`delta.baseline.takenOn`). A null baseline names no date ("No earlier measurement yet"). This follows the Wave 2 hand-off checklist.
3. **Both tables sort.** The spec says the Total row and unmeasured rows ignore sorting, which only makes sense if the team table sorts too. Names start ascending and every number column starts with its largest value first (the v7 prototype's behaviour). The spec's "Age starts descending, everything else ascending" rule describes the alert list's keys.
4. **Default order.** With no active header both tables keep the server order (critical open, then high open, then name). Under "High only" they order by high open instead, so a hidden column never decides the order. A sort on a hidden severity's column is ignored and its header button is disabled.
5. **Repositories footer** follows the page-wide rule that every total that counts alerts includes the stored counts of unmeasured repositories. Its Open and Overdue columns sum every row in view, so the footer equals the team table, the Alerts strip, the rail and the Alerts tab. Only an unmeasured row's own cells read unknown. The footer's repository count, Oldest open and Next due stay measured-only (they are not part of the sum invariant, and a stored age or date may be out of date). The footer's second line reads "N unmeasured: totals include stored counts".
6. **"N open now"** is the scoped summary's open count (the same figure as the KPI tile). The change sentence under it is the tile's. Each legend entry's "N open" is the team's latest point inside the chosen range.
7. **Hover fade is dropped.** v7 specifies dimming by selected team only. The old hover fade, and its "stale hover" guard, go away with `trend-chart.tsx`.
8. **The ownership card's tabs are a pressed-button group** (`aria-pressed`), not `role="tab"`. The composer's view tabs and its `tabpanel` are the page's only tab semantics, and a second `tabpanel` would make the page's `getByRole('tabpanel')` ambiguous.
9. **The Open tile carries no "vs {date}" caption.** Its change sentence already names the date. The since-baseline tile keeps the caption, as the Wave 2 checklist asks.
10. **The "History starts {date} (first sync)" note** shows only under the All range, the only range that can say where history starts.
11. **Unmeasured reason copy** is "DEPENDABOT OFF" for `dependabot-off` and "STATUS CHECK FAILED" for `error`.
12. **Sort glyph.** ↕ is written with the text variation selector (U+FE0E); without it macOS draws an emoji box.

### Task 3.1: Change sentences and tones (`overview-format.ts`)

**Files:**
- Create: `src/app/vulnerabilities/overview-format.ts`
- Modify: `src/lib/__tests__/support/security-fixtures.ts` (append `ovBaseline`, `ovDeltaTeam`, `ovDelta`, `ovNoBaseline`)
- Test: `src/lib/__tests__/unit/vuln-overview-format.test.ts`

**Interfaces:**
- Consumes: `DeltaResult`, `DeltaTeam`, `SnapshotSet` types from `@/lib/vulnerabilities/aggregate`; `formatWeek` from `@/components/charts/chart-format`.
- Produces: `shortDate(iso): string` ("Sep 29"); `changeSentence(delta, baselineDate): string`; `changeToneClass(delta, sev): string`; `baselineUnavailableText(d): string`; `usableTotal(d): DeltaTeam | null`; `openChange(d, sev): { text; toneClass; hasChange; delta }`. Fixtures: `ovBaseline(takenOn?)`, `ovDeltaTeam(team, deltaOpen, over?)`, `ovDelta(total, over?)`, `ovNoBaseline()`.

- [ ] **Step 1: Write the failing test**

Append this block to the end of `src/lib/__tests__/support/security-fixtures.ts` (do not edit anything above it; the file's existing `import type` line already brings in `DeltaResult`, so this block imports only the two names it adds):

```ts
// ── Wave 3 (Overview) fixtures: every name starts with `ov` ───────────────────────────────────────
import type { DeltaTeam, SnapshotSet } from '@/lib/vulnerabilities/aggregate';

/** A stored measurement taken on `takenOn` (a sync). */
export const ovBaseline = (takenOn = '2026-09-15'): SnapshotSet => ({
  source: 'sync', key: `sync:${takenOn}`, takenOn, measuredAt: `${takenOn}T06:00:00Z`,
});

export const ovDeltaTeam = (team: string, deltaOpen: number, over: Partial<DeltaTeam> = {}): DeltaTeam => ({
  team, deltaOpen, new: 0, resolved: 0, dismissed: 0, reopened: 0, other: 0, ...over,
});

/** An available delta with the given total (or, with null, one that has a baseline but no total). */
export const ovDelta = (total: DeltaTeam | null, over: Partial<DeltaResult> = {}): DeltaResult => ({
  available: total !== null, baseline: ovBaseline(), reposNotInBaseline: 0, teams: [], total, ...over,
});

/** A delta with no baseline at all (nothing is old enough to compare against). */
export const ovNoBaseline = (): DeltaResult => ({ available: false, baseline: null, reposNotInBaseline: 0, teams: [], total: null });
```

Create `src/lib/__tests__/unit/vuln-overview-format.test.ts`:

```ts
// src/lib/__tests__/unit/vuln-overview-format.test.ts
// The Overview's change sentences: one wording and one tone for the Open tile and the trend header.
import { baselineUnavailableText, changeSentence, changeToneClass, openChange, shortDate, usableTotal } from '@/app/vulnerabilities/overview-format';
import { ovBaseline, ovDelta, ovDeltaTeam, ovNoBaseline } from '../support/security-fixtures';

describe('changeSentence', () => {
  // Revert: swap the two arrows, or print the signed number ("▲ -3").
  it('reads "▲ N more than on <date>", "▼ N fewer than on <date>" or "Same as on <date>"', () => {
    expect(changeSentence(2, '2026-09-29')).toBe('▲ 2 more than on Sep 29');
    expect(changeSentence(-1, '2026-09-29')).toBe('▼ 1 fewer than on Sep 29');
    expect(changeSentence(0, '2026-09-29')).toBe('Same as on Sep 29');
  });

  it('writes the date as month and day in UTC, never shifted by the local zone', () => {
    expect(shortDate('2026-01-01')).toBe('Jan 1');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
  });
});

describe('changeToneClass', () => {
  // Revert: use one colour for both severities, or colour a decrease red.
  it('more alerts is red for critical and orange for high; fewer is green; no change is grey', () => {
    expect(changeToneClass(5, 'critical')).toBe('text-red-400');
    expect(changeToneClass(5, 'high')).toBe('text-orange-400');
    expect(changeToneClass(-3, 'critical')).toBe('text-green-400');
    expect(changeToneClass(-3, 'high')).toBe('text-green-400');
    expect(changeToneClass(0, 'critical')).toBe('text-gray-500');
  });
});

describe('baselineUnavailableText', () => {
  // Revert: always name a date, or never name one.
  it('a null baseline names no date; a known baseline that does not measure this view names its date', () => {
    expect(baselineUnavailableText(ovNoBaseline())).toBe('No earlier measurement yet');
    expect(baselineUnavailableText(undefined)).toBe('No earlier measurement yet');
    expect(baselineUnavailableText(ovDelta(null, { baseline: ovBaseline('2026-09-29') }))).toBe('No measurement on or before Sep 29');
  });
});

describe('usableTotal and openChange', () => {
  // Revert: trust `available` alone and dereference the total.
  it('an available delta whose total is null is not usable and never throws', () => {
    const d = ovDelta(null, { available: true });
    expect(usableTotal(d)).toBeNull();
    const c = openChange(d, 'critical');
    expect(c.hasChange).toBe(false);
    expect(c.delta).toBeNull();
    expect(c.text).toBe('No measurement on or before Sep 15');
    expect(c.text).not.toMatch(/NaN|undefined|null/);
  });

  it('an unavailable delta is not usable even if it carries a stale total', () => {
    expect(usableTotal(ovDelta(ovDeltaTeam('Total', 4), { available: false }))).toBeNull();
  });

  it('a usable delta gives the sentence, its tone and the number', () => {
    const c = openChange(ovDelta(ovDeltaTeam('Total', 2), { baseline: ovBaseline('2026-09-29') }), 'critical');
    expect(c).toEqual({ text: '▲ 2 more than on Sep 29', toneClass: 'text-red-400', hasChange: true, delta: 2 });
  });

  it('no delta at all reads as no earlier measurement', () => {
    expect(openChange(undefined, 'high')).toEqual({ text: 'No earlier measurement yet', toneClass: 'text-gray-500', hasChange: false, delta: null });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-overview-format.test.ts --maxWorkers=3`
Expected: FAIL, `Test suite failed to run`, `Cannot find module '@/app/vulnerabilities/overview-format'`.

- [ ] **Step 3: Implement**

Create `src/app/vulnerabilities/overview-format.ts`:

```ts
// src/app/vulnerabilities/overview-format.ts
// GLOOK-64: the wording and tone of the Overview's "change since the baseline" sentences, in one
// place so the Open tile and the trend header cannot disagree. Pure: no React, no server imports.
import type { DeltaResult, DeltaTeam } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import { formatWeek } from '@/components/charts/chart-format';

/** "Sep 29": month and day, UTC. Same formatter as the chart axes. */
export const shortDate = (iso: string): string => formatWeek(iso);

/** "▲ 2 more than on Sep 29", "▼ 1 fewer than on Sep 29" or "Same as on Sep 29". */
export function changeSentence(delta: number, baselineDate: string): string {
  const on = shortDate(baselineDate);
  if (delta > 0) return `▲ ${delta} more than on ${on}`;
  if (delta < 0) return `▼ ${-delta} fewer than on ${on}`;
  return `Same as on ${on}`;
}

/**
 * More open alerts is bad: red for critical, orange for high (the severity's own colour). Fewer is
 * green, no change is grey. The arrow in the sentence is the non-colour cue.
 */
export function changeToneClass(delta: number, sev: Severity): string {
  if (delta > 0) return sev === 'high' ? 'text-orange-400' : 'text-red-400';
  if (delta < 0) return 'text-green-400';
  return 'text-gray-500';
}

/**
 * Why there is no change to show. A null baseline means no stored measurement is old enough, so the
 * sentence names no date. A known baseline whose set does not measure this severity (an imported CSV
 * run never measures high) names that date.
 */
export function baselineUnavailableText(d: DeltaResult | null | undefined): string {
  return d?.baseline ? `No measurement on or before ${shortDate(d.baseline.takenOn)}` : 'No earlier measurement yet';
}

/** The delta's total, only when it can be trusted: available, with a baseline and a total. */
export function usableTotal(d: DeltaResult | null | undefined): DeltaTeam | null {
  return d && d.available && d.baseline && d.total ? d.total : null;
}

export interface OpenChange {
  /** The sentence to show under the open count. */
  text: string;
  /** A Tailwind text colour class. */
  toneClass: string;
  /** True when `text` is a change sentence, false when it explains why there is none. */
  hasChange: boolean;
  /** The change itself, when there is one. */
  delta: number | null;
}

export function openChange(d: DeltaResult | null | undefined, sev: Severity): OpenChange {
  const total = usableTotal(d);
  if (total && d?.baseline) {
    return { text: changeSentence(total.deltaOpen, d.baseline.takenOn), toneClass: changeToneClass(total.deltaOpen, sev), hasChange: true, delta: total.deltaOpen };
  }
  return { text: baselineUnavailableText(d), toneClass: 'text-gray-500', hasChange: false, delta: null };
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-overview-format.test.ts --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (8 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/overview-format.ts src/lib/__tests__/support/security-fixtures.ts src/lib/__tests__/unit/vuln-overview-format.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Overview change sentences and tones"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.2: Sparkline (`sparkline.tsx`)

**Files:**
- Create: `src/app/vulnerabilities/sparkline.tsx`
- Test: `src/lib/__tests__/unit/vuln-sparkline.test.tsx`

**Interfaces:**
- Consumes: `TrendSeries` from `@/lib/vulnerabilities/aggregate`; `diffDays` from `@/lib/vulnerabilities/time`; `toNum` from `@/components/charts/chart-format`; `SPARK_H`; `shortDate` (Task 3.1); `SPARKLINE_DAYS` from `security-state.ts`.
- Produces: `SparkPoint`; `sparkPoints(series, team | null): SparkPoint[]`; `sparkLine(points, today): string` (SVG `points`); `SPARK_FULL_DAYS` (`SPARKLINE_DAYS - 6`); `sparkModel(points, sev, today)`; default export `Sparkline({ points | undefined, sev, today, errorText? })`, which renders `data-testid` `sparkline`, `sparkline-slot` (inline height `SPARK_H`) and `sparkline-caption` (a fixed `h-4` line).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-sparkline.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-sparkline.test.tsx
// The KPI sparkline: stored measurements only, summed per date, with three history states.
import { render, screen } from '@testing-library/react';
import Sparkline, { sparkLine, sparkModel, sparkPoints, SPARK_FULL_DAYS } from '@/app/vulnerabilities/sparkline';
import { SPARK_H } from '@/app/vulnerabilities/dimensions';
import { SPARKLINE_DAYS } from '@/app/vulnerabilities/security-state';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

const TODAY = '2026-09-30';
const series: TrendSeries[] = [
  { team: 'Payments', points: [{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }] },
  { team: 'Search', points: [{ date: '2026-09-22', open: 1 }, { date: '2026-09-29', open: 1 }] },
];

describe('sparkPoints', () => {
  // Revert: take only the first series, or average instead of summing.
  it('sums every team per stored measurement date, oldest first', () => {
    expect(sparkPoints(series, null)).toEqual([{ date: '2026-09-22', open: 3 }, { date: '2026-09-29', open: 4 }]);
  });

  // Revert: ignore the team argument.
  it('with a team it sums only that team, so the line matches the team-scoped count beside it', () => {
    expect(sparkPoints(series, 'Payments')).toEqual([{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }]);
    expect(sparkPoints(series, 'Nobody')).toEqual([]);
  });

  it('coerces a string count from the database and merges teams that share a date', () => {
    const odd = [{ team: 'A', points: [{ date: '2026-09-29', open: '2' as unknown as number }] }, { team: 'B', points: [{ date: '2026-09-29', open: 5 }] }];
    expect(sparkPoints(odd, null)).toEqual([{ date: '2026-09-29', open: 7 }]);
  });
});

describe('sparkLine', () => {
  // Revert: space the points evenly instead of by date.
  it('places points by their date: a point a quarter of the way in time is a quarter of the way across', () => {
    const pts = [{ date: '2026-09-02', open: 0 }, { date: '2026-09-09', open: 4 }, { date: '2026-09-30', open: 8 }];
    const xs = sparkLine(pts, TODAY).split(' ').map(p => Number(p.split(',')[0]));
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeCloseTo(25, 1);
    expect(xs[2]).toBe(100);
  });

  it('keeps the line inside the 24px slot and puts a higher count higher up', () => {
    const ys = sparkLine([{ date: '2026-09-01', open: 1 }, { date: '2026-09-10', open: 9 }], TODAY).split(' ').map(p => Number(p.split(',')[1]));
    expect(ys[1]).toBeLessThan(ys[0]);
    for (const y of ys) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(SPARK_H); }
  });

  it('a flat series is a line across the middle, never NaN', () => {
    const out = sparkLine([{ date: '2026-09-01', open: 4 }, { date: '2026-09-10', open: 4 }], TODAY);
    expect(out).not.toMatch(/NaN/);
    expect(out.split(' ').map(p => Number(p.split(',')[1]))).toEqual([SPARK_H / 2, SPARK_H / 2]);
  });
});

describe('sparkModel (0, 1 and 2+ measurements)', () => {
  // Revert: swap the messages, or draw a line for one point.
  it('0 measurements: "Not enough history yet" in the slot and "No measurements yet" as the caption', () => {
    expect(sparkModel([], 'critical', TODAY)).toEqual({ kind: 'none', message: 'Not enough history yet', caption: 'No measurements yet' });
  });

  it('1 measurement: "Not enough history yet" and "1 measurement so far (<date>)"', () => {
    expect(sparkModel([{ date: '2026-09-30', open: 3 }], 'critical', TODAY))
      .toEqual({ kind: 'one', message: 'Not enough history yet', caption: '1 measurement so far (Sep 30)' });
  });

  it('2+ measurements under 90 days of history: "Open <sev> · N measurements since <date>"', () => {
    const m = sparkModel([{ date: '2026-09-22', open: 3 }, { date: '2026-09-29', open: 4 }], 'high', TODAY);
    expect(m.kind).toBe('line');
    expect(m.caption).toBe('Open high · 2 measurements since Sep 22');
  });

  // Revert: compare with the wrong threshold (e.g. > instead of >=) or drop the branch.
  it(`history reaching back ${SPARK_FULL_DAYS} days or more reads "Open <sev> · last ${SPARKLINE_DAYS} days"`, () => {
    const edge = [{ date: '2026-07-08', open: 3 }, { date: '2026-09-29', open: 4 }]; // exactly 84 days before TODAY
    expect(sparkModel(edge, 'critical', TODAY).caption).toBe(`Open critical · last ${SPARKLINE_DAYS} days`);
    const short = [{ date: '2026-07-09', open: 3 }, { date: '2026-09-29', open: 4 }]; // 83 days
    expect(sparkModel(short, 'critical', TODAY).caption).toBe('Open critical · 2 measurements since Jul 9');
  });

  // Revert: hard-code 84 or "90 days" instead of deriving both from SPARKLINE_DAYS (the request window).
  it('the window is the one the sparkline request asks for', () => {
    expect(SPARKLINE_DAYS).toBe(90);
    expect(SPARK_FULL_DAYS).toBe(SPARKLINE_DAYS - 6);
  });
});

describe('Sparkline component', () => {
  // Revert: drop the inline height from the slot in any state.
  it('keeps the 24px slot and a caption line in every state: loading, error, 0, 1 and 2+ measurements', () => {
    const states: Array<{ points: Array<{ date: string; open: number }> | undefined; errorText?: string }> = [
      { points: undefined },
      { points: undefined, errorText: "Couldn't load trend: HTTP 500" },
      { points: [] },
      { points: [{ date: '2026-09-29', open: 2 }] },
      { points: [{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }] },
    ];
    for (const s of states) {
      const { unmount } = render(<Sparkline points={s.points} sev="critical" today={TODAY} errorText={s.errorText} />);
      expect(screen.getByTestId('sparkline-slot').style.height).toBe(`${SPARK_H}px`);
      expect(screen.getByTestId('sparkline-caption').className).toContain('h-4');
      unmount();
    }
  });

  it('draws one polyline for 2+ measurements and none for fewer', () => {
    const { container, rerender } = render(<Sparkline points={[{ date: '2026-09-22', open: 2 }, { date: '2026-09-29', open: 3 }]} sev="critical" today={TODAY} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    rerender(<Sparkline points={[{ date: '2026-09-29', open: 2 }]} sev="critical" today={TODAY} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
    expect(screen.getByText('Not enough history yet')).toBeTruthy();
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('1 measurement so far (Sep 29)');
  });

  it('while loading the caption is an aria-hidden non-breaking space; after an error it shows the message in red', () => {
    const { rerender } = render(<Sparkline points={undefined} sev="critical" today={TODAY} />);
    const cap = screen.getByTestId('sparkline-caption');
    expect(cap.textContent).toBe('\u00a0');
    expect(cap.getAttribute('aria-hidden')).toBe('true');
    rerender(<Sparkline points={undefined} sev="critical" today={TODAY} errorText="Couldn't load trend: HTTP 500" />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe("Couldn't load trend: HTTP 500");
    expect(screen.getByTestId('sparkline-caption').className).toContain('text-red-400');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-sparkline.test.tsx --maxWorkers=3`
Expected: FAIL, `Cannot find module '@/app/vulnerabilities/sparkline'`.

- [ ] **Step 3: Implement**

The sparkline sums the unscoped `data.sparkline` series (the key Wave 2 builds with `sparklineSince`), so a selected team costs no extra request. Create `src/app/vulnerabilities/sparkline.tsx`:

```tsx
// src/app/vulnerabilities/sparkline.tsx
'use client';
// GLOOK-64: the 24px sparkline under the Open tile's count. It draws only STORED measurements (one
// point per sync or imported run), never a series rebuilt from alert timestamps, and it is summed
// from the unscoped trend response so a selected team costs no extra request.
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import { diffDays } from '@/lib/vulnerabilities/time';
import { toNum } from '@/components/charts/chart-format';
import { SPARK_H } from './dimensions';
import { shortDate } from './overview-format';
import { SPARKLINE_DAYS } from './security-state';

export interface SparkPoint { date: string; open: number }

/**
 * One point per stored measurement date: the open counts of every team on that date, summed. With a
 * team, only that team's series is summed, so the line matches the (team-scoped) count beside it.
 */
export function sparkPoints(series: readonly TrendSeries[], team: string | null): SparkPoint[] {
  const byDate = new Map<string, number>();
  for (const s of series) {
    if (team !== null && s.team !== team) continue;
    for (const p of s.points) byDate.set(p.date, (byDate.get(p.date) ?? 0) + toNum(p.open));
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, open]) => ({ date, open }));
}

/**
 * The request starts SPARKLINE_DAYS back, so a line whose first point is within 6 days of that start
 * "covers the window" and reads "last 90 days"; a younger one says how many measurements it has.
 */
export const SPARK_FULL_DAYS = SPARKLINE_DAYS - 6;
const WIDTH = 100;
const PAD = 2;

/** SVG `points` for a polyline in a 100 x SPARK_H box: x by date (first point to today), y by open count. */
export function sparkLine(points: readonly SparkPoint[], today: string): string {
  if (points.length === 0) return '';
  const first = points[0].date;
  const last = points[points.length - 1].date;
  const span = Math.max(1, diffDays(last > today ? last : today, first));
  const values = points.map(p => p.open);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) => (max === min ? SPARK_H / 2 : SPARK_H - PAD - ((v - min) / (max - min)) * (SPARK_H - 2 * PAD));
  return points.map(p => `${((diffDays(p.date, first) / span) * WIDTH).toFixed(2)},${y(p.open).toFixed(2)}`).join(' ');
}

export type SparkModel =
  | { kind: 'none'; message: string; caption: string }
  | { kind: 'one'; message: string; caption: string }
  | { kind: 'line'; line: string; caption: string };

export function sparkModel(points: readonly SparkPoint[], sev: Severity, today: string): SparkModel {
  if (points.length === 0) return { kind: 'none', message: 'Not enough history yet', caption: 'No measurements yet' };
  if (points.length === 1) {
    return { kind: 'one', message: 'Not enough history yet', caption: `1 measurement so far (${shortDate(points[0].date)})` };
  }
  const first = points[0].date;
  const caption = diffDays(today, first) >= SPARK_FULL_DAYS
    ? `Open ${sev} · last ${SPARKLINE_DAYS} days`
    : `Open ${sev} · ${points.length} measurements since ${shortDate(first)}`;
  return { kind: 'line', line: sparkLine(points, today), caption };
}

export interface SparklineProps {
  /** Undefined while loading or after an error. */
  points: readonly SparkPoint[] | undefined;
  sev: Severity;
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** panelError text when the request failed. */
  errorText?: string | null;
}

/** The 24px slot and its caption line. Both keep their height in every state. */
export default function Sparkline({ points, sev, today, errorText = null }: SparklineProps) {
  const model = points ? sparkModel(points, sev, today) : null;
  const caption = errorText ?? model?.caption ?? null;
  return (
    <div data-testid="sparkline">
      <div data-testid="sparkline-slot" className="relative text-gray-400" style={{ height: SPARK_H }}>
        {model?.kind === 'line' && (
          <svg
            viewBox={`0 0 100 ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={model.caption}
            className="absolute inset-0 w-full overflow-visible" style={{ height: SPARK_H }}
          >
            <polyline
              points={model.line} fill="none" stroke="currentColor" strokeWidth={1.5}
              vectorEffect="non-scaling-stroke" strokeLinejoin="round"
            />
          </svg>
        )}
        {(model?.kind === 'none' || model?.kind === 'one') && (
          <span className="absolute inset-0 flex items-center text-[11px] text-gray-500">{model.message}</span>
        )}
        {errorText && <span className="absolute inset-0 flex items-center text-[11px] text-gray-500">Trend unavailable</span>}
      </div>
      <div
        data-testid="sparkline-caption" aria-hidden={caption ? undefined : true}
        className={`h-4 truncate text-[11px] leading-4 ${errorText ? 'text-red-400' : 'text-gray-500'}`} title={caption ?? undefined}
      >
        {caption ?? '\u00a0'}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-sparkline.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (14 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/sparkline.tsx src/lib/__tests__/unit/vuln-sparkline.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: KPI sparkline from stored measurements"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.3: KPI row and the Open tile (`kpi-tiles.tsx`)

**Files:**
- Modify: `src/app/vulnerabilities/kpi-tiles.tsx` (replace the Wave 2 stub)
- Modify: `src/lib/__tests__/support/security-fixtures.ts` (append `ovCell`, `ovTeam`, `ovSeries`, `ovProps`)
- Test: `src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx`

**Interfaces:**
- Consumes: `SecurityViewProps`; `KPI_ROW_H`, `TYPE`; `dash` from `format.ts`; `openChange` (3.1); `Sparkline`, `sparkPoints` (3.2).
- Produces: default export `KpiTiles(props: SecurityViewProps)`: a `section` with `data-testid="kpi-tiles"`, inline height `KPI_ROW_H` in every branch and `opacity-60` while `data.summary.stale`; the Open tile `data-testid="kpi-open"` with the change line `kpi-open-change`. Tasks 3.4 to 3.6 add the other three tiles to the same grid. Fixtures: `ovCell(open, over?)`, `ovTeam(team, critical, high, unmeasuredRepos?)`, `ovSeries(team, [[date, open], ...])`, `ovProps({ summary?, teamSummary?, repos?, url?, data? })` (a complete `SecurityViewProps` whose `data.summary`, `data.teamSummary` and `props.summary` agree).

- [ ] **Step 1: Write the failing test**

Append this block to the end of `src/lib/__tests__/support/security-fixtures.ts`:

```ts
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

/** A severity cell for a team or total row. Only `open` is required; the rest default to zero or null. */
export const ovCell = (open: number, over: Partial<SevCell> = {}): SevCell => ({
  open, resolved: 0, dismissed: 0, pctClosed: null, overdue: null, dueSoon: null, carriedResolved: 0, ...over,
});

/** A team (or Total) row built from two cells. */
export const ovTeam = (team: string, critical: SevCell, high: SevCell, unmeasuredRepos = 0): TeamRow => ({
  team, critical, high, unmeasuredRepos,
});

/** One team's trend series from [date, open] pairs. */
export const ovSeries = (team: string, points: Array<[string, number]>): TrendSeries => ({
  team, points: points.map(([date, open]) => ({ date, open })),
});

/**
 * SecurityViewProps for the Overview slots. `summary` overrides the scoped summary (and the team
 * table's, unless `teamSummary` is given), `url` overrides URL values, `repos` replaces the repository
 * rows, `data` replaces any slot (for example a loading `sparkline`).
 */
export function ovProps(o: {
  summary?: Partial<SummaryData>;
  teamSummary?: Slot<SummaryData>;
  repos?: RepoRow[];
  url?: Partial<SecurityViewProps['url']>;
  data?: Partial<SecurityData>;
} = {}): SecurityViewProps {
  const summary = summaryFixture(o.summary);
  const base = viewProps();
  return viewProps({
    summary,
    url: { ...base.url, ...o.url },
    data: {
      ...base.data,
      summary: slot(summary),
      teamSummary: o.teamSummary ?? slot(summary),
      ...(o.repos ? { repos: slot(reposFixture(o.repos)) } : {}),
      ...o.data,
    },
  });
}
```

Create `src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx
// The KPI row and its first tile, "Open {severity} alerts": the count, the change sentence and the
// sparkline. The other three tiles have their own files (vuln-kpi-since, -resolved, -sla).
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import type { SummaryData, TrendData } from '@/app/vulnerabilities/api-types';
import { KPI_ROW_H, SPARK_H } from '@/app/vulnerabilities/dimensions';
import {
  ovBaseline, ovCell, ovDelta, ovDeltaTeam, ovNoBaseline, ovProps, ovSeries, ovTeam, slot, trendFixture,
} from '../support/security-fixtures';

beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-09-30T12:00:00Z')); });
afterEach(() => { jest.useRealTimers(); });

const openTile = () => screen.getByTestId('kpi-open');
const criticalDelta = (deltaOpen: number, takenOn = '2026-09-15') =>
  ovDelta(ovDeltaTeam('Total', deltaOpen), { baseline: ovBaseline(takenOn) });

describe('the row', () => {
  // Revert: drop the inline height, or set it only in the populated branch.
  it('is KPI_ROW_H tall in every branch: populated, stale, with a loading sparkline and with a failed one', () => {
    const branches = [
      ovProps(),
      ovProps({ data: { summary: slot<SummaryData>(undefined, { stale: true, loading: false }) } }),
      ovProps({ data: { sparkline: slot<TrendData>(undefined, { loading: true }) } }),
      ovProps({ data: { sparkline: slot<TrendData>(undefined, { error: new Error('x'), errorText: "Couldn't load trend: x", loading: false }) } }),
    ];
    for (const p of branches) {
      const { unmount } = render(<KpiTiles {...p} />);
      expect(screen.getByTestId('kpi-tiles').style.height).toBe(`${KPI_ROW_H}px`);
      unmount();
    }
  });

  // Revert: remove the `opacity-60` on a stale summary.
  it('dims while the summary shows the previous key, and not otherwise', () => {
    const { rerender } = render(<KpiTiles {...ovProps({ data: { summary: slot<SummaryData>(undefined, { stale: true, loading: false }) } })} />);
    expect(screen.getByTestId('kpi-tiles').className).toContain('opacity-60');
    rerender(<KpiTiles {...ovProps()} />);
    expect(screen.getByTestId('kpi-tiles').className).not.toContain('opacity-60');
  });
});

describe('Open tile: count and severity', () => {
  it('reads "Open critical alerts" and the critical total', () => {
    render(<KpiTiles {...ovProps()} />);
    expect(within(openTile()).getByText('Open critical alerts')).toBeTruthy();
    expect(within(openTile()).getByText('10')).toBeTruthy();
  });

  // Revert: read `critical` regardless of kSev, or sum both severities.
  it('follows kSev: "High only" shows the high total under "Open high alerts", never a sum', () => {
    render(<KpiTiles {...ovProps({ url: { severity: 'high', kSev: 'high' } })} />);
    expect(within(openTile()).getByText('Open high alerts')).toBeTruthy();
    expect(within(openTile()).getByText('3')).toBeTruthy();
    expect(within(openTile()).queryByText('13')).toBeNull();
  });

  // Revert: read the team table's summary (data.teamSummary) instead of the scoped one (props.summary).
  it('shows the team-scoped number while the table beside it lists every team', () => {
    const scoped = { pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1))], total: ovTeam('Total', ovCell(3), ovCell(1)) } };
    const p = ovProps({ summary: scoped, url: { team: 'Payments' } });
    p.data.teamSummary = slot({ ...p.summary, pivot: { rows: [], total: ovTeam('Total', ovCell(10), ovCell(3)) } });
    render(<KpiTiles {...p} />);
    expect(within(openTile()).getByText('3')).toBeTruthy();
    expect(within(openTile()).queryByText('10')).toBeNull();
  });
});

describe('Open tile: the change sentence', () => {
  // Revert: use one tone for all deltas (the old deltaClass rule: red up, green down, grey flat).
  it('is red for more alerts, green for fewer and grey for no change, each with its arrow and date', () => {
    const cases: Array<[number, string, string]> = [
      [5, '▲ 5 more than on Sep 15', 'text-red-400'],
      [-3, '▼ 3 fewer than on Sep 15', 'text-green-400'],
      [0, 'Same as on Sep 15', 'text-gray-500'],
    ];
    for (const [delta, text, tone] of cases) {
      const { unmount } = render(<KpiTiles {...ovProps({ summary: { delta: { critical: criticalDelta(delta), high: ovNoBaseline() } } })} />);
      const el = screen.getByText(text);
      expect(el.className).toContain(tone);
      expect(el.getAttribute('data-testid')).toBe('kpi-open-change');
      unmount();
    }
  });

  it('a rise in high alerts is orange, not red', () => {
    render(<KpiTiles {...ovProps({ url: { severity: 'high', kSev: 'high' }, summary: { delta: { critical: ovNoBaseline(), high: criticalDelta(2) } } })} />);
    expect(screen.getByText('▲ 2 more than on Sep 15').className).toContain('text-orange-400');
  });

  // Revert: leave the sentence slot empty when there is no delta (the row's shape then changes).
  it('says why there is no change: "No earlier measurement yet" for a null baseline', () => {
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: ovNoBaseline(), high: ovNoBaseline() } } })} />);
    const el = screen.getByTestId('kpi-open-change');
    expect(el.textContent).toBe('No earlier measurement yet');
    expect(el.className).toContain('h-5');
  });

  it('says "No measurement on or before <date>" when a baseline exists but does not cover this view', () => {
    const d = ovDelta(null, { baseline: ovBaseline('2026-09-29') });
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: d, high: d } } })} />);
    expect(screen.getByTestId('kpi-open-change').textContent).toBe('No measurement on or before Sep 29');
  });

  // Revert: trust `available` and dereference the null total.
  it('an available delta with a null total never throws and never prints NaN or undefined', () => {
    const d = ovDelta(null, { available: true });
    render(<KpiTiles {...ovProps({ summary: { delta: { critical: d, high: d } } })} />);
    const text = openTile().textContent ?? '';
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(screen.getByTestId('kpi-open-change').textContent).toBe('No measurement on or before Sep 15');
  });
});

describe('Open tile: the sparkline', () => {
  const sparkSlot = (series: ReturnType<typeof ovSeries>[]) => ({ sparkline: slot(trendFixture(series)) });

  // Revert: sparkPoints ignores the team, or the tile passes null instead of url.team.
  it('with an owning team selected, the line is summed from that team only', () => {
    const series = [
      ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]]),
      ovSeries('Search', [['2026-09-22', 5], ['2026-09-29', 1]]),
    ];
    render(<KpiTiles {...ovProps({ url: { team: 'Payments' }, data: sparkSlot(series) })} />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('Open critical · 2 measurements since Sep 22');
    const pts = openTile().querySelector('polyline')!.getAttribute('points')!.split(' ').map(p => Number(p.split(',')[1]));
    expect(pts).toHaveLength(2);
    expect(pts[1]).toBeLessThan(pts[0]); // Payments 2 -> 3 rises (y falls); with Search's 5 -> 1 summed it would fall
  });

  it('shows the three history states: no measurements, one, and a line', () => {
    const { rerender } = render(<KpiTiles {...ovProps({ data: sparkSlot([]) })} />);
    expect(screen.getByText('Not enough history yet')).toBeTruthy();
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('No measurements yet');
    rerender(<KpiTiles {...ovProps({ data: sparkSlot([ovSeries('Payments', [['2026-09-29', 3]])]) })} />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe('1 measurement so far (Sep 29)');
    rerender(<KpiTiles {...ovProps({ data: sparkSlot([ovSeries('Payments', [['2026-09-22', 2], ['2026-09-29', 3]])]) })} />);
    expect(openTile().querySelectorAll('polyline')).toHaveLength(1);
  });

  // Revert: render the slot only when there is a line.
  it('keeps its 24px slot in the tile in every history state', () => {
    for (const series of [[], [ovSeries('Payments', [['2026-09-29', 3]])]]) {
      const { unmount } = render(<KpiTiles {...ovProps({ data: sparkSlot(series) })} />);
      expect(screen.getByTestId('sparkline-slot').style.height).toBe(`${SPARK_H}px`);
      unmount();
    }
  });

  it('a failed trend request shows its message in the caption and leaves the rest of the tile alone', () => {
    render(<KpiTiles {...ovProps({ data: { sparkline: slot<TrendData>(undefined, { error: new Error('x'), errorText: "Couldn't load trend: x", loading: false }) } })} />);
    expect(screen.getByTestId('sparkline-caption').textContent).toBe("Couldn't load trend: x");
    expect(within(openTile()).getByText('10')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx --maxWorkers=3`
Expected: FAIL, 13 of 14 tests, `Unable to find an element by: [data-testid="kpi-open"]` (the stub renders an empty `kpi-tiles` section, which is why the row-height test alone passes).

- [ ] **Step 3: Implement**

Replace the whole of `src/app/vulnerabilities/kpi-tiles.tsx`:

```tsx
// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H, TYPE } from './dimensions';
import { dash } from './format';
import { openChange } from './overview-format';
import Sparkline, { sparkPoints } from './sparkline';

const TILE = 'bg-gray-900 rounded-xl p-4 min-w-0 h-full overflow-hidden flex flex-col';
const LABEL = `${TYPE.sectionLabel} truncate text-gray-400`;

const todayUtc = () => new Date().toISOString().slice(0, 10);

function OpenTile({ summary, data, url }: SecurityViewProps) {
  const sev = url.kSev;
  const change = openChange(summary.delta[sev], sev);
  const spark = data.sparkline;
  return (
    <div data-testid="kpi-open" className={TILE}>
      <div className={LABEL}>Open {sev} alerts</div>
      <div className={`${TYPE.kpiValue} mt-1 text-white`}>{dash(summary.pivot.total[sev].open)}</div>
      {/* Always one line: the change sentence, or the reason there is none. */}
      <div data-testid="kpi-open-change" className={`h-5 truncate text-[13px] leading-5 ${change.toneClass}`} title={change.text}>
        {change.text}
      </div>
      <div className="mt-auto">
        <Sparkline
          points={spark.data ? sparkPoints(spark.data.series, url.team) : undefined}
          sev={sev}
          today={todayUtc()}
          errorText={spark.errorText}
        />
      </div>
    </div>
  );
}

export default function KpiTiles(props: SecurityViewProps) {
  const stale = props.data.summary.stale;
  return (
    <section
      aria-label="Key figures"
      data-testid="kpi-tiles"
      className={`grid gap-4${stale ? ' opacity-60' : ''}`}
      style={{ height: KPI_ROW_H, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
    >
      <OpenTile {...props} />
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (the page test still finds `kpi-tiles` at `KPI_ROW_H`), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/kpi-tiles.tsx src/lib/__tests__/support/security-fixtures.ts src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: KPI row and Open tile"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.4: Since-baseline tile

**Files:**
- Modify: `src/app/vulnerabilities/kpi-tiles.tsx` (imports, `CountRow`, `SinceTile`, the grid)
- Test: `src/lib/__tests__/unit/vuln-kpi-since.test.tsx`

**Interfaces:**
- Consumes: `KpiTiles` from 3.3; `deltaBaselineCaption`, `signed` from `format.ts`; `baselineUnavailableText`, `shortDate`, `usableTotal` from 3.1; fixtures `ovDelta`, `ovDeltaTeam`, `ovBaseline`, `ovNoBaseline`, `ovProps`.
- Produces: tile `data-testid="kpi-since"` titled "{severity} since {date}", rows new / resolved ("(N dismissed)") / reopened, and three reserved one-line slots `kpi-since-other`, `kpi-since-caption`, `kpi-since-repos`, each `h-4 truncate` and an aria-hidden non-breaking space when empty.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-kpi-since.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-since.test.tsx
// The KPI tile "{Severity} since {date}": new / resolved (N dismissed) / reopened since the baseline.
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import { ovBaseline, ovDelta, ovDeltaTeam, ovNoBaseline, ovProps } from '../support/security-fixtures';

const tile = () => screen.getByTestId('kpi-since');
const total = (over: Partial<ReturnType<typeof ovDeltaTeam>> = {}) => ovDeltaTeam('Total', 2, { new: 4, resolved: 3, dismissed: 1, reopened: 2, ...over });
const withDelta = (d: ReturnType<typeof ovDelta>) => ovProps({ summary: { delta: { critical: d, high: ovNoBaseline() } } });
const NBSP = '\u00a0';

describe('available delta', () => {
  it('titles the tile with the severity and the baseline date, and lists new, resolved (dismissed) and reopened', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { baseline: ovBaseline('2026-09-29') }))} />);
    expect(within(tile()).getByText('critical since Sep 29')).toBeTruthy();
    const text = tile().textContent ?? '';
    expect(text).toContain('new4');
    expect(text).toContain('resolved(1 dismissed)3');
    expect(text).toContain('reopened2');
  });

  // Revert: read the critical delta whatever kSev says.
  it('follows kSev: "High only" reads the high delta', () => {
    const p = ovProps({
      url: { severity: 'high', kSev: 'high' },
      summary: { delta: { critical: ovDelta(total()), high: ovDelta(total({ new: 9, resolved: 8, dismissed: 7, reopened: 6 })) } },
    });
    render(<KpiTiles {...p} />);
    expect(within(tile()).getByText('high since Sep 15')).toBeTruthy();
    expect(tile().textContent).toContain('new9');
  });

  // Revert: drop the caption or change its wording ("vs <date>" is what the column headers use too).
  it('keeps the "vs <date>" caption', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { baseline: ovBaseline('2099-01-01') }))} />);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('vs 2099-01-01');
    expect(screen.getByTestId('kpi-since-caption').hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('"N repos not in baseline"', () => {
  // Revert: join the count back onto the caption, or render the line conditionally.
  it('0 repos: the caption is exactly "vs <date>" and the line holds only an aria-hidden non-breaking space', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { reposNotInBaseline: 0 }))} />);
    const repos = screen.getByTestId('kpi-since-repos');
    expect(repos.textContent).toBe(NBSP);
    expect(repos.getAttribute('aria-hidden')).toBe('true');
  });

  it('3 repos: the count sits on its own line and the caption is unchanged', () => {
    render(<KpiTiles {...withDelta(ovDelta(total(), { reposNotInBaseline: 3 }))} />);
    expect(screen.getByTestId('kpi-since-repos').textContent).toBe('3 repos not in baseline');
    expect(screen.getByTestId('kpi-since-repos').hasAttribute('aria-hidden')).toBe(false);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('vs 2026-09-15');
  });

  // Revert: show the count for an unavailable delta too.
  it('is not shown when the delta is unavailable, even if it carries a count', () => {
    render(<KpiTiles {...withDelta(ovDelta(null, { available: false, reposNotInBaseline: 5 }))} />);
    expect(screen.getByTestId('kpi-since-repos').textContent).toBe(NBSP);
  });
});

describe('"other ±N"', () => {
  // Revert: drop the truncation or the title.
  it('is shown on one truncated line with the full text in its title', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ other: 4 })))} />);
    const el = screen.getByTestId('kpi-since-other');
    expect(el.textContent).toBe('other +4');
    expect(el.className).toContain('truncate');
    expect(el.getAttribute('title')).toBe('other +4: change in open alerts not explained by new, resolved or reopened');
    expect(el.hasAttribute('aria-hidden')).toBe(false);
  });

  it('shows the sign of a negative remainder', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ other: -2 })))} />);
    expect(screen.getByTestId('kpi-since-other').textContent).toBe('other -2');
  });

  // Revert: render the line for zero too.
  it('is not shown when it is zero: the slot holds an aria-hidden non-breaking space', () => {
    render(<KpiTiles {...withDelta(ovDelta(total({ other: 0 })))} />);
    const el = screen.getByTestId('kpi-since-other');
    expect(el.textContent).toBe(NBSP);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('unavailable delta', () => {
  // Revert: keep the old copy ("no measurement for this view before ...") or always name a date.
  it('a null baseline reads "No earlier measurement yet" and shows dashes', () => {
    render(<KpiTiles {...withDelta(ovNoBaseline())} />);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('No earlier measurement yet');
    expect(within(tile()).getByText('critical since baseline')).toBeTruthy();
    expect(within(tile()).getAllByText('—')).toHaveLength(3);
  });

  it('a known baseline that does not measure this view reads "No measurement on or before <date>"', () => {
    render(<KpiTiles {...withDelta(ovDelta(null, { baseline: ovBaseline('2099-01-01') }))} />);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('No measurement on or before Jan 1');
    expect(screen.getByTestId('kpi-since-caption').getAttribute('title')).toBe('No measurement on or before Jan 1');
  });

  // Revert: choose the available branch on `available` alone and dereference total.
  it('an available delta with a null total takes the unavailable branch: no throw, dashes, no NaN', () => {
    render(<KpiTiles {...withDelta(ovDelta(null, { available: true, baseline: ovBaseline('2099-01-01') }))} />);
    expect(within(tile()).getAllByText('—')).toHaveLength(3);
    expect(tile().textContent).not.toMatch(/NaN|undefined|null/);
    expect(screen.getByTestId('kpi-since-caption').textContent).toBe('No measurement on or before Jan 1');
  });
});

describe('fixed shape', () => {
  // Revert: drop a reserved slot's fixed height (h-4) or let it wrap (truncate) in either branch.
  it('every reserved line has the same height and truncation classes whether the delta is available or not', () => {
    const slots = ['kpi-since-other', 'kpi-since-caption', 'kpi-since-repos'];
    const classes = () => slots.map(id => screen.getByTestId(id).className);
    const { unmount } = render(<KpiTiles {...withDelta(ovDelta(total({ other: 1 }), { reposNotInBaseline: 2 }))} />);
    const available = classes();
    unmount();
    render(<KpiTiles {...withDelta(ovNoBaseline())} />);
    expect(classes()).toEqual(available);
    for (const c of available) { expect(c).toContain('h-4'); expect(c).toContain('truncate'); }
  });

  it('the three figure rows are single fixed-height lines whose label truncates', () => {
    render(<KpiTiles {...withDelta(ovDelta(total()))} />);
    const rows = Array.from(tile().querySelectorAll('div.h-5'));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.querySelector('.truncate')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-since.test.tsx --maxWorkers=3`
Expected: FAIL, all 14 tests, `Unable to find an element by: [data-testid="kpi-since"]`.

- [ ] **Step 3: Implement**

In `src/app/vulnerabilities/kpi-tiles.tsx`, replace the import block at the top of the file (everything above `const TILE`) with:

```tsx
// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H, TYPE } from './dimensions';
import { dash, deltaBaselineCaption, signed } from './format';
import { baselineUnavailableText, openChange, shortDate, usableTotal } from './overview-format';
import Sparkline, { sparkPoints } from './sparkline';
```

Add these two functions directly above `export default function KpiTiles`:

```tsx
/** One "label  value" line of the since-baseline tile. */
function CountRow({ label, note, value }: { label: string; note?: string; value: number | null }) {
  return (
    <div className="flex h-5 items-baseline justify-between gap-2 text-sm leading-5">
      <span className="min-w-0 truncate text-gray-300">
        {label}
        {note && <span className="ml-1 text-xs text-gray-500">{note}</span>}
      </span>
      <span className={`shrink-0 font-semibold tabular-nums ${value === null ? 'text-gray-500' : 'text-white'}`}>{dash(value)}</span>
    </div>
  );
}

function SinceTile({ summary, url }: SecurityViewProps) {
  const sev = url.kSev;
  const d = summary.delta[sev];
  const total = usableTotal(d);
  // The caption keeps today's "vs <date>" wording; with no usable total it says why instead.
  const caption = total ? deltaBaselineCaption(d) : baselineUnavailableText(d);
  const notInBaseline = d?.available && d.reposNotInBaseline > 0 ? `${d.reposNotInBaseline} repos not in baseline` : null;
  const other = total && total.other !== 0
    ? { text: `other ${signed(total.other)}`, title: `other ${signed(total.other)}: change in open alerts not explained by new, resolved or reopened` }
    : null;
  return (
    <div data-testid="kpi-since" className={TILE}>
      <div className={LABEL}>{sev} since {d?.baseline ? shortDate(d.baseline.takenOn) : 'baseline'}</div>
      <div className="mt-1">
        <CountRow label="new" value={total ? total.new : null} />
        <CountRow label="resolved" note={total ? `(${total.dismissed} dismissed)` : undefined} value={total ? total.resolved : null} />
        <CountRow label="reopened" value={total ? total.reopened : null} />
      </div>
      {/* Three reserved one-line slots, whatever the delta holds, so the tile never changes shape. */}
      <div
        data-testid="kpi-since-other" aria-hidden={other ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-400" title={other?.title}
      >
        {other?.text ?? '\u00a0'}
      </div>
      <div data-testid="kpi-since-caption" className="h-4 truncate text-[11px] leading-4 text-gray-500" title={caption ?? undefined}>
        {caption ?? '\u00a0'}
      </div>
      <div
        data-testid="kpi-since-repos" aria-hidden={notInBaseline ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-500" title={notInBaseline ?? undefined}
      >
        {notInBaseline ?? '\u00a0'}
      </div>
    </div>
  );
}
```

Replace `KpiTiles` with (the grid now holds two tiles):

```tsx
export default function KpiTiles(props: SecurityViewProps) {
  const stale = props.data.summary.stale;
  return (
    <section
      aria-label="Key figures"
      data-testid="kpi-tiles"
      className={`grid gap-4${stale ? ' opacity-60' : ''}`}
      style={{ height: KPI_ROW_H, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
    >
      <OpenTile {...props} />
      <SinceTile {...props} />
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-since.test.tsx src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/kpi-tiles.tsx src/lib/__tests__/unit/vuln-kpi-since.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: KPI since-baseline tile"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.5: Resolved tile and the † wording

**Files:**
- Modify: `src/app/vulnerabilities/kpi-tiles.tsx` (imports, `ResolvedTile`, the grid)
- Modify: `src/app/vulnerabilities/overview-format.ts` (append `carriedTitle`, `carriedFootnote`)
- Modify: `src/lib/__tests__/unit/vuln-overview-format.test.ts` (one import name and one `describe`)
- Test: `src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx`

**Interfaces:**
- Consumes: `resolvedCaption`, `dash` from `format.ts`; fixtures `ovCell`, `ovTeam`, `ovProps`.
- Produces: `carriedTitle(n)` and `carriedFootnote(n)` (the † tooltip and footnote text, shared with the team table in 3.8); tile `data-testid="kpi-resolved"` with `kpi-resolved-since`, `kpi-resolved-footnote` (aria-hidden non-breaking space when nothing carries) and `kpi-resolved-closed`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx
// The KPI tile "Resolved {severity}": the count, "N dismissed · since {date}" (or "all time"), the
// † for carried-over CSV history and the "% of N raised are closed" line.
import { render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import { ovCell, ovProps, ovTeam } from '../support/security-fixtures';

const tile = () => screen.getByTestId('kpi-resolved');
const NBSP = '\u00a0';
const pivot = (critical: ReturnType<typeof ovCell>, high = ovCell(3)) => ({ pivot: { rows: [], total: ovTeam('Total', critical, high) } });
const CARRY_TITLE = 'Includes 3 carried over from imported CSV history (archived repo with no alert data)';

describe('count and caption', () => {
  it('a real start date reads "N dismissed · since <date>", with the % closed line', () => {
    render(<KpiTiles {...ovProps({ summary: pivot(ovCell(19, { resolved: 25, dismissed: 4, pctClosed: 57 })) })} />);
    expect(within(tile()).getByText('Resolved critical')).toBeTruthy();
    expect(within(tile()).getByText('25')).toBeTruthy();
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('4 dismissed · since 2020-01-08');
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('57% of 44 raised are closed');
  });

  // Revert: drop the "all time" branch (resolvedCaption's date: null case).
  it('with no resolved-count start date it reads "N dismissed · all time"', () => {
    render(<KpiTiles {...ovProps({ summary: { resolvedSince: { date: null, invalid: false }, ...pivot(ovCell(2, { resolved: 6, dismissed: 1, pctClosed: 75 })) } })} />);
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('1 dismissed · all time');
  });

  // Revert: render a number for a null resolved, or keep the date for an invalid start.
  it('an invalid start date shows — for the value, the dismissed count and % closed, and "since —"', () => {
    const critical = ovCell(12, { resolved: null, dismissed: null, pctClosed: null, carriedResolved: 7 });
    render(<KpiTiles {...ovProps({ summary: { resolvedSince: { date: null, invalid: true }, ...pivot(critical) } })} />);
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('— dismissed · since —');
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('— closed');
    expect(within(tile()).getByText('—')).toBeTruthy();
  });

  it('nothing raised yet reads "None raised yet", never "0% of 0"', () => {
    render(<KpiTiles {...ovProps({ summary: pivot(ovCell(0, { resolved: 0, dismissed: 0, pctClosed: null })) })} />);
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('None raised yet');
  });

  // Revert: read `critical` whatever kSev says.
  it('follows kSev: "High only" shows the high figures', () => {
    const p = ovProps({ url: { severity: 'high', kSev: 'high' }, summary: pivot(ovCell(1, { resolved: 9 }), ovCell(4, { resolved: 6, dismissed: 2, pctClosed: 60 })) });
    render(<KpiTiles {...p} />);
    expect(within(tile()).getByText('Resolved high')).toBeTruthy();
    expect(screen.getByTestId('kpi-resolved-since').textContent).toBe('2 dismissed · since 2020-01-08');
    expect(screen.getByTestId('kpi-resolved-closed').textContent).toBe('60% of 10 raised are closed');
  });
});

describe('† marker and footnote', () => {
  const carried = (over = {}) => ovProps({ summary: pivot(ovCell(5, { resolved: 8, dismissed: 1, pctClosed: 62, carriedResolved: 3, ...over })) });

  // Revert: key the marker off something other than carriedResolved > 0.
  it('a † with the carry tooltip and the footnote when carriedResolved > 0', () => {
    render(<KpiTiles {...carried()} />);
    expect(within(tile()).getByText('†').getAttribute('title')).toBe(CARRY_TITLE);
    const note = screen.getByTestId('kpi-resolved-footnote');
    expect(note.textContent).toBe('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.');
    expect(note.hasAttribute('aria-hidden')).toBe(false);
    expect(note.getAttribute('title')).toBe(note.textContent);
  });

  it('no † and an empty reserved footnote line when nothing carries', () => {
    render(<KpiTiles {...carried({ carriedResolved: 0 })} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByTitle(CARRY_TITLE)).toBeNull();
    const note = screen.getByTestId('kpi-resolved-footnote');
    expect(note.textContent).toBe(NBSP);
    expect(note.getAttribute('aria-hidden')).toBe('true');
  });

  // Revert: key the marker off carriedResolved alone (an invalid start date would then show a count nobody can trust).
  it('no † and no footnote when resolved is null (invalid start date), even though carriedResolved > 0', () => {
    render(<KpiTiles {...ovProps({ summary: { resolvedSince: { date: null, invalid: true }, ...pivot(ovCell(12, { resolved: null, dismissed: null, pctClosed: null, carriedResolved: 7 })) } })} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.getByTestId('kpi-resolved-footnote').textContent).toBe(NBSP);
  });
});

describe('fixed shape', () => {
  // Revert: drop h-4 or truncate from one of the reserved lines.
  it('the dismissed line, the footnote slot and the % line are single fixed-height lines', () => {
    render(<KpiTiles {...ovProps()} />);
    for (const id of ['kpi-resolved-since', 'kpi-resolved-footnote', 'kpi-resolved-closed']) {
      expect(screen.getByTestId(id).className).toContain('h-4');
      expect(screen.getByTestId(id).className).toContain('truncate');
    }
  });
});
```

Replace `src/lib/__tests__/unit/vuln-overview-format.test.ts` with this version (its `describe('carried-resolved wording')` is the new part):

```ts
// src/lib/__tests__/unit/vuln-overview-format.test.ts
// The Overview's change sentences: one wording and one tone for the Open tile and the trend header.
import { baselineUnavailableText, carriedFootnote, carriedTitle, changeSentence, changeToneClass, openChange, shortDate, usableTotal } from '@/app/vulnerabilities/overview-format';
import { ovBaseline, ovDelta, ovDeltaTeam, ovNoBaseline } from '../support/security-fixtures';

describe('changeSentence', () => {
  // Revert: swap the two arrows, or print the signed number ("▲ -3").
  it('reads "▲ N more than on <date>", "▼ N fewer than on <date>" or "Same as on <date>"', () => {
    expect(changeSentence(2, '2026-09-29')).toBe('▲ 2 more than on Sep 29');
    expect(changeSentence(-1, '2026-09-29')).toBe('▼ 1 fewer than on Sep 29');
    expect(changeSentence(0, '2026-09-29')).toBe('Same as on Sep 29');
  });

  it('writes the date as month and day in UTC, never shifted by the local zone', () => {
    expect(shortDate('2026-01-01')).toBe('Jan 1');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
  });
});

describe('changeToneClass', () => {
  // Revert: use one colour for both severities, or colour a decrease red.
  it('more alerts is red for critical and orange for high; fewer is green; no change is grey', () => {
    expect(changeToneClass(5, 'critical')).toBe('text-red-400');
    expect(changeToneClass(5, 'high')).toBe('text-orange-400');
    expect(changeToneClass(-3, 'critical')).toBe('text-green-400');
    expect(changeToneClass(-3, 'high')).toBe('text-green-400');
    expect(changeToneClass(0, 'critical')).toBe('text-gray-500');
  });
});

describe('baselineUnavailableText', () => {
  // Revert: always name a date, or never name one.
  it('a null baseline names no date; a known baseline that does not measure this view names its date', () => {
    expect(baselineUnavailableText(ovNoBaseline())).toBe('No earlier measurement yet');
    expect(baselineUnavailableText(undefined)).toBe('No earlier measurement yet');
    expect(baselineUnavailableText(ovDelta(null, { baseline: ovBaseline('2026-09-29') }))).toBe('No measurement on or before Sep 29');
  });
});

describe('usableTotal and openChange', () => {
  // Revert: trust `available` alone and dereference the total.
  it('an available delta whose total is null is not usable and never throws', () => {
    const d = ovDelta(null, { available: true });
    expect(usableTotal(d)).toBeNull();
    const c = openChange(d, 'critical');
    expect(c.hasChange).toBe(false);
    expect(c.delta).toBeNull();
    expect(c.text).toBe('No measurement on or before Sep 15');
    expect(c.text).not.toMatch(/NaN|undefined|null/);
  });

  it('an unavailable delta is not usable even if it carries a stale total', () => {
    expect(usableTotal(ovDelta(ovDeltaTeam('Total', 4), { available: false }))).toBeNull();
  });

  it('a usable delta gives the sentence, its tone and the number', () => {
    const c = openChange(ovDelta(ovDeltaTeam('Total', 2), { baseline: ovBaseline('2026-09-29') }), 'critical');
    expect(c).toEqual({ text: '▲ 2 more than on Sep 29', toneClass: 'text-red-400', hasChange: true, delta: 2 });
  });

  it('no delta at all reads as no earlier measurement', () => {
    expect(openChange(undefined, 'high')).toEqual({ text: 'No earlier measurement yet', toneClass: 'text-gray-500', hasChange: false, delta: null });
  });
});

describe('carried-resolved wording', () => {
  // Revert: reword either string (the tile and the table both read these).
  it('the † tooltip and footnote keep their wording', () => {
    expect(carriedTitle(3)).toBe('Includes 3 carried over from imported CSV history (archived repo with no alert data)');
    expect(carriedFootnote(3)).toBe('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx src/lib/__tests__/unit/vuln-overview-format.test.ts --maxWorkers=3`
Expected: FAIL: `vuln-kpi-resolved` finds no `kpi-resolved` element, and the new carried-wording test fails (`carriedTitle` is not exported yet).

- [ ] **Step 3: Implement**

Append to `src/app/vulnerabilities/overview-format.ts`:

```ts
/** The tooltip on a † beside a resolved figure that includes carried-over CSV history. */
export const carriedTitle = (n: number): string =>
  `Includes ${n} carried over from imported CSV history (archived repo with no alert data)`;

/** The footnote that explains the †. */
export const carriedFootnote = (n: number): string =>
  `† Resolved includes ${n} carried over from imported CSV history for archived repos Glooker never synced.`;
```

In `src/app/vulnerabilities/kpi-tiles.tsx`, replace the import block above `const TILE` with:

```tsx
// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H, TYPE } from './dimensions';
import { dash, deltaBaselineCaption, resolvedCaption, signed } from './format';
import { baselineUnavailableText, carriedFootnote, carriedTitle, openChange, shortDate, usableTotal } from './overview-format';
import Sparkline, { sparkPoints } from './sparkline';
```

Add this function directly above `export default function KpiTiles`:

```tsx
function ResolvedTile({ summary, url }: SecurityViewProps) {
  const sev = url.kSev;
  const c = summary.pivot.total[sev];
  // `resolved` is null when the start date is invalid: nothing carried can be trusted either.
  const carried = c.resolved !== null && c.carriedResolved > 0 ? c.carriedResolved : 0;
  const raised = c.open + (c.resolved ?? 0);
  const closedLine = c.resolved === null
    ? `${dash(c.pctClosed, '%')} closed`
    : raised === 0 ? 'None raised yet' : `${dash(c.pctClosed, '%')} of ${raised} raised are closed`;
  const footnote = carried > 0 ? carriedFootnote(carried) : null;
  return (
    <div data-testid="kpi-resolved" className={TILE}>
      <div className={LABEL}>Resolved {sev}</div>
      <div className={`${TYPE.kpiValue} mt-1 text-white`}>
        {dash(c.resolved)}
        {carried > 0 && <span className="ml-0.5 text-sm text-warn" title={carriedTitle(carried)}>†</span>}
      </div>
      <div data-testid="kpi-resolved-since" className="h-4 truncate text-xs leading-4 text-gray-400">
        {dash(c.dismissed)} dismissed · {resolvedCaption(summary.resolvedSince)}
      </div>
      <div
        data-testid="kpi-resolved-footnote" aria-hidden={footnote ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-500" title={footnote ?? undefined}
      >
        {footnote ?? '\u00a0'}
      </div>
      <div data-testid="kpi-resolved-closed" className="mt-auto h-4 truncate text-xs leading-4 text-gray-400">{closedLine}</div>
    </div>
  );
}
```

Replace `KpiTiles` with:

```tsx
export default function KpiTiles(props: SecurityViewProps) {
  const stale = props.data.summary.stale;
  return (
    <section
      aria-label="Key figures"
      data-testid="kpi-tiles"
      className={`grid gap-4${stale ? ' opacity-60' : ''}`}
      style={{ height: KPI_ROW_H, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
    >
      <OpenTile {...props} />
      <SinceTile {...props} />
      <ResolvedTile {...props} />
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx src/lib/__tests__/unit/vuln-overview-format.test.ts src/lib/__tests__/unit/vuln-kpi-since.test.tsx src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/kpi-tiles.tsx src/app/vulnerabilities/overview-format.ts src/lib/__tests__/unit/vuln-overview-format.test.ts src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: KPI resolved tile"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.6: SLA tile

**Files:**
- Modify: `src/app/vulnerabilities/kpi-tiles.tsx` (imports, `SlaRow`, `SlaTile`, the grid)
- Test: `src/lib/__tests__/unit/vuln-kpi-sla.test.tsx`

**Interfaces:**
- Consumes: `slaState`, `slaStateLabel`, `SlaState` from `sla-state.ts`; `openDrawer` from `SecurityViewProps`; `ovCell`, `ovTeam`, `ovProps`.
- Produces: tile `data-testid="kpi-sla"` with one row per severity (`kpi-sla-critical`, `kpi-sla-high`). An active row shows Overdue and Due ≤ 7d. Any other state shows its label in `kpi-sla-{sev}-state`, spanning both columns (`col-span-2`). An invalid policy wins over `slaStatus` and reads red with a "!" icon. A row whose severity the Severity filter hides gets `opacity-[0.35]` but stays. The ⓘ button calls `openDrawer(button)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-kpi-sla.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-sla.test.tsx
// The KPI tile "SLA · open alerts": Overdue and Due ≤ 7d per severity while that policy is active,
// otherwise the state's own message. The wording comes from sla-state.ts, so it matches every other consumer.
import { fireEvent, render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import type { SummaryData } from '@/app/vulnerabilities/api-types';
import { ovCell, ovProps, ovTeam } from '../support/security-fixtures';

type Status = 'active' | 'pending' | 'none';
const row = (sev: 'critical' | 'high') => screen.getByTestId(`kpi-sla-${sev}`);
const policyRow = (severity: 'critical' | 'high', pending: boolean, effectiveFrom: string) =>
  ({ id: `${severity}-${effectiveFrom}`, severity, days: 7, effectiveFrom, until: null, pending });

/** A summary whose two severities are in the given states, with figures in the active ones. */
function sla(critical: Status, high: Status, over: Partial<SummaryData> = {}): Partial<SummaryData> {
  return {
    slaStatus: { critical, high },
    policy: [
      ...(critical === 'none' ? [] : [policyRow('critical', critical === 'pending', critical === 'pending' ? '2026-11-01' : '2020-01-08')]),
      ...(high === 'none' ? [] : [policyRow('high', high === 'pending', high === 'pending' ? '2026-11-01' : '2020-01-08')]),
    ],
    pivot: { rows: [], total: ovTeam('Total', ovCell(20, { overdue: 15, dueSoon: 2 }), ovCell(30, { overdue: 13, dueSoon: 4 })) },
    ...over,
  };
}

describe('active policy', () => {
  it('shows Overdue and Due ≤ 7d for each severity, overdue in red', () => {
    render(<KpiTiles {...ovProps({ summary: sla('active', 'active') })} />);
    expect(within(row('critical')).getByText('15').className).toContain('text-red-400');
    expect(within(row('critical')).getByText('2')).toBeTruthy();
    expect(within(row('high')).getByText('13')).toBeTruthy();
    expect(within(row('high')).getByText('4')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Due ≤ 7d')).toBeTruthy();
  });

  // Revert: colour a zero overdue red.
  it('a zero overdue count is not red', () => {
    const p = ovProps({ summary: sla('active', 'active', { pivot: { rows: [], total: ovTeam('Total', ovCell(5, { overdue: 0, dueSoon: 1 }), ovCell(5, { overdue: 0, dueSoon: 0 })) } }) });
    render(<KpiTiles {...p} />);
    expect(within(row('critical')).getAllByText('0').length).toBe(1);
    expect(within(row('critical')).getByText('0').className).not.toContain('text-red-400');
  });
});

describe.each([['critical', 'high'], ['high', 'critical']] as const)('%s row in a non-active state while %s stays active', (sev, other) => {
  const statuses = (s: Status) => (sev === 'critical' ? sla(s, 'active') : sla('active', s));

  // Revert: render the Overdue / Due cells for a pending policy.
  it('pending: "Starts <date>" spanning both columns, grey, and no figures', () => {
    render(<KpiTiles {...ovProps({ summary: statuses('pending') })} />);
    const state = screen.getByTestId(`kpi-sla-${sev}-state`);
    expect(state.textContent).toBe('Starts 2026-11-01');
    expect(state.className).toContain('col-span-2');
    expect(state.className).not.toContain('text-red-400');
    expect(within(row(sev)).queryByText('15')).toBeNull();
    expect(within(row(other)).getByText(other === 'critical' ? '2' : '4')).toBeTruthy();
  });

  it('none: "No SLA policy yet", never the invalid message', () => {
    render(<KpiTiles {...ovProps({ summary: statuses('none') })} />);
    expect(screen.getByTestId(`kpi-sla-${sev}-state`).textContent).toBe('No SLA policy yet');
    expect(screen.queryByText("SLA policy can't be read")).toBeNull();
  });

  // Revert: check slaStatus before slaPolicyInvalid (an invalid policy then reads as merely empty).
  it('invalid: "!" icon and "SLA policy can\'t be read" in red, never "No SLA policy yet"', () => {
    render(<KpiTiles {...ovProps({ summary: { ...statuses('none'), slaPolicyInvalid: true } })} />);
    const invalid = screen.getByTestId(`kpi-sla-${sev}-state`);
    expect(invalid.textContent).toBe("!SLA policy can't be read");
    expect(invalid.className).toContain('text-red-400');
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });
});

describe('state wording and tone', () => {
  // Revert: let slaStatus win over slaPolicyInvalid.
  it('an invalid policy reads as unreadable on BOTH rows (it parses to an empty policy, so slaStatus says none)', () => {
    render(<KpiTiles {...ovProps({ summary: { ...sla('none', 'none'), slaPolicyInvalid: true } })} />);
    for (const sev of ['critical', 'high'] as const) {
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).textContent).toContain("SLA policy can't be read");
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).className).toContain('text-red-400');
    }
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  it('an empty policy reads "No SLA policy yet" on both rows, in grey', () => {
    render(<KpiTiles {...ovProps({ summary: sla('none', 'none') })} />);
    for (const sev of ['critical', 'high'] as const) {
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).textContent).toBe('No SLA policy yet');
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).className).toContain('text-gray-400');
    }
  });

  it('every non-active state carries an explanation in its title', () => {
    render(<KpiTiles {...ovProps({ summary: sla('pending', 'none') })} />);
    expect(screen.getByTestId('kpi-sla-critical-state').getAttribute('title')).toMatch(/not started yet/);
    expect(screen.getByTestId('kpi-sla-high-state').getAttribute('title')).toMatch(/No SLA policy is configured/);
  });
});

describe('hidden severity', () => {
  // Revert: dim by something other than the Severity filter, or drop the dimming.
  it('keeps the row of a severity the filter hides and dims it to 35%', () => {
    const { rerender } = render(<KpiTiles {...ovProps({ summary: sla('active', 'active'), url: { severity: 'critical', kSev: 'critical' } })} />);
    expect(row('high').className).toContain('opacity-[0.35]');
    expect(row('critical').className).not.toContain('opacity-[0.35]');
    expect(within(row('high')).getByText('13')).toBeTruthy();
    rerender(<KpiTiles {...ovProps({ summary: sla('active', 'active'), url: { severity: 'high', kSev: 'high' } })} />);
    expect(row('critical').className).toContain('opacity-[0.35]');
    expect(row('high').className).not.toContain('opacity-[0.35]');
    rerender(<KpiTiles {...ovProps({ summary: sla('active', 'active') })} />);
    expect(row('critical').className).not.toContain('opacity-[0.35]');
    expect(row('high').className).not.toContain('opacity-[0.35]');
  });
});

describe('the info button', () => {
  // Revert: call openDrawer() with no argument (focus would not return to the button on close).
  it('opens the coverage and policy drawer, passing the button so focus can return to it', () => {
    const p = ovProps();
    render(<KpiTiles {...p} />);
    const button = screen.getByRole('button', { name: 'Coverage and policy details' });
    fireEvent.click(button);
    expect(p.openDrawer).toHaveBeenCalledTimes(1);
    expect(p.openDrawer).toHaveBeenCalledWith(button);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-sla.test.tsx --maxWorkers=3`
Expected: FAIL, all 13 tests, `Unable to find an element by: [data-testid="kpi-sla-critical"]` (or the "Coverage and policy details" button).

- [ ] **Step 3: Implement**

In `src/app/vulnerabilities/kpi-tiles.tsx`, replace the import block above `const TILE` with:

```tsx
// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H, TYPE } from './dimensions';
import { slaState, slaStateLabel, type SlaState } from './sla-state';
import type { Severity } from '@/lib/vulnerabilities/types';
import { dash, deltaBaselineCaption, resolvedCaption, signed } from './format';
import { baselineUnavailableText, carriedFootnote, carriedTitle, openChange, shortDate, usableTotal } from './overview-format';
import Sparkline, { sparkPoints } from './sparkline';
```

Add these declarations and functions directly above `export default function KpiTiles`:

```tsx
const SLA_TIP: Record<Exclude<SlaState['kind'], 'active'>, string> = {
  pending: 'An SLA policy exists for this severity, but it has not started yet.',
  none: 'No SLA policy is configured for this severity.',
  invalid: "The SLA policy configuration doesn't parse. Check the deployment configuration.",
};

/** The badge column has a fixed width so both rows and the header line up whatever the row shows. */
const SLA_COLS = '40px minmax(0, 1fr) minmax(0, 1fr)';

const SLA_BADGE: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'CRIT', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-400' },
};

/** One severity's row: Overdue and Due ≤ 7d while its policy is active, otherwise its state, spanning both columns. */
function SlaRow({ sev, summary, dimmed }: { sev: Severity; summary: SecurityViewProps['summary']; dimmed: boolean }) {
  const st = slaState(sev, summary);
  const cell = summary.pivot.total[sev];
  const badge = SLA_BADGE[sev];
  return (
    <div
      data-testid={`kpi-sla-${sev}`}
      className={`grid h-7 items-center gap-x-2${dimmed ? ' opacity-[0.35]' : ''}`}
      style={{ gridTemplateColumns: SLA_COLS }}
    >
      <span className={`w-fit rounded px-1.5 text-[10px] font-semibold leading-4 tracking-wide ${badge.cls}`}>{badge.label}</span>
      {st.kind === 'active' ? (
        <>
          <span className={`text-right text-lg font-semibold tabular-nums ${cell.overdue ? 'text-red-400' : 'text-white'}`}>{dash(cell.overdue)}</span>
          <span className="text-right text-lg font-semibold tabular-nums text-white">{dash(cell.dueSoon)}</span>
        </>
      ) : (
        <span
          data-testid={`kpi-sla-${sev}-state`}
          className={`col-span-2 truncate text-right text-sm ${st.kind === 'invalid' ? 'font-semibold text-red-400' : st.kind === 'pending' ? 'text-gray-300' : 'text-gray-400'}`}
          title={SLA_TIP[st.kind]}
        >
          {st.kind === 'invalid' && <span aria-hidden="true" className="mr-1 inline-block rounded-full bg-red-400 px-1.5 text-[10px] leading-4 text-gray-900">!</span>}
          {slaStateLabel(st)}
        </span>
      )}
    </div>
  );
}

function SlaTile({ summary, url, openDrawer }: SecurityViewProps) {
  const shown = (sev: Severity) => url.severity === 'both' || url.severity === sev;
  return (
    <div data-testid="kpi-sla" className={TILE}>
      <div className="flex items-center justify-between gap-2">
        <div className={LABEL}>SLA · open alerts</div>
        <button
          type="button" aria-label="Coverage and policy details" title="Coverage and policy details"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-600 text-[11px] leading-none text-gray-400 hover:text-white"
          onClick={e => openDrawer(e.currentTarget)}
        >
          i
        </button>
      </div>
      <div className="mt-1">
        <div className="grid items-center gap-x-2" style={{ gridTemplateColumns: SLA_COLS }}>
          <span />
          <span className={`${TYPE.tableHeader} text-right text-gray-500`}>Overdue</span>
          <span className={`${TYPE.tableHeader} text-right text-gray-500`}>Due ≤ 7d</span>
        </div>
        <SlaRow sev="critical" summary={summary} dimmed={!shown('critical')} />
        <SlaRow sev="high" summary={summary} dimmed={!shown('high')} />
      </div>
    </div>
  );
}
```

Replace `KpiTiles` with the final version:

```tsx
export default function KpiTiles(props: SecurityViewProps) {
  const stale = props.data.summary.stale;
  return (
    <section
      aria-label="Key figures"
      data-testid="kpi-tiles"
      className={`grid gap-4${stale ? ' opacity-60' : ''}`}
      style={{ height: KPI_ROW_H, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
    >
      <OpenTile {...props} />
      <SinceTile {...props} />
      <ResolvedTile {...props} />
      <SlaTile {...props} />
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-kpi-sla.test.tsx src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx src/lib/__tests__/unit/vuln-kpi-since.test.tsx src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/kpi-tiles.tsx src/lib/__tests__/unit/vuln-kpi-sla.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: KPI SLA tile"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.7: Ownership rules (`ownership-model.ts`)

**Files:**
- Create: `src/app/vulnerabilities/ownership-model.ts`
- Test: `src/lib/__tests__/unit/vuln-ownership-model.test.ts`

**Interfaces:**
- Consumes: `DeltaResult`, `RepoRow`, `TeamRow` from `@/lib/vulnerabilities/aggregate`; `Severity`; `SeverityFilter` from `security-state.ts`; fixtures `cell`, `repoRow`, `ovCell`, `ovTeam`, `ovDelta`, `ovDeltaTeam`, `ovNoBaseline`.
- Produces: `SortDir`, `SortState<K>`; `nextSort(cur, key, first)`; `sortGlyph(active)`; `sevShown(filter, sev)`; team table: `TeamSortKey`, `TEAM_SORT_FIRST`, `teamKeySeverity`, `deltaOpenFor(delta, team)`, `orderTeamRows(rows, sort, deltas, severity)`; repositories table: `RepoSortKey`, `REPO_SORT_FIRST`, `repoKeySeverity`, `NextDue`, `RepoDisplay`, `repoDisplay(row, severity)`, `buildRepoView(rows, severity, sort, nameFilter): { measured, unmeasured }`, `repoTotals(measured, unmeasured = [])`, `unmeasuredReason(u)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-ownership-model.test.ts`:

```ts
// src/lib/__tests__/unit/vuln-ownership-model.test.ts
// The ownership card's pure rules: hidden severity, header sorting, repository rows under Severity.
import {
  buildRepoView, deltaOpenFor, nextSort, orderTeamRows, repoDisplay, repoTotals, sevShown, sortGlyph, unmeasuredReason,
  type RepoSortKey, type SortState, type TeamSortKey,
} from '@/app/vulnerabilities/ownership-model';
import { cell, ovCell, ovDelta, ovDeltaTeam, ovNoBaseline, ovTeam, repoRow } from '../support/security-fixtures';

const names = (rows: Array<{ team: string }>) => rows.map(r => r.team);
const repoNames = (v: ReturnType<typeof buildRepoView>) => [...v.measured.map(d => d.row.fullName), ...v.unmeasured.map(r => r.fullName)];

describe('nextSort and sevShown', () => {
  it('a new key starts in its own direction; the same key flips', () => {
    expect(nextSort(null, 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(null, 'openCrit', 'desc')).toEqual({ key: 'openCrit', dir: 'desc' });
    expect(nextSort({ key: 'openCrit', dir: 'desc' }, 'openCrit', 'desc')).toEqual({ key: 'openCrit', dir: 'asc' });
    expect(nextSort({ key: 'openCrit', dir: 'asc' }, 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' });
  });

  // Revert: treat "both" as hiding something, or invert the test.
  it('Severity hides only the other severity', () => {
    expect(sevShown('both', 'critical') && sevShown('both', 'high')).toBe(true);
    expect([sevShown('critical', 'critical'), sevShown('critical', 'high')]).toEqual([true, false]);
    expect([sevShown('high', 'critical'), sevShown('high', 'high')]).toEqual([false, true]);
  });
});

describe('sortGlyph', () => {
  // Revert: drop the variation selector (macOS then paints ↕ as a blue emoji box).
  it('↕ as a text glyph when inactive, ↑ ascending, ↓ descending', () => {
    expect(sortGlyph(null)).toBe('↕\uFE0E');
    expect(sortGlyph({ key: 'name', dir: 'asc' })).toBe('↑');
    expect(sortGlyph({ key: 'name', dir: 'desc' })).toBe('↓');
  });
});

describe('deltaOpenFor', () => {
  it('reads a team, the Total row, and null for a team missing from an available delta or an unavailable delta', () => {
    const d = ovDelta(ovDeltaTeam('Total', 9), { teams: [ovDeltaTeam('Payments', 12)] });
    expect(deltaOpenFor(d, 'Payments')).toBe(12);
    expect(deltaOpenFor(d, 'Total')).toBe(9);
    expect(deltaOpenFor(d, 'Search')).toBeNull();
    expect(deltaOpenFor(ovNoBaseline(), 'Payments')).toBeNull();
    expect(deltaOpenFor(undefined, 'Payments')).toBeNull();
  });
});

describe('orderTeamRows', () => {
  const rows = [
    ovTeam('Alpha', ovCell(2, { resolved: 9, pctClosed: 80, overdue: 1 }), ovCell(7)),
    ovTeam('Beta', ovCell(5, { resolved: 1, pctClosed: 10, overdue: null }), ovCell(1)),
    ovTeam('Gamma', ovCell(5, { resolved: 4, pctClosed: null, overdue: 3 }), ovCell(4)),
  ];
  const deltas = { critical: ovDelta(ovDeltaTeam('Total', 0), { teams: [ovDeltaTeam('Alpha', -2), ovDeltaTeam('Beta', 4)] }), high: ovNoBaseline() };
  const order = (sort: SortState<TeamSortKey> | null, severity: 'both' | 'critical' | 'high' = 'both') => names(orderTeamRows(rows, sort, deltas, severity));

  it('with no active header it keeps the server order, and under "High only" orders by high open', () => {
    expect(order(null)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(order(null, 'high')).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  // Revert: ignore the direction, or break ties by something other than the name.
  it('sorts a column in either direction, ties by name', () => {
    expect(order({ key: 'cOpen', dir: 'desc' })).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(order({ key: 'cOpen', dir: 'asc' })).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(order({ key: 'name', dir: 'desc' })).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  // Revert: put nulls first when ascending.
  it('nulls (no overdue figure, no % closed, no delta) sort last in BOTH directions', () => {
    expect(order({ key: 'cOverdue', dir: 'desc' })).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(order({ key: 'cOverdue', dir: 'asc' })).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(order({ key: 'cPct', dir: 'asc' })).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(order({ key: 'cChange', dir: 'desc' })).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(order({ key: 'cChange', dir: 'asc' })).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  // Revert: sort by a hidden severity's column.
  it('a sort on a hidden severity\'s column is ignored (that column reads "–")', () => {
    expect(order({ key: 'hOpen', dir: 'desc' }, 'critical')).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(order({ key: 'hOpen', dir: 'desc' }, 'both')).toEqual(['Alpha', 'Gamma', 'Beta']);
  });
});

describe('repoDisplay', () => {
  const r = repoRow('acme/checkout-api', 'Payments', {
    critical: cell({ open: 3, overdue: 1, dueSoon: 0, oldestOpenDays: 20, nextDue: { date: '2026-10-05', daysRemaining: 5 } }),
    high: cell({ open: 4, overdue: 2, dueSoon: 1, oldestOpenDays: 90, nextDue: { date: '2026-10-02', daysRemaining: 2 } }),
  });

  it('combines the shown severities: open sum, oldest = max, next due = earliest', () => {
    const d = repoDisplay(r, 'both');
    expect([d.open, d.oldest, d.next]).toEqual([7, 90, { date: '2026-10-02', daysRemaining: 2 }]);
  });

  // Revert: ignore Severity in the combination.
  it('leaves a hidden severity out of the combination', () => {
    expect(repoDisplay(r, 'critical')).toMatchObject({ open: 3, oldest: 20, next: { date: '2026-10-05', daysRemaining: 5 } });
    expect(repoDisplay(r, 'high')).toMatchObject({ open: 4, oldest: 90, next: { date: '2026-10-02', daysRemaining: 2 } });
  });

  it('a repository with nothing open has no oldest and no next due', () => {
    expect(repoDisplay(repoRow('acme/quiet', 'Search'), 'both')).toMatchObject({ open: 0, oldest: null, next: null, overCrit: null });
  });
});

describe('buildRepoView', () => {
  const rows = [
    repoRow('acme/a-api', 'Payments', { critical: cell({ open: 1, overdue: 0, oldestOpenDays: 5 }), high: cell({ open: 9, overdue: 2, oldestOpenDays: 50 }) }),
    repoRow('acme/b-web', 'Search', { critical: cell({ open: 4, overdue: 1, oldestOpenDays: 30 }), high: cell({ open: 0, overdue: 0 }) }),
    repoRow('acme/c-batch', 'Platform', { critical: cell({ open: 4, overdue: 3, oldestOpenDays: null }), high: cell({ open: 2, overdue: 0 }) }),
    repoRow('acme/z-quiet', 'Payments'),
    repoRow('acme/legacy', 'Platform', { critical: cell({ open: 8 }), unmeasured: { status: 'dependabot-off', detail: null } }),
    repoRow('acme/ancient', 'Platform', { critical: cell({ open: 2 }), unmeasured: { status: 'error', detail: 'HTTP 500' } }),
  ];
  const view = (sort: SortState<RepoSortKey> | null, severity: 'both' | 'critical' | 'high' = 'both', q = '') => buildRepoView(rows, severity, sort, q);

  it('default order is the server order (critical open, high open, name), unmeasured last by name', () => {
    expect(repoNames(view(null))).toEqual(['acme/c-batch', 'acme/b-web', 'acme/a-api', 'acme/z-quiet', 'acme/ancient', 'acme/legacy']);
  });

  // Revert: order by the hidden severity.
  it('a single shown severity orders by that severity alone', () => {
    expect(repoNames(view(null, 'high'))).toEqual(['acme/a-api', 'acme/c-batch', 'acme/b-web', 'acme/z-quiet', 'acme/ancient', 'acme/legacy']);
    expect(repoNames(view(null, 'critical'))).toEqual(['acme/b-web', 'acme/c-batch', 'acme/a-api', 'acme/z-quiet', 'acme/ancient', 'acme/legacy']);
  });

  // Revert: sort the unmeasured rows with the rest, or put them first when descending.
  it('unmeasured rows ignore sorting and stay last in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const out = repoNames(view({ key: 'openCrit', dir }));
      expect(out.slice(-2)).toEqual(['acme/ancient', 'acme/legacy']);
    }
    expect(repoNames(view({ key: 'name', dir: 'desc' }))).toEqual(['acme/z-quiet', 'acme/c-batch', 'acme/b-web', 'acme/a-api', 'acme/ancient', 'acme/legacy']);
  });

  it('sorts a numeric column, ties by name, with nulls last in both directions', () => {
    expect(repoNames(view({ key: 'oldest', dir: 'desc' })).slice(0, 4)).toEqual(['acme/a-api', 'acme/b-web', 'acme/c-batch', 'acme/z-quiet']);
    expect(repoNames(view({ key: 'oldest', dir: 'asc' })).slice(0, 4)).toEqual(['acme/b-web', 'acme/a-api', 'acme/c-batch', 'acme/z-quiet']);
    expect(repoNames(view({ key: 'overCrit', dir: 'desc' })).slice(0, 3)).toEqual(['acme/c-batch', 'acme/b-web', 'acme/a-api']);
  });

  // Revert: honour a sort on a hidden severity's column.
  it('a sort on a hidden severity\'s column is ignored', () => {
    expect(repoNames(view({ key: 'openHigh', dir: 'desc' }, 'critical'))).toEqual(repoNames(view(null, 'critical')));
  });

  it('the name filter is case-insensitive and applies to measured and unmeasured rows', () => {
    expect(repoNames(view(null, 'both', ' LEGA'))).toEqual(['acme/legacy']);
    expect(repoNames(view(null, 'both', 'b-'))).toEqual(['acme/b-web']);
    expect(repoNames(view(null, 'both', 'nothing-matches'))).toEqual([]);
  });
});

describe('repoTotals', () => {
  const rows = [
    repoRow('acme/a', 'Payments', { critical: cell({ open: 3, overdue: 1, oldestOpenDays: 10, nextDue: { date: '2026-10-09', daysRemaining: 9 } }), high: cell({ open: 1, overdue: null }) }),
    repoRow('acme/b', 'Payments', { critical: cell({ open: 2, overdue: 0, oldestOpenDays: 40 }), high: cell({ open: 0, overdue: null }) }),
    repoRow('acme/c', 'Payments', { critical: cell({ open: 50, overdue: 50 }), unmeasured: { status: 'error', detail: null } }),
  ];

  // Revert: drop the `unmeasured = []` default, or sum rows other than the ones passed.
  it('with only the measured rows passed, it sums those rows', () => {
    const t = repoTotals(buildRepoView(rows, 'both', null, '').measured);
    expect(t).toMatchObject({ count: 2, openCrit: 5, openHigh: 1, overCrit: 1, oldest: 40, next: { date: '2026-10-09', daysRemaining: 9 } });
  });

  // Revert: sum only the measured rows (the footer then disagrees with the team table and the strip).
  it('with the unmeasured rows passed too, open and overdue include their stored counts; count, oldest and next due do not', () => {
    const v = buildRepoView(rows, 'both', null, '');
    const t = repoTotals(v.measured, v.unmeasured.map(r => repoDisplay(r, 'both')));
    expect(t).toMatchObject({ count: 2, openCrit: 55, openHigh: 1, overCrit: 51, oldest: 40, next: { date: '2026-10-09', daysRemaining: 9 } });
  });

  it('an inactive SLA keeps overdue null rather than summing nulls to zero', () => {
    expect(repoTotals(buildRepoView(rows, 'both', null, '').measured).overHigh).toBeNull();
  });

  it('no rows: zero count, nothing oldest, nothing due', () => {
    expect(repoTotals([])).toEqual({ count: 0, openCrit: 0, openHigh: 0, overCrit: null, overHigh: null, oldest: null, next: null });
  });
});

describe('unmeasuredReason', () => {
  it('names the reason in capitals', () => {
    expect(unmeasuredReason({ status: 'dependabot-off', detail: null })).toBe('DEPENDABOT OFF');
    expect(unmeasuredReason({ status: 'error', detail: 'x' })).toBe('STATUS CHECK FAILED');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-ownership-model.test.ts --maxWorkers=3`
Expected: FAIL, `Cannot find module '@/app/vulnerabilities/ownership-model'`.

- [ ] **Step 3: Implement**

Create `src/app/vulnerabilities/ownership-model.ts`:

```ts
// src/app/vulnerabilities/ownership-model.ts
// GLOOK-64: the ownership card's pure logic. Which severities are visible, how the two tables sort,
// and what each repository row shows once Severity is applied. No React and no server imports, so
// the rules are tested without a DOM and the two table components stay thin.
import type { DeltaResult, RepoRow, TeamRow } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { SeverityFilter } from './security-state';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K; dir: SortDir }

/** A header click: the active key flips direction, any other key starts in its own first direction. */
export function nextSort<K extends string>(cur: SortState<K> | null, key: K, first: SortDir): SortState<K> {
  if (cur && cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: first };
}

/**
 * The glyph beside a sortable header: ↕ when it is not the active sort, ↑ or ↓ when it is. The
 * variation selector (U+FE0E) keeps ↕ a text glyph: without it macOS draws it as a coloured emoji.
 */
export const sortGlyph = (active: SortState<string> | null): string => (active ? (active.dir === 'asc' ? '↑' : '↓') : '↕\uFE0E');

/** A severity is shown unless the Severity filter names the other one. */
export const sevShown = (filter: SeverityFilter, sev: Severity): boolean => filter === 'both' || filter === sev;

/** null last in both directions, then the caller's tie-break. */
function compareValues(a: string | number | null, b: string | number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const c = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : a - b;
  return dir === 'asc' ? c : -c;
}

// ── Team table ─────────────────────────────────────────────────────────────────────────────────────

export type TeamSortKey =
  | 'name'
  | 'cOpen' | 'cChange' | 'cResolved' | 'cPct' | 'cOverdue'
  | 'hOpen' | 'hChange' | 'hResolved' | 'hPct' | 'hOverdue';

/** Names start ascending; every number column starts with its largest value first. */
export const TEAM_SORT_FIRST: Record<TeamSortKey, SortDir> = {
  name: 'asc',
  cOpen: 'desc', cChange: 'desc', cResolved: 'desc', cPct: 'desc', cOverdue: 'desc',
  hOpen: 'desc', hChange: 'desc', hResolved: 'desc', hPct: 'desc', hOverdue: 'desc',
};

/** The severity a sort key belongs to; null for the name column. */
export const teamKeySeverity = (key: TeamSortKey): Severity | null => (key === 'name' ? null : key[0] === 'c' ? 'critical' : 'high');

/** A team's change in open alerts since the baseline, or null when the delta has none for it. */
export function deltaOpenFor(d: DeltaResult | null | undefined, team: string): number | null {
  if (!d || !d.available) return null;
  const t = team === 'Total' ? d.total : d.teams.find(x => x.team === team);
  return t ? t.deltaOpen : null;
}

export interface TeamDeltas { critical: DeltaResult | null | undefined; high: DeltaResult | null | undefined }

function teamValue(r: TeamRow, key: TeamSortKey, deltas: TeamDeltas): string | number | null {
  const cell = key[0] === 'h' ? r.high : r.critical;
  const d = key[0] === 'h' ? deltas.high : deltas.critical;
  switch (key) {
    case 'name': return r.team;
    case 'cOpen': case 'hOpen': return cell.open;
    case 'cChange': case 'hChange': return deltaOpenFor(d, r.team);
    case 'cResolved': case 'hResolved': return cell.resolved;
    case 'cPct': case 'hPct': return cell.pctClosed;
    case 'cOverdue': case 'hOverdue': return cell.overdue;
  }
}

/**
 * The team rows in display order. With no active header the order is the server's (critical open
 * descending), except under "High only", where it is high open descending. A sort on a column of a
 * hidden severity is ignored, because that column reads "–".
 */
export function orderTeamRows(rows: readonly TeamRow[], sort: SortState<TeamSortKey> | null, deltas: TeamDeltas, severity: SeverityFilter): TeamRow[] {
  const active = sort && (teamKeySeverity(sort.key) === null || sevShown(severity, teamKeySeverity(sort.key)!)) ? sort : null;
  const out = [...rows];
  if (active) {
    return out.sort((a, b) => compareValues(teamValue(a, active.key, deltas), teamValue(b, active.key, deltas), active.dir) || a.team.localeCompare(b.team));
  }
  if (severity === 'high') return out.sort((a, b) => b.high.open - a.high.open || a.team.localeCompare(b.team));
  return out;
}

// ── Repositories table ─────────────────────────────────────────────────────────────────────────────

export type RepoSortKey = 'name' | 'team' | 'openCrit' | 'overCrit' | 'openHigh' | 'overHigh' | 'oldest' | 'next';

export const REPO_SORT_FIRST: Record<RepoSortKey, SortDir> = {
  name: 'asc', team: 'asc', next: 'asc',
  openCrit: 'desc', overCrit: 'desc', openHigh: 'desc', overHigh: 'desc', oldest: 'desc',
};

export const repoKeySeverity = (key: RepoSortKey): Severity | null =>
  key === 'openCrit' || key === 'overCrit' ? 'critical' : key === 'openHigh' || key === 'overHigh' ? 'high' : null;

export interface NextDue { date: string; daysRemaining: number }

/** One measured repository, with Severity applied: what its row and the footer totals read. */
export interface RepoDisplay {
  row: RepoRow;
  /** Open alerts under Severity: the sum over the shown severities. Zero greys the row. */
  open: number;
  openCrit: number;
  openHigh: number;
  /** Null unless that severity's SLA is active. */
  overCrit: number | null;
  overHigh: number | null;
  /** Oldest open alert in days, over the shown severities; null when none. */
  oldest: number | null;
  /** The earliest upcoming due date, over the shown severities with an active SLA; null when none. */
  next: NextDue | null;
}

export function repoDisplay(row: RepoRow, severity: SeverityFilter): RepoDisplay {
  const crit = sevShown(severity, 'critical');
  const high = sevShown(severity, 'high');
  const shown = [crit ? row.critical : null, high ? row.high : null].filter((c): c is NonNullable<typeof c> => c !== null);
  const ages = shown.map(c => c.oldestOpenDays).filter((n): n is number => n !== null);
  const dues = shown.map(c => c.nextDue).filter((n): n is NextDue => n !== null).sort((a, b) => a.date.localeCompare(b.date));
  return {
    row,
    open: shown.reduce((n, c) => n + c.open, 0),
    openCrit: row.critical.open,
    openHigh: row.high.open,
    overCrit: row.critical.overdue,
    overHigh: row.high.overdue,
    oldest: ages.length ? Math.max(...ages) : null,
    next: dues[0] ?? null,
  };
}

export interface RepoView {
  /** Measured rows, in display order. */
  measured: RepoDisplay[];
  /** Unmeasured rows: always last, by name, never sorted. */
  unmeasured: RepoRow[];
}

function repoValue(d: RepoDisplay, key: RepoSortKey): string | number | null {
  switch (key) {
    case 'name': return d.row.fullName;
    case 'team': return d.row.team;
    case 'openCrit': return d.openCrit;
    case 'overCrit': return d.overCrit;
    case 'openHigh': return d.openHigh;
    case 'overHigh': return d.overHigh;
    case 'oldest': return d.oldest;
    case 'next': return d.next ? d.next.date : null;
  }
}

/**
 * Filter by name, apply Severity and sort. Unmeasured rows ignore sorting and come last. With no
 * active header the order is the server's (critical open, high open, name), except that a single
 * shown severity orders by that severity alone, so a hidden column never decides the order.
 */
export function buildRepoView(rows: readonly RepoRow[], severity: SeverityFilter, sort: SortState<RepoSortKey> | null, nameFilter: string): RepoView {
  const q = nameFilter.trim().toLowerCase();
  const matched = rows.filter(r => !q || r.fullName.toLowerCase().includes(q));
  const unmeasured = matched.filter(r => r.unmeasured).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const measured = matched.filter(r => !r.unmeasured).map(r => repoDisplay(r, severity));
  const keySev = sort ? repoKeySeverity(sort.key) : null;
  const active = sort && (keySev === null || sevShown(severity, keySev)) ? sort : null;
  if (active) {
    measured.sort((a, b) => compareValues(repoValue(a, active.key), repoValue(b, active.key), active.dir) || a.row.fullName.localeCompare(b.row.fullName));
  } else if (severity === 'high') {
    measured.sort((a, b) => b.openHigh - a.openHigh || a.row.fullName.localeCompare(b.row.fullName));
  } else if (severity === 'critical') {
    measured.sort((a, b) => b.openCrit - a.openCrit || a.row.fullName.localeCompare(b.row.fullName));
  } else {
    measured.sort((a, b) => b.openCrit - a.openCrit || b.openHigh - a.openHigh || a.row.fullName.localeCompare(b.row.fullName));
  }
  return { measured, unmeasured };
}

export interface RepoTotals {
  count: number;
  openCrit: number;
  openHigh: number;
  overCrit: number | null;
  overHigh: number | null;
  oldest: number | null;
  next: NextDue | null;
}

const sumOrNull = (vals: Array<number | null>): number | null => (vals.every(v => v === null) ? null : vals.reduce<number>((n, v) => n + (v ?? 0), 0));

/**
 * The footer row. Open and overdue sum EVERY row in view, unmeasured rows' stored counts included, so
 * the footer agrees with the team table, the Alerts strip, the rail and the Alerts tab. The rows
 * themselves still show an unmeasured count as unknown. `count`, oldest and next due are measured
 * rows only: they are not part of the sum invariant and a stored age or date may be out of date.
 */
export function repoTotals(measured: readonly RepoDisplay[], unmeasured: readonly RepoDisplay[] = []): RepoTotals {
  const all = [...measured, ...unmeasured];
  const ages = measured.map(d => d.oldest).filter((n): n is number => n !== null);
  const dues = measured.map(d => d.next).filter((n): n is NextDue => n !== null).sort((a, b) => a.date.localeCompare(b.date));
  return {
    count: measured.length,
    openCrit: all.reduce((n, d) => n + d.openCrit, 0),
    openHigh: all.reduce((n, d) => n + d.openHigh, 0),
    overCrit: sumOrNull(all.map(d => d.overCrit)),
    overHigh: sumOrNull(all.map(d => d.overHigh)),
    oldest: ages.length ? Math.max(...ages) : null,
    next: dues[0] ?? null,
  };
}

/** "UNMEASURED · DEPENDABOT OFF": the reason in capitals. */
export function unmeasuredReason(u: NonNullable<RepoRow['unmeasured']>): string {
  return u.status === 'dependabot-off' ? 'DEPENDABOT OFF' : 'STATUS CHECK FAILED';
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-ownership-model.test.ts --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (22 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/ownership-model.ts src/lib/__tests__/unit/vuln-ownership-model.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: ownership card sorting and repository rules"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.8: Owning teams table (`team-table.tsx`)

**Files:**
- Create: `src/app/vulnerabilities/team-table.tsx`
- Test: `src/lib/__tests__/unit/vuln-team-table.test.tsx`

**Interfaces:**
- Consumes: `SecurityViewProps` (`summary`, `data.teamSummary`, `url.severity`, `url.team`, `url.selectTeamRow`, `openDrawer`); `TEAM_ROW_H`, `TYPE`, `Z`; `dash`, `deltaBaselineCaption`, `resolvedCaption`; `baselineUnavailableText`, `carriedFootnote`, `carriedTitle` (3.1, 3.5); `slaActive`; `ownership-model.ts` (3.7).
- Produces: default export `TeamTable(props: SecurityViewProps)`. Root `data-testid="team-table"` (`h-full overflow-auto`, `opacity-60` while stale). Pinned header (`sticky top-0`, `bg-chart-surface`, `zIndex: Z.pinnedRows`) and pinned footer holding the Total row `team-total-row` and the † footnote `team-table-footnote`. Rows `team-row-{team}` (inline height `TEAM_ROW_H`). Bands `team-band-critical` / `team-band-high`. Error branch `team-table-error`. The card (3.10) gives it its height.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-team-table.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-team-table.test.tsx
// The ownership card's "Owning teams" tab (replaces vuln-team-pivot.test.tsx).
import { fireEvent, render, screen, within } from '@testing-library/react';
import TeamTable from '@/app/vulnerabilities/team-table';
import { TEAM_ROW_H, Z } from '@/app/vulnerabilities/dimensions';
import type { SummaryData } from '@/app/vulnerabilities/api-types';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
import {
  ovBaseline, ovCell, ovDelta, ovDeltaTeam, ovNoBaseline, ovProps, ovTeam, slot, summaryFixture,
} from '../support/security-fixtures';

const NBSP = '\u00a0';
const rowOf = (team: string) => screen.getByTestId(`team-row-${team}`);
const cellsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="cell"]')) as HTMLElement[];

const ROWS = [
  ovTeam('Payments', ovCell(6, { resolved: 4, dismissed: 1, pctClosed: 40, overdue: 2 }), ovCell(10, { resolved: 2, dismissed: 0, pctClosed: 17, overdue: null }), 2),
  ovTeam('Unassigned', ovCell(1, { overdue: null }), ovCell(0)),
];
const TOTAL = ovTeam('Total', ovCell(7, { resolved: 4, dismissed: 1, pctClosed: 36, overdue: 2 }), ovCell(10, { resolved: 2, pctClosed: 17 }), 2);
const pivot = (rows = ROWS, total = TOTAL) => ({ pivot: { rows, total } });
const table = (summary: Partial<SummaryData> = {}, url: Partial<SecurityViewProps['url']> = {}) =>
  ovProps({ summary: { ...pivot(), ...summary }, url });

describe('layout', () => {
  // Revert: drop the inline row height, the sticky positions or the layer, or use the card-shell class for the pinned rows.
  it('the header and the Total row are pinned inside the scrolling body, above the rows, on the chart surface', () => {
    render(<TeamTable {...table()} />);
    const root = screen.getByTestId('team-table');
    expect(root.className).toContain('overflow-auto');
    expect(root.className).toContain('h-full');
    const total = screen.getByTestId('team-total-row');
    const footer = total.parentElement as HTMLElement;
    expect(footer.className).toContain('sticky');
    expect(footer.className).toContain('bottom-0');
    expect(footer.className).toContain('bg-chart-surface');
    expect(footer.className).not.toContain('bg-gray-900');
    expect(footer.style.zIndex).toBe(String(Z.pinnedRows));
    const head = (root.firstElementChild as HTMLElement);
    expect(head.className).toContain('sticky');
    expect(head.className).toContain('top-0');
    expect(head.className).toContain('bg-chart-surface');
    expect(head.style.zIndex).toBe(String(Z.pinnedRows));
  });

  it('team rows and the Total row are TEAM_ROW_H tall', () => {
    render(<TeamTable {...table()} />);
    expect(rowOf('Payments').style.height).toBe(`${TEAM_ROW_H}px`);
    expect(screen.getByTestId('team-total-row').style.height).toBe(`${TEAM_ROW_H}px`);
  });

  // Revert: size the columns by content (auto) instead of the shared grid template.
  it('the grid template is shared by every row and does not change with the baseline caption', () => {
    const { unmount } = render(<TeamTable {...table()} />);
    const templateOf = () => [rowOf('Payments'), screen.getByTestId('team-total-row')].map(r => r.style.gridTemplateColumns);
    const without = templateOf();
    expect(new Set(without).size).toBe(1);
    unmount();
    const delta = { critical: ovDelta(ovDeltaTeam('Total', 1), { baseline: ovBaseline('2099-01-01') }), high: ovNoBaseline() };
    render(<TeamTable {...table({ delta })} />);
    expect(templateOf()).toEqual(without);
  });

  it('numeric cells use tabular digits', () => {
    render(<TeamTable {...table()} />);
    for (const c of cellsOf(rowOf('Payments')).slice(1, 5)) expect(c.className).toContain('tabular-nums');
  });

  it('a long owning-team name ends in an ellipsis and keeps the full name in its title', () => {
    const long = 'A very long owning team name that cannot fit in the first column';
    render(<TeamTable {...table(pivot([ovTeam(long, ovCell(1), ovCell(0))]))} />);
    const name = screen.getByText(long);
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe(long);
  });
});

describe('data source', () => {
  const scoped = { pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1))], total: ovTeam('Total', ovCell(3), ovCell(1)) } };
  const everyone = summaryFixture({ pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1)), ovTeam('Search', ovCell(7), ovCell(2))], total: ovTeam('Total', ovCell(10), ovCell(3)) } });

  // Revert: read props.summary (the team-scoped one) instead of data.teamSummary.
  it('lists every team from the unfiltered summary while the page is scoped to one team, and highlights the selected one', () => {
    const p = ovProps({ summary: scoped, url: { team: 'Payments' }, teamSummary: slot(everyone) });
    render(<TeamTable {...p} />);
    expect(rowOf('Payments').className).toContain('bg-accent/10');
    expect(rowOf('Search').className).not.toContain('bg-accent/10');
    expect(within(screen.getByTestId('team-total-row')).getByText('10')).toBeTruthy();
  });

  // Revert: take the delta from props.summary instead of the unfiltered summary.
  it('the Change column follows the unfiltered response, not the team-scoped one', () => {
    const unfilteredDelta = ovDelta(ovDeltaTeam('Total', 7), { baseline: ovBaseline('2099-01-01'), teams: [ovDeltaTeam('Payments', 5), ovDeltaTeam('Search', 2)] });
    const scopedDelta = ovDelta(ovDeltaTeam('Total', 1), { baseline: ovBaseline('2099-02-02'), teams: [ovDeltaTeam('Payments', 1)] });
    const p = ovProps({ summary: { ...scoped, delta: { critical: scopedDelta, high: ovNoBaseline() } }, url: { team: 'Payments' }, teamSummary: slot({ ...everyone, delta: { critical: unfilteredDelta, high: ovNoBaseline() } }) });
    render(<TeamTable {...p} />);
    expect(screen.getByText('vs 2099-01-01')).toBeTruthy();
    expect(screen.queryByText('vs 2099-02-02')).toBeNull();
    expect(within(rowOf('Payments')).getByText('▲ 5')).toBeTruthy();
    expect(within(rowOf('Search')).getByText('▲ 2')).toBeTruthy();
    expect(within(screen.getByTestId('team-total-row')).getByText('▲ 7')).toBeTruthy();
  });

  // Revert: render nothing until teamSummary resolves.
  it('falls back to the scoped summary while the unfiltered one is still loading', () => {
    const p = ovProps({ summary: scoped, url: { team: 'Payments' }, teamSummary: slot<SummaryData>(undefined, { loading: true }) });
    render(<TeamTable {...p} />);
    expect(rowOf('Payments')).toBeTruthy();
  });

  // Revert: let the error propagate to the page or hide it.
  it('shows the unfiltered request\'s error inside the table and nothing else', () => {
    const p = ovProps({ teamSummary: slot<SummaryData>(undefined, { error: new Error('x'), errorText: "Couldn't load team table: x", loading: false }) });
    render(<TeamTable {...p} />);
    expect(screen.getByTestId('team-table-error').textContent).toBe("Couldn't load team table: x");
    expect(screen.queryByTestId('team-total-row')).toBeNull();
  });

  it('dims while it shows the previous key\'s rows', () => {
    render(<TeamTable {...ovProps({ summary: pivot(), teamSummary: slot(summaryFixture(pivot()), { stale: true }) })} />);
    expect(screen.getByTestId('team-table').className).toContain('opacity-60');
  });
});

describe('rows', () => {
  it('shows the CRITICAL and HIGH bands, the figures, and — for a missing percentage or overdue', () => {
    render(<TeamTable {...table()} />);
    expect(screen.getByTestId('team-band-critical').textContent).toBe('CRITICAL');
    expect(screen.getByTestId('team-band-high').textContent).toBe('HIGH');
    const payments = cellsOf(rowOf('Payments')).map(c => c.textContent);
    expect(payments[0]).toContain('Payments');
    expect(payments[1]).toBe('6');
    expect(payments[3]).toContain('4');
    expect(payments[4]).toBe('40%');
    expect(cellsOf(rowOf('Unassigned')).some(c => c.textContent === '—')).toBe(true);
  });

  // Revert: put the dismissed count only in the cell text, or drop the title.
  it('the Resolved cell shows the dismissed count and carries it in its title', () => {
    render(<TeamTable {...table()} />);
    expect(within(rowOf('Payments')).getByTitle('of which dismissed: 1')).toBeTruthy();
    expect(within(rowOf('Payments')).getByText('(1)')).toBeTruthy();
  });

  // Revert: put the owning-team header text or its tooltip back to "Team".
  it('the first header reads "Owning team" and says it is not a Glooker team', () => {
    render(<TeamTable {...table()} />);
    const header = screen.getByRole('columnheader', { name: /Owning team/ });
    expect(header.getAttribute('title')).toBe("The repository's team custom property — not a Glooker team");
  });
});

describe('unmeasured badge', () => {
  // Revert: put the badge in the critical Open cell, or let the click reach the row.
  it('sits under the team name, opens the drawer with the button, and does not select the team', () => {
    const p = table();
    render(<TeamTable {...p} />);
    const badge = within(rowOf('Payments')).getByRole('button', { name: /2 unmeasured/ });
    expect(cellsOf(rowOf('Payments'))[0].contains(badge)).toBe(true);
    fireEvent.click(badge);
    expect(p.openDrawer).toHaveBeenCalledWith(badge);
    expect(p.url.selectTeamRow).not.toHaveBeenCalled();
  });

  it('appears only for a team with unmeasured repositories, and on the Total row with the total', () => {
    render(<TeamTable {...table()} />);
    expect(within(rowOf('Unassigned')).queryByText(/unmeasured/)).toBeNull();
    expect(within(screen.getByTestId('team-total-row')).getByText('▲ 2 unmeasured')).toBeTruthy();
  });
});

describe('change column', () => {
  const total = ovDeltaTeam('Total', 9);
  const avail = ovDelta(total, { teams: [ovDeltaTeam('Payments', 12), ovDeltaTeam('Unassigned', -3)] });

  // Revert: colour by sign the other way, or drop the arrows.
  it('a rise is red with ▲, a fall is green with ▼, no change is a grey 0', () => {
    render(<TeamTable {...table({ delta: { critical: ovDelta(total, { teams: [ovDeltaTeam('Payments', 12), ovDeltaTeam('Unassigned', -3), ovDeltaTeam('Search', 0)] }), high: ovNoBaseline() } }, {})} />);
    expect(within(rowOf('Payments')).getByText('▲ 12').className).toContain('text-red-400');
    expect(within(rowOf('Unassigned')).getByText('▼ 3').className).toContain('text-green-400');
  });

  it('the Total row shows the delta total', () => {
    render(<TeamTable {...table({ delta: { critical: avail, high: ovNoBaseline() } })} />);
    expect(within(screen.getByTestId('team-total-row')).getByText('▲ 9')).toBeTruthy();
  });

  // Revert: render 0 or blank for a team absent from an available delta.
  it('a team missing from an available delta reads —', () => {
    const d = ovDelta(total, { teams: [ovDeltaTeam('Unassigned', 1)] });
    render(<TeamTable {...table({ delta: { critical: d, high: ovNoBaseline() } })} />);
    expect(cellsOf(rowOf('Payments'))[2].textContent).toBe('—');
  });

  // Revert: reuse the same span node so only its text changes.
  it('the value is a NEW node when its text changes (a baseline switch does not move a right-aligned figure)', () => {
    const withDelta = (n: number) => table({ delta: { critical: ovDelta(total, { teams: [ovDeltaTeam('Payments', n)] }), high: ovNoBaseline() } });
    const { rerender } = render(<TeamTable {...withDelta(12)} />);
    const before = within(rowOf('Payments')).getByText('▲ 12');
    rerender(<TeamTable {...withDelta(5)} />);
    const after = within(rowOf('Payments')).getByText('▲ 5');
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });
});

describe('header captions', () => {
  const baseline = (takenOn: string) => ovBaseline(takenOn);

  // Revert: share one caption between the two severities.
  it('shows "vs <date>" under both Change headers, and under one only when the other is unavailable', () => {
    const both = { critical: ovDelta(ovDeltaTeam('Total', 1), { baseline: baseline('2099-01-01') }), high: ovDelta(ovDeltaTeam('Total', 1), { baseline: baseline('2099-01-01') }) };
    const { unmount } = render(<TeamTable {...table({ delta: both })} />);
    expect(screen.getAllByText('vs 2099-01-01')).toHaveLength(2);
    unmount();
    const oneOnly = { critical: both.critical, high: ovDelta(null, { baseline: baseline('2099-01-01') }) };
    render(<TeamTable {...table({ delta: oneOnly })} />);
    expect(screen.getAllByText('vs 2099-01-01')).toHaveLength(1);
    expect(screen.getByText('No measurement on or before Jan 1')).toBeTruthy();
  });

  it('with no baseline at all both headers say "No earlier measurement yet" (and the slot is never empty)', () => {
    render(<TeamTable {...table({ delta: { critical: ovNoBaseline(), high: ovNoBaseline() } })} />);
    expect(screen.getAllByText('No earlier measurement yet')).toHaveLength(2);
  });

  // Revert: change Resolved's title from the shared resolvedCaption.
  it('the Resolved header names the start date, "all time" or an invalid date in its title', () => {
    const cases: Array<[SummaryData['resolvedSince'], string]> = [
      [{ date: '2020-01-08', invalid: false }, 'Resolved since 2020-01-08'],
      [{ date: null, invalid: false }, 'Resolved all time'],
      [{ date: null, invalid: true }, 'Resolved since —'],
    ];
    for (const [resolvedSince, title] of cases) {
      const { unmount } = render(<TeamTable {...table({ resolvedSince })} />);
      expect(screen.getAllByRole('columnheader').filter(h => h.getAttribute('title') === title)).toHaveLength(2);
      unmount();
    }
  });
});

describe('Overdue columns per SLA state', () => {
  const policy = (severity: 'critical' | 'high', pending: boolean) => ({ id: `${severity}-1`, severity, days: 7, effectiveFrom: '2026-11-01', until: null, pending });
  const overdueHeaders = () => screen.queryAllByRole('columnheader').filter(h => h.textContent?.startsWith('Overdue')).length;

  // Revert: render an Overdue column whatever the state, or key it off anything but slaActive.
  it.each([
    ['active', { critical: 'active', high: 'active' }, [policy('critical', false), policy('high', false)], false, 2],
    ['critical only active', { critical: 'active', high: 'none' }, [policy('critical', false)], false, 1],
    ['pending', { critical: 'pending', high: 'pending' }, [policy('critical', true), policy('high', true)], false, 0],
    ['none', { critical: 'none', high: 'none' }, [], false, 0],
    ['invalid (parses as none)', { critical: 'none', high: 'none' }, [], true, 0],
    ['invalid wins over a stale active status', { critical: 'active', high: 'active' }, [policy('critical', false), policy('high', false)], true, 0],
  ] as const)('%s: %i Overdue headers', (_name, slaStatus, pol, invalid, count) => {
    render(<TeamTable {...table({ slaStatus: slaStatus as SummaryData['slaStatus'], policy: pol as unknown as SummaryData['policy'], slaPolicyInvalid: invalid })} />);
    expect(overdueHeaders()).toBe(count);
    // The cells follow the headers: a row has 1 (name) + 4 per group + one per active Overdue column.
    expect(cellsOf(rowOf('Payments'))).toHaveLength(1 + 8 + count);
  });

  it('an overdue count above zero is bold red, zero is grey', () => {
    render(<TeamTable {...table({ pivot: { rows: [ovTeam('Payments', ovCell(5, { overdue: 2 }), ovCell(1, { overdue: 0 }))], total: TOTAL }, slaStatus: { critical: 'active', high: 'active' } })} />);
    const cells = cellsOf(rowOf('Payments'));
    expect(cells[5].textContent).toBe('2');
    expect(cells[5].className).toContain('text-red-400');
    expect(cells[10].textContent).toBe('0');
    expect(cells[10].className).not.toContain('text-red-400');
  });
});

describe('hidden severity', () => {
  // Revert: leave the hidden severity's figures in, or use the em dash.
  it('"High only" shows – (en dash) in every critical column, the Total row included, and dims its headers to 35%', () => {
    render(<TeamTable {...table({ slaStatus: { critical: 'active', high: 'active' } }, { severity: 'high', kSev: 'high' })} />);
    for (const row of [rowOf('Payments'), screen.getByTestId('team-total-row')]) {
      const cells = cellsOf(row);
      expect(cells.slice(1, 6).map(c => c.textContent)).toEqual(['–', '–', '–', '–', '–']);
      expect(cells.slice(6, 10).map(c => c.textContent)).not.toContain('–');
    }
    expect(screen.getByTestId('team-band-critical').className).toContain('opacity-[0.35]');
    expect(screen.getByTestId('team-band-high').className).not.toContain('opacity-[0.35]');
    const openCrit = screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith('Open'))!;
    expect(openCrit.className).toContain('opacity-[0.35]');
  });

  it('"Critical only" hides the high columns the same way', () => {
    render(<TeamTable {...table({}, { severity: 'critical', kSev: 'critical' })} />);
    expect(cellsOf(rowOf('Payments')).slice(-4).map(c => c.textContent)).toEqual(['–', '–', '–', '–']);
    expect(screen.getByTestId('team-band-high').className).toContain('opacity-[0.35]');
  });

  it('with both severities shown nothing is dimmed or replaced', () => {
    render(<TeamTable {...table()} />);
    expect(screen.queryAllByText('–')).toHaveLength(0);
    expect(document.querySelector('.opacity-\\[0\\.35\\]')).toBeNull();
  });
});

describe('† marker and footnote', () => {
  const CARRY = 'Includes 3 carried over from imported CSV history (archived repo with no alert data)';
  const withCarry = {
    pivot: {
      rows: [ovTeam('Payments', ovCell(5, { resolved: 8, carriedResolved: 3 }), ovCell(0)), ovTeam('Unassigned', ovCell(1, { resolved: 2 }), ovCell(0))],
      total: ovTeam('Total', ovCell(6, { resolved: 10, carriedResolved: 3 }), ovCell(0)),
    },
  };

  it('a † with the carry title after the critical Resolved number of a row whose carriedResolved > 0', () => {
    render(<TeamTable {...table(withCarry)} />);
    expect(within(rowOf('Payments')).getByText('†').getAttribute('title')).toBe(CARRY);
    expect(within(rowOf('Unassigned')).queryByText('†')).toBeNull();
  });

  it('the footnote sits under the Total row when the total carriedResolved > 0', () => {
    render(<TeamTable {...table(withCarry)} />);
    const note = screen.getByTestId('team-table-footnote');
    expect(note.textContent).toBe('† Resolved includes 3 carried over from imported CSV history for archived repos Glooker never synced.');
    expect(note.parentElement).toBe(screen.getByTestId('team-total-row').parentElement);
  });

  it('neither marker nor footnote when nothing carries', () => {
    render(<TeamTable {...table()} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByTestId('team-table-footnote')).toBeNull();
  });

  // Revert: key the marker off carriedResolved alone.
  it('neither when resolved is null (invalid start date) even though carriedResolved > 0', () => {
    const invalid = { pivot: { rows: [ovTeam('Payments', ovCell(5, { resolved: null, dismissed: null, carriedResolved: 3 }), ovCell(0))], total: ovTeam('Total', ovCell(5, { resolved: null, dismissed: null, carriedResolved: 3 }), ovCell(0)) }, resolvedSince: { date: null, invalid: true } };
    render(<TeamTable {...table(invalid)} />);
    expect(screen.queryByText('†')).toBeNull();
    expect(screen.queryByTestId('team-table-footnote')).toBeNull();
  });
});

describe('row selection', () => {
  // Revert: toggle in the component (call selectTeamRow(null) for the selected row), or call setTeam.
  it('a click, and Enter, call url.selectTeamRow with the team; the selected row is highlighted and marked ×', () => {
    const p = table();
    const { rerender } = render(<TeamTable {...p} />);
    fireEvent.click(within(rowOf('Payments')).getByText('Payments'));
    expect(p.url.selectTeamRow).toHaveBeenLastCalledWith('Payments');
    fireEvent.keyDown(rowOf('Unassigned'), { key: 'Enter' });
    expect(p.url.selectTeamRow).toHaveBeenLastCalledWith('Unassigned');

    const selected = table({}, { team: 'Payments' });
    selected.url.selectTeamRow = p.url.selectTeamRow;
    rerender(<TeamTable {...selected} />);
    expect(rowOf('Payments').className).toContain('bg-accent/10');
    expect(rowOf('Payments').getAttribute('title')).toBe('Clear the Owning team filter');
    expect(within(rowOf('Payments')).getByText('×')).toBeTruthy();
    fireEvent.click(rowOf('Payments'));
    expect(p.url.selectTeamRow).toHaveBeenLastCalledWith('Payments');
    expect(p.url.setTeam).not.toHaveBeenCalled();
  });

  it('the Total row is not clickable', () => {
    const p = table();
    render(<TeamTable {...p} />);
    fireEvent.click(screen.getByTestId('team-total-row'));
    expect(p.url.selectTeamRow).not.toHaveBeenCalled();
  });
});

describe('sorting', () => {
  const rows = [ovTeam('Alpha', ovCell(2), ovCell(7)), ovTeam('Beta', ovCell(5), ovCell(1)), ovTeam('Gamma', ovCell(3), ovCell(4))];
  const order = () => screen.getAllByTestId(/^team-row-/).map(r => r.getAttribute('data-testid')!.replace('team-row-', ''));
  const openHeader = (n: number) => screen.getAllByRole('columnheader').filter(h => h.textContent?.startsWith('Open'))[n];

  it('starts in server order with no active header, then sorts a column descending, then ascending, with the arrow and aria-sort', () => {
    render(<TeamTable {...table(pivot(rows, TOTAL))} />);
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(openHeader(0).getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(openHeader(0)).getByRole('button'));
    expect(order()).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(openHeader(0).getAttribute('aria-sort')).toBe('descending');
    expect(openHeader(0).textContent).toContain('↓');
    fireEvent.click(within(openHeader(0)).getByRole('button'));
    expect(order()).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(openHeader(0).textContent).toContain('↑');
  });

  // Revert: sort the Total row with the others.
  it('the Total row stays last whatever the sort', () => {
    render(<TeamTable {...table(pivot(rows, TOTAL))} />);
    fireEvent.click(within(openHeader(0)).getByRole('button'));
    const all = Array.from(screen.getByTestId('team-table').querySelectorAll('[data-testid^="team-row-"], [data-testid="team-total-row"]')).map(r => r.getAttribute('data-testid'));
    expect(all[all.length - 1]).toBe('team-total-row');
  });

  // Revert: leave the hidden severity's headers clickable.
  it('a hidden severity\'s headers cannot be sorted', () => {
    render(<TeamTable {...table(pivot(rows, TOTAL), { severity: 'high', kSev: 'high' })} />);
    expect((within(openHeader(0)).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(openHeader(0).textContent).not.toMatch(/[↕↑↓]/);
    expect((within(openHeader(1)).getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the name column sorts ascending first', () => {
    render(<TeamTable {...table(pivot([rows[1], rows[2], rows[0]], TOTAL))} />);
    fireEvent.click(screen.getByRole('button', { name: /Owning team/ }));
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-team-table.test.tsx --maxWorkers=3`
Expected: FAIL, `Cannot find module '@/app/vulnerabilities/team-table'`.

- [ ] **Step 3: Implement**

The table is a CSS grid of `div` rows with ARIA roles, not a `<table>`: grid tracks are `minmax(0, …)`, so long names truncate and no column width depends on its content, and sticky header and footer rows work without per-cell tricks. Create `src/app/vulnerabilities/team-table.tsx`:

```tsx
// src/app/vulnerabilities/team-table.tsx
'use client';
// GLOOK-64: the "Owning teams" tab. One row per owning team with a CRITICAL group and a HIGH group,
// a pinned header and a pinned Total row inside the card's scrolling body. It reads `data.teamSummary`
// (never scoped to the selected team, so every team stays listed to compare against) and falls back
// to the scoped `summary` only while that request has not resolved yet.
import { useState } from 'react';
import type { TeamRow, SevCell } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { SecurityViewProps } from './view-props';
import { TEAM_ROW_H, TYPE, Z } from './dimensions';
import { dash, deltaBaselineCaption, resolvedCaption } from './format';
import { baselineUnavailableText, carriedFootnote, carriedTitle } from './overview-format';
import { slaActive } from './sla-state';
import {
  deltaOpenFor, nextSort, orderTeamRows, sevShown, sortGlyph, TEAM_SORT_FIRST,
  type SortState, type TeamSortKey,
} from './ownership-model';

const HIDDEN = '–'; // an en dash: a hidden severity's cell. A missing figure is "—" (em dash) from dash().
const DIM = 'opacity-[0.35]';

const GROUPS: Array<{ sev: Severity; prefix: 'c' | 'h'; label: string; band: string; tint: string }> = [
  { sev: 'critical', prefix: 'c', label: 'CRITICAL', band: 'bg-red-500/20 text-red-400', tint: 'bg-crit-tint' },
  { sev: 'high', prefix: 'h', label: 'HIGH', band: 'bg-orange-500/20 text-orange-400', tint: 'bg-high-tint' },
];

type Col = 'Open' | 'Change' | 'Resolved' | 'Pct' | 'Overdue';
const sortKey = (prefix: 'c' | 'h', col: Col) => `${prefix}${col}` as TeamSortKey;

function changeCell(delta: number | null) {
  const text = delta === null ? '—' : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : '0';
  const tone = delta === null || delta === 0 ? 'text-gray-600' : delta > 0 ? 'text-red-400' : 'text-green-400';
  // Keyed by its text: a baseline switch swaps one figure for another in every row, and in a
  // right-aligned cell an in-place text edit moves the text's start, which the layout-shift API
  // scores. A remounted span is a new object, not a moved one.
  return <span key={text} className={tone}>{text}</span>;
}

interface RowCtx {
  columns: Record<Severity, { overdue: boolean }>;
  severity: SecurityViewProps['url']['severity'];
  deltas: { critical: SecurityViewProps['summary']['delta']['critical']; high: SecurityViewProps['summary']['delta']['high'] };
}

/** The cells of one severity group for one row (or the Total row). */
function GroupCells({ row, g, ctx }: { row: TeamRow; g: typeof GROUPS[number]; ctx: RowCtx }) {
  const hasOverdue = ctx.columns[g.sev].overdue;
  const n = 4 + (hasOverdue ? 1 : 0);
  if (!sevShown(ctx.severity, g.sev)) {
    return <>{Array.from({ length: n }, (_, i) => <div key={i} role="cell" className={`${g.tint} px-2 text-right text-gray-600`}>{HIDDEN}</div>)}</>;
  }
  const c: SevCell = row[g.sev];
  const carried = c.resolved !== null && c.carriedResolved > 0;
  return (
    <>
      <div role="cell" className={`${g.tint} px-2 text-right font-semibold tabular-nums text-white`}>{dash(c.open)}</div>
      <div role="cell" className={`${g.tint} px-2 text-right tabular-nums`}>{changeCell(deltaOpenFor(ctx.deltas[g.sev], row.team))}</div>
      <div role="cell" className={`${g.tint} px-2 text-right tabular-nums text-gray-200`} title={`of which dismissed: ${dash(c.dismissed)}`}>
        {dash(c.resolved)}
        {carried && <span className="ml-0.5 text-warn" title={carriedTitle(c.carriedResolved)}>†</span>}
        <span className="ml-1 text-xs text-gray-500">({dash(c.dismissed)})</span>
      </div>
      <div role="cell" className={`${g.tint} px-2 text-right tabular-nums text-gray-300`}>{dash(c.pctClosed, '%')}</div>
      {hasOverdue && (
        <div role="cell" className={`${g.tint} px-2 text-right tabular-nums ${c.overdue ? 'font-bold text-red-400' : 'text-gray-600'}`}>{dash(c.overdue)}</div>
      )}
    </>
  );
}

function UnmeasuredBadge({ n, onOpen }: { n: number; onOpen: SecurityViewProps['openDrawer'] }) {
  return (
    <button
      type="button"
      className="mt-0.5 w-fit max-w-full truncate rounded border border-warn-line bg-warn-bg px-1 text-[10px] leading-4 text-warn"
      title={`Open counts for ${n} ${n === 1 ? 'repository are' : 'repositories are'} unknown. Their resolved alerts and measured history still count in this row.`}
      onClick={e => { e.stopPropagation(); onOpen(e.currentTarget); }}
    >
      ▲ {n} unmeasured
    </button>
  );
}

export default function TeamTable({ summary, data, url, openDrawer }: SecurityViewProps) {
  const [sort, setSort] = useState<SortState<TeamSortKey> | null>(null);
  const slot = data.teamSummary;

  if (slot.errorText) {
    return <p data-testid="team-table-error" className="p-4 text-xs text-red-400">{slot.errorText}</p>;
  }
  // The scoped summary stands in only until the unfiltered one first resolves (a deep link with a team).
  const src = slot.data ?? summary;
  const columns: RowCtx['columns'] = {
    critical: { overdue: slaActive('critical', src) },
    high: { overdue: slaActive('high', src) },
  };
  const deltas = { critical: src.delta.critical, high: src.delta.high };
  const ctx: RowCtx = { columns, severity: url.severity, deltas };
  const rows = orderTeamRows(src.pivot.rows, sort, deltas, url.severity);
  const total = src.pivot.total;
  const nC = 4 + (columns.critical.overdue ? 1 : 0);
  const nH = 4 + (columns.high.overdue ? 1 : 0);
  const template = `minmax(0, 1.25fr) repeat(${nC}, minmax(0, 1fr)) 8px repeat(${nH}, minmax(0, 1fr))`;
  const rowStyle = { display: 'grid', gridTemplateColumns: template } as const;
  const critBaseline = deltaBaselineCaption(deltas.critical) ?? baselineUnavailableText(deltas.critical);
  const highBaseline = deltaBaselineCaption(deltas.high) ?? baselineUnavailableText(deltas.high);
  const carriedTotal = total.critical.resolved !== null ? total.critical.carriedResolved : 0;

  const header = (g: typeof GROUPS[number], col: Col, label: string, sub?: string, subTitle?: string, title?: string) => {
    const key = sortKey(g.prefix, col);
    const shown = sevShown(url.severity, g.sev);
    const active = shown && sort?.key === key ? sort : null;
    return (
      <div role="columnheader" aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${g.tint} px-2 ${shown ? '' : DIM}`} title={title}>
        <button
          type="button" disabled={!shown}
          className={`${TYPE.tableHeader} flex w-full items-center justify-end gap-1 whitespace-nowrap ${active ? 'text-white' : 'text-gray-400'} disabled:cursor-default`}
          onClick={() => setSort(s => nextSort(s, key, TEAM_SORT_FIRST[key]))}
        >
          {label}
          {shown && <span aria-hidden="true" className={active ? 'text-accent-light' : 'text-gray-600'}>{sortGlyph(active)}</span>}
        </button>
        <div className="h-3.5 truncate text-right text-[10px] font-normal normal-case leading-[14px] tracking-normal text-gray-500" title={subTitle ?? sub} aria-hidden={sub ? undefined : true}>{sub ?? '\u00a0'}</div>
      </div>
    );
  };

  const band = (g: typeof GROUPS[number], span: number) => (
    <div role="columnheader" data-testid={`team-band-${g.sev}`} className={`${g.band} py-1 text-center text-[11px] font-semibold tracking-widest ${sevShown(url.severity, g.sev) ? '' : DIM}`} style={{ gridColumn: `span ${span}` }}>
      {g.label}
    </div>
  );
  const nameKey: TeamSortKey = 'name';
  const nameActive = sort?.key === nameKey ? sort : null;
  const groupHeader = (g: typeof GROUPS[number], baseline: string, hasOverdue: boolean) => (
    <>
      {header(g, 'Open', 'Open')}
      {header(g, 'Change', 'Change', baseline)}
      {header(g, 'Resolved', 'Resolved', '(dismissed)', undefined, `Resolved ${resolvedCaption(src.resolvedSince)}`)}
      {header(g, 'Pct', '% closed')}
      {hasOverdue && header(g, 'Overdue', 'Overdue')}
    </>
  );

  return (
    <div role="table" aria-label="Owning teams" data-testid="team-table" className={`h-full overflow-auto${slot.stale ? ' opacity-60' : ''}`}>
      <div className="sticky top-0 bg-chart-surface" style={{ zIndex: Z.pinnedRows }}>
        <div role="row" style={rowStyle}>
          <div />
          {band(GROUPS[0], nC)}
          <div />
          {band(GROUPS[1], nH)}
        </div>
        <div role="row" style={rowStyle} className="items-end border-b border-gray-800">
          <div role="columnheader" aria-sort={nameActive ? (nameActive.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-2 pb-[18px]" title="The repository's team custom property — not a Glooker team">
            <button type="button" className={`${TYPE.tableHeader} flex items-center gap-1 whitespace-nowrap ${nameActive ? 'text-white' : 'text-gray-400'}`} onClick={() => setSort(s => nextSort(s, nameKey, TEAM_SORT_FIRST[nameKey]))}>
              Owning team
              <span aria-hidden="true" className={nameActive ? 'text-accent-light' : 'text-gray-600'}>{sortGlyph(nameActive)}</span>
            </button>
          </div>
          {groupHeader(GROUPS[0], critBaseline, columns.critical.overdue)}
          <div />
          {groupHeader(GROUPS[1], highBaseline, columns.high.overdue)}
        </div>
      </div>

      {rows.map(r => {
        const selected = url.team === r.team;
        return (
          <div
            key={r.team} role="row" data-testid={`team-row-${r.team}`} tabIndex={0} aria-selected={selected}
            title={selected ? 'Clear the Owning team filter' : `Filter the page to ${r.team} and list its repositories`}
            className={`cursor-pointer items-center border-b border-gray-800/60 hover:bg-gray-800/30${selected ? ' bg-accent/10' : ''}`}
            style={{ ...rowStyle, height: TEAM_ROW_H }}
            onClick={() => url.selectTeamRow(r.team)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); url.selectTeamRow(r.team); } }}
          >
            <div role="cell" className="flex min-w-0 flex-col justify-center px-2">
              <div className="flex min-w-0 items-center gap-1">
                <span className={`${TYPE.body} min-w-0 truncate ${selected ? 'font-semibold text-accent-light' : 'text-gray-100'}`} title={r.team}>{r.team}</span>
                {selected && <span aria-hidden="true" className="shrink-0 text-accent-light">×</span>}
              </div>
              {r.unmeasuredRepos > 0 && <UnmeasuredBadge n={r.unmeasuredRepos} onOpen={openDrawer} />}
            </div>
            <GroupCells row={r} g={GROUPS[0]} ctx={ctx} />
            <div />
            <GroupCells row={r} g={GROUPS[1]} ctx={ctx} />
          </div>
        );
      })}

      <div className="sticky bottom-0 bg-chart-surface" style={{ zIndex: Z.pinnedRows }}>
        <div role="row" data-testid="team-total-row" className="items-center border-t border-gray-700 font-bold" style={{ ...rowStyle, height: TEAM_ROW_H }}>
          <div role="cell" className="flex min-w-0 flex-col justify-center px-2">
            <span className={`${TYPE.body} text-white`}>Total</span>
            {total.unmeasuredRepos > 0 && <UnmeasuredBadge n={total.unmeasuredRepos} onOpen={openDrawer} />}
          </div>
          <GroupCells row={total} g={GROUPS[0]} ctx={ctx} />
          <div />
          <GroupCells row={total} g={GROUPS[1]} ctx={ctx} />
        </div>
        {carriedTotal > 0 && <p data-testid="team-table-footnote" className="px-2 pb-1 text-[11px] text-gray-500">{carriedFootnote(carriedTotal)}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-team-table.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (42 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/team-table.tsx src/lib/__tests__/unit/vuln-team-table.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Owning teams table"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.9: Repositories table (`repo-table.tsx`)

**Files:**
- Create: `src/app/vulnerabilities/repo-table.tsx`
- Test: `src/lib/__tests__/unit/vuln-repo-table.test.tsx`

**Interfaces:**
- Consumes: `SecurityViewProps` (`summary`, `data.repos`, `url.severity`, `url.team`, `url.selectRepoRow`, `openDrawer`); `CODEBASE_LABELS` from `@/lib/vulnerabilities/codebase-labels`; `TEAM_ROW_H`, `TYPE`, `Z`; `shortDate` (3.1); `slaActive`, `anySlaActive`; `ownership-model.ts` (3.7: `buildRepoView`, `repoDisplay`, `repoTotals`, `nextSort` and the rest); fixtures `cell`, `repoRow`, `reposFixture`, `slot`, `ovProps`.
- Produces: default export `RepoTable(props: SecurityViewProps & { nameFilter: string })`. Root `repo-table` (`h-full overflow-auto`); rows `repo-row-{fullName}` (inline height `TEAM_ROW_H`); the hatched band `repo-unmeasured-band`; pinned footer `repo-footer` with its second line `repo-footer-note`; branches `repo-table-error` and `repo-table-loading`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-repo-table.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-repo-table.test.tsx
// The ownership card's "Repositories" tab.
import { fireEvent, render, screen, within } from '@testing-library/react';
import RepoTable from '@/app/vulnerabilities/repo-table';
import { TEAM_ROW_H, Z } from '@/app/vulnerabilities/dimensions';
import type { SummaryData, ReposData } from '@/app/vulnerabilities/api-types';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
import { cell, ovProps, repoRow, reposFixture, slot } from '../support/security-fixtures';

const NBSP = '\u00a0';
const LONG_TEAM = 'A very long owning team name that cannot fit its column';
const ROWS = [
  repoRow('acme/checkout-api', 'Payments', {
    critical: cell({ open: 9, overdue: 8, dueSoon: 1, oldestOpenDays: 101, nextDue: { date: '2026-10-02', daysRemaining: 2 } }),
    high: cell({ open: 14, overdue: 7, dueSoon: 0, oldestOpenDays: 40, nextDue: null }),
  }),
  repoRow('acme/billing-worker', 'Payments', {
    critical: cell({ open: 2, overdue: 1, dueSoon: 0, oldestOpenDays: 18, nextDue: { date: '2026-10-07', daysRemaining: 0 } }),
    high: cell({ open: 1, overdue: 0, dueSoon: 0, oldestOpenDays: 5, nextDue: null }),
  }),
  repoRow('acme/ledger-service', 'Payments', { critical: cell({ open: 0, overdue: 0, dueSoon: 0 }), high: cell({ open: 0, overdue: 0, dueSoon: 0 }) }),
  repoRow('acme/search-index', LONG_TEAM, { critical: cell({ open: 0, overdue: 0, dueSoon: 0 }), high: cell({ open: 3, overdue: 0, dueSoon: 0, oldestOpenDays: 9 }) }),
  repoRow('acme/invoice-render', 'Payments', { critical: cell({ open: 8, overdue: 4 }), high: cell({ open: 5, overdue: 2 }), unmeasured: { status: 'dependabot-off', detail: null } }),
];

const policy = (severity: 'critical' | 'high', pending: boolean) => ({ id: `${severity}-1`, severity, days: 7, effectiveFrom: '2026-11-01', until: null, pending });
const ACTIVE = { slaStatus: { critical: 'active', high: 'active' } as SummaryData['slaStatus'], policy: [policy('critical', false), policy('high', false)] as unknown as SummaryData['policy'] };

function table(o: { rows?: typeof ROWS; summary?: Partial<SummaryData>; url?: Partial<SecurityViewProps['url']>; filter?: string; repos?: SecurityViewProps['data']['repos'] } = {}) {
  const p = ovProps({ summary: { ...ACTIVE, ...o.summary }, url: o.url, repos: o.rows ?? ROWS });
  if (o.repos) p.data.repos = o.repos;
  return { ...p, nameFilter: o.filter ?? '' };
}
const rowOf = (name: string) => screen.getByTestId(`repo-row-${name}`);
const cellsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="cell"]')) as HTMLElement[];
const headerNames = () => screen.getAllByRole('columnheader').map(h => h.textContent?.replace(/[↕↑↓]\uFE0E?/g, '').trim());
const order = () => screen.getAllByTestId(/^repo-row-/).map(r => r.getAttribute('data-testid')!.replace('repo-row-acme/', ''));

describe('columns follow the SLA state', () => {
  const all = ['Repository', 'Owning team', 'Open crit', 'Overdue crit', 'Open high', 'Overdue high', 'Oldest open', 'Next due'];
  const status = (critical: 'active' | 'pending' | 'none', high: 'active' | 'pending' | 'none') => ({
    slaStatus: { critical, high } as SummaryData['slaStatus'],
    policy: [...(critical === 'none' ? [] : [policy('critical', critical === 'pending')]), ...(high === 'none' ? [] : [policy('high', high === 'pending')])] as unknown as SummaryData['policy'],
  });

  // Revert: show an Overdue column whatever the state, or drop "Next due" when only one policy is active.
  it.each([
    ['both active', status('active', 'active'), false, all],
    ['critical active, high pending', status('active', 'pending'), false, all.filter(h => h !== 'Overdue high')],
    ['critical pending, high active', status('pending', 'active'), false, all.filter(h => h !== 'Overdue crit')],
    ['both pending', status('pending', 'pending'), false, all.filter(h => !/Overdue|Next due/.test(h))],
    ['none', status('none', 'none'), false, all.filter(h => !/Overdue|Next due/.test(h))],
    ['invalid', status('active', 'active'), true, all.filter(h => !/Overdue|Next due/.test(h))],
  ] as const)('%s', (_n, s, invalid, expected) => {
    render(<RepoTable {...table({ summary: { ...s, slaPolicyInvalid: invalid } })} />);
    expect(headerNames()).toEqual(expected);
    expect(cellsOf(rowOf('acme/checkout-api'))).toHaveLength(expected.length);
  });
});

describe('measured rows', () => {
  it('shows the name with its codebase underneath, the owning team, the counts, oldest and next due', () => {
    render(<RepoTable {...table()} />);
    const cells = cellsOf(rowOf('acme/checkout-api')).map(c => c.textContent);
    expect(cells[0]).toBe('acme/checkout-apiBackend');
    expect(cells.slice(1)).toEqual(['Payments', '9', '8', '14', '7', '101d', 'Oct 2in 2d']);
  });

  it('a next due date of today reads "today"', () => {
    render(<RepoTable {...table()} />);
    expect(cellsOf(rowOf('acme/billing-worker'))[7].textContent).toBe('Oct 7today');
  });

  // Revert: render overdue zero in red, or an overdue above zero in grey.
  it('overdue above zero is bold red; zero is grey', () => {
    render(<RepoTable {...table()} />);
    const cells = cellsOf(rowOf('acme/checkout-api'));
    expect(cells[3].className).toContain('text-red-400');
    expect(cells[3].className).toContain('font-bold');
    expect(cellsOf(rowOf('acme/search-index'))[3].className).not.toContain('text-red-400');
  });

  // Revert: drop zero-alert repositories from the list, or leave them un-greyed.
  it('a repository with no open alerts is listed, greyed, with "· no open alerts" under its name and — for oldest and next due', () => {
    render(<RepoTable {...table()} />);
    const r = rowOf('acme/ledger-service');
    const cells = cellsOf(r);
    expect(cells[0].textContent).toBe('acme/ledger-serviceBackend · no open alerts');
    expect(cells[0].firstElementChild!.className).toContain('text-gray-500');
    expect(cells[1].className).toContain('text-gray-500');
    expect(cells[2].textContent).toBe('0');
    expect(cells[2].className).toContain('text-gray-600');
    expect(cells[6].textContent).toBe('—');
    expect(cells[7].textContent).toBe('—');
  });

  // Revert: render the team in a non-truncating element, or without its title.
  it('a long owning-team name ends in an ellipsis and carries the full name in its title', () => {
    render(<RepoTable {...table()} />);
    const team = cellsOf(rowOf('acme/search-index'))[1];
    expect(team.className).toContain('truncate');
    expect(team.className).toContain('min-w-0');
    expect(team.getAttribute('title')).toBe(LONG_TEAM);
  });

  it('a long repository name truncates and carries its title as well', () => {
    render(<RepoTable {...table()} />);
    const name = within(rowOf('acme/checkout-api')).getByText('acme/checkout-api');
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe('acme/checkout-api');
  });

  it('rows are TEAM_ROW_H tall', () => {
    render(<RepoTable {...table()} />);
    expect(rowOf('acme/checkout-api').style.height).toBe(`${TEAM_ROW_H}px`);
    expect(rowOf('acme/invoice-render').style.height).toBe(`${TEAM_ROW_H}px`);
  });
});

describe('hidden severity', () => {
  // Revert: leave a hidden severity's figures in, or use the em dash.
  it('"Critical only" shows – in the high columns, rows and footer, and dims and locks their headers', () => {
    render(<RepoTable {...table({ url: { severity: 'critical', kSev: 'critical' } })} />);
    expect(cellsOf(rowOf('acme/checkout-api')).map(c => c.textContent)).toEqual(['acme/checkout-apiBackend', 'Payments', '9', '8', '–', '–', '101d', 'Oct 2in 2d']);
    const footer = cellsOf(screen.getByTestId('repo-footer')).map(c => c.textContent);
    expect(footer[3]).toBe('–');
    expect(footer[4]).toBe('–');
    const openHigh = screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith('Open high'))!;
    expect(openHigh.className).toContain('opacity-[0.35]');
    expect((within(openHigh).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  // Revert: decide "no open alerts" from both severities.
  it('"no open alerts" follows the shown severities: a high-only repository reads as empty under "Critical only"', () => {
    render(<RepoTable {...table({ url: { severity: 'critical', kSev: 'critical' } })} />);
    expect(cellsOf(rowOf('acme/search-index'))[0].textContent).toBe('acme/search-indexBackend · no open alerts');
  });

  it('"High only" combines only the high figures for oldest open', () => {
    render(<RepoTable {...table({ url: { severity: 'high', kSev: 'high' } })} />);
    expect(cellsOf(rowOf('acme/checkout-api'))[6].textContent).toBe('40d');
  });
});

describe('unmeasured repositories', () => {
  // Revert: show the stored counts, or word the band differently.
  it('are listed last as a hatched band, with their open counts unknown and no stored figure on screen', () => {
    render(<RepoTable {...table()} />);
    const r = rowOf('acme/invoice-render');
    const band = within(r).getByTestId('repo-unmeasured-band');
    expect(band.textContent).toBe('▲ UNMEASURED · DEPENDABOT OFF — alert counts unknown, not zero');
    expect(band.className).toContain('vuln-hatch');
    expect(r.textContent).not.toMatch(/\b8\b|\b5\b/);
    expect(order()[order().length - 1]).toBe('invoice-render');
  });

  it('the band spans every numeric column in every SLA state', () => {
    for (const s of [ACTIVE, { slaStatus: { critical: 'none', high: 'none' } as SummaryData['slaStatus'], policy: [] as SummaryData['policy'] }]) {
      const { unmount } = render(<RepoTable {...table({ summary: s })} />);
      const n = screen.getAllByRole('columnheader').length - 2;
      expect(screen.getByTestId('repo-unmeasured-band').style.gridColumn).toBe(`span ${n}`);
      unmount();
    }
  });

  it('an error status names a failed status check', () => {
    const rows = [repoRow('acme/legacy', 'Platform', { unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' } })];
    render(<RepoTable {...table({ rows })} />);
    expect(screen.getByTestId('repo-unmeasured-band').textContent).toContain('UNMEASURED · STATUS CHECK FAILED');
    expect(rowOf('acme/legacy').getAttribute('title')).toBe('Open counts unknown (HTTP 500: status check failed). Click for details.');
  });

  // Revert: send the click to selectRepoRow like a measured row.
  it('a click opens the drawer with the row and does not open the repository\'s alerts', () => {
    const p = table();
    render(<RepoTable {...p} />);
    const r = rowOf('acme/invoice-render');
    fireEvent.click(r);
    expect(p.openDrawer).toHaveBeenCalledWith(r);
    expect(p.url.selectRepoRow).not.toHaveBeenCalled();
  });

  it('sits last and ignores sorting in both directions', () => {
    render(<RepoTable {...table()} />);
    const header = screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith('Repository'))!;
    fireEvent.click(within(header).getByRole('button'));
    expect(order()[order().length - 1]).toBe('invoice-render');
    fireEvent.click(within(header).getByRole('button'));
    expect(order()[order().length - 1]).toBe('invoice-render');
  });
});

describe('row click', () => {
  // Revert: call setRepo or setTeam instead, or drop the team.
  it('opens the repository\'s alerts with its owning team via url.selectRepoRow, on click and Enter', () => {
    const p = table();
    render(<RepoTable {...p} />);
    fireEvent.click(rowOf('acme/checkout-api'));
    expect(p.url.selectRepoRow).toHaveBeenLastCalledWith({ fullName: 'acme/checkout-api', team: 'Payments' });
    fireEvent.keyDown(rowOf('acme/ledger-service'), { key: 'Enter' });
    expect(p.url.selectRepoRow).toHaveBeenLastCalledWith({ fullName: 'acme/ledger-service', team: 'Payments' });
    expect(p.url.setRepo).not.toHaveBeenCalled();
    expect(p.url.setTeam).not.toHaveBeenCalled();
  });

  it('"Unassigned" is a valid owning team', () => {
    const p = table({ rows: [repoRow('acme/orphan', 'Unassigned', { critical: cell({ open: 1, overdue: 0 }) })] });
    render(<RepoTable {...p} />);
    fireEvent.click(rowOf('acme/orphan'));
    expect(p.url.selectRepoRow).toHaveBeenCalledWith({ fullName: 'acme/orphan', team: 'Unassigned' });
  });
});

describe('footer', () => {
  const footer = () => screen.getByTestId('repo-footer');

  it('reads "Total · N repos" with no team and sums open and overdue over every row, the unmeasured one\'s stored counts included', () => {
    render(<RepoTable {...table()} />);
    const cells = cellsOf(footer());
    expect(cells[0].textContent).toContain('Total · 4 repos');
    // crit open 9+2+0+0 + the unmeasured row's stored 8 = 19, overdue 9+4 = 13, high 14+1+0+3 + 5 = 23, overdue 7+2 = 9;
    // oldest (max 101d) and next due (Oct 2) come from the measured rows only
    expect(cells.slice(1).map(c => c.textContent)).toEqual(['19', '13', '23', '9', '101d', 'Oct 2in 2d']);
  });

  it('reads "{Team} total · N repos" when an owning team is selected', () => {
    render(<RepoTable {...table({ url: { team: 'Payments' } })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Payments total · 4 repos');
  });

  it('a singular repository reads "1 repo"', () => {
    render(<RepoTable {...table({ rows: [ROWS[0]] })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Total · 1 repo');
  });

  it('the second line says how many are unmeasured, and is a reserved empty line when none are', () => {
    const { unmount } = render(<RepoTable {...table()} />);
    expect(screen.getByTestId('repo-footer-note').textContent).toBe('1 unmeasured: totals include stored counts');
    unmount();
    render(<RepoTable {...table({ rows: [ROWS[0]] })} />);
    const note = screen.getByTestId('repo-footer-note');
    expect(note.textContent).toBe(NBSP);
    expect(note.getAttribute('aria-hidden')).toBe('true');
  });

  // Revert: leave the label "Total" while a filter is applied.
  it('reads "Matching" while the name filter is in use, and the second line names the filter', () => {
    render(<RepoTable {...table({ filter: 'ledger' })} />);
    expect(cellsOf(footer())[0].textContent).toContain('Matching · 1 repo');
    expect(screen.getByTestId('repo-footer-note').textContent).toBe('name contains “ledger”');
    expect(order()).toEqual(['ledger-service']);
  });

  it('is pinned to the bottom of the scrolling body on the chart surface, above the rows', () => {
    render(<RepoTable {...table()} />);
    const pinned = footer().parentElement as HTMLElement;
    expect(pinned.className).toContain('sticky');
    expect(pinned.className).toContain('bottom-0');
    expect(pinned.className).toContain('bg-chart-surface');
    expect(pinned.className).not.toContain('bg-gray-900');
    expect(pinned.style.zIndex).toBe(String(Z.pinnedRows));
    expect(screen.getByTestId('repo-table').className).toContain('overflow-auto');
  });

  it('the header row is pinned to the top the same way', () => {
    render(<RepoTable {...table()} />);
    const head = screen.getAllByRole('row')[0];
    expect(head.className).toContain('sticky');
    expect(head.className).toContain('top-0');
    expect(head.className).toContain('bg-chart-surface');
    expect(head.style.zIndex).toBe(String(Z.pinnedRows));
  });
});

describe('sorting', () => {
  const header = (label: string) => screen.getAllByRole('columnheader').find(h => h.textContent?.startsWith(label))!;
  const click = (label: string) => fireEvent.click(within(header(label)).getByRole('button'));

  it('starts in server order with every header showing ↕, then sorts with ↓ and ↑ in the accent colour', () => {
    render(<RepoTable {...table()} />);
    expect(order()).toEqual(['checkout-api', 'billing-worker', 'search-index', 'ledger-service', 'invoice-render']);
    expect(header('Open crit').textContent).toContain('↕');
    click('Open crit');
    expect(header('Open crit').textContent).toContain('↓');
    expect(header('Open crit').getAttribute('aria-sort')).toBe('descending');
    expect(header('Open crit').querySelector('.text-accent-light')).not.toBeNull();
    click('Open crit');
    expect(header('Open crit').textContent).toContain('↑');
    expect(order().slice(0, 2)).toEqual(['ledger-service', 'search-index']);
  });

  // Revert: sort a missing "oldest" as zero.
  it('a missing figure sorts last in both directions, ties by name', () => {
    render(<RepoTable {...table()} />);
    click('Oldest open');
    expect(order().slice(0, 4)).toEqual(['checkout-api', 'billing-worker', 'search-index', 'ledger-service']);
    click('Oldest open');
    expect(order().slice(0, 4)).toEqual(['search-index', 'billing-worker', 'checkout-api', 'ledger-service']);
  });

  it('the name column starts ascending', () => {
    render(<RepoTable {...table()} />);
    click('Repository');
    expect(order().slice(0, 4)).toEqual(['billing-worker', 'checkout-api', 'ledger-service', 'search-index']);
  });

  it('Next due starts with the soonest date', () => {
    render(<RepoTable {...table()} />);
    click('Next due');
    expect(order().slice(0, 2)).toEqual(['checkout-api', 'billing-worker']);
  });
});

describe('states', () => {
  it('shows the request\'s error and nothing else', () => {
    render(<RepoTable {...table({ repos: slot<ReposData>(undefined, { error: new Error('x'), errorText: "Couldn't load repositories: x", loading: false }) })} />);
    expect(screen.getByTestId('repo-table-error').textContent).toBe("Couldn't load repositories: x");
    expect(screen.queryByTestId('repo-table')).toBeNull();
  });

  it('shows Loading… before the first response', () => {
    render(<RepoTable {...table({ repos: slot<ReposData>(undefined, { loading: true }) })} />);
    expect(screen.getByTestId('repo-table-loading').textContent).toBe('Loading…');
  });

  it('an empty scope says so and still has its header and footer', () => {
    render(<RepoTable {...table({ rows: [] })} />);
    expect(screen.getByText('No repositories in this scope.')).toBeTruthy();
    expect(cellsOf(screen.getByTestId('repo-footer'))[0].textContent).toContain('Total · 0 repos');
  });

  it('a filter that matches nothing says so', () => {
    render(<RepoTable {...table({ filter: 'zzz' })} />);
    expect(screen.getByText('No repositories match “zzz”.')).toBeTruthy();
  });

  it('dims while it shows the previous key\'s rows', () => {
    render(<RepoTable {...table({ repos: slot(reposFixture(ROWS), { stale: true }) })} />);
    expect(screen.getByTestId('repo-table').className).toContain('opacity-60');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-repo-table.test.tsx --maxWorkers=3`
Expected: FAIL, `Cannot find module '@/app/vulnerabilities/repo-table'`.

- [ ] **Step 3: Implement**

Create `src/app/vulnerabilities/repo-table.tsx`:

```tsx
// src/app/vulnerabilities/repo-table.tsx
'use client';
// GLOOK-64: the "Repositories" tab. Every repository in scope (the selected owning team's, or all),
// including those with no open alerts, with a pinned header and a pinned footer inside the card's
// scrolling body. A repository's open counts are unknown while it is unmeasured: it is listed last
// as a hatched band and ignores sorting. The footer's open and overdue sums still include its stored
// counts, so the footer agrees with the team table; its count, oldest and next due are measured rows only.
import { useState } from 'react';
import type { RepoRow } from '@/lib/vulnerabilities/aggregate';
import { CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { SecurityViewProps } from './view-props';
import { TEAM_ROW_H, TYPE, Z } from './dimensions';
import { shortDate } from './overview-format';
import { slaActive, anySlaActive } from './sla-state';
import {
  buildRepoView, nextSort, repoDisplay, repoKeySeverity, repoTotals, REPO_SORT_FIRST, sevShown, sortGlyph, unmeasuredReason,
  type NextDue, type RepoDisplay, type RepoSortKey, type SortState,
} from './ownership-model';

const HIDDEN = '–'; // en dash: a hidden severity's cell. A missing figure is "—" (em dash).
const DIM = 'opacity-[0.35]';

interface Col { key: RepoSortKey; label: string; width: string; align: 'right' }

function columns(src: SecurityViewProps['summary']): Col[] {
  const num = (key: RepoSortKey, label: string): Col => ({ key, label, width: 'minmax(0, 0.8fr)', align: 'right' });
  return [
    num('openCrit', 'Open crit'),
    ...(slaActive('critical', src) ? [num('overCrit', 'Overdue crit')] : []),
    num('openHigh', 'Open high'),
    ...(slaActive('high', src) ? [num('overHigh', 'Overdue high')] : []),
    num('oldest', 'Oldest open'),
    ...(anySlaActive(src) ? [{ ...num('next', 'Next due'), width: 'minmax(0, 1.1fr)' }] : []),
  ];
}

const nextText = (n: NextDue) => ({ date: shortDate(n.date), sub: n.daysRemaining === 0 ? 'today' : `in ${n.daysRemaining}d` });

/** The text of one numeric cell (or footer cell) for a column; null for a hidden severity. */
function figure(col: Col, v: { openCrit: number; openHigh: number; overCrit: number | null; overHigh: number | null; oldest: number | null; next: NextDue | null }, bold: boolean) {
  switch (col.key) {
    case 'openCrit': return { text: String(v.openCrit), cls: v.openCrit ? 'text-white' : 'text-gray-600', weight: true };
    case 'openHigh': return { text: String(v.openHigh), cls: v.openHigh ? 'text-white' : 'text-gray-600', weight: true };
    case 'overCrit': return { text: String(v.overCrit ?? 0), cls: v.overCrit ? 'font-bold text-red-400' : 'text-gray-600', weight: false };
    case 'overHigh': return { text: String(v.overHigh ?? 0), cls: v.overHigh ? 'font-bold text-red-400' : 'text-gray-600', weight: false };
    case 'oldest': return { text: v.oldest === null ? '—' : `${v.oldest}d`, cls: bold ? 'text-white' : 'text-gray-300', weight: false };
    default: return { text: v.next ? nextText(v.next).date : '—', cls: 'text-gray-300', weight: false, sub: v.next ? nextText(v.next).sub : undefined };
  }
}

function MeasuredRow({ d, cols, template, severity, onSelect }: {
  d: RepoDisplay; cols: Col[]; template: string; severity: SecurityViewProps['url']['severity']; onSelect: SecurityViewProps['url']['selectRepoRow'];
}) {
  const r = d.row;
  const zero = d.open === 0;
  return (
    <div
      role="row" data-testid={`repo-row-${r.fullName}`} tabIndex={0} title={`Open ${r.fullName} alerts`}
      className="cursor-pointer items-center border-b border-gray-800/60 hover:bg-gray-800/30"
      style={{ display: 'grid', gridTemplateColumns: template, height: TEAM_ROW_H }}
      onClick={() => onSelect({ fullName: r.fullName, team: r.team })}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ fullName: r.fullName, team: r.team }); } }}
    >
      <div role="cell" className="min-w-0 px-2">
        <div className={`${TYPE.body} truncate ${zero ? 'text-gray-500' : 'text-gray-100'}`} title={r.fullName}>{r.fullName}</div>
        <div className="truncate text-xs text-gray-500">{CODEBASE_LABELS[r.codebaseGroup]}{zero ? ' · no open alerts' : ''}</div>
      </div>
      <div role="cell" className={`${TYPE.body} min-w-0 truncate px-2 ${zero ? 'text-gray-500' : 'text-gray-300'}`} title={r.team}>{r.team}</div>
      {cols.map(c => {
        const sev = repoKeySeverity(c.key);
        if (sev && !sevShown(severity, sev)) return <div key={c.key} role="cell" className="px-2 text-right text-gray-600">{HIDDEN}</div>;
        const f = figure(c, d, false);
        return (
          <div key={c.key} role="cell" className={`px-2 text-right tabular-nums ${f.cls}${f.weight ? ' font-semibold' : ''}`}>
            {f.text}
            {'sub' in f && f.sub && <span className="ml-1 text-xs font-normal text-gray-500">{f.sub}</span>}
          </div>
        );
      })}
    </div>
  );
}

function UnmeasuredRow({ r, cols, template, onOpen }: { r: RepoRow; cols: Col[]; template: string; onOpen: SecurityViewProps['openDrawer'] }) {
  const u = r.unmeasured!;
  const reason = unmeasuredReason(u);
  const text = `▲ UNMEASURED · ${reason} — alert counts unknown, not zero`;
  return (
    <div
      role="row" data-testid={`repo-row-${r.fullName}`} tabIndex={0}
      title={`Open counts unknown${u.detail ? ` (${u.detail})` : ''}. Click for details.`}
      className="cursor-pointer items-center border-b border-gray-800/60"
      style={{ display: 'grid', gridTemplateColumns: template, height: TEAM_ROW_H }}
      onClick={e => onOpen(e.currentTarget)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e.currentTarget); } }}
    >
      <div role="cell" className="min-w-0 px-2">
        <div className={`${TYPE.body} truncate text-gray-100`} title={r.fullName}>{r.fullName}</div>
        <div className="truncate text-xs text-gray-500">{CODEBASE_LABELS[r.codebaseGroup]}</div>
      </div>
      <div role="cell" className={`${TYPE.body} min-w-0 truncate px-2 text-gray-300`} title={r.team}>{r.team}</div>
      <div role="cell" data-testid="repo-unmeasured-band" className="vuln-hatch mx-2 min-w-0 truncate rounded border border-warn-line px-2 py-1 text-xs font-semibold text-warn" style={{ gridColumn: `span ${cols.length}` }}>
        {text}
      </div>
    </div>
  );
}

export interface RepoTableProps extends SecurityViewProps {
  /** The card's name filter text (local state, owned by the card header's input). */
  nameFilter: string;
}

export default function RepoTable({ summary, data, url, openDrawer, nameFilter }: RepoTableProps) {
  const [sort, setSort] = useState<SortState<RepoSortKey> | null>(null);
  const slot = data.repos;
  if (slot.errorText) return <p data-testid="repo-table-error" className="p-4 text-xs text-red-400">{slot.errorText}</p>;
  if (!slot.data) return <p data-testid="repo-table-loading" className="p-4 text-xs text-gray-500">Loading…</p>;

  const rows = slot.data.rows;
  const cols = columns(summary);
  const template = `minmax(0, 2fr) minmax(0, 1fr) ${cols.map(c => c.width).join(' ')}`;
  const view = buildRepoView(rows, url.severity, sort, nameFilter);
  const totals = repoTotals(view.measured, view.unmeasured.map(r => repoDisplay(r, url.severity)));
  const filtering = nameFilter.trim() !== '';
  const subs = [
    view.unmeasured.length ? `${view.unmeasured.length} unmeasured: totals include stored counts` : null,
    filtering ? `name contains “${nameFilter.trim()}”` : null,
  ].filter((s): s is string => s !== null);

  const head = (key: RepoSortKey, label: string, right: boolean) => {
    const sev = repoKeySeverity(key);
    const shown = !sev || sevShown(url.severity, sev);
    const active = shown && sort?.key === key ? sort : null;
    return (
      <div key={key} role="columnheader" aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2 ${shown ? '' : DIM}`}>
        <button
          type="button" disabled={!shown}
          className={`${TYPE.tableHeader} flex w-full items-center gap-1 leading-[13px] ${right ? 'justify-end text-right' : 'text-left'} ${active ? 'text-white' : 'text-gray-400'} disabled:cursor-default`}
          onClick={() => setSort(s => nextSort(s, key, REPO_SORT_FIRST[key]))}
        >
          <span>{label}</span>
          {shown && <span aria-hidden="true" className={active ? 'text-accent-light' : 'text-gray-600'}>{sortGlyph(active)}</span>}
        </button>
      </div>
    );
  };

  return (
    <div role="table" aria-label="Repositories" data-testid="repo-table" className={`h-full overflow-auto${slot.stale ? ' opacity-60' : ''}`}>
      <div role="row" className="sticky top-0 items-center border-b border-gray-800 bg-chart-surface" style={{ display: 'grid', gridTemplateColumns: template, height: 40, zIndex: Z.pinnedRows }}>
        {head('name', 'Repository', false)}
        {head('team', 'Owning team', false)}
        {cols.map(c => head(c.key, c.label, true))}
      </div>

      {rows.length === 0 && <p className="p-4 text-xs text-gray-500">No repositories in this scope.</p>}
      {rows.length > 0 && view.measured.length + view.unmeasured.length === 0 && (
        <p className="p-4 text-xs text-gray-500">No repositories match “{nameFilter.trim()}”.</p>
      )}
      {view.measured.map(d => <MeasuredRow key={d.row.fullName} d={d} cols={cols} template={template} severity={url.severity} onSelect={url.selectRepoRow} />)}
      {view.unmeasured.map(r => <UnmeasuredRow key={r.fullName} r={r} cols={cols} template={template} onOpen={openDrawer} />)}

      <div className="sticky bottom-0 border-t border-gray-700 bg-chart-surface" style={{ zIndex: Z.pinnedRows }}>
        <div role="row" data-testid="repo-footer" className="items-center font-bold" style={{ display: 'grid', gridTemplateColumns: template, minHeight: TEAM_ROW_H }}>
          <div role="cell" className="col-span-2 min-w-0 px-2">
            <div className={`${TYPE.body} truncate text-white`}>
              {filtering ? 'Matching' : url.team ? `${url.team} total` : 'Total'} · {totals.count} {totals.count === 1 ? 'repo' : 'repos'}
            </div>
            <div data-testid="repo-footer-note" className="h-4 truncate text-xs font-normal leading-4 text-gray-500" aria-hidden={subs.length ? undefined : true}>{subs.length ? subs.join(' · ') : '\u00a0'}</div>
          </div>
          {cols.map(c => {
            const sev = repoKeySeverity(c.key);
            if (sev && !sevShown(url.severity, sev)) return <div key={c.key} role="cell" className="px-2 text-right text-gray-600">{HIDDEN}</div>;
            const f = figure(c, totals, true);
            return (
              <div key={c.key} role="cell" className={`px-2 text-right tabular-nums ${f.cls.replace('text-gray-600', 'text-white')}`}>
                {f.text}
                {'sub' in f && f.sub && <span className="ml-1 text-xs font-normal text-gray-500">{f.sub}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-repo-table.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (39 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/repo-table.tsx src/lib/__tests__/unit/vuln-repo-table.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Repositories table"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.10: Ownership card (`ownership-card.tsx`)

**Files:**
- Modify: `src/app/vulnerabilities/ownership-card.tsx` (replace the Wave 2 stub)
- Test: `src/lib/__tests__/unit/vuln-ownership-card.test.tsx`

**Interfaces:**
- Consumes: `TeamTable` (3.8), `RepoTable` (3.9); `url.own`, `url.setOwn`; `OWNERSHIP_BODY_H`, `TYPE`; `data.teamSummary`, `data.repos`.
- Produces: default export `OwnershipCard(props: SecurityViewProps)`: `section` `data-testid="ownership-card"` (no inline height), a pressed-button group for the two tabs with their counts, the name filter (Repositories tab only, local state that survives a tab switch) and the body `data-testid="ownership-card-body"` with inline height `OWNERSHIP_BODY_H` in every branch. A filter change must never move a control, so each tab's count is always rendered (`ownership-tab-count-teams` / `-repos`, empty while the repository rows load) in a slot with the minimum width `OWN_TAB_COUNT_MIN_W` (exported, `'2ch'`), and each tab label (`ownership-tab-label-teams` / `-repos`) reserves its semibold width through an invisible `::after` copy, so the pressed tab being bold does not move the other one.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-ownership-card.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-ownership-card.test.tsx
// The ownership card shell: tabs, the name filter and the fixed 330px body. The tables have their own
// files (vuln-team-table, vuln-repo-table).
import { fireEvent, render, screen, within } from '@testing-library/react';
import OwnershipCard, { OWN_TAB_COUNT_MIN_W } from '@/app/vulnerabilities/ownership-card';
import { OWNERSHIP_BODY_H } from '@/app/vulnerabilities/dimensions';
import type { ReposData, SummaryData } from '@/app/vulnerabilities/api-types';
import { cell, ovCell, ovProps, ovTeam, repoRow, reposFixture, slot, summaryFixture } from '../support/security-fixtures';

const body = () => screen.getByTestId('ownership-card-body');

describe('the body keeps its height in every state', () => {
  const err = (label: string) => ({ error: new Error('x'), errorText: `Couldn't load ${label}: x`, loading: false });
  const branches: Array<[string, ReturnType<typeof ovProps>]> = [
    ['teams: populated', ovProps()],
    ['teams: unfiltered summary failed', ovProps({ teamSummary: slot<SummaryData>(undefined, err('team table')) })],
    ['teams: unfiltered summary still loading (falls back to the scoped one)', ovProps({ teamSummary: slot<SummaryData>(undefined, { loading: true }) })],
    ['teams: stale', ovProps({ teamSummary: slot(summaryFixture(), { stale: true }) })],
    ['repos: populated', ovProps({ url: { own: 'repos' } })],
    ['repos: loading', ovProps({ url: { own: 'repos' }, data: { repos: slot<ReposData>(undefined, { loading: true }) } })],
    ['repos: error', ovProps({ url: { own: 'repos' }, data: { repos: slot<ReposData>(undefined, err('repositories')) } })],
    ['repos: empty', ovProps({ url: { own: 'repos' }, repos: [] })],
  ];

  // Revert: apply the height only in the populated branch, or on the outer section.
  it.each(branches)('%s', (_name, props) => {
    render(<OwnershipCard {...props} />);
    expect(body().style.height).toBe(`${OWNERSHIP_BODY_H}px`);
    expect(screen.getByTestId('ownership-card').style.height).toBe('');
  });
});

describe('tabs', () => {
  it('presses the tab named by url.own and labels the body with it', () => {
    const { rerender } = render(<OwnershipCard {...ovProps()} />);
    expect(screen.getByRole('button', { name: /Owning teams/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Repositories/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('team-table')).toBeTruthy();
    expect(body().getAttribute('aria-labelledby')).toBe('ownership-tab-teams');
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getByRole('button', { name: /Repositories/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('repo-table')).toBeTruthy();
    expect(screen.queryByTestId('team-table')).toBeNull();
    expect(body().getAttribute('aria-labelledby')).toBe('ownership-tab-repos');
  });

  // Revert: write the view or the team instead of `own`.
  it('a tab click calls url.setOwn', () => {
    const p = ovProps();
    render(<OwnershipCard {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Repositories/ }));
    expect(p.url.setOwn).toHaveBeenCalledWith('repos');
    fireEvent.click(screen.getByRole('button', { name: /Owning teams/ }));
    expect(p.url.setOwn).toHaveBeenLastCalledWith('teams');
  });

  it('the tab labels carry the team count and "N + M unmeasured" for repositories', () => {
    render(<OwnershipCard {...ovProps()} />);
    expect(screen.getByRole('button', { name: /Owning teams/ }).textContent).toBe('Owning teams2');
    expect(screen.getByRole('button', { name: /Repositories/ }).textContent).toBe('Repositories3 + 1 unmeasured');
  });

  it('the repositories count has no unmeasured part when none is unmeasured, and no count before the rows load', () => {
    const { unmount } = render(<OwnershipCard {...ovProps({ repos: [repoRow('acme/a', 'Payments')] })} />);
    expect(screen.getByRole('button', { name: /Repositories/ }).textContent).toBe('Repositories1');
    unmount();
    render(<OwnershipCard {...ovProps({ data: { repos: slot<ReposData>(undefined, { loading: true }) } })} />);
    expect(screen.getByRole('button', { name: /Repositories/ }).textContent).toBe('Repositories');
  });

  // Revert: render a count only when it has a value, or without the min-width: the Repositories tab slides
  // when the team count gains a digit.
  it('each tab count sits in a slot with a minimum width, in every state, so the tab after it does not move', () => {
    const states = [
      ovProps(),
      ovProps({ repos: [repoRow('acme/a', 'Payments')] }),
      ovProps({ data: { repos: slot<ReposData>(undefined, { loading: true }) } }),
    ];
    for (const p of states) {
      const { unmount } = render(<OwnershipCard {...p} />);
      for (const id of ['teams', 'repos']) {
        expect(screen.getByTestId(`ownership-tab-count-${id}`).style.minWidth).toBe(OWN_TAB_COUNT_MIN_W);
      }
      unmount();
    }
  });

  // Revert: drop the data-label / after: classes: the pressed tab is wider (semibold) and the other tab slides when you switch.
  it('each tab label reserves its semibold width, pressed or not, so switching tabs moves nothing', () => {
    for (const own of ['teams', 'repos'] as const) {
      const { unmount } = render(<OwnershipCard {...ovProps({ url: { own } })} />);
      for (const [id, label] of [['teams', 'Owning teams'], ['repos', 'Repositories']]) {
        const el = screen.getByTestId(`ownership-tab-label-${id}`);
        expect(el.getAttribute('data-label')).toBe(label);
        expect(el.className).toContain('after:font-semibold');
        expect(el.className).toContain('after:content-[attr(data-label)]');
      }
      unmount();
    }
  });

  it('explains what a click does on each tab', () => {
    const { rerender } = render(<OwnershipCard {...ovProps()} />);
    expect(screen.getByText('Click a team to filter the page to it')).toBeTruthy();
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getByText('Click a repository to open its alerts')).toBeTruthy();
  });
});

describe('interactions through the card', () => {
  // Revert: toggle the team in the card, or call setTeam.
  it('a team row click calls url.selectTeamRow', () => {
    const p = ovProps();
    render(<OwnershipCard {...p} />);
    fireEvent.click(screen.getByTestId('team-row-Payments'));
    expect(p.url.selectTeamRow).toHaveBeenCalledWith('Payments');
  });

  it('a repository row click calls url.selectRepoRow with the repository and its team', () => {
    const p = ovProps({ url: { own: 'repos' } });
    render(<OwnershipCard {...p} />);
    fireEvent.click(screen.getByTestId('repo-row-acme/checkout-api'));
    expect(p.url.selectRepoRow).toHaveBeenCalledWith({ fullName: 'acme/checkout-api', team: 'Payments' });
  });

  // Revert: leave the unmeasured row's stored count out of the footer sum (it then reads 6 where the team row reads 10).
  it('a team with an unmeasured repository that still holds stored alerts reads the same open counts in its team row and in the Repositories footer', () => {
    const rows = [
      repoRow('acme/a', 'Payments', { critical: cell({ open: 6 }), high: cell({ open: 2 }) }),
      repoRow('acme/legacy', 'Payments', { critical: cell({ open: 4 }), high: cell({ open: 1 }), unmeasured: { status: 'error', detail: null } }),
    ];
    const pivot = { rows: [ovTeam('Payments', ovCell(10), ovCell(3), 1)], total: ovTeam('Total', ovCell(10), ovCell(3), 1) };
    const props = (own: 'teams' | 'repos') => ovProps({ summary: { pivot }, repos: rows, url: { team: 'Payments', own } });
    const cells = (id: string) => Array.from(screen.getByTestId(id).querySelectorAll('[role="cell"]')).map(c => c.textContent);
    const { rerender } = render(<OwnershipCard {...props('teams')} />);
    const teamRow = cells('team-row-Payments');
    rerender(<OwnershipCard {...props('repos')} />);
    const footer = cells('repo-footer');
    // team row: [team, open crit, change, resolved, % closed, overdue crit, open high, ...]; footer: [label, open crit, overdue crit, open high, ...]
    expect([teamRow[1], teamRow[6]]).toEqual(['10', '3']);
    expect([footer[1], footer[3]]).toEqual(['10', '3']);
  });

  // Revert: build the team table from the scoped summary.
  it('with a team selected the team table still lists every team (it reads the unfiltered summary)', () => {
    const scoped = { pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1))], total: ovTeam('Total', ovCell(3), ovCell(1)) } };
    const everyone = summaryFixture({ pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1)), ovTeam('Search', ovCell(7), ovCell(2))], total: ovTeam('Total', ovCell(10), ovCell(3)) } });
    render(<OwnershipCard {...ovProps({ summary: scoped, url: { team: 'Payments' }, teamSummary: slot(everyone) })} />);
    expect(screen.getByTestId('team-row-Search')).toBeTruthy();
    expect(screen.getByTestId('team-row-Payments').className).toContain('bg-accent/10');
  });

  it('with a team selected the Repositories tab lists that team\'s rows from the scoped repos response', () => {
    const rows = [repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 2 }) })];
    const p = ovProps({ url: { own: 'repos', team: 'Payments' }, repos: rows });
    p.data.repos = slot(reposFixture(rows, { codebase: 'backend', team: 'Payments' }));
    render(<OwnershipCard {...p} />);
    expect(screen.getAllByTestId(/^repo-row-/)).toHaveLength(1);
    expect(screen.getByTestId('repo-footer').textContent).toContain('Payments total · 1 repo');
  });
});

describe('name filter', () => {
  it('exists only on the Repositories tab', () => {
    const { rerender } = render(<OwnershipCard {...ovProps()} />);
    expect(screen.queryByLabelText('Filter repositories by name')).toBeNull();
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getByLabelText('Filter repositories by name')).toBeTruthy();
  });

  // Revert: forget to pass the filter to the table, or leave the footer on "Total".
  it('narrows the rows by name and the footer reads "Matching"', () => {
    render(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getAllByTestId(/^repo-row-/)).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Filter repositories by name'), { target: { value: 'ledger' } });
    expect(screen.getAllByTestId(/^repo-row-/)).toHaveLength(1);
    expect(within(screen.getByTestId('repo-footer')).getByText(/Matching · 1 repo/)).toBeTruthy();
  });

  it('keeps its text when the tab is switched away and back', () => {
    const { rerender } = render(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    fireEvent.change(screen.getByLabelText('Filter repositories by name'), { target: { value: 'ledger' } });
    rerender(<OwnershipCard {...ovProps()} />);
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect((screen.getByLabelText('Filter repositories by name') as HTMLInputElement).value).toBe('ledger');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-ownership-card.test.tsx --maxWorkers=3`
Expected: FAIL, 15 of 23 tests (the stub has no tabs or tables, so the height tests alone pass).

- [ ] **Step 3: Implement**

Replace the whole of `src/app/vulnerabilities/ownership-card.tsx`:

```tsx
// src/app/vulnerabilities/ownership-card.tsx
'use client';
// GLOOK-64: the Overview's ownership card: an "Owning teams" tab and a "Repositories" tab over one
// 330px body that the tables scroll inside (their header and footer rows stay pinned). The body keeps
// its height in every state (loading, error, empty, populated), so a filter change never resizes the card.
import { useState } from 'react';
import type { SecurityViewProps } from './view-props';
import type { OwnTab } from './security-state';
import { OWNERSHIP_BODY_H, TYPE } from './dimensions';
import TeamTable from './team-table';
import RepoTable from './repo-table';

/** Every tab's count sits in a slot at least this wide, so a count going from one digit to two (a
 * filter changes the number of owning teams) does not move the tab after it. */
export const OWN_TAB_COUNT_MIN_W = '2ch';

const TABS: Array<{ id: OwnTab; label: string }> = [
  { id: 'teams', label: 'Owning teams' },
  { id: 'repos', label: 'Repositories' },
];

export default function OwnershipCard(props: SecurityViewProps) {
  const { url, data, summary } = props;
  const [nameFilter, setNameFilter] = useState('');

  const teamCount = (data.teamSummary.data ?? summary).pivot.rows.length;
  const repoRows = data.repos.data?.rows;
  const unmeasured = repoRows ? repoRows.filter(r => r.unmeasured).length : 0;
  const counts: Record<OwnTab, string | null> = {
    teams: String(teamCount),
    repos: repoRows ? `${repoRows.length - unmeasured}${unmeasured ? ` + ${unmeasured} unmeasured` : ''}` : null,
  };

  return (
    <section aria-label="Ownership" data-testid="ownership-card" className="flex flex-col gap-3">
      <h2 className={`${TYPE.sectionLabel} text-gray-400`}>Open alerts by owner</h2>
      <div className={`${TYPE.card} bg-gray-900 p-4`}>
        <div className="flex h-9 items-center justify-between gap-3 border-b border-gray-800">
          {/* A pressed-button group, not role="tab": the page's own view tabs are the only tablist, and the
              composer's tabpanel is the only tabpanel. */}
          <div role="group" aria-label="Ownership view" className="flex min-w-0 gap-5">
            {TABS.map(t => {
              const on = url.own === t.id;
              return (
                <button
                  key={t.id} type="button" id={`ownership-tab-${t.id}`} aria-pressed={on} aria-controls="ownership-panel"
                  className={`-mb-px flex min-w-0 items-baseline gap-1.5 border-b-2 pb-2 pt-1 ${TYPE.body} ${on ? 'border-accent font-semibold text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                  onClick={() => url.setOwn(t.id)}
                >
                  {/* The pressed tab is semibold. The invisible ::after copy of the label is semibold on both tabs, so
                      each tab is as wide as its bold label and switching tabs does not move the other one. */}
                  <span
                    data-testid={`ownership-tab-label-${t.id}`} data-label={t.label}
                    className="truncate after:invisible after:block after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]"
                  >{t.label}</span>
                  <span data-testid={`ownership-tab-count-${t.id}`} className="shrink-0 text-xs font-normal text-gray-500" style={{ minWidth: OWN_TAB_COUNT_MIN_W }}>{counts[t.id]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <span className="hidden truncate text-xs text-gray-500 md:block">
              {url.own === 'teams' ? 'Click a team to filter the page to it' : 'Click a repository to open its alerts'}
            </span>
            {url.own === 'repos' && (
              <input
                type="search" aria-label="Filter repositories by name" placeholder="Filter repositories by name" value={nameFilter}
                className={`h-7 w-56 ${TYPE.control} border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200 placeholder:text-gray-500`}
                onChange={e => setNameFilter(e.target.value)}
              />
            )}
          </div>
        </div>
        <div
          id="ownership-panel" role="region" aria-labelledby={`ownership-tab-${url.own}`} data-testid="ownership-card-body"
          className="mt-3 overflow-hidden" style={{ height: OWNERSHIP_BODY_H }}
        >
          {url.own === 'teams' ? <TeamTable {...props} /> : <RepoTable {...props} nameFilter={nameFilter} />}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-ownership-card.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (the page test still finds `ownership-card-body` at `OWNERSHIP_BODY_H` and exactly one `tabpanel`), tsc clean.

Named reverts: removing the `minWidth` from the tab counts, or rendering a count only when it has a value, fails "each tab count sits in a slot with a minimum width, in every state"; removing the `data-label` attribute or the `after:` classes from the label fails "each tab label reserves its semibold width, pressed or not".

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/ownership-card.tsx src/lib/__tests__/unit/vuln-ownership-card.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Ownership card with Owning teams and Repositories tabs"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.11: Trend rules (`trend-model.ts`)

**Files:**
- Create: `src/app/vulnerabilities/trend-model.ts`
- Test: `src/lib/__tests__/unit/vuln-trend-model.test.ts`

**Interfaces:**
- Consumes: `TrendSeries`; `addDays`, `diffDays` from `@/lib/vulnerabilities/time`; `toNum`; `TrendRange`; `shortDate` (3.1); `assignTeamColors`, `OTHER_TEAM_COLOR` from `team-colors.ts`; fixture `ovSeries` (3.3).
- Produces: `TREND_MIN_SPAN_DAYS` (7), `SHORT_HISTORY_DAYS` (14), `TREND_RANGES`; `dayNumber(iso)`, `isoOfDay(n)`; `trendDomain(range, series, today)`; `trendTicks(start, end, count?)`; `TrendRow`, `trendRows(drawnSeries)`; `trendStatus(series, range, today): { measurements, message, note }`; `LegendEntry`, `buildLegend(series, selectedTeam)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-trend-model.test.ts`:

```ts
// src/lib/__tests__/unit/vuln-trend-model.test.ts
// The trend card's pure rules: the domain, the rows, the history messages and the legend.
import {
  buildLegend, dayNumber, isoOfDay, trendDomain, trendRows, trendStatus, trendTicks, SHORT_HISTORY_DAYS, TREND_MIN_SPAN_DAYS,
} from '@/app/vulnerabilities/trend-model';
import { OTHER_TEAM_COLOR } from '@/app/vulnerabilities/team-colors';
import { ovSeries } from '../support/security-fixtures';

const TODAY = '2026-09-30';

describe('trendDomain', () => {
  // Revert: start "All" at the window start instead of the first point, or drop the 7-day floor.
  it('All runs from the first point to today', () => {
    const s = [ovSeries('Payments', [['2026-03-18', 5], ['2026-09-29', 11]])];
    expect(trendDomain('all', s, TODAY)).toEqual({ start: '2026-03-18', end: TODAY });
  });

  it(`All never spans less than ${TREND_MIN_SPAN_DAYS} days: two recent points, one point, or none`, () => {
    const floor = '2026-09-23';
    expect(trendDomain('all', [ovSeries('A', [['2026-09-28', 1], ['2026-09-29', 2]])], TODAY)).toEqual({ start: floor, end: TODAY });
    expect(trendDomain('all', [ovSeries('A', [['2026-09-30', 1]])], TODAY)).toEqual({ start: floor, end: TODAY });
    expect(trendDomain('all', [], TODAY)).toEqual({ start: floor, end: TODAY });
  });

  // Revert: compute the start from the first point for the other ranges too.
  it('the other ranges run from today minus 30, 90 or 365 days to today, whatever the data', () => {
    const s = [ovSeries('A', [['2026-09-20', 1], ['2026-09-29', 2]])];
    expect(trendDomain('30d', s, TODAY).start).toBe('2026-08-31');
    expect(trendDomain('90d', s, TODAY).start).toBe('2026-07-02');
    expect(trendDomain('1y', s, TODAY).start).toBe('2025-09-30');
    expect(trendDomain('30d', s, TODAY).end).toBe(TODAY);
  });

  it('a point after today extends the end instead of falling off the plot', () => {
    expect(trendDomain('all', [ovSeries('A', [['2026-09-01', 1], ['2026-10-02', 2]])], TODAY).end).toBe('2026-10-02');
  });
});

describe('ticks and day numbers', () => {
  it('round-trip an ISO date through the day number', () => {
    expect(isoOfDay(dayNumber('2026-09-30'))).toBe('2026-09-30');
    expect(dayNumber('2026-10-01') - dayNumber('2026-09-30')).toBe(1);
  });

  it('five evenly spaced whole-day ticks including both ends', () => {
    const t = trendTicks('2026-09-02', '2026-09-30');
    expect(t).toHaveLength(5);
    expect(t[0]).toBe(dayNumber('2026-09-02'));
    expect(t[4]).toBe(dayNumber('2026-09-30'));
    expect(t.every(Number.isInteger)).toBe(true);
  });
});

describe('trendRows', () => {
  // Revert: key rows by index, or merge teams that have different dates.
  it('has one row per date, keyed by team, with the actual day number (names with dots stay intact)', () => {
    const rows = trendRows([
      ovSeries('team.alpha', [['2026-09-01', 2], ['2026-09-29', 3]]),
      ovSeries('Search', [['2026-09-29', 7]]),
    ]);
    expect(rows.map(r => r.date)).toEqual(['2026-09-01', '2026-09-29']);
    expect(rows[1].values).toEqual({ 'team.alpha': 3, Search: 7 });
    expect(rows[0].values).toEqual({ 'team.alpha': 2 });
    expect(rows[1].t - rows[0].t).toBe(28);
  });

  it('coerces a string count from the database', () => {
    expect(trendRows([{ team: 'A', points: [{ date: '2026-09-29', open: '4' as unknown as number }] }])[0].values.A).toBe(4);
  });
});

describe('trendStatus', () => {
  // Revert: swap the two messages, or require only one point for a line.
  it('0 points: "No measurements yet", with the sub-line for the range', () => {
    expect(trendStatus([], 'all', TODAY).message).toEqual({ title: 'No measurements yet', sub: 'History starts at the first sync.' });
    expect(trendStatus([], '30d', TODAY).message).toEqual({ title: 'No measurements yet', sub: 'No measurements in this range.' });
  });

  it('1 point: "Not enough history yet" and where it is', () => {
    const s = trendStatus([ovSeries('A', [['2026-09-30', 1]]), ovSeries('B', [['2026-09-30', 2]])], 'all', TODAY);
    expect(s.measurements).toBe(1);
    expect(s.message).toEqual({ title: 'Not enough history yet', sub: '1 measurement so far (Sep 30). The line appears after the next sync.' });
  });

  it('counts distinct dates across all teams, not points per team', () => {
    const s = trendStatus([ovSeries('A', [['2026-09-01', 1]]), ovSeries('B', [['2026-09-29', 2]])], 'all', TODAY);
    expect(s.measurements).toBe(2);
    expect(s.message).toBeNull();
  });

  // Revert: show the note for an older history, or for a range other than All.
  it(`a history younger than ${SHORT_HISTORY_DAYS} days under All gets the "History starts" note`, () => {
    const young = [ovSeries('A', [['2026-09-22', 1], ['2026-09-29', 2]])];
    expect(trendStatus(young, 'all', TODAY).note).toBe('History starts Sep 22 (first sync) · 2 measurements');
    expect(trendStatus(young, '90d', TODAY).note).toBeNull();
    const old = [ovSeries('A', [['2026-03-18', 1], ['2026-09-29', 2]])];
    expect(trendStatus(old, 'all', TODAY).note).toBeNull();
    const edge = [ovSeries('A', [['2026-09-16', 1], ['2026-09-29', 2]])]; // exactly 14 days: not short
    expect(trendStatus(edge, 'all', TODAY).note).toBeNull();
  });
});

describe('buildLegend', () => {
  const many = Array.from({ length: 15 }, (_, i) => ovSeries(`Team ${String(i + 1).padStart(2, '0')}`, [['2026-09-01', 15 - i], ['2026-09-29', 15 - i]]));

  // Revert: list only the teams that got a colour, or one "Other" entry per team.
  it('lists every team: the top 12 by open count, then one "Other · N teams" entry', () => {
    const l = buildLegend(many, null);
    expect(l).toHaveLength(13);
    expect(l.slice(0, 12).map(e => e.label)).toEqual(many.slice(0, 12).map(s => s.team));
    expect(l[12].label).toBe('Other · 3 teams');
    expect(l[12].color).toBe(OTHER_TEAM_COLOR);
    expect(l[12].open).toBe(3 + 2 + 1);
    expect(new Set(l.slice(0, 12).map(e => e.color)).size).toBe(12);
  });

  // Revert: leave the names out of the tooltip.
  it('the "Other" entry\'s title names every team it stands for, and a named entry\'s title is its name', () => {
    const l = buildLegend(many, null);
    expect(l[12].title).toBe('Team 13, Team 14, Team 15');
    expect(l[0].title).toBe('Team 01');
  });

  it('"Other · 1 team" is singular, and no "Other" entry exists with 12 teams or fewer', () => {
    expect(buildLegend(many.slice(0, 13), null).at(-1)?.label).toBe('Other · 1 team');
    expect(buildLegend(many.slice(0, 12), null).some(e => e.label.startsWith('Other'))).toBe(false);
  });

  it('orders by open count, ties by name, and shows each team\'s latest count', () => {
    const l = buildLegend([ovSeries('Search', [['2026-09-29', 3]]), ovSeries('Payments', [['2026-09-29', 3]]), ovSeries('Platform', [['2026-09-22', 1], ['2026-09-29', 9]])], null);
    expect(l.map(e => [e.label, e.open])).toEqual([['Platform', 9], ['Payments', 3], ['Search', 3]]);
  });

  // Revert: drop entries for the unselected teams (the legend would then change height), or dim the selected one.
  it('selecting a team keeps every entry and dims all but that one to "dimmed"', () => {
    const l = buildLegend(many, 'Team 02');
    expect(l).toHaveLength(13);
    expect(l.filter(e => !e.dimmed).map(e => e.label)).toEqual(['Team 02']);
    expect(l.find(e => e.selected)?.label).toBe('Team 02');
  });

  it('selecting a team inside "Other" leaves only the "Other" entry undimmed', () => {
    const l = buildLegend(many, 'Team 14');
    expect(l.filter(e => !e.dimmed).map(e => e.label)).toEqual(['Other · 3 teams']);
  });

  it('with no team selected nothing is dimmed or selected', () => {
    const l = buildLegend(many, null);
    expect(l.some(e => e.dimmed || e.selected)).toBe(false);
  });

  it('no series, no entries', () => {
    expect(buildLegend([], null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-trend-model.test.ts --maxWorkers=3`
Expected: FAIL, `Cannot find module '@/app/vulnerabilities/trend-model'`.

- [ ] **Step 3: Implement**

Create `src/app/vulnerabilities/trend-model.ts`:

```ts
// src/app/vulnerabilities/trend-model.ts
// GLOOK-64: the trend card's pure rules: the x-axis domain, the rows a chart draws, the "not enough
// history" messages and the legend. No React and no server imports. Points are placed by their actual
// date; nothing here fills a gap or rebuilds history from alert timestamps.
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { addDays, diffDays } from '@/lib/vulnerabilities/time';
import { toNum } from '@/components/charts/chart-format';
import type { TrendRange } from './security-state';
import { shortDate } from './overview-format';
import { assignTeamColors, OTHER_TEAM_COLOR } from './team-colors';

const DAY_MS = 86_400_000;

/** The All range always spans at least this many days, so two nearby points do not fill the plot. */
export const TREND_MIN_SPAN_DAYS = 7;
/** A history younger than this shows the "History starts ..." note. */
export const SHORT_HISTORY_DAYS = 14;

export const TREND_RANGES: ReadonlyArray<readonly [TrendRange, string]> = [
  ['all', 'All time'], ['1y', 'Last year'], ['90d', 'Last 90 days'], ['30d', 'Last 30 days'],
];
const RANGE_DAYS: Record<Exclude<TrendRange, 'all'>, number> = { '30d': 30, '90d': 90, '1y': 365 };

/** Days since the epoch, as the chart's numeric x value. */
export const dayNumber = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
export const isoOfDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

const allDates = (series: readonly TrendSeries[]): string[] =>
  [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();

/**
 * The x-axis span. "All" runs from the first point to today and never spans less than
 * TREND_MIN_SPAN_DAYS; the other ranges run from today minus 30, 90 or 365 days to today. A point
 * after today (a skewed clock) extends the end rather than falling off the plot.
 */
export function trendDomain(range: TrendRange, series: readonly TrendSeries[], today: string): { start: string; end: string } {
  const dates = allDates(series);
  const last = dates[dates.length - 1];
  const end = last && last > today ? last : today;
  if (range !== 'all') return { start: addDays(today, -RANGE_DAYS[range]), end };
  const floor = addDays(end, -TREND_MIN_SPAN_DAYS);
  return { start: dates[0] && dates[0] < floor ? dates[0] : floor, end };
}

/** Evenly spaced whole-day ticks across the domain, first and last included. */
export function trendTicks(start: string, end: string, count = 5): number[] {
  const a = dayNumber(start);
  const b = dayNumber(end);
  return Array.from({ length: count }, (_, i) => Math.round(a + ((b - a) * i) / (count - 1)));
}

export interface TrendRow { t: number; date: string; values: Record<string, number> }

/** One row per date that has a point in a drawn series, keyed by team (names may contain dots). */
export function trendRows(drawn: readonly TrendSeries[]): TrendRow[] {
  const byDate = new Map<string, TrendRow>();
  for (const s of drawn) {
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { t: dayNumber(p.date), date: p.date, values: {} };
      row.values[s.team] = toNum(p.open);
      byDate.set(p.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t);
}

export interface TrendStatus {
  /** Stored measurements in range: distinct dates across ALL teams, whichever team is drawn. */
  measurements: number;
  /** Shown instead of the chart when there are fewer than two. */
  message: { title: string; sub: string } | null;
  /** Shown over a chart whose history is short. */
  note: string | null;
}

export function trendStatus(series: readonly TrendSeries[], range: TrendRange, today: string): TrendStatus {
  const dates = allDates(series);
  if (dates.length === 0) {
    return {
      measurements: 0,
      message: { title: 'No measurements yet', sub: range === 'all' ? 'History starts at the first sync.' : 'No measurements in this range.' },
      note: null,
    };
  }
  if (dates.length === 1) {
    return {
      measurements: 1,
      message: { title: 'Not enough history yet', sub: `1 measurement so far (${shortDate(dates[0])}). The line appears after the next sync.` },
      note: null,
    };
  }
  // The note says where history starts, which only the All range can claim.
  const young = range === 'all' && diffDays(today, dates[0]) < SHORT_HISTORY_DAYS;
  return {
    measurements: dates.length,
    message: null,
    note: young ? `History starts ${shortDate(dates[0])} (first sync) · ${dates.length} measurements` : null,
  };
}

export interface LegendEntry {
  label: string;
  color: string;
  /** Open count at the team's latest point; for "Other", the sum over its teams. */
  open: number;
  /** The tooltip: the team's name, or for "Other" every name it stands for. */
  title: string;
  /** Teams this entry stands for. */
  teams: string[];
  /** Dimmed to 0.4 because another team is selected. */
  dimmed: boolean;
  selected: boolean;
}

const latestOpen = (s: TrendSeries): number => toNum(s.points[s.points.length - 1]?.open);

/**
 * Every owning team, always: the top 12 by open count (the ones assignTeamColors gives a colour) each
 * with their own entry, then one "Other · N teams" entry for the rest. Selecting a team never removes
 * an entry, so the legend's height does not change; the others are marked dimmed instead.
 */
export function buildLegend(series: readonly TrendSeries[], selected: string | null): LegendEntry[] {
  const colors = assignTeamColors([...series]);
  const ranked = [...series].sort((a, b) => latestOpen(b) - latestOpen(a) || a.team.localeCompare(b.team));
  const entry = (teams: TrendSeries[], label: string, color: string, title: string): LegendEntry => ({
    label, color, title, teams: teams.map(s => s.team), open: teams.reduce((n, s) => n + latestOpen(s), 0),
    dimmed: selected !== null && !teams.some(s => s.team === selected),
    selected: selected !== null && teams.some(s => s.team === selected),
  });
  const named = ranked.filter(s => colors[s.team] !== OTHER_TEAM_COLOR);
  const rest = ranked.filter(s => colors[s.team] === OTHER_TEAM_COLOR);
  const out = named.map(s => entry([s], s.team, colors[s.team], s.team));
  if (rest.length) {
    out.push(entry(rest, `Other · ${rest.length} ${rest.length === 1 ? 'team' : 'teams'}`, OTHER_TEAM_COLOR, rest.map(s => s.team).sort((a, b) => a.localeCompare(b)).join(', ')));
  }
  return out;
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-trend-model.test.ts --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (20 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/trend-model.ts src/lib/__tests__/unit/vuln-trend-model.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: trend axis, history and legend rules"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.12: Trend card (`trend-card.tsx`)

**Files:**
- Modify: `src/app/vulnerabilities/trend-card.tsx` (replace the Wave 2 stub)
- Test: `src/lib/__tests__/unit/vuln-trend-card.test.tsx`

**Interfaces:**
- Consumes: Recharts (`CartesianGrid`, `Line`, `LineChart`, `XAxis`, `YAxis`), `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig` from `@/components/charts/chart`; `trend-model.ts` (3.11); `openChange`, `shortDate` (3.1); `assignTeamColors`, `OTHER_TEAM_COLOR`; `data.trend` (the unscoped series for the chosen range), `url.range`, `url.setRange`, `url.team`, `url.kSev`; `TREND_PLOT_H`; the test helper `fixChartSize` from `src/lib/__tests__/setup/chart-size.ts`.
- Produces: default export `TrendCard(props: SecurityViewProps)`: `section` `data-testid="trend-card"` (no inline height); the plot `data-testid="trend-plot"` with inline height `TREND_PLOT_H` in every branch (chart, `trend-message`, loading, error); `trend-open-now`, `trend-change`, `trend-note`, `trend-legend` (`min-h-[32px]`, entries `trend-legend-entry` keyed by position) and `trend-footnote`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-trend-card.test.tsx`:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-trend-card.test.tsx
// The trend card (replaces vuln-trend-chart.test.tsx). Dates are built relative to today so the tests
// need no fake clock (Recharts schedules animation frames).
import { fireEvent, render, screen, within } from '@testing-library/react';
import TrendCard from '@/app/vulnerabilities/trend-card';
import { TREND_PLOT_H } from '@/app/vulnerabilities/dimensions';
import { assignTeamColors } from '@/app/vulnerabilities/team-colors';
import { dayNumber, trendDomain } from '@/app/vulnerabilities/trend-model';
import { shortDate } from '@/app/vulnerabilities/overview-format';
import { addDays } from '@/lib/vulnerabilities/time';
import type { TrendData } from '@/app/vulnerabilities/api-types';
import { ovBaseline, ovDelta, ovDeltaTeam, ovProps, ovSeries, slot, trendFixture } from '../support/security-fixtures';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => addDays(TODAY, -n);
const SERIES = [
  ovSeries('TeamA', [[ago(40), 4], [ago(1), 6]]),
  ovSeries('TeamB', [[ago(40), 9], [ago(1), 7]]),
  ovSeries('team.alpha', [[ago(40), 2], [ago(1), 3]]),
];
const props = (series = SERIES, o: Parameters<typeof ovProps>[0] = {}) => ovProps({ ...o, data: { trend: slot(trendFixture(series)), ...o.data } });
const strokes = (c: HTMLElement) => Array.from(c.querySelectorAll('path.recharts-line-curve')).map(p => p.getAttribute('stroke'));
const legend = () => screen.getAllByTestId('trend-legend-entry');

describe('the plot box', () => {
  const err = { error: new Error('x'), errorText: "Couldn't load trend: x", loading: false };
  const branches: Array<[string, ReturnType<typeof ovProps>]> = [
    ['populated', props()],
    ['stale', ovProps({ data: { trend: slot(trendFixture(SERIES), { stale: true }) } })],
    ['loading', ovProps({ data: { trend: slot<TrendData>(undefined, { loading: true }) } })],
    ['error', ovProps({ data: { trend: slot<TrendData>(undefined, err) } })],
    ['no measurements', props([])],
    ['one measurement', props([ovSeries('TeamA', [[ago(1), 4]])])],
  ];

  // Revert: apply the height only to the populated chart, or on the outer section.
  it.each(branches)('%s: 220px tall, with no fixed height on the card', (_n, p) => {
    render(<TrendCard {...p} />);
    expect(screen.getByTestId('trend-plot').style.height).toBe(`${TREND_PLOT_H}px`);
    expect(screen.getByTestId('trend-card').style.height).toBe('');
  });

  it('a failed request shows its message and Loading… shows before the first response', () => {
    const { unmount } = render(<TrendCard {...branches[3][1]} />);
    expect(within(screen.getByTestId('trend-plot')).getByText("Couldn't load trend: x")).toBeTruthy();
    unmount();
    render(<TrendCard {...branches[2][1]} />);
    expect(within(screen.getByTestId('trend-plot')).getByText('Loading…')).toBeTruthy();
  });

  it('dims while it shows the previous key\'s data', () => {
    render(<TrendCard {...branches[1][1]} />);
    expect(screen.getByTestId('trend-plot').className).toContain('opacity-60');
  });
});

describe('header', () => {
  it('names the severity: "Open critical alerts by owning team", or high under "High only"', () => {
    const { rerender } = render(<TrendCard {...props()} />);
    expect(screen.getByText('Open critical alerts by owning team')).toBeTruthy();
    rerender(<TrendCard {...props(SERIES, { url: { severity: 'high', kSev: 'high' } })} />);
    expect(screen.getByText('Open high alerts by owning team')).toBeTruthy();
    expect(screen.getByText('One point per stored measurement')).toBeTruthy();
  });

  // Revert: change the default, the order or the labels.
  it('the range select lists All time (the default), Last year, Last 90 days, Last 30 days', () => {
    render(<TrendCard {...props()} />);
    const select = screen.getByLabelText('Range') as HTMLSelectElement;
    expect(select.value).toBe('all');
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([
      ['all', 'All time'], ['1y', 'Last year'], ['90d', 'Last 90 days'], ['30d', 'Last 30 days'],
    ]);
  });

  // Revert: write another URL key, or ignore the change.
  it('choosing a range calls url.setRange', () => {
    const p = props();
    render(<TrendCard {...p} />);
    fireEvent.change(screen.getByLabelText('Range'), { target: { value: '90d' } });
    expect(p.url.setRange).toHaveBeenCalledWith('90d');
  });

  it('shows "N open now" from the scoped summary and the change sentence under it', () => {
    const p = props(SERIES, { summary: { delta: { critical: ovDelta(ovDeltaTeam('Total', 2), { baseline: ovBaseline('2026-09-29') }), high: ovDelta(null) } } });
    render(<TrendCard {...p} />);
    expect(screen.getByTestId('trend-open-now').textContent).toBe('10 open now');
    expect(screen.getByTestId('trend-change').textContent).toBe('▲ 2 more than on Sep 29');
    expect(screen.getByTestId('trend-change').className).toContain('text-red-400');
  });

  it('with no baseline the sentence says so', () => {
    render(<TrendCard {...props()} />);
    expect(screen.getByTestId('trend-change').textContent).toBe('No earlier measurement yet');
  });
});

describe('lines and colours', () => {
  // Revert: build colours from the drawn (filtered) series.
  it('draws one line per team in its own colour; the colours are distinct and come from the unfiltered series', () => {
    const { container } = render(<TrendCard {...props()} />);
    const colors = assignTeamColors(SERIES);
    expect(strokes(container)).toHaveLength(3);
    expect([...strokes(container)].sort()).toEqual(Object.values(colors).sort());
    expect(new Set(strokes(container)).size).toBe(3);
  });

  // Revert: draw every team when one is selected, or recompute the colour from the filtered series.
  it('a selected team draws only its own line, in the colour it had before', () => {
    const colors = assignTeamColors(SERIES);
    const { container } = render(<TrendCard {...props(SERIES, { url: { team: 'TeamB' } })} />);
    expect(strokes(container)).toEqual([colors.TeamB]);
    expect(colors.TeamB).not.toBe('var(--vuln-series-1)');
  });

  it('draws a line for a team whose name contains a dot (no lodash-path dataKey lookup)', () => {
    const { container } = render(<TrendCard {...props(SERIES, { url: { team: 'team.alpha' } })} />);
    const path = container.querySelector('path.recharts-line-curve');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
  });

  it('teams beyond the top 12 are thinner grey lines', () => {
    const many = Array.from({ length: 14 }, (_, i) => ovSeries(`Team ${String(i + 1).padStart(2, '0')}`, [[ago(40), 14 - i], [ago(1), 14 - i]]));
    const { container } = render(<TrendCard {...props(many)} />);
    const paths = Array.from(container.querySelectorAll('path.recharts-line-curve'));
    const grey = paths.filter(p => p.getAttribute('stroke') === 'var(--vuln-series-other)');
    expect(grey).toHaveLength(2);
    expect(grey.every(p => Number(p.getAttribute('stroke-width')) < 2)).toBe(true);
    expect(paths.filter(p => p.getAttribute('stroke') !== 'var(--vuln-series-other)').every(p => p.getAttribute('stroke-width') === '2')).toBe(true);
  });
});

describe('placement by date', () => {
  // The plot's left and right edges: the first gridline spans the whole plot.
  const edges = (c: HTMLElement): [number, number] => {
    const line = c.querySelector('.recharts-cartesian-grid-horizontal line')!;
    return [Number(line.getAttribute('x1')), Number(line.getAttribute('x2'))];
  };
  const dotXs = (c: HTMLElement) => Array.from(c.querySelectorAll('circle.recharts-dot')).map(d => Number(d.getAttribute('cx'))).sort((a, b) => a - b);

  // Revert: use a category axis (even spacing) instead of the numeric date axis.
  it('puts each dot at its date\'s share of the axis, not evenly spaced', () => {
    const s = [ovSeries('TeamA', [[ago(28), 1], [ago(21), 2], [ago(0), 3]])];
    const { container } = render(<TrendCard {...props(s)} />);
    const [x0, x4] = edges(container);
    const { start, end } = trendDomain('all', s, TODAY);
    const frac = (iso: string) => (dayNumber(iso) - dayNumber(start)) / (dayNumber(end) - dayNumber(start));
    const dots = dotXs(container);
    expect(dots).toHaveLength(3);
    dots.forEach((cx, i) => expect((cx - x0) / (x4 - x0)).toBeCloseTo(frac([ago(28), ago(21), ago(0)][i]), 2));
  });

  // Revert: start All at the first point regardless of the 7-day floor.
  it('All spans at least 7 days even when the first point is yesterday', () => {
    const s = [ovSeries('TeamA', [[ago(2), 1], [ago(1), 2]])];
    const { container } = render(<TrendCard {...props(s)} />);
    const [x0, x4] = edges(container);
    const dots = dotXs(container);
    expect((dots[0] - x0) / (x4 - x0)).toBeCloseTo(5 / 7, 2);
    expect((dots[1] - x0) / (x4 - x0)).toBeCloseTo(6 / 7, 2);
  });

  it('the other ranges run from today minus 30, 90 or 365 days', () => {
    const s = [ovSeries('TeamA', [[ago(20), 1], [ago(10), 2]])];
    const { container } = render(<TrendCard {...props(s, { url: { range: '30d' } })} />);
    const [x0, x4] = edges(container);
    expect((dotXs(container)[0] - x0) / (x4 - x0)).toBeCloseTo(10 / 30, 2);
  });
});

describe('history messages', () => {
  it('shows "No measurements yet" instead of a chart for 0 points, and the range-specific sub-line', () => {
    const { container, rerender } = render(<TrendCard {...props([])} />);
    expect(screen.getByTestId('trend-message').textContent).toBe('No measurements yetHistory starts at the first sync.');
    expect(container.querySelector('svg')).toBeNull();
    rerender(<TrendCard {...props([], { url: { range: '30d' } })} />);
    expect(screen.getByTestId('trend-message').textContent).toBe('No measurements yetNo measurements in this range.');
  });

  it('shows "Not enough history yet" for 1 point, naming it', () => {
    const { container } = render(<TrendCard {...props([ovSeries('TeamA', [[ago(1), 4]]), ovSeries('TeamB', [[ago(1), 2]])])} />);
    expect(screen.getByTestId('trend-message').textContent).toBe(`Not enough history yet1 measurement so far (${shortDate(ago(1))}). The line appears after the next sync.`);
    expect(container.querySelector('svg')).toBeNull();
  });

  // Revert: show the note for an old history, or never.
  it('a history younger than 14 days shows the "History starts" note over the chart; an older one does not', () => {
    const young = [ovSeries('TeamA', [[ago(6), 1], [ago(1), 2]])];
    const { rerender } = render(<TrendCard {...props(young)} />);
    expect(screen.getByTestId('trend-note').textContent).toMatch(/^History starts .* \(first sync\) · 2 measurements$/);
    rerender(<TrendCard {...props()} />);
    expect(screen.queryByTestId('trend-note')).toBeNull();
  });

  it('a team with fewer points than the rest does not turn the chart into the message', () => {
    const { container } = render(<TrendCard {...props([ovSeries('TeamA', [[ago(40), 4], [ago(1), 6]]), ovSeries('TeamB', [[ago(1), 7]])], { url: { team: 'TeamB' } })} />);
    expect(screen.queryByTestId('trend-message')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('legend', () => {
  const many = Array.from({ length: 15 }, (_, i) => ovSeries(`Team ${String(i + 1).padStart(2, '0')}`, [[ago(40), 15 - i], [ago(1), 15 - i]]));

  it('names every team in chrome text beside a swatch in the team colour, with its open count', () => {
    render(<TrendCard {...props()} />);
    const colors = assignTeamColors(SERIES);
    expect(legend()).toHaveLength(3);
    for (const e of legend()) {
      const label = e.children[1] as HTMLElement;
      expect(label.className).toContain('text-chart-axis');
      expect(label.getAttribute('style') ?? '').not.toContain('color');
      expect((e.querySelector('i') as HTMLElement).style.background).toBe(colors[label.textContent!]);
    }
    expect(legend().map(e => e.textContent)).toEqual(['TeamB7 open', 'TeamA6 open', 'team.alpha3 open']);
  });

  // Revert: list only the coloured teams.
  it('with more than 12 teams: the top 12, then one "Other · N teams" entry whose tooltip names the rest', () => {
    render(<TrendCard {...props(many)} />);
    expect(legend()).toHaveLength(13);
    const other = legend()[12];
    expect(other.textContent).toBe('Other · 3 teams6 open');
    expect(other.getAttribute('title')).toBe('Team 13, Team 14, Team 15');
    expect((other.querySelector('i') as HTMLElement).style.background).toBe('var(--vuln-series-other)');
  });

  // Revert: filter the legend to the selected team, or skip the dimming.
  it('selecting a team keeps every entry, dims the others to 0.4 and bolds the selected one', () => {
    const { rerender } = render(<TrendCard {...props(many)} />);
    const count = legend().length;
    expect(legend().every(e => e.style.opacity === '1')).toBe(true);
    rerender(<TrendCard {...props(many, { url: { team: 'Team 02' } })} />);
    expect(legend()).toHaveLength(count);
    expect(legend().filter(e => e.style.opacity === '1').map(e => e.getAttribute('title'))).toEqual(['Team 02']);
    expect(legend().filter(e => e.style.opacity === '0.4')).toHaveLength(count - 1);
    expect(within(legend()[1]).getByText('Team 02').className).toContain('font-semibold');
  });

  it('selecting a team inside "Other" leaves only the "Other" entry undimmed', () => {
    render(<TrendCard {...props(many, { url: { team: 'Team 14' } })} />);
    expect(legend().filter(e => e.style.opacity === '1').map(e => e.textContent)).toEqual(['Other · 3 teams6 open']);
  });

  // Revert: key the entries by team name.
  it('entries are the same DOM nodes across a series swap, with their text updated', () => {
    const swapped = SERIES.map((s, i) => ({ ...s, team: `Swapped${i}` }));
    const { rerender } = render(<TrendCard {...props()} />);
    const before = legend();
    rerender(<TrendCard {...props(swapped)} />);
    legend().forEach((el, i) => expect(el).toBe(before[i]));
    expect(legend().map(e => e.textContent).join(' ')).toContain('Swapped');
  });

  // Revert: drop the min-height (the card then resizes between an empty and a populated state).
  it('reserves two lines in every state, and the footnote is always there', () => {
    for (const p of [props(), props([]), ovProps({ data: { trend: slot<TrendData>(undefined, { loading: true }) } })]) {
      const { unmount } = render(<TrendCard {...p} />);
      expect(screen.getByTestId('trend-legend').className).toContain('min-h-[32px]');
      expect(screen.getByTestId('trend-footnote').textContent).toBe('Each dot is one stored measurement (an imported CSV run or a sync).');
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**
Run: `npx jest src/lib/__tests__/unit/vuln-trend-card.test.tsx --maxWorkers=3`
Expected: FAIL, 24 of 30 tests (the stub renders only an empty `trend-plot`).

- [ ] **Step 3: Implement**

Dates sit on a numeric time axis (`type="number"` over day numbers), so a point's position is its date's share of the axis. Colours always come from `assignTeamColors` over the UNFILTERED series, so a team keeps its colour when it is the only line drawn. The component contains no hex value and no `fill-gray-*` or `stroke-gray-*` class (Task 3.13's guard checks this). Replace the whole of `src/app/vulnerabilities/trend-card.tsx`:

```tsx
// src/app/vulnerabilities/trend-card.tsx
'use client';
// GLOOK-64: "Open {severity} alerts by owning team". One line per team, one dot per STORED
// measurement, placed on a numeric time axis by the measurement's actual date. The series is the
// unscoped trend (so colours and the legend never depend on the selected team); a selected team draws
// only its own line and dims the other legend entries. The plot box is TREND_PLOT_H in every state.
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/charts/chart';
import { toNum } from '@/components/charts/chart-format';
import type { SecurityViewProps } from './view-props';
import type { TrendRange } from './security-state';
import { TREND_PLOT_H, TYPE } from './dimensions';
import { openChange, shortDate } from './overview-format';
import { OTHER_TEAM_COLOR, assignTeamColors } from './team-colors';
import { buildLegend, dayNumber, isoOfDay, TREND_RANGES, trendDomain, trendRows, trendStatus, trendTicks, type TrendRow } from './trend-model';

const FOOTNOTE = 'Each dot is one stored measurement (an imported CSV run or a sync).';
const todayUtc = () => new Date().toISOString().slice(0, 10);

function Plot({ series, team, range, today }: { series: TrendSeries[]; team: string | null; range: TrendRange; today: string }) {
  const colors = assignTeamColors(series);
  const drawn = team ? series.filter(s => s.team === team) : series;
  const rows = trendRows(drawn);
  const { start, end } = trendDomain(range, series, today);
  // The grey "other" lines go first, so the coloured top-12 lines are drawn over them.
  const ordered = [...drawn].sort((a, b) => Number(colors[b.team] === OTHER_TEAM_COLOR) - Number(colors[a.team] === OTHER_TEAM_COLOR));
  // Labels only: a colour here would make ChartStyle emit a --color-<team name> custom property per team.
  const config: ChartConfig = Object.fromEntries(drawn.map(s => [s.team, { label: s.team }]));
  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full">
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t" type="number" domain={[dayNumber(start), dayNumber(end)]} ticks={trendTicks(start, end)}
          tickFormatter={(t: number) => shortDate(isoOfDay(t))} tickLine={false} axisLine={false} allowDataOverflow
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} domain={[0, 'auto']} />
        <ChartTooltip
          itemSorter={item => -toNum(item.value)}
          content={<ChartTooltipContent indicator="line" labelFormatter={(_v, payload) => shortDate(String((payload?.[0]?.payload as TrendRow | undefined)?.date ?? ''))} />}
        />
        {ordered.map(s => {
          const other = colors[s.team] === OTHER_TEAM_COLOR;
          const color = colors[s.team] ?? OTHER_TEAM_COLOR;
          return (
            <Line
              key={s.team} type="linear" name={s.team} dataKey={(row: TrendRow) => row.values[s.team] ?? null}
              stroke={color} strokeWidth={other ? 1.25 : 2}
              dot={{ r: other ? 1.5 : 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: other ? 3 : 4, fill: color, strokeWidth: 0 }}
              connectNulls isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ChartContainer>
  );
}

export default function TrendCard({ summary, data, url }: SecurityViewProps) {
  const sev = url.kSev;
  const slot = data.trend;
  const series = slot.data?.series;
  const today = todayUtc();
  const status = series ? trendStatus(series, url.range, today) : null;
  const legend = series ? buildLegend(series, url.team) : [];
  const change = openChange(summary.delta[sev], sev);

  return (
    <section aria-label="Trend" data-testid="trend-card" className="flex flex-col gap-3">
      <h2 className={`${TYPE.sectionLabel} text-gray-400`}>Trend</h2>
      <div className={`${TYPE.card} bg-gray-900 p-4`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">Open {sev} alerts by owning team</h3>
            <p className="text-xs text-gray-400">One point per stored measurement</p>
          </div>
          <div className="flex shrink-0 items-start gap-4">
            <select
              aria-label="Range" value={url.range} onChange={e => url.setRange(e.target.value as TrendRange)}
              className={`h-8 ${TYPE.control} border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200`}
            >
              {TREND_RANGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <div className="text-right">
              <div data-testid="trend-open-now" className="text-sm font-semibold text-white">{summary.pivot.total[sev].open} open now</div>
              <div data-testid="trend-change" className={`h-4 text-xs leading-4 ${change.toneClass}`}>{change.text}</div>
            </div>
          </div>
        </div>

        <div data-testid="trend-plot" className={`relative mt-3${slot.stale ? ' opacity-60' : ''}`} style={{ height: TREND_PLOT_H }}>
          {slot.errorText && <p className="flex h-full items-center justify-center text-xs text-red-400">{slot.errorText}</p>}
          {!slot.errorText && !series && <p className="flex h-full items-center justify-center text-xs text-gray-500">Loading…</p>}
          {!slot.errorText && series && status?.message && (
            <div data-testid="trend-message" className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-gray-300">{status.message.title}</p>
              <p className="text-xs text-gray-500">{status.message.sub}</p>
            </div>
          )}
          {!slot.errorText && series && status && !status.message && (
            <>
              <Plot series={series} team={url.team} range={url.range} today={today} />
              {status.note && <p data-testid="trend-note" className="pointer-events-none absolute left-9 top-0 text-[11px] text-gray-500">{status.note}</p>}
            </>
          )}
        </div>

        {/* Entries are keyed by position: keyed by team, a team click looked (to the layout-shift API)
            like the surviving entry sliding to the start of the row. Two lines are reserved. */}
        <div data-testid="trend-legend" className="mt-3 flex min-h-[32px] flex-wrap content-start gap-x-4 gap-y-0 text-[11px] leading-4">
          {legend.map((e, i) => (
            <span
              key={i} data-testid="trend-legend-entry" title={e.title} className="flex cursor-default items-center gap-1.5"
              style={{ opacity: e.dimmed ? 0.4 : 1 }}
            >
              <i aria-hidden="true" className="inline-block h-[3px] w-3 rounded-sm" style={{ background: e.color }} />
              <span className={`text-chart-axis ${e.selected ? 'font-semibold' : ''}`}>{e.label}</span>
              <span className="text-gray-500">{e.open} open</span>
            </span>
          ))}
        </div>
        <p data-testid="trend-footnote" className="mt-1 text-[10px] leading-[14px] text-gray-500">{FOOTNOTE}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**
Run: `npx jest src/lib/__tests__/unit/vuln-trend-card.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS (30 tests), tsc clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/vulnerabilities/trend-card.tsx src/lib/__tests__/unit/vuln-trend-card.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: trend card with date-placed points and a stable legend"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Task 3.13: Retire `team-pivot.tsx` and `trend-chart.tsx`, repoint the chart guards

**Files:**
- Delete: `src/app/vulnerabilities/team-pivot.tsx`, `src/app/vulnerabilities/trend-chart.tsx`, `src/lib/__tests__/unit/vuln-team-pivot.test.tsx`, `src/lib/__tests__/unit/vuln-trend-chart.test.tsx`
- Modify: `src/lib/__tests__/unit/chart-no-literal-colors.test.ts` (`EXTRA` list and the exact-list assertion)
- Modify: `src/lib/__tests__/unit/chart-tokens-css.test.ts` (`REFERENCING_FILES`)
- Modify: `src/lib/__tests__/unit/vuln-owning-team-label.test.tsx` (remove the `TeamPivot` half; the `AlertsTable` half stays for Wave 4)

**Interfaces:**
- Consumes: the new chart modules `trend-card.tsx` and `sparkline.tsx` (3.2, 3.12).
- Produces: nothing new. After this task no file imports `team-pivot` or `trend-chart`.

This task changes no behaviour. Its tests are guards, so the failing-test step is replaced by a check that the guard bites. Every behaviour the deleted tests covered is re-covered in Tasks 3.1 to 3.12 (see the rewrite map).

- [ ] **Step 1: Update the guards**

In `src/lib/__tests__/unit/chart-no-literal-colors.test.ts`, replace the `EXTRA` array with:

```ts
const EXTRA = [
  'src/app/vulnerabilities/trend-card.tsx',
  'src/app/vulnerabilities/sparkline.tsx',
  'src/app/vulnerabilities/team-colors.ts',
  'src/app/projects/progress-ring.tsx',
];
```

and replace the expected list inside `it('scans every chart module', ...)` with:

```ts
  expect(names).toEqual([
    'src/app/projects/progress-ring.tsx',
    'src/app/vulnerabilities/sparkline.tsx',
    'src/app/vulnerabilities/team-colors.ts',
    'src/app/vulnerabilities/trend-card.tsx',
    'src/components/charts/chart-format.ts',
    'src/components/charts/chart.tsx',
    'src/components/charts/commit-type-donut.tsx',
    'src/components/charts/commit-types.ts',
    'src/components/charts/hatch.tsx',
    'src/components/charts/lines-changed-chart.tsx',
    'src/components/charts/spend-impact-scatter.tsx',
    'src/components/charts/stacked-types-chart.tsx',
    'src/components/charts/timeline-chart.tsx',
  ]);
```

In `src/lib/__tests__/unit/chart-tokens-css.test.ts`, replace the `REFERENCING_FILES` array with:

```ts
const REFERENCING_FILES = [
  'tailwind.config.ts',
  'src/app/vulnerabilities/trend-card.tsx',
  'src/app/vulnerabilities/sparkline.tsx',
  'src/app/projects/progress-ring.tsx',
  'src/components/ProjectsCard.tsx',
];
```

Replace the whole of `src/lib/__tests__/unit/vuln-owning-team-label.test.tsx` with (the "Owning team" header assertion now lives in `vuln-team-table.test.tsx`, test "the first header reads "Owning team" and says it is not a Glooker team"):

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-owning-team-label.test.tsx
// GLOOK-59 Task 9: the vulnerability repo "team" custom property is relabeled "Owning team" so
// it isn't confused with a Glooker (people) team — the team table's header (now covered by
// vuln-team-table.test.tsx) and AlertsTable's dropdown (still here until it is replaced).
import React from 'react';
import { render, screen } from '@testing-library/react';
import AlertsTable from '@/app/vulnerabilities/alerts-table';
import { listAlerts } from '@/lib/vulnerabilities/aggregate';

const R = (repoId: number, team: string) => ({ repoId, fullName: `o/r${repoId}`, team, serviceTier: 'production', codebaseType: 'backend', archived: false, dependabotStatus: 'ok', dependabotStatusDetail: null }) as any;
const A = (repoId: number, n: number, over: any = {}) => ({ repoId, number: n, htmlUrl: `u${repoId}${n}`, state: 'open', severity: 'critical', severityChangedAt: null, ghsaId: `G${n}`, cveId: `CVE-${repoId}${n}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false, packageName: 'pkg', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: null, createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false, ...over });
const F = { state: 'open' as const, overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', repo: null as string | null };

it('AlertsTable\'s team dropdown is labeled "Owning team" with an "All owning teams" option', () => {
  const { rows: alertRows, totalCount, truncated } = listAlerts([A(1, 1)], [R(1, 'TeamA')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
  render(<AlertsTable rows={alertRows} totalCount={totalCount} truncated={truncated} filters={F} onFiltersChange={() => {}}
    team={null} teams={['TeamA']} onTeamChange={() => {}} />);
  const select = screen.getByLabelText('Owning team') as HTMLSelectElement;
  expect(select).toBeTruthy();
  expect(screen.getByText('All owning teams')).toBeTruthy();
});
```

- [ ] **Step 2: Delete the old modules and check the guard bites**
```bash
git rm src/app/vulnerabilities/team-pivot.tsx src/app/vulnerabilities/trend-chart.tsx src/lib/__tests__/unit/vuln-team-pivot.test.tsx src/lib/__tests__/unit/vuln-trend-chart.test.tsx
grep -rn "team-pivot\|trend-chart" src --include=*.ts --include=*.tsx
```
Expected: the `grep` prints only comment mentions in `format.ts`, `globals.css`, `vuln-series-contrast.test.ts` and `setup/resize-observer.ts` (leave them), and no `import`.

Then prove the literal-colour guard covers the new modules: temporarily add the line `const BAD = '#ff0000';` to the top of `src/app/vulnerabilities/trend-card.tsx`, run `npx jest src/lib/__tests__/unit/chart-no-literal-colors.test.ts --maxWorkers=3`, and expect FAIL (`no chart module contains a literal colour`, naming `trend-card.tsx`). Remove the line.

- [ ] **Step 3: Run the guards, the Overview suites and the types**
Run: `npx jest src/lib/__tests__/unit/chart-no-literal-colors.test.ts src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/vuln-owning-team-label.test.tsx src/lib/__tests__/unit/vuln-trend-colors-css.test.ts src/lib/__tests__/unit/vuln-series-contrast.test.ts --maxWorkers=3` then `npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 4: Run the full suite**
Run: `npx jest --maxWorkers=3`
Expected: PASS, every suite (nothing outside this wave's files changed behaviour).

- [ ] **Step 5: Commit**
```bash
git add src/lib/__tests__/unit/chart-no-literal-colors.test.ts src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/vuln-owning-team-label.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: retire team-pivot and trend-chart, repoint chart guards"
```
Run the three lines one at a time. If the guard line fails, do not run `git commit`; remove the offending text and `git add` again.

### Wave 3 test rewrite map

Every old test file below is under `src/lib/__tests__/unit/`. "New" names are the `describe` and `it` titles of the named file. Old assertions stay readable with `git show main:src/lib/__tests__/unit/<file>`.

| Old test file | Fate | Intent that must survive, and the new test that carries it |
|---|---|---|
| `vuln-team-pivot.test.tsx` | Deleted in 3.13, replaced by `vuln-team-table.test.tsx` | Severity bands, "—" for a null % or overdue: "rows > shows the CRITICAL and HIGH bands, the figures, and — for a missing percentage or overdue". Unmeasured marker: "unmeasured badge > sits under the team name, opens the drawer with the button, and does not select the team" (v7 moves it from beside critical Open to under the name) and "appears only for a team with unmeasured repositories, and on the Total row with the total". Dismissed tooltip: "rows > the Resolved cell shows the dismissed count and carries it in its title". "—" for a team missing from an available delta: "change column > a team missing from an available delta reads —". High Overdue column only while its SLA is active: "Overdue columns per SLA state" (six cases: both active, critical only, both pending, none, invalid, invalid over a stale active status). Positive red and negative green delta, Total shows the delta total: "change column > a rise is red with ▲, a fall is green with ▼, no change is a grey 0" and "the Total row shows the delta total" (arrows replace the signs: v7's non-colour cue). † marker, tooltip, footnote, none at zero, none when resolved is null: the four tests of "† marker and footnote". "since / all time / since —" Resolved caption: "header captions > the Resolved header names the start date, "all time" or an invalid date in its title" (v7 shows "(dismissed)" as the visible sub-caption). "vs <date>" under both or one Change header, none with no delta: "header captions > shows "vs <date>" under both Change headers, and under one only when the other is unavailable" and "with no baseline at all both headers say "No earlier measurement yet"" (new copy; the slot is never empty). Row click and highlight: "row selection > a click, and Enter, call url.selectTeamRow..." (the toggle moved into `useSecurityUrl`). Layout stability: caption slot always present: the two header-caption tests above; width floor and tabular digits: "layout > the grid template is shared by every row and does not change with the baseline caption" and "numeric cells use tabular digits"; keyed value span: "change column > the value is a NEW node when its text changes". |
| `vuln-trend-chart.test.tsx` | Deleted in 3.13, replaced by `vuln-trend-card.test.tsx` and `vuln-trend-model.test.ts` | One line per team, distinct colours: "lines and colours > draws one line per team in its own colour...". A team keeps its colour when filtered: "a selected team draws only its own line, in the colour it had before". Dotted team name: "draws a line for a team whose name contains a dot". Legend in chrome text beside a swatch: "legend > names every team in chrome text beside a swatch in the team colour, with its open count". Grey fallback: "lines and colours > teams beyond the top 12 are thinner grey lines" and `buildLegend` "lists every team: the top 12 by open count, then one "Other · N teams" entry" (the "team missing from the colour map" case cannot occur now: colours come from the same series). Empty state same height as the chart, shared skeleton: "the plot box" (six branches at 220px) and "legend > reserves two lines in every state, and the footnote is always there" (the invisible-placeholder structure is retired: v7 shows a message instead). Legend entries keyed by position: "legend > entries are the same DOM nodes across a series swap". Stale-hover guard: retired with the hover fade (v7 dims by selected team: "legend > selecting a team keeps every entry, dims the others to 0.4 and bolds the selected one"). |
| `vuln-owning-team-label.test.tsx` | Edited in 3.13 | The `TeamPivot` half moves to `vuln-team-table.test.tsx` ("rows > the first header reads "Owning team" and says it is not a Glooker team"). The `AlertsTable` half stays; Wave 4 deletes it with `alerts-table.tsx`. |
| `chart-no-literal-colors.test.ts`, `chart-tokens-css.test.ts` | Updated in 3.13 | `trend-chart.tsx` becomes `trend-card.tsx` plus `sparkline.tsx` in `EXTRA`, the exact-list assertion and `REFERENCING_FILES`. The guards still bite: Task 3.13 Step 2 adds a literal hex to `trend-card.tsx` and sees the guard fail. |
| `vuln-security-page.test.tsx`, `vuln-security-view-props.test.tsx` | Unchanged | They run in every task that touches a slot. The ownership card deliberately uses no `role="tab"` or `role="tabpanel"`, so the page test's `getByRole('tabpanel')` and its `getBoundingClientRect` stub still see only the composer's panel. |
| `vuln-format.test.ts`, `vuln-series-contrast.test.ts`, `vuln-trend-colors-css.test.ts` | Unchanged | `resolvedCaption`, `deltaBaselineCaption` and the series palette are reused as they are. |

**Wave 2 hand-off checklist, Wave 3 items.** Each is a named test in this wave:

| Hand-off item | Test |
|---|---|
| "N repos not in baseline" on its own line, only when available and non-zero; the "vs {date}" caption unchanged | `vuln-kpi-since`: "N repos not in baseline" (0 repos, 3 repos, unavailable delta) |
| Unavailable-baseline caption, new copy: "No earlier measurement yet" for a null baseline, "No measurement on or before {date}" otherwise | `vuln-kpi-since`: "unavailable delta" (two tests); `vuln-kpi-tiles`: "says why there is no change" (two tests); `vuln-team-table`: "header captions"; `vuln-overview-format`: "baselineUnavailableText" |
| Null-total guard: an available delta with a null total takes the unavailable branch, no throw, no NaN | `vuln-kpi-since`: "an available delta with a null total takes the unavailable branch"; `vuln-kpi-tiles`: "an available delta with a null total never throws and never prints NaN or undefined"; `vuln-overview-format`: "an available delta whose total is null is not usable and never throws" |
| "other ±N": only when non-zero, one truncated line, full text in the title | `vuln-kpi-since`: '"other ±N"' (three tests) |
| † marker and footnote (ownership card and Resolved tile), none when resolved is null | `vuln-team-table`: "† marker and footnote" (four tests); `vuln-kpi-resolved`: "† marker and footnote" (three tests) |
| Every `sla-state` consumer, all four states | SLA tile: `vuln-kpi-sla` (`describe.each` over both severities for pending, none and invalid, plus active and "an invalid policy reads as unreadable on BOTH rows"); team-table Overdue columns: `vuln-team-table` "Overdue columns per SLA state"; repository-table Overdue and Next due columns: `vuln-repo-table` "columns follow the SLA state" |

**Intents assigned to Wave 3 in the Wave 2 map, by old file:**

| Old file (deleted in 2.11) | New test |
|---|---|
| `vuln-content-b1`: open-delta red up, green down, grey flat | `vuln-kpi-tiles`: "Open tile: the change sentence > is red for more alerts, green for fewer and grey for no change, each with its arrow and date" (and "a rise in high alerts is orange, not red") |
| `vuln-content-b1`: Resolved tile † with its title at `carriedResolved > 0`, none at 0 | `vuln-kpi-resolved`: "a † with the carry tooltip and the footnote when carriedResolved > 0", "no † and an empty reserved footnote line when nothing carries" |
| `vuln-content-config-errors`: empty policy reads "No SLA policy yet", invalid never reads as empty | `vuln-kpi-sla`: "an empty policy reads "No SLA policy yet" on both rows, in grey", "an invalid policy reads as unreadable on BOTH rows (it parses to an empty policy, so slaStatus says none)" |
| `vuln-content-pivot-unfiltered`: KPI shows the team-scoped number while the table lists every team | `vuln-kpi-tiles`: "shows the team-scoped number while the table beside it lists every team"; `vuln-team-table`: "lists every team from the unfiltered summary while the page is scoped to one team, and highlights the selected one"; `vuln-ownership-card`: "with a team selected the team table still lists every team (it reads the unfiltered summary)" |
| `vuln-content-pivot-unfiltered`: the table's Change column follows the unfiltered response | `vuln-team-table`: "the Change column follows the unfiltered response, not the team-scoped one" |
| `vuln-content-pivot-unfiltered`: table falls back to `data.summary` while `data.teamSummary` loads | `vuln-team-table`: "falls back to the scoped summary while the unfiltered one is still loading" |
| `vuln-content-pivot-unfiltered`: an unfiltered-request error shows in the table and the rest of the page still renders | `vuln-team-table`: "shows the unfiltered request's error inside the table and nothing else"; `vuln-ownership-card`: "the body keeps its height in every state > teams: unfiltered summary failed". The KPI tiles read `props.summary`, not `data.teamSummary`, so they cannot be affected; `vuln-kpi-tiles` renders with a failed `teamSummary`-independent summary in every case |
| `vuln-content-resolved-caption`: "since <date>", "all time", invalid shows "—" for value, % closed and dismissed | `vuln-kpi-resolved`: "a real start date reads...", "with no resolved-count start date it reads "N dismissed · all time"", "an invalid start date shows — for the value, the dismissed count and % closed, and "since —"" |
| `vuln-content-resolved-caption`: "vs <date>" on the open and since tiles | `vuln-kpi-since`: "keeps the "vs <date>" caption"; the Open tile's sentence names the date instead (decision 9): `vuln-kpi-tiles` "the change sentence" tests |
| `vuln-content-resolved-caption`: fixed tile shape (caption slots as aria-hidden non-breaking spaces, truncating figure line) | `vuln-kpi-since`: "fixed shape" (two tests); `vuln-kpi-resolved`: "fixed shape"; `vuln-kpi-tiles`: "the row" (height in every branch) |
| `vuln-content-resolved-caption`: no † when `resolved` is null | `vuln-kpi-resolved`: "no † and no footnote when resolved is null (invalid start date), even though carriedResolved > 0" |
| `vuln-content-scroll`: a team row click | `vuln-team-table`: "row selection > a click, and Enter, call url.selectTeamRow..."; `vuln-ownership-card`: "a team row click calls url.selectTeamRow" |
| `vuln-content-scroll` and `vuln-content-trend-range`: the range control | `vuln-trend-card`: "choosing a range calls url.setRange", "the range select lists All time (the default), Last year, Last 90 days, Last 30 days" |
| `vuln-content-trend-colors`: colours from the UNFILTERED series | `vuln-trend-card`: "draws one line per team in its own colour; the colours are distinct and come from the unfiltered series", "a selected team draws only its own line, in the colour it had before" |

### Wave 3 exit check

All commands run in the repository root.

1. The wave's own tests:
   `npx jest src/lib/__tests__/unit/vuln-overview-format.test.ts src/lib/__tests__/unit/vuln-sparkline.test.tsx src/lib/__tests__/unit/vuln-kpi-tiles.test.tsx src/lib/__tests__/unit/vuln-kpi-since.test.tsx src/lib/__tests__/unit/vuln-kpi-resolved.test.tsx src/lib/__tests__/unit/vuln-kpi-sla.test.tsx src/lib/__tests__/unit/vuln-ownership-model.test.ts src/lib/__tests__/unit/vuln-team-table.test.tsx src/lib/__tests__/unit/vuln-repo-table.test.tsx src/lib/__tests__/unit/vuln-ownership-card.test.tsx src/lib/__tests__/unit/vuln-trend-model.test.ts src/lib/__tests__/unit/vuln-trend-card.test.tsx --maxWorkers=3`
2. The guards and Wave 2 suites this wave could disturb:
   `npx jest src/lib/__tests__/unit/chart-no-literal-colors.test.ts src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/vuln-owning-team-label.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx src/lib/__tests__/unit/vuln-security-support.test.tsx src/lib/__tests__/unit/vuln-format.test.ts src/lib/__tests__/unit/vuln-series-contrast.test.ts src/lib/__tests__/unit/vuln-trend-colors-css.test.ts --maxWorkers=3`
3. Types and the full suite: `npx tsc --noEmit` then `npx jest --maxWorkers=3` (all suites pass; CI uses 3 workers).
4. Production build, from a clean cache: `rm -rf .next && npm run build`. Run it only in a checkout that has its own installed dependencies.
5. No stale references: `grep -rn "team-pivot\|trend-chart" src --include=*.ts --include=*.tsx` prints only comment text, and no `import`.
6. The internal-name guard on the whole wave: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff origin/main...HEAD | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1` succeeds (grep finds nothing). `INTERNAL_NAMES` is the maintainers' private pattern of company, host and people names and real policy values; it lives in the implementer's environment and is never written in this plan or in the repository. New files use only `acme/...`, Payments, Search and Platform.
7. Headless-Chrome measurement (the harness lives outside the repository), against `npm run dev:mock`, on `/vulnerabilities` and on `/vulnerabilities?own=repos`, at 1024px and 1440px, in the default dark theme and one light theme:
   - `kpi-tiles` is 178px tall, `ownership-card-body` 330px, `trend-plot` 220px, in every state: defaults, `severity=high`, `severity=critical`, a selected team, `baseline=30d` (no baseline), a codebase with no measurements, and while a request is pending (add a response delay);
   - no KPI tile has `scrollHeight > clientHeight` or `scrollWidth > clientWidth`, and `document.documentElement.scrollWidth <= window.innerWidth`;
   - scrolling inside the ownership body keeps the header row and the Total (or footer) row in place, and the body, not the page, scrolls;
   - switching tabs, choosing a team and changing Severity cause no layout shift outside the card bodies (the layout-shift API reports 0 for the KPI row and the trend card);
   - the left edge of the "Repositories" tab (`ownership-tab-repos`) is the same before and after every filter change and every tab switch: the tab counts have a minimum width and each label reserves its bold width;
   - the team table's and repositories table's headers stay on one or two lines at 1024px and no header is clipped; a long owning-team name ends in "…" with its full name in the title;
   - in the light theme, pinned rows and the Total row show no border or shadow (they use `bg-chart-surface`, not `bg-gray-900`), the hatched band and the ▲ unmeasured badge are readable, and the KPI row is still 178px.
   Waves 1-4 together were measured in dark and light at 1024px and 1440px against `npm run dev:mock` (Task 5.4 records the run): the heights, no horizontal scroll, no tile overflow, the headers and the ↕ glyph, and the position checks above all held.
8. Documentation: this wave edits no documentation file. `docs/vulnerabilities-page.md` and the root `CLAUDE.md` are updated in Wave 5 (they still name `team-pivot.tsx` and `trend-chart.tsx`).

## Wave 4: Alerts view (summary strip, repository rail, alert list, pager)

**Goal.** Fill the three Alerts-view slots that Wave 2 left as stubs (`alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx`) and create the pager (`pager.tsx`). After this wave `/vulnerabilities?view=alerts` is complete. The strip shows the scope and a CRIT and a HIGH row. The rail lists every repository in scope, re-sorted so the most overdue come first. The list is a toolbar (search, Status, four toggles), six sortable headers, ten 56px rows and the pager. Every figure on the view comes from the `repos` rows (strip, rail) or from the alerts response (list rows and pager), and every SLA message comes from `sla-state.ts`. The old `alerts-table.tsx` and its test are retired, and every intent of that test is re-covered by a named test (see the rewrite map). The composer, `view-props.ts`, `dimensions.ts`, `security-state.ts` and `use-security-data.ts` are not changed. Waves 1-5 ship as one PR.

**Verification record.** All seven tasks were built and run in a scratch copy of the repository that already had Waves 1 and 2 applied. The numbers below come from that copy.

- `npx tsc --noEmit` was clean and `npm run build` succeeded from an empty `.next`. With Waves 1-3 applied in order the full run is 219 suites and 2596 tests. After this wave it is 223 suites and 2780 tests (six new suites, two retired: `vuln-alerts-table` and `vuln-owning-team-label`).
- Step 2 of Tasks 4.1-4.5 was replayed against the original fixtures file, the missing module or the Wave 2 stubs, and failed for the stated reason.
- 23 deliberate regressions were applied one at a time (19 against the component tests, 4 more against the composed-page test). Each failed at least one named test (see "Reverts that fail" in each task and the table in Task 4.7).
- The production build was measured in headless Chrome with `npm run dev:mock`'s environment and the seeded mock database, at 1024px and 1440px, in dark and light. The strip was 72px, the card 776px, the rail 260px, the list area 560px, every row 56px, the header 52px and the pager 28px, before and after each of ten interactions. There was no horizontal scroll, no clipped "Nd OVERDUE" and no truncated header label. With a pending high SLA the rail's SLA note wrapped to two lines and was not clipped.

**Wave 4 decisions.** The spec and the design handoff leave these open. Each is a choice this plan makes.

1. **State wording.** The strip tail, the rail footer and the Due column's sub-line all print `slaStateLabel` verbatim: "Starts {date}", "No SLA policy yet", "SLA policy can't be read". The handoff's prototype uses variants ("SLA starts Nov 1", "no SLA policy", "SLA unreadable"). The spec lists the labels once and says each state appears on the strip, the rail and the overdue columns, so one wording is used everywhere. The toggles' hint is the one exception, as Wave 2 specified: pending reads "Due dates start {earliest date}".
2. **Rail order under Severity.** "Overdue, then open critical, then open high" is computed from the severities the user can see. A hidden severity counts as 0. With "High only", a repository with 9 open critical alerts and no open high alerts reads "no open alerts", is greyed and sorts last. The prototype sorts by the raw critical count; that would order rows by a figure the rail does not show.
3. **Unmeasured repositories in totals.** The strip and the rail's "All" row sum the stored open counts of unmeasured repositories (through `scopeOpenCount`), so they equal the Alerts tab count and the list's "N alerts" total for the default list. The unmeasured rows themselves show no counts. This follows spec decision 2: stored alerts still count.
4. **A selected repository that is unmeasured** (reachable only by editing the URL, because the rail opens the drawer for it) shows its stored counts in the strip and its stored alerts in the list. There is no special state.
5. **Scope follows `data.effectiveRepo`**, never `url.repo`. A repository that was not found is not the scope: the strip and the rail fall back to the whole scope and the "All" row is the selected one.
6. **Dates in the list** read "Jul 21" (month and day, UTC). Dates in policy messages stay as the policy file gives them (`2026-11-01`), as Waves 2 and 3 print them.
7. **Constants live in the slot files.** `dimensions.ts` is Wave 2's file, so the list column's own sizes (`ALERT_HEAD_H`, `ALERT_GRID_COLS`, `ALERT_DUE_MIN_W` and the rest) are exported from `alert-list.tsx`, and `PAGER_H` from `pager.tsx`. A test adds them up against `ALERTS_CARD_H`.
8. **The data hook may send an unknown repository once** while the `repos` rows are still loading (Wave 2's `repoStatus: 'pending'`). It never sends it again after the rows say it is absent. The composer test asserts "at most once, then never again".

### Wave 4 public interface

Everything below lives in `src/app/vulnerabilities/`. Wave 5 (docs) and the headless measurement rely on the test ids.

```ts
// pager.tsx
export const PAGER_H = 28;
export const PAGER_NOTE = 'counted per Dependabot alert, not per CVE';
export const pageCount: (totalCount: number, pageSize: number) => number;          // at least 1
export function pagerText(page: number, pageSize: number, totalCount: number): string;   // "1–10 of 26 alerts · counted per ..."
export interface PagerProps { page: number; pageSize: number; totalCount: number | null; onPage: (page: number) => void }
export default function Pager(props: PagerProps): JSX.Element;                      // totalCount null = unknown (blank)

// repo-rail.tsx
export const RAIL_SORT_NOTE = 'Sorted by overdue, then open critical';
export const unmeasuredReason: (u: NonNullable<RepoRow['unmeasured']>) => string;  // same wording as the drawer
export interface RailStat { crit: number; high: number; overdue: number; total: number }
export function railStat(row: RepoRow, severity: SeverityFilter, sla: SlaSource): RailStat;
export function sortRailRows(rows: readonly RepoRow[], severity: SeverityFilter, sla: SlaSource): Array<{ row: RepoRow; stat: RailStat }>;
export function railCounts(crit: number, high: number, severity: SeverityFilter): string;   // "9 crit · 14 high open" | "no open alerts"
export function railSlaNote(sla: SlaSource): string;

// alert-list.tsx
export const SEARCH_DEBOUNCE_MS = 300;
export const ALERT_TOOLBAR_ROW_H = 32, ALERT_TOOLBAR_GAP = 8, ALERT_HEAD_H = 52, ALERT_COLUMN_GAP = 12;
export const ALERT_COLUMN_PAD = { top: 16, x: 20, bottom: 12 };
export const ALERT_COLUMN_CHROME_H: number;      // + ALERT_LIST_H = ALERTS_CARD_H (776)
export const ALERT_DUE_MIN_W = 120, ALERT_SEV_W = 56, ALERT_AGE_W = 52;
export const ALERT_GRID_COLS: string;            // one grid for the header and every row
export const SORT_ARROW: { none: string; asc: '↑'; desc: '↓' };
export function shortDate(iso: string): string;                 // "Jul 21", UTC
export function noSlaHint(sla: SlaSource): string | null;       // null while any SLA is active
export default function AlertList(props: SecurityViewProps): JSX.Element;
```

Test ids the headless measurement and the tests use: `alerts-strip`, `strip-kind`, `strip-title`, `strip-title-col`, `strip-critical` / `strip-high` (row), `strip-<sev>-open`, `strip-<sev>-tail`, `strip-unmeasured`; `repo-rail`, `rail-meta`, `rail-list`, `rail-all`, `rail-row` (with `data-repo`), `rail-counts`, `rail-overdue`, `rail-unmeasured`, `rail-sla-note`; `alert-list`, `alert-list-head`, `sort-<key>`, `sort-arrow-<key>`, `alert-list-rows`, `alert-row`, `alert-due`, `alert-due-sub`, `alert-state`, `alert-sla-hint`, `alert-updating`, `alert-pager`.

**Shared fixtures.** Task 4.1 appends names that start with `al` to `src/lib/__tests__/support/security-fixtures.ts` and edits nothing above them. Wave 3 appends names that start with `ov` to the same file. The two blocks are independent: when the branches meet, keep both blocks (a conflict at the end of the file is resolved by keeping both).

### Task 4.1: Alerts-view test support (`al` fixtures)

**Files:**
- Modify: `src/lib/__tests__/support/security-fixtures.ts` (append one block at the end of the file; add no imports and edit no existing line)
- Test: `src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx`

**Interfaces:**
- Consumes: from the same file, `summaryFixture`, `repoRow`, `cell`, `alertRow`, `alertsFixture`; the types `AlertRow`, `RepoRow`, `SummaryData`, `AlertsData`, `ReposData` that the file already imports.
- Produces:
  - `type AlSlaKind = 'active' | 'pending' | 'none' | 'invalid'`.
  - `alSummary(states: { critical: AlSlaKind; high: AlSlaKind }, over?: Partial<SummaryData>): SummaryData`. A `pending` severity starts on `2026-11-01`. An `invalid` state makes both severities invalid (`slaPolicyInvalid: true`, empty policy), as a real unreadable policy does.
  - `AL_RAIL_ROWS: RepoRow[]`: eight repositories whose server order differs from the rail order (see the comment on the constant). Two are unmeasured and keep stored counts.
  - `alAlertRow(n, over?)`, `alAlertRows(n, over?)`, `AL_OVERDUE_ROW`, `AL_RESOLVED_ROW`.
  - `alAlertsRoute(all: AlertRow[])`: a route function for `fetchRouter({ alerts: alAlertsRoute(all) })` that slices `all` by `limit` and `offset` like the server and echoes `limit`, `offset` and `sort`.

The names are pinned by their own test, so a later change to a fixture cannot silently change what the Alerts-view tests prove.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx
// The Alerts-view fixtures (the `al` names in support/security-fixtures.ts) are pinned here, so a
// slot test that leans on one cannot pass against a fixture that quietly stopped meaning what its
// name says.
import { slaState, anySlaActive } from '@/app/vulnerabilities/sla-state';
import {
  alSummary, AL_RAIL_ROWS, alAlertRow, alAlertRows, AL_OVERDUE_ROW, AL_RESOLVED_ROW, alAlertsRoute, type AlSlaKind,
} from '../support/security-fixtures';

describe('alSummary', () => {
  const kinds: AlSlaKind[] = ['active', 'pending', 'none'];

  it.each(kinds.flatMap(c => kinds.map(h => [c, h] as const)))('critical %s, high %s reads back through slaState', (critical, high) => {
    const s = alSummary({ critical, high });
    expect(slaState('critical', s).kind).toBe(critical);
    expect(slaState('high', s).kind).toBe(high);
    expect(anySlaActive(s)).toBe(critical === 'active' || high === 'active');
  });

  it('a pending severity starts on 2026-11-01', () => {
    expect(slaState('critical', alSummary({ critical: 'pending', high: 'active' }))).toEqual({ kind: 'pending', startsOn: '2026-11-01' });
  });

  it('an invalid state makes both severities invalid and leaves the policy empty, as a real unreadable policy does', () => {
    const s = alSummary({ critical: 'active', high: 'invalid' });
    expect(s.slaPolicyInvalid).toBe(true);
    expect(s.policy).toEqual([]);
    expect(slaState('critical', s).kind).toBe('invalid');
    expect(slaState('high', s).kind).toBe('invalid');
    expect(anySlaActive(s)).toBe(false);
  });

  it('other summary fields can be overridden', () => {
    expect(alSummary({ critical: 'active', high: 'active' }, { org: 'other' }).org).toBe('other');
  });
});

describe('AL_RAIL_ROWS', () => {
  it('is in server order: measured rows by open critical, then open high, then name; unmeasured rows last', () => {
    const measured = AL_RAIL_ROWS.filter(r => !r.unmeasured);
    const sorted = [...measured].sort((a, b) =>
      b.critical.open - a.critical.open || b.high.open - a.high.open || a.fullName.localeCompare(b.fullName));
    expect(measured.map(r => r.fullName)).toEqual(sorted.map(r => r.fullName));
    expect(AL_RAIL_ROWS.slice(measured.length).every(r => r.unmeasured)).toBe(true);
  });

  it('puts the repository with the most overdue alerts below one with more open critical, so a rail re-sort is observable', () => {
    const overdue = (r: (typeof AL_RAIL_ROWS)[number]) => (r.critical.overdue ?? 0) + (r.high.overdue ?? 0);
    const measured = AL_RAIL_ROWS.filter(r => !r.unmeasured);
    const mostOverdue = measured.reduce((a, b) => (overdue(b) > overdue(a) ? b : a));
    expect(mostOverdue.fullName).toBe('acme/checkout-api');
    expect(measured[0].fullName).not.toBe(mostOverdue.fullName);
  });

  it('has a zero-alert repository and two unmeasured ones that still carry stored counts', () => {
    expect(AL_RAIL_ROWS.some(r => !r.unmeasured && r.critical.open + r.high.open === 0)).toBe(true);
    const unmeasured = AL_RAIL_ROWS.filter(r => r.unmeasured);
    expect(unmeasured.map(r => r.unmeasured!.status).sort()).toEqual(['dependabot-off', 'error']);
    expect(unmeasured.every(r => r.critical.open > 0)).toBe(true);
  });
});

describe('alert row fixtures', () => {
  it('alAlertRows makes n distinct alerts', () => {
    const rows = alAlertRows(12);
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map(r => r.cveId)).size).toBe(12);
    expect(new Set(rows.map(r => r.htmlUrl)).size).toBe(12);
    expect(alAlertRow(3, { severity: 'high' }).severity).toBe('high');
  });

  it('AL_OVERDUE_ROW is 71 days past due and AL_RESOLVED_ROW is a fixed alert that was reopened', () => {
    expect(AL_OVERDUE_ROW.daysRemaining).toBe(-71);
    expect(AL_OVERDUE_ROW.state).toBe('open');
    expect(AL_RESOLVED_ROW.state).toBe('fixed');
    expect(AL_RESOLVED_ROW.reopenedCount).toBe(1);
    expect(AL_RESOLVED_ROW.lastReopenedAt).toBe('2026-08-14T10:30:00Z');
  });
});

describe('alAlertsRoute', () => {
  const all = alAlertRows(26);
  const reply = (qs: string) => (alAlertsRoute(all)(new URL(`http://x/api/vulnerabilities/alerts?${qs}`)).body);

  it('serves one page of the list with the full total, and echoes limit and offset', () => {
    const body = reply('limit=10&offset=20');
    expect(body.rows.map(r => r.cveId)).toEqual(all.slice(20, 26).map(r => r.cveId));
    expect(body.totalCount).toBe(26);
    expect(body.appliedFilters).toMatchObject({ limit: 10, offset: 20, state: 'open', codebase: 'backend' });
  });

  it('an offset past the end is an empty page with the exact total', () => {
    const body = reply('limit=10&offset=40');
    expect(body.rows).toEqual([]);
    expect(body.totalCount).toBe(26);
  });

  it('echoes sort when one is sent and omits it otherwise', () => {
    expect(reply('limit=10&offset=0&sort=age:desc').appliedFilters).toMatchObject({ sort: 'age:desc' });
    expect(reply('limit=10&offset=0').appliedFilters).not.toHaveProperty('sort');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx --maxWorkers=3`
Expected: FAIL, `TypeError: (0 , security_fixtures_1.alAlertRows) is not a function` (the suite fails to run: none of the `al` names exist yet).

- [ ] **Step 3: Implement**

Append this block to the end of `src/lib/__tests__/support/security-fixtures.ts`, after `viewProps`. Do not add an import and do not touch any line above it.

```ts

// ── Wave 4 (Alerts view) fixtures. Every name starts with `al`; Wave 3 appends `ov` names below its own marker. ──

/** The four SLA states of one severity, as the summary reports them. `invalid` is a policy that cannot be read. */
export type AlSlaKind = 'active' | 'pending' | 'none' | 'invalid';

/**
 * A summary whose critical and high SLA states are the given ones. `pending` starts on 2026-11-01
 * (the date the UI prints); `invalid` sets `slaPolicyInvalid`, which makes both severities invalid
 * (an unreadable policy parses to no entries, so the real summary reports 'none' for both).
 */
export function alSummary(states: { critical: AlSlaKind; high: AlSlaKind }, over: Partial<SummaryData> = {}): SummaryData {
  const invalid = states.critical === 'invalid' || states.high === 'invalid';
  const status = (k: AlSlaKind): 'active' | 'pending' | 'none' => (k === 'active' || k === 'pending' ? k : 'none');
  const policy: SummaryData['policy'] = invalid ? [] : (['critical', 'high'] as const).flatMap(sev => {
    const k = states[sev];
    if (k !== 'active' && k !== 'pending') return [];
    return [{ id: `${sev}-policy`, severity: sev, days: sev === 'critical' ? 7 : 30, effectiveFrom: k === 'active' ? '2020-01-08' : '2026-11-01', until: null, pending: k === 'pending' }];
  });
  return summaryFixture({
    slaStatus: { critical: status(states.critical), high: status(states.high) },
    slaPolicyInvalid: invalid,
    policy,
    ...over,
  });
}

/** An open/overdue/due-soon cell for a severity whose SLA is active. */
const alActive = (open: number, overdue: number) => cell({ open, overdue, dueSoon: 0, oldestOpenDays: open ? 30 : null });

/**
 * Rail rows whose SERVER order (critical open desc, high open desc, name) differs from the RAIL order
 * (overdue, then open critical, then open high, then name). Both SLAs active.
 *   server: ledger-service, checkout-api, audit-log, zeta-jobs, billing-worker, quiet-service, then unmeasured
 *   rail:   checkout-api (4 overdue), billing-worker (1), ledger-service, audit-log, zeta-jobs, quiet-service, then unmeasured
 */
export const AL_RAIL_ROWS: RepoRow[] = [
  repoRow('acme/ledger-service', 'Payments', { critical: alActive(5, 0), high: alActive(0, 0) }),
  repoRow('acme/checkout-api', 'Payments', { critical: alActive(3, 1), high: alActive(2, 3) }),
  repoRow('acme/audit-log', 'Platform', { critical: alActive(2, 0), high: alActive(5, 0) }),
  repoRow('acme/zeta-jobs', 'Platform', { critical: alActive(2, 0), high: alActive(5, 0) }),
  repoRow('acme/billing-worker', 'Payments', { critical: alActive(2, 1), high: alActive(1, 0) }),
  repoRow('acme/quiet-service', 'Search', { critical: alActive(0, 0), high: alActive(0, 0) }),
  repoRow('acme/invoice-render', 'Payments', {
    critical: alActive(7, 2), high: alActive(0, 0), unmeasured: { status: 'dependabot-off', detail: null },
  }),
  repoRow('acme/legacy-batch', 'Platform', {
    critical: alActive(4, 0), high: alActive(1, 0), unmeasured: { status: 'error', detail: 'HTTP 500: status check failed' },
  }),
];

/** One alert row; `n` makes the advisory id, the package and the alert distinct. */
export const alAlertRow = (n: number, over: Partial<AlertRow> = {}): AlertRow => alertRow({
  cveId: `CVE-2026-${String(1000 + n)}`, ghsaId: `GHSA-${n}`, packageName: `pkg-${n}`, ageDays: 10 + n,
  htmlUrl: `https://example.invalid/acme/checkout-api/security/dependabot/${n}`, ...over,
});

/** `n` distinct open alerts, newest advisory last. */
export const alAlertRows = (n: number, over: Partial<AlertRow> = {}): AlertRow[] =>
  Array.from({ length: n }, (_, i) => alAlertRow(i + 1, over));

/** An open critical alert 71 days past its due date. */
export const AL_OVERDUE_ROW: AlertRow = alAlertRow(1, {
  cveId: 'CVE-2026-43102', cvss: 9.1, packageName: 'golang.org/x/net', ecosystem: 'go', scope: 'runtime',
  ageDays: 77, dueDate: '2026-07-21', daysRemaining: -71, state: 'open',
});

/** A fixed alert, resolved on time, that was reopened once. */
export const AL_RESOLVED_ROW: AlertRow = alAlertRow(2, {
  cveId: 'CVE-2026-41871', cvss: 7.5, packageName: 'semver', ecosystem: 'npm', scope: 'development',
  state: 'fixed', dueDate: null, daysRemaining: null, resolvedAt: '2026-09-03T08:00:00Z', resolvedOnTime: true, resolvedDaysLate: null,
  reopenedCount: 1, lastReopenedAt: '2026-08-14T10:30:00Z',
});

/**
 * An alerts route that serves `all` as the server would: it honours `limit` and `offset`, reports the
 * full `totalCount`, and echoes limit, offset and sort. Pass it to `fetchRouter({ alerts: alAlertsRoute(all) })`.
 */
export const alAlertsRoute = (all: AlertRow[]) => (url: URL) => {
  const limit = Number(url.searchParams.get('limit') ?? 10);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const sort = url.searchParams.get('sort');
  const applied: AlertsData['appliedFilters'] = {
    codebase: (url.searchParams.get('codebase') ?? 'backend') as ReposData['appliedFilters']['codebase'],
    state: (url.searchParams.get('state') ?? 'open') as 'open', limit, offset,
    ...(sort ? { sort: sort as NonNullable<AlertsData['appliedFilters']['sort']> } : {}),
  };
  return { body: alertsFixture(all.slice(offset, offset + limit), all.length, applied) };
};
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx src/lib/__tests__/unit/vuln-security-support.test.tsx --maxWorkers=3`
Expected: PASS (the Wave 2 support test still passes, because nothing above the new block changed).

Then run `npx tsc --noEmit`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/support/security-fixtures.ts src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Alerts-view test fixtures (al names)"
```

### Task 4.2: Pager

**Files:**
- Create: `src/app/vulnerabilities/pager.tsx`
- Test: `src/lib/__tests__/unit/vuln-pager.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks. React only.
- Produces: `Pager` (default export), `PagerProps`, `PAGER_H`, `PAGER_NOTE`, `pageCount`, `pagerText` (see "Wave 4 public interface").

Behaviours:
- The text reads "1–10 of 26 alerts · counted per Dependabot alert, not per CVE". The last page ends at the total. One alert is singular. An empty result reads "0 alerts · counted ...".
- Previous, "Page X of Y" and Next. Previous is disabled on page 1 and Next on the last page. An empty result is "Page 1 of 1".
- A page number ahead of a shrunken result never reads "Page 4 of 3": the display clamps to the last page, and Previous steps from the clamped page. (The list's clamp effect, Task 4.5, then moves the real page.)
- `totalCount: null` (loading or error) renders a blank, `aria-hidden` row with both buttons disabled. It never reads "0 alerts".
- The row is exactly `PAGER_H` (28px) tall as an inline style in every state, and it does not clip its own overflow, so a focused button's ring shows.

Reverts that fail: none by itself; Task 4.5 and Task 4.7 mutate the callers.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-pager.test.tsx
// The alert list's pager: its text, its page numbering and its fixed height.
import { render, screen, fireEvent } from '@testing-library/react';
import Pager, { PAGER_H, PAGER_NOTE, pageCount, pagerText } from '@/app/vulnerabilities/pager';

const NOTE = 'counted per Dependabot alert, not per CVE';

describe('pagerText', () => {
  it('reads "1–10 of 26 alerts · counted per Dependabot alert, not per CVE" on the first page', () => {
    expect(PAGER_NOTE).toBe(NOTE);
    expect(pagerText(1, 10, 26)).toBe(`1–10 of 26 alerts · ${NOTE}`);
  });

  it('the last page ends at the total, not at a full page', () => {
    expect(pagerText(3, 10, 26)).toBe(`21–26 of 26 alerts · ${NOTE}`);
  });

  it('one alert is singular, and an empty result reads "0 alerts"', () => {
    expect(pagerText(1, 10, 1)).toBe(`1–1 of 1 alert · ${NOTE}`);
    expect(pagerText(1, 10, 0)).toBe(`0 alerts · ${NOTE}`);
  });

  it('a page number past the end never reads a range beyond the total', () => {
    expect(pagerText(9, 10, 26)).toBe(`26–26 of 26 alerts · ${NOTE}`);
  });

  it('groups thousands, so a large result stays readable', () => {
    expect(pagerText(1, 10, 1234)).toBe(`1–10 of 1,234 alerts · ${NOTE}`);
  });
});

describe('pageCount', () => {
  it('rounds up, and an empty result still has one page', () => {
    expect(pageCount(26, 10)).toBe(3);
    expect(pageCount(20, 10)).toBe(2);
    expect(pageCount(0, 10)).toBe(1);
  });
});

describe('Pager', () => {
  it('shows "Page X of Y" with Previous disabled on the first page and Next reporting page 2', () => {
    const onPage = jest.fn();
    render(<Pager page={1} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('Next is disabled on the last page and Previous reports the page before', () => {
    const onPage = jest.fn();
    render(<Pager page={3} pageSize={10} totalCount={26} onPage={onPage} />);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('an empty result is "Page 1 of 1" with both buttons disabled', () => {
    render(<Pager page={1} pageSize={10} totalCount={0} onPage={jest.fn()} />);
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a page number ahead of a shrunken result never reads "Page 4 of 3"', () => {
    const onPage = jest.fn();
    render(<Pager page={4} pageSize={10} totalCount={26} onPage={onPage} />);
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it.each([
    ['a known count', 26],
    ['an empty result', 0],
    ['an unknown count (loading or error)', null],
  ])('keeps its %s height of PAGER_H as an inline style', (_label, totalCount) => {
    render(<Pager page={1} pageSize={10} totalCount={totalCount} onPage={jest.fn()} />);
    expect(screen.getByTestId('alert-pager').style.height).toBe(`${PAGER_H}px`);
  });

  it('does not clip its own overflow, so a focused button\'s ring shows', () => {
    render(<Pager page={1} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(screen.getByTestId('alert-pager').className.split(/\s+/)).not.toContain('overflow-hidden');
  });

  it('with no known count it is an aria-hidden blank, never a fake "0 alerts", and both buttons are disabled', () => {
    render(<Pager page={1} pageSize={10} totalCount={null} onPage={jest.fn()} />);
    const pager = screen.getByTestId('alert-pager');
    expect(pager.textContent).not.toMatch(/alerts/);
    expect(pager.textContent).not.toMatch(/Page/);
    expect(pager.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('light theme', () => {
  // Revert: give the pager (or one of its buttons) the card-shell class: the light remap's 1px border would grow the fixed 28px row.
  it('uses no card-shell class (bg-gray-900), so the light theme\'s border and shadow cannot grow the fixed row', () => {
    const { container } = render(<Pager page={1} pageSize={10} totalCount={26} onPage={jest.fn()} />);
    expect(container.querySelector('.bg-gray-900')).toBeNull();
    expect(screen.getByTestId('alert-pager').style.height).toBe(`${PAGER_H}px`);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-pager.test.tsx --maxWorkers=3`
Expected: FAIL, `Could not locate module @/app/vulnerabilities/pager`.

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/pager.tsx
'use client';
// GLOOK-64: the alert list's pager (spec "Columns and sorting", Pager). Presentational: the page
// number lives in the alert-list controller, this only draws it and reports a click.

/** The pager row's fixed height in px. The alert list's column chrome adds it up, so it is a constant. */
export const PAGER_H = 28;
export const PAGER_NOTE = 'counted per Dependabot alert, not per CVE';

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** How many pages `totalCount` alerts make; an empty result still has one (empty) page. */
export const pageCount = (totalCount: number, pageSize: number) => Math.max(1, Math.ceil(totalCount / pageSize));

/** "1–10 of 26 alerts · counted per Dependabot alert, not per CVE". With nothing to count it reads "0 alerts · ...". */
export function pagerText(page: number, pageSize: number, totalCount: number): string {
  if (totalCount === 0) return `0 alerts · ${PAGER_NOTE}`;
  const from = Math.min((Math.max(1, page) - 1) * pageSize + 1, totalCount);
  const to = Math.min(totalCount, from + pageSize - 1);
  return `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${plural(totalCount, 'alert')} · ${PAGER_NOTE}`;
}

export interface PagerProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** null while the count is not known (loading, error): the row keeps its height and reads nothing. */
  totalCount: number | null;
  onPage: (page: number) => void;
}

const buttonClass = 'h-7 px-2.5 rounded-md bg-chart-surface text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-default';

export default function Pager({ page, pageSize, totalCount, onPage }: PagerProps) {
  const known = totalCount !== null;
  const pages = known ? pageCount(totalCount, pageSize) : 1;
  // While the page number is ahead of a shrunken result, the display never reads "Page 4 of 3".
  const shown = Math.min(Math.max(1, page), pages);
  return (
    <div
      data-testid="alert-pager"
      className="box-border flex items-center justify-between gap-3 text-xs text-gray-400"
      style={{ height: PAGER_H }}
    >
      <span className="min-w-0 truncate" aria-hidden={known ? undefined : true}>
        {known ? pagerText(page, pageSize, totalCount) : '\u00a0'}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className={`${buttonClass} text-gray-300`} disabled={!known || shown <= 1} onClick={() => onPage(shown - 1)}>
          ‹ Previous
        </button>
        <span className="px-1.5 whitespace-nowrap" aria-hidden={known ? undefined : true}>{known ? `Page ${shown} of ${pages}` : '\u00a0'}</span>
        <button type="button" className={`${buttonClass} text-gray-300`} disabled={!known || shown >= pages} onClick={() => onPage(shown + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-pager.test.tsx --maxWorkers=3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/pager.tsx src/lib/__tests__/unit/vuln-pager.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: alert list pager"
```

### Task 4.3: Alerts summary strip

**Files:**
- Modify: `src/app/vulnerabilities/alerts-strip.tsx` (replace the Wave 2 stub)
- Test: `src/lib/__tests__/unit/vuln-alerts-strip.test.tsx`

**Interfaces:**
- Consumes: `SecurityViewProps` (`./view-props`); `scopeOpenCount` (`./security-state`); `slaState`, `slaStateLabel` (`./sla-state`); `ALERTS_STRIP_H`, `TYPE` (`./dimensions`); the `vuln-hatch`, `text-warn` and `border-warn-line` utilities (Task 2.1); the Task 4.1 fixtures (`alSummary`, `AL_RAIL_ROWS`, `AlSlaKind`) and `viewProps`, `slot`, `reposFixture`, `repoRow`, `cell`, `REPO_ROWS`, `alertsFixture`.
- Produces: `AlertsStrip` (default export, `SecurityViewProps`), keeping the stub's `data-testid="alerts-strip"` and its inline `height: ALERTS_STRIP_H` on the outer element; and the exported width constants `ALERTS_STRIP_TITLE_W` (176), `ALERTS_STRIP_OPEN_MIN_W` (72) and `ALERTS_STRIP_OVERDUE_MIN_W` (96), which the strip's test imports.

Behaviours:
- The left block has two lines: a scope label and a title. No team: "All owning teams" over "All repositories". A team: "Owning team" over "{team} · all repositories". A repository: "Repository · owning team {team}" over the repository name.
- A CRIT row and a HIGH row, each "N open · {tail}". Open is `scopeOpenCount(rows, severity, data.effectiveRepo)` per severity, so it includes an unmeasured row's stored count. The strip never reads the alerts response.
- The tail is "N overdue" while that severity's SLA is active (red and bold when N is above 0, grey at 0). Otherwise it is `slaStateLabel`: "Starts {date}", "No SLA policy yet" (grey), or "SLA policy can't be read" with a "!" icon (red, bold). The overdue number sums `row[severity].overdue` over the scope; the server sends null for an inactive severity, and the SLA state decides what is printed.
- A hidden severity (Severity "Critical only" or "High only") keeps its row at opacity 0.35.
- A filter change never moves a block. The title column is a fixed `ALERTS_STRIP_TITLE_W` (176px, exported, `shrink-0`; a long title ends in "…" with its full text in `title`). The two figures that change width with their digits have a minimum width: the open figure `ALERTS_STRIP_OPEN_MIN_W` (72px, always) and the tail `ALERTS_STRIP_OVERDUE_MIN_W` (96px, only while the SLA is active). The severity blocks themselves are NOT fixed in width, because an SLA state label ("No SLA policy yet", "Starts {date}", "SLA policy can't be read") is longer than the figures and must not be cut; a state label does not change with the filters, so it moves nothing. Together the CRIT and HIGH blocks keep their x position whatever the scope and the numbers. Measured at 1024px with the unmeasured badge showing, the title, both blocks and the badge fit with no label cut for the active, pending and none policy states; with an unreadable policy ("SLA policy can't be read" is the longest label) there is not room, so the blocks shrink, each tail ends in "…" (the full text is the block's `title`, and the KPI tile, rail footer and list show it too), and the blocks sit a little differently when the badge is absent. At 1440px every state fits.
- An unmeasured badge, "▲ N unmeasured repos" (hatched, `text-warn`), shows only when no repository is selected and some row is unmeasured. Clicking it calls `openDrawer(e.currentTarget)`.
- Loading shows "—" for every figure. An error with no rows shows the error text in place of the two rows. The strip is `ALERTS_STRIP_H` tall in every state.

Reverts that fail: the strip reading `data.alerts.data.totalCount` instead of the rows fails `figures › reads the repos rows, not the alert list response: a different list total changes nothing` (and three more in that describe); scoping by `url.repo` instead of `data.effectiveRepo` fails `figures › a repository that was not found is not the scope: the figures stay at the whole scope`; sizing the title column by its content (a `min-w-*` instead of the fixed width) fails `fixed title column`; dropping the open figure's or the overdue figure's minimum width fails `figure slots and unclipped SLA labels`; giving a severity block a fixed width (it would cut the SLA state labels) fails the three state cases of `figure slots and unclipped SLA labels`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-strip.test.tsx
// The Alerts view's 72px summary strip. Its figures come from the `repos` rows for the current
// scope, never from the alert list's response, and its SLA tail follows sla-state.ts.
import { render, screen, fireEvent } from '@testing-library/react';
import AlertsStrip, { ALERTS_STRIP_OPEN_MIN_W, ALERTS_STRIP_OVERDUE_MIN_W, ALERTS_STRIP_TITLE_W } from '@/app/vulnerabilities/alerts-strip';
import { ALERTS_STRIP_H } from '@/app/vulnerabilities/dimensions';
import {
  viewProps, slot, reposFixture, alertsFixture, repoRow, cell, REPO_ROWS, AL_RAIL_ROWS, alSummary, type AlSlaKind,
} from '../support/security-fixtures';

const bothActive = alSummary({ critical: 'active', high: 'active' });
const text = (id: string) => screen.getByTestId(id).textContent;

/** Props with the given repos rows, scope and SLA states. */
function props(opts: {
  rows?: Parameters<typeof reposFixture>[0]; urlOver?: Record<string, unknown>; effectiveRepo?: string | null;
  summary?: ReturnType<typeof alSummary>; data?: Record<string, unknown>;
} = {}) {
  const base = viewProps({ summary: opts.summary ?? bothActive });
  return {
    ...base,
    url: { ...base.url, ...(opts.urlOver ?? {}) },
    data: {
      ...base.data,
      repos: slot(reposFixture(opts.rows ?? AL_RAIL_ROWS)),
      effectiveRepo: opts.effectiveRepo ?? null,
      ...(opts.data ?? {}),
    },
  } as ReturnType<typeof viewProps>;
}

describe('figures', () => {
  it('CRIT and HIGH read "N open · N overdue", summed over every repos row, an unmeasured row\'s stored count included', () => {
    render(<AlertsStrip {...props()} />);
    // critical open: 5+3+2+2+2+0 + 7 (invoice-render, unmeasured) + 4 (legacy-batch, unmeasured) = 25
    expect(text('strip-critical-open')).toBe('25');
    // high open: 0+2+5+5+1+0 + 0 + 1 = 14
    expect(text('strip-high-open')).toBe('14');
    // overdue: critical 1 (checkout) + 1 (billing) + 2 (invoice-render); high 3 (checkout)
    expect(text('strip-critical-tail')).toContain('4 overdue');
    expect(text('strip-high-tail')).toContain('3 overdue');
  });

  it('reads the repos rows, not the alert list response: a different list total changes nothing', () => {
    const p = props();
    const withList = { ...p, data: { ...p.data, alerts: slot(alertsFixture([], 999)) } } as typeof p;
    render(<AlertsStrip {...withList} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(text('strip-high-open')).toBe('14');
    expect(screen.getByTestId('alerts-strip').textContent).not.toContain('999');
  });

  it('a selected repository narrows every figure to that row', () => {
    render(<AlertsStrip {...props({ effectiveRepo: 'acme/checkout-api', urlOver: { repo: 'acme/checkout-api' } })} />);
    expect(text('strip-critical-open')).toBe('3');
    expect(text('strip-high-open')).toBe('2');
    expect(text('strip-critical-tail')).toContain('1 overdue');
    expect(text('strip-high-tail')).toContain('3 overdue');
  });

  it('a repository that was not found is not the scope: the figures stay at the whole scope', () => {
    // url.repo is still set, but data.effectiveRepo is null (repoStatus "not-found").
    render(<AlertsStrip {...props({ effectiveRepo: null, urlOver: { repo: 'acme/missing' }, data: { repoStatus: 'not-found' } })} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(text('strip-title')).toBe('All repositories');
  });

  it('shows a dash for the counts while the repos rows are loading, and keeps the badge slot', () => {
    render(<AlertsStrip {...props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined) } })} />);
    expect(text('strip-critical-open')).toBe('—');
    expect(text('strip-high-open')).toBe('—');
    expect(screen.getByTestId('alerts-strip').style.height).toBe(`${ALERTS_STRIP_H}px`);
  });
});

describe('scope label and title', () => {
  it('no team: "All owning teams" over "All repositories"', () => {
    render(<AlertsStrip {...props()} />);
    expect(text('strip-kind')).toBe('All owning teams');
    expect(text('strip-title')).toBe('All repositories');
  });

  it('a team: "Owning team" over "<team> · all repositories"', () => {
    render(<AlertsStrip {...props({ urlOver: { team: 'Payments' } })} />);
    expect(text('strip-kind')).toBe('Owning team');
    expect(text('strip-title')).toBe('Payments · all repositories');
  });

  it('a repository: "Repository · owning team <team>" over the repository name', () => {
    render(<AlertsStrip {...props({ effectiveRepo: 'acme/audit-log', urlOver: { repo: 'acme/audit-log' } })} />);
    expect(text('strip-kind')).toBe('Repository · owning team Platform');
    expect(text('strip-title')).toBe('acme/audit-log');
  });
});

describe('the SLA tail, per state, for each severity (strip consumer of sla-state)', () => {
  const cases: Array<[AlSlaKind, string]> = [
    ['active', '4 overdue'],
    ['pending', 'Starts 2026-11-01'],
    ['none', 'No SLA policy yet'],
    ['invalid', "SLA policy can't be read"],
  ];

  it.each(cases)('critical %s reads "%s" while high stays active', (kind, tail) => {
    const states = { critical: kind, high: kind === 'invalid' ? 'invalid' : 'active' } as const;
    render(<AlertsStrip {...props({ summary: alSummary(states) })} />);
    const el = screen.getByTestId('strip-critical-tail');
    expect(el.textContent).toContain(tail);
    // An overdue count is shown only while that severity's SLA is active.
    if (kind !== 'active') expect(el.textContent).not.toMatch(/overdue/);
    // The state message is red and bold for an unreadable policy only.
    expect(el.className.includes('text-red-400')).toBe(kind === 'invalid' || kind === 'active');
  });

  it.each(cases.filter(([k]) => k !== 'invalid'))('high %s reads "%s" while critical stays active', (kind, _tail) => {
    render(<AlertsStrip {...props({ summary: alSummary({ critical: 'active', high: kind }) })} />);
    const el = screen.getByTestId('strip-high-tail');
    const expected = { active: '3 overdue', pending: 'Starts 2026-11-01', none: 'No SLA policy yet' }[kind as 'active' | 'pending' | 'none'];
    expect(el.textContent).toContain(expected);
    if (kind !== 'active') expect(el.textContent).not.toMatch(/overdue/);
  });

  it('an unreadable policy shows the "!" icon and reads as red, never as "No SLA policy yet"', () => {
    render(<AlertsStrip {...props({ summary: alSummary({ critical: 'invalid', high: 'invalid' }) })} />);
    for (const sev of ['critical', 'high']) {
      const el = screen.getByTestId(`strip-${sev}-tail`);
      expect(el.textContent).toContain("SLA policy can't be read");
      expect(el.textContent).not.toContain('No SLA policy yet');
      expect(el.textContent).toContain('!');
      expect(el.className).toContain('font-bold');
    }
  });

  it('an active SLA with nothing overdue reads "0 overdue" in grey, not red', () => {
    render(<AlertsStrip {...props({ rows: REPO_ROWS.filter(r => r.fullName === 'acme/search-index'), summary: alSummary({ critical: 'active', high: 'none' }) })} />);
    const el = screen.getByTestId('strip-critical-tail');
    expect(el.textContent).toContain('0 overdue');
    expect(el.className).not.toContain('text-red-400');
  });
});

describe('hidden severity', () => {
  it.each([
    ['critical', 'strip-high', 'strip-critical'],
    ['high', 'strip-critical', 'strip-high'],
  ])('Severity "%s only" dims %s to 0.35 and keeps its figures; %s stays at 1', (severity, dimmed, shown) => {
    render(<AlertsStrip {...props({ urlOver: { severity } })} />);
    expect(screen.getByTestId(dimmed).style.opacity).toBe('0.35');
    expect(screen.getByTestId(shown).style.opacity).toBe('1');
    expect(screen.getByTestId(`${dimmed}-open`).textContent).not.toBe('—');
  });

  it('"Critical + high" dims neither row', () => {
    render(<AlertsStrip {...props()} />);
    expect(screen.getByTestId('strip-critical').style.opacity).toBe('1');
    expect(screen.getByTestId('strip-high').style.opacity).toBe('1');
  });
});

describe('unmeasured badge', () => {
  it('shows "N unmeasured repos" when no repository is selected, and clicking it opens the drawer from that element', () => {
    const p = props();
    render(<AlertsStrip {...p} />);
    const badge = screen.getByTestId('strip-unmeasured');
    expect(badge.textContent).toContain('2 unmeasured repos');
    fireEvent.click(badge);
    expect(p.openDrawer).toHaveBeenCalledWith(badge);
  });

  it('is singular for one repository', () => {
    render(<AlertsStrip {...props({ rows: [...REPO_ROWS] })} />);
    expect(text('strip-unmeasured')).toContain('1 unmeasured repo');
    expect(text('strip-unmeasured')).not.toContain('repos');
  });

  it('is absent when a repository is selected, and absent when nothing is unmeasured', () => {
    const { unmount } = render(<AlertsStrip {...props({ effectiveRepo: 'acme/audit-log', urlOver: { repo: 'acme/audit-log' } })} />);
    expect(screen.queryByTestId('strip-unmeasured')).toBeNull();
    unmount();
    render(<AlertsStrip {...props({ rows: [repoRow('acme/ledger', 'Payments', { critical: cell({ open: 1 }) })] })} />);
    expect(screen.queryByTestId('strip-unmeasured')).toBeNull();
  });
});

describe('fixed title column', () => {
  const noRows = slot<ReturnType<typeof reposFixture>>(undefined);
  // Revert: size the column by its content (min-width instead of width): the CRIT and HIGH blocks slide
  // sideways as the title changes between "All repositories", a team and a repository.
  it.each([
    ['all repositories', props(), 'All repositories'],
    ['a team', props({ urlOver: { team: 'Payments' } }), 'Payments · all repositories'],
    ['a repository', props({ effectiveRepo: 'acme/audit-log', urlOver: { repo: 'acme/audit-log' } }), 'acme/audit-log'],
    ['loading', props({ data: { repos: noRows } }), 'All repositories'],
  ])('%s: the title column is ALERTS_STRIP_TITLE_W wide and does not shrink, and a long title is cut with its full text in the title attribute', (_label, p, title) => {
    render(<AlertsStrip {...p} />);
    const col = screen.getByTestId('strip-title-col');
    expect(col.style.width).toBe(`${ALERTS_STRIP_TITLE_W}px`);
    expect(col.className).toContain('shrink-0');
    expect(col.className).not.toMatch(/min-w-/);
    const t = screen.getByTestId('strip-title');
    expect(t.className).toContain('truncate');
    expect(t.getAttribute('title')).toBe(title);
  });
});

describe('figure slots and unclipped SLA labels', () => {
  // Revert: let the open figure size to its digits: the HIGH block slides when the CRIT count gains a digit.
  it.each([
    ['25 open · 4 overdue', props()],
    ['one repository, one digit', props({ effectiveRepo: 'acme/checkout-api', urlOver: { repo: 'acme/checkout-api' } })],
    ['loading dashes', props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined) } })],
    ['a severity hidden by the filter', props({ urlOver: { severity: 'high' } })],
  ])('%s: each open figure sits in a slot with a minimum width, in every state', (_label, p) => {
    render(<AlertsStrip {...p} />);
    for (const sev of ['critical', 'high']) {
      expect(screen.getByTestId(`strip-${sev}-open-slot`).style.minWidth).toBe(`${ALERTS_STRIP_OPEN_MIN_W}px`);
    }
  });

  // Revert: drop the tail's minWidth while the SLA is active: the HIGH block slides when "overdue" gains a digit.
  it('while the SLA is active each overdue figure has a minimum width, and no state label gets one', () => {
    render(<AlertsStrip {...props()} />);
    for (const sev of ['critical', 'high']) {
      expect(screen.getByTestId(`strip-${sev}-tail`).style.minWidth).toBe(`${ALERTS_STRIP_OVERDUE_MIN_W}px`);
    }
  });

  // Revert: give a severity block a fixed width (or `shrink-0` with a width): "No SLA policy yet", "Starts {date}" and
  // "SLA policy can't be read" are longer than the figures and would be cut. The blocks size to their content.
  it.each([
    ['pending', { critical: 'pending', high: 'pending' }, /Starts /],
    ['none', { critical: 'none', high: 'none' }, /No SLA policy yet/],
    ['invalid', { critical: 'invalid', high: 'invalid' }, /SLA policy can't be read/],
  ] as Array<[string, { critical: AlSlaKind; high: AlSlaKind }, RegExp]>)('%s: the label is whole, has no minimum width, and no severity block has a fixed width', (_name, kinds, label) => {
    render(<AlertsStrip {...props({ summary: alSummary(kinds) })} />);
    for (const sev of ['critical', 'high']) {
      const block = screen.getByTestId(`strip-${sev}`);
      expect(block.style.width).toBe('');
      expect(block.className).not.toContain('shrink-0');
      expect(screen.getByTestId(`strip-${sev}-tail`).style.minWidth).toBe('');
      expect(screen.getByTestId(`strip-${sev}-tail`).textContent).toMatch(label);
    }
  });
});

describe('fixed height', () => {
  it.each([
    ['populated', props()],
    ['loading', props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined) } })],
    ['error', props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('boom'), errorText: "Couldn't load repositories: boom" }) } })],
    ['empty scope', props({ rows: [] })],
  ])('the %s strip is ALERTS_STRIP_H as an inline style', (_label, p) => {
    render(<AlertsStrip {...p} />);
    expect(screen.getByTestId('alerts-strip').style.height).toBe(`${ALERTS_STRIP_H}px`);
  });

  it('an error replaces the figures with the error text', () => {
    render(<AlertsStrip {...props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('boom'), errorText: "Couldn't load repositories: boom" }) } })} />);
    expect(screen.getByTestId('alerts-strip').textContent).toContain("Couldn't load repositories: boom");
    expect(screen.queryByTestId('strip-critical-open')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-alerts-strip.test.tsx --maxWorkers=3`
Expected: FAIL. The Wave 2 stub renders an empty section, so `strip-critical-open` and the other test ids are not found.

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/alerts-strip.tsx
'use client';
// GLOOK-64: the Alerts view's 72px summary strip: the scope label and title, a CRIT and a HIGH row
// ("N open · N overdue"), and the unmeasured badge. Every figure comes from the `repos` rows for the
// current scope (the selected repository, if any), never from the alert list's response, so the
// strip, the rail and the Alerts tab count cannot disagree with each other.
import type { RepoRow } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { SecurityViewProps } from './view-props';
import { scopeOpenCount } from './security-state';
import { slaState, slaStateLabel } from './sla-state';
import { ALERTS_STRIP_H, TYPE } from './dimensions';

/** Widths, in px, that keep the CRIT and HIGH blocks where they are whatever the filters. The title column is
 * fixed, so a short "All repositories" and a long team or repository name take the same room (a long title ends in
 * "…" with its full text in a `title`). The open figure and, while the SLA is active, the overdue figure change
 * width with their digits, so each has a minimum width sized for four and three digits. The blocks themselves
 * are NOT fixed: an SLA state label ("No SLA policy yet", "Starts 2099-01-01") is longer than the figures and
 * must not be cut, and it does not change with the filters. */
export const ALERTS_STRIP_TITLE_W = 176;
export const ALERTS_STRIP_OPEN_MIN_W = 72;
export const ALERTS_STRIP_OVERDUE_MIN_W = 96;

const SEVERITIES: readonly Severity[] = ['critical', 'high'];
const BADGE: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'CRIT', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-400' },
};

/** Overdue alerts of one severity in scope. The server sends null while that severity's SLA is not active. */
function scopeOverdue(rows: readonly RepoRow[], sev: Severity, repo: string | null): number {
  let n = 0;
  for (const r of rows) {
    if (repo && r.fullName !== repo) continue;
    n += r[sev].overdue ?? 0;
  }
  return n;
}

export default function AlertsStrip({ summary, data, url, openDrawer }: SecurityViewProps) {
  const rows = data.repos.data?.rows;
  const repo = data.effectiveRepo;          // not url.repo: a repository that was not found is not the scope
  const repoRow = repo && rows ? rows.find(r => r.fullName === repo) : undefined;

  const kind = repo ? `Repository · owning team ${repoRow?.team ?? url.team ?? '—'}` : url.team ? 'Owning team' : 'All owning teams';
  const title = repo ?? (url.team ? `${url.team} · all repositories` : 'All repositories');
  const unmeasured = rows && !repo ? rows.filter(r => r.unmeasured).length : 0;

  return (
    <section
      aria-label="Alerts summary"
      data-testid="alerts-strip"
      className={`bg-gray-900 ${TYPE.card} px-5 flex items-center gap-5 overflow-hidden whitespace-nowrap`}
      style={{ height: ALERTS_STRIP_H }}
    >
      <div data-testid="strip-title-col" className="flex shrink-0 flex-col gap-0.5" style={{ width: ALERTS_STRIP_TITLE_W }}>
        <span data-testid="strip-kind" className={`${TYPE.tableHeader} text-gray-400 truncate`}>{kind}</span>
        <span data-testid="strip-title" title={title} className="text-base font-bold text-white truncate">{title}</span>
      </div>
      <div className="h-9 w-px shrink-0 bg-gray-700" aria-hidden="true" />
      {data.repos.errorText && !rows ? (
        <span className="text-sm text-red-400 truncate">{data.repos.errorText}</span>
      ) : (
        SEVERITIES.map(sev => {
          const st = slaState(sev, summary);
          const open = rows ? scopeOpenCount(rows, sev, repo) : null;
          const overdue = rows ? scopeOverdue(rows, sev, repo) : 0;
          const label = slaStateLabel(st);
          const hidden = url.severity !== 'both' && url.severity !== sev;
          return (
            <div
              key={sev}
              data-testid={`strip-${sev}`}
              title={label ?? undefined}
              className="flex min-w-0 items-center gap-2 text-sm text-gray-300"
              style={{ opacity: hidden ? 0.35 : 1 }}
            >
              <span className={`w-[34px] shrink-0 py-px text-center text-[10px] font-bold tracking-[0.05em] ${TYPE.badge} ${BADGE[sev].cls}`}>{BADGE[sev].label}</span>
              <span data-testid={`strip-${sev}-open-slot`} className="shrink-0" style={{ minWidth: ALERTS_STRIP_OPEN_MIN_W }}><b data-testid={`strip-${sev}-open`} className="text-white">{open === null ? '—' : open.toLocaleString('en-US')}</b> open</span>
              <span
                data-testid={`strip-${sev}-tail`}
                className={`flex min-w-0 items-center gap-1 ${st.kind === 'invalid' ? 'font-bold text-red-400' : st.kind === 'active' && overdue > 0 ? 'font-bold text-red-400' : 'text-gray-500'}`}
                style={st.kind === 'active' ? { minWidth: ALERTS_STRIP_OVERDUE_MIN_W } : undefined}
              >
                ·
                {st.kind === 'invalid' && (
                  <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-400 text-[10px] font-bold text-gray-900">!</span>
                )}
                <span className="truncate">{!rows ? '—' : st.kind === 'active' ? `${overdue.toLocaleString('en-US')} overdue` : label}</span>
              </span>
            </div>
          );
        })
      )}
      <div className="flex-1" />
      {unmeasured > 0 && (
        <button
          type="button"
          data-testid="strip-unmeasured"
          title="Open counts for these repositories are unknown. Click for details."
          onClick={e => openDrawer(e.currentTarget)}
          className={`vuln-hatch flex h-6 shrink-0 items-center gap-1.5 border border-warn-line px-2 text-xs font-semibold text-warn ${TYPE.badge}`}
        >
          <span aria-hidden="true">▲</span>
          {unmeasured} unmeasured {unmeasured === 1 ? 'repo' : 'repos'}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-alerts-strip.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3`
Expected: PASS (the page test still finds `alerts-strip` at 72px; the view-props test still renders it with `viewProps()`).

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/alerts-strip.tsx src/lib/__tests__/unit/vuln-alerts-strip.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Alerts view summary strip"
```

### Task 4.4: Repository rail

**Files:**
- Modify: `src/app/vulnerabilities/repo-rail.tsx` (replace the Wave 2 stub)
- Test: `src/lib/__tests__/unit/vuln-repo-rail.test.tsx`

**Interfaces:**
- Consumes: `SecurityViewProps`; `scopeOpenCount`, `SeverityFilter` (`./security-state`); `SLA_INVALID_LABEL`, `slaActive`, `slaState`, `slaStateLabel`, `SlaSource` (`./sla-state`); `RAIL_W`, `TYPE` (`./dimensions`); `RepoRow` type (`@/lib/vulnerabilities/aggregate`); `url.setRepo` and `openDrawer` from the props; the `vuln-hatch` utility; the Task 4.1 fixtures.
- Produces: `RepoRail` (default export) and the helpers listed under "Wave 4 public interface". It keeps the stub's `data-testid="repo-rail"` and its inline `width: RAIL_W`.

Behaviours:
- Header: "REPOSITORIES" (the `sectionLabel` type), a count line ("14 repos + 3 unmeasured"), and a "Filter by name" box that filters measured and unmeasured rows by name. No match reads "No repositories match “{text}”."; an empty scope reads "No repositories in this scope."; loading reads "Loading…"; an error shows its text.
- First row: "All {team} repositories" with a team filter, otherwise "All repositories", with the scope's counts ("25 crit · 14 high open"). It is the tinted row while no repository is selected. Clicking it calls `url.setRepo(null)`.
- Then the measured rows, re-sorted on the client: overdue desc, open critical desc, open high desc, name. The server order (open critical, then open high) is not kept. Figures follow Severity: a hidden severity counts as 0.
- Each row: the repository name, "N crit · N high open", and "N OVERDUE" on the right. N sums the visible severities whose SLA is active, using `slaActive` from the summary (not the row's own null). Nothing is printed at 0. "Owning team: X" shows only when no team filter is set. A row with nothing open under Severity is greyed (`text-gray-500`) and reads "no open alerts".
- Selection follows `data.effectiveRepo`. The selected row is tinted (`bg-accent/10`, the page's existing selected-row tint, the same as the selected team row), shows "×" and has `aria-pressed`. Clicking a row calls `url.setRepo(fullName)`; clicking the selected row calls `url.setRepo(null)`. A rail click writes only `repo` as a replace, so it never calls `selectRepoRow`, `setTeam` or `setView`.
- Unmeasured rows come last, ordered by name, hatched (`vuln-hatch`), reading "▲ UNMEASURED · {reason}" with the drawer's wording ("Dependabot off", or the error detail, or "Status check failed"). They show no counts. Clicking one calls `openDrawer(e.currentTarget)` and does not select it.
- Footer: "Sorted by overdue, then open critical", then the SLA note. The note says which severities the OVERDUE figures include and why one is missing: "Overdue counts critical and high"; "Overdue counts critical only · high: {label}"; "Overdue counts high only · critical: {label}"; "No active SLA policy · no overdue counts"; "SLA policy can't be read · no overdue counts". **The note wraps** (`whitespace-normal break-words`): it is one of the three fixes beyond the handoff, and it must never truncate. The list above it scrolls (`overflow-y-auto`), so a taller footer shrinks the list, not the card.

Reverts that fail: removing the re-sort (keeping server order) fails `order: overdue, then open critical, then open high, then name; unmeasured last › re-sorts the server order (which is by open critical) so a repository with more overdue comes first` and three more; adding `truncate` to the note fails `footer › the SLA explanation wraps instead of truncating (fix 1 beyond the handoff)`; printing overdue without the SLA gate fails several cases of `the OVERDUE figure › critical %s, high %s: checkout-api reads %s`; a rail click that calls `selectRepoRow` fails `selection › clicking a row calls url.setRepo with that repository and nothing else on the URL`; an unmeasured row that selects instead of opening the drawer fails `unmeasured rows › are hatched, read "UNMEASURED · <reason>", show no counts, and open the drawer from the clicked element`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-repo-rail.test.tsx
// The Alerts view's 260px repository rail: client re-sort, the SLA-gated OVERDUE figure, selection,
// unmeasured rows, the wrapping footer note (one of the three fixes beyond the handoff).
import { render, screen, fireEvent, within } from '@testing-library/react';
import RepoRail, { railSlaNote, railStat, sortRailRows, unmeasuredReason } from '@/app/vulnerabilities/repo-rail';
import { RAIL_W } from '@/app/vulnerabilities/dimensions';
import {
  viewProps, slot, reposFixture, repoRow, cell, REPO_ROWS, AL_RAIL_ROWS, alSummary, type AlSlaKind,
} from '../support/security-fixtures';

const bothActive = alSummary({ critical: 'active', high: 'active' });

function props(opts: { rows?: Parameters<typeof reposFixture>[0]; urlOver?: Record<string, unknown>; effectiveRepo?: string | null; summary?: ReturnType<typeof alSummary>; repos?: unknown } = {}) {
  const base = viewProps({ summary: opts.summary ?? bothActive });
  return {
    ...base,
    url: { ...base.url, ...(opts.urlOver ?? {}) },
    data: { ...base.data, repos: opts.repos ?? slot(reposFixture(opts.rows ?? AL_RAIL_ROWS)), effectiveRepo: opts.effectiveRepo ?? null },
  } as ReturnType<typeof viewProps>;
}
const railNames = () => screen.getAllByTestId('rail-row').map(el => el.getAttribute('data-repo'));
const row = (name: string) => screen.getAllByTestId('rail-row').find(el => el.getAttribute('data-repo') === name)!;

describe('structure', () => {
  it('has the REPOSITORIES header, a count line and a "Filter by name" box', () => {
    render(<RepoRail {...props()} />);
    expect(screen.getByText('Repositories')).toBeTruthy();
    expect(screen.getByTestId('rail-meta').textContent).toBe('6 repos + 2 unmeasured');
    expect(screen.getByPlaceholderText('Filter by name')).toBeTruthy();
  });

  it('the first row reads "All repositories", or "All <team> repositories" with a team filter, with the scope\'s counts', () => {
    const { unmount } = render(<RepoRail {...props()} />);
    expect(screen.getByTestId('rail-all').textContent).toContain('All repositories');
    expect(screen.getByTestId('rail-all').textContent).toContain('25 crit · 14 high open');
    unmount();
    render(<RepoRail {...props({ urlOver: { team: 'Payments' } })} />);
    expect(screen.getByTestId('rail-all').textContent).toContain('All Payments repositories');
  });

  it.each([
    ['populated', props()],
    ['loading', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined) })],
    ['error', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('x'), errorText: "Couldn't load repositories: x" }) })],
    ['empty scope', props({ rows: [] })],
  ])('the %s rail is RAIL_W wide as an inline style', (_label, p) => {
    render(<RepoRail {...p} />);
    expect(screen.getByTestId('repo-rail').style.width).toBe(`${RAIL_W}px`);
  });

  it('loading reads "Loading…" and an error shows its text, with the All row and the footer still there', () => {
    const { unmount } = render(<RepoRail {...props({ repos: slot<ReturnType<typeof reposFixture>>(undefined) })} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByTestId('rail-all')).toBeTruthy();
    unmount();
    render(<RepoRail {...props({ repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('x'), errorText: "Couldn't load repositories: x" }) })} />);
    expect(screen.getByText("Couldn't load repositories: x")).toBeTruthy();
    expect(screen.getByTestId('rail-sla-note')).toBeTruthy();
  });

  it('an empty scope reads "No repositories in this scope."', () => {
    render(<RepoRail {...props({ rows: [] })} />);
    expect(screen.getByText('No repositories in this scope.')).toBeTruthy();
  });
});

describe('order: overdue, then open critical, then open high, then name; unmeasured last', () => {
  it('re-sorts the server order (which is by open critical) so a repository with more overdue comes first', () => {
    // The fixture is in SERVER order: ledger-service (5 critical) first. The rail must not keep it.
    expect(AL_RAIL_ROWS[0].fullName).toBe('acme/ledger-service');
    render(<RepoRail {...props()} />);
    expect(railNames()).toEqual([
      'acme/checkout-api',    // 4 overdue
      'acme/billing-worker',  // 1 overdue
      'acme/ledger-service',  // 0 overdue, 5 critical
      'acme/audit-log',       // 2 critical, 5 high
      'acme/zeta-jobs',       // the same figures, so by name
      'acme/quiet-service',   // nothing open
    ]);
  });

  it('Severity "High only" sorts by the visible severity: hidden critical counts as 0', () => {
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(railNames()).toEqual([
      'acme/checkout-api',    // 3 high overdue
      'acme/audit-log', 'acme/zeta-jobs',   // 5 high open
      'acme/billing-worker',  // 1 high open
      'acme/ledger-service', 'acme/quiet-service',   // nothing visible, by name
    ]);
  });

  it('Severity "Critical only" counts only critical overdue', () => {
    render(<RepoRail {...props({ urlOver: { severity: 'critical' } })} />);
    expect(railNames().slice(0, 3)).toEqual(['acme/checkout-api', 'acme/billing-worker', 'acme/ledger-service']);
  });

  it('unmeasured repositories come last, whatever their stored counts, ordered by name', () => {
    render(<RepoRail {...props()} />);
    const all = Array.from(screen.getByTestId('rail-list').querySelectorAll('[data-testid="rail-row"], [data-testid="rail-unmeasured"]'))
      .map(el => el.getAttribute('data-repo'));
    expect(all.slice(-2)).toEqual(['acme/invoice-render', 'acme/legacy-batch']);
    expect(all.slice(0, -2).every(n => !['acme/invoice-render', 'acme/legacy-batch'].includes(n!))).toBe(true);
  });

  it('sortRailRows is a pure function of rows, severity and the SLA state', () => {
    const sorted = sortRailRows(AL_RAIL_ROWS, 'both', bothActive).map(s => s.row.fullName);
    expect(sorted[0]).toBe('acme/checkout-api');
    expect(sorted).not.toContain('acme/invoice-render');
  });
});

describe('the OVERDUE figure', () => {
  it('shows "N OVERDUE" summed over the visible severities with an active SLA, and nothing when it is 0', () => {
    render(<RepoRail {...props()} />);
    expect(within(row('acme/checkout-api')).getByTestId('rail-overdue').textContent).toBe('4 OVERDUE');
    expect(within(row('acme/billing-worker')).getByTestId('rail-overdue').textContent).toBe('1 OVERDUE');
    expect(within(row('acme/ledger-service')).queryByTestId('rail-overdue')).toBeNull();
    expect(screen.queryByText(/^0 OVERDUE/)).toBeNull();
  });

  it('Severity "Critical only" drops the high overdue, and "High only" drops the critical overdue', () => {
    const { unmount } = render(<RepoRail {...props({ urlOver: { severity: 'critical' } })} />);
    expect(within(row('acme/checkout-api')).getByTestId('rail-overdue').textContent).toBe('1 OVERDUE');
    unmount();
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(within(row('acme/checkout-api')).getByTestId('rail-overdue').textContent).toBe('3 OVERDUE');
    expect(within(row('acme/billing-worker')).queryByTestId('rail-overdue')).toBeNull();
  });

  it.each<[AlSlaKind, AlSlaKind, string | null]>([
    ['active', 'active', '4 OVERDUE'],
    ['active', 'pending', '1 OVERDUE'],
    ['pending', 'active', '3 OVERDUE'],
    ['none', 'none', null],
    ['pending', 'pending', null],
    ['invalid', 'invalid', null],
  ])('critical %s, high %s: checkout-api reads %s', (critical, high, expected) => {
    // The rows still carry overdue figures: the SLA state, not the row, decides whether one is shown.
    render(<RepoRail {...props({ summary: alSummary({ critical, high }) })} />);
    const el = within(row('acme/checkout-api')).queryByTestId('rail-overdue');
    expect(el?.textContent ?? null).toBe(expected);
  });
});

describe('row content', () => {
  it('shows "N crit · N high open" and the owning team only when no team filter is set', () => {
    const { unmount } = render(<RepoRail {...props()} />);
    expect(within(row('acme/billing-worker')).getByTestId('rail-counts').textContent).toBe('2 crit · 1 high open');
    expect(row('acme/billing-worker').textContent).toContain('Owning team: Payments');
    unmount();
    render(<RepoRail {...props({ urlOver: { team: 'Payments' } })} />);
    expect(row('acme/billing-worker').textContent).not.toContain('Owning team');
  });

  it('a hidden severity is left out of the counts', () => {
    render(<RepoRail {...props({ urlOver: { severity: 'high' } })} />);
    expect(within(row('acme/billing-worker')).getByTestId('rail-counts').textContent).toBe('1 high open');
  });

  it('a repository with no open alerts is greyed and says "no open alerts"', () => {
    render(<RepoRail {...props()} />);
    const quiet = row('acme/quiet-service');
    expect(within(quiet).getByTestId('rail-counts').textContent).toBe('no open alerts');
    expect(quiet.innerHTML).toContain('text-gray-500');
    expect(quiet.innerHTML).not.toContain('text-gray-200');
    expect(row('acme/checkout-api').innerHTML).toContain('text-gray-200');
  });

  it('railStat treats a row whose only open alerts are of a hidden severity as empty', () => {
    const r = repoRow('acme/x', 'Payments', { critical: cell({ open: 4, overdue: 2 }), high: cell() });
    expect(railStat(r, 'high', bothActive)).toEqual({ crit: 0, high: 0, overdue: 0, total: 0 });
    expect(railStat(r, 'both', bothActive)).toEqual({ crit: 4, high: 0, overdue: 2, total: 4 });
  });
});

describe('selection', () => {
  it('tints the selected row, shows × and marks it pressed; the All row is not selected then', () => {
    render(<RepoRail {...props({ effectiveRepo: 'acme/audit-log' })} />);
    const sel = row('acme/audit-log');
    expect(sel.getAttribute('aria-pressed')).toBe('true');
    expect(sel.className).toContain('bg-accent/10');
    expect(sel.textContent).toContain('×');
    expect(screen.getByTestId('rail-all').getAttribute('aria-pressed')).toBe('false');
    expect(row('acme/zeta-jobs').getAttribute('aria-pressed')).toBe('false');
    expect(row('acme/zeta-jobs').textContent).not.toContain('×');
  });

  it('with no repository the All row is the tinted one', () => {
    render(<RepoRail {...props()} />);
    expect(screen.getByTestId('rail-all').className).toContain('bg-accent/10');
    expect(screen.getByTestId('rail-all').getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking a row calls url.setRepo with that repository and nothing else on the URL', () => {
    const p = props();
    render(<RepoRail {...p} />);
    fireEvent.click(row('acme/audit-log'));
    expect(p.url.setRepo).toHaveBeenCalledTimes(1);
    expect(p.url.setRepo).toHaveBeenCalledWith('acme/audit-log');
    // A rail click is a replace of `repo` only: no history entry, no view or team change.
    expect(p.url.selectRepoRow).not.toHaveBeenCalled();
    expect(p.url.setTeam).not.toHaveBeenCalled();
    expect(p.url.setView).not.toHaveBeenCalled();
  });

  it('clicking the selected row (its ×) or the All row clears the repository', () => {
    const p = props({ effectiveRepo: 'acme/audit-log' });
    render(<RepoRail {...p} />);
    fireEvent.click(row('acme/audit-log'));
    expect(p.url.setRepo).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByTestId('rail-all'));
    expect(p.url.setRepo).toHaveBeenLastCalledWith(null);
    expect(p.url.setRepo).toHaveBeenCalledTimes(2);
  });
});

describe('unmeasured rows', () => {
  it('are hatched, read "UNMEASURED · <reason>", show no counts, and open the drawer from the clicked element', () => {
    const p = props();
    render(<RepoRail {...p} />);
    const off = screen.getAllByTestId('rail-unmeasured').find(el => el.getAttribute('data-repo') === 'acme/invoice-render')!;
    const err = screen.getAllByTestId('rail-unmeasured').find(el => el.getAttribute('data-repo') === 'acme/legacy-batch')!;
    expect(off.className).toContain('vuln-hatch');
    expect(off.textContent).toContain('Unmeasured · Dependabot off');
    expect(err.textContent).toContain('Unmeasured · HTTP 500: status check failed');
    expect(off.textContent).not.toMatch(/crit|high|\d+ open/);
    fireEvent.click(off);
    expect(p.openDrawer).toHaveBeenCalledWith(off);
    expect(p.url.setRepo).not.toHaveBeenCalled();
  });

  it('unmeasuredReason words the two statuses like the drawer', () => {
    expect(unmeasuredReason({ status: 'dependabot-off', detail: null })).toBe('Dependabot off');
    expect(unmeasuredReason({ status: 'error', detail: 'timeout' })).toBe('timeout');
    expect(unmeasuredReason({ status: 'error', detail: null })).toBe('Status check failed');
  });
});

describe('the name filter', () => {
  it('filters measured and unmeasured rows by name, updates the count, and says so when nothing matches', () => {
    render(<RepoRail {...props()} />);
    const box = screen.getByPlaceholderText('Filter by name');
    fireEvent.change(box, { target: { value: 'LEDGER' } });
    expect(railNames()).toEqual(['acme/ledger-service']);
    expect(screen.getByTestId('rail-meta').textContent).toBe('1 repo');
    fireEvent.change(box, { target: { value: 'invoice' } });
    expect(screen.queryAllByTestId('rail-row')).toHaveLength(0);
    expect(screen.getAllByTestId('rail-unmeasured')).toHaveLength(1);
    expect(screen.getByTestId('rail-meta').textContent).toBe('0 repos + 1 unmeasured');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('No repositories match “zzz”.')).toBeTruthy();
  });
});

describe('footer', () => {
  it('reads "Sorted by overdue, then open critical" above the SLA explanation', () => {
    render(<RepoRail {...props()} />);
    const footer = screen.getByText('Sorted by overdue, then open critical').parentElement!;
    expect(footer.textContent).toContain('Overdue counts critical and high');
  });

  it('the SLA explanation wraps instead of truncating (fix 1 beyond the handoff)', () => {
    render(<RepoRail {...props({ summary: alSummary({ critical: 'active', high: 'pending' }) })} />);
    const note = screen.getByTestId('rail-sla-note');
    expect(note.textContent).toBe('Overdue counts critical only · high: Starts 2026-11-01');
    for (const clipping of ['truncate', 'whitespace-nowrap', 'text-ellipsis', 'overflow-hidden']) {
      expect(note.className.split(/\s+/)).not.toContain(clipping);
    }
    expect(note.className).toContain('whitespace-normal');
    expect(note.className).toContain('break-words');
  });

  it.each<[AlSlaKind, AlSlaKind, string]>([
    ['active', 'active', 'Overdue counts critical and high'],
    ['active', 'pending', 'Overdue counts critical only · high: Starts 2026-11-01'],
    ['active', 'none', 'Overdue counts critical only · high: No SLA policy yet'],
    ['pending', 'active', 'Overdue counts high only · critical: Starts 2026-11-01'],
    ['none', 'active', 'Overdue counts high only · critical: No SLA policy yet'],
    ['none', 'none', 'No active SLA policy · no overdue counts'],
    ['pending', 'pending', 'No active SLA policy · no overdue counts'],
    ['invalid', 'invalid', "SLA policy can't be read · no overdue counts"],
  ])('critical %s, high %s: "%s"', (critical, high, expected) => {
    expect(railSlaNote(alSummary({ critical, high }))).toBe(expected);
    render(<RepoRail {...props({ summary: alSummary({ critical, high }) })} />);
    expect(screen.getByTestId('rail-sla-note').textContent).toBe(expected);
  });
});

describe('with the plain REPO_ROWS fixture', () => {
  it('lists every repository once and keeps the server order when nothing is overdue', () => {
    render(<RepoRail {...props({ rows: REPO_ROWS, summary: alSummary({ critical: 'none', high: 'none' }) })} />);
    expect(railNames()).toEqual(['acme/checkout-api', 'acme/ledger', 'acme/search-index']);
    expect(screen.getAllByTestId('rail-unmeasured')).toHaveLength(1);
  });
});

describe('light theme', () => {
  // Revert: put the card-shell class on the rail, a row or the search box: the light remap's border would resize a fixed-height row.
  it.each([
    ['populated', props()],
    ['loading', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined) })],
    ['error', props({ repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('x'), errorText: "Couldn't load repositories: x" }) })],
    ['empty scope', props({ rows: [] })],
  ])('the %s rail uses no card-shell class (bg-gray-900) anywhere inside it', (_label, p) => {
    const { container } = render(<RepoRail {...p} />);
    expect(container.querySelector('.bg-gray-900')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-repo-rail.test.tsx --maxWorkers=3`
Expected: FAIL. The Wave 2 stub renders an empty `aside`, so the `Repositories` header, `rail-all` and `rail-row` are not found.

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/repo-rail.tsx
'use client';
// GLOOK-64: the Alerts view's 260px repository rail. One row per repository in scope, re-sorted on
// the client (overdue, then open critical, then open high, then name; unmeasured last), with the
// selected repository tinted and a click that writes only `repo` (a replace, no history entry).
import { useState } from 'react';
import type { RepoRow } from '@/lib/vulnerabilities/aggregate';
import type { SecurityViewProps } from './view-props';
import { scopeOpenCount, type SeverityFilter } from './security-state';
import { SLA_INVALID_LABEL, slaActive, slaState, slaStateLabel, type SlaSource } from './sla-state';
import { RAIL_W, TYPE } from './dimensions';

export const RAIL_SORT_NOTE = 'Sorted by overdue, then open critical';

/** Why a repository is unmeasured. Same wording as the coverage drawer. */
export const unmeasuredReason = (u: NonNullable<RepoRow['unmeasured']>) =>
  u.status === 'dependabot-off' ? 'Dependabot off' : (u.detail ?? 'Status check failed');

export interface RailStat { crit: number; high: number; overdue: number; total: number }

/**
 * One row's figures under the Severity filter: a hidden severity counts as 0 (so the sort and the
 * "no open alerts" grey follow what the user can see), and overdue sums only the severities that are
 * both visible and have an active SLA. The SLA state decides, not the row's own null.
 */
export function railStat(row: RepoRow, severity: SeverityFilter, sla: SlaSource): RailStat {
  const crit = severity === 'high' ? 0 : row.critical.open;
  const high = severity === 'critical' ? 0 : row.high.open;
  const overdue =
    (severity !== 'high' && slaActive('critical', sla) ? (row.critical.overdue ?? 0) : 0) +
    (severity !== 'critical' && slaActive('high', sla) ? (row.high.overdue ?? 0) : 0);
  return { crit, high, overdue, total: crit + high };
}

/** Measured rows in rail order: overdue desc, open critical desc, open high desc, name asc. */
export function sortRailRows(rows: readonly RepoRow[], severity: SeverityFilter, sla: SlaSource): Array<{ row: RepoRow; stat: RailStat }> {
  return rows
    .filter(r => !r.unmeasured)
    .map(row => ({ row, stat: railStat(row, severity, sla) }))
    .sort((a, b) =>
      b.stat.overdue - a.stat.overdue || b.stat.crit - a.stat.crit || b.stat.high - a.stat.high || a.row.fullName.localeCompare(b.row.fullName));
}

/** "9 crit · 14 high open", or "no open alerts" when the visible severities have none. */
export function railCounts(crit: number, high: number, severity: SeverityFilter): string {
  if (crit + high === 0) return 'no open alerts';
  const parts: string[] = [];
  if (severity !== 'high') parts.push(`${crit.toLocaleString('en-US')} crit`);
  if (severity !== 'critical') parts.push(`${high.toLocaleString('en-US')} high`);
  return `${parts.join(' · ')} open`;
}

/** The footer's second line: which severities the OVERDUE figures include, and why one is missing. */
export function railSlaNote(sla: SlaSource): string {
  const c = slaState('critical', sla);
  const h = slaState('high', sla);
  if (c.kind === 'active' && h.kind === 'active') return 'Overdue counts critical and high';
  if (c.kind === 'active') return `Overdue counts critical only · high: ${slaStateLabel(h)}`;
  if (h.kind === 'active') return `Overdue counts high only · critical: ${slaStateLabel(c)}`;
  return `${c.kind === 'invalid' ? SLA_INVALID_LABEL : 'No active SLA policy'} · no overdue counts`;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

export default function RepoRail({ summary, data, url, openDrawer }: SecurityViewProps) {
  const [filter, setFilter] = useState('');
  const rows = data.repos.data?.rows;
  const repo = data.effectiveRepo;          // not url.repo: a repository that was not found is not selected
  const needle = filter.trim().toLowerCase();
  const matching = rows ? rows.filter(r => !needle || r.fullName.toLowerCase().includes(needle)) : [];
  const measured = sortRailRows(matching, url.severity, summary);
  const unmeasured = matching.filter(r => r.unmeasured).sort((a, b) => a.fullName.localeCompare(b.fullName));

  const allCrit = rows ? scopeOpenCount(rows, 'critical', null) : 0;
  const allHigh = rows ? scopeOpenCount(rows, 'high', null) : 0;
  const meta = rows ? `${plural(measured.length, 'repo')}${unmeasured.length ? ` + ${unmeasured.length} unmeasured` : ''}` : '';

  return (
    <aside
      aria-label="Repositories"
      data-testid="repo-rail"
      className="flex min-h-0 min-w-0 flex-col border-r border-gray-700"
      style={{ width: RAIL_W }}
    >
      <div className="flex flex-none flex-col gap-2.5 px-4 pb-2.5 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={`${TYPE.sectionLabel} text-gray-300`}>Repositories</span>
          <span data-testid="rail-meta" className="min-h-4 truncate text-xs text-gray-500">{meta || '\u00a0'}</span>
        </div>
        <input
          aria-label="Filter by name"
          placeholder="Filter by name"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`h-[30px] w-full border border-gray-700 bg-chart-surface px-2.5 text-[13px] text-gray-200 ${TYPE.control}`}
        />
      </div>

      <div
        data-testid="rail-list"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
        style={{ opacity: data.repos.stale ? 0.6 : 1 }}
      >
        <button
          type="button"
          data-testid="rail-all"
          aria-pressed={repo === null}
          onClick={() => url.setRepo(null)}
          className={`flex w-full flex-none flex-col gap-0.5 px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${repo === null ? 'bg-accent/10' : 'hover:bg-gray-800/30'}`}
        >
          <span className={`truncate ${repo === null ? 'font-semibold text-accent-light' : 'text-gray-200'}`}>
            {url.team ? `All ${url.team} repositories` : 'All repositories'}
          </span>
          <span className="truncate text-xs text-gray-400">{rows ? railCounts(allCrit, allHigh, url.severity) : '\u00a0'}</span>
        </button>
        <div className="mx-0.5 my-1 h-px flex-none bg-gray-700" aria-hidden="true" />

        {!rows && data.repos.errorText && <p className="px-2.5 py-4 text-sm text-red-400">{data.repos.errorText}</p>}
        {!rows && !data.repos.errorText && <p className="px-2.5 py-4 text-sm text-gray-500">Loading…</p>}
        {rows && measured.length === 0 && unmeasured.length === 0 && (
          <p className="px-2.5 py-4 text-sm text-gray-400">
            {needle ? `No repositories match “${filter.trim()}”.` : 'No repositories in this scope.'}
          </p>
        )}

        {measured.map(({ row, stat }) => {
          const selected = repo === row.fullName;
          return (
            <button
              key={row.fullName}
              type="button"
              data-testid="rail-row"
              data-repo={row.fullName}
              aria-pressed={selected}
              title={selected ? 'Show all repositories' : `Show ${row.fullName} alerts`}
              onClick={() => url.setRepo(selected ? null : row.fullName)}
              className={`flex w-full flex-none flex-col gap-0.5 px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${selected ? 'bg-accent/10' : 'hover:bg-gray-800/30'}`}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className={`truncate ${selected ? 'font-semibold text-accent-light' : stat.total > 0 ? 'text-gray-200' : 'text-gray-500'}`}>{row.fullName}</span>
                {selected && <span aria-hidden="true" className="shrink-0 text-[15px] leading-none text-accent-light">×</span>}
              </span>
              <span className="flex justify-between gap-2 whitespace-nowrap text-xs text-gray-400">
                <span data-testid="rail-counts" className="min-w-0 truncate">{railCounts(stat.crit, stat.high, url.severity)}</span>
                {stat.overdue > 0 && <span data-testid="rail-overdue" className="shrink-0 font-bold text-red-400">{stat.overdue.toLocaleString('en-US')} OVERDUE</span>}
              </span>
              {!url.team && <span className="truncate text-[11px] text-gray-500">Owning team: {row.team}</span>}
            </button>
          );
        })}

        {unmeasured.map(row => (
          <button
            key={row.fullName}
            type="button"
            data-testid="rail-unmeasured"
            data-repo={row.fullName}
            title="Open counts unknown. Resolved alerts and history still count."
            onClick={e => openDrawer(e.currentTarget)}
            className={`vuln-hatch mt-1 flex w-full flex-none flex-col gap-[3px] border border-warn-line px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control}`}
          >
            <span className="truncate text-gray-200">{row.fullName}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-warn">
              <span aria-hidden="true" className="shrink-0">▲</span>
              <span className="truncate uppercase">Unmeasured · {unmeasuredReason(row.unmeasured!)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-none flex-col gap-0.5 border-t border-gray-700 px-4 py-2.5 text-xs text-gray-500">
        <span>{RAIL_SORT_NOTE}</span>
        {/* Wraps: the second line explains which overdue counts are included, so it must never be clipped. */}
        <span data-testid="rail-sla-note" className="whitespace-normal break-words">{railSlaNote(summary)}</span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-repo-rail.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/repo-rail.tsx src/lib/__tests__/unit/vuln-repo-rail.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Alerts view repository rail"
```

### Task 4.5: Alert list (toolbar, headers, rows, branches, clamp)

**Files:**
- Modify: `src/app/vulnerabilities/alert-list.tsx` (replace the Wave 2 stub)
- Test: `src/lib/__tests__/unit/vuln-alert-list.test.tsx`

**Interfaces:**
- Consumes: `SecurityViewProps`; `AlertSortKey`, `AlertStatus`, `DEFAULT_ALERT_LIST`, `sanitiseAlertList`, `useAlertList`, `ALERT_SORT_FIRST_DIR` (`./security-state`; the tests use the last four); `SLA_INVALID_LABEL`, `SLA_NONE_LABEL`, `anySlaActive`, `slaState`, `slaStateLabel`, `SlaSource` (`./sla-state`); `Pager`, `PAGER_H` (Task 4.2); `ALERT_LIST_H`, `ALERT_PAGE_SIZE`, `ALERT_ROW_H`, `ALERTS_CARD_H`, `RAIL_W`, `TYPE` (`./dimensions`); `ALERT_SORT_KEYS` (`@/lib/vulnerabilities/alert-sort`, tests); `AlertRow` type (`@/lib/vulnerabilities/aggregate`); `data.alerts` (a `Slot<AlertsData>`), `data.repoStatus`, `url.clearRepo`, and the `list` controller from the props; the Task 4.1 fixtures.
- Produces: `AlertList` (default export) and the constants and helpers under "Wave 4 public interface". It keeps the stub's `data-testid="alert-list"` (no fixed height) and `data-testid="alert-list-rows"` with inline `height: ALERT_LIST_H` in every branch.

Behaviours:

*Toolbar.* Row 1 is a search box (placeholder "Search CVE, GHSA, package") and a Status select (Open, Resolved, Open + resolved). Row 2 is four toggles: Overdue, Due ≤ 7d, Reopened, Runtime only, each a button with `aria-pressed`. Both rows are 32px tall.
- *Search.* The typed text is local. It is applied (`list.setQuery`) `SEARCH_DEBOUNCE_MS` (300ms) after the last keystroke. It is applied at once, before the other control's own handler, when the user clicks a toggle, the Status select or a sort header inside that window (one `setQuery`, then the click's handler, then nothing from the timer). It is applied on unmount, so switching view inside the window keeps the text. A value already sent is not sent twice, and typing back to the applied value sends nothing. The box starts from `list.list.q`.
- *Time toggles.* Overdue and Due ≤ 7d are enabled only while some severity's SLA is active and the status is not Resolved. Otherwise they are disabled (opacity 0.45) with a `title`. While no SLA is active, a visible hint also shows beside the toggles: `noSlaHint` (invalid wins over pending, which wins over none): "SLA policy can't be read", "Due dates start {earliest start date}", "No SLA policy yet". Resolved disables them with the title "Resolved alerts have no due date" and prints no SLA hint. A disabled toggle never reads as pressed. Mutual exclusion of Overdue and Due ≤ 7d, and Resolved clearing both, live in `useAlertList` (Task 2.6) and are tested here through the real controller.

*Headers.* Six sortable headers in a CSS grid: Sev, Advisory (second line "CVSS · package"), Repository ("owning team"), Age, Due, State ("scope"). Each calls `list.setSort(key)`. With `sort: null` every header shows ↕ and none is marked sorted. The active header shows ↑ or ↓ in `text-accent-light` and `aria-sort`. The first click's direction comes from the controller (`ALERT_SORT_FIRST_DIR`: Age descending, the rest ascending). The list never re-sorts rows: the server orders them.

*Rows.* Ten rows of 56px in a 560px area (`alert-list-rows`). Columns: a CRIT or HIGH badge; the advisory id as a link (`htmlUrl`, new tab) over "CVSS 9.1 · package (ecosystem)"; the repository's short name (full name in the title) over the owning team; age ("77d"); Due; State over scope.
- *Due.* While the row's severity SLA is active, an open alert shows the date ("Jul 21") over "in Nd", "today" or "Nd OVERDUE" (red, bold). Otherwise it shows "—" over that severity's `slaStateLabel`. A resolved alert shows "—" over "resolved on time" or "resolved Nd late". **"Nd OVERDUE" is not clipped** (fix 2 beyond the handoff): its element has no overflow clip or ellipsis and cannot shrink, and the Due grid track has a pixel minimum (`ALERT_DUE_MIN_W`) while every other track is `minmax(0, …)`. A test adds the tracks' minimums and checks they fit the list column at a 1024px viewport.
- *State.* The state, then a muted suffix: for a resolved alert the dismissal reason and the resolved date; for any alert that was reopened, "↺ reopened {date}" from `lastReopenedAt` (UTC, "Aug 14"; no date when it is null). The scope reads "unknown" when null.
- Cells that truncate carry their full text as a `title`. A null package prints nothing (never "null"). Rows are keyed by position.

*Branches of the 560px area, in this order.*
1. `data.repoStatus === 'not-found'`: "Repository not found · " and a "Show all repositories" button that calls `url.clearRepo()`. This is checked first because the alerts slot is the empty slot in this state. It is never a page-level error.
2. `data.alerts.errorText`: the text, centred in the area. The toolbar, headers and pager stay mounted, so the user can undo the filter that failed.
3. `data.alerts.loading`: "Loading…".
4. Rows, or "No alerts match these filters." when empty.
- While `data.alerts.stale` is true the area dims (`opacity-60`) and "Updating…" shows beside the toggles. The controls are never dimmed. An error shows neither.
- The pager shows `totalCount` from the response; in loading, error and not-found it is the blank state.
- *Page clamp.* An effect: when the alerts data is settled (not stale, not loading), `rows.length === 0`, `totalCount > 0` and the page is above 1, call `list.setPage(Math.ceil(totalCount / 10))`.
- *Fixed size.* The list column's padding, two toolbar rows, header, pager and three gaps add up to `ALERT_COLUMN_CHROME_H`; with the 560px rows that is the 776px card. A test asserts the sum.

Reverts that fail: removing the clamp fails `pager and the page clamp › a page past the end (no rows, a total above 0) goes to the last page`; dropping the Due track's pixel minimum fails `fixed geometry › the Due track has a pixel minimum and every other track can shrink to 0, so the minimums fit at 1024px (fix 2 beyond the handoff)`; removing the flush on unmount fails `search › a view switch (the list unmounts) inside the window applies the typed text instead of dropping it`; removing the flush before a click fails four cases under `search`; reversing or re-sorting the rows fails `rows › renders rows in the order the server sent them, whatever the active sort (the server sorts, the client does not)` (and several Due cases); checking loading before not-found fails `repository not found › is checked before loading and empty: the empty alerts slot of this state is not "No alerts match"`; letting Resolved keep the time toggles enabled fails `Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active › Resolved disables both time toggles without printing an SLA hint`; reading the reopened date from the wrong field fails two `State column` tests; making the invalid state read as "none" fails `Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active › an unreadable policy reads "SLA policy can't be read", never "No SLA policy yet"`; removing the stale dim fails `stale, loading and error › stale: the row area dims and "Updating…" shows; the controls are not dimmed`; wiring every header to the same sort key fails `sort headers › clicking the %s header calls setSort with that key` and `sort headers › Age starts descending (oldest first), every other key ascending, and a second click reverses (real controller)`.

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alert-list.test.tsx
// The Alerts view's list column. Replaces vuln-alerts-table.test.tsx: the rows, the fixed
// geometry, the toolbar (search debounce and flush, Status, four toggles), the sort headers, the
// stale / error / not-found branches, and the page clamp.
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import AlertList, {
  ALERT_COLUMN_CHROME_H, ALERT_COLUMN_PAD, ALERT_DUE_MIN_W, ALERT_GRID_COLS, ALERT_HEAD_H, SEARCH_DEBOUNCE_MS, SORT_ARROW, noSlaHint, shortDate,
} from '@/app/vulnerabilities/alert-list';
import { PAGER_H } from '@/app/vulnerabilities/pager';
import { ALERTS_CARD_H, ALERT_LIST_H, ALERT_ROW_H, RAIL_W } from '@/app/vulnerabilities/dimensions';
import {
  ALERT_SORT_FIRST_DIR, DEFAULT_ALERT_LIST, sanitiseAlertList, useAlertList, type AlertListState,
} from '@/app/vulnerabilities/security-state';
import { anySlaActive } from '@/app/vulnerabilities/sla-state';
import type { AlertsData } from '@/app/vulnerabilities/api-types';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
import { ALERT_SORT_KEYS } from '@/lib/vulnerabilities/alert-sort';
import {
  viewProps, slot, alertsFixture, alAlertRow, alAlertRows, alSummary, AL_OVERDUE_ROW, AL_RESOLVED_ROW, type AlSlaKind,
} from '../support/security-fixtures';

const active = alSummary({ critical: 'active', high: 'active' });
const ERR = { loading: false, error: new Error('HTTP 500'), errorText: "Couldn't load alerts: HTTP 500" };
const noData = () => slot<AlertsData>(undefined, { loading: false });

/** Props with the given rows (and an optional total), list state, SLA states and data overrides. */
function props(opts: {
  rows?: AlertsData['rows']; total?: number; list?: Partial<AlertListState>; summary?: SecurityViewProps['summary'];
  alerts?: SecurityViewProps['data']['alerts']; data?: Partial<SecurityViewProps['data']>;
} = {}): SecurityViewProps {
  const base = viewProps({ summary: opts.summary ?? active });
  const rows = opts.rows ?? alAlertRows(10);
  return {
    ...base,
    list: { ...base.list, list: { ...DEFAULT_ALERT_LIST, ...(opts.list ?? {}) } },
    data: { ...base.data, alerts: opts.alerts ?? slot(alertsFixture(rows, opts.total ?? rows.length)), ...(opts.data ?? {}) },
  };
}
const rowsArea = () => screen.getByTestId('alert-list-rows');
const button = (name: string | RegExp) => screen.getByRole('button', { name });

/** The real controller wired into the list, so behaviour that lives in useAlertList shows through the UI. */
function Harness({ summary = active, onList }: { summary?: SecurityViewProps['summary']; onList?: (l: AlertListState) => void }) {
  const ctl = useAlertList({ codebase: 'backend', team: null, repo: null, severity: 'both' });
  const effective = sanitiseAlertList(ctl.list, { anySlaActive: anySlaActive(summary) });
  onList?.(effective);
  const base = props({ summary });
  return <AlertList {...base} list={{ ...ctl, list: effective }} />;
}

describe('fixed geometry', () => {
  it('the list column chrome plus the 560px row area is exactly the 776px card', () => {
    expect(ALERT_COLUMN_CHROME_H + ALERT_LIST_H).toBe(ALERTS_CARD_H);
    expect(ALERT_LIST_H).toBe(10 * ALERT_ROW_H);
  });

  it.each([
    ['populated', props()],
    ['stale', props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true }) })],
    ['loading', props({ alerts: slot<AlertsData>(undefined) })],
    ['error', props({ alerts: slot<AlertsData>(undefined, ERR) })],
    ['empty', props({ rows: [], total: 0 })],
    ['repository not found', props({ alerts: noData(), data: { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']> })],
  ])('the %s list area is ALERT_LIST_H as an inline style, and the outer list sets no height', (_label, p) => {
    render(<AlertList {...p} />);
    expect(rowsArea().style.height).toBe(`${ALERT_LIST_H}px`);
    expect(screen.getByTestId('alert-list').style.height).toBe('');
    expect(screen.getByTestId('alert-pager').style.height).toBe(`${PAGER_H}px`);
    expect(screen.getByTestId('alert-list-head').style.height).toBe(`${ALERT_HEAD_H}px`);
  });

  it('the list area is the same DOM node, at its height, across loading, populated, error, empty and not-found renders', () => {
    const notFound = { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']>;
    const { rerender } = render(<AlertList {...props({ alerts: slot<AlertsData>(undefined) })} />);
    const area = rowsArea();
    for (const next of [
      props(), props({ alerts: slot<AlertsData>(undefined, ERR) }), props({ rows: [], total: 0 }),
      props({ alerts: noData(), data: notFound }), props({ alerts: slot<AlertsData>(undefined) }),
    ]) {
      rerender(<AlertList {...next} />);
      expect(rowsArea()).toBe(area);
      expect(area.style.height).toBe(`${ALERT_LIST_H}px`);
    }
  });

  it('every row is ALERT_ROW_H tall as an inline style and shares the header\'s grid', () => {
    render(<AlertList {...props()} />);
    const head = screen.getByTestId('alert-list-head');
    const rows = screen.getAllByTestId('alert-row');
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.style.height).toBe(`${ALERT_ROW_H}px`);
      expect(r.style.gridTemplateColumns).toBe(head.style.gridTemplateColumns);
    }
    expect(head.style.gridTemplateColumns).toBe(ALERT_GRID_COLS);
  });

  it('the Due track has a pixel minimum and every other track can shrink to 0, so the minimums fit at 1024px (fix 2 beyond the handoff)', () => {
    const tracks = ALERT_GRID_COLS.split(' ');
    expect(tracks).toHaveLength(6);
    expect(tracks[4]).toBe(`minmax(${ALERT_DUE_MIN_W}px,1fr)`);
    expect(ALERT_DUE_MIN_W).toBeGreaterThanOrEqual(110);
    // Sum what the tracks insist on: px tracks and minmax(Npx, …) minimums. minmax(0, …) insists on nothing.
    const insisted = tracks.reduce((sum, t) => {
      const px = /^(\d+)px$/.exec(t) ?? /^minmax\((\d+)px,/.exec(t);
      return sum + (px ? Number(px[1]) : 0);
    }, 0);
    // 1024px viewport: the page container's side padding (2 × 24), then the rail and the list column's own padding.
    const listWidth = 1024 - 2 * 24 - RAIL_W - 2 * ALERT_COLUMN_PAD.x;
    expect(listWidth).toBe(676);
    expect(insisted).toBeLessThanOrEqual(listWidth);
    expect(tracks.filter(t => t.startsWith('minmax(0,'))).toHaveLength(3);
  });

  it('the Age header drops its left padding, so "AGE ↕" fits the 52px Age track instead of ending in an ellipsis', () => {
    render(<AlertList {...props()} />);
    expect(ALERT_GRID_COLS.split(' ')[3]).toBe('52px');
    expect(screen.getByTestId('sort-age').className.split(/\s+/)).toContain('pl-0');
    expect(screen.getByTestId('sort-age').className.split(/\s+/)).not.toContain('px-2.5');
  });

  it('"Nd OVERDUE" is bold red, never clipped: no ellipsis, no overflow clip, no shrinking, in a cell that does not clip either', () => {
    render(<AlertList {...props({ rows: [AL_OVERDUE_ROW] })} />);
    const sub = screen.getByTestId('alert-due-sub');
    expect(sub.textContent).toBe('71d OVERDUE');
    const cls = sub.className.split(/\s+/);
    for (const c of ['text-red-400', 'font-bold', 'whitespace-nowrap', 'shrink-0']) expect(cls).toContain(c);
    for (const c of ['truncate', 'text-ellipsis', 'overflow-hidden']) expect(cls).not.toContain(c);
    expect(sub.parentElement!.className.split(/\s+/)).not.toContain('overflow-hidden');
    expect(sub.parentElement!.className.split(/\s+/)).not.toContain('truncate');
  });

  it('the Overdue figure sits in the same Due cell as a quiet sub-line would, so rows keep their height', () => {
    render(<AlertList {...props({ rows: [AL_OVERDUE_ROW, alAlertRow(5)] })} />);
    for (const r of screen.getAllByTestId('alert-row')) expect(r.style.height).toBe(`${ALERT_ROW_H}px`);
  });
});

describe('rows', () => {
  it('shows severity, a linked advisory with "CVSS · package", the repository over its owning team, age, due and state over scope', () => {
    render(<AlertList {...props({ rows: [AL_OVERDUE_ROW] })} />);
    const row = screen.getByTestId('alert-row');
    expect(within(row).getByText('CRIT')).toBeTruthy();
    const link = within(row).getByRole('link', { name: 'CVE-2026-43102' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(AL_OVERDUE_ROW.htmlUrl);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    expect(within(row).getByText('CVSS 9.1 · golang.org/x/net (go)')).toBeTruthy();
    const repo = within(row).getByText('checkout-api');
    expect(repo.getAttribute('title')).toBe('acme/checkout-api');
    expect(within(row).getByText('Payments')).toBeTruthy();
    expect(within(row).getByText('77d')).toBeTruthy();
    expect(screen.getByTestId('alert-due').textContent).toBe('Jul 21');
    expect(screen.getByTestId('alert-state').textContent).toBe('open');
    expect(within(row).getByText('runtime')).toBeTruthy();
  });

  it('a high alert wears the HIGH badge', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { severity: 'high' })] })} />);
    expect(screen.getByText('HIGH')).toBeTruthy();
    expect(screen.queryByText('CRIT')).toBeNull();
  });

  it('renders rows in the order the server sent them, whatever the active sort (the server sorts, the client does not)', () => {
    const rows = [alAlertRow(3, { ageDays: 5 }), alAlertRow(1, { ageDays: 90 }), alAlertRow(2, { ageDays: 40 })];
    render(<AlertList {...props({ rows, list: { sort: { key: 'age', dir: 'desc' } } })} />);
    const ids = screen.getAllByTestId('alert-row').map(r => within(r).getByRole('link').textContent);
    expect(ids).toEqual(['CVE-2026-1003', 'CVE-2026-1001', 'CVE-2026-1002']);
  });

  it('every cell that can truncate carries its full text as a title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, {
      repo: 'acme/a-repository-with-a-very-long-name', team: 'A long owning team name', packageName: 'a-long-package-name', ecosystem: 'npm',
      state: 'dismissed', dismissedReason: 'no_bandwidth', resolvedAt: '2026-09-03T08:00:00Z', dueDate: null, daysRemaining: null,
    })], summary: alSummary({ critical: 'pending', high: 'pending' }) })} />);
    const row = screen.getByTestId('alert-row');
    expect(within(row).getByRole('link').getAttribute('title')).toBe('CVE-2026-1001');
    expect(within(row).getByText('CVSS 9.8 · a-long-package-name (npm)').getAttribute('title')).toBe('CVSS 9.8 · a-long-package-name (npm)');
    expect(within(row).getByText('a-repository-with-a-very-long-name').getAttribute('title')).toBe('acme/a-repository-with-a-very-long-name');
    expect(within(row).getByText('A long owning team name').getAttribute('title')).toBe('A long owning team name');
    expect(screen.getByTestId('alert-state').getAttribute('title')).toBe('dismissed · no_bandwidth · Sep 3');
  });

  it('an open alert\'s state-message sub-line in the Due cell carries its text as a title', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'invalid', high: 'invalid' }), rows: [alAlertRow(1, { dueDate: null, daysRemaining: null })] })} />);
    expect(screen.getByTestId('alert-due-sub').getAttribute('title')).toBe("SLA policy can't be read");
  });

  it('a null package renders nothing, never the text "null", in the cell or its title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { packageName: null, ecosystem: 'npm' })] })} />);
    const row = screen.getByTestId('alert-row');
    expect(row.textContent).not.toContain('null');
    expect(row.innerHTML).not.toContain('null');
    expect(within(row).getByText('CVSS 9.8')).toBeTruthy();
  });

  it('no CVSS and no package leaves the sub-line blank with no title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { packageName: null, ecosystem: null, cvss: null })] })} />);
    const row = screen.getByTestId('alert-row');
    expect(row.textContent).not.toContain('CVSS');
    expect(row.querySelector('[title=""]')).toBeNull();
  });

  it('falls back from the CVE id to the GHSA id', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { cveId: null, ghsaId: 'GHSA-p3vc-6q8r-22jw' })] })} />);
    expect(screen.getByRole('link', { name: 'GHSA-p3vc-6q8r-22jw' })).toBeTruthy();
  });

  it('the first row is the same DOM node across a rerender with different rows (rows are keyed by position)', () => {
    const { rerender } = render(<AlertList {...props({ rows: alAlertRows(3) })} />);
    const first = screen.getAllByTestId('alert-row')[0];
    rerender(<AlertList {...props({ rows: alAlertRows(5, { severity: 'high' }) })} />);
    expect(screen.getAllByTestId('alert-row')[0]).toBe(first);
  });

  it('shortDate reads UTC, so a late-evening instant stays on its UTC day', () => {
    expect(shortDate('2026-08-14T23:30:00Z')).toBe('Aug 14');
    expect(shortDate('2026-07-21')).toBe('Jul 21');
    expect(shortDate('not a date')).toBe('not a date');
  });
});

describe('State column: "↺ reopened {date}" comes from lastReopenedAt', () => {
  it('an open alert that was reopened reads "open · ↺ reopened Aug 14"', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { reopenedCount: 2, lastReopenedAt: '2026-08-14T10:30:00Z' })] })} />);
    expect(screen.getByTestId('alert-state').textContent).toBe('open · ↺ reopened Aug 14');
    expect(screen.getByTestId('alert-state').getAttribute('title')).toBe('open · ↺ reopened Aug 14');
  });

  it('a reopened alert with no recorded date still says it was reopened', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { reopenedCount: 1, lastReopenedAt: null })] })} />);
    expect(screen.getByTestId('alert-state').textContent).toBe('open · ↺ reopened');
  });

  it('an alert that never reopened says nothing about it, even if a stale date is present', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { reopenedCount: 0, lastReopenedAt: '2026-08-14T10:30:00Z' })] })} />);
    expect(screen.getByTestId('alert-state').textContent).toBe('open');
  });

  it('a resolved alert reads its state, the date it was resolved and, if reopened, when', () => {
    render(<AlertList {...props({ rows: [AL_RESOLVED_ROW] })} />);
    expect(screen.getByTestId('alert-state').textContent).toBe('fixed · Sep 3 · ↺ reopened Aug 14');
  });

  it('a dismissed alert shows its reason', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { state: 'dismissed', dismissedReason: 'no_bandwidth', resolvedAt: '2026-09-03T08:00:00Z', dueDate: null, daysRemaining: null })] })} />);
    expect(screen.getByTestId('alert-state').textContent).toBe('dismissed · no_bandwidth · Sep 3');
  });

  it('the scope sits under the state, and a missing scope reads "unknown"', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { scope: 'development' }), alAlertRow(2, { scope: null })] })} />);
    expect(screen.getByText('development')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
  });
});

describe('Due column, per SLA state (alert-list consumer of sla-state)', () => {
  it('active: the date over "in Nd", "today" or "Nd OVERDUE"', () => {
    render(<AlertList {...props({ rows: [
      alAlertRow(1, { dueDate: '2026-09-19', daysRemaining: 4 }),
      alAlertRow(2, { dueDate: '2026-09-15', daysRemaining: 0 }),
      alAlertRow(3, { dueDate: '2026-09-10', daysRemaining: -5 }),
    ] })} />);
    const dues = screen.getAllByTestId('alert-due').map(e => e.textContent);
    const subs = screen.getAllByTestId('alert-due-sub').map(e => e.textContent);
    expect(dues).toEqual(['Sep 19', 'Sep 15', 'Sep 10']);
    expect(subs).toEqual(['in 4d', 'today', '5d OVERDUE']);
    expect(screen.getAllByTestId('alert-due')[2].className).toContain('text-red-400');
    expect(screen.getAllByTestId('alert-due')[0].className).not.toContain('text-red-400');
  });

  it.each<[AlSlaKind, string]>([
    ['pending', 'Starts 2026-11-01'],
    ['none', 'No SLA policy yet'],
    ['invalid', "SLA policy can't be read"],
  ])('%s: a dash over "%s", never a due date or an overdue count', (kind, message) => {
    render(<AlertList {...props({
      summary: alSummary({ critical: kind, high: kind }),
      rows: [alAlertRow(1, { dueDate: null, daysRemaining: null })],
    })} />);
    expect(screen.getByTestId('alert-due').textContent).toBe('—');
    expect(screen.getByTestId('alert-due-sub').textContent).toBe(message);
    expect(screen.getByTestId('alert-row').textContent).not.toMatch(/OVERDUE/);
  });

  it('each row follows ITS severity: critical active shows a date, high pending shows its state message', () => {
    render(<AlertList {...props({
      summary: alSummary({ critical: 'active', high: 'pending' }),
      rows: [alAlertRow(1, { severity: 'critical', dueDate: '2026-09-19', daysRemaining: 4 }), alAlertRow(2, { severity: 'high', dueDate: null, daysRemaining: null })],
    })} />);
    const dues = screen.getAllByTestId('alert-due').map(e => e.textContent);
    const subs = screen.getAllByTestId('alert-due-sub').map(e => e.textContent);
    expect(dues).toEqual(['Sep 19', '—']);
    expect(subs).toEqual(['in 4d', 'Starts 2026-11-01']);
  });

  it('a resolved alert has no due date: a dash, and whether it was fixed in time', () => {
    render(<AlertList {...props({ rows: [AL_RESOLVED_ROW, alAlertRow(3, { state: 'fixed', resolvedOnTime: false, resolvedDaysLate: 3, dueDate: null, daysRemaining: null })] })} />);
    expect(screen.getAllByTestId('alert-due').map(e => e.textContent)).toEqual(['—', '—']);
    expect(screen.getAllByTestId('alert-due-sub').map(e => e.textContent)).toEqual(['resolved on time', 'resolved 3d late']);
  });
});

describe('Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active', () => {
  const timeToggles = () => [button('Overdue'), button('Due ≤ 7d')] as HTMLButtonElement[];

  it('every severity pending: both disabled, the hint reads "Due dates start 2026-11-01"', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'pending', high: 'pending' }) })} />);
    for (const t of timeToggles()) { expect(t.disabled).toBe(true); expect(t.title).toBe('Due dates start 2026-11-01'); }
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe('Due dates start 2026-11-01');
  });

  it('pending beats none: with one severity pending and the other without a policy the hint names the start date', () => {
    expect(noSlaHint(alSummary({ critical: 'none', high: 'pending' }))).toBe('Due dates start 2026-11-01');
  });

  it('an empty policy with none everywhere reads "No SLA policy yet"', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'none', high: 'none' }) })} />);
    for (const t of timeToggles()) expect(t.disabled).toBe(true);
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe('No SLA policy yet');
  });

  it('an unreadable policy reads "SLA policy can\'t be read", never "No SLA policy yet"', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'invalid', high: 'invalid' }) })} />);
    for (const t of timeToggles()) expect(t.disabled).toBe(true);
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe("SLA policy can't be read");
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  it.each<[AlSlaKind, AlSlaKind]>([['active', 'active'], ['active', 'pending'], ['none', 'active'], ['pending', 'active']])(
    'critical %s, high %s: at least one SLA is active, so both are enabled and there is no hint', (critical, high) => {
      render(<AlertList {...props({ summary: alSummary({ critical, high }) })} />);
      for (const t of timeToggles()) { expect(t.disabled).toBe(false); expect(t.title).toBe(''); }
      expect(screen.queryByTestId('alert-sla-hint')).toBeNull();
    });

  it('a disabled toggle ignores clicks, and Reopened and Runtime only stay enabled', () => {
    const p = props({ summary: alSummary({ critical: 'none', high: 'none' }) });
    render(<AlertList {...p} />);
    fireEvent.click(button('Overdue'));
    fireEvent.click(button('Due ≤ 7d'));
    expect(p.list.toggleOverdue).not.toHaveBeenCalled();
    expect(p.list.toggleDueSoon).not.toHaveBeenCalled();
    fireEvent.click(button('Reopened'));
    fireEvent.click(button('Runtime only'));
    expect(p.list.toggleReopened).toHaveBeenCalledTimes(1);
    expect(p.list.toggleRuntimeOnly).toHaveBeenCalledTimes(1);
  });

  it('a toggle that is "on" in the state but disabled never reads as pressed', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'none', high: 'none' }), list: { overdue: true } })} />);
    expect(button('Overdue').getAttribute('aria-pressed')).toBe('false');
  });

  it('Resolved disables both time toggles without printing an SLA hint', () => {
    render(<AlertList {...props({ list: { status: 'resolved' } })} />);
    for (const t of timeToggles()) { expect(t.disabled).toBe(true); expect(t.title).toBe('Resolved alerts have no due date'); }
    expect(screen.queryByTestId('alert-sla-hint')).toBeNull();
  });

  it('active toggles call their handlers', () => {
    const p = props();
    render(<AlertList {...p} />);
    fireEvent.click(button('Overdue'));
    fireEvent.click(button('Due ≤ 7d'));
    expect(p.list.toggleOverdue).toHaveBeenCalledTimes(1);
    expect(p.list.toggleDueSoon).toHaveBeenCalledTimes(1);
  });
});

describe('toggles and Status with the real list controller', () => {
  const pressed = (name: string) => button(name).getAttribute('aria-pressed');

  it('Overdue and Due ≤ 7d are mutually exclusive: turning one on turns the other off', () => {
    render(<Harness />);
    fireEvent.click(button('Overdue'));
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['true', 'false']);
    fireEvent.click(button('Due ≤ 7d'));
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['false', 'true']);
    fireEvent.click(button('Overdue'));
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['true', 'false']);
  });

  it('choosing Resolved disables the time toggles and clears whatever they were set to', () => {
    render(<Harness />);
    fireEvent.click(button('Overdue'));
    expect(pressed('Overdue')).toBe('true');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } });
    expect((button('Overdue') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Due ≤ 7d') as HTMLButtonElement).disabled).toBe(true);
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['false', 'false']);
    // Back to Open: still off, and enabled again.
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
    expect((button('Overdue') as HTMLButtonElement).disabled).toBe(false);
    expect(pressed('Overdue')).toBe('false');
  });

  it('Reopened and Runtime only toggle independently of the time toggles', () => {
    render(<Harness />);
    fireEvent.click(button('Overdue'));
    fireEvent.click(button('Reopened'));
    fireEvent.click(button('Runtime only'));
    expect([pressed('Overdue'), pressed('Reopened'), pressed('Runtime only')]).toEqual(['true', 'true', 'true']);
    fireEvent.click(button('Reopened'));
    expect([pressed('Overdue'), pressed('Reopened'), pressed('Runtime only')]).toEqual(['true', 'false', 'true']);
  });

  it('no SLA active: nothing can turn a time toggle on', () => {
    render(<Harness summary={alSummary({ critical: 'none', high: 'none' })} />);
    fireEvent.click(button('Overdue'));
    expect(pressed('Overdue')).toBe('false');
  });

  it('Status offers Open, Resolved and Open + resolved and reports the choice', () => {
    const p = props();
    render(<AlertList {...p} />);
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([
      ['open', 'Open'], ['resolved', 'Resolved'], ['all', 'Open + resolved'],
    ]);
    fireEvent.change(select, { target: { value: 'all' } });
    expect(p.list.setStatus).toHaveBeenCalledWith('all');
  });
});

describe('sort headers', () => {
  const HEAD_LABELS: Record<string, string> = { severity: 'Sev', advisory: 'Advisory', repo: 'Repository', age: 'Age', due: 'Due', state: 'State' };

  it('there is one sortable header per sort key the server accepts, in column order', () => {
    render(<AlertList {...props()} />);
    const heads = within(screen.getByTestId('alert-list-head')).getAllByRole('columnheader');
    expect(heads).toHaveLength(ALERT_SORT_KEYS.length);
    expect(heads.map(h => within(h).getByRole('button').getAttribute('data-testid'))).toEqual(
      ['severity', 'advisory', 'repo', 'age', 'due', 'state'].map(k => `sort-${k}`),
    );
    for (const k of ALERT_SORT_KEYS) expect(screen.getByTestId(`sort-${k}`).textContent).toContain(HEAD_LABELS[k]);
  });

  it.each(ALERT_SORT_KEYS.map(k => [k]))('clicking the %s header calls setSort with that key', key => {
    const p = props();
    render(<AlertList {...p} />);
    fireEvent.click(screen.getByTestId(`sort-${key}`));
    expect(p.list.setSort).toHaveBeenCalledWith(key);
  });

  it('with no sort every header shows ↕ and none is marked sorted (the server\'s default order)', () => {
    render(<AlertList {...props()} />);
    for (const k of ALERT_SORT_KEYS) {
      expect(screen.getByTestId(`sort-arrow-${k}`).textContent).toBe(SORT_ARROW.none);
      expect(SORT_ARROW.none.replace('\uFE0E', '')).toBe('↕');
      expect(screen.getByTestId(`sort-arrow-${k}`).className).not.toContain('text-accent-light');
      expect(screen.getByRole('columnheader', { name: new RegExp(HEAD_LABELS[k]) }).getAttribute('aria-sort')).toBe('none');
    }
  });

  it.each([['asc', '↑', 'ascending'], ['desc', '↓', 'descending']] as const)(
    'the active header shows %s as %s in the accent colour and the others keep ↕', (dir, arrow, aria) => {
      render(<AlertList {...props({ list: { sort: { key: 'due', dir } } })} />);
      expect(screen.getByTestId('sort-arrow-due').textContent).toBe(arrow);
      expect(screen.getByTestId('sort-arrow-due').className).toContain('text-accent-light');
      expect(screen.getByRole('columnheader', { name: /Due/ }).getAttribute('aria-sort')).toBe(aria);
      expect(screen.getByTestId('sort-arrow-age').textContent).toBe(SORT_ARROW.none);
    });

  it('Age starts descending (oldest first), every other key ascending, and a second click reverses (real controller)', () => {
    const seen: AlertListState[] = [];
    render(<Harness onList={l => seen.push(l)} />);
    const last = () => seen[seen.length - 1].sort;
    fireEvent.click(screen.getByTestId('sort-age'));
    expect(last()).toEqual({ key: 'age', dir: ALERT_SORT_FIRST_DIR.age });
    expect(screen.getByTestId('sort-arrow-age').textContent).toBe('↓');
    fireEvent.click(screen.getByTestId('sort-age'));
    expect(screen.getByTestId('sort-arrow-age').textContent).toBe('↑');
    fireEvent.click(screen.getByTestId('sort-repo'));
    expect(last()).toEqual({ key: 'repo', dir: 'asc' });
    expect(screen.getByTestId('sort-arrow-repo').textContent).toBe('↑');
    expect(screen.getByTestId('sort-arrow-age').textContent).toBe(SORT_ARROW.none);
  });

  it('the Advisory, Repository and State headers carry their second line', () => {
    render(<AlertList {...props()} />);
    expect(screen.getByTestId('sort-advisory').textContent).toContain('CVSS · package');
    expect(screen.getByTestId('sort-repo').textContent).toContain('owning team');
    expect(screen.getByTestId('sort-state').textContent).toContain('scope');
  });
});

describe('search', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const type = (v: string) => fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: v } });
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  it('applies the typed text once, SEARCH_DEBOUNCE_MS after the last keystroke', () => {
    const p = props();
    render(<AlertList {...p} />);
    type('lod'); advance(SEARCH_DEBOUNCE_MS - 100);
    type('lodash'); advance(SEARCH_DEBOUNCE_MS - 1);
    expect(p.list.setQuery).not.toHaveBeenCalled();
    advance(1);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
  });

  it('a toggle clicked inside the debounce window applies the typed text first, once, and the timer then does nothing', () => {
    const p = props();
    render(<AlertList {...p} />);
    type('lodash');
    fireEvent.click(button('Reopened'));
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
    expect(p.list.toggleReopened).toHaveBeenCalledTimes(1);
    const q = (p.list.setQuery as jest.Mock).mock.invocationCallOrder[0];
    const t = (p.list.toggleReopened as jest.Mock).mock.invocationCallOrder[0];
    expect(q).toBeLessThan(t);
    advance(SEARCH_DEBOUNCE_MS * 3);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the Status select', () => fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })],
    ['a sort header', () => fireEvent.click(screen.getByTestId('sort-due'))],
    ['the Overdue toggle', () => fireEvent.click(button('Overdue'))],
  ])('%s clicked inside the window applies the typed text too', (_label, act_) => {
    const p = props();
    render(<AlertList {...p} />);
    type('semver');
    act_();
    expect(p.list.setQuery).toHaveBeenCalledWith('semver');
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it('a view switch (the list unmounts) inside the window applies the typed text instead of dropping it', () => {
    const p = props();
    const { unmount } = render(<AlertList {...p} />);
    type('lodash');
    unmount();
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
    advance(SEARCH_DEBOUNCE_MS * 3);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it('unmounting after the debounce already fired does not send the same text a second time', () => {
    const p = props();
    const { unmount } = render(<AlertList {...p} />);
    type('lodash'); advance(SEARCH_DEBOUNCE_MS);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    unmount();
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it('unmounting with nothing typed, or with the text typed back to what it was, sends nothing', () => {
    const p = props({ list: { q: 'abc' } });
    const { unmount } = render(<AlertList {...p} />);
    expect((screen.getByLabelText('Search alerts') as HTMLInputElement).value).toBe('abc');
    type('abcd'); type('abc');
    unmount();
    expect(p.list.setQuery).not.toHaveBeenCalled();
  });

  it('starts from the list state\'s query, so coming back to the view shows what was applied', () => {
    render(<AlertList {...props({ list: { q: 'express' } })} />);
    expect((screen.getByLabelText('Search alerts') as HTMLInputElement).value).toBe('express');
  });

  it('the search box keeps its node, its focus and its typed text while the next page loads, goes stale or fails', () => {
    const p = props();
    const { rerender } = render(<AlertList {...p} />);
    const input = screen.getByLabelText('Search alerts') as HTMLInputElement;
    input.focus();
    type('lodash');
    const next = (alerts: SecurityViewProps['data']['alerts'], list: Partial<AlertListState> = {}) =>
      rerender(<AlertList {...props({ alerts, list })} />);
    next(slot<AlertsData>(undefined), { overdue: true });               // the new key has not resolved yet
    expect(screen.getByLabelText('Search alerts')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('lodash');
    next(slot(alertsFixture(alAlertRows(10), 26), { stale: true }));                // previous data while the new key loads
    expect(screen.getByLabelText('Search alerts')).toBe(input);
    expect(document.activeElement).toBe(input);
    next(slot<AlertsData>(undefined, ERR));                             // the request failed
    expect(screen.getByLabelText('Search alerts')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('lodash');
  });
});

describe('stale, loading and error', () => {
  it('stale: the row area dims and "Updating…" shows; the controls are not dimmed', () => {
    render(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true }) })} />);
    expect(rowsArea().className).toContain('opacity-60');
    expect(screen.getByText('Updating…')).toBeTruthy();
    for (const el of [screen.getByLabelText('Search alerts'), button('Overdue'), button('Reopened'), screen.getByTestId('sort-due')]) {
      for (let a: HTMLElement | null = el; a && a.getAttribute('data-testid') !== 'alert-list'; a = a.parentElement) {
        expect(a.className).not.toContain('opacity-60');
      }
    }
  });

  it('not stale: no dimming and no "Updating…"', () => {
    render(<AlertList {...props()} />);
    expect(rowsArea().className).not.toContain('opacity-60');
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('an error shows no "Updating…" and no dimming, even for stale data', () => {
    render(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true, error: new Error('x'), errorText: "Couldn't load alerts: x" }) })} />);
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(rowsArea().className).not.toContain('opacity-60');
  });

  it('loading reads "Loading…" with a blank pager, never a fake "0 alerts"', () => {
    render(<AlertList {...props({ alerts: slot<AlertsData>(undefined) })} />);
    expect(within(rowsArea()).getByText('Loading…')).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).not.toMatch(/alerts/);
    expect(screen.queryAllByTestId('alert-row')).toHaveLength(0);
  });

  it('an error replaces the rows with its text inside the list area and keeps every control mounted', () => {
    render(<AlertList {...props({ alerts: slot<AlertsData>(undefined, ERR) })} />);
    expect(within(rowsArea()).getByText("Couldn't load alerts: HTTP 500")).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByLabelText('Search alerts')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    for (const name of ['Overdue', 'Due ≤ 7d', 'Reopened', 'Runtime only']) expect(button(name)).toBeTruthy();
    for (const k of ALERT_SORT_KEYS) expect(screen.getByTestId(`sort-${k}`)).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).not.toMatch(/alerts/);
  });

  it('an error wins over data still held from the previous key', () => {
    render(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(3), 3), { error: new Error('x'), errorText: "Couldn't load alerts: x" }) })} />);
    expect(screen.queryAllByTestId('alert-row')).toHaveLength(0);
    expect(within(rowsArea()).getByText("Couldn't load alerts: x")).toBeTruthy();
  });

  it('an empty result reads "No alerts match these filters." with "0 alerts" in the pager', () => {
    render(<AlertList {...props({ rows: [], total: 0 })} />);
    expect(within(rowsArea()).getByText('No alerts match these filters.')).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).toContain('0 alerts · counted per Dependabot alert, not per CVE');
  });
});

describe('repository not found', () => {
  const notFound = () => props({
    alerts: noData(),
    data: { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']>,
  });

  it('shows "Repository not found · Show all repositories" inside the list area, with the controls still mounted', () => {
    render(<AlertList {...notFound()} />);
    expect(within(rowsArea()).getByText(/Repository not found/)).toBeTruthy();
    expect(within(rowsArea()).getByRole('button', { name: 'Show all repositories' })).toBeTruthy();
    expect(screen.getByLabelText('Search alerts')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('No alerts match these filters.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();     // never a page-level error
  });

  it('"Show all repositories" clears the repository', () => {
    const p = notFound();
    render(<AlertList {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all repositories' }));
    expect(p.url.clearRepo).toHaveBeenCalledTimes(1);
  });

  it('is checked before loading and empty: the empty alerts slot of this state is not "No alerts match"', () => {
    const p = props({ alerts: slot<AlertsData>(undefined, { loading: true }), data: { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']> });
    render(<AlertList {...p} />);
    expect(screen.getByText(/Repository not found/)).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('pager and the page clamp', () => {
  it('shows the range, "Page X of Y" and reports Next / Previous through setPage', () => {
    const p = props({ rows: alAlertRows(10), total: 26, list: { page: 2 } });
    render(<AlertList {...p} />);
    expect(screen.getByTestId('alert-pager').textContent).toContain('11–20 of 26 alerts · counted per Dependabot alert, not per CVE');
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    fireEvent.click(button(/Next/));
    expect(p.list.setPage).toHaveBeenLastCalledWith(3);
    fireEvent.click(button(/Previous/));
    expect(p.list.setPage).toHaveBeenLastCalledWith(1);
  });

  it('a page past the end (no rows, a total above 0) goes to the last page', () => {
    const p = props({ rows: [], total: 25, list: { page: 4 } });
    render(<AlertList {...p} />);
    expect(p.list.setPage).toHaveBeenCalledTimes(1);
    expect(p.list.setPage).toHaveBeenCalledWith(3);
  });

  it.each([
    ['page 1 with no results', props({ rows: [], total: 0, list: { page: 1 } })],
    ['page 3 with no results at all (a total of 0)', props({ rows: [], total: 0, list: { page: 3 } })],
    ['rows present on page 4', props({ rows: alAlertRows(5), total: 35, list: { page: 4 } })],
    ['an empty page 1 whose total is above 0', props({ rows: [], total: 25, list: { page: 1 } })],
    ['previous-key data still on screen (stale)', props({ alerts: slot(alertsFixture([], 25), { stale: true }), list: { page: 4 } })],
    ['a request still loading', props({ alerts: slot<AlertsData>(undefined), list: { page: 4 } })],
    ['an error', props({ alerts: slot<AlertsData>(undefined, ERR), list: { page: 4 } })],
  ])('does not clamp for %s', (_label, p) => {
    render(<AlertList {...p} />);
    expect(p.list.setPage).not.toHaveBeenCalled();
  });
});

describe('toolbar content', () => {
  it('has the search box with its placeholder, the Status select and the four toggles', () => {
    render(<AlertList {...props()} />);
    expect(screen.getByPlaceholderText('Search CVE, GHSA, package')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    for (const name of ['Overdue', 'Due ≤ 7d', 'Reopened', 'Runtime only']) expect(button(name)).toBeTruthy();
  });

  it('marks the active toggles as pressed', () => {
    render(<AlertList {...props({ list: { reopened: true, runtimeOnly: true } })} />);
    expect(button('Reopened').getAttribute('aria-pressed')).toBe('true');
    expect(button('Runtime only').getAttribute('aria-pressed')).toBe('true');
    expect(button('Overdue').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('light theme', () => {
  // Revert: put the card-shell class on the list, a row, the header or a control: the light remap's border would resize a fixed-height row.
  it.each([
    ['populated', props()],
    ['no rows', props({ rows: [], total: 0 })],
    ['error', props({ alerts: slot<AlertsData>(undefined, ERR) })],
  ])('%s: nothing inside the list uses the card-shell class (bg-gray-900)', (_label, p) => {
    const { container } = render(<AlertList {...p} />);
    expect(container.querySelector('.bg-gray-900')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-alert-list.test.tsx --maxWorkers=3`
Expected: FAIL. The Wave 2 stub renders only the empty 560px area, so the toolbar, headers, rows and pager are not found, and the geometry assertions that name the header and the pager fail too.

- [ ] **Step 3: Implement**

```tsx
// src/app/vulnerabilities/alert-list.tsx
'use client';
// GLOOK-64: the Alerts view's list column: search and Status, the four toggles, six sortable
// headers, a fixed 560px area of 56px rows, and the pager. The server sorts and pages (`limit=10`,
// `offset`, `sort`), so rows render in the order they arrive and this component never re-sorts them.
import { useEffect, useRef, useState } from 'react';
import type { AlertRow } from '@/lib/vulnerabilities/aggregate';
import type { SecurityViewProps } from './view-props';
import type { AlertSortKey, AlertStatus } from './security-state';
import { SLA_INVALID_LABEL, SLA_NONE_LABEL, anySlaActive, slaState, slaStateLabel, type SlaSource } from './sla-state';
import Pager, { PAGER_H } from './pager';
import { ALERT_LIST_H, ALERT_PAGE_SIZE, ALERT_ROW_H, TYPE } from './dimensions';

/** The search box applies its text this long after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 300;

// ── Fixed sizes of the list column. Together with the 560px row area they make the 776px card:
// padding + two toolbar rows + the header + the pager + three gaps = ALERT_COLUMN_CHROME_H.
export const ALERT_TOOLBAR_ROW_H = 32;
export const ALERT_TOOLBAR_GAP = 8;
export const ALERT_HEAD_H = 52;
export const ALERT_COLUMN_PAD = { top: 16, x: 20, bottom: 12 } as const;
export const ALERT_COLUMN_GAP = 12;
export const ALERT_COLUMN_CHROME_H =
  ALERT_COLUMN_PAD.top + 2 * ALERT_TOOLBAR_ROW_H + ALERT_TOOLBAR_GAP + ALERT_HEAD_H + PAGER_H + 3 * ALERT_COLUMN_GAP + ALERT_COLUMN_PAD.bottom;

/** The Due track keeps this much room, so "104d OVERDUE" is never clipped at 1024px. */
export const ALERT_DUE_MIN_W = 120;
export const ALERT_SEV_W = 56;
export const ALERT_AGE_W = 52;
/** One grid for the header and every row, so the columns line up. Every other track is minmax(0, …) so long text ends in "…". */
export const ALERT_GRID_COLS =
  `${ALERT_SEV_W}px minmax(0,2.2fr) minmax(0,1.8fr) ${ALERT_AGE_W}px minmax(${ALERT_DUE_MIN_W}px,1fr) minmax(0,1fr)`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Jul 21" for a YYYY-MM-DD date or an ISO instant, read in UTC. Anything unparseable is returned as it came. */
export function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Why Overdue and Due ≤ 7d are disabled when no severity has an active SLA, or null when one does.
 * Invalid wins over pending, which wins over none, so an unreadable policy never reads as "no policy".
 */
export function noSlaHint(sla: SlaSource): string | null {
  const states = [slaState('critical', sla), slaState('high', sla)];
  if (states.some(s => s.kind === 'active')) return null;
  if (states.some(s => s.kind === 'invalid')) return SLA_INVALID_LABEL;
  const starts: string[] = [];
  let pending = false;
  for (const s of states) {
    if (s.kind !== 'pending') continue;
    pending = true;
    if (s.startsOn) starts.push(s.startsOn);
  }
  if (pending) return `Due dates start ${starts.sort()[0] ?? 'later'}`;
  return SLA_NONE_LABEL;
}

const STATUS_OPTIONS: ReadonlyArray<[AlertStatus, string]> = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'Open + resolved']];

/** Header copy per sort key. A Record, so a key added to the wire contract without a header fails the type check. */
const HEAD_COPY: Record<AlertSortKey, { label: string; sub: string; right: boolean }> = {
  severity: { label: 'Sev', sub: '', right: false },
  advisory: { label: 'Advisory', sub: 'CVSS · package', right: false },
  repo: { label: 'Repository', sub: 'owning team', right: false },
  age: { label: 'Age', sub: '', right: true },
  due: { label: 'Due', sub: '', right: true },
  state: { label: 'State', sub: 'scope', right: false },
};
/** Left to right, matching ALERT_GRID_COLS. */
const HEAD_ORDER: readonly AlertSortKey[] = ['severity', 'advisory', 'repo', 'age', 'due', 'state'];

/** The sort glyphs. U+FE0E asks for the text form of ↕, which some fonts otherwise draw as a coloured emoji. */
export const SORT_ARROW = { none: '↕\uFE0E', asc: '↑', desc: '↓' } as const;

const SEV_BADGE = {
  critical: { label: 'CRIT', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-400' },
} as const;

function AlertRowView({ r, sla }: { r: AlertRow; sla: SlaSource }) {
  const idText = r.cveId ?? r.ghsaId ?? '';
  const cvss = r.cvss !== null ? `CVSS ${Number(r.cvss).toFixed(1)}` : null;
  // A null package renders nothing (never the text "null"), in the cell or its title.
  const pkg = `${r.packageName ?? ''}${r.packageName && r.ecosystem ? ` (${r.ecosystem})` : ''}`;
  const advSub = [cvss, pkg || null].filter(Boolean).join(' · ');
  const repoShort = r.repo.split('/').pop() ?? r.repo;

  // Due: the date and "Nd OVERDUE" / "in Nd" while this severity's SLA is active; otherwise a dash
  // with the SLA state's own message (or, for a resolved alert, whether it was fixed in time).
  const st = slaState(r.severity, sla);
  let due = '—';
  let dueSub = '';
  let overdue = false;
  if (r.state === 'open') {
    if (st.kind === 'active') {
      if (r.dueDate) {
        due = shortDate(r.dueDate);
        if (r.daysRemaining !== null) {
          overdue = r.daysRemaining < 0;
          dueSub = overdue ? `${-r.daysRemaining}d OVERDUE` : r.daysRemaining === 0 ? 'today' : `in ${r.daysRemaining}d`;
        }
      }
    } else {
      dueSub = slaStateLabel(st) ?? '';
    }
  } else if (r.resolvedOnTime !== null) {
    dueSub = r.resolvedOnTime ? 'resolved on time' : `resolved ${r.resolvedDaysLate}d late`;
  }

  const stateExtra = [
    ...(r.state !== 'open' ? [r.dismissedReason, r.resolvedAt ? shortDate(r.resolvedAt) : null] : []),
    r.reopenedCount > 0 ? `↺ reopened${r.lastReopenedAt ? ` ${shortDate(r.lastReopenedAt)}` : ''}` : null,
  ].filter((x): x is string => !!x);
  const stateFull = [r.state, ...stateExtra].join(' · ');

  const cell = 'flex min-w-0 flex-col justify-center gap-0.5 px-2.5';
  const sub = 'truncate text-xs text-gray-400';
  return (
    <div
      data-testid="alert-row"
      className="grid box-border border-b border-gray-800/60 text-sm text-gray-200"
      style={{ gridTemplateColumns: ALERT_GRID_COLS, height: ALERT_ROW_H }}
    >
      <div className="flex items-center">
        <span className={`w-[38px] py-0.5 text-center text-[10px] font-bold tracking-[0.05em] ${TYPE.badge} ${SEV_BADGE[r.severity].cls}`}>{SEV_BADGE[r.severity].label}</span>
      </div>
      <div className={cell}>
        <a href={r.htmlUrl} target="_blank" rel="noreferrer" title={idText} className="truncate text-accent-light underline underline-offset-2 hover:text-accent-lighter">{idText}</a>
        <span className={sub} title={advSub || undefined}>{advSub || '\u00a0'}</span>
      </div>
      <div className={cell}>
        <span className="truncate" title={r.repo}>{repoShort}</span>
        <span className={sub} title={r.team}>{r.team}</span>
      </div>
      <div className="flex items-center justify-end px-2.5 text-gray-300 tabular-nums">{r.ageDays}d</div>
      <div className={`${cell} items-end`}>
        <span data-testid="alert-due" className={`whitespace-nowrap tabular-nums ${overdue ? 'text-red-400' : 'text-gray-300'}`}>{due}</span>
        {overdue ? (
          // Never clipped: no overflow, no ellipsis, and the track has a pixel minimum (ALERT_DUE_MIN_W).
          <span data-testid="alert-due-sub" className="shrink-0 whitespace-nowrap text-xs font-bold text-red-400">{dueSub}</span>
        ) : (
          <span data-testid="alert-due-sub" className={`${sub} max-w-full`} title={dueSub || undefined}>{dueSub || '\u00a0'}</span>
        )}
      </div>
      <div className={cell}>
        <span data-testid="alert-state" className="truncate" title={stateFull}>
          {r.state}
          {stateExtra.length > 0 && <span className="text-gray-500"> · {stateExtra.join(' · ')}</span>}
        </span>
        <span className={sub}>{r.scope ?? 'unknown'}</span>
      </div>
    </div>
  );
}

/** One of the four toggles. A disabled toggle never reads as on, whatever the state says. */
function Toggle({ label, on, disabled, title, onClick }: { label: string; on: boolean; disabled: boolean; title?: string; onClick: () => void }) {
  const pressed = on && !disabled;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-[7px] whitespace-nowrap border px-2.5 text-[13px] ${TYPE.control} ${pressed ? 'border-accent bg-accent-bg text-accent-light' : 'border-gray-700 text-gray-300'} ${disabled ? 'cursor-default opacity-[0.45]' : ''}`}
      style={{ height: ALERT_TOOLBAR_ROW_H }}
    >
      <span aria-hidden="true" className={`flex h-3 w-3 items-center justify-center rounded-[3px] border-[1.5px] text-[9px] font-bold leading-none ${pressed ? 'border-accent bg-accent text-gray-900' : 'border-gray-500'}`}>{pressed ? '✓' : ''}</span>
      {label}
    </button>
  );
}

export default function AlertList({ summary, data, url, list: ctl }: SecurityViewProps) {
  const l = ctl.list;
  const alerts = data.alerts;
  const timeEnabled = anySlaActive(summary) && l.status !== 'resolved';
  const slaHint = noSlaHint(summary);

  // ── Search: typed text is local, applied SEARCH_DEBOUNCE_MS after the last keystroke, and applied
  // at once (never dropped) when the user clicks any other control or leaves the view.
  const [typed, setTyped] = useState(l.q);
  const typedRef = useRef(typed);
  const sentRef = useRef(l.q);             // the last value handed to setQuery (or the one the list started with)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  const flush = useRef(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (typedRef.current !== sentRef.current) {
      sentRef.current = typedRef.current;
      ctlRef.current.setQuery(typedRef.current);
    }
  }).current;
  const onType = (v: string) => {
    typedRef.current = v;
    setTyped(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => flush(), [flush]);   // a view switch unmounts the list: apply what is typed
  const then = (fn: () => void) => () => { flush(); fn(); };

  // ── Page clamp: a page past the end (a sync shrank the result, or a hand-edited state) goes to the last page.
  const rowsLen = alerts.data?.rows.length ?? 0;
  const total = alerts.data?.totalCount ?? 0;
  useEffect(() => {
    if (!alerts.data || alerts.stale || alerts.loading) return;
    if (rowsLen === 0 && total > 0 && l.page > 1) ctlRef.current.setPage(Math.ceil(total / ALERT_PAGE_SIZE));
  }, [alerts.data, alerts.stale, alerts.loading, rowsLen, total, l.page]);

  // ── What the 560px area shows. Not-found is checked first: its alerts slot is the empty slot.
  const notFound = data.repoStatus === 'not-found';
  const errorText = notFound ? null : alerts.errorText;
  const loading = !notFound && !errorText && alerts.loading;
  const rows = !notFound && !errorText && alerts.data ? alerts.data.rows : null;
  const stale = !notFound && !errorText && alerts.stale;
  const pagerTotal = rows ? total : null;

  const timeTitle = l.status === 'resolved' ? 'Resolved alerts have no due date' : (slaHint ?? undefined);

  return (
    <section
      aria-label="Alerts"
      data-testid="alert-list"
      className="flex min-w-0 flex-col"
      style={{
        paddingTop: ALERT_COLUMN_PAD.top, paddingBottom: ALERT_COLUMN_PAD.bottom,
        paddingLeft: ALERT_COLUMN_PAD.x, paddingRight: ALERT_COLUMN_PAD.x, gap: ALERT_COLUMN_GAP,
      }}
    >
      <div className="flex flex-none flex-col" style={{ gap: ALERT_TOOLBAR_GAP }}>
        <div className="flex items-center gap-2" style={{ height: ALERT_TOOLBAR_ROW_H }}>
          <input
            aria-label="Search alerts"
            placeholder="Search CVE, GHSA, package"
            value={typed}
            onChange={e => onType(e.target.value)}
            className={`min-w-[160px] flex-1 border border-gray-700 bg-chart-surface px-2.5 text-[13px] text-gray-200 ${TYPE.control}`}
            style={{ height: ALERT_TOOLBAR_ROW_H }}
          />
          <select
            aria-label="Status"
            value={l.status}
            onChange={e => { flush(); ctl.setStatus(e.target.value as AlertStatus); }}
            className={`w-[132px] shrink-0 border border-gray-700 bg-chart-surface px-2 text-[13px] text-gray-200 ${TYPE.control}`}
            style={{ height: ALERT_TOOLBAR_ROW_H }}
          >
            {STATUS_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 overflow-hidden" style={{ height: ALERT_TOOLBAR_ROW_H }}>
          <Toggle label="Overdue" on={l.overdue} disabled={!timeEnabled} title={timeTitle} onClick={then(ctl.toggleOverdue)} />
          <Toggle label="Due ≤ 7d" on={l.dueSoon} disabled={!timeEnabled} title={timeTitle} onClick={then(ctl.toggleDueSoon)} />
          <Toggle label="Reopened" on={l.reopened} disabled={false} onClick={then(ctl.toggleReopened)} />
          <Toggle label="Runtime only" on={l.runtimeOnly} disabled={false} onClick={then(ctl.toggleRuntimeOnly)} />
          {slaHint && <span data-testid="alert-sla-hint" title={slaHint} className="min-w-0 flex-1 truncate text-xs text-gray-500">{slaHint}</span>}
          <span className="flex-1" />
          {stale && <span data-testid="alert-updating" className="shrink-0 text-[11px] text-accent-light">Updating…</span>}
        </div>
      </div>

      <div
        role="row"
        data-testid="alert-list-head"
        className="grid flex-none box-border border-b border-gray-700"
        style={{ gridTemplateColumns: ALERT_GRID_COLS, height: ALERT_HEAD_H }}
      >
        {HEAD_ORDER.map(key => {
          const h = { key, ...HEAD_COPY[key] };
          const active = l.sort?.key === h.key ? l.sort : null;
          return (
            <div
              key={h.key}
              role="columnheader"
              aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className="min-w-0"
            >
              <button
                type="button"
                data-testid={`sort-${h.key}`}
                onClick={then(() => ctl.setSort(h.key))}
                className={`flex h-full w-full min-w-0 flex-col justify-end gap-px overflow-hidden whitespace-nowrap pb-2 pt-2 ${h.key === 'severity' || h.key === 'age' ? 'pl-0 pr-2.5' : 'px-2.5'} ${h.right ? 'items-end' : 'items-start'} ${TYPE.tableHeader} ${active ? 'text-white' : 'text-gray-400'}`}
              >
                <span className="flex max-w-full items-baseline gap-1">
                  <span className="truncate">{h.label}</span>
                  <span data-testid={`sort-arrow-${h.key}`} aria-hidden="true" className={`shrink-0 tracking-normal ${active ? 'text-accent-light' : 'text-gray-500'}`}>
                    {active ? (active.dir === 'asc' ? SORT_ARROW.asc : SORT_ARROW.desc) : SORT_ARROW.none}
                  </span>
                </span>
                <span className="max-w-full truncate text-xs font-medium normal-case tracking-normal text-gray-500">{h.sub || '\u00a0'}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div
        data-testid="alert-list-rows"
        className={`relative flex-none overflow-hidden ${stale ? 'opacity-60' : ''}`}
        style={{ height: ALERT_LIST_H }}
        aria-busy={stale || loading ? true : undefined}
      >
        {rows?.map((r, i) => <AlertRowView key={i} r={r} sla={summary} />)}
        {rows && rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No alerts match these filters.</div>
        )}
        {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading…</div>}
        {errorText && <div role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-400">{errorText}</div>}
        {notFound && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-sm text-gray-300">
            <span>Repository not found ·</span>
            <button type="button" onClick={() => url.clearRepo()} className="text-accent-light underline underline-offset-2 hover:text-accent-lighter">
              Show all repositories
            </button>
          </div>
        )}
      </div>

      <Pager page={l.page} pageSize={ALERT_PAGE_SIZE} totalCount={pagerTotal} onPage={p => ctl.setPage(p)} />
    </section>
  );
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-alert-list.test.tsx src/lib/__tests__/unit/vuln-pager.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx --maxWorkers=3`
Expected: PASS.

Then `npx tsc --noEmit`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/alert-list.tsx src/lib/__tests__/unit/vuln-alert-list.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Alerts view alert list"
```

### Task 4.6: Retire `alerts-table.tsx` and its tests

**Files:**
- Delete: `src/app/vulnerabilities/alerts-table.tsx`
- Delete: `src/lib/__tests__/unit/vuln-alerts-table.test.tsx`
- Delete: `src/lib/__tests__/unit/vuln-owning-team-label.test.tsx` (after Wave 3 it holds only the `AlertsTable` test)

**Interfaces:**
- Consumes: Tasks 4.2 and 4.5 (the replacement) and the Wave 4 test rewrite map below, which says where each of the 54 tests in the deleted file now lives.
- Produces: nothing new. After this task no file imports `alerts-table`.

This task has no failing-test step. It deletes code and tests, so its check is that nothing still imports the module, that the type check and the suites that remain are green, and that the rewrite map has no gap. Do it after Tasks 4.1-4.5, never before: until then the deleted test is the only cover for these intents.

`vuln-owning-team-label.test.tsx` held two tests. Wave 3's Task 3.13 already removed the `TeamPivot` one (its intent lives in `vuln-team-table.test.tsx`), so the file now holds only the `AlertsTable` test, which guards the dropdown this task retires. Leaving the file with no test would make Jest fail the suite with "Your test suite must contain at least one test", so this task deletes the file. The dropdown's intent (an "Owning team" label and an "All owning teams" option) lives in `vuln-filter-bar.test.tsx`.

- [ ] **Step 1: Delete the label test**

```bash
git rm src/lib/__tests__/unit/vuln-owning-team-label.test.tsx
```

- [ ] **Step 2: Delete the old test and confirm nothing else uses the module**

```bash
git rm src/lib/__tests__/unit/vuln-alerts-table.test.tsx
grep -rn "alerts-table\|AlertsTable\|alertFilterQuery\|AlertsPanel" src
```

Expected: lines from `src/app/vulnerabilities/alerts-table.tsx` itself, one comment in `src/app/vulnerabilities/format.ts` (it mentions `AlertsPanel`; leave it) and the header comment of `src/lib/__tests__/unit/vuln-alert-list.test.tsx`. No import of the module anywhere else.

- [ ] **Step 3: Delete the module**

```bash
git rm src/app/vulnerabilities/alerts-table.tsx
grep -rn "alerts-table\|AlertsTable\|alertFilterQuery\|AlertsPanel" src
```

Expected: exactly two lines, both comments: one in `src/app/vulnerabilities/format.ts` and one in `src/lib/__tests__/unit/vuln-alert-list.test.tsx`. No `import`, no JSX.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx tsc --noEmit` then `npx jest src/lib/__tests__/unit/vuln-alert-list.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-format.test.ts --maxWorkers=3`
Expected: no type errors; PASS (`vuln-format.test.ts` is unchanged: `fetcher`, `panelError` and the other helpers stay in `format.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A -- src/lib/__tests__/unit/vuln-owning-team-label.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: retire alerts-table.tsx and its test"
```

### Task 4.7: Alerts view composed with the real hooks

**Files:**
- Test: `src/lib/__tests__/unit/vuln-alerts-view.test.tsx` (create)

**Interfaces:**
- Consumes: `VulnerabilitiesContent` (the Wave 2 composer, default export of `src/app/vulnerabilities/vulnerabilities-content.tsx`); `SEARCH_DEBOUNCE_MS` (Task 4.5); `createNavigationMock` through `jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock())` (Task 2.5); `SwrFresh`, `fetchRouter`, `callsTo`, `reposFixture`, `REPO_ROWS`, `summaryFixture` and the Task 4.1 fixtures (`AL_RAIL_ROWS`, `alAlertRows`, `alAlertsRoute`, `alSummary`).
- Produces: nothing. This task only adds tests.

The component tests use mocked handlers. This file wires the strip, rail and list to the real URL hook, the real alert-list controller and the real data hook, against a routed fetch mock. It is where URL history (push vs replace), request parameters, the stale-repository logic and the search flush meet.

Its checks, by describe: one source for every count (strip, rail "All" row and Alerts tab count agree; a team scopes all three); selecting a repository from the rail (one replace with `scroll: false`, view and team untouched; narrows the strip and the request; an unmeasured row opens the drawer without touching the URL); paging, sorting and list parameters (`limit=10&offset=0`, no `sort` and no `severity=both` by default; Next and Previous; the remainder page; `sort=age:desc` then `age:asc`, a new key starting ascending, and the page returning to 1; every list control and a scope change returning to page 1; a result that shrinks below the current page lands on the last page); search text and a view switch; a repository that cannot be shown (missing from the rows, or rejected by the API: one inline state, no page error, no repeated request); a plain alerts failure inside the card; the SLA states reaching the strip, the rail footer, the Due column and the toggles from one summary; the unmeasured badge opening the drawer and Esc returning focus.

- [ ] **Step 1: Write the test**

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-view.test.tsx
// The Alerts view composed with the real hooks: strip, rail and list against a routed fetch mock and
// the reactive navigation mock. This is where URL history, request parameters and the data hook's
// stale-repository logic meet the three components.
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';
import { SEARCH_DEBOUNCE_MS } from '@/app/vulnerabilities/alert-list';
import {
  SwrFresh, fetchRouter, callsTo, reposFixture, REPO_ROWS, AL_RAIL_ROWS, alAlertRows, alAlertsRoute, alSummary, summaryFixture,
} from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
const nav = () => jest.requireMock('next/navigation') as any;
const params = (url: string) => new URL(url, 'http://x').searchParams;

function mount(search: string, routes: Parameters<typeof fetchRouter>[0] = {}) {
  nav().__resetSearch(search);
  const fetchMock = fetchRouter(routes);
  (global as any).fetch = fetchMock;
  render(<SwrFresh><VulnerabilitiesContent /></SwrFresh>);
  return fetchMock;
}
const lastAlerts = (f: jest.Mock) => callsTo(f, 'alerts').slice(-1)[0];
const railRow = (name: string) => screen.getAllByTestId('rail-row').find(el => el.getAttribute('data-repo') === name)!;
const cves = () => screen.getAllByTestId('alert-row').map(r => within(r).getByRole('link').textContent);

describe('one source for every count', () => {
  it('the strip, the rail\'s All row and the Alerts tab count all read the repos rows', async () => {
    mount('view=alerts');
    // REPO_ROWS: critical 3+2+1+4 = 10, high 1+0+2+0 = 3 (the unmeasured row's stored 4 is included).
    expect((await screen.findByTestId('strip-critical-open')).textContent).toBe('10');
    expect(screen.getByTestId('strip-high-open').textContent).toBe('3');
    expect(screen.getByTestId('rail-all').textContent).toContain('10 crit · 3 high open');
    await waitFor(() => expect(screen.getByTestId('alerts-tab-count').textContent).toBe('13'));
  });

  it('a team in the URL scopes all three through the repos request', async () => {
    const f = mount('view=alerts&team=Payments', {
      repos: url => ({ body: reposFixture(REPO_ROWS.filter(r => r.team === (url.searchParams.get('team') ?? r.team)), { codebase: 'backend', team: 'Payments' }) }),
    });
    expect((await screen.findByTestId('strip-critical-open')).textContent).toBe('5');
    expect(screen.getByTestId('strip-title').textContent).toBe('Payments · all repositories');
    expect(screen.getByTestId('rail-all').textContent).toContain('All Payments repositories');
    expect(callsTo(f, 'repos')[0].searchParams.get('team')).toBe('Payments');
  });
});

describe('selecting a repository from the rail', () => {
  it('writes only repo, as a replace with scroll:false: no history entry, view and team untouched', async () => {
    mount('view=alerts', { repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }) });
    fireEvent.click(await waitFor(() => railRow('acme/audit-log')));
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    const call = nav().__calls[0];
    expect(call.kind).toBe('replace');
    expect(call.opts).toEqual({ scroll: false });
    const p = params(call.url);
    expect(p.get('repo')).toBe('acme/audit-log');
    expect(p.get('view')).toBe('alerts');
    expect(p.has('team')).toBe(false);
  });

  it('narrows the strip and the alerts request to that repository and tints the row; clicking it again clears it', async () => {
    const f = mount('view=alerts', { repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }) });
    fireEvent.click(await waitFor(() => railRow('acme/audit-log')));
    await waitFor(() => expect(screen.getByTestId('strip-title').textContent).toBe('acme/audit-log'));
    expect(screen.getByTestId('strip-critical-open').textContent).toBe('2');
    expect(railRow('acme/audit-log').className).toContain('bg-accent/10');
    await waitFor(() => expect(lastAlerts(f).searchParams.get('repo')).toBe('acme/audit-log'));
    fireEvent.click(railRow('acme/audit-log'));
    await waitFor(() => expect(screen.getByTestId('strip-title').textContent).toBe('All repositories'));
    await waitFor(() => expect(lastAlerts(f).searchParams.has('repo')).toBe(false));
  });

  it('an unmeasured rail row opens the drawer and does not touch the URL', async () => {
    mount('view=alerts');
    const row = await screen.findByTestId('rail-unmeasured');
    fireEvent.click(row);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(nav().__calls.length).toBe(0);
  });
});

describe('paging, sorting and the list parameters', () => {
  const all = alAlertRows(26);

  it('asks for ten at a time, from offset 0, and shows "1–10 of 26"', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    const q = callsTo(f, 'alerts')[0].searchParams;
    expect([q.get('limit'), q.get('offset'), q.get('state')]).toEqual(['10', '0', 'open']);
    expect(q.has('sort')).toBe(false);          // no active header: the server's default order
    expect(q.has('severity')).toBe(false);      // never severity=both
    expect(cves()).toHaveLength(10);
    expect(screen.getByTestId('alert-pager').textContent).toContain('1–10 of 26 alerts');
  });

  it('Next asks for offset 10 and shows the next ten; Previous returns', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('offset')).toBe('10'));
    await waitFor(() => expect(cves()[0]).toBe('CVE-2026-1011'));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(cves()[0]).toBe('CVE-2026-1001'));
  });

  it('the last page shows the remainder, and the list area keeps its 560px', async () => {
    mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(cves()[0]).toBe('CVE-2026-1011'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(cves()).toHaveLength(6));
    expect(screen.getByTestId('alert-pager').textContent).toContain('21–26 of 26 alerts');
    expect(screen.getByTestId('alert-list-rows').style.height).toBe('560px');
  });

  it('a header click sends sort=<key>:<dir> with its first direction and returns to offset 0', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all) });
    await screen.findAllByTestId('alert-row');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('offset')).toBe('10'));
    fireEvent.click(screen.getByTestId('sort-age'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('sort')).toBe('age:desc'));
    expect(lastAlerts(f).searchParams.get('offset')).toBe('0');
    fireEvent.click(screen.getByTestId('sort-age'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('sort')).toBe('age:asc'));
    fireEvent.click(screen.getByTestId('sort-repo'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('sort')).toBe('repo:asc'));
  });

  it('every list control and a scope change returns to page 1', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(all), repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }) });
    await screen.findAllByTestId('alert-row');
    const toPage2 = async () => {
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      await waitFor(() => expect(lastAlerts(f).searchParams.get('offset')).toBe('10'));
    };
    await toPage2();
    fireEvent.click(screen.getByRole('button', { name: 'Reopened' }));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('reopened')).toBe('true'));
    expect(lastAlerts(f).searchParams.get('offset')).toBe('0');
    await toPage2();
    fireEvent.click(railRow('acme/audit-log'));
    await waitFor(() => expect(lastAlerts(f).searchParams.get('repo')).toBe('acme/audit-log'));
    expect(lastAlerts(f).searchParams.get('offset')).toBe('0');
  });

  it('a page past the end after the result shrank lands on the last page', async () => {
    let total = 25;
    const f = mount('view=alerts', { alerts: url => alAlertsRoute(all.slice(0, total))(url) });
    await screen.findAllByTestId('alert-row');
    total = 15;      // a sync lands: two pages now, but the page still thinks there are three
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));      // page 3, offset 20: no rows, a total of 15
    await waitFor(() => expect(callsTo(f, 'alerts').some(u => u.searchParams.get('offset') === '20')).toBe(true));
    // Offset 20 was asked for and came back empty; the clamp then shows page 2 (its rows are already cached).
    await waitFor(() => expect(cves()).toHaveLength(5));
    expect(cves()[0]).toBe('CVE-2026-1011');
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  });
});

describe('search text and a view switch', () => {
  it('text typed inside the debounce window is applied when the user switches view, and is there when they come back', async () => {
    const f = mount('view=alerts', { alerts: alAlertsRoute(alAlertRows(3)) });
    const input = await screen.findByLabelText('Search alerts');
    fireEvent.change(input, { target: { value: 'lodash' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));     // well inside SEARCH_DEBOUNCE_MS
    // Applied by the unmount, not by the 300ms timer: the request is out before any timer could run.
    expect(callsTo(f, 'alerts').some(u => u.searchParams.get('q') === 'lodash')).toBe(true);
    fireEvent.click(await screen.findByRole('tab', { name: /^Alerts/ }));
    expect((await screen.findByLabelText('Search alerts') as HTMLInputElement).value).toBe('lodash');
    // The debounce timer of the unmounted list does not send it again.
    await act(async () => { await new Promise(r => setTimeout(r, SEARCH_DEBOUNCE_MS + 100)); });
    expect(callsTo(f, 'alerts').filter(u => u.searchParams.get('q') === 'lodash').length).toBe(1);
  });
});

describe('a repository that cannot be shown', () => {
  it('a repository missing from the repos rows shows the inline state, does not send that repo again, and "Show all repositories" clears it', async () => {
    const f = mount('view=alerts&repo=acme%2Fmissing', { alerts: alAlertsRoute(alAlertRows(4)) });
    expect(await screen.findByText(/Repository not found/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    // The data hook may send the repo once while the repos rows are still loading; once they say it is absent, never again.
    const sent = () => callsTo(f, 'alerts').filter(u => u.searchParams.get('repo') === 'acme/missing').length;
    const sentWhenShown = sent();
    expect(sentWhenShown).toBeLessThanOrEqual(1);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(sent()).toBe(sentWhenShown);
    // The scope falls back to everything: the All row is the selected one, and the strip is unscoped.
    expect(screen.getByTestId('rail-all').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('strip-title').textContent).toBe('All repositories');
    fireEvent.click(screen.getByRole('button', { name: 'Show all repositories' }));
    await waitFor(() => expect(nav().__calls.length).toBe(1));
    expect(nav().__calls[0].kind).toBe('replace');
    expect(params(nav().__calls[0].url).has('repo')).toBe(false);
    await waitFor(() => expect(cves()).toHaveLength(4));
    expect(screen.queryByText(/Repository not found/)).toBeNull();
  });

  it('a repository the alerts API rejects shows the same inline state, is asked for once, and raises no page error', async () => {
    const f = mount('view=alerts&repo=acme%2Fledger', {
      alerts: url => (url.searchParams.get('repo') ? { status: 400, body: { error: 'unknown repo' } } : alAlertsRoute(alAlertRows(2))(url)),
    });
    expect(await screen.findByText(/Repository not found/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(screen.getByTestId('alerts-strip')).toBeTruthy();
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(callsTo(f, 'alerts').filter(u => u.searchParams.get('repo') === 'acme/ledger')).toHaveLength(1);
  });

  it('a plain alerts failure shows its error inside the card while the strip, the rail and the controls stay up', async () => {
    mount('view=alerts', { alerts: { status: 500, body: { error: 'Internal Server Error' } } });
    expect(await within(await screen.findByTestId('alert-list-rows')).findByText(/Couldn't load alerts: Internal Server Error/)).toBeTruthy();
    expect(screen.getByTestId('strip-critical-open').textContent).toBe('10');
    expect(screen.getAllByTestId('rail-row').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Search alerts')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('SLA states reach every Alerts-view consumer from one summary', () => {
  it('critical active, high pending: the strip, the rail footer and the Due column all say so', async () => {
    mount('view=alerts', {
      summary: url => ({ body: alSummary({ critical: 'active', high: 'pending' }, { appliedFilters: { codebase: 'backend', baseline: url.searchParams.get('baseline') ?? 'last' } }) }),
      repos: url => ({ body: reposFixture(AL_RAIL_ROWS, { codebase: (url.searchParams.get('codebase') ?? 'backend') as 'backend' }) }),
      alerts: alAlertsRoute([
        ...alAlertRows(1, { severity: 'critical', dueDate: '2026-09-10', daysRemaining: -5 }),
        ...alAlertRows(1, { severity: 'high', dueDate: null, daysRemaining: null }).map(r => ({ ...r, cveId: 'CVE-2026-9999' })),
      ]),
    });
    await screen.findAllByTestId('alert-row');
    expect(screen.getByTestId('strip-critical-tail').textContent).toContain('overdue');
    expect(screen.getByTestId('strip-high-tail').textContent).toContain('Starts 2026-11-01');
    expect(screen.getByTestId('rail-sla-note').textContent).toBe('Overdue counts critical only · high: Starts 2026-11-01');
    expect(screen.getAllByTestId('alert-due-sub').map(e => e.textContent)).toEqual(['5d OVERDUE', 'Starts 2026-11-01']);
    expect((screen.getByRole('button', { name: 'Overdue' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('no SLA active: the time toggles are disabled with the hint and the strip says why', async () => {
    mount('view=alerts', {
      summary: url => ({ body: summaryFixture({ slaStatus: { critical: 'none', high: 'none' }, policy: [], appliedFilters: { codebase: 'backend', baseline: url.searchParams.get('baseline') ?? 'last' } }) }),
    });
    expect((await screen.findByTestId('alert-sla-hint')).textContent).toBe('No SLA policy yet');
    expect((screen.getByRole('button', { name: 'Overdue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('strip-critical-tail').textContent).toContain('No SLA policy yet');
  });
});

describe('the unmeasured badge', () => {
  it('opens the drawer from the strip and returns focus to the badge on Esc', async () => {
    mount('view=alerts');
    const badge = await screen.findByTestId('strip-unmeasured');
    fireEvent.click(badge);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(badge);
  });
});
```

- [ ] **Step 2: Run it and confirm it passes, then prove it can fail**

Run: `npx jest src/lib/__tests__/unit/vuln-alerts-view.test.tsx --maxWorkers=3`
Expected: PASS (18 tests). These tests pin behaviour that Tasks 4.2-4.5 already built, so a plain run cannot fail first. Prove the file bites with these one-line reverts, one at a time, restoring each before the next. Each must fail the named test:

| Revert | Test that fails |
|---|---|
| In `alert-list.tsx`, pass `onPage={p => ctl.setPage(p + 1)}` to `Pager` | `paging, sorting and the list parameters › Next asks for offset 10 and shows the next ten; Previous returns` (and three more in that describe) |
| In `alert-list.tsx`, delete the line `ctlRef.current.setPage(Math.ceil(total / ALERT_PAGE_SIZE));` | `paging, sorting and the list parameters › a page past the end after the result shrank lands on the last page` |
| In `alert-list.tsx`, change `useEffect(() => () => flush(), [flush]);` to `useEffect(() => () => undefined, [flush]);` | `search text and a view switch › text typed inside the debounce window is applied when the user switches view, and is there when they come back` |
| In `repo-rail.tsx`, change the row's `onClick` to call `url.selectRepoRow({ fullName: row.fullName, team: row.team })` | `selecting a repository from the rail › writes only repo, as a replace with scroll:false: no history entry, view and team untouched` |
| In `alert-list.tsx`, change `const notFound = data.repoStatus === 'not-found';` to `const notFound = false;` | `a repository that cannot be shown › a repository missing from the repos rows shows the inline state, does not send that repo again, and "Show all repositories" clears it` |

- [ ] **Step 3: Implement**

No implementation. The behaviour exists from Tasks 4.2-4.5.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-alerts-view.test.tsx src/lib/__tests__/unit/vuln-security-page.test.tsx --maxWorkers=3`
Expected: PASS, with every revert from Step 2 undone.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/unit/vuln-alerts-view.test.tsx
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: Alerts view composed-page tests"
```

### Wave 4 test rewrite map

Task 4.6 deletes `vuln-alerts-table.test.tsx` (54 tests) and `vuln-owning-team-label.test.tsx` (one test: Wave 3 already moved the other). Every old test below has a fate. The old assertions stay readable with `git show main:src/lib/__tests__/unit/vuln-alerts-table.test.tsx`. New tests are in `vuln-alert-list.test.tsx` unless a file is named. "Retired" means the feature the test guarded no longer exists, with the reason.

**Rows that Wave 2's map assigned to Wave 4.**

| Wave 2 map row | Intent | New test |
|---|---|---|
| `vuln-content-b1` | The list dims and shows "Updating…" while `data.alerts.stale` is true, and neither otherwise | `stale, loading and error › stale: the row area dims and "Updating…" shows; the controls are not dimmed`; `› not stale: no dimming and no "Updating…"` |
| `vuln-content-error` | A failing alerts request shows its error inside the card with the controls still mounted | `stale, loading and error › an error replaces the rows with its text inside the list area and keeps every control mounted`; `vuln-alerts-view › a repository that cannot be shown › a plain alerts failure shows its error inside the card while the strip, the rail and the controls stay up` |
| `vuln-content-error` | The search box and its typed value survive a filter change while the next fetch is pending | `search › the search box keeps its node, its focus and its typed text while the next page loads, goes stale or fails` |
| `vuln-alerts-keep-previous-data` | The search input stays mounted and focused across a refetch (not unmounted while `stale` or `loading`) | the same test: `search › the search box keeps its node, its focus and its typed text while the next page loads, goes stale or fails` |
| `vuln-owning-team-label` (AlertsTable half) | The list's team dropdown said "Owning team" | Retired: the list has no team dropdown. The sticky bar's select is covered by `vuln-filter-bar › Codebase, Owning team and Severity`. Task 4.6 deletes the file. |
| `vuln-alerts-table` › `time chips disabled with a hint while no SLA is active` | Disabled-with-hint, from the SLA state | `Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active` (pending, pending beats none, none, invalid, four enabled combinations, disabled toggle ignores clicks, Resolved) |
| `vuln-alerts-table` › mutual exclusion | Overdue and Due ≤ 7d exclude each other | `toggles and Status with the real list controller › Overdue and Due ≤ 7d are mutually exclusive: turning one on turns the other off` |
| Hand-off checklist: typed text | Applied on view switch and on a chip click inside the 300ms window; flushed on unmount | `search › a toggle clicked inside the debounce window applies the typed text first, once, and the timer then does nothing`; `search › %s clicked inside the window applies the typed text too` (Status select, sort header, Overdue); `search › a view switch (the list unmounts) inside the window applies the typed text instead of dropping it`; `vuln-alerts-view › search text and a view switch › text typed inside the debounce window is applied when the user switches view, and is there when they come back` |
| Hand-off checklist: SLA consumers | A test per SLA state (active, pending, none, invalid) for every Wave 4 consumer | strip: `vuln-alerts-strip › the SLA tail, per state, for each severity (strip consumer of sla-state)`; rail: `vuln-repo-rail › the OVERDUE figure › critical %s, high %s: checkout-api reads %s` (six combinations) and `footer › critical %s, high %s: "%s"` (eight combinations); Due column: `Due column, per SLA state (alert-list consumer of sla-state)`; toggles: `Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active`; all four on one summary: `vuln-alerts-view › SLA states reach every Alerts-view consumer from one summary` |

**Every test in `vuln-alerts-table.test.tsx`.**

| Old test | Fate | New test or reason |
|---|---|---|
| renders an overdue alert red with a negative countdown | Rewritten | `Due column, per SLA state › active: the date over "in Nd", "today" or "Nd OVERDUE"`; `fixed geometry › "Nd OVERDUE" is bold red, never clipped: no ellipsis, no overflow clip, no shrinking, in a cell that does not clip either` |
| filter chips report immediately; search debounces ~300ms | Rewritten | `search › applies the typed text once, SEARCH_DEBOUNCE_MS after the last keystroke`; `Overdue and Due ≤ 7d toggles › active toggles call their handlers` |
| Repo and Owning team columns sort independently | Rewritten as server sort | `sort headers` (six headers, first directions, ↕ ↑ ↓); the order itself is the server's: `vuln-aggregate › listAlerts sort`. A team column no longer exists (the owning team is the second line of Repository). |
| `alertFilterQuery` maps UI filters to the API parameters; includes repo when set | Replaced | `vuln-security-state › alertsQueryString` (Wave 2 Task 2.4); the repo parameter: `vuln-alerts-view › selecting a repository from the rail › narrows the strip and the alerts request to that repository and tints the row; clicking it again clears it` |
| choosing Resolved disables the time-based chips and clears overdue/dueSoon | Rewritten | `toggles and Status with the real list controller › choosing Resolved disables the time toggles and clears whatever they were set to` |
| Overdue and Due ≤ 7d are mutually exclusive | Rewritten | `toggles and Status with the real list controller › Overdue and Due ≤ 7d are mutually exclusive: turning one on turns the other off` |
| flushes a pending debounced search on unmount | Rewritten | `search › a view switch (the list unmounts) inside the window applies the typed text instead of dropping it` |
| unmounting after the debounce already fired does not call onFiltersChange a second time | Rewritten | `search › unmounting after the debounce already fired does not send the same text a second time` |
| unmounting with nothing typed does not call onFiltersChange | Rewritten | `search › unmounting with nothing typed, or with the text typed back to what it was, sends nothing` |
| a stale table dims only the table container, not the search input or the chips | Rewritten | `stale, loading and error › stale: the row area dims and "Updating…" shows; the controls are not dimmed` |
| opacity-60 is absent when the table is not stale | Rewritten | `stale, loading and error › not stale: no dimming and no "Updating…"` |
| `pagination (show 20, then "Show 20 more")`: first 20 of 45 with "Showing 20 of 45"; one click reveals 40, a second 45 | Retired | The list pages on the server, ten at a time, with a pager. `vuln-pager.test.tsx`; `pager and the page clamp › shows the range, "Page X of Y" and reports Next / Previous through setPage`; `vuln-alerts-view › paging, sorting and the list parameters` |
| sorting applies to all 45 loaded rows before slicing | Retired | The server sorts, then slices: `vuln-aggregate › listAlerts offset, limit and truncated` and `vuln-aggregate › listAlerts pages never repeat or skip a row (more than 500 matches, tied due dates)`. The client never re-sorts: `rows › renders rows in the order the server sent them, whatever the active sort (the server sorts, the client does not)`; `vuln-alerts-view › a header click sends sort=<key>:<dir> with its first direction and returns to offset 0` |
| a new `rows` prop KEEPS the expanded page size | Retired | There is no expanded page size. The stable height intent: `fixed geometry › the %s list area is ALERT_LIST_H as an inline style, and the outer list sets no height` (six branches) |
| after expanding, a shorter result clamps the count line and keeps the reserved height | Rewritten | `pager and the page clamp › a page past the end (no rows, a total above 0) goes to the last page`; `vuln-alerts-view › a page past the end after the result shrank lands on the last page` |
| two "Show 20 more" clicks reserve 45 rows, not 60 | Retired | There is no "Show 20 more" button |
| `time chips disabled with a hint` (six tests: pending date, critical active, none, clears when set, missing `slaStatus`, invalid) | Rewritten | `Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active`. "Clears overdue/dueSoon if somehow set": `Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active › a toggle that is "on" in the state but disabled never reads as pressed` and `vuln-security-state › sanitiseAlertList`. "Missing `slaStatus`" is retired: the summary is always present. |
| `repo dropdown` (options from the facet, not the loaded rows; selecting sends `repo=`; "All repos" clears; disabled with no facet) | Rewritten as the rail | The rail lists every `repos` row, not the loaded alert rows: `vuln-repo-rail › order: overdue, then open critical, then open high, then name; unmeasured last` and `vuln-repo-rail › structure`. Selecting: `selection › clicking a row calls url.setRepo with that repository and nothing else on the URL`. Clearing: `selection › clicking the selected row (its ×) or the All row clears the repository`. Never empty and enabled: `structure › loading reads "Loading…" and an error shows its text, with the All row and the footer still there`. |
| `repo dropdown keeps a stale selection visible` (renders the missing repo as a "(0)" option) | Rewritten | `repository not found` and `vuln-alerts-view › a repository that cannot be shown` (the inline state replaces the "(0)" option) |
| `AlertsPanel`: no data yet shows "Loading…" with no "Updating…" | Rewritten | `stale, loading and error › loading reads "Loading…" with a blank pager, never a fake "0 alerts"` |
| `AlertsPanel`: an error hides "Updating…" even with stale data | Rewritten | `stale, loading and error › an error shows no "Updating…" and no dimming, even for stale data` |
| `AlertsPanel`: stale data shows "Updating…" and the table | Rewritten | `stale, loading and error › stale: the row area dims and "Updating…" shows; the controls are not dimmed` |
| `alerts slot: fixed geometry`: every truncatable cell carries its full text as a title, with nowrap and ellipsis; Sev, Age and Scope carry none | Rewritten | `rows › every cell that can truncate carries its full text as a title`; truncation itself is the `truncate` class on each cell's text (v7 cells are grid items, not table cells) |
| ... the due text goes in the Due title; no SLA is titled "no SLA" | Rewritten | `Due column, per SLA state` and `rows › an open alert's state-message sub-line in the Due cell carries its text as a title` |
| ... the CVE cell: the id link truncates, the CVSS score is `shrink-0`, the reopened badge is not in this cell | Retired | v7 puts CVSS on the advisory's second line. The id link and the sub-line: `rows › shows severity, a linked advisory with "CVSS · package", the repository over its owning team, age, due and state over scope` |
| ... the State cell: the reopened badge is `shrink-0` and last | Rewritten | The badge is now a muted text suffix: `State column: "↺ reopened {date}" comes from lastReopenedAt` (six tests) |
| ... a null `packageName` shows only the ecosystem, never "null"; with no ecosystem the cell is empty with no title | Rewritten | `rows › a null package renders nothing, never the text "null", in the cell or its title`; `rows › no CVSS and no package leaves the sub-line blank with no title` |
| ... the first body row is the same DOM node across a rerender | Rewritten | `rows › the first row is the same DOM node across a rerender with different rows (rows are keyed by position)` |
| ... every body row and the header row carry an inline pinned height; cells have a fixed leading; badges are `leading-none` | Rewritten | `fixed geometry › every row is ALERT_ROW_H tall as an inline style and shares the header's grid`. The leading rules are retired: v7 rows are fixed-height grids, not table cells. |
| ... one `<col>` per `<th>`, widths, `table-fixed`; each `<col>` matches `ALERT_COL_W`; the table minimum width fits 1024px | Retired and replaced | No `<table>`. `fixed geometry › the Due track has a pixel minimum and every other track can shrink to 0, so the minimums fit at 1024px (fix 2 beyond the handoff)` |
| ... the slot has an inline reservation (header, a page of rows, both lines, min-width) | Rewritten | `fixed geometry › the list column chrome plus the 560px row area is exactly the 776px card`; `fixed geometry › the %s list area is ALERT_LIST_H as an inline style, and the outer list sets no height` |
| ... `alerts-body` carries the floor and wraps the loading, error and table branches | Rewritten | `fixed geometry › the %s list area is ALERT_LIST_H as an inline style, and the outer list sets no height` (populated, stale, loading, error, empty, repository not found) |
| ... the loading and error text sits in a sticky `left-0` box bounded to the viewport | Retired | The list never scrolls horizontally in v7 (`minmax(0, …)` tracks), so the message cannot be scrolled out of view |
| ... the slot is the same DOM node across loading, populated, error and empty renders | Rewritten | `fixed geometry › the list area is the same DOM node, at its height, across loading, populated, error, empty and not-found renders` |
| `count line and footnote always occupy their lines`: "Showing 5 of 5" and "Showing 0 of 0" | Rewritten | `vuln-pager › pagerText` (range, last page, singular, "0 alerts") |
| ... an empty aria-hidden placeholder in loading and error, never a fake "Showing 0 of 0" | Rewritten | `vuln-pager › with no known count it is an aria-hidden blank, never a fake "0 alerts", and both buttons are disabled`; `stale, loading and error › loading reads "Loading…" with a blank pager, never a fake "0 alerts"` and `stale, loading and error › an error replaces the rows with its text inside the list area and keeps every control mounted` |
| ... both lines carry an inline `LINE_H` height, nowrap and padding | Rewritten | `vuln-pager › keeps its %s height of PAGER_H as an inline style` (three branches) |
| ... the count line does not clip overflow so the button focus ring shows | Rewritten | `vuln-pager › does not clip its own overflow, so a focused button's ring shows` |
| ... the footnote reads "200 of 340 alerts loaded." or "340 alerts." | Retired | The server pages, so a "loaded of total" footnote has no meaning. The pager reads "1–10 of 26 alerts · counted per Dependabot alert, not per CVE". |
| `Repo select: fixed width` (`w-48 shrink-0`; its title is the selected label) | Retired | There is no repo select. The rail is `RAIL_W` wide in every branch: `vuln-repo-rail › structure › the %s rail is RAIL_W wide as an inline style` |

### Wave 4 exit check

All commands run in the repository root.

1. The wave's own tests:
   `npx jest src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx src/lib/__tests__/unit/vuln-pager.test.tsx src/lib/__tests__/unit/vuln-alerts-strip.test.tsx src/lib/__tests__/unit/vuln-repo-rail.test.tsx src/lib/__tests__/unit/vuln-alert-list.test.tsx src/lib/__tests__/unit/vuln-alerts-view.test.tsx --maxWorkers=3`
2. The unchanged guards this wave could disturb (the page test still finds the three slots at their heights, and `viewProps()` still renders every slot):
   `npx jest src/lib/__tests__/unit/vuln-security-page.test.tsx src/lib/__tests__/unit/vuln-security-view-props.test.tsx src/lib/__tests__/unit/vuln-security-support.test.tsx src/lib/__tests__/unit/vuln-use-security-data.test.tsx src/lib/__tests__/unit/vuln-security-hooks.test.tsx src/lib/__tests__/unit/vuln-filter-bar.test.tsx src/lib/__tests__/unit/vuln-format.test.ts src/lib/__tests__/unit/logger-enforcement.test.ts --maxWorkers=3`
3. Types and the full suite: `npx tsc --noEmit` then `npx jest --maxWorkers=3` (all suites pass; CI uses 3 workers). With Waves 1-3 in place this wave adds six suites and removes two (`vuln-alerts-table` and `vuln-owning-team-label`), so the full run reads 223 suites and 2780 tests.
4. Production build, from a clean cache: `rm -rf .next && npm run build`. `page.tsx` is unchanged and the new files export no component other than their default from a page file.
5. No leftover import of the retired module: `grep -rn "alerts-table\|AlertsTable\|alertFilterQuery\|AlertsPanel" src` prints exactly two comment lines: one in `src/app/vulnerabilities/format.ts` and one in `src/lib/__tests__/unit/vuln-alert-list.test.tsx`.
6. The internal-name guard on the whole wave: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff origin/main...HEAD | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1` succeeds (grep finds nothing). `INTERNAL_NAMES` is the maintainers' private pattern of company, host and people names and real policy values; it lives in the implementer's environment and is never written in this plan or in the repository. New files use only `acme/...`, Payments, Search and Platform.
7. Headless-Chrome measurement (the harness lives outside the repository, as today). At 1024px and 1440px, in the default dark theme and one light theme, against `npm run dev:mock`, on `/vulnerabilities?view=alerts`:
   - strip 72px, card 776px, rail 260px wide, list area 560px, every row 56px, header 52px, pager 28px, before and after each of: Next page, sort by Age, Overdue on, Due ≤ 7d on, Status Resolved and back to Open, select a rail repository, clear it, Severity High only and back;
   - no horizontal scroll: `document.documentElement.scrollWidth <= window.innerWidth`;
   - the left edge of `strip-critical` and `strip-high` is the same before and after every interaction above (the title column is a fixed width and the open and overdue figures have minimum widths); and the same holds, with no tail label cut (`scrollWidth <= clientWidth` on each tail's text), when the app is started with `VULNERABILITIES_SLA_POLICY` giving the high severity a far-future `effectiveFrom`, with an empty policy (`[]`) and with an unparseable value;
   - every "Nd OVERDUE" element has `scrollWidth <= clientWidth` and its left edge is inside its cell (fix 2 beyond the handoff);
   - no sort-header label is truncated (the Age header fits its 52px track with its arrow);
   - the rail's SLA note is not clipped (`scrollWidth <= clientWidth`), and with a pending high SLA (start the app with `VULNERABILITIES_SLA_POLICY` giving the high severity a far-future `effectiveFrom`) it wraps to two lines while the card stays 776px (fix 1 beyond the handoff);
   - the layout-shift API reports no movement of the strip, the card, the rail's box or the pager across the interactions above (the only shift sources are the rail rows re-sorting under Severity and row text changing);
   - the "↕" glyph renders as text, not as a coloured emoji.
8. Documentation: this wave edits no documentation file. `docs/vulnerabilities-page.md` and the root `CLAUDE.md` are updated in Wave 5. They still mention the retired `alerts-table.tsx`; Wave 5 rewrites those lines.

## Wave 5: Documentation, comment cleanup and final verification

**Goal.** Bring the written record in line with the page Waves 1-4 built, then prove the whole branch. Task 5.1 rewrites `docs/vulnerabilities-page.md` for the new page and adds a small test that keeps it honest (every path and test file it names exists, no retired module is mentioned, and its size table matches `dimensions.ts`). Task 5.2 updates the vulnerability entry in the root `CLAUDE.md`. Task 5.3 removes the last comment-only mentions of the retired components. Task 5.4 changes nothing: it runs the type check, the full suite, the build, the internal-name guard over the branch and the headless-Chrome measurement, with pass criteria. No product code changes in this wave, so no behaviour can regress in it; the only new test is the document guard.

**Verification record.** Every edit below was made in a scratch copy of the repository that had Waves 1-4 applied in order, and every claim in the document was checked against that copy's code (the sources of truth are named in each task).

- With Waves 1-4 applied in order: `npx tsc --noEmit` clean; `npx jest --maxWorkers=3` 223 suites and 2780 tests, all passing; `npm run build` succeeded. After this wave: 224 suites and 2784 tests, all passing, and the build succeeded.
- The document test fails against the current (GLOOK-43) document, all four tests, and passes against the new one. Changing the KPI row height in the document's size table from 178px to 190px fails the fourth test and names `KPI_ROW_H`.
- The headless measurement (Task 5.4) ran against the production build with `npm run dev:mock`'s environment and a seeded mock database, at 1024px and 1440px, in dark and light, on both views, before and after about twenty interactions each (filters, a team row, a repository row, view switches, toggles, paging, search, the drawer). Zero deviations from the fixed sizes, no horizontal scroll, no console errors, the sticky bar stayed at the top while scrolling. The x positions of the header coverage line's items, of the Repositories tab and of the Alerts strip's CRIT and HIGH blocks were identical before and after every interaction. Started again with a pending, an empty and an unparseable SLA policy, the strip's tails were not cut and its blocks did not move at 1440px, nor at 1024px, with one exception: an unreadable policy at 1024px with the unmeasured badge showing, where the two blocks cannot fit their labels (each tail ends in "…" and the full text is the block's `title`). The layout-shift entries are classified in Task 5.4.

**Wave 5 decisions.**

1. **The document is replaced, not patched.** The GLOOK-43 document described a page that no longer exists, so "What it shows", "Layout stability", "Data flow" and "Key files" are new. The sections about the sync, the facts cache, the SLA and taxonomy configuration, CSV import, environment variables, rollout and configuration are unchanged except for the named wording that mentioned a retired panel. A reviewer can diff the two documents and see that.
2. **A document test is part of the task.** Documentation rots by renaming. The test reads the document and checks the things a machine can check: named files exist, named tests exist, retired modules are not named, and the size table agrees with `dimensions.ts`. It does not check prose.
3. **Provenance comments stay.** Three test headers say "replaces vuln-team-pivot.test.tsx", "Replaces vuln-alerts-table.test.tsx" and "replaces vuln-trend-chart.test.tsx". They tell a reviewer of this branch where each old test's intent went, and the retired-name grep in Task 5.3 expects exactly those three lines. The document test's own list of retired names is the fourth expected line.
4. **Historical specs and plans are not edited.** Everything under `docs/superpowers/` describes the repository as it was when it was written.
5. **The Repositories footer is documented as it is built.** Wave 3's footer sums open and overdue over every row in view, an unmeasured repository's stored counts included, so a team's footer figure equals the team table, the strip, the rail and the Alerts tab. The footer's repository count, Oldest open and Next due stay measured-only. The document says so, in "Repository rows and the sum invariant" under "What a page figure includes", and in the Repositories-tab bullet.

### Wave 5 public interface

None. This wave adds one test file and changes documents and comments.

### Task 5.1: Rewrite `docs/vulnerabilities-page.md` and guard it with a test

**Files:**
- Create: `src/lib/__tests__/unit/vuln-docs-references.test.ts`
- Modify: `docs/vulnerabilities-page.md` (replace the whole file)

**Interfaces:**
- Consumes: the page, API and MCP behaviour of Waves 1-4. Every figure in the new document is read from the code: sizes from `src/app/vulnerabilities/dimensions.ts`, `alert-list.tsx` and `pager.tsx`; URL keys from `security-state.ts`; requests from `use-security-data.ts`; SLA wording from `sla-state.ts`; rows and the invariant from `computeRepoRows` in `aggregate.ts`; the MCP tools from `src/lib/mcp/tools.ts`.
- Produces: the document, and a test that reads it.

The old document describes the GLOOK-43 page (filter chips, the pivot, "Show 20 more", `alerts-table.tsx`, four MCP tools). It is wrong in most of "What it shows", "Layout stability", "Data flow" and "Key files", so it is replaced as a whole. The sync, facts cache, SLA and taxonomy, CSV import, environment, rollout and configuration sections keep their text except for the wording that named a retired panel.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/vuln-docs-references.test.ts`:

```ts
// GLOOK-64: docs/vulnerabilities-page.md names files and tests; a name that no longer exists, or a
// retired module that creeps back in, makes the document lie to the next reader. This reads the
// document, so it fails the day a file is renamed or deleted without the document being updated.
import fs from 'fs';
import path from 'path';
import {
  ALERTS_CARD_H, ALERTS_STRIP_H, ALERT_LIST_H, ALERT_ROW_H, COVERAGE_LINE_MIN_H, DRAWER_W, FILTER_BAR_H,
  KPI_ROW_H, OWNERSHIP_BODY_H, PAGE_MAX_W, RAIL_W, SPARK_H, TREND_PLOT_H,
} from '@/app/vulnerabilities/dimensions';

const root = path.join(__dirname, '../../../..');
const doc = fs.readFileSync(path.join(root, 'docs/vulnerabilities-page.md'), 'utf8');
const ticked = [...new Set([...doc.matchAll(/`([^`\n]+)`/g)].map(m => m[1]))];

const RETIRED = ['alerts-table', 'AlertsTable', 'AlertsPanel', 'team-pivot', 'TeamPivot', 'trend-chart', 'TrendChart', 'coverage-panel', 'CoveragePanel', 'policy-panel', 'PolicyPanel'];

it('every src/, scripts/ and docs/ path the document names exists', () => {
  const paths = ticked.filter(t => /^(src|scripts|docs)\/[\w./[\]-]+\.(ts|tsx|md|css|json|sql)$/.test(t));
  expect(paths.filter(p => !fs.existsSync(path.join(root, p)))).toEqual([]);
  expect(paths.length).toBeGreaterThan(40); // the extractor really found the Key files table and the prose
});

it('every test file the document names exists', () => {
  const tests = ticked.filter(t => /^[\w-]+\.test\.tsx?$/.test(t));
  expect(tests.filter(t => !fs.existsSync(path.join(root, 'src/lib/__tests__/unit', t)))).toEqual([]);
  expect(tests.length).toBeGreaterThan(10);
});

it('does not mention a module the redesign retired', () => {
  expect(RETIRED.filter(name => doc.includes(name))).toEqual([]);
});

it('the Layout stability section states the sizes dimensions.ts defines', () => {
  const start = doc.indexOf('## Layout stability');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  expect(start).toBeGreaterThan(-1);
  const sizes = {
    PAGE_MAX_W, COVERAGE_LINE_MIN_H, FILTER_BAR_H, KPI_ROW_H, OWNERSHIP_BODY_H, SPARK_H, TREND_PLOT_H,
    ALERTS_STRIP_H, ALERTS_CARD_H, ALERT_LIST_H, ALERT_ROW_H, RAIL_W, DRAWER_W,
  };
  expect(Object.entries(sizes).filter(([, px]) => !section.includes(`${px}px`)).map(([name]) => name)).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/lib/__tests__/unit/vuln-docs-references.test.ts --maxWorkers=3`
Expected: FAIL, all four tests, each for its own reason. The path test receives `src/app/vulnerabilities/alerts-table.tsx`, `team-pivot.tsx`, `trend-chart.tsx`, `coverage-panel.tsx` and `policy-panel.tsx` as the paths that do not exist. The test-file test passes its existence check but fails its extractor guard (`Expected: > 10`, `Received: 2`), because the old document names its tests without the `.test.tsx` extension. The retired-name test receives `alerts-table`, `AlertsPanel`, `team-pivot`, `trend-chart`, `coverage-panel` and `policy-panel`. The size test receives eleven sizes the old Layout stability section does not state (`COVERAGE_LINE_MIN_H`, `FILTER_BAR_H`, `KPI_ROW_H`, `OWNERSHIP_BODY_H` and so on).

- [ ] **Step 3: Implement**

Replace the whole of `docs/vulnerabilities-page.md` with the following. The fence is four backticks because the document contains three-backtick blocks.

````markdown
# Vulnerabilities Page — Technical Reference

This document describes the `/vulnerabilities` page and the `src/lib/vulnerabilities/` module (GLOOK-43, redesigned in GLOOK-64) for AI coding assistants working on the codebase.

## Overview

The Vulnerabilities page ("Security") tracks critical and high Dependabot alerts across every in-scope repo in a GitHub org — a repo whose configured tier property equals the configured in-scope value (`service_tier = production` by default; see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration) below). Before this feature, per-team counts came from an existing manual process with no per-alert history. It stores one row per alert (never deleted) plus a per-repo snapshot on every sync, so every number is traceable to an alert, and reopened alerts are detected instead of silently vanishing from "resolved" counts. A repo archived after its first sync keeps its history this way automatically; a repo archived before its first sync has no stored alerts at all, so its resolved count is carried over from imported CSV history instead (below).

The page answers two questions. A security lead asks how each owning team is doing (Overview). A team lead asks which of their repositories have open critical or high alerts, and what those alerts are (Alerts).

It is a standalone module with no coupling to `reports`/`schedules` — see the root `CLAUDE.md` architectural-decisions entry for why (Approach B, extending the report pipeline, was rejected: 52 `FROM reports` queries in 27 files would need a `report_type` discriminator).

## What it shows

The page is one header card, one sticky filter bar and two views (Overview and Alerts) that share the bar's filters. Everything the page shows is either an alert, a repository row or a stored measurement.

### The header card

1. **Title and meta line** — `Security · {org}`, then a line such as "Backend · 11 production repositories · 4 owning teams". The repository count and the number of distinct owning teams (Unassigned counts as one) come from the `repos` rows; the scope word ("production") comes from `summary.scope.value`, never from a literal. The header uses the shared `PageHeader` and `DataFreshness` components, which the org and team report pages also use, so it adds its own elements as `PageHeader` children instead of changing them.
2. **Freshness and links** — "last successful sync …" (amber when stale: more than 36 hours since the last `succeeded`/`partial` run), an "Updating…" badge while the summary reloads, and a "Sync history →" link to the sync history tab.
3. **Stale tag and failed-sync banner** — "▲ STALE · 42H" when the data is stale. When the latest run failed, a banner says so and shows the first issue; the page keeps serving the last good run's data, because a failed run writes nothing. The config-error banner (`configErrors`, below) also renders here.
4. **Coverage line** — an "▲ N UNMEASURED" badge when any in-scope repo is unmeasured, "Excluded N", "Needs tagging N", and a "Coverage & policy →" link. Each opens the drawer. The line has a 22px minimum height and the badge has a reserved slot, so neither the line's height nor the items after the badge move when the badge appears or disappears.

### The sticky bar

The bar sticks below the top of the viewport and holds the view tabs and every filter.

- **Tabs** — "Overview" and "Alerts". The Alerts tab carries the open count under Severity for the current scope (the sum of the `repos` rows, so it includes the stored counts of unmeasured repositories). The count slot has a minimum width, so the tab does not change size when the count arrives.
- **Filters** — Codebase (each option shows its open count: it follows Severity and Owning team, and is computed client-side from `summary.codebaseCounts`), Owning team ("All owning teams" plus `summary.knownTeams`), Severity, and Compare to (Last sync / 7 days / 30 days / A date…). Choosing "A date…" writes a concrete date immediately (the current baseline's date, else a week ago) and shows a date input.
- **Reset filters** appears only when a filter differs from its default. It resets Codebase, Owning team, Severity, Compare to and the selected repository, and never changes the view or the Overview's ownership tab.
- A filter that differs from its default is drawn in the accent colour. Which codebase-type values fall into each Codebase option is deployment configuration (`VULN_CODEBASE_GROUPS`, below).

### Severity on the page

The page never sends `severity=both` to the API. One rule decides which severity each element uses.

| Element | Severity it uses |
|---|---|
| KPI tiles, sparkline, trend | `kSev`: critical, unless Severity is "High only", then high. They show one severity, never a sum of both. |
| Alert list, repository rail, summary strip, Alerts tab count, Repositories tab | Follow Severity. "Critical + high" sends no `severity` parameter. |
| Codebase option counts | Follow Severity and Owning team. |

The old `?sev=` key is retired and ignored; an old `?sev=high` link now shows critical.

### Overview

1. **KPI tiles** — four tiles in a fixed row, all following `kSev`.
   - *Open {severity} alerts*: the open count, a change sentence ("▲ 2 more than on Sep 29", "▼ 1 fewer than on Sep 29", "Same as on Sep 29", or why there is none: "No earlier measurement yet" / "No measurement on or before Sep 29"), and a 24px sparkline of the last 90 days. The sparkline sums the unscoped trend series per stored measurement date, and only the selected team's series when an owning team is selected, so the line matches the count beside it. With no measurements it reads "Not enough history yet" over "No measurements yet"; with one it reads "Not enough history yet" over "1 measurement so far ({date})"; with two or more it draws the line.
   - *{severity} since {date}*: new / resolved (with a dismissed sub-count) / reopened since the baseline, plus `other ±N` when non-zero (change in open alerts that new, resolved and reopened do not explain) and `N repos not in baseline` when non-zero. Three one-line slots are reserved in every state.
   - *Resolved {severity}*: the resolved count, "N dismissed · since {date}" (or "all time" when `VULN_RESOLVED_SINCE` is unset, "since —" when invalid), and "% of N raised are closed". A figure that includes carried-over CSV history is marked `†`, with a footnote.
   - *SLA · open alerts*: Overdue and Due ≤ 7d per severity while that severity's policy is active; otherwise the severity's SLA state (see "SLA states"). A hidden severity (Severity filter) dims to 35% rather than disappearing.
2. **Ownership card** — one card with two tabs over one fixed-height body. Tables scroll inside the body; their header row and their Total/footer row stay pinned.
   - *Owning teams*: one row per owning team, with a CRITICAL group and a HIGH group. Columns per severity: Open, Change vs {baseline date} (or the "No earlier measurement yet" text), Resolved (dismissed), % closed, and Overdue only while that severity's SLA is active. Unassigned is a real row. A row with unmeasured repos shows an "▲ N unmeasured" badge that opens the drawer; a row whose critical resolved figure carries history shows `†`. Sortable headers show ↕, the active one ↑ or ↓. The table makes its own summary request with no `team` parameter (same `codebase` and `baseline`; with no team selected it has the same SWR key as the KPI tiles' request and dedupes to one), so selecting a team never collapses it to one row and its Total row stays org-wide within the selected codebase.
   - *Repositories*: one row per in-scope, non-archived repository in the current Codebase and Owning team scope, including repositories with no open alerts (greyed). Columns: Repository (codebase underneath), Owning team, Open crit, Overdue crit, Open high, Overdue high, Oldest open, Next due; the Overdue columns exist only while that severity's SLA is active, "Next due" only while at least one policy is active. A name filter narrows the rows (the footer then reads "Matching"). Unmeasured repositories are listed last as a hatched band ("▲ UNMEASURED · DEPENDABOT OFF — alert counts unknown, not zero"); they ignore sorting and show no count. The footer's Open and Overdue columns sum every row, an unmeasured repository's stored counts included, so a team's footer figure equals the team table's; the footer's repository count, Oldest open and Next due come from the measured rows only, and its second line reads "N unmeasured: totals include stored counts" (see "Repository rows and the sum invariant").
3. **Trend card** — "Open {severity} alerts by owning team": the **open** count, one point per stored measurement per team, placed on a numeric time axis by the measurement's actual date (no reconstructed history). A Range select (All time, Last year, Last 90 days, Last 30 days; URL key `range`) picks the window; anything but "All time" adds `since=<today minus 30/90/365 days, UTC>` to the trend request. The legend always lists every owning team: the top 12 by current open count are each coloured distinctly (a CSS custom property per theme mode, `globals.css`), the rest share one grey "Other · N teams" entry whose tooltip lists the names. A selected team draws only its own line and dims the other legend entries to 0.4 opacity. The trend request is never scoped by team, so a team keeps its colour and the legend never changes; the page filters the series client-side. With no points the plot shows "No measurements yet"; with one point it shows "Not enough history yet"; a young history (under 14 days) shows a note such as "History starts Sep 29 (first sync) · 3 measurements". The footnote reads "Each dot is one stored measurement (an imported CSV run or a sync)."

### Alerts

1. **Summary strip** — the scope label and title ("All owning teams / All repositories", "Owning team / {team} · all repositories", or "Repository · owning team {team} / {repo}"), a CRIT row and a HIGH row each reading "N open · {tail}" (the tail is "N overdue" while that severity's SLA is active, otherwise its state message), and an "▲ N unmeasured repos" badge when no repository is selected. The strip is computed from the `repos` rows for the current scope, never from the alert list's response, so the strip, the rail and the Alerts tab count cannot disagree with each other. Its figures include the stored counts of unmeasured repositories.
2. **Repository rail** — 260px wide. A first row "All {team} repositories" (or "All repositories"), then one row per measured repository sorted by overdue, then open critical, then open high, then name (the sort follows the Severity filter: a hidden severity counts as 0). Each row shows "N crit · N high open" (or "no open alerts", greyed), "N OVERDUE" on the right, and "Owning team: X" only when no team filter is set. Unmeasured repositories come last as hatched rows that open the drawer. A name filter sits above the rows. The footer says how the rows are sorted and which severities the OVERDUE figures include.
3. **Alert list** — a toolbar (search; Status: Open / Resolved / Open + resolved; toggles Overdue, Due ≤ 7d, Reopened, Runtime only), six sortable headers (Sev, Advisory with CVSS · package, Repository with owning team, Age, Due, State with scope), ten 56px rows, and a pager ("1–10 of 26 alerts · counted per Dependabot alert, not per CVE", Previous, "Page X of Y", Next). The server sorts and pages the list (see "Alert sort and offset"); the component renders rows in the order they arrive.
   - Each key starts in its natural direction: Age starts descending (oldest first), every other key ascending; clicking the active header reverses it. With no header active the list is in the server's default order (soonest due, then severity, then newest).
   - **Due** shows the date and "Nd OVERDUE" (red) or "in Nd" while that severity's SLA is active; otherwise a dash with the SLA state's message. A resolved alert shows "resolved on time" or "resolved Nd late". The Due track has a 120px minimum so "104d OVERDUE" is never clipped at 1024px.
   - **State** shows the state, the dismissed reason and resolution date for non-open alerts, and "↺ reopened {date}" for a reopened alert, over the dependency scope.
   - Before any severity's SLA is active (`summary.slaStatus`), Overdue and Due ≤ 7d are disabled with a hint ("Due dates start <date>", "No SLA policy yet" or "SLA policy can't be read"). **Overdue and Due ≤ 7d are mutually exclusive**: no alert is both past its due date and ≤ 7 days from it, so turning one on turns the other off, and `parseVulnFilters` (shared by the API and MCP) rejects `overdue=true` together with `due_soon=true` with `"overdue and due_soon are disjoint buckets — use one"`. The **Due ≤ 7d** toggle sends `due_soon` (open AND 0 ≤ days_remaining ≤ 7), not a `due_before` cutoff, which also matched already-overdue alerts. Choosing **Resolved** disables and clears both time toggles, since a resolved alert has no due date.
   - The search box applies its text 300ms after the last keystroke, and applies it at once (never drops it) when the user clicks any other control or leaves the view.
   - A page past the end (a sync shrank the result) moves to the last page. A selected repository that is not in the loaded rows, or that the alerts API rejects ("unknown repo", "repo not tracked"), shows "Repository not found · Show all repositories" inside the list area, and the page never sends that `repo` again.
4. **The list has no owning-team select.** Owning team lives in the sticky bar, and a rail row sets only `repo`.

### Coverage & policy drawer

A right-hand dialog (460px wide, at most 92% of the viewport; `role="dialog"`, `aria-modal`). Opening it focuses the close button and keeps focus inside; Esc, the backdrop and × close it; closing returns focus to the element that opened it. Its open state is local, not in the URL. It reads the same `coverage` and `summary` responses as the header line and the KPI tiles, so it follows the Codebase and Owning team filters. It groups gaps as **Unmeasured** (hatched rows with GitHub's reason, or "Dependabot off"; open counts unknown, but their resolved alerts and measured history still count), **Needs tagging** (counted under "Unassigned" until tagged) and **Excluded by policy** (not counted anywhere on this page), then lists the policy as "From deployment configuration": each severity's SLA state, each entry's derived window (e.g. "critical-2099-01 · 7 days · 2099-01-07 → open-ended", marked *pending* before it starts), the resolved-count start date and the scope rule. With no entries it says "No SLA policy yet"; with an invalid policy it says "SLA policy can't be read".

### SLA states

Each severity has one of four SLA states, decided in one place (`sla-state.ts`) so the SLA tile, the strip, the rail, the Overdue and Due columns and the drawer cannot disagree.

| State | Meaning | Wording |
|---|---|---|
| active | A policy entry has taken effect | figures: Overdue, Due ≤ 7d |
| pending | A policy exists but starts later | "Starts {date}" |
| none | No policy configured | "No SLA policy yet" |
| invalid | The configured policy does not parse | "SLA policy can't be read" (red) |

An Overdue column, a Due ≤ 7d figure and a "Next due" column exist only while their severity's policy is active; `overdue`, `dueSoon` and `nextDue` are `null` in the data otherwise, which is different from zero. An invalid policy reads as `invalid` even though it parses to an empty policy.

### Interactions

| Action | Result |
|---|---|
| Click a team row | Sets Owning team, stays on Overview and switches the card to Repositories. Clicking the selected row again clears it. |
| Click a repository row (Repositories tab) | Pushes one history entry to Alerts with that repository selected, and sets Owning team to that repository's owning team (`Unassigned` is a valid team). |
| Click an unmeasured row or badge | Opens the drawer. |
| Click a rail row | Writes only `repo` (a replace); clicking the selected row, or the "All" row, clears it. |
| Change Codebase or Owning team | Never switches view. It clears the selected repository in the same URL write. |
| Change Severity or Compare to | Never switches view. |
| Change a list filter (search, status, toggles, sort, page) | Applies only to the alert list. |
| Change any list filter or any scope filter | Resets the alert list to page 1. |
| Switch view | Pushes a history entry. If the user has scrolled past the top of the view content, the page scrolls up just enough that the content starts right under the sticky bar; it never scrolls down. |

### URL keys

State lives in the URL (`src/lib/url-state.ts`; the page's schemas are in `src/app/vulnerabilities/security-state.ts`), so a team lead can bookmark "Alerts · Payments". Every key is declared with `scroll: false`.

| Key | Values | Default | History |
|---|---|---|---|
| `view` | `overview`, `alerts` | `overview` | push |
| `own` | `teams`, `repos` | `teams` | push |
| `codebase` | `backend`, `frontend`, `shared`, `other`, `all` | `backend` | replace |
| `team` | an owning team (or `Unassigned`) | none | replace |
| `repo` | `org/name` | none | replace |
| `severity` | `both`, `critical`, `high` | `both` | replace |
| `baseline` | `last`, `7d`, `30d`, `YYYY-MM-DD` | `last` | replace |
| `range` | `30d`, `90d`, `1y`, `all` | `all` | replace |

`useUrlBatch` pushes when any key in the batch is declared `push`, so a team-row or repository-row click (which writes `own` or `view`) pushes one history entry and Back returns to where the user was; every other change replaces. The alert list's page, filters, search text and sort, and the tables' sorts and name filters, are local state, not URL. A hand-edited `baseline` that the API would reject (HTTP 400, which would blank the page) reads as `last`; a hand-edited combination of list filters is sanitised before the request is built, so a bad combination never costs a request.

### States the page covers

- **Hidden severity** (Severity is not "Critical + high"): "–" in that severity's columns, including the Total row, left out of the sums; its headers dim to 35% opacity. The SLA tile and the strip keep the row and dim it.
- **Repositories with no open alerts**: listed and greyed, in the rail and in the Repositories tab.
- **Unmeasured repositories**: listed last as a hatched band; their open count renders as unknown although the API carries the stored count.
- **Baseline**: "No earlier measurement yet" or "No measurement on or before {date}" when the baseline set does not exist or does not cover the view.
- **More than 12 owning teams**: the top 12 by open count get distinct colours from the existing palette; the rest share one grey "Other · N teams" legend entry.
- **Unknown team in the URL**: the page shows the recovery action "Clear team filter" and the known teams.
- **Summary request fails**: a full-page error, never half a page of stale numbers. Any other failed request shows an error inside its own region.
- **No successful sync yet**: a short message with a link to the sync history. (With the module off, `page.tsx` returns 404 instead.)

### Carried over from the GLOOK-43 page

| Behaviour | Where it lives now |
|---|---|
| `†` marker on carried-resolved figures, and its footnote | KPI Resolved tile and the team table |
| "Clear team filter" recovery for an unknown team | `vulnerabilities-content.tsx` |
| Full-page error when the summary fails | `vulnerabilities-content.tsx` |
| Config-error banner | the header card |
| Overdue and Due ≤ 7d mutually exclusive; Resolved clears both | alert list and `security-state.ts` |
| Both time toggles cleared when no SLA is active | `sanitiseAlertList` in `security-state.ts` |
| "other ±N" and "N repos not in baseline" | KPI since-baseline tile |

The old "+N open critical in other codebase types" KPI line is dropped from the page: the Codebase options show those counts. `kpi.openCriticalOtherCodebases` is still in the summary response (MCP: `kpi.open_critical_other_codebases`); the page does not read it.

**"Owning team" labeling:** the vulnerability pages label the repo-level `team` custom property "Owning team" everywhere it's shown to a person — the team table's first column (with a tooltip clarifying it is not a Glooker team), the sticky bar's "Owning team" select (`aria-label="Owning team"`, "All owning teams" option), the rail and the list's repository cell — specifically so it is never confused with a Glooker (people) team. This is a label-only distinction; the underlying property, its semantics, and its plumbing through `src/lib/vulnerabilities/` are unchanged, and it is never joined against Glooker's own team data.

**Accent-token rule:** every accent color on the vulnerabilities pages and the Runs tabs uses the theme's `accent`/`accent-light`/`accent-lighter`/`accent-dark` utility classes defined in `src/app/globals.css` (`bg-accent`, `text-accent-light`, `hover:bg-accent-dark`, etc.) — never a hard-coded Tailwind color like `indigo-*`. Severity and status colours are the exception and are deliberate: critical is `red-400`, high is `orange-400`, good is `green-400`, and the unmeasured and stale amber and the column washes are the `--warn`, `--warn-bg`, `--warn-line`, `--crit-tint` and `--high-tint` variables in `globals.css`, defined for both theme modes. Chart colours come from `--vuln-series-*` and `--chart-*`; `chart-no-literal-colors.test.ts` keeps literal colours out of the chart modules. A future change to this area must not reintroduce a literal colour; add a utility or variable to `globals.css` if the token set doesn't already cover the shade needed.

## Reports page and sync history

**The Reports page** (`/reports`, `src/app/reports/reports-tabs.tsx` — the route and file names are unchanged from the old "Report History" page, the page is titled "Reports", with tabs "Commits & PRs" (GitHub · Jira) and "Dependabot alerts" (GitHub)). The second tab, "Dependabot alerts" (`?tab=syncs`, `src/app/reports/vulnerability-syncs-tab.tsx`), shown only when the feature is enabled — the page has no tabs otherwise. GLOOK-59 unified reports and vulnerability syncs onto one shared run model (`src/lib/runs/`: status mapping, formatting, health, staleness) and one card component, `RunCard` (`src/components/runs/RunCard.tsx`); the syncs tab is an adapter onto that shared model, not a second copy of the card. Each tab renders a `RunsToolbar` holding its schedule/next-run line (`RunsToolbar`'s `info`) and its primary action (`RunsToolbar`'s `action` — "Sync alerts" here, rendered only when `canAct`), then one collapsible `RunCard` per run.

A sync `RunCard`'s header (chevron, status chip via `RunHealthBadge`, trigger via `triggerLabel(s.triggerKind, s.triggeredBy)`, duration, start time) is always visible; clicking a **finished** run (succeeded, partial, or failed) expands it into a stats grid (alerts, repos, new/resolved/reopened/missing — "initial import" on the first sync) and, when non-empty, the issues list and a link to the dashboard. A **running** run is never clickable and instead always shows a live progress block — step, a repos counter once known, a progress bar, and a collapsible log panel — the same pattern as a running report's progress block, backed by its own in-memory store (`src/lib/vulnerabilities/progress.ts`) and polled per-card from `GET /api/vulnerabilities/syncs/:id/progress`; it doesn't survive a process restart, and a restart marks the run failed anyway (`initVulnerabilityScheduler()`, see "Sync phases and statuses" below), so there's nothing stale for it to serve after one. Once a run is observed running during a page session, its progress block stays visible after it finishes (polling stopped) until the page reloads. It's a run summary, not an execution trace — per-request detail beyond the visible log lines goes to the server console and `LOG_DIR`. Unlike a report card, a sync card has no Delete or Stop action — Stop is deliberately withheld pending an owner design check (a stopped sync must write nothing), and Delete was never offered for syncs.

Sync staleness (the amber "Last successful sync …" state, both here and in the sync `RunHealthBadge`) comes from a fixed `STALE_MS` (36h, `src/lib/vulnerabilities/queries.ts`) — unlike report staleness, which is derived from the enabled report schedules. **Settings → Schedules** (`src/app/settings/schedules-tab.tsx`) manages the Dependabot alerts sync the same way as report schedules: it is one row in the shared `schedules` table (`kind = 'vuln_sync'`, run by the shared scheduler manager in `src/lib/schedule/manager.ts`), shown with Type "Dependabot alerts", editable cadence and timezone, and pause/resume. It can't be deleted (pausing is the off switch) and has no org, period or test-mode fields. `VULN_SYNC_CRON`/`VULN_SYNC_TZ` only seed that row on the first boot with the feature on; after that the row is the source of truth, so a Settings edit survives restarts and deploys. Both the vulnerabilities dashboard's header and this row read their freshness from `reportFreshness`/`vulnerabilityFreshness` on `GET /api/llm-config`, rendered through the shared `DataFreshness` component (`src/components/runs/DataFreshness.tsx`) and `PageHeader` (`src/components/PageHeader.tsx`).

**NavBar** shows a "Vulnerabilities" link when `/api/llm-config`'s `vulnerabilities.enabled` is true (`src/components/NavBar.tsx`), and the last sync date alongside it.

## Layout stability

The page must not jump when a filter changes. The rule is: **a filter change may change what a slot shows; it must never change a slot's size or a control's position.** Every fixed size is written once, in `src/app/vulnerabilities/dimensions.ts` (and, for the alert list's own column and the few widths that belong to one component, exported from that component: `alert-list.tsx`, `pager.tsx`, `security-header.tsx`, `ownership-card.tsx` and `alerts-strip.tsx`), and the components apply those constants as inline styles, so a number changes in one place and tests compare rendered styles against the names.

| Element | Fixed size |
|---|---|
| Page container | max width 1280px; padding 32 / 24 / 40 (top / sides / bottom); 24px gap |
| Header coverage line | 22px minimum height; the unmeasured badge's slot is always rendered, 136px wide, and hidden when there is no badge; the Excluded and Needs tagging counts sit in slots 72px and 104px wide |
| Sticky bar | 84px: two 36px rows plus 6px top and bottom padding |
| Bar selects | Codebase 220, Owning team 170, Severity 140, Compare to 118, date input 128; each `shrink-0`, long text truncates with a `title` |
| Bar reserved slots | "Reset filters" 116px, date input 128px: hidden, never removed |
| KPI tile row | 178px |
| Ownership card body | 330px (team rows 50px; tables scroll inside, header and Total row pinned); each tab's count sits in a slot at least 2ch wide |
| Sparkline slot | 24px |
| Trend plot | 220px; the legend reserves two lines (32px) |
| Alerts summary strip | 72px; the title column is a fixed 176px, the open figure has a minimum width of 72px and the overdue figure one of 96px |
| Alerts card | 776px: a 260px rail and the list column |
| Alert list | 560px of rows (10 × 56px), a 52px header, two 32px toolbar rows, a 28px pager |
| Drawer | 460px, at most 92% of the viewport |

What holds the sizes constant:

- **Every region keeps its height in every state.** The ownership body, the trend plot, the alert list's row area and the strip are the same size while loading, on error, when empty and when populated. A short or empty list leaves blank space under its rows; that is deliberate and accepted.
- **Reserved slots, not removed controls.** The Reset button, the date input, the Alerts tab count, the coverage line's height and the slots of its badge and counts, the ownership tab counts' minimum width and the tabs' bold label width, the strip's title column width and its figures' minimum widths, every caption line in the KPI tiles, the Repositories footer's second line and the trend legend's two lines render in every state (an `aria-hidden` non-breaking space when empty), so a state change cannot add or remove a line.
- **Grid tracks use `minmax(0, …)` and one grid serves a header and its rows.** Long text ends in "…" with a `title` carrying the full text. There is no horizontal scroll at 1024px or wider; below that the cards scroll inside themselves (the page is not designed for narrower screens).
- **Stale data stays on screen.** Every SWR key uses `keepPreviousData`; a scope change dims the previous key's figures (`opacity-60`) instead of blanking the region.
- **List and legend entries are keyed by position**, not by team or alert: keyed by identity, a filter change looked to the browser's layout-shift API like the surviving entries sliding to a new position.
- **Light theme.** The light-mode remap gives `.bg-gray-900` a 1px border and a shadow, so `bg-gray-900` is used for card shells only. Pinned headers, Total rows, rail rows, alert rows and drawer rows use `bg-chart-surface` or a plain `var()` with no border, so the fixed heights hold in both modes.
- **Page-level state is not scroll-jumping.** URL writes pass `scroll: false`, and a view switch scrolls up (never down) just enough that the content starts under the sticky bar.

How it is checked:

1. **jsdom unit tests** (`vuln-security-dimensions.test.ts`, `vuln-kpi-tiles.test.tsx`, `vuln-ownership-card.test.tsx`, `vuln-team-table.test.tsx`, `vuln-repo-table.test.tsx`, `vuln-trend-card.test.tsx`, `vuln-alerts-strip.test.tsx`, `vuln-repo-rail.test.tsx`, `vuln-alert-list.test.tsx`, `vuln-pager.test.tsx`, `vuln-alerts-view.test.tsx`, `vuln-security-page.test.tsx`) have no layout engine, so they guard structure, classes and inline styles: the constants are applied in every branch (loading, error, empty, populated) and the pieces add up to the card heights. Each names the revert that makes it fail.
2. **A headless-Chrome run** is the real check. It loads the production build against `npm run dev:mock`'s data at 1024px and 1440px, in the dark theme (the default) and a light theme (set `localStorage['glooker-theme']` to `daylight-blue` before load), on the Overview and the Alerts views, before and after roughly ten interactions each (filters, a team row, a repository row, view switches, toggles, paging, the drawer). It gates on: the heights in the table above (tiles 178, ownership body 330, trend plot 220, strip 72, card 776, list rows 560, every alert row 56, the rail 260 wide, the pager 28); the sticky bar and the header card keeping their height and the bar staying at the top while scrolled; no horizontal scroll; no console errors; the x position of the coverage line's items, of the Repositories tab and of the Alerts strip's CRIT and HIGH blocks staying the same through every interaction; and the layout-shift API. Shifts are logged with the moving element, so a figure changing inside a fixed slot (acceptable: that is a content change) can be told apart from a control or a slot moving (a defect). The harness is not in the repository. The header card is 2px taller in light mode than in dark (the light remap's card border); it is constant within a mode and is not one of the fixed heights.

## Data flow

```
GitHub org endpoints (github.ts / github-mock.ts)
        │  fetch phase: buffered in memory, nothing written yet
        ▼
sync.ts — runSync(): one db.transaction() write phase
        │  upserts vulnerability_repos, vulnerability_alerts,
        │  sets missing_since, writes snapshots and sync counters
        ▼
vulnerability_repos / vulnerability_alerts / vulnerability_repo_snapshots / vulnerability_syncs
        │
        ▼
aggregate.ts (pure functions: computePivot, computeRepoRows, computeCodebaseCounts, computeKpi, computeDelta, computeTrend, listAlerts, computeCoverage, knownTeams, pickBaseline, snapshotSets)
        │
        ▼
queries.ts (getSummary / getRepos / getTrend / getAlerts / getCoverage / listSyncs) — shared by API and MCP
        │                                             │
        ▼                                             ▼
/api/vulnerabilities/* routes (camelCase JSON)   MCP tools (snake_case JSON, via toSnake() boundary mapper)
        │
        ▼
src/app/vulnerabilities/ — use-security-data.ts (every SWR key) → vulnerabilities-content.tsx → the region modules
```

`queries.ts` is the single source of truth read by both the API and the MCP tools, so the dashboard and an agent can never disagree. It resolves availability (`prepare()`), validates `team`/`repo` filter values against what's actually stored, and delegates every computation to `aggregate.ts`, which is pure (facts + filters + `now` in, numbers out) and therefore trivially testable without touching the DB. `getRepos` is its own route rather than a summary field so the MCP summary payload stays small; both read the same facts cache, which is keyed by the latest sync, so they agree between syncs.

`db-helpers.ts` maps raw DB rows to `AlertFact`/`RepoFact` (`rowToAlertFact`, `rowToRepoFact`) and provides `upsertRows`/`insertRows`/`bool()` helpers used by the sync writer.

### What each region requests

Every key uses `keepPreviousData` and is built in one place (`securityKeys()` in `use-security-data.ts`).

| Element | Request | Parameters |
|---|---|---|
| KPI tiles, SLA tile, Codebase option counts | `summary` | `codebase`, `team`, `baseline` |
| Header meta line | `repos` rows, plus `summary.scope.value` | `codebase`, `team` |
| Header coverage line, drawer | `coverage` (and `summary` for the drawer's policy) | `codebase`, `team` |
| Team table | `summary` (a second key) | `codebase`, `baseline`; never `team` |
| Sparkline | `trend` | `codebase`, `severity=kSev`, `since` fixed 90 days back; never `team` |
| Repositories tab, rail, strip, Alerts tab count | `repos` | `codebase`, `team` |
| Alert list | `alerts` | `codebase`, `team`, `repo`, `severity` (omitted for both), list filters, `limit=10`, `offset`, `sort` |
| Trend | `trend` | `codebase`, `severity=kSev`, `since` from `range`; never `team` |

**Known limitation.** The summary, team-table and `repos` requests can briefly disagree if a sync lands between them. The hook compares their settled sync times and refetches the older ones, once per distinct disagreement.

### Page modules

| Module (`src/app/vulnerabilities/`) | Role |
|---|---|
| `page.tsx` | Server component, feature gate (404 when disabled). Exports only `default`. |
| `vulnerabilities-content.tsx` | The thin composer: URL state, data and the drawer's state, full-page states, the view switch |
| `security-state.ts` | URL schemas, `kSev`, the clearing handlers (`useSecurityUrl`), the alert list's local state (`useAlertList`), `scopeOpenCount`, the rules that sanitise hand-edited input, `alertsQueryString` |
| `use-security-data.ts` | Every SWR key, the stale-repository status, the sync-time reconciliation |
| `api-types.ts`, `view-props.ts` | Response types and the props every view region takes |
| `sla-state.ts`, `dimensions.ts`, `format.ts`, `overview-format.ts` | The four SLA states and their wording; the fixed sizes; shared formatters; the change sentences and carried-resolved wording |
| `security-header.tsx`, `filter-bar.tsx`, `view-tabs.tsx`, `coverage-drawer.tsx` | Header card, sticky bar, tabs, drawer |
| `kpi-tiles.tsx`, `sparkline.tsx` | Overview tiles |
| `ownership-card.tsx`, `team-table.tsx`, `repo-table.tsx`, `ownership-model.ts` | The ownership card and its two tables (`ownership-model.ts` holds the sort, row-view and footer-sum logic) |
| `trend-card.tsx`, `trend-model.ts`, `team-colors.ts` | The trend card; the model that builds rows, domain, ticks, legend and status; the team colour assignment |
| `alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx`, `pager.tsx` | The Alerts view |

## The four tables and the counting rules

Four tables, added in all three schema locations (`schema.sql`, `src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts`) per the root `CLAUDE.md` "new table" rule. Never a pinned charset.

- **`vulnerability_repos`** — one row per repo Glooker has seen: `repo_id` (PK, GitHub numeric id), `org`, `full_name`, `team`/`service_tier`/`codebase_type` (the custom property values, nullable), `archived`, `dependabot_status` (`ok`/`archived`/`error`/`dependabot-off`), `dependabot_status_detail` (GitHub's message, for `error` and `dependabot-off`), `first_seen_at`/`last_seen_at`.
- **`vulnerability_alerts`** — one row per Dependabot alert, primary key `(repo_id, number)`, **never deleted**. Identity, state (`open`/`fixed`/`dismissed`/`auto_dismissed`), severity (`critical`/`high`, with `severity_changed_at` when GitHub re-rates it), advisory fields (`ghsa_id`, `cve_id`, `cvss_score`, `epss_percentage`, `advisory_withdrawn_at`), dependency fields (`package_name`, `ecosystem`, `manifest_path`, `relationship`, `scope`), GitHub timestamps, and Glooker's own bookkeeping: `reopened_count`, `last_reopened_at`, `missing_since`, `withheld_since`, `first_seen_sync_id`/`last_seen_sync_id`.
- **`vulnerability_syncs`** — one row per run: `trigger_kind` (`schedule`/`manual` — named `trigger_kind` because `TRIGGER` is a reserved MySQL word), `triggered_by`, `status` (`running`/`succeeded`/`partial`/`failed`), timestamps, `alerts_fetched`, `repos_checked`, the four per-run counters, and `issues` (a JSON array of `{ repo?, kind, message }`).
- **`vulnerability_repo_snapshots`** — one row per repo per sync or imported CSV: `source` (`sync`/`csv-import`), `sync_id` (null for CSV), `source_file` (CSV only), `taken_on` (date), `measured_at` (instant — a sync's `finished_at`, or a CSV's `taken_on` at 00:00 UTC), and the counts (`open_critical`, `open_high`, `resolved_critical_since_start`, `resolved_high_since_start`; the two `high` columns are null for CSV rows, which never measured high). The `*_at_time` columns are audit-only — no query uses them by default.

**Counting rules** (`aggregate.ts`, used by every query):

- **Open** = `state = open` AND `missing_since IS NULL` AND the repo is not archived. An archived repo's open alerts are excluded from open counts and SLAs.
- **Resolved since start** = `state ∈ {fixed, dismissed, auto_dismissed}` AND (`VULN_RESOLVED_SINCE` is unset, or the resolution timestamp ≥ the configured `VULN_RESOLVED_SINCE`) AND `advisory_withdrawn_at IS NULL`. When unset, the date condition is omitted rather than compared against null, so resolved counts cover all time. Archived repos' resolved alerts **are** counted. Dismissed counts as resolved.
- **Carried resolved** (critical only): a repo that is `archived`, has zero rows in `vulnerability_alerts`, and has at least one `csv-import` snapshot has no stored alerts to compute a resolved count from at all — it's archived from *before* the first sync ever ran. Its carry is the latest such snapshot's `resolved_critical_since_start` (by `taken_on` then `measured_at`), computed by `queries.ts`'s `loadCarriedResolvedCritical()` (one dual-DB-safe correlated-subquery SQL query, no window functions) and stored on `RepoFact.carriedResolvedCritical`. `computePivot` (`aggregate.ts`) adds it into that repo's team's critical `resolved` (and so `pctClosed`) and the total — re-checking `archived` and "zero alert rows" itself from the `repos`/`alerts` it's already given, independent of whether the field was computed correctly upstream. Open is never carried, and there's no high counterpart (the CSVs never measured high). The UI marks a carrying team row and the Resolved KPI tile with a `†` and a tooltip, plus a footnote when the figure carries; MCP exposes it as `carried_resolved` on both `pivot.rows[].critical` and `pivot.total.critical`.
- **In scope** = the repo's current configured tier property equals the configured in-scope value (`service_tier = 'production'` by default; both are deployment configuration — see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration)). An in-scope repo with a null codebase-type value is counted under Other and All, and listed in Needs tagging. A repo with a null tier value is not counted anywhere (listed in Needs tagging if it has open alerts).
- **Team** = the repo's current configured team property. Null shows as **Unassigned**, a real pivot row, not dropped.
- **Codebase groups** (`codebase.ts`/`codebase-labels.ts`): which codebase-type values fall into Backend, Frontend and Shared libraries is `VULN_CODEBASE_GROUPS`, deployment configuration (default `{"backend":["backend"],"frontend":["frontend"],"shared":["shared"]}`). Other = every in-scope value not listed in any group, including null. All = everything.
- **Unmeasured repos** — an in-scope repo whose `dependabot_status` is `error` **or** `dependabot-off` (`isUnmeasured()` in `aggregate.ts` — the one place this decision is made, so the pivot, the repository rows and the coverage lists can't drift apart). Its stored alerts still count, but every team row/total it belongs to carries `unmeasured_repos: N` so a team can never look clean because Dependabot stopped reporting for one of its repos. A `dependabot-off` repo (GitHub's exact pinned 403 message, `DEPENDABOT_OFF_MESSAGE` in `github.ts`) is unmeasured the same way an `error` repo is, but is **not** a sync issue and never makes a run `partial` by itself — the drawer's Unmeasured group labels it "Dependabot off" instead of showing a GitHub error message.
- **Repository rows** (`computeRepoRows` in `aggregate.ts`, GLOOK-64): one row per in-scope, non-archived repository in the view, with each severity's open, overdue and due-soon counts. It is built on the same `viewRepos`, `isOpen` and `computeDue` as `computePivot`, so the rows sum to the pivot (below). An unmeasured repository carries its **stored** counts.
- Attribution is always by the repo's **current** `team`/`service_tier`/`codebase_type` — history is re-scoped, not frozen (the `*_at_time` snapshot columns are audit-only).

**Definitions used verbatim by the UI, API and MCP:** the unit is the Dependabot **alert**, not the CVE (one CVE across five manifests is five alerts). "Resolved" (not "fixed") covers fixed/dismissed/auto-dismissed, always shown with a dismissed sub-count. "% closed" = `resolved / (open + resolved) × 100`, rounded to a whole percent; "—" in the UI / `null` in MCP at a zero denominator. "Age" is whole UTC days from `created_at` to now (open) or to the resolution timestamp (resolved). "Overdue" = open AND `days_remaining < 0`; "Due soon" = open AND `0 ≤ days_remaining ≤ 7`.

### Repository rows and the sum invariant

`computeRepoRows(alerts, repos, { codebase, team?, now })` is pure and returns one `RepoRow` per in-scope, non-archived repository in the view, including repositories with no open alerts:

```ts
interface RepoSevCell {
  open: number;
  overdue: number | null;          // null unless this severity's SLA is active
  dueSoon: number | null;          // null unless this severity's SLA is active
  oldestOpenDays: number | null;   // max age of open alerts (UTC days, floor 0)
  nextDue: { date: string; daysRemaining: number } | null; // earliest due date not yet overdue; null unless SLA active
}
interface RepoRow {
  fullName: string; team: string; codebaseGroup: Exclude<CodebaseGroup, 'all'>;
  critical: RepoSevCell;
  high: RepoSevCell;
  unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null;
}
```

- **Row order is fixed inside the function:** measured rows by critical open descending, then high open descending, then `fullName`; then unmeasured rows by `fullName`. The page re-sorts for the rail and the sortable table, but the API and MCP order is this one.
- **Unmeasured rows carry their stored counts.** That keeps the invariant below exact. The page renders an unmeasured row's open count as unknown, never as zero; the MCP description says "for a row with `unmeasured` set, `open` is the stored count and may be out of date".
- Resolved, dismissed, % closed and carried-resolved figures are deliberately not in repository rows. The page combines "both severities" client-side, because the rows carry each severity separately.
- The same SLA gate decides whether a severity is active in `finish()` (the pivot) and in `computeRepoRows`, so the two can never disagree.

**The invariant.** For any filters, per team and per severity:

1. The sum of the team's repository rows for `open`, `overdue` and `dueSoon` equals that team's pivot cell.
2. When a severity's SLA is inactive, `overdue` and `dueSoon` are `null` in both the rows and the pivot.
3. The number of the team's rows with `unmeasured` set equals the team's `unmeasuredRepos`.

It is checked three ways: over the mock fixtures and several filter combinations (`vuln-repo-rows-invariant.test.ts`, `vuln-seed-repo-rows.test.ts`); against an independent source, where each repository's `open` equals the `totalCount` of `listAlerts({ state: 'open', repo })` for that repository (`vuln-queries.test.ts`, through the real database); and in the MCP tool's tests. The fixtures include an unmeasured repository that has stored alerts.

**What a page figure includes.** Every total that is a count of alerts includes the stored counts of unmeasured repositories, because counting rules are unchanged: the team table's rows and Total row, the Alerts strip, the rail's "All" row, the Alerts tab count and the alert list's "N alerts" all agree with each other and with the pivot. The Repositories tab's footer follows the same rule: its Open and Overdue columns sum every row in view, an unmeasured repository's stored counts included, so the footer equals the team table's figure for the same team. Only an unmeasured row's own cells read unknown. The footer's repository count, Oldest open and Next due use the measured rows only: they are not part of the sum invariant, and a stored age or due date may be out of date. The footer's second line says how many repositories are unmeasured: "N unmeasured: totals include stored counts". The mock data has an unmeasured repository with stored alerts, so this is exercised there.

`computeCodebaseCounts(alerts, repos, { team?, now })` returns `Record<CodebaseGroup, { critical: number; high: number }>` including `all`. It ignores the `codebase` filter and honours `team`, and a repository with no codebase type counts under `other` and `all`, exactly as `inCodebaseView` places it, so `counts[c]` equals the pivot's total open for `codebase = c`. The summary carries it as `codebaseCounts`.

`computeCoverage` takes a `codebase` option and filters its three lists by codebase group (a null codebase type counts under Other and All). The header coverage line and the drawer read the same response.

## Alert sort and offset

`listAlerts` (`aggregate.ts`) sorts and slices in memory, for the page and for MCP. There is no SQL `LIMIT` or `OFFSET`, because binding a JS number there fails on MySQL 8.0.22+; paging is `slice(offset, offset + limit)` over the sorted hits.

| Rule | Value |
|---|---|
| Sort keys (a closed list, `alert-sort.ts`, matching the alert-list columns) | `severity`, `advisory`, `repo`, `age`, `due`, `state` |
| Format | `sort=<key>:<asc\|desc>`, e.g. `due:asc` |
| Nulls | Last in both directions |
| Tie-break, always applied last and never reversed | repository full name, then alert number |
| No `sort` given | soonest due, then severity, then newest, then the tie-break |
| `offset` | default 0; a non-negative integer, validated by `parseVulnFilters` |
| `offset` at or past the total | empty `rows`, exact `totalCount` |
| `truncated` | `offset + rows.length < totalCount` |
| `limit` | default 100, capped at 500, applied per page; the page sends 10 |

`offset` and `sort` join `ALERT_FILTER_KEYS`, so they appear in `appliedFilters`. The `repos` facet that `list_vulnerabilities` returns is not affected by `offset`, `limit` or `sort`. The list pages on the server because resolved alerts are never deleted, so "Resolved" and "Open + resolved" will exceed the 500-row cap over time, and client-side paging would then silently misorder rows. `AlertRow.lastReopenedAt` is the ISO instant of the latest reopen, shown as a UTC date.

## Sync phases and statuses

`sync.ts`: a run is a **fetch phase** (nothing written) followed by **one write transaction** (`db.transaction()`), so a run that fails before the transaction commits leaves every vulnerability table exactly as it was.

1. **Start** — an in-process `globalThis` flag (`scheduler.ts`) is checked and set synchronously before the first `await`, so a second trigger gets `409` and a scheduled tick is skipped and logged. A `vulnerability_syncs` row is inserted with `status = 'running'`. On boot, `initVulnerabilityScheduler()` marks any leftover `running` rows `failed` ("interrupted by restart"), the same pattern as report schedules. Immediately before that insert, a **watchdog** (`startSync()` in `scheduler.ts`) marks any `running` row for this org older than **2 hours** `failed` ("still running after 2h") — it isn't a timer, it only runs at the start of the next sync attempt. It has no effect on the `isSyncRunning()` in-process flag that `listSyncs().running` (and so the "Sync alerts"/"Sync running…" button) reads — that flag is already `false` after any process restart, since in-memory state doesn't survive a crash. What it actually fixes is the orphaned `vulnerability_syncs` **row**: without it, a run whose process died mid-sync (skipping `initVulnerabilityScheduler()`'s boot-time cleanup, e.g. because something other than a fresh boot restarted the process) would leave that row's `status = 'running'` forever, and the syncs tab would render it as a running card indefinitely — the progress endpoint's DB fallback shows a generic "Running…" step with no logs, since the in-memory progress store doesn't survive the crash either — even though nothing is actually running.
2. **Fetch: repos** — `GET /orgs/{org}/repos` (ids, `archived`, names) and `GET /orgs/{org}/properties/values` (team, tier, type).
3. **Fetch: alerts** — `GET /orgs/{org}/dependabot/alerts?severity=critical,high&state=open,fixed,dismissed,auto_dismissed`, paged manually by following the `Link` header's `rel="next"`, each page wrapped individually in `withRetry` (not one `withRetry` around the whole pagination loop — a rate limit would otherwise restart every page).
4. **Fetch: zero-alert repos** — for each in-scope repo with no alerts from step 3, one call to `GET /repos/{o}/{r}/dependabot/alerts?per_page=1`: `200` → `ok`; a 403 with the exact archived-repo message → `archived`; a 403 with the exact message `Dependabot alerts are disabled for this repository.` → `dependabot-off` (unmeasured, but **not** recorded as an `issues` entry and never makes the run `partial` on its own); anything else → `error` (unmeasured), recorded as an `issues` entry.
5. **Write, in one transaction** — upsert repos; upsert alerts (recording reopens via `reopened_count`/`last_reopened_at` and severity changes via `severity_changed_at`; seen alerts get `missing_since` and `withheld_since` cleared); the **completeness guard** (below); set `dependabot_status`; write snapshots; write the sync counters.
6. **Finish** with one of three statuses: `succeeded` (clean — a run whose only non-`ok` repos are `dependabot-off` is still `succeeded`), `partial` (a **non-informational** issue exists — some step-4 checks returned `error`, the completeness guard withheld a candidate this run, or the repo listing was proven incomplete this run, see below), or `failed` (step 2/3 didn't complete, or the transaction rolled back — **nothing was written except the sync row itself, and a failed run is never a delta baseline**).

**Every request the vulnerability module makes to GitHub carries a 60s timeout** (`VULN_GITHUB_TIMEOUT_MS` in `github.ts`, via `request: { signal: AbortSignal.timeout(60_000) }` on `fetchAllPages`'s two calls and `getRepoDependabotStatus` — the shared Octokit instance and every report-path call are untouched). Before this, a hung request (no response, no error — the connection just never completes) had no rate-limit header and no HTTP status, so `withRetry`'s classification never fired and the request waited forever, keeping `isSyncRunning()` true until the process restarted. `AbortSignal.timeout` rejects the underlying `fetch` with a `TimeoutError`, not `AbortError` (that name is reserved for a signal aborted by an explicit `controller.abort()` call). `@octokit/request`'s fetch wrapper only special-cases the literal name `AbortError` — rethrowing it as-is with `error.status = 500` added — so a `TimeoutError` instead falls through to the wrapper's generic branch, which wraps it in a `RequestError` with `status: 500`. Either way `withRetry` classifies the failure as a transient 5xx and retries it (up to 3 attempts) rather than as a rate limit or network error — a final timeout still fails the run visibly, just after that shallow retry budget, the same as any other transient failure.

**Issue kinds and the informational rule** (`sync.ts`, `INFORMATIONAL_ISSUE_KINDS`/`assembleIssues()`): every issue recorded in a sync row's `issues` column has a `kind`. Two kinds are **informational** — `data-sanitized` (below) and `completeness-recovered` (below) — and never by themselves make a run `partial`; every other kind (`fetch`, `repo-status`, `completeness`, `repo-list-incomplete`, `write`) does. Issues are always assembled non-informational-first, informational-last, so a fatal issue (`fetch` on a failed fetch phase, `write` on a rolled-back transaction) is always `issues[0]` regardless of what else was collected. This mirrors the `countableSkips()`/`COUNTABLE_SKIP_CLASSIFICATIONS` pattern in `report-runner/types.ts`: one named, explicit set decides which kinds count, so a future issue kind is a deliberate decision, not a default.

**4-byte characters and utf8mb3** (`bmpOnly()` in `github.ts`): dev's MySQL database is utf8mb3 (charsets are never pinned — see the root `CLAUDE.md`), and inserting a 4-byte UTF-8 character (an emoji, most supplementary-plane CJK) into any `TEXT`/`VARCHAR` column fails with `ERROR 1366 Incorrect string value`, rolling back the whole write transaction — one emoji anywhere in a GitHub alert summary, dismissed reason, package name, or repo/team/tier/type value is enough to fail the entire daily sync. `bmpOnly()` replaces every code point above U+FFFF with U+FFFD, and runs on every string field **before** `clip()` wherever both apply (`mapAlert`, `listOrgReposForVulns`, `listOrgRepoProperties`) — so `clip`'s `slice()` can never split a surrogate pair either, since bmpOnly has already collapsed it to one code unit. How many values were sanitized (and separately, how many were clipped to their column limit) is reported up through an optional `onDataNotice` callback threaded through `fetchPhase()` in `sync.ts`, and rolled into one informational `data-sanitized` issue (`"N values had 4-byte characters replaced and M were clipped to column limits"`) when the total is nonzero.

**The completeness guard** (`writePhase()` in `sync.ts`, GLOOK-50 lesson): a stored **open** alert that this sweep didn't see is a *candidate* to be marked `missing_since`. Every candidate is first split into two kinds:
- **Explainable** — its repo is no longer in this sweep's repo list, or is archived in this sweep — **unless the repo listing itself is proven incomplete this sweep** (below), in which case an absent-repo candidate loses its explainable status; an archived-in-this-sweep repo stays explainable regardless, since archival is observed directly on the repo row rather than inferred from absence. Explainable candidates are **always** marked missing immediately, guard or no guard.
- **Unexplained** — everything else: the alert was re-rated below high (falls outside the severity filter), its advisory was deleted upstream, a truncated/broken sweep failed to return it, or its repo is absent from a repo listing that is itself proven incomplete this sweep. A genuinely *resolved* alert never becomes a candidate at all — step 3 fetches `state=open,fixed,dismissed,auto_dismissed`, so a real fix/dismiss is still returned and diffed normally (counted as `resolved_count`), not treated as missing. A large batch of unexplained candidates is much more likely a broken/truncated sweep (a paging bug, a truncated response) than that many alerts genuinely re-rated or deleted between two syncs.

The guard trips when the count of **fresh** unexplained candidates (never withheld before) exceeds `max(50, 5% of the prior open count)`. When it trips: fresh unexplained candidates get `withheld_since` set instead of `missing_since` (their `state` stays `open` everywhere — they still count as open in every KPI, pivot and alert-list figure), the run finishes `partial`, and a **non-informational** issue of kind `completeness` is recorded with the candidate count and the prior-open count. **Recovery:** an unexplained candidate that was *already* carrying `withheld_since` from an earlier withheld run is marked missing on this run regardless of whether the guard trips again this time — unseen on two consecutive *committed* runs (a failed run neither counts nor resets this) is treated as proof it's real, and it's marked missing on that second run, recording an **informational** `completeness-recovered` issue (`"N previously withheld alerts marked missing after two consecutive sweeps without them"`) — it doesn't make the run `partial` by itself, but it isn't silent either. Only fresh (never-withheld) unexplained candidates count toward the trip threshold, so a candidate recovered this run can't re-trip the guard. This is what keeps the guard from wedging forever on a permanently-reduced count — a one-shot guard (no recovery) would instead stay tripped forever after any legitimate mass drop above the threshold (a mass re-rating below high, or a batch of upstream deletions — archival is always explainable, so it never drives a trip either way).

**Repo-listing incompleteness:** the repo listing (`f.repos`, from step 2) is treated as proven incomplete for this run when either a fetched alert's `repoId` is not in it, or a repo in the properties listing (also step 2) is missing from it — either is proof the listing itself dropped a repo that GitHub otherwise still knows about. When that holds, `writePhase()` records a **non-informational** `repo-list-incomplete` issue (the run is `partial`) and, as described above, no longer trusts "absent from the listing" as a self-evident explanation for a candidate's disappearance. Without this, a broken repo listing could make the guard blindly mark a batch of alerts missing by classifying them as "repo genuinely gone" when the listing itself was the thing that was broken.

**What an operator sees:** the syncs tab (Reports → Dependabot alerts) shows `partial` plus the issue messages; `missing_count` jumps on whichever later run finally marks the recovered alerts missing. MCP callers see `sync.last_status: "partial"` and the same issues in `sync.issues`. **The `/vulnerabilities` dashboard shows nothing for a `partial` run at all** — its header shows only staleness (amber past 36h) and its failed-sync banner renders only when `lastStatus === 'failed'`; nothing on the page reads `partial`. A withheld completeness sweep, a repo-list-incomplete run, or a step-4 repo-status error is visible only in the syncs tab and in MCP's `sync.last_status`.

**Sync counters** (`new_count`, `resolved_count`, `reopened_count`, `missing_count`) are per-run transitions computed while diffing against stored rows. On the **first** sync all four are `null` (the UI shows "initial import") — otherwise the first sync would report every stored alert as "new".

**Failure handling** follows the GLOOK-48/GLOOK-50 pattern: rate limits are handled by `withRetry` per page (primary waits for the reset; secondary escalates 60s→300s); a genuine permission 403 (not a rate limit — see `permissionMessage()` in `sync.ts`) fails the run immediately with a plain, actionable message instead of burning the retry budget.

**Scheduling** (`scheduler.ts`) — one `croner` job registered from `instrumentation.ts` after `initScheduler()`, under its own `globalThis` key so it survives Next.js HMR. Assumes a single app instance (same as report schedules; not solved here). A hung run *in this same process* is not covered by the 2h watchdog above — it keeps `isSyncRunning()` true only until its GitHub requests time out (per the 60s-timeout note above); the watchdog exists for `vulnerability_syncs` rows orphaned by a different or dead process.

## Facts cache

`queries.ts`'s `loadFacts()` caches repos and alerts in a single module-level entry, keyed by `` `${org}:${latest succeeded/partial sync id}:${repo count}` `` (`factsCacheKey()`). **The key changes on a succeeded or partial sync** (either one writes a new `MAX(id)`-eligible `vulnerability_syncs` row; a `failed` run does not, since its status is filtered out of the `MAX(id)` query — a failed sync never moves the key), **or when the repo count changes**. A CSV import changes the key only when it adds a new repo row (the repo count moves) — an import that only adds snapshot/history rows for repos already known doesn't invalidate the cache. **This is the one place that caveat now has a real, user-visible edge:** a CSV re-import of a repo Glooker already has a row for can change that repo's `carriedResolvedCritical` (a later or corrected snapshot), but since it doesn't move the repo count, the cached `RepoFact[]` isn't refreshed by it — the corrected carry only reaches the dashboard after the next sync (any succeeded/partial run moves the key) or a server restart (the cache is a module-level, in-process variable). Re-querying every alert on every dashboard request would otherwise be pure waste on a large org. Alerts are cached separately from the key computation, so the trend endpoint's `loadAlerts: false` path never runs the alerts query at all, not even once to warm an entry it doesn't need. A single entry is enough because this module is per-process and, per the spec, targets one org. `__clearVulnFactsCache()` is test-only, forcing the next call to reload from the DB.

The cache holds **in-flight promises**, not resolved values — every concurrent caller for the same key awaits the same promise, so there's no window where one caller's write lands on a different caller's entry. A rejected load evicts its entry (only while it's still the current one), so a later call retries instead of being stuck on a poisoned entry.

**After `npm run seed:reset` against a running dev server, restart the server.** `seed:reset` is `rm -f glooker.db && tsx scripts/seed.ts` — it deletes the SQLite file and a separate `tsx` process recreates it. A dev server that was already running still holds its database handle open on the deleted file (POSIX lets a process keep reading/writing an unlinked file by its old inode), so it never sees the freshly seeded data at all until it's restarted and reopens the path.

## SLA policy and org taxonomy (deployment configuration)

The SLA policy, the resolved-count start date, the tracking scope and the custom-property taxonomy are **deployment configuration**, not code. Glooker is public; a deployment's policy dates and property names are its own business. They're set as environment variables in the deployment's own (private) configuration. Keep these values in version-controlled deployment configuration so each change is reviewed and has a history. The public code ships neutral defaults.

`src/lib/vulnerabilities/config.ts` owns the neutral defaults, parsing and validation, and memoizes the result once per process (test-only reset: `__clearVulnConfigCache`). **Agents changing the code** — the recipes and rules below, plus which call sites read configuration instead of a literal — live in `src/lib/vulnerabilities/CLAUDE.md`. Real values never enter this repo.

| Variable | Meaning | Default when unset |
|---|---|---|
| `VULNERABILITIES_SLA_POLICY` | JSON array of SLA entries `{ id, severity, effectiveFrom, days }` | `[]`: no due dates ("No SLA policy yet") |
| `VULN_RESOLVED_SINCE` | `YYYY-MM-DD`; "Resolved" counts only resolutions on or after it, both severities | unset: resolved counts cover all time, and the caption says so |
| `VULN_TEAM_PROPERTY` | custom-property key holding a repo's team | `team` |
| `VULN_TIER_PROPERTY` | custom-property key holding a repo's service tier | `service_tier` |
| `VULN_TIER_IN_SCOPE` | the tier value that's tracked | `production` |
| `VULN_CODEBASE_PROPERTY` | custom-property key holding a repo's codebase type | `codebase_type` |
| `VULN_CODEBASE_GROUPS` | JSON object: page group (`backend`, `frontend`, `shared`) → list of values of the codebase-type property. Unlisted values fall into **Other**. | `{"backend":["backend"],"frontend":["frontend"],"shared":["shared"]}` |

Synthetic example (the same one ships in `.env.example`):

```
VULNERABILITIES_SLA_POLICY=[{"id":"critical-2099-01","severity":"critical","effectiveFrom":"2099-01-07","days":7}]
VULN_RESOLVED_SINCE=2099-01-01
VULN_CODEBASE_GROUPS={"backend":["service"],"frontend":["web","mobile"],"shared":["library"]}
```

**Cutover: the defaults are for fresh installs.** An existing deployment **must** set the taxonomy variables (`VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_TIER_IN_SCOPE`, `VULN_CODEBASE_PROPERTY`, `VULN_CODEBASE_GROUPS`) to its own org's property keys, in-scope value and codebase groups before (or with) the release that reads them — the neutral defaults will not match an existing org's properties. Deploy order: add the variables to the deployment first (the running image ignores unknown variables), then roll out the image that reads them. The sync-time guard below is the backstop.

**Sync-time guard for the taxonomy.** Whether a property key exists or a value matches can only be known against real GitHub data, so the sync checks it. Each of these records a **non-informational** sync issue (kind `config`), which makes the run `partial`:
- a configured property key (team, tier or codebase type) appears on no fetched property row;
- no repo's tier equals the configured in-scope value;
- no in-scope repo's codebase type matches any configured group (everything would land in Other, and the default Backend view would be empty).

The message names the variable, never its value.

**Validation, loud and never silent.**
- **Messages never echo a value.** They carry the variable name, the entry **index** (1-based, never the id, which encodes a severity and a month), and the rule — never the raw value, never `JSON.parse`'s own message text. A duplicate-id error names both indices. This applies to every `VULN_*`/`VULNERABILITIES_*` variable, scalars included, and to startup messages, sync-guard messages and the `configErrors` channel alike.
- Invalid JSON: `Invalid JSON in VULNERABILITIES_SLA_POLICY env var` (same shape for `VULN_CODEBASE_GROUPS`).
- Valid JSON that breaks a rule names the entry by index, e.g. `VULNERABILITIES_SLA_POLICY: entry 2: days must be > 0`. The rules: unique ids; ids match `<severity>-<YYYY-MM>`; `severity` is `critical` or `high`; `effectiveFrom` and `VULN_RESOLVED_SINCE` are valid calendar dates; `days` is a positive integer; `effectiveFrom` strictly increases per severity in array order; a codebase value appears under at most one group; only the three known group names.
- An unrecognised variable starting with `VULN_` or `VULNERABILITIES_` produces a startup warning, so a misspelled name doesn't silently mean "unset".
- **Invalid SLA policy:** no SLA is applied, and the error shows on the `configErrors` channel below. It never silently falls back to "no SLA".
- **Invalid `VULN_CODEBASE_GROUPS`:** falls back to the default mapping, with the error shown.
- **`VULN_RESOLVED_SINCE`:** when unset, the resolved-date condition is omitted (never compared against null); the summary field is `null` (MCP `resolved_count_start_date: null`) and the caption reads "all time". When invalid, resolved counts and % closed render as "—" and the error shows — never as all-time figures, which would overstate progress.
- One rule can't be checked by a stateless validator: **never edit an entry that has already taken effect.** The review of the configuration change is its guard.

**The `configErrors` channel.** Every endpoint's shared preparation step (`prepare()` in `queries.ts`) attaches `configErrors` to the envelope, so the summary, alerts, coverage and trend APIs all carry it (`config_errors` in every MCP tool): a list of `{ source: 'startup' | 'sync', variable, rule, at? }`, with no value field, so the no-echo rule holds by construction. Startup entries come from the memoized validation and clear on restart. Sync entries come from the `config` issues of the latest run that reached the guard (succeeded or partial; a run that failed before the guard doesn't clear them), carry that run's finish time, and clear on the next such run. Startup entries come first; no de-duplication across sources. The dashboard's red banner reads the list and says when a sync entry will clear ("clears after the next successful sync"). An overdue list computed under a broken policy therefore never looks like "nothing is overdue".

**How a due date is computed** (`sla.ts`, pure, at read time, never stored): `clock_start = max(created_at, first policy effectiveFrom for that severity, severity_changed_at if re-rated upward)`. A reopen never moves the clock — an alert reopened after its due date is overdue immediately, because the fix didn't hold. Downward re-ratings (critical → high) follow the lower severity's policy. `due_date = date(clock_start) + days`.

The drawer's policy section derives each entry's window, e.g. "critical-2099-01 · 7 days · 2099-01-07 → open-ended", and marks entries that haven't started yet as *pending*. With no entries it says "No SLA policy yet"; with an invalid policy it says "SLA policy can't be read". Every other place the page shows an SLA state uses the same four wordings (see "SLA states").

### The policy-change playbook

The rules live in Glooker, public and value-free: this document (for operators) and `src/lib/vulnerabilities/CLAUDE.md` (for agents changing the code). A deployment's own configuration holds the values and a pointer to these rules; it doesn't restate the rules the validator enforces, so the two can't drift.

**The one exception: the two rules no code can check** — repeat these word for word beside the policy variable, wherever it's set. Consider adding the two rules to your change-review checklist:
1. Never edit or delete an entry that has taken effect; append a new entry with a later `effectiveFrom`.
2. Choose `effectiveFrom` in the future, so teams get notice.

1. **What each variable does to existing numbers:**
   - `VULNERABILITIES_SLA_POLICY` sets due dates. Due dates are computed at read time, so editing an entry that has taken effect silently moves deadlines teams were already given.
   - `VULN_RESOLVED_SINCE` sets every "resolved since" and "% closed" figure. Changing it also makes imported history inconsistent, because its resolved column was computed against the date in force when it was produced.
   - **Property keys** (`VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_CODEBASE_PROPERTY`) act at **sync time**: a change affects future syncs only; rows already stored keep the values read under the old key until the next sync overwrites them.
   - **`VULN_TIER_IN_SCOPE` and `VULN_CODEBASE_GROUPS`** act at **read time**: they re-scope all history immediately. One exception: the in-scope check also decides, during a sync, which zero-alert repos get their Dependabot status checked, so `unmeasured`/`dependabot-off` statuses catch up only after the next sync.
2. **Recipes:**
   - **Turn on a severity's SLA:** append an entry with a future `effectiveFrom`.
   - **Change a window:** append a new entry for the same severity with a **later** `effectiveFrom`. Never edit or delete an entry that has taken effect.
   - **Choose `effectiveFrom`** in the future, so teams get notice. The validator can't compare it with the deploy date, so it's a stated rule.
   - **Id convention:** `<severity>-<YYYY-MM>`.
3. **Guards:** the startup validator enforces every rule it can check (listed above); the sync-time guard catches taxonomy mismatches. `vuln-config.test.ts` unit-tests the validator over synthetic fixtures (one per rule, plus the no-echo rule). `vuln-sla.test.ts` keeps the due-date example table with synthetic policies (created before the policy starts, after it starts, across a policy change, reopened, re-rated up and down).

## MCP tools and the availability contract

Five read-only tools, registered in `src/lib/mcp/tools.ts`, calling the same `queries.ts` functions the API uses:

- `list_vulnerabilities` — filtered alert rows plus `total_count`, `truncated`, `applied_filters` (including defaults), `excluded_by_codebase` (how many alerts match every filter except the `codebase` default, so a frontend team's criticals don't look clean just because the default view is Backend), and `repos` (`RepoFacetRow[]` in `aggregate.ts`: distinct repos with their counts, matching every filter except `repo` itself and ignoring `limit`, `offset` and `sort`). The facet follows every list filter (state, severity, overdue, …), so it is not a per-repository open count; use `list_vulnerability_repos` for that. Pages with `limit` (default 100, max 500 per page) and `offset`, ordered by `sort` (see "Alert sort and offset"). Each row carries `last_reopened_at`.
- `get_vulnerability_summary` — the per-team pivot plus the delta since a baseline and the SLA policy in effect; carries `resolved_count_start_date` at the top level and `codebase_counts` (open critical and high for every codebase group and `all`, ignoring `codebase`, honouring `team`). `resolved` includes `carried_resolved` from imported CSV history for archived repos with no alert data in Glooker. `kpi.open_critical_other_codebases` is still in the payload; the page no longer shows it.
- `get_vulnerability_trend` — measured points only (no reconstructed history).
- `get_vulnerability_coverage` — the three coverage lists, filtered to the `codebase` group. **It defaults to `backend`, like every other tool**; before GLOOK-64 it returned every codebase, so a caller that relied on that must pass `codebase=all`.
- `list_vulnerability_repos` — every tracked, non-archived repository in the `codebase` and `team` scope, including repositories with no open alerts. Each row (snake_case) has `full_name`, `team`, `codebase_group`, per-severity `critical` and `high` objects (`open`, `overdue`, `due_soon`, `oldest_open_days`, `next_due: { date, days_remaining }`) and `unmeasured` (`{ status, detail }` or `null`). `overdue: null` (and `due_soon`, `next_due`) means that severity's SLA is not active, not zero. A row with `unmeasured` set has `open` equal to the stored count, which may be out of date: report it as unknown. Rows are in the `computeRepoRows` order; for each team and severity they sum to that team's `open`, `overdue` and `due_soon` in `get_vulnerability_summary`. Returns `rows`, `total_count` and `truncated` (true when there are more rows than `limit`, default 100, max 500). It reads `getRepos`, the same function as `GET /api/vulnerabilities/repos`, so it returns the page's figures.

**HTTP is camelCase, MCP is snake_case.** The HTTP API (`totalCount`, `lastSuccessfulAt`, `dueDate`) is consumed only by the UI; MCP responses use snake_case (`applied_filters`, `sync.last_successful_at`, `unmeasured_repos`) because that's the convention MCP callers expect. One recursive key mapper at the MCP boundary (`toSnake()` in `src/lib/mcp/tools.ts`) does the conversion — it rewrites keys only, never values, so team/repo names pass through unchanged. This split is deliberate (see the spec's API section); don't try to unify the two.

**Filter validation** — `offset` must be a non-negative integer and `sort` must be `<key>:<asc|desc>` with a known key, or the call returns an error; an unknown `team` returns `{ error: "unknown team", known_teams: [...] }` rather than a silently empty result. `codebase` defaults to `backend`, and `excluded_by_codebase` makes that default visible instead of hiding it.

A `repo` filter on `list_vulnerabilities`/`GET alerts` distinguishes two failure modes: a `repo` Glooker has never seen returns `{ error: "unknown repo" }`; a `repo` Glooker knows but whose current tier value isn't the configured in-scope value returns a distinct `{ error: "repo not tracked", repo, service_tier }` (the payload field is always named `service_tier`, whatever the configured tier property key) — the alerts endpoint is the only one that filters by repo, so this check lives only there.

**Team validation is scope-aware and differs by endpoint.** Summary, trend and alerts validate a `team` filter against **in-scope** repos only (`knownTeams()` — the configured in-scope tier). The coverage endpoint validates against **every** team Glooker has ever seen, in scope or not (`prepare(f, now, { teamScope: 'all' })`) — coverage exists specifically to surface out-of-scope and untagged repos, so an out-of-scope team's name must not read as "unknown" there the way it would on the other three endpoints.

**Availability contract** (mirrors the `{ available: false }` precedent in `projects/insights.ts`):

| State | Response |
|---|---|
| Feature off | `{ available: false, reason: "Vulnerability tracking is not enabled on this Glooker instance." }` |
| No successful sync yet | `{ available: false, reason: "No successful vulnerability sync yet.", sync: { … } }` |
| Synced | data plus `sync: { last_successful_at, stale, last_status, issues_count, issues: [first 5] }` |
| Latest run failed, an earlier one succeeded | data from the last good run, with `stale`/`last_status: "failed"` |

`stale` is true when the last success is more than 36 hours old. Tool descriptions (`VULN_COMMON` in `tools.ts`) tell agents to check `available` and `sync.stale` before reporting numbers — a failed or partial sync must never be reported as zeros.

## CSV import

Historical per-repo snapshots can be loaded from an external source into `vulnerability_repo_snapshots` with `source = 'csv-import'`. The trend card, the baseline picker and the carried-resolved rule read these rows exactly as they read a sync's own snapshots. The importer itself is a local-only tool and is not part of this repository.

## Env vars and token permissions

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VULNERABILITIES_ORG` | enables the feature | unset (off) | GitHub org login, e.g. `your-org`. When unset: the page and every `/api/vulnerabilities/*` route return 404, the NavBar link is hidden, and no cron job is registered. |
| `VULN_SYNC_CRON` | no | `0 6 * * *` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |
| `VULN_SYNC_TZ` | no | `America/New_York` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |

`GITHUB_TOKEN` needs the usual scopes plus, for the org Dependabot endpoints specifically: the account must be an **org owner or security manager**, with **Dependabot alerts: read** and org **Custom properties: read**. Only required when `VULNERABILITIES_ORG` is set.

**Deployment requirement:** the token must have access to **all** of the org's repos, not a subset — a fine-grained token scoped to a selected-repos list makes every run come back `partial` with a `repo-list-incomplete` issue (see [Repo-listing incompleteness](#sync-phases-and-statuses) above).

## Mock mode

```
npm run seed:reset && npm run dev:mock
```

`dev:mock` sets `VULNERABILITIES_ORG=mock-org` (otherwise the feature would be off in mock mode, since `package.json` doesn't set it by default). `github-mock.ts` implements the new `VulnerabilitySource` methods with fixture alerts covering both severities, all four states, a reopened alert, an alert that disappears between two sweeps, an archived repo, an untagged repo, an out-of-scope repo, one repo whose status check errors (unmeasured), and one repo whose status check returns `dependabot-off` (also unmeasured, but never a sync issue). GLOOK-64 added ten more owning teams (so the Backend view lists more than 12 and the "Other · N teams" legend entry shows), a repository with nothing open (`quiet-service`, the greyed zero-alert row) and an unmeasured repository that still has stored alerts (`stale-scanner`, flagged after the seed runs, so its open count is unknown rather than zero). Repo `team` values live in `scripts/mock-identities.ts` (`MOCK_VULN_REPOS`) as plain strings — not rows in Glooker's `teams` table.

`scripts/seed-vulnerabilities.ts` (called from `scripts/seed.ts`) seeds by running the real sync against the mock provider: two good syncs 3 and 2 days ago (so the page shows **stale**), a failed run 1 day ago (so it shows the **failed-sync banner** while still serving the last good run's data), and eight weeks of backend-only CSV-style snapshots for the trend card (using each fixture repo's own `archived` flag, so an archived fixture repo's history is archived too). It skips itself if either `vulnerability_syncs` or `vulnerability_repo_snapshots` (`source = 'csv-import'`) already has rows — checking both means an interrupted run (one table written, not the other) can't double the CSV history on a plain re-`seed`; `seed:reset` is still the way to rebuild from scratch.

`dev:mock` also sets a synthetic, already-in-effect `VULNERABILITIES_SLA_POLICY` (both severities, `effectiveFrom` in the past) and a `VULN_CODEBASE_GROUPS` with a multi-value group, so overdue rendering (red due date, Overdue column) and a non-default codebase mapping are both visible without editing any file. Overdue rendering is also covered directly by jsdom component tests that render rows from the real `listAlerts` with a `now` after the due date. `vuln-seed-repo-rows.test.ts` runs the real seed into a throwaway database and checks that the seeded data exercises every repository-row state and that the rows still sum to the pivot.

The headless measurement in "Layout stability" runs against a production build with `dev:mock`'s environment and a seeded database: seed with `npm run seed:reset` (or `npx tsx scripts/seed.ts` with `SQLITE_PATH` pointing at a scratch file), then start the built app with the same environment variables `dev:mock` sets.

## Rollout

All of this happens **before** `VULNERABILITIES_ORG` is set in prod — the feature stays off (see Env vars above) until it's confirmed working.

**Pre-prod gate**, after the dev deploy:

- `SHOW TABLES LIKE 'vulnerability_%'` returns 4.
- The deploy logs contain no "Failed to create a vulnerability table" (the `schema.sql` charset gotcha in the root `CLAUDE.md` — `initSchema()` catches and logs DDL failures instead of throwing, so a broken table creation is otherwise silent).
- The syncs tab (`?tab=syncs` on the Reports page) loads.

**Rollout step 2 comparison** — per repo, Backend view, first sync, run against the real org once the first sync has completed:

```sql
SELECT s.full_name, s.open_critical, s.resolved_critical_since_start
FROM vulnerability_repo_snapshots s
JOIN vulnerability_repos r ON r.repo_id = s.repo_id
WHERE s.sync_id = <first sync id>
  AND r.service_tier = <configured VULN_TIER_IN_SCOPE value>
  AND r.codebase_type IN (<configured VULN_CODEBASE_GROUPS.backend values>)
ORDER BY s.full_name;
```

## Key files

| File | Purpose |
|------|---------|
| `src/app/vulnerabilities/page.tsx` | Server component, feature gate (404 when disabled) |
| `src/app/vulnerabilities/vulnerabilities-content.tsx` | Client composer: URL state, data, drawer state, full-page states, the view switch |
| `src/app/vulnerabilities/security-state.ts` | URL schemas, `kSev`, `useSecurityUrl`, `useAlertList`, `scopeOpenCount`, `alertsQueryString`, the sanitising rules |
| `src/app/vulnerabilities/use-security-data.ts` | Every SWR key (`securityKeys()`), the stale-repository status, sync-time reconciliation |
| `src/app/vulnerabilities/dimensions.ts` | The fixed sizes, written once (see "Layout stability") |
| `src/app/vulnerabilities/sla-state.ts` | The four SLA states and their wording |
| `src/app/vulnerabilities/security-header.tsx`, `filter-bar.tsx`, `view-tabs.tsx`, `coverage-drawer.tsx` | Header card, sticky bar, view tabs, the Coverage & policy drawer |
| `src/app/vulnerabilities/kpi-tiles.tsx`, `sparkline.tsx` | Overview KPI tiles and the 90-day sparkline |
| `src/app/vulnerabilities/ownership-card.tsx`, `team-table.tsx`, `repo-table.tsx`, `ownership-model.ts` | The ownership card, its two tables, and their sort, row-view and footer-sum logic |
| `src/app/vulnerabilities/trend-card.tsx`, `trend-model.ts`, `team-colors.ts` | The trend card, its model, and the team colour assignment |
| `src/app/vulnerabilities/alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx`, `pager.tsx` | The Alerts view |
| `src/app/vulnerabilities/format.ts`, `overview-format.ts`, `api-types.ts`, `view-props.ts` | Shared formatters and the change sentences, response types, the props every region takes |
| `src/app/reports/vulnerability-syncs-tab.tsx` | "Dependabot alerts" tab on the Reports page — collapsible RunCards, live progress on the running one |
| `src/app/api/vulnerabilities/summary/route.ts`, `repos/route.ts`, `trend/route.ts`, `alerts/route.ts`, `coverage/route.ts`, `syncs/route.ts`, `syncs/[id]/progress/route.ts`, `sync/route.ts` | API routes, all wrapped with `withRequestLog()` |
| `src/app/api/vulnerabilities/_shared.ts` | `withFilters()` — shared filter parsing/404/400 handling for the read routes |
| `src/lib/url-state.ts` | The URL state hooks (`useUrlState`, `useUrlBatch`) the page's schemas use |
| `src/lib/vulnerabilities/queries.ts` | `getSummary`/`getRepos`/`getTrend`/`getAlerts`/`getCoverage`/`listSyncs`/`getSyncProgressView` — the one source of truth for API and MCP, plus the facts cache |
| `src/lib/vulnerabilities/aggregate.ts` | Pure aggregation: `computePivot`, `computeRepoRows`, `computeCodebaseCounts`, `computeKpi`, `computeDelta`, `computeTrend`, `listAlerts`, `computeCoverage`, `knownTeams`, `pickBaseline`, `snapshotSets` |
| `src/lib/vulnerabilities/alert-sort.ts` | The alert list's sort contract (`ALERT_SORT_KEYS`, `parseAlertSort`), shared by the parser, the aggregation and the page |
| `src/lib/vulnerabilities/sync.ts` | `runSync()` — fetch phase, write transaction, the completeness guard |
| `src/lib/vulnerabilities/progress.ts` | In-memory per-sync progress store for the running card (`initSyncProgress`/`updateSyncProgress`/`addSyncLog`/`getSyncProgress`) — mirrors `src/lib/progress-store.ts`, standalone (no db import) |
| `src/lib/vulnerabilities/scheduler.ts` | `startSync()` (the watchdog lives here), `initVulnerabilityScheduler()`, the cron job |
| `src/lib/vulnerabilities/filters.ts` | `parseVulnFilters()` — the one parameter parser shared by API and MCP |
| `src/lib/vulnerabilities/config.ts` | `parseVulnConfig`/`getVulnConfig` — the deployment configuration parser, validator and neutral defaults (see `src/lib/vulnerabilities/CLAUDE.md` before editing) |
| `src/lib/vulnerabilities/properties.ts` | `mapPropertyRows()` — maps raw custom-property rows to the configured keys, shared by the real and mock GitHub providers |
| `src/lib/vulnerabilities/sla.ts` | `computeDue`, `daysRemaining`, `slaStatus`, `resolvedTiming` |
| `src/lib/vulnerabilities/codebase.ts` | `codebaseGroupOf()`, `isInScope()` — read the configured groups and in-scope tier |
| `src/lib/vulnerabilities/codebase-labels.ts` | Display-only group names/labels, safe to import from client components |
| `src/lib/vulnerabilities/db-helpers.ts` | `rowToAlertFact`/`rowToRepoFact`, `upsertRows`/`insertRows`/`bool()` |
| `src/lib/github-mock.ts` | Mock `VulnerabilitySource` fixtures for `dev:mock` |
| `scripts/mock-identities.ts` | `MOCK_VULN_REPOS`: the mock repositories and their owning teams |
| `scripts/seed-vulnerabilities.ts` | Seeds mock vulnerability data via the real `runSync()` |
| `src/lib/mcp/tools.ts` | The five read-only MCP tools (`VULN_COMMON`, `toSnake()`) |

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VULNERABILITIES_ORG` | enables the feature | unset (off) | See [Env vars and token permissions](#env-vars-and-token-permissions) above. |
| `VULN_SYNC_CRON` | no | `0 6 * * *` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |
| `VULN_SYNC_TZ` | no | `America/New_York` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |
| `GITHUB_TOKEN` | yes, when the feature is on | — | Needs org owner/security-manager access, `Dependabot alerts: read`, and org `Custom properties: read`. Must have access to **all** org repos — a token scoped to selected repos makes every run `partial` with `repo-list-incomplete`. |
| `GITHUB_PROVIDER=mock` | no | unset | Used by `dev:mock`; swaps in `github-mock.ts`'s fixtures. |
| `VULNERABILITIES_SLA_POLICY`, `VULN_RESOLVED_SINCE`, `VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_TIER_IN_SCOPE`, `VULN_CODEBASE_PROPERTY`, `VULN_CODEBASE_GROUPS` | no | see below | Deployment configuration — see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration) above for the full table, validation rules and playbook. |
````

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx jest src/lib/__tests__/unit/vuln-docs-references.test.ts --maxWorkers=3`
Expected: PASS, 4 tests.

Reverts that fail: restoring the old document fails all four. Changing the full-path token `src/app/vulnerabilities/security-state.ts` in the document to `src/app/vulnerabilities/security-states.ts` fails `every src/, scripts/ and docs/ path the document names exists`, and the failure names that path. Writing `178px` as `190px` in the Layout stability table fails `the Layout stability section states the sizes dimensions.ts defines` and names `KPI_ROW_H`. Adding the words `team-pivot` anywhere fails `does not mention a module the redesign retired`.

The test checks only full-path tokens (`src/…`, `scripts/…`, `docs/…`) and bare test-file names. A bare module name inside a comma-joined table cell (the Key files and Page modules tables name many, such as `repo-rail.tsx`) is not checked, so a rename of one of those is caught by reading, not by the test. Then read the new document once against the code. The test cannot check prose, so check these claims by reading the named file: the Overdue and Due ≤ 7d rules in `alert-list.tsx` and `security-state.ts`; the four SLA wordings in `sla-state.ts`; the URL keys and history modes in `security-state.ts`; the request table in `use-security-data.ts` (`securityKeys`); the MCP row shape in `limitRepoRows` and `list_vulnerability_repos` in `src/lib/mcp/tools.ts`.

- [ ] **Step 5: Commit**

```bash
git add docs/vulnerabilities-page.md src/lib/__tests__/unit/vuln-docs-references.test.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: rewrite the vulnerabilities page reference for the new page"
```

### Task 5.2: Update the vulnerability entry in the root `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (the `**Vulnerability tracking**` entry under "Key architectural decisions")

**Interfaces:**
- Consumes: Task 5.1's document (the entry points at its "Layout stability" section).
- Produces: nothing new.

The entry already carries the sync, the completeness guard and the configuration rules. It gains the one rule a future change to the repository rows is most likely to break, and a pointer to the page's state and data modules. It stays one entry, in the same style.

This task has no failing-test step: it edits a document that no test reads. Its check is a search that must find nothing before and the new sentences after.

- [ ] **Step 1: Confirm the entry does not mention the rows yet**

Run: `grep -n "computeRepoRows" CLAUDE.md`
Expected: no output.

- [ ] **Step 2: Edit the entry**

In `CLAUDE.md`, in the `**Vulnerability tracking**` entry, replace the end of the entry. Before (the last sentence of the entry):

```text
an archived/deleted repo's alerts are always explainable and never drive a trip).
```

After (the same sentence, then three new ones, still one paragraph):

```text
an archived/deleted repo's alerts are always explainable and never drive a trip). **The per-repository rows (`computeRepoRows` in `aggregate.ts`) must sum to the team pivot**: per team and severity, the rows' `open`, `overdue` and `dueSoon` equal the pivot cell, and the rows with `unmeasured` set equal `unmeasuredRepos`. An unmeasured repository carries its stored counts in the rows (the UI shows them as unknown, never zero), so skipping those rows breaks the totals, the Alerts strip and the `list_vulnerability_repos` MCP tool together. The `/vulnerabilities` page reads its URL state from `security-state.ts` and every request from `use-security-data.ts`, and its fixed sizes live in `dimensions.ts`: a filter change may change what a slot shows but never its size (`docs/vulnerabilities-page.md`, "Layout stability"). In light mode `bg-gray-900` also gets a border and a shadow, so it is for card shells only; rows and pinned headers use `bg-chart-surface`.
```

- [ ] **Step 3: Check the edit**

Run: `grep -c "computeRepoRows" CLAUDE.md` Expected: `1`.
Run: `grep -n "Layout stability" CLAUDE.md` Expected: one line, in the vulnerability entry.
Run: `git diff --stat` Expected: only `CLAUDE.md`, one line changed.

- [ ] **Step 4: Confirm the pointer resolves**

Run: `grep -n "^## Layout stability" docs/vulnerabilities-page.md`
Expected: one line (the section the entry names).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: record the repository-row sum invariant in CLAUDE.md"
```

### Task 5.3: Remove the last comment-only mentions of retired components

**Files:**
- Modify: `src/app/vulnerabilities/format.ts` (three comments)
- Modify: `src/app/globals.css` (two comments)
- Modify: `src/lib/vulnerabilities/sla.ts` (one comment)
- Modify: `src/lib/vulnerabilities/CLAUDE.md` (one line)
- Modify: `src/lib/__tests__/unit/vuln-series-contrast.test.ts` (one comment)
- Modify: `src/lib/__tests__/setup/resize-observer.ts` (one comment)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. No code, selector or value changes.

Waves 2-4 replaced `TeamPivot`, `TrendChart`, `AlertsPanel`, `PolicyPanel` and `CoveragePanel`, but eight comments and one agent note still name them. Comments that point at a module that does not exist send the next reader looking for it. This task changes the words in those places and nothing else; the CSS edits are inside `/* … */` comments and change no declaration.

This task has no failing-test step. Its check is a search that finds the stale mentions before and nothing after, then the suites that read these files.

- [ ] **Step 1: Find the stale mentions**

Run:

```bash
grep -nE "TeamPivot|PolicyPanel|AlertsPanel|trend-chart|TrendChart|policy panel|coverage panel" src/app/vulnerabilities/format.ts src/app/globals.css src/lib/vulnerabilities/sla.ts src/lib/vulnerabilities/CLAUDE.md src/lib/__tests__/unit/vuln-series-contrast.test.ts src/lib/__tests__/setup/resize-observer.ts
```

Expected, exactly these nine lines:

```text
src/app/vulnerabilities/format.ts:8: * VULN_RESOLVED_SINCE) into the caption every "resolved since" figure renders through — TeamPivot,
src/app/vulnerabilities/format.ts:9: * the KPI tile on vulnerabilities-content.tsx, and PolicyPanel. `invalid` wins over `date` (an
src/app/vulnerabilities/format.ts:36: * — arrived as SWR **data**, never as SWR `error`. That left AlertsPanel stuck on "Loading…"
src/app/globals.css:14:  /* GLOOK-43 J2-1: trend-chart series colours, ranked by current open count (dark palette,
src/app/globals.css:146:  /* GLOOK-43 J2-1: the light-mode trend-chart series palette, same order as the dark :root
src/lib/vulnerabilities/sla.ts:54:/** Each entry with its derived window, for the policy panel and MCP. */
src/lib/vulnerabilities/CLAUDE.md:24:- The summary's `scope: { property, value }` (`queries.ts`) and the policy panel's scope caption.
src/lib/__tests__/unit/vuln-series-contrast.test.ts:2:// the trend-chart legend renders each series colour as 11px text (WCAG AA needs 4.5:1 for
src/lib/__tests__/setup/resize-observer.ts:3:// render VulnerabilitiesContent with the real TrendChart) needs this stub. Guarded so node-env
```

If a line differs, Waves 1-4 changed the file since this plan was written: find the same sentence and edit that.

- [ ] **Step 2: Make the edits**

For each file, replace the text under "Before" with the text under "After". Each "Before" occurs exactly once in its file.

In `src/app/vulnerabilities/format.ts` (3 edits):

Before:

```ts
 * VULN_RESOLVED_SINCE) into the caption every "resolved since" figure renders through — TeamPivot,
 * the KPI tile on vulnerabilities-content.tsx, and PolicyPanel. `invalid` wins over `date` (an
```

After:

```ts
 * VULN_RESOLVED_SINCE) into the caption every "resolved since" figure renders through — the team
 * table, the Resolved KPI tile and the coverage drawer. `invalid` wins over `date` (an
```

Before:

```ts
Uses `takenOn` (the date the trend chart plots)
```

After:

```ts
Uses `takenOn` (the date the trend card plots)
```

Before:

```ts
 * — arrived as SWR **data**, never as SWR `error`. That left AlertsPanel stuck on "Loading…"
 * forever (its `data` prop is derived from `alerts?.rows`, which is never present on an error
 * body) and let the syncs tab overwrite its last good table with the error object. Throwing here
```

After:

```ts
 * — arrived as SWR **data**, never as SWR `error`. That left the alerts panel stuck on "Loading…"
 * forever (its rows are read from `alerts?.rows`, which is never present on an error
 * body) and let the syncs tab overwrite its last good table with the error object. Throwing here
```

In `src/app/globals.css` (2 edits):

Before:

```css
/* GLOOK-43 J2-1: trend-chart series colours, ranked by current open count
```

After:

```css
/* GLOOK-43 J2-1: trend series colours, ranked by current open count
```

Before:

```css
/* GLOOK-43 J2-1: the light-mode trend-chart series palette, same order
```

After:

```css
/* GLOOK-43 J2-1: the light-mode trend series palette, same order
```

In `src/lib/vulnerabilities/sla.ts`:

Before:

```ts
/** Each entry with its derived window, for the policy panel and MCP. */
```

After:

```ts
/** Each entry with its derived window, for the coverage drawer and MCP. */
```

In `src/lib/vulnerabilities/CLAUDE.md`:

Before:

```markdown
and the policy panel's scope caption.
```

After:

```markdown
and the coverage drawer's scope caption.
```

In `src/lib/__tests__/unit/vuln-series-contrast.test.ts`:

Before:

```ts
// the trend-chart legend renders each series colour as 11px text
```

After:

```ts
// the trend card legend renders each series colour as 11px text
```

In `src/lib/__tests__/setup/resize-observer.ts`:

Before:

```ts
(including the vuln-content-* tests that
// render VulnerabilitiesContent with the real TrendChart) needs this stub.
```

After:

```ts
(including the vuln-security-page and
// vuln-alerts-view tests that render VulnerabilitiesContent with the real trend card) needs this stub.
```

- [ ] **Step 3: Confirm the mentions are gone**

Run the Step 1 command again. Expected: no output.

Then search the whole tree:

```bash
grep -rnE "alerts-table|AlertsTable|AlertsPanel|team-pivot|TeamPivot|trend-chart|TrendChart|coverage-panel|CoveragePanel|policy-panel|PolicyPanel|policy panel|coverage panel" src scripts CLAUDE.md README.md .env.example docs/vulnerabilities-page.md
```

Expected, exactly these four lines. Three are the provenance notes in test headers (kept on purpose, see "Wave 5 decisions"), and one is the document test's own list of retired names:

```text
src/lib/__tests__/unit/vuln-team-table.test.tsx:3:// The ownership card's "Owning teams" tab (replaces vuln-team-pivot.test.tsx).
src/lib/__tests__/unit/vuln-alert-list.test.tsx:3:// The Alerts view's list column. Replaces vuln-alerts-table.test.tsx: the rows, the fixed
src/lib/__tests__/unit/vuln-trend-card.test.tsx:3:// The trend card (replaces vuln-trend-chart.test.tsx). Dates are built relative to today so the tests
src/lib/__tests__/unit/vuln-docs-references.test.ts:15:const RETIRED = ['alerts-table', 'AlertsTable', 'AlertsPanel', 'team-pivot', 'TeamPivot', 'trend-chart', 'TrendChart', 'coverage-panel', 'CoveragePanel', 'policy-panel', 'PolicyPanel'];
```

(`docs/superpowers/` is deliberately outside the search: those files record the repository as it was.)

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx tsc --noEmit` then `npx jest src/lib/__tests__/unit/vuln-series-contrast.test.ts src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/chart-no-literal-colors.test.ts src/lib/__tests__/unit/chart-contrast.test.ts src/lib/__tests__/unit/vuln-format.test.ts src/lib/__tests__/unit/vuln-docs-references.test.ts --maxWorkers=3`
Expected: no type errors; PASS, 6 suites. The first four read `globals.css` and the chart modules, so a comment edit that broke a rule they parse would fail here.

- [ ] **Step 5: Commit**

```bash
git add src/app/vulnerabilities/format.ts src/app/globals.css src/lib/vulnerabilities/sla.ts src/lib/vulnerabilities/CLAUDE.md src/lib/__tests__/unit/vuln-series-contrast.test.ts src/lib/__tests__/setup/resize-observer.ts
: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff --cached | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1
git commit -m "GLOOK-64: drop comment references to the retired page components"
```

### Task 5.4: Final verification (no file changes)

**Files:**
- None. This task creates, modifies and commits nothing. A failure is fixed in the task that owns the failing file, then this task starts again.

**Interfaces:**
- Consumes: Waves 1-5 as committed. The test ids the headless run uses are listed in the Wave 2, 3 and 4 public interfaces (`security-bar`, `security-header`, `kpi-tiles`, `ownership-card-body`, `trend-plot`, `alerts-strip`, `alerts-card`, `alert-list-rows`, `alert-row`, `repo-rail`, `alert-pager`, `repo-footer`, `alerts-tab-count`, `strip-critical-open`).
- Produces: a pass or a list of failures.

- [ ] **Step 1: Types**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: The full suite**

Run: `npx jest --maxWorkers=3`
Expected: every suite passes. On the verified tree the run was 224 suites and 2784 tests. Compare counts before debugging a failure (see the CI note in the root `CLAUDE.md`): a different count means a different tree.

- [ ] **Step 3: The production build**

Run: `rm -rf .next` then `npm run build`
Expected: the build succeeds and lists `/vulnerabilities` and `/api/vulnerabilities/repos` among the routes.

- [ ] **Step 4: The internal-name guard over the whole branch**

Run: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff origin/main...HEAD | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1`
Expected: no output and exit status 0 for the `test`. Also run `git log origin/main..HEAD --format=%B | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1` for the commit messages.

- [ ] **Step 5: Retired names**

Run the whole-tree search from Task 5.3 Step 3. Expected: the same four lines.

- [ ] **Step 6: The headless-Chrome measurement**

The harness is not in the repository. Write it outside the tree, with `playwright-core` driving the system Chrome. Seed a scratch database with `SQLITE_PATH` pointing outside the repository (`npx tsx scripts/seed.ts`, with the environment variables that `npm run dev:mock` sets for the SLA policy, the codebase groups and the mock providers), then serve the **production build** from Step 3 with the same environment. Do not run `next dev` and `next build` in the same checkout without removing `.next` between them. Stop the server when done.

Load `/vulnerabilities` and `/vulnerabilities?view=alerts` at viewport widths 1024 and 1440, in the default dark theme and in a light theme (set `localStorage['glooker-theme']` to `daylight-blue` before the page loads; confirm `document.documentElement.getAttribute('data-theme-mode')` reads `light`). On each, measure, then perform about ten interactions that cover: Codebase, Owning team, Severity and Compare to (including "A date…"), Reset filters, a team row click, the Repositories tab and its name filter, a repository row click (it opens Alerts), the view tabs, a rail row, All, the alert list's sort, toggles, Status, search and paging, and opening and closing the drawer (the header's "Coverage & policy →" link on Overview, the strip's unmeasured badge on Alerts). After each interaction, measure again.

Pass criteria. Every one must hold at every step, in both themes, at both widths:

| Check | Pass |
|---|---|
| `kpi-tiles` height | 178 |
| `ownership-card-body` height | 330 |
| `trend-plot` height | 220 |
| `alerts-strip` height | 72 |
| `alerts-card` height | 776 |
| `alert-list-rows` height | 560 |
| every `alert-row` height | 56 |
| `repo-rail` width | 260 |
| `alert-pager` height | 28 |
| `security-bar` height | 84, the same before and after every interaction |
| `security-header` height | the same before and after every interaction within a theme (it is 2px taller in light than in dark because the light remap gives the card a border; that is not a failure) |
| drawer width | 460 at both widths |
| light-mode border and shadow | none of the heights above differ between dark and light |
| horizontal scroll | `document.documentElement.scrollWidth - window.innerWidth` is 0 |
| controls that must not slide | the left edge of each child of `coverage-line`, of `ownership-tab-repos` (Overview) and of `strip-critical` and `strip-high` (Alerts) is the same before and after every interaction, in every theme and at every width |
| SLA state labels on the strip | restart the production server with `VULNERABILITIES_SLA_POLICY` set to a policy whose high severity starts in the far future, to `[]`, and to an unparseable value: each strip tail's text span has `scrollWidth <= clientWidth` at 1024px and 1440px (no label is cut), the unmeasured badge's right edge stays inside the strip, and the two blocks keep their left edges across a scope change |
| sticky bar | its top is 0 after scrolling the page |
| console | no `error` messages and no uncaught exceptions |
| layout-shift entries | see below |

For the layout-shift API, log every entry with its sources (the nearest `data-testid` of each moving node, and its previous and current rectangle), counting entries caused by recent input too. An entry passes when every moving node is a row, a figure or a text run changing inside a slot whose size is fixed (a table or list row appearing, disappearing or reordering inside the 330px or 560px body, a number or sentence changing width, the page footer sliding as the page height changes). An entry fails when a fixed-size slot, the sticky bar, a select, a toggle or the view tabs moves. Three position shifts that earlier builds had are gone and must stay gone: the header coverage line's items sliding when the unmeasured badge appeared or disappeared, the "Repositories" ownership tab moving when the teams count changed width or the other tab was pressed, and the CRIT and HIGH blocks in the Alerts strip moving when the title or the figures changed width. The "controls that must not slide" row of the table above checks them directly. Anything else that moves is a failure to fix in the wave that owns the component.

Then look at the four 1440px screenshots (Overview and Alerts, dark and light) for visual defects: clipped or overlapping text, a control outside its card, a missing border or shadow in light mode, unreadable text over the hatched unmeasured bands.

- [ ] **Step 7: Record the result**

No commit. Put the results of Steps 1-6 (counts, the build result, the guard's silence, the pass table, and the list of shifts seen) in the pull request description.

### Wave 5 test rewrite map

No existing test breaks or retires in this wave. The changes are a document, one root `CLAUDE.md` entry and nine comment edits. The one new suite is below. Tests that read the files whose comments change (`vuln-series-contrast`, `chart-tokens-css`, `chart-no-literal-colors`, `chart-contrast`, `vuln-format`) pass unchanged; Task 5.3 Step 4 runs them.

| File | Fate | Intent |
|---|---|---|
| `vuln-docs-references.test.ts` | New (Task 5.1) | The reference document names only files and tests that exist, never a retired module, and states the sizes `dimensions.ts` defines |

### Wave 5 exit check

Run each, in order, from the repository root:

1. `npx jest src/lib/__tests__/unit/vuln-docs-references.test.ts --maxWorkers=3` Expected: PASS, 4 tests.
2. The Task 5.3 Step 3 searches. Expected: nothing for the six files, and the four named lines for the whole tree.
3. `npx tsc --noEmit` then `npx jest --maxWorkers=3` Expected: no type errors; every suite passes (224 suites, 2784 tests on the verified tree).
4. `npm run build` from an empty `.next`. Expected: succeeds.
5. The internal-name guard over the whole wave: `: "${INTERNAL_NAMES:?set INTERNAL_NAMES}"; git diff origin/main...HEAD | grep -n -i -E "$INTERNAL_NAMES"; test $? -eq 1`. Expected: no output, exit status 0.
6. Task 5.4 Step 6, the headless measurement, with every pass criterion met.

## Self-review

These notes record what was checked when the five waves were assembled, so a reviewer knows what has been verified and what has not.

### Spec coverage

Every section of the spec has a task. "Doc" means Task 5.1, which rewrites `docs/vulnerabilities-page.md` for it.

| Spec section | Tasks |
|---|---|
| Decisions 1 to 7, Guardrails | Global Constraints; enforced by 1.2, 1.3 (counting rules, the sum invariant), 2.1 (no `themes.ts` change), 2.10 (`PageHeader` and `DataFreshness` untouched), 1.9 (`withRequestLog`), 1.7 (in-memory paging), every task's Step 5 and 5.4 Step 4 (no internal names: the `INTERNAL_NAMES` guard) |
| Header card (meta line, stale tag, failed banner, coverage line, Sync history) | 2.10, composed in 2.11 |
| Sticky bar (view tabs, filters, reset) | 2.8, composed in 2.11 |
| Overview: KPI tiles, sparkline | 3.1 (change sentences), 3.2 (sparkline), 3.3 (KPI row, Open tile), 3.4 (since-baseline tile), 3.5 (Resolved tile, † wording), 3.6 (SLA tile) |
| Overview: ownership card (Owning teams, Repositories) | 3.7 (rules), 3.8 (team table), 3.9 (repository table), 3.10 (card and tabs) |
| Overview: trend chart | 3.11 (rules), 3.12 (card), 3.13 (old chart retired, chart guards repointed) |
| Alerts: strip, rail, list, pager | 4.3, 4.4, 4.5, 4.2; fixtures 4.1; composed with the real hooks in 4.7 |
| Coverage & policy drawer | 2.9 |
| Severity on the page (`kSev`) | 2.4 (rule), 2.7 (requests), 3.2, 3.3, 3.12 (consumers), 4.3 to 4.5 (Severity-following figures) |
| Interactions, "Stale repository" | 2.4 (sanitising), 2.6 (clearing handlers, `useAlertList`), 2.7 (`repoStatus`), 3.8 to 3.10 (team and repository clicks), 4.4, 4.5, 4.7 |
| States: SLA (four states) | 2.3, then 3.6, 3.8, 3.9, 4.3, 4.4, 4.5, 4.7 |
| States: history, baseline, resolved-count start date, hidden severity | 3.2 and 3.11 (history), 3.1 and 3.4 (baseline), 3.5 (start date unset), 3.6, 3.8, 3.9, 4.3 (hidden severity) |
| States: zero-alert and unmeasured repositories, more than 12 owning teams | 3.9, 4.4 (zero-alert, unmeasured band), 2.9 (drawer group), 3.11 and 3.12 (colours, "Other · N teams") |
| States: unknown team, summary failure | 2.11 |
| Fixes beyond the handoff | 4.4 (rail footer wraps), 4.5 ("Nd OVERDUE" not clipped), 3.9 (owning-team ellipsis) |
| Dimensions and typography, "Rules that keep the layout still" | 2.2 (constants), applied in 2.8 to 4.5. Beyond the spec's list, three plan-level refinements keep items from sliding when a filter changes: the header coverage line's slots (2.10), the ownership card's tab counts and labels (3.10) and the Alerts strip's title column and figure slots (4.3, with a measured limit: at 1024px with the unmeasured badge showing, an unreadable SLA policy is the one state whose labels do not fit). The spec's list does not name them; Task 5.1 states the rule they serve in the reference document (a filter change must never change a slot's size or a control's position) |
| Rail rows, Sorting, Pager, Columns | 4.4, 4.5, 4.2, 3.7 to 3.9 (the table sorts) |
| Carried over from today's page | 2.4 (sanitising), 2.11 (error and unknown-team pages, config banner), 3.5 (†), 4.5 (toggles) |
| Architecture 1: data layer | 1.1 (SLA gate), 1.2 (`computeRepoRows`), 1.3 (invariant and cross-check), 1.4 (`computeCodebaseCounts`), 1.5 (coverage `codebase`), 1.6 (`lastReopenedAt`), 1.7 (sort, offset, tie-break) |
| Architecture 2: queries and API | 1.8 (`parseVulnFilters`), 1.9 (`getRepos` and the repos route) |
| Architecture 3: MCP | 1.10 |
| Architecture 4: page modules, data flow, sticky bar, drawer, trend | 2.4 to 2.11 (modules and data flow), 3.11 and 3.12 (trend), 4.7 (data flow on the Alerts view) |
| Architecture 5: URL state | 2.4, 2.6 (`url-state.ts` needs no new types) |
| Architecture 6: styling and new CSS variables | 2.1 (tokens, utilities, `--warn` contrast guard) |
| Testing: unit, API and MCP, jsdom, chart guards | Every task's Step 1; chart guards 3.13; test rewrite map at the end of each wave |
| Testing: headless-Chrome measurement | 5.4 Step 6, and item 7 of the Wave 2, 3 and 4 exit checks |
| Documentation (`docs/vulnerabilities-page.md`, `CLAUDE.md`, seed and mock data) | 5.1, 5.2, 5.3; seed and mock data in 1.11 |
| Out of scope, Definition of done | Respected (nothing edits `themes.ts`, sync or baseline picking); the Definition of done is Task 5.4 (types, full suite, build, guard, measurement) |

### Placeholder scan

The plan was searched for the usual unfinished-work markers (the to-do and to-be-decided words), for "similar to Task N", "same as Task N", "add error handling", "handle edge cases", "implement later", "write tests for the above" and for a line holding only an ellipsis. None of them occurs. The remaining hits are product text (an input's `placeholder` attribute, "Search CVE, GHSA, package"), one `{ ... }` that names an existing interface in an insertion instruction (Task 1.2), and a table cell that quotes an old test name. The plan also contains no local filesystem path, no Node version or install path, no commit-attribution trailer and no host, person or company name. The guard commands read the private `INTERNAL_NAMES` pattern from the implementer's environment.

### Type consistency

1. The code blocks come from files that were run together: the final tree with Waves 1 to 5 applied passes `npx tsc --noEmit`, `npx jest --maxWorkers=3` (224 suites, 2784 tests) and `npm run build`. Of the 67 code blocks that name a file, 53 are the whole file as it ends up, 4 are fragments in order, and 10 are earlier stages of a file that a later task extends (the Wave 2 stubs and the first versions of `security-state.ts`, `kpi-tiles.tsx` and `vuln-overview-format.test.ts`).
2. Every identifier on a "Consumes" or "Produces" line exists in that tree, except two parameter names in prose (`drawnSeries`, `selectedTeam`) and a glob (`*_SCHEMA`).
3. Every `@/` import in a code block resolves to a file of that tree. The one exception, `alerts-table`, is imported by a test that Task 4.6 deletes in the same wave.
4. Names that cross waves match their definitions: `RepoRow` and `RepoSevCell` (Task 1.2) in 2.5 and 3.7 to 4.5; `Slot`, `SecurityViewProps` and `OpenDrawer` (Wave 2) in every Wave 3 and 4 component; `repoTotals(measured, unmeasured = [])` (Task 3.7) in 3.9; `scopeOpenCount` (2.4) in 4.3 and 4.4; `slaState` and `slaStateLabel` (2.3) in 3.6, 3.8, 3.9, 4.3 to 4.5; and the width constants exported by `security-header.tsx`, `ownership-card.tsx` and `alerts-strip.tsx`, which their tests import.

### Review Focus coverage

All five situations have a named test. Each test names its revert in a `// Revert:` comment, and every test added or changed in this assembly was mutation-checked: the revert was applied, the named test failed, and the file was restored.

1. Missing repository or team: existing tests in Tasks 2.7, 2.11, 4.5 and 4.7.
2. More than 500 alerts: Task 1.7 had the test for Open only. A second test now covers Resolved and Open + resolved (620 alerts, every sort key in both directions, reversed input).
3. SLA states: existing tests in Tasks 2.3, 3.6, 3.8, 3.9, 4.3, 4.4, 4.5 and 4.7.
4. Unmeasured repository with stored alerts: Tasks 1.3, 1.11, 3.7, 3.9 and 4.7 existed. Task 3.10 gained a test that puts the team row and the Repositories footer side by side. The footer now follows the rule that every total includes stored counts (Decision 5 of Wave 3).
5. Light theme: Tasks 3.8 and 3.9 pinned the pinned rows. Tasks 2.9, 4.2, 4.4 and 4.5 gained a test that nothing inside their fixed-height regions uses the card-shell class. The measurement in Task 5.4 covers the rest.

### Known gaps

- Wave 1 and Wave 2 code blocks were verified when those waves were built; this assembly re-ran the whole suite, type check and build over the final tree but did not rebuild the Wave 1 and Wave 2 intermediate states one task at a time.
- The in-order counts after Waves 1 to 3 (219 suites, 2596 tests) and after Wave 4 (223 suites, 2780 tests) are derived from the per-file counts of the final run; only Wave 1 alone (210 suites, 2219 tests) and the final tree (224 suites, 2784 tests) were run directly.
