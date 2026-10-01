# GLOOK-59 — Unify run and reporting UX (GitHub reports + vulnerability syncs) — Design

Source of truth: Jira [GLOOK-59](https://smartling.atlassian.net/browse/GLOOK-59) (description + first comment). This file is a verbatim-in-substance copy so implementers do not need Jira access.

## Decisions (user, 2026-09-28)
- Structural consistency (not visual-only).
- Vulnerability schedule appears in Settings → Schedules as a **read-only** row.
- Keep the "view as of" asymmetry: reports can open any past run; the vulnerability dashboard always shows latest-good data against a baseline.

## Problem
Reports and vulnerability syncs share a lifecycle (scheduled/manual run → live progress → run history → dashboard over latest good data) but diverged: status vocabularies (`done`/`stopped` vs `succeeded`/`partial`), card headers, run controls, schedule location (Settings vs env cron), health signal (`IntegrityBadge` vs `partial` + issues), freshness signal (date only vs stale + failed-run banner), page headers, theme (vuln pages hard-code indigo instead of `accent`), near-duplicate card code (`src/app/reports/page.tsx` vs `src/app/reports/vulnerability-syncs-tab.tsx`), and "team" meaning two unrelated things (repo custom property vs Glooker people-teams).

## Guardrails
- No change to vulnerability sync semantics: fetch-then-one-transaction write, `missing_since`, completeness guard, `withheld_since` release.
- Never join the vulnerability `team` property to Glooker `teams`.
- No real policy dates, property keys or property values in the repo.
- Sync **Stop** requires a design check with the module owner (a stopped sync must write nothing) — **excluded from this implementation** pending that check.

## Plan items
1. Shared run model: `RunStatus` (pending/running/succeeded/partial/stopped/failed) + per-source mapping; one status chip.
2. Shared `RunCard`: header (chevron, status chip, subject, trigger, duration, start time), hover actions, live progress (step, counter, bar, collapsible logs with shared colouring), expandable body (stats slot + issues). Thin adapters for reports and syncs.
3. Runs page: "Report History" → neutral "Runs" title, tabs Reports | Vulnerability syncs; `/reports` and `?tab=syncs` keep working; primary action follows the active tab; each tab shows a schedule / next-run line.
4. Card header parity: report cards gain trigger + duration (new `reports.trigger_kind` / `triggered_by`); sync cards gain a subject line (org + scope).
5. Controls parity: reports keep Resume/Stop/Delete; syncs never get Delete; (sync Stop deferred, see Guardrails); one hover-reveal action cluster.
6. Health on the card: reports show integrity state on the list card; syncs show issue count.
7. Errors: replace `alert()` in report actions with inline banners.
8. One polling approach: report list/progress move to the per-card SWR pattern the syncs tab uses; keep `useIdleAwarePolling` for the list.
9. Settings → Schedules read-only vulnerability row: cron, tz, next run, "configured by deployment"; only when the feature is enabled.
10. `DataFreshness`: last successful run, amber when stale, "latest run failed — showing last good data" banner. Vuln page uses it; Team/Org Summary use it on the latest report and show "viewing report from <date>" on older ones. Stale threshold per source: 36h for syncs, derived from report schedules for reports.
11. Shared page header for Org Summary, Team Summary, Vulnerabilities.
12. Theme `accent` token instead of hard-coded indigo on vuln pages/tabs; one timestamp formatter (America/New_York, compact).
13. Label the vulnerability team as "Owning team" (tooltip: from the repo's custom property). No data joining.
14. Nav: "Vulnerabilities" shows last-sync date (amber when stale).
15. Tests + docs (`docs/vulnerabilities-page.md`, root `CLAUDE.md`).

Out of scope: editable vuln schedule; "view as of" for the vuln dashboard; pipeline changes beyond report trigger metadata.
