# Vulnerabilities Page — Technical Reference

This document describes the `/vulnerabilities` page and the `src/lib/vulnerabilities/` module (GLOOK-43, redesigned in GLOOK-64) for AI coding assistants working on the codebase.

## Overview

The Vulnerabilities page ("Security") tracks critical and high Dependabot alerts across every in-scope repo in a GitHub org — a repo whose configured tier property equals the configured in-scope value (`service_tier = production` by default; see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration) below). Before this feature, per-team counts came from an existing manual process with no per-alert history. It stores one row per alert (never deleted) plus a per-repo snapshot on every sync, so every number is traceable to an alert, and reopened alerts are detected instead of silently vanishing from "resolved" counts. A repo archived after its first sync keeps its history this way automatically; a repo archived before its first sync has no stored alerts at all, so its resolved count is carried over from imported CSV history that is already stored (below).

The page answers two questions. A security lead asks how each owning team is doing (Overview). A team lead asks which of their repositories have open critical or high alerts, and what those alerts are (Alerts).

It is a standalone module with no coupling to `reports`/`schedules` — see the root `CLAUDE.md` architectural-decisions entry for why (Approach B, extending the report pipeline, was rejected: dozens of `FROM reports` queries across the codebase would need a `report_type` discriminator).

## What it shows

The page is one header card, one sticky filter bar and two views (Overview and Alerts) that share the bar's filters. Everything the page shows is either an alert, a repository row or a stored measurement.

### The header card

1. **Title and meta line** — `Security · {org}`, then a line such as "Backend · 11 production repositories · 4 owning teams · synced daily". The closing "synced daily" is the design's wording and a literal: it is true while the sync schedule (Settings, Schedules) is daily, and says so even if an operator changes it. The repository count and the number of distinct owning teams (Unassigned counts as one) come from the `repos` rows requested with `codebase` only, never `team`, so the line describes the codebase and does not change when an owning team is chosen (with no team selected it is the same request as the Repositories tab and dedupes to one); the scope word ("production") comes from `summary.scope.value`, never from a literal. The header uses the shared `PageHeader` and `DataFreshness` components, which the org and team report pages also use, so it adds its own elements as `PageHeader` children instead of changing them.
2. **Freshness and links** — "last successful sync …", turned amber while the data is stale, with the "▲ STALE · NH" tag beside it on the same row (`PageHeader`'s `badges` slot, so the stale line takes one row, not two), an "Updating…" badge while the summary reloads, and a "Sync history" button (the app's secondary button) to the sync history tab.
3. **Stale tag and failed-sync banner** — the "▲ STALE · 42H" tag (on the freshness row, above) shows when the data is stale (more than 36 hours since the last `succeeded`/`partial` run). When the latest run failed, a banner with a filled red "!" disc reads "The latest sync failed; showing data from the last good sync." and appends the first issue; the page keeps serving the last good run's data, because a failed run writes nothing. The config-error banner (`configErrors`, below) also renders here.
4. **Coverage line** — under a divider, a "COVERAGE" label, then a hatched "▲ N unmeasured repos" badge when any in-scope repo is unmeasured, "· N excluded by policy · N need tagging", and a "Coverage & policy →" link. The badge and the link open the drawer. The line has a 22px minimum height and the badge has a reserved slot, so neither the line's height nor the items after the badge move when the badge appears or disappears.

### The sticky bar

The bar sticks to the top of the viewport while the page scrolls and holds the view tabs and every filter, in two fixed rows.

- **Tabs** — "Overview" and "Alerts". The Alerts tab carries the open count under Severity for the current scope, written "N open" (the sum of the `repos` rows, so it includes the stored counts of unmeasured repositories). The count slot has a minimum width (64px), so the tab does not change size when the count arrives; it stays blank while the figure is unknown.
- **Filters** — each select sits under a small uppercase caption that is also its accessible name (`<label htmlFor>`): CODEBASE, OWNING TEAM, SEVERITY and COMPARE TO. Codebase options show the open count of `kSev` with its unit ("Backend · 8 open crit", or "open high" under High only); the server scopes `summary.codebaseCounts` to the Owning team, so the counts follow it, and the select only picks the `kSev` figure. Owning team lists "All owning teams" plus `summary.knownTeams`. Severity is Critical + high / Critical only / High only. Compare to is Last sync / 7 days ago / 30 days ago / A date…; choosing "A date…" writes a concrete date immediately (the current baseline's date, else a week ago) and shows a date input.
- **Reset filters** sits at the right end of the filter row and appears only when a filter differs from its default. It resets Codebase, Owning team, Severity, Compare to and the selected repository, and never changes the view or the Overview's ownership tab.
- A filter that differs from its default is drawn with the accent border, the accent fill and accent text. Which codebase-type values fall into each Codebase option is deployment configuration (`VULN_CODEBASE_GROUPS`, below).
- **Links are underlined** ("Coverage & policy →", "Reset filters", "Clear team filter", "Show all repositories"): the underline is the non-colour cue. One exception, from the design: the repository names in the Coverage & policy drawer's rows read as plain names and underline on hover and on keyboard focus (each row's reason is its own cue).

### Severity on the page

The page never sends `severity=both` to the API. One rule decides which severity each element uses.

| Element | Severity it uses |
|---|---|
| KPI tiles, sparkline, trend | `kSev`: critical, unless Severity is "High only", then high. They show one severity, never a sum of both. |
| Alert list, repository rail, summary strip, Alerts tab count, Repositories tab | Follow Severity. "Critical + high" sends no `severity` parameter. |
| Codebase option counts | `kSev` (critical, or high under "High only"), for the selected Owning team; the option writes the unit ("open crit" / "open high"). |

The old `?sev=` key is retired and ignored; an old `?sev=high` link now shows critical.

### How dates read

One function, `displayDate` (`labels.ts`), writes every date a person reads: "Oct 4" in the current year and "Jan 8, 2020" in any other year, always from the UTC date. The ISO form appears only inside `title` attributes. That covers the change sentences, the baseline and resolved captions, SLA start dates, the trend's axis, tooltip, note and messages, the Repositories table's Next due, and every date in the alert list. Other wording that more than one surface prints is defined once beside it: the reason a repository is unmeasured (`unmeasuredReason`, the drawer's wording, which the Repositories band upper-cases and the rail shows in capitals through CSS) and the unmeasured badge phrase "▲ N unmeasured repos" (`unmeasuredBadgeText`), used by the header and the Alerts strip. The team table uses the short chip "▲ N unmeasured" (`unmeasuredChipText`).

### Overview

1. **KPI tiles** — four tiles in a fixed row, all following `kSev`.
   - *Open {severity} alerts*: the open count, a change sentence ("▲ 2 more than on Sep 29", "▼ 1 fewer than on Sep 29", "Same as on Sep 29", or why there is none: "No earlier measurement yet" / "No measurement on or before Sep 29"), and a 24px sparkline of the last 90 days. The sparkline sums the unscoped trend series per stored measurement date, and only the selected team's series when an owning team is selected, so the line matches the count beside it. With no measurements it reads "Not enough history yet" over "No measurements yet"; with one it reads "Not enough history yet" over "1 measurement so far ({date})"; with two or more it draws the line, captioned "Open {severity} · last 90 days" once the first point is within 6 days of the 90-day start and "{N} measurements since {date}" before that (the full text is the caption's title).
   - *{severity} since {date}*: new / resolved (with a dismissed sub-count) / reopened since the baseline, plus `other ±N` when non-zero (change in open alerts that new, resolved and reopened do not explain) and `N repos not in baseline` when non-zero. The title names the baseline date, so there is no "vs {date}" caption; with no usable baseline the caption slot says why instead. Three one-line slots are reserved in every state.
   - *Resolved {severity}*: the resolved count, "N dismissed · since {date}" (or "all time" when `VULN_RESOLVED_SINCE` is unset, "since —" when invalid), and "% of N raised are closed". A figure that includes carried-over CSV history is marked `†`, with a footnote.
   - *SLA · open alerts*: Overdue and Due ≤ 7d per severity while that severity's policy is active; otherwise the severity's SLA state in the tile's own wording: "Starts {date}", "No SLA policy yet", or "! Policy error" (the title carries the full sentence; see "SLA states"). A hidden severity (Severity filter) dims to 35% rather than disappearing. The tile's "i" button opens the drawer.
