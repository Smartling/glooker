# Service Layer Extraction — developers, llm-config, orgs, report, report-highlights

## Context

Continuing the refactor started with `schedule/` and `teams/` — extracting business logic from API controllers into `src/lib/<domain>/service.ts` modules. Controllers become thin HTTP adapters.

## Services to Create

### 1. `src/lib/developers/service.ts`
- `listDevelopers(org, query?, limit?)` — DB query, dedup by login, filter, limit
- `listDevelopersFromGitHub(org, query?)` — GitHub API fallback

### 2. `src/lib/llm-config/service.ts`
- `getLLMConfig()` — build config from env vars, check missing
- `testLLMConnection()` — ping LLM, measure latency

### 3. `src/lib/orgs/service.ts`
- `listOrgs()` — paginated GitHub API

### 4. `src/lib/report/` (split into focused files)
- `service.ts` — `listReports()`, `createReport(input)`, `getReport(id)`, `deleteReport(id)`, `getReportProgress(id)`, `stopReport(id)`, `resumeReport(id)`
- `org.ts` — `getOrgReport(id)` (org timeline with weekly aggregation)
- `dev.ts` — `getDevReport(id, login)` (dev detail + timeline)
- `summary.ts` — `getDevSummary(id, login)` (LLM summary with cache)
- `commits.ts` — `getReportCommits(reportId, login)`
- Shared: `aggregateWeekly()` helper (dedup in org.ts and dev.ts)

### 5. `src/lib/report-highlights/service.ts`
- `getReportHighlights()` — cache check, delta computation, LLM call, cache save

## Test Strategy

Controller-level tests for each group, mocking DB/GitHub/LLM. Tests verify:
- Correct JSON response shape and status codes
- Error cases (400, 404, 500)
- Business logic (dedup, filtering, caching)

Tests written BEFORE refactor to establish baseline, then verified AFTER.

## Typed Errors

Same pattern as schedule/teams:
- `ReportNotFoundError`
- `DeveloperNotFoundError` (for dev detail/summary)

## Files Created

| Path | Purpose |
|------|---------|
| `src/lib/developers/service.ts` | Developer listing logic |
| `src/lib/developers/index.ts` | Barrel |
| `src/lib/llm-config/service.ts` | LLM config + connection test |
| `src/lib/llm-config/index.ts` | Barrel |
| `src/lib/orgs/service.ts` | Org listing |
| `src/lib/orgs/index.ts` | Barrel |
| `src/lib/report/service.ts` | Report CRUD + lifecycle |
| `src/lib/report/org.ts` | Org timeline |
| `src/lib/report/dev.ts` | Dev detail |
| `src/lib/report/summary.ts` | Dev summary (LLM) |
| `src/lib/report/commits.ts` | Commits lookup |
| `src/lib/report/index.ts` | Barrel |
| `src/lib/report-highlights/service.ts` | Report highlights |
| `src/lib/report-highlights/index.ts` | Barrel |
