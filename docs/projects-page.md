# Projects Page — Technical Reference

This document describes the `/projects` page architecture for AI coding assistants working on the codebase.

## Overview

The Projects page (`/projects`) displays Jira epics for one project at a time, chosen from any number of projects registered in the `jira_projects` table and configured via Settings → Projects. Each project has three tabs (active, middle, done) and one of two layouts: `goal-initiative` hierarchy groups epics by Business Goal → Initiative, `owner` hierarchy is flat and groups by the epic's assignee instead. Each epic can be expanded to show an AI-generated summary of recent work. A separate "Not in Project" section shows team-by-team work that isn't attributable to any tracked epic.

## Feature gating

- Page returns 404 if `JIRA_ENABLED !== 'true'`
- Page shows a "not configured" empty state ("No Jira projects configured. Add one in Settings → Projects.") when the org has no rows in `jira_projects`
- Nav link on home page only visible when Jira is enabled and configured (checked via `/api/llm-config`)
- "Show work outside projects" button restricted to admins (`canAct` from `useAuth()`)

## Board configuration

Each project on the board is a row in the org-scoped `jira_projects` table, managed from **Settings → Projects** (admin only): project key, display name, active status, middle status (optional — a project with none gets a two-tab board), hierarchy, and position (sort order / default project). See `src/lib/jira-projects/` for validation and JQL construction.

Both the project key and the two status fields are re-validated at the point of use in `buildProjectJql`, not just on save — this also catches rows written directly to the DB rather than through the Settings form.

## Data flow

### 1. Epic list (`GET /api/projects?org=<org>&project=<key>&status=active|middle|done`)

**Source:** `src/app/api/projects/route.ts` → `src/lib/jira-projects/jql.ts` (JQL) + `src/lib/projects/service.ts` (epics)

1. Resolves which configured project to query (`?project=<key>`, default the one with the lowest `position`) and which of its three tabs (`?status=`, default `active`). Builds that project/tab's JQL via `buildProjectJql()` and runs it against Jira via `client.searchEpics(jql)` — returns epics with parent links
2. Collects unique Initiative keys from epic parents
3. Batch-fetches Initiatives to resolve their parents (Business Goals) — `key in (SPS-1, SPS-11, ...)`
4. Maps epic assignee → team: `user_mappings` table (jira_email → github_login) → `team_members` + `teams` (github_login → team name/color)
5. Returns sorted list: Goal → Initiative → Epic name. Parentless epics are kept rather than dropped — this is what lets a flat `owner` project (no Initiative/Goal parents at all) render instead of coming back empty
6. Also returns `jiraHost` and the resolved `project` row (including its `hierarchy`) so the frontend can pick a layout

**Jira hierarchy:** `goal-initiative` projects group Business Goal (level 3) → Initiative (level 2) → Epic (level 1) and render 7 table columns. `owner` projects are flat — 6 columns, headed "Owner" — grouped by the epic's assignee instead.

**Per-project, per-tab JQL (`buildProjectJql`):**
- active: `project = "<key>" AND issuetype = Epic AND status = "<activeStatus>"`
- middle (only if `middleStatus` is set): `project = "<key>" AND issuetype = Epic AND status = "<middleStatus>"`
- done: `project = "<key>" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d`

**Critical invariant:** the active and middle tabs must use the exact named status (`status = "..."`), never a status category. Measured on production Jira, `status = "In Progress"` returns 46 SPS epics while `statusCategory = "In Progress"` returns 71 — the extra 25 sit in Discovery, Rollout, Specs & Design and Ready for Dev. Using the category would silently inflate the board and double-list Rollout epics onto the wrong tab.

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

### 4. Epic stats / Progress rings (`GET /api/projects/[key]/stats?org=<org>`)

**Source:** `src/app/api/projects/[key]/stats/route.ts` → `src/lib/projects/epic-stats.ts`

Loaded in parallel on page load — frontend fires one fetch per epic simultaneously. Rings appear progressively as each resolves.

1. **Cache check:** Reads `epic_stats` table. Returns cached if < 24h old.
2. **On cache miss:** Calls `client.searchChildIssues(epicKey)` for Jira child counts, then runs two-phase commit query (same logic as epic summaries) for commit/dev counts.
3. **Upserts** into `epic_stats` table.

**What the rings show:**
- **Ring size** = overall volume (`totalJiras + commitCount + devCount`, normalized to the largest epic on the page)
- **Outer ring (amber)** = % of Jira child tasks closed (`resolvedJiras / totalJiras`)
- **Inner ring (green)** = commit progress (`actualCommits / expectedCommits`, where `expected = totalJiras × avgCommitsPerJira`, capped at 100%)
- **Center number** = developer count
- **Hover tooltip** = exact numbers

