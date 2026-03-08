# Glooker — GitHub Org Developer Impact Analytics

Glooker pulls commit history from a GitHub org, runs LLM-based analysis on each commit via Smartling AI Proxy, and produces a developer impact report with metrics like complexity, PR discipline, AI-assisted coding percentage, and an overall impact score.

## Architecture

```
Browser (Next.js)  →  API Routes (Node.js)  →  GitHub API + Smartling AI Proxy
                                             →  MySQL (report storage)
```

**Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, MySQL, OpenAI SDK (pointed at Smartling AI Proxy)

### How a report runs

1. **List org members** via `GET /orgs/{org}/members`
2. **For each member**, search their commits (`search/commits` API) and merged PRs (`search/issues` API) in the date range
3. **Fetch diffs** for each commit via `GET /repos/{owner}/{repo}/commits/{sha}`
4. **Detect AI co-authorship** by parsing commit message trailers (`Co-Authored-By: Claude`, `Cursor`, `Copilot`, etc.)
5. **LLM analysis** (concurrency-limited) — each commit is sent to the AI Proxy for complexity scoring, type classification, risk assessment, and AI-generation detection
6. **Aggregate** per-developer stats and save to MySQL
7. **Display** ranked table in the UI with export options (CSV, Google Sheets)

### Key files

```
src/
├── app/
│   ├── page.tsx                          # Main dashboard UI (client component)
│   ├── layout.tsx                        # Root layout
│   ├── globals.css                       # Tailwind imports
│   └── api/report/
│       ├── route.ts                      # POST: start report, GET: list reports
│       └── [id]/
│           ├── route.ts                  # GET: report results + developer stats
│           └── progress/
│               └── route.ts             # GET: live progress (polled by frontend)
├── lib/
│   ├── db.ts                            # MySQL connection pool
│   ├── smartling-auth.ts                # Smartling OAuth (user+secret → Bearer token, cached)
│   ├── aiproxy.ts                       # OpenAI client configured for Smartling AI Proxy
│   ├── github.ts                        # GitHub API: org members, commit search, PR search, diff fetching, AI co-author detection
│   ├── analyzer.ts                      # LLM commit analysis prompt + response parsing
│   ├── aggregator.ts                    # Per-developer metric rollup (impact score, PR%, AI%, type breakdown)
│   ├── report-runner.ts                 # Full pipeline orchestrator (search → fetch → analyze → save)
│   └── progress-store.ts               # In-memory progress tracking (Map-based, for single-user local use)
├── schema.sql                           # MySQL schema (3 tables: reports, developer_stats, commit_analyses)
├── .env.example                         # Environment variable template
└── package.json
```

### Database schema

- **reports** — one row per report run (id, org, period, status, timestamps)
- **developer_stats** — per-developer aggregated metrics per report (commits, PRs, complexity, impact, PR%, AI%, type breakdown, active repos)
- **commit_analyses** — per-commit LLM analysis results (complexity, type, impact summary, risk level, AI co-author flag, maybe_ai flag)

### Report metrics

| Metric | Source | Description |
|--------|--------|-------------|
| Commits | GitHub commit search | Total commits in period (all, not just PR-linked) |
| PRs | GitHub PR search | Merged PRs authored |
| Lines +/- | GitHub commit API | Lines added and removed |
| Avg Complexity | LLM (1-10) | Mean complexity across all commits |
| PR% | GitHub | Percentage of commits that went through a PR |
| AI% | Trailer parsing + LLM | Percentage of commits with AI assistance (confirmed via Co-Authored-By trailers, or suspected by LLM) |
| Impact Score | Computed | Weighted blend of volume, PRs, complexity, and PR discipline (0-10) |
| Type Breakdown | LLM | Commit categorization: feature, bug, refactor, infra, docs, test, other |

### AI detection

Two layers:
1. **Confirmed** — commit message trailers: `Co-Authored-By: Claude Code`, `Cursor`, `GitHub Copilot`, `Windsurf`, `Aider`, `Codeium`, `Tabnine`, `Amazon Q`
2. **Suspected** (`maybe_ai`) — when no co-author is detected, the LLM evaluates the diff for AI-generation patterns (mechanical consistency, verbose naming, boilerplate patterns)

