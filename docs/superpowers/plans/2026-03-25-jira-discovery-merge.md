# Jira Discovery Loop Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the sequential post-LLM Jira discovery loop into the main per-member GitHub fetch loop so both run concurrently per member.

**Architecture:** `resolveJiraUser` currently reads emails from the `commit_analyses` DB table, which is only populated after LLM analysis runs — forcing Jira to be a second pass. We change the signature to accept `emails: string[]` directly (already available in-memory from `fetchUserActivity`). With that dependency removed, each member's Jira fetch can be fired off as a non-awaited promise alongside LLM work, collected in a `pendingJira` array, and awaited before final aggregation. Note: per-member Jira progress step messages (`[N/M] Fetching Jira issues`) are intentionally dropped — concurrent execution makes them meaningless; a single summary log remains.

**Tech Stack:** TypeScript, Jest + ts-jest, SQLite/MySQL via `db.execute`

---

## File Map

| File | Change |
|------|--------|
| `src/lib/jira/mapper.ts` | Replace `reportId: string` param with `emails: string[]`; remove DB email query |
| `src/lib/__tests__/unit/jira-mapper.test.ts` | Update tests to new signature; remove DB mock for email query |
| `src/lib/report-runner.ts` | Add `pendingJira[]`; fire Jira per member after commit dedup; remove old Jira loop; await both arrays |
| `src/lib/__tests__/integration/report-runner.test.ts` | Add Jira mocks; add test verifying Jira fires per active member |

---

### Task 1: Update `resolveJiraUser` to accept emails directly

**Files:**
- Modify: `src/lib/jira/mapper.ts`
- Test: `src/lib/__tests__/unit/jira-mapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire test file content — the new signature drops `reportId` and accepts `emails: string[]` as the third argument. The auto-discovery test no longer mocks a DB call for emails (old test used 3 DB calls; new test uses 2).

```typescript
// src/lib/__tests__/unit/jira-mapper.test.ts
import { resolveJiraUser } from '@/lib/jira/mapper';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

jest.mock('@/lib/jira/client', () => ({
  getJiraClient: jest.fn(),
}));

import db from '@/lib/db';
import { getJiraClient } from '@/lib/jira/client';

const mockDb = db as any;
const mockGetJiraClient = getJiraClient as jest.Mock;

