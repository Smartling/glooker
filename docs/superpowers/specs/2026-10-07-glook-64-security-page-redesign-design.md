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
7. **Delta and baseline logic stay exactly as today.** The page does not change how a baseline is picked (see "Out of scope" for why no change is needed).

## Guardrails (unchanged from GLOOK-43)

- The repository `team` custom property ("Owning team") is never joined to Glooker's people-based `teams`.
- History comes only from stored measurements (`vulnerability_repo_snapshots`). It is never reconstructed from alert timestamps.
- Sync semantics are untouched: two-phase sync, `missing_since`, the completeness guard and `withheld_since`.
- The page and the MCP tools read the same functions in `queries.ts`, so they can never disagree.

## What the page does (v7)

The page has two views that share one sticky filter bar. Both views and the main filters live in the URL, so a team lead can bookmark "Alerts · Payments". The URL keys are listed under "URL state".

- **Header card** (the existing `PageHeader`, unchanged):
  - the title, plus a meta line: codebase · N {scope value} repositories · N owning teams (for example "Backend · 11 production repositories · 4 owning teams" under the default scope). The scope label comes from `summary.scope.value`, never from a literal. The line does not say "synced daily";
  - the stale tag ("▲ STALE · 42H") and the failed-sync banner with its "!" icon;
  - a coverage line: unmeasured badge, excluded count, needs-tagging count, and a "Coverage & policy →" link. The line has a minimum height of 22px, so it doesn't shrink when the badge disappears;
  - a "Sync history" action.
  - `PageHeader` and `DataFreshness` stay unchanged, because the org and team report pages use them. The stale tag, the banner and the coverage line are page-local elements passed as `PageHeader`'s `children`. The meta line cannot hold them, because `PageHeader` renders `meta` inside a `<p>`.
- **Sticky bar:**
  - view tabs: Overview, and Alerts with its open count under Severity, written "N open";
  - filters, each under a small uppercase caption: Codebase (each option shows its `kSev` open count with its unit), Owning team, Severity (Critical + high / Critical only / High only), Compare to (Last sync / 7 days ago / 30 days ago / A date…). "A date…" opens its date input pre-filled with a date;
  - a non-default filter gets the accent treatment, and "Reset filters" appears only when a filter differs from its default.
- **Overview:**
  - KPI tiles: open alerts with a change sentence and a sparkline; new / resolved / reopened since the baseline; resolved with % closed; SLA overdue and due ≤ 7d per severity;
  - an ownership card with an Owning teams tab and a Repositories tab;
  - the trend chart.
- **Alerts:**
  - a summary strip for the current scope: the scope label and title, a CRIT row and a HIGH row each reading "N open · {tail}" (the tail is "N overdue" while that SLA is active, otherwise its state message), and an unmeasured badge when no repository is selected;
  - a card with a 260px repository rail and the alert list, paged 10 rows at a time.
- **Coverage & policy drawer:** unmeasured, needs-tagging and excluded repositories, plus the policy.

### Severity on the page

The page never sends `severity=both` to the API. One rule decides which severity each element uses:

| Term | Meaning |
|---|---|
| `kSev` | `critical`, unless Severity is "High only", then `high`. |
| KPI tiles, sparkline, trend | Use `kSev`. They show one severity, never a sum of both. |
| Alert list, rail, summary strip, Alerts tab count | Follow Severity. "Critical + high" sends no `severity` parameter. |
| Codebase option counts | Use `kSev` and follow Owning team. The page computes them client-side from the per-severity counts in `codebaseCounts` and writes the unit: "Backend · 8 open crit", or "open high" under "High only". The count is the number the KPI tile beside the option shows. |

The old `?sev=` key is ignored. An old `?sev=high` link now shows critical. That is accepted.

### Interactions

