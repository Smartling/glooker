# Team Pulse Summary — Design Spec

## Overview

Add an LLM-generated daily team pulse summary to the Team Summary page. When an admin selects a team filter and the active report covers >= 14 days, a collapsible summary appears above the developer table showing activity changes, silent members, team focus, and alerts for the last 2 working days compared to the 2 working days before that.

## Where It Appears

**Page:** Team Summary (`/report/[id]/team`)

**Trigger:** All of these must be true:
1. A team filter is selected (not "all developers")
2. The report's `period_days >= 14`
3. The viewer is an admin (`canAct` from `useAuth`)

**Position:** Above the developer table, below the report header and filters. Collapsible — expanded by default on first load, remembers collapse state in session.

## Data Model

### Time Windows

Given a report's date range, compute the last 4 working days (Mon-Fri, excluding weekends):

- **Current window:** last 2 working days in the report period
- **Prior window:** 2 working days immediately before the current window

Example for a report ending Apr 13 (Sunday):
- Current: Thu Apr 10, Wed Apr 9
- Prior: Tue Apr 8, Mon Apr 7

### Per-Member Data Extraction

For each team member, query `commit_analyses` grouped by `DATE(committed_at)` for the 4 working days:

```sql
SELECT github_login, DATE(committed_at) as day,
  COUNT(*) as commits,
  COUNT(DISTINCT pr_number) as prs,
  SUM(lines_added) as lines_added,
  SUM(lines_removed) as lines_removed,
  ROUND(AVG(complexity), 1) as avg_complexity,
  GROUP_CONCAT(DISTINCT type ORDER BY type) as types,
  GROUP_CONCAT(DISTINCT repo ORDER BY repo) as repos
FROM commit_analyses
WHERE report_id = ? AND github_login IN (?) AND DATE(committed_at) IN (?)
GROUP BY github_login, day
```

Also query `jira_issues` for resolved tickets in the same windows:

```sql
SELECT github_login, DATE(resolved_at) as day, COUNT(*) as issues,
  ROUND(SUM(COALESCE(story_points, 0)), 1) as story_points
FROM jira_issues
WHERE report_id = ? AND github_login IN (?) AND DATE(resolved_at) IN (?)
GROUP BY github_login, day
```

For reviews: use `developer_stats.total_reviews` as report-period context (no daily breakdown available). Show as "N reviews this period" in the member context, not as a daily metric.

### Aggregation

For each member, aggregate the current and prior windows:
- Commits, PRs, lines added/removed, jira issues, story points — summed per window
- Delta: percentage change from prior to current
- Repos and work types from the current window
- Team averages computed from active members in the current window

### Team Health Indicators

Computed from the aggregated data (no LLM needed):
- **Active ratio:** X of Y members active (had commits in current window)
- **Trending:** total team commits current vs prior (up/down/stable arrow + percentage)

## LLM Summary

### Prompt Template

Stored in `prompts/team-pulse-system.txt` (customizable, like all other prompts).

**System prompt** instructs the LLM to:
- ONLY use data provided — never infer or hallucinate
- Use @handles for developers
- Be direct and scannable — short bullets, no fluff
- Compare individuals against their own baseline AND the team average
- Keep under 350 words
- Use exact structure: Activity Changes, Silent Members, Team Focus, Alerts

**User prompt** is constructed from the extracted data — a self-contained text block listing each member's current vs prior stats, team averages, and any Jira/review context. The LLM never queries the database directly.

### Single LLM Call Per Team

One call produces the full summary. No multi-prompt chains needed.

### Caching

Cache the summary in a new `team_pulse_summaries` table:

```sql
CREATE TABLE team_pulse_summaries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    TEXT NOT NULL,
  team_name    TEXT NOT NULL,
  org          TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  health_json  TEXT NOT NULL,  -- {activeRatio: "5/7", trending: "+23%", trendDirection: "up"}
  generated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, team_name)
);
```

