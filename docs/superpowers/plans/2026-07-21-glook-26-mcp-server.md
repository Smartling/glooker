# Glooker MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Glooker's data (raw commits/PRs/Jiras, developer stats, and LLM-generated project/team/highlight analysis) as a read-only MCP server queryable from Claude Code and Claude.ai, with cross-report time-series analysis.

**Architecture:** A hand-rolled, stateless Streamable-HTTP MCP endpoint at `/api/mcp`. Three thin layers: an HTTP route (`route.ts`), a JSON-RPC protocol handler (`protocol.ts`), and a tool registry (`tools.ts`). Tool handlers call new cross-report query functions (`queries.ts`) and existing service functions. Two existing routes (`project-insights`, `release-notes`) are refactored to extract their inline logic into shared services so the route and the MCP tool share one implementation.

**Tech Stack:** Next.js 15 App Router (Node runtime), TypeScript, the existing `@/lib/db` abstraction (SQLite/MySQL), Jest + ts-jest. No new dependencies.

## Global Constraints

- **No new dependencies.** Tools use JSON Schema (like `src/lib/chat/tools.ts`), not zod. The MCP protocol is hand-rolled JSON-RPC, not `@modelcontextprotocol/sdk`.
- **Read-only.** No MCP tool mutates the DB or triggers report runs.
- **All API route handlers must be wrapped with `withRequestLog()`** from `@/lib/logger` (enforced by `logger-enforcement.test.ts`).
- **`DECIMAL`/`REAL` columns can come back as strings** — always `Number()` before arithmetic or `.toFixed()`.
- **`@octokit/rest` is ESM-only** — any test whose import chain reaches `github.ts` must `jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }))` before imports.
- **Tests mock the DB**: `jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }))`.
- **DB dialect safety**: only plain parameterized `SELECT ... WHERE ... ORDER BY ... LIMIT ?` SQL in new query functions — no window functions, no MySQL-only syntax. Dedup and bucketing happen in JS.
- **`LIMIT ?` params are passed as strings** (e.g. `String(limit)`) — matches the existing `chat/tools.ts` convention.
- **Cross-report dedup rule**: dedup by `commit_sha` / `issue_key`, keep the row with the earliest `committed_at` / `resolved_at`; use that timestamp as the timeline. Report-scoped calls (explicit `report_id`) skip dedup.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/projects/insights.ts` | NEW — `getProjectInsights(reportId?)`: report resolution, DB fetch, LLM clustering, enrichment, caching (extracted from the route) |
| `src/app/api/project-insights/route.ts` | MODIFY — thin wrapper: call `getProjectInsights()`, return `NextResponse.json` |
| `src/lib/release-notes/service.ts` | NEW — `getReleaseNotes()`: GitHub fetch, LLM summary, caching (extracted from the route) |
| `src/app/api/release-notes/route.ts` | MODIFY — thin wrapper |
| `src/lib/mcp/resolve.ts` | NEW — `resolveReportId(reportId?)` |
| `src/lib/mcp/dedup.ts` | NEW — pure helpers `dedupByKeyEarliest`, `bucketByPeriod` |
| `src/lib/mcp/queries.ts` | NEW — cross-report query functions used by tool handlers |
| `src/lib/mcp/tools.ts` | NEW — `MCP_TOOLS` registry (JSON-Schema inputSchema + handler) + `callTool` |
| `src/lib/mcp/protocol.ts` | NEW — `handleJsonRpc(message)` dispatch |
| `src/app/api/mcp/route.ts` | NEW — POST/GET/OPTIONS transport, identity logging, `withRequestLog()` |
| `src/lib/__tests__/unit/mcp-dedup.test.ts` | NEW |
| `src/lib/__tests__/unit/mcp-queries.test.ts` | NEW |
| `src/lib/__tests__/unit/mcp-tools.test.ts` | NEW |
| `src/lib/__tests__/unit/mcp-protocol.test.ts` | NEW |
| `scripts/mock-identities.ts` / `scripts/seed-data.ts` | VERIFY — existing seed already covers the tables the tools read; no new entities |

---

### Task 1: Extract `getProjectInsights()` from the project-insights route

**Files:**
- Create: `src/lib/projects/insights.ts`
- Modify: `src/app/api/project-insights/route.ts`
- Test: `src/lib/__tests__/unit/mcp-project-insights.test.ts`

**Interfaces:**
- Produces: `getProjectInsights(reportId?: string): Promise<ProjectInsightsResult>` where
  `ProjectInsightsResult = { available: false } | { available: true; report: { id: string; org: string; periodDays: number; createdAt: string }; projects: any[]; untracked_work: any[]; otherTotals: { jiras: number; prs: number }; otherDetails: { jira_details: any[]; prs: any[] }; totals: { commits: number; prs: number; jiras: number }; cached: boolean }` and the error case throws (route maps to 500).

- [ ] **Step 1: Create the service file by moving the route body verbatim, parameterized by `reportId`**

Create `src/lib/projects/insights.ts`. Copy the entire logic from the current `getHandler` in `src/app/api/project-insights/route.ts`, with these mechanical changes:
- Drop the `NextResponse` import; import `db`, `getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit`, `renderInflightBlock`, and the two `TeamProjectInflight*` types exactly as the route does now.
- Rename the function to `export async function getProjectInsights(reportId?: string)`.
- Replace the "find latest report" query so it honors an explicit `reportId`:

```typescript
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit } from '@/lib/llm-provider';
import { renderInflightBlock } from '@/lib/team-pulse/render';
import type { TeamProjectInflightPr, TeamProjectInflightBranch } from '@/lib/team-pulse/data';

const INSIGHTS_CACHE_VERSION = 3;

