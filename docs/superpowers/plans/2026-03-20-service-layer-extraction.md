# Service Layer Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract business logic from developers, llm-config, orgs, report, and report-highlights API controllers into `src/lib/<domain>/` service modules, following the established `schedule/` and `teams/` pattern.

**Architecture:** Each domain gets a `src/lib/<domain>/service.ts` (or multiple focused files for report/) with exported functions. Controllers become thin HTTP adapters: parse request → validate → call service → format response. Typed error classes enable controllers to map domain errors to HTTP status codes.

**Approach: Tests First.** For each domain: (1) write controller-level tests against the CURRENT code to establish baseline, (2) commit tests, (3) extract service layer, (4) verify tests still pass, (5) commit extraction. This ensures no behavior changes during refactoring.

**Tech Stack:** Next.js 15 API routes, Jest + ts-jest, SQLite/MySQL dual DB

---

## File Structure

```
src/lib/
├── developers/
│   ├── service.ts      # listDevelopers, listDevelopersFromGitHub
│   └── index.ts        # barrel
├── llm-config/
│   ├── service.ts      # getLLMConfig, testLLMConnection
│   └── index.ts        # barrel
├── orgs/
│   ├── service.ts      # listOrgs
│   └── index.ts        # barrel
├── report/
│   ├── service.ts      # CRUD + lifecycle (list, create, get, delete, progress, stop, resume)
│   ├── org.ts          # getOrgReport (org timeline with weekly aggregation)
│   ├── dev.ts          # getDevReport (dev detail + timeline)
│   ├── summary.ts      # getDevSummary (LLM + cache)
│   ├── commits.ts      # getReportCommits
│   ├── timeline.ts     # shared aggregateWeekly helper (used by org.ts and dev.ts)
│   └── index.ts        # barrel
├── report-highlights/
│   ├── service.ts      # getReportHighlights
│   └── index.ts        # barrel
```

---

## Task Ordering: Tests First

Each task follows: **(A) write tests against current controllers → commit tests → (B) extract service → verify tests still pass → commit extraction.**

---

### Task 1: `developers` — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/developers-service.test.ts`
- Create: `src/lib/developers/service.ts`
- Create: `src/lib/developers/index.ts`
- Modify: `src/app/api/developers/route.ts`

**Phase A: Tests (against current controller logic)**

- [ ] **Step 1: Write tests `src/lib/__tests__/unit/developers-service.test.ts`**

Mock `@/lib/db/index` and `@/lib/github`. Test the business logic currently in the controller:
- DB query returns multiple rows for same login → dedup keeps first (latest) name/avatar
- Filter by query matches login (case-insensitive)
- Filter by query matches github_name (case-insensitive)
- Limit parameter truncates results
- GitHub source maps members to `{ github_login, github_name: null, avatar_url }`
- GitHub source filters by query
- GitHub source caps at 20 results

- [ ] **Step 2: Run tests** — `npm test -- --testPathPattern=developers-service` — all pass

- [ ] **Step 3: Commit tests** — `git commit -m "test: add developers service tests"`

**Phase B: Extract**

- [ ] **Step 4: Create `src/lib/developers/service.ts`** — extract `listDevelopers(org, opts)` and `listDevelopersFromGitHub(org, query)` from controller

- [ ] **Step 5: Create `src/lib/developers/index.ts`** — barrel export

- [ ] **Step 6: Simplify controller** — thin HTTP adapter calling service functions

- [ ] **Step 7: Run all tests** — `npm test` — all pass

- [ ] **Step 8: Commit extraction** — `git commit -m "refactor: extract developers service layer into src/lib/developers/"`

---

### Task 2: `orgs` — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/orgs-service.test.ts`
- Create: `src/lib/orgs/service.ts`
- Create: `src/lib/orgs/index.ts`
- Modify: `src/app/api/orgs/route.ts`

**Phase A: Tests**

- [ ] **Step 1: Write tests** — mock `@octokit/rest`. Test:
  - Returns mapped org objects `{ login, avatar_url }`
  - Handles missing avatar_url (defaults to `''`)
  - Handles pagination (multiple pages)

- [ ] **Step 2: Run tests, commit** — `git commit -m "test: add orgs service tests"`

**Phase B: Extract**

