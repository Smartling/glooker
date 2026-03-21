# Jira Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect resolved Jira issues per developer during report generation and display them in the UI alongside GitHub data.

**Architecture:** Add a `src/lib/jira/` module using `jira-client` npm package for API calls. Extend the report pipeline to auto-discover GitHub→Jira user mappings via commit emails, then fetch resolved issues via JQL. Store in new `jira_issues` and `user_mappings` tables. Display in org report table and developer detail page. Settings UI gets Jira config and user mappings editor.

**Tech Stack:** `jira-client` (npm), Next.js 15, SQLite/MySQL dual DB, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-21-jira-integration-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/jira/client.ts` | **New** — Jira API client (JiraClient class, JQL builder) |
| `src/lib/jira/mapper.ts` | **New** — GitHub→Jira user mapping logic (lookup, auto-discover, persist) |
| `src/lib/jira/index.ts` | **New** — Re-exports from client.ts and mapper.ts |
| `src/types/jira-client.d.ts` | **New** — Type declarations for `jira-client` npm package |
| `src/lib/db/sqlite.ts` | Add `jira_issues` + `user_mappings` CREATE TABLE; add `conflictCols`; add ALTER TABLE migrations |
| `src/lib/db/mysql.ts` | Add CREATE TABLE for new tables + ALTER TABLE migrations |
| `schema.sql` | Add `jira_issues`, `user_mappings` tables; add `total_jira_issues` to `developer_stats` |
| `src/lib/app-config/service.ts` | Add `jira` section to AppConfig + validation (non-blocking) |
| `src/lib/github.ts` | Add `authorEmail` to `RawCommitHit` and `CommitData` interfaces |
| `src/lib/aggregator.ts` | Add `totalJiraIssues` to `DeveloperStats` interface |
| `src/lib/report-runner.ts` | Add Jira steps (mapping + issue fetch) after commit analysis; update both INSERT statements |
| `src/lib/report/org.ts` | Include `total_jira_issues` in developer stats query |
| `src/lib/report/dev.ts` | Include `total_jira_issues` in stats query |
| `src/app/api/report/[id]/jira-issues/route.ts` | **New** — GET jira issues for a dev in a report |
| `src/app/api/settings/jira/test-connection/route.ts` | **New** — POST test Jira credentials (reads env vars server-side) |
| `src/app/api/settings/user-mappings/route.ts` | **New** — GET/PUT user mappings |
| `src/app/report/[id]/org/page.tsx` | Add Jira Issues column with hover popover |
| `src/app/report/[id]/dev/[login]/page.tsx` | Add Jira Issues section |
| `src/app/settings/page.tsx` | Add Jira config tab + user mappings editor |
| `.env.example` | Add Jira env vars |

---

## Task 1: Install `jira-client` and add types

**Files:**
- Modify: `package.json`
- Create: `src/types/jira-client.d.ts`

- [ ] **Step 1: Install jira-client**

```bash
npm install jira-client
```

- [ ] **Step 2: Create type declaration**

`jira-client` doesn't have official types. Create `src/types/jira-client.d.ts`:

```typescript
declare module 'jira-client' {
  interface JiraApiOptions {
    protocol?: string;
    host: string;
    username?: string;
    password?: string;
    apiVersion?: string;
    strictSSL?: boolean;
    bearer?: string;
    timeout?: number;
  }

  interface SearchResult {
    total: number;
    startAt: number;
    maxResults: number;
    issues: Array<{
      key: string;
      fields: Record<string, any>;
    }>;
  }

  interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress?: string;
    active: boolean;
  }

  class JiraApi {
    constructor(options: JiraApiOptions);
    searchJira(jql: string, options?: { startAt?: number; maxResults?: number; fields?: string[] }): Promise<SearchResult>;
    getCurrentUser(): Promise<JiraUser>;
    searchUsers(opts: { query: string; maxResults?: number }): Promise<JiraUser[]>;
  }

  export default JiraApi;
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/types/jira-client.d.ts
git commit -m "chore: install jira-client dependency and add type declarations"
```

---

## Task 2: Database schema — new tables and migrations

**Files:**
- Modify: `schema.sql`
- Modify: `src/lib/db/sqlite.ts`
- Modify: `src/lib/db/mysql.ts`

- [ ] **Step 1: Update `schema.sql` — add `jira_issues` table**

Add after the `commit_analyses` table:

```sql
CREATE TABLE IF NOT EXISTS jira_issues (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  report_id                 VARCHAR(36)  NOT NULL,
  github_login              VARCHAR(255) NOT NULL,
  jira_account_id           VARCHAR(128) NULL,
  jira_email                VARCHAR(255) NULL,
  project_key               VARCHAR(50)  NOT NULL,
  issue_key                 VARCHAR(50)  NOT NULL,
  issue_type                VARCHAR(100) NULL,
  summary                   VARCHAR(500) NULL,
  description               TEXT         NULL,
  status                    VARCHAR(100) NULL,
  labels                    TEXT         NULL,
  story_points              DECIMAL(6,2) NULL,
  original_estimate_seconds INT          NULL,
  issue_url                 VARCHAR(500) NULL,
  created_at                TIMESTAMP    NULL,
  resolved_at               TIMESTAMP    NULL,
  complexity                TINYINT      NULL,
  type                      ENUM('feature','bug','refactor','infra','docs','test','other') NULL,
  impact_summary            TEXT         NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_issue (report_id, issue_key)
);
```

- [ ] **Step 2: Update `schema.sql` — add `user_mappings` table**

```sql
CREATE TABLE IF NOT EXISTS user_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org             VARCHAR(255) NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  jira_email      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_gh_login (org, github_login)
);
```

- [ ] **Step 3: Update `schema.sql` — add columns to existing tables**

Add `total_jira_issues INT NOT NULL DEFAULT 0` after `ai_percentage` in `developer_stats` CREATE TABLE.

Add `author_email VARCHAR(255) NULL` after `github_login` in `commit_analyses` CREATE TABLE.

- [ ] **Step 4: Update `src/lib/db/sqlite.ts` — add SQLite table definitions**

Add to the `SCHEMA` constant after `commit_analyses`:

```sql
CREATE TABLE IF NOT EXISTS jira_issues (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id                 TEXT    NOT NULL,
  github_login              TEXT    NOT NULL,
  jira_account_id           TEXT,
  jira_email                TEXT,
  project_key               TEXT    NOT NULL,
  issue_key                 TEXT    NOT NULL,
  issue_type                TEXT,
  summary                   TEXT,
  description               TEXT,
  status                    TEXT,
  labels                    TEXT,
  story_points              REAL,
  original_estimate_seconds INTEGER,
  issue_url                 TEXT,
  created_at                TEXT,
  resolved_at               TEXT,
  complexity                INTEGER,
  type                      TEXT CHECK(type IN ('feature','bug','refactor','infra','docs','test','other')),
  impact_summary            TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, issue_key)
);

CREATE TABLE IF NOT EXISTS user_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org             TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  jira_account_id TEXT    NOT NULL,
  jira_email      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (org, github_login)
);
```

Also add `total_jira_issues INTEGER NOT NULL DEFAULT 0` to `developer_stats` and `author_email TEXT` to `commit_analyses` in the SCHEMA constant.

- [ ] **Step 5: Update `src/lib/db/sqlite.ts` — add `conflictCols` entries**

In the `translateSQL` function, add to the `conflictCols` object:

```typescript
jira_issues: 'report_id, issue_key',
user_mappings: 'org, github_login',
```

- [ ] **Step 6: Update `src/lib/db/sqlite.ts` — add ALTER TABLE migrations**

After `db.exec(SCHEMA);` in `createSQLiteDB()`, add:

```typescript
// Migrations: safe for existing DBs (ignore "duplicate column" errors)
try { db.exec('ALTER TABLE developer_stats ADD COLUMN total_jira_issues INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE commit_analyses ADD COLUMN author_email TEXT'); } catch (_) {}
```

- [ ] **Step 7: Update `src/lib/db/mysql.ts` — add CREATE TABLE and migrations**

Add new schemas constant (like existing `SCHEDULES_SCHEMA`):

```typescript
const JIRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS jira_issues (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  report_id                 VARCHAR(36)  NOT NULL,
  github_login              VARCHAR(255) NOT NULL,
  jira_account_id           VARCHAR(128) NULL,
  jira_email                VARCHAR(255) NULL,
  project_key               VARCHAR(50)  NOT NULL,
  issue_key                 VARCHAR(50)  NOT NULL,
  issue_type                VARCHAR(100) NULL,
  summary                   VARCHAR(500) NULL,
  description               TEXT         NULL,
  status                    VARCHAR(100) NULL,
  labels                    TEXT         NULL,
  story_points              DECIMAL(6,2) NULL,
  original_estimate_seconds INT          NULL,
  issue_url                 VARCHAR(500) NULL,
  created_at                TIMESTAMP    NULL,
  resolved_at               TIMESTAMP    NULL,
  complexity                TINYINT      NULL,
  type                      ENUM('feature','bug','refactor','infra','docs','test','other') NULL,
  impact_summary            TEXT         NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_issue (report_id, issue_key)
);
`;

const USER_MAPPINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org             VARCHAR(255) NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  jira_email      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_gh_login (org, github_login)
);
`;
```

After the existing `pool.execute(SCHEDULES_SCHEMA)` block, add:

```typescript
pool.execute(JIRA_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create jira_issues table:', err);
});
pool.execute(USER_MAPPINGS_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create user_mappings table:', err);
});

