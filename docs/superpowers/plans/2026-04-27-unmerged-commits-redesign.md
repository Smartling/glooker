# Unmerged Commits Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the aggregate-level in-flight tracking with **per-commit** in-flight data sourced from `pulls/{N}/commits` (open-PR side) and `users/{user}/events/orgs/{org}` + `compare()` (orphan-branch side), so the org charts reflect commit volume at the actual `committed_at` instead of `pr_updated_at`.

**Architecture:** New `unmerged_commits` table (per-commit data with real `committed_at`/lines). Rename `unmerged_work → unmerged_prs` (PR-only metadata). All fetching runs in the existing per-engineer loop, fenced inside try/catch — never affects `commit_analyses`/`developer_stats`/impact. Org chart overlay reads from `unmerged_commits` bucketed by week of `committed_at`.

**Tech Stack:** Next.js 15 App Router, MySQL + SQLite via `db.execute`, `mysql2`, `@octokit/rest`, Jest + ts-jest, `p-limit`.

**Spec:** `docs/superpowers/specs/2026-04-27-unmerged-commits-redesign-design.md`
**Branch:** `feature/unmerged-work-org-charts` (continues from previous PR work; will become next PR after this lands).

---

## Files map

- **Modify**
  - `src/lib/db/mysql.ts` — drop `unmerged_work`, add `unmerged_prs` and `unmerged_commits` tables
  - `src/lib/db/sqlite.ts` — same
  - `src/lib/github.ts` — add `fetchUserOrgEvents`, `fetchPullRequestCommits`, `compareBranchCommits`; export existing `getCommitDetail`
  - `src/lib/github-mock.ts` — mock the new provider methods
  - `src/lib/report-runner.ts` — replace unmerged-work fetch (bare-branch + open-PR overlay path) with new unmerged-commits flow; switch open-PR target table from `unmerged_work` to `unmerged_prs`
  - `src/lib/report/org.ts` — overlay sources from `unmerged_commits` bucketed by `committed_at`; KPI sourced from `unmerged_prs` (PR counts) + `unmerged_commits` (bare-branch counts)
  - `src/lib/report/dev.ts` — read `Open Pull Requests` list from `unmerged_prs`, `Branch Commits` list from `unmerged_commits WHERE pr_number IS NULL`
  - `src/lib/report/summary.ts` — read same as dev API; the existing `formatUnmergedWorkSection` helper signature is unchanged
- **Create**
  - `src/lib/__tests__/unit/github-fetch-user-events.test.ts`
  - `src/lib/__tests__/unit/github-fetch-pr-commits.test.ts`
  - `src/lib/__tests__/unit/github-compare-branch-commits.test.ts`

---

## Task 1: Schema migration — drop `unmerged_work`, add `unmerged_prs` + `unmerged_commits`

**Files:**
- Modify: `src/lib/db/mysql.ts`
- Modify: `src/lib/db/sqlite.ts`

- [ ] **Step 1: Update `mysql.ts` — replace UNMERGED_WORK_SCHEMA with two new schemas**

Open `src/lib/db/mysql.ts`. Find the `UNMERGED_WORK_SCHEMA` constant (it currently defines `unmerged_work` with the `kind` discriminator). Replace it and its `pool.execute(UNMERGED_WORK_SCHEMA)` call with:

```typescript
const UNMERGED_PRS_SCHEMA = `
CREATE TABLE IF NOT EXISTS unmerged_prs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  repo            VARCHAR(255) NOT NULL,
  pr_number       INT          NOT NULL,
  pr_title        VARCHAR(500) NULL,
  pr_url          VARCHAR(500) NULL,
  is_draft        BOOLEAN      NULL,
  pr_commits      INT          NULL,
  pr_additions    INT          NULL,
  pr_deletions    INT          NULL,
  pr_created_at   TIMESTAMP    NULL,
  pr_updated_at   TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_unmerged_pr (report_id, repo, pr_number)
);
`;

const UNMERGED_COMMITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS unmerged_commits (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  repo            VARCHAR(255) NOT NULL,
  branch          VARCHAR(255) NULL,
  pr_number       INT          NULL,
  commit_sha      VARCHAR(40)  NOT NULL,
  commit_message  TEXT         NULL,
  lines_added     INT          NOT NULL DEFAULT 0,
  lines_removed   INT          NOT NULL DEFAULT 0,
  committed_at    TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_unmerged_commit (report_id, repo, commit_sha)
);
`;
```

Find the existing call:
```typescript
pool.execute(UNMERGED_WORK_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create unmerged_work table:', err);
});
```

Replace with:
```typescript
pool.execute(UNMERGED_PRS_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create unmerged_prs table:', err);
});
pool.execute(UNMERGED_COMMITS_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create unmerged_commits table:', err);
});
pool.execute('DROP TABLE IF EXISTS unmerged_work').catch((err) => {
  console.error('[db/mysql] Failed to drop unmerged_work table:', err);
});
```

The `DROP TABLE` is intentional. The old table's data is per-report transient; nothing depends on it after this PR lands.

- [ ] **Step 2: Update `sqlite.ts` — same swap**

Open `src/lib/db/sqlite.ts`. Find the `unmerged_work` `CREATE TABLE` block within the `SCHEMA` template literal. Remove that block. Add these two table definitions in the same template literal (alongside the other tables):

```sql
CREATE TABLE IF NOT EXISTS unmerged_prs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  repo            TEXT    NOT NULL,
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT,
  pr_url          TEXT,
  is_draft        INTEGER,
  pr_commits      INTEGER,
  pr_additions    INTEGER,
  pr_deletions    INTEGER,
  pr_created_at   TEXT,
  pr_updated_at   TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, repo, pr_number)
);

CREATE TABLE IF NOT EXISTS unmerged_commits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  repo            TEXT    NOT NULL,
  branch          TEXT,
  pr_number       INTEGER,
  commit_sha      TEXT    NOT NULL,
  commit_message  TEXT,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  committed_at    TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, repo, commit_sha)
);
```

Outside the `SCHEMA` template literal — anywhere the SQLite init runs after the schema is applied — add a sibling cleanup statement so existing local SQLite DBs drop the old table:

```typescript
db.exec('DROP TABLE IF EXISTS unmerged_work');
```

If the SQLite init currently runs `SCHEMA` via `db.exec(SCHEMA)`, add the line right after that call.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/mysql.ts src/lib/db/sqlite.ts
git commit -m "feat(unmerged-work): replace unmerged_work with unmerged_prs + unmerged_commits tables"
```

