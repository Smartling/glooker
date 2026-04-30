# Unmerged Work Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track each developer's in-flight work (open PRs + bare branch commits) per report, expose it on the Dev Detail page, and feed it to the LLM engineer summary so the model can nudge developers to finish what they've started.

**Architecture:** New `unmerged_work` table linked to `reports`, populated during the existing per-member report runner loop via two new GitHub provider methods (`fetchOpenPRs` + `isCommitInDefaultBranch`). Existing stats paths are untouched — no impact on impact score, PR%, AI%, or any other metric. API and UI surface the data only on the Dev Detail page.

**Tech Stack:** Next.js 15 App Router, MySQL + SQLite via `db.execute`, `mysql2`, `@octokit/rest`, Jest + ts-jest, `p-limit` for parallelism.

**Spec:** `docs/superpowers/specs/2026-04-24-unmerged-work-design.md`

---

## Files map

- **Create**
  - `src/lib/__tests__/unit/github-fetch-open-prs.test.ts` — test for the new provider method
  - `src/lib/__tests__/unit/github-is-commit-in-default-branch.test.ts` — test for the new helper
  - `src/lib/__tests__/unit/unmerged-prompt.test.ts` — test for the prompt builder
- **Modify**
  - `src/lib/db/mysql.ts` — add `UNMERGED_WORK_SCHEMA` constant + `pool.execute` call
  - `src/lib/db/sqlite.ts` — add unmerged_work table to the `SCHEMA` template string
  - `src/lib/github.ts` — add `OpenPrInfo` type, `fetchOpenPRs`, `isCommitInDefaultBranch`, extend `GitHubProvider` interface and returned object
  - `src/lib/github-mock.ts` — mock implementations of the two new methods
  - `src/lib/report-runner.ts` — integrate unmerged-work fetching into the per-member loop
  - `src/lib/report/dev.ts` — SELECT from `unmerged_work`, shape into `{ openPrs, branchCommits }`
  - `src/app/report/[id]/dev/[login]/page.tsx` — new "In-flight Work" section
  - `src/lib/report/summary.ts` — fetch unmerged_work rows and pass to prompt
  - `prompts/report-summary-user.txt` — new `{{UNMERGED_WORK_SECTION}}` placeholder
  - `src/lib/__tests__/integration/report-runner.test.ts` — cover new mocks + row inserts
  - `scripts/mock-identities.ts` — add mock open PRs + bare branch commits per identity
  - `scripts/seed-data.ts` — populate `unmerged_work` rows for seeded reports

---

## Task 1: Schema — MySQL auto-create

**Files:**
- Modify: `src/lib/db/mysql.ts`

- [ ] **Step 1: Add table schema constant**

After the `TEAM_PULSE_SCHEMA` constant (~line 118), add:

```typescript
const UNMERGED_WORK_SCHEMA = `
CREATE TABLE IF NOT EXISTS unmerged_work (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  report_id         VARCHAR(36)  NOT NULL,
  github_login      VARCHAR(255) NOT NULL,
  kind              ENUM('open_pr','bare_branch_commit') NOT NULL,
  repo              VARCHAR(255) NOT NULL,
  pr_number         INT          NULL,
  pr_title          VARCHAR(500) NULL,
  pr_url            VARCHAR(500) NULL,
  is_draft          BOOLEAN      NULL,
  pr_commits        INT          NULL,
  pr_additions      INT          NULL,
  pr_deletions      INT          NULL,
  pr_created_at     TIMESTAMP    NULL,
  pr_updated_at     TIMESTAMP    NULL,
  commit_sha        VARCHAR(40)  NULL,
  commit_message    TEXT         NULL,
  branch_name       VARCHAR(255) NULL,
  commit_additions  INT          NULL,
  commit_deletions  INT          NULL,
  committed_at      TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_unmerged (report_id, kind, repo, pr_number, commit_sha)
);
`;
```

- [ ] **Step 2: Register table creation with the pool**

After the `TEAM_PULSE_SCHEMA` `pool.execute(...)` call (around line 150-152), add:

```typescript
  pool.execute(UNMERGED_WORK_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create unmerged_work table:', err);
  });
```

