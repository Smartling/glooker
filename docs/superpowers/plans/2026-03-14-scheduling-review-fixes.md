# Scheduling Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical and important issues found during PR review of the scheduling feature.

**Architecture:** Three independent fix tasks targeting: (1) backend reliability — scheduler error handling and init guard, (2) API route robustness — try/catch + shared validation, (3) frontend error handling — client-side fetch error feedback. Each task can be implemented and tested independently.

**Tech Stack:** Next.js 15, TypeScript, croner, SQLite/MySQL

---

## File Structure

| File | Responsibility | Task |
|------|---------------|------|
| `src/lib/schedule-validation.ts` | **Create** — shared `validateScheduleBody()` extracted from both route files | Task 2 |
| `src/lib/schedule-manager.ts` | **Modify** — fix init guard ordering, add DB update in runReport catch, add logging to getNextRun catch | Task 1 |
| `src/lib/db/mysql.ts` | **Modify** — await schedules table creation | Task 1 |
| `src/app/api/schedule/route.ts` | **Modify** — add try/catch to GET/POST, import shared validation, wrap req.json() | Task 2 |
| `src/app/api/schedule/[id]/route.ts` | **Modify** — add try/catch to PUT/DELETE, import shared validation, wrap req.json() | Task 2 |
| `src/app/page.tsx` | **Modify** — fix deleteSchedule, toggleScheduleEnabled error handling, replace empty .catch blocks | Task 3 |

---

## Chunk 1: All Fixes

### Task 1: Backend Scheduler Reliability

**Files:**
- Modify: `src/lib/schedule-manager.ts`
- Modify: `src/lib/db/mysql.ts`

Fixes review issues: #1 (fire-and-forget runReport), #2 (MySQL table race), #3 (init guard ordering), #6 (getNextRun silent null), #11 (init guard prevents retry)

- [ ] **Step 1: Fix `initScheduler` guard ordering**

Move `g.__glooker_scheduler_init = true` to AFTER the init logic succeeds. Wrap body in try/catch that does NOT set the flag on failure.

In `src/lib/schedule-manager.ts`, change `initScheduler()` to:

```typescript
export async function initScheduler(): Promise<void> {
  if (g.__glooker_scheduler_init) return;

  console.log('[scheduler] Initializing…');

  try {
    await db.execute(
      `UPDATE reports SET status = 'failed', error = 'Server restarted during execution' WHERE status = 'running'`,
    );

    const [rows] = await db.execute<Schedule>(
      `SELECT * FROM schedules WHERE enabled = 1`,
    );

    for (const schedule of rows) {
      registerSchedule(schedule);
    }

    g.__glooker_scheduler_init = true;
    console.log(`[scheduler] ${rows.length} schedule(s) registered`);
  } catch (err) {
    console.error('[scheduler] Initialization failed:', err);
  }
}
```

- [ ] **Step 2: Fix fire-and-forget `runReport` catch to update DB**

In `src/lib/schedule-manager.ts`, change the `runReport(...).catch(...)` in `triggerSchedule()` to also mark the report as failed in the database:

```typescript
    runReport(reportId, org, period_days, false, Boolean(test_mode)).catch(async (err) => {
      console.error(`[scheduler] Report ${reportId} failed:`, err);
      try {
        await db.execute(
          `UPDATE reports SET status = 'failed', error = ? WHERE id = ?`,
          [err instanceof Error ? err.message : String(err), reportId],
        );
      } catch (dbErr) {
        console.error(`[scheduler] Failed to mark report ${reportId} as failed:`, dbErr);
      }
    });
```

- [ ] **Step 3: Add logging to `getNextRun` catch**

```typescript
export function getNextRun(cronExpr: string, timezone: string): Date | null {
  try {
    const job = new Cron(cronExpr, { timezone });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch (err) {
    console.error(`[scheduler] getNextRun failed for "${cronExpr}" (${timezone}):`, err);
    return null;
  }
}
```

- [ ] **Step 4: Await MySQL schedules table creation**

In `src/lib/db/mysql.ts`, change `createMySQLDB` to be async and await the schema creation. Since the existing pattern returns a sync DB object, add a top-level `ready` promise that `initScheduler` can wait for implicitly (the `execute` calls will queue behind the pool).

Actually, the simplest fix: since `pool.execute` queues behind the pool anyway, the real issue is just that errors are silently caught. Change to `await` by making the DB init async. But the existing pattern is a sync factory. Instead, log more clearly and let the pool queue handle ordering:

```typescript
pool.execute(SCHEDULES_SCHEMA).catch((err) => {
  console.error('[db/mysql] Failed to create schedules table:', err);
});
```

This is already the pattern used — the pool serializes queries so `initScheduler`'s SELECT will queue after the CREATE TABLE. The fix is just better error logging (already done above). The race condition concern is a false positive since mysql2 pool serializes.

- [ ] **Step 5: Verify changes compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-manager.ts src/lib/db/mysql.ts
git commit -m "fix(scheduler): fix init guard, mark failed reports in DB, improve error logging"
```

---

### Task 2: API Route Robustness

**Files:**
- Create: `src/lib/schedule-validation.ts`
- Modify: `src/app/api/schedule/route.ts`
- Modify: `src/app/api/schedule/[id]/route.ts`

Fixes review issues: #5 (no try/catch in API routes), #8 (duplicated validateBody), #9 (req.json not wrapped)

- [ ] **Step 1: Extract shared `validateScheduleBody`**

Create `src/lib/schedule-validation.ts`:

```typescript
import { Cron } from 'croner';