- [ ] **Step 3: Create `src/lib/orgs/service.ts`** — `listOrgs()`
- [ ] **Step 4: Create barrel, simplify controller**
- [ ] **Step 5: Run all tests, commit** — `git commit -m "refactor: extract orgs service layer into src/lib/orgs/"`

---

### Task 3: `llm-config` — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/llm-config-service.test.ts`
- Create: `src/lib/llm-config/service.ts`
- Create: `src/lib/llm-config/index.ts`
- Modify: `src/app/api/llm-config/route.ts`

**Phase A: Tests**

- [ ] **Step 1: Write tests** — mock `process.env` and `@/lib/llm-provider`. Test:
  - `getLLMConfig` for each provider (openai, anthropic, openai-compatible, smartling)
  - Missing env vars detected correctly
  - `testLLMConnection` success case with latency
  - `testLLMConnection` failure case with error message

- [ ] **Step 2: Run tests, commit** — `git commit -m "test: add llm-config service tests"`

**Phase B: Extract**

- [ ] **Step 3: Create `src/lib/llm-config/service.ts`** — `getLLMConfig()`, `testLLMConnection()`
- [ ] **Step 4: Create barrel, simplify controller**
- [ ] **Step 5: Run all tests, commit** — `git commit -m "refactor: extract llm-config service layer into src/lib/llm-config/"`

---

### Task 4: `report` CRUD + Lifecycle — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/report-service.test.ts`
- Create: `src/lib/report/service.ts`
- Modify: `src/app/api/report/route.ts`
- Modify: `src/app/api/report/[id]/route.ts`
- Modify: `src/app/api/report/[id]/progress/route.ts`
- Modify: `src/app/api/report/[id]/stop/route.ts`
- Modify: `src/app/api/report/[id]/resume/route.ts`

**Phase A: Tests**

- [ ] **Step 1: Write tests** — mock `db`, `report-runner`, `progress-store`, `uuid`. Test:
  - `listReports` returns rows ordered by created_at DESC, limit 20
  - `createReport` inserts, calls initProgress, fires runReport
  - `getReport` returns report + developers with parsed JSON columns
  - `getReport` throws `ReportNotFoundError` when missing
  - `deleteReport` deletes, throws `ReportNotFoundError` when affectedRows=0
  - `getReportProgress` returns from memory store first
  - `getReportProgress` falls back to DB reconstruction for running report
  - `getReportProgress` throws `ReportNotFoundError`
  - `stopReport` calls requestStop, updates DB + progress
  - `stopReport` throws `ReportNotRunningError` if status != 'running'
  - `resumeReport` resets status, fires runReport with resume=true
  - `resumeReport` throws `ReportAlreadyCompletedError`

- [ ] **Step 2: Run tests, commit** — `git commit -m "test: add report CRUD/lifecycle service tests"`

**Phase B: Extract**

- [ ] **Step 3: Create `src/lib/report/service.ts`** with typed errors: `ReportNotFoundError`, `ReportNotRunningError`, `ReportAlreadyCompletedError`
- [ ] **Step 4: Simplify all 5 controller files**
- [ ] **Step 5: Run all tests, commit** — `git commit -m "refactor: extract report CRUD/lifecycle service into src/lib/report/"`

---

### Task 5: Shared Timeline Helper — Tests + Implementation

**Files:**
- Create: `src/lib/__tests__/unit/report-timeline.test.ts`
- Create: `src/lib/report/timeline.ts`

**Phase A: Tests**

- [ ] **Step 1: Write tests** for pure functions (no mocks needed):
  - `dedupCommitsBySha` keeps first occurrence, removes duplicates
  - `aggregateWeekly` groups commits into Monday-aligned weeks
  - `aggregateWeekly` calculates avgComplexity correctly
  - `aggregateWeekly` calculates aiPercent (ai_co_authored OR maybe_ai)
  - `aggregateWeekly` with `trackDevs: true` counts unique activeDevs per week
  - `aggregateWeekly` sorts by week ascending

- [ ] **Step 2: Run tests, commit** — `git commit -m "test: add timeline aggregation tests"`

**Phase B: Implement**

- [ ] **Step 3: Create `src/lib/report/timeline.ts`** — `dedupCommitsBySha()`, `aggregateWeekly()`
- [ ] **Step 4: Run all tests, commit** — `git commit -m "feat: add shared timeline aggregation helper"`

