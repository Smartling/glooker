# Skills + model breakdown UI surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show skills usage and model breakdown per engineer on the engineer page, and as an org-level Model Mix panel on the Spend tab.

**Architecture:** The engineer page already receives `skills`, `models` and `developer.cc_skills_used` and drops them, so that half is presentation only. The Spend tab needs two new queries in `org.ts`, per-login cost stripping in the org route via a shared `stripModelCost` helper, and a pure `computeModelMix` that aggregates **client-side** over the rows that survived stripping — so an aggregate can never exceed what the viewer may see.

**Tech Stack:** TypeScript, Next.js 15 App Router (client components), Tailwind, SWR, Jest + ts-jest, `@testing-library/react` + `jest-environment-jsdom` for behavioural tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-skills-model-ui-surfaces-design.md`. Continues on `feat/glook-30-skills-model-ingestion` (one combined PR, by explicit user choice).
- **Visibility:** all skills data and `cc_skills_used` are ungated. `cc_model_usage.model` is ungated. `cc_model_usage.cost` AND `cc_model_usage.requests` are gated by the existing `canSeeCost(devLogin)` — `requests` is gated because summing it across a developer's models reconstructs the gated `cc_requests` exactly.
- After stripping, a developer's model array must be re-sorted by model name so array order cannot leak a relative-cost ranking.
- **Scope coherence:** `computeModelMix` counts only rows whose `cost` is present. Models listed, dev counts, requests and total must all be scoped identically — never org-wide model names beside team-only cost.
- Under partial cost visibility the Model Mix `%` column and share bar are **kept** (a composition share is valid on a well-defined subset, unlike the Pareto/Top-20% concentration stats) and the section is relabelled with an explicit scope.
- All money values are **cents** end to end; divide by 100 exactly once, at render. `formatDollars(cents)` already exists at `src/app/report/[id]/org/page.tsx:952`.
- DECIMAL/REAL come back as strings from both drivers — coerce with `Number()` when mapping rows.
- All API route handlers stay wrapped in `withRequestLog()`.
- Jest flag is `--testPathPatterns` (plural). Behavioural component tests use a `/** @jest-environment jsdom */` docblock and a `.tsx` extension.
- Do not add dependencies. There is no charting library; visuals are hand-rolled divs/SVG.

---

## File Structure

**Modify**
- `src/lib/cost-visibility.ts` — add `stripModelCost`, the single implementation of per-model cost stripping.
- `src/app/api/report/[id]/dev/[login]/route.ts` — replace its inline strip with the helper.
- `src/lib/report/org.ts` — two new queries, `cc_skills_used` column, return `modelUsage` + `skillsUsage`.
- `src/app/api/report/[id]/org/route.ts` — strip per-model cost per login via the helper.
- `src/app/report/[id]/dev/[login]/page.tsx` — export a `ClaudeCodeUsageCard` component, render it where the spend tile was; extend types.
- `src/app/report/[id]/org/page.tsx` — export `computeModelMix`; add the Model Mix section and skills line to `SpendTab`.

**Create (tests)**
- `src/lib/__tests__/unit/strip-model-cost.test.ts`
- `src/lib/__tests__/unit/org-model-usage.test.ts`
- `src/lib/__tests__/unit/org-route-model-gating.test.ts`
- `src/lib/__tests__/unit/dev-usage-card.test.tsx`
- `src/lib/__tests__/unit/compute-model-mix.test.ts`
- `src/lib/__tests__/unit/spend-model-mix.test.tsx`

**Note on component extraction:** this codebase deliberately inlines everything per page (no shared `Card`/`Table` primitives exist). Two small deviations are made for testability only: `ClaudeCodeUsageCard` and `computeModelMix` are exported from their page files so tests can exercise them without mounting a whole page (which would require mocking `useSWR`, `useParams` and `useRouter`). `src/app/profile/profile-content.tsx` has a near-identical inline usage block; unifying the two is a deliberate non-goal here — it would re-open an already-reviewed surface.

---

### Task 1: `stripModelCost` helper, and the dev route uses it

**Files:**
- Modify: `src/lib/cost-visibility.ts` (add after `stripDevCost`, ~line 128)
- Modify: `src/app/api/report/[id]/dev/[login]/route.ts:16-29` (replace the inline strip)
- Test: `src/lib/__tests__/unit/strip-model-cost.test.ts`

**Interfaces:**
- Consumes: `canSeeCost: (devLogin: string) => boolean` from the existing `buildCostVisibility`.
- Produces:
  ```ts
  export function stripModelCost<T extends { model: string; cost?: number | null; requests?: number | null }>(
    models: T[], canSeeCost: (devLogin: string) => boolean, devLogin: string,
  ): Array<Omit<T, 'cost' | 'requests'> & Partial<Pick<T, 'cost' | 'requests'>>>;
  ```
  Task 3 calls this per `github_login` group.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/strip-model-cost.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { stripModelCost } from '@/lib/cost-visibility';

const rows = [
  { model: 'claude-sonnet-5', cost: 500, requests: 20 },
  { model: 'claude-opus-4-8', cost: 900, requests: 5 },
];

it('returns rows untouched when cost is visible', () => {
  const out = stripModelCost(rows, () => true, 'alice');
  expect(out).toEqual(rows);
});

it('drops cost AND requests when cost is not visible, keeping model', () => {
  const out = stripModelCost(rows, () => false, 'alice') as any[];
  expect(out.map(m => m.model).sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
  for (const m of out) {
    expect(m).not.toHaveProperty('cost');
    expect(m).not.toHaveProperty('requests');
  }
});

it('re-orders by model name when stripped so order carries no cost signal', () => {
  // cost order is [opus 900, sonnet 500]; name order is [opus, sonnet] — use a
  // fixture where the two differ so the assertion is load-bearing.
  const mixed = [
    { model: 'zeta-model', cost: 900, requests: 1 },
    { model: 'alpha-model', cost: 100, requests: 2 },
  ];
  const visible = stripModelCost(mixed, () => true, 'alice') as any[];
  expect(visible.map(m => m.model)).toEqual(['zeta-model', 'alpha-model']);   // untouched
  const hidden = stripModelCost(mixed, () => false, 'alice') as any[];
  expect(hidden.map(m => m.model)).toEqual(['alpha-model', 'zeta-model']);    // name-ordered
});

it('passes the developer login to the predicate', () => {
  const canSeeCost = jest.fn(() => true);
  stripModelCost(rows, canSeeCost, 'carol');
  expect(canSeeCost).toHaveBeenCalledWith('carol');
});

it('handles an empty array', () => {
  expect(stripModelCost([], () => false, 'alice')).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="strip-model-cost"`
