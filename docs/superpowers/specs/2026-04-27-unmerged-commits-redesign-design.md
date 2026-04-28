# Unmerged Work Redesign — Per-commit Data via Events Feed

**Date:** 2026-04-27
**Status:** Pending review
**Supersedes:** the bare-branch detection path in `2026-04-24-unmerged-work-design.md` and the open-PR overlay in `2026-04-25-unmerged-work-org-charts-design.md`

## 1. Goal

Replace the current aggregate-level in-flight tracking with **per-commit** in-flight data, so the org charts (`Commits / Week`, `Lines Changed / Week`, pie, stacked types) reflect commit volume at the actual `committed_at` date rather than at the PR's `pr_updated_at`. Catches both **commits in open PRs** and **commits on non-default branches without a PR** — neither of which is visible to the existing `searchUserCommits` pipeline.

## 2. Why this redesign

Empirically verified: GitHub's commit search API (`/search/commits`) only indexes the **default branch** of each repo. Confirmed by:
- GitHub's official REST docs: *"Find commits via various criteria on the default branch (usually main)."*
- Direct hash lookups: PR commits returning HTTP 200 from `repos/X/Y/commits/{sha}` (the commit exists in the repo) but `0` results from `search/commits?q=hash:SHA` (not in the search index).
- Aggregate test: `dsavchenko-sm` has 107 commits in an open PR in `context-core-services`; `searchUserCommits` returns exactly 1 commit in that repo across 4 months.

Implication: every commit on a non-default branch — whether sitting in an open PR or just a WIP push without a PR — is **invisible to `commit_analyses`**. The existing "bare-branch" detection in `2026-04-24-unmerged-work-design.md` was running against an empty input and finding 0 by construction. The "open PR overlay" in `2026-04-25-unmerged-work-org-charts-design.md` worked around this by aggregating `pr_commits` counts, but bucketed everything under `pr_updated_at` instead of true commit dates.

## 3. Scope

### In-scope

- **New `unmerged_commits` table** — per-commit rows with real `committed_at`, `lines_added`, `lines_removed`. One row per (report_id, repo, commit_sha).
- **Rename `unmerged_work` → `unmerged_prs`**, drop the `kind` discriminator and the (always-empty) bare-branch fields. Keeps PR-level metadata (`pr_title`, `pr_url`, `is_draft`, `pr_created_at`, `pr_updated_at`, `pr_commits`, `pr_additions`, `pr_deletions`) used by the KPI card and the dev-page "Open Pull Requests" list.
- **New per-engineer fetch flow** integrated into the existing per-member loop in `report-runner.ts`:
  - For each open PR: fetch its commits via `pulls/{N}/commits`.
  - For each non-default branch found via the user events feed (and not already covered by an open PR): fetch its commits via `compare(default...branch_head)`.
  - For each unique SHA across both sources: fetch authoritative line counts via `repos/X/Y/commits/{sha}`.
  - INSERT into `unmerged_commits`.
- **Org chart overlay** sources from `unmerged_commits`, bucketed by `WEEK(committed_at, MONDAY)`.
- **Failure isolation**: per-engineer try/catch wraps the unmerged-work fetch. Failure logs and skips that engineer's unmerged data without affecting the main report's `developer_stats` / `commit_analyses` / impact score.

### Out of scope

- LLM analysis of unmerged commits. They get `type='in_flight'` implicitly when org-chart aggregator counts them. No `complexity`, `type`, `impact_summary` fields stored.
- Per-engineer pagination beyond GitHub's 300-event/90-day events feed limit. Active engineers may have unmerged work older than 90 days that won't be discoverable; we accept this for a 14-day report period.
- Backfilling old reports — once the table changes ship, existing reports lose their unmerged data until they're regenerated. Old data is transient by design (per-report snapshot, never queried across reports).

### Explicitly preserved

- `commit_analyses`, `developer_stats`, impact score, and the existing default-branch fetch (`searchUserCommits` → `fetchUserActivity`) — completely untouched. The user explicitly asked for the unmerged flow to be separate from the main flow that's known reliable.

