# GLOOK-64 — Security page redesign: per-repository view for team leads — Design

## Goal

A team lead can see every repository their team owns that has open critical or high Dependabot alerts, with counts per repository, and open one repository's alerts. To get there, the Security page (`/vulnerabilities`) is rebuilt to an approved high-fidelity design (v7). That design also brings the page in line with the look of the rest of Glooker.

The design handoff (HTML prototype, README, states sheet) is kept outside this repository. It contains example policy values, and this repository is public. This spec restates everything an implementer needs from it.

## Decisions

These were settled during design review (2026-10-07):

1. **Scope is the full redesign**, not only a repository table. A repository view bolted onto the old layout did not work.
2. **Counting rules are unchanged.** An unmeasured repository's stored alerts still count in team rows, totals, % closed and the trend. Its open count is shown as unknown, never as zero.
3. **High overdue appears only while a high SLA policy is active**, and then everywhere critical overdue appears. This is today's rule, applied consistently.
4. **`src/app/themes.ts` is not changed.** The design's colour roles map onto existing theme values. Only colours the app lacks are added.
5. **A per-repository MCP tool is in scope.** It reuses the same backend function as the page.
6. **No internal details** in code, tests, fixtures, docs, specs, plans or commit messages. Use invented names (`acme/checkout-api`, "Payments") and the synthetic policy from `npm run dev:mock`.

## Guardrails (unchanged from GLOOK-43)

- The repository `team` custom property ("Owning team") is never joined to Glooker's people-based `teams`.
- History comes only from stored measurements (`vulnerability_repo_snapshots`). It is never reconstructed from alert timestamps.
- Sync semantics are untouched: two-phase sync, `missing_since`, the completeness guard and `withheld_since`.
- The page and the MCP tools read the same functions in `queries.ts`, so they can never disagree.

## What the page does (v7)

The page has two views that share one sticky filter bar. Both views and all filters live in the URL, so a team lead can bookmark "Alerts · Payments".

- **Header card** (the existing `PageHeader`):
  - the title, plus a meta line: codebase · production repositories · owning teams;
  - the stale-sync warning and the failed-sync banner;
  - a coverage line: unmeasured badge, excluded count, needs-tagging count, and a "Coverage & policy →" link. The line has a minimum height of 22px, so it doesn't shrink when the badge disappears;
  - a "Sync history" action.
- **Sticky bar:**
  - view tabs: Overview, and Alerts with its open count;
  - filters: Codebase (each option shows its open count), Owning team, Severity (Critical + high / Critical only / High only), Compare to (Last sync / 7 days / 30 days / A date…);
  - a non-default filter gets the accent treatment, and "Reset filters" appears only when a filter differs from its default.
- **Overview:**
  - KPI tiles: open alerts with a change sentence and a sparkline; new / resolved / reopened since the baseline; resolved with % closed; SLA overdue and due ≤ 7d per severity;
  - an ownership card with an Owning teams tab and a Repositories tab;
  - the trend chart.
- **Alerts:**
  - a summary strip for the current scope;
  - a card with a 260px repository rail and the alert list, paged 10 rows at a time.
- **Coverage & policy drawer:** unmeasured, needs-tagging and excluded repositories, plus the policy.

### Interactions

| Action | Result |
|---|---|
| Click a team row | Sets Owning team, stays on Overview and switches the card to Repositories. Clicking the selected row again clears it. |
| Click a repository row | Switches to Alerts with that repository selected. |
| Click an unmeasured row or badge | Opens the drawer. |
| Change a filter | Never switches view. If the selected repository falls outside the new codebase or team scope, it is cleared. |
| Change a list filter (search, status, toggles, sort) | Applies only to the alert list and resets it to page 1. |

### States the implementation must cover

- **SLA policy per severity:** active, pending ("Starts {date}"), none ("No SLA policy yet"), invalid ("SLA policy can't be read", in red). Each state appears on the SLA tile, the strip, the rail and the overdue columns. An overdue column exists only while its severity's policy is active.
- **History:** a sparkline with 0, 1 or ≥2 measurements ("No measurements yet", "Not enough history yet" with "1 measurement so far ({date})", or a line), and the trend's short-history note.
- **Baseline:** "No earlier measurement yet" or "No measurement on or before {date}" when the baseline set doesn't exist or doesn't cover the view.
- **Resolved-count start date unset:** "N dismissed · all time".
- **Hidden severity:** "–" in its columns, including the Total row. It is left out of the sums, and its headers dim to 35% opacity.
- **Repositories with no open alerts:** listed and greyed, both in the rail and in the Repositories tab.
- **Unmeasured repositories:** listed last as a hatched band reading "▲ UNMEASURED · {reason} — alert counts unknown, not zero". The footer note reads "N unmeasured: open counts unknown".
- **More than 12 owning teams:** the top 12 by open count get distinct colours from the existing palette; the rest share one grey "Other · N teams" legend entry.

