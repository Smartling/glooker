# GLOOK-11 — Per-Team Current Projects on Team Pulse

## Goal

Add a per-team "Current Projects" card to the Team Pulse page. The card lists the projects each team is actively shipping, derived from GitHub commit + Jira issue activity by team members. It mirrors the org-level Projects card from the home page but scoped to a single team and over the full report window.

The feature is intentionally **disconnected from the manually-curated Projects page** — no comparison badges, no drift detection in v1. If we want a drift signal later, it gets its own ticket.

## Non-goals

- **Comparison with the Projects page** (`/projects`). Out of scope — different unit (LLM cluster vs Jira epic) and different curation model. Separate concern.
- **Refactoring the Projects page itself.**
- **Manual override / curation UX.** The card is purely derived from activity.
- **A new top-level route.** This adds a card to an existing page; no new URL.

## Architecture

```
User clicks team on /report/[id]/team
        │
        ▼
GET /api/team-pulse/[reportId]/[teamName]     (existing endpoint)
        │
        ▼
getTeamPulse(reportId, team, org, teamMembers)
   │
   ├─► cache hit on team_pulse_summaries?
   │     └─► yes: return { summary, health, projects, ... }
   │
   ├─► extractTeamPulseData(...)         (existing, pulse window)
   ├─► generatePulseSummary(slice)       (existing LLM call)
   │
   ├─► extractTeamProjectsData(...)      ← NEW, full report window
   │     pulls commits + jira_issues filtered to team_members
   │
   ├─► generateTeamProjects(data)        ← NEW, second LLM call
   │     returns Project[]
   │
   └─► write row to team_pulse_summaries (now with projects JSON column)
         and return { summary, health, projects, generatedAt, cached }
```

**Lazy regeneration.** The team pulse already generates on-click, cached per (report_id, team_name). The projects step rides the same trigger and caches in the same row. Teams nobody visits cost nothing.

**LLM cost envelope.** ~1 extra LLM call per (team, report) visit. For ~10 teams over daily reports, even if every team is visited, that's ~10 extra calls per day. Marginal.

## Data layer

### `extractTeamProjectsData(reportId, teamMembers, periodDays)`

New function in `src/lib/team-pulse/data.ts`. Pulls the inputs the LLM clustering needs:

```ts
interface TeamProjectsInput {
  commits: Array<{
    sha: string;
    repo: string;
    pr_number: number | null;
    message_first_line: string;
    github_login: string;
    lines: number;
    committed_at: string;
  }>;
  jira_issues: Array<{
    issue_key: string;
    project_key: string;
    summary: string;
    github_login: string;
    type: string | null;
    status: string | null;
  }>;
  team_members: string[];   // github logins; passed through to the prompt for validation
}
```

Window: `now() − report.period_days … now()`. Filter: `commit_analyses.github_login IN team_members` and `jira_issues.github_login IN team_members`.

**Input-size guard:** cap commits at the most recent 200 (sorted by `committed_at DESC`); pass all jira_issues (typically < 200 per team per window). This bounds the prompt to a predictable size on heavy teams.

### `generateTeamProjects(data)`

New module `src/lib/team-pulse/projects.ts`. Loads the prompt template, calls the LLM, parses the JSON response, validates the result.

```ts
interface TeamProject {
  name: string;                 // LLM-generated descriptive name
  summary: string;              // one-line description
  developers: string[];         // github logins (must be ⊆ team_members)
  jira_count: number;
  estimated_commits: number;
  estimated_prs: number;
  last_activity: string;        // ISO date — most recent commit in cluster
}
```

**Validation rules:**
- `developers` is filtered to `developers ∩ team_members` post-LLM (defensive against hallucinated logins).
- `last_activity` is overridden post-LLM with the actual MAX(committed_at) of the cluster's commits if available, or LLM-emitted value if the cluster has no commits.
- Projects with `developers.length === 0` after filtering are dropped.
- If `data.commits.length === 0 && data.jira_issues.length === 0`, **short-circuit and return `[]` without calling the LLM.**

### Prompt template

New file `prompts/team-pulse-projects.txt`. Placeholders: `{{TEAM_NAME}}`, `{{COMMITS_JSON}}`, `{{JIRA_ISSUES_JSON}}`, `{{TEAM_MEMBERS_JSON}}`. Structure mirrors the existing `prompts/team-pulse-system.txt` and the org-level project-insights prompt. Returns a JSON array matching the `TeamProject` shape.

## Schema change

```sql
ALTER TABLE team_pulse_summaries ADD COLUMN projects JSON NULL;
```

- MySQL: native JSON. SQLite: TEXT (the existing dual-DB SQL translator handles JSON columns as text).
- Nullable: legacy cached rows (pulse only, no projects) remain valid — they just render without the projects card. On next click, the row regenerates and gets `projects` populated.
- Migration: append to `schema.sql` for fresh DBs; existing dev/AWS instances need the `ALTER TABLE` run once on deploy (the startup migration pattern in `instrumentation.ts` / DB-init code handles "add column if not exists" — confirm shape during implementation).

## API contract

`/api/team-pulse/[reportId]/[teamName]` response is extended:

```ts
interface TeamPulseResponse {
  summary: string;
  health: { activeRatio: string; trending: string; trendDirection: 'up'|'down'|'stable' };
  projects: TeamProject[];   // NEW
  generatedAt: string;
  cached: boolean;
}
```

