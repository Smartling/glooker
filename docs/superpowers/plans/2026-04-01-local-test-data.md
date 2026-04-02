# Local Test Data & Mock Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every page in Glooker fully testable locally with `npm run seed && npm run dev:mock` — no GitHub, Jira, or LLM credentials needed.

**Architecture:** Three mock providers (GitHub, Jira, LLM) each following the existing provider/factory pattern. A shared `mock-identities.ts` file defines all mock entities once. A seed script populates SQLite with realistic data. Each provider is independently selectable via env var (`GITHUB_PROVIDER=mock`, `JIRA_PROVIDER=mock`, `LLM_PROVIDER=mock`).

**Tech Stack:** TypeScript, SQLite (better-sqlite3), tsx (dev runner), existing OpenAI SDK duck-typing pattern.

---

### Task 1: Shared Mock Identities

**Files:**
- Create: `scripts/mock-identities.ts`

- [ ] **Step 1: Create the shared identities file**

```typescript
// scripts/mock-identities.ts
// Single source of truth for all mock entity references.
// Both seed script and mock providers import from here.

import { v4 as uuidv4 } from 'uuid';

export const MOCK_ORG = 'mock-org';

// Stable UUIDs so seed is idempotent across runs
export const MOCK_REPORT_IDS = {
  completed14d: '00000000-0000-4000-a000-000000000001',
  completed30d: '00000000-0000-4000-a000-000000000002',
  running:      '00000000-0000-4000-a000-000000000003',
};

export interface MockDeveloper {
  githubLogin: string;
  githubName: string;
  avatarUrl: string;
  jiraEmail: string;
  jiraAccountId: string;
  team: string;
}

export const MOCK_DEVELOPERS: MockDeveloper[] = [
  { githubLogin: 'alice-mock', githubName: 'Alice Chen', avatarUrl: 'https://i.pravatar.cc/150?u=alice', jiraEmail: 'alice@mockorg.dev', jiraAccountId: 'jira-alice-001', team: 'Platform' },
  { githubLogin: 'bob-mock', githubName: 'Bob Martinez', avatarUrl: 'https://i.pravatar.cc/150?u=bob', jiraEmail: 'bob@mockorg.dev', jiraAccountId: 'jira-bob-002', team: 'Platform' },
  { githubLogin: 'carol-mock', githubName: 'Carol Nguyen', avatarUrl: 'https://i.pravatar.cc/150?u=carol', jiraEmail: 'carol@mockorg.dev', jiraAccountId: 'jira-carol-003', team: 'Platform' },
  { githubLogin: 'dave-mock', githubName: 'Dave Kim', avatarUrl: 'https://i.pravatar.cc/150?u=dave', jiraEmail: 'dave@mockorg.dev', jiraAccountId: 'jira-dave-004', team: 'Frontend' },
  { githubLogin: 'eve-mock', githubName: 'Eve Patel', avatarUrl: 'https://i.pravatar.cc/150?u=eve', jiraEmail: 'eve@mockorg.dev', jiraAccountId: 'jira-eve-005', team: 'Frontend' },
  { githubLogin: 'frank-mock', githubName: 'Frank Osei', avatarUrl: 'https://i.pravatar.cc/150?u=frank', jiraEmail: 'frank@mockorg.dev', jiraAccountId: 'jira-frank-006', team: 'Frontend' },
  { githubLogin: 'grace-mock', githubName: 'Grace Liu', avatarUrl: 'https://i.pravatar.cc/150?u=grace', jiraEmail: 'grace@mockorg.dev', jiraAccountId: 'jira-grace-007', team: 'Data' },
  { githubLogin: 'hank-mock', githubName: 'Hank Russo', avatarUrl: 'https://i.pravatar.cc/150?u=hank', jiraEmail: 'hank@mockorg.dev', jiraAccountId: 'jira-hank-008', team: 'Data' },
];

export interface MockTeam {
  id: string;
  name: string;
  color: string;
}

export const MOCK_TEAMS: MockTeam[] = [
  { id: '00000000-0000-4000-b000-000000000001', name: 'Platform', color: '#2563EB' },
  { id: '00000000-0000-4000-b000-000000000002', name: 'Frontend', color: '#7C3AED' },
  { id: '00000000-0000-4000-b000-000000000003', name: 'Data', color: '#059669' },
];

export interface MockEpic {
  key: string;
  summary: string;
  goalKey: string;
  goalSummary: string;
  initiativeKey: string;
  initiativeSummary: string;
  assigneeEmail: string;
}

export const MOCK_EPICS: MockEpic[] = [
  { key: 'MOCK-101', summary: 'Migrate auth to OAuth 2.1', goalKey: 'MOCK-1', goalSummary: 'Security Hardening', initiativeKey: 'MOCK-10', initiativeSummary: 'Auth Modernization', assigneeEmail: 'alice@mockorg.dev' },
  { key: 'MOCK-102', summary: 'Implement rate limiting middleware', goalKey: 'MOCK-1', goalSummary: 'Security Hardening', initiativeKey: 'MOCK-10', initiativeSummary: 'Auth Modernization', assigneeEmail: 'bob@mockorg.dev' },
  { key: 'MOCK-201', summary: 'Redesign dashboard components', goalKey: 'MOCK-2', goalSummary: 'User Experience Refresh', initiativeKey: 'MOCK-20', initiativeSummary: 'Frontend Overhaul', assigneeEmail: 'dave@mockorg.dev' },
  { key: 'MOCK-202', summary: 'Build data pipeline v2', goalKey: 'MOCK-2', goalSummary: 'User Experience Refresh', initiativeKey: 'MOCK-21', initiativeSummary: 'Data Infrastructure', assigneeEmail: 'grace@mockorg.dev' },
];
```