| Action | Result |
|---|---|
| Click a team row | Sets Owning team, stays on Overview and switches the card to Repositories. Clicking the selected row again clears it. |
| Click a repository row | Switches to Alerts with that repository selected. It also sets Owning team to that repository's owning team (`Unassigned` is a valid team). |
| Click an unmeasured row or badge | Opens the drawer. |
| Change Codebase or Owning team | Never switches view. It clears the selected repository in the same URL write (see "Stale repository"). |
| Change another filter | Never switches view. |
| Change a list filter (search, status, toggles, sort, page) | Applies only to the alert list. |
| Change any list filter or any scope filter | Resets the alert list to page 1. |
| Click "Reset filters" | Resets Codebase, Owning team, Severity, Compare to and the selected repository. It never changes the view. |
| Switch view | Pushes a history entry. If the user has scrolled past the top of the view content, the page scrolls up just enough that the content starts right under the sticky bar. It never scrolls down. |

The rail's first row reads "All {team} repositories", or "All repositories" when no team is selected.

**Stale repository.** A selected repository can stop making sense: the URL is hand-edited, or the scope changed.

1. Every Codebase or Owning team setter writes `repo: null` in the same `useUrlBatch` call.
2. A `repo` that is absent from the loaded `getRepos` rows, or that the alerts API rejects ("unknown repo" or "repo not tracked"), shows an inline "Repository not found · Show all repositories" state inside the alerts card.
3. The page does not send that `repo` again, and it never raises the page-level error for it.
4. "Show all repositories" clears `repo`.

### States the implementation must cover

- **SLA policy per severity:** active, pending, none, invalid. Each state appears on the SLA tile, the strip, the rail and the overdue columns. An overdue column exists only while its severity's policy is active. The wording has one definition with two forms. Where the header already says SLA (the SLA tile): "Starts {date}", "No SLA policy yet", and for an invalid policy "! Policy error" (red; the title holds the full sentence). Where it does not (the strip tails, the rail footer, the Due column's sub-line, the toggle hint): "SLA starts {date}", "no SLA policy yet", "SLA policy can't be read" (red). The rail footer follows Severity and, while no SLA is active, names the state before "· no overdue counts".
- **Dates:** one rule writes every visible date: "Oct 4" within the current year, "Jan 8, 2020" in any other year, always from the UTC date. The ISO form appears only in `title` attributes.
- **History:** a sparkline with 0, 1 or ≥2 measurements ("No measurements yet", "Not enough history yet" with "1 measurement so far ({date})", or a line), and the trend's short-history note.
- **Baseline:** "No earlier measurement yet" or "No measurement on or before {date}" when the baseline set doesn't exist or doesn't cover the view.
- **Resolved-count start date unset:** "N dismissed · all time".
- **Hidden severity:** "–" in its columns, including the Total row. It is left out of the sums, and its headers dim to 35% opacity. The SLA tile and the strip keep the row and dim it to 35%.
- **Repositories with no open alerts:** listed and greyed, both in the rail and in the Repositories tab.
- **Unmeasured repositories:** listed last as a hatched band reading "▲ UNMEASURED · {reason} — alert counts unknown, not zero". The UI renders their open count as unknown, although the API carries the stored count. Every total that counts alerts includes the stored counts of unmeasured repositories, the Repositories footer's open and overdue sums among them, so the footer agrees with the team table, the strip, the rail and the Alerts tab; only an unmeasured row's own cells read unknown. The footer's repository count, Oldest open and Next due use the measured rows only. The footer note reads "N unmeasured: totals include stored counts".
- **More than 12 owning teams:** the top 12 by open count get distinct colours from the existing palette; the rest share one grey "Other · N teams" legend entry.
- **Unknown team in the URL:** the page shows the recovery action "Clear team filter".
- **Summary request fails:** the page shows a full-page error, never half a page of stale numbers.

### Fixes beyond the handoff

These three come from the design review:

1. **The rail footer's SLA explanation wraps to a second line** instead of truncating.
2. **"Nd OVERDUE" in the Due column isn't clipped at 1024px.**
3. **Long owning-team names in the Repositories tab end in an ellipsis** instead of being cut mid-word.