### Fixes beyond the handoff

These three come from the design review:

1. **The rail footer's SLA explanation wraps to a second line** instead of truncating.
2. **"Nd OVERDUE" in the Due column isn't clipped at 1024px.**
3. **Long owning-team names in the Repositories tab end in an ellipsis** instead of being cut mid-word.

## Architecture

### 1. Data layer (`src/lib/vulnerabilities/aggregate.ts`)

**`computeRepoRows(alerts, repos, { codebase, team?, now })` is new.** It is a pure function built on the same `viewRepos`, `isOpen` and `computeDue` as `computePivot`. It returns one row per in-scope repository in view, including those with no open alerts:

```ts
interface RepoRow {
  fullName: string; team: string; codebaseGroup: CodebaseGroup;
  critical: { open: number; overdue: number | null; dueSoon: number | null };
  high:     { open: number; overdue: number | null; dueSoon: number | null };
  oldestOpenDays: number | null;            // max age of open alerts
  nextDue: { date: string; daysRemaining: number } | null; // earliest due ≥ 0 days out
  unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null;
}
```

- Per severity, `overdue` and `dueSoon` are `null` while that severity's SLA policy isn't active, using the same `finish()` rule as the pivot.
- **The invariant:** for any filters, the sum of a team's repository rows equals that team's pivot row for open, overdue and due-soon. A unit test asserts this over the mock fixtures and several filter combinations.

**`computeCodebaseCounts(alerts, repos, { team?, now })` is new.** It returns open critical and high per codebase group, for the Codebase select.

**`AlertRow.lastReopenedAt` is new.** It is already on `AlertFact`, and the list needs it for "↺ reopened {date}".

**`pickBaseline` gains a view filter.** Today it picks the latest snapshot set on or before the point, and only then does `computeDelta` reject a set that doesn't measure the view. Imported CSV sets measure Backend critical only, and the importer is external, so a CSV set dated after the first sync can't be ruled out. Such a set would hide an earlier sync that did measure the view. The fix is for the picker to consider only sets that measure the requested codebase and severity, so "on or before" means "latest measurement of this view".

**"All codebases" history needs no change.** Every sync stores one snapshot row per repository across all codebases, and `setMeasures` already excludes CSV sets from every view except Backend critical. So the "All" view's history is exactly the sync dates.

### 2. Queries and API

| Function (`queries.ts`) | Route | Change |
|---|---|---|
| `getRepos(f)` | `GET /api/vulnerabilities/repos` (new, wrapped in `withRequestLog`) | Returns `{ rows: RepoRow[], sync, configErrors }` for `codebase` and `team`. Rows carry both severities; the page applies the Severity filter as "–" columns. |
| `getSummary(f)` | existing | Adds `codebaseCounts` |
| `getAlerts(f)` | existing | Adds `offset` and `sort` (field plus direction), sorted server-side before slicing. `totalCount` stays exact. |

**Why the alert list pages on the server.** Resolved alerts are never deleted, so "Resolved" and "Open + resolved" will exceed the 500-row cap over time. Client-side paging would then silently misorder rows.

**Why `getRepos` is a separate route, not a summary field.** It keeps the MCP summary payload small. Both routes read the same facts cache, which is keyed by the latest sync, so they agree between syncs.

`parseVulnFilters` accepts `offset` and `sort` and validates them, as it does for every other parameter.

### 3. MCP

A new tool, `list_vulnerability_repos`, uses `vulnCall(a, f => getRepos(f))`.

- **Inputs:** `codebase` and `team`, from `VULN_FILTER_PROPS`.
- **Output:** the repository rows in snake_case.
- **Description:** it follows the `VULN_COMMON` conventions. It also states that a row with `unmeasured` set has unknown open counts, and that `overdue: null` means that severity's SLA isn't active.

`list_vulnerabilities` documents its new `offset` and `sort` inputs.

### 4. Page (`src/app/vulnerabilities/`)

