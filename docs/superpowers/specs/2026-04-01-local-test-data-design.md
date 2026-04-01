# Local Test Data & Mock Providers

**Date:** 2026-04-01
**Goal:** Make the full app testable locally without GitHub, Jira, or LLM credentials by adding mock providers and a DB seed script.

## Problem

Several pages (reports, developer detail, projects) are impossible to test locally without real data. Running a report requires GitHub + LLM tokens. The projects page requires Jira credentials. This slows development and makes visual testing (e.g., theme changes) impractical.

## Approach

Provider-based mocking + explicit seed script. Each external service gets its own mock provider (`LLM_PROVIDER=mock`, `JIRA_PROVIDER=mock`, `GITHUB_PROVIDER=mock`), following the existing per-service provider pattern. A seed script populates the DB. Shared mock identities are defined once and imported by both seed and mock providers.

## Design

### 1. Shared Mock Identities

**`scripts/mock-identities.ts`** — single source of truth for all mock entity references. Both the seed script and mock providers import from here. Changing a developer name, email, or team assignment in one place updates everywhere.

Exports:
- `MOCK_ORG` — the org name (`'mock-org'`)
- `MOCK_DEVELOPERS` — array of 8 developers with `githubLogin`, `githubName`, `avatarUrl`, `jiraEmail`, `jiraAccountId`, `team`
- `MOCK_TEAMS` — array of 3 teams with `id`, `name`, `color`
- `MOCK_EPICS` — array of 3-4 epic keys/summaries used by both mock Jira and seed epic_summaries
- `MOCK_REPORT_IDS` — the 3 report UUIDs (referenced across tables)

### 2. Mock LLM Provider

Add `mock` as a value for `LLM_PROVIDER` in `src/lib/llm-provider.ts`. Update the `Provider` type union to include `'mock'`.

**Prompt identification:** Add a `promptTag(name: string)` function exported from `llm-provider.ts` that returns `{ __prompt_id: name }`. Each LLM call site adds `...promptTag('analyzer-system')` alongside the existing `...extraBodyProps()`. The mock adapter reads `params.__prompt_id` to select the fixture. Real providers ignore unknown keys. This eliminates fragile substring matching — the contract is explicit and type-safe.

**Implementation:** `src/lib/llm-mock.ts` — a duck-typed adapter (like bedrock-adapter) that implements the OpenAI chat completions interface. Routes on `params.__prompt_id`:

| `__prompt_id` | Source template | Response |
|--------------|----------------|----------|
| `analyzer-system` | `analyzer-system.txt` | Fixture `{complexity, type, impact_summary, risk_level}` JSON |
| `analyzer-system-ai-confirmed` | `analyzer-system-ai-confirmed.txt` | Same shape, with `ai_co_authored` context |
| `epic-summary-system` | `epic-summary-system.txt` | Fixture narrative text |
| `untracked-work-system` | `untracked-work-system.txt` | Fixture `WorkGroup[]` JSON |
| `report-summary-system` | `report-summary-system.txt` | Fixture narrative with badges JSON |
| `report-highlights-system` | `report-highlights-system.txt` | Fixture comparison JSON |
| `chat-agent-system` | `chat-agent-system.txt` | Fixture chat response |
| `llm-config-test-system` | `llm-config-test-system.txt` | `"OK"` |
| (fallback) | — | Generic acknowledgment |

No network calls, instant responses. Static responses per prompt type — variation comes from the seed data (different developers, commit counts), not the mock LLM.

### 3. Mock Jira Client

**Implementation:** `src/lib/jira/mock-client.ts` — implements a `JiraClientInterface` extracted from the concrete `JiraClient` class. Both the real client and mock client implement this interface. Imports epic/developer data from `scripts/mock-identities.ts`.

**Refactor required:** Extract `JiraClientInterface` from `JiraClient` with these methods:
- `searchEpics(jql)` — returns epics from `MOCK_EPICS` across 2 business goals and 2 initiatives
- `searchChildIssues(epicKey)` — returns 2 child issues per epic (mix of resolved and remaining)
- `searchDoneIssues(accountId, periodDays, projects?, storyPointsFields?)` — returns resolved issues for the report runner's Jira phase
- `findUserByEmail(email)` — maps to `MOCK_DEVELOPERS` by `jiraEmail`
- `testConnection()` — returns success. Note: `testJiraConnection()` in `src/lib/jira/service.ts` currently constructs a `JiraClient` directly, bypassing `getJiraClient()`. Refactor it to use the factory so mock mode works.

Update `getJiraClient()` return type from `JiraClient | null` to `JiraClientInterface | null`.

