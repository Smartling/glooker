# Scheduling Feature Design

## Overview

Add cron-based scheduled report generation to Glooker. Schedules are stored in the database, managed via the dashboard UI, and executed by `croner` running inside the Next.js process.

## Data Model

New `schedules` table (SQLite syntax shown; MySQL equivalent uses `DATETIME DEFAULT CURRENT_TIMESTAMP` for `created_at` and standard `FOREIGN KEY` syntax, derived the same way as existing tables):

```sql
CREATE TABLE IF NOT EXISTS schedules (
  id             TEXT    NOT NULL PRIMARY KEY,  -- UUID
  org            TEXT    NOT NULL,
  period_days    INTEGER NOT NULL,
  cron_expr      TEXT    NOT NULL,              -- e.g. "0 9 * * 1"
  timezone       TEXT    NOT NULL DEFAULT 'UTC',
  enabled        INTEGER NOT NULL DEFAULT 1,
  test_mode      INTEGER NOT NULL DEFAULT 0,
  last_run_at    TEXT,
  last_report_id TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (last_report_id) REFERENCES reports(id) ON DELETE SET NULL
);
```

- `last_run_at` and `last_report_id` track the most recent execution.
- Added to both SQLite schema (in `db/sqlite.ts`) and MySQL schema init.
- If any schedule queries use `ON DUPLICATE KEY UPDATE`, add `schedules` to the `conflictCols` map in `translateSQL()`.

## Scheduler Module

**File:** `src/lib/schedule-manager.ts`

- `globalThis.__glooker_schedules` — `Map<string, Cron>` surviving HMR reloads.
- `initScheduler()` — called from `instrumentation.ts`:
  1. Marks any orphaned `running` reports as `failed` (recovery from server restart).
  2. Loads all enabled schedules from DB, registers cron jobs.
- `registerSchedule(schedule)` — creates a `croner` Cron job that calls the trigger function directly, then updates `last_run_at` and `last_report_id` in the DB.
- `unregisterSchedule(id)` — stops and removes a cron job from the map.
- `getNextRun(cronExpr, timezone)` — uses `croner`'s built-in `.nextRun()` method to compute next fire time for UI display.

### Initialization

Uses Next.js `instrumentation.ts` (`register()` hook) which runs once on server startup. Two guards:
1. **Runtime check:** `if (process.env.NEXT_RUNTIME === 'nodejs')` — prevents running in Edge runtime where node APIs are unavailable.
2. **`globalThis` guard:** prevents double-init in dev mode (same pattern as progress-store).

### On Trigger

1. **Concurrency check:** query `reports` table for any `running` report with the same `org`. If one exists, skip this run and log a warning.
2. Generate a new report UUID.
3. Insert a pending report row into `reports` table.
4. Initialize progress tracker.
5. Call `runReport(id, org, periodDays, false, testMode)` wrapped in try/catch — errors are logged but never crash the scheduler.
6. Update `schedules` row: set `last_run_at = NOW()`, `last_report_id = id`.

## API Endpoints

### `GET /api/schedule`

Returns all schedules ordered by `created_at DESC`. Each row includes the linked report's status (via `last_report_id` join) for UI display.

### `POST /api/schedule`

Create a new schedule.

**Body (all required):**
```json
{
  "org": "Smartling",
  "periodDays": 3,
  "cronExpr": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "testMode": false,
  "enabled": true
}
```

- Validates `periodDays` is one of `[3, 14, 30, 90]`.
- Validates cron expression with `croner`'s pattern parsing (throws on invalid).
- Inserts into DB, registers the cron job in the live scheduler.

### `PUT /api/schedule/[id]`

Full replacement update of a schedule.

**Body (all required):**
```json
{
  "org": "Smartling",
  "periodDays": 3,
  "cronExpr": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "testMode": false,
  "enabled": true
}
```

- Validates `periodDays` and cron expression (same as POST).
- Updates DB row, stops old cron job, registers new one (or just stops if `enabled: false`).

### `DELETE /api/schedule/[id]`

Deletes the schedule from DB and stops the cron job.

## UI Design

### Location

New "Schedules" section in the sidebar, below the existing reports list. Same single-page dashboard, no separate route.

### Schedule List (Sidebar)

- Each schedule shows: org name, cadence (human-readable), enabled/disabled toggle.
- Click to expand/edit inline.
- "New Schedule" button at the top of the section.

### Create/Edit Form (Inline Panel)

| Field | Control | Notes |
|---|---|---|
| Org | Dropdown | Same source as report form (`/api/orgs`) |
| Period | Dropdown | 3, 14, 30, 90 days |
| Cadence | Dropdown + hidden cron input | Preset fills the cron value; "Custom" reveals the input |
| Timezone | Dropdown | Common timezones, browser timezone auto-detected as default |
| Test mode | Checkbox | |
| Enabled | Toggle | |

### Cadence Presets

| Preset | Cron Expression |
|---|---|
| Every hour | `0 * * * *` |
| Daily at midnight | `0 0 * * *` |
| Daily at 9 AM | `0 9 * * *` |
| Weekdays at 9 AM | `0 9 * * 1-5` |
| Weekly (Monday 9 AM) | `0 9 * * 1` |
| Monthly (1st at 9 AM) | `0 9 1 * *` |
| Custom | User-provided cron expression |

Default selection: **Weekdays at 9 AM**.

### Status Indicators

- **Last run:** Relative time ("2 hours ago") + linked report's status (completed/failed/running) + link to the report.
- **Next run:** Computed from cron expression + timezone via `croner`'s `.nextRun()` (e.g. "Mon Mar 16 at 9:00 AM ET").

### Timezone Dropdown Options

Auto-detect browser timezone as default. List includes:
- UTC
- America/New_York
- America/Chicago
- America/Denver
- America/Los_Angeles
- Europe/London
- Europe/Berlin
- Asia/Tokyo

## Dependencies

- `croner` — cron scheduler with built-in timezone support and `.nextRun()`. Single dependency, no extras needed.

## Next.js Configuration

- Add `croner` to `serverExternalPackages` in `next.config.ts` if bundling issues arise (same approach as `better-sqlite3` and `mysql2`).

## Out of Scope

- Auto-send email digest after report completes (no email system yet).
- Email delivery, opt-in/opt-out, template rendering.
- "Run now" manual trigger button for schedules.
- Schedule count limits.
- `schedule_id` foreign key on `reports` table (linking reports to their source schedule).