No new endpoint. Existing consumers ignore the extra field.

## UI layer

### Reusable component

Extract the home-page Projects card from inline JSX in `src/app/llm-findings.tsx:153–211` into `src/components/ProjectsCard.tsx`:

```tsx
interface ProjectsCardProps {
  projects: TeamProject[];
  loading?: boolean;
  title?: string;          // default: "Current Projects"
  subtitle?: string;
  emptyMessage?: string;   // default: "No active projects in this window."
}
```

Both surfaces consume it:
- **Home** (`llm-findings.tsx`) — replace inline JSX with `<ProjectsCard projects={orgProjects} />`. Behavior unchanged.
- **Team Pulse** (`src/app/report/[id]/team/page.tsx`) — render `<ProjectsCard projects={teamPulse.projects} title="Current Projects" subtitle="Active work over the report window" />` between the pulse summary block and the developer table.

### Row shape

Mirrors the existing home-card row: name (bold) + summary (subtle) + contributor logins beneath, plus right-aligned metric badges for `jira_count` / `estimated_commits` / `estimated_prs`. Add a small `last_activity` chip ("Active 2d ago") to the right side.

### States

| State | Renders |
|---|---|
| Loading (pulse not yet generated) | Skeleton rows, same pattern as the pulse summary loader. |
| Loaded, projects populated | Card with rows, ordered by `estimated_commits` desc. |
| Loaded, empty array | `emptyMessage` text inside the card. |
| Legacy cache (projects field absent / null) | Card hidden entirely — next click regenerates and populates. |

## Tests

| Layer | What | Where |
|---|---|---|
| Unit — data extractor | `extractTeamProjectsData()` filters to team_members, uses full report window, caps commits at 200. Cases: empty team, member with no activity, jira-only contributor, multi-repo cluster, oversized commit list (truncation). | `src/lib/__tests__/unit/team-projects-data.test.ts` |
| Unit — generator | `generateTeamProjects()`: validates `developers ⊆ team_members`, drops projects with empty developers, overrides `last_activity` from actual data, short-circuits empty input. | `src/lib/__tests__/unit/team-projects-generator.test.ts` |
| Unit — prompt template | Snapshot test on rendered `team-pulse-projects.txt` matches expected placeholders + structure. Run `npm test -- -u` after any edit to the template. | `src/lib/__tests__/unit/prompts.test.ts` (extend) |
| Unit — service | `getTeamPulse()` returns `{ summary, health, projects }`. Cache hit deserializes projects JSON; legacy row (`projects` null) returns `projects: []` and is NOT regenerated implicitly. | `src/lib/__tests__/unit/team-pulse.test.ts` (extend) |
| Mock provider | Add `promptTag('team-pulse-projects')` at the call site; add a fixture entry in `src/lib/llm-mock.ts` returning a representative 2-project array. | per CLAUDE.md mock conventions |
| Visual / smoke | Manual: in `npm run dev:mock`, visit a team page, confirm card renders with mock projects below the pulse summary and above the dev table. | n/a |

## Edge cases

| Case | Behavior |
|---|---|
| Team with 0 members | No data fetched, no LLM call, `projects: []` cached. Card renders empty state. |
| Team member with no activity in window | Filtered out of input; if all members are inactive, behaves like empty team. |
| LLM emits `developers` containing a non-team login | Stripped at validation. If that leaves `developers: []`, the whole project is dropped. |
| LLM emits an unparseable response | Existing LLM-parse fallback applies (strip code fences, retry, surface error). On terminal failure, `projects` is stored as `[]` and the failure is logged. (Same pattern as pulse summary failures today.) |
| Same project worked on by multiple teams | Each team's card shows the project with only that team's contributors and that team's share of metrics. Numbers won't match the org-level card; that's correct. |
| `report.period_days = 0` (mis-configured) | The extractor returns empty data; short-circuit path applies. |
| Pulse exists in cache without `projects` (legacy row) | UI hides the card. No implicit regen — the row only refreshes when the team is re-visited and the regen path is naturally triggered (e.g., cache TTL expiry or manual refresh). |

## Files touched

- **Modify** `src/lib/team-pulse/service.ts` — add projects step inside `getTeamPulse()`; persist + deserialize the JSON column.
- **Modify** `src/lib/team-pulse/data.ts` — add `extractTeamProjectsData()`.
- **Create** `src/lib/team-pulse/projects.ts` — `generateTeamProjects()` + `TeamProject` type + validation.
- **Create** `prompts/team-pulse-projects.txt` — new LLM prompt template.
- **Modify** `schema.sql` — `ALTER TABLE team_pulse_summaries ADD COLUMN projects JSON NULL`.
- **Create** `src/components/ProjectsCard.tsx` — extracted reusable component.
- **Modify** `src/app/llm-findings.tsx` — replace inline JSX with `<ProjectsCard>` (no behavior change).
- **Modify** `src/app/report/[id]/team/page.tsx` — render `<ProjectsCard>` between pulse summary and dev table.
- **Modify** `src/lib/llm-mock.ts` — fixture for the new prompt tag.
- **Modify** `scripts/seed-data.ts` — only if seeded reports need pre-populated `projects` JSON (otherwise lazy regen handles it on first click).
- **Create** `src/lib/__tests__/unit/team-projects-data.test.ts` and `team-projects-generator.test.ts`; extend existing `team-pulse.test.ts` and `prompts.test.ts`.