- [ ] **Step 2: Commit**

```bash
git add scripts/mock-identities.ts
git commit -m "feat(mock): add shared mock identities — single source of truth for test entities"
```

---

### Task 2: Add `promptTag()` to LLM Provider

**Files:**
- Modify: `src/lib/llm-provider.ts`
- Test: `src/lib/__tests__/unit/llm-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/__tests__/unit/llm-provider.test.ts`:

```typescript
describe('promptTag', () => {
  it('returns an object with __prompt_id', () => {
    const mod = require('@/lib/llm-provider');
    expect(mod.promptTag('analyzer-system')).toEqual({ __prompt_id: 'analyzer-system' });
  });

  it('returns empty object when no name given', () => {
    const mod = require('@/lib/llm-provider');
    expect(mod.promptTag('')).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="llm-provider" -t "promptTag"`
Expected: FAIL with "promptTag is not a function"

- [ ] **Step 3: Add `promptTag` and update Provider type in `llm-provider.ts`**

Add to `src/lib/llm-provider.ts`:

```typescript
// Update type union (line 16):
type Provider = 'openai' | 'anthropic' | 'smartling' | 'openai-compatible' | 'bedrock' | 'mock';

// Add after extraBodyProps() function:
/**
 * Tag an LLM request with the prompt template name.
 * The mock provider uses this to select fixture responses.
 * Real providers ignore unknown keys.
 */
export function promptTag(name: string): Record<string, unknown> {
  if (!name) return {};
  return { __prompt_id: name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="llm-provider" -t "promptTag"`
Expected: PASS

- [ ] **Step 5: Add `promptTag` calls to all 8 LLM call sites**

Each file already spreads `...extraBodyProps()`. Add `...promptTag('template-name')` alongside it:

`src/lib/analyzer.ts` (line ~41):
```typescript
    ...extraBodyProps(),
    ...promptTag(commit.aiCoAuthored ? 'analyzer-system-ai-confirmed' : 'analyzer-system'),
```
Import: add `promptTag` to the import from `'./llm-provider'`

`src/lib/projects/epic-summary.ts` (line ~289):
```typescript
    ...extraBodyProps(),
    ...promptTag('epic-summary-system'),
```
Import: add `promptTag` to the import from `'@/lib/llm-provider'`

`src/lib/projects/untracked.ts` (line ~269):
```typescript
    ...extraBodyProps(),
    ...promptTag('untracked-work-system'),
```
Import: add `promptTag` to the import from `'@/lib/llm-provider'`

`src/lib/report/summary.ts` (line ~144):
```typescript
    ...extraBodyProps(),
    ...promptTag('report-summary-system'),
```
Import: add `promptTag` to the import from `'@/lib/llm-provider'`

`src/lib/report-highlights/service.ts` (line ~141):
```typescript
    ...extraBodyProps(),
    ...promptTag('report-highlights-system'),
```
Import: add `promptTag` to the import from `'../llm-provider'`

`src/lib/chat/agent.ts` (line ~40):
```typescript
    ...extraBodyProps(),
    ...promptTag('chat-agent-system'),
```
Import: add `promptTag` to the import from `'@/lib/llm-provider'`

`src/lib/llm-config/service.ts` (line ~74):
```typescript
    ...extraBodyProps(),
    ...promptTag('llm-config-test-system'),
```
Import: add `promptTag` to the import from `'@/lib/llm-provider'`

`src/lib/app-config/service.ts` (line ~136):
```typescript
    ...extraBodyProps(),
    ...promptTag('llm-config-test-system'),
```
Import: add `promptTag` to the import from `'@/lib/llm-provider'`

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass (promptTag returns `{}` equivalent for tests that mock extraBodyProps — no behavior change for real providers).