**Selection:** `JIRA_PROVIDER=mock` env var — explicit and independent from `LLM_PROVIDER`, following the same per-service provider pattern. When `JIRA_ENABLED=true` and `JIRA_PROVIDER=mock`, the factory returns `MockJiraClient` and skips the `JIRA_HOST`/`JIRA_USERNAME`/`JIRA_API_TOKEN` credential guards. This lets you mock Jira independently of LLM (e.g., real LLM + mock Jira, or vice versa).

### 4. Mock GitHub Provider

**Refactor required:** `src/lib/github.ts` currently instantiates `const octokit = new Octokit(...)` at module scope — there is no factory function. All exported functions (`listOrgMembers`, `fetchUserActivity`) use this directly. Extract a `GitHubProvider` interface (or object type: `{ listOrgMembers, fetchUserActivity }`) and add a `getGitHubProvider()` factory that returns either the real module or the mock based on `GITHUB_PROVIDER=mock`. Update the two call sites (`report-runner.ts`, `developers/service.ts`) to use the factory. This mirrors the Jira interface extraction pattern in section 3.

**Implementation:** `src/lib/github-mock.ts` — implements the `GitHubProvider` interface. Returns fixture data for org member listing and commit search. Imports developer data from `scripts/mock-identities.ts`. The mock returns:
- Org members → `MOCK_DEVELOPERS` with login/name/avatar
- Commit search per user → 3-5 fixture commits per developer (matching `scripts/mock-identities.ts`)

**Selection:** `GITHUB_PROVIDER=mock` env var. When set, `getGitHubProvider()` returns the mock implementation and skips Octokit instantiation (no `GITHUB_TOKEN` needed).

This enables the full report generation flow: click "New Report" → mock GitHub returns members/commits → mock LLM analyzes → results land in DB → browse the report. This is the killer local dev experience — the core app flow works end-to-end.

**Env validation:** Skip `GITHUB_TOKEN` requirement when `GITHUB_PROVIDER=mock`.

### 5. Seed Script

**Entry point:** `scripts/seed.ts` — uses relative imports (no `@/*` aliases) to avoid path resolution issues. Add `tsx` to devDependencies. Imports shared identities from `scripts/mock-identities.ts`.

**Run via:** `npm run seed` (alias for `tsx scripts/seed.ts`).
**Reset and reseed:** `npm run seed:reset` (alias for `rm -f glooker.db && tsx scripts/seed.ts`).

**Fixture data:** `scripts/seed-data.ts` — single file exporting all fixture arrays. References `MOCK_DEVELOPERS`, `MOCK_TEAMS`, `MOCK_EPICS`, `MOCK_REPORT_IDS` from `mock-identities.ts`.

**What it seeds:**

| Table | Records | Notes |
|-------|---------|-------|
| `reports` | 3 | Two completed (14d and 30d periods), one with status `running` (for testing progress/log panel UI) |
| `developer_stats` | 8 per report | Varied profiles: high/mid/low performers |
| `commit_analyses` | 3-5 per developer | Mix of feature/bug/refactor/docs, varied complexity, some AI-flagged |
| `jira_issues` | 2-3 per developer | Resolved issues with realistic summaries |
| `teams` | 3 | "Platform", "Frontend", "Data" |
| `team_members` | 8 distributed across teams | Maps to `MOCK_DEVELOPERS` |
| `user_mappings` | 8 | From `MOCK_DEVELOPERS` — `jira_email` values match mock `searchEpics` assignee emails |
| `developer_summaries` | 8 per report | Pre-generated narrative + badges |
| `report_comparisons` | 1 | Links the two completed reports, with pre-generated `highlights_json` |
| `epic_summaries` | 3-4 | Pre-cached, keys from `MOCK_EPICS` |
| `untracked_summaries` | 1 per team | Pre-cached so "show untracked" works |
| `schedules` | 1 | One weekly schedule (renders on settings Schedules tab) |
| `release_notes` | 1 | Cached release notes (renders on dashboard) |

**Behavior:**
- Idempotent: uses `INSERT OR IGNORE` via the DB abstraction layer (SQLite translator handles this)
- Targets SQLite only (the local-dev default)
- Uses the existing DB abstraction layer (`src/lib/db`) — first `execute()` call triggers schema creation on a fresh DB
- All identifiers sourced from `mock-identities.ts` — no drift between seed and mocks
- Org name: `MOCK_ORG` from `mock-identities.ts`

### 6. Developer Workflow

**First-time setup:**
```
npm install
npm run seed
npm run dev:mock
```

**Package.json scripts:**
```json
"seed": "tsx scripts/seed.ts",
"seed:reset": "rm -f glooker.db && tsx scripts/seed.ts",
"dev:mock": "GITHUB_PROVIDER=mock LLM_PROVIDER=mock JIRA_ENABLED=true JIRA_PROVIDER=mock JIRA_PROJECTS_JQL='project = MOCK AND issuetype = Epic' next dev"
```