- [ ] **Step 3: Verify the TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/mysql.ts
git commit -m "feat(unmerged-work): add unmerged_work table (MySQL)"
```

---

## Task 2: Schema — SQLite auto-create

**Files:**
- Modify: `src/lib/db/sqlite.ts`

- [ ] **Step 1: Add table to the SCHEMA template string**

Open `src/lib/db/sqlite.ts`. Locate the `SCHEMA` template literal (starts around line 6). Append this table definition before the closing backtick, alongside the other tables:

```typescript
CREATE TABLE IF NOT EXISTS unmerged_work (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id         TEXT    NOT NULL,
  github_login      TEXT    NOT NULL,
  kind              TEXT    NOT NULL CHECK(kind IN ('open_pr','bare_branch_commit')),
  repo              TEXT    NOT NULL,
  pr_number         INTEGER,
  pr_title          TEXT,
  pr_url            TEXT,
  is_draft          INTEGER,
  pr_commits        INTEGER,
  pr_additions      INTEGER,
  pr_deletions      INTEGER,
  pr_created_at     TEXT,
  pr_updated_at     TEXT,
  commit_sha        TEXT,
  commit_message    TEXT,
  branch_name       TEXT,
  commit_additions  INTEGER,
  commit_deletions  INTEGER,
  committed_at      TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, kind, repo, pr_number, commit_sha)
);
```

- [ ] **Step 2: Verify the TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: no output (clean).

- [ ] **Step 3: Verify SQLite integration test still passes**

Run: `npx jest src/lib/__tests__/ -t sqlite --ci`
Expected: PASS on any existing sqlite tests; no errors creating the new table.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/sqlite.ts
git commit -m "feat(unmerged-work): add unmerged_work table (SQLite)"
```

---

## Task 3: GitHub provider — `fetchOpenPRs` method

**Files:**
- Create: `src/lib/__tests__/unit/github-fetch-open-prs.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github-mock.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/github-fetch-open-prs.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { fetchOpenPRs } from '../../github';

describe('fetchOpenPRs', () => {
  it('returns a list of open PRs for a user in an org', async () => {
    const mockSearch = jest.fn().mockResolvedValue({
      data: {
        total_count: 2,
        items: [
          {
            number: 101,
            title: 'Refactor auth module',
            html_url: 'https://github.com/acme/auth/pull/101',
            draft: false,
            repository_url: 'https://api.github.com/repos/acme/auth',
            created_at: '2026-04-01T10:00:00Z',
            updated_at: '2026-04-22T12:00:00Z',
          },
          {
            number: 202,
            title: 'WIP billing fix',
            html_url: 'https://github.com/acme/billing/pull/202',
            draft: true,
            repository_url: 'https://api.github.com/repos/acme/billing',
            created_at: '2026-04-20T08:00:00Z',
            updated_at: '2026-04-23T09:00:00Z',
          },
        ],
      },
    });
    const mockPullsGet = jest.fn()
      .mockResolvedValueOnce({ data: { commits: 7, additions: 284, deletions: 112 } })
      .mockResolvedValueOnce({ data: { commits: 2, additions: 47, deletions: 12 } });

    const { __setOctokitForTest } = await import('../../github');
    __setOctokitForTest({
      search: { issuesAndPullRequests: mockSearch },
      pulls: { get: mockPullsGet },
    } as any);

    const since = new Date('2026-04-10');
    const result = await fetchOpenPRs('acme', 'alice', since);

    expect(result).toEqual([
      {
        repo: 'auth',
        number: 101,
        title: 'Refactor auth module',
        url: 'https://github.com/acme/auth/pull/101',
        draft: false,
        commits: 7,
        additions: 284,
        deletions: 112,
        createdAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-22T12:00:00Z',
      },
      {
        repo: 'billing',
        number: 202,
        title: 'WIP billing fix',
        url: 'https://github.com/acme/billing/pull/202',
        draft: true,
        commits: 2,
        additions: 47,
        deletions: 12,
        createdAt: '2026-04-20T08:00:00Z',
        updatedAt: '2026-04-23T09:00:00Z',
      },
    ]);

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
      q: 'org:acme author:alice is:pr is:open updated:>=2026-04-10',
    }));
  });

  it('returns empty array when the user has no open PRs', async () => {
    const mockSearch = jest.fn().mockResolvedValue({ data: { total_count: 0, items: [] } });
    const { __setOctokitForTest } = await import('../../github');
    __setOctokitForTest({ search: { issuesAndPullRequests: mockSearch } } as any);

    const result = await fetchOpenPRs('acme', 'alice', new Date('2026-04-10'));
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/github-fetch-open-prs.test.ts`
Expected: FAIL — `fetchOpenPRs is not a function` or similar.

- [ ] **Step 3: Add `__setOctokitForTest` export to `src/lib/github.ts` if missing**

Near the top of `src/lib/github.ts`, locate `getOctokit()`. If there's no test seam, add one directly below the existing octokit singleton:

```typescript
export function __setOctokitForTest(mock: any) {
  (globalThis as any).__glooker_octokit_override = mock;
}

function getOctokit() {
  const override = (globalThis as any).__glooker_octokit_override;
  if (override) return override;
  // … existing logic …
}
```

If `getOctokit` already supports injection, skip this step.

- [ ] **Step 4: Add `OpenPrInfo` type + `fetchOpenPRs` function**

In `src/lib/github.ts`, add near the other type definitions (around line 40):