**Cache key:** `(report_id, team_name)`. One summary per team per report. Cached indefinitely (report data doesn't change after completion).

**Cache invalidation:** only when the report is deleted (CASCADE). No TTL needed.

## API

### `GET /api/report/[id]/team-pulse?team={teamName}&org={org}`

Returns the cached summary if available, otherwise generates it on demand:

```typescript
{
  summary: string;         // LLM-generated markdown text
  health: {
    activeRatio: string;   // "5/7"
    trending: string;      // "+23%"
    trendDirection: "up" | "down" | "stable";
  };
  generatedAt: string;     // ISO timestamp
  cached: boolean;
}
```

**Auth:** admin only (`requireAdmin`).

**Behavior:**
1. Check `team_pulse_summaries` for cached entry
2. If cached, return immediately
3. If not cached, compute time windows, extract data, call LLM, cache, return
4. If report `period_days < 14`, return `400` with error message

## UI

### Team Pulse Card

A card that appears above the developer table when all trigger conditions are met.

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Team Pulse: {TeamName}                    5/7 active ▲23% │
│ Apr 9-10 vs Apr 7-8                        [Collapse ▾] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ## Activity Changes                                     │
│ - @dimitrystd surged 250% (2.8x team avg)...          │
│ - @AlexanderPashinskiy dropped 35%...                  │
│                                                         │
│ ## Silent Members                                       │
│ - @DmitryMasley went dark after frontend work          │
│                                                         │
│ ## Team Focus                                           │
│ - Primary repos: tms, back-translation-service         │
│ - 35 commits, 11 PRs merged                           │
│                                                         │
│ ## Alerts                                               │
│ - @DmitryMasley needs check-in                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Header row:**
- Team name
- Active ratio badge: "5/7 active"
- Trending indicator: arrow + percentage (green for up, red for down, gray for stable)
- Collapse/expand toggle

**Body:**
- Rendered markdown from the LLM summary
- Loading state: skeleton with "Generating team pulse..." text
- Error state: "Failed to generate summary" with retry button

**Collapse state:** stored in `sessionStorage` per team name. Defaults to expanded on first view.

### Rendering Markdown

The summary text is markdown. Use a simple renderer — the existing codebase doesn't use a markdown library, so render with basic replacements:
- `## Heading` → bold heading
- `- bullet` → bullet list
- `@handle` → styled inline
- `**bold**` → bold text

Or use `dangerouslySetInnerHTML` with a lightweight markdown-to-HTML function. Keep it simple — the LLM output is controlled and predictable.

## File Structure

```
src/lib/team-pulse/
├── service.ts        # getTeamPulse() — orchestrates data extraction, LLM call, caching
├── data.ts           # extractTeamPulseData() — SQL queries, time window computation
└── prompt.ts         # buildTeamPulsePrompt() — constructs the LLM prompt from data

prompts/
└── team-pulse-system.txt   # System prompt template

src/app/api/report/[id]/team-pulse/
└── route.ts          # GET handler — admin-gated, calls service

src/app/report/[id]/team/
└── page.tsx          # Modified — adds TeamPulseCard when conditions met
```

## Working Day Computation

```typescript
function getWorkingDays(reportEndDate: Date, count: number): string[] {
  const days: string[] = [];
  const d = new Date(reportEndDate);
  while (days.length < count) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().split('T')[0]);
    }
  }
  return days.reverse(); // chronological order
}
```

Called with `count=4` to get the 4 working days. First 2 = prior window, last 2 = current window.

## Access Control

| Action | Condition |
|--------|-----------|
| See team pulse card | `claudeCodeEnabled` is NOT required. Only: `isAdmin` AND team filter selected AND `period_days >= 14` |
| API endpoint | `requireAdmin(req)` |

## What This Does NOT Do

- No per-user daily pulse (only per-team)
- No daily review breakdown (uses report-period total as context)
- No email/Slack notifications
- No automatic scheduled generation (on-demand only, cached after first view)
- No comparison across different reports (only within one report's date range)

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger location | Team Summary page with team filter | Natural context — lead is already looking at their team |
| Min report period | 14 days | Need enough data for 4 working days + meaningful comparison |
| Window size | 2 working days vs 2 working days | Balances noise (1 day too spiky) vs staleness (3+ days too averaged) |
| LLM calls | 1 per team | All data fits in one prompt; multi-call adds latency and cost |
| Caching | DB table per (report_id, team_name) | Report data is immutable after completion; cache forever |
| Admin only | Phase 1 | Validate quality before opening to all users |
| Prompt storage | `prompts/` directory | Consistent with all other LLM prompts; customizable without code changes |
| Markdown rendering | Simple inline renderer | No library dependency; LLM output is controlled |
| Reviews | Report-period total as context | No daily breakdown available in schema |