Note: With `GITHUB_PROVIDER=mock`, the `GITHUB_TOKEN` warning from env validation is suppressed. All three external services are mocked — the full app works end-to-end including report generation.

**Resetting data:** `npm run seed:reset`

### 7. Maintenance Instructions (CLAUDE.md addition)

> When adding or modifying database tables, API response shapes, or page data requirements: update `scripts/seed-data.ts` to include the new columns/tables and `scripts/mock-identities.ts` if new entities are introduced. Run `npm run seed:reset` and verify affected pages render correctly with `npm run dev:mock`. When adding a new LLM prompt template, add a `promptTag()` call at the call site and a corresponding fixture response in the mock LLM provider (`src/lib/llm-mock.ts`).

### 8. Env Validation

`src/lib/env-validation.ts` changes:
- Add `'mock'` to `VALID_LLM_PROVIDERS`
- Add `JIRA_PROVIDER` and `GITHUB_PROVIDER` validation rules (accept `'mock'` as valid value)
- Skip `GITHUB_TOKEN` required check when `GITHUB_PROVIDER=mock`
- Skip Jira credential conditional checks (`JIRA_HOST`, `JIRA_USERNAME`, `JIRA_API_TOKEN`) when `JIRA_PROVIDER=mock`
- Introduce `isMockProvider(service: string): boolean` helper — returns `true` when `{SERVICE}_PROVIDER=mock`. This centralizes the mock-check logic and scales cleanly if more services are added.

## Files Touched

| File | Change |
|------|--------|
| `scripts/mock-identities.ts` (new) | Shared mock entity definitions (developers, teams, epics, report IDs) |
| `src/lib/llm-provider.ts` | Add `'mock'` to `Provider` type union, `mock` switch case, and `promptTag()` export |
| `src/lib/llm-mock.ts` (new) | Mock LLM adapter (duck-typed, routes on `__prompt_id`) |
| `src/lib/jira/types.ts` (new) | Extract `JiraClientInterface` from concrete class |
| `src/lib/jira/mock-client.ts` (new) | Mock Jira client implementing `JiraClientInterface` |
| `src/lib/jira/client.ts` | Implement `JiraClientInterface`, mock factory check before credential guards |
| `src/lib/jira/service.ts` | Refactor `testJiraConnection()` to use `getJiraClient()` factory |
| `src/lib/github-mock.ts` (new) | Mock GitHub provider implementing `GitHubProvider` interface |
| `src/lib/github.ts` | Extract `GitHubProvider` interface, add `getGitHubProvider()` factory, refactor module-level Octokit to lazy init |
| `src/lib/report-runner.ts` | Use `getGitHubProvider()` instead of direct imports from `github.ts` |
| `src/lib/analyzer.ts` | Add `...promptTag('analyzer-system')` to LLM call |
| `src/lib/chat/agent.ts` | Add `...promptTag('chat-agent-system')` to LLM call |
| `src/lib/projects/epic-summary.ts` | Add `...promptTag('epic-summary-system')` to LLM call |
| `src/lib/projects/untracked.ts` | Add `...promptTag('untracked-work-system')` to LLM call |
| `src/lib/report/summary.ts` | Add `...promptTag('report-summary-system')` to LLM call |
| `src/lib/report-highlights/service.ts` | Add `...promptTag('report-highlights-system')` to LLM call |
| `src/lib/llm-config/service.ts` | Add `...promptTag('llm-config-test-system')` to LLM call |
| `src/lib/app-config/service.ts` | Add `...promptTag(...)` to LLM call (if applicable) |
| `scripts/seed.ts` (new) | Seed script entry point (relative imports) |
| `scripts/seed-data.ts` (new) | All fixture data, imports from `mock-identities.ts` |
| `package.json` | Add `tsx` to devDependencies, add `seed`, `seed:reset`, and `dev:mock` scripts |
| `CLAUDE.md` | Add maintenance instruction |
| `.env.example` | Document `LLM_PROVIDER=mock`, `JIRA_PROVIDER=mock`, `GITHUB_PROVIDER=mock` |
| `src/lib/env-validation.ts` | Add `isMockProvider()` helper, update validation rules for all three mock providers |

## Out of Scope

- Mock data for auth/user profile features (`AUTH_ENABLED`)
- Production data export/sanitization
- Automated test suite using mock providers (future work)
- Mock progress store for the "running" report (the log panel renders from the in-memory progress store; seed data puts the report in `running` status so the UI shows the panel, but live log entries require the report runner to actually execute)
