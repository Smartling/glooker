# Claude Code Spend Analytics — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code spend tracking to Glooker — admins see per-developer spend with Pareto analysis on the org report page; developers see their own spend on their detail page.

**Architecture:** New `src/lib/claude-code/` module (client + mock + index) following the Jira pattern. Report-runner fetches spend data from Anthropic's Claude Code Analytics API after the Jira step, matches users by email, stores aggregates in four new `developer_stats` columns. Frontend uses `useAuth()` to gate spend visibility.

**Tech Stack:** Next.js 15, TypeScript, SQLite/MySQL, Jest, Anthropic Admin API (`x-api-key` auth, direct `fetch`)

---

### Task 1: Database Migrations

**Files:**
- Modify: `src/lib/db/sqlite.ts` (migrations section ~line 216-218)
- Modify: `src/lib/db/mysql.ts` (migrations section ~line 138-147)

- [ ] **Step 1: Add SQLite migrations**

In `src/lib/db/sqlite.ts`, after the existing `total_reviews` migration (line 218), add:

```typescript
try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_total_cost REAL NOT NULL DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_input_tokens INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_output_tokens INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_sessions INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
```

- [ ] **Step 2: Add MySQL migrations**

In `src/lib/db/mysql.ts`, after the existing `total_reviews` migration (line 147), add:

```typescript
pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_total_cost DECIMAL(10,2) NOT NULL DEFAULT 0').catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_total_cost:', err);
});
pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_input_tokens BIGINT NOT NULL DEFAULT 0').catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_input_tokens:', err);
});
pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_output_tokens BIGINT NOT NULL DEFAULT 0').catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_output_tokens:', err);
});
pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_sessions INT NOT NULL DEFAULT 0').catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_sessions:', err);
});
```

- [ ] **Step 3: Verify migrations run cleanly**