### Smartling AI Proxy

LLM calls go through the Smartling AI Proxy OpenAI-compatible endpoint:
```
POST /ai-proxy-api/v2/accounts/{accountUid}/compatible/openai/chat/completions
Authorization: Bearer {smartling_oauth_token}
```
Auth: `POST /auth-api/v2/authenticate` with `userIdentifier` + `userSecret` → Bearer token (cached, auto-refreshed).

Supported models: `anthropic/claude-sonnet-4-20250514`, `openai/gpt-4o-2024-08-06`, `google/gemini-2.5-flash`, etc. See AI Proxy docs for full list.

### GitHub API strategy

- **Per-user search** instead of per-repo (avoids iterating 600+ repos)
- **Commit search API** as primary source (captures direct pushes, not just PR-linked commits)
- **Automatic retry with exponential back-off** on 403/429 rate limits
- **2.5s gap** between search requests to stay under secondary rate limits
- Fine-grained token with `Contents:read`, `Pull requests:read`, `Metadata:read` (repo) + `Members:read` (org)

## Setup

### Prerequisites

- Node.js 20+
- MySQL 8+ (Homebrew: `brew install mysql && brew services start mysql`)
- GitHub fine-grained personal access token
- Smartling AI Proxy credentials (accountUid, userIdentifier, userSecret)

### Install and run

```bash
# Clone
git clone https://github.com/Smartling/glooker.git
cd glooker

# Install dependencies
npm install

# Configure
cp .env.example .env.local
# Edit .env.local with your credentials

# Initialize database
mysql -u root < schema.sql

# If your MySQL has existing tables from a previous version, run migrations:
# ALTER TABLE developer_stats ADD COLUMN pr_percentage INT NOT NULL DEFAULT 0 AFTER impact_score;
# ALTER TABLE developer_stats ADD COLUMN ai_percentage INT NOT NULL DEFAULT 0 AFTER pr_percentage;
# ALTER TABLE commit_analyses ADD COLUMN ai_co_authored TINYINT(1) NOT NULL DEFAULT 0 AFTER risk_level;
# ALTER TABLE commit_analyses ADD COLUMN ai_tool_name VARCHAR(50) NULL AFTER ai_co_authored;
# ALTER TABLE commit_analyses ADD COLUMN maybe_ai TINYINT(1) NOT NULL DEFAULT 0 AFTER ai_tool_name;

# Start dev server
npm run dev
# Open http://localhost:3000
```

### GitHub token setup

1. Go to https://github.com/settings/personal-access-tokens
2. Generate new token (fine-grained)
3. Resource owner: your org
4. Repository access: All repositories
5. Repository permissions: Contents (read), Pull requests (read), Metadata (read)
6. Organization permissions: Members (read)

### Running a report

1. Open http://localhost:3000
2. Enter your GitHub org name
3. Select period (14/30/90 days)
4. Click "Run Report"
5. Watch progress in the log panel
6. Export results via CSV or Google Sheets

**Note:** For large orgs (100+ members), a 90-day report can take 30-60 minutes due to GitHub API rate limits and LLM analysis time. Run `caffeinate -d` in a separate terminal to prevent your Mac from sleeping.

## Development notes

- **Progress tracking** is in-memory (Map). If the dev server restarts mid-run, progress is lost. The DB status will show "running" — it gets auto-recovered as "failed" on next progress poll.
- **`next build` before `next dev`** can cause stale `.next` cache errors (`Cannot find module './638.js'`). Fix: `rm -rf .next` and restart `next dev`.
- **MySQL timezone**: MySQL uses SYSTEM timezone (your Mac's timezone). The mysql2 connection does not override this. All timestamps in the DB are in local time.
- **LLM concurrency** defaults to 5. Increase `LLM_CONCURRENCY` in `.env.local` if the AI Proxy allows more.

## Future work

- Jira integration (story points, ticket linking)
- PR cycle time and review metrics
- Trend view (compare periods)
- Scheduled/recurring reports
- Direct-to-branch commit detection improvement (currently uses commit message `(#NNN)` pattern matching)
- Checkpoint/resume for long-running reports
