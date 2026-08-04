# GLOOK-30 / GLOOK-29: Skills + model-breakdown ingestion and self-view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest per-developer skills usage and model breakdown from the Anthropic Analytics API through the existing cc-spend machinery, and surface a developer's own cost/skills/models on their profile page.

**Architecture:** Two new methods on the existing `CcSpendProvider` reuse its key, auth, retry, pagination and mock factory. Skills parsing is a generic recursive walk so new product buckets need no code change. Both dimensions land in symmetric per-(report, developer, dimension) long tables, extensible by rows rather than columns. All three applies (cost, skills, models) share one extracted email→login resolver and run in separate transactions inside the existing `refreshCcSpendForReport`, so the report runner and the "Pull from Anthropic" button both drive them with no new trigger.

**Tech Stack:** TypeScript, Next.js 15, MySQL + SQLite (dual), Jest + ts-jest, Anthropic Analytics REST API.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-glook-30-skills-model-ingestion-design.md`.
- Auth headers for both endpoints: `x-api-key: <ANTHROPIC_ANALYTICS_API_KEY>`, `anthropic-version: 2023-06-01`.
- Skills endpoint is `GET /v1/organizations/analytics/users`; params are `starting_date` + `ending_date` (**dates, not** the `starting_at`/`ending_at` timestamps the cost endpoint uses), `limit`, and `page=<next_page token>`.
- **Verified trap:** on `/users`, only `page` advances the cursor. `next_page`, `cursor` and `starting_after` are silently ignored and re-serve page 1 — using them would loop until `MAX_PAGES`.
- **Verified:** a date range on `/users` returns **one aggregated row per user** (keyset-paginated by email), not one row per user per day. No per-day collapsing needed.
- **Verified:** `/users` has a ~2-day data lag and returns HTTP 400 `"Latest available data for this query is <date>."` for a too-recent `ending_date`.
- Model endpoint is the existing cost endpoint plus `group_by[]=model`. **Verified trap:** the `[]` is required — `group_by=model` is silently ignored and returns `model: null`.
- `cost` values use the existing convention exactly: `Math.round(parseFloat(amount))`, the same unit written to `developer_stats.cc_total_cost` and rendered by dividing by 100.
- Skills, model identity and per-model request counts are **ungated**. Per-model `cost` is **gated** by the existing `canSeeCost(login)` from `src/lib/cost-visibility.ts`.
- Σ(per-model cost) ≠ `cc_total_cost`; no reconciliation is asserted anywhere.
- Every new API route handler stays wrapped in `withRequestLog()` (no new routes in this plan).
- Jest flag is `--testPathPatterns` (plural). Test files importing anything that transitively reaches `github.ts` must `jest.mock('@octokit/rest')` before the import.
- New DB objects follow the existing pattern: SQLite via the `SCHEMA` const (`CREATE TABLE IF NOT EXISTS`) plus idempotent `ALTER` in `createSQLiteDB()`; MySQL via `CREATE TABLE IF NOT EXISTS` + `ALTER … catch(ER_DUP_FIELDNAME)` in the `ready` IIFE. `schema.sql` is not edited.

---

## File Structure

**Create**
- `src/lib/cc-spend/skills-parser.ts` — pure generic walk extracting per-product skills entries from a `/users` row. Isolated because it is the only non-trivial logic here and must be exhaustively tested.
- `src/lib/cc-spend/identity.ts` — the email→`github_login` resolver, extracted from `apply.ts` so all three applies share one implementation.
- `src/lib/cc-spend/apply-breakdowns.ts` — `applySkillsUsage()` + `applyModelUsage()`. Keeps `apply.ts` focused on cost.

**Modify**
- `src/lib/cc-spend/provider.ts` — two method signatures + result types.
- `src/lib/cc-spend/anthropic-provider.ts` — skills URL builder, skills fetch/walk, model grouped fetch.
- `src/lib/cc-spend/mock-provider.ts` — deterministic fixtures for both.
- `src/lib/cc-spend/apply.ts` — consume the shared resolver.
- `src/lib/cc-spend/service.ts` — two extra pulls, skills window clamp, each non-fatal.
- `src/lib/db/sqlite.ts`, `src/lib/db/mysql.ts` — two tables + rollup column.
- `src/lib/report/dev.ts` — include the focused developer's skills + model rows.
- `src/app/api/report/[id]/dev/[login]/route.ts` — strip per-model `cost` via `canSeeCost`.
- `src/app/profile/profile-content.tsx` — self-view.
- `scripts/seed-data.ts` — seed both tables + rollup.

---

### Task 1: Database schema — two breakdown tables + rollup column

**Files:**
- Modify: `src/lib/db/sqlite.ts` (add to `SCHEMA` const; add ALTER near the existing cc-spend migrations ~line 275)
- Modify: `src/lib/db/mysql.ts` (add table consts + apply in the `ready` IIFE near the existing cc ALTERs ~line 245)
- Test: `src/lib/__tests__/unit/cc-breakdown-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `cc_skills_usage(report_id, github_login, product, skills_used, skills_distinct)` and `cc_model_usage(report_id, github_login, model, cost, requests)`, both `UNIQUE (report_id, github_login, <dimension>)` with `FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE`; column `developer_stats.cc_skills_used`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-breakdown-schema.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSQLiteDB } from '@/lib/db/sqlite';

let dbPath: string;
let db: any;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-schema-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  db = createSQLiteDB();
});
afterAll(() => { try { fs.unlinkSync(dbPath); } catch {} });

it('creates both breakdown tables', async () => {
  const [rows] = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cc_skills_usage','cc_model_usage')`,
  ) as [any[], any];
  expect(rows.map((r: any) => r.name).sort()).toEqual(['cc_model_usage', 'cc_skills_usage']);
});

it('adds the cc_skills_used rollup column to developer_stats', async () => {
  const [cols] = await db.execute(`PRAGMA table_info(developer_stats)`) as [any[], any];
  expect(cols.map((c: any) => c.name)).toContain('cc_skills_used');
});

it('cascades breakdown rows when the report is deleted', async () => {
  await db.execute(
    `INSERT INTO reports (id, org, period_days, status) VALUES ('rX', 'acme', 14, 'completed')`,
  );
  await db.execute(
    `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
     VALUES ('rX', 'alice', 'cowork', 5, 2)`,
  );
  await db.execute(
    `INSERT INTO cc_model_usage (report_id, github_login, model, cost, requests)
     VALUES ('rX', 'alice', 'claude-sonnet-5', 1234, 10)`,
  );
  await db.execute(`DELETE FROM reports WHERE id = 'rX'`);

  const [skills] = await db.execute(`SELECT * FROM cc_skills_usage WHERE report_id = 'rX'`) as [any[], any];
  const [models] = await db.execute(`SELECT * FROM cc_model_usage WHERE report_id = 'rX'`) as [any[], any];
  expect(skills).toHaveLength(0);
  expect(models).toHaveLength(0);
});

