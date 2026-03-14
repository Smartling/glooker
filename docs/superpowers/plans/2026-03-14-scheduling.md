# Scheduling Feature Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cron-based scheduled report generation with DB persistence, API CRUD, and dashboard UI management.

**Architecture:** Schedules stored in a `schedules` DB table, managed via REST API and sidebar UI. `croner` library runs cron jobs inside the Next.js process, initialized via `instrumentation.ts` on startup. Cron triggers call `runReport()` directly with concurrency guards.

**Tech Stack:** croner (cron scheduling + timezone + nextRun), Next.js instrumentation hook, SQLite/MySQL dual DB, React (existing single-page dashboard)

**Spec:** `docs/superpowers/specs/2026-03-14-scheduling-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/schedule-manager.ts` | Create | Cron job lifecycle: init, register, unregister, trigger, getNextRun |
| `src/instrumentation.ts` | Create | Next.js startup hook — calls initScheduler() |
| `src/app/api/schedule/route.ts` | Create | GET (list) + POST (create) schedule endpoints |
| `src/app/api/schedule/[id]/route.ts` | Create | PUT (update) + DELETE (remove) schedule endpoints |
| `src/lib/db/sqlite.ts` | Modify | Add `schedules` table to SCHEMA |
| `src/lib/db/mysql.ts` | Modify | Add `schedules` table init for MySQL |
| `next.config.ts` | Modify | Add `croner` to serverExternalPackages |
| `src/app/page.tsx` | Modify | Add Schedules sidebar section, create/edit form, reports list polling |
| `package.json` | Modify | Add `croner` dependency |

---

## Chunk 1: Backend Infrastructure

### Task 1: Install croner and update Next.js config

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts:3-5`

- [ ] **Step 1: Install croner**

Run: `npm install croner`

- [ ] **Step 2: Add croner to serverExternalPackages**

In `next.config.ts`, update the config:

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner'],
};
```

- [ ] **Step 3: Verify dev server starts**

Run: `npm run dev`
Expected: Server starts on port 3000 without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "feat(scheduling): add croner dependency and next config"
```

---

### Task 2: Add schedules table to SQLite schema

**Files:**
- Modify: `src/lib/db/sqlite.ts:6-59`

- [ ] **Step 1: Add schedules table DDL to SCHEMA constant**

In `src/lib/db/sqlite.ts`, append to the `SCHEMA` string (after the `commit_analyses` table, before the closing backtick on line 59):

```sql
CREATE TABLE IF NOT EXISTS schedules (
  id             TEXT    NOT NULL PRIMARY KEY,
  org            TEXT    NOT NULL,
  period_days    INTEGER NOT NULL,
  cron_expr      TEXT    NOT NULL,
  timezone       TEXT    NOT NULL DEFAULT 'UTC',
  enabled        INTEGER NOT NULL DEFAULT 1,
  test_mode      INTEGER NOT NULL DEFAULT 0,
  last_run_at    TEXT,
  last_report_id TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (last_report_id) REFERENCES reports(id) ON DELETE SET NULL
);
```

- [ ] **Step 2: Delete existing glooker.db so schema recreates**

The SQLite DB uses `CREATE TABLE IF NOT EXISTS`, so the new table will be created on next access. No migration needed. If the DB already exists, the new table will be added automatically.

- [ ] **Step 3: Verify by starting dev server and checking DB**

Run: `npm run dev` (start server so DB initializes), then in another terminal:
Run: `sqlite3 glooker.db ".schema schedules"`
Expected: Shows the schedules table DDL.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/sqlite.ts
git commit -m "feat(scheduling): add schedules table to SQLite schema"
```

---

### Task 3: Add schedules table to MySQL schema

**Files:**
- Modify: `src/lib/db/mysql.ts`

- [ ] **Step 1: Add auto-creation of schedules table in MySQL**

The MySQL module currently has no schema init. Add a `SCHEDULES_SCHEMA` constant and execute it in `createMySQLDB()` after creating the pool, similar to how SQLite does it with `db.exec(SCHEMA)`:

```ts
const SCHEDULES_SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id             VARCHAR(36)  NOT NULL PRIMARY KEY,
  org            VARCHAR(255) NOT NULL,
  period_days    INT          NOT NULL,
  cron_expr      VARCHAR(100) NOT NULL,
  timezone       VARCHAR(50)  NOT NULL DEFAULT 'UTC',
  enabled        TINYINT      NOT NULL DEFAULT 1,
  test_mode      TINYINT      NOT NULL DEFAULT 0,
  last_run_at    DATETIME,
  last_report_id VARCHAR(36),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (last_report_id) REFERENCES reports(id) ON DELETE SET NULL
);
`;
```

In `createMySQLDB()`, after creating the pool, add:

```ts
  // Auto-create schedules table if it doesn't exist
  pool.execute(SCHEDULES_SCHEMA).catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db/mysql.ts
