# De-duplicated commits and Jira issues (range performance follow-up to GLOOK-63)

**Status:** draft for review, 2026-11-06.

## Why

The Team and Engineer pages' "Past 90 days" and "Past 12 months" views (GLOOK-63) are slow on dev. A 12-month view takes several seconds, and not only on the first load.

Reports run daily and each covers 14 days, so every report stores its own copy of about 13 days that the previous report already stored. On dev:

| Table | Rows | Distinct items |
|---|---|---|
| `commit_analyses` | ~185k | ~34k commits |
| `jira_issues` | ~70k | ~9k issues |

Every range request de-duplicates all of it again: `GROUP BY commit_sha` / `issue_key`, then tens of thousands of row lookups into wide rows. The database is a `db.t4g.micro` with a 128 MB buffer pool. Measured on dev for 12 months:

| Step | Time |
|---|---|
| Commit de-dupe | ~1s |
| Commit row lookups | ~2.5s |
| Jira de-dupe | ~0.5s |
| Jira row lookups | ~2.5s |

The in-process cache added in `d91bdb0` hides repeat loads, but every deploy clears it, and so does anything that changes the report set.

**The fix:** keep a de-duplicated copy as data is written, so range views read it directly.

## Goals

1. **Two new tables.** One row per commit (`commit_canonical`) and one row per Jira issue (`jira_canonical`), per org, holding only the columns the cross-report readers need.
2. **The cross-report readers switch to them.** A 12-month view on dev must load in well under a second, every time, with the same figures as today, apart from the pick-rule change described below.
3. **Kept current automatically:**
   - when a report completes;
   - when a report is deleted.
4. **Admin tooling** for when things go wrong.
   - **Why:** the owner's experience is that a tool to rebuild a derived copy ("reflection") pays off. It's there for the day someone spots a figure that looks wrong.
   - **Settings → "De-duplicated data" card**, admin only:
     - **Check** is read-only. It recomputes the expected rows from the source tables and compares them with what's stored. Per table it shows `stored`, `expected` and `differ`.
     - **Rebuild** rebuilds both tables from the source tables. It asks for confirmation and runs as one transaction per table, so a reader never sees a half-built table.
     - The card shows when the last rebuild ran and how long it took.
   - **CLI:** `npm run rebuild:canonical -- [--check]`, with the same behaviour as the two buttons.
5. **LLM reuse.** When the report runner meets a commit whose analysis already exists in an earlier completed report, it copies that analysis instead of calling the LLM.
   - This is low priority for this deployment, because AI Proxy caches LLM requests. It is still included.

## Non-goals

- **Readers that look at one report stay on the per-report tables.** `commit_analyses` and `jira_issues` stay exactly as they are, and so does every reader that looks at one report: Team Pulse, projects/epics, chat tools, the per-report commit drill-down, cc-spend identity, and the current-report path.
- No change to `pr_activity`; it is already de-duplicated.
- No new indexes on the per-report tables.
- No infrastructure changes (instance size, buffer pool).
- No automatic build on startup.
  - **Owner's decision:** the app may start with the new tables empty, and an admin builds them with Rebuild.

## Anti-goals (a failure even if it "works")

- **Range figures silently diverging from the per-report data** with nothing to detect it. Check exists to catch exactly this.
- **A range view showing zeros or nothing because the tables haven't been built yet.** See "Before the first build".
- **A rebuild that leaves a table half-written** if it fails or is stopped.
- **Any change to current-report figures.**

## The data

**`commit_canonical`:**
- **Key:** `(org, commit_sha)`.
- **Copied from the chosen `commit_analyses` row:**
  - `analysis_id`, the id of the source row;
  - `report_id`;
  - `github_login`;
  - `repo`;
  - `committed_at`;
  - `lines_added`, `lines_removed`;
  - `complexity`, `type`;
  - `ai_co_authored`, `ai_tool_name`, `maybe_ai`;
  - `pr_number`, `pr_title`;
  - `risk_level`;
  - `commit_message`, `impact_summary` (the range commit list shows them).
- **Index:** `(org, committed_at)`, plus `(org, github_login, committed_at)` for per-engineer readers.

**`jira_canonical`:**
- **Key:** `(org, issue_key)`.
- **Copied from the chosen `jira_issues` row:** `issue_id`, `report_id`, `github_login`, `project_key`, `issue_type`, `summary`, `description`, `status`, `labels`, `story_points`, `original_estimate_seconds`, `issue_url`, `created_at`, `resolved_at`.
- **Index:** `(org, resolved_at)`, plus `(org, github_login, resolved_at)`.