## 4. Schema

### New table: `unmerged_commits`

```sql
CREATE TABLE unmerged_commits (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,    -- commit author's GitHub login (engineer being processed)
  repo            VARCHAR(255) NOT NULL,
  branch          VARCHAR(255) NULL,        -- e.g., 'feature/foo' (no refs/heads/ prefix). NULL when not determinable.
  pr_number       INT          NULL,        -- non-null when the commit is in an open PR
  commit_sha      VARCHAR(40)  NOT NULL,
  commit_message  TEXT         NULL,
  lines_added     INT          NOT NULL DEFAULT 0,
  lines_removed   INT          NOT NULL DEFAULT 0,
  committed_at    TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_unmerged_commit (report_id, repo, commit_sha)
);
```

`UNIQUE (report_id, repo, commit_sha)` allows `INSERT IGNORE` for idempotence when the same SHA is observed via multiple paths (e.g., PR + push event).

### Renamed table: `unmerged_prs`

Schema-equivalent to the current `unmerged_work` table with `kind`-related fields removed. PR-only payload:

```sql
CREATE TABLE unmerged_prs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  report_id        VARCHAR(36)  NOT NULL,
  github_login     VARCHAR(255) NOT NULL,
  repo             VARCHAR(255) NOT NULL,
  pr_number        INT          NOT NULL,
  pr_title         VARCHAR(500) NULL,
  pr_url           VARCHAR(500) NULL,
  is_draft         BOOLEAN      NULL,
  pr_commits       INT          NULL,
  pr_additions     INT          NULL,
  pr_deletions     INT          NULL,
  pr_created_at    TIMESTAMP    NULL,
  pr_updated_at    TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_unmerged_pr (report_id, repo, pr_number)
);
```

### Migration approach

- `mysql.ts` and `sqlite.ts` schema constants: drop `unmerged_work` table, create `unmerged_prs` and `unmerged_commits`.
- All existing reports lose their unmerged-work data. Acceptable per scope discussion — reports are short-lived snapshots.
- No need for a multi-stage rename; the `unmerged_work` table has only ever been populated under the now-superseded design and was never wired into anything user-visible beyond the in-flight overlay we're replacing.

## 5. Pipeline (`report-runner.ts`)

The new fetch fits into the existing per-engineer loop **after** the existing `fetchOpenPRs` call. Each step is wrapped in its own try/catch — a failure at any step logs and skips, never breaking the main report flow.

```
For each member (engineer) in the per-member loop:

  // ── Existing main flow (UNTOUCHED) ──
  activity      = fetchUserActivity(org, login, since)   // default-branch commits → commit_analyses
  reviewCounts  = countReviewedPRs(org, login, since)
  openPrs       = fetchOpenPRs(org, login, since)        // populates unmerged_prs (renamed from unmerged_work)

  // ── NEW unmerged-commits flow (separate path, separate table) ──
  try {
    // (1) Open-PR commits — known set from openPrs above
    prCommitSummaries = []
    for each pr in openPrs:
      commits_raw = pulls/{N}/commits paginated      // SHA, message, committed_at, no lines
      filter to commits authored by `login` (the engineer)
      prCommitSummaries.push({ pr, commits_raw })

    // (2) Branch-without-PR commits via events feed
    events = users/{login}/events/orgs/{org} paginated up to 300 events
    pushes = events where type=='PushEvent' and ref ≠ default_branch_of(repo)
    prRefs = set of refs already covered by openPrs
    orphanRefs = unique(repo, ref) in pushes minus prRefs

    branchCommitSummaries = []
    for each (repo, ref) in orphanRefs:
      head_sha = look up branch's current head (last PushEvent for that ref OR via /repos/X/Y/branches/{ref})
      compare = repos/X/Y/compare/{default}...{head_sha}
      filter compare.commits to commits authored by `login`
      branchCommitSummaries.push({ repo, ref, commits })

    // (3) Dedupe SHAs across (1) and (2)
    uniqueShas = dedupe([...prCommitSummaries.commits, ...branchCommitSummaries.commits])

    // (4) Per-commit lines fetch (parallelized via existing p-limit)
    for each sha in uniqueShas:
      detail = repos/X/Y/commits/{sha}              // additions, deletions
      INSERT IGNORE INTO unmerged_commits
        (report_id, github_login, repo, branch, pr_number,
         commit_sha, commit_message, lines_added, lines_removed, committed_at)
  } catch (err) {
    log("@${login} unmerged-fetch failed: ${err}")
    // continue to next member
  }
```