```typescript
export interface OpenPrInfo {
  repo:       string;
  number:     number;
  title:      string;
  url:        string;
  draft:      boolean;
  commits:    number;
  additions:  number;
  deletions:  number;
  createdAt:  string;
  updatedAt:  string;
}
```

Add this to the `GitHubProvider` interface:

```typescript
fetchOpenPRs(org: string, user: string, since: Date, log?: (msg: string) => void): Promise<OpenPrInfo[]>;
```

After `countReviewedPRs`, add the implementation:

```typescript
export async function fetchOpenPRs(
  org:   string,
  user:  string,
  since: Date,
  log?:  (msg: string) => void,
): Promise<OpenPrInfo[]> {
  const sinceStr = since.toISOString().split('T')[0];
  const q = `org:${org} author:${user} is:pr is:open updated:>=${sinceStr}`;
  const results: OpenPrInfo[] = [];

  let page = 1;
  while (true) {
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().search.issuesAndPullRequests({ q, per_page: 100, page }),
      log,
    );
    for (const item of res.data.items) {
      const repo = (item.repository_url || '').split('/').pop() || '';
      // Fetch per-PR size details (commits/additions/deletions)
      let commits = 0, additions = 0, deletions = 0;
      try {
        const { data: prDetail } = await withRetry(
          () => getOctokit().pulls.get({ owner: org, repo, pull_number: item.number }),
          log,
        );
        commits   = prDetail.commits   ?? 0;
        additions = prDetail.additions ?? 0;
        deletions = prDetail.deletions ?? 0;
      } catch {
        // degrade gracefully if PR details are unavailable
      }
      results.push({
        repo,
        number:    item.number,
        title:     item.title,
        url:       item.html_url,
        draft:     Boolean(item.draft),
        commits,
        additions,
        deletions,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      });
    }
    if (results.length >= res.data.total_count || res.data.items.length < 100) break;
    page++;
  }

  return results;
}
```

Finally, add `fetchOpenPRs` to the returned provider object around line 451:

```typescript
cachedProvider = { listOrgMembers, fetchUserActivity, listOrgs, countReviewedPRs, fetchOpenPRs };
```

- [ ] **Step 5: Add mock implementation**

In `src/lib/github-mock.ts`, after `countReviewedPRs`, add:

```typescript
    async fetchOpenPRs(_org, _user, _since, log) {
      log?.(`[mock] fetchOpenPRs for ${_user}`);
      return [];
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/lib/__tests__/unit/github-fetch-open-prs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts src/lib/__tests__/unit/github-fetch-open-prs.test.ts
git commit -m "feat(unmerged-work): add fetchOpenPRs GitHub provider method"
```

---

## Task 4: GitHub provider — `isCommitInDefaultBranch` helper

**Files:**
- Create: `src/lib/__tests__/unit/github-is-commit-in-default-branch.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github-mock.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/github-is-commit-in-default-branch.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { isCommitInDefaultBranch, __setOctokitForTest } from '../../github';

describe('isCommitInDefaultBranch', () => {
  it('returns true when compare status is behind', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'behind' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    const result = await isCommitInDefaultBranch('acme', 'app', 'abc123');
    expect(result).toBe(true);
  });

  it('returns true when compare status is identical', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'identical' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app', 'abc123')).toBe(true);
  });

  it('returns false when compare status is ahead', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'ahead' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app', 'abc123')).toBe(false);
  });

  it('returns false when compare status is diverged', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'diverged' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app', 'abc123')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/unit/github-is-commit-in-default-branch.test.ts`
Expected: FAIL — `isCommitInDefaultBranch is not a function`.

- [ ] **Step 3: Add implementation**

In `src/lib/github.ts`, near the other helpers, add:

```typescript
// Per-run cache of default branch names keyed by "owner/repo".
const defaultBranchCache = new Map<string, string>();

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const key = `${owner}/${repo}`;
  if (defaultBranchCache.has(key)) return defaultBranchCache.get(key)!;
  const { data } = await withRetry(() => getOctokit().repos.get({ owner, repo }));
  const name = data.default_branch || 'main';
  defaultBranchCache.set(key, name);
  return name;
}

export async function isCommitInDefaultBranch(
  owner: string,
  repo:  string,
  sha:   string,
): Promise<boolean> {
  const base = await getDefaultBranch(owner, repo);
  const { data } = await withRetry(() =>
    getOctokit().repos.compareCommits({ owner, repo, base, head: sha }),
  );
  return data.status === 'behind' || data.status === 'identical';
}
```

- [ ] **Step 4: Extend the `GitHubProvider` interface and the returned object**

Update the interface:

```typescript
isCommitInDefaultBranch(owner: string, repo: string, sha: string): Promise<boolean>;
```

Update the provider returned from `getGitHubProvider()`:

