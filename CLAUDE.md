# Claude Code Instructions

## Project overview

Glooker is a Next.js 15 web app that generates developer impact reports for a GitHub org. It fetches commits via GitHub API, analyzes them with an LLM, and displays ranked developer stats.

## Commands

- `npm run dev` — start dev server on port 3000
- `npm run build` — production build (avoid running before `npm run dev`, causes stale cache)
- `npm test` — run all tests (Jest + ts-jest)
- `npm run test:watch` — run tests in watch mode
- `npm run test:coverage` — run tests with coverage report
- `rm -rf .next` — fix "Cannot find module './638.js'" errors
- SQLite (default): data in `./glooker.db`, no setup needed
- MySQL: `mysql -u root --skip-password -e "..."` (database: `glooker`)

## Key architectural decisions

- **Per-user GitHub search** (not per-repo) — orgs can have 600+ repos, iterating each is too slow
- **Commit search API** is the primary data source (not PR search) — captures direct pushes that never went through PRs
- **LLM provider abstraction** (`llm-provider.ts`) — all providers use the OpenAI SDK since they all support the chat completions format. Smartling AI Proxy is one option alongside direct OpenAI/Anthropic. AWS Bedrock uses a duck-typed adapter (`bedrock-adapter.ts`) that translates OpenAI-style requests to Bedrock's InvokeModel API
- **Dual DB support** — SQLite (default, zero config) and MySQL (opt-in via `DB_TYPE=mysql`). The SQLite wrapper translates MySQL-dialect SQL on the fly
- **In-memory progress store** (globalThis Map) — survives Next.js HMR, acceptable for single-user local use
- **AI detection** has two layers: trailer parsing (confirmed) and LLM heuristic (maybe_ai)
- **Prompt template system** — LLM prompts live in `prompts/` dir (configurable via `PROMPTS_DIR`), loaded by `prompt-loader.ts` with in-memory caching. Templates use `{{PLACEHOLDER}}` syntax. All LLM settings (temperature, max_tokens, max_iterations) are configurable via env vars with hardcoded defaults.
- **API request logging** (`logger.ts`) — opt-in via `LOG_DIR` env var. All API route handlers must be wrapped with `withRequestLog()` from `src/lib/logger.ts`. Writes structured JSON to `requests.log` (all requests) and `errors.log` (4xx/5xx + exceptions). A Jest enforcement test verifies all route files import the wrapper. When `LOG_DIR` is unset, logging is a no-op.
- **Jira integration** (`src/lib/jira/`) — optional, enabled via `JIRA_ENABLED=true`. Uses direct `fetch` calls to Jira REST API (no external SDK). Auto-discovers GitHub→Jira user mappings via commit author emails, persists to `user_mappings` table. Fetches resolved issues via JQL (`statusCategory = "Done"`) using the new `/search/jql` endpoint. Jira data (story points or issue count) contributes to the impact score via a `jiraFactor` (weight 0.5). Uses story points when available (`min(SP/15, 1)`), falls back to issue count (`min(count/10, 1)`). PR review count also contributes (weight 0.5, `min(reviews/15, 1)`) — counted via GitHub search API `reviewed-by:` filter.
- **Claude Code spend & skills breakdown** (`src/lib/cc-spend/`) — `refreshCcSpendForReport()` (`service.ts`) makes three independent Anthropic Analytics pulls per report: total spend (`developer_stats.cc_total_cost`/`cc_requests`), per-model cost (`cc_model_usage` table, one row per developer login + model), and skills usage (`cc_skills_usage` table, one row per developer login + product, rolled up into `developer_stats.cc_skills_used`). Each pull is independently non-fatal — a failed model or skills pull does not discard a cost pull that already succeeded; failures are recorded on the result as `skillsError`/`modelsError` rather than thrown, surfaced in Settings → Pull from Anthropic. Skills usage is deliberately never gated by team visibility (see the policy comment on `CC_FIELDS` in `cost-visibility.ts`), unlike per-model cost, which is stripped for developers outside the viewer's team the same as `cc_total_cost`.

## Environment