### Dimensions and typography

| Element | Value |
|---|---|
| Page container | max width 1280px; padding 32 / 24 / 40; gap 24 |
| KPI tile row | 178px |
| Ownership card body | 330px. The tables scroll inside it; the header row and the Total row stay pinned. |
| Team table rows | 50px |
| Alerts summary strip | 72px |
| Alerts card | 776px |
| Alert rows | 56px, 10 per page, so the list area is 560px |
| Repository rail width | 260px |
| Trend plot | 220px |
| Sparkline slot | 24px |
| Drawer | 460px wide, at most 92% of the viewport |
| Header coverage line | minimum height 22px |
| Title | 24px, weight 700 |
| KPI value | 22px, weight 700 |
| Section labels | 12px, weight 600, uppercase, letter-spacing 0.08em |
| Table headers | 11px, weight 600, uppercase, letter-spacing 0.06em |
| Body text | 14px; secondary text 12–13px |
| Radii | cards 12px, controls 6px, badges 3–4px |

Rules that keep the layout still:

- The selects have fixed widths: Codebase 220px, Owning team 170px, Severity 140px, Compare to 118px, date input 128px. Each is `shrink-0`, and long text truncates with a `title` attribute.
- The bar reserves slots for "Reset filters" and the date input, so its height never changes.
- A filter change never moves a control. The header coverage line always renders the unmeasured badge's slot (a reserved width, hidden when the count is zero) and fixed-width count slots. The ownership card's tab counts have a minimum width. The Alerts strip's title column has a fixed width and its figures have minimum widths. One accepted exception: with an unreadable SLA policy at 1024px and the unmeasured badge showing, the strip's two state messages truncate with "…" and show the full text on hover.
- There is no horizontal scroll at 1024px. Grid tracks use `minmax(0, …)`, and long text ends in "…".
- Below 1024px the cards scroll inside themselves. The page is not designed for narrower screens.

### Columns and sorting

Bracketed columns exist only while that severity's SLA policy is active. "Next due" exists only while at least one policy is active.

| Table | Columns |
|---|---|
| Team table | Owning team \| CRITICAL group: Open, Change vs {baseline date} (or "No earlier measurement yet" / "No measurement on or before {date}" when there is no baseline), Resolved (dismissed), % closed, [Overdue] \| HIGH group: the same, with [Overdue] |
| Repositories table | Repository (codebase underneath) \| Owning team \| Open crit \| [Overdue crit] \| Open high \| [Overdue high] \| Oldest open \| [Next due] |
| Alert list | Sev \| Advisory (CVSS · package) \| Repository (owning team) \| Age \| Due \| State (scope) |

**Rail rows.**

- Each row shows the repository name, "N crit · N high open", and "N OVERDUE" on the right.
- "Owning team: X" appears only when no team filter is set.
- Order: overdue, then open critical, then open high.
- Zero-alert repositories are greyed. Unmeasured repositories come last, hatched.

**Sorting.**

- Click a header to sort. Each key starts in its natural direction: Age starts descending (oldest first), and every other key starts ascending. Click again to reverse. With no header active (`sort: null`), the alert list is in the server's default order. With no active header the list draws Due ascending; the first click on Due then sorts descending. Under Resolved nothing is drawn and Due starts ascending.
- Sortable headers show ↕. The active header shows ↑ or ↓ in the accent colour.
- The Total row and unmeasured rows ignore sorting.
- The Repositories tab has a name filter. Its footer reads "Matching" while the filter is in use.

**Pager.** The text reads "1–10 of N alerts · counted per Dependabot alert, not per CVE", with Previous, "Page X of Y" and Next.

### Carried over from today's page