**`avgCommitsPerJira`** is computed client-side from the aggregate of all loaded stats across epics. Updates as more stats arrive.

**Relationship to epic summaries:** The epic summary service (`getEpicSummary`) calls `getEpicRingStats()` for its stats instead of computing them independently. On summary refresh (`forceRefresh=true`), both `epic_stats` and `epic_summaries` caches are evicted and recomputed.

## Database tables

### `epic_stats`
Caches lightweight ring metrics per epic. Key: `(epic_key, org)`. TTL: 24h. Fields: `total_jiras`, `resolved_jiras`, `remaining_jiras`, `commit_count`, `dev_count`, `lines_added`, `lines_removed`, `repos`.

### `epic_summaries`
Caches LLM-generated epic summaries. Key: `(epic_key, org)`. TTL: 24h. Uses stats from `epic_stats` — not independent.

### `untracked_summaries`
Caches LLM-clustered work groups per team. Key: `(team_name, org)`. TTL: 24h.

All tables auto-create on startup via `src/lib/db/mysql.ts` and `src/lib/db/sqlite.ts`.

## Cache architecture

```
epic_stats (lightweight, fast)          epic_summaries (LLM-generated)
┌─────────────────────────────┐        ┌────────────────────────────┐
│ total_jiras, resolved_jiras │        │ summary_text               │
│ commit_count, dev_count     │◄───────│ (calls getEpicRingStats)   │
│ lines_added, lines_removed  │        │ jira_resolved, commit_count│
│ repos, generated_at         │        │ lines_added, repos         │
└─────────────────────────────┘        └────────────────────────────┘
        ▲                                       ▲
        │ cache hit: 1 DB read                  │ cache hit: 1 DB read + stats
        │ cache miss: 1 Jira + 2-3 DB          │ cache miss: stats + 1 LLM call
        │                                       │
  /api/projects/[key]/stats          /api/projects/[key]/summary
  (rings, page load)                 (chevron click)

  On refresh (summary): evict BOTH tables → recompute stats → LLM → cache both
```

## Prompt templates

- `prompts/epic-summary-system.txt` — strict pattern: `[What] — [N] tasks resolved, [N] commits across [repos] (~[net]K lines), [N] remaining ([list]).`
- `prompts/untracked-work-system.txt` — clusters commits into 2-5 named groups, returns JSON with name, summary, commit_shas per group.

## Key files

| File | Purpose |
|------|---------|
| `src/app/projects/page.tsx` | Server component, feature gate |
| `src/app/projects/projects-content.tsx` | Client component, table + filters + rings + expand |
| `src/app/api/projects/route.ts` | Epic list endpoint |
| `src/app/api/projects/[key]/stats/route.ts` | Epic ring stats endpoint (no LLM) |
| `src/app/api/projects/[key]/summary/route.ts` | Epic summary endpoint (LLM) |
| `src/app/api/projects/untracked/route.ts` | Untracked work endpoint |
| `src/lib/projects/service.ts` | Epic list service (Jira + team mapping) |
| `src/lib/projects/epic-stats.ts` | Epic stats service (Jira counts + commit/dev counts, cached) |
| `src/lib/projects/epic-summary.ts` | Epic summary service (uses stats + LLM) |
| `src/lib/projects/untracked.ts` | Untracked work service (commits + LLM clustering) |
| `src/lib/jira/client.ts` | `searchEpics()`, `searchChildIssues()` methods |
| `src/lib/jira-projects/service.ts` | CRUD over the `jira_projects` table |
| `src/lib/jira-projects/jql.ts` | `buildProjectJql()` — per-project, per-tab JQL |
| `src/lib/jira-projects/types.ts` | `validateJiraProject()`, project key/status validation |
| `src/lib/jira-projects/seed.ts` | One-time legacy `JIRA_PROJECTS_JQL` → first row migration |
| `src/app/settings/projects-tab.tsx` | Settings → Projects admin UI |

## Configuration

| Env var | Required | Example |
|---------|----------|---------|
| `JIRA_ENABLED` | Yes | `true` |
| `JIRA_PROJECTS_JQL` | No (legacy) | `project = SPS AND issuetype = Epic AND status = "In Progress"` |
| `JIRA_HOST` | Yes | `smartling.atlassian.net` |

**`JIRA_PROJECTS_JQL` is legacy.** Board configuration now lives in the `jira_projects` table (Settings → Projects), and this env var no longer drives the board query. It still does two things: on upgrade, if an org has no `jira_projects` rows yet, it's parsed once to seed the first row so an existing deployment keeps its board with no operator action; and it continues to supply the project-key prefixes excluded from "Not in Project" untracked-work matching.
