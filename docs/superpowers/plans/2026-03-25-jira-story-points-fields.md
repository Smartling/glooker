# Jira Story Points Fields — Configurable via Env Var

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded Jira story points field IDs with a configurable `JIRA_STORY_POINTS_FIELDS` env var so any Jira instance can report story points correctly.

**Architecture:** `searchDoneIssues` gains a `storyPointsFields: string[]` parameter; the caller (`report-runner.ts`) reads the value from app config; the config service parses the new env var. Docs and UI updated to match.

**Tech Stack:** TypeScript, Next.js 15, Jest + ts-jest

---

## File Map

| File | Change |
|------|--------|
| `src/lib/jira/client.ts` | Add `storyPointsFields` param; remove hardcoded fields; dynamic mapping |
| `src/lib/app-config/service.ts` | Add `storyPointsFields: string[]` to interface + config block |
| `src/lib/report-runner.ts` | Pass `jiraConfig.storyPointsFields` to `searchDoneIssues` |
| `src/lib/__tests__/unit/jira-client.test.ts` | Add `searchDoneIssues` unit tests |
| `.env.example` | Add `JIRA_STORY_POINTS_FIELDS` with discovery comment |
| `README.md` | Document new var + field discovery instructions |
| `CLAUDE.md` | Add gotcha |
| `src/app/settings/page.tsx` | Add story points fields row in Jira config display |

---

## Task 1: Add `searchDoneIssues` unit tests (TDD — tests first)

**Files:**
- Modify: `src/lib/__tests__/unit/jira-client.test.ts`

These tests import `JiraClient` directly and mock `global.fetch`. They define the expected behavior of the new signature before the implementation changes.

- [ ] **Step 1: Update the import on line 1 of the test file**

In `src/lib/__tests__/unit/jira-client.test.ts`, replace the existing import:

```typescript
// Before:
import { buildDoneIssuesJql } from '@/lib/jira';

// After:
import { buildDoneIssuesJql, JiraClient } from '@/lib/jira';
```

- [ ] **Step 2: Append the new describe block**

Append to `src/lib/__tests__/unit/jira-client.test.ts` (after the existing `buildDoneIssuesJql` tests):

```typescript
describe('JiraClient.searchDoneIssues — story points mapping', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockResponse(issues: Array<{ key: string; fields: Record<string, any> }>) {
    return {
      ok: true,
      json: () => Promise.resolve({ issues, total: issues.length }),
    };
  }

  function baseFields(extra: Record<string, any> = {}) {
    return {
      summary: 'Test issue',
      status: { name: 'Done' },
      issuetype: { name: 'Story' },
      labels: [],
      created: '2024-01-01T00:00:00.000Z',
      resolutiondate: '2024-01-15T00:00:00.000Z',
      ...extra,
    };
  }

  const client = new JiraClient('mycompany.atlassian.net', 'user@example.com', 'token');

  it('returns null storyPoints when storyPointsFields is empty', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields() },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, []);
    expect(issues[0].storyPoints).toBeNull();
  });

  it('maps story points from a configured field', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10016: 5 }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10016']);
    expect(issues[0].storyPoints).toBe(5);
  });

  it('coerces string story point value to number', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10016: '8' }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10016']);
    expect(issues[0].storyPoints).toBe(8);
  });

  it('uses first non-null field when multiple fields are configured', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10028: null, customfield_10016: 3 }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10028', 'customfield_10016']);
    expect(issues[0].storyPoints).toBe(3);
  });

  it('returns null when all configured fields are null in the response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      { key: 'PROJ-1', fields: baseFields({ customfield_10016: null }) },
    ]));
    const issues = await client.searchDoneIssues('account123', 30, undefined, ['customfield_10016']);
    expect(issues[0].storyPoints).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests — expect a TypeScript argument-count failure**

```bash
npm test -- --testPathPattern="jira-client" --no-coverage
```

Expected: TypeScript error — `searchDoneIssues` does not accept 4 arguments yet. This confirms the tests are wired correctly before the implementation exists. (`JiraClient` itself should resolve fine — only the call signature is wrong.)

---

## Task 2: Update `client.ts` — configurable story points fields

**Files:**
- Modify: `src/lib/jira/client.ts:118-163`

- [ ] **Step 1: Update the `searchDoneIssues` signature and implementation**

In `src/lib/jira/client.ts`, replace the existing `searchDoneIssues` method (lines 118–163):

```typescript
async searchDoneIssues(
  accountId: string,
  periodDays: number,
  projects?: string[],
  storyPointsFields: string[] = [],
): Promise<JiraIssueData[]> {
  const jql = buildDoneIssuesJql(accountId, periodDays, projects);
  const fields = [
    'summary', 'description', 'status', 'issuetype', 'labels',
    ...storyPointsFields,
    'timeoriginalestimate', 'created', 'resolutiondate',
  ];

  const allIssues: JiraIssueData[] = [];
  const maxResults = 50;
  let nextPageToken: string | undefined;

  while (true) {
    const result = await this.searchJql(jql, fields, maxResults, nextPageToken);

    for (const issue of result.issues) {
      const f = issue.fields;

      let storyPoints: number | null = null;
      for (const field of storyPointsFields) {
        if (f[field] != null) {
          const v = Number(f[field]);
          if (!isNaN(v)) {
            storyPoints = v;
            break;
          }
        }
      }

      allIssues.push({
        issueKey: issue.key,
        projectKey: issue.key.split('-')[0],
        issueType: f.issuetype?.name || null,
        summary: f.summary || null,
        description: typeof f.description === 'string'
          ? f.description.slice(0, 2000)
          : (f.description?.content ? extractAdfText(f.description).slice(0, 2000) : null),
        status: f.status?.name || null,
        labels: f.labels || [],
        storyPoints,
        originalEstimateSeconds: f.timeoriginalestimate || null,
        issueUrl: `${this.protocol}://${this.host}/browse/${issue.key}`,
        createdAt: f.created || null,
        resolvedAt: f.resolutiondate || null,
      });
    }

    if (!result.nextPageToken || result.issues.length < maxResults) break;
    nextPageToken = result.nextPageToken;
    await new Promise(r => setTimeout(r, 1000));
  }

  return allIssues;
}
```

- [ ] **Step 2: Run the tests — expect them to pass**

```bash
npm test -- --testPathPattern="jira-client" --no-coverage
```

Expected: All 8 tests pass (3 existing `buildDoneIssuesJql` + 5 new `searchDoneIssues` tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/jira/client.ts src/lib/__tests__/unit/jira-client.test.ts
git commit -m "feat: configurable story points fields in searchDoneIssues"
```