- [ ] **Step 7: Commit**

```bash
git add src/lib/llm-provider.ts src/lib/analyzer.ts src/lib/projects/epic-summary.ts src/lib/projects/untracked.ts src/lib/report/summary.ts src/lib/report-highlights/service.ts src/lib/chat/agent.ts src/lib/llm-config/service.ts src/lib/app-config/service.ts src/lib/__tests__/unit/llm-provider.test.ts
git commit -m "feat(mock): add promptTag() for LLM mock routing — tag all 8 call sites"
```

---

### Task 3: Mock LLM Provider

**Files:**
- Create: `src/lib/llm-mock.ts`
- Modify: `src/lib/llm-provider.ts`

- [ ] **Step 1: Create `src/lib/llm-mock.ts`**

```typescript
/**
 * Mock LLM provider. Duck-typed OpenAI client that returns static fixture
 * responses based on __prompt_id. No network calls, instant responses.
 */

const FIXTURES: Record<string, string> = {
  'analyzer-system': JSON.stringify({
    complexity: 5,
    type: 'feature',
    impact_summary: 'Adds mock feature implementation with tests',
    risk_level: 'low',
    maybe_ai: false,
  }),
  'analyzer-system-ai-confirmed': JSON.stringify({
    complexity: 4,
    type: 'feature',
    impact_summary: 'AI-assisted feature implementation',
    risk_level: 'low',
    maybe_ai: false,
  }),
  'epic-summary-system': 'This epic made strong progress with 5 issues resolved. The team completed the core auth migration and rate limiting middleware. Two issues remain for edge-case handling and documentation.',
  'untracked-work-system': JSON.stringify([
    { name: 'CI/CD Improvements', summary: 'Pipeline optimization and caching', commitCount: 3, repos: ['infra-config'], linesAdded: 120, linesRemoved: 45 },
    { name: 'Bug Fixes', summary: 'Various production bug fixes', commitCount: 2, repos: ['api-service'], linesAdded: 30, linesRemoved: 15 },
  ]),
  'report-summary-system': JSON.stringify({
    summary: 'A productive period focused on platform stability and feature delivery. Contributed 15 commits across 3 repositories with an average complexity of 5.2. Demonstrated strong code review discipline with 90% of changes going through PRs.',
    badges: [
      { label: 'PR Champion', description: 'High PR discipline rate' },
      { label: 'Polyglot', description: 'Active across multiple repositories' },
    ],
  }),
  'report-highlights-system': JSON.stringify({
    highlights: [
      'Overall team velocity increased 15% compared to previous period',
      'Average commit complexity rose from 4.1 to 5.3, indicating more impactful work',
      'AI-assisted commits grew from 8% to 12% of total output',
    ],
  }),
  'chat-agent-system': 'Based on the report data, the team had a productive sprint with 8 active contributors. The highest impact came from platform infrastructure work.',
  'llm-config-test-system': 'OK',
};

const FALLBACK = 'Mock LLM response — no fixture matched for this prompt.';

export function createMockLLMClient() {
  return {
    chat: {
      completions: {
        async create(params: {
          messages: { role: string; content: string }[];
          model: string;
          __prompt_id?: string;
          [key: string]: unknown;
        }) {
          const promptId = params.__prompt_id || '';
          const content = FIXTURES[promptId] || FALLBACK;

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content,
                },
              },
            ],
          };
        },
      },
    },
  };
}
```

- [ ] **Step 2: Add `mock` case to `getLLMClient()` in `llm-provider.ts`**

Add before the `default:` case in the switch statement:

```typescript
    case 'mock': {
      const { createMockLLMClient } = await import('./llm-mock');
      cachedClient = createMockLLMClient() as unknown as OpenAI;
      return cachedClient;
    }
```