export async function getProjectInsights(reportId?: string) {
  let report: any;
  if (reportId) {
    const [rows] = await db.execute(
      `SELECT id, org, period_days, created_at FROM reports WHERE id = ?`,
      [reportId],
    ) as [any[], any];
    if (!rows.length) return { available: false };
    report = rows[0];
  } else {
    const [latestRows] = await db.execute(
      `SELECT id, org, period_days, created_at FROM reports
       WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
      [],
    ) as [any[], any];
    if (!latestRows.length) return { available: false };
    report = latestRows[0];
  }
  // ... REST OF THE CURRENT ROUTE BODY, UNCHANGED, EXCEPT:
  //   - every `return NextResponse.json(X)` becomes `return X`
  //   - the final `catch (err)` block re-throws instead of returning a 500:
  //       } catch (err) { throw err instanceof Error ? err : new Error(String(err)); }
}
```

Everything between "Fetch all data once" and the final return stays byte-for-byte identical (the jira-count guard, cache read, LLM call, enrichment, `otherDetails`, cache write). Only the two edits above (report resolution at the top; `NextResponse.json(x)` → `x`; catch re-throws) change.

- [ ] **Step 2: Rewrite the route as a thin wrapper**

Replace the entire contents of `src/app/api/project-insights/route.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { getProjectInsights } from '@/lib/projects/insights';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  try {
    return NextResponse.json(await getProjectInsights());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withRequestLog(getHandler);
```

- [ ] **Step 3: Write a test for the early-return paths (mocked DB)**

Create `src/lib/__tests__/unit/mcp-project-insights.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import { getProjectInsights } from '@/lib/projects/insights';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

describe('getProjectInsights', () => {
  beforeEach(() => mockExecute.mockReset());

  it('returns { available: false } when the explicit report id does not exist', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // report lookup empty
    const result = await getProjectInsights('missing-id');
    expect(result).toEqual({ available: false });
  });

  it('returns { available: false } when there are no completed reports', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // latest lookup empty
    const result = await getProjectInsights();
    expect(result).toEqual({ available: false });
  });

  it('returns { available: false } when the report has no jira issues', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, created_at: '2026-01-01' }], null])
      .mockResolvedValueOnce([[{ cnt: 0 }], null]); // jira count
    const result = await getProjectInsights('r1');
    expect(result).toEqual({ available: false });
  });
});
```

- [ ] **Step 4: Run the test and the existing suite**

Run: `npm test -- --testPathPattern="mcp-project-insights"`
Expected: PASS (3 tests).
Run: `npm test`
Expected: full suite PASS — confirms the route refactor didn't break `logger-enforcement.test.ts` or any project-insights consumer.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/insights.ts src/app/api/project-insights/route.ts src/lib/__tests__/unit/mcp-project-insights.test.ts
git commit -m "refactor(projects): extract getProjectInsights() from route (GLOOK-26)"
```

---

### Task 2: Extract `getReleaseNotes()` from the release-notes route

**Files:**
- Create: `src/lib/release-notes/service.ts`
- Modify: `src/app/api/release-notes/route.ts`
- Test: `src/lib/__tests__/unit/mcp-release-notes.test.ts`

**Interfaces:**
- Produces: `getReleaseNotes(): Promise<{ available: false } | { available: true; summary: string; commitCount: number; generatedAt: string; latestSha: string; cached: boolean }>`

- [ ] **Step 1: Create the service file**

Create `src/lib/release-notes/service.ts` by moving the route body, replacing every `return NextResponse.json(X)` with `return X` and dropping the `NextResponse`/`withRequestLog` imports:

```typescript
import db from '@/lib/db';
import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit } from '@/lib/llm-provider';

const REPO_OWNER = 'Smartling';
const REPO_NAME = 'glooker';
const DAYS = 14;

export async function getReleaseNotes() {
  try {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) return { available: false as const };

    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?since=${since}&per_page=100`,
      { headers: { Authorization: `token ${ghToken}`, Accept: 'application/vnd.github.v3+json' }, next: { revalidate: 3600 } },
    );
    if (!res.ok) return { available: false as const };

    const commits = await res.json();
    if (!Array.isArray(commits) || commits.length === 0) return { available: false as const };

    const latestSha = commits[0].sha;
    const [cached] = await db.execute(
      `SELECT summary, commit_count, generated_at FROM release_notes WHERE latest_commit_sha = ?`,
      [latestSha],
    ) as [any[], any];
    if (cached.length > 0) {
      return {
        available: true as const,
        summary: cached[0].summary,
        commitCount: cached[0].commit_count,
        generatedAt: cached[0].generated_at,
        latestSha,
        cached: true,
      };
    }

    const commitList = commits.map((c: any) => `- ${c.commit.message.split('\n')[0]}`).join('\n');
    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.3,
      ...tokenLimit(512),
      messages: [
        { role: 'system', content: `You are a technical writer producing concise release notes for Glooker, a developer impact analytics tool. Write 3-6 bullet points summarizing the most notable changes. Each bullet should be one short sentence. Group related commits. Skip merge commits, version bumps, and trivial changes. Use past tense ("Added", "Fixed", "Improved"). Return plain text with bullet points using "•" character, no markdown.` },
        { role: 'user', content: `Here are the ${commits.length} commits from the last ${DAYS} days:\n\n${commitList}` },
      ],
      ...extraBodyProps(),
    } as any);

    const summary = (response.choices[0].message.content || '').trim();
    await db.execute(
      `INSERT INTO release_notes (latest_commit_sha, summary, commit_count)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), commit_count = VALUES(commit_count), generated_at = NOW()`,
      [latestSha, summary, commits.length],
    );

    return { available: true as const, summary, commitCount: commits.length, generatedAt: new Date().toISOString(), latestSha, cached: false };
  } catch (err) {
    console.error('[release-notes]', err);
    return { available: false as const };
  }
}
```

- [ ] **Step 2: Rewrite the route as a thin wrapper**

Replace `src/app/api/release-notes/route.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { getReleaseNotes } from '@/lib/release-notes/service';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  return NextResponse.json(await getReleaseNotes());
}

export const GET = withRequestLog(getHandler);
```

- [ ] **Step 3: Write a test (mocked DB, no GH token → available:false)**

Create `src/lib/__tests__/unit/mcp-release-notes.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { getReleaseNotes } from '@/lib/release-notes/service';

describe('getReleaseNotes', () => {
  const original = process.env.GITHUB_TOKEN;
  afterEach(() => { process.env.GITHUB_TOKEN = original; });

  it('returns { available: false } when GITHUB_TOKEN is unset', async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await getReleaseNotes();
    expect(result).toEqual({ available: false });
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern="mcp-release-notes"`
Expected: PASS (1 test).
Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/release-notes/service.ts src/app/api/release-notes/route.ts src/lib/__tests__/unit/mcp-release-notes.test.ts
git commit -m "refactor(release-notes): extract getReleaseNotes() from route (GLOOK-26)"
```

---

### Task 3: MCP pure helpers — `resolveReportId`, `dedupByKeyEarliest`, `bucketByPeriod`

**Files:**
- Create: `src/lib/mcp/resolve.ts`
- Create: `src/lib/mcp/dedup.ts`
- Test: `src/lib/__tests__/unit/mcp-dedup.test.ts`

**Interfaces:**
- Produces:
  - `resolveReportId(reportId?: string): Promise<{ id: string } | { error: string }>` — explicit id validated to exist; else latest completed; `{ error: 'no completed reports' }` when none.
  - `dedupByKeyEarliest<T>(rows: T[], keyField: keyof T, tsField: keyof T): T[]` — one row per key, the one with the earliest non-null timestamp; rows with a null/empty key are kept as-is (not collapsed).
  - `bucketByPeriod<T>(rows: T[], tsField: keyof T, period: 'week' | 'month'): { bucket: string; count: number; rows: T[] }[]` — buckets sorted ascending; `bucket` is an ISO date (`YYYY-MM-DD`) for the period start (Monday for week, first-of-month for month); rows with an unparseable timestamp are dropped.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/lib/__tests__/unit/mcp-dedup.test.ts`:

```typescript
import { dedupByKeyEarliest, bucketByPeriod } from '@/lib/mcp/dedup';

describe('dedupByKeyEarliest', () => {
  it('keeps the earliest-timestamp row per key', () => {
    const rows = [
      { sha: 'a', ts: '2026-03-10T00:00:00Z', v: 'late' },
      { sha: 'a', ts: '2026-01-05T00:00:00Z', v: 'early' },
      { sha: 'b', ts: '2026-02-01T00:00:00Z', v: 'only' },
    ];
    const out = dedupByKeyEarliest(rows, 'sha', 'ts');
    expect(out).toHaveLength(2);
    expect(out.find(r => r.sha === 'a')?.v).toBe('early');
    expect(out.find(r => r.sha === 'b')?.v).toBe('only');
  });

  it('does not collapse rows whose key is null or empty', () => {
    const rows = [
      { key: null, ts: '2026-01-01T00:00:00Z' },
      { key: '',   ts: '2026-01-02T00:00:00Z' },
      { key: null, ts: '2026-01-03T00:00:00Z' },
    ];
    expect(dedupByKeyEarliest(rows, 'key', 'ts')).toHaveLength(3);
  });

  it('treats a null timestamp as latest (loses to any real timestamp)', () => {
    const rows = [
      { sha: 'a', ts: null, v: 'null-ts' },
      { sha: 'a', ts: '2026-01-01T00:00:00Z', v: 'real' },
    ];
    expect(dedupByKeyEarliest(rows, 'sha', 'ts')[0].v).toBe('real');
  });
});

describe('bucketByPeriod', () => {
  it('buckets by ISO week (Monday start) ascending', () => {
    const rows = [
      { ts: '2026-01-14T12:00:00Z' }, // Wed → week of Mon 2026-01-12
      { ts: '2026-01-12T00:00:00Z' }, // Mon → same week
      { ts: '2026-01-05T00:00:00Z' }, // Mon → week of 2026-01-05
    ];
    const out = bucketByPeriod(rows, 'ts', 'week');
    expect(out.map(b => b.bucket)).toEqual(['2026-01-05', '2026-01-12']);
    expect(out[1].count).toBe(2);
  });

  it('buckets by month (first-of-month) ascending', () => {
    const rows = [
      { ts: '2026-02-20T00:00:00Z' },
      { ts: '2026-01-31T00:00:00Z' },
      { ts: '2026-02-01T00:00:00Z' },
    ];
    const out = bucketByPeriod(rows, 'ts', 'month');
    expect(out.map(b => b.bucket)).toEqual(['2026-01-01', '2026-02-01']);
    expect(out[1].count).toBe(2);
  });

  it('drops rows with an unparseable timestamp', () => {
    const rows = [{ ts: 'not-a-date' }, { ts: '2026-01-05T00:00:00Z' }];
    expect(bucketByPeriod(rows, 'ts', 'week')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="mcp-dedup"`
Expected: FAIL — "Cannot find module '@/lib/mcp/dedup'".

- [ ] **Step 3: Implement `src/lib/mcp/dedup.ts`**

```typescript
/** One row per key, keeping the row with the earliest non-null timestamp.
 *  Rows whose key is null/empty are never collapsed (returned as-is). */
export function dedupByKeyEarliest<T>(rows: T[], keyField: keyof T, tsField: keyof T): T[] {
  const best = new Map<string, T>();
  const passthrough: T[] = [];
  const ms = (r: T): number => {
    const t = r[tsField] as unknown as string | null;
    const n = t ? new Date(t).getTime() : NaN;
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n; // null/invalid ts = latest
  };
  for (const r of rows) {
    const k = r[keyField] as unknown as string | null;
    if (k === null || k === undefined || k === '') { passthrough.push(r); continue; }
    const existing = best.get(k);
    if (!existing || ms(r) < ms(existing)) best.set(k, r);
  }
  return [...best.values(), ...passthrough];
}

function periodStartISO(d: Date, period: 'week' | 'month'): string {
  if (period === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  // ISO week: Monday start. getUTCDay(): 0=Sun..6=Sat.
  const day = d.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1); // days since Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Group rows into time buckets (week=Monday start, month=first-of-month), ascending.
 *  Rows with an unparseable timestamp are dropped. */
export function bucketByPeriod<T>(
  rows: T[], tsField: keyof T, period: 'week' | 'month',
): { bucket: string; count: number; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const raw = r[tsField] as unknown as string | null;
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = periodStartISO(d, period);
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, bucketRows]) => ({ bucket, count: bucketRows.length, rows: bucketRows }));
}
```

- [ ] **Step 4: Implement `src/lib/mcp/resolve.ts`**

```typescript
import db from '@/lib/db';

/** Resolve a report id: validate an explicit id, or fall back to the latest completed report. */
export async function resolveReportId(reportId?: string): Promise<{ id: string } | { error: string }> {
  if (reportId) {
    const [rows] = await db.execute(
      `SELECT id FROM reports WHERE id = ?`, [reportId],
    ) as [any[], any];
    if (!rows.length) return { error: `report not found: ${reportId}` };
    return { id: rows[0].id };
  }
  const [rows] = await db.execute(
    `SELECT id FROM reports WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [],
  ) as [any[], any];
  if (!rows.length) return { error: 'no completed reports' };
  return { id: rows[0].id };
}
```

- [ ] **Step 5: Run the dedup test to verify it passes**

Run: `npm test -- --testPathPattern="mcp-dedup"`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/resolve.ts src/lib/mcp/dedup.ts src/lib/__tests__/unit/mcp-dedup.test.ts
git commit -m "feat(mcp): add resolveReportId + dedup/bucket helpers (GLOOK-26)"
```

