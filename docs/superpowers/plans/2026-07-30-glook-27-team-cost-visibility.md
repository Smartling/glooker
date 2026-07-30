# GLOOK-27 Team-Scoped Cost Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team member see Claude Code cost (`cc_total_cost`/`cc_requests`) for other members of their own team, across the web routes and the MCP `query_developer_stats` tool, without leaking cost across team boundaries or granting new privileges.

**Architecture:** One shared gating module (`src/lib/cost-visibility.ts`) is the single source of truth: `resolveRequester(headers)` (identity: githubLogin, isAdmin, authDisabled) + `buildCostVisibility(org, requester)` (per-dev `canSeeCost` predicate built from `listTeams(org)`) + `stripDevCost(devs, canSeeCost)`. The three REST routes and the MCP tool all call it; the frontend renders stripped (absent) cost as "–" and treats a partially-hidden team total as "–".

**Tech Stack:** Next.js 15 App Router (Node), TypeScript, existing `@/lib/db` (SQLite/MySQL), Jest + ts-jest, React/Tailwind frontend.

## Global Constraints

- **Trust rule (verbatim):** a developer's cost is visible when `authDisabled || isAdmin || (requester shares ≥1 team with that developer)`. Auth disabled ⇒ everyone sees all (matches today's `isAdmin()` returning true when `AUTH_ENABLED != 'true'`). Unmapped identity (auth on, no `github_login`) ⇒ sees no cost.
- **No new privileges / no mutation changes.** "Pull from Anthropic" stays admin-only (do not touch its gate).
- **Cost fields:** `cc_total_cost`, `cc_requests` (per-dev); `cc_period_start`, `cc_period_end`, `spendWindow` (report-level, org route only).
- **`canSeeAnyCost`** (report-level gate) = `authDisabled || isAdmin || (githubLogin != null && requester has ≥1 team)`.
- Tests mock the DB: `jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }))` and `jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }))` where the import chain reaches `github.ts`. MCP tests also `jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }))`.
- Jest flag on this repo is `--testPathPatterns` (plural).
- All API route handlers stay wrapped in `withRequestLog()` (enforced by `logger-enforcement.test.ts`).
- Out of scope: `/api/teams` GET and `/api/mcp` pre-existing missing-auth gaps; cost ingestion/storage.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cost-visibility.ts` | NEW — `resolveRequester`, `buildCostVisibility`, `stripDevCost` |
| `src/app/api/auth/me/route.ts` | Reuse `resolveRequester` for identity (kills the duplicated email→login/isAdmin logic) |
| `src/app/api/report/[id]/route.ts` | Per-dev cost strip via shared module |
| `src/app/api/report/[id]/dev/[login]/route.ts` | Per-dev cost strip via shared module |
| `src/app/api/report/[id]/org/route.ts` | Per-dev strip + `canSeeAnyCost`-gated report-level fields |
| `src/lib/mcp/protocol.ts` | Thread `requester` through `handleJsonRpc` → `callTool` |
| `src/lib/mcp/tools.ts` | `McpTool.handler` + `callTool` accept `requester`; wire `query_developer_stats` |
| `src/lib/mcp/queries.ts` | `queryDeveloperStats(args, requester?)` strips cost per team-scope |
| `src/app/api/mcp/route.ts` | Resolve requester, pass to `handleJsonRpc` |
| `src/lib/teams/team-aggregator.ts` | Team total is `null` ("–") when any member's cost is hidden |
| `src/app/report/[id]/team/dev-table.tsx` | Presence-driven Spend column; "–" for absent |
| `src/app/report/[id]/team/team-table.tsx` | Presence-driven Spend column; "–" for `null` |
| `src/app/report/[id]/org/page.tsx` | Presence-driven Spend tab |
| `src/app/report/[id]/dev/[login]/page.tsx` | Presence-driven cost tile |
| tests | module, routes, MCP, aggregator, leak-surface guards |

---

### Task 1: Shared cost-visibility module

**Files:**
- Create: `src/lib/cost-visibility.ts`
- Test: `src/lib/__tests__/unit/cost-visibility.test.ts`

**Interfaces:**
- Produces:
  - `interface Requester { githubLogin: string | null; isAdmin: boolean; authDisabled: boolean }`
  - `resolveRequester(headers: Headers): Promise<Requester>`
  - `interface CostVisibility { canSeeCost: (devLogin: string) => boolean; canSeeAnyCost: boolean }`
  - `buildCostVisibility(org: string, requester: Requester): Promise<CostVisibility>`
  - `stripDevCost<T extends { github_login: string }>(devs: T[], canSeeCost: (login: string) => boolean): T[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/cost-visibility.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/teams/service', () => ({ listTeams: jest.fn() }));

import { resolveRequester, buildCostVisibility, stripDevCost } from '@/lib/cost-visibility';
import db from '@/lib/db/index';
import { listTeams } from '@/lib/teams/service';

const mockExecute = db.execute as jest.Mock;
const mockListTeams = listTeams as jest.Mock;
const origEnv = { ...process.env };
beforeEach(() => { mockExecute.mockReset(); mockListTeams.mockReset(); process.env = { ...origEnv }; });
afterAll(() => { process.env = origEnv; });

function headersWithEmail(email: string): Headers {
  // AUTH_HEADER default x-amzn-oidc-data: unsigned JWT whose payload has `email`.
  const payload = Buffer.from(JSON.stringify({ email, sub: email })).toString('base64');
  return new Headers({ 'x-amzn-oidc-data': `h.${payload}.` });
}

describe('resolveRequester', () => {
  it('authDisabled when AUTH_ENABLED is not true', async () => {
    delete process.env.AUTH_ENABLED;
    const r = await resolveRequester(new Headers());
    expect(r).toEqual({ githubLogin: null, isAdmin: false, authDisabled: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('no identity header (auth on) → not admin, no login, not authDisabled', async () => {
    process.env.AUTH_ENABLED = 'true';
    const r = await resolveRequester(new Headers());
    expect(r).toEqual({ githubLogin: null, isAdmin: false, authDisabled: false });
  });

  it('maps email → github_login and reads admin group membership', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'glooker-admin';
    // extractUser reads groups from the JWT payload; put the admin group in it.
    const payload = Buffer.from(JSON.stringify({ email: 'a@x.com', sub: 'a@x.com', groups: ['glooker-admin'] })).toString('base64');
    const headers = new Headers({ 'x-amzn-oidc-data': `h.${payload}.` });
    mockExecute.mockResolvedValueOnce([[{ github_login: 'alice' }], null]);
    const r = await resolveRequester(headers);
    expect(r).toEqual({ githubLogin: 'alice', isAdmin: true, authDisabled: false });
  });

  it('mapped non-admin', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'glooker-admin';
    mockExecute.mockResolvedValueOnce([[{ github_login: 'bob' }], null]);
    const r = await resolveRequester(headersWithEmail('bob@x.com'));
    expect(r).toEqual({ githubLogin: 'bob', isAdmin: false, authDisabled: false });
  });
});

describe('buildCostVisibility', () => {
  const teams = [
    { id: 't1', members: ['alice', 'bob'] },
    { id: 't2', members: ['carol'] },
  ];

  it('admin sees all without hitting listTeams', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: 'x', isAdmin: true, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('anyone')).toBe(true);
    expect(mockListTeams).not.toHaveBeenCalled();
  });

  it('authDisabled sees all', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: null, isAdmin: false, authDisabled: true });
    expect(v.canSeeCost('anyone')).toBe(true);
    expect(v.canSeeAnyCost).toBe(true);
  });

  it('unmapped requester sees nothing', async () => {
    const v = await buildCostVisibility('acme', { githubLogin: null, isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
  });

  it('team member sees own-team devs, not other teams', async () => {
    mockListTeams.mockResolvedValueOnce(teams);
    const v = await buildCostVisibility('acme', { githubLogin: 'alice', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(true);
    expect(v.canSeeCost('alice')).toBe(true);  // self
    expect(v.canSeeCost('bob')).toBe(true);     // same team t1
    expect(v.canSeeCost('carol')).toBe(false);  // team t2
  });

  it('mapped but team-less requester sees nothing', async () => {
    mockListTeams.mockResolvedValueOnce(teams);
    const v = await buildCostVisibility('acme', { githubLogin: 'dave', isAdmin: false, authDisabled: false });
    expect(v.canSeeAnyCost).toBe(false);
    expect(v.canSeeCost('alice')).toBe(false);
  });
});

describe('stripDevCost', () => {
  it('drops cc fields for devs the predicate rejects, keeps for accepted', () => {
    const devs = [
      { github_login: 'alice', cc_total_cost: 100, cc_requests: 5, impact_score: 4 },
      { github_login: 'carol', cc_total_cost: 200, cc_requests: 9, impact_score: 3 },
    ];
    const out = stripDevCost(devs, (l) => l === 'alice');
    expect(out[0]).toEqual({ github_login: 'alice', cc_total_cost: 100, cc_requests: 5, impact_score: 4 });
    expect(out[1]).toEqual({ github_login: 'carol', impact_score: 3 });
    expect('cc_total_cost' in out[1]).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPatterns="cost-visibility"`
Expected: FAIL — "Cannot find module '@/lib/cost-visibility'".

- [ ] **Step 3: Implement `src/lib/cost-visibility.ts`**

```typescript
import db from '@/lib/db';
import { extractUser, isAuthEnabled } from '@/lib/auth';
import { listTeams } from '@/lib/teams/service';

export interface Requester {
  githubLogin: string | null;
  isAdmin: boolean;
  authDisabled: boolean;
}

export interface CostVisibility {
  canSeeCost: (devLogin: string) => boolean;
  canSeeAnyCost: boolean;
}

const CC_FIELDS = ['cc_total_cost', 'cc_requests'] as const;

/**
 * Resolve who is asking, from request headers. Identity only — team membership
 * is org-scoped and resolved in buildCostVisibility. When auth is disabled the
 * caller is treated as omniscient (matches isAdmin() returning true then).
 */
export async function resolveRequester(headers: Headers): Promise<Requester> {
  if (!isAuthEnabled()) return { githubLogin: null, isAdmin: false, authDisabled: true };

  const user = extractUser(headers);
  if (!user) return { githubLogin: null, isAdmin: false, authDisabled: false };

  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  const isAdmin = !!adminGroup && user.groups.includes(adminGroup);

  const [rows] = await db.execute(
    `SELECT github_login FROM user_mappings WHERE jira_email = ? LIMIT 1`,
    [user.email],
  ) as [any[], any];

  return { githubLogin: rows[0]?.github_login ?? null, isAdmin, authDisabled: false };
}

/**
 * Per-developer cost predicate for a requester within an org. Visible when auth
 * is disabled, the requester is an admin, or the requester shares at least one
 * team with the developer. One listTeams(org) call builds a login→teamIds map.
 */
export async function buildCostVisibility(org: string, requester: Requester): Promise<CostVisibility> {
  if (requester.authDisabled || requester.isAdmin) {
    return { canSeeCost: () => true, canSeeAnyCost: true };
  }
  if (!requester.githubLogin) {
    return { canSeeCost: () => false, canSeeAnyCost: false };
  }

  const teams = await listTeams(org) as Array<{ id: string; members: string[] }>;
  const loginToTeamIds = new Map<string, string[]>();
  for (const t of teams) {
    for (const login of t.members) {
      const arr = loginToTeamIds.get(login) ?? [];
      arr.push(t.id);
      loginToTeamIds.set(login, arr);
    }
  }

  const requesterTeams = new Set(loginToTeamIds.get(requester.githubLogin) ?? []);
  const canSeeAnyCost = requesterTeams.size > 0;
  const canSeeCost = (devLogin: string): boolean => {
    if (!canSeeAnyCost) return false;
    const devTeams = loginToTeamIds.get(devLogin) ?? [];
    return devTeams.some((t) => requesterTeams.has(t));
  };

  return { canSeeCost, canSeeAnyCost };
}

/** Drop cc_total_cost / cc_requests from developers the requester cannot see. */
export function stripDevCost<T extends { github_login: string }>(
  devs: T[],
  canSeeCost: (login: string) => boolean,
): T[] {
  return devs.map((d) => {
    if (canSeeCost(d.github_login)) return d;
    const copy: any = { ...d };
    for (const f of CC_FIELDS) delete copy[f];
    return copy;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPatterns="cost-visibility"`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost-visibility.ts src/lib/__tests__/unit/cost-visibility.test.ts
git commit -m "feat(cost): shared team-scoped cost-visibility module (GLOOK-27)"
```

---

### Task 2: Refactor `/api/auth/me` to reuse `resolveRequester`

**Files:**
- Modify: `src/app/api/auth/me/route.ts`
- Test: `src/lib/__tests__/unit/auth-me.test.ts` (existing — keep passing)

**Interfaces:**
- Consumes: `resolveRequester(headers): Promise<Requester>` (Task 1).

- [ ] **Step 1: Run the existing auth-me test to capture current behavior**

Run: `npm test -- --testPathPatterns="auth-me"`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Refactor the handler**

Replace the identity/role derivation in `src/app/api/auth/me/route.ts` with `resolveRequester`, keeping the response shape identical. New handler body:

```typescript
import { NextResponse } from 'next/server';
import { isAuthEnabled } from '@/lib/auth';
import { resolveRequester } from '@/lib/cost-visibility';
import db from '@/lib/db';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  const requester = await resolveRequester(req.headers);
  // resolveRequester returns authDisabled:false here (auth is on). A null
  // githubLogin with no admin still means "authenticated but unmapped".
  const { extractUser } = await import('@/lib/auth');
  const user = extractUser(req.headers);
  if (!user) {
    return NextResponse.json({ enabled: true, user: null });
  }

  const role = requester.isAdmin ? 'admin' : 'viewer';

  // Name/avatar for display (unchanged query, keyed off the resolved login).
  let name: string | null = user.name || null;
  let avatarUrl: string | null = null;
  let team: { name: string; color: string } | null = null;

  if (requester.githubLogin) {
    const [displayRows] = await db.execute(
      `SELECT ds.github_name, ds.avatar_url
       FROM developer_stats ds
       LEFT JOIN reports r ON r.id = ds.report_id AND r.status = 'completed'
       WHERE ds.github_login = ?
       ORDER BY r.completed_at DESC
       LIMIT 1`,
      [requester.githubLogin],
    ) as [any[], any];
    if (displayRows.length) {
      name = user.name || displayRows[0].github_name || null;
      avatarUrl = displayRows[0].avatar_url || null;
    }

    const [teamRows] = await db.execute(
      `SELECT t.name AS team_name, t.color AS team_color
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.github_login = ? LIMIT 1`,
      [requester.githubLogin],
    ) as [any[], any];
    if (teamRows.length) team = { name: teamRows[0].team_name, color: teamRows[0].team_color };
  }

  return NextResponse.json({
    enabled: true,
    user: { email: user.email, githubLogin: requester.githubLogin, name, avatarUrl, team, role },
  });
}

export const GET = withRequestLog(getHandler);
```

- [ ] **Step 3: Run the auth-me test**

Run: `npm test -- --testPathPatterns="auth-me"`
Expected: PASS (response shape unchanged). If the existing test mocked the old two-query sequence and now sees a different sequence, update the mock's `mockResolvedValueOnce` order to match: (1) `resolveRequester` login lookup, (2) display-name lookup, (3) team lookup — returning the same values the test asserts on.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/me/route.ts src/lib/__tests__/unit/auth-me.test.ts
git commit -m "refactor(auth): /api/auth/me reuses resolveRequester (GLOOK-27)"
```

---

### Task 3: Team-scope the three REST cost routes

**Files:**
- Modify: `src/app/api/report/[id]/route.ts`
- Modify: `src/app/api/report/[id]/dev/[login]/route.ts`
- Modify: `src/app/api/report/[id]/org/route.ts`
- Test: `src/lib/__tests__/unit/report-cost-gating.test.ts`

**Interfaces:**
- Consumes: `resolveRequester`, `buildCostVisibility`, `stripDevCost` (Task 1). Report objects expose `report.org` (confirmed: `getReport`/`getOrgReport`/`getDevReport` all `SELECT ... org ...` and return `report: reportRows[0]`).

- [ ] **Step 1: Write failing route tests**

Create `src/lib/__tests__/unit/report-cost-gating.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report/service', () => ({
  getReport: jest.fn(), deleteReport: jest.fn(),
  ReportNotFoundError: class ReportNotFoundError extends Error {},
}));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(),
  buildCostVisibility: jest.fn(),
  stripDevCost: jest.requireActual('@/lib/cost-visibility').stripDevCost,
}));

import { GET } from '@/app/api/report/[id]/route';
import { getReport } from '@/lib/report/service';
import { resolveRequester, buildCostVisibility } from '@/lib/cost-visibility';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request('http://localhost/api/report/r1');

beforeEach(() => jest.clearAllMocks());

it('report route strips cost for devs the requester cannot see', async () => {
  (getReport as jest.Mock).mockResolvedValue({
    report: { id: 'r1', org: 'acme' },
    developers: [
      { github_login: 'alice', cc_total_cost: 10, cc_requests: 1 },
      { github_login: 'carol', cc_total_cost: 20, cc_requests: 2 },
    ],
  });
  (resolveRequester as jest.Mock).mockResolvedValue({ githubLogin: 'alice', isAdmin: false, authDisabled: false });
  (buildCostVisibility as jest.Mock).mockResolvedValue({ canSeeCost: (l: string) => l === 'alice', canSeeAnyCost: true });

  const res = await GET(req() as any, params('r1') as any);
  const body = await res.json();
  expect(body.developers[0]).toHaveProperty('cc_total_cost', 10);
  expect(body.developers[1]).not.toHaveProperty('cc_total_cost');
  expect(buildCostVisibility).toHaveBeenCalledWith('acme', expect.objectContaining({ githubLogin: 'alice' }));
});
```

(Add analogous cases for the dev and org routes in the same file — importing their `GET`, mocking `getDevReport`/`getOrgReport` with `report.org`, and asserting: dev route strips `result.developer`+`allDevelopers` by predicate; org route strips developers AND, when `canSeeAnyCost` is false, removes `report.cc_period_start`/`cc_period_end` and sets `spendWindow` to null, but keeps them when true.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="report-cost-gating"`
Expected: FAIL (routes still use `isAdmin`).

- [ ] **Step 3: Edit `report/[id]/route.ts`**

Replace the `getHandler` cost block:

```typescript
// imports: drop isAdmin; add resolveRequester/buildCostVisibility/stripDevCost
import { requireAdmin } from '@/lib/auth';
import { resolveRequester, buildCostVisibility, stripDevCost } from '@/lib/cost-visibility';
// ...
const result = await getReport(id);
const requester = await resolveRequester(req.headers);
const { canSeeCost } = await buildCostVisibility(result.report.org, requester);
result.developers = stripDevCost(result.developers, canSeeCost);
return NextResponse.json(result);
```

(Leave `DELETE`/`requireAdmin` untouched.)

- [ ] **Step 4: Edit `report/[id]/dev/[login]/route.ts`**

Keep its `stripCc` helper for shape, but drive it by the predicate:

```typescript
import { resolveRequester, buildCostVisibility } from '@/lib/cost-visibility';
// ...
const result = await getDevReport(id, login);
const requester = await resolveRequester(req.headers);
const { canSeeCost } = await buildCostVisibility(result.report.org, requester);
if (!canSeeCost(result.developer.github_login)) result.developer = stripCc(result.developer);
result.allDevelopers = result.allDevelopers.map((d: any) => canSeeCost(d.github_login) ? d : stripCc(d));
return NextResponse.json(result);
```

- [ ] **Step 5: Edit `report/[id]/org/route.ts`**

```typescript
import { resolveRequester, buildCostVisibility, stripDevCost } from '@/lib/cost-visibility';
// ...
const result = await getOrgReport(id);
const requester = await resolveRequester(req.headers);
const { canSeeCost, canSeeAnyCost } = await buildCostVisibility(result.report.org, requester);
result.developers = stripDevCost(result.developers, canSeeCost);
if (!canSeeAnyCost) {
  const { cc_period_start, cc_period_end, ...reportRest } = result.report;
  result.report = reportRest;
  (result as any).spendWindow = null;
}
return NextResponse.json(result);
```

- [ ] **Step 6: Run route tests + full suite**

Run: `npm test -- --testPathPatterns="report-cost-gating"` → PASS.
Run: `npm test` → PASS (confirms `logger-enforcement` and existing report tests still green).

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/report/[id]/route.ts" "src/app/api/report/[id]/dev/[login]/route.ts" "src/app/api/report/[id]/org/route.ts" src/lib/__tests__/unit/report-cost-gating.test.ts
git commit -m "feat(cost): team-scope cost in the three report routes (GLOOK-27)"
```

---

### Task 4: Team-scope the MCP `query_developer_stats` tool

**Files:**
- Modify: `src/lib/mcp/queries.ts` (`queryDeveloperStats`)
- Modify: `src/lib/mcp/tools.ts` (`McpTool.handler` type, `callTool`, the `query_developer_stats` handler)
- Modify: `src/lib/mcp/protocol.ts` (`handleJsonRpc`)
- Modify: `src/app/api/mcp/route.ts` (resolve + pass requester)
- Test: `src/lib/__tests__/unit/mcp-cost-gating.test.ts`

**Interfaces:**
- Consumes: `Requester`, `buildCostVisibility`, `stripDevCost` (Task 1); `resolveRequester` (Task 1); `reportOrg(reportId)` (existing internal in `queries.ts`).
- Produces: `queryDeveloperStats(args, requester?: Requester)`; `callTool(name, args, requester?: Requester)`; `handleJsonRpc(message, requester?: Requester)`.

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/unit/mcp-cost-gating.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/teams/service', () => ({ listTeams: jest.fn() }));

import { queryDeveloperStats } from '@/lib/mcp/queries';
import db from '@/lib/db/index';
import { listTeams } from '@/lib/teams/service';

const mockExecute = db.execute as jest.Mock;
const mockListTeams = listTeams as jest.Mock;
beforeEach(() => { mockExecute.mockReset(); mockListTeams.mockReset(); });

function mockReportResolution(org = 'acme') {
  mockExecute
    .mockResolvedValueOnce([[{ id: 'r1' }], null])   // resolveReportId
    .mockResolvedValueOnce([[{ org }], null])          // reportOrg
    .mockResolvedValueOnce([[                            // developer rows
      { github_login: 'alice', impact_score: '4', cc_total_cost: '10', cc_requests: '1' },
      { github_login: 'carol', impact_score: '3', cc_total_cost: '20', cc_requests: '2' },
    ], null]);
}

it('strips cc for non-teammates when requester is a non-admin team member', async () => {
  mockReportResolution('acme');
  mockListTeams.mockResolvedValueOnce([{ id: 't1', members: ['alice'] }, { id: 't2', members: ['carol'] }]);
  const out = await queryDeveloperStats({ report_id: 'r1' }, { githubLogin: 'alice', isAdmin: false, authDisabled: false }) as any;
  const alice = out.developers.find((d: any) => d.github_login === 'alice');
  const carol = out.developers.find((d: any) => d.github_login === 'carol');
  expect(alice.cc_total_cost).toBe(10);
  expect('cc_total_cost' in carol).toBe(false);
});

it('strips ALL cc when no requester is provided (safe default)', async () => {
  mockReportResolution('acme');
  const out = await queryDeveloperStats({ report_id: 'r1' }) as any;
  expect(out.developers.every((d: any) => !('cc_total_cost' in d))).toBe(true);
});

it('admin keeps all cc', async () => {
  mockReportResolution('acme');
  const out = await queryDeveloperStats({ report_id: 'r1' }, { githubLogin: 'x', isAdmin: true, authDisabled: false }) as any;
  expect(out.developers.every((d: any) => 'cc_total_cost' in d)).toBe(true);
});
```

Note the mock call order: `queryDeveloperStats` calls `resolveReportId` (1 execute), then this task adds a `reportOrg` lookup (1 execute), then the dev-stats query (1 execute) — matching `mockReportResolution`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="mcp-cost-gating"`
Expected: FAIL (`queryDeveloperStats` ignores the second arg and returns cc for all).

- [ ] **Step 3: Edit `queryDeveloperStats` in `src/lib/mcp/queries.ts`**

Add the import at the top of the file:

```typescript
import { buildCostVisibility, stripDevCost, type Requester } from '@/lib/cost-visibility';
```

Change the signature and add gating before the return:

```typescript
export async function queryDeveloperStats(
  args: { report_id?: string; login?: string; sort_by?: string; limit?: number },
  requester?: Requester,
) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const org = await reportOrg(r.id);                 // existing helper in this file
  // ... existing sortBy / conditions / db.execute unchanged ...
  const developers = rows.map((row: any) => {
    const out = { ...row };
    for (const f of NUMERIC_DEV_FIELDS) if (out[f] != null) out[f] = Number(out[f]);
    return out;
  });

  // Team-scoped cost gating (GLOOK-27). Undefined requester → strip all cost.
  const vis = requester && org
    ? await buildCostVisibility(org, requester)
    : { canSeeCost: () => false, canSeeAnyCost: false };
  const gated = stripDevCost(developers, vis.canSeeCost);
  return { developers: gated, count: gated.length };
}
```

(If `reportOrg` is defined below `queryDeveloperStats`, it's a function declaration and hoists — no reorder needed. Verify `reportOrg` exists; it's used by `queryCommits`.)

- [ ] **Step 4: Edit `src/lib/mcp/tools.ts`**

Change the handler type and `callTool` to thread `requester`, and pass it to the one tool that needs it:

```typescript
// import
import type { Requester } from '@/lib/cost-visibility';

// interface McpTool
handler: (args: any, requester?: Requester) => Promise<any>;

// the query_developer_stats registry entry
handler: (a, requester) => queryDeveloperStats(a, requester),

// callTool
export async function callTool(name: string, args: any, requester?: Requester): Promise<any> {
  // ...existing lookup...
  return tool.handler(args, requester);   // pass requester through
}
```

- [ ] **Step 5: Edit `src/lib/mcp/protocol.ts`**

Thread `requester` into `handleJsonRpc` and the `tools/call` dispatch:

```typescript
import type { Requester } from '@/lib/cost-visibility';

export async function handleJsonRpc(message: any, requester?: Requester): Promise<RpcResult> {
  // ... in the 'tools/call' case, where it calls callTool:
  const result = await callTool(name, args, requester);
  // ... rest unchanged ...
}
```

- [ ] **Step 6: Edit `src/app/api/mcp/route.ts`**

Resolve the requester once and pass it in:

```typescript
import { resolveRequester } from '@/lib/cost-visibility';
// in postHandler, after the auth backstop, before dispatch:
const requester = await resolveRequester(req.headers);
const { status, body } = await handleJsonRpc(message, requester);
```

- [ ] **Step 7: Run MCP tests + full suite**

Run: `npm test -- --testPathPatterns="mcp-cost-gating"` → PASS.
Run: `npm test -- --testPathPatterns="mcp-"` → PASS (protocol/tools/route/queries tests still green — the extra optional arg is backward-compatible).

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/queries.ts src/lib/mcp/tools.ts src/lib/mcp/protocol.ts "src/app/api/mcp/route.ts" src/lib/__tests__/unit/mcp-cost-gating.test.ts
git commit -m "feat(mcp): team-scope cost in query_developer_stats (GLOOK-27)"
```

---

### Task 5: Frontend — render hidden cost as "–", presence-driven display

**Files:**
- Modify: `src/lib/teams/team-aggregator.ts`
- Modify: `src/app/report/[id]/team/dev-table.tsx`
- Modify: `src/app/report/[id]/team/team-table.tsx`
- Modify: `src/app/report/[id]/org/page.tsx`
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`
- Test: `src/lib/__tests__/unit/team-aggregator-cost.test.ts`

**Interfaces:**
- Consumes: developer objects where `cc_total_cost` is `undefined` when hidden (Tasks 3–4 strip it).
- Produces: `AggregatorTeam.cc_total_cost: number | null` (null = "some member hidden").

- [ ] **Step 1: Write failing aggregator test**

Create `src/lib/__tests__/unit/team-aggregator-cost.test.ts`:

```typescript
import { aggregateTeams } from '@/lib/teams/team-aggregator';

const teams = [{ id: 't1', name: 'A', color: '#111', members: ['alice', 'bob'] }];

it('team total is null when any member cost is hidden', () => {
  const devs = [
    { github_login: 'alice', cc_total_cost: 100 },
    { github_login: 'bob' },  // cost hidden (stripped)
  ] as any;
  const [row] = aggregateTeams(devs, teams as any);
  expect(row.cc_total_cost).toBeNull();
});

it('team total is the real sum when all members visible', () => {
  const devs = [
    { github_login: 'alice', cc_total_cost: 100 },
    { github_login: 'bob', cc_total_cost: 50 },
  ] as any;
  const [row] = aggregateTeams(devs, teams as any);
  expect(row.cc_total_cost).toBe(150);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="team-aggregator-cost"`
Expected: FAIL (current code sums `?? 0`, yielding 100 not null).

- [ ] **Step 3: Edit `src/lib/teams/team-aggregator.ts`**

Change `TeamRow.cc_total_cost` / `AggregatorTeam.cc_total_cost` type to `number | null`. In the per-team member loop, track hidden members and null out the total:

```typescript
// in the loop over a team's developers (near line 76-83):
let cc_total_cost: number | null = 0;
let ccHidden = false;
for (const d of teamDevs) {
  // ...existing sums...
  if (d.cc_total_cost == null) ccHidden = true;
  else if (cc_total_cost !== null) cc_total_cost += Number(d.cc_total_cost);
}
if (ccHidden) cc_total_cost = null;
// ...include cc_total_cost in the returned row unchanged...
```

- [ ] **Step 4: Run aggregator test**

Run: `npm test -- --testPathPatterns="team-aggregator-cost"`
Expected: PASS.

- [ ] **Step 5: Presence-driven display in the four UI files**

`dev-table.tsx` (line ~60): drop the `canAct &&`:
```typescript
const hasSpend = developers.some(d => d.cc_total_cost != null);
```
And where a per-row spend cell renders, show `d.cc_total_cost != null ? \`$${(Number(d.cc_total_cost)/100).toLocaleString()}\` : '–'`.

`team-table.tsx` (line ~44): `const hasSpend = rows.some(r => r.cc_total_cost != null);`
Cell (line ~146): `{hasSpend && <td …>{row.cc_total_cost == null ? '–' : \`$${Math.round(row.cc_total_cost/100).toLocaleString()}\`}</td>}`

`org/page.tsx` (line ~126): `const hasSpend = developers.some(d => d.cc_total_cost != null);` (the `SpendTab` already only renders when `hasSpend`). Inside `SpendTab`, render any per-dev cost that is `null`/absent as "–".

`dev/[login]/page.tsx` (line ~253): `{dev.cc_total_cost != null && (` … tile … `)}` — remove the `canAct &&` gate; the tile shows iff cost is present in the payload.

**Do not change** the "Pull from Anthropic" button gate — it stays on `canAct`/admin.

- [ ] **Step 6: Type-check + full suite**

Run: `npx tsc --noEmit` → no new errors (the `number | null` change may surface call sites; fix them to accept null).
Run: `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/teams/team-aggregator.ts "src/app/report/[id]/team/dev-table.tsx" "src/app/report/[id]/team/team-table.tsx" "src/app/report/[id]/org/page.tsx" "src/app/report/[id]/dev/[login]/page.tsx" src/lib/__tests__/unit/team-aggregator-cost.test.ts
git commit -m "feat(cost): render hidden cost as '-' and drive spend display by payload (GLOOK-27)"
```

---

### Task 6: DoD leak-surface guard tests + final verification

**Files:**
- Test: `src/lib/__tests__/unit/cost-leak-surfaces.test.ts`

**Interfaces:** none (assertions over existing code).

- [ ] **Step 1: Write guard tests**

Create `src/lib/__tests__/unit/cost-leak-surfaces.test.ts` — assert the export header list and the team-pulse SQL never include cost, so a future edit that adds cost fails loudly:

```typescript
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

it('CSV/Sheets export builds no cost columns', () => {
  const src = read('src/app/report/[id]/team/page.tsx');
  // The export header arrays must not reference cost fields.
  expect(src).not.toMatch(/headers[\s\S]*cc_total_cost/);
  expect(src).not.toMatch(/headers[\s\S]*Spend/);
});

it('team-pulse data layer selects no cost fields', () => {
  const src = read('src/lib/team-pulse/data.ts');
  expect(src).not.toMatch(/cc_total_cost|cc_requests|cc_period/);
});
```

- [ ] **Step 2: Run to verify it passes (guard confirms current safe state)**

Run: `npm test -- --testPathPatterns="cost-leak-surfaces"`
Expected: PASS (export + team-pulse carry no cost today).

- [ ] **Step 3: Full verification**

Run: `npm test` → all suites PASS.
Run: `npx tsc --noEmit` → clean (ignore any pre-existing unrelated errors in untracked `* 2.ts` duplicate files).

- [ ] **Step 4: Manual smoke (mock mode) — optional but recommended**

Start `DB_TYPE=sqlite npm run dev:mock`, seed if needed, and with `AUTH_ENABLED` unset confirm cost still shows everywhere (auth-off = omniscient). This confirms no regression for the default local experience.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/unit/cost-leak-surfaces.test.ts
git commit -m "test(cost): guard export + team-pulse against cost leaks (GLOOK-27)"
```

---

## Self-Review

**Spec coverage:**
- Shared module (resolveRequester/buildCostVisibility/stripDevCost) → Task 1 ✓
- `/api/auth/me` reuse → Task 2 ✓
- 3 REST routes per-dev strip + org report-level `canSeeAnyCost` gating → Task 3 ✓
- MCP `query_developer_stats` team-scoped (close the bypass) → Task 4 ✓
- Frontend "–" + aggregator null + presence-driven display + Pull stays admin → Task 5 ✓
- Leak surfaces (export, team-pulse) guarded; MCP covered in Task 4 → Task 6 ✓
- Trust model edges (auth-off omniscient, unmapped sees none, multi-team intersection) → Task 1 tests ✓
- Out-of-scope (`/api/teams`, `/api/mcp` auth gaps) → untouched ✓

**Placeholder scan:** no TBD/TODO; every code step shows concrete code or exact edit; commands have expected output.

**Type consistency:** `Requester { githubLogin, isAdmin, authDisabled }` used identically in Tasks 1–4. `CostVisibility { canSeeCost, canSeeAnyCost }` consistent. `stripDevCost(devs, canSeeCost)` signature matches all call sites. `AggregatorTeam.cc_total_cost: number | null` flows to `team-table.tsx` rendering (Task 5).

**Note (spec refinement):** the spec's illustrative `Requester` included `teamIds`; the plan moves team derivation into `buildCostVisibility` (one `listTeams` call) so `resolveRequester` needs no org and is reusable by `/api/auth/me`. Behavior/DoD unchanged.
