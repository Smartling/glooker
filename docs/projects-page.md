# Projects Page — Technical Reference

This document describes the `/projects` page architecture for AI coding assistants working on the codebase.

## Overview

The Projects page (`/projects`) displays in-progress Jira epics from a configured project (e.g., SPS), grouped by Business Goal and Initiative hierarchy. Each epic can be expanded to show an AI-generated summary of recent work. A separate "Not in Project" section shows team-by-team work that isn't attributable to any tracked epic.

## Feature gating

- Page returns 404 if `JIRA_ENABLED !== 'true'`
- Page shows "not configured" if `JIRA_PROJECTS_JQL` env var is unset
- Nav link on home page only visible when both are set (checked via `/api/llm-config`)
- "Show work outside projects" button restricted to admins (`canAct` from `useAuth()`)

## Data flow

### 1. Epic list (`GET /api/projects?org=<org>`)

**Source:** `src/app/api/projects/route.ts` → `src/lib/projects/service.ts`

1. Runs `JIRA_PROJECTS_JQL` against Jira via `client.searchEpics(jql)` — returns epics with parent links
2. Collects unique Initiative keys from epic parents
3. Batch-fetches Initiatives to resolve their parents (Business Goals) — `key in (SPS-1, SPS-11, ...)`
4. Maps epic assignee → team: `user_mappings` table (jira_email → github_login) → `team_members` + `teams` (github_login → team name/color)
5. Returns sorted list: Goal → Initiative → Epic name
6. Also returns `jiraHost` for building browse URLs

**Jira hierarchy:** Business Goal (level 3) → Initiative (level 2) → Epic (level 1)

### 2. Epic summary (`GET /api/projects/[key]/summary?org=<org>&summary=<text>&refresh=true`)

**Source:** `src/app/api/projects/[key]/summary/route.ts` → `src/lib/projects/epic-summary.ts`

Triggered on-demand when user clicks the expand chevron on an epic row.

1. **Cache check:** Looks up `epic_summaries` table. Returns cached if < 24h old (unless `refresh=true`).
2. **Jira child issues:** Calls `client.searchChildIssues(epicKey)` — JQL: `"Epic Link" = KEY OR parent = KEY`. Returns key, summary, status, statusCategory, resolvedAt, assigneeEmail.
3. **Split:** Resolved in last 14 days (statusCategory = "Done" + resolvedAt >= 14d ago) vs remaining.
4. **Commit matching (two-phase):**
   - Phase 1: Query `commit_analyses` for commits whose `commit_message` contains any child issue key or the epic key. This seeds a set of **repos** and **GitHub logins**.
   - Phase 2: Query ALL commits by those logins in those repos in the 14-day window. This catches commits that don't reference any Jira key (the common case — e.g., "Fix PR review findings").
   - Also resolves Jira assignee emails → GitHub logins via `user_mappings` to seed additional logins.
5. **LLM call:** Fills `prompts/epic-summary-system.txt` template with stats, calls LLM for a one-sentence summary following a strict pattern (max 40 words).
6. **Cache store:** Upserts into `epic_summaries` table.

**Why two-phase:** Most commits don't reference Jira keys. A developer who made one commit mentioning `PARSER-43` in `mdx-service` is likely working on that epic — so all their `mdx-service` commits in the window are included.

### 3. Untracked work (`GET /api/projects/untracked?org=<org>&refresh=true`)

**Source:** `src/app/api/projects/untracked/route.ts` → `src/lib/projects/untracked.ts`

Loaded on-demand via "Show work outside projects" button (admin only).

