# GLOOK-63 — Date range for the Team and Engineer pages

**Ticket:** GLOOK-63, "Team page - extend beyond current report (14 days)".
**Status:** approved in conversation on 2026-10-27; this document records it.

## Problem

The Team page (`/report/[id]/team`) and Engineer page (`/report/[id]/dev/[login]`) show figures from one report, which covers 14 days. Managers want to see a team or a person over a quarter or a year. Reports run daily and each covers the last 14 days, so consecutive reports overlap by 13 days, and earlier history has gaps. Adding up per-report figures would count most work about 14 times.

The impact score has a second problem. Its volume caps are fixed counts (`impact-score.ts`): 20 commits, 10 PRs, 15 story points or 10 Jira issues, and 15 reviews. Those suit 14 days. Over 90 days nearly everyone reaches every cap, and the score stops telling people apart.

## Requirements

1. Both pages get a range picker with three options: **Current report** (the default), **Past 90 days** and **Past 12 months**.
   - The choice is stored in the `range` URL parameter, with values `current`, `90d` and `12m`. It uses `useUrlState`, `history: 'replace'` and `scroll: false`, like the org page.
   - An invalid value falls back to `current`.
2. **Current report** behaves exactly as it does today: the same requests and the same figures.
3. A range always ends on the viewed report's end date (`completed_at`, or `created_at` if that is missing). It starts 90 or 365 days before that date. On an old report, "Past 90 days" therefore means the 90 days before that report.
4. With a range selected, these parts are recomputed over the range:
   - **Team page:** the team table, the developer table, and both exports (CSV and Sheets).
   - **Engineer page:** KPIs, percentiles (against every developer over the same range), the commit list and the weekly chart.

   The weekly chart's visible window follows the picker: Current report keeps today's 90-day view, and 12 months shows 12 months.
5. These parts always stay on the current report and are labelled "Current report" while a range is selected:
   - Team Pulse;
   - the engineer's LLM summary and badges;
   - Claude Code spend, models and skills.
6. Each figure has an exact de-duplication rule:

   | Figure | Source | Rule |
   |---|---|---|
   | Commits, lines added and removed, avg complexity, AI %, PR %, type breakdown, active repos | `commit_analyses` | one row per `commit_sha` (`canonicalCommitIdsSql`), `committed_at` inside the range |
   | Jira issues, story points | `jira_issues` | one row per `issue_key`, `resolved_at` inside the range |
   | Merged PRs authored | new `pr_activity` table, `kind='authored'` | distinct `(repo, pr_number)`, `merged_at` inside the range |
   | Reviews | `pr_activity`, `kind='reviewed'` | distinct `(repo, pr_number)`, `merged_at` inside the range |

7. **Developers listed:** every login with a `developer_stats` row in any completed report whose window overlaps the range. A person who appears in no report inside the range is not listed.
8. **Measured days:** the number of days in the range covered by the union of completed reports' search windows. It is reused from `completedReportWindows`. When measured days are short of the range, the page says so next to the picker, e.g. "212 of 365 days measured".
9. **Impact score scales with the period.**
   - `computeImpactScore` gains an optional `periodDays` input, defaulting to 14. Every volume cap becomes `cap × periodDays / 14`: commits 20, PRs 10, story points 15, Jira issues 10, reviews 15. The complexity and PR-% terms don't change.
   - **Report runner:** passes the report's `period_days`. Today's 14-day reports keep their scores, and longer reports are scored fairly from now on.
   - **Range view:** passes measured days. The PR and review caps instead use the days `pr_activity` covers inside the range (requirement 11), so missing PR data never reads as low activity.
   - **Team aggregator:** passes the same `periodDays` as the developer figures it aggregates.
10. **PR rows from now on.**
    - Each report run upserts one `pr_activity` row per merged PR authored and per merged PR reviewed.
    - `countReviewedPRs` pages with `per_page: 100` and returns the items, not just `total_count`.
    - The GLOOK-50 trust rules still apply unchanged: retry, raise only on provable loss, and send kept-but-unproven figures to `integrity.recordUnverified`. The existing `total_prs` and `total_reviews` columns are still written, with the same values.
11. **PR coverage.** A `pr_activity_coverage` table records which (org, login, day range) slices have been fully collected.
    - Report runs record their window for each developer whose PR searches were trustworthy.
    - The backfill records each month it finishes.
    - The range view counts PR-covered days per developer. Where the range is not fully covered, the page notes it, e.g. "PR and review data from Mar 3".