```typescript
cachedProvider = {
  listOrgMembers,
  fetchUserActivity,
  listOrgs,
  countReviewedPRs,
  fetchOpenPRs,
  isCommitInDefaultBranch,
};
```

- [ ] **Step 5: Add mock**

In `src/lib/github-mock.ts`:

```typescript
    async isCommitInDefaultBranch(_owner, _repo, _sha) {
      // For the mock, mark every 3rd commit as NOT in default (bare-branch commit)
      const n = _sha.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      return n % 3 !== 0;
    },
```

- [ ] **Step 6: Run tests to verify**

Run: `npx jest src/lib/__tests__/unit/github-is-commit-in-default-branch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts src/lib/__tests__/unit/github-is-commit-in-default-branch.test.ts
git commit -m "feat(unmerged-work): add isCommitInDefaultBranch provider method"
```

---

## Task 5: Report runner — collect + persist unmerged work

**Files:**
- Modify: `src/lib/report-runner.ts`
- Modify: `src/lib/__tests__/integration/report-runner.test.ts`

- [ ] **Step 1: Update the integration-test mock to cover the new methods**

Open `src/lib/__tests__/integration/report-runner.test.ts`. After `mockCountReviewedPRs`, add:

```typescript
const mockFetchOpenPRs = jest.fn().mockResolvedValue([]);
const mockIsCommitInDefaultBranch = jest.fn().mockResolvedValue(true); // default: every commit is in main
```

Update `mockGetGitHubProvider.mockReturnValue(...)` to include:

```typescript
  fetchOpenPRs: mockFetchOpenPRs,
  isCommitInDefaultBranch: mockIsCommitInDefaultBranch,
```

- [ ] **Step 2: Add a failing test for open-PR persistence**

In the same test file, inside the existing `describe('runReport', ...)`, add:

```typescript
it('persists open PRs into unmerged_work table', async () => {
  mockFetchOpenPRs.mockResolvedValueOnce([
    {
      repo: 'app',
      number: 42,
      title: 'Refactor',
      url: 'https://github.com/my-org/app/pull/42',
      draft: false,
      commits: 3,
      additions: 100,
      deletions: 20,
      createdAt: '2026-04-10T00:00:00Z',
      updatedAt: '2026-04-22T00:00:00Z',
    },
  ]);
  mockFetchOpenPRs.mockResolvedValue([]); // bob has none

  await runReport('r1', 'my-org', 14);

  const insertCall = mockDbExecute.mock.calls.find(
    (call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('INSERT INTO unmerged_work') &&
      call[1]?.[1] === 'alice' &&
      call[1]?.[2] === 'open_pr',
  );
  expect(insertCall).toBeTruthy();
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts`
Expected: FAIL on the new test (no matching INSERT).

- [ ] **Step 4: Integrate open-PR fetch into report-runner**

Open `src/lib/report-runner.ts`. After the existing `countReviewedPRs` block in the per-member loop (around line 185), add:

