# GLOOK-38 — Research on the Glooker Projects board

**Status:** design agreed, pending Ben's confirmation of the mockup
**Ticket:** [GLOOK-38](https://smartling.atlassian.net/browse/GLOOK-38)
**Mockup:** `mockups/glook-38-research-board.html` (published artifact)
**Date:** 2026-08-14

## Problem

Ben asked for the LanguageAI Research team (Jira project `RND`) to appear in Glooker as a
board like every other team's, replacing their use of RND board 646. His one added
requirement: finished tickets should linger on the board for a while.

Glooker's core loop is commit-driven, and Research barely commits. Four of the six RND
people are already ingested and sit at the very bottom of the impact ranking — 2 to 18
commits each, near-zero PR rate — while two more own epics without appearing at all. The
ranked developer table is the wrong instrument for them. The right one already exists: the
`/projects` page, which reads Jira epics rather than commits.

Three concrete obstacles block simply pointing it at RND:

1. **No hierarchy.** `/projects` renders Goal → Initiative → Epic and
   `src/lib/projects/service.ts:49` silently drops any epic without an Initiative parent.
   Zero of RND's 25 epics have a parent, so the board renders empty today.
2. **One global source.** `JIRA_PROJECTS_JQL` is a single env var
   (`project = SPS AND issuetype = Epic AND status = "In Progress"`), and team attribution
   is derived from the epic assignee's GitHub login via `user_mappings` → `team_members`.
   That chain is exactly what's unreliable for a team whose members may not commit.
3. **Commit-shaped progress rings.** The inner emerald arc measures commit volume against
   an expected rate and the centre digit counts committing developers. RND keys do appear
   in commit messages (Attila's carry `RND-1185:`), but they tend to name standalone tasks
   rather than epic children, so little rolls up.

## Goals

- Research appears as a team on `/projects`, with epics sourced from the RND project by
  provenance rather than inferred from who commits.
- The same rows, rings, status tabs and inline Jira status/due-date editing every other
  team has.
- Per-team board behaviour, so SPS is bit-for-bit unchanged.
- Parentless epics stop being discarded.

## Non-goals

- **Columns you drag cards between.** This is a table, not a kanban. Board 646 remains the
  place to move work. If Ben's real need is the drag interaction, this design does not
  meet it and we should hear that before building.
- **Ranking researchers against engineers by commit volume.** Not meaningful; not doing it.
- **LLM epic summaries for Research.** The existing summaries lean on commit diffs.
- **Per-team colour on the team chip.** `team.color` is already ignored on this page
  (`projects-content.tsx:1055`); out of scope to fix here.

## Decisions

Settled with Maksym against the mockup. Ben still to confirm.

| # | Decision | Chosen |
|---|---|---|
| 1 | Goal/Initiative columns for a flat project | **Group by researcher** — first column becomes the assignee, merged vertically; status moves to its own column |
| 2 | Middle status tab | **Backlog** instead of Rollout, per team |
| 3 | Done tab retention | **30 days, rejected included** |
| 4 | Progress ring | **Jira arc only** — single amber arc, centre digit = child count |

**Decision 3 diverges from the ticket.** Ben wrote "maybe two weeks"; we're proposing 30
days. Rationale: research epics run months, and at a fortnight the Done tab holds exactly
one row (`RND-1191`, closed 5 Aug — `RND-1152` at 29 days falls out). 30 days is also
today's behaviour, so nothing changes for other teams. This must be raised with him
explicitly, not shipped quietly. It is a one-value change to reverse.

**Rejected work needs a date fallback.** `RND-968 Foundation Ranking v2` has status
`Rejected`, which Jira files under `statusCategory = Done` but leaves with a null
`resolutiondate`. No `resolved >= -Nd` window can ever catch it. Including rejected epics
therefore means widening the Done query to `resolved >= -30d OR updated >= -30d`.

## Architecture

### `teams.board_config` — one nullable JSON column

All four decisions are per-team, because SPS must keep its current behaviour. Rather than
four columns, one nullable JSON blob on `teams`:

```json
{
  "jiraProjectKeys": ["RND"],
  "hierarchy": "owner",
  "middleTab": "Backlog",
  "ringMode": "jira",
  "doneWindowDays": 30,
  "includeRejected": true
}
```

`NULL` (every existing team) means today's behaviour exactly: assignee-based attribution,
Goal → Initiative hierarchy, a Rollout middle tab, both ring arcs, rejected work excluded.
Every key is individually optional and falls back to the current default.

Precedent for a JSON column: `team_pulse_summaries.projects` (`schema.sql:195`).

### Project sources and attribution

`/api/projects` today runs one JQL. It becomes a resolver over a list of sources:

```ts
type ProjectSource =
  | { kind: 'global'; jql: string }
  | { kind: 'team'; team: { name: string; color: string }; projectKeys: string[] };
```

- The `global` source is `JIRA_PROJECTS_JQL`, run and mutated exactly as today —
  back-compatible, no behaviour change.
- One `team` source per team whose `board_config.jiraProjectKeys` is non-empty.
- Results merge and dedupe by epic key. Epics from a `team` source are attributed to that
  team **by provenance**, skipping the `user_mappings` → `team_members` hop entirely. So
  Alex Yanishevsky and Olivia Norris get correct team attribution without needing a GitHub
  identity — though their **Lead** cell still shows unassigned until they're mapped.
- Epics from the `global` source keep assignee-based attribution
  (`buildAssigneeTeamMap`, `service.ts:83-118`) unchanged.

If an epic somehow arrives from both, provenance wins.

### JQL construction, and why not string surgery

The status tabs currently rewrite the JQL by regex (`api/projects/route.ts:20-27`):

```ts
jql = baseJql.replace(/status\s*=\s*"[^"]*"/, 'status = "Rollout"');
```

This only matches a literal `status = "…"` clause and **silently no-ops** for the
`statusCategory = "…"` form that `env-validation.ts:127` and `.env.example:114` themselves
recommend. We are not extending that mechanism. `team` sources get a structured builder:

| Tab | Clause |
|---|---|
| In Progress | `project in (…) AND issuetype = Epic AND statusCategory = "In Progress"` |
| Backlog | `project in (…) AND issuetype = Epic AND statusCategory = "To Do"` |
| Done, `includeRejected: false` | `… AND statusCategory = "Done" AND resolved >= -{doneWindowDays}d` |
| Done, `includeRejected: true` | `… AND statusCategory = "Done" AND (resolved >= -{doneWindowDays}d OR updated >= -{doneWindowDays}d)` |

`doneWindowDays` defaults to 30, matching today's behaviour. It is a config value precisely
because decision 3 is the one most likely to be overruled — switching Research to Ben's two
weeks is then a Settings edit, not a code change. The tab label follows it (`Done (2w)` /
`Done (30d)`).

`statusCategory` rather than `status` so it survives RND's workflow naming (`Backlog` maps
to the `To Do` category; `Rejected` maps to `Done`).

The existing regex is left alone — fixing it is a separate concern and touching it here
would put SPS's board at risk for no gain in this ticket. Worth its own ticket.

### Parentless epics

`src/lib/projects/service.ts:49` drops epics whose parent is not an Initiative. Change it
to keep them with `goal: null, initiative: null`.

**Blast radius, measured:** of 46 SPS In-Progress epics, 45 have an Initiative parent and
**one does not** — `SPS-720 Make active repositories AI-ready`. So this fix adds exactly one
row to the SPS board. That is a bug fix with a negligible footprint, not a hazard.

### Hierarchy modes (decision 1)

`hierarchy: 'goal-initiative'` (default) is today's layout. `hierarchy: 'owner'` changes
the column set:

| Mode | Columns (width %) |
|---|---|
| `goal-initiative` | Business Goal 14 · Initiative 14 · ring 4 · Epic 34 · Due 10 · Lead 13 · Team 11 |
| `owner` | Researcher 18 · ring 4 · Epic 43 · Due 11 · Status 11 · Team 13 |

`owner` reuses the existing consecutive-run rowSpan merging (`projects-content.tsx:489-528`)
keyed on assignee instead of goal/initiative, so a run of one person's hypotheses reads as
one block — the same visual rhythm the SPS board already has. Status moves out of the Lead
cell into its own column, keeping the interactive transition dropdown.

### Ring modes (decision 4)

`ringMode: 'commits'` (default) is today. `ringMode: 'jira'` renders a single amber arc at
radius 20 for `resolvedJiras / totalJiras`, drops the inner emerald arc and its track, and
puts `totalJiras` in the centre instead of `devCount`. Size still scales with
`log(commits + jiras + 1)`, so rows stay comparable.

Verified against the real formulas: RND-1085 (30 children, all closed) renders at 48px with
a 3.0 stroke and a full arc; RND-1098 (no children) floors at 22px with an 8.0 stroke.

### When does a board_config apply?

`/projects` is org-wide with a team filter. A per-team config only makes sense for a
single-team view, so:

> `board_config` applies when the team filter selects **exactly one** team that has one.
> Otherwise the page renders in default mode, and Research's epics appear as ordinary rows
> with em-dash hierarchy.

Research epics therefore still show up on the unfiltered board — they are not hidden — they
just don't restructure it.

`/projects?team=Research` already works as a bookmark: `filterTeam` is
`useUrlState({ key: 'team' })` at `projects-content.tsx:83`, so the deep link needs no new
work. What is actually missing is passing that team to the **API** — the SWR key is
`/api/projects?org=…&status=…` with no team parameter — so server-side source resolution and
the `boardConfig` lookup never see it. That plumbing, and keying the client's `tabCache` by
team as well as tab, is the real task.

## Data model

`teams` is a base table, so on MySQL it comes from `schema.sql` while `db/mysql.ts` only
runs `ALTER` migrations. The column must be added in **three** places:

1. `schema.sql` — `board_config JSON NULL` on the `teams` definition.
2. `src/lib/db/mysql.ts` — guarded `ALTER TABLE teams ADD COLUMN board_config JSON NULL`
   alongside the existing swallowed migrations (~lines 266-322).
3. `src/lib/db/sqlite.ts` — in the `SCHEMA` literal **and** as a guarded `ALTER` for
   existing local DBs (~lines 286-320).

**Do not pin a charset** on any table touched here (`ER_FK_INCOMPATIBLE_COLUMNS`, errno
3780 — the 2026-08-11 org-report outage; guarded by `mysql-schema-fk-charset.test.ts`).
`initSchema()` swallows DDL failures, so a bad migration fails silently until a query hits
it.

No writer uses `ON DUPLICATE KEY UPDATE` on `teams` for this column, so the `conflictCols`
map in `sqlite.ts:389-405` needs no entry.

## API

| Route | Change |
|---|---|
| `GET /api/projects?org=&status=` | Resolves and merges project sources; accepts `Backlog` as a `status` value; returns `boardConfig` for the requested team when one applies |
| `GET /api/teams?org=` | Returns `board_config` per team |
| `PUT /api/teams/[id]` | Accepts `board_config`; validates keys and enum values, rejects unknown ones |

Response addition to `GET /api/projects`:

```ts
{ epics: ProjectEpic[], jiraHost: string | null, boardConfig: BoardConfig | null }
```

`ProjectEpic` gains `projectKey: string` so provenance is inspectable client-side.

Every handler stays wrapped in `withRequestLog()` — enforced by
`logger-enforcement.test.ts`. `PUT /api/teams/[id]` keeps `requireAdmin`.

## UI

- `src/app/projects/projects-content.tsx` — column set, header labels and `colgroup`
  driven by `boardConfig.hierarchy`; tab list driven by `boardConfig.middleTab`; the Done
  tab label follows `boardConfig.doneWindowDays`; `ProgressRing` takes a `mode` prop.
- `src/app/settings/page.tsx` — the `TeamsTab` (lines 385-475) gains a Jira project-keys
  field and the three board toggles, admin-only.
- Page files under `src/app/**/page.tsx` may export **only** `default` — anything shared
  goes in a sibling module.

The mockup is the visual reference; it reproduces the shipped palette, spacing and ring
geometry exactly.

## Mock and seed

Per `CLAUDE.md`, a new entity means updating both mock and seed:

- `scripts/mock-identities.ts` — add a fourth team with a `boardConfig`, plus two members
  who have a `jiraEmail` but no commits, to exercise the research-shaped case.
- `scripts/seed-data.ts` — `seedTeams` carries `board_config` (JSON-stringified).
- `src/lib/jira/mock-client.ts` — `searchEpics` currently **ignores the JQL entirely** and
  returns all four fixture epics. It must at least honour a project-key filter, or the
  provenance path is untested in mock mode. Add fixture epics with no parent so the
  parentless path is exercised.

## Testing

- `service.ts` keeps parentless epics with null goal/initiative; provenance attribution
  beats the assignee map; provenance wins on overlap.
- JQL builder emits the right clause per tab, honours `doneWindowDays`, and adds the
  `OR updated >= -Nd` widening only when `includeRejected` is set.
- `board_config` round-trips through both dialects; `NULL` yields today's defaults; unknown
  keys and bad enum values are rejected by the API.
- Ring geometry in `jira` mode: no inner circle emitted, centre digit is the child count.
- Existing MySQL charset guard and logger-enforcement tests must stay green.
- Any test setting `SQLITE_PATH`/`DB_TYPE` must restore the prior value in `afterAll` —
  `process.env` is shared across a Jest worker.
- Component tests need a `/** @jest-environment jsdom */` docblock.

## Risks and open questions

1. **Ben may actually want the kanban.** "Move this view into it" could mean the columns,
   not the contents. The mockup exists to find out. If it is the drag interaction he wants,
   this design does not deliver it.
2. **The 30-day divergence** from his stated two weeks needs his explicit sign-off.
3. **Unmapped assignees.** Alex Yanishevsky and Olivia Norris own epics but have no
   `user_mappings` row, so their Lead cell reads unassigned. Provenance fixes team
   attribution but not the person. Manual mapping in Settings resolves it.
4. **Backlog epics have no children yet**, so their rings are all 22px floors with empty
   arcs. Visually flat but correct.
5. **`epic-stats` uses a 90-day child window** (`epic-stats.ts:53-60`), which is unchanged
   here but means an old epic's ring can under-report. Pre-existing, noted only.
6. **`docs/projects-page.md` is stale** — claims a 14-day window where the code uses 90.
   Worth correcting while we're in this area.

## Out of scope, worth their own tickets

- The `status`-vs-`statusCategory` regex fragility in `api/projects/route.ts:20-27`.
- `/api/projects` and `GET /api/teams` are unauthenticated; `team-pulse` lacks the
  `requireAdmin` its spec called for.
- `team.color` unused on the Projects page.
- The stale `" 2.tsx"` / `" 3.md"` cloud-sync duplicates littering `src/app/projects/`,
  `src/lib/team-pulse/` and `docs/superpowers/`.