### Author filtering

The events feed shows pushes by the engineer (the actor pushing). But the COMMITS within a push may have been authored by anyone — e.g., they pushed someone else's commits, or a merge commit. Same with PR commits and `compare` results. We MUST filter to commits where `commit.author.login === engineer.login` (or fallback to email match) so each engineer only "owns" their own commits in `unmerged_commits`. This mirrors the same identity model used by `searchUserCommits` for the default-branch path.

### `pulls/{N}/commits` quirk

This endpoint returns up to 250 commits regardless of pagination — the GitHub docs note this. PRs with > 250 commits are rare; if encountered we log a warning and store the first 250.

### Events feed quirks

- Returns up to 300 events across all event types in the last 90 days (GitHub-imposed limits).
- Events on private repos require the token to have `repo` scope and access to those repos. Smartling's existing token already has this (it's used for `searchUserCommits` on private repos today).
- `PushEvent` payload includes the head SHA for the push but truncates to ≤ 20 commits per event. We don't trust the embedded commits list — we use the events feed only to **discover branches**; the actual commit list comes from the `compare` call.

## 6. Org chart overlay (replaces 2026-04-25 design)

`getOrgReport` no longer reads from `unmerged_work` for chart overlay. Instead:

```sql
SELECT committed_at, lines_added, lines_removed
FROM unmerged_commits
WHERE report_id = ?
```

Bucket each row by week (Monday-anchored, same logic as `aggregateWeekly`). For each bucket:
- `commits += 1`
- `linesAdded += lines_added`
- `linesRemoved += lines_removed`
- `linesP95Added += lines_added`, `linesP95Removed += lines_removed`
- `types.in_flight = (types.in_flight || 0) + 1`
- `inFlightLinesAdded += lines_added`, `inFlightLinesRemoved += lines_removed`

If a week didn't exist in the timeline (no shipped commits that week), create the bucket — same logic as today.

The KPI card data still comes from a separate aggregation query, but now uses `unmerged_prs` for the open-PR side and a derived count from `unmerged_commits` for the bare-branch side:

```sql
SELECT
  (SELECT COUNT(*)              FROM unmerged_prs     WHERE report_id = ?) AS openPrCount,
  (SELECT COUNT(DISTINCT login) FROM unmerged_prs     WHERE report_id = ?) AS openPrDevCount,
  (SELECT COUNT(*)              FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareBranchCommitCount,
  (SELECT COUNT(DISTINCT login) FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareBranchDevCount,
  (SELECT COALESCE(SUM(lines_added),0)   FROM unmerged_commits WHERE report_id = ?) AS inFlightLinesAdded,
  (SELECT COALESCE(SUM(lines_removed),0) FROM unmerged_commits WHERE report_id = ?) AS inFlightLinesRemoved
;
```

(Pseudocode — actual implementation will use a single multi-aggregation query for efficiency.)

## 7. Dev Detail page

The existing "In-flight Work" section currently shows two sub-blocks:
1. **Open Pull Requests** — sourced from `unmerged_work` `kind='open_pr'`. Continues to source from `unmerged_prs` (renamed). No UI change.
2. **Branch Commits (not in default branch)** — currently sourced from `unmerged_work` `kind='bare_branch_commit'` (always empty in practice). Now sourced from `unmerged_commits WHERE pr_number IS NULL AND github_login = ?`. Will populate properly for the first time. Each row shows commit SHA, message, repo, lines, age — same shape as today.

The dev API (`getDevReport`) updates its query accordingly — read from `unmerged_prs` and `unmerged_commits` instead of the old `unmerged_work`.