Expected: FAIL — `stripModelCost is not a function`.

- [ ] **Step 3: Add the helper**

In `src/lib/cost-visibility.ts`, after `stripDevCost`:

```typescript
/**
 * Per-model cost fields. `requests` is included deliberately: summing
 * models[].requests across a developer's array reconstructs the gated
 * cc_requests value exactly (same user_cost_report window, merely grouped by
 * model), so leaving it in would let a non-privileged viewer recover a stripped
 * field by arithmetic.
 */
const MODEL_COST_FIELDS = ['cost', 'requests'] as const;
type ModelCostField = typeof MODEL_COST_FIELDS[number];

interface ModelBearing {
  model: string;
  cost?: number | null;
  requests?: number | null;
}

/**
 * Drop per-model cost fields unless the requester may see this developer's cost.
 * When stripped, the array is re-sorted by model name: callers order it by cost
 * for privileged viewers, and that order would otherwise leak a relative-cost
 * ranking to someone not allowed to see the amounts.
 */
export function stripModelCost<T extends ModelBearing>(
  models: T[],
  canSeeCost: (devLogin: string) => boolean,
  devLogin: string,
): Array<Omit<T, ModelCostField> & Partial<Pick<T, ModelCostField>>> {
  if (canSeeCost(devLogin)) return models;
  return models
    .map((m) => {
      const copy: any = { ...m };
      for (const f of MODEL_COST_FIELDS) delete copy[f];
      return copy;
    })
    .sort((a: any, b: any) => String(a.model).localeCompare(String(b.model)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="strip-model-cost"`
Expected: PASS (5 tests).

- [ ] **Step 5: Use the helper in the dev route**

In `src/app/api/report/[id]/dev/[login]/route.ts`, add `stripModelCost` to the existing import from `@/lib/cost-visibility`, then replace the whole comment-plus-`if` block (lines 16-29 — from `// Per-model cost is money…` through the closing `}` of the `if`) with:

```typescript
    // Per-model cost/requests follow the same team-scoped rule as cc_total_cost;
    // stripModelCost is the single implementation (see its doc comment for why
    // requests is included and why the array is re-sorted when stripped).
    result.models = stripModelCost(result.models ?? [], canSeeCost, result.developer.github_login);
```

Then update the module mock in `src/lib/__tests__/unit/cc-breakdown-dev-route.test.ts` — it mocks `@/lib/cost-visibility` wholesale, so the route would otherwise call `undefined`. Add this line to that `jest.mock` factory:

```typescript
  stripModelCost: jest.requireActual('@/lib/cost-visibility').stripModelCost,
```

- [ ] **Step 6: Prove the refactor is behaviour-preserving**

Run: `npm test -- --testPathPatterns="strip-model-cost|cc-breakdown-dev-route|report-cost-gating|cost-visibility|cost-leak-surfaces"`
Expected: PASS, with the pre-existing dev-route and gating assertions unchanged.

Run: `grep -n "cost, requests, \.\.\.rest" "src/app/api/report/[id]/dev/[login]/route.ts"`
Expected: no output — no inline copy of the strip remains.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cost-visibility.ts "src/app/api/report/[id]/dev/[login]/route.ts" src/lib/__tests__/unit/strip-model-cost.test.ts src/lib/__tests__/unit/cc-breakdown-dev-route.test.ts
git commit -m "refactor(cost): extract stripModelCost as the single per-model cost gate"
```

---

### Task 2: `org.ts` returns per-login model and skills rows

**Files:**
- Modify: `src/lib/report/org.ts:20-29` (add `cc_skills_used` to the SELECT) and before the final `return` (~line 264)
- Test: `src/lib/__tests__/unit/org-model-usage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, on `getOrgReport`'s return value:
  ```ts
  modelUsage:  Array<{ github_login: string; model: string; cost: number; requests: number }>
  skillsUsage: Array<{ github_login: string; product: string; skills_used: number; skills_distinct: number }>
  ```
  Task 3 strips `cost`/`requests` from `modelUsage`; Tasks 5 and 6 consume both.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/org-model-usage.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { getOrgReport } from '@/lib/report/org';