Update the error message in `default:`:
```typescript
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use: openai, anthropic, smartling, openai-compatible, bedrock, or mock`);
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All pass (mock case not exercised in tests, existing tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/lib/llm-mock.ts src/lib/llm-provider.ts
git commit -m "feat(mock): add mock LLM provider — static fixtures routed by promptTag"
```

---

### Task 4: Jira Interface Extraction & Mock Client

**Files:**
- Create: `src/lib/jira/types.ts`
- Create: `src/lib/jira/mock-client.ts`
- Modify: `src/lib/jira/client.ts`
- Modify: `src/lib/jira/service.ts`

- [ ] **Step 1: Extract `JiraClientInterface` to `src/lib/jira/types.ts`**

```typescript
import type { JiraUser, JiraIssueData } from './client';

export interface JiraClientInterface {
  testConnection(): Promise<JiraUser>;

  findUserByEmail(email: string): Promise<JiraUser | null>;

  searchEpics(jql: string): Promise<Array<{
    key: string;
    summary: string;
    status: string;
    dueDate: string | null;
    assigneeDisplayName: string | null;
    assigneeEmail: string | null;
    parentKey: string | null;
    parentSummary: string | null;
    parentTypeName: string | null;
  }>>;

  searchChildIssues(epicKey: string): Promise<Array<{
    key: string;
    summary: string;
    status: string;
    statusCategory: string;
    resolvedAt: string | null;
    assigneeEmail: string | null;
  }>>;

  searchDoneIssues(
    accountId: string,
    periodDays: number,
    projects?: string[],
    storyPointsFields?: string[],
  ): Promise<JiraIssueData[]>;
}
```

- [ ] **Step 2: Make `JiraClient` implement the interface**

In `src/lib/jira/client.ts`, add the import and implements clause:

```typescript
import type { JiraClientInterface } from './types';

export class JiraClient implements JiraClientInterface {
  // ... existing implementation unchanged
}
```

- [ ] **Step 3: Update `getJiraClient()` to return interface type and support mock**

```typescript
import type { JiraClientInterface } from './types';

let cachedClient: JiraClientInterface | null = null;

export function getJiraClient(): JiraClientInterface | null {
  if (process.env.JIRA_ENABLED !== 'true') return null;

  // Mock provider — skip credential checks
  if (process.env.JIRA_PROVIDER === 'mock') {
    if (!cachedClient) {
      // Dynamic import to avoid bundling mock in production
      const { MockJiraClient } = require('./mock-client');
      cachedClient = new MockJiraClient();
    }
    return cachedClient;
  }

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

- [ ] **Step 4: Create `src/lib/jira/mock-client.ts`**

```typescript
import type { JiraClientInterface } from './types';
import type { JiraUser, JiraIssueData } from './client';

// Use dynamic import to avoid circular dependency with scripts/
// Mock identities are loaded lazily
let _identities: typeof import('../../../scripts/mock-identities') | null = null;
async function getIdentities() {
  if (!_identities) _identities = await import('../../../scripts/mock-identities');
  return _identities;
}

export class MockJiraClient implements JiraClientInterface {
  async testConnection(): Promise<JiraUser> {
    return {
      accountId: 'mock-admin-001',
      displayName: 'Mock Admin',
      emailAddress: 'admin@mockorg.dev',
      active: true,
    };
  }

  async findUserByEmail(email: string): Promise<JiraUser | null> {
    const { MOCK_DEVELOPERS } = await getIdentities();
    const dev = MOCK_DEVELOPERS.find(d => d.jiraEmail === email);
    if (!dev) return null;
    return {
      accountId: dev.jiraAccountId,
      displayName: dev.githubName,
      emailAddress: dev.jiraEmail,
      active: true,
    };
  }

  async searchEpics(_jql: string): Promise<Array<{
    key: string; summary: string; status: string; dueDate: string | null;
    assigneeDisplayName: string | null; assigneeEmail: string | null;
    parentKey: string | null; parentSummary: string | null; parentTypeName: string | null;
  }>> {
    const { MOCK_EPICS, MOCK_DEVELOPERS } = await getIdentities();
    return MOCK_EPICS.map(epic => {
      const dev = MOCK_DEVELOPERS.find(d => d.jiraEmail === epic.assigneeEmail);
      return {
        key: epic.key,
        summary: epic.summary,
        status: 'In Progress',
        dueDate: '2026-05-15',
        assigneeDisplayName: dev?.githubName || null,
        assigneeEmail: epic.assigneeEmail,
        parentKey: epic.initiativeKey,
        parentSummary: epic.initiativeSummary,
        parentTypeName: 'Initiative',
      };
    });
  }

  async searchChildIssues(epicKey: string): Promise<Array<{
    key: string; summary: string; status: string; statusCategory: string;
    resolvedAt: string | null; assigneeEmail: string | null;
  }>> {
    const { MOCK_EPICS } = await getIdentities();
    const epic = MOCK_EPICS.find(e => e.key === epicKey);
    const prefix = epicKey.split('-')[0];
    const num = parseInt(epicKey.split('-')[1]) || 100;
    return [
      { key: `${prefix}-${num + 50}`, summary: `Implement core logic for ${epic?.summary || epicKey}`, status: 'Done', statusCategory: 'Done', resolvedAt: '2026-03-28T10:00:00.000Z', assigneeEmail: epic?.assigneeEmail || null },
      { key: `${prefix}-${num + 51}`, summary: `Add tests for ${epic?.summary || epicKey}`, status: 'In Progress', statusCategory: 'In Progress', resolvedAt: null, assigneeEmail: epic?.assigneeEmail || null },
    ];
  }

  async searchDoneIssues(
    accountId: string,
    _periodDays: number,
    _projects?: string[],
    _storyPointsFields?: string[],
  ): Promise<JiraIssueData[]> {
    const { MOCK_DEVELOPERS } = await getIdentities();
    const dev = MOCK_DEVELOPERS.find(d => d.jiraAccountId === accountId);
    if (!dev) return [];
    const prefix = 'MOCK';
    return [
      {
        issueKey: `${prefix}-${Math.floor(Math.random() * 900) + 100}`,
        projectKey: prefix,
        issueType: 'Story',
        summary: `Completed task by ${dev.githubName}`,
        description: null,
        status: 'Done',
        labels: ['backend'],
        storyPoints: 3,
        originalEstimateSeconds: null,
        issueUrl: `https://mockorg.atlassian.net/browse/${prefix}-999`,
        createdAt: '2026-03-15T10:00:00.000Z',
        resolvedAt: '2026-03-25T16:00:00.000Z',
      },
    ];
  }
}
```

- [ ] **Step 5: Refactor `testJiraConnection()` in `service.ts` to use factory**

In `src/lib/jira/service.ts`, replace lines 34-47:

```typescript
export async function testJiraConnection() {
  const client = getJiraClient();
  if (!client) {
    throw new JiraNotConfiguredError();
  }
  const user = await client.testConnection();
  return { displayName: user.displayName, emailAddress: user.emailAddress };
}
```

Also update the import to remove the direct `JiraClient` import if no longer needed:
```typescript
import { getJiraClient } from './client';
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/jira/types.ts src/lib/jira/mock-client.ts src/lib/jira/client.ts src/lib/jira/service.ts
git commit -m "feat(mock): add mock Jira client with interface extraction and factory support"
```

---

### Task 5: GitHub Provider Refactor & Mock

**Files:**
- Modify: `src/lib/github.ts`
- Create: `src/lib/github-mock.ts`
- Modify: `src/lib/orgs/service.ts`
- Modify: `src/lib/report-runner.ts`

- [ ] **Step 1: Extract `GitHubProvider` interface and factory in `github.ts`**

Add at the top of `src/lib/github.ts`, after the existing type exports:

```typescript
export interface GitHubProvider {
  listOrgMembers(org: string, log?: (msg: string) => void): Promise<OrgMember[]>;
  fetchUserActivity(org: string, user: string, since: Date, log?: (msg: string) => void): Promise<UserActivity>;
  listOrgs(): Promise<Array<{ login: string; avatar_url: string }>>;
}
```

Refactor the module-level `octokit` to lazy initialization:

```typescript
let octokit: Octokit | null = null;
function getOctokit(): Octokit {
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}
```

Update all internal references from `octokit.` to `getOctokit().` (in `withRetry`, `listOrgMembers`, `searchUserCommits`, `searchUserMergedPRs`, `getCommitDetail`).

Add `listOrgs` to this module (move from `orgs/service.ts`):

```typescript
export async function listOrgs(): Promise<Array<{ login: string; avatar_url: string }>> {
  const kit = getOctokit();
  const orgs: Array<{ login: string; avatar_url: string }> = [];
  for await (const res of kit.paginate.iterator(kit.orgs.listForAuthenticatedUser, { per_page: 100 })) {
    orgs.push(...res.data.map((o) => ({ login: o.login, avatar_url: o.avatar_url || '' })));
  }
  return orgs;
}
```

Add factory function:

```typescript
let cachedProvider: GitHubProvider | null = null;

