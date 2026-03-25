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
- **Jira integration** (`src/lib/jira/`) — optional, enabled via `JIRA_ENABLED=true`. Uses direct `fetch` calls to Jira REST API (no external SDK). Auto-discovers GitHub→Jira user mappings via commit author emails, persists to `user_mappings` table. Fetches resolved issues via JQL (`statusCategory = "Done"`) using the new `/search/jql` endpoint. Jira data is gathered but does **not** influence the impact score formula yet.

## Environment

- Secrets in `.env.local` (gitignored) — never commit
- `.env.example` has placeholder values for all providers
- `LLM_PROVIDER` selects backend: `openai` (default), `anthropic`, `openai-compatible`, `smartling`, `bedrock`
- `DB_TYPE` selects database: `sqlite` (default), `mysql`
- `JIRA_ENABLED=true` enables Jira integration; requires `JIRA_HOST`, `JIRA_USERNAME`, `JIRA_API_TOKEN`
- GitHub fine-grained token needs: Contents:read, Pull requests:read, Metadata:read, Members:read

## Gotchas

- `DECIMAL`/`REAL` columns from both MySQL and SQLite may come back as strings — always use `Number()` before `.toFixed()`
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