**Rules for both tables:**
- Neither table has a foreign key to `reports`. Upkeep handles deletes (below).
- Add them to `schema.sql`, `db/mysql.ts` and `db/sqlite.ts`. Never pin a charset (CLAUDE.md, `mysql-schema-fk-charset.test.ts`).
- `org` comes from `reports.org`; the source tables have no org column.

**Which copy counts (the pick rule):**
- Candidates are copies in **completed** reports of that org only.
- **Commits:** prefer a copy with non-null `complexity`, then the highest `id`. This matches today's `canonicalCommitIdsSql`.
- **Jira:** the highest `id` (the latest copy), which credits the latest assignee, as today.
- **Deliberate change:** today's range queries pick only among reports whose window overlaps the range (a PR #107 review fix). The new tables pick across all completed reports. Copies of one commit share sha, author, lines and date, so only the LLM fields can differ, and rarely. For Jira, the latest copy also wins today in practice.
- **Ruling:** accept the change and document it in CLAUDE.md.

## Upkeep

- **Report completes.** In the same transaction that sets `status = 'completed'` in `report-runner.ts`, upsert the canonical rows for every `commit_sha` and `issue_key` in that report. Re-apply the pick rule per key against all completed copies, not just "this report wins", so a newer report without an LLM score doesn't replace an older one that has one.
- **Report deleted** (`deleteReport` in `report/service.ts`): before the delete, collect the keys whose canonical row points at this report. Delete the report, re-pick those keys from the remaining completed reports, and drop keys that have no copy left. All of it happens in one transaction.
- **Anything that bypasses the app** (a direct DB import such as the GLOOK-34 backfill, manual SQL): not handled automatically. Check detects it and Rebuild fixes it. CLAUDE.md says so.
- **Rebuild:**
  - For each table, it fills a staging table, then swaps it in within one transaction. It never deletes first and then fills.
  - Approach left to the builder: MySQL `RENAME TABLE` swap, or a `DELETE` + `INSERT … SELECT` inside one transaction. The same behaviour is needed on SQLite.
  - Only one rebuild runs at a time. A second request is refused with "rebuild already running".
- **A report that completes during a rebuild** (my call): a rebuild records when it started. After the swap, and before releasing its lock, it re-applies the pick rule for every report that completed since then, so those upserts are never lost to the swap.
- **Scope of one rebuild** (my call): every org in one run, each org in its own transaction, and each org's build time recorded only when that org succeeds. A failure leaves the other orgs built and that org on the fallback path. The Check card lists results per org.
- **Before an org's first build** (my call): report completion and deletion do **not** write that org's canonical rows. Its readers use the fallback anyway, and the first Rebuild fills everything, so Check never sees a half-filled table.
- **Check:**
  - Computes the expected rows with the same pick rule in SQL.
  - Compares by key and by the chosen source id. `differ` counts keys that are missing, extra, or point at a different source row.
  - The card and the CLI list up to 20 example keys.
  - It writes nothing.

## Before the first build

- Readers must tell "not built yet" apart from "built and empty".
- **Recording a build:** a completed rebuild records the time it finished, per org, in a small settings row such as `canonical_built_at` (the builder chooses where).
- **Until then, for that org:**
  - the range and timeline readers use today's de-dupe queries, which stay in the code as the fallback;
  - the Settings card says "Not built yet — range views use the slower path".
- **Ruling:** this fallback is my call, not something the owner asked for. It is the only way to honour both "start empty" and "never show wrong figures".

## Readers that switch

| Code | Today | After |
|---|---|---|
| `report/range.ts` `getRangeDeveloperStats` | commit + Jira de-dupe | `commit_canonical` / `jira_canonical`, filtered by `org` and the date column |
| `report/range.ts` `getRangeCommits`, `getRangeJiraIssues` | de-dupe | canonical tables |
| `report/org.ts` org weekly timeline | commit de-dupe over all reports | `commit_canonical` by org |
| `report/dev.ts` engineer weekly chart | commit de-dupe by login | `commit_canonical` by org + login |
| `report/summary.ts` engineer summary history | commit de-dupe by login | `commit_canonical` by org + login |
| `mcp/queries.ts` cross-report commit query | commit de-dupe | `commit_canonical` |

