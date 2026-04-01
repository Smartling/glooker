# Local Test Data & Mock Providers

**Date:** 2026-04-01
**Goal:** Make the full app testable locally without GitHub, Jira, or LLM credentials by adding mock providers and a DB seed script.

## Problem

Several pages (reports, developer detail, projects) are impossible to test locally without real data. Running a report requires GitHub + LLM tokens. The projects page requires Jira credentials. This slows development and makes visual testing (e.g., theme changes) impractical.

## Approach

Provider-based mocking + explicit seed script. Uses the existing abstraction layers (LLM provider, Jira client) rather than scattering conditionals through production code.

## Design

### 1. Mock LLM Provider

Add `mock` as a value for `LLM_PROVIDER` in `src/lib/llm-provider.ts`.

**Implementation:** `src/lib/llm-mock.ts` — a duck-typed adapter (like bedrock-adapter) that implements the OpenAI chat completions interface. Returns canned responses by matching the system prompt:

| Prompt template | Response |
|----------------|----------|
| `commit-analysis-system.txt` | Fixture `{complexity, type, impact_summary, risk_level}` JSON |
| `epic-summary-system.txt` | Fixture narrative text |
| `untracked-work-system.txt` | Fixture `WorkGroup[]` JSON |
| `dev-summary-system.txt` | Fixture narrative with badges JSON |
| `release-notes-system.txt` | Fixture bullet points |
| (fallback) | Generic acknowledgment |

No network calls, instant responses. Varies output slightly based on input content to produce non-identical results across developers/epics.

### 2. Mock Jira Client

**Implementation:** `src/lib/jira/mock-client.ts` — implements the same interface as the real Jira client.

Returns fixture data for:
- `searchEpics(jql)` — 8-10 epics across 2-3 business goals and 3-4 initiatives
- `searchChildIssues(epicKey)` — 3-5 child issues per epic (mix of resolved and remaining)
- `findUserByEmail(email)` — maps to seeded user mappings
- `getFields()` — returns mock field list with story points field

**Selection:** `JIRA_PROVIDER=mock` env var. Checked in the Jira client factory (`src/lib/jira/client.ts`). When set, returns `MockJiraClient` instead of the real client.

### 3. Seed Script

**Entry point:** `scripts/seed.ts` — run via `npx tsx scripts/seed.ts` or `npm run seed`.

**Fixture data:** `scripts/seed-data.ts` — single file exporting all fixture arrays.

**What it seeds:**

| Table | Records | Notes |
|-------|---------|-------|
| `reports` | 3 | One completed (14d), one completed (30d), one running |
| `developer_stats` | 8 per completed report | Varied profiles: high/mid/low performers |
| `commit_analyses` | ~15-25 per developer | Mix of types, complexities, some AI-flagged |
| `jira_issues` | 2-4 per developer | Resolved issues with realistic summaries |
| `teams` | 3 | "Platform", "Frontend", "Data" |
| `team_members` | 8 distributed across teams | Maps to the 8 developers |
| `user_mappings` | 8 | GitHub login to Jira email/account |
| `developer_summaries` | 8 per completed report | Pre-generated narrative + badges |
| `epic_summaries` | 5-6 | Pre-cached so expansion works without LLM |
| `untracked_summaries` | 3 (one per team) | Pre-cached so "show untracked" works |
| `schedules` | 1 | One weekly schedule |
| `release_notes` | 1 | Cached release notes |

**Behavior:**
- Idempotent: checks if data exists before inserting
- Uses the existing DB abstraction layer (`src/lib/db`)
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
"seed": "npx tsx scripts/seed.ts",
"dev:mock": "LLM_PROVIDER=mock JIRA_PROVIDER=mock next dev"
```

**Resetting data:** `rm glooker.db && npm run seed`

### 5. Maintenance Instructions (CLAUDE.md addition)

> When adding or modifying database tables, API response shapes, or page data requirements: update `scripts/seed-data.ts` to include the new columns/tables. Run `npm run seed` on a fresh DB and verify affected pages render correctly with `npm run dev:mock`. When adding a new LLM prompt template, add a corresponding fixture response in the mock LLM provider.

## Files Touched

| File | Change |
|------|--------|
| `src/lib/llm-provider.ts` | Add `mock` provider case |
| `src/lib/llm-mock.ts` (new) | Mock LLM implementation |
| `src/lib/jira/mock-client.ts` (new) | Mock Jira client |
| `src/lib/jira/client.ts` | Add factory check for `JIRA_PROVIDER=mock` |
| `scripts/seed.ts` (new) | Seed script entry point |
| `scripts/seed-data.ts` (new) | All fixture data |
| `package.json` | Add `seed` and `dev:mock` scripts |
| `CLAUDE.md` | Add maintenance instruction |
| `.env.example` | Document `LLM_PROVIDER=mock`, `JIRA_PROVIDER=mock` |
| `src/lib/env-validation.ts` | Accept `mock` as valid provider values |

## Out of Scope

- GitHub API mocking (seed script covers what GitHub would fetch)
- Production data export/sanitization
- Automated test suite using mock providers (future work)
- Mock data for auth/user profile features (`AUTH_ENABLED`)