// Migrations
pool.execute('ALTER TABLE developer_stats ADD COLUMN total_jira_issues INT NOT NULL DEFAULT 0').catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add total_jira_issues:', err);
});
pool.execute('ALTER TABLE commit_analyses ADD COLUMN author_email VARCHAR(255) NULL AFTER github_login').catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add author_email:', err);
});
```

- [ ] **Step 8: Verify — delete `glooker.db` and run `npm run dev`**

```bash
rm -f glooker.db && npm run dev
```

Then verify:

```bash
sqlite3 glooker.db ".tables"
```

Expected: `jira_issues` and `user_mappings` listed among tables.

- [ ] **Step 9: Commit**

```bash
git add schema.sql src/lib/db/sqlite.ts src/lib/db/mysql.ts
git commit -m "feat: add jira_issues and user_mappings tables with migrations"
```

---

## Task 3: Add `authorEmail` to GitHub data pipeline

**Files:**
- Modify: `src/lib/github.ts`
- Modify: `src/lib/report-runner.ts`

The GitHub commit search API returns `item.commit.author.email` but the code doesn't capture it. We need it for Jira user auto-discovery.

- [ ] **Step 1: Add `authorEmail` to `RawCommitHit` interface**

In `src/lib/github.ts`, add to `RawCommitHit` (after `authorName`):

```typescript
authorEmail: string;
```

- [ ] **Step 2: Capture email in `searchUserCommits`**

In the `hits.push(...)` block (around line 161-170), add after `authorName`:

```typescript
authorEmail: item.commit.author?.email || '',
```

- [ ] **Step 3: Add `authorEmail` to `CommitData` interface**

After `authorName`:

```typescript
authorEmail:   string;
```

- [ ] **Step 4: Propagate in commit building**

Where `RawCommitHit` is mapped to `CommitData` (around line 341), add:

```typescript
authorEmail:  raw.authorEmail,
```

- [ ] **Step 5: Update INSERT in `report-runner.ts` to save `author_email`**

In the `INSERT IGNORE INTO commit_analyses` statement (around line 195), add `author_email` to the column list (after `github_login`) and `commit.authorEmail` to the VALUES (after `commit.author`).

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: All tests pass (new field is additive).

- [ ] **Step 7: Commit**

```bash
git add src/lib/github.ts src/lib/report-runner.ts
git commit -m "feat: capture author email from GitHub commit search API"
```

---

## Task 4: App config — Jira section

**Files:**
- Modify: `src/lib/app-config/service.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add Jira fields to `AppConfig` interface**

```typescript
jira: {
  enabled: boolean;
  host: string | null;
  username: string | null;
  hasApiToken: boolean;
  apiVersion: string;
  projects: string[];
  missing: string[];  // separate from core missing — Jira is optional
};
```

- [ ] **Step 2: Add Jira config population in `getAppConfig()`**

Before `return config;`, add:

```typescript
const jiraEnabled = process.env.JIRA_ENABLED === 'true';
const jiraMissing: string[] = [];
if (jiraEnabled) {
  if (!process.env.JIRA_HOST) jiraMissing.push('JIRA_HOST');
  if (!process.env.JIRA_USERNAME) jiraMissing.push('JIRA_USERNAME');
  if (!process.env.JIRA_API_TOKEN) jiraMissing.push('JIRA_API_TOKEN');
}
config.jira = {
  enabled: jiraEnabled,
  host: process.env.JIRA_HOST || null,
  username: process.env.JIRA_USERNAME || null,
  hasApiToken: Boolean(process.env.JIRA_API_TOKEN),
  apiVersion: process.env.JIRA_API_VERSION || '3',
  projects: process.env.JIRA_PROJECTS ? process.env.JIRA_PROJECTS.split(',').map(p => p.trim()).filter(Boolean) : [],
  missing: jiraMissing,
};
```