---

## Task 2: GitHub provider — `fetchUserOrgEvents` (events feed)

**Files:**
- Create: `src/lib/__tests__/unit/github-fetch-user-events.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github-mock.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/github-fetch-user-events.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { fetchUserOrgEvents, __setOctokitForTest } from '../../github';

describe('fetchUserOrgEvents', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns push events with repo + ref + head sha for the user in the org', async () => {
    const mockListEvents = jest.fn().mockResolvedValueOnce({
      data: [
        {
          type: 'PushEvent',
          repo: { name: 'acme/auth' },
          payload: { ref: 'refs/heads/feature-foo', head: 'aaa1' },
        },
        {
          type: 'PushEvent',
          repo: { name: 'acme/auth' },
          payload: { ref: 'refs/heads/main', head: 'aaa2' }, // default branch — caller filters
        },
        {
          type: 'PullRequestEvent',
          repo: { name: 'acme/auth' },
          payload: {},
        },
      ],
    });
    __setOctokitForTest({
      activity: { listOrgEventsForAuthenticatedUser: mockListEvents },
    } as any);

    const events = await fetchUserOrgEvents('acme', 'alice');

    expect(events).toEqual([
      { type: 'PushEvent', repo: 'auth', ref: 'refs/heads/feature-foo', headSha: 'aaa1' },
      { type: 'PushEvent', repo: 'auth', ref: 'refs/heads/main',        headSha: 'aaa2' },
    ]);
    expect(mockListEvents).toHaveBeenCalledWith(expect.objectContaining({ org: 'acme', username: 'alice', per_page: 100 }));
  });

  it('returns empty array when the user has no events', async () => {
    const mockListEvents = jest.fn().mockResolvedValueOnce({ data: [] });
    __setOctokitForTest({
      activity: { listOrgEventsForAuthenticatedUser: mockListEvents },
    } as any);
    expect(await fetchUserOrgEvents('acme', 'alice')).toEqual([]);
  });

  it('paginates and stops at 3 pages (300-event GitHub cap)', async () => {
    const mockListEvents = jest.fn().mockResolvedValue({
      data: Array.from({ length: 100 }).map((_, i) => ({
        type: 'PushEvent',
        repo: { name: 'acme/x' },
        payload: { ref: 'refs/heads/branch-' + i, head: 'sha-' + i },
      })),
    });
    __setOctokitForTest({
      activity: { listOrgEventsForAuthenticatedUser: mockListEvents },
    } as any);
    const events = await fetchUserOrgEvents('acme', 'alice');
    expect(events.length).toBe(300);
    expect(mockListEvents).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest src/lib/__tests__/unit/github-fetch-user-events.test.ts --ci`
Expected: FAIL — `fetchUserOrgEvents is not a function`.

- [ ] **Step 3: Add the type and the implementation in `src/lib/github.ts`**

Near the other type definitions (around `OpenPrInfo`):

```typescript
export interface UserOrgEvent {
  type:    string;
  repo:    string;     // bare repo name (without owner)
  ref:     string;     // e.g., 'refs/heads/feature-foo'
  headSha: string;
}
```

Add to the `GitHubProvider` interface:

```typescript
fetchUserOrgEvents(org: string, user: string, log?: (msg: string) => void): Promise<UserOrgEvent[]>;
```

After `fetchOpenPRs`, add:

```typescript
export async function fetchUserOrgEvents(
  org:   string,
  user:  string,
  log?:  (msg: string) => void,
): Promise<UserOrgEvent[]> {
  const events: UserOrgEvent[] = [];
  // GitHub caps user/events feeds at 300 events / 3 pages
  for (let page = 1; page <= 3; page++) {
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().activity.listOrgEventsForAuthenticatedUser({
        org, username: user, per_page: 100, page,
      }),
      log,
    );
    for (const item of res.data) {
      if (item.type !== 'PushEvent') continue;
      const repo = (item.repo?.name || '').split('/').pop() || '';
      const payload: any = item.payload || {};
      if (!payload.ref || !payload.head) continue;
      events.push({
        type:    item.type,
        repo,
        ref:     payload.ref,
        headSha: payload.head,
      });
    }
    if (res.data.length < 100) break;
  }
  return events;
}
```

Update the `cachedProvider` factory at the bottom of the file:

```typescript
cachedProvider = {
  listOrgMembers,
  fetchUserActivity,
  listOrgs,
  countReviewedPRs,
  fetchOpenPRs,
  isCommitInDefaultBranch,
  fetchUserOrgEvents,
};
```

- [ ] **Step 4: Add mock in `src/lib/github-mock.ts`**

After the existing `isCommitInDefaultBranch` mock, add:

```typescript
    async fetchUserOrgEvents(_org, _user, log) {
      log?.(`[mock] fetchUserOrgEvents for ${_user}`);
      return [];
    },
```

- [ ] **Step 5: Update other test mocks that stub `GitHubProvider`**

Run: `grep -rn "fetchOpenPRs:" src/lib/__tests__/ --include="*.ts"`. For every match, add `fetchUserOrgEvents: jest.fn().mockResolvedValue([])` right after `fetchOpenPRs:`.

Also update `src/lib/__tests__/unit/orgs-service.test.ts`'s 4 provider stubs.

- [ ] **Step 6: Run tests**

Run: `npx jest src/lib/__tests__/unit/github-fetch-user-events.test.ts --ci`
Expected: PASS (3 tests).

Run: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts \
        src/lib/__tests__/unit/github-fetch-user-events.test.ts \
        src/lib/__tests__/unit/orgs-service.test.ts
git commit -m "feat(unmerged-work): add fetchUserOrgEvents GitHub provider method"
```

---

## Task 3: GitHub provider — `fetchPullRequestCommits` (per-PR commit list)

**Files:**
- Create: `src/lib/__tests__/unit/github-fetch-pr-commits.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github-mock.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/github-fetch-pr-commits.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { fetchPullRequestCommits, __setOctokitForTest } from '../../github';