| Behaviour | Decision |
|---|---|
| `†` marker on carried-resolved figures, and its footnote | Keep |
| Unknown-team recovery ("Clear team filter") | Keep |
| Full-page error when the summary fails | Keep |
| Config-error banner | Keep |
| Overdue and Due ≤ 7d are mutually exclusive | Keep |
| Resolved status disables and clears both time toggles | Keep |
| Both time toggles cleared when no SLA is active | Keep |
| Sanitise hand-edited filter combinations before the request | Keep |
| "other ±N" in the since-baseline tile and "N repos not in baseline" when non-zero | Keep |
| "+N open critical in other codebase types" | Drop. The Codebase options show those counts. |

## Architecture

### 1. Data layer (`src/lib/vulnerabilities/aggregate.ts`)

**One shared SLA gate.** `finish()` decides whether a severity's SLA is active with `slaStatus(sev, now) === 'active'`. That check is extracted into a small helper that `finish()` and `computeRepoRows` both call, so the two can never disagree.

**`computeRepoRows(alerts, repos, { codebase, team?, now })` is new.** It is a pure function built on the same `viewRepos`, `isOpen` and `computeDue` as `computePivot`. It returns one row per in-scope repository in view, including those with no open alerts. Archived repositories are excluded, so they contribute 0 to every invariant field.

```ts
interface RepoSevCell {
  open: number;
  overdue: number | null;          // null unless this severity's SLA is active
  dueSoon: number | null;          // null unless this severity's SLA is active
  oldestOpenDays: number | null;   // max age of open alerts; same age rule as toAlertRow (ageDays, UTC days, floor 0)
  nextDue: { date: string; daysRemaining: number } | null; // earliest due ≥ 0 days out; null unless SLA active
}
interface RepoRow {
  fullName: string; team: string; codebaseGroup: Exclude<CodebaseGroup, 'all'>;
  critical: RepoSevCell;
  high: RepoSevCell;
  unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null;
}
```

- The page combines "both severities" client-side, because the rows carry each severity separately.
- Resolved, dismissed, % closed and carried-resolved figures are deliberately not in repository rows.
- **Row order is fixed inside `computeRepoRows`:** measured rows by critical open descending, then high open descending, then `fullName`; then unmeasured rows by `fullName`.
- **Unmeasured rows carry their stored counts.** This keeps the invariant below true. The UI renders `open` as unknown. The MCP description says: "for a row with `unmeasured` set, `open` is the stored count and may be out of date".

**The invariant, stated exactly.** For any filters, per team and per severity:

1. The sum of the team's repository rows for `open`, `overdue` and `dueSoon` equals that team's pivot cell.
2. When a severity's SLA is inactive, `overdue` and `dueSoon` are null in both the rows and the pivot.
3. The number of the team's non-archived rows with `unmeasured` set equals the team's `unmeasuredRepos`.

**Tests for the invariant:**

- The invariant holds over the mock fixtures and several filter combinations.
- An independent cross-check: each repository's `open` equals the `totalCount` of `listAlerts({ state: 'open', repo })` for that repository. The fixtures include an unmeasured repository that has stored alerts.

**`computeCodebaseCounts(alerts, repos, { team?, now })` is new.**

- It returns `Record<CodebaseGroup, { critical: number; high: number }>`, including `all`.
- It ignores the `codebase` filter and honours `team`.
- A repository with a null codebase type counts under `other` and `all`.
- Test: `counts[c]` equals the pivot's total open for `codebase = c`.

**`computeCoverage` gains a `codebase` option.** It filters its three lists by codebase group. A null codebase type counts under Other and All. The header coverage line and the drawer read the same response.

**`AlertRow.lastReopenedAt: string | null` is new.** It is an ISO instant, already on `AlertFact`, and the list shows it as a UTC date in "↺ reopened {date}".

**Alert sort and offset (`listAlerts`).**

| Rule | Value |
|---|---|
| Sort keys (closed list, matching the alert-list columns) | `severity`, `advisory`, `repo`, `age`, `due`, `state` |
| Format | `sort=<key>:<asc\|desc>` |
| Nulls | Last in both directions |
| Tie-break, always applied last | repository full name, then alert number |
| No `sort` given | Today's order (soonest due, then severity, then newest), plus the tie-break |
| `offset` | Default 0; a non-negative integer |
| `offset` ≥ total | Empty `rows`, exact `totalCount` |
| `truncated` | `offset + rows.length < totalCount` |
| `limit` cap | 500, applied per page |