**IMPORTANT:** Do NOT modify `config.ready` — Jira is optional and should not block core functionality. Jira missing vars are tracked in `config.jira.missing` separately.

- [ ] **Step 3: Update `.env.example`**

Add after the Smartling section:

```
# -----------------------------------------------------------------------------
# Jira (optional — for tracking resolved issues per developer)
# -----------------------------------------------------------------------------
# JIRA_ENABLED=false
# JIRA_HOST=mycompany.atlassian.net
# JIRA_USERNAME=your-email@company.com
# JIRA_API_TOKEN=your-jira-api-token
# JIRA_API_VERSION=3
# JIRA_PROJECTS=PROJ1,PROJ2
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/app-config/service.ts .env.example
git commit -m "feat: add Jira configuration to app config service"
```

---

## Task 5: Jira API client

**Files:**
- Create: `src/lib/jira/client.ts`
- Create: `src/lib/jira/index.ts`
- Create: `src/lib/__tests__/unit/jira-client.test.ts`

- [ ] **Step 1: Write test for JQL building**

Create `src/lib/__tests__/unit/jira-client.test.ts`:

```typescript
import { buildDoneIssuesJql } from '@/lib/jira';

describe('buildDoneIssuesJql', () => {
  it('builds basic JQL without project filter', () => {
    const jql = buildDoneIssuesJql('abc123', 30);
    expect(jql).toBe(
      'assignee = "abc123" AND statusCategory = "Done" AND resolved >= -30d ORDER BY resolved DESC'
    );
  });

  it('builds JQL with project filter', () => {
    const jql = buildDoneIssuesJql('abc123', 14, ['PROJ1', 'PROJ2']);
    expect(jql).toContain('project IN ("PROJ1","PROJ2")');
    expect(jql).toContain('resolved >= -14d');
  });

  it('builds JQL with empty project filter (same as no filter)', () => {
    const jql = buildDoneIssuesJql('abc123', 7, []);
    expect(jql).not.toContain('project IN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="jira-client.test"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/jira/client.ts`**

```typescript
import JiraApi from 'jira-client';

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

export interface JiraIssueData {
  issueKey: string;
  projectKey: string;
  issueType: string | null;
  summary: string | null;
  description: string | null;
  status: string | null;
  labels: string[];
  storyPoints: number | null;
  originalEstimateSeconds: number | null;
  issueUrl: string;
  createdAt: string | null;
  resolvedAt: string | null;
}

export function buildDoneIssuesJql(
  accountId: string,
  periodDays: number,
  projects?: string[],
): string {
  const parts = [
    `assignee = "${accountId}"`,
    'statusCategory = "Done"',
    `resolved >= -${periodDays}d`,
  ];
  if (projects && projects.length > 0) {
    const quoted = projects.map(p => `"${p}"`).join(',');
    parts.push(`project IN (${quoted})`);
  }
  return parts.join(' AND ') + ' ORDER BY resolved DESC';
}

export class JiraClient {
  private api: JiraApi;
  private host: string;
  private protocol: string;

  constructor(host: string, username: string, apiToken: string, apiVersion = '3') {
    const isHttps = !host.includes('localhost') && !host.startsWith('http://');
    this.protocol = isHttps ? 'https' : 'http';
    this.host = host.replace(/^https?:\/\//, '');

    this.api = new JiraApi({
      protocol: this.protocol,
      host: this.host,
      username,
      password: apiToken,
      apiVersion,
      strictSSL: isHttps,
    });
  }

  async testConnection(): Promise<JiraUser> {
    return this.api.getCurrentUser() as Promise<JiraUser>;
  }

  async findUserByEmail(email: string): Promise<JiraUser | null> {
    const results = await this.api.searchUsers({ query: email, maxResults: 10 });
    const match = results.find(
      (u: JiraUser) => u.emailAddress?.toLowerCase() === email.toLowerCase() && u.active,
    );
    if (!match && results.length > 0 && results.every((u: JiraUser) => !u.emailAddress)) {
      console.warn(
        `[jira] User search for "${email}" returned ${results.length} results but none have emailAddress — email visibility may be restricted`,
      );
    }
    return match || null;
  }

  async searchDoneIssues(
    accountId: string,
    periodDays: number,
    projects?: string[],
  ): Promise<JiraIssueData[]> {
    const jql = buildDoneIssuesJql(accountId, periodDays, projects);
    const fields = [
      'summary', 'description', 'status', 'issuetype', 'labels',
      'customfield_10016', 'timeoriginalestimate', 'created', 'resolutiondate',
    ];

    const allIssues: JiraIssueData[] = [];
    let startAt = 0;
    const maxResults = 50;

    while (true) {
      const result = await this.api.searchJira(jql, { startAt, maxResults, fields });

      for (const issue of result.issues) {
        const f = issue.fields;
        allIssues.push({
          issueKey: issue.key,
          projectKey: issue.key.split('-')[0],
          issueType: f.issuetype?.name || null,
          summary: f.summary || null,
          description: typeof f.description === 'string'
            ? f.description.slice(0, 2000)
            : (f.description?.content ? '[ADF content]' : null),
          status: f.status?.name || null,
          labels: f.labels || [],
          storyPoints: f.customfield_10016 != null ? Number(f.customfield_10016) : null,
          originalEstimateSeconds: f.timeoriginalestimate || null,
          issueUrl: `${this.protocol}://${this.host}/browse/${issue.key}`,
          createdAt: f.created || null,
          resolvedAt: f.resolutiondate || null,
        });
      }

      if (allIssues.length >= result.total || result.issues.length < maxResults) break;
      startAt += maxResults;
      await new Promise(r => setTimeout(r, 1000));
    }

    return allIssues;
  }
}

