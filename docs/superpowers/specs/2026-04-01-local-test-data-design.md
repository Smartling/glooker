# Local Test Data & Mock Providers

**Date:** 2026-04-01
**Goal:** Make the full app testable locally without GitHub, Jira, or LLM credentials by adding mock providers and a DB seed script.

## Problem

Several pages (reports, developer detail, projects) are impossible to test locally without real data. Running a report requires GitHub + LLM tokens. The projects page requires Jira credentials. This slows development and makes visual testing (e.g., theme changes) impractical.

## Approach

Provider-based mocking + explicit seed script. Uses the existing abstraction layers (LLM provider, Jira client) rather than scattering conditionals through production code.

## Design

### 1. Mock LLM Provider

Add `mock` as a value for `LLM_PROVIDER` in `src/lib/llm-provider.ts`. Update the `Provider` type union to include `'mock'`.

**Implementation:** `src/lib/llm-mock.ts` — a duck-typed adapter (like bedrock-adapter) that implements the OpenAI chat completions interface. Returns static fixture responses by matching a unique substring in the system prompt (prompts are composed at runtime via `{{PLACEHOLDER}}` substitution, so match on a known phrase from each template, not the filename):

| System prompt contains | Source template | Response |
|----------------------|----------------|----------|
| `"commit impact analysis"` | `analyzer-system.txt` | Fixture `{complexity, type, impact_summary, risk_level}` JSON |
| `"AI-assisted"` | `analyzer-system-ai-confirmed.txt` | Same shape as above, with `ai_co_authored` context |
| `"Summarize this epic"` | `epic-summary-system.txt` | Fixture narrative text |
| `"Analyze these commits from team"` | `untracked-work-system.txt` | Fixture `WorkGroup[]` JSON |
| `"Write a developer summary"` | `report-summary-system.txt` | Fixture narrative with badges JSON |
| `"engineering analytics assistant"` | `report-highlights-system.txt` | Fixture comparison JSON |
| `"Glooker Assistant"` | `chat-agent-system.txt` | Fixture chat response |
| `"Reply with exactly"` | `llm-config-test-system.txt` | `"OK"` |
| (fallback) | — | Generic acknowledgment |

Note: `analyzer-calibration.txt` is not a standalone prompt — it is composed into `analyzer-system.txt` via `{{COMPLEXITY_CALIBRATION}}` substitution. No separate mock entry needed.

No network calls, instant responses. Static responses per prompt type — variation comes from the seed data (different developers, commit counts), not the mock LLM.

### 2. Mock Jira Client

**Implementation:** `src/lib/jira/mock-client.ts` — implements a `JiraClientInterface` extracted from the concrete `JiraClient` class. Both the real client and mock client implement this interface.

**Refactor required:** Extract `JiraClientInterface` from `JiraClient` with these methods:
- `searchEpics(jql)` — returns 3-4 epics across 2 business goals and 2 initiatives
- `searchChildIssues(epicKey)` — returns 2 child issues per epic (mix of resolved and remaining)
- `searchDoneIssues(accountId, periodDays, projects?, storyPointsFields?)` — returns resolved issues for the report runner's Jira phase
- `findUserByEmail(email)` — maps to seeded user mappings
- `testConnection()` — returns success (for settings page "Test Jira Connection" button). Note: `testJiraConnection()` in `src/lib/jira/service.ts` currently constructs a `JiraClient` directly, bypassing `getJiraClient()`. Refactor it to use the factory so mock mode works.

Update `getJiraClient()` return type from `JiraClient | null` to `JiraClientInterface | null`.

**Selection:** `JIRA_PROVIDER=mock` env var — explicit and independent from `LLM_PROVIDER`, following the same per-service provider pattern. When `JIRA_ENABLED=true` and `JIRA_PROVIDER=mock`, the factory returns `MockJiraClient` and skips the `JIRA_HOST`/`JIRA_USERNAME`/`JIRA_API_TOKEN` credential guards. This lets you mock Jira independently of LLM (e.g., real LLM + mock Jira, or vice versa).

### 3. Seed Script

**Entry point:** `scripts/seed.ts` — uses relative imports (no `@/*` aliases) to avoid path resolution issues. Add `tsx` to devDependencies.

**Run via:** `npm run seed` (alias for `tsx scripts/seed.ts`).

**Fixture data:** `scripts/seed-data.ts` — single file exporting all fixture arrays.

**What it seeds:**