---

## Task 3: Update app config — parse `JIRA_STORY_POINTS_FIELDS`

**Files:**
- Modify: `src/lib/app-config/service.ts:26-34` (interface), `src/lib/app-config/service.ts:105-113` (config block)

- [ ] **Step 1: Add `storyPointsFields` to the `AppConfig` interface**

In `src/lib/app-config/service.ts`, update the `jira` block in the `AppConfig` interface (lines 26–34):

```typescript
jira: {
  enabled: boolean;
  host: string | null;
  username: string | null;
  hasApiToken: boolean;
  apiVersion: string;
  projects: string[];
  storyPointsFields: string[];
  missing: string[];
};
```

- [ ] **Step 2: Parse the env var in `getAppConfig`**

In `src/lib/app-config/service.ts`, update the `config.jira = { ... }` block (lines 105–113):

```typescript
config.jira = {
  enabled: jiraEnabled,
  host: process.env.JIRA_HOST || null,
  username: process.env.JIRA_USERNAME || null,
  hasApiToken: Boolean(process.env.JIRA_API_TOKEN),
  apiVersion: process.env.JIRA_API_VERSION || '3',
  projects: process.env.JIRA_PROJECTS ? process.env.JIRA_PROJECTS.split(',').map(p => p.trim()).filter(Boolean) : [],
  storyPointsFields: process.env.JIRA_STORY_POINTS_FIELDS
    ? process.env.JIRA_STORY_POINTS_FIELDS.split(',').map(p => p.trim()).filter(Boolean)
    : [],
  missing: jiraMissing,
};
```

- [ ] **Step 3: Add env var parsing tests to `llm-config-service.test.ts`**

In `src/lib/__tests__/unit/llm-config-service.test.ts`, add `'JIRA_STORY_POINTS_FIELDS'` to the `envKeys` array (alongside the other Jira vars, or at end of the list — follow existing pattern), then add a new `describe` block for the Jira story points fields parsing:

```typescript
describe('jira.storyPointsFields parsing', () => {
  beforeEach(() => {
    // Enable Jira so the config block runs
    process.env.JIRA_ENABLED = 'true';
    process.env.JIRA_HOST = 'example.atlassian.net';
    process.env.JIRA_USERNAME = 'user@example.com';
    process.env.JIRA_API_TOKEN = 'token';
  });

  it('returns empty array when JIRA_STORY_POINTS_FIELDS is not set', () => {
    delete process.env.JIRA_STORY_POINTS_FIELDS;
    const config = getAppConfig();
    expect(config.jira.storyPointsFields).toEqual([]);
  });

  it('parses a single field ID', () => {
    process.env.JIRA_STORY_POINTS_FIELDS = 'customfield_10016';
    const config = getAppConfig();
    expect(config.jira.storyPointsFields).toEqual(['customfield_10016']);
  });

  it('parses multiple comma-separated field IDs', () => {
    process.env.JIRA_STORY_POINTS_FIELDS = 'customfield_10016,customfield_10028';
    const config = getAppConfig();
    expect(config.jira.storyPointsFields).toEqual(['customfield_10016', 'customfield_10028']);
  });

  it('trims whitespace around field IDs', () => {
    process.env.JIRA_STORY_POINTS_FIELDS = ' customfield_10016 , customfield_10028 ';
    const config = getAppConfig();
    expect(config.jira.storyPointsFields).toEqual(['customfield_10016', 'customfield_10028']);
  });

  it('filters out empty strings from the list', () => {
    process.env.JIRA_STORY_POINTS_FIELDS = 'customfield_10016,,';
    const config = getAppConfig();
    expect(config.jira.storyPointsFields).toEqual(['customfield_10016']);
  });
});
```