let cachedClient: JiraClient | null = null;

export function getJiraClient(): JiraClient | null {
  if (process.env.JIRA_ENABLED !== 'true') return null;
  if (!process.env.JIRA_HOST || !process.env.JIRA_USERNAME || !process.env.JIRA_API_TOKEN) return null;

  if (!cachedClient) {
    cachedClient = new JiraClient(
      process.env.JIRA_HOST,
      process.env.JIRA_USERNAME,
      process.env.JIRA_API_TOKEN,
      process.env.JIRA_API_VERSION || '3',
    );
  }
  return cachedClient;
}
```

- [ ] **Step 4: Create `src/lib/jira/index.ts`**

```typescript
export { JiraClient, getJiraClient, buildDoneIssuesJql } from './client';
export type { JiraUser, JiraIssueData } from './client';
export { resolveJiraUser } from './mapper';
```

Note: `mapper.ts` doesn't exist yet — it will be created in Task 6. The index re-export will cause a TS error until then. If this blocks, temporarily comment out the mapper export line and uncomment after Task 6.

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --testPathPattern="jira-client.test"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/jira/ src/lib/__tests__/unit/jira-client.test.ts
git commit -m "feat: add Jira API client with JQL builder and user search"
```

---

## Task 6: Jira user mapping service

**Files:**
- Create: `src/lib/jira/mapper.ts`
- Create: `src/lib/__tests__/unit/jira-mapper.test.ts`

**Prerequisite:** Task 3 (author_email in commit_analyses) must be complete — the mapper queries this column.

- [ ] **Step 1: Write test for mapping logic**

Create `src/lib/__tests__/unit/jira-mapper.test.ts`:

```typescript
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

    const result = await resolveJiraUser('myorg', 'devuser', 'report-1');
    expect(result).toEqual({ accountId: 'jira-123', email: 'dev@co.com' });
  });

  it('returns null when no mapping and no Jira client', async () => {
    mockDb.execute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue(null);

    const result = await resolveJiraUser('myorg', 'devuser', 'report-1');
    expect(result).toBeNull();
  });

  it('auto-discovers via commit emails and persists mapping', async () => {
    mockDb.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[
        { author_email: 'dev@co.com' },
        { author_email: 'dev@personal.com' },
      ], null])
      .mockResolvedValueOnce([[], null]);

    const mockClient = {
      findUserByEmail: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ accountId: 'jira-456', displayName: 'Dev', emailAddress: 'dev@personal.com' }),
    };
    mockGetJiraClient.mockReturnValue(mockClient);

    const result = await resolveJiraUser('myorg', 'devuser', 'report-1');
    expect(result).toEqual({ accountId: 'jira-456', email: 'dev@personal.com' });
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="jira-mapper.test"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/jira/mapper.ts`**