The new components are page-local. `page.tsx` keeps exporting only its default, per the root `CLAUDE.md`. Other pages' inline tabs and modals are not refactored.

- **Shell:** `filter-bar.tsx` (sticky), `view-tabs.tsx`, `coverage-drawer.tsx` (Esc and backdrop close it), `pager.tsx`.
- **Overview:** `kpi-tiles.tsx`, `ownership-card.tsx` (team table and repository table), `trend-card.tsx`.
- **Alerts:** `alerts-strip.tsx`, `repo-rail.tsx`, and the alert list, which reworks `alerts-table.tsx`.
- **Header:** the existing `PageHeader`, using its `meta` and `actions` slots.

### 5. URL state (`src/lib/url-state.ts`)

| Key | Values | Default | Note |
|---|---|---|---|
| `view` | overview, alerts | overview | new |
| `own` | teams, repos | teams | new |
| `codebase` | as today | backend | unchanged |
| `team` | string | none | unchanged |
| `repo` | org/name | none | new; moves from local state |
| `severity` | both, critical, high | both | new key |
| `baseline` | last, 7d, 30d, YYYY-MM-DD | last | unchanged, so old links keep working |
| `range` | 30d, 90d, 1y, all | all | unchanged |
| list filters | status, overdue, dueSoon, reopened, runtime, q, sort, page | as in v7 | new |

- **`sev` is retired.** It was the trend's own severity toggle, defaulting to critical. In v7 the trend follows the page-wide `severity`, so `sev` is ignored. A new key avoids changing what an old `?sev=critical` link means.
- **`url-state.ts` gains `boolean` and `number` types.** One click that changes view, team and repository goes through `useUrlBatch`.

### 6. Styling

- Surfaces and text use the Tailwind grey classes the rest of the app uses, so the existing `[data-theme-mode="light"]` remap in `globals.css` applies unchanged. Accent uses the existing `accent` utilities, and `--accent-fg` maps to `text-accent-light`.
- **New CSS variables**, each defined on `:root` and under `[data-theme-mode="light"]`:
  - `--warn`, `--warn-bg`, `--warn-line`: the muted amber for unmeasured and stale, distinct from the default amber accent;
  - `--crit-tint` and `--high-tint`: the column-group cell tints.
- Team lines keep the existing `--vuln-series-*` palette and `assignTeamColors`. Their contrast tests stay as they are.

## Testing

- **Unit tests:**
  - `computeRepoRows`: the sum invariant, unmeasured rows, zero-alert rows, the SLA-inactive nulls, `oldestOpenDays` and `nextDue`;
  - `computeCodebaseCounts`;
  - the `pickBaseline` view filter, including the CSV-after-sync case;
  - alert sort and offset, including a total above 500;
  - `parseVulnFilters` for the new parameters;
  - the URL-state boolean and number types.
- **API and MCP:**
  - the repos route returns rows, and `logger-enforcement.test.ts` passes;
  - `list_vulnerability_repos` returns snake_case rows and `available: false` when the feature is off.
- **jsdom component tests:**
  - layout stability: KPI row, ownership body, strip and alerts card heights constant across filter changes;
  - the four SLA states;
  - hidden severity;
  - unmeasured band text;
  - interactions from the table above;
  - the three fixes beyond the handoff.
- **Existing tests:** suites that pin the old page's sizes and structure are rewritten for the new layout, not deleted without replacement.
- **Guards:** `grep` the diff for internal names before every commit.

## Documentation

- **`docs/vulnerabilities-page.md` is rewritten** for the new page: what it shows, interactions, URL keys, layout stability, the repository rows and their invariant, and the MCP tool. The counting rules section keeps its rules and gains `computeRepoRows`.
- **`CLAUDE.md`:** the vulnerability entry mentions `computeRepoRows` and the sum invariant.
- **`scripts/seed-data.ts` and `scripts/mock-identities.ts`:** extended if the mock needs a zero-alert repository or more owning teams to exercise the states above.

## Out of scope

- Changes to `themes.ts` or to other pages' components.
- Light-theme contrast fixes. They have their own ticket.
- Sync Stop, and any change to sync behaviour.

## Definition of done

- Every item in GLOOK-64's definition of done holds.
- The page matches v7 at 1440px and 1024px, in the default dark theme and one light theme, with the three fixes beyond the handoff.
- Repository rows sum to team rows for every filter combination tested.
- The MCP tool returns the same figures as the page.
- The full Jest suite passes under Node 24, and `npm run build` succeeds.
