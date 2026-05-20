# GLOOK-7 — Team Pulse: include in-flight work

## Goal

The Team Pulse AI summary currently describes only what a team **shipped** in the period. Extend it so the same summary also describes what the team is **currently working on** — open PRs and unmerged branches — woven into the existing narrative.

The data already exists in the report snapshot (`unmerged_prs`, `unmerged_commits` tables, populated by the report runner). This feature is a small data-extension + prompt change. No UI work.

## Non-goals

- **No frontend change.** TeamPulseCard already renders Markdown; the new content arrives naturally through the LLM output.
- **No new headings or structured sections in the Markdown.** Per user preference, the LLM weaves in-flight context into the existing "Team Focus" and "Alerts" sections.
- **No in-progress Jira.** Initially scoped in, then explicitly removed by the user — only signals already in the report snapshot are used.
- **No new API endpoint or background fetch.** Existing `/api/report/[id]/team-pulse` route is the surface; new data is gathered inside `gatherTeamPulseData` from existing tables.
- **No per-PR / per-branch detail.** Counts, top-N by repo, top-N by author, and aging stats only. The LLM doesn't need PR titles or branch names to produce a useful narrative.

## Architecture

```
TeamPulseCard ──► /api/report/[id]/team-pulse
                       │
                       ▼
                 team-pulse/service.ts
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        cache      data.ts     LLM call
        check        │
                     │  (extended in this change)
                     ├── existing aggregations (members, windows, etc.)
                     ├── shipped Jira (already)
                     └── NEW: in-flight (open_prs, unmerged_branches)
                          from unmerged_prs & unmerged_commits tables
```

The single change is inside `data.ts`. The service layer composes an enriched prompt input and the existing LLM call carries it through.

## Files touched

- **Modify** `src/lib/team-pulse/data.ts` — add `gatherInflight()` and extend the `TeamPulseInput` interface with the new `inflight` field.
- **Modify** `src/lib/team-pulse/prompt.ts` — add the new placeholder values to the JSON variables map.
- **Modify** `prompts/team-pulse-system.txt` — add the IN-FLIGHT WORK context block + one rule instructing the model to weave it into Team Focus and Alerts.
- **Modify** `src/lib/team-pulse/service.ts` — add `PROMPT_VERSION = 'v2-inflight'` constant, include it in the cache SELECT and INSERT.
- **Modify** schema: `src/lib/db/mysql.ts` and `src/lib/db/sqlite.ts` — add `prompt_version VARCHAR(16) NOT NULL DEFAULT 'v1'` column to `team_pulse_summaries`.
- **New** `src/lib/__tests__/unit/team-pulse-inflight.test.ts` — covers the new aggregation and the prompt builder.
- **Snapshot update** — `prompts/team-pulse-system.txt` has a snapshot test (per CLAUDE.md). Update via `npm test -- -u` after editing.

## Data shape

```ts
// Added to TeamPulseInput (src/lib/team-pulse/data.ts)
inflight: {
  open_prs: {
    total: number;
    draft: number;
    ready: number;
    by_author: { login: string; count: number }[];   // top 5, descending
    by_repo:   { repo: string;  count: number }[];   // top 3, descending
    oldest_days: number;        // max(now - updated_at) across open PRs; 0 if none
    lines_added: number;        // sum across open PRs
    lines_removed: number;
  };
  unmerged_branches: {
    total_branches: number;     // distinct branch refs across team
    total_commits: number;      // sum of unmerged commits across the team
    // no by_author / by_repo for branches — totals only.
    // Open-PR distribution captures "who's working on what" for the LLM;
    // adding branch-level distribution is noise.
  };
};
```

### Aggregation rules

- **Team scope**: rows are filtered by `author_login IN (team_members)`. The team member list comes from the existing `team_members` table query already in the team-pulse pipeline.
- **Author identity**: GitHub login (the existing `unmerged_prs.author_login` / `unmerged_commits.author_login` column).
- **Top-N**: by_author limited to top 5; by_repo limited to top 3. Ties broken alphabetically. Same convention used elsewhere in the codebase where we surface "top contributors" in a narrative context.
- **Drafts**: `unmerged_prs.is_draft` boolean already populated by the report runner.
- **`oldest_days`**: derived from `unmerged_prs.updated_at`. If zero open PRs, set to `0`.
- **Empty-team / no-data case**: the entire `inflight` block is still emitted, with zeros and empty arrays. The prompt template's placeholders never become empty strings — the rendered prompt should never have a `{{X}}` orphan.

### Prompt template changes

Add the block below right after the existing `PER-MEMBER DATA:` section in `prompts/team-pulse-system.txt`:

