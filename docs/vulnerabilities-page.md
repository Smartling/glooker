# Vulnerabilities Page — Technical Reference

This document describes the `/vulnerabilities` page and the `src/lib/vulnerabilities/` module (GLOOK-43) for AI coding assistants working on the codebase.

## Overview

The Vulnerabilities page tracks critical and high Dependabot alerts across every in-scope repo in a GitHub org — a repo whose configured tier property equals the configured in-scope value (`service_tier = production` by default; see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration) below). Before this feature, per-team counts came from an existing manual process with no per-alert history. It stores one row per alert (never deleted) plus a per-repo snapshot on every sync, so every number is traceable to an alert, and reopened alerts are detected instead of silently vanishing from "resolved" counts. A repo archived after its first sync keeps its history this way automatically; a repo archived before its first sync has no stored alerts at all, so its resolved count is carried over from imported CSV history instead (below).

It is a standalone module with no coupling to `reports`/`schedules` — see the root `CLAUDE.md` architectural-decisions entry for why (Approach B, extending the report pipeline, was rejected: 52 `FROM reports` queries in 27 files would need a `report_type` discriminator).

## What it shows

1. **Header** — org, "Last successful sync …" (amber when stale — more than 36 hours since the last `succeeded`/`partial` run), a link to the sync history tab, and a banner when the latest run failed (the page still serves the last good run's data, because a failed run writes nothing).
2. **Filter row** — codebase chips (Backend is the default) and a baseline picker (`last` / `7d` / `30d` / `YYYY-MM-DD`). Which codebase-type values fall into each chip is deployment configuration (`VULN_CODEBASE_GROUPS`, below). State lives in the URL via `url-state.ts`.
3. **KPI tiles** — open critical with Δ against the baseline and "+N open critical in other codebase types"; new / resolved (with a dismissed sub-count) / reopened since the baseline, plus other movement when non-zero; resolved critical since the configured start date, or all time, with % closed (marked with a `†` and tooltip when it includes a carried count); SLA status per severity ("Starts <effectiveFrom>", "High: SLA not yet active").
4. **Team pivot** — CRITICAL and HIGH each get a tinted header band with a gap column between them. Columns per severity: Open · Δ · Resolved (*since the configured start date, or all time*) · % closed · Overdue (critical only, until a high policy entry exists). There's a Total row, and Unassigned is a real row, not dropped. A row with unmeasured repos shows a marker next to Open. A row whose critical carriedResolved > 0 shows a `†` after the Resolved number with a tooltip naming the carried count, and a footnote line below the pivot shows the total's carried count. Clicking a row filters the whole page to that team.
5. **Trend chart** — the **open** count, one point per day per team, from snapshots (no reconstructed history). A Critical | High toggle switches severity, next to timeframe chips (30 days · 90 days · 1 year · All — URL state `range`, default `all`; anything but `all` adds `since=<today minus 30/90/365 days, UTC>` to the trend request). Up to 12 teams, ranked by current open count, are each coloured distinctly (a CSS custom property per theme mode, `globals.css`); the rest are grey. Each line starts at its first measurement — Backend starts at the first imported CSV, everything else starts at the first sync.
6. **Alert list** — Sev · CVE/advisory (linked to `html_url`, with CVSS) · Package · Repo · Team (separate, sortable and filterable columns) · Age · Due / days remaining (red when overdue) · Scope · State (with `dismissed_reason` for dismissed rows) · a reopened badge. A team `<select>` ("All teams" plus `summary.knownTeams`) is bound to the same page-wide `team` URL state a pivot-row click sets — there is no separate alerts-only team state. A repo `<select>` ("All repos" plus the alerts response's `repos` facet, labelled `{short name} ({count})`) is local alert-filter state — not URL, not page-wide — and resets to null whenever the page-wide team or codebase changes. Before any severity's SLA is active (`summary.slaStatus`), the Overdue and Due ≤ 7d chips are disabled with a hint ("Due dates start <date>", or "No SLA policy yet" for an empty policy) derived generically from `summary.policy`. Up to 200 rows are fetched and sorted, but only the first 20 render; a "Show 20 more" button (next to a "Showing N of M" count line) reveals more 20 at a time — sorting always applies to every loaded row before the page is sliced. Filters: open/resolved, overdue, due ≤ 7d, reopened, runtime only, and a text search over CVE/GHSA/package/repo. The **Due ≤ 7d** chip sends the `due_soon` filter (open AND 0 ≤ days_remaining ≤ 7), not a `due_before` cutoff — a cutoff also matched already-overdue alerts, since any due date before it includes one already in the past. Choosing **Resolved** disables and clears the two time-based chips (Overdue, Due ≤ 7d), since a resolved alert has no due date. **Overdue and Due ≤ 7d are mutually exclusive:** no alert can be both past its due date and ≤7 days from it, so the two chips are disjoint buckets — turning one on turns the other off, and `parseVulnFilters` (shared by the API and MCP) rejects `overdue=true` together with `due_soon=true` with `"overdue and due_soon are disjoint buckets — use one"` rather than silently returning an empty list. The search box debounces ~300ms after the last keystroke, and flushes on unmount (a filter change or navigation before the timer fires still applies the typed text instead of dropping it).
7. **Coverage gaps panel** — three lists, each row showing repo (linked), tier/type, team, open critical, open high: **Needs tagging** (open alerts, missing tier/type/team), **Excluded by policy** (repos outside the configured tracking scope, with open alerts), **Dependabot status** (in-scope repos whose status is `error` or `dependabot-off`, i.e. unmeasured — an `error` row shows GitHub's message, a `dependabot-off` row shows the label "Dependabot off" instead).
8. **Policy panel** — each SLA entry with its derived window (e.g. "critical-2099-01 · 7 days · 2099-01-07 → open-ended", marked *pending* before it starts), the resolved-count start date, and the scope rule. Shows "No SLA policy yet" with no entries, or the validation error when the configured policy is invalid.

**Report History** gets a second tab, "Vulnerability syncs" (`?tab=syncs`, `src/app/reports/vulnerability-syncs-tab.tsx`), shown only when the feature is enabled — Report History has no tabs otherwise. It shows the schedule and next run, a "Sync now" button (rendered only when `canAct`), and one collapsible card per run — the same design as the Reports tab's cards. A card's header (chevron, status chip, trigger, duration, start time) is always visible; clicking a **finished** run (succeeded, partial, or failed) expands it into a stats grid (alerts, repos, new/resolved/reopened/missing — "initial import" on the first sync) and, when non-empty, the issues list and a link to the dashboard. A **running** run is never clickable and instead always shows a live progress block — step, a repos counter once known, a progress bar, and a collapsible log panel — the same pattern as a running report's progress block, backed by its own in-memory store (`src/lib/vulnerabilities/progress.ts`) and polled per-card from `GET /api/vulnerabilities/syncs/:id/progress`; it doesn't survive a process restart, and a restart marks the run failed anyway (`initVulnerabilityScheduler()`, see "Sync phases and statuses" below), so there's nothing stale for it to serve after one. Once a run is observed running during a page session, its progress block stays visible after it finishes (polling stopped) until the page reloads. It's a run summary, not an execution trace — per-request detail beyond the visible log lines goes to the server console and `LOG_DIR`.

**NavBar** shows a "Vulnerabilities" link when `/api/llm-config`'s `vulnerabilities.enabled` is true (`src/components/NavBar.tsx`).

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
aggregate.ts (pure functions: computePivot, computeKpi, computeDelta, computeTrend, listAlerts, computeCoverage, knownTeams, pickBaseline, snapshotSets)
        │
        ▼
queries.ts (getSummary / getTrend / getAlerts / getCoverage / listSyncs) — shared by API and MCP
        │                                             │
        ▼                                             ▼
/api/vulnerabilities/* routes (camelCase JSON)   MCP tools (snake_case JSON, via toSnake() boundary mapper)
```

`queries.ts` is the single source of truth read by both the API and the MCP tools, so the dashboard and an agent can never disagree. It resolves availability (`prepare()`), validates `team`/`repo` filter values against what's actually stored, and delegates every computation to `aggregate.ts`, which is pure (facts + filters + `now` in, numbers out) and therefore trivially testable without touching the DB.

`db-helpers.ts` maps raw DB rows to `AlertFact`/`RepoFact` (`rowToAlertFact`, `rowToRepoFact`) and provides `upsertRows`/`insertRows`/`bool()` helpers used by the sync writer.

## The four tables and the counting rules

Four tables, added in all three schema locations (`schema.sql`, `src/lib/db/mysql.ts`, `src/lib/db/sqlite.ts`) per the root `CLAUDE.md` "new table" rule. Never a pinned charset.

- **`vulnerability_repos`** — one row per repo Glooker has seen: `repo_id` (PK, GitHub numeric id), `org`, `full_name`, `team`/`service_tier`/`codebase_type` (the custom property values, nullable), `archived`, `dependabot_status` (`ok`/`archived`/`error`/`dependabot-off`), `dependabot_status_detail` (GitHub's message, for `error` and `dependabot-off`), `first_seen_at`/`last_seen_at`.
- **`vulnerability_alerts`** — one row per Dependabot alert, primary key `(repo_id, number)`, **never deleted**. Identity, state (`open`/`fixed`/`dismissed`/`auto_dismissed`), severity (`critical`/`high`, with `severity_changed_at` when GitHub re-rates it), advisory fields (`ghsa_id`, `cve_id`, `cvss_score`, `epss_percentage`, `advisory_withdrawn_at`), dependency fields (`package_name`, `ecosystem`, `manifest_path`, `relationship`, `scope`), GitHub timestamps, and Glooker's own bookkeeping: `reopened_count`, `last_reopened_at`, `missing_since`, `withheld_since`, `first_seen_sync_id`/`last_seen_sync_id`.
- **`vulnerability_syncs`** — one row per run: `trigger_kind` (`schedule`/`manual` — named `trigger_kind` because `TRIGGER` is a reserved MySQL word), `triggered_by`, `status` (`running`/`succeeded`/`partial`/`failed`), timestamps, `alerts_fetched`, `repos_checked`, the four per-run counters, and `issues` (a JSON array of `{ repo?, kind, message }`).
- **`vulnerability_repo_snapshots`** — one row per repo per sync or imported CSV: `source` (`sync`/`csv-import`), `sync_id` (null for CSV), `source_file` (CSV only), `taken_on` (date), `measured_at` (instant — a sync's `finished_at`, or a CSV's `taken_on` at 00:00 UTC), and the counts (`open_critical`, `open_high`, `resolved_critical_since_start`, `resolved_high_since_start`; the two `high` columns are null for CSV rows, which never measured high). The `*_at_time` columns are audit-only — no query uses them by default.

**Counting rules** (`aggregate.ts`, used by every query):

- **Open** = `state = open` AND `missing_since IS NULL` AND the repo is not archived. An archived repo's open alerts are excluded from open counts and SLAs.
- **Resolved since start** = `state ∈ {fixed, dismissed, auto_dismissed}` AND (`VULN_RESOLVED_SINCE` is unset, or the resolution timestamp ≥ the configured `VULN_RESOLVED_SINCE`) AND `advisory_withdrawn_at IS NULL`. When unset, the date condition is omitted rather than compared against null, so resolved counts cover all time. Archived repos' resolved alerts **are** counted. Dismissed counts as resolved.
- **Carried resolved** (critical only): a repo that is `archived`, has zero rows in `vulnerability_alerts`, and has at least one `csv-import` snapshot has no stored alerts to compute a resolved count from at all — it's archived from *before* the first sync ever ran. Its carry is the latest such snapshot's `resolved_critical_since_start` (by `taken_on` then `measured_at`), computed by `queries.ts`'s `loadCarriedResolvedCritical()` (one dual-DB-safe correlated-subquery SQL query, no window functions) and stored on `RepoFact.carriedResolvedCritical`. `computePivot` (`aggregate.ts`) adds it into that repo's team's critical `resolved` (and so `pctClosed`) and the total — re-checking `archived` and "zero alert rows" itself from the `repos`/`alerts` it's already given, independent of whether the field was computed correctly upstream. Open is never carried, and there's no high counterpart (the CSVs never measured high). The UI marks a carrying row and the "Resolved critical since" KPI tile with a `†` and a tooltip, plus a footnote line below the pivot when the total carries; MCP exposes it as `carried_resolved` on both `pivot.rows[].critical` and `pivot.total.critical`.
- **In scope** = the repo's current configured tier property equals the configured in-scope value (`service_tier = 'production'` by default; both are deployment configuration — see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration)). An in-scope repo with a null codebase-type value is counted under Other and All, and listed in Needs tagging. A repo with a null tier value is not counted anywhere (listed in Needs tagging if it has open alerts).
- **Team** = the repo's current configured team property. Null shows as **Unassigned**, a real pivot row, not dropped.
- **Codebase groups** (`codebase.ts`/`codebase-labels.ts`): which codebase-type values fall into Backend, Frontend and Shared libraries is `VULN_CODEBASE_GROUPS`, deployment configuration (default `{"backend":["backend"],"frontend":["frontend"],"shared":["shared"]}`). Other = every in-scope value not listed in any group, including null. All = everything.
- **Unmeasured repos** — an in-scope repo whose `dependabot_status` is `error` **or** `dependabot-off` (`isUnmeasured()` in `aggregate.ts` — the one place this decision is made, so the pivot and the coverage panel can't drift apart). Its stored alerts still count, but every team row/total it belongs to carries `unmeasured_repos: N` so a team can never look clean because Dependabot stopped reporting for one of its repos. A `dependabot-off` repo (GitHub's exact pinned 403 message, `DEPENDABOT_OFF_MESSAGE` in `github.ts`) is unmeasured the same way an `error` repo is, but is **not** a sync issue and never makes a run `partial` by itself — the coverage panel's unmeasured list labels it "Dependabot off" instead of showing a GitHub error message.
- Attribution is always by the repo's **current** `team`/`service_tier`/`codebase_type` — history is re-scoped, not frozen (the `*_at_time` snapshot columns are audit-only).

**Definitions used verbatim by the UI, API and MCP:** the unit is the Dependabot **alert**, not the CVE (one CVE across five manifests is five alerts). "Resolved" (not "fixed") covers fixed/dismissed/auto-dismissed, always shown with a dismissed sub-count. "% closed" = `resolved / (open + resolved) × 100`, rounded to a whole percent; "—" in the UI / `null` in MCP at a zero denominator. "Age" is whole UTC days from `created_at` to now (open) or to the resolution timestamp (resolved). "Overdue" = open AND `days_remaining < 0`; "Due soon" = open AND `0 ≤ days_remaining ≤ 7`.

## Sync phases and statuses

`sync.ts`: a run is a **fetch phase** (nothing written) followed by **one write transaction** (`db.transaction()`), so a run that fails before the transaction commits leaves every vulnerability table exactly as it was.

1. **Start** — an in-process `globalThis` flag (`scheduler.ts`) is checked and set synchronously before the first `await`, so a second trigger gets `409` and a scheduled tick is skipped and logged. A `vulnerability_syncs` row is inserted with `status = 'running'`. On boot, `initVulnerabilityScheduler()` marks any leftover `running` rows `failed` ("interrupted by restart"), the same pattern as report schedules. Immediately before that insert, a **watchdog** (`startSync()` in `scheduler.ts`) marks any `running` row for this org older than **2 hours** `failed` ("still running after 2h") — it isn't a timer, it only runs at the start of the next sync attempt. It has no effect on the `isSyncRunning()` in-process flag that `listSyncs().running` (and so the "Sync now"/"Sync running…" button) reads — that flag is already `false` after any process restart, since in-memory state doesn't survive a crash. What it actually fixes is the orphaned `vulnerability_syncs` **row**: without it, a run whose process died mid-sync (skipping `initVulnerabilityScheduler()`'s boot-time cleanup, e.g. because something other than a fresh boot restarted the process) would leave that row's `status = 'running'` forever, and the syncs tab would render it as a running card indefinitely — the progress endpoint's DB fallback shows a generic "Running…" step with no logs, since the in-memory progress store doesn't survive the crash either — even though nothing is actually running.
2. **Fetch: repos** — `GET /orgs/{org}/repos` (ids, `archived`, names) and `GET /orgs/{org}/properties/values` (team, tier, type).
3. **Fetch: alerts** — `GET /orgs/{org}/dependabot/alerts?severity=critical,high&state=open,fixed,dismissed,auto_dismissed`, paged manually by following the `Link` header's `rel="next"`, each page wrapped individually in `withRetry` (not one `withRetry` around the whole pagination loop — a rate limit would otherwise restart every page).
4. **Fetch: zero-alert repos** — for each in-scope repo with no alerts from step 3, one call to `GET /repos/{o}/{r}/dependabot/alerts?per_page=1`: `200` → `ok`; a 403 with the exact archived-repo message → `archived`; a 403 with the exact message `Dependabot alerts are disabled for this repository.` → `dependabot-off` (unmeasured, but **not** recorded as an `issues` entry and never makes the run `partial` on its own); anything else → `error` (unmeasured), recorded as an `issues` entry.
5. **Write, in one transaction** — upsert repos; upsert alerts (recording reopens via `reopened_count`/`last_reopened_at` and severity changes via `severity_changed_at`; seen alerts get `missing_since` and `withheld_since` cleared); the **completeness guard** (below); set `dependabot_status`; write snapshots; write the sync counters.
6. **Finish** with one of three statuses: `succeeded` (clean — a run whose only non-`ok` repos are `dependabot-off` is still `succeeded`), `partial` (a **non-informational** issue exists — some step-4 checks returned `error`, the completeness guard withheld a candidate this run, or the repo listing was proven incomplete this run, see below), or `failed` (step 2/3 didn't complete, or the transaction rolled back — **nothing was written except the sync row itself, and a failed run is never a delta baseline**).

**Every request the vulnerability module makes to GitHub carries a 60s timeout** (`VULN_GITHUB_TIMEOUT_MS` in `github.ts`, via `request: { signal: AbortSignal.timeout(60_000) }` on `fetchAllPages`'s two calls and `getRepoDependabotStatus` — the shared Octokit instance and every report-path call are untouched). Before this, a hung request (no response, no error — the connection just never completes) had no rate-limit header and no HTTP status, so `withRetry`'s classification never fired and the request waited forever, keeping `isSyncRunning()` true until the process restarted. `AbortSignal.timeout` rejects the underlying `fetch` with a `TimeoutError`, not `AbortError` (that name is reserved for a signal aborted by an explicit `controller.abort()` call). `@octokit/request`'s fetch wrapper only special-cases the literal name `AbortError` — rethrowing it as-is with `error.status = 500` added — so a `TimeoutError` instead falls through to the wrapper's generic branch, which wraps it in a `RequestError` with `status: 500`. Either way `withRetry` classifies the failure as a transient 5xx and retries it (up to 3 attempts) rather than as a rate limit or network error — a final timeout still fails the run visibly, just after that shallow retry budget, the same as any other transient failure.

**Issue kinds and the informational rule** (`sync.ts`, `INFORMATIONAL_ISSUE_KINDS`/`assembleIssues()`): every issue recorded in a sync row's `issues` column has a `kind`. Two kinds are **informational** — `data-sanitized` (below) and `completeness-recovered` (below) — and never by themselves make a run `partial`; every other kind (`fetch`, `repo-status`, `completeness`, `repo-list-incomplete`, `write`) does. Issues are always assembled non-informational-first, informational-last, so a fatal issue (`fetch` on a failed fetch phase, `write` on a rolled-back transaction) is always `issues[0]` regardless of what else was collected. This mirrors the `countableSkips()`/`COUNTABLE_SKIP_CLASSIFICATIONS` pattern in `report-runner/types.ts`: one named, explicit set decides which kinds count, so a future issue kind is a deliberate decision, not a default.

**4-byte characters and utf8mb3** (`bmpOnly()` in `github.ts`): dev's MySQL database is utf8mb3 (charsets are never pinned — see the root `CLAUDE.md`), and inserting a 4-byte UTF-8 character (an emoji, most supplementary-plane CJK) into any `TEXT`/`VARCHAR` column fails with `ERROR 1366 Incorrect string value`, rolling back the whole write transaction — one emoji anywhere in a GitHub alert summary, dismissed reason, package name, or repo/team/tier/type value is enough to fail the entire daily sync. `bmpOnly()` replaces every code point above U+FFFF with U+FFFD, and runs on every string field **before** `clip()` wherever both apply (`mapAlert`, `listOrgReposForVulns`, `listOrgRepoProperties`) — so `clip`'s `slice()` can never split a surrogate pair either, since bmpOnly has already collapsed it to one code unit. How many values were sanitized (and separately, how many were clipped to their column limit) is reported up through an optional `onDataNotice` callback threaded through `fetchPhase()` in `sync.ts`, and rolled into one informational `data-sanitized` issue (`"N values had 4-byte characters replaced and M were clipped to column limits"`) when the total is nonzero.

**The completeness guard** (`writePhase()` in `sync.ts`, GLOOK-50 lesson): a stored **open** alert that this sweep didn't see is a *candidate* to be marked `missing_since`. Every candidate is first split into two kinds:
- **Explainable** — its repo is no longer in this sweep's repo list, or is archived in this sweep — **unless the repo listing itself is proven incomplete this sweep** (below), in which case an absent-repo candidate loses its explainable status; an archived-in-this-sweep repo stays explainable regardless, since archival is observed directly on the repo row rather than inferred from absence. Explainable candidates are **always** marked missing immediately, guard or no guard.
- **Unexplained** — everything else: the alert was re-rated below high (falls outside the severity filter), its advisory was deleted upstream, a truncated/broken sweep failed to return it, or its repo is absent from a repo listing that is itself proven incomplete this sweep. A genuinely *resolved* alert never becomes a candidate at all — step 3 fetches `state=open,fixed,dismissed,auto_dismissed`, so a real fix/dismiss is still returned and diffed normally (counted as `resolved_count`), not treated as missing. A large batch of unexplained candidates is much more likely a broken/truncated sweep (a paging bug, a truncated response) than that many alerts genuinely re-rated or deleted between two syncs.

The guard trips when the count of **fresh** unexplained candidates (never withheld before) exceeds `max(50, 5% of the prior open count)`. When it trips: fresh unexplained candidates get `withheld_since` set instead of `missing_since` (their `state` stays `open` everywhere — they still count as open in every KPI, pivot and alert-list figure), the run finishes `partial`, and a **non-informational** issue of kind `completeness` is recorded with the candidate count and the prior-open count. **Recovery:** an unexplained candidate that was *already* carrying `withheld_since` from an earlier withheld run is marked missing on this run regardless of whether the guard trips again this time — unseen on two consecutive *committed* runs (a failed run neither counts nor resets this) is treated as proof it's real, and it's marked missing on that second run, recording an **informational** `completeness-recovered` issue (`"N previously withheld alerts marked missing after two consecutive sweeps without them"`) — it doesn't make the run `partial` by itself, but it isn't silent either. Only fresh (never-withheld) unexplained candidates count toward the trip threshold, so a candidate recovered this run can't re-trip the guard. This is what keeps the guard from wedging forever on a permanently-reduced count — a one-shot guard (no recovery) would instead stay tripped forever after any legitimate mass drop above the threshold (a mass re-rating below high, or a batch of upstream deletions — archival is always explainable, so it never drives a trip either way).

**Repo-listing incompleteness:** the repo listing (`f.repos`, from step 2) is treated as proven incomplete for this run when either a fetched alert's `repoId` is not in it, or a repo in the properties listing (also step 2) is missing from it — either is proof the listing itself dropped a repo that GitHub otherwise still knows about. When that holds, `writePhase()` records a **non-informational** `repo-list-incomplete` issue (the run is `partial`) and, as described above, no longer trusts "absent from the listing" as a self-evident explanation for a candidate's disappearance. Without this, a broken repo listing could make the guard blindly mark a batch of alerts missing by classifying them as "repo genuinely gone" when the listing itself was the thing that was broken.

**What an operator sees:** the syncs tab (Report History → Vulnerability syncs) shows `partial` plus the issue messages; `missing_count` jumps on whichever later run finally marks the recovered alerts missing. MCP callers see `sync.last_status: "partial"` and the same issues in `sync.issues`. **The `/vulnerabilities` dashboard shows nothing for a `partial` run at all** — its header shows only staleness (amber past 36h) and its failed-sync banner renders only when `lastStatus === 'failed'`; nothing on the page reads `partial`. A withheld completeness sweep, a repo-list-incomplete run, or a step-4 repo-status error is visible only in the syncs tab and in MCP's `sync.last_status`.

**Sync counters** (`new_count`, `resolved_count`, `reopened_count`, `missing_count`) are per-run transitions computed while diffing against stored rows. On the **first** sync all four are `null` (the UI shows "initial import") — otherwise the first sync would report every stored alert as "new".

**Failure handling** follows the GLOOK-48/GLOOK-50 pattern: rate limits are handled by `withRetry` per page (primary waits for the reset; secondary escalates 60s→300s); a genuine permission 403 (not a rate limit — see `permissionMessage()` in `sync.ts`) fails the run immediately with a plain, actionable message instead of burning the retry budget.

**Scheduling** (`scheduler.ts`) — one `croner` job registered from `instrumentation.ts` after `initScheduler()`, under its own `globalThis` key so it survives Next.js HMR. Assumes a single app instance (same as report schedules; not solved here). A hung run *in this same process* is not covered by the 2h watchdog above — it keeps `isSyncRunning()` true only until its GitHub requests time out (per the 60s-timeout note above); the watchdog exists for `vulnerability_syncs` rows orphaned by a different or dead process.

## Facts cache

`queries.ts`'s `loadFacts()` caches repos and alerts in a single module-level entry, keyed by `` `${org}:${latest succeeded/partial sync id}:${repo count}` `` (`factsCacheKey()`). **The key changes on a succeeded or partial sync** (either one writes a new `MAX(id)`-eligible `vulnerability_syncs` row; a `failed` run does not, since its status is filtered out of the `MAX(id)` query — a failed sync never moves the key), **or when the repo count changes**. A CSV import changes the key only when it adds a new repo row (the repo count moves) — an import that only adds snapshot/history rows for repos already known doesn't invalidate the cache. **This is the one place that caveat now has a real, user-visible edge:** a CSV re-import of a repo Glooker already has a row for can change that repo's `carriedResolvedCritical` (a later or corrected snapshot), but since it doesn't move the repo count, the cached `RepoFact[]` isn't refreshed by it — the corrected carry only reaches the dashboard after the next sync (any succeeded/partial run moves the key) or a server restart (the cache is a module-level, in-process variable). Re-querying every alert on every dashboard request would otherwise be pure waste on a large org. Alerts are cached separately from the key computation, so the trend endpoint's `loadAlerts: false` path never runs the alerts query at all, not even once to warm an entry it doesn't need. A single entry is enough because this module is per-process and, per the spec, targets one org. `__clearVulnFactsCache()` is test-only, forcing the next call to reload from the DB.

The cache holds **in-flight promises**, not resolved values — every concurrent caller for the same key awaits the same promise, so there's no window where one caller's write lands on a different caller's entry. A rejected load evicts its entry (only while it's still the current one), so a later call retries instead of being stuck on a poisoned entry.

**After `npm run seed:reset` against a running dev server, restart the server.** `seed:reset` is `rm -f glooker.db && tsx scripts/seed.ts` — it deletes the SQLite file and a separate `tsx` process recreates it. A dev server that was already running still holds its database handle open on the deleted file (POSIX lets a process keep reading/writing an unlinked file by its old inode), so it never sees the freshly seeded data at all until it's restarted and reopens the path.

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

The policy panel derives each entry's window, e.g. "critical-2099-01 · 7 days · 2099-01-07 → open-ended", and marks entries that haven't started yet as *pending*. With no entries it says "No SLA policy yet"; with an invalid policy it shows "SLA policy configuration is invalid".

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

Four read-only tools, registered in `src/lib/mcp/tools.ts`, calling the same `queries.ts` functions the API uses:

- `list_vulnerabilities` — filtered alert rows plus `total_count`, `truncated`, `applied_filters` (including defaults), `excluded_by_codebase` (how many alerts match every filter except the `codebase` default, so a frontend team's criticals don't look clean just because the default view is Backend), and `repos` (`RepoFacetRow[]` in `aggregate.ts`: distinct repos with their counts, matching every filter except `repo` itself and ignoring `limit` — a single team can have well more open alerts than any page size, so a repo picker can't be built from the loaded rows). Sorted by count descending, then by name.
- `get_vulnerability_summary` — the per-team pivot plus the delta since a baseline and the SLA policy in effect; carries `resolved_count_start_date` at the top level. `resolved` includes `carried_resolved` from imported CSV history for archived repos with no alert data in Glooker.
- `get_vulnerability_trend` — measured points only (no reconstructed history).
- `get_vulnerability_coverage` — the three coverage lists.

**HTTP is camelCase, MCP is snake_case.** The HTTP API (`totalCount`, `lastSuccessfulAt`, `dueDate`) is consumed only by the UI; MCP responses use snake_case (`applied_filters`, `sync.last_successful_at`, `unmeasured_repos`) because that's the convention MCP callers expect. One recursive key mapper at the MCP boundary (`toSnake()` in `src/lib/mcp/tools.ts`) does the conversion — it rewrites keys only, never values, so team/repo names pass through unchanged. This split is deliberate (see the spec's API section); don't try to unify the two.

**Filter validation** — an unknown `team` returns `{ error: "unknown team", known_teams: [...] }` rather than a silently empty result. `codebase` defaults to `backend`, and `excluded_by_codebase` makes that default visible instead of hiding it.

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

Historical per-repo snapshots can be loaded from an external source into `vulnerability_repo_snapshots` with `source = 'csv-import'`. The trend chart, the baseline picker and the carried-resolved rule read these rows exactly as they read a sync's own snapshots. The importer itself is a local-only tool and is not part of this repository.

## Env vars and token permissions

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VULNERABILITIES_ORG` | enables the feature | unset (off) | GitHub org login, e.g. `your-org`. When unset: the page and every `/api/vulnerabilities/*` route return 404, the NavBar link is hidden, and no cron job is registered. |
| `VULN_SYNC_CRON` | no | `0 6 * * *` | Validated in `env-validation.ts`. |
| `VULN_SYNC_TZ` | no | `America/New_York` | Validated in `env-validation.ts`. |

`GITHUB_TOKEN` needs the usual scopes plus, for the org Dependabot endpoints specifically: the account must be an **org owner or security manager**, with **Dependabot alerts: read** and org **Custom properties: read**. Only required when `VULNERABILITIES_ORG` is set.

**Deployment requirement:** the token must have access to **all** of the org's repos, not a subset — a fine-grained token scoped to a selected-repos list makes every run come back `partial` with a `repo-list-incomplete` issue (see [Repo-listing incompleteness](#sync-phases-and-statuses) above).

## Mock mode

```
npm run seed:reset && npm run dev:mock
```

`dev:mock` sets `VULNERABILITIES_ORG=mock-org` (otherwise the feature would be off in mock mode, since `package.json` doesn't set it by default). `github-mock.ts` implements the new `VulnerabilitySource` methods with fixture alerts covering both severities, all four states, a reopened alert, an alert that disappears between two sweeps, an archived repo, an untagged repo, an out-of-scope repo, one repo whose status check errors (unmeasured), and one repo whose status check returns `dependabot-off` (also unmeasured, but never a sync issue). Repo `team` values live in `scripts/mock-identities.ts` (`MOCK_VULN_REPOS`) as plain strings — not rows in Glooker's `teams` table.

`scripts/seed-vulnerabilities.ts` (called from `scripts/seed.ts`) seeds by running the real sync against the mock provider: two good syncs 3 and 2 days ago (so the page shows **stale**), a failed run 1 day ago (so it shows the **failed-sync banner** while still serving the last good run's data), and eight weeks of backend-only CSV-style snapshots for the trend chart (using each fixture repo's own `archived` flag, so an archived fixture repo's history is archived too). It skips itself if either `vulnerability_syncs` or `vulnerability_repo_snapshots` (`source = 'csv-import'`) already has rows — checking both means an interrupted run (one table written, not the other) can't double the CSV history on a plain re-`seed`; `seed:reset` is still the way to rebuild from scratch.

`dev:mock` also sets a synthetic, already-in-effect `VULNERABILITIES_SLA_POLICY` (both severities, `effectiveFrom` in the past) and a `VULN_CODEBASE_GROUPS` with a multi-value group, so overdue rendering (red due date, Overdue column) and a non-default codebase mapping are both visible without editing any file. Overdue rendering is also covered directly by jsdom component tests that render rows from the real `listAlerts` with a `now` after the due date.

## Rollout

All of this happens **before** `VULNERABILITIES_ORG` is set in prod — the feature stays off (see Env vars above) until it's confirmed working.

**Pre-prod gate**, after the dev deploy:

- `SHOW TABLES LIKE 'vulnerability_%'` returns 4.
- The deploy logs contain no "Failed to create a vulnerability table" (the `schema.sql` charset gotcha in the root `CLAUDE.md` — `initSchema()` catches and logs DDL failures instead of throwing, so a broken table creation is otherwise silent).
- The syncs tab (`?tab=syncs` on Report History) loads.

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
| `src/app/vulnerabilities/page.tsx` | Server component, feature gate (404 when disabled) |
| `src/app/vulnerabilities/vulnerabilities-content.tsx` | Client component: header, filter row, KPI tiles, panel composition |
| `src/app/vulnerabilities/alerts-table.tsx` | Alert list: filters (Overdue/Due ≤ 7d mutually exclusive), sort, debounced search, `alertFilterQuery()`; `AlertsPanel` owns the header/Updating-indicator/error/loading/table swap |
| `src/app/vulnerabilities/team-pivot.tsx` | Per-team pivot table (CRITICAL/HIGH bands, delta, row selection) |
| `src/app/vulnerabilities/trend-chart.tsx` | Per-team daily open-count trend |
| `src/app/vulnerabilities/coverage-panel.tsx` | Needs tagging / excluded by policy / unmeasured lists |
| `src/app/vulnerabilities/policy-panel.tsx` | SLA policy entries and derived windows |
| `src/app/vulnerabilities/format.ts` | Shared formatters: `dash`, `signed`, `deltaClass`, `panelError` |
| `src/app/reports/vulnerability-syncs-tab.tsx` | "Vulnerability syncs" tab on Report History — collapsible cards, live progress on the running one |
| `src/app/api/vulnerabilities/summary/route.ts`, `trend/route.ts`, `alerts/route.ts`, `coverage/route.ts`, `syncs/route.ts`, `syncs/[id]/progress/route.ts`, `sync/route.ts` | API routes, all wrapped with `withRequestLog()` |
| `src/app/api/vulnerabilities/_shared.ts` | `withFilters()` — shared filter parsing/404/400 handling for the read routes |
| `src/lib/vulnerabilities/queries.ts` | `getSummary`/`getTrend`/`getAlerts`/`getCoverage`/`listSyncs`/`getSyncProgressView` — the one source of truth for API and MCP, plus the facts cache |
| `src/lib/vulnerabilities/aggregate.ts` | Pure aggregation: `computePivot`, `computeKpi`, `computeDelta`, `computeTrend`, `listAlerts`, `computeCoverage`, `knownTeams`, `pickBaseline`, `snapshotSets` |
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
| `scripts/seed-vulnerabilities.ts` | Seeds mock vulnerability data via the real `runSync()` |
| `src/lib/mcp/tools.ts` | The four read-only MCP tools (`VULN_COMMON`, `toSnake()`) |

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `VULNERABILITIES_ORG` | enables the feature | unset (off) | See [Env vars and token permissions](#env-vars-and-token-permissions) above. |
| `VULN_SYNC_CRON` | no | `0 6 * * *` | Validated in `env-validation.ts`. |
| `VULN_SYNC_TZ` | no | `America/New_York` | Validated in `env-validation.ts`. |
| `GITHUB_TOKEN` | yes, when the feature is on | — | Needs org owner/security-manager access, `Dependabot alerts: read`, and org `Custom properties: read`. Must have access to **all** org repos — a token scoped to selected repos makes every run `partial` with `repo-list-incomplete`. |
| `GITHUB_PROVIDER=mock` | no | unset | Used by `dev:mock`; swaps in `github-mock.ts`'s fixtures. |
| `VULNERABILITIES_SLA_POLICY`, `VULN_RESOLVED_SINCE`, `VULN_TEAM_PROPERTY`, `VULN_TIER_PROPERTY`, `VULN_TIER_IN_SCOPE`, `VULN_CODEBASE_PROPERTY`, `VULN_CODEBASE_GROUPS` | no | see below | Deployment configuration — see [SLA policy and org taxonomy](#sla-policy-and-org-taxonomy-deployment-configuration) above for the full table, validation rules and playbook. |