import db from '@/lib/db';

const mockExecute = db.execute as jest.Mock;

/** Route by SQL text so the test survives query-order changes. */
function routeQueries() {
  mockExecute.mockImplementation(async (sql: string) => {
    if (/FROM reports/.test(sql)) {
      return [[{ id: 'r1', org: 'acme', period_days: 14, status: 'completed', created_at: 'x', completed_at: 'y' }], null];
    }
    if (/FROM developer_stats/.test(sql)) {
      return [[{ github_login: 'alice', github_name: 'Alice', type_breakdown: '{}', active_repos: '[]', cc_total_cost: '100', cc_requests: '5', cc_skills_used: '12' }], null];
    }
    if (/FROM cc_model_usage/.test(sql)) {
      return [[
        { github_login: 'alice', model: 'claude-sonnet-5', cost: '500.00', requests: '20' },
        { github_login: 'bob', model: 'claude-opus-4-8', cost: '900.00', requests: '5' },
      ], null];
    }
    if (/FROM cc_skills_usage/.test(sql)) {
      return [[{ github_login: 'alice', product: 'cowork', skills_used: '12', skills_distinct: '4' }], null];
    }
    return [[], null];
  });
}

beforeEach(() => { mockExecute.mockReset(); routeQueries(); });

it('returns modelUsage with numeric coercion', async () => {
  const res: any = await getOrgReport('r1');
  expect(res.modelUsage).toEqual([
    { github_login: 'alice', model: 'claude-sonnet-5', cost: 500, requests: 20 },
    { github_login: 'bob', model: 'claude-opus-4-8', cost: 900, requests: 5 },
  ]);
});

it('returns skillsUsage with numeric coercion', async () => {
  const res: any = await getOrgReport('r1');
  expect(res.skillsUsage).toEqual([
    { github_login: 'alice', product: 'cowork', skills_used: 12, skills_distinct: 4 },
  ]);
});

it('selects cc_skills_used for developers', async () => {
  const res: any = await getOrgReport('r1');
  const devSelect = mockExecute.mock.calls.map(c => String(c[0])).find(s => /FROM developer_stats/.test(s))!;
  expect(devSelect).toMatch(/cc_skills_used/);
  expect(res.developers[0].cc_skills_used).toBe('12');
});