## 8. LLM summary prompt

Currently the engineer summary prompt receives a `formatUnmergedWorkSection` block built from the same `unmerged_work` data. Switch to:
- Open PRs: same shape as today, sourced from `unmerged_prs`.
- Bare-branch commits: now actually populated. Sourced from `unmerged_commits WHERE pr_number IS NULL AND github_login = ?`.

The framing in the prompt stays unchanged: *"Work in flight (NOT counted in impact score — these are unmerged): ..."*

## 9. Cost analysis

Per-engineer per-report:

| Operation | Calls | Notes |
|---|---|---|
| `users/{login}/events/orgs/{org}` (events feed) | 1-3 (paginated) | New |
| `pulls/{N}/commits` (per open PR) | ~3 | Cheap, paginated 100/page |
| `compare` (per orphan branch) | ~5 | Engineers typically have <10 active non-default branches |
| `repos/X/Y/commits/{sha}` (per unique unmerged SHA) | **~50 avg, ~200 max** | The dominant cost |

For a Smartling-sized org (~65 engineers): ~3,250 `getCommit` calls. With `p-limit` of 5 and 2.5s pacing per worker: ~25-30 min added to report runtime.

Acceptable trade-off given the user's explicit ask for reliable line counts.

## 10. Testing

- **Unit tests** in `src/lib/__tests__/unit/`:
  - `github-fetch-user-events.test.ts` — new GitHub provider method `fetchUserOrgEvents` with mocked octokit.
  - `github-list-pr-commits.test.ts` — `fetchOpenPrCommits` per PR.
  - `github-compare-branch-commits.test.ts` — branch-vs-default compare.
  - `unmerged-commits-fetch.test.ts` — the new combined fetch logic in report-runner (mocked github calls, asserts INSERTs).
  - `org-unmerged-overlay.test.ts` — `getOrgReport` overlays from `unmerged_commits` correctly.
- **Integration test** in `report-runner.test.ts` — extend the existing test with mocked `fetchUserOrgEvents` returning a known set of pushes; assert `unmerged_commits` rows are inserted with correct `committed_at` and `lines_added`.
- **Snapshot test** — the LLM prompt's bare-branch block should now show real data when fed sample rows.

## 11. Manual verification (final task)

The user's standing TODO from the previous spec (§8 of `2026-04-24-unmerged-work-design.md`) carries over:
1. Create a branch in `glooker` with a commit, push without opening a PR.
2. Run a fresh report locally.
3. Confirm the commit appears in the dev's "Branch Commits" list AND in the org `Commits / Week` chart at the commit's actual `committed_at` date.
4. Confirm bare-branch KPI count is ≥ 1 and the chart shows an amber `in_flight` slice/layer in the relevant week.
5. Open a PR from a feature branch (without merging). Confirm the PR's commits show up under their actual `committed_at` dates, not lumped at `pr_updated_at`.

## 12. Open questions resolved during brainstorm

| Question | Decision |
|---|---|
| Schema: extend `unmerged_work` or new table? | New `unmerged_commits` table; rename `unmerged_work` → `unmerged_prs` and drop unused fields |
| LLM analysis on unmerged commits? | No |
| Pipeline placement? | Integrated in the existing per-engineer loop, fenced via try/catch |
| Per-commit line accuracy? | Real lines via `repos/X/Y/commits/{sha}` per commit (no proportional estimation) |
| Bucket date for chart overlay? | Real per-commit `committed_at` (replaces the previous design's `pr_updated_at`) |

## 13. Follow-ups / explicitly deferred

- **GitHub Enterprise events feed access on private repos** — needs runtime verification on first deploy. If events feed returns sparse data due to token scopes, fall back to per-PR-only path until token is updated.
- **Per-engineer events feed rate limiting** — events endpoint is part of GitHub's primary rate limit. Should be fine with existing pacing.
- **Engineers with > 300 events in the 90-day window** — they'll lose visibility on older orphan branches. Acceptable for a 14-day report; revisit if active engineers regularly hit this cap.