Sorting and slicing stay in memory in `listAlerts`. There is no SQL `LIMIT` or `OFFSET`, because of the MySQL binding pitfall. The `repos` facet stays for MCP and is not affected by `offset` or `sort`.

**Why the alert list pages on the server.** Resolved alerts are never deleted, so "Resolved" and "Open + resolved" will exceed the 500-row cap over time. Client-side paging would then silently misorder rows.

**"All codebases" history needs no change.** Every sync stores one snapshot row per repository across all codebases, and `setMeasures` already excludes CSV sets from every view except Backend critical. So the "All" view's history is exactly the sync dates.

### 2. Queries and API

| Function (`queries.ts`) | Route | Change |
|---|---|---|
| `getRepos(f)` | `GET /api/vulnerabilities/repos` (new, wrapped in `withRequestLog`) | New. See the envelope below. |
| `getSummary(f)` | existing | Adds `codebaseCounts` |
| `getAlerts(f)` | existing | Adds `offset` and `sort`. Both join `ALERT_FILTER_KEYS`, so they appear in `appliedFilters`. |
| `getCoverage(f)` | `/coverage` (existing) | Adds `codebase` to its inputs and to `appliedFilters`. Coverage defaults to `backend` like every other route; `codebase=all` restores the previous all-codebases result. |

**`getRepos` envelope.** It matches the other envelopes:

```ts
{ available: true, sync, appliedFilters: pickApplied(f, ['codebase', 'team']), configErrors, rows: RepoRow[] }
```

- The route uses `withFilters`, so it returns 404 when the feature is off.
- `prepare()` validates the team. An unknown team returns 400 with the known teams.
- It uses `codebase` and `team`. The shared parser validates every other parameter (a bad value is a 400) and then ignores it.
- It returns every row. The page needs all of them, so `limit` does not apply to the HTTP route.

`parseVulnFilters` accepts `offset` and `sort` and validates them, as it does for every other parameter.

**Why `getRepos` is a separate route, not a summary field.** It keeps the MCP summary payload small. Both routes read the same facts cache, which is keyed by the latest sync, so they agree between syncs.

### 3. MCP

A new tool, `list_vulnerability_repos`, uses `vulnCall(a, f => getRepos(f))`.

- **Inputs:** `codebase` and `team`, from `VULN_FILTER_PROPS`, plus `limit` (default 100, max 500) and `offset` (rows to skip, default 0). `truncated` is `offset + rows < total_count`, the same rule as `list_vulnerabilities`.
- **Output:** the repository rows in snake_case, `total_count` and `truncated`. `applied_filters` echoes the `limit` and `offset` applied (MCP only; the HTTP envelope is unchanged).
- **Description:** it follows the `VULN_COMMON` conventions. It also states that:
  - a row with `unmeasured` set has `open` equal to the stored count, which may be out of date;
  - `overdue: null` means that severity's SLA isn't active;
  - the difference from `list_vulnerabilities`: its `repos` facet follows all list filters, while these rows give open counts per repository.
- `list_vulnerabilities` documents its new `offset` and `sort` inputs. Its description states the same difference from the new tool.
- `get_vulnerability_coverage` gains `codebase` in its inputs and description. Coverage defaults to `backend` like every other route; `codebase=all` restores the previous all-codebases result.

### 4. Page (`src/app/vulnerabilities/`)

The new components are page-local. `page.tsx` keeps exporting only its default, per the root `CLAUDE.md`. Other pages' inline tabs and modals are not refactored.

