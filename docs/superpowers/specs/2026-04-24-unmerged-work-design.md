# Unmerged Work Tracking — Design Spec

**Date:** 2026-04-24
**Status:** Approved for implementation planning

## 1. Goal

Expose each developer's **in-flight work** — open pull requests and commits pushed to branches but not yet merged to the default branch — alongside the existing shipped-work report. Surface this on the Dev Detail page and feed it to the LLM-generated engineer summary so the model can nudge developers to finish what they've started before taking on new work.

**Non-goals:** affect impact score, PR %, AI %, complexity, or any other existing metric. Change the current data flow that feeds shipped-work stats.

## 2. Scope

### In-scope
- **Open PRs** authored by each developer, where the PR was *updated* (opened, commented on, or pushed to) during the report period. Covers the case of a 30-day-old PR that the developer pushed to this week.
- **Bare branch commits** — commits the developer authored during the report period that are not in the default branch AND not associated with any pull request (open or merged).
- Dev Detail page UI surface, admin and viewer both see it.
- LLM engineer-summary prompt integration, with explicit framing that unmerged work does not count toward impact.

### Out of scope
- Team Summary or Org Summary surface. If a manager-level view proves valuable post-launch, it's a follow-up.
- Impact score contribution. Explicitly excluded per requirement.
- Branch enumeration across all repos in the org. We use per-engineer GitHub search to avoid 600+-repo sweeps.
- Draft-vs-open PR differentiation in the LLM prompt (draft state is captured in the data but treated the same in the summary).

## 3. Data model

One new table. No changes to existing tables.

```sql
CREATE TABLE unmerged_work (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  report_id         VARCHAR(36)  NOT NULL,
  github_login      VARCHAR(255) NOT NULL,
  kind              ENUM('open_pr','bare_branch_commit') NOT NULL,
  repo              VARCHAR(255) NOT NULL,

  -- open_pr fields (null for bare_branch_commit)
  pr_number         INT          NULL,
  pr_title          VARCHAR(500) NULL,
  pr_url            VARCHAR(500) NULL,
  is_draft          BOOLEAN      NULL,
  pr_commits        INT          NULL,
  pr_additions      INT          NULL,
  pr_deletions      INT          NULL,
  pr_created_at     TIMESTAMP    NULL,
  pr_updated_at     TIMESTAMP    NULL,

  -- bare_branch_commit fields (null for open_pr)
  commit_sha        VARCHAR(40)  NULL,
  commit_message    TEXT         NULL,
  branch_name       VARCHAR(255) NULL,
  commit_additions  INT          NULL,
  commit_deletions  INT          NULL,
  committed_at      TIMESTAMP    NULL,

  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_unmerged (report_id, kind, repo, pr_number, commit_sha)
);
```

**Design choices:**
- **Single table with `kind` discriminator** rather than two tables. Same consumer, same lifecycle, only the payload differs. Query stays simple: `WHERE report_id=? AND github_login=?`.
- **NULLable fields** for `kind`-specific columns, keeping payload slim for each row.
- **`ON DELETE CASCADE`** from `reports` so deleting a report cleans up in-flight data automatically (mirrors `developer_stats`, `commit_analyses`).
- **Wiped per-report** — each report generation starts fresh. No cumulative history; the report is a point-in-time snapshot.

Added via auto-migration in `src/lib/db/mysql.ts` and `src/lib/db/sqlite.ts` (the SQLite variant uses `INTEGER`/`TEXT` column types per the existing translator). The schema is additive — safe for existing DBs.

## 4. Fetch flow (report runner)

All work slots into the existing per-member loop in `src/lib/report-runner.ts`, immediately after `countReviewedPRs`:

### Step 4.1 — Fetch open PRs per developer

New GitHub provider method `fetchOpenPRs(org, login, since)` that runs a search:

```
org:{ORG} author:{LOGIN} is:pr is:open updated:>={SINCE_ISO}
```

Each result gives `{ number, title, html_url, draft, repo, created_at, updated_at }`. Additional per-PR detail (`commits`, `additions`, `deletions`) requires `GET /repos/{owner}/{repo}/pulls/{number}` — one call per PR. Typical developer has 0-5 open PRs in a period, so this is bounded.

### Step 4.2 — Detect bare branch commits

For every commit already returned by `searchUserCommits` (which indexes commits across all refs, including feature branches):