- Secrets in `.env.local` (gitignored) — never commit
- `.env.example` has placeholder values for all providers
- `LLM_PROVIDER` selects backend: `openai` (default), `anthropic`, `openai-compatible`, `smartling`, `bedrock`
- `DB_TYPE` selects database: `sqlite` (default), `mysql`
- `JIRA_ENABLED=true` enables Jira integration; requires `JIRA_HOST`, `JIRA_USERNAME`, `JIRA_API_TOKEN`
- `ANTHROPIC_ANALYTICS_API_KEY` enables per-developer spend pull during report runs. This is a `read:analytics`-scoped admin API key generated at `claude.ai/analytics/api-keys` (NOT console.anthropic.com). Hits the Enterprise Analytics endpoint `/v1/organizations/analytics/user_cost_report` — a multi-surface feed (claude.ai + Claude Code + API), not Claude Code-only — for cost, and `/v1/organizations/analytics/users` for skills usage. The `/users` endpoint trails real time by ~2 days and 400s on a too-recent end date, so `service.ts` clamps the skills pull's end date back (`SKILLS_LAG_DAYS`) — this is why a freshly generated report's skills figures can cover a slightly narrower window than its displayed Spend Period; that's the endpoint's data lag, not a bug. Values for any given date may be revised for up to 30 days as late events reconcile, so historical pulls within that window are expected to shift slightly. If unset, report runs warn and skip the CC enrichment phase; `cc_cost_cents` / `cc_requests` stay at 0 until backfilled via the Settings → Pull from Anthropic button.
- `CC_ANALYTICS_PROVIDER=mock` selects the mock provider for local dev (used by `npm run dev:mock`).
- `AUTH_TEST_USER=admin|viewer` bypasses ALB OIDC entirely and fabricates a local identity when `AUTH_ENABLED=true` — no JWT is consulted once it's set. `AUTH_TEST_EMAIL` overrides the fabricated identity's email (pick one whose `user_mappings` row resolves to a real `github_login` to exercise profile/cost-visibility as a specific person); without it the identity has no GitHub mapping. `AUTH_TEST_ALLOW_IN_PRODUCTION=true` is required in addition to `AUTH_TEST_USER` when `NODE_ENV=production` (e.g. the local podman/docker-compose flow, which runs the built production image) — without it the bypass is inert in production. Neither `AUTH_TEST_USER` nor `AUTH_TEST_EMAIL` is validated at startup; never set them in a real deployment — with `AUTH_ENABLED=true`, `AUTH_TEST_USER` makes every request resolve to the fabricated identity regardless of the real caller's JWT.
- GitHub fine-grained token needs: Contents:read, Pull requests:read, Metadata:read, Members:read

## Gotchas