| Module | Role |
|---|---|
| `security-state.ts` | The URL schemas as exported consts, `kSev`, the clearing handlers, and the rules that sanitise hand-edited combinations |
| `use-security-data.ts` | Every SWR key, in one place |
| `vulnerabilities-content.tsx` | A thin composer of the modules below |
| `filter-bar.tsx`, `view-tabs.tsx`, `pager.tsx` | The sticky shell |
| `coverage-drawer.tsx` | The drawer |
| `kpi-tiles.tsx`, `sparkline.tsx` | Overview tiles |
| `ownership-card.tsx` | Team table and repository table |
| `trend-card.tsx` | The trend chart |
| `alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx` | The Alerts view |
| Header | The existing `PageHeader`, with page-local children (see "What the page does") |

**Old to new files.** The old modules are replaced, not patched:

| Old | Replacement |
|---|---|
| `team-pivot.tsx` | `ownership-card.tsx` |
| `coverage-panel.tsx`, `policy-panel.tsx` | `coverage-drawer.tsx` |
| `alerts-table.tsx` | `alert-list.tsx` |
| `trend-chart.tsx` | `trend-card.tsx` |

`team-colors.ts` and `format.ts` stay.

**Data flow.** Every SWR key uses `keepPreviousData`.

| Element | Request | Parameters |
|---|---|---|
| KPI tiles, SLA tile, Codebase options | `summary` | `codebase`, `team`, `baseline` |
| Header meta line | `repos` rows, plus `summary.scope.value` | `codebase` only, never `team`. The repository count and the number of distinct owning teams (Unassigned counts as one) come from the rows; the scope label comes from `summary.scope.value`. The line describes the codebase, so choosing an owning team does not change it. With no team selected the request is the same as the Repositories tab's and dedupes to one. |
| Header coverage line | `coverage` | `codebase`, `team` |
| Team table | `summary` (a second key) | `codebase`, `baseline`. It is never scoped to the team, so every team stays listed. |
| Sparkline | `trend` (its own key) | `codebase`, `severity=kSev`, `since` fixed at 90 days back. No `team`. |
| Repositories tab and rail | `repos` | `codebase`, `team` |
| Alerts strip | `repos` rows | Computed from the rows for the current scope (the selected repository, if any). It does not read the list response. |
| Alerts tab count | `repos` rows | Sum of open counts under Severity for the current scope |
| Alert list | `alerts` | `codebase`, `team`, `repo`, `severity` (omitted for both), list filters, `limit=10`, `offset`, `sort` |
| Trend | `trend` | `codebase`, `severity=kSev`, `since` from `range`. No `team`. |
| Drawer | `coverage` and `summary` | The same responses as the header coverage line and the KPI tiles |

- The sparkline sums the unscoped trend series for `kSev` per stored measurement date. When an owning team is selected, it sums only that team's series, so the line matches the KPI count beside it.
- The trend filters by team client-side over the unscoped series.
- **Known limitation.** The Overview's two requests (summary and repos) can briefly disagree if a sync lands between them. The page refetches both when the sync time changes.

**Sticky bar.**

- Its background is `var(--body-bg, #0F0F0F)`.
- Its z-index is above the tables' pinned rows and below the drawer.
- It is a sibling of the view content inside the page container, and no ancestor sets `overflow`, so `position: sticky` works.

**Drawer.**

- It has `role="dialog"` and `aria-modal="true"`, and its title labels it.
- Opening it focuses the close button, and focus stays inside while it is open.
- Esc closes it. The Esc listener exists only while the drawer is open. The backdrop and the × also close it.
- Closing returns focus to the element that opened it.
- Its z-index is above the sticky bar.
- Its open state is local, not in the URL.
- It follows the Codebase and Owning team filters. A subtitle says what it follows ("{Codebase} · Owning team: {team or all} · follows the page filters"). It groups gaps as Unmeasured (hatched rows, open counts unknown; their resolved alerts and measured history still count), Needs tagging (counted under "Unassigned") and Excluded by policy (not counted). Each group header shows its repository count and a right-aligned summary ("open counts unknown", "N open critical"), and each row gives its reason (the unmeasured reason, the missing tags, "outside scope ({tier})"). The policy section, "From deployment configuration", has four labelled rows and shows no entry ids: Critical SLA and High SLA ("N days · since {date}", "N days · starts {date}", "No SLA policy yet", or in red "! Can't be read · check the SLA settings in the deployment config"), Resolved count ("Since {date} · fixed + dismissed" or "All time · fixed + dismissed") and Scope ("{property} = {value}").

