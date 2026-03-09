# Claude Code Instructions

## Project overview

Glooker is a Next.js 15 web app that generates developer impact reports for a GitHub org. It fetches commits via GitHub API, analyzes them with an LLM, and displays ranked developer stats.

## Commands

- `npm run dev` — start dev server on port 3000
- `npm run build` — production build (avoid running before `npm run dev`, causes stale cache)
- `rm -rf .next` — fix "Cannot find module './638.js'" errors
- SQLite (default): data in `./glooker.db`, no setup needed
- MySQL: `mysql -u root --skip-password -e "..."` (database: `glooker`)

## Key architectural decisions

- **Per-user GitHub search** (not per-repo) — orgs can have 600+ repos, iterating each is too slow
- **Commit search API** is the primary data source (not PR search) — captures direct pushes that never went through PRs
- **LLM provider abstraction** (`llm-provider.ts`) — all providers use the OpenAI SDK since they all support the chat completions format. Smartling AI Proxy is one option alongside direct OpenAI/Anthropic
- **Dual DB support** — SQLite (default, zero config) and MySQL (opt-in via `DB_TYPE=mysql`). The SQLite wrapper translates MySQL-dialect SQL on the fly
- **In-memory progress store** (globalThis Map) — survives Next.js HMR, acceptable for single-user local use
- **AI detection** has two layers: trailer parsing (confirmed) and LLM heuristic (maybe_ai)

## Environment

- Secrets in `.env.local` (gitignored) — never commit
- `.env.example` has placeholder values for all providers
- `LLM_PROVIDER` selects backend: `openai` (default), `anthropic`, `openai-compatible`, `smartling`
- `DB_TYPE` selects database: `sqlite` (default), `mysql`
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