```typescript
import db from '@/lib/db';
import { getJiraClient } from './client';

interface JiraMapping {
  accountId: string;
  email: string | null;
}

export async function resolveJiraUser(
  org: string,
  githubLogin: string,
  reportId: string,
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

  // 2. Auto-discover via commit emails
  const client = getJiraClient();
  if (!client) return null;

  const [emailRows] = await db.execute(
    `SELECT DISTINCT author_email FROM commit_analyses WHERE report_id = ? AND github_login = ? AND author_email IS NOT NULL AND author_email != ''`,
    [reportId, githubLogin],
  ) as [any[], any];

  const emails: string[] = emailRows.map((r: any) => r.author_email);
  if (emails.length === 0) {
    log?.(`[jira] No commit emails found for @${githubLogin}, cannot auto-discover Jira mapping`);
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

- [ ] **Step 4: Uncomment the mapper re-export in `src/lib/jira/index.ts`**

Ensure the line is active:

```typescript
export { resolveJiraUser } from './mapper';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --testPathPattern="jira-mapper.test"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/jira/mapper.ts src/lib/jira/index.ts src/lib/__tests__/unit/jira-mapper.test.ts
git commit -m "feat: add Jira user mapping service with auto-discovery"
```

---

## Task 7: Update aggregator and developer stats queries

**Files:**
- Modify: `src/lib/aggregator.ts`
- Modify: `src/lib/report-runner.ts`
- Modify: `src/lib/report/org.ts`
- Modify: `src/lib/report/dev.ts`

- [ ] **Step 1: Add `totalJiraIssues` to `DeveloperStats` interface**

In `src/lib/aggregator.ts`, add to the `DeveloperStats` interface:

```typescript
totalJiraIssues: number;
```

In the `aggregate` function, add when building each stat in the `stats.push(...)`:

```typescript
totalJiraIssues: 0,  // Set by report-runner after Jira fetch
```

- [ ] **Step 2: Update both INSERT statements in `report-runner.ts`**

For **both** `INSERT INTO developer_stats` statements (around lines 104-138 and 267-301):

Add `total_jira_issues` to column list, add `s.totalJiraIssues` to VALUES, add `total_jira_issues = VALUES(total_jira_issues)` to ON DUPLICATE KEY UPDATE.

- [ ] **Step 3: Update `src/lib/report/org.ts` — include `total_jira_issues` in SELECT**

Add `total_jira_issues` to the SELECT in the developer stats query.

- [ ] **Step 4: Update `src/lib/report/dev.ts` — include `total_jira_issues` in SELECT**

Same change for both the single developer query and the all-developers query.

- [ ] **Step 5: Run tests — update aggregator test if needed**

```bash
npm test
```

The aggregator test (`src/lib/__tests__/unit/aggregator.test.ts`) may fail if it uses exact object matching. Update assertions to include `totalJiraIssues: 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aggregator.ts src/lib/report-runner.ts src/lib/report/org.ts src/lib/report/dev.ts
git commit -m "feat: add total_jira_issues to developer stats pipeline"
```

---

## Task 8: Integrate Jira fetch into report pipeline

**Files:**
- Modify: `src/lib/report-runner.ts`

- [ ] **Step 1: Add imports**

At the top of `report-runner.ts`:

```typescript
import { getJiraClient, type JiraIssueData } from './jira';
import { resolveJiraUser } from './jira';
import { getAppConfig } from './app-config/service';
```

- [ ] **Step 2: Add Jira fetch logic after LLM work completes**

After `await Promise.all(pendingLLM);` (around line 250) and before the final aggregation, add:

```typescript
// Jira integration: resolve users and fetch done issues
const jiraConfig = getAppConfig().jira;
const jiraIssueCountByLogin = new Map<string, number>();