**Trend.**

- Points are placed by their actual date.
- The All range runs from the first point to today, and spans at least 7 days.
- With fewer than 2 points, the chart shows a message. A short history shows a note.
- The plot is 220px tall.
- The legend always lists every owning team, so its height never changes: the top 12 each show "N open", then one "Other · N teams" entry whose tooltip lists the names.
- A selected team draws only its own line, and the other legend entries dim to 0.4 opacity.
- Title: "Open {kSev} alerts by owning team". Range select: All time (default) / Last year / Last 90 days / Last 30 days.
- Footnote: "Each dot is one stored measurement (an imported CSV run or a sync)."

### 5. URL state (`src/lib/url-state.ts`)

| Key | Values | Default | History |
|---|---|---|---|
| `view` | overview, alerts | overview | push |
| `own` | teams, repos | teams | push |
| `codebase` | as today | backend | replace |
| `team` | string | none | replace |
| `repo` | org/name | none | replace |
| `severity` | both, critical, high | both | replace |
| `baseline` | last, 7d, 30d, YYYY-MM-DD | last | replace |
| `range` | 30d, 90d, 1y, all | all | replace |

- Every key is declared with `scroll: false`.
- Page number, the list filters (status, overdue, dueSoon, reopened, runtime, search), the table sorts and the name searches stay local state, not URL.
- `url-state.ts` needs no new types.
- `useUrlBatch` pushes when any key in the batch is declared `push`. A team-row or repository-row click writes `own` or `view` in its batch, so it pushes a history entry and Back returns to Overview. Every other change replaces.
- `sev` is retired. It was the trend's own severity toggle, defaulting to critical. In v7 the trend follows the page-wide Severity, so `sev` is ignored. A new key avoids changing what an old `?sev=critical` link means.

### 6. Styling

- Surfaces and text use the Tailwind grey classes the rest of the app uses, so the existing `[data-theme-mode="light"]` remap in `globals.css` applies unchanged.
- **Light-theme caution.** The light remap gives `.bg-gray-900` a 1px border and a shadow.
  - Use `bg-gray-900` for card shells only.
  - Pinned headers, Total rows, rail rows, alert rows and drawer rows use `bg-chart-surface` or a plain `var()`, with no border, so the fixed heights hold in light mode.
- Opacity values use arbitrary classes (`opacity-[0.35]`) or inline style. No class name is built dynamically, because Tailwind would not generate it.
- Team lines keep the existing `--vuln-series-*` palette and `assignTeamColors`. Their contrast tests stay as they are.

**Design token to class mapping.**

| Design token | Implementation |
|---|---|
| crit | `text-red-400` |
| high | `text-orange-400` |
| good | `text-green-400` |
| grid | `--chart-grid` |
| crit-bg, high-bg | the new `--crit-tint` and `--high-tint` |
| accent-fg | `text-accent-light` |

**New CSS variables.** Each is defined on `:root` and under `[data-theme-mode="light"]`:

| Variable | Dark | Light |
|---|---|---|
| `--warn` (muted amber for unmeasured and stale) | `#d29922` | `#8f5f00` |
| `--warn-bg` | `rgba(210,153,34,.11)` | `#fbefc6` |
| `--warn-line` | `rgba(210,153,34,.45)` | `rgba(154,103,0,.32)` |
| `--crit-tint` (critical column wash) | `rgba(239,68,68,.045)` | `#fef7f7` |
| `--high-tint` (high column wash) | `rgba(251,146,60,.04)` | `#fffaf5` |