describe('resolveJiraUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing mapping from DB', async () => {
    mockDb.execute.mockResolvedValueOnce([[{
      jira_account_id: 'jira-123',
      jira_email: 'dev@co.com',
    }], null]);

    const result = await resolveJiraUser('myorg', 'devuser', ['dev@co.com']);
    expect(result).toEqual({ accountId: 'jira-123', email: 'dev@co.com' });
    // Only one DB call — the mapping lookup; no email query
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('returns null when no mapping and no Jira client', async () => {
    mockDb.execute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue(null);

    const result = await resolveJiraUser('myorg', 'devuser', ['dev@co.com']);
    expect(result).toBeNull();
  });

  it('returns null when no mapping, client present, but no emails provided', async () => {
    mockDb.execute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue({ findUserByEmail: jest.fn() });

    const result = await resolveJiraUser('myorg', 'devuser', []);
    expect(result).toBeNull();
  });

  it('auto-discovers via provided emails and persists mapping', async () => {
    // DB calls: 1 mapping lookup + 1 persist (no longer a 3rd call for email query)
    mockDb.execute
      .mockResolvedValueOnce([[], null])   // mapping lookup → not found
      .mockResolvedValueOnce([[], null]);  // persist INSERT

    const mockClient = {
      findUserByEmail: jest.fn()
        .mockResolvedValueOnce(null)  // dev@co.com → not found
        .mockResolvedValueOnce({ accountId: 'jira-456', displayName: 'Dev' }),
    };
    mockGetJiraClient.mockReturnValue(mockClient);

    const result = await resolveJiraUser('myorg', 'devuser', ['dev@co.com', 'dev@personal.com']);
    expect(result).toEqual({ accountId: 'jira-456', email: 'dev@personal.com' });
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/fluffy/Work/Projects/services/glooker
npm test -- --testPathPattern="jira-mapper" 2>&1 | tail -30
```

Expected: type errors or test failures because `resolveJiraUser` still has old signature.

- [ ] **Step 3: Update `resolveJiraUser` implementation**

New signature: replace `reportId: string` with `emails: string[]`. Remove the `commit_analyses` DB query block (lines 29–38 of current file). Use the passed-in `emails` array directly.

```typescript
// src/lib/jira/mapper.ts
import db from '@/lib/db';
import { getJiraClient } from './client';

interface JiraMapping {
  accountId: string;
  email: string | null;
}

export async function resolveJiraUser(
  org: string,
  githubLogin: string,
  emails: string[],
  log?: (msg: string) => void,
): Promise<JiraMapping | null> {
  // 1. Check existing mapping
  const [rows] = await db.execute(
    `SELECT jira_account_id, jira_email FROM user_mappings WHERE org = ? AND github_login = ?`,
    [org, githubLogin],
  ) as [any[], any];

  if (rows.length > 0 && rows[0].jira_account_id) {
    return { accountId: rows[0].jira_account_id, email: rows[0].jira_email };
  }

  // 2. Auto-discover via provided emails
  const client = getJiraClient();
  if (!client) return null;

  if (emails.length === 0) {
    log?.(`[jira] No commit emails provided for @${githubLogin}, cannot auto-discover Jira mapping`);
    return null;
  }

  for (const email of emails) {
    try {
      await new Promise(r => setTimeout(r, 1000));
      const user = await client.findUserByEmail(email);
      if (user) {
        log?.(`[jira] Auto-discovered: @${githubLogin} → ${user.displayName} (${email})`);
        // 3. Persist mapping
        await db.execute(
          `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email, created_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE jira_account_id = VALUES(jira_account_id), jira_email = VALUES(jira_email)`,
          [org, githubLogin, user.accountId, email],
        );
        return { accountId: user.accountId, email };
      }
    } catch (err) {
      log?.(`[jira] Error looking up ${email} for @${githubLogin}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log?.(`[jira] No Jira user found for @${githubLogin} (tried ${emails.length} email(s))`);
  return null;
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- --testPathPattern="jira-mapper" 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jira/mapper.ts src/lib/__tests__/unit/jira-mapper.test.ts
git commit -m "refactor: resolveJiraUser accepts emails directly instead of querying DB"
```

---

### Task 2: Merge Jira discovery into main loop in `report-runner.ts`

**Files:**
- Modify: `src/lib/report-runner.ts`
- Test: `src/lib/__tests__/integration/report-runner.test.ts`

- [ ] **Step 1: Add Jira mocks and a new test to the integration test file**

**Critical:** `jest.mock('@/lib/app-config/service')` replaces `getAppConfig` with an auto-mock returning `undefined`. This breaks ALL existing tests unless `beforeEach` provides a default return value — they will throw `TypeError: Cannot read properties of undefined (reading 'jira')` at runtime. The `beforeEach` addition below is required for correctness, not just for the new test.

Add these mocks at the top of `report-runner.test.ts` (after the existing `jest.mock` calls):

```typescript
jest.mock('@/lib/jira', () => ({
  getJiraClient: jest.fn(),
  resolveJiraUser: jest.fn(),
}));
jest.mock('@/lib/app-config/service', () => ({
  getAppConfig: jest.fn(),
}));
```

Add to imports (after existing imports):

```typescript
import { getJiraClient, resolveJiraUser } from '@/lib/jira';
import { getAppConfig } from '@/lib/app-config/service';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockResolveJiraUser = resolveJiraUser as jest.Mock;
const mockGetAppConfig = getAppConfig as jest.Mock;
```

Add to the existing `beforeEach` block (required — disables Jira for all existing tests):

```typescript
mockGetAppConfig.mockReturnValue({ jira: { enabled: false, projects: [] } });
```

Add the new test at the end of the `describe('runReport')` block:

```typescript
it('fires Jira discovery per active member when Jira is enabled', async () => {
  mockGetAppConfig.mockReturnValue({ jira: { enabled: true, projects: [] } });

  const mockJiraClient = {
    searchDoneIssues: jest.fn().mockResolvedValue([
      {
        projectKey: 'PROJ', issueKey: 'PROJ-1', issueType: 'Story',
        summary: 'A ticket', description: '', status: 'Done',
        labels: [], storyPoints: null, originalEstimateSeconds: null,
        issueUrl: 'https://jira.example.com/browse/PROJ-1',
        createdAt: '2025-01-01', resolvedAt: '2025-01-10',
      },
    ]),
  };
  mockGetJiraClient.mockReturnValue(mockJiraClient);
  mockResolveJiraUser.mockResolvedValue({ accountId: 'jira-abc', email: 'alice@co.com' });

  mockDbExecute.mockImplementation(async (sql: string) => {
    if (typeof sql === 'string' && sql.includes('jira_issues') && sql.includes('COUNT')) {
      return [[{ cnt: 0 }], null];
    }
    return [[], null];
  });

  await runReport('r-jira', 'my-org', 14);

  // Both alice and bob have commits → Jira should be queried for both
  expect(mockResolveJiraUser).toHaveBeenCalledTimes(2);
  expect(mockJiraClient.searchDoneIssues).toHaveBeenCalledTimes(2);

  // Verify jira_issues INSERT was called for both members (1 issue each)
  const jiraInserts = mockDbExecute.mock.calls.filter(
    (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT IGNORE INTO jira_issues'),
  );
  expect(jiraInserts).toHaveLength(2);

  // Verify final developer_stats includes total_jira_issues = 1 for both members
  const statsInserts = mockDbExecute.mock.calls.filter(
    (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO developer_stats'),
  );
  const finalInsert = statsInserts[statsInserts.length - 1];
  // total_jira_issues is the 13th param (index 12) in the VALUES list
  expect(finalInsert[1][12]).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

```bash
npm test -- --testPathPattern="report-runner" 2>&1 | tail -30
```

Expected: the new test fails; all existing tests still pass (because `beforeEach` provides the default `getAppConfig` mock).

- [ ] **Step 3: Update `report-runner.ts`**

Apply all edits below **atomically** — steps 3b and 3e must both be applied before running TypeScript, since 3b adds early declarations and 3e removes the old ones. Having both `const jiraClient` declarations simultaneously will cause a compile error.

**Note on progressive stats:** `checkMemberComplete` fires inside LLM promises and writes `developer_stats` progressively. Since LLM and Jira run concurrently, those progressive inserts will always write `totalJiraIssues = 0`. The final aggregation block (step 3d, after both arrays are awaited) overwrites them with the correct values. This is intentional — if you observe `total_jira_issues = 0` during a run, that's expected until completion.

**3a.** In the variable declarations block (around line 88, alongside `pendingLLM`), add:

```typescript
const pendingJira: Promise<void>[] = [];
```

**3b.** Before the member loop (before `// 2. Pipelined fetch+LLM loop` comment, around line 150), add:

```typescript
const jiraConfig = getAppConfig().jira;
const jiraClient = jiraConfig.enabled ? getJiraClient() : null;
const jiraIssueCountByLogin = new Map<string, number>();
```

**3c.** Inside the member loop, after the LLM queuing block (just before the `// If no new commits needed LLM` comment at line 238), add:

```typescript
// Jira discovery: fire in parallel with LLM work — only needs emails from commits
if (jiraClient && thisMemCommits.length > 0) {
  const login = member.login;
  const emails = [...new Set(thisMemCommits.map(c => c.authorEmail).filter((e): e is string => Boolean(e)))];
  const jp = (async () => {
    if (shouldStop(reportId)) return;

    // Resume: skip if already have jira_issues for this user/report
    const [existingJira] = await db.execute(
      `SELECT COUNT(*) as cnt FROM jira_issues WHERE report_id = ? AND github_login = ?`,
      [reportId, login],
    ) as [any[], any];

    if (existingJira[0]?.cnt > 0) {
      jiraIssueCountByLogin.set(login, existingJira[0].cnt);
      log(`[jira] @${login}: ${existingJira[0].cnt} issues already in DB (resume)`);
      return;
    }

    try {
      const mapping = await resolveJiraUser(org, login, emails, log);
      if (!mapping) {
        jiraIssueCountByLogin.set(login, 0);
        return;
      }

      const issues = await jiraClient.searchDoneIssues(
        mapping.accountId, days, jiraConfig.projects.length > 0 ? jiraConfig.projects : undefined,
      );

      for (const issue of issues) {
        await db.execute(
          `INSERT IGNORE INTO jira_issues
             (report_id, github_login, jira_account_id, jira_email,
              project_key, issue_key, issue_type, summary, description,
              status, labels, story_points, original_estimate_seconds,
              issue_url, created_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reportId, login, mapping.accountId, mapping.email,
            issue.projectKey, issue.issueKey, issue.issueType,
            issue.summary, issue.description, issue.status,
            JSON.stringify(issue.labels), issue.storyPoints,
            issue.originalEstimateSeconds, issue.issueUrl,
            issue.createdAt, issue.resolvedAt,
          ],
        );
      }

      jiraIssueCountByLogin.set(login, issues.length);
      if (issues.length > 0) log(`[jira] @${login}: ${issues.length} resolved issues`);
    } catch (err) {
      log(`[jira] ERROR @${login}: ${err instanceof Error ? err.message : String(err)}`);
      jiraIssueCountByLogin.set(login, 0);
    }
  })();
  pendingJira.push(jp);
}
```

**3d.** Change `await Promise.all(pendingLLM)` to:

```typescript
await Promise.all([...pendingLLM, ...pendingJira]);

if (jiraClient) {
  const jiraTotal = [...jiraIssueCountByLogin.values()].reduce((a, b) => a + b, 0);
  log(`Jira collection complete: ${jiraTotal} total issues`);
}
```

**3e.** Delete the old Jira block in its entirety. This block starts at the comment `// Jira integration: resolve users and fetch done issues` (line 263) and ends at the closing `}` of the outer `if (jiraClient)` block (line 335), plus the `log(...)` summary line immediately after. Also delete the three variable declarations that preceded it: `const jiraConfig`, `const jiraIssueCountByLogin`, and `const jiraClient` — these are now declared above the loop from step 3b.

- [ ] **Step 4: Run the targeted tests**

```bash
npm test -- --testPathPattern="report-runner|jira-mapper" 2>&1 | tail -40
```

Expected: all tests pass, including the new Jira test.

- [ ] **Step 5: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report-runner.ts src/lib/__tests__/integration/report-runner.test.ts
git commit -m "feat: merge Jira discovery into main per-member loop, run concurrently with LLM analysis"
```