it('rejects a duplicate (report, login, dimension)', async () => {
  await db.execute(`INSERT INTO reports (id, org, period_days, status) VALUES ('rY', 'acme', 14, 'completed')`);
  await db.execute(
    `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
     VALUES ('rY', 'bob', 'chat', 0, 3)`,
  );
  await expect(db.execute(
    `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
     VALUES ('rY', 'bob', 'chat', 1, 1)`,
  )).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-breakdown-schema"`
Expected: FAIL — first test returns `[]` (no such tables).

- [ ] **Step 3: Add the tables and column to SQLite**

In `src/lib/db/sqlite.ts`, append to the `SCHEMA` template string (after the last existing `CREATE TABLE`):

```sql
CREATE TABLE IF NOT EXISTS cc_skills_usage (
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  product         TEXT    NOT NULL,
  skills_used     INTEGER NOT NULL DEFAULT 0,
  skills_distinct INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login, product)
);

CREATE TABLE IF NOT EXISTS cc_model_usage (
  report_id    TEXT    NOT NULL,
  github_login TEXT    NOT NULL,
  model        TEXT    NOT NULL,
  cost         REAL    NOT NULL DEFAULT 0,
  requests     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login, model)
);
```

And in `createSQLiteDB()`, immediately after the existing `cc_requests` ALTER (~line 276):

```typescript
  // GLOOK-30: rollup so existing per-developer tooling picks up a headline
  // "skills invoked" number without special-casing. Breakdown lives in cc_skills_usage.
  try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_skills_used INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
```

- [ ] **Step 4: Add the same to MySQL**

In `src/lib/db/mysql.ts`, near the other schema consts, add:

```typescript
const CC_SKILLS_USAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS cc_skills_usage (
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  product         VARCHAR(64)  NOT NULL,
  skills_used     INT          NOT NULL DEFAULT 0,
  skills_distinct INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_cc_skills (report_id, github_login, product),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CC_MODEL_USAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS cc_model_usage (
  report_id    VARCHAR(36)   NOT NULL,
  github_login VARCHAR(255)  NOT NULL,
  model        VARCHAR(128)  NOT NULL,
  cost         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  requests     BIGINT        NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_cc_model (report_id, github_login, model),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
```

And inside the `ready` IIFE, after the existing `cc_requests` ALTER (~line 247):

```typescript
  await pool.execute(CC_SKILLS_USAGE_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create cc_skills_usage table:', err);
  });
  await pool.execute(CC_MODEL_USAGE_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create cc_model_usage table:', err);
  });
  await pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_skills_used INT NOT NULL DEFAULT 0').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_skills_used:', err);
  });
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPatterns="cc-breakdown-schema"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/sqlite.ts src/lib/db/mysql.ts src/lib/__tests__/unit/cc-breakdown-schema.test.ts
git commit -m "feat(cc): add cc_skills_usage + cc_model_usage tables and cc_skills_used rollup (GLOOK-30)"
```

---

### Task 2: Skills parser — generic walk over product buckets

**Files:**
- Create: `src/lib/cc-spend/skills-parser.ts`
- Test: `src/lib/__tests__/unit/cc-skills-parser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface SkillsProductUsage { product: string; used: number; distinct: number }` and `export function extractSkillsEntries(row: Record<string, any> | null | undefined): SkillsProductUsage[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-skills-parser.test.ts`:

```typescript
import { extractSkillsEntries } from '@/lib/cc-spend/skills-parser';

it('names products by dotted path with the _metrics suffix stripped', () => {
  const row = {
    user: { email_address: 'a@x.com' },
    chat_metrics: { distinct_skills_used_count: 3, message_count: 10 },
    cowork_metrics: { skills_used_count: 12, distinct_skills_used_count: 4 },
    office_metrics: {
      excel: { skills_used_count: 2, distinct_skills_used_count: 1 },
      word:  { skills_used_count: 0, distinct_skills_used_count: 0 },
    },
    science_metrics: { skills_used_count: 7 },
  };
  const out = extractSkillsEntries(row);
  expect(out).toEqual(expect.arrayContaining([
    { product: 'chat',         used: 0,  distinct: 3 },
    { product: 'cowork',       used: 12, distinct: 4 },
    { product: 'office.excel', used: 2,  distinct: 1 },
    { product: 'science',      used: 7,  distinct: 0 },
  ]));
});

it('skips entries where both counts are zero', () => {
  const out = extractSkillsEntries({
    office_metrics: { word: { skills_used_count: 0, distinct_skills_used_count: 0 } },
  });
  expect(out).toEqual([]);
});

it('picks up an unknown future product bucket with no code change', () => {
  const out = extractSkillsEntries({ hologram_metrics: { skills_used_count: 9 } });
  expect(out).toEqual([{ product: 'hologram', used: 9, distinct: 0 }]);
});

it('ignores nodes with no skills fields, including user', () => {
  const out = extractSkillsEntries({
    user: { type: 'user', id: 'u1', email_address: 'a@x.com' },
    claude_code_metrics: { core_metrics: { distinct_session_count: 45 } },
    web_search_count: 3,
  });
  expect(out).toEqual([]);
});

it('is safe on null, undefined and non-objects', () => {
  expect(extractSkillsEntries(null)).toEqual([]);
  expect(extractSkillsEntries(undefined)).toEqual([]);
  expect(extractSkillsEntries({})).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-skills-parser"`
Expected: FAIL — cannot resolve `@/lib/cc-spend/skills-parser`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cc-spend/skills-parser.ts`:

```typescript
/**
 * Skills counts arrive scattered across per-product buckets on each
 * /v1/organizations/analytics/users row, not as one top-level field, and the set
 * of buckets grows over time. So rather than mapping known fields, walk the row
 * and emit an entry wherever a node carries either skills counter. A new product
 * bucket is then picked up with no code change.
 *
 * Note chat reports only `distinct_skills_used_count` (no total), so its `used`
 * is legitimately 0.
 */
export interface SkillsProductUsage {
  product: string;
  used: number;
  distinct: number;
}

const USED_KEY = 'skills_used_count';
const DISTINCT_KEY = 'distinct_skills_used_count';

const toCount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function extractSkillsEntries(row: Record<string, any> | null | undefined): SkillsProductUsage[] {
  const out: SkillsProductUsage[] = [];

  const visit = (node: any, pathSegments: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    if (pathSegments.length > 0 && (USED_KEY in node || DISTINCT_KEY in node)) {
      const used = toCount(node[USED_KEY]);
      const distinct = toCount(node[DISTINCT_KEY]);
      // Absence means "no usage" — skipping zeros keeps the table small and
      // makes a present row meaningful.
      if (used > 0 || distinct > 0) {
        out.push({ product: pathSegments.map(s => s.replace(/_metrics$/, '')).join('.'), used, distinct });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value, [...pathSegments, key]);
      }
    }
  };

  visit(row, []);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="cc-skills-parser"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cc-spend/skills-parser.ts src/lib/__tests__/unit/cc-skills-parser.test.ts
git commit -m "feat(cc): generic skills-usage parser over product buckets (GLOOK-30)"
```

---

### Task 3: Provider — skills and model pulls

**Files:**
- Modify: `src/lib/cc-spend/provider.ts`
- Modify: `src/lib/cc-spend/anthropic-provider.ts`
- Test: `src/lib/__tests__/unit/cc-breakdown-provider.test.ts`

**Interfaces:**
- Consumes: `extractSkillsEntries`, `SkillsProductUsage` from Task 2.
- Produces, all exported from `provider.ts`:
  ```typescript
  export interface PerEmailSkills { email: string; products: SkillsProductUsage[] }
  export interface ModelUsage { model: string; costCents: number; requests: number }
  export interface PerEmailModelCost { email: string; models: ModelUsage[] }
  ```
  and two new `CcSpendProvider` methods:
  ```typescript
  pullSkillsByPeriod(periodStart: string, periodEnd: string, log?: (msg: string) => void): Promise<PerEmailSkills[]>;
  pullModelCostByPeriod(periodStart: string, periodEnd: string, log?: (msg: string) => void): Promise<PerEmailModelCost[]>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-breakdown-provider.test.ts`:

```typescript
import { createAnthropicCcSpendProvider } from '@/lib/cc-spend/anthropic-provider';

const origFetch = global.fetch;
const origKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
beforeEach(() => { process.env.ANTHROPIC_ANALYTICS_API_KEY = 'k-test'; });
afterAll(() => { global.fetch = origFetch; process.env.ANTHROPIC_ANALYTICS_API_KEY = origKey; });

const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });

it('skills: uses date params and the page cursor, and aggregates per email', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: any) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return ok({
        data: [{ user: { email_address: 'A@X.com' }, cowork_metrics: { skills_used_count: 4, distinct_skills_used_count: 2 } }],
        next_page: 'TOKEN2',
      }) as any;
    }
    return ok({
      data: [{ user: { email_address: 'b@x.com' }, chat_metrics: { distinct_skills_used_count: 5 } }],
      next_page: null,
    }) as any;
  }) as any;

  const out = await createAnthropicCcSpendProvider().pullSkillsByPeriod('2026-07-01', '2026-07-14');

  expect(urls[0]).toContain('/v1/organizations/analytics/users');
  expect(urls[0]).toContain('starting_date=2026-07-01');
  expect(urls[0]).toContain('ending_date=2026-07-14');
  expect(urls[0]).not.toContain('starting_at');
  // Only `page` advances this endpoint's cursor; next_page/cursor are ignored by the API.
  expect(urls[1]).toContain('page=TOKEN2');

  expect(out).toEqual([
    { email: 'a@x.com', products: [{ product: 'cowork', used: 4, distinct: 2 }] },
    { email: 'b@x.com', products: [{ product: 'chat', used: 0, distinct: 5 }] },
  ]);
});

it('skills: drops users with no non-zero skills usage', async () => {
  global.fetch = jest.fn(async () => ok({
    data: [{ user: { email_address: 'c@x.com' }, office_metrics: { word: { skills_used_count: 0, distinct_skills_used_count: 0 } } }],
    next_page: null,
  }) as any) as any;

  const out = await createAnthropicCcSpendProvider().pullSkillsByPeriod('2026-07-01', '2026-07-14');
  expect(out).toEqual([]);
});