- `DECIMAL`/`REAL` columns from both MySQL and SQLite may come back as strings — always use `Number()` before `.toFixed()`
- **Never pin a charset on a MySQL table** (`DEFAULT CHARSET=...`). `reports.id` and every other table inherit the database default, and MySQL refuses a foreign key whose string column differs in charset/collation from its referent (`ER_FK_INCOMPATIBLE_COLUMNS`, errno 3780). Dev's DB is utf8mb3 while a stock local MySQL 8/9 defaults to utf8mb4, so a pinned `utf8mb4` passes locally and fails only in dev. `initSchema()` **catches and logs** DDL failures instead of throwing, so the table just silently doesn't exist until a query hits it — the 2026-08-11 org-report outage. Guarded by `mysql-schema-fk-charset.test.ts`. To verify MySQL schema changes locally: `CREATE DATABASE x CHARACTER SET utf8mb3`, apply `sed '1,2d' schema.sql` (its first two lines are `CREATE DATABASE`/`USE glooker` and will otherwise hit your real local DB), then run the app against it.
- Base tables (`reports`, `developer_stats`, `commit_analyses`) come from `schema.sql` on MySQL — `db/mysql.ts` only creates the newer tables and runs `ALTER` migrations. SQLite creates everything in `db/sqlite.ts`. A new table therefore needs adding in **both** places.
- GitHub search API returns max 1000 results per query — per-user search avoids this
- GitHub secondary rate limits trigger on rapid successive search calls — 2.5s sleeps between requests + exponential back-off retry on 403/429
- Some LLM providers wrap JSON in markdown fences despite `response_format: json_object` — the parser strips ` ```json ``` ` fences
- Smartling auth token expires in ~24h — `smartling-auth.ts` caches and auto-refreshes 5 min before expiry
- `next build` artifacts conflict with `next dev` — always `rm -rf .next` when switching
- SQLite SQL translator handles `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, and `NOW()` — if adding new MySQL-specific SQL, update `translateSQL()` in `db/sqlite.ts`
- Progress store and stop-signal store use `globalThis` to survive Next.js HMR module reloads
- `@octokit/rest` is ESM-only — any test file that imports from `github.ts` (directly or transitively) must `jest.mock('@octokit/rest')` before the import
- Tests use Jest + ts-jest with `@/` path alias — config in `jest.config.ts`
- CI runs on all pull requests and pushes to main (`.github/workflows/test.yml`)
- On `pull_request`, CI tests the **merge of the PR head into main**, not the branch tip — so a suite that is green locally can fail in CI purely because main moved. When a CI failure won't reproduce, check the suite/test counts first: a mismatch (e.g. local 102 suites/922 tests vs CI 103/925) means you are running a different tree. Reproduce with `git merge origin/main` on a throwaway branch, and mimic the runner's worker count (`--maxWorkers=3`, ubuntu-latest has 4 vCPU).
- `expect(promise).rejects.toThrow(/pattern/)` reports **"Received function did not throw"** when the promise rejects with a payload that has no string `message` (plain object, string, null, undefined) — wording indistinguishable from the promise having resolved. Assertions on rejection payloads that may not be `Error`s should capture the rejection and include the payload in the failure output; otherwise the failure actively misdirects (see `cc-breakdown-schema.test.ts`).
- Test files share `process.env` across the whole worker — Jest resets the module registry per file but not the environment. Any test that sets `SQLITE_PATH`/`DB_TYPE` must restore the prior value in `afterAll`, or later files in that worker inherit a DB path whose file the earlier `afterAll` deleted. `jest.mock` factories run before the surrounding module body, so capture-and-restore inside the factory, around the `createSQLiteDB()` call.
- Docker images are built and pushed to GHCR on merge to main and via `workflow_dispatch` (`.github/workflows/docker-publish.yml`). Images tagged with 7-char short SHA; `:latest` tag only on main pushes.
- `GET /api/health` — liveness probe endpoint, returns `{ status: "ok", version }`. No auth, no DB check.
- Env vars are validated at startup in `instrumentation.ts` via `env-validation.ts` — warns about missing/invalid vars but does not crash the server
- `PROMPTS_DIR` defaults to `./prompts` relative to CWD — in Docker, ensure the directory is mounted or `outputFileTracingIncludes` is configured in `next.config.ts`
- Prompt loader caches template files in memory — restart the server after changing prompt template files (or call `clearPromptCache()` in dev)
- Prompt template files have Jest snapshot tests that assert exact text — after editing any file in `prompts/`, run `npm test -- -u` to update snapshots (or `npm test -- --testPathPattern="analyzer" -u` for a specific service). Review the snapshot diff to confirm the change is intentional.
- Jira Cloud removed `/rest/api/3/search` in 2025 — use `/rest/api/3/search/jql` with `nextPageToken` pagination (not `startAt`)
- Jira Cloud API v3 returns descriptions as ADF (Atlassian Document Format) JSON, not plain text — `extractAdfText()` in `jira/client.ts` handles this
- Jira Cloud instances with hidden email visibility will cause auto-discovery to fail silently — users must edit mappings manually in Settings
- The `jira_issues` table has nullable LLM columns (`complexity`, `type`, `impact_summary`) for future use — no LLM analysis runs on Jira items yet
- Jira story points field IDs are instance-specific — `JIRA_STORY_POINTS_FIELDS` must be configured explicitly (no default). Discover IDs via `GET /rest/api/3/field`, use the `id` of fields whose name contains "story" or "point". If unset, `storyPoints` is always `null`.
- The main report page (`page.tsx`) and org report page (`report/[id]/org/page.tsx`) both render developer tables — changes to columns must be applied to both
- `AUTH_ENABLED=true` enables user profile feature — extracts identity from ALB OIDC JWT header (`x-amzn-oidc-data` by default). Requires `user_mappings` table populated (via Jira auto-discovery) for full GitHub profile linking. Off by default — zero impact when disabled.
- `AUTH_ADMIN_GROUP` defines which Okta group grants admin role. When `AUTH_ENABLED=true` but `AUTH_ADMIN_GROUP` is empty, all users are viewers and all mutating APIs return 403. This is a safe default but will block report generation — always set `AUTH_ADMIN_GROUP` alongside `AUTH_ENABLED`.
- Admin/viewer role is derived from JWT `groups` claim on every request — no DB storage. Changing a user's Okta groups takes effect on their next page load.
- All API route handlers must be wrapped with `withRequestLog()` — a Jest enforcement test (`logger-enforcement.test.ts`) checks for the import in every `src/app/api/**/route.ts` file. When adding a new API route, wrap every exported handler (GET, POST, PUT, PATCH, DELETE).
- `LOG_DIR` env var enables API request logging — when unset, `withRequestLog` is a no-op. When set, creates the directory on first write. Log rotation is handled by infrastructure, not the app.
- Next.js App Router page files (`src/app/**/page.tsx`) may export ONLY `default` (plus Next's own reserved fields) — exporting a component or helper for testing breaks `npm run build` while `npm test` and `tsc --noEmit` both pass; put shared pieces in a sibling module instead.
- Jest `testMatch` includes `.tsx`; behavioural component tests need a `/** @jest-environment jsdom */` docblock (precedent: `src/lib/__tests__/unit/profile-self-view.test.tsx`). Before this was configured, `.tsx` test files were silently skipped rather than failing.

## Local Development (Mock Mode)

- `npm run seed` populates SQLite with test data; `npm run seed:reset` wipes and re-seeds
- `npm run dev:mock` starts the server with all external services mocked (GitHub, Jira, LLM)
- Mock providers: `GITHUB_PROVIDER=mock`, `JIRA_PROVIDER=mock`, `LLM_PROVIDER=mock` — each independent
- When adding or modifying database tables, API response shapes, or page data requirements: update `scripts/seed-data.ts` and `scripts/mock-identities.ts` if new entities are introduced
- When adding a new LLM prompt template, add a `promptTag()` call at the call site and a corresponding fixture response in `src/lib/llm-mock.ts`
- Mock entities (developers, teams, epics) are defined in `scripts/mock-identities.ts` — single source of truth for both seed and mock providers