| Table | Records | Notes |
|-------|---------|-------|
| `reports` | 3 | Two completed (14d and 30d periods), one with status `running` (for testing progress/log panel UI) |
| `developer_stats` | 8 per report | Varied profiles: high/mid/low performers |
| `commit_analyses` | 3-5 per developer | Mix of feature/bug/refactor/docs, varied complexity, some AI-flagged |
| `jira_issues` | 2-3 per developer | Resolved issues with realistic summaries |
| `teams` | 3 | "Platform", "Frontend", "Data" |
| `team_members` | 8 distributed across teams | Maps to the 8 developers |
| `user_mappings` | 8 | GitHub login to Jira email/account. `jira_email` values must match the `assigneeEmail` values returned by mock `searchEpics` |
| `developer_summaries` | 8 per report | Pre-generated narrative + badges |
| `report_comparisons` | 1 | Links the two completed reports, with pre-generated `highlights_json` |
| `epic_summaries` | 3-4 | Pre-cached, matching the mock Jira epic keys |
| `untracked_summaries` | 1 per team | Pre-cached so "show untracked" works |
| `schedules` | 1 | One weekly schedule (renders on settings Schedules tab) |
| `release_notes` | 1 | Cached release notes (renders on dashboard) |

**Behavior:**
- Idempotent: uses `INSERT OR IGNORE` via the DB abstraction layer (SQLite translator handles this)
- Targets SQLite only (the local-dev default)
- Uses the existing DB abstraction layer (`src/lib/db`) — first `execute()` call triggers schema creation on a fresh DB
- Fictional but realistic data (no real names/emails from production)
- Org name: `mock-org`

### 4. Developer Workflow

**First-time setup:**
```
npm install
npm run seed
npm run dev:mock
```

**Package.json scripts:**
```json
"seed": "tsx scripts/seed.ts",
"dev:mock": "LLM_PROVIDER=mock JIRA_ENABLED=true JIRA_PROVIDER=mock JIRA_PROJECTS_JQL='project = MOCK AND issuetype = Epic' next dev"
```

Note: `GITHUB_TOKEN` is not set in `dev:mock`. The env validation will log a warning — this is expected in mock mode. The release-notes endpoint will return cached data from the seed; a cache miss returns empty gracefully.

**Resetting data:** `rm glooker.db && npm run seed`

### 5. Maintenance Instructions (CLAUDE.md addition)

> When adding or modifying database tables, API response shapes, or page data requirements: update `scripts/seed-data.ts` to include the new columns/tables. Run `npm run seed` on a fresh DB and verify affected pages render correctly with `npm run dev:mock`. When adding a new LLM prompt template, add a corresponding fixture response in the mock LLM provider (`src/lib/llm-mock.ts`).

## Files Touched

| File | Change |
|------|--------|
| `src/lib/llm-provider.ts` | Add `'mock'` to `Provider` type union and switch case |
| `src/lib/llm-mock.ts` (new) | Mock LLM adapter (duck-typed, like bedrock-adapter) |
| `src/lib/jira/types.ts` (new) | Extract `JiraClientInterface` from concrete class |
| `src/lib/jira/mock-client.ts` (new) | Mock Jira client implementing `JiraClientInterface` |
| `src/lib/jira/client.ts` | Implement `JiraClientInterface`, mock factory check before credential guards |
| `src/lib/jira/service.ts` | Refactor `testJiraConnection()` to use `getJiraClient()` factory |
| `scripts/seed.ts` (new) | Seed script entry point (relative imports, no `@/*` aliases) |
| `scripts/seed-data.ts` (new) | All fixture data |
| `package.json` | Add `tsx` to devDependencies, add `seed` and `dev:mock` scripts |
| `CLAUDE.md` | Add maintenance instruction |
| `.env.example` | Document `LLM_PROVIDER=mock`, `JIRA_PROVIDER=mock`, and mock-mode workflow |
| `src/lib/env-validation.ts` | Accept `mock` as valid `LLM_PROVIDER` and `JIRA_PROVIDER` values; skip Jira credential checks when `JIRA_PROVIDER=mock` |

## Out of Scope

- GitHub API mocking (seed script covers what GitHub would fetch)
- Production data export/sanitization
- Automated test suite using mock providers (future work)
- Mock data for auth/user profile features (`AUTH_ENABLED`)
- Mock progress store for the "running" report (the log panel renders from the in-memory progress store; seed data puts the report in `running` status so the UI shows the panel, but live log entries require the report runner to actually execute)
