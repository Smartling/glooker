# De-duplicated Commits and Jira Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one de-duplicated row per commit (`commit_canonical`) and per Jira issue (`jira_canonical`) per org, maintained on report completion/deletion and by an admin Rebuild, so range views, weekly charts, summary history and the MCP cross-report commit query read them directly instead of re-de-duplicating ~255k rows per request.

**Architecture:** A new module `src/lib/canonical/` owns the pick rule, per-key refresh, full rebuild, Check, the build marker (`canonical_builds`), the rebuild lock and LLM-analysis reuse. Readers ask `isCanonicalBuilt(org)` per request: built → read the canonical tables; not built → today's de-dupe queries, kept verbatim as the fallback. Admin access is via three `withRequestLog` + `requireAdmin` routes under `/api/settings/canonical`, a Settings card, and `npm run rebuild:canonical`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Jest + ts-jest (+ jsdom for `.tsx`), better-sqlite3 / mysql2 through `src/lib/db` (`execute`, `transaction`), tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-canonical-commits-jira-design.md` (including the 2026-11-06 decision: weekly charts and summary history become completed-only).

## Global Constraints

- New tables go in **all three** of `schema.sql`, `src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts`. Never pin a charset or collation (`mysql-schema-fk-charset.test.ts`). No foreign key to `reports`.
- Any new MySQL-only SQL must work through `translateSQL()` in `db/sqlite.ts`; this plan deliberately uses only `INSERT IGNORE`, `DELETE`, `INSERT … SELECT` and plain `SELECT`, all of which already translate. Do **not** introduce `ON DUPLICATE KEY UPDATE` with a different key shape, `RENAME TABLE`, or `REPLACE INTO`.
- Every exported handler in a new `src/app/api/**/route.ts` is wrapped in `withRequestLog()` and starts with `const denied = await requireAdmin(req); if (denied) return denied;`.
- Every remaining `canonicalCommitIdsSql` / `canonicalJiraIdsSql` join (the fallback path) keeps `/*+ JOIN_FIXED_ORDER() */` with the derived table first (`canonical-join-order.test.ts` must keep passing unchanged).
- Real-SQLite tests capture `SQLITE_PATH` / `DB_TYPE` before setting them and restore them in `afterAll` (pattern: `report-range-db.test.ts`). Any test importing `report-runner.ts` or `github.ts` transitively uses the factory mock `jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }))`.
- Pick rule, verbatim from the spec: candidates are copies in **completed** reports of that org only; commits prefer non-null `complexity`, then highest `id`; Jira takes the highest `id`. The pick is across **all** completed reports (not only window-overlapping ones).
- Before an org's first build: no canonical writes for it on completion/deletion, no LLM reuse, readers use the fallback. The app never builds automatically on startup.
- `commit_analyses`, `jira_issues` and every single-report reader stay exactly as they are. No change to `pr_activity`. No new indexes on per-report tables. Current-report figures must not change.
- Measured days and the developer list in range figures still come from the reports (`rangeReports`), not from the canonical tables.
- Rebuild is refused while another runs, with the exact message `rebuild already running`.
- Check and the CLI list at most 20 example keys per table.
- `DECIMAL` columns come back as strings: `Number()` before arithmetic or `.toFixed()`.

## Decisions (left to the builder by the spec)