Run: `rm -f glooker.db && npm run dev` — check the server starts without errors. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/sqlite.ts src/lib/db/mysql.ts
git commit -m "feat(cc-spend): add cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions columns"
```

---

### Task 2: Configuration and Environment Validation

**Files:**
- Modify: `src/lib/app-config/service.ts`
- Modify: `src/lib/env-validation.ts`
- Test: `src/lib/__tests__/unit/llm-config-service.test.ts`

- [ ] **Step 1: Add claudeCode section to AppConfig interface**

In `src/lib/app-config/service.ts`, add to the `AppConfig` interface after the `jira` section:

```typescript
claudeCode: {
  enabled: boolean;
  hasAdminApiKey: boolean;
};
```

- [ ] **Step 2: Populate claudeCode config in getAppConfig()**

At the end of `getAppConfig()`, before `return config;`, add:

```typescript
config.claudeCode = {
  enabled: process.env.CLAUDE_CODE_ENABLED === 'true',
  hasAdminApiKey: Boolean(process.env.ANTHROPIC_ADMIN_API_KEY),
};
```

- [ ] **Step 3: Add conditional env validation**

In `src/lib/env-validation.ts`, add a new entry to the `conditionalRules` array:

```typescript
{
  when: () => process.env.CLAUDE_CODE_ENABLED === 'true',
  featureLabel: 'CLAUDE_CODE_ENABLED=true',
  vars: [
    { name: 'ANTHROPIC_ADMIN_API_KEY', description: 'Anthropic Admin API key (sk-ant-admin...)' },
    { name: 'AUTH_ENABLED', description: 'Auth must be enabled for spend visibility gating' },
  ],
},
```

Also add to the `rules` array:

```typescript
{
  name: 'CLAUDE_CODE_ENABLED',
  required: false,
  description: 'Enable Claude Code spend analytics (true/false)',
  validate: (v) =>
    ['true', 'false'].includes(v)
      ? null
      : 'must be true or false',
},
```

- [ ] **Step 4: Add test for claudeCode config**

In `src/lib/__tests__/unit/llm-config-service.test.ts`, add a new describe block:

```typescript
describe('claudeCode config', () => {
  it('defaults to disabled', () => {
    delete process.env.CLAUDE_CODE_ENABLED;
    const config = getAppConfig();
    expect(config.claudeCode.enabled).toBe(false);
    expect(config.claudeCode.hasAdminApiKey).toBe(false);
  });

  it('enabled when CLAUDE_CODE_ENABLED=true', () => {
    process.env.CLAUDE_CODE_ENABLED = 'true';
    process.env.ANTHROPIC_ADMIN_API_KEY = 'sk-ant-admin-test';
    const config = getAppConfig();
    expect(config.claudeCode.enabled).toBe(true);
    expect(config.claudeCode.hasAdminApiKey).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx jest --testPathPatterns="llm-config-service"` — expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/app-config/service.ts src/lib/env-validation.ts src/lib/__tests__/unit/llm-config-service.test.ts
git commit -m "feat(cc-spend): add claudeCode config section and env validation"
```

---

### Task 3: Claude Code API Client

**Files:**
- Create: `src/lib/claude-code/client.ts`
- Test: `src/lib/__tests__/unit/claude-code-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/claude-code-client.test.ts`:

```typescript
import { ClaudeCodeClient } from '@/lib/claude-code/client';

describe('ClaudeCodeClient', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockResponse(data: any[], nextPage?: string) {
    return {
      ok: true,
      json: () => Promise.resolve({
        data,
        has_more: Boolean(nextPage),
        next_page: nextPage || null,
      }),
    };
  }

  function makeRecord(email: string, cost: number, input: number, output: number, sessions: number) {
    return {
      actor: { type: 'user_actor', email_address: email },
      num_sessions: sessions,
      model_breakdown: [
        {
          model: 'claude-sonnet-4-20250514',
          tokens: { input, output, cache_read: 100, cache_creation: 50 },
          estimated_cost: { amount: String(cost), currency: 'USD' },
        },
      ],
    };
  }

  it('fetches and aggregates daily spend records', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      makeRecord('alice@test.com', 500, 1000, 200, 3),
      makeRecord('bob@test.com', 300, 800, 150, 2),
    ]));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      email: 'alice@test.com',
      totalCost: 500,
      inputTokens: 1150, // 1000 + 100 cache_read + 50 cache_creation
      outputTokens: 200,
      sessions: 3,
    });
  });

  it('handles pagination', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(
        [makeRecord('alice@test.com', 500, 1000, 200, 3)],
        'cursor-page-2',
      ))
      .mockResolvedValueOnce(mockResponse(
        [makeRecord('bob@test.com', 300, 800, 150, 2)],
      ));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call should include page cursor
    expect(mockFetch.mock.calls[1][0]).toContain('page=cursor-page-2');
  });

  it('skips non-user actors (API keys)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      makeRecord('alice@test.com', 500, 1000, 200, 3),
      {
        actor: { type: 'api_actor', api_key_name: 'CI key' },
        num_sessions: 10,
        model_breakdown: [{
          model: 'claude-sonnet-4-20250514',
          tokens: { input: 5000, output: 1000, cache_read: 0, cache_creation: 0 },
          estimated_cost: { amount: '2000', currency: 'USD' },
        }],
      },
    ]));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(1);
    expect(records[0].email).toBe('alice@test.com');
  });

  it('sums across multiple models for same user', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      {
        actor: { type: 'user_actor', email_address: 'alice@test.com' },
        num_sessions: 5,
        model_breakdown: [
          {
            model: 'claude-sonnet-4-20250514',
            tokens: { input: 1000, output: 200, cache_read: 100, cache_creation: 50 },
            estimated_cost: { amount: '300', currency: 'USD' },
          },
          {
            model: 'claude-opus-4-20250514',
            tokens: { input: 2000, output: 500, cache_read: 200, cache_creation: 100 },
            estimated_cost: { amount: '800', currency: 'USD' },
          },
        ],
      },
    ]));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(1);
    expect(records[0].totalCost).toBe(1100); // 300 + 800
    expect(records[0].inputTokens).toBe(3450); // (1000+100+50) + (2000+200+100)
    expect(records[0].outputTokens).toBe(700); // 200 + 500
  });

  it('sends correct auth headers', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const client = new ClaudeCodeClient('sk-ant-admin-test-key');
    await client.fetchDailySpend('2026-04-01');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/organizations/usage_report/claude_code'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-admin-test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const client = new ClaudeCodeClient('bad-key');
    await expect(client.fetchDailySpend('2026-04-01')).rejects.toThrow('401');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="claude-code-client"` — expected: FAIL (module not found).

- [ ] **Step 3: Implement the client**

Create `src/lib/claude-code/client.ts`:

```typescript
const API_BASE = 'https://api.anthropic.com';

export interface ClaudeCodeDailyRecord {
  email: string;
  totalCost: number;       // cents USD, summed across all models
  inputTokens: number;     // uncached + cache_read + cache_creation
  outputTokens: number;
  sessions: number;
}

export interface ClaudeCodeClientInterface {
  fetchDailySpend(date: string): Promise<ClaudeCodeDailyRecord[]>;
}

export class ClaudeCodeClient implements ClaudeCodeClientInterface {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchDailySpend(date: string): Promise<ClaudeCodeDailyRecord[]> {
    const records: ClaudeCodeDailyRecord[] = [];
    let page: string | null = null;

    do {
      let url = `${API_BASE}/v1/organizations/usage_report/claude_code?starting_at=${date}&limit=1000`;
      if (page) url += `&page=${page}`;

      const res = await fetch(url, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Claude Code API error ${res.status}: ${text}`);
      }

      const body = await res.json();

      for (const record of body.data || []) {
        if (record.actor?.type !== 'user_actor') continue;

        const email = record.actor.email_address;
        if (!email) continue;

        let totalCost = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        for (const m of record.model_breakdown || []) {
          totalCost += Number(m.estimated_cost?.amount || 0);
          const t = m.tokens || {};
          inputTokens += (t.input || 0) + (t.cache_read || 0) + (t.cache_creation || 0);
          outputTokens += t.output || 0;
        }

        records.push({
          email,
          totalCost: Math.round(totalCost * 100) / 100,
          inputTokens,
          outputTokens,
          sessions: record.num_sessions || 0,
        });
      }

      page = body.has_more ? body.next_page : null;
    } while (page);

    return records;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="claude-code-client"` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude-code/client.ts src/lib/__tests__/unit/claude-code-client.test.ts
git commit -m "feat(cc-spend): add Claude Code Analytics API client with tests"
```

---

### Task 4: Mock Client and Module Index

**Files:**
- Create: `src/lib/claude-code/mock-client.ts`
- Create: `src/lib/claude-code/index.ts`

- [ ] **Step 1: Create the mock client**

Create `src/lib/claude-code/mock-client.ts`:

```typescript
import type { ClaudeCodeClientInterface, ClaudeCodeDailyRecord } from './client';

// Lazy-load mock identities to avoid bundling in production
let _identities: typeof import('../../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../../scripts/mock-identities');
  return _identities!;
}

export class MockClaudeCodeClient implements ClaudeCodeClientInterface {
  async fetchDailySpend(_date: string): Promise<ClaudeCodeDailyRecord[]> {
    const { MOCK_DEVELOPERS } = getIdentities();
    return MOCK_DEVELOPERS.map(dev => ({
      email: dev.jiraEmail, // mock uses jiraEmail as the Anthropic email
      totalCost: Math.round((Math.random() * 800 + 200) * 100) / 100, // $2-$10/day in cents
      inputTokens: Math.floor(Math.random() * 500000 + 100000),
      outputTokens: Math.floor(Math.random() * 100000 + 20000),
      sessions: Math.floor(Math.random() * 10 + 1),
    }));
  }
}
```

- [ ] **Step 2: Create the index module**

Create `src/lib/claude-code/index.ts`:

```typescript
export { ClaudeCodeClient } from './client';
export type { ClaudeCodeDailyRecord, ClaudeCodeClientInterface } from './client';
export { MockClaudeCodeClient } from './mock-client';

import type { ClaudeCodeClientInterface } from './client';
import { ClaudeCodeClient } from './client';
import { MockClaudeCodeClient } from './mock-client';

let cachedClient: ClaudeCodeClientInterface | null = null;

export function getClaudeCodeClient(): ClaudeCodeClientInterface | null {
  if (cachedClient) return cachedClient;

  if (process.env.CLAUDE_CODE_PROVIDER === 'mock') {
    cachedClient = new MockClaudeCodeClient();
    return cachedClient;
  }

  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) return null;

  cachedClient = new ClaudeCodeClient(apiKey);
  return cachedClient;
}
```

- [ ] **Step 3: Verify import works**

Run: `npx jest --testPathPatterns="claude-code-client"` — expected: still passes (index.ts doesn't break existing tests).

- [ ] **Step 4: Commit**

```bash
git add src/lib/claude-code/mock-client.ts src/lib/claude-code/index.ts
git commit -m "feat(cc-spend): add mock client and module index"
```

---

### Task 5: Report Runner Integration

**Files:**
- Modify: `src/lib/report-runner.ts`
- Modify: `src/lib/aggregator.ts`

- [ ] **Step 1: Add cc_ fields to DeveloperStats interface**

In `src/lib/aggregator.ts`, add to the `DeveloperStats` interface (after `totalReviews`):

```typescript
ccTotalCost: number;
ccInputTokens: number;
ccOutputTokens: number;
ccSessions: number;
```

In `aggregate()`, in the `stats.push()` block, add after `totalReviews: 0`:

```typescript
ccTotalCost: 0,
ccInputTokens: 0,
ccOutputTokens: 0,
ccSessions: 0,
```

- [ ] **Step 2: Update report-runner imports**

In `src/lib/report-runner.ts`, add import at the top:

```typescript
import { getClaudeCodeClient } from './claude-code';
```

- [ ] **Step 3: Add Claude Code spend step in report-runner**

In `src/lib/report-runner.ts`, after the Jira section (after the `log('Jira collection complete...')` line or the closing brace of the `if (jiraConfig.enabled)` block), and before the `// 3. Final aggregation` comment, add:

```typescript
    // Claude Code spend collection
    const ccConfig = getAppConfig().claudeCode;
    const ccSpendByLogin = new Map<string, { cost: number; inputTokens: number; outputTokens: number; sessions: number }>();

    if (ccConfig.enabled) {
      const ccClient = getClaudeCodeClient();
      if (ccClient) {
        log('[claude-code] Fetching spend data...');
        updateProgress(reportId, { step: 'Collecting Claude Code spend...' });

        // Build date range for the report period
        const dates: string[] = [];
        for (let d = 0; d < days; d++) {
          const date = new Date(since.getTime() + d * 24 * 60 * 60 * 1000);
          dates.push(date.toISOString().split('T')[0]);
        }

        // Fetch all days and accumulate by email
        const spendByEmail = new Map<string, { cost: number; inputTokens: number; outputTokens: number; sessions: number }>();
        for (const date of dates) {
          try {
            const records = await ccClient.fetchDailySpend(date);
            for (const r of records) {
              const existing = spendByEmail.get(r.email) || { cost: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
              existing.cost += r.totalCost;
              existing.inputTokens += r.inputTokens;
              existing.outputTokens += r.outputTokens;
              existing.sessions += r.sessions;
              spendByEmail.set(r.email, existing);
            }
          } catch (err) {
            log(`[claude-code] WARN: failed to fetch ${date}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Build email-to-login map from commit_analyses
        const [emailRows] = await db.execute(
          `SELECT DISTINCT github_login, author_email FROM commit_analyses WHERE report_id = ? AND author_email IS NOT NULL`,
          [reportId],
        ) as [any[], any];
        const emailToLogin = new Map<string, string>();
        for (const row of emailRows) {
          if (row.author_email) emailToLogin.set(row.author_email.toLowerCase(), row.github_login);
        }

        // Match and assign
        let matched = 0;
        let unmatched = 0;
        for (const [email, spend] of spendByEmail) {
          const login = emailToLogin.get(email.toLowerCase());
          if (login) {
            ccSpendByLogin.set(login, spend);
            matched++;
          } else {
            unmatched++;
          }
        }

        // Log per-developer spend
        for (const [login, spend] of ccSpendByLogin) {
          log(`[claude-code] @${login}: $${(spend.cost / 100).toFixed(2)} (${spend.sessions} sessions)`);
        }

        const totalSpend = [...ccSpendByLogin.values()].reduce((s, v) => s + v.cost, 0);
        log(`[claude-code] Spend collection complete: $${(totalSpend / 100).toFixed(2)} total across ${matched} matched developers (${unmatched} unmatched emails skipped)`);
      }
    }