---

### Task 4: MCP query functions (raw entities + discovery + epics)

**Files:**
- Create: `src/lib/mcp/queries.ts`
- Test: `src/lib/__tests__/unit/mcp-queries.test.ts`

**Interfaces:**
- Consumes: `resolveReportId` (Task 3), `dedupByKeyEarliest` (Task 3).
- Produces (all return plain JSON-serializable objects; on missing report they return `{ error: string }`):
  - `listReports(args: { org?: string; status?: string; limit?: number }): Promise<{ reports: any[] }>`
  - `getOrgSummaryTool(args: { report_id?: string }): Promise<any>`
  - `queryCommits(args: { report_id?: string; login?: string; repo?: string; type?: string; since?: string; until?: string; min_complexity?: number; ai_only?: boolean; limit?: number }): Promise<{ commits: any[]; count: number }>`
  - `queryJiraIssues(args: { report_id?: string; login?: string; project_key?: string; issue_type?: string; status?: string; since?: string; until?: string; limit?: number }): Promise<{ issues: any[]; count: number }>`
  - `queryDeveloperStats(args: { report_id?: string; login?: string; sort_by?: string; limit?: number }): Promise<{ developers: any[]; count: number }>`
  - `queryUnmergedWork(args: { report_id?: string; login?: string; repo?: string }): Promise<{ prs: any[]; branches: any[] }>`
  - `getEpicSummaries(args: { org?: string; epic_key?: string }): Promise<{ epics: any[] }>`
  - `MAX_ROWS = 500` constant (exported).

Cross-report semantics: when `report_id` is **omitted**, `queryCommits`/`queryJiraIssues` query across **all** reports for the resolved report's org, then dedup by `commit_sha`/`issue_key` (earliest timestamp). When `report_id` is provided, they filter to that report only and skip dedup.

- [ ] **Step 1: Write the failing tests (mocked DB)**

Create `src/lib/__tests__/unit/mcp-queries.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { queryCommits, queryJiraIssues, queryDeveloperStats, listReports, getEpicSummaries } from '@/lib/mcp/queries';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('listReports', () => {
  it('returns reports without needing a report id', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: 'x', completed_at: 'y' }], null]);
    const out = await listReports({ limit: 5 });
    expect(out.reports).toHaveLength(1);
    // limit passed as string, capped
    const params = mockExecute.mock.calls[0][1];
    expect(params).toContain('5');
  });
});

describe('queryCommits', () => {
  it('errors when no completed report exists and none specified', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // resolveReportId → none
    expect(await queryCommits({})).toEqual({ error: 'no completed reports' });
  });

  it('report-scoped: filters to one report and does NOT dedup', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId (explicit)
      .mockResolvedValueOnce([[                                  // org lookup for that report
        { org: 'acme' }], null])
      .mockResolvedValueOnce([[                                  // rows
        { commit_sha: 'a', committed_at: '2026-01-02', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
        { commit_sha: 'a', committed_at: '2026-01-01', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
      ], null]);
    const out = await queryCommits({ report_id: 'r1' });
    expect(out.count).toBe(2); // duplicates preserved when report-scoped
  });

  it('cross-report: dedups by commit_sha keeping earliest committed_at', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId (latest completed)
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // org lookup
      .mockResolvedValueOnce([[                                  // rows across reports
        { commit_sha: 'a', committed_at: '2026-03-01', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
        { commit_sha: 'a', committed_at: '2026-01-01', repo: 'x', github_login: 'u', type: 'feature', lines_added: 1, lines_removed: 0 },
        { commit_sha: 'b', committed_at: '2026-02-01', repo: 'x', github_login: 'u', type: 'bug', lines_added: 2, lines_removed: 1 },
      ], null]);
    const out = await queryCommits({});
    expect(out.count).toBe(2);
    expect(out.commits.find((c: any) => c.commit_sha === 'a').committed_at).toBe('2026-01-01');
  });
});

describe('queryDeveloperStats', () => {
  it('coerces numeric string columns and sorts by a safe metric', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ github_login: 'u', impact_score: '4.5', total_commits: '10' }], null]);
    const out = await queryDeveloperStats({ report_id: 'r1', sort_by: 'impact_score' });
    expect(out.developers[0].impact_score).toBe(4.5);
    expect(typeof out.developers[0].impact_score).toBe('number');
  });

  it('rejects an unsafe sort_by and falls back to impact_score', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1' }], null])
      .mockResolvedValueOnce([[], null]);
    await queryDeveloperStats({ report_id: 'r1', sort_by: 'name; DROP TABLE reports' });
    const sql = mockExecute.mock.calls[1][0] as string;
    expect(sql).toContain('ORDER BY ds.impact_score');
  });
});

describe('queryJiraIssues', () => {
  it('cross-report dedups by issue_key keeping earliest resolved_at', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // org lookup
      .mockResolvedValueOnce([[
        { issue_key: 'K-1', resolved_at: '2026-03-01', project_key: 'K' },
        { issue_key: 'K-1', resolved_at: '2026-01-01', project_key: 'K' },
      ], null]);
    const out = await queryJiraIssues({});
    expect(out.count).toBe(1);
    expect(out.issues[0].resolved_at).toBe('2026-01-01');
  });
});

describe('getEpicSummaries', () => {
  it('lists epics for an org when no epic_key given', async () => {
    mockExecute.mockResolvedValueOnce([[{ epic_key: 'E-1', org: 'acme', resolved_jiras: 3, remaining_jiras: 1, commit_count: 12 }], null]);
    const out = await getEpicSummaries({ org: 'acme' });
    expect(out.epics).toHaveLength(1);
    expect(out.epics[0].epic_key).toBe('E-1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern="mcp-queries"`