**Weekly charts become completed-only** (user decision, 2026-11-06). Today the org and engineer weekly charts and the summary history de-dupe across all reports, including running and failed ones. After the switch they count only commits from completed reports, the same rule as the range figures. Today's activity appears once the day's report completes; commits found only by a failed run that was never re-run drop off. The equivalence test allows this difference for these readers.

**Keep the in-process range cache** (`warmRangeCache`, memoised `getRangeDeveloperStats`). It stays correct (keyed by the report set) and stays cheap. Removing it is left to the builder if measurements show it no longer matters.

**Report scoping today.** Range figures include commits from completed reports overlapping the window, filtered by `committed_at` inside the range. With the canonical table this becomes "commits of this org with `committed_at` in the range". The two are the same set unless a commit's only copies are in reports that don't overlap the window. That can happen only for a commit dated inside the window but found only by a report whose window lies elsewhere (for example, a commit rebased long after its author date). This is rare, and the new behaviour, which counts it, is arguably more correct. The same holds for Jira, filtered by `resolved_at`. Jira's latest-copy pick across all completed reports credits the latest assignee, as today. Accepted (my call): the equivalence test allows exactly these documented differences, and nothing else. Measured days and the developer list are unchanged; they still come from the reports.

## LLM reuse

- **Where:** in `report-runner.ts`, before `analyzeCommit(commit)` (~line 448).
- **Lookup:** find the commit's analysis in `commit_canonical` (org + sha, `complexity IS NOT NULL`).
- **Before the org's first build** (my call): no reuse. That avoids ~2,000 extra lookups per report against `commit_analyses` on a small buffer pool, and it costs only the LLM calls that AI Proxy's cache already absorbs.
- **If found:** write this report's `commit_analyses` row with the copied `complexity`, `type`, `impact_summary`, `risk_level` and `maybe_ai`, and skip the LLM call.
- **Fields always taken from the current GitHub fetch:** `ai_co_authored`, `ai_tool_name`, lines and the PR fields.
- **Progress counting:** reused commits count as analysed. Log one summary line per report, e.g. "Reused 1,412 analyses, 87 new LLM calls".
- **Prompt changes:** a changed analysis prompt template would not take effect on reused commits. That is acceptable. Note it in CLAUDE.md beside the prompt-template gotcha.

## Testing

- **Equivalence (the main test).**
  - On a SQLite fixture with overlapping reports, the canonical readers return the same figures as today's de-dupe queries for current, 90-day and 12-month windows.
  - Duplicates must appear in 3 reports, including one copy without complexity, plus a failed report.
- **Upkeep:**
  - completing a report adds and re-picks rows;
  - a newer copy without complexity doesn't replace one with complexity;
  - deleting a report re-points to a remaining copy, or removes the row when none is left;
  - failed or running reports never contribute.
- **Rebuild and Check:**
  - Rebuild on a corrupted table (missing, extra, wrong source) restores it;
  - Check reports the right `differ` before the rebuild and 0 after;
  - a rebuild that fails part-way leaves the previous table intact;
  - concurrent rebuilds are refused.
- **Fallback:** an org with no recorded build uses the old queries and produces identical results.
- **LLM reuse:** a commit analysed in an earlier completed report doesn't call the LLM (mock provider asserts no call), and its row copies the analysis fields.
- **Settings card:** admin-only (a viewer gets 403 from the API routes, and the card is not rendered), the Check and Rebuild states, and the confirmation step.
- **Performance check before switching dev:**
  - Run Check against dev RDS, read-only and with owner approval.
  - After deploying and pressing Rebuild, time a 12-month view on dev. Target: under 1s cold.

## Rollout

1. Merge and deploy. The tables are empty, so readers use the fallback and nothing changes for users.
2. The admin presses Check: "not built".
3. The admin presses Rebuild, then Check again: 0 differ.
4. Time the 12-month view.
5. **If anything is wrong:**
   - revert the readers;
   - **or** delete the `canonical_built_at` row, so the readers fall back to the old queries without a deploy.

## Left to the builder

- Exact column types, beyond mirroring the source columns.
- Where `canonical_built_at` is stored.
- The swap technique.
- API route names for Check and Rebuild (they must be wrapped in `withRequestLog` and admin-gated).
- Whether Rebuild runs in the request or in the background with progress polling (dev: about 255k source rows).
- The exact card copy.