```

- [ ] **Step 4: Attach spend data in final aggregation**

In `src/lib/report-runner.ts`, in the final aggregation loop (the `for (const s of stats)` block that attaches Jira data), after the `s.totalReviews = reviewCounts.get(...)` line, add:

```typescript
      // Attach Claude Code spend (already fetched above)
      const ccSpend = ccSpendByLogin.get(s.githubLogin);
      if (ccSpend) {
        s.ccTotalCost = ccSpend.cost;
        s.ccInputTokens = ccSpend.inputTokens;
        s.ccOutputTokens = ccSpend.outputTokens;
        s.ccSessions = ccSpend.sessions;
      }
```

- [ ] **Step 5: Add cc_ columns to both INSERT statements**

In `src/lib/report-runner.ts`, update both INSERT statements (the progressive one in `checkMemberComplete` and the final one). Add `cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions` to both the column list and VALUES placeholder list, and add the corresponding values to the params array:

In the column list of both INSERT statements, after `total_reviews,` add:

```
cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions,
```

In the VALUES placeholders, add 4 more `?` placeholders.

In the ON DUPLICATE KEY UPDATE clause, add:

```
cc_total_cost     = VALUES(cc_total_cost),
cc_input_tokens   = VALUES(cc_input_tokens),
cc_output_tokens  = VALUES(cc_output_tokens),
cc_sessions       = VALUES(cc_sessions),
```

In the params array, after `s.totalReviews,` add:

```typescript
s.ccTotalCost,
s.ccInputTokens,
s.ccOutputTokens,
s.ccSessions,
```

- [ ] **Step 6: Update report-runner integration test**

In `src/lib/__tests__/integration/report-runner.test.ts`, add `countReviewedPRs` to the mock (if not already present) and add a mock for `getClaudeCodeClient`. At the top with other mocks:

```typescript
jest.mock('@/lib/claude-code', () => ({
  getClaudeCodeClient: jest.fn().mockReturnValue(null),
}));
```

- [ ] **Step 7: Run all tests**

Run: `npm test` — expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/aggregator.ts src/lib/report-runner.ts src/lib/__tests__/integration/report-runner.test.ts
git commit -m "feat(cc-spend): integrate Claude Code spend collection into report runner"
```