```typescript
        // Fetch open PRs for this member (in-flight work)
        try {
          const openPrs = await github.fetchOpenPRs(org, member.login, since, log);
          if (openPrs.length > 0) log(`@${member.login}: ${openPrs.length} open PR(s)`);
          for (const pr of openPrs) {
            await db.execute(
              `INSERT IGNORE INTO unmerged_work
                 (report_id, github_login, kind, repo, pr_number, pr_title, pr_url,
                  is_draft, pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at)
               VALUES (?, ?, 'open_pr', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                reportId,
                member.login,
                pr.repo,
                pr.number,
                pr.title,
                pr.url,
                pr.draft ? 1 : 0,
                pr.commits,
                pr.additions,
                pr.deletions,
                pr.createdAt,
                pr.updatedAt,
              ],
            );
          }
        } catch (err) {
          log(`@${member.login} openPRs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
```

- [ ] **Step 5: Run the test again**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts -t "persists open PRs"`
Expected: PASS.

- [ ] **Step 6: Add a failing test for bare-branch-commit persistence**

In the same test file:

```typescript
it('persists bare branch commits into unmerged_work table', async () => {
  // Alice has one commit with no PR association; compareCommits says it's NOT in main.
  mockFetchUserActivity.mockImplementationOnce(async () => ({
    commits: [makeCommit({ sha: 'aaa1', author: 'alice', authorName: 'alice', prNumber: null, repo: 'app' })],
    prs: [],
  }));
  mockFetchOpenPRs.mockResolvedValue([]);
  mockIsCommitInDefaultBranch.mockResolvedValueOnce(false); // aaa1 not in main

  await runReport('r1', 'my-org', 14);

  const insertCall = mockDbExecute.mock.calls.find(
    (call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('INSERT INTO unmerged_work') &&
      call[1]?.[2] === 'bare_branch_commit' &&
      call[1]?.[4] === 'aaa1',
  );
  expect(insertCall).toBeTruthy();
});
```

- [ ] **Step 7: Run to confirm failure**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts -t "bare branch"`
Expected: FAIL.

- [ ] **Step 8: Integrate bare-branch detection in the runner**

In `src/lib/report-runner.ts`, after the commit-dedup block (right after `memberCommits.set(member.login, thisMemCommits)`), add:

```typescript
        // Classify commits that aren't associated with any PR — are they in main already, or "bare branch"?
        for (const commit of thisMemCommits) {
          if (commit.prNumber) continue; // already tied to a PR (merged or open)
          try {
            const inMain = await github.isCommitInDefaultBranch(org, commit.repo, commit.sha);
            if (inMain) continue;
            await db.execute(
              `INSERT IGNORE INTO unmerged_work
                 (report_id, github_login, kind, repo, commit_sha, commit_message,
                  commit_additions, commit_deletions, committed_at)
               VALUES (?, ?, 'bare_branch_commit', ?, ?, ?, ?, ?, ?)`,
              [
                reportId,
                member.login,
                commit.repo,
                commit.sha,
                commit.message,
                commit.additions,
                commit.deletions,
                commit.committedAt,
              ],
            );
          } catch (err) {
            log(`bare-branch check failed for ${commit.sha.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
```

- [ ] **Step 9: Run all runner tests**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/report-runner.ts src/lib/__tests__/integration/report-runner.test.ts
git commit -m "feat(unmerged-work): collect + persist open PRs and bare branch commits in runner"
```

---

## Task 6: Expose unmerged work on the Dev API

**Files:**
- Modify: `src/lib/report/dev.ts`

- [ ] **Step 1: Add the unmerged-work SELECT and shape the response**

Open `src/lib/report/dev.ts`. After the existing `timeline` aggregation (around line 89), add:

```typescript
  // Unmerged work (in-flight) — separate from shipped stats
  const [unmergedRows] = await db.execute(
    `SELECT kind, repo, pr_number, pr_title, pr_url, is_draft,
            pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at,
            commit_sha, commit_message, branch_name,
            commit_additions, commit_deletions, committed_at
     FROM unmerged_work
     WHERE report_id = ? AND github_login = ?
     ORDER BY COALESCE(pr_updated_at, committed_at) DESC`,
    [reportId, login],
  ) as [any[], any];

  const openPrs = unmergedRows.filter((r: any) => r.kind === 'open_pr').map((r: any) => ({
    repo:       r.repo,
    number:     r.pr_number,
    title:      r.pr_title,
    url:        r.pr_url,
    draft:      Boolean(r.is_draft),
    commits:    r.pr_commits,
    additions:  r.pr_additions,
    deletions:  r.pr_deletions,
    createdAt:  r.pr_created_at,
    updatedAt:  r.pr_updated_at,
  }));
  const branchCommits = unmergedRows.filter((r: any) => r.kind === 'bare_branch_commit').map((r: any) => ({
    repo:         r.repo,
    sha:          r.commit_sha,
    message:      r.commit_message,
    branchName:   r.branch_name,
    additions:    r.commit_additions,
    deletions:    r.commit_deletions,
    committedAt:  r.committed_at,
  }));
```

- [ ] **Step 2: Add `unmergedWork` to the returned object**

Update the final `return { ... }` in `getDevReport`:

```typescript
  return {
    report: reportRows[0],
    developer: parseDev(devRows[0]),
    allDevelopers: allDevRows,
    commits: commitRows,
    timeline,
    unmergedWork: { openPrs, branchCommits },
  };
```

- [ ] **Step 3: Verify typecheck + existing tests still pass**

```bash
npx tsc --noEmit --project tsconfig.json
npm test -- --ci --testPathPattern="report|dev"
```

Expected: clean typecheck; existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/report/dev.ts
git commit -m "feat(unmerged-work): return unmergedWork in dev API response"
```

---

## Task 7: Dev Detail UI — "In-flight Work" section

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`

- [ ] **Step 1: Extend the `DevDetailData` types**

Open `src/app/report/[id]/dev/[login]/page.tsx`. Near the existing interfaces, add:

```typescript
interface OpenPr {
  repo: string; number: number; title: string; url: string;
  draft: boolean; commits: number; additions: number; deletions: number;
  createdAt: string; updatedAt: string;
}

interface BareBranchCommit {
  repo: string; sha: string; message: string; branchName: string | null;
  additions: number; deletions: number; committedAt: string;
}
```

- [ ] **Step 2: Read `unmergedWork` from the API response**

Inside the component, alongside `const dev`, `const commits`, add:

```typescript
  const unmergedWork: { openPrs: OpenPr[]; branchCommits: BareBranchCommit[] } =
    devData?.unmergedWork ?? { openPrs: [], branchCommits: [] };
```

- [ ] **Step 3: Add the UI section below "Recent Commits"**

Find the existing "Recent Commits" block. Directly below its closing tag, add:

```tsx
{(unmergedWork.openPrs.length > 0 || unmergedWork.branchCommits.length > 0) && (
  <div className="bg-gray-900 rounded-xl p-5 mb-6">
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">In-flight Work</p>
      <p className="text-xs text-gray-600">
        {unmergedWork.openPrs.length} open PR{unmergedWork.openPrs.length === 1 ? '' : 's'} ·{' '}
        {unmergedWork.branchCommits.length} branch commit{unmergedWork.branchCommits.length === 1 ? '' : 's'}
      </p>
    </div>

    {unmergedWork.openPrs.length > 0 && (
      <div className="mb-4">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mb-2">Open Pull Requests</p>
        <div className="space-y-1">
          {unmergedWork.openPrs.map(pr => (
            <a key={pr.url} href={pr.url} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-3 px-2 py-1.5 hover:bg-gray-800/40 rounded -mx-2 text-sm">
              <span className="text-xs text-gray-600 font-mono shrink-0">#{pr.number}</span>
              {pr.draft && <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded shrink-0">DRAFT</span>}
              <span className="text-gray-200 truncate min-w-0 flex-1">{pr.title}</span>
              <span className="text-xs text-gray-500 shrink-0">{pr.repo}</span>
              <span className="text-xs text-green-400 shrink-0 font-mono">+{pr.additions.toLocaleString()}</span>
              <span className="text-xs text-red-400 shrink-0 font-mono">-{pr.deletions.toLocaleString()}</span>
              <span className="text-xs text-gray-600 shrink-0">{daysAgo(pr.updatedAt)}d</span>
            </a>
          ))}
        </div>
      </div>
    )}

    {unmergedWork.branchCommits.length > 0 && (
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mb-2">Branch Commits (not in default branch)</p>
        <div className="space-y-1">
          {unmergedWork.branchCommits.map(c => (
            <a key={c.sha} href={`https://github.com/${report?.org}/${c.repo}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-3 px-2 py-1.5 hover:bg-gray-800/40 rounded -mx-2 text-sm">
              <span className="text-xs text-gray-600 font-mono shrink-0">{c.sha.slice(0, 7)}</span>
              <span className="text-gray-200 truncate min-w-0 flex-1">{c.message.split('\n')[0]}</span>
              <span className="text-xs text-gray-500 shrink-0">{c.repo}</span>
              <span className="text-xs text-green-400 shrink-0 font-mono">+{c.additions.toLocaleString()}</span>
              <span className="text-xs text-red-400 shrink-0 font-mono">-{c.deletions.toLocaleString()}</span>
              <span className="text-xs text-gray-600 shrink-0">{daysAgo(c.committedAt)}d</span>
            </a>
          ))}
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Add the `daysAgo` helper**

At the top of the file (before the component), add:

```typescript
function daysAgo(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/report/\[id\]/dev/\[login\]/page.tsx
git commit -m "feat(unmerged-work): add In-flight Work section to dev detail page"
```

---

## Task 8: LLM summary — inject unmerged-work context

**Files:**
- Modify: `src/lib/report/summary.ts`
- Modify: `prompts/report-summary-user.txt`
- Create: `src/lib/__tests__/unit/unmerged-prompt.test.ts`

- [ ] **Step 1: Write the failing test for the prompt builder**

Create `src/lib/__tests__/unit/unmerged-prompt.test.ts`:

```typescript
import { formatUnmergedWorkSection } from '../../report/summary';

describe('formatUnmergedWorkSection', () => {
  it('returns empty string when no unmerged work', () => {
    expect(formatUnmergedWorkSection([], [])).toBe('');
  });

  it('formats open PRs with age + caps at 5 items', () => {
    const prs = Array.from({ length: 7 }).map((_, i) => ({
      title: `PR ${i}`,
      updatedAt: new Date(Date.now() - i * 86400000).toISOString(),
      createdAt: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
      draft: i === 1,
    }));
    const out = formatUnmergedWorkSection(prs, []);
    expect(out).toContain('Open PRs: 7');
    expect(out).toContain('PR 0');
    expect(out).toContain('+ 2 more');
    expect(out).toMatch(/does NOT count/i);
  });

  it('formats bare branch commits with cap at 3', () => {
    const commits = Array.from({ length: 5 }).map((_, i) => ({
      message: `commit ${i}`,
      repo: `repo-${i % 2}`,
      committedAt: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    const out = formatUnmergedWorkSection([], commits);
    expect(out).toContain('Commits on unmerged branches: 5');
    expect(out).toContain('commit 0');
    expect(out).toContain('+ 2 more');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest src/lib/__tests__/unit/unmerged-prompt.test.ts`
Expected: FAIL — `formatUnmergedWorkSection is not defined`.

- [ ] **Step 3: Add the prompt builder**

In `src/lib/report/summary.ts`, export a helper above `getDevSummary`:

```typescript
interface UnmergedPrSummary { title: string; updatedAt: string; createdAt: string; draft: boolean; }
interface UnmergedCommitSummary { message: string; repo: string; committedAt: string; }

export function formatUnmergedWorkSection(
  openPrs: UnmergedPrSummary[],
  branchCommits: UnmergedCommitSummary[],
): string {
  if (openPrs.length === 0 && branchCommits.length === 0) return '';

  const daysAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));

  const lines: string[] = [];
  lines.push('Work in flight (NOT counted in impact score — these are unmerged):');

  if (openPrs.length > 0) {
    const top = [...openPrs]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
    lines.push(`- Open PRs: ${openPrs.length}`);
    for (const pr of top) {
      const age = daysAgo(pr.createdAt);
      const upd = daysAgo(pr.updatedAt);
      const draft = pr.draft ? ' [draft]' : '';
      lines.push(`  - "${pr.title}" (opened ${age}d ago, updated ${upd}d ago${draft})`);
    }
    if (openPrs.length > 5) lines.push(`  + ${openPrs.length - 5} more`);
  }

  if (branchCommits.length > 0) {
    const repos = Array.from(new Set(branchCommits.map(c => c.repo)));
    const top = [...branchCommits]
      .sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime())
      .slice(0, 3);
    lines.push(`- Commits on unmerged branches: ${branchCommits.length} across ${repos.length} repo${repos.length === 1 ? '' : 's'}`);
    for (const c of top) {
      lines.push(`  - "${c.message.split('\n')[0]}" (${daysAgo(c.committedAt)}d ago in ${c.repo})`);
    }
    if (branchCommits.length > 3) lines.push(`  + ${branchCommits.length - 3} more`);
  }

  lines.push('');
  lines.push('If this developer has substantial in-flight work AND modest shipped impact, nudge them to finish existing work before starting new.');
  lines.push('If in-flight work is minimal or shipped impact is already strong, do not mention it.');
  lines.push('Remember: in-flight work is NOT reflected in the impact score.');

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npx jest src/lib/__tests__/unit/unmerged-prompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Fetch unmerged rows in `getDevSummary` and pass them to the prompt**

Inside `getDevSummary`, after the existing `const dev = ...` load, add:

```typescript
  const [unmergedRows] = await db.execute(
    `SELECT kind, pr_title, pr_created_at, pr_updated_at, is_draft,
            commit_message, repo, committed_at
     FROM unmerged_work
     WHERE report_id = ? AND github_login = ?`,
    [reportId, login],
  ) as [any[], any];

  const unmergedPrs = unmergedRows
    .filter((r: any) => r.kind === 'open_pr')
    .map((r: any) => ({ title: r.pr_title, createdAt: r.pr_created_at, updatedAt: r.pr_updated_at, draft: Boolean(r.is_draft) }));
  const unmergedCommits = unmergedRows
    .filter((r: any) => r.kind === 'bare_branch_commit')
    .map((r: any) => ({ message: r.commit_message, repo: r.repo, committedAt: r.committed_at }));

  const unmergedSection = formatUnmergedWorkSection(unmergedPrs, unmergedCommits);
```

Then, in the `loadPrompt('report-summary-user.txt', {...})` call, add one more template variable:

```typescript
    UNMERGED_WORK_SECTION: unmergedSection,
```

- [ ] **Step 6: Update the prompt template**

Open `prompts/report-summary-user.txt`. Append (at the end, before any closing instructions):

```
{{UNMERGED_WORK_SECTION}}
```

If the existing template uses a specific section ordering, place it after the "Recent Commits" summary and before the "produce output" line.

- [ ] **Step 7: Update the prompt snapshot**

Run: `npx jest --testPathPattern="summary" -u`
Expected: snapshot(s) updated; tests PASS.

Review the snapshot diff to confirm it reflects only the new section appearing at the intended location.

- [ ] **Step 8: Commit**

```bash
git add src/lib/report/summary.ts prompts/report-summary-user.txt src/lib/__tests__/unit/unmerged-prompt.test.ts src/lib/__tests__/unit/__snapshots__/
git commit -m "feat(unmerged-work): inject in-flight work context into engineer summary prompt"
```

---

## Task 9: Mock data + seed updates

**Files:**
- Modify: `scripts/mock-identities.ts`
- Modify: `scripts/seed-data.ts`
- Modify: `src/lib/github-mock.ts`

- [ ] **Step 1: Add mock open-PR fixtures to each identity**

In `scripts/mock-identities.ts`, locate the identity array. Add a `mockOpenPrs` field to 2-3 of the seed identities:

```typescript
    mockOpenPrs: [
      { repo: 'tms', number: 8421, title: 'Refactor auth middleware', url: '#', draft: false, commits: 6, additions: 284, deletions: 112, createdAt: '2026-04-03T10:00:00Z', updatedAt: '2026-04-21T12:00:00Z' },
      { repo: 'tms', number: 8433, title: 'WIP billing edge case', url: '#', draft: true,  commits: 1, additions: 22,  deletions: 4,   createdAt: '2026-04-22T09:00:00Z', updatedAt: '2026-04-23T15:00:00Z' },
    ],
```

- [ ] **Step 2: Hook those fixtures into the mock GitHub provider**

In `src/lib/github-mock.ts`, change `fetchOpenPRs` to return the identity's `mockOpenPrs` field when present:

```typescript
    async fetchOpenPRs(_org, user, _since, log) {
      const ident = MOCK_IDENTITIES.find(i => i.login === user);
      log?.(`[mock] fetchOpenPRs ${user}: ${ident?.mockOpenPrs?.length ?? 0}`);
      return ident?.mockOpenPrs ?? [];
    },
```

Confirm `MOCK_IDENTITIES` is already imported at the top of `github-mock.ts`; if not, add the import.

- [ ] **Step 3: Seed unmerged_work rows for seeded reports**

In `scripts/seed-data.ts`, after the `developer_stats` insertion loop, add:

```typescript
  for (const identity of MOCK_IDENTITIES) {
    const prs = identity.mockOpenPrs ?? [];
    for (const pr of prs) {
      await db.execute(
        `INSERT IGNORE INTO unmerged_work
           (report_id, github_login, kind, repo, pr_number, pr_title, pr_url,
            is_draft, pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at)
         VALUES (?, ?, 'open_pr', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, identity.login, pr.repo, pr.number, pr.title, pr.url,
         pr.draft ? 1 : 0, pr.commits, pr.additions, pr.deletions, pr.createdAt, pr.updatedAt],
      );
    }
  }
```

(The `reportId` variable name should match what's already in scope in the seed loop.)

- [ ] **Step 4: Run the seed script in SQLite mode**

```bash
rm -f glooker.db glooker.db-shm glooker.db-wal
DB_TYPE=sqlite npm run seed:reset
sqlite3 glooker.db 'SELECT github_login, kind, pr_title FROM unmerged_work LIMIT 5;'
```

Expected: rows printed for the identities you added `mockOpenPrs` to.

- [ ] **Step 5: Commit**

```bash
git add scripts/mock-identities.ts scripts/seed-data.ts src/lib/github-mock.ts
git commit -m "feat(unmerged-work): mock + seed data"
```

---

## Task 10: End-to-end verification & final commit

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --ci`
Expected: all tests PASS, including the 3 new test files and the updated integration test.

- [ ] **Step 2: Build the Next.js app**

```bash
rm -rf .next
npm run build
```

Expected: build succeeds with no TS errors.

- [ ] **Step 3: Manual smoke in mock mode**

```bash
DB_TYPE=sqlite GITHUB_PROVIDER=mock LLM_PROVIDER=mock JIRA_PROVIDER=mock npm run dev:mock
```

Visit http://localhost:3000/report/{seeded-id}/dev/{seeded-login}. Expected:
- The "In-flight Work" section appears with the seeded open PRs.
- The engineer summary references the in-flight work (or mentions none) in its narrative.
- The team / org pages are unchanged; no CC-style gating applies.
- A dev without seeded `mockOpenPrs` shows no "In-flight Work" section.

- [ ] **Step 4: Rebuild the container (optional, for real-DB test)**

```bash
podman-compose build app
AUTH_ENABLED=true AUTH_TEST_USER=admin AUTH_ADMIN_GROUP=glooker-admins podman-compose up -d --force-recreate app
```

Hit http://localhost:3000 and confirm the page renders without console errors even when the DB has no unmerged rows.

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin feature/unmerged-work
gh pr create --title "feat(unmerged-work): track in-flight PRs + branch commits per developer" \
  --body "Implements spec docs/superpowers/specs/2026-04-24-unmerged-work-design.md."
```

Return the PR URL.

---

## Self-review notes

- Every spec section has a task:
  - Data model → Tasks 1, 2
  - Fetch flow (open PRs, bare-branch compare, persistence) → Tasks 3, 4, 5
  - API shape → Task 6
  - Dev Detail UI → Task 7
  - LLM prompt → Task 8
  - Mock & seed → Task 9
  - Verification → Task 10
- No placeholders — every step has exact file paths, SQL, or code.
- Types match across tasks (`OpenPrInfo` in Task 3 is the source of truth; Tasks 5, 6, 7 reference the same property names: `repo`, `number`, `title`, `url`, `draft`, `commits`, `additions`, `deletions`, `createdAt`, `updatedAt`).
- TDD rhythm: each new provider method, helper, and runner hook is written test-first.
- Frequent commits: 10 commits aligned to logical chunks.