it('scopes both new queries to the report', async () => {
  await getOrgReport('r1');
  for (const pattern of [/FROM cc_model_usage/, /FROM cc_skills_usage/]) {
    const call = mockExecute.mock.calls.find(c => pattern.test(String(c[0])))!;
    expect(String(call[0])).toMatch(/WHERE report_id = \?/);
    expect(call[1]).toEqual(['r1']);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="org-model-usage"`
Expected: FAIL — `res.modelUsage` is `undefined`.

- [ ] **Step 3: Add `cc_skills_used` to the developer SELECT**

In `src/lib/report/org.ts`, change the `devRows` SELECT column list so the cc line reads:

```
            cc_total_cost, cc_requests, cc_skills_used
```

- [ ] **Step 4: Add the two queries and return them**

In `src/lib/report/org.ts`, immediately before the final `return` statement:

```typescript
  // GLOOK-30 UI: per-(login, dimension) breakdown rows, returned unaggregated.
  // The org route strips cost/requests per login and the client aggregates what
  // survives, so an aggregate can never exceed what the viewer may see.
  const [modelUsageRows] = await db.execute(
    `SELECT github_login, model, cost, requests
     FROM cc_model_usage WHERE report_id = ?
     ORDER BY github_login, cost DESC, model`,
    [reportId],
  ) as [any[], any];
  const modelUsage = modelUsageRows.map((r: any) => ({
    github_login: String(r.github_login),
    model: String(r.model),
    cost: Number(r.cost) || 0,
    requests: Number(r.requests) || 0,
  }));

  const [skillsUsageRows] = await db.execute(
    `SELECT github_login, product, skills_used, skills_distinct
     FROM cc_skills_usage WHERE report_id = ?
     ORDER BY github_login, skills_used DESC, product`,
    [reportId],
  ) as [any[], any];
  const skillsUsage = skillsUsageRows.map((r: any) => ({
    github_login: String(r.github_login),
    product: String(r.product),
    skills_used: Number(r.skills_used) || 0,
    skills_distinct: Number(r.skills_distinct) || 0,
  }));
```

and extend the return:

```typescript
  return { report: reportRows[0], developers, timeline, spendWindow, unmergedSummary, modelUsage, skillsUsage };
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPatterns="org-model-usage|report-cost-gating"`
Expected: PASS — 4 new tests, and the existing org-route gating suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/org.ts src/lib/__tests__/unit/org-model-usage.test.ts
git commit -m "feat(org): return per-login model and skills usage rows"
```

---

### Task 3: Org route strips per-model cost per login

**Files:**
- Modify: `src/app/api/report/[id]/org/route.ts`
- Test: `src/lib/__tests__/unit/org-route-model-gating.test.ts`

**Interfaces:**
- Consumes: `stripModelCost(models, canSeeCost, devLogin)` (Task 1); `modelUsage` / `skillsUsage` on the `getOrgReport` result (Task 2).
- Produces: an org payload whose `modelUsage` rows have `cost`/`requests` absent for developers the requester may not see, grouped per login with name-ordered models. `skillsUsage` is never modified.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/org-route-model-gating.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/org', () => ({ getOrgReport: jest.fn() }));
jest.mock('@/lib/report/service', () => ({ ReportNotFoundError: class ReportNotFoundError extends Error {} }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({ githubLogin: 'alice', isAdmin: false, authDisabled: false })),
  buildCostVisibility: jest.fn(),
  stripDevCost: jest.requireActual('@/lib/cost-visibility').stripDevCost,
  stripModelCost: jest.requireActual('@/lib/cost-visibility').stripModelCost,
  costCacheHeaders: jest.requireActual('@/lib/cost-visibility').costCacheHeaders,
}));

import { GET } from '@/app/api/report/[id]/org/route';
import { getOrgReport } from '@/lib/report/org';
import { buildCostVisibility } from '@/lib/cost-visibility';

const params = { params: Promise.resolve({ id: 'r1' }) };
const req = () => new Request('http://localhost/api/report/r1/org');

beforeEach(() => {
  jest.clearAllMocks();
  (getOrgReport as jest.Mock).mockResolvedValue({
    report: { id: 'r1', org: 'acme', cc_period_start: '2026-07-01', cc_period_end: '2026-07-14' },
    developers: [{ github_login: 'alice', cc_total_cost: 100, cc_requests: 5 },
                 { github_login: 'carol', cc_total_cost: 200, cc_requests: 9 }],
    timeline: [], spendWindow: {}, unmergedSummary: null,
    modelUsage: [
      // alice is a teammate; carol is not. zeta/alpha differ in cost vs name order.
      { github_login: 'alice', model: 'zeta-model', cost: 900, requests: 3 },
      { github_login: 'alice', model: 'alpha-model', cost: 100, requests: 7 },
      { github_login: 'carol', model: 'zeta-model', cost: 800, requests: 4 },
      { github_login: 'carol', model: 'alpha-model', cost: 50, requests: 1 },
    ],
    skillsUsage: [{ github_login: 'carol', product: 'cowork', skills_used: 3, skills_distinct: 2 }],
  });
  (buildCostVisibility as jest.Mock).mockResolvedValue({
    canSeeCost: (l: string) => l === 'alice', canSeeAnyCost: true,
  });
});

it('keeps per-model cost for a developer the requester can see', async () => {
  const body = await (await GET(req() as any, params as any)).json();
  const alice = body.modelUsage.filter((r: any) => r.github_login === 'alice');
  expect(alice).toEqual([
    { github_login: 'alice', model: 'zeta-model', cost: 900, requests: 3 },
    { github_login: 'alice', model: 'alpha-model', cost: 100, requests: 7 },
  ]);
});

it('strips cost AND requests for a developer the requester cannot see', async () => {
  const body = await (await GET(req() as any, params as any)).json();
  const carol = body.modelUsage.filter((r: any) => r.github_login === 'carol');
  expect(carol.map((r: any) => r.model)).toEqual(['alpha-model', 'zeta-model']); // name-ordered
  for (const r of carol) {
    expect(r).not.toHaveProperty('cost');
    expect(r).not.toHaveProperty('requests');
    expect(r.github_login).toBe('carol');
  }
});

it('never strips skillsUsage', async () => {
  const body = await (await GET(req() as any, params as any)).json();
  expect(body.skillsUsage).toEqual([
    { github_login: 'carol', product: 'cowork', skills_used: 3, skills_distinct: 2 },
  ]);
});

it('leak guard: no per-model cost for any developer when nothing is visible', async () => {
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: () => false, canSeeAnyCost: false });
  const body = await (await GET(req() as any, params as any)).json();
  expect(body.modelUsage).toHaveLength(4);
  for (const r of body.modelUsage) {
    expect(r).not.toHaveProperty('cost');
    expect(r).not.toHaveProperty('requests');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="org-route-model-gating"`
Expected: FAIL — carol's rows still carry `cost`.

- [ ] **Step 3: Strip per login in the route**

In `src/app/api/report/[id]/org/route.ts`, add `stripModelCost` to the `@/lib/cost-visibility` import, then insert immediately after the `result.developers = stripDevCost(...)` line:

```typescript
    // Per-model cost/requests are gated per developer. Group by login so
    // stripModelCost's name-reordering applies within each developer's models —
    // the rows arrive ordered by cost, which would otherwise leak a relative
    // ranking for a developer whose amounts are hidden.
    const modelsByLogin = new Map<string, any[]>();
    for (const row of (result as any).modelUsage ?? []) {
      const arr = modelsByLogin.get(row.github_login) ?? [];
      arr.push(row);
      modelsByLogin.set(row.github_login, arr);
    }
    (result as any).modelUsage = [...modelsByLogin.entries()].flatMap(
      ([login, rows]) => stripModelCost(rows, canSeeCost, login),
    );
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="org-route-model-gating|report-cost-gating|cost-leak-surfaces"`
Expected: PASS — 4 new tests, existing gating suites unchanged.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/report/[id]/org/route.ts" src/lib/__tests__/unit/org-route-model-gating.test.ts
git commit -m "feat(org): gate per-model cost per developer on the org endpoint"
```

---

### Task 4: Claude Code Usage card on the engineer page

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx` — types (~19-28), destructuring (~118-124), replace the spend tile (250-259), add the exported component
- Test: `src/lib/__tests__/unit/dev-usage-card.test.tsx`

**Interfaces:**
- Consumes: the existing `/api/report/[id]/dev/[login]` payload — `developer.cc_total_cost?`, `developer.cc_requests?`, `developer.cc_skills_used?`, `skills[]`, `models[]` (where `cost` and `requests` are optional).
- Produces:
  ```ts
  export interface SkillRow { product: string; skills_used: number; skills_distinct: number }
  export interface ModelRow { model: string; cost?: number; requests?: number }
  export function ClaudeCodeUsageCard(props: {
    costCents?: number; requests?: number; skillsUsed?: number;
    skills: SkillRow[]; models: ModelRow[];
  }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/dev-usage-card.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ClaudeCodeUsageCard } from '@/app/report/[id]/dev/[login]/page';

it('renders spend, requests, skills invoked and both lists', () => {
  render(<ClaudeCodeUsageCard
    costCents={12345} requests={42} skillsUsed={12}
    skills={[{ product: 'cowork', skills_used: 12, skills_distinct: 4 }]}
    models={[{ model: 'claude-sonnet-5', cost: 500, requests: 20 }]}
  />);
  expect(screen.getByText('$123.45')).toBeTruthy();
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  expect(screen.getByText('cowork')).toBeTruthy();
  expect(screen.getByText(/12 used/)).toBeTruthy();
  expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.getByText(/\$5\.00/)).toBeTruthy();
});

it('renders a model with cost and requests stripped without printing $undefined or NaN', () => {
  render(<ClaudeCodeUsageCard
    skills={[]} models={[{ model: 'claude-sonnet-5' }]}
  />);
  expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.queryByText(/undefined|NaN|\$/)).toBeNull();
});