export function getGitHubProvider(): GitHubProvider {
  if (cachedProvider) return cachedProvider;

  if (process.env.GITHUB_PROVIDER === 'mock') {
    const { createMockGitHubProvider } = require('./github-mock');
    cachedProvider = createMockGitHubProvider();
    return cachedProvider;
  }

  cachedProvider = { listOrgMembers, fetchUserActivity, listOrgs };
  return cachedProvider;
}
```

- [ ] **Step 2: Create `src/lib/github-mock.ts`**

```typescript
import type { GitHubProvider, OrgMember, UserActivity, CommitData } from './github';

// Dynamic import to avoid bundling in production
let _identities: typeof import('../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../scripts/mock-identities');
  return _identities!;
}

export function createMockGitHubProvider(): GitHubProvider {
  return {
    async listOrgs() {
      const { MOCK_ORG } = getIdentities();
      return [{ login: MOCK_ORG, avatar_url: '' }];
    },

    async listOrgMembers(org, log) {
      const { MOCK_DEVELOPERS } = getIdentities();
      log?.(`[mock] Returning ${MOCK_DEVELOPERS.length} mock members`);
      return MOCK_DEVELOPERS.map(d => ({
        login: d.githubLogin,
        name: d.githubName,
        avatarUrl: d.avatarUrl,
      }));
    },

    async fetchUserActivity(org, user, since, log) {
      const { MOCK_DEVELOPERS } = getIdentities();
      const dev = MOCK_DEVELOPERS.find(d => d.githubLogin === user);
      if (!dev) return { commits: [], prs: [] };

      log?.(`[mock] Generating fixture commits for ${user}`);

      const types = ['feature', 'bug', 'refactor', 'docs', 'test'] as const;
      const repos = ['api-service', 'web-app', 'shared-lib'];
      const commits: CommitData[] = [];

      // Generate 3-5 commits per developer
      const count = 3 + (dev.githubLogin.charCodeAt(0) % 3); // deterministic per user
      for (let i = 0; i < count; i++) {
        const type = types[i % types.length];
        const repo = repos[i % repos.length];
        const day = i + 1;
        commits.push({
          sha: `mock${dev.githubLogin.replace('-', '')}${String(i).padStart(4, '0')}`.padEnd(40, '0'),
          repo,
          author: dev.githubLogin,
          authorName: dev.githubName,
          authorEmail: dev.jiraEmail,
          avatarUrl: dev.avatarUrl,
          message: `${type}: mock commit ${i + 1} by ${dev.githubName}`,
          fullMessage: `${type}: mock commit ${i + 1} by ${dev.githubName}`,
          diff: `--- a/src/${type}.ts\n+++ b/src/${type}.ts\n@@ -1,3 +1,5 @@\n+// ${type} change\n+console.log("${type}");`,
          additions: 10 + i * 5,
          deletions: 2 + i,
          prNumber: 100 + i,
          prTitle: `${type}: ${dev.githubName}'s PR #${i + 1}`,
          committedAt: new Date(Date.now() - day * 86400000).toISOString(),
          aiCoAuthored: i === 0 && dev.team === 'Frontend', // some AI-flagged
          aiToolName: i === 0 && dev.team === 'Frontend' ? 'copilot' : null,
        });
      }

      return {
        commits,
        prs: commits.filter(c => c.prNumber).map(c => ({
          number: c.prNumber!,
          title: c.prTitle!,
          mergedAt: c.committedAt,
        })),
      };
    },
  };
}
```

- [ ] **Step 3: Update `orgs/service.ts` to use the factory**

Replace `src/lib/orgs/service.ts`:

```typescript
import { getGitHubProvider } from '@/lib/github';