Expected: FAIL — "Cannot find module '@/lib/mcp/queries'".

- [ ] **Step 3: Implement `src/lib/mcp/queries.ts`**

```typescript
import db from '@/lib/db';
import { resolveReportId } from './resolve';
import { dedupByKeyEarliest } from './dedup';

export const MAX_ROWS = 500;

const clampLimit = (raw: unknown, def: number) => String(Math.min(Number(raw) || def, MAX_ROWS));

// Resolve the org of the report we are anchored to (for cross-report queries).
async function reportOrg(reportId: string): Promise<string | null> {
  const [rows] = await db.execute(`SELECT org FROM reports WHERE id = ?`, [reportId]) as [any[], any];
  return rows[0]?.org ?? null;
}

export async function listReports(args: { org?: string; status?: string; limit?: number }) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (args.org) { conditions.push('org = ?'); params.push(args.org); }
  if (args.status) { conditions.push('status = ?'); params.push(args.status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(clampLimit(args.limit, 50));
  const [rows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at
     FROM reports ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  ) as [any[], any];
  return { reports: rows };
}

export async function getOrgSummaryTool(args: { report_id?: string }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const [report] = await db.execute(
    `SELECT id, org, period_days, created_at, completed_at FROM reports WHERE id = ?`, [r.id],
  ) as [any[], any];
  const [stats] = await db.execute(
    `SELECT COUNT(*) AS dev_count, SUM(total_commits) AS total_commits, SUM(total_prs) AS total_prs,
            SUM(lines_added) AS total_lines_added, SUM(lines_removed) AS total_lines_removed,
            AVG(avg_complexity) AS avg_complexity, AVG(impact_score) AS avg_impact,
            AVG(pr_percentage) AS avg_pr_pct, AVG(ai_percentage) AS avg_ai_pct
     FROM developer_stats WHERE report_id = ?`, [r.id],
  ) as [any[], any];
  const [jira] = await db.execute(
    `SELECT COUNT(*) AS total_issues, SUM(story_points) AS total_story_points,
            COUNT(DISTINCT project_key) AS project_count
     FROM jira_issues WHERE report_id = ?`, [r.id],
  ) as [any[], any];
  const s = stats[0] || {};
  return {
    report: report[0],
    developers: Number(s.dev_count ?? 0),
    total_commits: Number(s.total_commits ?? 0),
    total_prs: Number(s.total_prs ?? 0),
    total_lines_added: Number(s.total_lines_added ?? 0),
    total_lines_removed: Number(s.total_lines_removed ?? 0),
    avg_complexity: Number(s.avg_complexity ?? 0),
    avg_impact: Number(s.avg_impact ?? 0),
    avg_pr_percentage: Number(s.avg_pr_pct ?? 0),
    avg_ai_percentage: Number(s.avg_ai_pct ?? 0),
    jira: {
      total_issues: Number(jira[0]?.total_issues ?? 0),
      total_story_points: Number(jira[0]?.total_story_points ?? 0),
      project_count: Number(jira[0]?.project_count ?? 0),
    },
  };
}

export async function queryCommits(args: {
  report_id?: string; login?: string; repo?: string; type?: string;
  since?: string; until?: string; min_complexity?: number; ai_only?: boolean; limit?: number;
}) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const crossReport = !args.report_id;

  const conditions: string[] = [];
  const params: any[] = [];
  if (crossReport) {
    const org = await reportOrg(r.id);
    conditions.push(`ca.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')`);
    params.push(org);
  } else {
    conditions.push('ca.report_id = ?');
    params.push(r.id);
  }
  if (args.login) { conditions.push('ca.github_login = ?'); params.push(args.login); }
  if (args.repo) { conditions.push('ca.repo = ?'); params.push(args.repo); }
  if (args.type) { conditions.push('ca.type = ?'); params.push(args.type); }
  if (args.since) { conditions.push('ca.committed_at >= ?'); params.push(args.since); }
  if (args.until) { conditions.push('ca.committed_at <= ?'); params.push(args.until); }
  if (args.min_complexity != null) { conditions.push('ca.complexity >= ?'); params.push(args.min_complexity); }
  if (args.ai_only) { conditions.push('(ca.ai_co_authored = 1 OR ca.maybe_ai = 1)'); }
  params.push(clampLimit(args.limit, 100));

  const [rows] = await db.execute(
    `SELECT ca.commit_sha, ca.repo, ca.github_login, ca.pr_number, ca.commit_message,
            ca.type, ca.complexity, ca.risk_level, ca.lines_added, ca.lines_removed,
            ca.ai_co_authored, ca.maybe_ai, ca.committed_at
     FROM commit_analyses ca
     WHERE ${conditions.join(' AND ')}
     ORDER BY ca.committed_at DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  const commits = crossReport ? dedupByKeyEarliest(rows, 'commit_sha', 'committed_at') : rows;
  return { commits, count: commits.length };
}

export async function queryJiraIssues(args: {
  report_id?: string; login?: string; project_key?: string; issue_type?: string;
  status?: string; since?: string; until?: string; limit?: number;
}) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const crossReport = !args.report_id;

  const conditions: string[] = [];
  const params: any[] = [];
  if (crossReport) {
    const org = await reportOrg(r.id);
    conditions.push(`ji.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')`);
    params.push(org);
  } else {
    conditions.push('ji.report_id = ?');
    params.push(r.id);
  }
  if (args.login) { conditions.push('ji.github_login = ?'); params.push(args.login); }
  if (args.project_key) { conditions.push('ji.project_key = ?'); params.push(args.project_key); }
  if (args.issue_type) { conditions.push('ji.issue_type = ?'); params.push(args.issue_type); }
  if (args.status) { conditions.push('ji.status = ?'); params.push(args.status); }
  if (args.since) { conditions.push('ji.resolved_at >= ?'); params.push(args.since); }
  if (args.until) { conditions.push('ji.resolved_at <= ?'); params.push(args.until); }
  params.push(clampLimit(args.limit, 100));

  const [rows] = await db.execute(
    `SELECT ji.issue_key, ji.project_key, ji.issue_type, ji.summary, ji.status,
            ji.story_points, ji.github_login, ji.created_at, ji.resolved_at, ji.issue_url
     FROM jira_issues ji
     WHERE ${conditions.join(' AND ')}
     ORDER BY ji.resolved_at DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  const issues = crossReport ? dedupByKeyEarliest(rows, 'issue_key', 'resolved_at') : rows;
  return { issues, count: issues.length };
}

const DEV_SORT_COLUMNS = ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'lines_removed', 'ai_percentage', 'pr_percentage'];
const NUMERIC_DEV_FIELDS = ['total_prs', 'total_commits', 'lines_added', 'lines_removed', 'avg_complexity', 'impact_score', 'pr_percentage', 'ai_percentage', 'total_jira_issues', 'cc_total_cost', 'cc_requests'];

export async function queryDeveloperStats(args: { report_id?: string; login?: string; sort_by?: string; limit?: number }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const sortBy = DEV_SORT_COLUMNS.includes(args.sort_by ?? '') ? args.sort_by : 'impact_score';

  const conditions = ['ds.report_id = ?'];
  const params: any[] = [r.id];
  if (args.login) { conditions.push('ds.github_login = ?'); params.push(args.login); }
  params.push(clampLimit(args.limit, 100));

  const [rows] = await db.execute(
    `SELECT ds.github_login, ds.github_name, ds.total_prs, ds.total_commits,
            ds.lines_added, ds.lines_removed, ds.avg_complexity, ds.impact_score,
            ds.pr_percentage, ds.ai_percentage, ds.total_jira_issues,
            ds.cc_total_cost, ds.cc_requests
     FROM developer_stats ds
     WHERE ${conditions.join(' AND ')}
     ORDER BY ds.${sortBy} DESC
     LIMIT ?`,
    params,
  ) as [any[], any];

  const developers = rows.map((row: any) => {
    const out = { ...row };
    for (const f of NUMERIC_DEV_FIELDS) if (out[f] != null) out[f] = Number(out[f]);
    return out;
  });
  return { developers, count: developers.length };
}

export async function queryUnmergedWork(args: { report_id?: string; login?: string; repo?: string }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;

  const prConds = ['report_id = ?']; const prParams: any[] = [r.id];
  const brConds = ['report_id = ?', 'pr_number IS NULL']; const brParams: any[] = [r.id];
  if (args.login) { prConds.push('github_login = ?'); prParams.push(args.login); brConds.push('github_login = ?'); brParams.push(args.login); }
  if (args.repo) { prConds.push('repo = ?'); prParams.push(args.repo); brConds.push('repo = ?'); brParams.push(args.repo); }

  const [prs] = await db.execute(
    `SELECT repo, pr_number, pr_title, pr_url, is_draft, pr_commits, pr_additions, pr_deletions,
            github_login, pr_created_at, pr_updated_at
     FROM unmerged_prs WHERE ${prConds.join(' AND ')}
     ORDER BY COALESCE(pr_additions,0) + COALESCE(pr_deletions,0) DESC LIMIT ?`,
    [...prParams, String(MAX_ROWS)],
  ) as [any[], any];

  const [branches] = await db.execute(
    `SELECT repo, branch, github_login, COUNT(*) AS commit_count,
            SUM(lines_added + lines_removed) AS total_lines
     FROM unmerged_commits WHERE ${brConds.join(' AND ')}
     GROUP BY repo, branch, github_login ORDER BY total_lines DESC LIMIT ?`,
    [...brParams, String(MAX_ROWS)],
  ) as [any[], any];

  return {
    prs: prs.map((p: any) => ({ ...p, pr_additions: Number(p.pr_additions ?? 0), pr_deletions: Number(p.pr_deletions ?? 0), is_draft: p.is_draft === 1 || p.is_draft === true })),
    branches: branches.map((b: any) => ({ ...b, commit_count: Number(b.commit_count ?? 0), total_lines: Number(b.total_lines ?? 0) })),
  };
}

export async function getEpicSummaries(args: { org?: string; epic_key?: string }) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (args.org) { conditions.push('es.org = ?'); params.push(args.org); }
  if (args.epic_key) { conditions.push('es.epic_key = ?'); params.push(args.epic_key); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `SELECT es.epic_key, es.org, es.summary_text, es.jira_resolved, es.jira_remaining,
            es.commit_count, es.lines_added, es.lines_removed, es.repos,
            est.total_jiras, est.dev_count
     FROM epic_summaries es
     LEFT JOIN epic_stats est ON est.epic_key = es.epic_key AND est.org = es.org
     ${where}
     ORDER BY es.commit_count DESC`,
    params,
  ) as [any[], any];
  const epics = rows.map((r: any) => ({
    ...r,
    jira_resolved: Number(r.jira_resolved ?? 0),
    jira_remaining: Number(r.jira_remaining ?? 0),
    commit_count: Number(r.commit_count ?? 0),
    lines_added: Number(r.lines_added ?? 0),
    lines_removed: Number(r.lines_removed ?? 0),
    total_jiras: r.total_jiras == null ? null : Number(r.total_jiras),
    dev_count: r.dev_count == null ? null : Number(r.dev_count),
  }));
  return { epics };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="mcp-queries"`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/queries.ts src/lib/__tests__/unit/mcp-queries.test.ts
git commit -m "feat(mcp): add raw-entity + discovery + epic query functions (GLOOK-26)"
```

---

### Task 5: `get_metric_timeseries` query function

**Files:**
- Modify: `src/lib/mcp/queries.ts`
- Test: `src/lib/__tests__/unit/mcp-queries.test.ts` (append)

**Interfaces:**
- Consumes: `resolveReportId`, `dedupByKeyEarliest`, `bucketByPeriod`, `reportOrg` (internal).
- Produces: `getMetricTimeseries(args: { metric: string; group_by?: string; org?: string; since?: string; until?: string }): Promise<{ metric: string; group_by: string; series: { bucket: string; value: number }[] } | { error: string }>`

Semantics:
- `metric ∈ commits | prs | lines_added | jira_resolved | impact_score | ai_percentage`
- `group_by ∈ week | month | report | developer | repo | type` (default `week`)
- Row-based metrics (`commits`, `prs`, `lines_added`, `jira_resolved`) use the deduped cross-report timeline for the org; `week`/`month` bucket by timestamp, other `group_by` values bucket by that dimension.
- Report-based metrics (`impact_score`, `ai_percentage`) aggregate `developer_stats` per report (AVG), and `bucket` is the report `created_at` date; `group_by` is forced to `report`.

- [ ] **Step 1: Append failing tests**

Add to `src/lib/__tests__/unit/mcp-queries.test.ts`:

```typescript
import { getMetricTimeseries } from '@/lib/mcp/queries';

describe('getMetricTimeseries', () => {
  it('commits by week: dedups then buckets by Monday', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])            // resolveReportId
      .mockResolvedValueOnce([[{ org: 'acme' }], null])          // reportOrg
      .mockResolvedValueOnce([[
        { commit_sha: 'a', committed_at: '2026-01-05T00:00:00Z' }, // Mon wk 01-05
        { commit_sha: 'a', committed_at: '2026-03-01T00:00:00Z' }, // dup, later → dropped
        { commit_sha: 'b', committed_at: '2026-01-07T00:00:00Z' }, // Wed wk 01-05
      ], null]);
    const out = await getMetricTimeseries({ metric: 'commits', group_by: 'week' });
    expect(out).toEqual({ metric: 'commits', group_by: 'week', series: [{ bucket: '2026-01-05', value: 2 }] });
  });

  it('lines_added by repo: sums the metric per group', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r9' }], null])
      .mockResolvedValueOnce([[{ org: 'acme' }], null])
      .mockResolvedValueOnce([[
        { commit_sha: 'a', committed_at: '2026-01-01', repo: 'x', lines_added: '10' },
        { commit_sha: 'b', committed_at: '2026-01-02', repo: 'x', lines_added: '5' },
        { commit_sha: 'c', committed_at: '2026-01-03', repo: 'y', lines_added: '3' },
      ], null]);
    const out = await getMetricTimeseries({ metric: 'lines_added', group_by: 'repo' });
    expect(out.series).toEqual([{ bucket: 'x', value: 15 }, { bucket: 'y', value: 3 }]);
  });

  it('impact_score forces group_by=report and averages per report', async () => {
    mockExecute.mockResolvedValueOnce([[
      { report_id: 'r1', created_at: '2026-01-01', value: '4.0' },
      { report_id: 'r2', created_at: '2026-02-01', value: '4.5' },
    ], null]);
    const out = await getMetricTimeseries({ metric: 'impact_score', org: 'acme' });
    expect(out.group_by).toBe('report');
    expect(out.series).toEqual([{ bucket: '2026-01-01', value: 4 }, { bucket: '2026-02-01', value: 4.5 }]);
  });

  it('rejects an unknown metric', async () => {
    expect(await getMetricTimeseries({ metric: 'bogus' })).toEqual({ error: 'unknown metric: bogus' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern="mcp-queries" -t "getMetricTimeseries"`
Expected: FAIL — `getMetricTimeseries` is not exported.

- [ ] **Step 3: Implement `getMetricTimeseries` in `src/lib/mcp/queries.ts`**

Add the import at the top (extend the existing dedup import line):

```typescript
import { dedupByKeyEarliest, bucketByPeriod } from './dedup';
```

Append the function:

```typescript
const ROW_METRICS = new Set(['commits', 'prs', 'lines_added', 'jira_resolved']);
const REPORT_METRICS = new Set(['impact_score', 'ai_percentage']);

export async function getMetricTimeseries(args: { metric: string; group_by?: string; org?: string; since?: string; until?: string }) {
  const { metric } = args;
  if (!ROW_METRICS.has(metric) && !REPORT_METRICS.has(metric)) {
    return { error: `unknown metric: ${metric}` };
  }

  // Report-based metrics: average developer_stats per report.
  if (REPORT_METRICS.has(metric)) {
    const col = metric === 'impact_score' ? 'impact_score' : 'ai_percentage';
    const conditions = [`r.status = 'completed'`];
    const params: any[] = [];
    if (args.org) { conditions.push('r.org = ?'); params.push(args.org); }
    if (args.since) { conditions.push('r.created_at >= ?'); params.push(args.since); }
    if (args.until) { conditions.push('r.created_at <= ?'); params.push(args.until); }
    const [rows] = await db.execute(
      `SELECT r.id AS report_id, r.created_at, AVG(ds.${col}) AS value
       FROM reports r JOIN developer_stats ds ON ds.report_id = r.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY r.id, r.created_at
       ORDER BY r.created_at ASC`,
      params,
    ) as [any[], any];
    return {
      metric, group_by: 'report',
      series: rows.map((r: any) => ({ bucket: String(r.created_at).slice(0, 10), value: Number(r.value ?? 0) })),
    };
  }

  // Row-based metrics: resolve org, pull rows across the org's completed reports, dedup, bucket.
  const r = await resolveReportId(undefined); // latest completed anchors the org when org not given
  let org = args.org ?? null;
  if (!org) {
    if ('error' in r) return r;
    org = await reportOrg(r.id);
  }
  const groupBy = args.group_by ?? 'week';

  const isJira = metric === 'jira_resolved';
  const table = isJira ? 'jira_issues ji' : 'commit_analyses ca';
  const alias = isJira ? 'ji' : 'ca';
  const tsCol = isJira ? 'resolved_at' : 'committed_at';
  const keyCol = isJira ? 'issue_key' : 'commit_sha';

  const conditions = [`${alias}.report_id IN (SELECT id FROM reports WHERE org = ? AND status = 'completed')`];
  const params: any[] = [org];
  if (args.since) { conditions.push(`${alias}.${tsCol} >= ?`); params.push(args.since); }
  if (args.until) { conditions.push(`${alias}.${tsCol} <= ?`); params.push(args.until); }
  // For 'prs', restrict to commits that belong to a PR and dedup by pr_number instead.
  if (metric === 'prs') conditions.push('ca.pr_number IS NOT NULL');

  const selectCols = isJira
    ? `ji.issue_key, ji.resolved_at, ji.project_key`
    : `ca.commit_sha, ca.pr_number, ca.committed_at, ca.repo, ca.github_login, ca.type, ca.lines_added`;

  const [rows] = await db.execute(
    `SELECT ${selectCols} FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY ${alias}.${tsCol} ASC`,
    params,
  ) as [any[], any];

  // Dedup to the real timeline.
  let deduped: any[];
  if (metric === 'prs') {
    deduped = dedupByKeyEarliest(rows, 'pr_number', 'committed_at');
  } else {
    deduped = dedupByKeyEarliest(rows, keyCol as any, tsCol as any);
  }

  // Bucket.
  const valueOf = (row: any): number => metric === 'lines_added' ? Number(row.lines_added ?? 0) : 1;

  if (groupBy === 'week' || groupBy === 'month') {
    const buckets = bucketByPeriod(deduped, tsCol as any, groupBy);
    return { metric, group_by: groupBy, series: buckets.map(b => ({ bucket: b.bucket, value: b.rows.reduce((s, row) => s + valueOf(row), 0) })) };
  }

  // Dimension grouping: report | developer | repo | type
  const dimField = groupBy === 'developer' ? 'github_login' : groupBy === 'repo' ? 'repo' : groupBy === 'type' ? 'type' : 'report';
  const agg = new Map<string, number>();
  for (const row of deduped) {
    const key = String(row[dimField] ?? 'unknown');
    agg.set(key, (agg.get(key) ?? 0) + valueOf(row));
  }
  const series = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, value]) => ({ bucket, value }));
  return { metric, group_by: groupBy, series };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="mcp-queries"`
Expected: PASS (all cases, including the four new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/queries.ts src/lib/__tests__/unit/mcp-queries.test.ts
git commit -m "feat(mcp): add get_metric_timeseries query (GLOOK-26)"
```

---

### Task 6: Tool registry (`tools.ts`)

**Files:**
- Create: `src/lib/mcp/tools.ts`
- Test: `src/lib/__tests__/unit/mcp-tools.test.ts`

**Interfaces:**
- Consumes: all query functions from Task 4 & 5; `getProjectInsights` (Task 1); `getReleaseNotes` (Task 2); `getReportHighlights` from `@/lib/report-highlights`; `getDevSummary` from `@/lib/report/summary`; `getTeamPulse` from `@/lib/team-pulse`; `resolveReportId` (Task 3); `db`.
- Produces:
  - `interface McpTool { name: string; description: string; inputSchema: object; handler: (args: any) => Promise<any> }`
  - `export const MCP_TOOLS: McpTool[]`
  - `export async function callTool(name: string, args: Record<string, any>): Promise<any>` — dispatches by name; unknown name → `{ error: 'unknown tool: <name>' }`; handler throw → `{ error: <message> }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/mcp-tools.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { MCP_TOOLS, callTool } from '@/lib/mcp/tools';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('MCP tool registry', () => {
  const EXPECTED = [
    'list_reports', 'get_org_summary', 'query_commits', 'query_jira_issues',
    'query_developer_stats', 'query_unmerged_work', 'get_project_insights',
    'get_project_details', 'get_highlights', 'get_team_pulse',
    'get_developer_summary', 'get_release_notes', 'get_epic_summaries',
    'get_metric_timeseries',
  ];

  it('registers exactly the expected tools with unique names', () => {
    const names = MCP_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual([...EXPECTED].sort());
  });

  it('every tool has a description and a JSON-Schema inputSchema of type object', () => {
    for (const t of MCP_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.inputSchema as any).type).toBe('object');
      expect(typeof t.handler).toBe('function');
    }
  });

  it('callTool dispatches to the handler (list_reports round-trip)', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: 'x', completed_at: 'y' }], null]);
    const out = await callTool('list_reports', { limit: 5 });
    expect(out.reports).toHaveLength(1);
  });

  it('callTool returns an error object for an unknown tool', async () => {
    expect(await callTool('nope', {})).toEqual({ error: 'unknown tool: nope' });
  });

  it('callTool converts a handler throw into an error object', async () => {
    mockExecute.mockRejectedValueOnce(new Error('boom'));
    const out = await callTool('list_reports', {});
    expect(out).toEqual({ error: 'boom' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern="mcp-tools"`
Expected: FAIL — "Cannot find module '@/lib/mcp/tools'".

- [ ] **Step 3: Implement `src/lib/mcp/tools.ts`**

```typescript
import db from '@/lib/db';
import {
  listReports, getOrgSummaryTool, queryCommits, queryJiraIssues,
  queryDeveloperStats, queryUnmergedWork, getEpicSummaries, getMetricTimeseries,
} from './queries';
import { resolveReportId } from './resolve';
import { getProjectInsights } from '@/lib/projects/insights';
import { getReleaseNotes } from '@/lib/release-notes/service';
import { getReportHighlights } from '@/lib/report-highlights';
import { getDevSummary } from '@/lib/report/summary';
import { getTeamPulse } from '@/lib/team-pulse';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: any) => Promise<any>;
}

const REPORT_ID = { report_id: { type: 'string', description: 'Report id. Omit for the latest completed report.' } };

// get_project_details: filter the insights payload down to one project by name.
async function getProjectDetails(args: { project_name: string; report_id?: string }) {
  const insights: any = await getProjectInsights(args.report_id);
  if (!insights?.available) return insights;
  const projects: any[] = insights.projects ?? [];
  const match = projects.find(p => String(p.name).toLowerCase() === String(args.project_name).toLowerCase());
  if (!match) return { error: 'project not found', available: projects.map(p => p.name) };
  return { report: insights.report, project: match };
}

// get_team_pulse: look up members, then delegate to the existing service.
async function getTeamPulseTool(args: { report_id?: string; team: string; org: string; with_projects?: boolean }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  const [members] = await db.execute(
    `SELECT tm.github_login FROM team_members tm JOIN teams t ON tm.team_id = t.id
     WHERE t.name = ? AND t.org = ?`,
    [args.team, args.org],
  ) as [any[], any];
  if (!members.length) return { error: 'team not found or has no members' };
  return getTeamPulse(r.id, args.team, args.org, members.map((m: any) => m.github_login), { withProjects: !!args.with_projects });
}

// get_developer_summary: resolve report, then delegate.
async function getDeveloperSummaryTool(args: { login: string; report_id?: string }) {
  const r = await resolveReportId(args.report_id);
  if ('error' in r) return r;
  return getDevSummary(r.id, args.login);
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_reports',
    description: 'List Glooker report runs (id, org, period, status, dates). The entry point for finding report ids.',
    inputSchema: { type: 'object', properties: {
      org: { type: 'string', description: 'Filter by GitHub org (optional)' },
      status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'stopped'], description: 'Filter by status (optional)' },
      limit: { type: 'number', description: 'Max rows (default 50, max 500)' },
    } },
    handler: (a) => listReports(a),
  },
  {
    name: 'get_org_summary',
    description: 'High-level totals for a report: developers, commits, PRs, lines, averages, Jira totals.',
    inputSchema: { type: 'object', properties: { ...REPORT_ID } },
    handler: (a) => getOrgSummaryTool(a),
  },
  {
    name: 'query_commits',
    description: 'Query analyzed commits as flat rows. Omit report_id for cross-report results (deduped by SHA, earliest commit date).',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter by developer login' },
      repo: { type: 'string', description: 'Filter by repo' },
      type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other'], description: 'Commit type' },
      since: { type: 'string', description: 'ISO date lower bound on committed_at' },
      until: { type: 'string', description: 'ISO date upper bound on committed_at' },
      min_complexity: { type: 'number', description: 'Minimum complexity 1-10' },
      ai_only: { type: 'boolean', description: 'Only AI-assisted commits' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => queryCommits(a),
  },
  {
    name: 'query_jira_issues',
    description: 'Query Jira issues as flat rows. Omit report_id for cross-report results (deduped by issue key, earliest resolved date).',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter by developer login' },
      project_key: { type: 'string', description: 'Filter by Jira project key e.g. GLOOK' },
      issue_type: { type: 'string', description: 'Filter by issue type e.g. Story, Bug' },
      status: { type: 'string', description: 'Filter by status' },
      since: { type: 'string', description: 'ISO date lower bound on resolved_at' },
      until: { type: 'string', description: 'ISO date upper bound on resolved_at' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => queryJiraIssues(a),
  },
  {
    name: 'query_developer_stats',
    description: 'Per-developer aggregate stats for a report, ranked. Metrics: commits, PRs, lines, impact score, AI %.',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter to one developer' },
      sort_by: { type: 'string', enum: ['impact_score', 'total_commits', 'total_prs', 'avg_complexity', 'lines_added', 'lines_removed', 'ai_percentage', 'pr_percentage'], description: 'Sort column (default impact_score)' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
    } },
    handler: (a) => queryDeveloperStats(a),
  },
  {
    name: 'query_unmerged_work',
    description: 'In-flight work for a report: open PRs and unmerged branch commits.',
    inputSchema: { type: 'object', properties: {
      ...REPORT_ID,
      login: { type: 'string', description: 'Filter by developer login' },
      repo: { type: 'string', description: 'Filter by repo' },
    } },
    handler: (a) => queryUnmergedWork(a),
  },
  {
    name: 'get_project_insights',
    description: 'LLM-clustered projects for a report with Jira/PR/commit attribution, plus unattributed "Other" work. Cached; first call may take 30-60s.',
    inputSchema: { type: 'object', properties: { ...REPORT_ID } },
    handler: (a) => getProjectInsights(a.report_id),
  },
  {
    name: 'get_project_details',
    description: 'Full drill-down (Jiras, PRs, commits) for a single clustered project by name.',
    inputSchema: { type: 'object', properties: {
      project_name: { type: 'string', description: 'Exact project name from get_project_insights' },
      ...REPORT_ID,
    }, required: ['project_name'] },
    handler: (a) => getProjectDetails(a),
  },
  {
    name: 'get_highlights',
    description: 'Narrative highlights comparing the latest report to the previous one.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getReportHighlights(),
  },
  {
    name: 'get_team_pulse',
    description: 'Team health summary for a report. Requires team name and org (report period must be >= 14 days).',
    inputSchema: { type: 'object', properties: {
      team: { type: 'string', description: 'Team name' },
      org: { type: 'string', description: 'GitHub org' },
      ...REPORT_ID,
      with_projects: { type: 'boolean', description: 'Include per-project breakdown' },
    }, required: ['team', 'org'] },
    handler: (a) => getTeamPulseTool(a),
  },
  {
    name: 'get_developer_summary',
    description: 'LLM narrative + badges for a single developer in a report.',
    inputSchema: { type: 'object', properties: {
      login: { type: 'string', description: 'Developer GitHub login' },
      ...REPORT_ID,
    }, required: ['login'] },
    handler: (a) => getDeveloperSummaryTool(a),
  },
  {
    name: 'get_release_notes',
    description: 'Recent release notes for the Glooker repo (last 14 days of commits, summarized).',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getReleaseNotes(),
  },
  {
    name: 'get_epic_summaries',
    description: 'Epic-level rollups (summary text, resolved/remaining Jiras, commits, devs). List all epics or drill into one.',
    inputSchema: { type: 'object', properties: {
      org: { type: 'string', description: 'Filter by org' },
      epic_key: { type: 'string', description: 'Specific epic key (optional)' },
    } },
    handler: (a) => getEpicSummaries(a),
  },
  {
    name: 'get_metric_timeseries',
    description: 'Time-series or grouped aggregate of a metric across reports. metric: commits|prs|lines_added|jira_resolved|impact_score|ai_percentage. group_by: week|month|report|developer|repo|type.',
    inputSchema: { type: 'object', properties: {
      metric: { type: 'string', enum: ['commits', 'prs', 'lines_added', 'jira_resolved', 'impact_score', 'ai_percentage'], description: 'Metric to aggregate' },
      group_by: { type: 'string', enum: ['week', 'month', 'report', 'developer', 'repo', 'type'], description: 'Bucketing dimension (default week)' },
      org: { type: 'string', description: 'GitHub org (defaults to latest completed report org)' },
      since: { type: 'string', description: 'ISO date lower bound' },
      until: { type: 'string', description: 'ISO date upper bound' },
    }, required: ['metric'] },
    handler: (a) => getMetricTimeseries(a),
  },
];

const BY_NAME = new Map(MCP_TOOLS.map(t => [t.name, t]));

export async function callTool(name: string, args: Record<string, any>): Promise<any> {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `unknown tool: ${name}` };
  try {
    return await tool.handler(args ?? {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="mcp-tools"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools.ts src/lib/__tests__/unit/mcp-tools.test.ts
git commit -m "feat(mcp): add tool registry + callTool dispatch (GLOOK-26)"
```

---

### Task 7: JSON-RPC protocol handler (`protocol.ts`)

**Files:**
- Create: `src/lib/mcp/protocol.ts`
- Test: `src/lib/__tests__/unit/mcp-protocol.test.ts`

**Interfaces:**
- Consumes: `MCP_TOOLS`, `callTool` (Task 6).
- Produces: `handleJsonRpc(message: any): Promise<{ status: number; body: any | null }>` where `body === null` means "202 Accepted, empty body" (for notifications). Otherwise `status` is 200 and `body` is the JSON-RPC response object.
- Constants: `SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']`, `DEFAULT_PROTOCOL_VERSION = '2025-06-18'`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/mcp-protocol.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { handleJsonRpc } from '@/lib/mcp/protocol';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('handleJsonRpc', () => {
  it('initialize echoes a supported protocolVersion and advertises tools capability', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(res.status).toBe(200);
    expect(res.body.result.protocolVersion).toBe('2025-03-26');
    expect(res.body.result.capabilities).toEqual({ tools: {} });
    expect(res.body.result.serverInfo.name).toBe('glooker');
  });

  it('initialize falls back to the default version when unrecognized', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(res.body.result.protocolVersion).toBe('2025-06-18');
  });

  it('notifications/initialized yields 202 with no body', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res).toEqual({ status: 202, body: null });
  });

  it('ping returns an empty result', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('tools/list returns the registry as name/description/inputSchema', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = res.body.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.find((t: any) => t.name === 'query_commits')).toBeTruthy();
    for (const t of tools) {
      expect(Object.keys(t).sort()).toEqual(['description', 'inputSchema', 'name']);
    }
  });

  it('tools/call wraps the tool result as MCP content', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: 'x', completed_at: 'y' }], null]);
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_reports', arguments: { limit: 5 } } });
    expect(res.body.result.content[0].type).toBe('text');
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload.reports).toHaveLength(1);
  });

  it('tools/call with an unknown tool returns isError content', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    expect(res.body.result.isError).toBe(true);
  });

  it('unknown method returns JSON-RPC error -32601', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 5, method: 'does/not/exist' });
    expect(res.body.error.code).toBe(-32601);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern="mcp-protocol"`
Expected: FAIL — "Cannot find module '@/lib/mcp/protocol'".

- [ ] **Step 3: Implement `src/lib/mcp/protocol.ts`**

```typescript
import { MCP_TOOLS, callTool } from './tools';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = { name: 'glooker', version: process.env.npm_package_version || '0.1.0' };