it('models: sends group_by[] with brackets and groups per email', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: any) => {
    urls.push(String(url));
    return ok({
      data: [
        { actor: { type: 'user_actor', email: 'A@X.com' }, model: 'claude-opus-4-8', amount: '1500.4', requests: 10 },
        { actor: { type: 'user_actor', email: 'a@x.com' }, model: 'claude-sonnet-5', amount: '500.6', requests: 20 },
        { actor: { type: 'api_actor', email: 'bot@x.com' }, model: 'claude-sonnet-5', amount: '999', requests: 1 },
        { actor: { type: 'user_actor', email: 'd@x.com', deleted: true }, model: 'claude-sonnet-5', amount: '5', requests: 1 },
        { actor: { type: 'user_actor', email: 'e@x.com' }, model: null, amount: '7', requests: 1 },
      ],
      next_page: null,
    }) as any;
  }) as any;

  const out = await createAnthropicCcSpendProvider().pullModelCostByPeriod('2026-07-01', '2026-07-14');

  expect(urls[0]).toContain('group_by%5B%5D=model');
  expect(out).toEqual([{
    email: 'a@x.com',
    models: [
      { model: 'claude-opus-4-8', costCents: 1500, requests: 10 },
      { model: 'claude-sonnet-5', costCents: 501,  requests: 20 },
    ],
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-breakdown-provider"`
Expected: FAIL — `pullSkillsByPeriod is not a function`.

- [ ] **Step 3: Extend the provider contract**

In `src/lib/cc-spend/provider.ts`, add the import and types, and the two methods to the interface:

```typescript
import type { SkillsProductUsage } from './skills-parser';

export interface PerEmailSkills {
  email: string;
  products: SkillsProductUsage[];
}

export interface ModelUsage {
  model: string;
  costCents: number;
  requests: number;
}

export interface PerEmailModelCost {
  email: string;
  models: ModelUsage[];
}
```

and inside `export interface CcSpendProvider { … }`:

```typescript
  /** Pull per-user skills usage per product for [start, end] (inclusive, YYYY-MM-DD). */
  pullSkillsByPeriod(periodStart: string, periodEnd: string, log?: (msg: string) => void): Promise<PerEmailSkills[]>;
  /** Pull per-user cost/requests broken down by model for [start, end] (inclusive, YYYY-MM-DD). */
  pullModelCostByPeriod(periodStart: string, periodEnd: string, log?: (msg: string) => void): Promise<PerEmailModelCost[]>;
```

- [ ] **Step 4: Implement both pulls in the Anthropic provider**

In `src/lib/cc-spend/anthropic-provider.ts`, add imports and the users path near the existing consts:

```typescript
import { extractSkillsEntries } from './skills-parser';
import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult, PerEmailSkills, PerEmailModelCost, ModelUsage } from './provider';

const USERS_PATH = '/v1/organizations/analytics/users';
```

Add a URL builder beside `buildUrl` (note the different param names and that `page` is the only cursor param this endpoint honours):

```typescript
/**
 * The /users endpoint takes DATES (starting_date/ending_date), not the
 * starting_at/ending_at timestamps the cost endpoint uses. Its cursor param is
 * `page`; passing the token as `next_page`/`cursor` is silently ignored and
 * re-serves page 1, which would spin until MAX_PAGES.
 */
function buildUsersUrl(periodStart: string, periodEnd: string, cursor: string | null, limit: number): string {
  const url = new URL(`${ANTHROPIC_BASE}${USERS_PATH}`);
  url.searchParams.set('starting_date', periodStart);
  url.searchParams.set('ending_date', periodEnd);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('page', cursor);
  return url.toString();
}
```

Then inside `createAnthropicCcSpendProvider()`, before the `return`, add both methods:

```typescript
  async function pullSkillsByPeriod(
    periodStart: string,
    periodEnd: string,
    log?: (msg: string) => void,
  ): Promise<PerEmailSkills[]> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    // A date range returns one aggregated row per user (keyset-paginated by
    // email), so this Map is defensive rather than load-bearing.
    const byEmail = new Map<string, PerEmailSkills>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = buildUsersUrl(periodStart, periodEnd, cursor, 1000);
      const page = await fetchPage(apiKey, url, log) as { data?: any[]; next_page?: string | null };
      for (const row of page.data ?? []) {
        const rawEmail = row?.user?.email_address;
        if (!rawEmail) continue;
        const email = String(rawEmail).trim().toLowerCase();
        const products = extractSkillsEntries(row);
        if (products.length === 0) continue;
        const existing = byEmail.get(email);
        if (existing) existing.products.push(...products);
        else byEmail.set(email, { email, products });
      }
      cursor = page.next_page ?? null;
      if (++pages >= MAX_PAGES) {
        throw new Error(`Anthropic analytics pagination exceeded ${MAX_PAGES} pages — refusing to continue`);
      }
    } while (cursor);

    return [...byEmail.values()];
  }

  async function pullModelCostByPeriod(
    periodStart: string,
    periodEnd: string,
    log?: (msg: string) => void,
  ): Promise<PerEmailModelCost[]> {
    const apiKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
    if (!apiKey) throw new AnthropicAnalyticsKeyMissingError();

    const byEmail = new Map<string, Map<string, ModelUsage>>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      // The `[]` is required: group_by=model (no brackets) is silently ignored
      // and every row comes back with model: null.
      const url = `${buildUrl(periodStart, periodEnd, cursor, 1000)}&group_by%5B%5D=model`;
      const page = await fetchPage(apiKey, url, log) as { data?: any[]; next_page?: string | null };
      for (const row of page.data ?? []) {
        if (row?.actor?.type !== 'user_actor') continue;
        if (row?.actor?.deleted === true) continue;
        const rawEmail = row?.actor?.email;
        const model = row?.model;
        if (!rawEmail || !model) continue;
        const email = String(rawEmail).trim().toLowerCase();

        const amountNum = typeof row.amount === 'string' ? parseFloat(row.amount) : NaN;
        const costCents = Number.isFinite(amountNum) ? Math.round(amountNum) : 0;
        const requests = Number(row.requests) || 0;

        let models = byEmail.get(email);
        if (!models) { models = new Map<string, ModelUsage>(); byEmail.set(email, models); }
        const entry = models.get(String(model)) ?? { model: String(model), costCents: 0, requests: 0 };
        entry.costCents += costCents;
        entry.requests += requests;
        models.set(entry.model, entry);
      }
      cursor = page.next_page ?? null;
      if (++pages >= MAX_PAGES) {
        throw new Error(`Anthropic analytics pagination exceeded ${MAX_PAGES} pages — refusing to continue`);
      }
    } while (cursor);

    return [...byEmail.entries()].map(([email, models]) => ({ email, models: [...models.values()] }));
  }
```

and change the final line to:

```typescript
  return { pullByPeriod, probe, pullSkillsByPeriod, pullModelCostByPeriod };
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPatterns="cc-breakdown-provider|cc-spend-anthropic-provider"`
Expected: PASS — the 3 new tests plus the existing provider suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cc-spend/provider.ts src/lib/cc-spend/anthropic-provider.ts src/lib/__tests__/unit/cc-breakdown-provider.test.ts
git commit -m "feat(cc): pull skills usage and per-model cost from the Analytics API (GLOOK-30)"
```

---

### Task 4: Extract the shared email→login resolver

**Files:**
- Create: `src/lib/cc-spend/identity.ts`
- Modify: `src/lib/cc-spend/apply.ts:54-75` (replace the inlined map build)
- Test: `src/lib/__tests__/unit/cc-identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export async function buildEmailToLoginMap(tx: { execute: Function }, reportId: string, org: string): Promise<Map<string, string>>` — keys are lowercased emails.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-identity.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import { buildEmailToLoginMap } from '@/lib/cc-spend/identity';

it('prefers commit_analyses over user_mappings and lowercases keys', async () => {
  const tx = {
    execute: jest.fn()
      .mockResolvedValueOnce([[{ email: 'alice@x.com', github_login: 'alice' }], null])
      .mockResolvedValueOnce([[
        { email: 'alice@x.com', github_login: 'alice-jira' }, // must NOT override
        { email: 'bob@x.com', github_login: 'bob' },
      ], null]),
  };

  const map = await buildEmailToLoginMap(tx as any, 'r1', 'acme');

  expect(map.get('alice@x.com')).toBe('alice');
  expect(map.get('bob@x.com')).toBe('bob');
  expect(map.size).toBe(2);
  expect(tx.execute.mock.calls[0][0]).toMatch(/FROM commit_analyses/);
  expect(tx.execute.mock.calls[0][1]).toEqual(['r1']);
  expect(tx.execute.mock.calls[1][0]).toMatch(/FROM user_mappings/);
  expect(tx.execute.mock.calls[1][1]).toEqual(['acme']);
});

it('skips rows with a missing email or login', async () => {
  const tx = {
    execute: jest.fn()
      .mockResolvedValueOnce([[{ email: '', github_login: 'x' }, { email: 'y@x.com', github_login: null }], null])
      .mockResolvedValueOnce([[], null]),
  };
  const map = await buildEmailToLoginMap(tx as any, 'r1', 'acme');
  expect(map.size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-identity"`
Expected: FAIL — cannot resolve `@/lib/cc-spend/identity`.

- [ ] **Step 3: Create the shared resolver**

Create `src/lib/cc-spend/identity.ts`:

```typescript
/**
 * Single source of truth for Anthropic email → github_login resolution, shared
 * by the cost, skills and model applies so the three cannot drift apart.
 *
 * commit_analyses is primary (authoritative for this report's window);
 * user_mappings is the fallback and never overrides a commit-derived mapping.
 * Takes a `tx` so callers can run it inside their own transaction.
 */
export async function buildEmailToLoginMap(
  tx: { execute: (sql: string, params?: any[]) => Promise<any> },
  reportId: string,
  org: string,
): Promise<Map<string, string>> {
  const emailToLogin = new Map<string, string>();

  const [commitEmails] = await tx.execute(
    `SELECT DISTINCT LOWER(author_email) AS email, github_login
     FROM commit_analyses
     WHERE report_id = ? AND author_email IS NOT NULL AND author_email <> ''`,
    [reportId],
  ) as [any[], any];
  for (const r of commitEmails) {
    if (r.email && r.github_login) emailToLogin.set(r.email, r.github_login);
  }

  const [jiraMappings] = await tx.execute(
    `SELECT LOWER(jira_email) AS email, github_login
     FROM user_mappings
     WHERE org = ? AND jira_email IS NOT NULL AND jira_email <> ''`,
    [org],
  ) as [any[], any];
  for (const r of jiraMappings) {
    if (r.email && r.github_login && !emailToLogin.has(r.email)) {
      emailToLogin.set(r.email, r.github_login);
    }
  }

  return emailToLogin;
}
```

- [ ] **Step 4: Use it from apply.ts**

In `src/lib/cc-spend/apply.ts`, add the import:

```typescript
import { buildEmailToLoginMap } from './identity';
```

and replace lines 54-75 (the comment plus both queries and both loops) with:

```typescript
    // Build email → github_login map (commit_analyses primary, user_mappings fallback).
    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);
```

- [ ] **Step 5: Run tests to verify the refactor is behaviour-preserving**

Run: `npm test -- --testPathPatterns="cc-identity|cc-spend-apply|cc-spend-end-to-end"`
Expected: PASS — 2 new tests plus the existing apply and end-to-end suites unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cc-spend/identity.ts src/lib/cc-spend/apply.ts src/lib/__tests__/unit/cc-identity.test.ts
git commit -m "refactor(cc): extract shared email→login resolver for all cc applies (GLOOK-30)"
```

---

### Task 5: Apply skills and model usage

**Files:**
- Create: `src/lib/cc-spend/apply-breakdowns.ts`
- Test: `src/lib/__tests__/unit/cc-apply-breakdowns.test.ts`

**Interfaces:**
- Consumes: `buildEmailToLoginMap` (Task 4); `PerEmailSkills`, `PerEmailModelCost` (Task 3); tables from Task 1.
- Produces:
  ```typescript
  export interface BreakdownApplyResult { matched: number; unmappedEmail: number; rows: number }
  export function applySkillsUsage(input: { reportId: string; org: string; skills: PerEmailSkills[] }): Promise<BreakdownApplyResult>
  export function applyModelUsage(input: { reportId: string; org: string; models: PerEmailModelCost[] }): Promise<BreakdownApplyResult>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-apply-breakdowns.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let applySkillsUsage: any;
let applyModelUsage: any;
let db: any;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-bd-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ applySkillsUsage, applyModelUsage } = await import('@/lib/cc-spend/apply-breakdowns'));

  await db.execute(`INSERT INTO reports (id, org, period_days, status) VALUES ('r1', 'acme', 14, 'completed')`);
  await db.execute(
    `INSERT INTO developer_stats (report_id, github_login, github_name) VALUES ('r1', 'alice', 'Alice')`,
  );
  await db.execute(
    `INSERT INTO commit_analyses (report_id, commit_sha, repo, github_login, author_email, commit_message)
     VALUES ('r1', 'sha1', 'repo', 'alice', 'alice@x.com', 'msg')`,
  );
});
afterAll(() => { try { fs.unlinkSync(dbPath); } catch {} });

