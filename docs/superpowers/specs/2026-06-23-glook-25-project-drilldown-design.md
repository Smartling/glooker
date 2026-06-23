# GLOOK-25: Project Drill-Down

## Goal

Let users click any project card on the home page to see the exact Jiras, PRs, and commits the LLM attributed to that project — with Jiras grouped by epic theme.

## POC Findings

Validated during brainstorming (June 2026):

1. **Sending all data to the LLM works.** Sending all 733 commits + 303 PRs + 362 Jiras (~200K tokens) produces better clustering than the previous Jira-only approach. The LLM uses commit messages (which contain Jira keys) to correlate PRs and commits to projects. A new project — "Jobs Service & MT Router" (52 jiras, 55 PRs) — only emerged when commit data was included.

2. **LLM should enumerate what it attributed.** The prompt asks the LLM to return `jira_keys`, `groups` (epic themes), `pr_numbers`, and `commit_shas` per project. The backend enriches those keys/numbers with full DB details.

3. **Jira key as attribution signal.** Each Jira key and PR number appears in exactly one project (enforced by prompt). The DB enrichment joins `jira_keys` → full issue details and `pr_numbers` → commit rows.

4. **Inline expand (not modal).** Clicking a project row opens an inline panel below it with three tabs: Jiras / PRs / Commits. Other projects remain visible.

---

## Architecture

### Prompt changes (`src/app/api/project-insights/route.ts`)

**New data sent:**
- Replace "top 30 no-Jira commits" with **all commits** (`commit_sha|pr_number|repo|login|message|+add/-remove`)
- Add **PR summaries** (`pr_number|repo|login|commit_count|+add/-remove|first_message`)

**New fields returned per project:**
```json
{
  "jira_keys": ["PROJ-123"],
  "groups": [{ "name": "Theme Name", "jira_keys": ["PROJ-123"] }],
  "pr_numbers": [101, 102],
  "commit_shas": ["abc1234"]
}
```

**Token limit:** bump to 12000 (response is larger due to enumerated keys/numbers).

### Backend enrichment

After LLM response:
1. `jira_keys` → join to `jira_issues` → full `jira_details` (key, summary, type, assignee)
2. `groups[].jira_keys` → same enrichment within each group
3. `pr_numbers` → look up commits by `pr_number` in `commit_analyses` → dedupe into PR rows (pr, repo, login, commit_count, lines_added, lines_removed, first_message)
4. `commit_shas` (bare commits, no PR) → look up by SHA in `commit_analyses`
5. Fetch all commits (`commit_analyses`) once at start, indexed by SHA and pr_number

Stored in cache as `{ _v: 3, projects, untracked_work }` — bump version to invalidate v2 rows.

### Data types (`src/components/ProjectsCard.tsx`)

Extend `ProjectsCardItem`:

```typescript
export interface JiraDetail {
  key: string;
  summary: string;
  type: string | null;
  assignee: string | null;
}

export interface ProjectGroup {
  name: string;
  jira_details: JiraDetail[];
}

export interface PrDetail {
  pr: number;
  repo: string;
  login: string;
  msg: string;
  commits: number;
  added: number;
  removed: number;
}

export interface CommitDetail {
  sha: string;
  repo: string;
  login: string;
  msg: string;
  pr: number | null;
  added: number;
  removed: number;
}

// Add to ProjectsCardItem:
jira_details?: JiraDetail[];
groups?: ProjectGroup[];
prs?: PrDetail[];
commits?: CommitDetail[];
```

### Frontend (`src/components/ProjectsCard.tsx`)

`ProjectsBody` renders each project row. When a project has `jira_details` or `prs` or `commits`, the row becomes expandable:

- Click the row → toggle inline expand panel below
- Expand panel has three tabs: **Jiras** / **PRs** / **Commits**
- **Jiras tab**: groups shown as collapsible sections (epic name + issue list). Each issue shows key, summary, assignee avatar. If no groups, flat list.
- **PRs tab**: list of PRs (number, first message truncated, repo, author avatar, commit count, +lines/-lines)
- **Commits tab**: list of commits (7-char SHA, message, PR badge if linked, author avatar, repo, +lines/-lines)
- Truncate to 12 items per tab with "+ N more" note

`ProjectsCardProps` gets no new props — the expandability is inferred from whether the data is present.

### Commit stats badge on Jira rows

Each Jira row in the Jiras tab shows a small cyan badge with the count of commits and PRs that reference its key in their message (`REGEXP_SUBSTR(commit_message, '[A-Z]+-[0-9]+') = key`). Computed server-side and added to `jira_details`.

Add to `JiraDetail`:
```typescript
linked_commits?: number;
linked_prs?: number;
```

Computed during enrichment by scanning `allCommitRows` for each key.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/api/project-insights/route.ts` | Send all commits + PRs; return `jira_keys/groups/pr_numbers/commit_shas`; enrich with full details + commit stats badges; cache `_v: 3` |
| `src/components/ProjectsCard.tsx` | Extend types; add inline expand with 3 tabs |
| `src/lib/__tests__/unit/project-insights.test.ts` | Update snapshot / mocks for new fields if applicable |

---

## Cache

Bump `_v` from `2` → `3` in `project-insights/route.ts`. Old rows without `_v: 3` regenerate on next page load (one-time burst).

---

## Performance Notes

- LLM call: ~30–60s first time (large context), cached thereafter
- All-commits DB fetch: single query, indexed on `report_id`, ~500 rows max
- Enrichment: O(commits × projects) in-memory, negligible