1. **Exclude tracked work — Jira prefixes:** Batch-fetches all child issues for all tracked epics via `parent in (SPS-574, SPS-125, ...)`. Extracts unique Jira project key prefixes (e.g., PARSER, DT, DELTA, DEVORTEX, TQCT). These prefixes are used as `NOT LIKE '%PREFIX-%'` exclusions in the commit query.
2. **Exclude tracked work — repos:** Reads `epic_summaries` cache for repo lists. Repos appearing in ≤3 epics are considered "exclusive" and excluded. Widely shared repos (tms, gdn-frontend-monorepo) are NOT excluded to avoid false negatives.
3. **Per-team processing:** For each team with members, queries their commits in the last 14 days excluding the above. Skips teams with 0 untracked commits.
4. **LLM clustering:** Feeds each team's commits to LLM (`prompts/untracked-work-system.txt`) to cluster into 2-5 logical work groups with descriptive names and one-sentence summaries.
5. **Cache:** Stores in `untracked_summaries` table per team (24h TTL).

**Why prefix + repo exclusion:** Child issues use different Jira project keys (PARSER-*, DT-*, DELTA-*), not SPS-*. The prefix exclusion catches commits that reference child keys. The repo exclusion catches commits in epic-associated repos that don't reference any key.

## Frontend (`src/app/projects/projects-content.tsx`)

### Table structure
- `table-fixed` with `<colgroup>` percentages: 15% / 15% / 35% / 10% / 13% / 12%
- Goal and Initiative columns use `rowSpan` to merge consecutive identical values
- Hover highlighting: state-based (`hoveredGoal` / `hoveredInit`) — all cells in the hovered goal group get `bg-gray-900/30`

### Epic rows
- Chevron (▶) toggles `expandedEpic` state — only one expanded at a time
- On expand: fetches `/api/projects/[key]/summary` (if not cached in component state)
- Summary panel shows below epic text with a refresh button (↻)
- Epic key is a link to Jira (`https://{jiraHost}/browse/{key}`)

### "Not in Project" rows
- Appended after epic rows in the same `<tbody>`
- Goal column: "Not in Project" label (merged across all teams)
- Initiative column: "—"
- Each LLM-generated work group is a row with expandable summary (same chevron pattern, but summary is inline from API response — no separate fetch)
- Team column shows team pill

### Filters
- Three dropdowns: Business Goal, Initiative, Team (+ "No team" option)
- Active filters shown as accent-colored pills with × dismiss
- Filters apply to both epic rows and untracked rows

## Database tables

### `epic_summaries`
Caches LLM-generated epic summaries. Key: `(epic_key, org)`. TTL: 24h.

### `untracked_summaries`
Caches LLM-clustered work groups per team. Key: `(team_name, org)`. TTL: 24h.

Both tables auto-create on startup via `src/lib/db/mysql.ts` and `src/lib/db/sqlite.ts`.

## Prompt templates

- `prompts/epic-summary-system.txt` — strict pattern: `[What] — [N] tasks resolved, [N] commits across [repos] (~[net]K lines), [N] remaining ([list]).`
- `prompts/untracked-work-system.txt` — clusters commits into 2-5 named groups, returns JSON with name, summary, commitCount, repos, linesAdded, linesRemoved.

## Key files

| File | Purpose |
|------|---------|
| `src/app/projects/page.tsx` | Server component, feature gate |
| `src/app/projects/projects-content.tsx` | Client component, table + filters + expand |
| `src/app/api/projects/route.ts` | Epic list endpoint |
| `src/app/api/projects/[key]/summary/route.ts` | Epic summary endpoint |
| `src/app/api/projects/untracked/route.ts` | Untracked work endpoint |
| `src/lib/projects/service.ts` | Epic list service (Jira + team mapping) |
| `src/lib/projects/epic-summary.ts` | Epic summary service (Jira + commits + LLM) |
| `src/lib/projects/untracked.ts` | Untracked work service (commits + LLM clustering) |
| `src/lib/jira/client.ts` | `searchEpics()`, `searchChildIssues()` methods |

## Configuration

| Env var | Required | Example |
|---------|----------|---------|
| `JIRA_ENABLED` | Yes | `true` |
| `JIRA_PROJECTS_JQL` | Yes | `project = SPS AND issuetype = Epic AND status = "In Progress"` |
| `JIRA_HOST` | Yes | `smartling.atlassian.net` |