---

### Task 6: Update Report Data Queries

**Files:**
- Modify: `src/lib/report/org.ts`
- Modify: `src/lib/report/dev.ts`

- [ ] **Step 1: Add cc_ columns to org report query**

In `src/lib/report/org.ts`, in the `getOrgReport()` function, update the developer_stats SELECT to include the new columns. After `total_jira_issues,` add:

```
cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions,
```

- [ ] **Step 2: Add cc_ columns to dev report queries**

In `src/lib/report/dev.ts`, in `getDevReport()`, update both SELECT queries:

In the individual dev query (the one with `WHERE report_id = ? AND github_login = ?`), after `total_jira_issues, total_reviews,` add:

```
cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions,
```

In the all-devs query (for percentile computation), after `total_jira_issues, total_reviews` add:

```
, cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions
```

- [ ] **Step 3: Run tests**

Run: `npm test` — expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/report/org.ts src/lib/report/dev.ts
git commit -m "feat(cc-spend): add cc_ columns to org and dev report queries"
```

---

### Task 7: Org Report Page — Spend Column + Spend Tab

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

This task is the largest and covers UI changes. The org page is a large client component.

- [ ] **Step 1: Add auth and config state**

In `src/app/report/[id]/org/page.tsx`, add the import for `useAuth`:

```typescript
import { useAuth } from '@/app/auth-context';
```

Inside the component, after the existing `useState` declarations, add:

```typescript
const { canAct: isAdmin } = useAuth();
const [ccEnabled, setCcEnabled] = useState(false);
```

In the existing `useEffect` that fetches `/api/report/${params.id}/org`, also fetch the config:

```typescript
fetch('/api/llm-config').then(r => r.json()).then(d => {
  setCcEnabled(d.claudeCode?.enabled ?? false);
}).catch(() => {});
```

- [ ] **Step 2: Add cc_ fields to Developer interface**

In the `Developer` interface at the top of the file, add:

```typescript
cc_total_cost?: number;
cc_input_tokens?: number;
cc_output_tokens?: number;
cc_sessions?: number;
```

- [ ] **Step 3: Add Spend column to the developer table**

Find the table header row in the developer table. After the last `<th>` (before the closing `</tr>`), conditionally add:

```tsx
{ccEnabled && isAdmin && <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Spend</th>}
```

In the corresponding table body row, after the last `<td>`, add:

```tsx
{ccEnabled && isAdmin && (
  <td className="px-3 py-2 text-right text-sm text-green-400">
    {d.cc_total_cost ? `$${(d.cc_total_cost / 100).toFixed(2)}` : '—'}
  </td>
)}
```

- [ ] **Step 4: Add Spend tab**

Add a tab toggle state near the other state declarations:

```typescript
const [activeTab, setActiveTab] = useState<'overview' | 'spend'>('overview');
```

Before the main content area (after the summary cards section), add tab navigation (only if spend tab should be visible):

```tsx
{ccEnabled && isAdmin && (
  <div className="flex gap-4 border-b border-gray-800 mb-6">
    <button
      onClick={() => setActiveTab('overview')}
      className={`pb-2 text-sm font-medium ${activeTab === 'overview' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
    >
      Overview
    </button>
    <button
      onClick={() => setActiveTab('spend')}
      className={`pb-2 text-sm font-medium ${activeTab === 'spend' ? 'text-white border-b-2 border-green-500' : 'text-gray-500 hover:text-gray-300'}`}
    >
      Spend
    </button>
  </div>
)}
```

- [ ] **Step 5: Create SpendTab component**

Create a `SpendTab` component at the bottom of the file (or inline). This renders when `activeTab === 'spend'`. It receives `developers` as a prop and computes:

- Total spend, average, median, top 20% share
- Pareto concentration bar
- Top spenders table with outlier badges
- Spend vs Impact scatter plot

The component is substantial — implement the summary bar, Pareto bar, and table first. The scatter plot can use a simple `<div>` with absolutely positioned dots (same pattern used in the brainstorming mockup), or use Recharts `<ScatterChart>` if already imported.

Key computations for the spend tab:

```typescript
function computeSpendMetrics(devs: Developer[]) {
  const withSpend = devs
    .filter(d => (d.cc_total_cost ?? 0) > 0)
    .sort((a, b) => (b.cc_total_cost ?? 0) - (a.cc_total_cost ?? 0));

  const total = withSpend.reduce((s, d) => s + (d.cc_total_cost ?? 0), 0);
  const avg = withSpend.length > 0 ? total / withSpend.length : 0;
  const sorted = withSpend.map(d => d.cc_total_cost ?? 0).sort((a, b) => a - b);
  const median = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : 0;

  const top20Count = Math.max(1, Math.ceil(withSpend.length * 0.2));
  const top20Spend = withSpend.slice(0, top20Count).reduce((s, d) => s + (d.cc_total_cost ?? 0), 0);
  const top20Pct = total > 0 ? Math.round((top20Spend / total) * 100) : 0;

  // Outlier detection: 2x median $/impact
  const costPerImpact = withSpend
    .filter(d => Number(d.impact_score) > 0)
    .map(d => (d.cc_total_cost ?? 0) / Number(d.impact_score));
  const medianCPI = costPerImpact.length > 0
    ? costPerImpact.sort((a, b) => a - b)[Math.floor(costPerImpact.length / 2)]
    : 0;

  return { withSpend, total, avg, median, top20Count, top20Spend, top20Pct, medianCPI };
}
```

Wrap the existing content in `{activeTab === 'overview' && ( ... )}` and add `{activeTab === 'spend' && ( <SpendTab /> )}`.

- [ ] **Step 6: Test manually**

Run: `npm run dev` and navigate to an org report page. Verify:
- Without `CLAUDE_CODE_ENABLED=true`: no spend column, no tabs
- With mock data and admin role: spend column visible, spend tab renders

- [ ] **Step 7: Commit**

```bash
git add src/app/report/[id]/org/page.tsx
git commit -m "feat(cc-spend): add Spend column and Spend tab to org report page"
```

---

### Task 8: Developer Detail Page — Spend Tile

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`

- [ ] **Step 1: Add auth check and config fetch**

Import `useAuth` (if not already imported):

```typescript
import { useAuth } from '@/app/auth-context';
```

Add state and fetch:

```typescript
const { user: authUser, canAct: isAdmin, enabled: authEnabled } = useAuth();
const [ccEnabled, setCcEnabled] = useState(false);
```

In the existing `useEffect` that fetches `/api/llm-config`, extend it to also read `claudeCode`:

```typescript
fetch('/api/llm-config').then(r => r.json()).then(d => {
  if (d.jira?.host) setJiraHost(d.jira.host);
  setCcEnabled(d.claudeCode?.enabled ?? false);
}).catch(() => {});
```

- [ ] **Step 2: Add cc_ fields to DevStats interface**

In the `DevStats` interface (or equivalent) at the top of the file, add:

```typescript
cc_total_cost?: number;
cc_input_tokens?: number;
cc_output_tokens?: number;
cc_sessions?: number;
```

- [ ] **Step 3: Compute visibility and render tile**

Determine if the spend tile should be shown:

```typescript
const showSpendTile = ccEnabled && authEnabled && (
  isAdmin || (authUser?.email && devEmails.includes(authUser.email))
);
```

For `devEmails`, query the developer's commit emails. The simplest approach: the API already returns commit data — check if `authUser?.email` matches any `author_email` from the commits. Alternatively, compare `authUser?.githubLogin` to the page's `login` param.

Simpler approach using github login:

```typescript
const isOwnProfile = authUser?.githubLogin === login;
const showSpendTile = ccEnabled && authEnabled && (isAdmin || isOwnProfile);
```

Add the spend tile to the metrics array (where the other tiles like Commits, PRs, Reviews are defined). Conditionally include it:

```typescript
...(showSpendTile && dev.cc_total_cost ? [{
  label: 'CC Spend',
  value: `$${(dev.cc_total_cost / 100).toFixed(2)}`,
  sub: `${dev.cc_sessions ?? 0} sessions`,
}] : []),
```

- [ ] **Step 4: Test manually**

- As admin: navigate to any developer's page — spend tile should be visible
- As the developer themselves: spend tile should be visible
- As a different non-admin user: spend tile should be hidden

- [ ] **Step 5: Commit**

```bash
git add "src/app/report/[id]/dev/[login]/page.tsx"
git commit -m "feat(cc-spend): add CC Spend tile to developer detail page (auth-gated)"
```

---

### Task 9: Update Documentation and Mock Setup

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example` (if it exists)
- Modify: `README.md`

- [ ] **Step 1: Update CLAUDE.md**

Add to the "Key architectural decisions" section:

```
- **Claude Code spend analytics** (`src/lib/claude-code/`) — optional, enabled via `CLAUDE_CODE_ENABLED=true`. Uses Anthropic Admin API to pull per-developer Claude Code spend during report runs. Matches users by commit author email. Requires `AUTH_ENABLED=true` for spend visibility gating. Spend stored as cents in `cc_total_cost`, `cc_input_tokens`, `cc_output_tokens`, `cc_sessions` columns on `developer_stats`.
```

Add to the "Environment" section:

```
- `CLAUDE_CODE_ENABLED=true` enables Claude Code spend analytics; requires `ANTHROPIC_ADMIN_API_KEY` and `AUTH_ENABLED=true`
- `CLAUDE_CODE_PROVIDER=mock` returns random spend data (for dev/test)
```

Add to "Gotchas":

```
- Claude Code Analytics API returns cost as cents in string format (e.g., `"123.45"` = $1.2345) — stored as cents in DB, formatted to dollars in UI
- Claude Code API returns data one day at a time — a 30-day report makes 30 API calls (fast, free, no rate limit concerns)
- Spend tile on dev detail page requires both `CLAUDE_CODE_ENABLED=true` and `AUTH_ENABLED=true` — without auth, can't determine who's viewing
```

- [ ] **Step 2: Update README.md**

Add a "Claude Code (optional)" section after the Jira section:

```markdown
### Claude Code Analytics (optional)

Track per-developer Claude Code spend. Requires an [Anthropic Admin API key](https://console.anthropic.com/settings/admin-keys):

\```env
CLAUDE_CODE_ENABLED=true
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-...
AUTH_ENABLED=true  # Required — spend visibility is role-gated
\```

Spend data is collected during report runs from the [Claude Code Analytics API](https://docs.anthropic.com/en/api/admin-api). Users are matched to GitHub developers by email address. Admins see a Spend tab on the org report page with Pareto analysis; developers see their own spend on their detail page.
```

Add "CC Spend" row to the Report Metrics table:

```
| CC Spend | Claude Code estimated cost for the period (optional, requires Anthropic Admin API key) |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: add Claude Code spend analytics documentation"
```

---

### Task 10: Full Test Suite Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test` — expected: all tests pass, no regressions.

- [ ] **Step 2: Run build**

Run: `npm run build` — expected: builds cleanly with no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Start the dev server with mock mode:

```bash
CLAUDE_CODE_ENABLED=true CLAUDE_CODE_PROVIDER=mock AUTH_ENABLED=true npm run dev
```

Verify:
- Org report page shows Spend column for admin
- Spend tab appears with summary metrics, Pareto bar, and table
- Developer detail page shows CC Spend tile for own profile
- Without `CLAUDE_CODE_ENABLED`: no spend UI anywhere

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(cc-spend): fixups from smoke testing"
```