type RpcResult = { status: number; body: any | null };

function ok(id: any, result: any): RpcResult {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}
function err(id: any, code: number, message: string): RpcResult {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } };
}

export async function handleJsonRpc(message: any): Promise<RpcResult> {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return err(message?.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return { status: 202, body: null };
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (typeof name !== 'string') return err(id, -32602, 'Invalid params: missing tool name');
      const result = await callTool(name, args);
      const isError = result && typeof result === 'object' && 'error' in result;
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !!isError,
      });
    }
    default:
      if (isNotification) return { status: 202, body: null };
      return err(id, -32601, `Method not found: ${method}`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="mcp-protocol"`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/protocol.ts src/lib/__tests__/unit/mcp-protocol.test.ts
git commit -m "feat(mcp): add hand-rolled JSON-RPC protocol handler (GLOOK-26)"
```

---

### Task 8: HTTP transport route (`/api/mcp`)

**Files:**
- Create: `src/app/api/mcp/route.ts`
- Test: `src/lib/__tests__/unit/mcp-route.test.ts`

**Interfaces:**
- Consumes: `handleJsonRpc` (Task 7); `extractUser` from `@/lib/auth`; `withRequestLog` from `@/lib/logger`.
- Produces: `POST`, `GET`, `OPTIONS` handlers.

Behavior:
- **POST**: parse JSON body; on parse failure return JSON-RPC `-32700` with HTTP 200. Otherwise call `handleJsonRpc`; if `body === null` return `new Response(null, { status })` (202), else `NextResponse.json(body, { status })`. Best-effort `extractUser(req.headers)` is read so `withRequestLog` can attribute the request (no gating — read-only server).
- **GET**: return HTTP 405 (no server-initiated SSE stream) — MCP clients tolerate this for a POST-only server.
- **OPTIONS**: return 204 (CORS/preflight friendliness behind the proxy).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/mcp-route.test.ts`:

```typescript
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { POST, GET } from '@/app/api/mcp/route';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

function postReq(body: any) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mcp', () => {
  it('handles initialize and returns 200 JSON-RPC result', async () => {
    const res = await POST(postReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe('glooker');
  });

  it('returns 202 with empty body for notifications/initialized', async () => {
    const res = await POST(postReq({ jsonrpc: '2.0', method: 'notifications/initialized' }) as any);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('returns a -32700 parse error for malformed JSON', async () => {
    const bad = new Request('http://localhost/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' });
    const res = await POST(bad as any);
    const json = await res.json();
    expect(json.error.code).toBe(-32700);
  });

  it('GET returns 405', async () => {
    const res = await GET(new Request('http://localhost/api/mcp') as any);
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern="mcp-route"`
Expected: FAIL — "Cannot find module '@/app/api/mcp/route'".

- [ ] **Step 3: Implement `src/app/api/mcp/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { handleJsonRpc } from '@/lib/mcp/protocol';
import { extractUser } from '@/lib/auth';

async function postHandler(req: Request) {
  // Identity is read for request-log attribution only (read-only server, no gating).
  try { extractUser(req.headers); } catch { /* no-op */ }

  let message: any;
  try {
    message = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 200 });
  }

  const { status, body } = await handleJsonRpc(message);
  if (body === null) return new Response(null, { status });
  return NextResponse.json(body, { status });
}

async function getHandler() {
  // POST-only MCP endpoint; no server-initiated SSE stream.
  return new Response('Method Not Allowed', { status: 405 });
}

async function optionsHandler() {
  return new Response(null, { status: 204 });
}

export const POST = withRequestLog(postHandler);
export const GET = withRequestLog(getHandler);
export const OPTIONS = withRequestLog(optionsHandler);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="mcp-route"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the logger-enforcement test explicitly**

Run: `npm test -- --testPathPattern="logger-enforcement"`
Expected: PASS — confirms `POST`, `GET`, `OPTIONS` in the new route are all wrapped with `withRequestLog`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/mcp/route.ts src/lib/__tests__/unit/mcp-route.test.ts
git commit -m "feat(mcp): add /api/mcp Streamable-HTTP transport route (GLOOK-26)"
```

---

### Task 9: Local connection config + full verification + mock smoke test

**Files:**
- Create: `.mcp.json`
- Modify: `.env.example` (document the proxy env, no secrets)
- Verify: full suite, `dev:mock` smoke test

**Interfaces:** none (integration/verification task).

- [ ] **Step 1: Add a local `.mcp.json` for connecting Claude Code to the dev server**

Create `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "glooker-local": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

- [ ] **Step 2: Document the proxy env in `.env.example`**

Append to `.env.example` (find the file; add at the end):

```bash
# ── Glooker MCP server (GLOOK-26) ─────────────────────────────────────────
# The MCP endpoint lives at /api/mcp and is unauthenticated in the app itself.
# In AWS it is fronted by the mcp-okta-proxy sidecar, configured (on the PROXY,
# not here) with:
#   OKTA_MCP_PROXY_UPSTREAM_URL=http://localhost:3000
#   OKTA_MCP_PROXY_MCP_PUBLIC_URL=https://glooker-mcp.internal-tools.dev.smartling.net
#   OKTA_MCP_PROXY_USERINFO_HEADER_NAME=x-amzn-oidc-data
# Locally, no proxy is needed — connect Claude Code directly (see .mcp.json).
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites, including the six new `mcp-*` suites and `logger-enforcement`.

- [ ] **Step 4: Type-check via build-free tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke-test the endpoint under mock mode**

Start the mock dev server in the background:

Run: `npm run dev:mock` (wait until it logs "Ready" / listening on :3000)

Then in another shell verify the handshake and a tool call:

```bash
# initialize
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
# expect: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"glooker",...}}}

# tools/list
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | python3 -m json.tool | head -40
# expect: 14 tools

# tools/call → list_reports
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_reports","arguments":{"limit":5}}}'
# expect: result.content[0].text is JSON with a "reports" array from the seeded DB
```

Expected: `initialize` returns the server info; `tools/list` returns 14 tools; `list_reports` returns seeded reports. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add .mcp.json .env.example
git commit -m "chore(mcp): add local .mcp.json + document proxy env (GLOOK-26)"
```

---

## Self-Review

**1. Spec coverage:**
- Curated tool set (14 tools) → Task 6 registry; discovery/raw/semantic/time-series all present. ✓
- Cross-report dedup (earliest timestamp) → Task 3 helper + Task 4/5 usage; report-scoped skips dedup. ✓
- `resolveReportId` default-to-latest + clean error → Task 3. ✓
- Three-layer architecture (route/protocol/tools + queries) → Tasks 4-8. ✓
- Refactors: extract `getProjectInsights` + `getReleaseNotes` → Tasks 1, 2. ✓
- `get_epic_summaries` reads tables directly (not `getEpicSummary`) → Task 4. ✓
- `get_project_details` case-insensitive match + `available` list on miss → Task 6 `getProjectDetails`. ✓
- Hand-rolled JSON-RPC (initialize/initialized/tools.list/tools.call/ping) + JSON `application/json` responses + 202 for notifications → Task 7, 8. ✓
- JSON Schema not zod; no `@modelcontextprotocol/sdk` → Tasks 6-8, no new deps. ✓
- `withRequestLog` on all handlers → Task 8 + Step 5 enforcement check. ✓
- Identity via `extractUser` for logging only, no gating → Task 8. ✓
- Read-only (no mutation tools) → registry contains only reads. ✓
- Testing: pure-helper tests, mocked-db query tests, registry test, protocol test → Tasks 3-8. ✓
- Mock-mode smoke test → Task 9. ✓
- Deployment (Terraform/ECS/Okta) explicitly out of scope → not in plan (documented in `.env.example` only). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✓

**3. Type consistency:** `resolveReportId` returns `{ id } | { error }` — used consistently in Tasks 4/5/6 via `'error' in r` guard. Query function names in Task 4/5 (`listReports`, `getOrgSummaryTool`, `queryCommits`, `queryJiraIssues`, `queryDeveloperStats`, `queryUnmergedWork`, `getEpicSummaries`, `getMetricTimeseries`) match the imports in Task 6 `tools.ts`. `handleJsonRpc` return shape `{ status, body }` matches Task 8 route consumption. `MCP_TOOLS`/`callTool` names match Task 7 imports. ✓