```
IN-FLIGHT WORK (snapshot at report time):
- Open PRs: {{INFLIGHT_PR_TOTAL}} ({{INFLIGHT_PR_DRAFT}} draft, {{INFLIGHT_PR_READY}} ready); oldest {{INFLIGHT_PR_OLDEST_DAYS}}d; {{INFLIGHT_PR_LINES_ADDED}}/-{{INFLIGHT_PR_LINES_REMOVED}} lines
- Unmerged branches: {{INFLIGHT_BRANCH_COUNT}} branches, {{INFLIGHT_BRANCH_COMMITS}} commits
- In-flight by repo:   {{INFLIGHT_BY_REPO}}
- In-flight by author: {{INFLIGHT_BY_AUTHOR}}
```

Add one rule to the existing `RULES:` list:

```
- Use IN-FLIGHT WORK to enrich Team Focus (what they're currently working on alongside what shipped)
  and Alerts (flag PRs open >5 days, large in-flight diffs needing review).
  Do NOT add a new heading; integrate naturally into the existing sections.
```

### Prompt builder change (`prompt.ts`)

Extends the JSON variables map with:

```ts
{
  ...existing,
  INFLIGHT_PR_TOTAL:          inflight.open_prs.total,
  INFLIGHT_PR_DRAFT:          inflight.open_prs.draft,
  INFLIGHT_PR_READY:          inflight.open_prs.ready,
  INFLIGHT_PR_OLDEST_DAYS:    inflight.open_prs.oldest_days,
  INFLIGHT_PR_LINES_ADDED:    inflight.open_prs.lines_added,
  INFLIGHT_PR_LINES_REMOVED:  inflight.open_prs.lines_removed,
  INFLIGHT_BRANCH_COUNT:      inflight.unmerged_branches.total_branches,
  INFLIGHT_BRANCH_COMMITS:    inflight.unmerged_branches.total_commits,
  INFLIGHT_BY_REPO:           join(inflight.open_prs.by_repo,   r => `${r.repo} (${r.count})`),
  INFLIGHT_BY_AUTHOR:         join(inflight.open_prs.by_author, a => `@${a.login} (${a.count})`),
}
```

`INFLIGHT_BY_REPO` and `INFLIGHT_BY_AUTHOR` are derived from **open PRs only** (since the open-PR distribution captures "who's working on what" sufficiently for the narrative; branch-level distribution adds noise). One-line, comma-joined, e.g. `"frontend (4), api (2), data (1)"`.

When `inflight.open_prs.total === 0`:
- `INFLIGHT_BY_REPO` and `INFLIGHT_BY_AUTHOR` render as the literal string `"none"`.
- All count placeholders render as `0`.

## Cache invalidation

`team_pulse_summaries` is keyed on `(report_id, team_name)`. After this change, any pre-existing cached summary was produced by the old prompt and would mislead users.

Strategy: add a `prompt_version VARCHAR(16) NOT NULL DEFAULT 'v1'` column. Set `const PROMPT_VERSION = 'v2-inflight';` in `service.ts`. Include the version in the SELECT lookup and INSERT/UPDATE.

- Old rows survive as historical records but never satisfy the new SELECT (they're `'v1'`).
- The first access to any team's pulse after deploy is a cache miss → regenerates with the new prompt → inserts a `v2-inflight` row.
- Subsequent prompt iterations just bump the constant; no migration needed each time.

## Testing

| Layer | What | Where |
|---|---|---|
| Unit — aggregation | `gatherInflight()` against a seeded SQLite DB. Cases: counts (PR total, draft/ready split, branch totals), `oldest_days` math, `by_repo` & `by_author` top-N with ties, empty-team (no open PRs, no branches) returns zeroed struct with empty arrays. | `src/lib/__tests__/unit/team-pulse-inflight.test.ts` (new) |
| Unit — prompt builder | `buildTeamPulsePrompt(input)` with a representative `inflight` block produces the expected joined-string placeholder values. Empty case produces `"none"`. | Same test file |
| Snapshot — prompt | Existing snapshot test on `prompts/team-pulse-system.txt`; updated via `npm test -- -u`. Reviewer confirms the diff. | Existing snapshot infra |
| LLM call | Not unit-tested. Stochastic and remote. Existing mocking pattern is unchanged. | n/a |

## Open question (non-blocking)

- The `inflight.open_prs.oldest_days` metric is derived from `updated_at`. Should it instead be `created_at` (true PR age) or `min(updated_at)` interpretation? Recommendation in v1: stick with `updated_at` since the existing `unmerged_prs` table populates this from GitHub's `pull_request.updated_at`, which already reflects the last activity. Trivial to swap later.