A new test checks that `--warn` text meets 4.5:1 contrast on `--warn-bg` and on the body backgrounds, in each theme mode. It follows the pattern of `vuln-series-contrast.test.ts`. The handoff's light value `#9a6700` measured 4.23:1 on `--warn-bg` (`#fbefc6`), below the 4.5:1 floor, so the light `--warn` is darkened to `#8f5f00` (4.80:1).

## Testing

jsdom cannot measure layout, so the layout work has two kinds of check.

- **Unit tests:**
  - `computeRepoRows`: the invariant and its independent cross-check (see "Data layer"), unmeasured rows with stored alerts, zero-alert rows, archived exclusion, the SLA-inactive nulls, `oldestOpenDays`, `nextDue` and the fixed row order;
  - `computeCodebaseCounts` and the `codebase` option of `computeCoverage`;
  - alert sort and offset: no duplicate or skipped rows across pages with tied due dates and a total above 500, nulls last in both directions, `offset` ≥ total;
  - `parseVulnFilters` for `offset` and `sort`;
  - the `--warn` contrast test.
- **API and MCP:**
  - the repos route returns the envelope, returns 404 when the feature is off, and returns 400 with known teams for an unknown team; `logger-enforcement.test.ts` passes;
  - `list_vulnerability_repos` returns snake_case rows, `total_count`, `truncated` and `available: false` when the feature is off;
  - the exact tool-name lists in `mcp-tools.test.ts` and `vuln-mcp.test.ts` are updated for the new tool.
- **jsdom component tests:**
  - the exported height constants are applied as inline styles in every branch: loading, error, empty and populated;
  - the four SLA states, hidden severity and the unmeasured band text;
  - the interactions table, including the stale `repo` state and the drawer's focus and Esc behaviour;
  - the three fixes beyond the handoff.
- **Chart guards:** the new chart modules (`trend-card.tsx`, `sparkline.tsx`) replace `trend-chart.tsx` in `chart-no-literal-colors.test.ts` (the `EXTRA` list and the exact-list assertion) and in `chart-tokens-css.test.ts` (`REFERENCING_FILES`).
- **Headless-Chrome measurement.** Each implementation wave also runs a measurement at 1024px and 1440px, in dark and light. It checks layout shift, element heights, control positions and the absence of horizontal scroll. The harness stays outside the repository, as today.
- **Existing tests:** suites that pin the old page's sizes and structure are rewritten to keep each test's intent, not deleted without replacement. The per-test map belongs to the implementation plan.
- **Guards:** `grep` the diff for internal names before every commit.

## Documentation

`docs/vulnerabilities-page.md` and `CLAUDE.md` are updated in Wave 5, once the page exists.

- **`docs/vulnerabilities-page.md` is rewritten** for the new page: what it shows, interactions, URL keys, layout stability, the repository rows and their invariant, and the MCP tool. The counting rules section keeps its rules and gains `computeRepoRows`.
- **`CLAUDE.md`:** the vulnerability entry mentions `computeRepoRows` and the sum invariant.
- **`scripts/seed-data.ts` and `scripts/mock-identities.ts`:** extended if the mock needs a zero-alert repository, an unmeasured repository with stored alerts, or more owning teams to exercise the states above.

## Out of scope

- Changes to `themes.ts` or to other pages' components.
- Light-theme contrast fixes beyond the new tokens. They have their own ticket.
- Sync Stop, and any change to sync behaviour.
- **Baseline picking is unchanged.** The baseline picker would only misbehave if an imported CSV set were dated after a sync. CSV import was a one-time backfill of history from before the first sync, and no further imports will happen, so that case cannot arise.

## Definition of done

- A team lead can see every repository their team owns that has open critical or high alerts, with counts per repository, and can open one repository's alerts.
- The page matches v7 at 1440px and 1024px, in the default dark theme and one light theme, with the three fixes beyond the handoff.
- There is no horizontal scroll at 1024px, and the fixed heights hold in the headless run in dark and light.
- Repository rows sum to team rows for every filter combination tested.
- The MCP tool returns the same figures as the page.
- The full Jest suite passes, and `npm run build` succeeds.