export async function listOrgs(): Promise<Array<{ login: string; avatar_url: string }>> {
  const provider = getGitHubProvider();
  return provider.listOrgs();
}
```

- [ ] **Step 4: Update `report-runner.ts` to use the factory**

In `src/lib/report-runner.ts`, change the import (line 3):

```typescript
import { getGitHubProvider, type CommitData } from './github';
```

Replace direct calls (line 73 and 164):

```typescript
// line 73:
const github = getGitHubProvider();
const members = await github.listOrgMembers(org, log);

// line 164:
const activity = await github.fetchUserActivity(org, member.login, since, log);
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All pass. Tests that mock `@octokit/rest` still work because the real module still imports Octokit — the factory just adds indirection.

- [ ] **Step 6: Commit**

```bash
git add src/lib/github.ts src/lib/github-mock.ts src/lib/orgs/service.ts src/lib/report-runner.ts
git commit -m "feat(mock): add GitHub provider factory and mock — enables full report generation locally"
```

---

### Task 6: Env Validation Updates

**Files:**
- Modify: `src/lib/env-validation.ts`

- [ ] **Step 1: Add `isMockProvider` helper and update rules**

```typescript
// Add near the top, after the existing constants:
const VALID_JIRA_PROVIDERS = ['mock'];
const VALID_GITHUB_PROVIDERS = ['mock'];

function isMockProvider(service: 'llm' | 'jira' | 'github'): boolean {
  const envMap = { llm: 'LLM_PROVIDER', jira: 'JIRA_PROVIDER', github: 'GITHUB_PROVIDER' };
  return process.env[envMap[service]] === 'mock';
}

// Update VALID_LLM_PROVIDERS:
const VALID_LLM_PROVIDERS = ['openai', 'anthropic', 'openai-compatible', 'smartling', 'bedrock', 'mock'];
```

Update the `GITHUB_TOKEN` rule to be conditional:

```typescript
  {
    name: 'GITHUB_TOKEN',
    required: !isMockProvider('github'),
    description: 'GitHub personal access token (fine-grained)',
  },
```

Wait — `isMockProvider` reads `process.env` which is available at module load. But the `rules` array is also defined at module scope. This is actually fine since `process.env` is populated before module evaluation. However, to be safe, make `required` a getter or evaluate at validation time. Simplest: change the GITHUB_TOKEN rule check inside `validateEnv()`:

Actually, the simplest approach — just modify the check in `validateEnv()`:

```typescript
  // In the core rules loop, add special handling:
  for (const rule of rules) {
    const value = process.env[rule.name];

    // Skip required check for GITHUB_TOKEN when using mock GitHub
    const isRequired = rule.name === 'GITHUB_TOKEN' ? !isMockProvider('github') : rule.required;

    if (!value || value.trim() === '') {
      if (isRequired) {
        errors.push(`  - ${rule.name}: missing (${rule.description})`);
      }
      continue;
    }
    // ... rest unchanged
  }
```

Add validation rules for the new provider env vars:

```typescript
  // Add to the rules array:
  {
    name: 'JIRA_PROVIDER',
    required: false,
    description: `Jira provider (${VALID_JIRA_PROVIDERS.join(', ')})`,
    validate: (v) =>
      VALID_JIRA_PROVIDERS.includes(v) ? null : `must be one of: ${VALID_JIRA_PROVIDERS.join(', ')}`,
  },
  {
    name: 'GITHUB_PROVIDER',
    required: false,
    description: `GitHub provider (${VALID_GITHUB_PROVIDERS.join(', ')})`,
    validate: (v) =>
      VALID_GITHUB_PROVIDERS.includes(v) ? null : `must be one of: ${VALID_GITHUB_PROVIDERS.join(', ')}`,
  },
```

Update the Jira conditional rule to skip when mock:

```typescript
  {
    when: () => process.env.JIRA_ENABLED === 'true' && !isMockProvider('jira'),
    featureLabel: 'JIRA_ENABLED=true',
    vars: [
      { name: 'JIRA_HOST', description: 'Jira Cloud hostname' },
      { name: 'JIRA_USERNAME', description: 'Jira username / email' },
      { name: 'JIRA_API_TOKEN', description: 'Jira API token' },
      { name: 'JIRA_PROJECTS_JQL', description: 'JQL query for the Projects page' },
    ],
  },
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env-validation.ts
git commit -m "feat(mock): update env validation — skip credential checks for mock providers"
```

---

### Task 7: Seed Script & Fixture Data

**Files:**
- Create: `scripts/seed.ts`
- Create: `scripts/seed-data.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `tsx` to devDependencies**

```bash
npm install --save-dev tsx
```

- [ ] **Step 2: Create `scripts/seed-data.ts`**

This file imports from `mock-identities.ts` and exports all fixture arrays. Due to size, the implementer should generate realistic data matching the table schemas. Key constraints:

- All `report_id` foreign keys reference `MOCK_REPORT_IDS`
- All `github_login` values come from `MOCK_DEVELOPERS`
- All `jira_email` values come from `MOCK_DEVELOPERS`
- `type_breakdown` and `active_repos` are JSON strings
- `badges_json` and `highlights_json` are JSON strings
- `committed_at` dates fall within the last 14/30 days depending on report period

The file should export: `seedReports`, `seedDeveloperStats`, `seedCommitAnalyses`, `seedJiraIssues`, `seedTeams`, `seedTeamMembers`, `seedUserMappings`, `seedDeveloperSummaries`, `seedReportComparisons`, `seedEpicSummaries`, `seedUntrackedSummaries`, `seedSchedules`, `seedReleaseNotes`.

Each export is an array of row objects matching the table's column names.

- [ ] **Step 3: Create `scripts/seed.ts`**

```typescript
// scripts/seed.ts
// Populates the SQLite DB with mock data for local development.
// Run: npm run seed  |  Reset: npm run seed:reset

// Use relative imports — no @/* aliases in scripts/
import * as data from './seed-data';

