# Glooker

Developer impact analytics for GitHub organizations. Glooker pulls commit history, runs LLM-based analysis on each commit, and produces ranked developer reports with metrics like code complexity, PR discipline, AI-assisted coding percentage, and overall impact scores.

## Quick Start

```bash
git clone https://github.com/Smartling/glooker.git
cd glooker
npm install
cp .env.example .env.local
```

Edit `.env.local` with your GitHub token and LLM API key, then:

```bash
npm run dev
# Open http://localhost:3000
```

That's it. Glooker uses SQLite by default — no database setup needed.

## Features

- **Full commit coverage** — uses GitHub's commit search API to capture all commits, not just PR-linked ones
- **LLM-powered analysis** — each commit is analyzed for complexity (1-10), type (feature/bug/refactor/etc), risk level, and whether it appears AI-generated
- **AI detection** — three layers: confirmed via `Co-Authored-By` trailers, PR body patterns (e.g. "Generated with Claude Code"), branch commit trailer scanning for merge commits, and LLM heuristic analysis
- **PR discipline tracking** — shows what percentage of each developer's commits went through pull requests
- **Developer detail page** — click any developer to see percentile rankings (vs avg/p50/p95), type breakdown, active repos, and full commit history with links to GitHub
- **Progressive UI** — developer table populates during report generation as each member completes, not after everything finishes
- **Resumable reports** — interrupted reports can be resumed, skipping already-analyzed commits (commit analyses save to DB inline)
- **Scheduled reports** — configure recurring reports on a cron schedule
- **Export** — CSV download, Google Sheets, or Download PDF (print-optimized layout)
- **Multiple LLM providers** — OpenAI, Anthropic, any OpenAI-compatible endpoint (Ollama, vLLM, Azure), or Smartling AI Proxy

## Report Metrics

| Metric | Description |
|--------|-------------|
| Commits | Total commits in period (all, not just PR-linked) |
| PRs | Merged pull requests authored |
| Lines +/- | Lines added and removed |
| Complexity | Mean LLM-assessed complexity (1-10) |
| PR% | Percentage of commits that went through a PR |
| AI% | Percentage of commits with AI assistance (confirmed + suspected) |
| Impact | Weighted score combining volume, PRs, complexity, and PR discipline |
| Types | Commit categorization: feature, bug, refactor, infra, docs, test |

## Configuration

### GitHub Token

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens):

- **Resource owner**: your org
- **Repository access**: All repositories
- **Repository permissions**: Contents (read), Pull requests (read), Metadata (read)
- **Organization permissions**: Members (read)

### LLM Provider

Set `LLM_PROVIDER` in `.env.local`:

#### OpenAI (default)
```env
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

#### Anthropic
```env
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
```

#### Local / Custom (Ollama, vLLM, etc.)
```env
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3
LLM_API_KEY=not-needed
```

> **Apple Silicon (M1/M2/M3/M4) GPU acceleration:** If you install Ollama via an x86 Homebrew (`/usr/local/bin/brew`), it will run under Rosetta and **cannot access the Metal GPU** — inference will be CPU-only and much slower. Install Ollama using the [official installer](https://ollama.com/install.sh) or an ARM-native Homebrew (`/opt/homebrew/bin/brew`) to get full GPU acceleration. Verify with `ollama ps` — the PROCESSOR column should show `100% GPU`, not `100% CPU`.

#### Smartling AI Proxy
For Smartling customers with AI Proxy access:
```env
LLM_PROVIDER=smartling
SMARTLING_BASE_URL=https://api.smartling.com
SMARTLING_ACCOUNT_UID=your_account_uid
SMARTLING_USER_IDENTIFIER=your_user_identifier
SMARTLING_USER_SECRET=your_user_secret
LLM_MODEL=anthropic/claude-sonnet-4-20250514
```

### Database

**SQLite** (default) — zero config, data stored in `./glooker.db`:
```env
# No config needed — this is the default
```

**MySQL** — for teams or production:
```env
DB_TYPE=mysql
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=glooker
```
Then initialize: `mysql -u root < schema.sql`

## Docker

```bash
# Set your env vars
export GITHUB_TOKEN=github_pat_...
export LLM_API_KEY=sk-...

# Build and start (MySQL + app)
docker compose up --build -d

# Open http://localhost:3000
```

> **Note:** The MySQL container exposes port 3307 by default (to avoid conflicts with a local MySQL on 3306). Edit `docker-compose.yml` to change this.

## Architecture

```
Browser (Next.js)  →  API Routes  →  GitHub API
                                  →  LLM Provider (OpenAI / Anthropic / Smartling / custom)
                                  →  SQLite or MySQL
```

### How a report runs

1. List org members via GitHub API
2. For each member (pipelined — LLM starts while more members are still being fetched):
   - Search all commits and merged PRs in the date range
   - Fetch diffs for each commit
   - Detect AI co-authorship from commit trailers, PR body, and branch commits
   - Queue LLM analysis (concurrency-limited) for complexity, type, risk, and AI-generation detection
   - Save each commit analysis to DB immediately (enables resume)
3. When all of a member's commits are analyzed, aggregate and save developer stats to DB (enables progressive UI)
4. Final cross-member aggregation overwrites with canonical stats
5. Display ranked table with export options

### Key files

```
src/lib/
├── llm-provider.ts          # LLM provider factory (OpenAI SDK for all providers)
├── smartling-auth.ts         # Smartling OAuth (only loaded when provider=smartling)
├── github.ts                 # GitHub API: members, commit/PR search, diffs, AI detection
├── analyzer.ts               # LLM commit analysis prompt + response parsing
├── aggregator.ts             # Per-developer metric rollup
├── report-runner.ts          # Pipeline orchestrator (pipelined fetch → analyze → save)
├── progress-store.ts         # In-memory progress tracking (developer-based)
├── schedule-manager.ts       # Cron-based scheduled report execution
├── schedule-validation.ts    # Schedule input validation
└── db/
    ├── index.ts              # DB abstraction (selects SQLite or MySQL)
    ├── sqlite.ts             # SQLite implementation (default)
    └── mysql.ts              # MySQL implementation

src/app/
├── page.tsx                  # Main dashboard (report list, generation, developer table)
├── report/[id]/dev/[login]/
│   └── page.tsx              # Developer detail page (percentiles, commits)
└── api/
    ├── report/[id]/dev/[login]/route.ts  # Developer detail API
    ├── report/[id]/commits/route.ts      # Commits per developer API
    └── ...                               # Other report & schedule endpoints
```

## Development

```bash
npm run dev       # Start dev server
npm run build     # Production build
```

If you see `Cannot find module './638.js'`, run `rm -rf .next` and restart.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [CLAUDE.md](CLAUDE.md) for AI-assisted development context.

## License

[MIT](LICENSE)