if (jiraConfig.enabled) {
  const jiraClient = getJiraClient();
  if (jiraClient) {
    log('Starting Jira issue collection...');
    let jiraProcessed = 0;
    const jiraTotal = [...memberCommits.entries()].filter(([, c]) => c.length > 0).length;

    for (const [login, commits] of memberCommits.entries()) {
      if (commits.length === 0) continue;
      if (shouldStop(reportId)) throw new Error('Stopped by user');

      jiraProcessed++;
      updateProgress(reportId, {
        step: `[${jiraProcessed}/${jiraTotal}] Fetching Jira issues: @${login}`,
      });

      // Resume: skip if already have jira_issues for this user/report
      const [existingJira] = await db.execute(
        `SELECT COUNT(*) as cnt FROM jira_issues WHERE report_id = ? AND github_login = ?`,
        [reportId, login],
      ) as [any[], any];

      if (existingJira[0]?.cnt > 0) {
        jiraIssueCountByLogin.set(login, existingJira[0].cnt);
        log(`[jira] @${login}: ${existingJira[0].cnt} issues already in DB (resume)`);
        continue;
      }

      try {
        const mapping = await resolveJiraUser(org, login, reportId, log);
        if (!mapping) {
          jiraIssueCountByLogin.set(login, 0);
          continue;
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
    }

    log(`Jira collection complete: ${[...jiraIssueCountByLogin.values()].reduce((a, b) => a + b, 0)} total issues`);
  }
}
```

- [ ] **Step 3: Set `totalJiraIssues` on aggregated stats before saving**

After `const stats = aggregate(allCommits, analyses, prCounts);`, add:

```typescript
for (const s of stats) {
  s.totalJiraIssues = jiraIssueCountByLogin.get(s.githubLogin) || 0;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-runner.ts
git commit -m "feat: integrate Jira issue fetch into report pipeline"
```

---

## Task 9: API endpoints — Jira issues, test connection, user mappings

**Files:**
- Create: `src/app/api/report/[id]/jira-issues/route.ts`
- Create: `src/app/api/settings/jira/test-connection/route.ts`
- Create: `src/app/api/settings/user-mappings/route.ts`

- [ ] **Step 1: Create Jira issues API endpoint**

Create `src/app/api/report/[id]/jira-issues/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login');

  const conditions = ['report_id = ?'];
  const values: any[] = [id];

  if (login) {
    conditions.push('github_login = ?');
    values.push(login);
  }

  const [rows] = await db.execute(
    `SELECT issue_key, project_key, issue_type, summary, description,
            status, labels, story_points, original_estimate_seconds,
            issue_url, created_at, resolved_at
     FROM jira_issues
     WHERE ${conditions.join(' AND ')}
     ORDER BY resolved_at DESC`,
    values,
  ) as [any[], any];

  const issues = rows.map((r: any) => ({
    ...r,
    labels: typeof r.labels === 'string' ? JSON.parse(r.labels || '[]') : (r.labels || []),
    story_points: r.story_points != null ? Number(r.story_points) : null,
  }));

  return NextResponse.json(issues);
}
```

- [ ] **Step 2: Create test connection API endpoint**

Create `src/app/api/settings/jira/test-connection/route.ts`:

**IMPORTANT:** This endpoint reads credentials from environment variables server-side — the client does NOT send the token.

```typescript
import { NextResponse } from 'next/server';
import { JiraClient } from '@/lib/jira';

export async function POST() {
  try {
    const host = process.env.JIRA_HOST;
    const username = process.env.JIRA_USERNAME;
    const apiToken = process.env.JIRA_API_TOKEN;
    const apiVersion = process.env.JIRA_API_VERSION || '3';

    if (!host || !username || !apiToken) {
      return NextResponse.json({ success: false, error: 'Jira credentials not configured in environment' }, { status: 400 });
    }

    const client = new JiraClient(host, username, apiToken, apiVersion);
    const user = await client.testConnection();

    return NextResponse.json({
      success: true,
      user: { displayName: user.displayName, emailAddress: user.emailAddress },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create user mappings API endpoint**

Create `src/app/api/settings/user-mappings/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getJiraClient } from '@/lib/jira';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org required' }, { status: 400 });

  // Get developers from latest completed report
  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE org = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [org],
  ) as [any[], any];

  if (!reportRows.length) return NextResponse.json([]);

  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url FROM developer_stats WHERE report_id = ?`,
    [reportRows[0].id],
  ) as [any[], any];

  const [mappingRows] = await db.execute(
    `SELECT github_login, jira_account_id, jira_email FROM user_mappings WHERE org = ?`,
    [org],
  ) as [any[], any];

  const mappingsByLogin = new Map(
    mappingRows.map((r: any) => [r.github_login, { jira_account_id: r.jira_account_id, jira_email: r.jira_email }]),
  );

  const result = devRows.map((dev: any) => ({
    github_login: dev.github_login,
    github_name: dev.github_name,
    avatar_url: dev.avatar_url,
    jira_account_id: mappingsByLogin.get(dev.github_login)?.jira_account_id || null,
    jira_email: mappingsByLogin.get(dev.github_login)?.jira_email || null,
    mapped: mappingsByLogin.has(dev.github_login),
  }));

  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  const { org, github_login, jira_email } = await req.json();
  if (!org || !github_login) {
    return NextResponse.json({ error: 'org and github_login required' }, { status: 400 });
  }

  if (!jira_email) {
    await db.execute(`DELETE FROM user_mappings WHERE org = ? AND github_login = ?`, [org, github_login]);
    return NextResponse.json({ success: true, cleared: true });
  }

  const client = getJiraClient();
  if (!client) return NextResponse.json({ error: 'Jira not configured' }, { status: 400 });

  const user = await client.findUserByEmail(jira_email);
  if (!user) return NextResponse.json({ error: `No Jira user found for: ${jira_email}` }, { status: 404 });

  await db.execute(
    `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email, created_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE jira_account_id = VALUES(jira_account_id), jira_email = VALUES(jira_email)`,
    [org, github_login, user.accountId, jira_email],
  );

  return NextResponse.json({
    success: true,
    jira_account_id: user.accountId,
    jira_display_name: user.displayName,
    jira_email,
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/report/[id]/jira-issues/route.ts src/app/api/settings/jira/test-connection/route.ts src/app/api/settings/user-mappings/route.ts
git commit -m "feat: add Jira issues, test connection, and user mappings API endpoints"
```

---

## Task 10: Settings UI — Jira config tab

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Add 'jira' to Tab type**

```typescript
type Tab = 'schedules' | 'teams' | 'llm' | 'jira' | 'appearance';
```

- [ ] **Step 2: Add Jira tab button**

In the tabs array, add before 'appearance':

```typescript
{ id: 'jira' as Tab, label: 'Jira', icon: '🔗' },
```

- [ ] **Step 3: Add tab content render**

After `{activeTab === 'llm' && <LlmSettingsTab />}`:

```typescript
{activeTab === 'jira' && selectedOrg && <JiraSettingsTab org={selectedOrg} />}
```

- [ ] **Step 4: Create `JiraSettingsTab` component**

Add this component to the settings page file. It displays:
- Jira config (read-only from env vars) with Test Connection button
- User mappings table (all org members with editable Jira email field)

The Test Connection button calls `POST /api/settings/jira/test-connection` (no body — endpoint reads env vars server-side).

The user mappings table fetches from `GET /api/settings/user-mappings?org=...` and saves via `PUT /api/settings/user-mappings`.

Follow the existing visual style from LlmSettingsTab: `bg-gray-900 border border-gray-800 rounded-lg p-6` cards, `text-accent` for links, etc.

- [ ] **Step 5: Run dev server and verify**

```bash
npm run dev
```

Navigate to `/settings`, check Jira tab renders.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: add Jira settings tab with config display and user mappings editor"
```

---

## Task 11: Org report UI — Jira Issues column

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Read the org page to understand table structure**

Read `src/app/report/[id]/org/page.tsx` and locate the developer table headers and rows.

- [ ] **Step 2: Add Jira Issues column**

Add a "Jira" column header and cell. Only render if any developer has `total_jira_issues > 0`.

- [ ] **Step 3: Add `JiraIssuesPopover` component**

On hover, fetch `/api/report/[id]/jira-issues?login=...` and show a dropdown list of issue keys as clickable links. Follow the same visual style as existing tooltips in the page.

- [ ] **Step 4: Run dev server and verify**

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add src/app/report/[id]/org/page.tsx
git commit -m "feat: add Jira Issues column with hover popover to org report table"
```

---

## Task 12: Developer detail page — Jira Issues section

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`

- [ ] **Step 1: Read the dev page and understand current structure**

Read the file and locate the commits table section.

- [ ] **Step 2: Add Jira issues fetch**

When `developer.total_jira_issues > 0`, fetch `/api/report/${id}/jira-issues?login=${login}`.

- [ ] **Step 3: Add Jira Issues table below commits**

Table columns: Issue Key (link), Type, Summary, Story Points, Labels, Resolved Date. Follow existing table styles. Use `Number()` for `story_points`. Section not rendered if no Jira data.

- [ ] **Step 4: Run dev server and verify**

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add src/app/report/[id]/dev/[login]/page.tsx
git commit -m "feat: add Jira Issues section to developer detail page"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Smoke test the full flow**

```bash
npm run dev
```

Verify:
1. Settings page shows Jira tab with config display
2. If `JIRA_ENABLED=true`, Test Connection works
3. User mappings table shows org members
4. Run a report — Jira progress steps appear in logs
5. Org report table shows Jira column if data exists
6. Developer detail page shows Jira issues section

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A && git commit -m "fix: final adjustments for Jira integration"
```