it('writes one row per product and sets the cc_skills_used rollup', async () => {
  const res = await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [
      { email: 'alice@x.com', products: [
        { product: 'cowork', used: 12, distinct: 4 },
        { product: 'chat',   used: 0,  distinct: 5 },
      ] },
      { email: 'nobody@x.com', products: [{ product: 'cowork', used: 1, distinct: 1 }] },
    ],
  });

  expect(res).toEqual({ matched: 1, unmappedEmail: 1, rows: 2 });

  const [rows] = await db.execute(
    `SELECT product, skills_used, skills_distinct FROM cc_skills_usage WHERE report_id = 'r1' ORDER BY product`,
  ) as [any[], any];
  expect(rows).toEqual([
    { product: 'chat',   skills_used: 0,  skills_distinct: 5 },
    { product: 'cowork', skills_used: 12, skills_distinct: 4 },
  ]);

  // Rollup = Σ used only. chat contributes 0 because it reports no total.
  const [devs] = await db.execute(
    `SELECT cc_skills_used FROM developer_stats WHERE report_id = 'r1' AND github_login = 'alice'`,
  ) as [any[], any];
  expect(Number(devs[0].cc_skills_used)).toBe(12);
});

it('replaces prior rows instead of accumulating on re-run', async () => {
  await applySkillsUsage({
    reportId: 'r1', org: 'acme',
    skills: [{ email: 'alice@x.com', products: [{ product: 'science', used: 3, distinct: 1 }] }],
  });
  const [rows] = await db.execute(`SELECT product FROM cc_skills_usage WHERE report_id = 'r1'`) as [any[], any];
  expect(rows.map((r: any) => r.product)).toEqual(['science']);

  const [devs] = await db.execute(
    `SELECT cc_skills_used FROM developer_stats WHERE report_id = 'r1' AND github_login = 'alice'`,
  ) as [any[], any];
  expect(Number(devs[0].cc_skills_used)).toBe(3);
});

it('writes one row per model', async () => {
  const res = await applyModelUsage({
    reportId: 'r1', org: 'acme',
    models: [{ email: 'alice@x.com', models: [
      { model: 'claude-opus-4-8', costCents: 1500, requests: 10 },
      { model: 'claude-sonnet-5', costCents: 500,  requests: 20 },
    ] }],
  });

  expect(res).toEqual({ matched: 1, unmappedEmail: 0, rows: 2 });

  const [rows] = await db.execute(
    `SELECT model, cost, requests FROM cc_model_usage WHERE report_id = 'r1' ORDER BY model`,
  ) as [any[], any];
  expect(rows.map((r: any) => ({ model: r.model, cost: Number(r.cost), requests: Number(r.requests) }))).toEqual([
    { model: 'claude-opus-4-8', cost: 1500, requests: 10 },
    { model: 'claude-sonnet-5', cost: 500,  requests: 20 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-apply-breakdowns"`
Expected: FAIL — cannot resolve `@/lib/cc-spend/apply-breakdowns`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cc-spend/apply-breakdowns.ts`:

```typescript
import db from '@/lib/db';
import { buildEmailToLoginMap } from './identity';
import type { PerEmailSkills, PerEmailModelCost } from './provider';

export interface BreakdownApplyResult {
  /** Emails resolved to a github_login. */
  matched: number;
  /** No email→github_login mapping found. */
  unmappedEmail: number;
  /** Breakdown rows written. */
  rows: number;
}

/**
 * Both applies delete this report's rows before writing, so a partial pull
 * cannot leave stale values behind, and each runs in its own transaction so a
 * failure here can never roll back a good cost apply.
 */
export async function applySkillsUsage(input: {
  reportId: string; org: string; skills: PerEmailSkills[];
}): Promise<BreakdownApplyResult> {
  const { reportId, org, skills } = input;

  return await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cc_skills_usage WHERE report_id = ?`, [reportId]);
    await tx.execute(`UPDATE developer_stats SET cc_skills_used = 0 WHERE report_id = ?`, [reportId]);

    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);

    let matched = 0;
    let unmappedEmail = 0;
    let rows = 0;
    for (const entry of skills) {
      const login = emailToLogin.get(entry.email.trim().toLowerCase());
      if (!login) { unmappedEmail++; continue; }
      matched++;

      let usedTotal = 0;
      for (const p of entry.products) {
        await tx.execute(
          `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, login, p.product, p.used, p.distinct],
        );
        rows++;
        usedTotal += p.used;
      }

      // Rollup is Σ skills_used only; chat reports no total so it adds nothing.
      await tx.execute(
        `UPDATE developer_stats SET cc_skills_used = ? WHERE report_id = ? AND github_login = ?`,
        [usedTotal, reportId, login],
      );
    }

    return { matched, unmappedEmail, rows };
  });
}

export async function applyModelUsage(input: {
  reportId: string; org: string; models: PerEmailModelCost[];
}): Promise<BreakdownApplyResult> {
  const { reportId, org, models } = input;

  return await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cc_model_usage WHERE report_id = ?`, [reportId]);

    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);

    let matched = 0;
    let unmappedEmail = 0;
    let rows = 0;
    for (const entry of models) {
      const login = emailToLogin.get(entry.email.trim().toLowerCase());
      if (!login) { unmappedEmail++; continue; }
      matched++;
      for (const m of entry.models) {
        await tx.execute(
          `INSERT INTO cc_model_usage (report_id, github_login, model, cost, requests)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, login, m.model, m.costCents, m.requests],
        );
        rows++;
      }
    }

    return { matched, unmappedEmail, rows };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="cc-apply-breakdowns"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cc-spend/apply-breakdowns.ts src/lib/__tests__/unit/cc-apply-breakdowns.test.ts
git commit -m "feat(cc): apply skills and model breakdowns per report (GLOOK-30)"
```

---

### Task 6: Service orchestration — two extra pulls, clamped and non-fatal

**Files:**
- Modify: `src/lib/cc-spend/service.ts`
- Test: `src/lib/__tests__/unit/cc-breakdown-service.test.ts`

**Interfaces:**
- Consumes: `pullSkillsByPeriod`, `pullModelCostByPeriod` (Task 3); `applySkillsUsage`, `applyModelUsage`, `BreakdownApplyResult` (Task 5).
- Produces: `refreshCcSpendForReport` returns `CcApplyResult & { skills?: BreakdownApplyResult; models?: BreakdownApplyResult }` (additive — existing consumers are unaffected).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-breakdown-service.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/cc-spend/apply', () => ({
  applyCcSpend: jest.fn(async () => ({
    matched: 1, unmappedEmail: 0, noDevStatsRow: 0, totalApiUsers: 1,
    totalSpendUsd: 1, periodStart: '2026-07-01', periodEnd: '2026-07-15',
  })),
  ReportNotFoundError: class ReportNotFoundError extends Error {},
}));
jest.mock('@/lib/cc-spend/apply-breakdowns', () => ({
  applySkillsUsage: jest.fn(async () => ({ matched: 1, unmappedEmail: 0, rows: 2 })),
  applyModelUsage: jest.fn(async () => ({ matched: 1, unmappedEmail: 0, rows: 3 })),
}));

const pullByPeriod = jest.fn(async () => []);
const pullSkillsByPeriod = jest.fn(async () => []);
const pullModelCostByPeriod = jest.fn(async () => []);
jest.mock('@/lib/cc-spend/provider', () => ({
  getCcSpendProvider: () => ({ pullByPeriod, pullSkillsByPeriod, pullModelCostByPeriod, probe: jest.fn() }),
}));

import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import db from '@/lib/db';
import { applySkillsUsage, applyModelUsage } from '@/lib/cc-spend/apply-breakdowns';

const mockExecute = db.execute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // created_at far in the past so the clamp is not what limits the window.
  mockExecute.mockResolvedValue([[{ id: 'r1', org: 'acme', created_at: '2026-07-15T00:00:00Z', period_days: 14 }], null]);
});

it('pulls all three dimensions and returns the breakdown results', async () => {
  const res: any = await refreshCcSpendForReport('r1');
  expect(pullByPeriod).toHaveBeenCalled();
  expect(pullSkillsByPeriod).toHaveBeenCalled();
  expect(pullModelCostByPeriod).toHaveBeenCalled();
  expect(res.skills).toEqual({ matched: 1, unmappedEmail: 0, rows: 2 });
  expect(res.models).toEqual({ matched: 1, unmappedEmail: 0, rows: 3 });
});

it('clamps the skills end date to today-2 for the data lag', async () => {
  const today = new Date();
  const recent = today.toISOString().slice(0, 10);
  mockExecute.mockResolvedValue([[{ id: 'r1', org: 'acme', created_at: `${recent}T00:00:00Z`, period_days: 14 }], null]);

  await refreshCcSpendForReport('r1');

  const skillsEnd = pullSkillsByPeriod.mock.calls[0][1] as unknown as string;
  const expected = new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10);
  expect(skillsEnd).toBe(expected);
  // The cost pull is unaffected by the lag clamp.
  expect(pullByPeriod.mock.calls[0][1]).toBe(recent);
});

it('a skills failure does not fail the refresh or block the model pull', async () => {
  pullSkillsByPeriod.mockRejectedValueOnce(new Error('Anthropic Analytics API 400'));
  const res: any = await refreshCcSpendForReport('r1');
  expect(res.matched).toBe(1);          // cost result preserved
  expect(res.skills).toBeUndefined();
  expect(applySkillsUsage).not.toHaveBeenCalled();
  expect(applyModelUsage).toHaveBeenCalled();
});

it('a model failure does not fail the refresh', async () => {
  pullModelCostByPeriod.mockRejectedValueOnce(new Error('boom'));
  const res: any = await refreshCcSpendForReport('r1');
  expect(res.matched).toBe(1);
  expect(res.models).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-breakdown-service"`