git commit -m "feat(scheduling): add MySQL schedules table auto-creation"
```

---

### Task 4: Create schedule-manager.ts

**Files:**
- Create: `src/lib/schedule-manager.ts`

- [ ] **Step 1: Create the schedule manager module**

Create `src/lib/schedule-manager.ts`:

```ts
import { Cron } from 'croner';
import { v4 as uuidv4 } from 'uuid';
import db from './db/index';
import { runReport } from './report-runner';
import { initProgress } from './progress-store';

// ── Types ──────────────────────────────────────────────────────────

export interface Schedule {
  id:             string;
  org:            string;
  period_days:    number;
  cron_expr:      string;
  timezone:       string;
  enabled:        number;
  test_mode:      number;
  last_run_at:    string | null;
  last_report_id: string | null;
  created_at:     string;
}

// ── GlobalThis store (survives HMR) ───────────────────────────────

const g = globalThis as typeof globalThis & {
  __glooker_schedules?: Map<string, Cron>;
  __glooker_scheduler_init?: boolean;
};
if (!g.__glooker_schedules) g.__glooker_schedules = new Map();
const jobs = g.__glooker_schedules;

// ── Public API ────────────────────────────────────────────────────

export async function initScheduler(): Promise<void> {
  if (g.__glooker_scheduler_init) return; // guard against double-init in dev
  g.__glooker_scheduler_init = true;

  console.log('[scheduler] Initializing…');

  // Recovery: mark orphaned "running" reports as "failed"
  await db.execute(
    `UPDATE reports SET status = 'failed', error = 'Server restarted during execution' WHERE status = 'running'`,
  );

  // Load all enabled schedules
  const [rows] = await db.execute<Schedule>(
    `SELECT * FROM schedules WHERE enabled = 1`,
  );

  for (const schedule of rows) {
    registerSchedule(schedule);
  }

  console.log(`[scheduler] ${rows.length} schedule(s) registered`);
}

export function registerSchedule(schedule: Schedule): void {
  // Stop existing job if any
  unregisterSchedule(schedule.id);

  if (!schedule.enabled) return;

  const job = new Cron(schedule.cron_expr, { timezone: schedule.timezone }, async () => {
    await triggerSchedule(schedule);
  });

  jobs.set(schedule.id, job);
  console.log(`[scheduler] Registered: ${schedule.id} (${schedule.cron_expr} ${schedule.timezone})`);
}

export function unregisterSchedule(id: string): void {
  const existing = jobs.get(id);
  if (existing) {
    existing.stop();
    jobs.delete(id);
    console.log(`[scheduler] Unregistered: ${id}`);
  }
}

export function getNextRun(cronExpr: string, timezone: string): Date | null {
  try {
    const job = new Cron(cronExpr, { timezone });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return null;
  }
}

// ── Trigger logic ─────────────────────────────────────────────────