2. **Ownership card** — headed "Open alerts by owner": one card with two tabs (a pressed-button group, not an ARIA tablist: the page's own view tabs are the only tablist) over one fixed-height body. Each tab carries its count; the Repositories tab's reads "N + M unmeasured" when some repositories are unmeasured. Tables scroll inside the body; their header row and their Total/footer row stay pinned.
   - *Owning teams*: one row per owning team, with a CRITICAL group and a HIGH group. Columns per severity: Open, Change vs {baseline date} (or the "No earlier measurement yet" text), Resolved (dismissed), % closed, and Overdue only while that severity's SLA is active. Unassigned is a real row. A row with unmeasured repos shows the short "▲ N unmeasured" chip, which opens the drawer; a row whose critical resolved figure carries history shows `†`. Sortable headers show ↕, the active one ↑ or ↓. With no header chosen the table is in the server's order (open count of the severity the tiles follow, largest first), drawn as that column's "Open ↓". With many teams the body scrolls: a shadow above the pinned Total row, a reserved scrollbar gutter and "· scroll for more" on the card's hint say so, and while an owning team is selected the Total row reads "Total · all owning teams". The table makes its own summary request with no `team` parameter (same `codebase` and `baseline`; with no team selected it has the same SWR key as the KPI tiles' request and dedupes to one), so selecting a team never collapses it to one row and its Total row stays org-wide within the selected codebase.
   - *Repositories*: one row per in-scope, non-archived repository in the current Codebase and Owning team scope, including repositories with no open alerts (greyed, "· no open alerts", or "· no open critical alerts" / "· no open high alerts" when Severity narrows the view). Columns: Repository (codebase underneath), Owning team, Open crit, Overdue crit, Open high, Overdue high, Oldest open, Next due; the Overdue columns exist only while that severity's SLA is active, "Next due" only while at least one policy is active. A name filter narrows the rows. The footer label reads "Total · N repos", "{team} total · N repos" while an owning team's rows are loaded, or "Matching · N repos" while the name filter is on; with no header chosen the rows are in the server's order, drawn as "Open ↓" on the Open column of the severity the tiles follow. Header labels never wrap, and the Owning team track is a fixed width. Unmeasured repositories are listed last as a hatched band ("▲ UNMEASURED · DEPENDABOT OFF — alert counts unknown, not zero", the reason upper-cased); they ignore sorting and show no count. The footer's Open and Overdue columns sum every row, an unmeasured repository's stored counts included, so a team's footer figure equals the team table's; the footer's repository count, Oldest open and Next due come from the measured rows only, and its second line reads "N unmeasured: totals include stored counts" (with the name filter on, `name contains “{text}”` is added after it, joined by " · ", and stands alone when no repository is unmeasured; see "Repository rows and the sum invariant").
3. **Trend card** — "Open {severity} alerts by owning team": the **open** count, one point per stored measurement per team, placed on a numeric time axis by the measurement's actual date (no reconstructed history). A Range select (All time, Last year, Last 90 days, Last 30 days; URL key `range`) picks the window; anything but "All time" adds `since=<today minus 30/90/365 days, UTC>` to the trend request. The Range select (a fixed width) comes first, and to its right a fixed-width block, with its text right-aligned at the card's edge, reads "N open now" and the same change sentence as the Open tile. The legend always lists every owning team: the top 12 by current open count are each coloured distinctly (a CSS custom property per theme mode, `globals.css`), the rest share one grey "Other · N teams" entry whose tooltip lists the names. A selected team draws only its own line and dims the other legend entries to 0.4 opacity. The trend request is never scoped by team, so a team keeps its colour and the legend never changes; the page filters the series client-side. With no points the plot shows "No measurements yet"; with one point it shows "Not enough history yet"; under the All range, a young history (under 14 days) shows a note such as "History starts Sep 29 (first sync) · 3 measurements". The legend is a grid of auto-fill columns under a hairline, and its team names are cut with the full name in the entry's `title`. The footnote, 14px under the legend, reads "Each dot is one stored measurement (an imported CSV run or a sync). The 12 owning teams with the most open alerts get a colour; the rest are grey." The axes' labels are 11px.

### Alerts

1. **Summary strip** — a title column of fixed width (176px) holding the scope label and title ("All owning teams / All repositories", "Owning team / {team} · all repositories", or "Repository · {team} / {repo}"; the label's `title` holds the long form "Repository · owning team {team}", and a long name ends in "…" with its full text in a `title`), a CRIT block and a HIGH block each reading "N open · {tail}" (the tail is "N overdue" while that severity's SLA is active, otherwise its state message), and a badge. The badge reads "▲ N unmeasured repos" when no repository is selected; with a selected repository that is itself unmeasured it reads "▲ unmeasured · stored count", because that repository's figures are its last stored counts, not a measurement. The open figure sits right-aligned in a box at least 36px wide so "54 open · 53 overdue" reads as one phrase and starts in the same place; the overdue tail has a minimum width of 96px while its SLA is active. A selected repository whose row is not (yet) loaded reads "—", never 0, and the Alerts tab count stays blank until that row arrives. The strip is computed from the `repos` rows for the current scope, never from the alert list's response, so the strip, the rail and the Alerts tab count cannot disagree with each other. Its figures include the stored counts of unmeasured repositories. A failed refresh of the same rows keeps the figures (dimmed while stale) and adds a red "!" mark in the title column plus the "Couldn't refresh · showing last load" note.
   - **The blocks do not slide.** The CRIT block is fixed at its natural width (`shrink-0`), so its width depends only on its own SLA state, and the HIGH block's left edge is the same with and without the badge, in every SLA policy state. The one accepted cut: with an unreadable SLA policy at 1024px while the badge shows, the HIGH tail ends in "…" and the block's `title` holds the full text.
2. **Repository rail** — 260px wide. A first row "All {team} repositories" (or "All repositories"), then one row per measured repository sorted by overdue, then open critical, then open high, then name (the sort follows the Severity filter: a hidden severity counts as 0). Each row shows "N crit · N high open" (or "no open alerts", greyed; under a narrowed Severity "no open critical alerts" / "no open high alerts"), "N OVERDUE" on the right, and "Owning team: X" only when no team filter is set. Unmeasured repositories come last as hatched rows that open the drawer. The selected row shows a "×" and clicking it clears the selection. A header line reads "N repos + N unmeasured", and a name filter sits above the rows with a reserved line under it for the "Couldn't refresh" note. The footer says how the rows are sorted and which severities the OVERDUE figures include, following Severity ("Overdue counts critical only"), and names the state of any severity that has no active SLA ("· high: SLA starts Feb 1, 2099"; with neither active, "No SLA policy yet · no overdue counts", or, when the two states differ, "Critical: SLA starts Feb 1, 2099 · high: no SLA policy yet · no overdue counts"). The footer wraps to up to three lines for that wording and has a minimum height (87px), so the list's bottom edge does not move with Severity; an unreadable policy reads red with a "!" mark.
3. **Alert list** — a toolbar (search; Status: Open / Resolved / Open + resolved; toggles Overdue, Due ≤ 7d, Reopened, Runtime only), six sortable headers (Sev, Advisory with CVSS · package, Repository with owning team, Age, Due, State with scope), ten 56px rows, and a pager ("1–10 of 26 alerts · counted per Dependabot alert, not per CVE", Previous, "Page X of Y", Next). The server sorts and pages the list (see "Alert sort and offset"); the component renders rows in the order they arrive. The "Page X of Y" slot is a fixed 112px, and Previous and Next stay focusable at either end (`aria-disabled`, not `disabled`), so a click that moves the page to an end does not drop focus. The list column holds 16px / 20px / 12px of padding (top / sides / bottom) with 12px between its parts (and 8px between the two toolbar rows). A same-key refresh failure keeps the rows (dimmed) and shows the note at the right end of the second toolbar row.
   - Each key starts in its natural direction: Age starts descending (oldest first), every other key ascending; clicking the active header reverses it. With no header chosen the list is in the server's default order (soonest due, then severity, then newest), which the header row draws as "Due ↑", so the first click on Due sorts descending. Under Resolved nothing is drawn (a resolved alert has no due date) and the first click on Due sorts ascending.
   - **Due** shows the date and "Nd OVERDUE" (red), "today" or "in Nd" while that severity's SLA is active; otherwise a dash with the state's message ("SLA starts {date}", "no SLA policy yet", "SLA policy can't be read"). A resolved alert shows "resolved on time" or "resolved Nd late". The Due track has a 120px minimum so "104d OVERDUE" is never clipped at 1024px.
   - **State** reads "open", or "resolved · {reason}" (the dismissed reason, else the state), truncated at the cell edge, with a "↺" after it when the alert was reopened, over the dependency scope. The dates are not in the visible line: the resolution and reopen dates ride in the cell's title and the glyph's accessible label.
   - Before any severity's SLA is active (`summary.slaStatus`), Overdue and Due ≤ 7d are disabled with a hint ("Due dates start {date}", "no SLA policy yet", or, in red with a "!" mark, "SLA policy can't be read"); under Resolved the hint reads "Resolved alerts have no due date". At 1024px, while the list's refresh note shows, the disabled-toggle hint can shrink to nothing (its `title` keeps the full text). **Overdue and Due ≤ 7d are mutually exclusive**: no alert is both past its due date and ≤ 7 days from it, so turning one on turns the other off, and `parseVulnFilters` (shared by the API and MCP) rejects `overdue=true` together with `due_soon=true` with `"overdue and due_soon are disjoint buckets — use one"`. The **Due ≤ 7d** toggle sends `due_soon` (open AND 0 ≤ days_remaining ≤ 7), not a `due_before` cutoff, which also matched already-overdue alerts. Choosing **Resolved** disables and clears both time toggles, since a resolved alert has no due date. A disabled toggle never reads as on.
   - The search box applies its text 300ms after the last keystroke, and applies it at once (never drops it) when the user clicks any other control or leaves the view.
   - A page past the end (a sync shrank the result) moves to the last page. A selected repository that is not in the loaded rows, or that the alerts API rejects ("unknown repo", "repo not tracked"), shows "Repository not found · Show all repositories" inside the list area, and the page never sends that `repo` again.
4. **The list has no owning-team select.** Owning team lives in the sticky bar, and a rail row sets only `repo`.

### Coverage & policy drawer

A right-hand dialog (460px wide, at most 92% of the viewport; `role="dialog"`, `aria-modal`). Opening it focuses the close button and keeps focus inside; Esc, the backdrop and × close it; closing returns focus to the element that opened it. Its open state is local, not in the URL. It reads the same `coverage` and `summary` responses as the header line and the KPI tiles, so it follows the Codebase and Owning team filters. A subtitle under the title says what it follows ("Backend · Owning team: all · follows the page filters"). It groups gaps as **Unmeasured** (hatched rows with the one shared reason wording, "Dependabot off" or GitHub's detail; open counts unknown, but their resolved alerts and measured history still count), **Needs tagging** (counted under "Unassigned" until tagged; each row names the tags it lacks) and **Excluded by policy** (not counted anywhere on this page; each row says "outside scope ({tier})"). Each group header (15px, sentence case, with a ▲ on Unmeasured) shows its repository count and, on the right, a summary ("open counts unknown", "N open critical"); the rows are filled boxes, and a long name or reason wraps instead of being cut. The policy section, "From deployment configuration", has four labelled rows: **Critical SLA** and **High SLA** ("7 days · since {date}", "9 days · starts {date}", "No SLA policy yet", or, in red, "! Can't be read · check the SLA settings in the deployment config"), **Resolved count** ("Since {date} · fixed + dismissed" or "All time · fixed + dismissed") and **Scope** ("{property} = {value}"). Policy entry ids and a *pending* badge are never shown.

### SLA states

Each severity has one of four SLA states, decided in one place (`sla-state.ts`) so the SLA tile, the strip, the rail, the Overdue and Due columns and the drawer cannot disagree. The wording has one definition too, `slaStateLabel(state, { withSla })`: the SLA tile's header already says "SLA", so it uses the short form; the strip, the rail footer, the Due sub-line and the toggle hint do not, so they spell it out.

| State | Meaning | SLA tile | Strip tail, rail note, Due sub-line |
|---|---|---|---|
| active | A policy entry has taken effect | figures: Overdue, Due ≤ 7d | figures: "N overdue", the date and "Nd OVERDUE" |
| pending | A policy exists but starts later | "Starts {date}" | "SLA starts {date}" |
| none | No policy configured | "No SLA policy yet" | "no SLA policy yet" |
| invalid | The configured policy does not parse | "! Policy error" (red; the title has the full sentence) | "SLA policy can't be read" (red) |

The drawer words the same states its own way (see "Coverage & policy drawer").

An Overdue column, a Due ≤ 7d figure and a "Next due" column exist only while their severity's policy is active; `overdue`, `dueSoon` and `nextDue` are `null` in the data otherwise, which is different from zero. An invalid policy reads as `invalid` even though it parses to an empty policy.

### Interactions

| Action | Result |
|---|---|
| Click a team row | Sets Owning team, stays on Overview and switches the card to Repositories. Clicking the selected row again clears it. |
| Click a repository row (Repositories tab) | Pushes one history entry to Alerts with that repository selected, and sets Owning team to that repository's owning team (`Unassigned` is a valid team). |
| Click an unmeasured row or badge | Opens the drawer. |
| Click a rail row | Writes only `repo` (a replace); clicking the selected row, or the "All" row, clears it. |
| Change Codebase or Owning team | Never switches view. It clears the selected repository in the same URL write. |
| Change Severity or Compare to | Never switches view. |
| Change a list filter (search, status, toggles, sort, page) | Applies only to the alert list. |
| Change any list filter or any scope filter | Resets the alert list to page 1. |
| Switch view | Pushes a history entry. If the user has scrolled past the top of the view content, the page scrolls up just enough that the content starts right under the sticky bar; it never scrolls down. |

### URL keys

State lives in the URL (`src/lib/url-state.ts`; the page's schemas are in `src/app/vulnerabilities/security-state.ts`), so a team lead can bookmark "Alerts · Payments". Every key is declared with `scroll: false`.

| Key | Values | Default | History |
|---|---|---|---|
| `view` | `overview`, `alerts` | `overview` | push |
| `own` | `teams`, `repos` | `teams` | push |
| `codebase` | `backend`, `frontend`, `shared`, `other`, `all` | `backend` | replace |
| `team` | an owning team (or `Unassigned`) | none | replace |
| `repo` | `org/name` | none | replace |
| `severity` | `both`, `critical`, `high` | `both` | replace |
| `baseline` | `last`, `7d`, `30d`, `YYYY-MM-DD` | `last` | replace |
| `range` | `30d`, `90d`, `1y`, `all` | `all` | replace |

`useUrlBatch` pushes when any key in the batch is declared `push`, so a team-row or repository-row click (which writes `own` or `view`) pushes one history entry and Back returns to where the user was; every other change replaces. The alert list's page, filters, search text and sort, and the tables' sorts and name filters, are local state, not URL. A hand-edited `baseline` that the API would reject (HTTP 400, which would blank the page) reads as `last`; a hand-edited combination of list filters is sanitised before the request is built, so a bad combination never costs a request.

### States the page covers

- **Hidden severity** (Severity is not "Critical + high"): "–" in that severity's columns, including the Total row, left out of the sums; its headers dim to 35% opacity. The SLA tile and the strip keep the row and dim it.
- **Repositories with no open alerts**: listed and greyed, in the rail and in the Repositories tab.
- **Unmeasured repositories**: listed last as a hatched band; their open count renders as unknown although the API carries the stored count.
- **Baseline**: "No earlier measurement yet" or "No measurement on or before {date}" when the baseline set does not exist or does not cover the view.
- **More than 12 owning teams**: the top 12 by open count get distinct colours from the existing palette; the rest share one grey "Other · N teams" legend entry.
- **Unknown team in the URL**: the page shows the recovery action "Clear team filter" and the known teams.
- **Summary request fails**: a full-page error, never half a page of stale numbers, even when the summary still holds data (the one exception to the slot rule below). Any other failed request is handled inside its own region by the slot rule below.
- **The slot rule** (`slot-view.ts`, one decision for every section): a slot that owns data renders it, dimmed (opacity 0.6) while the previous key's data is on screen; if a refresh of the same key failed, the data stays and a small red "Couldn't refresh · showing last load" note appears in a reserved line (the failed request's own error text is in its `title`). With no data, an error shows the error text; with none, an `available: false` answer shows "Not available yet" (the server's reason in the `title`), never an endless "Loading…"; anything else shows "Loading…". Every note is the same `RefreshNote` component (`refresh-note.tsx`), always rendered and empty until something fails, and exactly one note per failed request is a live region (`role="status"`), so a screen reader announces a failure once: the alert list for `alerts`, the team table for `teamSummary`, the trend card for `trend`, the sparkline for `sparkline`, the strip for `repos` on the Alerts view and the repository table for it on the Overview (the rail's note reads the same slot and stays silent; the trend card hands its role to the sparkline when the two read one request, at Range 90 days). The red "!" mark that backs a wrong state (an unreadable policy, a failed refresh on the strip) is `bang-mark.tsx`, so it never rests on colour alone.
- **No successful sync yet**: a short message with a link to the sync history. (With the module off, `page.tsx` returns 404 instead.)

### Carried over from the GLOOK-43 page

| Behaviour | Where it lives now |
|---|---|
| `†` marker on carried-resolved figures, and its footnote | KPI Resolved tile and the team table |
| "Clear team filter" recovery for an unknown team | `vulnerabilities-content.tsx` |
| Full-page error when the summary fails | `vulnerabilities-content.tsx` |
| Config-error banner | the header card |
| Overdue and Due ≤ 7d mutually exclusive; Resolved clears both | alert list and `security-state.ts` |
| Both time toggles cleared when no SLA is active | `sanitiseAlertList` in `security-state.ts` |
| "other ±N" and "N repos not in baseline" | KPI since-baseline tile |

The old "+N open critical in other codebase types" KPI line is dropped from the page: the Codebase options show those counts. `kpi.openCriticalOtherCodebases` is still in the summary response (MCP: `kpi.open_critical_other_codebases`); the page does not read it.

**"Owning team" labeling:** the vulnerability pages label the repo-level `team` custom property "Owning team" everywhere it's shown to a person — the team table's first column (with a tooltip clarifying it is not a Glooker team), the sticky bar's "Owning team" select (the "OWNING TEAM" caption, "All owning teams" option), the rail and the list's repository cell — specifically so it is never confused with a Glooker (people) team. This is a label-only distinction; the underlying property, its semantics, and its plumbing through `src/lib/vulnerabilities/` are unchanged, and it is never joined against Glooker's own team data.

**Accent-token rule:** every accent color on the vulnerabilities pages and the Runs tabs uses the theme's `accent`/`accent-light`/`accent-lighter`/`accent-dark` utility classes defined in `src/app/globals.css` (`bg-accent`, `text-accent-light`, `hover:bg-accent-dark`, etc.) — never a hard-coded Tailwind color like `indigo-*`. Severity and status colours are the exception and are deliberate: critical is `red-400`, high is `orange-400`, good is `green-400`, and the unmeasured and stale amber and the column washes are the `--warn`, `--warn-bg`, `--warn-line`, `--warn-hatch`, `--crit-tint` and `--high-tint` variables in `globals.css`, defined for both theme modes. Chart colours come from `--vuln-series-*` and `--chart-*`; `chart-no-literal-colors.test.ts` keeps literal colours out of the chart modules. A future change to this area must not reintroduce a literal colour; add a utility or variable to `globals.css` if the token set doesn't already cover the shade needed.

## Reports page and sync history

**The Reports page** (`/reports`, `src/app/reports/reports-tabs.tsx` — the route and file names are unchanged from the old "Report History" page, the page is titled "Reports", with tabs "Commits & PRs" (GitHub · Jira) and "Dependabot alerts" (GitHub)). The second tab, "Dependabot alerts" (`?tab=syncs`, `src/app/reports/vulnerability-syncs-tab.tsx`), shown only when the feature is enabled — the page has no tabs otherwise. GLOOK-59 unified reports and vulnerability syncs onto one shared run model (`src/lib/runs/`: status mapping, formatting, health, staleness) and one card component, `RunCard` (`src/components/runs/RunCard.tsx`); the syncs tab is an adapter onto that shared model, not a second copy of the card. Each tab renders a `RunsToolbar` holding its schedule/next-run line (`RunsToolbar`'s `info`) and its primary action (`RunsToolbar`'s `action` — "Sync alerts" here, rendered only when `canAct`), then one collapsible `RunCard` per run.

A sync `RunCard`'s header (chevron, status chip via `RunHealthBadge`, trigger via `triggerLabel(s.triggerKind, s.triggeredBy)`, duration, start time) is always visible; clicking a **finished** run (succeeded, partial, or failed) expands it into a stats grid (alerts, repos, new/resolved/reopened/missing — "initial import" on the first sync) and, when non-empty, the issues list and a link to the dashboard. A **running** run is never clickable and instead always shows a live progress block — step, a repos counter once known, a progress bar, and a collapsible log panel — the same pattern as a running report's progress block, backed by its own in-memory store (`src/lib/vulnerabilities/progress.ts`) and polled per-card from `GET /api/vulnerabilities/syncs/:id/progress`; it doesn't survive a process restart, and a restart marks the run failed anyway (`initVulnerabilityScheduler()`, see "Sync phases and statuses" below), so there's nothing stale for it to serve after one. Once a run is observed running during a page session, its progress block stays visible after it finishes (polling stopped) until the page reloads. It's a run summary, not an execution trace — per-request detail beyond the visible log lines goes to the server console and `LOG_DIR`. Unlike a report card, a sync card has no Delete or Stop action — Stop is deliberately withheld pending an owner design check (a stopped sync must write nothing), and Delete was never offered for syncs.

Sync staleness (the amber "Last successful sync …" state, both here and in the sync `RunHealthBadge`) comes from a fixed `STALE_MS` (36h, `src/lib/vulnerabilities/queries.ts`) — unlike report staleness, which is derived from the enabled report schedules. **Settings → Schedules** (`src/app/settings/schedules-tab.tsx`) manages the Dependabot alerts sync the same way as report schedules: it is one row in the shared `schedules` table (`kind = 'vuln_sync'`, run by the shared scheduler manager in `src/lib/schedule/manager.ts`), shown with Type "Dependabot alerts", editable cadence and timezone, and pause/resume. It can't be deleted (pausing is the off switch) and has no org, period or test-mode fields. `VULN_SYNC_CRON`/`VULN_SYNC_TZ` only seed that row on the first boot with the feature on; after that the row is the source of truth, so a Settings edit survives restarts and deploys. The Security header and the report pages render their freshness through the shared `DataFreshness` component (`src/components/runs/DataFreshness.tsx`) inside `PageHeader` (`src/components/PageHeader.tsx`). The Security header reads it from `summary.sync.lastSuccessfulAt`, the report pages from `reportFreshness` on `GET /api/llm-config`; the NavBar link reads `vulnerabilityFreshness` from the same endpoint.

**NavBar** shows a "Security" link when `/api/llm-config`'s `vulnerabilities.enabled` is true (`src/components/NavBar.tsx`), and the last sync date alongside it.

## Layout stability

The page must not jump when a filter changes. The rule is: **a filter change may change what a slot shows; it must never change a slot's size or a control's position.** Every fixed size is written once, in `src/app/vulnerabilities/dimensions.ts` (and, for the alert list's own column and the few widths that belong to one component, exported from that component: `alert-list.tsx`, `pager.tsx`, `repo-table.tsx`, `ownership-card.tsx` and `alerts-strip.tsx`), and the components apply those constants as inline styles, so a number changes in one place and tests compare rendered styles against the names.

| Element | Fixed size |
|---|---|
| Page container | max width 1280px, measured on the content (`box-content`: the 24px side padding sits outside it, so the cards are 1280px wide from a 1328px viewport up, and nothing changes below that); padding 32 / 24 / 40 (top / sides / bottom); 24px gap |
| Header coverage line | 22px minimum height, under a divider with 14px of space between them; the unmeasured badge's slot is always rendered, 150px wide (the widest one-digit badge, measured, with a little room for another font), and hidden when there is no badge; the excluded and need-tagging counts sit in slots 126px and 95px wide, sized the same way. A text longer than its slot (a two-digit count) is cut with "…" and carries its full text in a `title` |
| Sticky bar | 127px: 12px of background above the tabs (taken out of the page gap by a negative top margin), a 34px tabs row (its 1px rule included), 14px of clear space under that rule, and a 67px filters row (a 52px block of a 15px caption, a 5px gap and a 32px select, then 14px to the lower rule and the 1px rule itself). Both rules are borders, so they end at the cards' edges while the bar's background covers the gutters |
| Bar selects | Codebase 220, Owning team 170, Severity 140, Compare to 118, date input 128; each `shrink-0`, long text truncates with a `title` |
| Bar reserved slots | "Reset filters" 116px (at the right end of the filter row), date input 128px: hidden, never removed; the Alerts tab's "N open" slot is at least 64px wide |
| KPI tile row | 178px; each tile pads 18px 20px, which leaves 142px of content (two pixels less in the light theme, whose card has a border). The "since" tile fits the smaller room: a 16px label line, three 25px figure rows and three reserved 16px lines. The SLA tile's rows have a 33px pitch |
| Ownership card body | 330px (team rows 50px, the team table's pinned header 56px and its † footnote line 20px; tables scroll inside, header and Total row pinned); each tab's count sits in a slot at least 2ch wide |
| Repositories tab | the Owning team column is 150px (`REPO_TEAM_COL_W`) and each Open and Overdue column has a 112px floor (`REPO_NUM_COL_MIN_W`). At 1024px the table cannot fit every header, and the accepted outcome is that "Oldest open" is cut with "…", its full label in its `title` |
| Sparkline slot | 24px |
| Trend plot | 220px; the Range select is 128px wide and the figures block beside it 210px (the widest change sentence that fits, measured, with its text right-aligned; a longer "No measurement on or before" sentence is cut with "…"), the legend's columns are at least 170px wide (five columns at the narrowest supported width, so a full legend of twelve colours and "Other" fits its three reserved lines, 48px) and cut a team name at 160px; the footnote sits 14px under the legend |
| Alerts summary strip | 72px; the title column is a fixed 176px, the open figure sits right-aligned in a box at least 36px wide and the overdue figure has a minimum width of 96px; the CRIT block is `shrink-0` |
| Alerts card | 776px: a 260px rail and the list column |
| Repository rail | 260px wide; its footer is at least 87px tall (a top border, 10px padding, a 16px sort line, a 2px gap and three 16px lines for the SLA note) |
| Alert list | 560px of rows (10 × 56px), a 52px header, a Due column track at least 120px wide so a long overdue label is never clipped, two 32px toolbar rows (8px apart), a 28px pager whose "Page X of Y" slot is 112px; 16px top and 12px bottom padding, 20px at the sides, 12px between parts; the pieces add up to the 776px card |
| Drawer | 460px, at most 92% of the viewport; its Policy list's label column is 96px |

What holds the sizes constant:

- **Every region keeps its height in every state.** The ownership body, the trend plot, the alert list's row area and the strip are the same size while loading, on error, when empty and when populated. A short or empty list leaves blank space under its rows; that is deliberate and accepted.
- **Reserved slots, not removed controls.** The Reset button, the date input, the Alerts tab count, the coverage line's height and the slots of its badge and counts, the ownership tab counts' minimum width and the tabs' bold label width, the strip's title column width and its figures' minimum widths, every caption line in the KPI tiles, the Repositories footer's second line, every "Couldn't refresh" note line and the trend legend's three lines render in every state (an `aria-hidden` non-breaking space when empty), so a state change cannot add or remove a line. The coverage line's slot widths were measured with the macOS system font and leave a few pixels spare; a wider system font cuts the text with "…" (the `title` keeps the full text).
- **Grid tracks use `minmax(0, …)` and one grid serves a header and its rows.** Long text ends in "…" with a `title` carrying the full text. There is no horizontal scroll at 1024px or wider; below that the cards scroll inside themselves (the page is not designed for narrower screens).
- **Stale data stays on screen.** Every SWR key uses `keepPreviousData`; a scope change dims the previous key's figures (`opacity-60`) instead of blanking the region.
- **List and legend entries are keyed by position**, not by team or alert: keyed by identity, a filter change looked to the browser's layout-shift API like the surviving entries sliding to a new position.
- **Light theme.** The light-mode remap gives `.bg-gray-900` a 1px border and a shadow, so `bg-gray-900` is used for card shells only. Pinned headers, Total rows, rail rows and alert rows use `bg-chart-surface` or a plain `var()` with no border, so the fixed heights hold in both modes. Filled controls and drawer rows use `bg-gray-800`, which the remap turns into a light grey with no border. Row dividers use `border-gray-800/50`, the divider class the remap covers: `border-gray-800/60` has no light rule, so it stayed the dark theme's near-black on white.
- **Page-level state is not scroll-jumping.** URL writes pass `scroll: false`, and a view switch scrolls up (never down) just enough that the content starts under the sticky bar.

How it is checked:

1. **jsdom unit tests** (`vuln-security-dimensions.test.ts`, `vuln-kpi-tiles.test.tsx`, `vuln-ownership-card.test.tsx`, `vuln-team-table.test.tsx`, `vuln-repo-table.test.tsx`, `vuln-trend-card.test.tsx`, `vuln-alerts-strip.test.tsx`, `vuln-repo-rail.test.tsx`, `vuln-alert-list.test.tsx`, `vuln-pager.test.tsx`, `vuln-alerts-view.test.tsx`, `vuln-security-page.test.tsx`) have no layout engine, so they guard structure, classes and inline styles: the constants are applied in every branch (loading, error, empty, populated) and the pieces add up to the card heights. The layout assertions name the revert that makes them fail.
2. **A headless-Chrome run** is the real check. It loads the production build against `npm run dev:mock`'s data (the environment is in "Mock mode") at 1024px and 1440px, in the dark theme (the default) and a light theme (set `localStorage['glooker-theme']` to `daylight-blue` before load), on the Overview and the Alerts views, before and after roughly ten interactions each (filters, a team row, a repository row, view switches, toggles, paging, the drawer). It gates on: the heights in the table above (tiles 178, ownership body 330, trend plot 220, strip 72, card 776, list rows 560, every alert row 56, the rail 260 wide, the pager 28); the sticky bar and the header card keeping their height and the bar staying at the top while scrolled; no horizontal scroll; no console errors; the x position of the coverage line's items, of the Repositories tab and of the Alerts strip's CRIT and HIGH blocks staying the same through every interaction (the HIGH block's left edge does not move when the unmeasured badge appears or disappears, in any SLA policy state); and the layout-shift API. Shifts are logged with the moving element, so a figure changing inside a fixed slot (acceptable: that is a content change) can be told apart from a control or a slot moving (a defect). The harness is not in the repository. The header card is 2px taller in light mode than in dark (the light remap's card border); it is constant within a mode and is not one of the fixed heights.

## Data flow

```
GitHub org endpoints (github.ts / github-mock.ts)
        │  fetch phase: buffered in memory, nothing written yet
        ▼
sync.ts — runSync(): one db.transaction() write phase
        │  upserts vulnerability_repos, vulnerability_alerts,
        │  sets missing_since, writes snapshots and sync counters
        ▼
vulnerability_repos / vulnerability_alerts / vulnerability_repo_snapshots / vulnerability_syncs
        │
        ▼
aggregate.ts (pure functions: computePivot, computeRepoRows, computeCodebaseCounts, computeKpi, computeDelta, computeTrend, listAlerts, computeCoverage, knownTeams, pickBaseline, snapshotSets)
        │
        ▼
queries.ts (getSummary / getRepos / getTrend / getAlerts / getCoverage / listSyncs) — shared by API and MCP
        │                                             │
        ▼                                             ▼
/api/vulnerabilities/* routes (camelCase JSON)   MCP tools (snake_case JSON, via toSnake() boundary mapper)
        │
        ▼
src/app/vulnerabilities/ — use-security-data.ts (every SWR key) → vulnerabilities-content.tsx → the region modules
```

The page reads each response through its slot (`Slot` in `api-types.ts`: data, an `unavailable` answer, the error text, `loading`, `stale`) and decides what to draw with `slotView` (see "States the page covers"), so a failed or unavailable request reads the same in every region.

`queries.ts` is the single source of truth read by both the API and the MCP tools, so the dashboard and an agent can never disagree. It resolves availability (`prepare()`), validates `team`/`repo` filter values against what's actually stored, and delegates every computation to `aggregate.ts`, which is pure (facts + filters + `now` in, numbers out) and therefore trivially testable without touching the DB. `getRepos` is its own route rather than a summary field so the MCP summary payload stays small; both read the same facts cache, which is keyed by the latest sync, so they agree between syncs.

`db-helpers.ts` maps raw DB rows to `AlertFact`/`RepoFact` (`rowToAlertFact`, `rowToRepoFact`) and provides `upsertRows`/`insertRows`/`bool()` helpers used by the sync writer.

### What each region requests

Every key uses `keepPreviousData` and is built in `use-security-data.ts`: `securityKeys()` for the seven keys that do not depend on the alert list, and `alertsQueryString` (from `security-state.ts`) for the alerts key.

| Element | Request | Parameters |
|---|---|---|
| KPI tiles, SLA tile, Codebase option counts | `summary` | `codebase`, `team`, `baseline` |
| Header meta line | `repos` rows, plus `summary.scope.value` | `codebase` only; never `team` (with no team selected it shares the Repositories tab's key) |
| Header coverage line, drawer | `coverage` (and `summary` for the drawer's policy) | `codebase`, `team` |
| Team table | `summary` (a second key) | `codebase`, `baseline`; never `team` |
| Sparkline | `trend` | `codebase`, `severity=kSev`, `since` fixed 90 days back; never `team` |
| Repositories tab, rail, strip, Alerts tab count | `repos` | `codebase`, `team` |
| Alert list | `alerts` | `codebase`, `team`, `repo`, `severity` (omitted for both), list filters, `limit=10`, `offset`, `sort` |
| Trend | `trend` | `codebase`, `severity=kSev`, `since` from `range`; never `team` |

**Known limitation.** The summary, team-table and `repos` requests can briefly disagree if a sync lands between them. The hook compares their settled sync times and refetches the older ones, once per distinct disagreement.

### Page modules

| Module (`src/app/vulnerabilities/`) | Role |
|---|---|
| `page.tsx` | Server component, feature gate (404 when disabled). Exports `default` and Next's reserved `dynamic` only. |
| `vulnerabilities-content.tsx` | The thin composer: URL state, data and the drawer's state, full-page states, the view switch |
| `security-state.ts` | URL schemas, `kSev`, the clearing handlers (`useSecurityUrl`), the alert list's local state (`useAlertList`), `scopeOpenCount`, the rules that sanitise hand-edited input, `alertsQueryString` |
| `use-security-data.ts` | Every SWR key, the stale-repository status, the sync-time reconciliation |
| `api-types.ts`, `view-props.ts` | Response types (including `Slot`) and the props every view region takes |
| `slot-view.ts`, `refresh-note.tsx`, `bang-mark.tsx` | The one slot rule (own data wins, dimmed while stale, the "Couldn't refresh · showing last load" note, then error, unavailable, loading); the note component (one live note per failed request); the red "!" mark |
| `labels.ts`, `sla-state.ts`, `dimensions.ts`, `format.ts`, `overview-format.ts` | The shared wording (dates, the unmeasured reason and badge); the four SLA states and their wording; the fixed sizes; shared formatters; the change sentences and carried-resolved wording |
| `security-header.tsx`, `filter-bar.tsx`, `view-tabs.tsx`, `coverage-drawer.tsx` | Header card, sticky bar, tabs, drawer |
| `kpi-tiles.tsx`, `sparkline.tsx` | Overview tiles |
| `ownership-card.tsx`, `team-table.tsx`, `repo-table.tsx`, `ownership-model.ts` | The ownership card and its two tables (`ownership-model.ts` holds the sort, row-view and footer-sum logic) |
| `trend-card.tsx`, `trend-model.ts`, `team-colors.ts` | The trend card; the model that builds rows, domain, ticks, legend and status; the team colour assignment |
| `alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx`, `pager.tsx` | The Alerts view |

## The four tables and the counting rules

Four tables, added in all three schema locations (`schema.sql`, `src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts`) per the root `CLAUDE.md` "new table" rule. Never a pinned charset.

- **`vulnerability_repos`** — one row per repo Glooker has seen: `repo_id` (PK, GitHub numeric id), `org`, `full_name`, `team`/`service_tier`/`codebase_type` (the custom property values, nullable), `archived`, `dependabot_status` (`ok`/`archived`/`error`/`dependabot-off`), `dependabot_status_detail` (GitHub's message, for `error` and `dependabot-off`), `first_seen_at`/`last_seen_at`.
- **`vulnerability_alerts`** — one row per Dependabot alert, primary key `(repo_id, number)`, **never deleted**. Identity, state (`open`/`fixed`/`dismissed`/`auto_dismissed`), severity (`critical`/`high`, with `severity_changed_at` when GitHub re-rates it), advisory fields (`ghsa_id`, `cve_id`, `cvss_score`, `epss_percentage`, `advisory_withdrawn_at`), dependency fields (`package_name`, `ecosystem`, `manifest_path`, `relationship`, `scope`), GitHub timestamps, and Glooker's own bookkeeping: `reopened_count`, `last_reopened_at`, `missing_since`, `withheld_since`, `first_seen_sync_id`/`last_seen_sync_id`.
- **`vulnerability_syncs`** — one row per run: `trigger_kind` (`schedule`/`manual` — named `trigger_kind` because `TRIGGER` is a reserved MySQL word), `triggered_by`, `status` (`running`/`succeeded`/`partial`/`failed`), timestamps, `alerts_fetched`, `repos_checked`, the four per-run counters, and `issues` (a JSON array of `{ repo?, kind, message }`).
- **`vulnerability_repo_snapshots`** — one row per repo per sync or imported CSV: `source` (`sync`/`csv-import`), `sync_id` (null for CSV), `source_file` (CSV only), `taken_on` (date), `measured_at` (instant — a sync's `finished_at`, or a CSV's `taken_on` at 00:00 UTC), and the counts (`open_critical`, `open_high`, `resolved_critical_since_start`, `resolved_high_since_start`; the two `high` columns are null for CSV rows, which never measured high). The `*_at_time` columns are audit-only — no query uses them by default.

**Counting rules** (`aggregate.ts`, used by every query):

- **Open** = `state = open` AND `missing_since IS NULL` AND the repo is not archived. An archived repo's open alerts are excluded from open counts and SLAs.
- **Resolved since start** = `state ∈ {fixed, dismissed, auto_dismissed}` AND (`VULN_RESOLVED_SINCE` is unset, or the resolution timestamp ≥ the configured `VULN_RESOLVED_SINCE`) AND `advisory_withdrawn_at IS NULL`. When unset, the date condition is omitted rather than compared against null, so resolved counts cover all time. Archived repos' resolved alerts **are** counted. Dismissed counts as resolved.
- **Carried resolved** (critical only): a repo that is `archived`, has zero rows in `vulnerability_alerts`, and has at least one `csv-import` snapshot has no stored alerts to compute a resolved count from at all — it's archived from *before* the first sync ever ran. Its carry is the latest such snapshot's `resolved_critical_since_start` (by `taken_on` then `measured_at`), computed by `queries.ts`'s `loadCarriedResolvedCritical()` (one dual-DB-safe correlated-subquery SQL query, no window functions) and stored on `RepoFact.carriedResolvedCritical`. `computePivot` (`aggregate.ts`) adds it into that repo's team's critical `resolved` (and so `pctClosed`) and the total — re-checking `archived` and "zero alert rows" itself from the `repos`/`alerts` it's already given, independent of whether the field was computed correctly upstream. Open is never carried, and there's no high counterpart (the CSVs never measured high). The UI marks a carrying team row and the Resolved KPI tile with a `†` and a tooltip, plus a footnote when the figure carries; MCP exposes it as `carried_resolved` on both `pivot.rows[].critical` and `pivot.total.critical`.
- **In scope** = the repo's current configured tier property equals the configured in-scope value (`service_tier = 'production'` by default; both are deployment configuration — see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration)). An in-scope repo with a null codebase-type value is counted under Other and All, and listed in Needs tagging. A repo with a null tier value is not counted anywhere (listed in Needs tagging if it has open alerts).
- **Team** = the repo's current configured team property. Null shows as **Unassigned**, a real pivot row, not dropped.
- **Codebase groups** (`codebase.ts`/`codebase-labels.ts`): which codebase-type values fall into Backend, Frontend and Shared libraries is `VULN_CODEBASE_GROUPS`, deployment configuration (default `{"backend":["backend"],"frontend":["frontend"],"shared":["shared"]}`). Other = every in-scope value not listed in any group, including null. All = everything.
- **Unmeasured repos** — an in-scope repo whose `dependabot_status` is `error` **or** `dependabot-off` (`isUnmeasured()` in `aggregate.ts` — the one place this decision is made, so the pivot, the repository rows and the coverage lists can't drift apart; the pivot's `unmeasuredRepos` and the coverage list both skip archived repositories, as the repository rows do, so an archived repo whose stored status is still `error` is never counted). Its stored alerts still count, but every team row/total it belongs to carries `unmeasured_repos: N` so a team can never look clean because Dependabot stopped reporting for one of its repos. A `dependabot-off` repo (GitHub's exact pinned 403 message, `DEPENDABOT_OFF_MESSAGE` in `github.ts`) is unmeasured the same way an `error` repo is, but is **not** a sync issue and never makes a run `partial` by itself — the drawer's Unmeasured group labels it "Dependabot off" instead of showing a GitHub error message.
- **Repository rows** (`computeRepoRows` in `aggregate.ts`, GLOOK-64): one row per in-scope, non-archived repository in the view, with each severity's open, overdue and due-soon counts. It is built on the same `viewRepos`, `isOpen` and `computeDue` as `computePivot`, so the rows sum to the pivot (below). An unmeasured repository carries its **stored** counts.
- Attribution is always by the repo's **current** `team`/`service_tier`/`codebase_type` — history is re-scoped, not frozen (the `*_at_time` snapshot columns are audit-only).

**Definitions used verbatim by the UI, API and MCP:** the unit is the Dependabot **alert**, not the CVE (one CVE across five manifests is five alerts). "Resolved" (not "fixed") covers fixed/dismissed/auto-dismissed, always shown with a dismissed sub-count. "% closed" = `resolved / (open + resolved) × 100`, rounded to a whole percent; "—" in the UI / `null` in MCP at a zero denominator. "Age" is whole UTC days from `created_at` to now (open) or to the resolution timestamp (resolved). "Overdue" = open AND `days_remaining < 0`; "Due soon" = open AND `0 ≤ days_remaining ≤ 7`.

### Repository rows and the sum invariant

`computeRepoRows(alerts, repos, { codebase, team?, now })` is pure and returns one `RepoRow` per in-scope, non-archived repository in the view, including repositories with no open alerts:

```ts
interface RepoSevCell {
  open: number;
  overdue: number | null;          // null unless this severity's SLA is active
  dueSoon: number | null;          // null unless this severity's SLA is active
  oldestOpenDays: number | null;   // max age of open alerts (UTC days, floor 0)
  nextDue: { date: string; daysRemaining: number } | null; // earliest due date not yet overdue; null unless SLA active
}
interface RepoRow {
  fullName: string; team: string; codebaseGroup: Exclude<CodebaseGroup, 'all'>;
  critical: RepoSevCell;
  high: RepoSevCell;
  unmeasured: { status: 'error' | 'dependabot-off'; detail: string | null } | null;
}
```

- **Row order is fixed inside the function:** measured rows by critical open descending, then high open descending, then `fullName`; then unmeasured rows by `fullName`. The page re-sorts for the rail and the sortable table, but the API and MCP order is this one.
- **The HTTP route returns every row.** `GET /api/vulnerabilities/repos` applies no limit (the page needs all of them); only the MCP tool windows the rows (below).
- **Unmeasured rows carry their stored counts.** That keeps the invariant below exact. The page renders an unmeasured row's open count as unknown, never as zero; the MCP description says "for a row with `unmeasured` set, `open` is the stored count and may be out of date".
- Resolved, dismissed, % closed and carried-resolved figures are deliberately not in repository rows. The page combines "both severities" client-side, because the rows carry each severity separately.
- The same SLA gate decides whether a severity is active in `finish()` (the pivot) and in `computeRepoRows`, so the two can never disagree.

**The invariant.** For any filters, per team and per severity:

1. The sum of the team's repository rows for `open`, `overdue` and `dueSoon` equals that team's pivot cell.
2. When a severity's SLA is inactive, `overdue` and `dueSoon` are `null` in both the rows and the pivot.
3. The number of the team's rows with `unmeasured` set equals the team's `unmeasuredRepos`.

It is checked three ways: over the mock fixtures and several filter combinations (`vuln-repo-rows-invariant.test.ts`, `vuln-seed-repo-rows.test.ts`); against an independent source, where each repository's `open` equals the `totalCount` of `listAlerts({ state: 'open', repo })` for that repository (`vuln-queries.test.ts`, through the real database); and in the MCP tool's tests. The fixtures include an unmeasured repository that has stored alerts.

**What a page figure includes.** Every total that is a count of alerts includes the stored counts of unmeasured repositories, because counting rules are unchanged: the team table's rows and Total row, the Alerts strip, the rail's "All" row, the Alerts tab count and the alert list's "N alerts" all agree with each other and with the pivot. The Repositories tab's footer follows the same rule: its Open and Overdue columns sum every row in view, an unmeasured repository's stored counts included, so the footer equals the team table's figure for the same team. Only an unmeasured row's own cells read unknown. The footer's repository count, Oldest open and Next due use the measured rows only: they are not part of the sum invariant, and a stored age or due date may be out of date. The footer's second line says how many repositories are unmeasured: "N unmeasured: totals include stored counts". The mock data has an unmeasured repository with stored alerts, so this is exercised there.

`computeCodebaseCounts(alerts, repos, { team?, now })` returns `Record<CodebaseGroup, { critical: number; high: number }>` including `all`. It ignores the `codebase` filter and honours `team`, and a repository with no codebase type counts under `other` and `all`, exactly as `inCodebaseView` places it, so `counts[c]` equals the pivot's total open for `codebase = c`. The summary carries it as `codebaseCounts`.

`computeCoverage` takes a `codebase` option and filters its three lists by codebase group (a null codebase type counts under Other and All). The header coverage line and the drawer read the same response.

## Alert sort and offset

`listAlerts` (`aggregate.ts`) sorts and slices in memory, for the page and for MCP. There is no SQL `LIMIT` or `OFFSET`, because binding a JS number there fails on MySQL 8.0.22+; paging is `slice(offset, offset + limit)` over the sorted hits.

| Rule | Value |
|---|---|
| Sort keys (a closed list, `alert-sort.ts`, matching the alert-list columns) | `severity`, `advisory`, `repo`, `age`, `due`, `state` |
| Format | `sort=<key>:<asc\|desc>`, e.g. `due:asc` |
| Nulls | Last in both directions |
| Tie-break, always applied last and never reversed | repository full name, then alert number |
| No `sort` given | soonest due, then severity, then newest, then the tie-break |
| `offset` | default 0; a non-negative integer, validated by `parseVulnFilters` |
| `offset` at or past the total | empty `rows`, exact `totalCount` |
| `truncated` | `offset + rows.length < totalCount` |
| `limit` | default 100, capped at 500, applied per page; the page sends 10 |

`offset` and `sort` join `ALERT_FILTER_KEYS`, so they appear in `appliedFilters`. The `repos` facet that `list_vulnerabilities` returns is not affected by `offset`, `limit` or `sort`. The list pages on the server because resolved alerts are never deleted, so "Resolved" and "Open + resolved" will exceed the 500-row cap over time, and client-side paging would then silently misorder rows. `AlertRow.lastReopenedAt` is the ISO instant of the latest reopen, shown as a UTC date.

## Sync phases and statuses

`sync.ts`: a run is a **fetch phase** (nothing written) followed by **one write transaction** (`db.transaction()`), so a run that fails before the transaction commits leaves every vulnerability table exactly as it was.

1. **Start** — an in-process `globalThis` flag (`scheduler.ts`) is checked and set synchronously before the first `await`, so a second trigger gets `409` and a scheduled tick is skipped and logged. A `vulnerability_syncs` row is inserted with `status = 'running'`. On boot, `initVulnerabilityScheduler()` marks any leftover `running` rows `failed` ("interrupted by restart"), the same pattern as report schedules. Immediately before that insert, a **watchdog** (`startSync()` in `scheduler.ts`) marks any `running` row for this org older than **2 hours** `failed` ("still running after 2h") — it isn't a timer, it only runs at the start of the next sync attempt. It has no effect on the `isSyncRunning()` in-process flag that `listSyncs().running` (and so the "Sync alerts"/"Sync running…" button) reads — that flag is already `false` after any process restart, since in-memory state doesn't survive a crash. What it actually fixes is the orphaned `vulnerability_syncs` **row**: without it, a run whose process died mid-sync (skipping `initVulnerabilityScheduler()`'s boot-time cleanup, e.g. because something other than a fresh boot restarted the process) would leave that row's `status = 'running'` forever, and the syncs tab would render it as a running card indefinitely — the progress endpoint's DB fallback shows a generic "Running…" step with no logs, since the in-memory progress store doesn't survive the crash either — even though nothing is actually running.
2. **Fetch: repos** — `GET /orgs/{org}/repos` (ids, `archived`, names) and `GET /orgs/{org}/properties/values` (team, tier, type).
3. **Fetch: alerts** — `GET /orgs/{org}/dependabot/alerts?severity=critical,high&state=open,fixed,dismissed,auto_dismissed`, paged manually by following the `Link` header's `rel="next"`, each page wrapped individually in `withRetry` (not one `withRetry` around the whole pagination loop — a rate limit would otherwise restart every page).
4. **Fetch: zero-alert repos** — for each in-scope repo with no alerts from step 3, one call to `GET /repos/{o}/{r}/dependabot/alerts?per_page=1`: `200` → `ok`; a 403 with the exact archived-repo message → `archived`; a 403 with the exact message `Dependabot alerts are disabled for this repository.` → `dependabot-off` (unmeasured, but **not** recorded as an `issues` entry and never makes the run `partial` on its own); anything else → `error` (unmeasured), recorded as an `issues` entry.
5. **Write, in one transaction** — upsert repos; upsert alerts (recording reopens via `reopened_count`/`last_reopened_at` and severity changes via `severity_changed_at`; seen alerts get `missing_since` and `withheld_since` cleared); the **completeness guard** (below); set `dependabot_status`; write snapshots; write the sync counters.
6. **Finish** with one of three statuses: `succeeded` (clean — a run whose only non-`ok` repos are `dependabot-off` is still `succeeded`), `partial` (a **non-informational** issue exists — some step-4 checks returned `error`, the completeness guard withheld a candidate this run, or the repo listing was proven incomplete this run, see below), or `failed` (step 2/3 didn't complete, or the transaction rolled back — **nothing was written except the sync row itself, and a failed run is never a delta baseline**).

**Every request the vulnerability module makes to GitHub carries a 60s timeout** (`VULN_GITHUB_TIMEOUT_MS` in `github.ts`, via `request: { signal: AbortSignal.timeout(60_000) }` on `fetchAllPages`'s two calls and `getRepoDependabotStatus` — the shared Octokit instance and every report-path call are untouched). Before this, a hung request (no response, no error — the connection just never completes) had no rate-limit header and no HTTP status, so `withRetry`'s classification never fired and the request waited forever, keeping `isSyncRunning()` true until the process restarted. `AbortSignal.timeout` rejects the underlying `fetch` with a `TimeoutError`, not `AbortError` (that name is reserved for a signal aborted by an explicit `controller.abort()` call). `@octokit/request`'s fetch wrapper only special-cases the literal name `AbortError` — rethrowing it as-is with `error.status = 500` added — so a `TimeoutError` instead falls through to the wrapper's generic branch, which wraps it in a `RequestError` with `status: 500`. Either way `withRetry` classifies the failure as a transient 5xx and retries it (up to 3 attempts) rather than as a rate limit or network error — a final timeout still fails the run visibly, just after that shallow retry budget, the same as any other transient failure.

**Issue kinds and the informational rule** (`sync.ts`, `INFORMATIONAL_ISSUE_KINDS`/`assembleIssues()`): every issue recorded in a sync row's `issues` column has a `kind`. Two kinds are **informational** — `data-sanitized` (below) and `completeness-recovered` (below) — and never by themselves make a run `partial`; every other kind (`fetch`, `repo-status`, `config`, `completeness`, `repo-list-incomplete`, `write`) does. Issues are always assembled non-informational-first, informational-last, so a fatal issue (`fetch` on a failed fetch phase, `write` on a rolled-back transaction) is always `issues[0]` regardless of what else was collected. This mirrors the `countableSkips()`/`COUNTABLE_SKIP_CLASSIFICATIONS` pattern in `report-runner/types.ts`: one named, explicit set decides which kinds count, so a future issue kind is a deliberate decision, not a default.

**4-byte characters and utf8mb3** (`bmpOnly()` in `github.ts`): dev's MySQL database is utf8mb3 (charsets are never pinned — see the root `CLAUDE.md`), and inserting a 4-byte UTF-8 character (an emoji, most supplementary-plane CJK) into any `TEXT`/`VARCHAR` column fails with `ERROR 1366 Incorrect string value`, rolling back the whole write transaction — one emoji anywhere in a GitHub alert summary, dismissed reason, package name, or repo/team/tier/type value is enough to fail the entire daily sync. `bmpOnly()` replaces every code point above U+FFFF with U+FFFD, and runs on every string field **before** `clip()` wherever both apply (`mapAlert`, `listOrgReposForVulns`, `listOrgRepoProperties`) — so `clip`'s `slice()` can never split a surrogate pair either, since bmpOnly has already collapsed it to one code unit. How many values were sanitized (and separately, how many were clipped to their column limit) is reported up through an optional `onDataNotice` callback threaded through `fetchPhase()` in `sync.ts`, and rolled into one informational `data-sanitized` issue (`"N values had 4-byte characters replaced and M were clipped to column limits"`) when the total is nonzero.

**The completeness guard** (`writePhase()` in `sync.ts`, GLOOK-50 lesson): a stored **open** alert that this sweep didn't see is a *candidate* to be marked `missing_since`. Every candidate is first split into two kinds:
- **Explainable** — its repo is no longer in this sweep's repo list, or is archived in this sweep — **unless the repo listing itself is proven incomplete this sweep** (below), in which case an absent-repo candidate loses its explainable status; an archived-in-this-sweep repo stays explainable regardless, since archival is observed directly on the repo row rather than inferred from absence. Explainable candidates are **always** marked missing immediately, guard or no guard.
- **Unexplained** — everything else: the alert was re-rated below high (falls outside the severity filter), its advisory was deleted upstream, a truncated/broken sweep failed to return it, or its repo is absent from a repo listing that is itself proven incomplete this sweep. A genuinely *resolved* alert never becomes a candidate at all — step 3 fetches `state=open,fixed,dismissed,auto_dismissed`, so a real fix/dismiss is still returned and diffed normally (counted as `resolved_count`), not treated as missing. A large batch of unexplained candidates is much more likely a broken/truncated sweep (a paging bug, a truncated response) than that many alerts genuinely re-rated or deleted between two syncs.

The guard trips when the count of **fresh** unexplained candidates (never withheld before) exceeds `max(50, 5% of the prior open count)`. When it trips: fresh unexplained candidates get `withheld_since` set instead of `missing_since` (their `state` stays `open` everywhere — they still count as open in every KPI, pivot and alert-list figure), the run finishes `partial`, and a **non-informational** issue of kind `completeness` is recorded with the candidate count and the prior-open count. **Recovery:** an unexplained candidate that was *already* carrying `withheld_since` from an earlier withheld run is marked missing on this run regardless of whether the guard trips again this time — unseen on two consecutive *committed* runs (a failed run neither counts nor resets this) is treated as proof it's real, and it's marked missing on that second run, recording an **informational** `completeness-recovered` issue (`"N previously withheld alerts marked missing after two consecutive sweeps without them"`) — it doesn't make the run `partial` by itself, but it isn't silent either. Only fresh (never-withheld) unexplained candidates count toward the trip threshold, so a candidate recovered this run can't re-trip the guard. This is what keeps the guard from wedging forever on a permanently-reduced count — a one-shot guard (no recovery) would instead stay tripped forever after any legitimate mass drop above the threshold (a mass re-rating below high, or a batch of upstream deletions — archival is always explainable, so it never drives a trip either way).

**Repo-listing incompleteness:** the repo listing (`f.repos`, from step 2) is treated as proven incomplete for this run when either a fetched alert's `repoId` is not in it, or a repo in the properties listing (also step 2) is missing from it — either is proof the listing itself dropped a repo that GitHub otherwise still knows about. When that holds, `writePhase()` records a **non-informational** `repo-list-incomplete` issue (the run is `partial`) and, as described above, no longer trusts "absent from the listing" as a self-evident explanation for a candidate's disappearance. Without this, a broken repo listing could make the guard blindly mark a batch of alerts missing by classifying them as "repo genuinely gone" when the listing itself was the thing that was broken.

**What an operator sees:** the syncs tab (Reports → Dependabot alerts) shows `partial` plus the issue messages; `missing_count` jumps on whichever later run finally marks the recovered alerts missing. MCP callers see `sync.last_status: "partial"` and the same issues in `sync.issues`. **The `/vulnerabilities` dashboard shows nothing for a `partial` run at all** — its header shows only the `▲ STALE` tag (past 36h) and its failed-sync banner renders only when `lastStatus === 'failed'`; nothing on the page reads `partial`. A withheld completeness sweep, a repo-list-incomplete run, or a step-4 repo-status error is visible only in the syncs tab and in MCP's `sync.last_status`.

**Sync counters** (`new_count`, `resolved_count`, `reopened_count`, `missing_count`) are per-run transitions computed while diffing against stored rows. On the **first** sync all four are `null` (the UI shows "initial import") — otherwise the first sync would report every stored alert as "new".

**Failure handling** follows the GLOOK-48/GLOOK-50 pattern: rate limits are handled by `withRetry` per page (primary waits for the reset; secondary escalates 60s→300s); a genuine permission 403 (not a rate limit — see `permissionMessage()` in `sync.ts`) fails the run immediately with a plain, actionable message instead of burning the retry budget.

**Scheduling** (`scheduler.ts`) — `initVulnerabilityScheduler()`, called from `instrumentation.ts` after `initScheduler()`, seeds the `kind = 'vuln_sync'` row of the shared `schedules` table on first boot and registers it with the shared scheduler manager (`src/lib/schedule/manager.ts`), which owns the `croner` job; its init guard sits under its own `globalThis` key so it survives Next.js HMR. Assumes a single app instance (same as report schedules; not solved here). A hung run *in this same process* is not covered by the 2h watchdog above — it keeps `isSyncRunning()` true only until its GitHub requests time out (per the 60s-timeout note above); the watchdog exists for `vulnerability_syncs` rows orphaned by a different or dead process.

## Facts cache

`queries.ts`'s `loadFacts()` caches repos and alerts in a single module-level entry, keyed by `` `${org}:${latest succeeded/partial sync id}:${repo count}` `` (`factsCacheKey()`). **The key changes on a succeeded or partial sync** (either one writes a new `MAX(id)`-eligible `vulnerability_syncs` row; a `failed` run does not, since its status is filtered out of the `MAX(id)` query — a failed sync never moves the key), **or when the repo count changes**. Imported CSV history is already stored and nothing re-imports it, so the cache's inputs change between syncs only if rows are edited by hand; such an edit reaches the dashboard after the next sync (any succeeded or partial run moves the key) or a server restart (the cache is a module-level, in-process variable). Re-querying every alert on every dashboard request would otherwise be pure waste on a large org. Alerts are cached separately from the key computation, so the trend endpoint's `loadAlerts: false` path never runs the alerts query at all, not even once to warm an entry it doesn't need. A single entry is enough because this module is per-process and, per the spec, targets one org. `__clearVulnFactsCache()` is test-only, forcing the next call to reload from the DB.

The cache holds **in-flight promises**, not resolved values — every concurrent caller for the same key awaits the same promise, so there's no window where one caller's write lands on a different caller's entry. A rejected load evicts its entry (only while it's still the current one), so a later call retries instead of being stuck on a poisoned entry.

**After `npm run seed:reset` against a running dev server, restart the server.** `seed:reset` is `rm -f glooker.db`, followed by the same `tsx scripts/seed.ts` that `npm run seed` runs — it deletes the SQLite file and a separate `tsx` process recreates it. A dev server that was already running still holds its database handle open on the deleted file (POSIX lets a process keep reading/writing an unlinked file by its old inode), so it never sees the freshly seeded data at all until it's restarted and reopens the path.

## SLA policy and org taxonomy (deployment configuration)

The SLA policy, the resolved-count start date, the tracking scope and the custom-property taxonomy are **deployment configuration**, not code. Glooker is public; a deployment's policy dates and property names are its own business. They're set as environment variables in the deployment's own (private) configuration. Keep these values in version-controlled deployment configuration so each change is reviewed and has a history. The public code ships neutral defaults.

`src/lib/vulnerabilities/config.ts` owns the neutral defaults, parsing and validation, and memoizes the result once per process (test-only reset: `__clearVulnConfigCache`). **Agents changing the code** — the recipes and rules below, plus which call sites read configuration instead of a literal — live in `src/lib/vulnerabilities/CLAUDE.md`. Real values never enter this repo.

| Variable | Meaning | Default when unset |
|---|---|---|
| `VULNERABILITIES_SLA_POLICY` | JSON array of SLA entries `{ id, severity, effectiveFrom, days }` | `[]`: no due dates ("No SLA policy yet") |
| `VULN_RESOLVED_SINCE` | `YYYY-MM-DD`; "Resolved" counts only resolutions on or after it, both severities | unset: resolved counts cover all time, and the caption says so |
| `VULN_TEAM_PROPERTY` | custom-property key holding a repo's team | `team` |
| `VULN_TIER_PROPERTY` | custom-property key holding a repo's service tier | `service_tier` |
| `VULN_TIER_IN_SCOPE` | the tier value that's tracked | `production` |
| `VULN_CODEBASE_PROPERTY` | custom-property key holding a repo's codebase type | `codebase_type` |
| `VULN_CODEBASE_GROUPS` | JSON object: page group (`backend`, `frontend`, `shared`) → list of values of the codebase-type property. Unlisted values fall into **Other**. | `{"backend":["backend"],"frontend":["frontend"],"shared":["shared"]}` |

Synthetic example (the same one ships in `.env.example`):

```
VULNERABILITIES_SLA_POLICY=[{"id":"critical-2099-01","severity":"critical","effectiveFrom":"2099-01-07","days":7}]
VULN_RESOLVED_SINCE=2099-01-01
VULN_CODEBASE_GROUPS={"backend":["service"],"frontend":["web","mobile"],"shared":["library"]}
```

**Cutover: the defaults are for fresh installs.** An existing deployment **must** set the taxonomy variables (`VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_TIER_IN_SCOPE`, `VULN_CODEBASE_PROPERTY`, `VULN_CODEBASE_GROUPS`) to its own org's property keys, in-scope value and codebase groups before (or with) the release that reads them — the neutral defaults will not match an existing org's properties. Deploy order: add the variables to the deployment first (the running image ignores unknown variables), then roll out the image that reads them. The sync-time guard below is the backstop.

**Sync-time guard for the taxonomy.** Whether a property key exists or a value matches can only be known against real GitHub data, so the sync checks it. Each of these records a **non-informational** sync issue (kind `config`), which makes the run `partial`:
- a configured property key (team, tier or codebase type) appears on no fetched property row;
- no repo's tier equals the configured in-scope value;
- no in-scope repo's codebase type matches any configured group (everything would land in Other, and the default Backend view would be empty).

The message names the variable, never its value.

**Validation, loud and never silent.**
- **Messages never echo a value.** They carry the variable name, the entry **index** (1-based, never the id, which encodes a severity and a month), and the rule — never the raw value, never `JSON.parse`'s own message text. A duplicate-id error names both indices. This applies to every `VULN_*`/`VULNERABILITIES_*` variable, scalars included, and to startup messages, sync-guard messages and the `configErrors` channel alike.
- Invalid JSON: `Invalid JSON in VULNERABILITIES_SLA_POLICY env var` (same shape for `VULN_CODEBASE_GROUPS`).
- Valid JSON that breaks a rule names the entry by index, e.g. `VULNERABILITIES_SLA_POLICY: entry 2: days must be > 0`. The rules: unique ids; ids match `<severity>-<YYYY-MM>`; `severity` is `critical` or `high`; `effectiveFrom` and `VULN_RESOLVED_SINCE` are valid calendar dates; `days` is a positive integer; `effectiveFrom` strictly increases per severity in array order; a codebase value appears under at most one group; only the three known group names.
- An unrecognised variable starting with `VULN_` or `VULNERABILITIES_` produces a startup warning, so a misspelled name doesn't silently mean "unset".
- **Invalid SLA policy:** no SLA is applied, and the error shows on the `configErrors` channel below. It never silently falls back to "no SLA".
- **Invalid `VULN_CODEBASE_GROUPS`:** falls back to the default mapping, with the error shown.
- **`VULN_RESOLVED_SINCE`:** when unset, the resolved-date condition is omitted (never compared against null); the summary field is `null` (MCP `resolved_count_start_date: null`) and the caption reads "all time". When invalid, resolved counts and % closed render as "—" and the error shows — never as all-time figures, which would overstate progress.
- One rule can't be checked by a stateless validator: **never edit an entry that has already taken effect.** The review of the configuration change is its guard.

**The `configErrors` channel.** Every endpoint's shared preparation step (`prepare()` in `queries.ts`) attaches `configErrors` to the envelope, so the summary, alerts, coverage and trend APIs all carry it (`config_errors` in every MCP tool): a list of `{ source: 'startup' | 'sync', variable, rule, at? }`, with no value field, so the no-echo rule holds by construction. Startup entries come from the memoized validation and clear on restart. Sync entries come from the `config` issues of the latest run that reached the guard (succeeded or partial; a run that failed before the guard doesn't clear them), carry that run's finish time, and clear on the next such run. Startup entries come first; no de-duplication across sources. The dashboard's red banner reads the list and says when a sync entry will clear ("clears after the next successful sync"). An overdue list computed under a broken policy therefore never looks like "nothing is overdue".

**How a due date is computed** (`sla.ts`, pure, at read time, never stored): `clock_start = max(created_at, first policy effectiveFrom for that severity, severity_changed_at if re-rated upward)`. A reopen never moves the clock — an alert reopened after its due date is overdue immediately, because the fix didn't hold. Downward re-ratings (critical → high) follow the lower severity's policy. `due_date = date(clock_start) + days`.

The drawer's policy section shows each severity's window and the date it started or will start, e.g. "7 days · since Jan 8, 2020" or "7 days · starts Jan 7, 2099". With no entries it says "No SLA policy yet"; with an invalid policy it says "! Can't be read · check the SLA settings in the deployment config". Every other place the page shows an SLA state uses the shared wording (see "SLA states").

### The policy-change playbook

The rules live in Glooker, public and value-free: this document (for operators) and `src/lib/vulnerabilities/CLAUDE.md` (for agents changing the code). A deployment's own configuration holds the values and a pointer to these rules; it doesn't restate the rules the validator enforces, so the two can't drift.

**The one exception: the two rules no code can check** — repeat these word for word beside the policy variable, wherever it's set. Consider adding the two rules to your change-review checklist:
1. Never edit or delete an entry that has taken effect; append a new entry with a later `effectiveFrom`.
2. Choose `effectiveFrom` in the future, so teams get notice.

1. **What each variable does to existing numbers:**
   - `VULNERABILITIES_SLA_POLICY` sets due dates. Due dates are computed at read time, so editing an entry that has taken effect silently moves deadlines teams were already given.
   - `VULN_RESOLVED_SINCE` sets every "resolved since" and "% closed" figure. Changing it also makes imported history inconsistent, because its resolved column was computed against the date in force when it was produced.
   - **Property keys** (`VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_CODEBASE_PROPERTY`) act at **sync time**: a change affects future syncs only; rows already stored keep the values read under the old key until the next sync overwrites them.
   - **`VULN_TIER_IN_SCOPE` and `VULN_CODEBASE_GROUPS`** act at **read time**: they re-scope all history immediately. One exception: the in-scope check also decides, during a sync, which zero-alert repos get their Dependabot status checked, so `unmeasured`/`dependabot-off` statuses catch up only after the next sync.
2. **Recipes:**
   - **Turn on a severity's SLA:** append an entry with a future `effectiveFrom`.
   - **Change a window:** append a new entry for the same severity with a **later** `effectiveFrom`. Never edit or delete an entry that has taken effect.
   - **Choose `effectiveFrom`** in the future, so teams get notice. The validator can't compare it with the deploy date, so it's a stated rule.
   - **Id convention:** `<severity>-<YYYY-MM>`.
3. **Guards:** the startup validator enforces every rule it can check (listed above); the sync-time guard catches taxonomy mismatches. `vuln-config.test.ts` unit-tests the validator over synthetic fixtures (one per rule, plus the no-echo rule). `vuln-sla.test.ts` keeps the due-date example table with synthetic policies (created before the policy starts, after it starts, across a policy change, reopened, re-rated up and down).

## MCP tools and the availability contract

Five read-only tools, registered in `src/lib/mcp/tools.ts`, calling the same `queries.ts` functions the API uses:

- `list_vulnerabilities` — filtered alert rows plus `total_count`, `truncated`, `applied_filters` (including defaults), `excluded_by_codebase` (how many alerts match every filter except the `codebase` default, so a frontend team's criticals don't look clean just because the default view is Backend), and `repos` (`RepoFacetRow[]` in `aggregate.ts`: distinct repos with their counts, matching every filter except `repo` itself and ignoring `limit`, `offset` and `sort`). The facet follows every list filter (state, severity, overdue, …), so it is not a per-repository open count; use `list_vulnerability_repos` for that. Pages with `limit` (default 100, max 500 per page) and `offset`, ordered by `sort` (see "Alert sort and offset"). Each row carries `last_reopened_at`.
- `get_vulnerability_summary` — the per-team pivot plus the delta since a baseline and the SLA policy in effect; carries `resolved_count_start_date` at the top level and `codebase_counts` (open critical and high for every codebase group and `all`, ignoring `codebase`, honouring `team`). `resolved` includes `carried_resolved` from imported CSV history for archived repos with no alert data in Glooker. `kpi.open_critical_other_codebases` is still in the payload; the page no longer shows it.
- `get_vulnerability_trend` — measured points only (no reconstructed history).
- `get_vulnerability_coverage` — the three coverage lists, filtered to the `codebase` group. **It defaults to `backend`, like every other tool**; before GLOOK-64 it returned every codebase, so a caller that relied on that must pass `codebase=all`, which restores the all-codebases result. The HTTP route `GET /api/vulnerabilities/coverage` behaves the same. A repository with no codebase-type property is grouped under Other, so it appears only with `codebase=other` or `codebase=all`.
- `list_vulnerability_repos` — every tracked, non-archived repository in the `codebase` and `team` scope (default `backend`; a repository with no codebase type is grouped under Other, so it appears only with `codebase=other` or `codebase=all`), including repositories with no open alerts. Each row (snake_case) has `full_name`, `team`, `codebase_group`, per-severity `critical` and `high` objects (`open`, `overdue`, `due_soon`, `oldest_open_days`, `next_due: { date, days_remaining }`) and `unmeasured` (`{ status, detail }` or `null`). `overdue: null` or `due_soon: null` means that severity's SLA is not active, not zero. `next_due` is also null when nothing is due ahead (nothing is open, or every open alert is already overdue), so a null `next_due` next to a numeric `overdue` does not mean there is no SLA. A row with `unmeasured` set shows only stored values from the last successful check (`open`, `overdue`, `due_soon`, `oldest_open_days`, `next_due`), which may be out of date: report them as unknown. Rows are in the `computeRepoRows` order (unmeasured rows last, so `limit` cuts them first). For each team and severity the rows sum to that team's `open`, `overdue` and `due_soon` in `get_vulnerability_summary` only when the whole result is read: over all pages together (`offset += limit` until `truncated` is false), or in one call with `offset` 0 and `truncated` false, and with the same `codebase` and `team` on every call. Returns `rows`, `total_count` and `truncated` (true when `offset + rows.length < total_count`); `limit` defaults to 100 (max 500) and `offset` to 0 (a non-negative integer), and both are echoed in `applied_filters`. It reads `getRepos`, the same function as `GET /api/vulnerabilities/repos`, so it returns the page's figures.

**HTTP is camelCase, MCP is snake_case.** The HTTP API (`totalCount`, `lastSuccessfulAt`, `dueDate`) is consumed only by the UI; MCP responses use snake_case (`applied_filters`, `sync.last_successful_at`, `unmeasured_repos`) because that's the convention MCP callers expect. One recursive key mapper at the MCP boundary (`toSnake()` in `src/lib/mcp/tools.ts`) does the conversion — it rewrites keys only, never values, so team/repo names pass through unchanged. This split is deliberate (see the spec's API section); don't try to unify the two.

**Filter validation** — `offset` must be a non-negative integer and `sort` must be `<key>:<asc|desc>` with a known key, or the call returns an error; an unknown `team` returns `{ error: "unknown team", known_teams: [...] }` rather than a silently empty result. `codebase` defaults to `backend`, and `excluded_by_codebase` makes that default visible instead of hiding it.

A `repo` filter on `list_vulnerabilities`/`GET alerts` distinguishes two failure modes: a `repo` Glooker has never seen returns `{ error: "unknown repo" }`; a `repo` Glooker knows but whose current tier value isn't the configured in-scope value returns a distinct `{ error: "repo not tracked", repo, service_tier }` (the payload field is always named `service_tier`, whatever the configured tier property key) — the alerts endpoint is the only one that filters by repo, so this check lives only there.

**Team validation is scope-aware and differs by endpoint.** Summary, trend and alerts validate a `team` filter against **in-scope** repos only (`knownTeams()` — the configured in-scope tier). The coverage endpoint validates against **every** team Glooker has ever seen, in scope or not (`prepare(f, now, { teamScope: 'all' })`) — coverage exists specifically to surface out-of-scope and untagged repos, so an out-of-scope team's name must not read as "unknown" there the way it would on the other three endpoints.

**Availability contract** (mirrors the `{ available: false }` precedent in `projects/insights.ts`):

| State | Response |
|---|---|
| Feature off | `{ available: false, reason: "Vulnerability tracking is not enabled on this Glooker instance." }` |
| No successful sync yet | `{ available: false, reason: "No successful vulnerability sync yet.", sync: { … } }` |
| Synced | data plus `sync: { last_successful_at, stale, last_status, issues_count, issues: [first 5] }` |
| Latest run failed, an earlier one succeeded | data from the last good run, with `stale`/`last_status: "failed"` |

`stale` is true when the last success is more than 36 hours old. Tool descriptions (`VULN_COMMON` in `tools.ts`) tell agents to check `available` and `sync.stale` before reporting numbers — a failed or partial sync must never be reported as zeros.

## CSV import

Historical per-repo snapshots were loaded once from an external source into `vulnerability_repo_snapshots` with `source = 'csv-import'`. The trend card, the baseline picker and the carried-resolved rule read these rows exactly as they read a sync's own snapshots. The importer itself was a local-only tool and is not part of this repository; the rows it wrote stay in the table and are read like any other snapshot.

## Env vars and token permissions

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VULNERABILITIES_ORG` | enables the feature | unset (off) | GitHub org login, e.g. `your-org`. When unset: the page and every `/api/vulnerabilities/*` route return 404, the NavBar link is hidden, and no cron job is registered. |
| `VULN_SYNC_CRON` | no | `0 6 * * *` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |
| `VULN_SYNC_TZ` | no | `America/New_York` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |

`GITHUB_TOKEN` needs the usual scopes plus, for the org Dependabot endpoints specifically: the account must be an **org owner or security manager**, with **Dependabot alerts: read** and org **Custom properties: read**. Only required when `VULNERABILITIES_ORG` is set.

**Deployment requirement:** the token must have access to **all** of the org's repos, not a subset — a fine-grained token scoped to a selected-repos list makes every run come back `partial` with a `repo-list-incomplete` issue (see [Repo-listing incompleteness](#sync-phases-and-statuses) above).

## Mock mode

```
npm run seed:reset && npm run dev:mock
```

`dev:mock` sets `VULNERABILITIES_ORG=mock-org` (otherwise the feature would be off in mock mode, since `package.json` doesn't set it by default). `github-mock.ts` implements the new `VulnerabilitySource` methods with fixture alerts covering both severities, all four states, a reopened alert, an alert that disappears between two sweeps, an archived repo, an untagged repo, an out-of-scope repo, one repo whose status check errors (unmeasured), and one repo whose status check returns `dependabot-off` (also unmeasured, but never a sync issue). GLOOK-64 added ten more owning teams (so the Backend view lists more than 12 and the "Other · N teams" legend entry shows), a repository with nothing open (`quiet-service`, the greyed zero-alert row) and an unmeasured repository that still has stored alerts (`stale-scanner`, flagged after the seed runs, so its open count is unknown rather than zero). Repo `team` values live in `scripts/mock-identities.ts` (`MOCK_VULN_REPOS`) as plain strings — not rows in Glooker's `teams` table.

`scripts/seed-vulnerabilities.ts` (called from `scripts/seed.ts`) seeds by running the real sync against the mock provider: two good syncs 3 and 2 days ago (so the page shows **stale**), a failed run 1 day ago (so it shows the **failed-sync banner** while still serving the last good run's data), and eight weeks of backend-only CSV-style snapshots for the trend card (using each fixture repo's own `archived` flag, so an archived fixture repo's history is archived too). It skips itself if either `vulnerability_syncs` or `vulnerability_repo_snapshots` (`source = 'csv-import'`) already has rows — checking both means an interrupted run (one table written, not the other) can't double the CSV history on a plain re-`seed`; `seed:reset` is still the way to rebuild from scratch.

`dev:mock` also sets a synthetic, already-in-effect `VULNERABILITIES_SLA_POLICY` (both severities, `effectiveFrom` in the past) and a `VULN_CODEBASE_GROUPS` with a multi-value group, so overdue rendering (red due date, Overdue column) and a non-default codebase mapping are both visible without editing any file. Overdue rendering is also covered directly by jsdom component tests that render rows from the real `listAlerts` with a `now` after the due date. `vuln-seed-repo-rows.test.ts` runs the real seed into a throwaway database and checks that the seeded data exercises every repository-row state and that the rows still sum to the pivot.

The headless measurement in "Layout stability" runs against a production build with `dev:mock`'s environment and a seeded database: seed with `npm run seed:reset` (or `npx tsx scripts/seed.ts` with `SQLITE_PATH` pointing at a scratch file and the same `VULN_CODEBASE_GROUPS` that `package.json` sets for `seed`; without it the `api` repositories fall into Other), then start the built app with the same environment variables `dev:mock` sets, plus `AUTH_ENABLED=false`, `AUTH_ALLOW_ANONYMOUS=true` and `AUTH_ALLOW_ANONYMOUS_ADMIN=true`, as `playwright.config.ts` does. A production server runs with auth ON when `AUTH_ENABLED` is unset, so it needs `AUTH_ENABLED=false`; and even then it serves only `/api/health` unless `AUTH_ALLOW_ANONYMOUS=true` (and `AUTH_ALLOW_ANONYMOUS_ADMIN=true` for the admin routes; see `.env.example`).

## Rollout

All of this happens **before** `VULNERABILITIES_ORG` is set in prod — the feature stays off (see Env vars above) until it's confirmed working.

**Pre-prod gate**, after the dev deploy:

- `SHOW TABLES LIKE 'vulnerability_%'` returns 4.
- The deploy logs contain no "Failed to create a vulnerability table" (the `schema.sql` charset gotcha in the root `CLAUDE.md` — `initSchema()` catches and logs DDL failures instead of throwing, so a broken table creation is otherwise silent).
- The syncs tab (`?tab=syncs` on the Reports page) loads.

**Rollout step 2 comparison** — per repo, Backend view, first sync, run against the real org once the first sync has completed:

```sql
SELECT s.full_name, s.open_critical, s.resolved_critical_since_start
FROM vulnerability_repo_snapshots s
JOIN vulnerability_repos r ON r.repo_id = s.repo_id
WHERE s.sync_id = <first sync id>
  AND r.service_tier = <configured VULN_TIER_IN_SCOPE value>
  AND r.codebase_type IN (<configured VULN_CODEBASE_GROUPS.backend values>)
ORDER BY s.full_name;
```

## Key files

| File | Purpose |
|------|---------|
| `src/app/vulnerabilities/page.tsx` | Server component, feature gate (404 when disabled); exports `default` and Next's reserved `dynamic` only |
| `src/app/vulnerabilities/vulnerabilities-content.tsx` | Client composer: URL state, data, drawer state, full-page states, the view switch |
| `src/app/vulnerabilities/security-state.ts` | URL schemas, `kSev`, `useSecurityUrl`, `useAlertList`, `scopeOpenCount`, `alertsQueryString`, the sanitising rules |
| `src/app/vulnerabilities/use-security-data.ts` | Every SWR key (`securityKeys()`, plus the alerts key), the stale-repository status, sync-time reconciliation |
| `src/app/vulnerabilities/dimensions.ts` | The fixed sizes, written once (see "Layout stability") |
| `src/app/vulnerabilities/labels.ts` | Wording more than one surface prints: `displayDate`, `unmeasuredReason`, `unmeasuredBadgeText`, `unmeasuredChipText` |
| `src/app/vulnerabilities/sla-state.ts` | The four SLA states and their wording (`slaStateLabel`) |
| `src/app/vulnerabilities/security-header.tsx`, `filter-bar.tsx`, `view-tabs.tsx`, `coverage-drawer.tsx` | Header card, sticky bar, view tabs, the Coverage & policy drawer |
| `src/app/vulnerabilities/kpi-tiles.tsx`, `sparkline.tsx` | Overview KPI tiles and the 90-day sparkline |
| `src/app/vulnerabilities/ownership-card.tsx`, `team-table.tsx`, `repo-table.tsx`, `ownership-model.ts` | The ownership card, its two tables, and their sort, row-view and footer-sum logic |
| `src/app/vulnerabilities/trend-card.tsx`, `trend-model.ts`, `team-colors.ts` | The trend card, its model, and the team colour assignment |
| `src/app/vulnerabilities/alerts-strip.tsx`, `repo-rail.tsx`, `alert-list.tsx`, `pager.tsx` | The Alerts view |
| `src/app/vulnerabilities/format.ts`, `overview-format.ts`, `api-types.ts`, `view-props.ts` | Shared formatters and the change sentences, response types, the props every region takes |
| `src/app/vulnerabilities/slot-view.ts`, `src/app/vulnerabilities/refresh-note.tsx`, `src/app/vulnerabilities/bang-mark.tsx` | The slot rule, the "Couldn't refresh" note and the red "!" mark every region shares |
| `src/app/reports/vulnerability-syncs-tab.tsx` | "Dependabot alerts" tab on the Reports page — collapsible RunCards, live progress on the running one |
| `src/app/api/vulnerabilities/`: `summary/route.ts`, `repos/route.ts`, `trend/route.ts`, `alerts/route.ts`, `coverage/route.ts`, `syncs/route.ts`, `syncs/[id]/progress/route.ts`, `sync/route.ts` | API routes, all wrapped with `withRequestLog()` |
| `src/app/api/vulnerabilities/_shared.ts` | `withFilters()` — shared filter parsing/404/400 handling for the read routes |
| `src/lib/url-state.ts` | The URL state hooks (`useUrlState`, `useUrlBatch`) the page's schemas use |
| `src/lib/vulnerabilities/queries.ts` | `getSummary`/`getRepos`/`getTrend`/`getAlerts`/`getCoverage`/`listSyncs`/`getSyncProgressView` — the one source of truth for API and MCP, plus the facts cache |
| `src/lib/vulnerabilities/aggregate.ts` | Pure aggregation: `computePivot`, `computeRepoRows`, `computeCodebaseCounts`, `computeKpi`, `computeDelta`, `computeTrend`, `listAlerts`, `computeCoverage`, `knownTeams`, `pickBaseline`, `snapshotSets` |
| `src/lib/vulnerabilities/alert-sort.ts` | The alert list's sort contract (`ALERT_SORT_KEYS`, `parseAlertSort`), shared by the parser, the aggregation and the page |
| `src/lib/vulnerabilities/sync.ts` | `runSync()` — fetch phase, write transaction, the completeness guard |
| `src/lib/vulnerabilities/progress.ts` | In-memory per-sync progress store for the running card (`initSyncProgress`/`updateSyncProgress`/`addSyncLog`/`getSyncProgress`) — mirrors `src/lib/progress-store.ts`, standalone (no db import) |
| `src/lib/vulnerabilities/scheduler.ts` | `startSync()` (the watchdog lives here), `initVulnerabilityScheduler()`, the cron job |
| `src/lib/vulnerabilities/filters.ts` | `parseVulnFilters()` — the one parameter parser shared by API and MCP |
| `src/lib/vulnerabilities/config.ts` | `parseVulnConfig`/`getVulnConfig` — the deployment configuration parser, validator and neutral defaults (see `src/lib/vulnerabilities/CLAUDE.md` before editing) |
| `src/lib/vulnerabilities/properties.ts` | `mapPropertyRows()` — maps raw custom-property rows to the configured keys, shared by the real and mock GitHub providers |
| `src/lib/vulnerabilities/sla.ts` | `computeDue`, `daysRemaining`, `slaStatus`, `resolvedTiming` |
| `src/lib/vulnerabilities/codebase.ts` | `codebaseGroupOf()`, `isInScope()` — read the configured groups and in-scope tier |
| `src/lib/vulnerabilities/codebase-labels.ts` | Display-only group names/labels, safe to import from client components |
| `src/lib/vulnerabilities/db-helpers.ts` | `rowToAlertFact`/`rowToRepoFact`, `upsertRows`/`insertRows`/`bool()` |
| `src/lib/github-mock.ts` | Mock `VulnerabilitySource` fixtures for `dev:mock` |
| `scripts/mock-identities.ts` | `MOCK_VULN_REPOS`: the mock repositories and their owning teams |
| `scripts/seed-vulnerabilities.ts` | Seeds mock vulnerability data via the real `runSync()` |
| `src/lib/mcp/tools.ts` | The five read-only MCP tools (`VULN_COMMON`, `toSnake()`) |

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VULNERABILITIES_ORG` | enables the feature | unset (off) | See [Env vars and token permissions](#env-vars-and-token-permissions) above. |
| `VULN_SYNC_CRON` | no | `0 6 * * *` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |
| `VULN_SYNC_TZ` | no | `America/New_York` | Seeds the Settings → Schedules row on first boot only; validated in `env-validation.ts`. |
| `GITHUB_TOKEN` | yes, when the feature is on | — | Needs org owner/security-manager access, `Dependabot alerts: read`, and org `Custom properties: read`. Must have access to **all** org repos — a token scoped to selected repos makes every run `partial` with `repo-list-incomplete`. |
| `GITHUB_PROVIDER=mock` | no | unset | Used by `dev:mock`; swaps in `github-mock.ts`'s fixtures. |
| `VULNERABILITIES_SLA_POLICY`, `VULN_RESOLVED_SINCE`, `VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_TIER_IN_SCOPE`, `VULN_CODEBASE_PROPERTY`, `VULN_CODEBASE_GROUPS` | no | see above | Deployment configuration — see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration) above for the full table, validation rules and playbook. |