Expected: FAIL — `pullSkillsByPeriod` is never called.

- [ ] **Step 3: Add the two pulls to the service**

In `src/lib/cc-spend/service.ts`, extend the imports:

```typescript
import { applySkillsUsage, applyModelUsage } from './apply-breakdowns';
import type { BreakdownApplyResult } from './apply-breakdowns';

export type CcRefreshResult = CcApplyResult & {
  skills?: BreakdownApplyResult;
  models?: BreakdownApplyResult;
};

/** The /users endpoint trails real time by ~2 days and 400s on a too-recent end date. */
const SKILLS_LAG_DAYS = 2;
```

Change the signature to `Promise<CcRefreshResult>`, then replace the final `return applyCcSpend({...})` with:

```typescript
  const costResult = await applyCcSpend({
    reportId,
    org: String(rows[0].org),
    aggregates,
    periodStart: startStr,
    periodEnd: endStr,
  });

  const org = String(rows[0].org);
  const result: CcRefreshResult = { ...costResult };

  // Skills: clamp the end date back to the API's latest available data. Each
  // extra dimension is independently non-fatal — a failure here must not discard
  // the cost result that already succeeded.
  const lagCutoff = new Date(Date.now() - SKILLS_LAG_DAYS * 86400_000).toISOString().slice(0, 10);
  const skillsEnd = endStr < lagCutoff ? endStr : lagCutoff;
  try {
    if (skillsEnd < startStr) {
      log?.(`CC skills: window ${startStr}..${skillsEnd} is empty after the ${SKILLS_LAG_DAYS}-day data lag; skipping`);
    } else {
      const skills = await provider.pullSkillsByPeriod(startStr, skillsEnd, log);
      result.skills = await applySkillsUsage({ reportId, org, skills });
      log?.(`CC skills: ${result.skills.matched} matched, ${result.skills.rows} rows (${startStr} → ${skillsEnd}) [${result.skills.unmappedEmail} unmapped]`);
    }
  } catch (err) {
    log?.(`CC skills: SKIP (${err instanceof Error ? err.message : String(err)})`);
  }

  try {
    const models = await provider.pullModelCostByPeriod(startStr, endStr, log);
    result.models = await applyModelUsage({ reportId, org, models });
    log?.(`CC models: ${result.models.matched} matched, ${result.models.rows} rows [${result.models.unmappedEmail} unmapped]`);
  } catch (err) {
    log?.(`CC models: SKIP (${err instanceof Error ? err.message : String(err)})`);
  }

  return result;
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="cc-breakdown-service|cc-spend-service"`
Expected: PASS — 4 new tests plus the existing service suite unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cc-spend/service.ts src/lib/__tests__/unit/cc-breakdown-service.test.ts
git commit -m "feat(cc): pull skills + model breakdowns in refreshCcSpendForReport (GLOOK-30)"
```

---

### Task 7: Mock provider and seed fixtures

**Files:**
- Modify: `src/lib/cc-spend/mock-provider.ts`
- Modify: `scripts/seed-data.ts:92-129`
- Test: `src/lib/__tests__/unit/cc-breakdown-mock.test.ts`

**Interfaces:**
- Consumes: `PerEmailSkills`, `PerEmailModelCost` (Task 3); tables (Task 1).
- Produces: `seedCcSkillsUsage` and `seedCcModelUsage` exported arrays from `scripts/seed-data.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-breakdown-mock.test.ts`:

```typescript
import { createMockCcSpendProvider } from '@/lib/cc-spend/mock-provider';
import { seedCcSkillsUsage, seedCcModelUsage } from '../../../../scripts/seed-data';

it('mock provider returns deterministic skills usage per email', async () => {
  const p = createMockCcSpendProvider();
  const a = await p.pullSkillsByPeriod('2026-07-01', '2026-07-14');
  const b = await p.pullSkillsByPeriod('2026-07-01', '2026-07-14');
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(0);
  expect(a[0].products.length).toBeGreaterThan(0);
  for (const e of a) {
    for (const prod of e.products) {
      expect(prod.used + prod.distinct).toBeGreaterThan(0);
    }
  }
});