1. **Column types** mirror the source columns exactly (MySQL types from `schema.sql`; SQLite `TEXT`/`INTEGER`/`REAL` as in `sqlite.ts`). Added columns: `org VARCHAR(255) NOT NULL` (same as `reports.org`), `analysis_id INT NOT NULL` / `issue_id INT NOT NULL`. An extra index on `report_id` in each table (not in the spec) serves the delete-path lookup "keys whose canonical row points at this report". Exact DDL in Task 1.
2. **Build marker** lives in a new table `canonical_builds (org PK, built_at VARCHAR(32) ISO string, duration_ms INT, commit_rows INT, jira_rows INT)` — one row per org, ISO strings in VARCHAR as the vulnerability module does. "Built" means a row exists. Rollback without a deploy: `DELETE FROM canonical_builds WHERE org = ?`. It is read uncached on every request (a PK lookup) so that rollback is instant.
3. **Rebuild lock** is a DB row, not process memory, so the CLI and the app exclude each other: table `canonical_rebuild_lock (id INT PK, started_at VARCHAR(32), holder VARCHAR(64))`, acquired with `INSERT IGNORE … VALUES (1, …)` and `affectedRows === 1`; a lock older than 2 hours is treated as stale (crashed process) and broken once.
4. **Swap technique:** per org, one `db.transaction` that `DELETE`s the org's rows from both canonical tables, re-inserts them with `INSERT … SELECT` keyed by source ids in batches of 500, and writes the `canonical_builds` row. The picks (key → source id) are computed **before** the transaction with a plain non-locking `SELECT`, so the long `GROUP BY` never holds InnoDB locks on `commit_analyses` while a report runs; the in-transaction `INSERT … SELECT … WHERE id IN (…)` touches only PK rows. Works identically on SQLite and MySQL; readers on MySQL see the old rows (MVCC) until commit. No staging table: the transaction is the staging (the spec allows "a `DELETE` + `INSERT … SELECT` inside one transaction").
5. **Transaction granularity:** one transaction per org covering both tables plus the marker. This satisfies both "one transaction per table" (no reader sees a half-built table) and "each org in its own transaction" (a failed org leaves others built and itself on its previous state).
6. **Report completed during a rebuild:** the rebuild snapshots the set of completed report ids when it takes the lock (ids, not timestamps — `completed_at` is a local-time string on SQLite and an instant on MySQL). After all orgs are swapped and before releasing the lock, it runs the per-report refresh for every completed report not in the snapshot. If any snapshot report no longer exists (deleted mid-rebuild), that org is rebuilt once more.
7. **Route names:** `GET /api/settings/canonical` (status: per-org builds, lock, in-process rebuild progress/last result), `GET /api/settings/canonical/check` (read-only Check), `POST /api/settings/canonical/rebuild` (starts a rebuild).
8. **Rebuild runs in the background.** The POST awaits lock acquisition only, then returns `202 { started: true }` (or `409 { error: 'rebuild already running' }`); the rebuild continues in-process and records progress in a `globalThis` store. The card polls the status route every 2 s while running. (~255k source rows on dev would exceed the ALB's request timeout if run in-request.)
9. **Card placement:** a `CanonicalCard` component in the sibling module `src/app/settings/canonical-card.tsx` (page files may export only `default`), rendered at the top of the admin-only App Settings tab, and itself returning `null` unless `useAuth().canAct`.
10. **Upkeep failures:** completion upkeep runs inside the same transaction as `status = 'completed'`, as the spec requires; a failure there therefore fails the report (it rolls back and the runner's catch marks it `failed`). Deletion upkeep likewise rolls the delete back.
11. **The in-process range cache stays.** Its key gains the org's `built_at` (or `'fallback'`), so a Rebuild — including one run from the CLI in another process — produces new keys instead of serving stale figures.
12. **Mock-DB tests:** readers call `isCanonicalBuilt` from `@/lib/canonical/state`, a separate module, so existing suites that mock `@/lib/db` with a fixed call sequence add `jest.mock('@/lib/canonical/state', () => ({ isCanonicalBuilt: jest.fn().mockResolvedValue(false), getCanonicalBuild: jest.fn().mockResolvedValue(null) }))` and keep their call order unchanged.
13. **Seed:** `scripts/seed.ts` calls `rebuildCanonical()` at the end so mock mode (`npm run dev:mock`) exercises the canonical path. This is not app startup, so it does not conflict with "no automatic build on startup".
14. **Summary history** is made testable by extracting its query into `loadDevCommitHistory(org, login)` in `summary.ts` (a lib file, so the export is safe).

## Review Focus

1. **A delete or completion that interleaves with a rebuild** — a report deleted after the rebuild computed its picks but before its transaction commits must not leave keys missing; expect Check to read 0 differ afterwards. Pinned by Task 3, test `rebuild re-runs an org whose snapshot report was deleted mid-rebuild`.
2. **An org whose every completed report is deleted after a build** — its canonical rows must disappear and readers must return empty (not stale) figures. Pinned by Task 4, test `deleting the last completed copy removes the key`, and Task 3, test `rebuild clears an org that has a build row but no completed reports`.
3. **A stale lock left by a crashed rebuild** — the next Rebuild must not be refused forever. Pinned by Task 3, test `a lock older than two hours is broken`.
4. **A CLI rebuild while the app's range cache is warm** — the next range request must reflect the rebuild, not a cached pre-rebuild result. Pinned by Task 5, test `cache key changes when built_at changes`.
5. **A key whose canonical copy is unanalysed when a newer analysed copy arrives, and vice versa** — the newer unanalysed copy never wins over an analysed one; a newer analysed copy does win. Pinned by Task 2, test `pick prefers analysed, then highest id`, and Task 4, test `newer copy without complexity does not replace one with complexity`.

Known non-covered behaviour (accepted, not tested): the SQLite `transaction()` wrapper shares one handle, so another request's statements issued during an open SQLite transaction join it. This is pre-existing and affects only single-user local use.

---

### Task 1: Tables and build-state module

**Files:**
- Modify: `schema.sql` (append after `pr_activity_coverage`, before the `CREATE INDEX` lines)
- Modify: `src/lib/db/mysql.ts` (new `CANONICAL_SCHEMAS: string[]` beside `PR_ACTIVITY_SCHEMAS`, executed in the same loop style with a `.catch` log)
- Modify: `src/lib/db/sqlite.ts` (append to the schema string after `pr_activity_coverage`)
- Create: `src/lib/canonical/state.ts`
- Test: `src/lib/__tests__/unit/canonical-schema-db.test.ts`

**Interfaces:**
- Produces:
  - `interface CanonicalBuild { org: string; builtAt: string; durationMs: number; commitRows: number; jiraRows: number }`
  - `getCanonicalBuild(org: string): Promise<CanonicalBuild | null>`
  - `isCanonicalBuilt(org: string): Promise<boolean>`
  - `listCanonicalBuilds(): Promise<CanonicalBuild[]>`
  - `recordCanonicalBuild(tx: DB, b: CanonicalBuild): Promise<void>` (DELETE then INSERT for the org)

MySQL DDL (SQLite: same columns, `TEXT`/`INTEGER`/`REAL`, `CREATE INDEX IF NOT EXISTS` statements instead of inline `KEY`):

```sql
CREATE TABLE IF NOT EXISTS commit_canonical (
  org            VARCHAR(255) NOT NULL,
  commit_sha     VARCHAR(40)  NOT NULL,
  analysis_id    INT          NOT NULL,
  report_id      VARCHAR(36)  NOT NULL,
  github_login   VARCHAR(255) NOT NULL,
  repo           VARCHAR(255) NOT NULL,
  committed_at   TIMESTAMP    NULL,
  lines_added    INT          NOT NULL DEFAULT 0,
  lines_removed  INT          NOT NULL DEFAULT 0,
  complexity     TINYINT      NULL,
  type           ENUM('feature','bug','refactor','infra','docs','test','other') NULL,
  ai_co_authored TINYINT(1)   NOT NULL DEFAULT 0,
  ai_tool_name   VARCHAR(50)  NULL,
  maybe_ai       TINYINT(1)   NOT NULL DEFAULT 0,
  pr_number      INT          NULL,
  pr_title       VARCHAR(500) NULL,
  risk_level     ENUM('low','medium','high') NULL,
  commit_message TEXT         NULL,
  impact_summary TEXT         NULL,
  PRIMARY KEY (org, commit_sha),
  KEY idx_commit_canonical_org_committed (org, committed_at),
  KEY idx_commit_canonical_org_login (org, github_login, committed_at),
  KEY idx_commit_canonical_report (report_id)
);
CREATE TABLE IF NOT EXISTS jira_canonical (
  org                       VARCHAR(255) NOT NULL,
  issue_key                 VARCHAR(50)  NOT NULL,
  issue_id                  INT          NOT NULL,
  report_id                 VARCHAR(36)  NOT NULL,
  github_login              VARCHAR(255) NOT NULL,
  project_key               VARCHAR(50)  NOT NULL,
  issue_type                VARCHAR(100) NULL,
  summary                   VARCHAR(500) NULL,
  description               TEXT         NULL,
  status                    VARCHAR(100) NULL,
  labels                    TEXT         NULL,
  story_points              DECIMAL(6,2) NULL,
  original_estimate_seconds INT          NULL,
  issue_url                 VARCHAR(500) NULL,
  created_at                TIMESTAMP    NULL,
  resolved_at               TIMESTAMP    NULL,
  PRIMARY KEY (org, issue_key),
  KEY idx_jira_canonical_org_resolved (org, resolved_at),
  KEY idx_jira_canonical_org_login (org, github_login, resolved_at),
  KEY idx_jira_canonical_report (report_id)
);
CREATE TABLE IF NOT EXISTS canonical_builds (
  org         VARCHAR(255) NOT NULL PRIMARY KEY,
  built_at    VARCHAR(32)  NOT NULL,
  duration_ms INT          NOT NULL,
  commit_rows INT          NOT NULL,
  jira_rows   INT          NOT NULL
);
CREATE TABLE IF NOT EXISTS canonical_rebuild_lock (
  id         INT         NOT NULL PRIMARY KEY,
  started_at VARCHAR(32) NOT NULL,
  holder     VARCHAR(64) NOT NULL
);
```

- [ ] **Step 1: Write the failing test** `canonical-schema-db.test.ts` (real SQLite, env capture/restore):
  - `it('creates the four canonical tables')` — `SELECT name FROM sqlite_master WHERE type='table'` contains `commit_canonical`, `jira_canonical`, `canonical_builds`, `canonical_rebuild_lock`.
  - `it('reports an org as not built until a build row exists')` — `isCanonicalBuilt('acme')` → `false`; `getCanonicalBuild('acme')` → `null`; after `db.transaction(tx => recordCanonicalBuild(tx, { org: 'acme', builtAt: '2026-11-06T10:00:00.000Z', durationMs: 1200, commitRows: 3, jiraRows: 1 }))` → `isCanonicalBuilt` `true`, `getCanonicalBuild` deep-equals that object (numbers, not strings).
  - `it('recordCanonicalBuild replaces the previous row')` — record twice with different `durationMs`; `listCanonicalBuilds()` has length 1 with the second value.
  - `it('declares the new tables in schema.sql and mysql.ts')` — read both files; each contains `CREATE TABLE IF NOT EXISTS commit_canonical`, `jira_canonical`, `canonical_builds`, `canonical_rebuild_lock`.
- [ ] **Step 2: Run** `npx jest canonical-schema-db` — Expected: FAIL (module `@/lib/canonical/state` not found).
- [ ] **Step 3: Add the DDL to the three schema files and implement `state.ts`.** `Number()` every numeric column on read.
- [ ] **Step 4: Run** `npx jest canonical-schema-db mysql-schema-fk-charset` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add schema.sql src/lib/db/mysql.ts src/lib/db/sqlite.ts src/lib/canonical/state.ts src/lib/__tests__/unit/canonical-schema-db.test.ts
git commit -m "GLOOK-63: canonical commit/Jira tables and build marker"
```

---

### Task 2: Pick rule and per-key refresh

**Files:**
- Create: `src/lib/canonical/pick.ts`
- Test: `src/lib/__tests__/unit/canonical-pick-db.test.ts`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces:
  - `CANONICAL_BATCH = 500`
  - `expectedCommitPicks(org: string, q?: DB): Promise<Map<string, number>>` — commit_sha → `commit_analyses.id`, whole org.
  - `expectedJiraPicks(org: string, q?: DB): Promise<Map<string, number>>` — issue_key → `jira_issues.id`.
  - `insertCommitsByIds(tx: DB, org: string, ids: number[]): Promise<void>` / `insertJiraByIds(tx: DB, org: string, ids: number[]): Promise<void>` — `INSERT INTO … SELECT ?, …` from the source table `WHERE id IN (…)`, batched.
  - `refreshCommitKeys(tx: DB, org: string, shas: string[]): Promise<void>` / `refreshJiraKeys(tx: DB, org: string, keys: string[]): Promise<void>` — per batch: delete those keys for the org, re-pick among the org's completed copies, insert the picks. A key with no remaining copy stays deleted.

Pick SQL (whole-org form; the per-key form adds `AND ca.commit_sha IN (…)`):

```sql
SELECT ca.commit_sha AS k,
       COALESCE(MAX(CASE WHEN ca.complexity IS NOT NULL THEN ca.id END), MAX(ca.id)) AS id
FROM commit_analyses ca
WHERE ca.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')
GROUP BY ca.commit_sha
```
Jira: `SELECT ji.issue_key AS k, MAX(ji.id) AS id FROM jira_issues ji WHERE ji.report_id IN (…same…) GROUP BY ji.issue_key`.

- [ ] **Step 1: Write the failing tests** (real SQLite). Fixture: reports `r1`,`r2`,`r3` completed for `acme`, `f1` failed and `p1` running for `acme`, `x1` completed for `other`. Commit `dup` in r1 (complexity 4), r2 (complexity 6), r3 (complexity NULL), f1 (complexity 9); commit `fx` only in f1; commit `zzz` only in x1. Jira `J-1` in r1 (login alice), r2 (login bob), f1 (login carol).
  - `it('pick prefers analysed, then highest id')` — `expectedCommitPicks('acme').get('dup')` equals the id of the **r2** copy.
  - `it('ignores failed and running reports and other orgs')` — `expectedCommitPicks('acme')` has keys exactly `['dup']`; `expectedJiraPicks('acme').get('J-1')` is the r2 id.
  - `it('refreshCommitKeys inserts the picked row with every copied column')` — after `refreshCommitKeys(tx,'acme',['dup'])`, `SELECT * FROM commit_canonical` has one row with `org='acme'`, `analysis_id` = r2 id, `report_id='r2'`, `complexity=6`, and `repo`, `committed_at`, `commit_message`, `impact_summary`, `pr_title` equal to the r2 source row.
  - `it('refreshCommitKeys removes a key with no completed copy')` — insert a bogus `commit_canonical` row for `fx`; refresh `['fx']`; row is gone.
  - `it('refreshJiraKeys credits the latest copy's assignee')` — `jira_canonical` row for `J-1` has `github_login='bob'`, `report_id='r2'`.
  - `it('batches keys beyond CANONICAL_BATCH')` — 1,201 distinct shas in r1; refresh all; `COUNT(*)` = 1,201.
- [ ] **Step 2: Run** `npx jest canonical-pick-db` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `pick.ts`.** `q` defaults to the shared `db`.
- [ ] **Step 4: Run** `npx jest canonical-pick-db` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/canonical/pick.ts src/lib/__tests__/unit/canonical-pick-db.test.ts && git commit -m "GLOOK-63: canonical pick rule and per-key refresh"`

---

### Task 3: Rebuild, Check and the rebuild lock

**Files:**
- Create: `src/lib/canonical/rebuild.ts`
- Test: `src/lib/__tests__/unit/canonical-rebuild-db.test.ts`

**Interfaces:**
- Consumes: Task 1 (`recordCanonicalBuild`, `getCanonicalBuild`, `listCanonicalBuilds`), Task 2 (`expected*Picks`, `insert*ByIds`, `refresh*Keys`).
- Produces:
  - `class RebuildRunningError extends Error` (message `rebuild already running`)
  - `interface CanonicalCheckTable { stored: number; expected: number; differ: number; examples: string[] }`
  - `interface CanonicalOrgCheck { org: string; builtAt: string | null; commits: CanonicalCheckTable; jira: CanonicalCheckTable }`
  - `checkCanonical(): Promise<CanonicalOrgCheck[]>` — every org in `SELECT DISTINCT org FROM reports WHERE status='completed'` ∪ `canonical_builds`, sorted by org. `differ` = keys missing + keys extra + keys whose stored `analysis_id`/`issue_id` ≠ expected id; `examples` ≤ 20 keys. Writes nothing.
  - `interface CanonicalRebuildOrgResult { org: string; ok: boolean; commitRows: number; jiraRows: number; durationMs: number; error?: string }`
  - `interface RebuildOptions { onProgress?: (org: string, done: number, total: number) => void; onBatch?: (org: string, table: 'commit' | 'jira') => void }` (`onBatch` is a test hook called after each insert batch inside the transaction)
  - `acquireRebuildLock(holder: string): Promise<{ startedAt: string; completedIds: Set<string> }>` — throws `RebuildRunningError`; breaks a lock whose `started_at` is > 2 h old (once).
  - `releaseRebuildLock(holder: string): Promise<void>`
  - `runRebuild(holder: string, snapshot: { completedIds: Set<string> }, opts?: RebuildOptions): Promise<CanonicalRebuildOrgResult[]>` — assumes the lock is held; always releases it in `finally`.
  - `rebuildCanonical(opts?: RebuildOptions): Promise<CanonicalRebuildOrgResult[]>` — acquire + run (used by the CLI, seed and tests).
  - `getRebuildLock(): Promise<{ startedAt: string; holder: string } | null>`

Per-org algorithm (Decision 4/5/6): compute both pick maps outside a transaction → `db.transaction(tx => { DELETE org rows from both tables; insert*ByIds in batches; recordCanonicalBuild(tx, …) })` → result `ok`. A thrown error yields `{ ok: false, error }` for that org and continues with the next org. After all orgs: refresh every currently completed report not in the snapshot (shas/keys from its own `commit_analyses`/`jira_issues` rows, via `refresh*Keys` in a transaction per report, only for orgs that are built); re-run an org whose snapshot ids are no longer all present. An org with a `canonical_builds` row but no completed reports is rebuilt to zero rows (its marker stays, with 0 counts).

- [ ] **Step 1: Write the failing tests** (real SQLite; reuse the Task 2 fixture shape, two orgs `acme` and `beta`):
  - `it('check reports not built and full differ before the first rebuild')` — `acme.builtAt` null, `commits.stored` 0, `commits.expected` = number of distinct completed shas, `differ` = expected.
  - `it('rebuild fills both tables and records the build')` — results all `ok`; Check then has `differ` 0 for every org/table; `getCanonicalBuild('acme').commitRows` equals `commits.expected`.
  - `it('rebuild restores a corrupted table')` — after a rebuild: delete one `commit_canonical` row (missing), insert a row for a sha with no completed copy (extra), update one row's `analysis_id` to a non-picked copy (wrong source); Check → `commits.differ` 3 and `examples` contains those three shas; rebuild; Check → 0.
  - `it('a rebuild that fails part-way leaves the previous table intact')` — rebuild once; snapshot `SELECT * FROM commit_canonical ORDER BY org, commit_sha`; rebuild with `onBatch: (org, t) => { if (org === 'acme' && t === 'jira') throw new Error('boom') }`; `acme` result `{ ok: false, error: 'boom' }`, `beta` result `ok: true`; acme rows deep-equal the snapshot; `canonical_builds` row for acme unchanged.
  - `it('concurrent rebuilds are refused')` — `acquireRebuildLock('a')` resolves; `acquireRebuildLock('b')` rejects with `RebuildRunningError` and message `rebuild already running`; after `releaseRebuildLock('a')`, `acquireRebuildLock('b')` resolves.
  - `it('a lock older than two hours is broken')` — insert lock row with `started_at` 3 h ago; `acquireRebuildLock('c')` resolves.
  - `it('a report completed during a rebuild is applied after the swap')` — acquire the lock (snapshot taken), then insert completed report `r9` with a new sha `late` and an analysed copy of `dup` (higher id, complexity 7), then `runRebuild`; `commit_canonical` contains `late`, and `dup` points at the r9 copy.
  - `it('rebuild re-runs an org whose snapshot report was deleted mid-rebuild')` — acquire lock, `DELETE FROM reports WHERE id='r2'`, run; Check `differ` 0 for acme.
  - `it('rebuild clears an org that has a build row but no completed reports')` — build, delete all of beta's reports, rebuild; `SELECT COUNT(*) FROM commit_canonical WHERE org='beta'` = 0.
- [ ] **Step 2: Run** `npx jest canonical-rebuild-db` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `rebuild.ts`.** Timestamps via `new Date().toISOString()`; holder `${process.pid}-${randomUUID().slice(0, 8)}`.
- [ ] **Step 4: Run** `npx jest canonical-rebuild-db` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/canonical/rebuild.ts src/lib/__tests__/unit/canonical-rebuild-db.test.ts && git commit -m "GLOOK-63: canonical rebuild, check and lock"`

---

### Task 4: Upkeep on report completion and deletion

**Files:**
- Create: `src/lib/canonical/upkeep.ts`
- Modify: `src/lib/report-runner.ts:752-755` (replace the `UPDATE reports SET status = 'completed'` call with `completeReport`)
- Modify: `src/lib/report/service.ts:167-177` (`deleteReport`)
- Test: `src/lib/__tests__/unit/canonical-upkeep-db.test.ts`
- Test (update if its mocks break): `src/lib/__tests__/unit/report-service.test.ts`

**Interfaces:**
- Consumes: `isCanonicalBuilt`, `refreshCommitKeys`, `refreshJiraKeys`.
- Produces:
  - `completeReport(reportId: string, runMetadataJson: string): Promise<void>` — one transaction: `UPDATE reports SET status = 'completed', run_metadata = ?, completed_at = NOW() WHERE id = ?`; then, if the report's org is built, refresh every `commit_sha` of this report's `commit_analyses` and every `issue_key` of its `jira_issues`.
  - `deleteReportWithUpkeep(id: string): Promise<number>` — returns `affectedRows` of the report delete. One transaction: read the org; if built, collect `commit_sha` from `commit_canonical WHERE report_id = ?` and `issue_key` from `jira_canonical WHERE report_id = ?`; `DELETE FROM reports WHERE id = ?`; refresh those keys. `deleteReport` calls it and keeps throwing `ReportNotFoundError` on 0.

- [ ] **Step 1: Write the failing tests** (real SQLite; fixture as Task 2, then `rebuildCanonical()` so `acme` is built, except where stated):
  - `it('completing a report adds new keys and re-picks existing ones')` — insert `running` report `r4` with sha `new1` and an analysed `dup` copy; `completeReport('r4', '{}')`; `reports.status` is `completed`; `commit_canonical` has `new1`; `dup` → r4 copy.
  - `it('newer copy without complexity does not replace one with complexity')` — `r5` running with `dup` complexity NULL; complete; `dup` still points at the previously picked analysed copy.
  - `it('does not write canonical rows for an org that was never built')` — org `fresh` with a running report holding sha `s1`; `completeReport`; `commit_canonical` has no `fresh` rows; report is completed.
  - `it('deleting a report re-points to a remaining copy')` — delete the report `dup` points at; `dup` now points at the next-best remaining completed copy; Jira `J-1` likewise.
  - `it('deleting the last completed copy removes the key')` — sha only in one completed report; delete it; key gone.
  - `it('failed or running reports never contribute')` — after deleting every completed report holding `dup`, `dup` is absent even though `f1` and `p1` still hold copies.
  - `it('deleteReport still throws ReportNotFoundError for an unknown id')`.
  - `it('Check reads 0 differ after a sequence of completions and deletions')`.
- [ ] **Step 2: Run** `npx jest canonical-upkeep-db` — Expected: FAIL.
- [ ] **Step 3: Implement `upkeep.ts`; wire the runner (keep the log, `updateProgress` and `warmRangeCache` lines after it) and `deleteReport`.**
- [ ] **Step 4: Run** `npx jest canonical-upkeep-db report-service` — Expected: PASS. If `report-service.test.ts` mocks `db.execute` only, add `transaction: jest.fn(fn => fn(db))` to its `@/lib/db` mock and the Decision 12 `@/lib/canonical/state` mock.
- [ ] **Step 5: Commit** `git add src/lib/canonical/upkeep.ts src/lib/report-runner.ts src/lib/report/service.ts src/lib/__tests__/unit/canonical-upkeep-db.test.ts src/lib/__tests__/unit/report-service.test.ts && git commit -m "GLOOK-63: keep canonical tables current on report completion and deletion"`

---

### Task 5: Range readers switch (with equivalence test)

**Files:**
- Modify: `src/lib/report/range.ts` (`getRangeDeveloperStats` cache key, `computeRangeDeveloperStats`, `getRangeCommits`, `getRangeJiraIssues`)
- Create: `src/lib/__tests__/unit/canonical-equivalence-db.test.ts`
- Modify (Decision 12 mock only): `range-cache.test.ts`, `report-range.test.ts`, `report-range-routes.test.ts`, and any other suite with a mocked `@/lib/db` that now fails on call order.

**Interfaces:**
- Consumes: `getCanonicalBuild(org)`, `rebuildCanonical()`.
- Produces: no new exports. Behaviour: when `getCanonicalBuild(org)` is non-null the commit/Jira queries become

```sql
SELECT github_login, repo, lines_added, lines_removed, complexity, type, ai_co_authored, maybe_ai, pr_number
FROM commit_canonical WHERE org = ? AND committed_at >= ? AND committed_at < ?
```
```sql
SELECT github_login, story_points FROM jira_canonical WHERE org = ? AND resolved_at >= ? AND resolved_at < ?
```
and `getRangeCommits` / `getRangeJiraIssues` select the same column lists as today from `commit_canonical` (`AND github_login = ?`) / `jira_canonical` (optional login), same `ORDER BY`. `rangeReports` (ids, measured days, developer list) is unchanged, and the `ids.length === 0 → []` guards stay on both paths. The fallback queries stay byte-for-byte as they are. The cache key array becomes `[org, since, until, measuredDays, ids, build?.builtAt ?? 'fallback']`.

- [ ] **Step 1: Write the failing equivalence test** `canonical-equivalence-db.test.ts` (real SQLite). Fixture for org `acme`: completed daily reports `r1`–`r3` (created 2026-10-01..03), an old completed `r0` (2026-05-01), a failed `f1` (2026-10-04); developers in each completed report. Commit `dup` copied in r1/r2/r3 with the r3 copy's complexity NULL; commits spread so some fall in the 90-day window (anchor r3) and one (`old`, 2026-04-20) only in 12 months; `fx` only in `f1`. Jira `J-1` in r1–r3 with the assignee changing in r3; `J-OLD` in r0. Helper `snapshot()` returns `{ dev90, dev12, commits90, commits12, jira90, jira12, current }` from `getRangeDeveloperStats`, `getRangeCommits('acme','alice',w)`, `getRangeJiraIssues('acme', undefined, w)` for both windows (`rangeWindow(r3, '90d' | '12m')`), and `getReport('r3', 'current')`.
  - `it('fallback (not built) matches the canonical tables after a rebuild')` — `before = await snapshot()`; `await rebuildCanonical(); clearRangeCache();` `after = await snapshot()`; `expect(after).toEqual(before)`.
  - `it('current-report figures are unchanged by a build')` — `after.current` equals `before.current` (asserted separately so a failure names it).
  - `it('a commit found only by a non-overlapping report is counted after the build (documented difference)')` — add commit `rebased` dated inside the 90-day window but stored only in `r0`; before the build `commits90` lacks it, after the build it contains it. This is the only difference allowed.
  - `it('cache key changes when built_at changes')` — call `getRangeDeveloperStats` (built), then change a canonical row's `lines_added` directly and update `canonical_builds.built_at`; the next call reflects the changed lines.
- [ ] **Step 2: Run** `npx jest canonical-equivalence-db` — Expected: FAIL on the documented-difference and cache-key tests (readers still use the fallback).
- [ ] **Step 3: Implement the switch in `range.ts`** (Decision 11 for the key).
- [ ] **Step 4: Run** `npx jest canonical-equivalence-db report-range canonical-join-order range-cache` — Expected: PASS. Add the Decision 12 mock to any mock-DB range suite that fails on call order.
- [ ] **Step 5: Commit** `git add src/lib/report/range.ts src/lib/__tests__/unit && git commit -m "GLOOK-63: range readers use canonical tables once built"`

---

### Task 6: Weekly charts, summary history and MCP commit query switch

**Files:**
- Modify: `src/lib/report/org.ts:63-78` (org timeline)
- Modify: `src/lib/report/dev.ts:104-120` (engineer timeline)
- Modify: `src/lib/report/summary.ts:120-135` (extract `loadDevCommitHistory`)
- Modify: `src/lib/mcp/queries.ts:114-166` (`queryCommits` cross-report branch)
- Modify: `src/lib/__tests__/unit/canonical-equivalence-db.test.ts`
- Modify (Decision 12 mock only): `report-org.test.ts`, `report-dev.test.ts`, `report-summary.test.ts`, `org-unmerged-summary.test.ts`, `org-model-usage.test.ts`, `org-route-model-gating.test.ts`, `cc-breakdown-dev-route.test.ts`, `mcp-queries.test.ts`, `report-cost-gating.test.ts`, `report-coverage.test.ts` — whichever fail on call order.

**Interfaces:**
- Consumes: `isCanonicalBuilt(org)`.
- Produces: `loadDevCommitHistory(org: string, login: string): Promise<any[]>` in `summary.ts` (rows: `commit_sha, committed_at, lines_added, lines_removed, complexity, type, ai_co_authored, maybe_ai`, `ORDER BY committed_at DESC`); `getDevSummary` calls it. Built-path queries:
  - org: `SELECT commit_sha, github_login, committed_at, lines_added, lines_removed, complexity, type, ai_co_authored, maybe_ai, pr_number FROM commit_canonical WHERE org = ? ORDER BY committed_at ASC`
  - dev: same minus `github_login`, `WHERE org = ? AND github_login = ?`
  - summary: as above, `DESC`
  - MCP: `FROM commit_canonical ca WHERE ca.org = ? AND …` with the existing `ca.`-prefixed conditions and column list, `ORDER BY ca.committed_at DESC LIMIT ?`.
  The `reports` query in org.ts/dev.ts stays (it feeds coverage) and the call order of the fallback path is unchanged. Not-built orgs keep today's queries, including today's all-report scope for the timelines.

- [ ] **Step 1: Extend the equivalence test** — `snapshot()` also returns `orgTimeline: (await getOrgReport('r3')).timeline`, `devTimeline: (await getDevReport('r3','alice')).timeline`, `history: await loadDevCommitHistory('acme','alice')`, `mcp: await queryCommits({ limit: 500 })` (with `resolveReportId` resolving to the latest acme report). Add:
  - `it('weekly charts and summary history become completed-only (documented difference)')` — `before.history` contains `fx`; `after.history` does not; `before.orgTimeline` total commits − `after.orgTimeline` total commits = 1 for the week of `fx`; with `fx` removed from `before`, the two are equal.
  - The existing `toEqual` test compares `mcp` too (the MCP query was already completed-only).
- [ ] **Step 2: Run** `npx jest canonical-equivalence-db` — Expected: FAIL on the completed-only test.
- [ ] **Step 3: Implement the four switches and the extraction.**
- [ ] **Step 4: Run** `npx jest canonical-equivalence-db commit-dedupe-db canonical-join-order report-org report-dev report-summary mcp-queries mcp-dedup` — Expected: PASS (adding the Decision 12 mock where needed). Then `npm test` — Expected: all suites pass.
- [ ] **Step 5: Commit** `git add -A src/lib && git commit -m "GLOOK-63: weekly charts, summary history and MCP commits read canonical tables"`

---

### Task 7: LLM analysis reuse

**Files:**
- Create: `src/lib/canonical/reuse.ts`
- Modify: `src/lib/report-runner.ts` (~line 59: compute `reuseEnabled`; ~448: call `analyzeWithReuse`; ~549: summary log line)
- Test: `src/lib/__tests__/unit/canonical-reuse-db.test.ts`

**Interfaces:**
- Consumes: `isCanonicalBuilt`, `commit_canonical`.
- Produces:
  - `findReusableAnalysis(org: string, sha: string): Promise<CommitAnalysis | null>` — `SELECT complexity, type, impact_summary, risk_level, maybe_ai FROM commit_canonical WHERE org = ? AND commit_sha = ? AND complexity IS NOT NULL`.
  - `analyzeWithReuse(org: string, commit: CommitData, reuseEnabled: boolean): Promise<{ analysis: CommitAnalysis; reused: boolean }>` — reuse when enabled and found, else `analyzeCommit(commit)`.
  - Runner: `const reuseEnabled = await isCanonicalBuilt(org)` once per run; the existing `INSERT IGNORE INTO commit_analyses` writes `analysis.*` for complexity/type/impact_summary/risk_level/maybe_ai and keeps `commit.aiCoAuthored`, `commit.aiToolName`, lines and PR fields from the GitHub fetch; reused commits go into `analyses` like any other (count as analysed); after the LLM phase log exactly `Reused ${reused.toLocaleString('en-US')} analyses, ${llmCalls.toLocaleString('en-US')} new LLM calls`.

- [ ] **Step 1: Write the failing tests** (real SQLite; `jest.mock('@/lib/analyzer', () => ({ analyzeCommit: jest.fn() }))`; build `acme` with a commit `aaa` analysed complexity 7/type `bug`/risk `high`/maybe_ai 1, and `bbb` whose only copy has NULL complexity):
  - `it('reuses an analysis from an earlier completed report without calling the LLM')` — `analyzeWithReuse('acme', commitFor('aaa'), true)` → `{ reused: true, analysis: { sha: 'aaa', complexity: 7, type: 'bug', riskLevel: 'high', maybeAi: true, impactSummary: <stored> } }`; `analyzeCommit` not called.
  - `it('calls the LLM when the stored copy has no complexity')` — `bbb` → `analyzeCommit` called once, `reused: false`.
  - `it('never reuses before the org is built')` — `reuseEnabled=false` → `analyzeCommit` called even for `aaa`.
  - `it('never reuses across orgs')` — `analyzeWithReuse('other', commitFor('aaa'), true)` calls the LLM.
- [ ] **Step 2: Run** `npx jest canonical-reuse-db` — Expected: FAIL.
- [ ] **Step 3: Implement `reuse.ts` and wire the runner.**
- [ ] **Step 4: Run** `npx jest canonical-reuse-db && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/canonical/reuse.ts src/lib/report-runner.ts src/lib/__tests__/unit/canonical-reuse-db.test.ts && git commit -m "GLOOK-63: reuse earlier LLM analyses from commit_canonical"`

---

### Task 8: Admin API routes and background rebuild

**Files:**
- Create: `src/lib/canonical/progress.ts`
- Create: `src/app/api/settings/canonical/route.ts` (GET)
- Create: `src/app/api/settings/canonical/check/route.ts` (GET)
- Create: `src/app/api/settings/canonical/rebuild/route.ts` (POST)
- Test: `src/lib/__tests__/unit/canonical-api.test.ts`

**Interfaces:**
- Consumes: `listCanonicalBuilds`, `checkCanonical`, `acquireRebuildLock`, `runRebuild`, `getRebuildLock`, `RebuildRunningError`.
- Produces:
  - `progress.ts` (globalThis `__glookerCanonicalRebuild`): `interface RebuildProgress { running: boolean; startedAt: string | null; finishedAt: string | null; currentOrg: string | null; orgsDone: number; orgsTotal: number; results: CanonicalRebuildOrgResult[] | null; error: string | null }`; `getRebuildProgress(): RebuildProgress`; `startBackgroundRebuild(): Promise<void>` — awaits `acquireRebuildLock`, sets `running`, then fire-and-forget `runRebuild(...)` updating progress via `onProgress` and storing `results`/`error` and `finishedAt` on settle, and calls `clearRangeCache()`.
  - `GET /api/settings/canonical` → `200 { builds: CanonicalBuild[], lock: { startedAt, holder } | null, progress: RebuildProgress }`
  - `GET /api/settings/canonical/check` → `200 { orgs: CanonicalOrgCheck[] }`
  - `POST /api/settings/canonical/rebuild` → `202 { started: true }`; `409 { error: 'rebuild already running' }` on `RebuildRunningError`.
  - All three: `withRequestLog`, `requireAdmin` first.

- [ ] **Step 1: Write the failing tests** (mock `@/lib/auth` as in `skip-allowlist-api.test.ts`; mock `@/lib/canonical/rebuild`, `@/lib/canonical/state`):
  - `it.each(['status', 'check', 'rebuild'])('%s returns 403 for a viewer')` — `requireAdmin` resolves a 403 response; status 403; the mocked rebuild/check functions were not called.
  - `it('status returns builds, lock and progress')`.
  - `it('check returns the per-org results and writes nothing')` — body `{ orgs }` equal to the mocked `checkCanonical` value.
  - `it('rebuild returns 202 and starts in the background')` — `acquireRebuildLock` resolves; `runRebuild` called once; response status 202 before `runRebuild`'s promise resolves (use a never-resolving mock).
  - `it('rebuild returns 409 when one is already running')` — `acquireRebuildLock` rejects `new RebuildRunningError()`; status 409; body `{ error: 'rebuild already running' }`.
- [ ] **Step 2: Run** `npx jest canonical-api` — Expected: FAIL (routes missing).
- [ ] **Step 3: Implement `progress.ts` and the three routes.**
- [ ] **Step 4: Run** `npx jest canonical-api logger-enforcement` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/canonical/progress.ts src/app/api/settings/canonical src/lib/__tests__/unit/canonical-api.test.ts && git commit -m "GLOOK-63: admin routes for canonical check and rebuild"`

---

### Task 9: Settings "De-duplicated data" card

**Files:**
- Create: `src/app/settings/canonical-card.tsx` (default export `CanonicalCard`)
- Modify: `src/app/settings/page.tsx` (`AppSettingsTab`: render `<CanonicalCard />` first)
- Test: `src/lib/__tests__/unit/settings-canonical-card.test.tsx` (`/** @jest-environment jsdom */`)

**Interfaces:**
- Consumes: Task 8 routes and response shapes.
- Produces: `CanonicalCard(): JSX.Element | null`. Copy (exact):
  - Title `De-duplicated data`; subtitle `One copy of each commit and Jira issue, used by the 90-day and 12-month views.`
  - Per org, not built: `Not built yet — range views use the slower path`; built: `Last rebuild ${new Date(builtAt).toLocaleString()} · took ${(durationMs / 1000).toFixed(1)}s · ${commitRows} commits, ${jiraRows} issues`.
  - Buttons `Check` and `Rebuild`. Check results: a per-org table with rows `Commits` / `Jira issues` and columns `Stored`, `Expected`, `Differ`, then `Examples: ` + the keys joined by `, ` when `differ > 0`.
  - Rebuild confirmation: `Rebuild both tables for every org? Range views keep working during the rebuild.` with `Confirm rebuild` and `Cancel`.
  - While running (`progress.running` or `lock` non-null): `Rebuilding… ${orgsDone}/${orgsTotal} orgs` and both buttons disabled; polls `GET /api/settings/canonical` every 2000 ms until not running, then reloads status.
  - 409 → shows `rebuild already running`. A failed org shows `${org}: ${error}` in red.
  - Returns `null` when `useAuth().canAct` is false.

- [ ] **Step 1: Write the failing tests** (mock `@/app/auth-context` `useAuth`; `global.fetch` per URL; fake timers for polling):
  - `it('renders nothing for a viewer')` — `canAct: false` → `container.firstChild` null, `fetch` not called.
  - `it('shows Not built yet for an org without a build')`.
  - `it('shows last rebuild time and duration')`.
  - `it('Check shows stored, expected and differ per table with examples')`.
  - `it('Rebuild asks for confirmation and Cancel sends nothing')` — no POST in `fetch` calls.
  - `it('Confirm rebuild posts, then polls until finished')` — POST to `/api/settings/canonical/rebuild`; status `running` then not; advance timers 2000 ms; text `Rebuilding… 1/2 orgs` then the build line.
  - `it('shows rebuild already running on 409')`.
- [ ] **Step 2: Run** `npx jest settings-canonical-card` — Expected: FAIL.
- [ ] **Step 3: Implement the card** using the existing card shell classes (`bg-gray-900 rounded-xl p-5`, button classes from `CcSpendRefreshBlock`), and render it in `AppSettingsTab`.
- [ ] **Step 4: Run** `npx jest settings-canonical-card && npx tsc --noEmit` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add src/app/settings/canonical-card.tsx src/app/settings/page.tsx src/lib/__tests__/unit/settings-canonical-card.test.tsx && git commit -m "GLOOK-63: Settings card for canonical check and rebuild"`

---

### Task 10: CLI, seed and documentation

**Files:**
- Create: `scripts/rebuild-canonical.ts`
- Modify: `package.json` (script `"rebuild:canonical": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/rebuild-canonical.ts"`)
- Modify: `scripts/seed.ts` (after `seedVulnerabilities`, `await (await import('../src/lib/canonical/rebuild')).rebuildCanonical()`)
- Modify: `CLAUDE.md`
- Create: `src/lib/canonical/cli.ts` (testable core)
- Test: `src/lib/__tests__/unit/canonical-cli-db.test.ts`

**Interfaces:**
- Consumes: `checkCanonical`, `rebuildCanonical`, `RebuildRunningError`.
- Produces: `runCanonicalCli(argv: string[], out: (line: string) => void): Promise<number>` (exit code). `--check`: prints per org `${org}: ${builtAt ?? 'not built'}` then `  commits stored=${s} expected=${e} differ=${d}` and `  jira    stored=… expected=… differ=…`, plus `    e.g. ${examples.join(', ')}` when `differ > 0`; exit 0 when all differ are 0 and every org is built, else 1. No flag: rebuild, prints `${org}: ok (${commitRows} commits, ${jiraRows} issues, ${durationMs}ms)` or `${org}: FAILED ${error}`; exit 0 all ok, 2 any failed, 3 with `rebuild already running` on the lock. The script is `parseArgs` + `process.exit(await runCanonicalCli(...))`, like `backfill-prs.ts`.

- [ ] **Step 1: Write the failing tests** (real SQLite fixture):
  - `it('--check reports not built and exits 1 before the first build')`.
  - `it('rebuild prints ok per org and exits 0, then --check exits 0')`.
  - `it('exits 3 with rebuild already running when the lock is held')`.
  - `it('--check writes nothing')` — row counts of all four canonical tables unchanged.
- [ ] **Step 2: Run** `npx jest canonical-cli-db` — Expected: FAIL.
- [ ] **Step 3: Implement `cli.ts`, the script, the package.json entry and the seed call.** Update `CLAUDE.md`:
  - Commands: `npm run rebuild:canonical -- [--check]`.
  - In the GLOOK-63 decision: range figures, weekly charts, summary history and the MCP cross-report commit query read `commit_canonical`/`jira_canonical` once the org has a `canonical_builds` row (else the old de-dupe queries); the pick is across **all** completed reports of the org (deliberate change from window-overlapping reports); weekly charts and summary history are completed-only; upkeep runs in the completion and delete transactions; writes that bypass the app (direct imports such as the GLOOK-34 backfill, manual SQL) are not reflected until Rebuild — Check detects them; rollback is `DELETE FROM canonical_builds WHERE org = ?`.
  - Beside the prompt-template gotcha: a changed analysis prompt does not apply to commits whose analysis is reused from `commit_canonical`.
  - Tables gotcha: `commit_canonical`, `jira_canonical`, `canonical_builds`, `canonical_rebuild_lock` exist in all three schema files.
- [ ] **Step 4: Run** `npx jest canonical-cli-db && npm test && npm run seed:reset` — Expected: all pass; seed completes and `sqlite3 glooker.db "SELECT COUNT(*) FROM canonical_builds"` is ≥ 1.
- [ ] **Step 5: Commit** `git add scripts/rebuild-canonical.ts scripts/seed.ts package.json CLAUDE.md src/lib/canonical/cli.ts src/lib/__tests__/unit/canonical-cli-db.test.ts && git commit -m "GLOOK-63: rebuild:canonical CLI, seed build and docs"`
- [ ] **Step 6 (manual, owner approval required, not part of CI):** against dev RDS run `npm run rebuild:canonical -- --check` (read-only) and report the per-org numbers. After deploy and an admin Rebuild, time a cold 12-month Team view on dev; target under 1 s. Record both results in the PR description.