---

### Task 6: `report/commits.ts` + `report/org.ts` — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/report-org.test.ts`
- Create: `src/lib/report/commits.ts`
- Create: `src/lib/report/org.ts`
- Modify: `src/app/api/report/[id]/commits/route.ts`
- Modify: `src/app/api/report/[id]/org/route.ts`

**Phase A: Tests**

- [ ] **Step 1: Write tests** — mock `db`. Test:
  - `getReportCommits` returns commits for given report+login
  - `getOrgReport` returns `{ report, developers, timeline }` with parsed JSON columns
  - `getOrgReport` throws `ReportNotFoundError`
  - Timeline uses `aggregateWeekly` with `trackDevs: true`

- [ ] **Step 2: Run tests, commit** — `git commit -m "test: add report org and commits service tests"`

**Phase B: Extract**

- [ ] **Step 3: Create service files using `aggregateWeekly`/`dedupCommitsBySha` from timeline.ts**
- [ ] **Step 4: Simplify controllers, run all tests, commit** — `git commit -m "refactor: extract report commits and org service"`

---

### Task 7: `report/dev.ts` + `report/summary.ts` — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/report-dev.test.ts`
- Create: `src/lib/__tests__/unit/report-summary.test.ts`
- Create: `src/lib/report/dev.ts`
- Create: `src/lib/report/summary.ts`
- Modify: `src/app/api/report/[id]/dev/[login]/route.ts`
- Modify: `src/app/api/report/[id]/dev/[login]/summary/route.ts`

**Phase A: Tests**

- [ ] **Step 1: Write dev tests** — mock `db`. Test:
  - `getDevReport` returns `{ report, developer, allDevelopers, commits, timeline }`
  - `getDevReport` throws `ReportNotFoundError`, `DeveloperNotFoundError`
  - Timeline uses `aggregateWeekly` without `trackDevs`

- [ ] **Step 2: Write summary tests** — mock `db` + `llm-provider`. Test:
  - Cached summary returns immediately (no LLM call)
  - Fresh summary calls LLM, parses response, saves to DB
  - `ReportNotFoundError` when report missing
  - `DeveloperNotFoundError` when dev not in report
  - LLM error returns error message

- [ ] **Step 3: Run tests, commit** — `git commit -m "test: add report dev and summary service tests"`

**Phase B: Extract**

- [ ] **Step 4: Create `src/lib/report/dev.ts`** and `src/lib/report/summary.ts`**
- [ ] **Step 5: Simplify controllers, run all tests, commit** — `git commit -m "refactor: extract report dev and summary services"`

---

### Task 8: `report-highlights` — Tests + Extraction

**Files:**
- Create: `src/lib/__tests__/unit/report-highlights-service.test.ts`
- Create: `src/lib/report-highlights/service.ts`
- Create: `src/lib/report-highlights/index.ts`
- Modify: `src/app/api/report-highlights/route.ts`

**Phase A: Tests**

- [ ] **Step 1: Write tests** — mock `db` + `llm-provider`. Test:
  - No completed reports → `{ available: false }`
  - No previous report for same org+period → `{ available: false }`
  - Cached highlights returns without LLM call, `cached: true`
  - Fresh generation: calls LLM, saves to DB, returns `cached: false`
  - Computes deltas correctly (newDevs, inactiveDevs, top movers)

- [ ] **Step 2: Run tests, commit** — `git commit -m "test: add report-highlights service tests"`

**Phase B: Extract**

- [ ] **Step 3: Create `src/lib/report-highlights/service.ts`** — `getReportHighlights()`
- [ ] **Step 4: Create barrel, simplify controller to ~10 lines**
- [ ] **Step 5: Run all tests, commit** — `git commit -m "refactor: extract report-highlights service layer"`

---

### Task 9: Report Barrel Export + Final Verification

**Files:**
- Create: `src/lib/report/index.ts`

- [ ] **Step 1: Create barrel** — re-export all public functions from service.ts, org.ts, dev.ts, summary.ts, commits.ts, timeline.ts

- [ ] **Step 2: Run full test suite** — `npm test` — all pass

- [ ] **Step 3: Run build** — `npm run build` — compiles successfully

- [ ] **Step 4: Commit** — `git commit -m "chore: add report barrel export"`