describe('fetchPullRequestCommits', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns commits for a PR with author login + date + message', async () => {
    const mockListCommits = jest.fn().mockResolvedValueOnce({
      data: [
        {
          sha: 'aaa1',
          commit: {
            message: 'feat: thing',
            author: { name: 'Alice', email: 'alice@x', date: '2026-04-15T10:00:00Z' },
            committer: { date: '2026-04-15T10:00:00Z' },
          },
          author: { login: 'alice' },
        },
        {
          sha: 'bbb2',
          commit: {
            message: 'fix: typo',
            author: { name: 'Alice', email: 'alice@x', date: '2026-04-16T11:00:00Z' },
            committer: { date: '2026-04-16T11:00:00Z' },
          },
          author: { login: 'alice' },
        },
      ],
    });
    __setOctokitForTest({ pulls: { listCommits: mockListCommits } } as any);

    const commits = await fetchPullRequestCommits('acme', 'auth', 42);

    expect(commits).toEqual([
      { sha: 'aaa1', message: 'feat: thing', authorLogin: 'alice', committedAt: '2026-04-15T10:00:00Z' },
      { sha: 'bbb2', message: 'fix: typo',   authorLogin: 'alice', committedAt: '2026-04-16T11:00:00Z' },
    ]);
    expect(mockListCommits).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'auth', pull_number: 42, per_page: 100 }));
  });

  it('returns empty array when the PR has no commits', async () => {
    const mockListCommits = jest.fn().mockResolvedValueOnce({ data: [] });
    __setOctokitForTest({ pulls: { listCommits: mockListCommits } } as any);
    expect(await fetchPullRequestCommits('acme', 'auth', 42)).toEqual([]);
  });

  it('falls back to null authorLogin when author is unlinked', async () => {
    const mockListCommits = jest.fn().mockResolvedValueOnce({
      data: [{
        sha: 'ccc3',
        commit: { message: 'msg', author: { date: '2026-04-15T10:00:00Z' }, committer: { date: '2026-04-15T10:00:00Z' } },
        author: null,
      }],
    });
    __setOctokitForTest({ pulls: { listCommits: mockListCommits } } as any);
    const commits = await fetchPullRequestCommits('acme', 'auth', 42);
    expect(commits[0].authorLogin).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest src/lib/__tests__/unit/github-fetch-pr-commits.test.ts --ci`
Expected: FAIL — `fetchPullRequestCommits is not a function`.

- [ ] **Step 3: Implement in `src/lib/github.ts`**

Near `OpenPrInfo`:

```typescript
export interface UnmergedCommitInfo {
  sha:          string;
  message:      string;
  authorLogin:  string | null;
  committedAt:  string;
}
```

Add to `GitHubProvider`:

```typescript
fetchPullRequestCommits(owner: string, repo: string, pullNumber: number, log?: (msg: string) => void): Promise<UnmergedCommitInfo[]>;
```

After `fetchOpenPRs`, add:

```typescript
export async function fetchPullRequestCommits(
  owner: string,
  repo:  string,
  pullNumber: number,
  log?:  (msg: string) => void,
): Promise<UnmergedCommitInfo[]> {
  const result: UnmergedCommitInfo[] = [];
  for (let page = 1; page <= 3; page++) { // GitHub caps PR commits at 250
    await sleep(2500);
    const res = await withRetry(
      () => getOctokit().pulls.listCommits({ owner, repo, pull_number: pullNumber, per_page: 100, page }),
      log,
    );
    for (const c of res.data) {
      result.push({
        sha:          c.sha,
        message:      c.commit?.message || '',
        authorLogin:  c.author?.login ?? null,
        committedAt:  c.commit?.committer?.date || c.commit?.author?.date || '',
      });
    }
    if (res.data.length < 100) break;
  }
  return result;
}
```

Update `cachedProvider`:

```typescript
cachedProvider = {
  listOrgMembers, fetchUserActivity, listOrgs, countReviewedPRs,
  fetchOpenPRs, isCommitInDefaultBranch, fetchUserOrgEvents,
  fetchPullRequestCommits,
};
```

- [ ] **Step 4: Add mock in `src/lib/github-mock.ts`**

```typescript
    async fetchPullRequestCommits(_owner, _repo, pullNumber, log) {
      log?.(`[mock] fetchPullRequestCommits #${pullNumber}`);
      return [];
    },
```

- [ ] **Step 5: Update other test mocks**

Add `fetchPullRequestCommits: jest.fn().mockResolvedValue([])` to every provider stub (use grep from Task 2 step 5 to find them).

- [ ] **Step 6: Run tests**

Run: `npx jest src/lib/__tests__/unit/github-fetch-pr-commits.test.ts --ci`
Expected: PASS (3 tests).

Run: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts \
        src/lib/__tests__/unit/github-fetch-pr-commits.test.ts \
        src/lib/__tests__/unit/orgs-service.test.ts
git commit -m "feat(unmerged-work): add fetchPullRequestCommits GitHub provider method"
```

---

## Task 4: GitHub provider — `compareBranchCommits` + export `getCommitDetail`

**Files:**
- Create: `src/lib/__tests__/unit/github-compare-branch-commits.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github-mock.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/github-compare-branch-commits.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { compareBranchCommits, __setOctokitForTest } from '../../github';

describe('compareBranchCommits', () => {
  afterEach(() => { __setOctokitForTest(null as any); });

  it('returns commits in head not in base', async () => {
    const reposGet = jest.fn().mockResolvedValue({ data: { default_branch: 'main' } });
    const compareCommits = jest.fn().mockResolvedValueOnce({
      data: {
        commits: [
          { sha: 'aaa1', commit: { message: 'feat', author: { date: '2026-04-15T10:00:00Z' }, committer: { date: '2026-04-15T10:00:00Z' } }, author: { login: 'alice' } },
          { sha: 'bbb2', commit: { message: 'fix',  author: { date: '2026-04-16T10:00:00Z' }, committer: { date: '2026-04-16T10:00:00Z' } }, author: { login: 'alice' } },
        ],
      },
    });
    __setOctokitForTest({ repos: { get: reposGet, compareCommits } } as any);

    const commits = await compareBranchCommits('acme', 'auth-branch-test', 'feature-foo-sha');

    expect(commits).toEqual([
      { sha: 'aaa1', message: 'feat', authorLogin: 'alice', committedAt: '2026-04-15T10:00:00Z' },
      { sha: 'bbb2', message: 'fix',  authorLogin: 'alice', committedAt: '2026-04-16T10:00:00Z' },
    ]);
    expect(compareCommits).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'acme', repo: 'auth-branch-test', base: 'main', head: 'feature-foo-sha',
    }));
  });

  it('returns empty array when head equals base', async () => {
    const reposGet = jest.fn().mockResolvedValue({ data: { default_branch: 'main' } });
    const compareCommits = jest.fn().mockResolvedValueOnce({ data: { commits: [] } });
    __setOctokitForTest({ repos: { get: reposGet, compareCommits } } as any);
    expect(await compareBranchCommits('acme', 'auth-empty', 'sha')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest src/lib/__tests__/unit/github-compare-branch-commits.test.ts --ci`
Expected: FAIL — `compareBranchCommits is not a function`.

- [ ] **Step 3: Implement in `src/lib/github.ts`**

Add to `GitHubProvider`:

```typescript
compareBranchCommits(owner: string, repo: string, headSha: string, log?: (msg: string) => void): Promise<UnmergedCommitInfo[]>;
```

After `isCommitInDefaultBranch`, add:

```typescript
export async function compareBranchCommits(
  owner:   string,
  repo:    string,
  headSha: string,
  log?:    (msg: string) => void,
): Promise<UnmergedCommitInfo[]> {
  const base = await getDefaultBranch(owner, repo);
  const { data } = await withRetry(
    () => getOctokit().repos.compareCommits({ owner, repo, base, head: headSha }),
    log,
  );
  return (data.commits || []).map((c: any) => ({
    sha:         c.sha,
    message:     c.commit?.message || '',
    authorLogin: c.author?.login ?? null,
    committedAt: c.commit?.committer?.date || c.commit?.author?.date || '',
  }));
}
```

Then **expose** the existing private `getCommitDetail` so the report runner can call it directly. Find:

```typescript
async function getCommitDetail(
```

Change to:

```typescript
export async function getCommitDetail(
```

Update `cachedProvider`:

```typescript
cachedProvider = {
  listOrgMembers, fetchUserActivity, listOrgs, countReviewedPRs,
  fetchOpenPRs, isCommitInDefaultBranch, fetchUserOrgEvents,
  fetchPullRequestCommits, compareBranchCommits,
};
```

- [ ] **Step 4: Mock in `src/lib/github-mock.ts`**

```typescript
    async compareBranchCommits(_owner, _repo, _headSha, log) {
      log?.(`[mock] compareBranchCommits ${_repo}`);
      return [];
    },
```

- [ ] **Step 5: Update other test mocks**

Add `compareBranchCommits: jest.fn().mockResolvedValue([])` to provider stubs.

- [ ] **Step 6: Run tests**

Run: `npx jest src/lib/__tests__/unit/github-compare-branch-commits.test.ts --ci`
Expected: PASS (2 tests).

Run: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts \
        src/lib/__tests__/unit/github-compare-branch-commits.test.ts \
        src/lib/__tests__/unit/orgs-service.test.ts
git commit -m "feat(unmerged-work): add compareBranchCommits provider method + export getCommitDetail"
```

---

## Task 5: Report runner — replace unmerged-work flow with new unmerged-commits + unmerged-prs writes

**Files:**
- Modify: `src/lib/report-runner.ts`
- Modify: `src/lib/__tests__/integration/report-runner.test.ts`

- [ ] **Step 1: Update integration test mocks**

Open `src/lib/__tests__/integration/report-runner.test.ts`. Find the existing `mockFetchOpenPRs` declaration. After it (and before `mockGetGitHubProvider.mockReturnValue(...)`), add:

```typescript
const mockFetchUserOrgEvents = jest.fn().mockResolvedValue([]);
const mockFetchPullRequestCommits = jest.fn().mockResolvedValue([]);
const mockCompareBranchCommits = jest.fn().mockResolvedValue([]);
```

In the same file, find any lines starting with `jest.mock('@/lib/github')` and inspect what they mock. Add `getCommitDetail` to the mock factory if not present:

```typescript
jest.mock('@/lib/github', () => ({
  ...jest.requireActual('@/lib/github'),
  getGitHubProvider: jest.fn(),
  getCommitDetail: jest.fn().mockResolvedValue({ additions: 0, deletions: 0, diff: '' }),
}));
```

Update `mockGetGitHubProvider.mockReturnValue({...})` to include:

```typescript
fetchUserOrgEvents:       mockFetchUserOrgEvents,
fetchPullRequestCommits:  mockFetchPullRequestCommits,
compareBranchCommits:     mockCompareBranchCommits,
```

In any `beforeEach` reset block:

```typescript
mockFetchUserOrgEvents.mockReset(); mockFetchUserOrgEvents.mockResolvedValue([]);
mockFetchPullRequestCommits.mockReset(); mockFetchPullRequestCommits.mockResolvedValue([]);
mockCompareBranchCommits.mockReset(); mockCompareBranchCommits.mockResolvedValue([]);
```

- [ ] **Step 2: Add a failing integration test for unmerged_commits inserts**

In `src/lib/__tests__/integration/report-runner.test.ts`, add a new test inside the existing `describe('runReport', ...)`:

```typescript
it('persists per-commit rows to unmerged_commits via PR commits + branch compare', async () => {
  const { getCommitDetail } = require('@/lib/github');

  // Alice has one open PR with one commit
  mockFetchOpenPRs.mockImplementation(async (_org, user) =>
    user === 'alice'
      ? [{ repo: 'app', number: 7, title: 'wip', url: 'https://github.com/o/app/pull/7', draft: false, commits: 1, additions: 30, deletions: 5, createdAt: '2026-04-10', updatedAt: '2026-04-22' }]
      : [],
  );
  mockFetchPullRequestCommits.mockImplementation(async (_owner, _repo, n) =>
    n === 7
      ? [{ sha: 'pr-sha-1', message: 'wip commit', authorLogin: 'alice', committedAt: '2026-04-22T15:00:00Z' }]
      : [],
  );
  // Alice also pushed a commit to a branch with no PR
  mockFetchUserOrgEvents.mockImplementation(async (_org, user) =>
    user === 'alice'
      ? [{ type: 'PushEvent', repo: 'app', ref: 'refs/heads/wip-branch', headSha: 'orphan-head' }]
      : [],
  );
  mockCompareBranchCommits.mockImplementation(async (_owner, _repo, head) =>
    head === 'orphan-head'
      ? [{ sha: 'orphan-sha-1', message: 'WIP no PR', authorLogin: 'alice', committedAt: '2026-04-21T15:00:00Z' }]
      : [],
  );
  (getCommitDetail as jest.Mock).mockResolvedValue({ additions: 30, deletions: 5, diff: '' });

  await runReport('r1', 'my-org', 14);

  const inserts = mockDbExecute.mock.calls.filter(
    (call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('INSERT') &&
      call[0].includes('unmerged_commits'),
  );
  expect(inserts.length).toBe(2);

  const prShas = inserts.map((c: any[]) => c[1][6]); // commit_sha is the 7th param (0-indexed 6) — see step 3 INSERT
  expect(prShas).toContain('pr-sha-1');
  expect(prShas).toContain('orphan-sha-1');
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts -t "unmerged_commits" --ci`
Expected: FAIL.

- [ ] **Step 4: Modify `src/lib/report-runner.ts`**

Open `src/lib/report-runner.ts`. The current code has two blocks inside the per-engineer loop — one inserts open-PR rows into `unmerged_work`, and one classifies/inserts bare-branch commits. Find those two blocks and **replace them with**:

First, the open-PR rows now go to `unmerged_prs`:

```typescript
        // Fetch open PRs for this member (in-flight metadata, not counted in impact)
        let openPrs: any[] = [];
        try {
          openPrs = await github.fetchOpenPRs(org, member.login, since, log);
          if (openPrs.length > 0) log(`@${member.login}: ${openPrs.length} open PR(s)`);
          for (const pr of openPrs) {
            await db.execute(
              `INSERT IGNORE INTO unmerged_prs
                 (report_id, github_login, repo, pr_number, pr_title, pr_url,
                  is_draft, pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                reportId, member.login, pr.repo, pr.number, pr.title, pr.url,
                pr.draft ? 1 : 0, pr.commits, pr.additions, pr.deletions, pr.createdAt, pr.updatedAt,
              ],
            );
          }
        } catch (err) {
          log(`@${member.login} openPRs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
```

Replace the previous bare-branch detection loop entirely with the new unmerged-commits flow. Add this immediately after the `memberCommits.set(member.login, thisMemCommits);` line (where the old bare-branch loop used to be):

```typescript
        // ── Unmerged commits flow (per-engineer, isolated from main report) ──
        // Build a per-engineer set of unmerged commit SHAs across two sources:
        //   (1) commits in the engineer's open PRs
        //   (2) commits on non-default branches the engineer pushed to (no PR yet)
        // Then enrich each unique SHA with line counts via getCommitDetail.
        try {
          type UmRecord = { repo: string; sha: string; message: string; committedAt: string; branch: string | null; prNumber: number | null };
          const seenSha = new Set<string>();
          const queue: UmRecord[] = [];

          // (1) commits in open PRs
          for (const pr of openPrs) {
            const prCommits = await github.fetchPullRequestCommits(org, pr.repo, pr.number, log);
            for (const c of prCommits) {
              if (c.authorLogin && c.authorLogin !== member.login) continue;
              if (seenSha.has(c.sha)) continue;
              seenSha.add(c.sha);
              queue.push({ repo: pr.repo, sha: c.sha, message: c.message, committedAt: c.committedAt, branch: null, prNumber: pr.number });
            }
          }

          // (2) commits on orphan branches (push events to non-default branches that aren't already covered by an open PR)
          const events = await github.fetchUserOrgEvents(org, member.login, log);
          const prBranches = new Set(openPrs.map(pr => `${pr.repo}::${pr.head_ref || ''}`)); // we don't track head_ref on PR rows yet; rely on SHA dedup below instead
          const branchSeen = new Set<string>();
          for (const ev of events) {
            const key = `${ev.repo}::${ev.ref}`;
            if (branchSeen.has(key)) continue;
            branchSeen.add(key);
            const defaultBranch = await github.isCommitInDefaultBranch(org, ev.repo, ev.headSha)
              ? null  // head is in default — the ref is presumably default; skip
              : 'check';
            if (defaultBranch === null) continue;
            const branchName = ev.ref.replace(/^refs\/heads\//, '');
            const branchCommits = await github.compareBranchCommits(org, ev.repo, ev.headSha, log);
            for (const c of branchCommits) {
              if (c.authorLogin && c.authorLogin !== member.login) continue;
              if (seenSha.has(c.sha)) continue;
              seenSha.add(c.sha);
              queue.push({ repo: ev.repo, sha: c.sha, message: c.message, committedAt: c.committedAt, branch: branchName, prNumber: null });
            }
          }

          // (3) per-commit line counts
          for (const item of queue) {
            try {
              const detail = await getCommitDetail(org, item.repo, item.sha, log);
              await db.execute(
                `INSERT IGNORE INTO unmerged_commits
                   (report_id, github_login, repo, branch, pr_number, commit_sha, commit_message,
                    lines_added, lines_removed, committed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  reportId, member.login, item.repo, item.branch, item.prNumber,
                  item.sha, item.message, detail.additions, detail.deletions, item.committedAt,
                ],
              );
            } catch (err) {
              log(`unmerged-commit detail failed for ${item.sha.slice(0, 7)}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } catch (err) {
          log(`@${member.login} unmerged-commits flow failed: ${err instanceof Error ? err.message : String(err)}`);
        }
```

At the top of the file, ensure `getCommitDetail` is imported alongside the existing GitHub imports:

```typescript
import { getCommitDetail } from './github';
```

Adjust the import line that's already there if `getCommitDetail` isn't included yet.

Note: the existing INSERT for `unmerged_work kind='bare_branch_commit'` and the classification loop right above it are both **removed**. The file should no longer reference `unmerged_work` anywhere.

- [ ] **Step 5: Run to confirm tests pass**

Run: `npx jest src/lib/__tests__/integration/report-runner.test.ts --ci`
Expected: PASS.

Run full suite: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report-runner.ts src/lib/__tests__/integration/report-runner.test.ts
git commit -m "feat(unmerged-work): runner — write unmerged_prs + unmerged_commits per engineer"
```

---

## Task 6: Org API — overlay from `unmerged_commits`, KPI from `unmerged_prs` + `unmerged_commits`

**Files:**
- Modify: `src/lib/report/org.ts`
- Modify: `src/lib/__tests__/unit/org-unmerged-summary.test.ts`

- [ ] **Step 1: Update existing tests for the new query structure**

Open `src/lib/__tests__/unit/org-unmerged-summary.test.ts`. The test `mockBaselineQueries` helper queues mocks in a fixed sequence. The new code in Task 6 step 2 will issue these queries in this order (after the existing 4 queries — reports, dev_stats, reportIds, timelineCommits):

5. `SELECT committed_at, lines_added, lines_removed FROM unmerged_commits WHERE report_id = ?` (overlay)
6. `SELECT ... unmergedSummary aggregation` (single multi-aggregation)

Replace the helper's last two `dbExec.mockResolvedValueOnce(...)` lines (currently for openPrRows + unmergedAgg) with:

```typescript
    // 5. unmerged_commits rows for overlay
    dbExec.mockResolvedValueOnce([overlayCommits, null]);
    // 6. unmerged summary aggregation (single multi-aggregation row)
    if (unmergedAgg) {
      dbExec.mockResolvedValueOnce([[unmergedAgg], null]);
    } else {
      dbExec.mockResolvedValueOnce([[{ openPrCount: 0, openPrDevCount: 0, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 0, inFlightLinesRemoved: 0 }], null]);
    }
```

Update the function signature and inputs:

```typescript
function mockBaselineQueries({
  org = 'acme',
  devs = [],
  reportIds = ['r1'],
  timelineCommits = [],
  overlayCommits = [],
  unmergedAgg = null,
}: {
  org?: string;
  devs?: any[];
  reportIds?: string[];
  timelineCommits?: any[];
  overlayCommits?: Array<{ committed_at: string; lines_added: number; lines_removed: number }>;
  unmergedAgg?: { openPrCount: number; openPrDevCount: number; bareBranchCount: number; bareBranchDevCount: number; inFlightLinesAdded: number; inFlightLinesRemoved: number; } | null;
})
```

Replace the existing test "adds open-PR commits to types.in_flight bucketed by week of pr_updated_at" with this new test:

```typescript
  it('adds unmerged_commits rows to types.in_flight bucketed by week of committed_at', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'aaa', github_login: 'alice', committed_at: '2026-04-22T15:00:00Z', lines_added: 10, lines_removed: 2, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      overlayCommits: [
        { committed_at: '2026-04-22T15:00:00Z', lines_added: 100, lines_removed: 30 },
        { committed_at: '2026-04-22T15:00:00Z', lines_added: 50,  lines_removed: 5  },
      ],
      unmergedAgg: { openPrCount: 1, openPrDevCount: 1, bareBranchCount: 0, bareBranchDevCount: 0, inFlightLinesAdded: 150, inFlightLinesRemoved: 35 },
    });
    const result = await getOrgReport('rep1');
    const week = result.timeline.find((w: any) => w.week === '2026-04-20')!;
    expect(week).toBeDefined();
    expect(week.types.in_flight).toBe(2);
    expect(week.types.feature).toBe(1);
    expect(week.commits).toBe(3);                      // 1 shipped + 2 in-flight
    expect(week.linesAdded).toBe(160);                 // 10 + 100 + 50
    expect(week.linesRemoved).toBe(37);                // 2 + 30 + 5
    expect(week.inFlightLinesAdded).toBe(150);
    expect(week.inFlightLinesRemoved).toBe(35);
  });
```

Replace the "creates a new week bucket" and "does not modify timeline when no open PRs exist" tests with the equivalent shapes referencing `overlayCommits` instead of `openPrRows`:

```typescript
  it('creates a new week bucket if a unmerged commit is in a week without shipped commits', async () => {
    mockBaselineQueries({
      timelineCommits: [],
      overlayCommits: [{ committed_at: '2026-04-22T15:00:00Z', lines_added: 50, lines_removed: 10 }],
      unmergedAgg: { openPrCount: 0, openPrDevCount: 0, bareBranchCount: 1, bareBranchDevCount: 1, inFlightLinesAdded: 50, inFlightLinesRemoved: 10 },
    });
    const result = await getOrgReport('rep1');
    expect(result.timeline.length).toBe(1);
    const week = result.timeline[0];
    expect(week.week).toBe('2026-04-20');
    expect(week.types.in_flight).toBe(1);
    expect(week.commits).toBe(1);
    expect(week.inFlightLinesAdded).toBe(50);
  });

  it('does not modify timeline when no overlay commits exist', async () => {
    mockBaselineQueries({
      timelineCommits: [
        { commit_sha: 'xxx', github_login: 'a', committed_at: '2026-04-22T15:00:00Z', lines_added: 1, lines_removed: 0, complexity: 5, type: 'feature', ai_co_authored: 0, maybe_ai: 0 },
      ],
      overlayCommits: [],
      unmergedAgg: null,
    });
    const result = await getOrgReport('rep1');
    const week = result.timeline.find((w: any) => w.week === '2026-04-20')!;
    expect(week.types.feature).toBe(1);
    expect(week.types.in_flight).toBeUndefined();
    expect(week.inFlightLinesAdded).toBeUndefined();
  });
```

The `unmergedSummary` null + with-counts tests stay as-is.

- [ ] **Step 2: Update `src/lib/report/org.ts`**

Open `src/lib/report/org.ts`. Replace the existing in-flight overlay block (currently SELECTs from `unmerged_work` where kind='open_pr' and buckets by `pr_updated_at`) with this:

```typescript
  // In-flight overlay: per-commit data sourced from unmerged_commits.
  const [overlayRows] = await db.execute(
    `SELECT committed_at, lines_added, lines_removed
     FROM unmerged_commits
     WHERE report_id = ?`,
    [reportId],
  ) as [any[], any];

  if (overlayRows.length > 0) {
    const weekMap = new Map<string, any>();
    for (const w of timeline) weekMap.set(w.week, w);

    for (const row of overlayRows) {
      if (!row.committed_at) continue;
      const d = new Date(row.committed_at);
      if (Number.isNaN(d.getTime())) continue;
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const weekKey = monday.toISOString().split('T')[0];

      let bucket = weekMap.get(weekKey);
      if (!bucket) {
        bucket = {
          week: weekKey,
          commits: 0,
          linesAdded: 0,
          linesRemoved: 0,
          linesP95Added: 0,
          linesP95Removed: 0,
          avgComplexity: 0,
          aiPercent: 0,
          types: {},
          inFlightLinesAdded: 0,
          inFlightLinesRemoved: 0,
          activeDevs: 0,
        };
        weekMap.set(weekKey, bucket);
        timeline.push(bucket);
      }

      const a = Number(row.lines_added   || 0);
      const r = Number(row.lines_removed || 0);

      bucket.commits         += 1;
      bucket.linesAdded      += a;
      bucket.linesRemoved    += r;
      bucket.linesP95Added   = (bucket.linesP95Added   || 0) + a;
      bucket.linesP95Removed = (bucket.linesP95Removed || 0) + r;
      bucket.types           = { ...(bucket.types || {}) };
      bucket.types.in_flight = (bucket.types.in_flight || 0) + 1;
      bucket.inFlightLinesAdded   = (bucket.inFlightLinesAdded   || 0) + a;
      bucket.inFlightLinesRemoved = (bucket.inFlightLinesRemoved || 0) + r;
    }

    timeline.sort((a, b) => a.week.localeCompare(b.week));
  }
```

Update the `unmergedSummary` aggregation. Replace the existing query with one that combines two tables:

```typescript
  // KPI-card aggregation: PR counts from unmerged_prs, commit counts from unmerged_commits
  const [unmergedAggRows] = await db.execute(
    `SELECT
       (SELECT COUNT(*)              FROM unmerged_prs     WHERE report_id = ?) AS openPrCount,
       (SELECT COUNT(DISTINCT github_login) FROM unmerged_prs WHERE report_id = ?) AS openPrDevCount,
       (SELECT COUNT(*)              FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareBranchCount,
       (SELECT COUNT(DISTINCT github_login) FROM unmerged_commits WHERE report_id = ? AND pr_number IS NULL) AS bareBranchDevCount,
       (SELECT COALESCE(SUM(lines_added),   0) FROM unmerged_commits WHERE report_id = ?) AS inFlightLinesAdded,
       (SELECT COALESCE(SUM(lines_removed), 0) FROM unmerged_commits WHERE report_id = ?) AS inFlightLinesRemoved`,
    [reportId, reportId, reportId, reportId, reportId, reportId],
  ) as [any[], any];
```

The `unmergedSummary` building block below it (`const aggRow = ...; const unmergedSummary = ...`) stays the same — same return shape.

- [ ] **Step 3: Run tests**

Run: `npx jest src/lib/__tests__/unit/org-unmerged-summary.test.ts --ci`
Expected: PASS.

Run full suite: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/report/org.ts src/lib/__tests__/unit/org-unmerged-summary.test.ts
git commit -m "feat(unmerged-work): org overlay reads from unmerged_commits per real committed_at"
```

---

## Task 7: Dev API + summary prompt — read from `unmerged_prs` + `unmerged_commits`

**Files:**
- Modify: `src/lib/report/dev.ts`
- Modify: `src/lib/report/summary.ts`

- [ ] **Step 1: Update `src/lib/report/dev.ts`**

Find the existing `unmerged_work` SELECT in `getDevReport` (around line 90-100). Replace with two separate queries:

```typescript
  // Unmerged work: PR-level metadata and per-commit data live in two tables now.
  const [unmergedPrRows] = await db.execute(
    `SELECT pr_number, pr_title, pr_url, repo, is_draft,
            pr_commits, pr_additions, pr_deletions, pr_created_at, pr_updated_at
     FROM unmerged_prs
     WHERE report_id = ? AND github_login = ?
     ORDER BY pr_updated_at DESC`,
    [reportId, login],
  ) as [any[], any];

  const [unmergedCommitRows] = await db.execute(
    `SELECT commit_sha, repo, branch, pr_number, commit_message,
            lines_added, lines_removed, committed_at
     FROM unmerged_commits
     WHERE report_id = ? AND github_login = ? AND pr_number IS NULL
     ORDER BY committed_at DESC`,
    [reportId, login],
  ) as [any[], any];

  const openPrs = unmergedPrRows.map((r: any) => ({
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
  const branchCommits = unmergedCommitRows.map((r: any) => ({
    repo:        r.repo,
    sha:         r.commit_sha,
    message:     r.commit_message,
    branchName:  r.branch,
    additions:   r.lines_added,
    deletions:   r.lines_removed,
    committedAt: r.committed_at,
  }));
```

The downstream `unmergedWork: { openPrs, branchCommits }` field on the return object stays the same — UI doesn't change.

- [ ] **Step 2: Update `src/lib/report/summary.ts`**

Find the existing `unmerged_work` SELECT in `getDevSummary`. Replace with the same two-query pattern:

```typescript
  const [unmergedPrRows] = await db.execute(
    `SELECT pr_title, pr_created_at, pr_updated_at, is_draft
     FROM unmerged_prs
     WHERE report_id = ? AND github_login = ?`,
    [reportId, login],
  ) as [any[], any];

  const [unmergedCommitRows] = await db.execute(
    `SELECT commit_message, repo, committed_at
     FROM unmerged_commits
     WHERE report_id = ? AND github_login = ? AND pr_number IS NULL`,
    [reportId, login],
  ) as [any[], any];

  const unmergedPrs = unmergedPrRows.map((r: any) => ({
    title:     r.pr_title,
    createdAt: r.pr_created_at,
    updatedAt: r.pr_updated_at,
    draft:     Boolean(r.is_draft),
  }));
  const unmergedCommits = unmergedCommitRows.map((r: any) => ({
    message:     r.commit_message,
    repo:        r.repo,
    committedAt: r.committed_at,
  }));
```

The call to `formatUnmergedWorkSection(unmergedPrs, unmergedCommits)` below stays unchanged.

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/report/dev.ts src/lib/report/summary.ts
git commit -m "feat(unmerged-work): dev API + summary read from unmerged_prs + unmerged_commits"
```

---

## Task 8: End-to-end verification + manual bare-branch test

- [ ] **Step 1: Full test suite**

Run: `npm test -- --ci`
Expected: all tests PASS.

- [ ] **Step 2: Production build**

```bash
rm -rf .next
npm run build
```

Expected: clean compile.

- [ ] **Step 3: Rebuild + redeploy local container**

```bash
podman-compose build app
AUTH_ENABLED=true AUTH_TEST_USER=admin AUTH_ADMIN_GROUP=glooker-admins podman-compose up -d --force-recreate app
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/health
```

Expected: HTTP 200.

- [ ] **Step 4: Verify schema migration ran**

```bash
mysql -u glooker -pglooker -h 127.0.0.1 -P 3307 glooker -e "
SHOW TABLES LIKE 'unmerged%';
DESCRIBE unmerged_prs;
DESCRIBE unmerged_commits;
"
```

Expected: `unmerged_prs` and `unmerged_commits` exist; `unmerged_work` does NOT (or exists with zero rows since it was dropped). The two new tables match the schemas in Task 1.

- [ ] **Step 5: Run a fresh report against Smartling**

From the UI: go to Reports History → Generate Report → 14 days against `Smartling` org. Wait for completion (~30-50 min — the new flow adds ~20-25 min of GitHub calls).

- [ ] **Step 6: Smoke-test the org API**

```bash
REPORT_ID=$(mysql -u glooker -pglooker -h 127.0.0.1 -P 3307 glooker -sN -e "SELECT id FROM reports ORDER BY created_at DESC LIMIT 1;")
echo "Latest report: $REPORT_ID"
curl -s "http://localhost:3000/api/report/$REPORT_ID/org" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('unmergedSummary:', json.dumps(d.get('unmergedSummary'), indent=2))
weeks_with_inflight = [(w['week'], w['types'].get('in_flight', 0)) for w in d.get('timeline', []) if w.get('types', {}).get('in_flight')]
print(f'weeks with in_flight: {len(weeks_with_inflight)}')
for w, c in weeks_with_inflight[-6:]: print(f'  {w}: {c} in-flight commits')
"
```

Expected output (numbers will vary by org activity):
```
unmergedSummary: { openPrCount, openPrDevCount, bareBranchCount, bareBranchDevCount, inFlightLinesAdded, inFlightLinesRemoved }
weeks with in_flight: 4-8 (spread across the 90-day window)
  ...per-week counts, distributed by real commit dates...
```

The key change vs the previous design: in-flight commits should now be distributed across MULTIPLE weeks, not lumped into one or two `pr_updated_at` weeks.

- [ ] **Step 7: Visual verification in browser**

Visit `http://localhost:3000/report/$REPORT_ID/org`:
- KPI cards populated.
- Pie chart `in_flight` slice present (assuming any unmerged work exists).
- Stacked Commit Types chart shows amber `in_flight` layer across multiple weeks (not just the most recent).
- `Commits / Week` chart bars are split between blue (shipped) and amber (in-flight).
- `Lines Changed / Week` chart shows amber overlay on the green/red.

Visit a dev's detail page, e.g. `http://localhost:3000/report/$REPORT_ID/dev/dsavchenko-sm`:
- "In-flight Work" section shows Open Pull Requests AND, **for the first time**, Branch Commits with real per-commit data.

- [ ] **Step 8: Manual bare-branch verification (the original §8 TODO from the previous spec)**

This confirms the orphan-branch-no-PR path works end-to-end:

```bash
cd /Users/msogin/Desktop/claudecode/glooker
git checkout main && git pull
git checkout -b verify-bare-branch-detection
echo "// bare-branch verification — delete me" >> README.md
git add README.md && git commit -m "test: bare-branch verification — delete me"
git push -u origin verify-bare-branch-detection
# Do NOT open a PR
```

Generate ANOTHER fresh report. After completion, expect:
- `unmergedSummary.bareBranchCount ≥ 1`
- The verification commit appears in `msogin`'s dev detail "Branch Commits (not in default branch)" section
- Pie chart `in_flight` slice incremented by 1
- A `Commits / Week` bar at the week of the commit shows an amber portion

Cleanup:
```bash
git checkout main
git push origin --delete verify-bare-branch-detection
git branch -D verify-bare-branch-detection
```

If any of these fail, report back with what you saw — there's a regression.

- [ ] **Step 9: Push branch + open PR**

Per user's standing preference (memory: feedback_no_push_before_test), wait for explicit user approval before pushing. Once approved:

```bash
git push -u origin feature/unmerged-work-org-charts
gh pr create --title "feat(unmerged-work): per-commit data via events feed + per-PR commits API" \
  --body "Implements docs/superpowers/specs/2026-04-27-unmerged-commits-redesign-design.md."
```

Return the PR URL.

---

## Self-review

### Spec coverage

- §3 (in-scope: `unmerged_commits` table) → Task 1
- §3 (rename `unmerged_work` → `unmerged_prs`) → Task 1
- §3 (per-engineer fetch in existing loop) → Task 5
- §3 (failure isolation) → Task 5 (try/catch wrapper around the new flow)
- §4 (schema MySQL + SQLite) → Task 1
- §5 (pipeline 1 — open-PR commits) → Task 5 (Step 4, item 1)
- §5 (pipeline 2 — branch-no-PR commits) → Task 5 (Step 4, item 2)
- §5 (pipeline 3 — dedupe SHAs) → Task 5 (Step 4, `seenSha`)
- §5 (pipeline 4 — per-commit lines via getCommitDetail) → Task 5 (Step 4, item 3) + Task 4 (export)
- §5 (author filter) → Task 5 (Step 4, `authorLogin !== member.login` check)
- §6 (org overlay from unmerged_commits) → Task 6
- §6 (KPI from unmerged_prs + unmerged_commits) → Task 6
- §7 (dev page sources) → Task 7
- §8 (LLM prompt sources) → Task 7
- §10 (unit tests for new provider methods) → Tasks 2, 3, 4
- §10 (integration test for runner) → Task 5 Step 2
- §10 (test for org overlay) → Task 6 Step 1
- §11 (manual verification) → Task 8 Step 8

### Type / name consistency

- `UnmergedCommitInfo`: `{ sha, message, authorLogin, committedAt }`. Used by `fetchPullRequestCommits` (Task 3) and `compareBranchCommits` (Task 4). ✓
- `UserOrgEvent`: `{ type, repo, ref, headSha }`. Used by `fetchUserOrgEvents` (Task 2) and consumed by runner (Task 5). ✓
- DB columns: `unmerged_commits.committed_at` matches the `committedAt` field consistently. `unmerged_prs.pr_updated_at` matches `updatedAt` field on `OpenPrInfo` (which is unchanged). ✓
- The runner inserts `lines_added`/`lines_removed` from `getCommitDetail` (returns `additions`/`deletions`). Mapping: `INSERT (lines_added, lines_removed) VALUES (detail.additions, detail.deletions)`. Consistent. ✓
- Author filter consistently uses `c.authorLogin === member.login` across both PR and branch fetches. ✓

### Frequent commits

8 task-level commits + 1 PR push. Each task is self-contained.

### YAGNI checks

- Single multi-aggregation query for KPI counts (avoids 6 round-trips).
- No new chart components — reusing existing `TimelineChart`, `LinesChangedChart`, `PieChart`, `StackedTypesChart`.
- No LLM analysis on unmerged commits (per spec).
- No backfill or data migration — existing reports lose unmerged data, accepted as transient.