it('mock provider returns deterministic model usage per email', async () => {
  const p = createMockCcSpendProvider();
  const a = await p.pullModelCostByPeriod('2026-07-01', '2026-07-14');
  expect(a).toEqual(await p.pullModelCostByPeriod('2026-07-01', '2026-07-14'));
  expect(a[0].models.map(m => m.model)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
});

it('seed data covers both breakdown tables', () => {
  expect(seedCcSkillsUsage.length).toBeGreaterThan(0);
  expect(seedCcModelUsage.length).toBeGreaterThan(0);
  for (const r of seedCcSkillsUsage) {
    expect(r).toHaveProperty('report_id');
    expect(r).toHaveProperty('github_login');
    expect(r).toHaveProperty('product');
  }
  for (const r of seedCcModelUsage) {
    expect(r).toHaveProperty('model');
    expect(r).toHaveProperty('cost');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-breakdown-mock"`
Expected: FAIL — `pullSkillsByPeriod is not a function`.

- [ ] **Step 3: Extend the mock provider**

In `src/lib/cc-spend/mock-provider.ts`, add the imports and generators, reusing the existing `hashEmail`:

```typescript
import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult, PerEmailSkills, PerEmailModelCost } from './provider';

const MOCK_PRODUCTS = ['cowork', 'chat', 'office.excel', 'science'] as const;
const MOCK_MODELS = ['claude-opus-4-8', 'claude-sonnet-5'] as const;

function skillsFor(email: string): PerEmailSkills {
  const h = hashEmail(email);
  const products = MOCK_PRODUCTS
    .map((product, i) => {
      const used = (h >>> (i * 3)) % 25;          // 0–24
      const distinct = used === 0 ? 0 : 1 + (used % 5);
      // chat reports no total, mirroring the real API.
      return product === 'chat'
        ? { product, used: 0, distinct: used === 0 ? 0 : 1 + (used % 4) }
        : { product, used, distinct };
    })
    .filter(p => p.used > 0 || p.distinct > 0);
  return { email, products };
}

function modelsFor(email: string): PerEmailModelCost {
  const h = hashEmail(email);
  return {
    email,
    models: MOCK_MODELS.map((model, i) => ({
      model,
      costCents: 5000 + ((h >>> (i * 5)) % 60000),
      requests: 50 + ((h >>> (i * 7)) % 900),
    })),
  };
}
```

and add both methods plus include them in the returned object:

```typescript
  async function pullSkillsByPeriod(): Promise<PerEmailSkills[]> {
    return MOCK_DEVELOPERS.filter(d => d.jiraEmail).map(d => skillsFor(d.jiraEmail));
  }

  async function pullModelCostByPeriod(): Promise<PerEmailModelCost[]> {
    return MOCK_DEVELOPERS.filter(d => d.jiraEmail).map(d => modelsFor(d.jiraEmail));
  }

  return { pullByPeriod, probe, pullSkillsByPeriod, pullModelCostByPeriod };
```

- [ ] **Step 4: Add seed rows**

In `scripts/seed-data.ts`, after the `seedDeveloperStats` loop (~line 129), add:

```typescript
// GLOOK-30: per-developer skills + model breakdowns, deterministic from the login
// hash so seeded reports exercise both tables and the cc_skills_used rollup.
const SEED_PRODUCTS = ['cowork', 'chat', 'office.excel', 'science'];
const SEED_MODELS = ['claude-opus-4-8', 'claude-sonnet-5'];

export const seedCcSkillsUsage: Record<string, any>[] = [];
export const seedCcModelUsage: Record<string, any>[] = [];
for (const rid of completedReportIds) {
  for (const dev of MOCK_DEVELOPERS) {
    const cc = ccSpendForLogin(dev.githubLogin);
    SEED_PRODUCTS.forEach((product, i) => {
      const used = product === 'chat' ? 0 : (cc.requests >> (i * 2)) % 20;
      const distinct = 1 + ((cc.requests >> i) % 5);
      if (used === 0 && product !== 'chat') return;
      seedCcSkillsUsage.push({
        report_id: rid, github_login: dev.githubLogin, product,
        skills_used: used, skills_distinct: distinct,
      });
    });
    SEED_MODELS.forEach((model, i) => {
      seedCcModelUsage.push({
        report_id: rid, github_login: dev.githubLogin, model,
        cost: Math.round(cc.costCents / (i + 2)),
        requests: Math.round(cc.requests / (i + 2)),
      });
    });
  }
}
```

Then wire both into the insert routine in `scripts/seed.ts` alongside the existing `seedDeveloperStats` insert, and set `cc_skills_used` on each `seedDeveloperStats` row by adding this field inside the existing object literal (~line 126):

```typescript
      cc_skills_used: SEED_PRODUCTS.reduce((s, product, i) => s + (product === 'chat' ? 0 : (cc.requests >> (i * 2)) % 20), 0),
```

Note: `SEED_PRODUCTS` must therefore be declared **above** the `seedDeveloperStats` loop. Move the two `SEED_*` consts above it.

- [ ] **Step 5: Run tests and the seed**

Run: `npm test -- --testPathPatterns="cc-breakdown-mock"`
Expected: PASS (3 tests).

Run: `npm run seed:reset`
Expected: completes, and the summary lists non-zero `cc_skills_usage` and `cc_model_usage` row counts.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cc-spend/mock-provider.ts scripts/seed-data.ts scripts/seed.ts src/lib/__tests__/unit/cc-breakdown-mock.test.ts
git commit -m "feat(cc): mock + seed fixtures for skills and model breakdowns (GLOOK-30)"
```

---

### Task 8: Expose breakdowns on the dev report, gate per-model cost

**Files:**
- Modify: `src/lib/report/dev.ts:150-157` (add two queries + return fields)
- Modify: `src/app/api/report/[id]/dev/[login]/route.ts`
- Test: `src/lib/__tests__/unit/cc-breakdown-dev-route.test.ts`

**Interfaces:**
- Consumes: tables (Task 1); `stripCostFields`, `resolveRequester`, `buildCostVisibility`, `costCacheHeaders` from `src/lib/cost-visibility.ts`.
- Produces: `getDevReport()` additionally returns `skills: Array<{ product: string; skills_used: number; skills_distinct: number }>` and `models: Array<{ model: string; cost: number; requests: number }>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cc-breakdown-dev-route.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/dev', () => ({
  getDevReport: jest.fn(),
  DeveloperNotFoundError: class DeveloperNotFoundError extends Error {},
}));
jest.mock('@/lib/report/service', () => ({ ReportNotFoundError: class ReportNotFoundError extends Error {} }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({ githubLogin: 'bob', isAdmin: false, authDisabled: false })),
  buildCostVisibility: jest.fn(),
  stripCostFields: jest.requireActual('@/lib/cost-visibility').stripCostFields,
  costCacheHeaders: jest.requireActual('@/lib/cost-visibility').costCacheHeaders,
}));

import { GET } from '@/app/api/report/[id]/dev/[login]/route';
import { getDevReport } from '@/lib/report/dev';
import { buildCostVisibility } from '@/lib/cost-visibility';

const params = { params: Promise.resolve({ id: 'r1', login: 'alice' }) };
const req = () => new Request('http://localhost/api/report/r1/dev/alice');

beforeEach(() => {
  jest.clearAllMocks();
  (getDevReport as jest.Mock).mockResolvedValue({
    report: { id: 'r1', org: 'acme' },
    developer: { github_login: 'alice', cc_total_cost: 100, cc_requests: 5, cc_skills_used: 12 },
    allDevelopers: [],
    commits: [], timeline: [], unmergedWork: { openPrs: [], branchCommits: [] },
    skills: [{ product: 'cowork', skills_used: 12, skills_distinct: 4 }],
    models: [{ model: 'claude-sonnet-5', cost: 500, requests: 20 }],
  });
});

it('strips per-model cost but keeps model + requests when cost is not visible', async () => {
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => false, canSeeAnyCost: false });

  const body = await (await GET(req() as any, params as any)).json();

  expect(body.models).toEqual([{ model: 'claude-sonnet-5', requests: 20 }]);
  expect(body.models[0]).not.toHaveProperty('cost');
  // Skills are ungated telemetry.
  expect(body.skills).toEqual([{ product: 'cowork', skills_used: 12, skills_distinct: 4 }]);
  expect(body.developer.cc_skills_used).toBe(12);
  expect(body.developer).not.toHaveProperty('cc_total_cost');
});