async function main() {
  // Dynamic import of the DB module (triggers schema creation on fresh DB)
  const dbModule = await import('../src/lib/db/index');
  const db = dbModule.default;

  console.log('Seeding database...\n');

  // Helper for INSERT OR IGNORE (SQLite translator handles dialect)
  async function seed(table: string, rows: Record<string, any>[]) {
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

    let inserted = 0;
    for (const row of rows) {
      try {
        await db.execute(sql, cols.map(c => row[c]));
        inserted++;
      } catch (e: any) {
        // Ignore duplicate key errors (idempotent)
        if (!e.message?.includes('UNIQUE constraint')) throw e;
      }
    }
    console.log(`  ${table}: ${inserted} rows`);
  }

  await seed('reports', data.seedReports);
  await seed('developer_stats', data.seedDeveloperStats);
  await seed('commit_analyses', data.seedCommitAnalyses);
  await seed('jira_issues', data.seedJiraIssues);
  await seed('teams', data.seedTeams);
  await seed('team_members', data.seedTeamMembers);
  await seed('user_mappings', data.seedUserMappings);
  await seed('developer_summaries', data.seedDeveloperSummaries);
  await seed('report_comparisons', data.seedReportComparisons);
  await seed('epic_summaries', data.seedEpicSummaries);
  await seed('untracked_summaries', data.seedUntrackedSummaries);
  await seed('schedules', data.seedSchedules);
  await seed('release_notes', data.seedReleaseNotes);

  console.log('\nDone! Run `npm run dev:mock` to start the app with mock providers.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
"seed": "tsx scripts/seed.ts",
"seed:reset": "rm -f glooker.db && tsx scripts/seed.ts",
"dev:mock": "GITHUB_PROVIDER=mock LLM_PROVIDER=mock JIRA_ENABLED=true JIRA_PROVIDER=mock JIRA_PROJECTS_JQL='project = MOCK AND issuetype = Epic' next dev"
```

- [ ] **Step 5: Run the seed script on a fresh DB**

```bash
rm -f glooker.db
npm run seed
```

Expected: All tables seeded with row counts printed.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts scripts/seed-data.ts package.json package-lock.json
git commit -m "feat(mock): add seed script and fixture data for local development"
```

---

### Task 8: CLAUDE.md, .env.example, and Final Verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example`

- [ ] **Step 1: Add maintenance instructions to CLAUDE.md**

Add under the `## Gotchas` section (or a new `## Local Development` section):

```markdown
## Local Development (Mock Mode)

- `npm run seed` populates SQLite with test data; `npm run seed:reset` wipes and re-seeds
- `npm run dev:mock` starts the server with all external services mocked (GitHub, Jira, LLM)
- Mock providers: `GITHUB_PROVIDER=mock`, `JIRA_PROVIDER=mock`, `LLM_PROVIDER=mock` — each independent
- When adding or modifying database tables, API response shapes, or page data requirements: update `scripts/seed-data.ts` and `scripts/mock-identities.ts` if new entities are introduced
- When adding a new LLM prompt template, add a `promptTag()` call at the call site and a corresponding fixture response in `src/lib/llm-mock.ts`
- Mock entities (developers, teams, epics) are defined in `scripts/mock-identities.ts` — single source of truth for both seed and mock providers
```

- [ ] **Step 2: Update `.env.example`**

Add mock mode documentation:

```bash
# ── Mock Mode (local development without credentials) ──
# GITHUB_PROVIDER=mock    # Returns fixture org members and commits (no GITHUB_TOKEN needed)
# LLM_PROVIDER=mock       # Returns static fixture responses (no LLM_API_KEY needed)
# JIRA_PROVIDER=mock      # Returns fixture epics and issues (no JIRA_HOST/credentials needed)
# Or use: npm run dev:mock (sets all three + JIRA_ENABLED=true)
```

- [ ] **Step 3: Full end-to-end verification**

```bash
rm -f glooker.db
npm run seed
npm run dev:mock
```

Then verify each page in the browser:
1. **Dashboard** — shows 3 reports (2 completed, 1 running), score explanation cards, release notes
2. **Org report** (`/report/{id}/org`) — developer table with 8 developers, type breakdown, impact scores
3. **Dev detail** (`/report/{id}/dev/{login}`) — individual stats, commit list, Jira issues
4. **Projects** (`/projects`) — epics grouped by goal/initiative, expand an epic for summary
5. **Settings** — schedules tab shows 1 schedule, teams tab shows 3 teams, appearance tab works
6. **New Report** — click "New Report" for `mock-org`, watch it complete with mock data

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: add mock mode instructions to CLAUDE.md and .env.example"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Mock LLM provider with `promptTag()` routing → Task 2 + 3
- [x] Jira interface extraction + mock client → Task 4
- [x] GitHub provider refactor + mock → Task 5
- [x] Seed script with all 13 tables → Task 7
- [x] Shared mock identities → Task 1
- [x] `dev:mock` and `seed:reset` scripts → Task 7
- [x] Env validation updates → Task 6
- [x] CLAUDE.md maintenance instructions → Task 8
- [x] `.env.example` documentation → Task 8
- [x] `testJiraConnection()` factory refactor → Task 4
- [x] `JIRA_PROVIDER=mock` independent flag → Task 4 + 6

**Placeholder scan:** No TBDs. Task 7 step 2 (seed-data.ts) describes the constraints and structure rather than full fixture JSON — this is intentional as the file will be 300+ lines of data and is best generated during implementation with the constraints documented.

**Type consistency:** `JiraClientInterface` defined in Task 4, used in Task 4. `GitHubProvider` defined in Task 5, used in Task 5. `promptTag` defined in Task 2, used in Tasks 2/3. `MockDeveloper`/`MockTeam`/`MockEpic` defined in Task 1, used in Tasks 4/5/7.