12. **Backfill script:** `npm run backfill:prs -- --org <org> --months 12`.
    - **Who:** every login with a `developer_stats` row for that org within the period.
    - **What:** month by month, the same two searches the report runs (`author:` and `reviewed-by:`, `is:merged`, `merged:<month>`), through the existing rate-limit and retry handling in `github.ts`.
    - **Re-running:** it is idempotent through upserts, and it skips (login, month) slices already in `pr_activity_coverage`, so an interrupted run resumes.
    - **Output:** progress lines, and a summary of failed slices at the end.
    - It runs against whatever database `.env` / `DB_TYPE` points at. It never runs automatically.

## Architecture

### Data

`pr_activity`:

| column | type | |
|---|---|---|
| `org` | VARCHAR | |
| `github_login` | VARCHAR | |
| `kind` | VARCHAR | `'authored'` or `'reviewed'` |
| `repo` | VARCHAR | |
| `pr_number` | INT | |
| `merged_at` | VARCHAR | ISO string |

- Primary key: `(org, github_login, kind, repo, pr_number)`.
- Index: `(org, merged_at)`.

`pr_activity_coverage`:

| column | type | |
|---|---|---|
| `org` | | |
| `github_login` | | |
| `since` | VARCHAR | ISO date |
| `until` | VARCHAR | ISO date |
| `source` | | `'report'` or `'backfill'` |

- Primary key: `(org, github_login, since, until)`.

Rules for both tables:
- Add them in `schema.sql`, `db/mysql.ts` and `db/sqlite.ts`.
- Don't pin a charset (see `CLAUDE.md`).
- Neither has a foreign key to `reports`, so deleting a report keeps PR history. The reports' search windows still drive the coverage note.

### Server

- **`src/lib/report/range.ts`**
  - **`RANGE_OPTIONS`, `ReportRange`:** shared with the client: `'current' | '90d' | '12m'`.
  - **`rangeWindow(report, range)`:** returns `{ since, until, days }`.
  - **`getRangeDeveloperStats(org, window)`:** returns rows in the same shape the pages already use for `developers`, plus `measured_days` and `pr_covered_days` per developer. It runs one SQL query per source in requirement 6 and computes each impact score with the scaled caps.
- **`getReport(id, range)` and `getDevReport(id, login, range)`**
  - With `current` (or no range), they run today's code path unchanged.
  - Otherwise they replace each developer's figures with the range figures and keep the current report's `cc_*` fields.
  - The response gains `range: { key, since, until, days, measuredDays }`.
- **API routes:** `/api/report/[id]` and `/api/report/[id]/dev/[login]` accept `?range=`. An invalid value returns 400.
  - Cost-visibility stripping and `withRequestLog` are unchanged.
  - The per-developer commit and Jira drill-downs on both pages (`/commits?login=` and `/jira-issues?login=` from the Team page's developer table, and `/jira-issues?login=` on the Engineer page) also accept `range` and list items de-duplicated by the same rules.

### Client

- **Range picker:** move `chart-range.ts` and the org page's picker into `src/components/range/`. The org page keeps its own options (`90d`, `12m`, `all`). The Team and Engineer pages use the new options.
- **Fetching:** both pages add `range` to their SWR keys. `keepPreviousData` stops the tables from blanking while new data loads.
- **Labels:** sections fixed to the current report get a small "Current report" label while a range is selected.

## Out of scope

- The org summary page's KPIs and tables (their chart range already exists).
- MCP tools.
- Making Team Pulse, LLM summaries or spend follow the range.
- An "all time" option on these pages.

## Testing

- **Unit:**
  - `computeImpactScore` scaling: `periodDays` 14 is identical to today; 28 doubles every volume cap; ratio terms don't change.
  - `rangeWindow`.
  - Measured-days union with gaps and overlaps.
- **SQL (SQLite fixture DB), for each source in requirement 6:**
  - the same commit, issue or PR appearing in three overlapping reports is counted once;
  - items outside the range are excluded.
- **Runner:**
  - review search pagination;
  - `pr_activity` and coverage writes;
  - trust rules still raise or record unverified as before.
- **Backfill:**
  - resumes past completed slices;
  - a failed slice writes no coverage row.
- **Pages:**
  - picker URL state;
  - Current report sends no `range` parameter;
  - labels on per-report sections;
  - measured-days note.
- **Schema:** the existing charset guard test covers the new MySQL tables.