- [ ] **Step 4: Run the config tests — expect failures**

```bash
npm test -- --testPathPattern="llm-config-service" --no-coverage
```

Expected: The 5 new tests fail (property doesn't exist yet).

- [ ] **Step 5: Implement the changes (Steps 1 and 2 above)**

Now make the interface and config block changes described in Steps 1 and 2.

- [ ] **Step 6: Run all tests to confirm passing**

```bash
npm test -- --no-coverage
```

Expected: All tests pass. (TypeScript will catch any missed callsites.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/app-config/service.ts src/lib/__tests__/unit/llm-config-service.test.ts
git commit -m "feat: add storyPointsFields to app config from JIRA_STORY_POINTS_FIELDS"
```

---

## Task 4: Wire `storyPointsFields` into `report-runner.ts`

**Files:**
- Modify: `src/lib/report-runner.ts:302-304`

- [ ] **Step 1: Pass `storyPointsFields` to `searchDoneIssues`**

In `src/lib/report-runner.ts`, update the `searchDoneIssues` call (lines 302–304):

```typescript
const issues = await jiraClient.searchDoneIssues(
  mapping.accountId,
  days,
  jiraConfig.projects.length > 0 ? jiraConfig.projects : undefined,
  jiraConfig.storyPointsFields,
);
```

- [ ] **Step 2: Run all tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/report-runner.ts
git commit -m "feat: pass storyPointsFields from config to searchDoneIssues"
```

---

## Task 5: Update docs and `.env.example`

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `.env.example`**

In `.env.example`, after the `# JIRA_PROJECTS=` line (currently line 101), add:

```env
# JIRA_STORY_POINTS_FIELDS=
# Comma-separated Jira field IDs for story points (instance-specific, no universal default).
# To find yours: GET https://<JIRA_HOST>/rest/api/3/field
# Filter results by fields whose name contains "story" or "point", then use the id value.
# Example: JIRA_STORY_POINTS_FIELDS=customfield_10016
```

- [ ] **Step 2: Update `README.md` Jira section**

In `README.md`, replace the Jira config block (lines 122–129):

```markdown
```env
JIRA_ENABLED=true
JIRA_HOST=mycompany.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_API_VERSION=3          # 3 for Cloud, 2 for Server
# JIRA_PROJECTS=PROJ1,PROJ2 # optional filter, default: all projects
# JIRA_STORY_POINTS_FIELDS=customfield_10016  # optional, instance-specific
```
```

Then after the user mappings sentence, add:

```markdown
To find story points field IDs for your instance: `GET https://<JIRA_HOST>/rest/api/3/field` — look for fields with "story" or "point" in the name and use the `id` value (e.g. `customfield_10016`). If unset, story points are not collected.
```

- [ ] **Step 3: Update `CLAUDE.md` Gotchas**

In `CLAUDE.md`, add after the last Jira-related gotcha (after the `jira_issues` table LLM columns note):

```markdown
- Jira story points field IDs are instance-specific — `JIRA_STORY_POINTS_FIELDS` must be configured explicitly (no default). Discover IDs via `GET /rest/api/3/field`, use the `id` of fields whose name contains "story" or "point". If unset, `storyPoints` is always `null`.
```

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md CLAUDE.md
git commit -m "docs: add JIRA_STORY_POINTS_FIELDS to env example, README, and CLAUDE.md"
```

---

## Task 6: Update Settings UI

**Files:**
- Modify: `src/app/settings/page.tsx:1041` (after the Projects row)

- [ ] **Step 1: Add story points fields row**

In `src/app/settings/page.tsx`, inside the `config.jira?.enabled` block, after the `Projects` `ConfigRow` (line 1041):

```tsx
<ConfigRow
  label="Story Points Fields"
  value={config.jira.storyPointsFields?.length > 0
    ? config.jira.storyPointsFields.join(', ')
    : '(not configured)'}
/>
```

- [ ] **Step 2: Run all tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: show story points fields in Jira settings UI"
```

---

## Done

All 6 tasks complete. Verify the full test suite one final time:

```bash
npm test -- --no-coverage
```

Expected: All tests green, no TypeScript errors.
