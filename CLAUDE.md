# Claude Code Instructions

## Project overview

Glooker is a Next.js 15 web app that generates developer impact reports for a GitHub org. It fetches commits via GitHub API, analyzes them with an LLM via Smartling AI Proxy, and displays ranked developer stats.

## Commands

- `npm run dev` — start dev server on port 3000
- `npm run build` — production build (avoid running before `npm run dev`, causes stale cache)
- `mysql -u root --skip-password -e "..."` — query the local MySQL (no password, database: `glooker`)
- `rm -rf .next` — fix "Cannot find module './638.js'" errors

## Key architectural decisions

- **Per-user GitHub search** (not per-repo) — the org has 600+ repos, iterating each is too slow
- **Commit search API** is the primary data source (not PR search) — captures direct pushes that never went through PRs
- **In-memory progress store** (Map) — acceptable for single-user local use, not production-safe
- **Smartling AI Proxy** uses OpenAI-compatible endpoint — we use the standard `openai` npm SDK with a custom `baseURL`
- **MySQL SYSTEM timezone** — timestamps are stored in local time (ET), mysql2 connection has no timezone override
- **AI detection** has two layers: trailer parsing (confirmed) and LLM heuristic (maybe_ai)

## Environment

- Secrets are in `.env.local` (gitignored) — never commit this file
- `.env.example` has placeholder values for reference
- MySQL database `glooker` with 3 tables — see `schema.sql`
- GitHub fine-grained token needs: Contents:read, Pull requests:read, Metadata:read, Members:read

## Gotchas

- `DECIMAL` columns from MySQL come back as strings in JS — always use `Number()` before `.toFixed()`
- GitHub search API returns max 1000 results per query — per-user search avoids this since individual users rarely hit 1000 commits in 90 days
- GitHub secondary rate limits trigger on rapid successive search calls — there are 2.5s sleeps between requests and exponential back-off retry on 403/429
- Smartling AI Proxy model `anthropic/claude-sonnet-4-20250514` sometimes wraps JSON in markdown fences despite `response_format: json_object` — the parser strips ` ```json ``` ` fences
- The Smartling auth token expires in ~24h — `smartling-auth.ts` caches and auto-refreshes 5 min before expiry
- `next build` artifacts conflict with `next dev` — always `rm -rf .next` when switching between them