it('keeps per-model cost when cost is visible', async () => {
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => true, canSeeAnyCost: true });

  const body = await (await GET(req() as any, params as any)).json();

  expect(body.models).toEqual([{ model: 'claude-sonnet-5', cost: 500, requests: 20 }]);
  expect(body.developer.cc_total_cost).toBe(100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="cc-breakdown-dev-route"`
Expected: FAIL — `body.models` still contains `cost`.

- [ ] **Step 3: Return breakdowns from getDevReport**

In `src/lib/report/dev.ts`, immediately before the final `return` (line 150), add:

```typescript
  const [skillsRows] = await db.execute(
    `SELECT product, skills_used, skills_distinct
     FROM cc_skills_usage WHERE report_id = ? AND github_login = ?
     ORDER BY skills_used DESC, product`,
    [reportId, login],
  ) as [any[], any];

  const [modelRows] = await db.execute(
    `SELECT model, cost, requests
     FROM cc_model_usage WHERE report_id = ? AND github_login = ?
     ORDER BY cost DESC, model`,
    [reportId, login],
  ) as [any[], any];
```

and extend the returned object with:

```typescript
    skills: skillsRows.map((r: any) => ({
      product: String(r.product),
      skills_used: Number(r.skills_used) || 0,
      skills_distinct: Number(r.skills_distinct) || 0,
    })),
    models: modelRows.map((r: any) => ({
      model: String(r.model),
      cost: Number(r.cost) || 0,
      requests: Number(r.requests) || 0,
    })),
```

- [ ] **Step 4: Gate per-model cost in the route**

In `src/app/api/report/[id]/dev/[login]/route.ts`, after the existing `allDevelopers` strip line, add:

```typescript
    // Model identity and request counts are ungated telemetry; per-model cost is
    // money, so it follows the same team-scoped rule as cc_total_cost (GLOOK-30).
    if (!canSeeCost(result.developer.github_login)) {
      result.models = (result.models ?? []).map(({ cost, ...rest }: any) => rest);
    }
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPatterns="cc-breakdown-dev-route|report-cost-gating"`
Expected: PASS — 2 new tests plus the existing gating suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add "src/lib/report/dev.ts" "src/app/api/report/[id]/dev/[login]/route.ts" src/lib/__tests__/unit/cc-breakdown-dev-route.test.ts
git commit -m "feat(cc): expose skills + model breakdowns on the dev report, gate per-model cost (GLOOK-30)"
```

---

### Task 9: Profile self-view (GLOOK-29)

**Files:**
- Modify: `src/app/profile/profile-content.tsx`
- Test: `src/lib/__tests__/unit/profile-self-view.test.ts`

**Interfaces:**
- Consumes: `/api/auth/me` (`user.githubLogin`), `/api/report`, `/api/report/[id]/dev/[login]` with the fields added in Task 8.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/profile-self-view.test.ts`:

```typescript
/**
 * The self-view must only ever request the requester's OWN login — that, plus
 * the dev route's existing gate, is what makes "never sees another developer's
 * data through this path" true by construction.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'src/app/profile/profile-content.tsx'), 'utf8',
);

it('builds the dev-report URL from the authenticated login only', () => {
  expect(src).toMatch(/\/api\/report\/\$\{[^}]*\}\/dev\/\$\{[^}]*githubLogin[^}]*\}/);
  // No hardcoded or query-supplied login may reach that URL.
  expect(src).not.toMatch(/\/dev\/\$\{\s*(login|params|searchParams)/);
});

it('renders own cost, skills and models', () => {
  expect(src).toContain('cc_total_cost');
  expect(src).toContain('skills');
  expect(src).toContain('models');
});

it('handles the unmapped-developer case', () => {
  expect(src).toMatch(/githubLogin/);
  expect(src).toMatch(/No Claude Code usage|not mapped|No usage/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="profile-self-view"`
Expected: FAIL — the file contains none of these strings.

- [ ] **Step 3: Add the self-view**

In `src/app/profile/profile-content.tsx`, add the imports and fetching logic at the top of the component:

```typescript
import { useEffect, useState } from 'react';

interface SelfUsage {
  cc_total_cost?: number;
  cc_requests?: number;
  cc_skills_used?: number;
  skills: Array<{ product: string; skills_used: number; skills_distinct: number }>;
  models: Array<{ model: string; cost?: number; requests: number }>;
}
```

Inside the component, after `const auth = useAuth();`:

```typescript
  const [usage, setUsage] = useState<SelfUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  const login = auth.user?.githubLogin ?? null;
  useEffect(() => {
    if (!login) { setUsageLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const reports = await (await fetch('/api/report')).json();
        const latest = (Array.isArray(reports) ? reports : []).find((r: any) => r.status === 'completed');
        if (!latest) return;
        // Own login only — never a value from the URL or another developer.
        const res = await fetch(`/api/report/${latest.id}/dev/${encodeURIComponent(login)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setUsage({
          cc_total_cost: data.developer?.cc_total_cost,
          cc_requests: data.developer?.cc_requests,
          cc_skills_used: data.developer?.cc_skills_used,
          skills: data.skills ?? [],
          models: data.models ?? [],
        });
      } catch { /* leave usage null — rendered as "no usage" below */ }
      finally { if (!cancelled) setUsageLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [login]);
```

Then, inside the returned card after the existing identity `</div>` block (before the closing `<p className="text-xs text-gray-600 mt-8">`), add:

```tsx
        <div className="border-t border-gray-800 pt-6 mt-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Your Claude Code usage</p>

          {usageLoading && <div className="animate-pulse bg-gray-800 rounded h-16" />}

          {!usageLoading && !usage && (
            <p className="text-sm text-gray-500">
              No Claude Code usage found for your account in the latest report.
            </p>
          )}

          {!usageLoading && usage && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Spend</p>
                  <p className="text-lg font-bold text-green-400">
                    {usage.cc_total_cost != null ? `$${(Number(usage.cc_total_cost) / 100).toFixed(2)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Requests</p>
                  <p className="text-lg font-bold text-gray-200">{usage.cc_requests ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Skills invoked</p>
                  <p className="text-lg font-bold text-gray-200">{usage.cc_skills_used ?? 0}</p>
                </div>
              </div>

              {usage.skills.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Skills by product</p>
                  {usage.skills.map(s => (
                    <div key={s.product} className="flex items-center justify-between text-sm py-0.5">
                      <span className="text-gray-400">{s.product}</span>
                      <span className="text-gray-300 tabular-nums">
                        {s.skills_used} used · {s.skills_distinct} distinct
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {usage.models.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Models</p>
                  {usage.models.map(m => (
                    <div key={m.model} className="flex items-center justify-between text-sm py-0.5">
                      <span className="text-gray-400">{m.model}</span>
                      <span className="text-gray-300 tabular-nums">
                        {m.cost != null ? `$${(Number(m.cost) / 100).toFixed(2)} · ` : ''}{m.requests} req
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 4: Run tests, type-check, full suite**

Run: `npm test -- --testPathPatterns="profile-self-view"`
Expected: PASS (3 tests).

Run: `npx tsc --noEmit`
Expected: no new errors in tracked files (pre-existing errors in stray `"* 2.ts"` files are unrelated).

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 5: Verify in mock mode**

Run: `npm run seed:reset && npm run dev:mock`
Then open `http://localhost:3000/profile` and confirm the "Your Claude Code usage" block shows spend, requests, skills-by-product and models. Stop the server when done.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/profile-content.tsx src/lib/__tests__/unit/profile-self-view.test.ts
git commit -m "feat(profile): show own cost, skills and model breakdown (GLOOK-29)"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Storage: two long tables + rollup, FK cascade, natural key | 1 |
| Skills parsing as a generic walk, zero-skip, `_metrics` stripping | 2 |
| Provider: two methods reusing key/auth/retry/pagination; date params; `group_by[]` | 3 |
| Shared email→login resolver (single source of truth) | 4 |
| `applySkillsUsage` / `applyModelUsage`, delete-before-write, separate transactions | 5 |
| Orchestration in `refreshCcSpendForReport`, 2-day clamp, non-fatal per dimension | 6 |
| Mock provider + seed fixtures | 7 |
| Expose on dev report; gate per-model cost only | 8 |
| GLOOK-29 self-view on the profile page | 9 |
| No `deleteReport` change (FK cascade) | 1 (cascade test) |
| No new routes; `withRequestLog` untouched | 8 (reuses existing route) |

No spec requirement is unassigned. Tokens and per-skill names are out of scope per the spec and appear in no task.

**Placeholder scan:** none — every step contains runnable code or an exact command.

**Type consistency:** `SkillsProductUsage` (Task 2) is the element type of `PerEmailSkills.products` (Task 3), consumed unchanged by `applySkillsUsage` (Task 5). `BreakdownApplyResult` (Task 5) is what Task 6 surfaces as `result.skills`/`result.models`. `costCents` is the provider-side name; the DB column is `cost` and the mapping happens once, in Task 5's INSERTs. Task 8's `skills`/`models` field names match what Task 9 reads.

**Known ordering constraint:** Task 7 Step 4 requires the `SEED_PRODUCTS` const to be declared above the `seedDeveloperStats` loop, since that loop now references it for the rollup.