async function triggerSchedule(schedule: Schedule): Promise<void> {
  const { id, org, period_days, test_mode } = schedule;

  try {
    // Concurrency check: skip if a report is already running for this org
    const [running] = await db.execute<{ id: string }>(
      `SELECT id FROM reports WHERE org = ? AND status = 'running' LIMIT 1`,
      [org],
    );
    if (running.length > 0) {
      console.log(`[scheduler] Skipping ${id}: report ${running[0].id} already running for ${org}`);
      return;
    }

    // Create a new report
    const reportId = uuidv4();
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status) VALUES (?, ?, ?, 'pending')`,
      [reportId, org, period_days],
    );
    initProgress(reportId);

    // Update schedule tracking
    await db.execute(
      `UPDATE schedules SET last_run_at = NOW(), last_report_id = ? WHERE id = ?`,
      [reportId, id],
    );

    console.log(`[scheduler] Triggered: schedule=${id}, report=${reportId}, org=${org}`);

    // Fire and forget — errors handled inside runReport, but wrap for safety
    runReport(reportId, org, period_days, false, Boolean(test_mode)).catch((err) => {
      console.error(`[scheduler] Report ${reportId} failed:`, err);
    });
  } catch (err) {
    console.error(`[scheduler] Trigger error for schedule ${id}:`, err);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/lib/schedule-manager.ts` (or just ensure dev server doesn't show errors)

- [ ] **Step 3: Commit**

```bash
git add src/lib/schedule-manager.ts
git commit -m "feat(scheduling): add schedule-manager with cron lifecycle and trigger logic"
```

---

### Task 5: Create instrumentation.ts

**Files:**
- Create: `src/instrumentation.ts`

- [ ] **Step 1: Create the Next.js instrumentation hook**

Create `src/instrumentation.ts`:

```ts
export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initScheduler } = await import('./lib/schedule-manager');
    await initScheduler();
  }
}
```

- [ ] **Step 2: Verify dev server starts and logs scheduler init**

Run: `npm run dev`
Expected: Console shows `[scheduler] Initializing…` and `[scheduler] 0 schedule(s) registered`.

- [ ] **Step 3: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat(scheduling): add instrumentation.ts to init scheduler on startup"
```

---

### Task 6: Create schedule API routes

**Files:**
- Create: `src/app/api/schedule/route.ts`
- Create: `src/app/api/schedule/[id]/route.ts`

- [ ] **Step 1: Create GET + POST route**

Create `src/app/api/schedule/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { Cron } from 'croner';
import db from '@/lib/db';
import { registerSchedule, getNextRun, type Schedule } from '@/lib/schedule-manager';

function validateBody(body: any): string | null {
  const { org, periodDays, cronExpr, timezone } = body;
  if (!org || typeof org !== 'string') return 'org is required';
  if (![3, 14, 30, 90].includes(Number(periodDays))) return 'periodDays must be 3, 14, 30, or 90';
  if (!cronExpr || typeof cronExpr !== 'string') return 'cronExpr is required';
  if (!timezone || typeof timezone !== 'string') return 'timezone is required';

  // Validate cron expression
  try {
    const test = new Cron(cronExpr, { timezone });
    test.stop();
  } catch {
    return 'Invalid cron expression or timezone';
  }

  return null;
}

export async function GET() {
  const [rows] = await db.execute(
    `SELECT s.*, r.status AS last_report_status
     FROM schedules s
     LEFT JOIN reports r ON s.last_report_id = r.id
     ORDER BY s.created_at DESC`,
  ) as [any[], any];

  // Compute next run for each schedule
  const enriched = rows.map((row: any) => ({
    ...row,
    next_run_at: row.enabled ? getNextRun(row.cron_expr, row.timezone)?.toISOString() ?? null : null,
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const error = validateBody(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const { org, periodDays, cronExpr, timezone, testMode = false, enabled = true } = body;
  const id = uuidv4();

  await db.execute(
    `INSERT INTO schedules (id, org, period_days, cron_expr, timezone, enabled, test_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0],
  );

  // Register the cron job if enabled
  if (enabled) {
    const schedule: Schedule = {
      id, org, period_days: Number(periodDays), cron_expr: cronExpr,
      timezone, enabled: 1, test_mode: testMode ? 1 : 0,
      last_run_at: null, last_report_id: null, created_at: new Date().toISOString(),
    };
    registerSchedule(schedule);
  }

  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 2: Create PUT + DELETE route**

Create `src/app/api/schedule/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { Cron } from 'croner';
import db from '@/lib/db';
import { registerSchedule, unregisterSchedule, type Schedule } from '@/lib/schedule-manager';

function validateBody(body: any): string | null {
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const error = validateBody(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const { org, periodDays, cronExpr, timezone, testMode, enabled } = body;

  // Verify schedule exists
  const [existing] = await db.execute(`SELECT id FROM schedules WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  await db.execute(
    `UPDATE schedules SET org = ?, period_days = ?, cron_expr = ?, timezone = ?, enabled = ?, test_mode = ?
     WHERE id = ?`,
    [org, Number(periodDays), cronExpr, timezone, enabled ? 1 : 0, testMode ? 1 : 0, id],
  );

  // Re-register (or unregister if disabled)
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
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  unregisterSchedule(id);
  await db.execute(`DELETE FROM schedules WHERE id = ?`, [id]);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Test API manually**

Run (with dev server running):
```bash
# Create a schedule
curl -X POST http://localhost:3000/api/schedule \
  -H 'Content-Type: application/json' \
  -d '{"org":"Smartling","periodDays":3,"cronExpr":"0 9 * * 1-5","timezone":"America/New_York","testMode":false,"enabled":true}'

# List schedules
curl http://localhost:3000/api/schedule

# Update (use the id from create response)
curl -X PUT http://localhost:3000/api/schedule/<id> \
  -H 'Content-Type: application/json' \
  -d '{"org":"Smartling","periodDays":14,"cronExpr":"0 9 * * 1","timezone":"UTC","testMode":false,"enabled":false}'

# Delete
curl -X DELETE http://localhost:3000/api/schedule/<id>
```

Expected: 201 on create, 200 on list/update/delete, proper JSON responses. Server logs should show `[scheduler] Registered` / `Unregistered` messages.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/schedule/route.ts src/app/api/schedule/\[id\]/route.ts
git commit -m "feat(scheduling): add CRUD API routes for schedules"
```

---

## Chunk 2: Frontend UI

### Task 7: Add reports list polling

**Files:**
- Modify: `src/app/page.tsx:67-81`

- [ ] **Step 1: Add a periodic poll for the reports list**

In `src/app/page.tsx`, after the existing `useEffect` that loads orgs and past reports on mount (lines 68-81), add a new effect that polls `GET /api/report` every 8 seconds:

```ts
  // Poll reports list to pick up scheduled reports
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/report')
        .then((r) => r.json())
        .then((reports: Report[]) => {
          setPastReports(reports);
          // If viewing a report that changed status, update it
          if (activeReport) {
            const updated = reports.find((r: Report) => r.id === activeReport.id);
            if (updated && updated.status !== activeReport.status) {
              setActiveReport((prev) => prev ? { ...prev, status: updated.status, completed_at: updated.completed_at } : prev);
              // If a report just completed and we're viewing it, load the full data
              if (updated.status === 'completed' && activeReport.status === 'running') {
                fetch(`/api/report/${updated.id}`).then((r) => r.json()).then((data) => {
                  setDevelopers(data.developers || []);
                  setActiveReport(data.report);
                });
              }
            }
          }
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport?.id, activeReport?.status]);
```

- [ ] **Step 2: Verify polling works**

Run: `npm run dev`, open browser, check Network tab — should see `GET /api/report` requests every ~8s.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(scheduling): add 8s reports list polling for scheduled reports"
```

---

### Task 8: Add Schedules sidebar section and create/edit form

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add schedule-related state and constants**

At the top of the `Home` component (after existing state declarations around line 63), add:

```ts
  // Schedule state
  const [schedules, setSchedules]             = useState<any[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<any | null>(null);
  const [scheduleOrg, setScheduleOrg]         = useState('');
  const [schedulePeriod, setSchedulePeriod]   = useState(3);
  const [scheduleCadence, setScheduleCadence] = useState('0 9 * * 1-5');
  const [scheduleCustomCron, setScheduleCustomCron] = useState('');
  const [scheduleTz, setScheduleTz]           = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [scheduleTestMode, setScheduleTestMode] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [isCustomCron, setIsCustomCron]       = useState(false);
```

Add these constants **outside** the component (above `export default function Home()`):

```ts
const CADENCE_PRESETS = [
  { label: 'Every hour',           cron: '0 * * * *' },
  { label: 'Daily at midnight',    cron: '0 0 * * *' },
  { label: 'Daily at 9 AM',        cron: '0 9 * * *' },
  { label: 'Weekdays at 9 AM',     cron: '0 9 * * 1-5' },
  { label: 'Weekly (Monday 9 AM)', cron: '0 9 * * 1' },
  { label: 'Monthly (1st at 9 AM)', cron: '0 9 1 * *' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
];
```

- [ ] **Step 2: Add schedule data loading**

In the existing mount `useEffect` (lines 68-81), add a fetch for schedules:

```ts
    fetch('/api/schedule')
      .then((r) => r.json())
      .then(setSchedules)
      .catch(() => {});
```

Also add schedule fetching to the reports polling `useEffect` from Task 7, so schedules refresh every 8s too. Add inside the interval callback:

```ts
      fetch('/api/schedule').then((r) => r.json()).then(setSchedules).catch(() => {});
```

- [ ] **Step 3: Add schedule CRUD handler functions**

After the existing `resumeReport` function (around line 216), add:

```ts
  function resetScheduleForm() {
    setScheduleOrg(orgs[0]?.login || '');
    setSchedulePeriod(3);
    setScheduleCadence('0 9 * * 1-5');
    setScheduleCustomCron('');
    setScheduleTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    setScheduleTestMode(false);
    setScheduleEnabled(true);
    setIsCustomCron(false);
    setEditingSchedule(null);
  }

  function openNewScheduleForm() {
    resetScheduleForm();
    setShowScheduleForm(true);
  }

  function openEditScheduleForm(s: any) {
    setEditingSchedule(s);
    setScheduleOrg(s.org);
    setSchedulePeriod(s.period_days);
    setScheduleTz(s.timezone);
    setScheduleTestMode(Boolean(s.test_mode));
    setScheduleEnabled(Boolean(s.enabled));

    // Check if cron matches a preset
    const preset = CADENCE_PRESETS.find((p) => p.cron === s.cron_expr);
    if (preset) {
      setScheduleCadence(preset.cron);
      setIsCustomCron(false);
      setScheduleCustomCron('');
    } else {
      setScheduleCadence('');
      setIsCustomCron(true);
      setScheduleCustomCron(s.cron_expr);
    }
    setShowScheduleForm(true);
  }

  async function saveSchedule() {
    const cronExpr = isCustomCron ? scheduleCustomCron : scheduleCadence;
    const payload = {
      org: scheduleOrg,
      periodDays: schedulePeriod,
      cronExpr,
      timezone: scheduleTz,
      testMode: scheduleTestMode,
      enabled: scheduleEnabled,
    };

    try {
      if (editingSchedule) {
        const res = await fetch(`/api/schedule/${editingSchedule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to update schedule');
          return;
        }
      } else {
        const res = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to create schedule');
          return;
        }
      }

      // Refresh schedules and close form
      fetch('/api/schedule').then((r) => r.json()).then(setSchedules).catch(() => {});
      setShowScheduleForm(false);
      resetScheduleForm();
    } catch {
      alert('Network error — could not save schedule');
    }
  }

  async function deleteSchedule(id: string) {
    try {
      const res = await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      if (editingSchedule?.id === id) {
        setShowScheduleForm(false);
        resetScheduleForm();
      }
    } catch {
      // ignore
    }
  }

  async function toggleScheduleEnabled(s: any) {
    const payload = {
      org: s.org,
      periodDays: s.period_days,
      cronExpr: s.cron_expr,
      timezone: s.timezone,
      testMode: Boolean(s.test_mode),
      enabled: !s.enabled,
    };
    await fetch(`/api/schedule/${s.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    fetch('/api/schedule').then((r) => r.json()).then(setSchedules).catch(() => {});
  }
```

- [ ] **Step 4: Add Schedules section to sidebar JSX**

Inside the sidebar `<div className="w-60 shrink-0">`, after the reports list `</div>` (line 405) but BEFORE the sidebar's closing `</div>` (line 406), add the Schedules section:

> **Note:** The create/edit form is placed in the main content area (Task 8, Step 5) rather than inline in the sidebar, because the form fields are too wide for the 240px sidebar.

```tsx
          {/* Schedules */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Schedules</p>
              <button
                onClick={openNewScheduleForm}
                disabled={orgs.length === 0}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed"
              >
                + New
              </button>
            </div>
            <div className="space-y-1.5">
              {schedules.length === 0 && !showScheduleForm && (
                <p className="text-gray-600 text-sm">No schedules</p>
              )}
              {schedules.map((s) => {
                const presetLabel = CADENCE_PRESETS.find((p) => p.cron === s.cron_expr)?.label || s.cron_expr;
                return (
                  <div key={s.id} className="group px-3 py-2.5 rounded-lg text-sm border border-transparent hover:bg-gray-800/50 hover:border-gray-800">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => openEditScheduleForm(s)}
                        className="text-left flex-1 min-w-0"
                      >
                        <span className="font-medium text-white truncate block">{s.org}</span>
                        <span className="text-xs text-gray-500">{presetLabel} &middot; {s.period_days}d</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleScheduleEnabled(s); }}
                          className={`w-8 h-4 rounded-full transition-colors relative ${s.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                          title={s.enabled ? 'Disable' : 'Enable'}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${s.enabled ? 'left-4' : 'left-0.5'}`} />
                        </button>
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); deleteSchedule(s.id); }}
                          className="p-0.5 rounded text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Delete schedule"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    {/* Status indicators */}
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      {s.last_run_at && (
                        <span className="text-gray-600">
                          Last: {timeAgo(s.last_run_at)}
                          {s.last_report_status && (
                            <span className={
                              s.last_report_status === 'completed' ? ' text-green-500' :
                              s.last_report_status === 'failed' ? ' text-red-400' :
                              s.last_report_status === 'running' ? ' text-blue-400' : ''
                            }> ({s.last_report_status})</span>
                          )}
                        </span>
                      )}
                      {s.next_run_at && s.enabled && (
                        <span className="text-gray-600">
                          Next: {new Date(s.next_run_at).toLocaleString('en-US', {
                            timeZone: s.timezone,
                            month: 'short', day: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
```

- [ ] **Step 5: Add the schedule create/edit form in the main content area**

In the main content area, before the `{/* Run form */}` section (around line 411), add:

```tsx
          {/* Schedule form */}
          {showScheduleForm && (
            <div className="bg-gray-900 rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">
                  {editingSchedule ? 'Edit Schedule' : 'New Schedule'}
                </h3>
                <button onClick={() => { setShowScheduleForm(false); resetScheduleForm(); }} className="text-gray-500 hover:text-gray-300 text-sm">
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Org */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Org</label>
                  <select value={scheduleOrg} onChange={(e) => setScheduleOrg(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                    {orgs.map((o) => <option key={o.login} value={o.login}>{o.login}</option>)}
                  </select>
                </div>
                {/* Period */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Period</label>
                  <select value={schedulePeriod} onChange={(e) => setSchedulePeriod(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                    {[3, 14, 30, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </div>
                {/* Cadence */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Cadence</label>
                  <select
                    value={isCustomCron ? '__custom__' : scheduleCadence}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setIsCustomCron(true);
                        setScheduleCadence('');
                      } else {
                        setIsCustomCron(false);
                        setScheduleCadence(e.target.value);
                        setScheduleCustomCron('');
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {CADENCE_PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
                    <option value="__custom__">Custom cron expression</option>
                  </select>
                  {isCustomCron && (
                    <input
                      type="text"
                      value={scheduleCustomCron}
                      onChange={(e) => setScheduleCustomCron(e.target.value)}
                      placeholder="e.g. 0 9 * * 1-5"
                      className="w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>
                {/* Timezone */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Timezone</label>
                  <select value={scheduleTz} onChange={(e) => setScheduleTz(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                    {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
              </div>
              {/* Options row */}
              <div className="flex items-center gap-6 mt-4">
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={scheduleTestMode} onChange={(e) => setScheduleTestMode(e.target.checked)}
                    className="rounded bg-gray-800 border-gray-700" />
                  Test mode
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="rounded bg-gray-800 border-gray-700" />
                  Enabled
                </label>
              </div>
              {/* Actions */}
              <div className="flex gap-3 mt-4">
                <button onClick={saveSchedule}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
                  {editingSchedule ? 'Update' : 'Create'} Schedule
                </button>
                {editingSchedule && (
                  <button onClick={() => deleteSchedule(editingSchedule.id)}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 6: Add the timeAgo helper function**

Add this utility function outside the component (near the other helper components like `ComplexityBadge`):

```ts
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 7: Verify the full UI works**

Run: `npm run dev`, open http://localhost:3000
Expected:
- "Schedules" section appears in sidebar below "Past Reports"
- "+ New" button opens the form in the main content area
- Cadence dropdown fills cron value; "Custom" shows the text input
- Timezone defaults to browser timezone
- Create/edit/delete/toggle all work
- Last run and next run indicators show in the sidebar

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(scheduling): add schedules sidebar, create/edit form, and reports polling"
```

---

## Chunk 3: Integration Verification

### Task 9: End-to-end verification

- [ ] **Step 1: Create a test schedule with a 1-minute cron**

Using the UI, create a schedule:
- Org: (your org)
- Period: 3 days
- Cadence: Custom → `* * * * *` (every minute, for testing)
- Timezone: your timezone
- Test mode: checked
- Enabled: checked

- [ ] **Step 2: Wait for the cron to trigger**

Wait ~1 minute. Check:
- Server console logs: `[scheduler] Triggered: schedule=...`
- Sidebar: new report appears with "running" status (within 8s poll cycle)
- Report completes or runs (depending on GitHub API availability)

- [ ] **Step 3: Verify concurrency guard**

While a report is running, wait for the next cron trigger. Check server logs:
Expected: `[scheduler] Skipping ...: report ... already running for ...`

- [ ] **Step 4: Clean up test schedule**

Delete or disable the test schedule via the UI.

- [ ] **Step 5: Verify server restart recovery**

1. Start a report running (via schedule or manually)
2. Kill the dev server (Ctrl+C)
3. Restart with `npm run dev`
Expected: Console shows `[scheduler] Initializing…` and any previously-running report gets marked as `failed` in the DB.

- [ ] **Step 6: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "feat(scheduling): integration cleanup"
```