1. **Skip if `commit.prNumber` is set** — the existing code already matches commits to PRs via message pattern (`(#N)` / `Merge pull request #N`). Matched commits belong to a PR (merged or open). They're either already captured in shipped stats (merged) or already captured in Step 4.1 (open PR).
2. **Otherwise call `GET /repos/{owner}/{repo}/compare/{default_branch}...{sha}`**:
   - Status `ahead` or `diverged` → commit is NOT in default branch → **bare branch commit**. Record it.
   - Status `identical` or `behind` → commit IS in default branch → drop (it's already in shipped stats).
3. The default branch name is fetched lazily per-repo and cached for the duration of the run (similar to how `prBodyCache` works for AI detection).

### Step 4.3 — Persist

`INSERT IGNORE INTO unmerged_work (...)` for each open PR and each bare branch commit. Uses the same pool, same `db.execute` prepared-statement pattern as existing code.

### Rate-limiting & parallelization
- Open-PR search: one extra search call per member. Fits into existing 2.5s sleep cadence.
- Bare-branch compare: called inside the `p-limit`-bounded async loop that already wraps LLM analysis. Parallelism limit is `LLM_CONCURRENCY` (default 5) — not ideal for GitHub calls but it's what's there. Follow-up could add a dedicated GitHub `p-limit`.
- Expected budget: ~5-15 compare calls per dev × ~65 devs = ~300-1000 calls. At 2.5s pacing sequentially that's 12-40 min; parallelized it's 2-8 min.

### Failure handling
- Open-PR fetch failure (per-user try/catch): log, continue, set `openPrs = []` for that user. Don't fail the report.
- Bare-branch compare failure (per-commit): log, skip, don't insert. Ensures one flaky API call doesn't block the whole report.
- All DB writes use `INSERT IGNORE` for idempotence on resume.

## 5. Dev Detail page

New collapsible section on `src/app/report/[id]/dev/[login]/page.tsx`, positioned below the existing **Recent Commits** block:

```
In-flight Work  (shows count: e.g., "4 open PRs · 7 branch commits")

┌─ Open Pull Requests ─────────────────────────────────────────┐
│ 📝 Refactor auth module              repo/auth    23d · +284/-112 │
│ 🚧 [DRAFT] Fix race in billing       repo/billing  3d · +47/-12   │
│ 📝 ...                                                        │
└──────────────────────────────────────────────────────────────┘

┌─ Branch Commits (not in default branch) ─────────────────────┐
│ fix: typo in migration               repo/app    5d · +1/-1  │
│ wip: try new caching strategy        repo/auth   2d · +120/-3 │
└──────────────────────────────────────────────────────────────┘
```

### Data
- Lives in API response: `/api/report/[id]/dev/[login]` returns a new top-level key `unmergedWork: { openPrs: [...], branchCommits: [...] }` (shape matches DB rows).
- Fetched by `getDevReport` via single `SELECT ... FROM unmerged_work WHERE report_id=? AND github_login=?`.

### Behavior
- Section is hidden entirely when both lists are empty.
- Each open PR row links to `pr_url` (GitHub), draft state shown as a `🚧 [DRAFT]` prefix or badge.
- Each branch commit row links to the commit on GitHub (`https://github.com/{org}/{repo}/commit/{sha}`).
- Sort: both lists by most recent activity descending (`pr_updated_at` / `committed_at`).
- Age rendered as "3 days ago" via existing `formatRelativeTime` helper.
- No auth gating — this is non-sensitive work-in-progress info the developer themselves benefits from seeing. Visible to all viewers.

## 6. LLM prompt integration

Modifies `src/app/api/report/[id]/dev/[login]/summary/route.ts`. Adds a new block to the user prompt after the existing stats section:

```
Work in flight (NOT counted in impact score — these are unmerged):
- Open PRs: 4
  - "Refactor auth module" (opened 23 days ago, last updated 2 days ago)
  - "Fix race in billing" (opened 3 days ago, draft)
  - ... [up to 5, rest summarized as "+ N more"]
- Commits on unmerged branches: 7 across 3 repos
  - Most recent: "wip: try new caching strategy" (5 days ago)
  - ... [up to 3]

If this developer has substantial in-flight work AND modest shipped impact,
nudge them: suggest they finish existing work before starting new.
If in-flight work is minimal or their shipped impact is already strong, do not mention it.
Explicitly: in-flight work is NOT reflected in the impact score.
```

**Why user-prompt and not system-prompt:** per-dev data belongs in the user prompt (matches how existing stats are injected). The system prompt stays general.

**Dropped from prompt:** full list of 10+ PRs would be noise. Cap at 5 PRs and 3 commits; summarize the rest as counts.

**Token impact:** ~50-150 tokens added per summary. Negligible vs existing ~3K-token prompt.

## 7. Testing

- **Unit tests** for the new GitHub provider method (`fetchOpenPRs`) with a mock API.
- **Unit tests** for the bare-branch classification logic (given a commit + compare-status, returns `bare | shipped`).
- **Integration test** in `report-runner.test.ts` verifying that `unmerged_work` rows are inserted for open PRs and bare branch commits, and that *existing* `developer_stats` remains unchanged when unmerged data exists.
- **Snapshot test** for the dev summary prompt template to catch accidental wording changes.
- **No UI e2e needed** — the component is straightforward list rendering.

## 8. Mock data & seed

- `scripts/mock-identities.ts`: add a small list of fake open PRs and bare-branch commits per identity.
- `scripts/seed-data.ts`: populate `unmerged_work` for seed reports.
- `src/lib/github-mock.ts`: add `fetchOpenPRs` returning fixture data; add mock `compare` returning `ahead` for a deterministic subset of commits.

## 9. Rollout

- **No feature flag** — the feature is additive (new table, new API key, new UI section that only renders when non-empty). Behaves as a no-op for existing reports (no data) and gracefully degrades if the GitHub calls fail.
- **No data migration** — existing reports simply have no `unmerged_work` rows; the UI section hides automatically.
- **Auto-migration** creates the table on server startup (matches existing pattern in `mysql.ts`).

## 10. Open questions resolved during brainstorm

| Question | Decision |
|---|---|
| What counts as "unmerged work"? | Open PRs + bare branch commits (Option B) |
| Per-engineer or per-repo fetch? | Per-engineer — matches existing architecture |
| Period semantics? | Any open PR with activity during the period (Option B) |
| UI placement? | Dev Detail page only (Option A) — no Team/Org surface |
| LLM integration? | Context-only injection with explicit "doesn't count toward impact" framing (Option A) |

## 11. Follow-ups / explicitly deferred

- **Team Summary column** for in-flight work counts. Build only if managers ask for it.
- **Org-level stale-PRs tile** showing oldest open PRs org-wide.
- **Dedicated nudge field** in the summary schema (Option B from brainstorm). Revisit if Option A's nudges feel too diluted by general narrative.
- **Dedicated GitHub `p-limit`** separate from `LLM_CONCURRENCY`. Worth doing if fetch time becomes painful.
- **Stale-branch detection without a PR** beyond the report period (dangling WIP). Would need branch enumeration, deferred.
