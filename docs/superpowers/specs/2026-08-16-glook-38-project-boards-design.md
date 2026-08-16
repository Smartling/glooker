# GLOOK-38 — Per-project boards on the Projects page

**Status:** design agreed 2026-08-16, pending implementation
**Ticket:** [GLOOK-38](https://smartling.atlassian.net/browse/GLOOK-38)
**Supersedes:** `2026-08-14-glook-38-research-board-design.md`, which designed a per-*team* board and is deleted in the same commit that adds this file. That design was implemented on `feat/glook-38-research-board` (16 commits, never pushed or merged) and verified working against live Jira before being superseded.
**Mockup:** `mockups/glook-38-research-board.html` — **stale**, shows the superseded design.

## Problem

Ben asked for the LanguageAI Research team (Jira project `RND`) to appear in Glooker as a board like every other team's. The 2026-08-14 design delivered that by making the board configurable *per team*: a team declared which Jira projects it owned, and epics from those projects were attributed to it by provenance.

That worked — it is running locally against real RND data — but it framed a generic capability as a Smartling-specific one. "Research is a special team" does not generalise; "you can point the board at any Jira project" does. This revision reframes it.

## What changed, and why

| 2026-08-14 | Now | Reason |
|---|---|---|
| Board configured per **team** (`teams.board_config`) | Board configured per **Jira project** (`jira_projects` table) | A project selector generalises; a special team does not |
| Team declares its project keys | Project is the unit; teams are not involved | Removes the Smartling-specific framing |
| Epics attributed by **provenance** | Attributed by **assignee** → `user_mappings` → `team_members`, everywhere | One attribution rule, no per-project special case |
| `ringMode: 'commits' \| 'jira'` | Removed — always commits | All progress tracking reads the same instrument |
| `doneWindowDays` per team | Fixed 30 days | Unification |
| `includeRejected` per team | Removed | Filtering Done on *last-updated* already catches rejected work |
| Board = merge of global JQL + team sources | Board = exactly one selected project | No merging, dedupe or provenance-precedence logic |

**The cost, stated plainly:** dropping provenance means an epic whose assignee has no GitHub account shows an em-dash in the Team column. On RND that is structural, not a data gap — `team_members` is keyed on `github_login`, and Alex Yanishevsky and Olivia Norris appear to have no GitHub account, so no row anyone can add would resolve them. This was chosen deliberately over keeping a project→team fallback.

## Goals

- `/projects` gains a Project selector; the board shows exactly one Jira project at a time.
- Any Jira project can be added by an admin without a deploy.
- SPS's three tabs return **identical** results to today.
- One ring, one Done semantic, one attribution rule across every project.

## Non-goals

- **Columns you drag cards between.** This is a table, not a kanban.
- **Ranking researchers against engineers by commit volume.**
- **Making rings meaningful for low-commit teams.** RND rings will show a full-ish amber arc and a near-empty emerald one. That is the same instrument SPS uses, reading honestly — not a defect to fix later.
- **Repointing untracked work per project** (see Scope).
- **Team membership by Jira identity.** It would fix the em-dash case at the root and is the natural follow-up ticket, but it touches `team_members`, the Settings members UI and Jira auto-discovery.

## Decisions

Settled 2026-08-16.

| # | Decision | Chosen |
|---|---|---|
| 1 | How a project is selected | Dropdown in the filter row, from an admin-managed list in Settings |
| 2 | Team column source | Assignee mapping only; em-dash when unmapped |
| 3 | Row grouping and the status tabs | Stay configurable, moved onto the project entry. Both tab statuses are named per project, not just the middle one — see the evidence below, which forced that |
| 4 | Done window | Unified to SPS's clause — 30 days, by last-updated |

## The evidence that shaped the JQL design

The obvious generic implementation — build every tab from `statusCategory` — **breaks the SPS board**. Measured against live Jira on 2026-08-16:

```
project = SPS AND issuetype = Epic AND status = "In Progress"          →  46 epics
project = SPS AND issuetype = Epic AND statusCategory = "In Progress"  →  71 epics
```

The 25 extra are `Discovery` (8), **`Rollout` (7)**, `Specs & Design` (6) and `Ready for Dev` (4). Using categories would put SPS's Rollout epics on the In Progress tab *as well as* their own, and drag in 18 pre-development epics the board deliberately excludes.

RND is the opposite shape: only **1** of its 13 in-progress-category epics carries a status other than the literal `In Progress`.

**Therefore each project names its own tab statuses.** No category inference for the first two tabs. Different Jira workflows genuinely differ, and pretending otherwise is itself a Smartling-specific assumption.

## Architecture

### `jira_projects` — one row per selectable project

Org-scoped, like `teams`.

| Column | Type | Example (SPS) | Example (RND) |
|---|---|---|---|
| `id` | uuid PK | | |
| `org` | string | `Smartling` | `Smartling` |
| `project_key` | string | `SPS` | `RND` |
| `display_name` | string | Smartling Platform | LanguageAI Research |
| `active_status` | string | `In Progress` | `In Progress` |
| `middle_status` | string, nullable | `Rollout` | `Backlog` |
| `hierarchy` | enum | `goal-initiative` | `owner` |
| `position` | int | 0 | 1 |

`UNIQUE(org, project_key)`. A blank `middle_status` yields a two-tab board.

### JQL generation

```
tab 1 (active):  project = "<key>" AND issuetype = Epic AND status = "<active_status>"
tab 2 (middle):  project = "<key>" AND issuetype = Epic AND status = "<middle_status>"
tab 3 (done):    project = "<key>" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d
```

Applied to SPS with `active_status = "In Progress"` and `middle_status = "Rollout"`, these three are semantically identical to what the current route produces for its three tabs — which is what makes the SPS board safe.

`project_key`, `active_status` and `middle_status` are interpolated into quoted JQL literals, so all three are validated on write: project keys against `/^[A-Z][A-Z0-9_]*$/`, status names rejected if they contain a double quote. Validation lives in one module, and `buildProjectJql` re-checks at the point of use — the same defence-in-depth the superseded revision's final review asked for.

**This deletes the JQL-rewriting regex.** `route.ts`'s `baseJql.replace(/status\s*=\s*"[^"]*"/, …)` — long flagged as fragile and silently broken for the `statusCategory` form — is replaced by generation. That was an out-of-scope item in the superseded revision; it resolves for free here.

### Attribution

One rule, everywhere: `assigneeEmail` → `user_mappings` → `team_members` → `teams`. `fetchProjectEpics` loses its `provenanceTeam` option and the associated precedence rule. Unmapped assignees render an em-dash, exactly as unmapped SPS assignees do today.

### Layout and rings

`hierarchy` drives the column set, unchanged from the implemented design: `goal-initiative` gives the seven-column layout, `owner` gives six with the assignee merged into the leading column and status split out. `computeSpans` and `columnLayout` survive as-is.

`ProgressRing` loses its `mode` prop and the entire jira-only branch. Its commits-mode rendering — two arcs, developer count in the centre — becomes the only rendering.

### Parentless epics

Unchanged from the implemented design and still required: `fetchProjectEpics` keeps epics with no Initiative parent, with `initiative: null` and `goal: null`, and a `hasInitiative` guard prevents a Story parent being rendered as an Initiative. Measured impact on SPS remains exactly one added row (`SPS-720`).

Correcting a claim in the superseded revision: RND is **not** uniformly flat. Measured 2026-08-16 across its 68 epics — In Progress 13 flat / 0 with initiative; Backlog 36 flat / 14 with; Done 5 flat / 0 with. The `owner` layout hides the Initiative column on the 14 Backlog epics that have one.

## Data model

A new table needs adding in **both** `src/lib/db/sqlite.ts` (which creates everything) and `src/lib/db/mysql.ts` (which creates only the newer tables), plus `schema.sql` for parity. **Never pin a charset** — `ER_FK_INCOMPATIBLE_COLUMNS`, errno 3780, guarded by `mysql-schema-fk-charset.test.ts`.

`teams.board_config` is dropped via a guarded `ALTER TABLE teams DROP COLUMN board_config` in both dialects. It exists on exactly one machine, its entire contents is config this revision abandons, and an orphan column on a base table that no code reads is worse cruft than a swallowed DROP.

### Self-migration

On first boot, if `jira_projects` is empty and `JIRA_PROJECTS_JQL` is set, seed one row by parsing it: `project\s*=\s*"?(\w+)"?` for the key, `status\s*=\s*"([^"]+)"` for `active_status`, `middle_status` `Rollout`, `hierarchy` `goal-initiative`, `display_name` = the key. That reproduces today's SPS board with no operator action. If either parse fails, the table stays empty and the page shows the existing "not configured" state pointing at Settings — no half-configured row.

## API

| Route | Change |
|---|---|
| `GET /api/projects?org=&project=&status=` | Takes a project key; loads that row, builds its JQL, fetches once. Returns `{ epics, jiraHost, project }`. 404 when the key is unknown or the list is empty. Defaults to the lowest `position` when `project` is absent. |
| `GET /api/jira-projects?org=` | Lists configured projects for the dropdown and Settings |
| `POST / PUT / DELETE /api/jira-projects[/id]` | `requireAdmin`; validation failures return 400 with the message |

Every handler stays wrapped in `withRequestLog()` — enforced by `logger-enforcement.test.ts`.

## UI

- `src/app/projects/projects-content.tsx` — a `Project` dropdown in the filter row backed by `useUrlState({ key: 'project' })`, so `?project=RND` is shareable and Back behaves. Tab labels and the column set follow the selected project's row. `tabCache` keys by tab + project rather than tab + team.
- `src/app/settings/` — a new Projects tab, admin-only, mirroring the Teams tab's shape. The Board section added to the Teams tab in the superseded revision is removed.
- `src/app/projects/page.tsx` and `src/app/settings/page.tsx` may export **only** `default`; helpers go in sibling modules.

## Scope: untracked work

The "work outside projects" block computes untracked commits against `JIRA_PROJECTS_JQL` directly, with its own 90-day windows and caching. It stays as-is and renders **only** when the selected project matches the key that env var names; otherwise it is hidden. `JIRA_PROJECTS_JQL` therefore survives as untracked-work's configuration rather than disappearing entirely. Repointing it per project is a follow-up ticket.

## Testing

- **Pin SPS's tabs.** An assertion that the active tab resolves to `status = "In Progress"` and *not* `statusCategory`. This is the 46-vs-71 regression and the single most likely mistake this redesign could reintroduce.
- Generated JQL per tab, including the two-tab case when `middle_status` is blank.
- `jira_projects` CRUD round-trips through both dialects; validation rejects bad keys and quote-bearing status names; the API returns 400 with the message.
- Self-migration seeds correctly from a well-formed `JIRA_PROJECTS_JQL` and leaves the table empty on a malformed one.
- Attribution is assignee-only; an unmapped assignee yields `team: null`.
- `ProgressRing` renders two arcs unconditionally; no `mode` prop exists.
- Existing guards stay green: MySQL charset, logger enforcement.
- Tests live flat in `src/lib/__tests__/unit/` (Jest `roots: ['<rootDir>/src/lib']`); component tests need a `/** @jest-environment jsdom */` docblock; `@testing-library/jest-dom` is **not** installed.

**Live verification after implementation:** SPS In Progress must still return **46** epics against real Jira, and RND's three tabs must return 13 / 50 / 5.

## Risks and open questions

1. **Ben has still not confirmed the mockup**, and it now shows a superseded design. It needs regenerating before he sees it — in particular the rings, which no longer have a Jira-only mode.
2. **Ben's two-week request has no Settings-level answer any more.** The Done window is fixed at 30 days; giving him 14 becomes a code change. This is a step back from the superseded design and should be raised with him.
3. **Roughly a third of the implemented branch comes back out** — `ringMode`, `doneWindowDays`, `includeRejected`, provenance, source merging, and the Teams Board section. The plan should treat these as deletions with their tests, not as edits.
4. **The em-dash consequence** is visible on RND today, where those rows currently show a `Research` chip. Anyone who has seen the running board will notice the regression.
5. `active_status` and `middle_status` are free text. A typo yields an empty tab with no error, since Jira happily returns zero results for a status that does not exist. Validating against the project's real statuses via `/rest/api/3/project/{key}/statuses` would prevent it; deferred as scope.

## Environment note

While this spec was being written, the macOS sandbox transiently revoked the shell's read access to the repository — `head package.json` returned `Operation not permitted` and `git` reported `Unable to read current working directory`, while the editor tools kept working. It recovered on its own a few minutes later. The same interference is the likely source of the `" 2.md"` / `" 3.md"` duplicate files littering `docs/superpowers/` and `src/lib/__tests__/unit/`, and of `git status` being slow enough to hang where targeted commands like `git rev-parse` return instantly. Worth recognising rather than debugging from scratch next time it happens.