it('shows an em dash for an absent spend and requests', () => {
  render(<ClaudeCodeUsageCard
    skillsUsed={0} skills={[]} models={[{ model: 'm1' }]}
  />);
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
});

it('renders nothing when no dimension has data', () => {
  const { container } = render(<ClaudeCodeUsageCard skills={[]} models={[]} />);
  expect(container.firstChild).toBeNull();
});

it('renders when only skills have data (zero spend)', () => {
  render(<ClaudeCodeUsageCard
    costCents={0} skills={[{ product: 'chat', skills_used: 0, skills_distinct: 3 }]} models={[]}
  />);
  expect(screen.getByText('chat')).toBeTruthy();
  expect(screen.getByText(/3 distinct/)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="dev-usage-card"`
Expected: FAIL — `ClaudeCodeUsageCard` is not exported.

- [ ] **Step 3: Add the component**

In `src/app/report/[id]/dev/[login]/page.tsx`, add these interfaces next to `DevStats` and add `cc_skills_used?: number;` to `DevStats`:

```typescript
export interface SkillRow { product: string; skills_used: number; skills_distinct: number }
/** cost and requests are optional: the dev route strips both for viewers who
 *  may not see this developer's cost. */
export interface ModelRow { model: string; cost?: number; requests?: number }
```

Then add the component at module level (below the helper functions, above `DevDetailPage`):

```tsx
/**
 * Exported for tests: mounting the whole page would require mocking useSWR and
 * useParams, which tells us nothing about this card.
 */
export function ClaudeCodeUsageCard({ costCents, requests, skillsUsed, skills, models }: {
  costCents?: number;
  requests?: number;
  skillsUsed?: number;
  skills: SkillRow[];
  models: ModelRow[];
}) {
  const hasSpend = costCents != null && Number(costCents) > 0;
  if (!hasSpend && skills.length === 0 && models.length === 0) return null;

  const maxModelCost = Math.max(...models.map(m => Number(m.cost ?? 0)), 1);

  return (
    <div className="bg-gray-900 rounded-xl p-5 mb-6">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Claude Code Usage</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Spend</p>
          <p className="text-xl font-bold text-green-400">
            {costCents != null ? `$${(Number(costCents) / 100).toFixed(2)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Requests</p>
          <p className="text-xl font-bold text-gray-200">{requests != null ? requests : '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Skills Invoked</p>
          <p className="text-xl font-bold text-gray-200">{skillsUsed ?? 0}</p>
        </div>
      </div>

      {skills.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Skills by product</p>
          <div className="space-y-1">
            {skills.map(s => (
              <div key={s.product} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-gray-400">{s.product}</span>
                <span className="text-gray-300 tabular-nums">{s.skills_used} used · {s.skills_distinct} distinct</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {models.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Models</p>
          <div className="space-y-1">
            {models.map(m => (
              <div key={m.model} className="flex items-center gap-3 text-sm py-0.5">
                <span className="text-gray-400 truncate min-w-0 flex-1">{m.model}</span>
                {m.cost != null && (
                  <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                    <div className="h-full bg-accent-light rounded-full"
                      style={{ width: `${(Number(m.cost) / maxModelCost) * 100}%` }} />
                  </div>
                )}
                <span className="text-gray-300 tabular-nums shrink-0">
                  {m.cost != null && m.requests != null
                    ? `$${(Number(m.cost) / 100).toFixed(2)} · ${m.requests} req`
                    : m.cost != null
                      ? `$${(Number(m.cost) / 100).toFixed(2)}`
                      : m.requests != null
                        ? `${m.requests} req`
                        : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the page**

In `DevDetailPage`, add to the destructuring block:

```typescript
  const skills: SkillRow[] = devData?.skills ?? [];
  const models: ModelRow[] = devData?.models ?? [];
```

and replace the whole existing "Anthropic Spend tile" block (the comment plus its `{dev.cc_total_cost != null && … }` JSX) with:

```tsx
      <ClaudeCodeUsageCard
        costCents={dev.cc_total_cost}
        requests={dev.cc_requests}
        skillsUsed={dev.cc_skills_used}
        skills={skills}
        models={models}
      />
```

- [ ] **Step 5: Run tests and type-check**

Run: `npm test -- --testPathPatterns="dev-usage-card"`
Expected: PASS (5 tests).

Run: `npx tsc --noEmit`
Expected: no errors in tracked files (files whose names contain a space then a digit before `.ts`/`.tsx` are untracked strays — ignore only those).

- [ ] **Step 6: Commit**

```bash
git add "src/app/report/[id]/dev/[login]/page.tsx" src/lib/__tests__/unit/dev-usage-card.test.tsx
git commit -m "feat(dev-page): Claude Code Usage card with skills and model breakdown"
```

---

### Task 5: `computeModelMix`

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx` — add beside `computeSpendMetrics` (~956)
- Test: `src/lib/__tests__/unit/compute-model-mix.test.ts`

**Interfaces:**
- Consumes: `modelUsage` rows from the org payload (Task 2), post-stripping (Task 3), so `cost`/`requests` may be absent.
- Produces:
  ```ts
  export interface ModelUsageRow { github_login: string; model: string; cost?: number; requests?: number }
  export interface ModelMixRow { model: string; cost: number; requests: number; devs: number; pct: number; costPerRequest: number }
  export function computeModelMix(rows: ModelUsageRow[]): { rows: ModelMixRow[]; total: number };
  ```
  Task 6 renders the result.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/compute-model-mix.test.ts`:

```typescript
import { computeModelMix } from '@/app/report/[id]/org/page';

it('merges a model across developers and counts distinct developers', () => {
  const { rows, total } = computeModelMix([
    { github_login: 'alice', model: 'sonnet', cost: 300, requests: 10 },
    { github_login: 'bob', model: 'sonnet', cost: 100, requests: 30 },
    { github_login: 'alice', model: 'opus', cost: 600, requests: 5 },
  ]);
  expect(total).toBe(1000);
  expect(rows).toEqual([
    { model: 'opus', cost: 600, requests: 5, devs: 1, pct: 60, costPerRequest: 120 },
    { model: 'sonnet', cost: 400, requests: 40, devs: 2, pct: 40, costPerRequest: 10 },
  ]);
});

it('SCOPE COHERENCE: ignores rows whose cost was stripped', () => {
  // carol's cost was stripped, so her model must not appear at all and must not
  // inflate any dev count — no $0 phantom row, no org-wide names beside
  // team-only cost.
  const { rows, total } = computeModelMix([
    { github_login: 'alice', model: 'sonnet', cost: 400, requests: 10 },
    { github_login: 'carol', model: 'sonnet' },
    { github_login: 'carol', model: 'haiku' },
  ]);
  expect(total).toBe(400);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ model: 'sonnet', cost: 400, devs: 1 });
  expect(rows.map(r => r.model)).not.toContain('haiku');
});

it('sorts by cost descending, then model name', () => {
  const { rows } = computeModelMix([
    { github_login: 'a', model: 'zeta', cost: 100, requests: 1 },
    { github_login: 'a', model: 'alpha', cost: 100, requests: 1 },
    { github_login: 'a', model: 'big', cost: 900, requests: 1 },
  ]);
  expect(rows.map(r => r.model)).toEqual(['big', 'alpha', 'zeta']);
});

it('handles zero requests without dividing by zero', () => {
  const { rows } = computeModelMix([{ github_login: 'a', model: 'm', cost: 500, requests: 0 }]);
  expect(rows[0].costPerRequest).toBe(0);
  expect(Number.isNaN(rows[0].costPerRequest)).toBe(false);
});

it('returns an empty result for no rows and for all-stripped rows', () => {
  expect(computeModelMix([])).toEqual({ rows: [], total: 0 });
  expect(computeModelMix([{ github_login: 'a', model: 'm' }])).toEqual({ rows: [], total: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="compute-model-mix"`
Expected: FAIL — `computeModelMix` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/app/report/[id]/org/page.tsx`, next to `computeSpendMetrics`:

```typescript
export interface ModelUsageRow { github_login: string; model: string; cost?: number; requests?: number }
export interface ModelMixRow {
  model: string; cost: number; requests: number; devs: number; pct: number; costPerRequest: number;
}

/**
 * Aggregate per-(login, model) rows into an org/team model mix.
 *
 * Scope coherence: only rows whose `cost` survived per-login stripping are
 * counted. The route keeps a row's `model` while deleting `cost`/`requests` for
 * developers the viewer may not see, so counting every row would mix scopes —
 * org-wide model names and developer counts beside team-only cost.
 */
export function computeModelMix(rows: ModelUsageRow[]): { rows: ModelMixRow[]; total: number } {
  const visible = rows.filter(r => r.cost != null);

  const byModel = new Map<string, { cost: number; requests: number; devs: Set<string> }>();
  for (const r of visible) {
    const entry = byModel.get(r.model) ?? { cost: 0, requests: 0, devs: new Set<string>() };
    entry.cost += Number(r.cost) || 0;
    entry.requests += Number(r.requests) || 0;
    entry.devs.add(r.github_login);
    byModel.set(r.model, entry);
  }

  const total = [...byModel.values()].reduce((s, e) => s + e.cost, 0);
  const out: ModelMixRow[] = [...byModel.entries()]
    .map(([model, e]) => ({
      model,
      cost: e.cost,
      requests: e.requests,
      devs: e.devs.size,
      pct: total > 0 ? (e.cost / total) * 100 : 0,
      costPerRequest: e.requests > 0 ? e.cost / e.requests : 0,
    }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));

  return { rows: out, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="compute-model-mix"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx" src/lib/__tests__/unit/compute-model-mix.test.ts
git commit -m "feat(spend): computeModelMix aggregating only visible-cost rows"
```

---

### Task 6: Model Mix section on the Spend tab

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx` — destructure `modelUsage`/`skillsUsage`, pass to `SpendTab`, export `SpendTab`, render the section after the Pareto block
- Test: `src/lib/__tests__/unit/spend-model-mix.test.tsx`

**Interfaces:**
- Consumes: `computeModelMix`, `ModelUsageRow` (Task 5); `modelUsage`/`skillsUsage` from the payload (Tasks 2-3); the existing `formatDollars` and `fullCostVisibility`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/spend-model-mix.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { SpendTab } from '@/app/report/[id]/org/page';

const baseProps = {
  reportId: 'r1',
  router: { push: jest.fn() } as any,
  report: { id: 'r1', org: 'acme', period_days: 14 } as any,
  spendWindow: null,
  skillsUsage: [
    { github_login: 'alice', product: 'cowork', skills_used: 9, skills_distinct: 8 },
    { github_login: 'bob', product: 'chat', skills_used: 0, skills_distinct: 3 },
  ],
};

const allVisible = [
  { github_login: 'alice', cc_total_cost: 600, cc_requests: 10, impact_score: 5 },
  { github_login: 'bob', cc_total_cost: 400, cc_requests: 40, impact_score: 4 },
] as any[];

const modelUsage = [
  { github_login: 'alice', model: 'opus', cost: 600, requests: 5 },
  { github_login: 'bob', model: 'sonnet', cost: 400, requests: 40 },
];

it('renders Model Mix with share and percent under full visibility', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={modelUsage} />);
  expect(screen.getByText('Model Mix')).toBeTruthy();
  expect(screen.getByText('opus')).toBeTruthy();
  expect(screen.getByText('sonnet')).toBeTruthy();
  expect(screen.getByText('60%')).toBeTruthy();
  expect(screen.getByText('40%')).toBeTruthy();
});

it('relabels and keeps percent under partial visibility', () => {
  // bob's cost is absent => partial visibility. A composition share is still
  // valid on a well-defined subset, so % must SURVIVE (unlike the Pareto stats).
  const partialDevs = [
    { github_login: 'alice', cc_total_cost: 600, cc_requests: 10, impact_score: 5 },
    { github_login: 'bob', impact_score: 4 },
  ] as any[];
  const partialModels = [
    { github_login: 'alice', model: 'opus', cost: 600, requests: 5 },
    { github_login: 'bob', model: 'sonnet' },
  ];
  render(<SpendTab {...baseProps} developers={partialDevs} modelUsage={partialModels} />);
  expect(screen.getByText(/Your teams' model mix/i)).toBeTruthy();
  expect(screen.queryByText('Model Mix')).toBeNull();
  expect(screen.getByText('100%')).toBeTruthy();          // opus is all of the visible spend
  expect(screen.queryByText('sonnet')).toBeNull();        // scope coherence
});

it('renders the compact skills line', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={modelUsage} />);
  expect(screen.getByText(/9 invocations by 2 developers/i)).toBeTruthy();
});

it('omits the Model Mix section entirely when there is no model data', () => {
  render(<SpendTab {...baseProps} developers={allVisible} modelUsage={[]} />);
  expect(screen.queryByText('Model Mix')).toBeNull();
  expect(screen.queryByText(/Your teams' model mix/i)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="spend-model-mix"`
Expected: FAIL — `SpendTab` is not exported.

- [ ] **Step 3: Thread the new payload fields through**

In `src/app/report/[id]/org/page.tsx`, add to `OrgDetailPage`'s destructuring:

```typescript
  const modelUsage: ModelUsageRow[] = data?.modelUsage ?? [];
  const skillsUsage: Array<{ github_login: string; product: string; skills_used: number; skills_distinct: number }> = data?.skillsUsage ?? [];
```

Change `function SpendTab(` to `export function SpendTab(` (exported for tests — mounting `OrgDetailPage` would require mocking `useSWR`, `useParams` and `useRouter`), and add to its props type:

```typescript
  modelUsage: ModelUsageRow[];
  skillsUsage: Array<{ github_login: string; product: string; skills_used: number; skills_distinct: number }>;
```

Update the call site to pass both:

```tsx
<SpendTab developers={developers} reportId={params.id} router={router} report={report} spendWindow={spendWindow} modelUsage={modelUsage} skillsUsage={skillsUsage} />
```

- [ ] **Step 4: Render the section**

Inside `SpendTab`, after the destructuring of `computeSpendMetrics`, add:

```typescript
  const { rows: modelMix, total: modelTotal } = computeModelMix(modelUsage);
  const modelMixLabel = fullCostVisibility ? 'Model Mix' : "Your teams' model mix";
  const skillsInvocations = skillsUsage.reduce((s, r) => s + r.skills_used, 0);
  const skillsDevs = new Set(skillsUsage.map(r => r.github_login)).size;
  const skillsByProduct = [...skillsUsage.reduce((m, r) => m.set(r.product, (m.get(r.product) ?? 0) + r.skills_used), new Map<string, number>())]
    .map(([product, used]) => `${product} ${used}`)
    .join(', ');
  const SHARE_COLORS = ['bg-accent', 'bg-accent-light', 'bg-accent-dark', 'bg-gray-600', 'bg-gray-700'];
```

Then insert this block immediately after the Pareto "Spend Concentration" block and before the Top Spenders table:

```tsx
      {/* Model Mix — composition of visible spend by model. Unlike the Pareto
          concentration stat above, a composition share stays meaningful on a
          permission-filtered subset, so the % and bar are kept under partial
          visibility and the label carries the scope instead. */}
      {modelMix.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">{modelMixLabel}</p>
            <p className="text-sm font-bold text-green-400">{formatDollars(modelTotal)}</p>
          </div>

          <div className="h-6 bg-gray-800 rounded-full overflow-hidden flex mb-4">
            {modelMix.slice(0, 5).map((m, i) => (
              <div key={m.model}
                className={`h-full flex items-center justify-center text-xs font-bold text-gray-900 ${SHARE_COLORS[i]}`}
                style={{ width: `${m.pct}%` }}>
                {m.pct > 12 && `${Math.round(m.pct)}%`}
              </div>
            ))}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Spend</th>
                <th className="px-4 py-3 text-right">%</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">$/Request</th>
                <th className="px-4 py-3 text-right">Devs</th>
              </tr>
            </thead>
            <tbody>
              {modelMix.map(m => (
                <tr key={m.model} className="border-b border-gray-800/50">
                  <td className="px-4 py-3 text-gray-300">{m.model}</td>
                  <td className="px-4 py-3 text-right text-green-400 font-mono">{formatDollars(m.cost)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{Math.round(m.pct)}%</td>
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{m.requests.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-400 font-mono">${(m.costPerRequest / 100).toFixed(3)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{m.devs}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {skillsUsage.length > 0 && (
            <p className="text-xs text-gray-500 mt-4">
              Skills: {skillsInvocations} invocations by {skillsDevs} developer{skillsDevs === 1 ? '' : 's'}
              {skillsByProduct ? ` (${skillsByProduct})` : ''}
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 5: Run tests, type-check, full suite**

Run: `npm test -- --testPathPatterns="spend-model-mix|compute-model-mix"`
Expected: PASS (9 tests).

Run: `npx tsc --noEmit`
Expected: no errors in tracked files.

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 6: Verify against real data in the running container**

Run:
```bash
podman-compose up -d --no-build app
RID=$(curl -s http://localhost:3000/api/report | python3 -c "import sys,json;d=json.load(sys.stdin);print(next(x['id'] for x in d if x['status']=='completed'))")
curl -s "http://localhost:3000/api/report/$RID/org" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('modelUsage rows:', len(d.get('modelUsage') or []))
print('skillsUsage rows:', len(d.get('skillsUsage') or []))
print('sample:', (d.get('modelUsage') or [])[:2])"
```
Expected: non-zero row counts and rows carrying `cost`/`requests` (the container runs `AUTH_TEST_USER=admin`). This requires rebuilding the image first if the container is stale — see the local-podman deploy notes.

- [ ] **Step 7: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx" src/lib/__tests__/unit/spend-model-mix.test.tsx
git commit -m "feat(spend): Model Mix panel with composition share and skills line"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Engineer page Claude Code Usage card (3-up stats, skills list, models list + bar) | 4 |
| Card hidden when no dimension has data; `—` for absent fields | 4 |
| Skills deliberately excluded from the percentile grid | (none — explicitly out of scope, noted in Task 4's interfaces) |
| Model Mix section after Pareto, before Top Spenders | 6 |
| Segmented share bar + table (model/spend/%/requests/$-per-request/devs) | 6 |
| Compact skills line | 6 |
| Partial visibility: relabel, KEEP % and bar | 6 (asserted in its test) |
| Scope coherence: only cost-present rows counted | 5 (asserted) + 3 (produces the stripped rows) |
| `org.ts` returns `modelUsage`, `skillsUsage`, `cc_skills_used` | 2 |
| Client-side aggregation (never server-side) | 5 |
| `stripModelCost` extracted as the single implementation | 1 |
| Org route strips per-model cost per login, name-reordered | 3 |
| Leak guard on the new org surface | 3 |
| Top Spenders table unchanged | (no task touches it) |

No spec requirement is unassigned.

**Placeholder scan:** none — every step carries runnable code or an exact command.

**Type consistency:** `ModelRow` (Task 4, page-local, `cost?`/`requests?`) and `ModelUsageRow` (Task 5, adds `github_login`) are deliberately distinct — the dev payload is already per-developer while the org payload is not. `ModelMixRow` (Task 5) is what Task 6 renders. `stripModelCost`'s signature in Task 1 matches its call sites in Task 1 (dev route, whole array) and Task 3 (per-login group). `computeModelMix` returns `{ rows, total }` in both Task 5 and Task 6.

**One ordering constraint:** Task 6 imports `ModelUsageRow` from the same file it edits, so Task 5 must land first.