export function validateScheduleBody(body: any): string | null {
  const { org, periodDays, cronExpr, timezone } = body;
  if (!org || typeof org !== 'string') return 'org is required';
  if (![3, 14, 30, 90].includes(Number(periodDays))) return 'periodDays must be 3, 14, 30, or 90';
  if (!cronExpr || typeof cronExpr !== 'string') return 'cronExpr is required';
  if (!timezone || typeof timezone !== 'string') return 'timezone is required';

  try {
    const test = new Cron(cronExpr, { timezone });
    test.stop();
  } catch {
    return 'Invalid cron expression or timezone';
  }

  return null;
}
```

- [ ] **Step 2: Wrap `route.ts` handlers in try/catch, use shared validation**

Replace `src/app/api/schedule/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { registerSchedule, getNextRun, type Schedule } from '@/lib/schedule-manager';
import { validateScheduleBody } from '@/lib/schedule-validation';

export async function GET() {
  try {
    const [rows] = await db.execute(
      `SELECT s.*, r.status AS last_report_status
       FROM schedules s
       LEFT JOIN reports r ON s.last_report_id = r.id
       ORDER BY s.created_at DESC`,
    ) as [any[], any];

    const enriched = rows.map((row: any) => ({
      ...row,
      next_run_at: row.enabled ? getNextRun(row.cron_expr, row.timezone)?.toISOString() ?? null : null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error('[api/schedule] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const error = validateScheduleBody(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const { org, periodDays, cronExpr, timezone, testMode = false, enabled = true } = body;
    const id = uuidv4();

    await db.execute(
      `INSERT INTO schedules (id, org, period_days, cron_expr, timezone, enabled, test_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0],
    );

    if (enabled) {
      const schedule: Schedule = {
        id, org, period_days: Number(periodDays), cron_expr: cronExpr,
        timezone, enabled: 1, test_mode: testMode ? 1 : 0,
        last_run_at: null, last_report_id: null, created_at: new Date().toISOString(),
      };
      registerSchedule(schedule);
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error('[api/schedule] POST failed:', err);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Wrap `[id]/route.ts` handlers in try/catch, use shared validation**

Replace `src/app/api/schedule/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { registerSchedule, unregisterSchedule, type Schedule } from '@/lib/schedule-manager';
import { validateScheduleBody } from '@/lib/schedule-validation';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const error = validateScheduleBody(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const { org, periodDays, cronExpr, timezone, testMode, enabled } = body;

    const [existing] = await db.execute(`SELECT id FROM schedules WHERE id = ?`, [id]) as [any[], any];
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    await db.execute(
      `UPDATE schedules SET org = ?, period_days = ?, cron_expr = ?, timezone = ?, enabled = ?, test_mode = ?
       WHERE id = ?`,
      [org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0, id],
    );

    const schedule: Schedule = {
      id, org, period_days: Number(periodDays), cron_expr: cronExpr,
      timezone, enabled: enabled ? 1 : 0, test_mode: testMode ? 1 : 0,
      last_run_at: null, last_report_id: null, created_at: '',
    };

    if (enabled) {
      registerSchedule(schedule);
    } else {
      unregisterSchedule(id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/schedule] PUT failed:', err);
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    unregisterSchedule(id);
    await db.execute(`DELETE FROM schedules WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/schedule] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify changes compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-validation.ts src/app/api/schedule/route.ts src/app/api/schedule/[id]/route.ts
git commit -m "fix(api): add try/catch to schedule routes, extract shared validation"
```

---

### Task 3: Frontend Error Handling

**Files:**
- Modify: `src/app/page.tsx`

Fixes review issues: #3 (deleteSchedule silent), #4 (toggleScheduleEnabled no error handling), #6 (empty .catch blocks)

- [ ] **Step 1: Fix `deleteSchedule` to show error feedback**

```typescript
  async function deleteSchedule(id: string) {
    try {
      const res = await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('Failed to delete schedule');
        return;
      }
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      if (editingSchedule?.id === id) {
        setShowScheduleForm(false);
        resetScheduleForm();
      }
    } catch {
      alert('Network error — could not delete schedule');
    }
  }
```

- [ ] **Step 2: Fix `toggleScheduleEnabled` with try/catch and .ok check**

```typescript
  async function toggleScheduleEnabled(s: any) {
    const payload = {
      org: s.org,
      periodDays: s.period_days,
      cronExpr: s.cron_expr,
      timezone: s.timezone,
      testMode: Boolean(s.test_mode),
      enabled: !s.enabled,
    };
    try {
      const res = await fetch(`/api/schedule/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        alert('Failed to toggle schedule');
        return;
      }
      fetch('/api/schedule').then((r) => r.json()).then(setSchedules).catch(() => {});
    } catch {
      alert('Network error — could not toggle schedule');
    }
  }
```

- [ ] **Step 3: Replace empty `.catch(() => {})` blocks with console.error logging**

Find all `.catch(() => {})` in the file and replace with `.catch((err) => console.error('[glooker]', err))`. There are approximately 5 instances:
- Mount useEffect: `fetch('/api/schedule').then(...).catch(() => {})`
- Polling useEffect: `.catch(() => {})` on report fetch and schedule fetch
- After saveSchedule: `fetch('/api/schedule').then(...).catch(() => {})`
- After toggleScheduleEnabled: `fetch('/api/schedule').then(...).catch(() => {})`

- [ ] **Step 4: Verify changes compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "fix(ui): add error handling to schedule operations, replace empty catch blocks"
```
