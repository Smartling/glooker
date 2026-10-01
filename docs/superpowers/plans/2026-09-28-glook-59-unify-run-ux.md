# GLOOK-59 Unified Run UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub reports and vulnerability syncs structurally consistent — one run model, one run card, one Runs page, one freshness/header pattern — without changing either pipeline's semantics.

**Architecture:** Pure helpers in `src/lib/runs/` (status mapping, formatting, health, staleness) feed presentational components in `src/components/runs/` (`RunStatusChip`, `RunHealthBadge`, `RunCard`, `RunsToolbar`, `DataFreshness`) and `src/components/PageHeader.tsx`. The reports tab and the vulnerability syncs tab become thin adapters over `RunCard`. Backend changes are additive: two nullable columns on `reports`, a `health` summary on the report list, `org` on the syncs list, and freshness fields on `/api/llm-config`.

**Tech Stack:** Next.js 15 App Router, React, SWR, Tailwind, croner, Jest + ts-jest + @testing-library/react (jsdom), SQLite/MySQL.

**Spec:** `docs/superpowers/specs/2026-09-28-glook-59-unify-run-ux-design.md` (copy of Jira GLOOK-59).

## Global Constraints

- Do NOT change vulnerability sync semantics: `src/lib/vulnerabilities/sync.ts`, the completeness guard, `missing_since`, `withheld_since` are untouchable. Read `src/lib/vulnerabilities/CLAUDE.md` before editing anything under `src/lib/vulnerabilities/`.
- Never join the vulnerability repo `team` property with Glooker's `teams` table.
- Never put real SLA dates, property keys or property values in code, tests or docs (public repo).
- Sync Stop is OUT of scope (pending the module owner's design check). Syncs never get Delete.
- Every `src/app/api/**/route.ts` handler stays wrapped in `withRequestLog()`.
- `src/app/**/page.tsx` files may export ONLY `default` — put anything testable in a sibling module.
- New DB columns go in `schema.sql` (MySQL base table), an `ALTER TABLE` in `src/lib/db/mysql.ts` (ignore `ER_DUP_FIELDNAME`), and the SQLite `CREATE TABLE` + `ALTER` in `src/lib/db/sqlite.ts`. Never pin a charset.
- `DECIMAL`/`REAL`/JSON columns may come back as strings — `Number()` numbers, and parse JSON that may be a string (SQLite) or an object (MySQL).
- Timestamps shown to users go through `formatRunTime()` (America/New_York, `month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'`).
- Use theme tokens (`text-accent-light`, `bg-accent`, `border-accent`, `bg-accent/10`, `hover:bg-accent-dark`) instead of `indigo-*` in every file this plan touches.
- Behavioural component tests need the `/** @jest-environment jsdom */` docblock and live under `src/lib/__tests__/unit/` (jest `roots` is `src/lib`; tests elsewhere silently never run).
- Jest 30: filter with `--testPathPatterns` (plural).
- Test files that import anything reaching `src/lib/github.ts` must mock `@octokit/rest` with the factory form.
- Baseline before Task 1: 169 suites / 1669 tests green. Every task ends with `npx jest` fully green and `npx tsc --noEmit` clean.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **Legacy report rows with NULL `trigger_kind`** (every report created before this change): the card must show no trigger text, not "Manual" and not "null". Test pinned in Task 3 and Task 5.
2. **`run_metadata` arriving as a JSON string (SQLite), an object (MySQL), NULL, or malformed text**: the report list must not 500 — health becomes `null`. Test pinned in Task 3.
3. **A report whose status is not in the known set** (e.g. a future status): chip must still render something readable, not crash. `fromReportStatus` falls back to `'pending'` with the raw label. Test pinned in Task 1.
4. **Report staleness with a weekday-only schedule on a Monday morning**: must NOT read stale (the Fri→Mon gap is normal). Test pinned in Task 7.
5. **Viewing an older report**: Team/Org Summary must show the "Viewing historical report" notice and must NOT show staleness or a latest-run-failed banner that belongs to a different run. Test pinned in Task 8.

---

### Task 1: Run primitives (status, format, health, staleness)

**Files:**
- Create: `src/lib/runs/status.ts`, `src/lib/runs/format.ts`, `src/lib/runs/health.ts`, `src/lib/runs/staleness.ts`
- Test: `src/lib/__tests__/unit/runs-primitives.test.ts`

**Interfaces:**
- Produces:
  - `type RunStatus = 'pending' | 'running' | 'succeeded' | 'partial' | 'stopped' | 'failed'`
  - `fromReportStatus(s: string): { status: RunStatus; label: string }` and `fromSyncStatus(s: string): { status: RunStatus; label: string }`
  - `isActive(s: RunStatus): boolean`
  - `STATUS_STYLE: Record<RunStatus, { text: string; bg: string }>`
  - `formatRunTime(v: string | Date | null | undefined): string`, `formatDuration(start, end): string`, `triggerLabel(kind, by): string | null`
  - `interface RunHealth { tone: 'info' | 'warn' | 'error'; label: string; title?: string }`
  - `reportHealth(meta: unknown): RunHealth | null` (accepts object, JSON string, null, garbage)
  - `syncHealth(row: { status: string; issues: Array<{ message: string }> }): RunHealth | null`
  - `staleAfterMs(schedules: Array<{ cron_expr: string; timezone: string; enabled: unknown }>, now: Date): number | null`
  - `isStale(lastAt: string | Date | null, staleMs: number | null, now: Date): boolean`

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/unit/runs-primitives.test.ts`

```ts
import { fromReportStatus, fromSyncStatus, isActive, STATUS_STYLE } from '@/lib/runs/status';
import { formatRunTime, formatDuration, triggerLabel } from '@/lib/runs/format';
import { reportHealth, syncHealth } from '@/lib/runs/health';
import { staleAfterMs, isStale } from '@/lib/runs/staleness';

describe('run status mapping', () => {
  it('maps report statuses onto the shared model', () => {
    expect(fromReportStatus('completed')).toEqual({ status: 'succeeded', label: 'succeeded' });
    expect(fromReportStatus('stopped')).toEqual({ status: 'stopped', label: 'stopped' });
    expect(fromReportStatus('running')).toEqual({ status: 'running', label: 'running' });
    expect(fromReportStatus('pending')).toEqual({ status: 'pending', label: 'pending' });
    expect(fromReportStatus('failed')).toEqual({ status: 'failed', label: 'failed' });
  });
  it('maps sync statuses onto the shared model', () => {
    expect(fromSyncStatus('succeeded').status).toBe('succeeded');
    expect(fromSyncStatus('partial').status).toBe('partial');
    expect(fromSyncStatus('failed').status).toBe('failed');
    expect(fromSyncStatus('running').status).toBe('running');
  });
  it('falls back to pending with the raw label for an unknown status', () => {
    expect(fromReportStatus('archived')).toEqual({ status: 'pending', label: 'archived' });
    expect(fromSyncStatus('weird')).toEqual({ status: 'pending', label: 'weird' });
  });
  it('isActive only for pending/running', () => {
    expect(isActive('running')).toBe(true);
    expect(isActive('pending')).toBe(true);
    expect(isActive('succeeded')).toBe(false);
  });
  it('has a style for every status and uses the accent token for running', () => {
    for (const s of ['pending', 'running', 'succeeded', 'partial', 'stopped', 'failed'] as const) {
      expect(STATUS_STYLE[s].text).toBeTruthy();
    }
    expect(STATUS_STYLE.running.text).toContain('accent');
  });
});

describe('run formatting', () => {
  it('formats times in America/New_York', () => {
    expect(formatRunTime('2026-09-22T10:00:00Z')).toBe('Sep 22, 6:00 AM');
  });
  it('returns an em dash for missing or invalid times', () => {
    expect(formatRunTime(null)).toBe('—');
    expect(formatRunTime('not a date')).toBe('—');
  });
  it('formats durations as Xm SSs', () => {
    expect(formatDuration('2026-09-22T10:00:00Z', '2026-09-22T10:04:12Z')).toBe('4m 12s');
    expect(formatDuration('2026-09-22T10:00:00Z', null)).toBe('—');
    expect(formatDuration('2026-09-22T10:05:00Z', '2026-09-22T10:00:00Z')).toBe('—');
  });
  it('labels triggers, and returns null for legacy rows with no trigger', () => {
    expect(triggerLabel('schedule', null)).toBe('Scheduled');
    expect(triggerLabel('manual', 'a@x')).toBe('Manual · a@x');
    expect(triggerLabel('manual', null)).toBe('Manual');
    expect(triggerLabel(null, null)).toBeNull();
    expect(triggerLabel(undefined, 'a@x')).toBeNull();
  });
});

describe('run health', () => {
  const base = { skipped: [], errors: [], expectedCount: 10, thresholds: {} };
  it('is null for no metadata or a clean ok run', () => {
    expect(reportHealth(null)).toBeNull();
    expect(reportHealth({ ...base, state: 'ok' })).toBeNull();
  });
  it('reports unverified figures on an ok run', () => {
    expect(reportHealth({ ...base, state: 'ok', unverified: [{ login: 'a', field: 'prs', reason: 'x' }] }))
      .toEqual({ tone: 'info', label: '1 unverified' });
  });
  it('reports degraded runs with the unexplained count', () => {
    const skipped = [
      { login: 'a', reason: 'r', classification: 'unknown' },
      { login: 'b', reason: 'r', classification: 'expected' },
    ];
    expect(reportHealth({ ...base, state: 'degraded', skipped })).toEqual({ tone: 'warn', label: '2 partial (1 unexplained)' });
  });
  it('reports failed runs as incomplete with the abort reason as title', () => {
    expect(reportHealth({ ...base, state: 'failed', abortReason: 'too many skips' }))
      .toEqual({ tone: 'error', label: 'incomplete', title: 'too many skips' });
  });
  it('accepts a JSON string (SQLite) and survives malformed input', () => {
    expect(reportHealth(JSON.stringify({ ...base, state: 'failed' }))?.label).toBe('incomplete');
    expect(reportHealth('{not json')).toBeNull();
    expect(reportHealth(42)).toBeNull();
    expect(reportHealth({ nonsense: true })).toBeNull();
  });
  it('sync health counts issues on finished runs only', () => {
    expect(syncHealth({ status: 'partial', issues: [{ message: 'a' }, { message: 'b' }] })).toEqual({ tone: 'warn', label: '2 issues' });
    expect(syncHealth({ status: 'failed', issues: [{ message: 'a' }] })).toEqual({ tone: 'error', label: '1 issue' });
    expect(syncHealth({ status: 'succeeded', issues: [] })).toBeNull();
    expect(syncHealth({ status: 'running', issues: [{ message: 'a' }] })).toBeNull();
  });
});

describe('report staleness', () => {
  const monday9am = new Date('2026-09-28T13:00:00Z'); // Mon 09:00 America/New_York
  it('is null when no schedule is enabled', () => {
    expect(staleAfterMs([], monday9am)).toBeNull();
    expect(staleAfterMs([{ cron_expr: '0 9 * * *', timezone: 'America/New_York', enabled: 0 }], monday9am)).toBeNull();
  });
  it('uses the largest gap between upcoming fires plus 12h grace', () => {
    // weekday 9am: largest gap is Fri 9am -> Mon 9am = 72h
    const ms = staleAfterMs([{ cron_expr: '0 9 * * 1-5', timezone: 'America/New_York', enabled: 1 }], monday9am);
    expect(ms).toBe((72 + 12) * 3600 * 1000);
  });
  it('takes the tightest threshold across schedules and skips invalid crons', () => {
    const ms = staleAfterMs([
      { cron_expr: 'not a cron', timezone: 'America/New_York', enabled: true },
      { cron_expr: '0 9 * * 1', timezone: 'America/New_York', enabled: true },   // weekly: 168h
      { cron_expr: '0 */6 * * *', timezone: 'America/New_York', enabled: true }, // 6h
    ], monday9am);
    expect(ms).toBe((6 + 12) * 3600 * 1000);
  });
  it('a Monday-morning report after a Friday run is not stale on a weekday schedule', () => {
    const ms = staleAfterMs([{ cron_expr: '0 9 * * 1-5', timezone: 'America/New_York', enabled: 1 }], monday9am);
    expect(isStale('2026-09-25T13:05:00Z', ms, monday9am)).toBe(false); // Fri 09:05 ET, 72h ago
  });
  it('isStale: never stale without a threshold; stale when missing data and a threshold exists', () => {
    expect(isStale('2020-01-01T00:00:00Z', null, monday9am)).toBe(false);
    expect(isStale(null, 1000, monday9am)).toBe(true);
    expect(isStale(new Date(monday9am.getTime() - 2000), 1000, monday9am)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPatterns="runs-primitives"`
Expected: FAIL — cannot find module `@/lib/runs/status`.

- [ ] **Step 3: Implement**

`src/lib/runs/status.ts`:
```ts
/** GLOOK-59: one run model shared by GitHub reports and vulnerability syncs. */
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'partial' | 'stopped' | 'failed';

const REPORT: Record<string, RunStatus> = {
  pending: 'pending', running: 'running', completed: 'succeeded', failed: 'failed', stopped: 'stopped',
};
const SYNC: Record<string, RunStatus> = {
  running: 'running', succeeded: 'succeeded', partial: 'partial', failed: 'failed',
};

function map(table: Record<string, RunStatus>, s: string): { status: RunStatus; label: string } {
  const status = table[s];
  // An unknown status still renders (neutral chip, raw text) rather than being mislabelled.
  return status ? { status, label: status } : { status: 'pending', label: s };
}

export const fromReportStatus = (s: string) => map(REPORT, s);
export const fromSyncStatus = (s: string) => map(SYNC, s);
export const isActive = (s: RunStatus) => s === 'pending' || s === 'running';

export const STATUS_STYLE: Record<RunStatus, { text: string; bg: string }> = {
  pending:   { text: 'text-gray-400',      bg: 'bg-gray-800' },
  running:   { text: 'text-accent-light',  bg: 'bg-accent/10' },
  succeeded: { text: 'text-green-400',     bg: 'bg-green-500/10' },
  partial:   { text: 'text-amber-400',     bg: 'bg-amber-500/10' },
  stopped:   { text: 'text-orange-400',    bg: 'bg-orange-500/10' },
  failed:    { text: 'text-red-400',       bg: 'bg-red-500/10' },
};
```

`src/lib/runs/format.ts`:
```ts
const TZ = 'America/New_York';

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The one timestamp format for run cards and freshness lines. */
export function formatRunTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  const a = toDate(start), b = toDate(end);
  if (!a || !b) return '—';
  const s = Math.round((b.getTime() - a.getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** null for rows that predate trigger tracking — show nothing rather than guess. */
export function triggerLabel(kind: string | null | undefined, by: string | null | undefined): string | null {
  if (kind === 'schedule') return 'Scheduled';
  if (kind === 'manual') return by ? `Manual · ${by}` : 'Manual';
  return null;
}
```

`src/lib/runs/health.ts`:
```ts
import { countableSkips, type RunMetadata } from '@/lib/report-runner/types';

export interface RunHealth { tone: 'info' | 'warn' | 'error'; label: string; title?: string }

function parse(meta: unknown): RunMetadata | null {
  let m: any = meta;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return null; }
  }
  if (!m || typeof m !== 'object' || !['ok', 'degraded', 'failed'].includes(m.state)) return null;
  return m as RunMetadata;
}

/** Compact, card-sized summary of a report's integrity. Same rules as IntegrityBadge. */
export function reportHealth(meta: unknown): RunHealth | null {
  const m = parse(meta);
  if (!m) return null;
  if (m.state === 'failed') return m.abortReason ? { tone: 'error', label: 'incomplete', title: m.abortReason } : { tone: 'error', label: 'incomplete' };
  if (m.state === 'degraded') {
    const skipped = Array.isArray(m.skipped) ? m.skipped : [];
    const counted = countableSkips(skipped).length;
    return { tone: 'warn', label: `${skipped.length} partial${counted > 0 ? ` (${counted} unexplained)` : ''}` };
  }
  const unverified = Array.isArray(m.unverified) ? m.unverified.length : 0;
  return unverified > 0 ? { tone: 'info', label: `${unverified} unverified` } : null;
}

export function syncHealth(row: { status: string; issues: Array<{ message: string }> }): RunHealth | null {
  const n = Array.isArray(row.issues) ? row.issues.length : 0;
  if (row.status === 'running' || n === 0) return null;
  return { tone: row.status === 'failed' ? 'error' : 'warn', label: `${n} issue${n === 1 ? '' : 's'}` };
}
```

`src/lib/runs/staleness.ts`:
```ts
import { Cron } from 'croner';

const GRACE_MS = 12 * 3600 * 1000;
const LOOKAHEAD = 8;

/**
 * GLOOK-59: how old the latest good report may get before it reads stale. Derived from the
 * enabled schedules: the largest gap between consecutive upcoming fires (so a weekday schedule's
 * Fri→Mon gap is normal) plus a 12h grace; the tightest schedule wins. null = no enabled schedule,
 * which means "never stale" — without a schedule there is no expectation to miss.
 */
export function staleAfterMs(
  schedules: Array<{ cron_expr: string; timezone: string; enabled: unknown }>,
  now: Date,
): number | null {
  let best: number | null = null;
  for (const s of schedules) {
    if (!s.enabled || s.enabled === '0') continue;
    let runs: Date[];
    try {
      const job = new Cron(s.cron_expr, { timezone: s.timezone, paused: true });
      runs = job.nextRuns(LOOKAHEAD, now);
      job.stop();
    } catch {
      continue;
    }
    if (runs.length < 2) continue;
    let gap = 0;
    for (let i = 1; i < runs.length; i++) gap = Math.max(gap, runs[i].getTime() - runs[i - 1].getTime());
    const ms = gap + GRACE_MS;
    best = best === null ? ms : Math.min(best, ms);
  }
  return best;
}

export function isStale(lastAt: string | Date | null, staleMs: number | null, now: Date): boolean {
  if (staleMs === null) return false;
  if (!lastAt) return true;
  const t = (lastAt instanceof Date ? lastAt : new Date(lastAt)).getTime();
  return Number.isNaN(t) || now.getTime() - t > staleMs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --testPathPatterns="runs-primitives"` → PASS. If the 72h weekday assertion is off by DST, the fixture dates (late September) have no DST transition in the 8-fire window; recheck the cron rather than loosening the test.

- [ ] **Step 5: Full suite + types, then commit**

```bash
npx jest && npx tsc --noEmit
git add src/lib/runs src/lib/__tests__/unit/runs-primitives.test.ts
git commit -m "GLOOK-59: shared run model, formatting, health and staleness helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared run UI components

**Files:**
- Create: `src/components/runs/RunStatusChip.tsx`, `src/components/runs/RunHealthBadge.tsx`, `src/components/runs/RunCard.tsx`, `src/components/runs/RunsToolbar.tsx`
- Test: `src/lib/__tests__/unit/run-card.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`RunStatus`, `STATUS_STYLE`, `RunHealth`, `formatRunTime`, `formatDuration`).
- Produces:
  - `<RunStatusChip status={RunStatus} label={string} />`
  - `<RunHealthBadge health={RunHealth | null} />` (renders nothing for null)
  - `interface RunProgressView { step: string; counter?: string | null; pct: number; running: boolean; tone: 'normal' | 'failed' | 'stopped'; error?: string | null; logs: string[] }`
  - `logLineClass(line: string): string`
  - `<RunCard status label subject trigger startedAt finishedAt health actions progress expandable expanded onToggle>{expanded body}</RunCard>`
  - `<RunsToolbar info={ReactNode} action={ReactNode} error={string | null} />`

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/unit/run-card.test.tsx`

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RunCard, { logLineClass } from '@/components/runs/RunCard';
import RunHealthBadge from '@/components/runs/RunHealthBadge';
import RunsToolbar from '@/components/runs/RunsToolbar';

const base = {
  status: 'succeeded' as const, label: 'succeeded', subject: <span>acme · 30 days</span>,
  trigger: 'Scheduled', startedAt: '2026-09-22T10:00:00Z', finishedAt: '2026-09-22T10:04:12Z',
  expandable: true, expanded: false, onToggle: jest.fn(),
};

describe('RunCard', () => {
  it('renders the shared header: chip, subject, trigger, duration, start time', () => {
    render(<RunCard {...base} />);
    expect(screen.getByText('succeeded')).toBeTruthy();
    expect(screen.getByText('acme · 30 days')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('4m 12s')).toBeTruthy();
    expect(screen.getByText('Sep 22, 6:00 AM')).toBeTruthy();
  });
  it('omits the trigger when it is null (legacy rows)', () => {
    const { container } = render(<RunCard {...base} trigger={null} />);
    expect(container.textContent).not.toContain('Manual');
    expect(container.textContent).not.toContain('null');
  });
  it('toggles only when expandable, and shows children only when expanded', () => {
    const onToggle = jest.fn();
    const { rerender } = render(<RunCard {...base} onToggle={onToggle}><p>stats body</p></RunCard>);
    expect(screen.queryByText('stats body')).toBeNull();
    fireEvent.click(screen.getByText('acme · 30 days'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<RunCard {...base} onToggle={onToggle} expanded><p>stats body</p></RunCard>);
    expect(screen.getByText('stats body')).toBeTruthy();
    rerender(<RunCard {...base} onToggle={onToggle} expandable={false}><p>stats body</p></RunCard>);
    fireEvent.click(screen.getByText('acme · 30 days'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it('action clicks do not toggle the card', () => {
    const onToggle = jest.fn();
    render(<RunCard {...base} onToggle={onToggle} actions={<button>Delete</button>} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onToggle).not.toHaveBeenCalled();
  });
  it('renders a progress block with step, counter, error and collapsible logs', () => {
    render(<RunCard {...base} status="running" label="running" finishedAt={null}
      progress={{ step: 'Fetching', counter: '3 / 10 repos', pct: 30, running: true, tone: 'normal', error: 'boom', logs: ['a', 'b'] }} />);
    expect(screen.getByText('Fetching')).toBeTruthy();
    expect(screen.getByText('3 / 10 repos')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('a')).toBeTruthy();
    fireEvent.click(screen.getByText('Logs (2)'));
    expect(screen.queryByText('a')).toBeNull();
  });
});

describe('logLineClass', () => {
  it('colours errors, skips, LLM and dev lines consistently', () => {
    expect(logLineClass('ERROR x')).toContain('red');
    expect(logLineClass('[10:00] sync failed: boom')).toContain('red');
    expect(logLineClass('SKIP @a')).toContain('yellow');
    expect(logLineClass('LLM [x]')).toContain('accent');
    expect(logLineClass('DEV @a done')).toContain('green');
    expect(logLineClass('plain')).toContain('gray');
  });
});

describe('RunHealthBadge', () => {
  it('renders nothing for null and a titled pill otherwise', () => {
    const { container, rerender } = render(<RunHealthBadge health={null} />);
    expect(container.textContent).toBe('');
    rerender(<RunHealthBadge health={{ tone: 'error', label: 'incomplete', title: 'why' }} />);
    expect(screen.getByText('incomplete').getAttribute('title')).toBe('why');
  });
});

describe('RunsToolbar', () => {
  it('renders info, action and an inline error banner', () => {
    render(<RunsToolbar info="Daily at 0 6 * * *" action={<button>Sync now</button>} error="HTTP 409" />);
    expect(screen.getByText('Daily at 0 6 * * *')).toBeTruthy();
    expect(screen.getByText('Sync now')).toBeTruthy();
    expect(screen.getByText('HTTP 409')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest --testPathPatterns="run-card"` → FAIL (module not found).

- [ ] **Step 3: Implement**

`src/components/runs/RunStatusChip.tsx`:
```tsx
import { STATUS_STYLE, type RunStatus } from '@/lib/runs/status';

export default function RunStatusChip({ status, label }: { status: RunStatus; label: string }) {
  const s = STATUS_STYLE[status];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.text} ${s.bg}`}>{label}</span>;
}
```

`src/components/runs/RunHealthBadge.tsx`:
```tsx
import type { RunHealth } from '@/lib/runs/health';

const TONE: Record<RunHealth['tone'], string> = {
  info:  'bg-sky-500/15 text-sky-300 border-sky-500/30',
  warn:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export default function RunHealthBadge({ health }: { health: RunHealth | null }) {
  if (!health) return null;
  return (
    <span title={health.title} className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${TONE[health.tone]}`}>
      {health.label}
    </span>
  );
}
```

`src/components/runs/RunCard.tsx`:
```tsx
'use client';
import { useState, type ReactNode } from 'react';
import type { RunStatus } from '@/lib/runs/status';
import { formatRunTime, formatDuration } from '@/lib/runs/format';
import RunStatusChip from './RunStatusChip';

export interface RunProgressView {
  step: string;
  counter?: string | null;
  pct: number;
  running: boolean;
  tone: 'normal' | 'failed' | 'stopped';
  error?: string | null;
  logs: string[];
}

/** One colouring rule for report and sync logs. */
export function logLineClass(line: string): string {
  if (line.includes('ERROR') || line.includes('FATAL') || line.includes('failed')) return 'text-red-400';
  if (line.includes('SKIP')) return 'text-yellow-500';
  if (line.includes('LLM [')) return 'text-accent-light';
  if (line.includes('DEV ')) return 'text-green-400';
  return 'text-gray-600';
}

const BAR: Record<RunProgressView['tone'], string> = { normal: 'bg-accent', failed: 'bg-red-500', stopped: 'bg-orange-500' };

function Progress({ p }: { p: RunProgressView }) {
  const [showLogs, setShowLogs] = useState(true);
  return (
    <div className="border-t border-gray-800 px-4 pb-3 pt-3">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-gray-400">{p.step}</span>
        {p.counter && <span className="text-gray-600">{p.counter}</span>}
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${BAR[p.tone]}`}
          style={{ width: `${Math.max(p.pct, p.running ? 2 : 0)}%` }} />
      </div>
      {p.error && <p className="text-xs text-red-400 mt-1.5">{p.error}</p>}
      {p.logs.length > 0 && (
        <div className="mt-3">
          <button onClick={(e) => { e.stopPropagation(); setShowLogs(!showLogs); }}
            className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-400 uppercase tracking-wider font-semibold">
            <svg className={`w-3 h-3 transition-transform ${showLogs ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Logs ({p.logs.length})
          </button>
          {showLogs && (
            <div className="max-h-48 overflow-y-auto mt-1.5 p-2 bg-gray-950 rounded-lg font-mono text-[11px] leading-relaxed">
              {p.logs.map((line, i) => <div key={i} className={logLineClass(line)}>{line}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface RunCardProps {
  status: RunStatus;
  label: string;
  subject: ReactNode;
  trigger?: string | null;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  health?: ReactNode;
  actions?: ReactNode;
  progress?: RunProgressView | null;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export default function RunCard(p: RunCardProps) {
  return (
    <div className={`group bg-gray-900 border rounded-xl transition-colors ${p.expanded ? 'border-gray-700' : 'border-gray-800 hover:border-gray-700'}`}>
      <div className={`flex items-center justify-between p-4 ${p.expandable ? 'cursor-pointer' : ''}`}
        onClick={() => (p.expandable ? p.onToggle() : undefined)}>
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {p.expandable && (
            <svg className={`w-3.5 h-3.5 text-gray-600 transition-transform ${p.expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          <RunStatusChip status={p.status} label={p.label} />
          <span className="font-medium text-white">{p.subject}</span>
          {p.trigger && <span className="text-sm text-gray-400">{p.trigger}</span>}
          <span className="text-xs text-gray-500">{formatDuration(p.startedAt, p.finishedAt ?? null)}</span>
          {p.health}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{formatRunTime(p.startedAt)}</span>
          {p.actions && (
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}>
              {p.actions}
            </div>
          )}
        </div>
      </div>
      {p.progress && <Progress p={p.progress} />}
      {p.expanded && p.children && <div className="border-t border-gray-800 px-4 pb-4 pt-3">{p.children}</div>}
    </div>
  );
}
```

`src/components/runs/RunsToolbar.tsx`:
```tsx
import type { ReactNode } from 'react';

/** The row under the Runs tabs: schedule/next-run info on the left, the tab's primary action on the right. */
export default function RunsToolbar({ info, action, error }: { info?: ReactNode; action?: ReactNode; error?: string | null }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500">{info}</span>
        {action}
      </div>
      {error && <div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run** `npx jest --testPathPatterns="run-card"` → PASS.
- [ ] **Step 5:** `npx jest && npx tsc --noEmit`, then commit `GLOOK-59: shared RunCard, status chip, health badge and toolbar` (with the Co-Authored-By trailer).

---

### Task 3: Report trigger metadata and list health (backend)

**Files:**
- Modify: `schema.sql` (reports table), `src/lib/db/mysql.ts` (add ALTERs next to the `run_metadata` ALTER), `src/lib/db/sqlite.ts` (CREATE TABLE reports + ALTERs next to the `run_metadata` ALTER), `src/lib/report/service.ts` (`listReports`, `createReport`), `src/lib/schedule/manager.ts` (scheduled INSERT), `src/app/api/report/route.ts` (pass the caller)
- Test: `src/lib/__tests__/unit/report-service.test.ts` (extend), `src/lib/__tests__/unit/report-list-health.test.ts` (new)

**Interfaces:**
- Consumes: `reportHealth` (Task 1).
- Produces: `GET /api/report` rows of type
  ```ts
  export interface ReportListRow {
    id: string; org: string; period_days: number; status: string;
    created_at: string; completed_at: string | null;
    trigger_kind: 'manual' | 'schedule' | null; triggered_by: string | null;
    health: RunHealth | null;
  }
  ```
  exported from `src/lib/report/service.ts`. `createReport(input: { org; periodDays; testMode?; triggeredBy?: string | null })` records `trigger_kind = 'manual'`.

- [ ] **Step 1: Write the failing tests** — new file `src/lib/__tests__/unit/report-list-health.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('rid') }));

import { listReports, createReport } from '@/lib/report/service';
import db from '@/lib/db/index';
const exec = db.execute as jest.Mock;

const row = (over: any = {}) => ({
  id: 'r1', org: 'acme', period_days: 30, status: 'completed',
  created_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T10:20:00Z',
  trigger_kind: null, triggered_by: null, run_metadata: null, ...over,
});

beforeEach(() => { jest.clearAllMocks(); exec.mockResolvedValue([[], null]); });

describe('listReports health + trigger', () => {
  it('selects the trigger columns and run_metadata, and never returns run_metadata itself', async () => {
    exec.mockResolvedValueOnce([[row()], null]);
    const [r] = await listReports();
    expect(exec.mock.calls[0][0]).toMatch(/trigger_kind/);
    expect(exec.mock.calls[0][0]).toMatch(/run_metadata/);
    expect(r).not.toHaveProperty('run_metadata');
    expect(r).toMatchObject({ trigger_kind: null, triggered_by: null, health: null });
  });
  it('summarises run_metadata from an object (MySQL) and a string (SQLite)', async () => {
    const meta = { state: 'failed', skipped: [], errors: [], expectedCount: 1, thresholds: {}, abortReason: 'x' };
    exec.mockResolvedValueOnce([[row({ run_metadata: meta }), row({ id: 'r2', run_metadata: JSON.stringify(meta) })], null]);
    const rows = await listReports();
    expect(rows.map(r => r.health?.label)).toEqual(['incomplete', 'incomplete']);
  });
  it('degrades malformed run_metadata to null health instead of throwing', async () => {
    exec.mockResolvedValueOnce([[row({ run_metadata: '{broken' })], null]);
    const [r] = await listReports();
    expect(r.health).toBeNull();
  });
});

describe('createReport trigger', () => {
  it('records a manual trigger with the caller', async () => {
    await createReport({ org: 'acme', periodDays: 30, triggeredBy: 'a@x' });
    const insert = exec.mock.calls.find(c => String(c[0]).includes('INSERT INTO reports'))!;
    expect(insert[0]).toMatch(/trigger_kind/);
    expect(insert[1]).toEqual(['rid', 'acme', 30, 'manual', 'a@x']);
  });
  it('records a manual trigger with no caller when auth is off', async () => {
    await createReport({ org: 'acme', periodDays: 30 });
    const insert = exec.mock.calls.find(c => String(c[0]).includes('INSERT INTO reports'))!;
    expect(insert[1]).toEqual(['rid', 'acme', 30, 'manual', null]);
  });
});
```

Also update the existing `report-service.test.ts` `listReports` "returns rows from DB" test so its rows include `run_metadata: null, trigger_kind: null, triggered_by: null` and its expectation is the mapped shape (`health: null`, no `run_metadata`), and update any `createReport` assertion on INSERT params to the new 5-element array. In `src/lib/__tests__/integration/schedule-manager.test.ts`, extend the "creates report and calls runReport on trigger" test to assert the INSERT SQL contains `'schedule'` (or the params contain `'schedule'`, depending on how you write it — choose literal SQL `'schedule'` as below).

- [ ] **Step 2: Run** `npx jest --testPathPatterns="report-list-health|report-service|schedule-manager"` → new tests FAIL.

- [ ] **Step 3: Implement**

`schema.sql` — in `CREATE TABLE IF NOT EXISTS reports`, after `run_metadata JSON NULL,` add:
```sql
  trigger_kind VARCHAR(16)  NULL,
  triggered_by VARCHAR(255) NULL,
```

`src/lib/db/mysql.ts` — directly after the `run_metadata` ALTER:
```ts
  // GLOOK-59: who/what started a report, for the shared run card. NULL on pre-existing rows.
  await pool.execute('ALTER TABLE reports ADD COLUMN trigger_kind VARCHAR(16) NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add trigger_kind:', err);
  });
  await pool.execute('ALTER TABLE reports ADD COLUMN triggered_by VARCHAR(255) NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add triggered_by:', err);
  });
```

`src/lib/db/sqlite.ts` — add `trigger_kind TEXT,` and `triggered_by TEXT,` to the reports CREATE TABLE (before `created_at`), and after the `run_metadata` ALTER:
```ts
  try { db.exec('ALTER TABLE reports ADD COLUMN trigger_kind TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE reports ADD COLUMN triggered_by TEXT'); } catch (_) {}
```

`src/lib/report/service.ts`:
```ts
import { reportHealth, type RunHealth } from '@/lib/runs/health';

export interface ReportListRow {
  id: string; org: string; period_days: number; status: string;
  created_at: string; completed_at: string | null;
  trigger_kind: 'manual' | 'schedule' | null; triggered_by: string | null;
  health: RunHealth | null;
}

export async function listReports(): Promise<ReportListRow[]> {
  const [rows] = await db.execute(
    `SELECT id, org, period_days, status, created_at, completed_at, trigger_kind, triggered_by, run_metadata
     FROM reports
     ORDER BY created_at DESC
     LIMIT 20`,
  ) as [any[], any];
  // run_metadata can carry hundreds of per-commit errors — ship only the card-sized summary.
  return rows.map(({ run_metadata, ...r }: any) => ({
    ...r,
    trigger_kind: r.trigger_kind ?? null,
    triggered_by: r.triggered_by ?? null,
    health: reportHealth(run_metadata),
  }));
}
```
and in `createReport` add `triggeredBy?: string | null` to the input type, then:
```ts
  const { org, periodDays, testMode = false, triggeredBy = null } = input;
  ...
  await db.execute(
    `INSERT INTO reports (id, org, period_days, status, trigger_kind, triggered_by) VALUES (?, ?, ?, 'pending', ?, ?)`,
    [id, org, periodDays, 'manual', triggeredBy],
  );
```
Note the params array order must be exactly `[id, org, periodDays, 'manual', triggeredBy]` to match the test.

`src/lib/schedule/manager.ts` — scheduled INSERT:
```ts
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, trigger_kind) VALUES (?, ?, ?, 'pending', 'schedule')`,
      [reportId, org, period_days],
    );
```

`src/app/api/report/route.ts` — import `extractUser` from `@/lib/auth` alongside `requireAdmin`, and pass `triggeredBy: extractUser(req.headers)?.email ?? null` into `createReport`.

- [ ] **Step 4: Run** the three test files → PASS; then `npx jest && npx tsc --noEmit` (the `mysql-schema-fk-charset` test must stay green — you added no charset).
- [ ] **Step 5: Commit** `GLOOK-59: record report trigger; ship a health summary on the report list`.

---

### Task 4: Vulnerability syncs tab on the shared RunCard

**Files:**
- Modify: `src/lib/vulnerabilities/queries.ts` (`ListSyncsResponse` + `listSyncs`: add `org`), `src/app/reports/vulnerability-syncs-tab.tsx`
- Test: `src/lib/__tests__/unit/vuln-syncs-tab.test.tsx` (extend), `src/lib/__tests__/unit/vuln-syncs-tab-polling.test.tsx` (must stay green unchanged), `src/lib/__tests__/unit/vuln-queries.test.ts` (extend if it covers `listSyncs`)

**Interfaces:**
- Consumes: Task 1 (`fromSyncStatus`, `triggerLabel`, `syncHealth`, `formatRunTime`), Task 2 (`RunCard`, `RunHealthBadge`, `RunsToolbar`, `RunProgressView`).
- Produces: `ListSyncsResponse` available branch gains `org: string`. The tab's default export signature is unchanged: `VulnerabilitySyncsTab({ canAct, observedRunning? })`.

Rules for the adapter (keep all existing behaviour the two syncs-tab test files pin — per-card 1.5s polling via `useSyncProgress`, `steadyRetry`, `observedRunning` retention, list 10s poll with `dedupingInterval: 2_000`, error-banner-over-last-good-data, "initial import" on the first sync, issues list, "Dashboard →" link):
- Card: `status/label` from `fromSyncStatus(s.status)`; `subject` = `` `${data.org} · Dependabot critical + high` ``; `trigger` = `triggerLabel(s.triggerKind, s.triggeredBy)`; `startedAt/finishedAt`; `health` = `<RunHealthBadge health={syncHealth(s)} />`; no `actions` (no Stop, no Delete — see Global Constraints); `expandable` = `s.status !== 'running'`.
- Progress view built from the `SyncProgress` response: `step`, `counter` = `progress.total > 0 ? \`${progress.done} / ${progress.total} repos\` : null`, `pct` = same rule as today (succeeded/partial → 100, else done/total), `running` = `progress.status === 'running'`, `tone` = `progress.status === 'failed' ? 'failed' : 'normal'`, `logs` = `progress.logs`, `error` = null.
- Expanded body: the existing StatCell grid + issues list + `Dashboard →` link (link class `text-accent-light hover:text-accent-lighter`).
- Toolbar: `<RunsToolbar info={\`Daily at ${cron} (${tz}) · next run ${formatRunTime(next_run)}\`} action={canAct ? <button …>{data.running ? 'Sync running…' : 'Sync now'}</button> : null} error={actionError} />`. The button uses `bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium px-4 py-2`.
- Remove the now-unused local `STATUS_COLOR`, `STATUS_BG`, `duration`, `triggerLabel`, `startTime` helpers from this file.

- [ ] **Step 1: Extend the failing tests.** In `vuln-syncs-tab.test.tsx`, change `listBody` to include `org: 'acme'` and add:

```tsx
it('renders the shared card header: subject line and issue-count health', async () => {
  global.fetch = mockFetchFor([{ ...failedSync, status: 'partial' }, succeededSecond]) as any;
  render(<SWRProvider><VulnerabilitySyncsTab canAct /></SWRProvider>);
  await waitFor(() => expect(screen.getAllByText('acme · Dependabot critical + high').length).toBe(2));
  expect(screen.getByText('1 issue')).toBeTruthy();
});

it('never offers Delete or Stop on sync cards', async () => {
  global.fetch = mockFetchFor([succeededSecond]) as any;
  render(<SWRProvider><VulnerabilitySyncsTab canAct /></SWRProvider>);
  await waitFor(() => screen.getByText('acme · Dependabot critical + high'));
  expect(screen.queryByText('Delete')).toBeNull();
  expect(screen.queryByText('Stop')).toBeNull();
});

it('shows the next run through the shared formatter', async () => {
  global.fetch = mockFetchFor([succeededSecond]) as any;
  render(<SWRProvider><VulnerabilitySyncsTab canAct /></SWRProvider>);
  await waitFor(() => expect(screen.getByText(/next run Sep 23, 6:00 AM/)).toBeTruthy());
});
```
(Match whatever wrapper the existing tests in this file use — if they wrap in `SWRConfig` with a fresh cache, do the same.) If an existing assertion pinned the raw ISO next-run text, update it to the formatted value; do not weaken any other assertion.

- [ ] **Step 2:** `npx jest --testPathPatterns="vuln-syncs-tab"` → new tests FAIL.
- [ ] **Step 3: Implement** the `org` field in `listSyncs` (`org` is already in scope as `getVulnerabilitiesOrg()`; add `org` to the returned object and to the `ListSyncsResponse` type), then rewrite `SyncCard` as an adapter over `RunCard` per the rules above.
- [ ] **Step 4:** `npx jest --testPathPatterns="vuln-"` → all vuln suites PASS; then `npx jest && npx tsc --noEmit`.
- [ ] **Step 5: Commit** `GLOOK-59: vulnerability syncs tab renders through the shared RunCard`.

---

### Task 5: Reports tab on the shared RunCard; Runs page

**Files:**
- Create: `src/app/reports/reports-tab.tsx` (all report-list logic, moved out of `page.tsx`), `src/app/reports/use-report-progress.ts`
- Modify: `src/app/reports/page.tsx` (becomes the thin Runs page), `src/app/reports/reports-tabs.tsx`
- Test: `src/lib/__tests__/unit/reports-tab.test.tsx` (new), `src/lib/__tests__/unit/runs-page-tabs.test.tsx` (new)

**Interfaces:**
- Consumes: Tasks 1–3 (`ReportListRow`, `fromReportStatus`, `triggerLabel`, `formatRunTime`, `RunCard`, `RunHealthBadge`, `RunsToolbar`).
- Produces:
  - `ReportsTab({ canAct, observedRunning }: { canAct: boolean; observedRunning: Set<string> })` default export.
  - `useReportProgress(id: string, enabled: boolean, onFinish: () => void)` → SWR response of the existing progress shape `{ status, step, totalRepos, processedRepos, totalDevelopers, completedDevelopers, error?, logs? }`.
  - `ReportsTabs()` (no props) default export: owns the tab state and both observed-running sets; renders `ReportsTab` or `VulnerabilitySyncsTab`.

Behaviour to preserve from the current `page.tsx` (read it first; it is the reference):
- New-report modal (org select from `/api/orgs`, period 3/14/30/90, `?test=1` testMode), Resume (failed/stopped, not while another run is active), Stop (running), Delete with inline confirm, expand a succeeded report to lazily fetch `/api/report/:id` stats (Developers, Commits, PRs, Lines +/-, Jira Issues when present, Avg Impact) plus Team Summary / Org Summary links, empty state, auto-resume progress for a report already running on load, and busting all SWR caches when a run finishes (`globalMutate(() => true, undefined, { revalidate: true })`).

Changes:
- List: `useSWR<ReportListRow[]>('/api/report', fetcher, { dedupingInterval: 2_000 })` with `useIdleAwarePolling(() => mutate(), 30_000, 120_000)`; after start/stop/resume/delete call `mutate()` instead of hand-editing local arrays. Use the app-wide fetcher from `src/lib/swr-provider.tsx` (it throws on `!ok`).
- Progress: `use-report-progress.ts` mirrors `useSyncProgress` in `vulnerability-syncs-tab.tsx` — `refreshInterval: (latest) => (!latest || latest.status === 'running' || latest.status === 'pending') ? 1500 : 0`, `dedupingInterval: 1000`, a steady 1500ms `onErrorRetry`, and `onFinish` fired exactly once when the status first leaves running/pending. `onFinish` = list `mutate()` + the global cache bust.
- A card shows progress when the report is running/pending OR its id is in `observedRunning` (page-session retention, like syncs). Progress view: `step`; `counter` = `totalDevelopers > 0 ? \`${completedDevelopers} / ${totalDevelopers} developers\` : completedDevelopers > 0 ? \`${completedDevelopers} developers done\` : totalRepos > 0 ? \`Fetching: ${processedRepos}/${totalRepos} members\` : null`; `pct` = completed → 100, else completed/total devs; `tone` failed/stopped/normal; `error` = progress.error; `logs` = progress.logs ?? [].
- Card: `fromReportStatus(r.status)`; `subject` = `` `${r.org} · ${r.period_days} days` ``; `trigger` = `triggerLabel(r.trigger_kind, r.triggered_by)`; `startedAt = r.created_at`, `finishedAt = r.completed_at`; `health` = `<RunHealthBadge health={r.health} />`; `actions` (only when `canAct`): Resume / Stop / delete-icon, same buttons as today but Resume uses `text-accent-light bg-accent/10 hover:bg-accent/30`; `expandable` = `r.status === 'completed'`.
- Errors: no `alert()`. Start/resume/stop/delete failures set `actionError` (from the response `error` field, else `HTTP <status>`) shown by `RunsToolbar`.
- Toolbar: `info` = next scheduled report from `useSWR('/api/schedule')` — the enabled schedule with the earliest `next_run_at`: `` `Next scheduled: ${org} · ${period_days}d · ${formatRunTime(next_run_at)}` ``, a `Manage schedules` link to `/settings#schedules` when `canAct`, or `'No report schedule'` when none is enabled; `action` = `+ New report` button (`bg-accent hover:bg-accent-dark …`, disabled while any report is running with title "A report is currently running"; label `Report running…` then).
- `page.tsx` becomes:

```tsx
'use client';
import { Suspense } from 'react';
import ReportsTabs from './reports-tabs';

export default function RunsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Runs</h1>
        <p className="text-xs text-gray-500 mt-0.5">History of report runs and data syncs</p>
      </div>
      <Suspense fallback={null}>
        <ReportsTabs />
      </Suspense>
    </div>
  );
}
```
- `reports-tabs.tsx`: keep `useUrlState({ key: 'tab', values: ['reports','syncs'], default: 'reports', history: 'replace' })`; own `observedReports = useRef(new Set<string>())` and `observedSyncs = useRef(new Set<number>())`; when vulnerabilities are disabled render only `<ReportsTab …/>` (no tab bar); tab underline uses `border-accent`.
- Nav label: in `src/components/NavBar.tsx`, if a nav item reads "Report History" or "Reports" linking to `/reports`, rename its text to `Runs` (keep the href).

- [ ] **Step 1: Write failing tests.**

`src/lib/__tests__/unit/reports-tab.test.tsx`:
```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ReportsTab from '@/app/reports/reports-tab';

jest.mock('@/hooks/use-idle-aware-polling', () => ({ useIdleAwarePolling: jest.fn() }));

const report = (over: any = {}) => ({
  id: 'r1', org: 'acme', period_days: 30, status: 'completed',
  created_at: '2026-09-22T10:00:00Z', completed_at: '2026-09-22T10:20:00Z',
  trigger_kind: 'schedule', triggered_by: null, health: null, ...over,
});

function mockFetch(routes: Record<string, (init?: any) => { status?: number; body: any }>) {
  return jest.fn((url: string, init?: any) => {
    const key = Object.keys(routes).find(k => url.startsWith(k))!;
    const r = routes[key](init);
    return Promise.resolve({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body });
  });
}

const wrap = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), fetcher: (u: string) => fetch(u).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); }) }}>{ui}</SWRConfig>);

describe('ReportsTab', () => {
  it('renders report cards through the shared header with trigger, duration and health', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [report({ health: { tone: 'warn', label: '2 partial' } })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [{ login: 'acme' }] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    expect(screen.getByText('succeeded')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('20m 00s')).toBeTruthy();
    expect(screen.getByText('2 partial')).toBeTruthy();
  });

  it('shows no trigger text for legacy rows', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [report({ trigger_kind: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    const { container } = wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    expect(container.textContent).not.toMatch(/Manual|Scheduled/);
  });

  it('surfaces a failed resume inline instead of alert()', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = mockFetch({
      '/api/report/r1/resume': () => ({ status: 409, body: { error: 'A report is already running.' } }),
      '/api/report': () => ({ body: [report({ status: 'failed', completed_at: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    fireEvent.click(await screen.findByText('Resume'));
    await waitFor(() => screen.getByText('A report is already running.'));
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows the next scheduled report in the toolbar', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [] }),
      '/api/schedule': () => ({ body: [
        { id: 's1', org: 'acme', period_days: 14, enabled: 1, next_run_at: '2026-09-29T13:00:00Z' },
        { id: 's2', org: 'other', period_days: 30, enabled: 0, next_run_at: null },
      ] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct observedRunning={new Set()} />);
    await waitFor(() => expect(screen.getByText(/Next scheduled: acme · 14d · Sep 29, 9:00 AM/)).toBeTruthy());
  });

  it('hides actions and the New report button for viewers', async () => {
    global.fetch = mockFetch({
      '/api/report': () => ({ body: [report({ status: 'failed', completed_at: null })] }),
      '/api/schedule': () => ({ body: [] }),
      '/api/orgs': () => ({ body: [] }),
    }) as any;
    wrap(<ReportsTab canAct={false} observedRunning={new Set()} />);
    await waitFor(() => screen.getByText('acme · 30 days'));
    expect(screen.queryByText('Resume')).toBeNull();
    expect(screen.queryByText('+ New report')).toBeNull();
  });
});
```
Note: `mockFetch` matches by `startsWith`, so list the more specific `/api/report/r1/resume` key BEFORE `/api/report` (object key order is preserved).

`src/lib/__tests__/unit/runs-page-tabs.test.tsx`:
```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => {
  let params = new URLSearchParams();
  return {
    useSearchParams: () => params,
    useRouter: () => ({ replace: (u: string) => { params = new URLSearchParams(u.split('?')[1] ?? ''); } }),
    usePathname: () => '/reports',
  };
});
jest.mock('@/app/auth-context', () => ({ useAuth: () => ({ canAct: true }) }));
jest.mock('@/app/reports/reports-tab', () => ({ __esModule: true, default: () => <div>REPORTS TAB</div> }));
jest.mock('@/app/reports/vulnerability-syncs-tab', () => ({ __esModule: true, default: () => <div>SYNCS TAB</div> }));
const swr = jest.fn();
jest.mock('swr', () => ({ __esModule: true, default: (...a: any[]) => swr(...a) }));

import ReportsTabs from '@/app/reports/reports-tabs';

it('shows only the reports tab when vulnerabilities are disabled', () => {
  swr.mockReturnValue({ data: { vulnerabilities: { enabled: false } } });
  render(<ReportsTabs />);
  expect(screen.getByText('REPORTS TAB')).toBeTruthy();
  expect(screen.queryByText('Vulnerability syncs')).toBeNull();
});

it('switches tabs when vulnerabilities are enabled', async () => {
  swr.mockReturnValue({ data: { vulnerabilities: { enabled: true } } });
  render(<ReportsTabs />);
  expect(screen.getByText('REPORTS TAB')).toBeTruthy();
  fireEvent.click(screen.getByText('Vulnerability syncs'));
  await waitFor(() => expect(screen.getByText('SYNCS TAB')).toBeTruthy());
});
```
If `useUrlState` does not re-render from this `next/navigation` mock, read `src/lib/__tests__/unit/url-state-hook.test.ts` and copy its mocking approach instead; keep the two assertions.

- [ ] **Step 2:** `npx jest --testPathPatterns="reports-tab|runs-page-tabs"` → FAIL.
- [ ] **Step 3: Implement** `use-report-progress.ts`, `reports-tab.tsx`, the new `page.tsx`, `reports-tabs.tsx`, and the NavBar label per the rules above. Every button/link touched uses accent tokens, no `indigo-*`.
- [ ] **Step 4:** the two new suites PASS; `npx jest && npx tsc --noEmit`; then `rm -rf .next && npx next build` must succeed (catches a non-default export from a `page.tsx` and server-only imports leaking into the client bundle — `reports-tab.tsx` may import only the *type* `ReportListRow` from `@/lib/report/service`, via `import type`).
- [ ] **Step 5: Commit** `GLOOK-59: Runs page — reports tab on the shared RunCard, SWR polling, inline errors`.

---

### Task 6: Read-only vulnerability schedule row in Settings → Schedules

**Files:**
- Create: `src/app/settings/vuln-schedule-row.tsx`
- Modify: `src/app/settings/page.tsx` (render the row inside `SchedulesTab`)
- Test: `src/lib/__tests__/unit/settings-vuln-schedule-row.test.tsx`

**Interfaces:**
- Consumes: `GET /api/vulnerabilities/syncs?limit=1` (available branch: `{ org, schedule: { cron, tz, next_run } }`; 404 when disabled), `formatRunTime`.
- Produces: `VulnScheduleRow()` default export — a self-contained block, renders nothing when the feature is disabled, unavailable, or the request fails.

- [ ] **Step 1: Failing test**

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import VulnScheduleRow from '@/app/settings/vuln-schedule-row';

const wrap = () => render(
  <SWRConfig value={{ provider: () => new Map(), fetcher: (u: string) => fetch(u).then(async r => { if (!r.ok) throw new Error('x'); return r.json(); }) }}>
    <VulnScheduleRow />
  </SWRConfig>,
);

it('renders a read-only row for the vulnerability sync', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    available: true, org: 'acme', running: false,
    schedule: { cron: '0 6 * * *', tz: 'America/New_York', next_run: '2026-09-29T10:00:00Z' }, syncs: [],
  }) }) as any;
  wrap();
  await waitFor(() => screen.getByText('Vulnerability sync'));
  expect(screen.getByText('acme')).toBeTruthy();
  expect(screen.getByText('0 6 * * *')).toBeTruthy();
  expect(screen.getByText('America/New_York')).toBeTruthy();
  expect(screen.getByText('Sep 29, 6:00 AM')).toBeTruthy();
  expect(screen.getByText('Configured by deployment')).toBeTruthy();
  expect(screen.queryByText('Edit')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('/api/vulnerabilities/syncs?limit=1');
});

it('renders nothing when the feature is disabled (404)', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) }) as any;
  const { container } = wrap();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

it('renders nothing when the response says unavailable', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ available: false, reason: 'off' }) }) as any;
  const { container } = wrap();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});
```

- [ ] **Step 2:** `npx jest --testPathPatterns="settings-vuln-schedule-row"` → FAIL.
- [ ] **Step 3: Implement**

```tsx
'use client';
import useSWR from 'swr';
import { formatRunTime } from '@/lib/runs/format';

/** GLOOK-59: the vulnerability sync schedule is deployment configuration (VULN_SYNC_CRON / VULN_SYNC_TZ),
 * so Settings shows it read-only next to the editable report schedules. */
export default function VulnScheduleRow() {
  const { data, error } = useSWR<any>('/api/vulnerabilities/syncs?limit=1', { shouldRetryOnError: false });
  if (error || !data || data.available !== true) return null;
  const { cron, tz, next_run } = data.schedule;
  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden mt-4">
      <table className="w-full text-sm">
        <tbody>
          <tr className="text-gray-400">
            <td className="px-4 py-3 text-white font-medium">Vulnerability sync</td>
            <td className="px-4 py-3 text-gray-300">{data.org}</td>
            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{cron}</td>
            <td className="px-4 py-3 text-gray-500 text-xs">{tz}</td>
            <td className="px-4 py-3 text-gray-500 text-xs">{formatRunTime(next_run)}</td>
            <td className="px-4 py-3 text-gray-600 text-xs text-right">Configured by deployment</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```
In `src/app/settings/page.tsx`, import it and render `<VulnScheduleRow />` at the end of `SchedulesTab`'s returned `<div>` (after the schedules table and its empty state, so it shows even with zero report schedules).

- [ ] **Step 4:** PASS; `npx jest && npx tsc --noEmit`.
- [ ] **Step 5: Commit** `GLOOK-59: read-only vulnerability sync row in Settings → Schedules`.

---

### Task 7: Freshness data on /api/llm-config

**Files:**
- Modify: `src/lib/app-config/service.ts` (add `getReportFreshness`, `getVulnerabilityFreshness`), `src/app/api/llm-config/route.ts`
- Test: `src/lib/__tests__/unit/app-config-freshness.test.ts`

**Interfaces:**
- Consumes: `staleAfterMs`, `isStale` (Task 1); `getSyncStatus(org, now)` from `src/lib/vulnerabilities/queries.ts`; `isVulnerabilitiesEnabled`, `getVulnerabilitiesOrg`.
- Produces on `GET /api/llm-config`:
  ```ts
  reportFreshness: { latestCompletedAt: string | null; latestRunStatus: string | null; latestRunFailed: boolean; stale: boolean } | null
  vulnerabilityFreshness: { lastSuccessfulAt: string | null; stale: boolean; lastStatus: string | null; issue: string | null } | null
  ```
  `vulnerabilityFreshness` is `null` when the feature is disabled. Both are `null` on any DB error (never throw from the config endpoint — it feeds the NavBar on every page).

- [ ] **Step 1: Failing test**

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/vulnerabilities/config', () => ({
  isVulnerabilitiesEnabled: jest.fn(() => true), getVulnerabilitiesOrg: jest.fn(() => 'acme'),
}));
jest.mock('@/lib/vulnerabilities/queries', () => ({ getSyncStatus: jest.fn() }));

import db from '@/lib/db';
import { getReportFreshness, getVulnerabilityFreshness } from '@/lib/app-config/service';
import { getSyncStatus } from '@/lib/vulnerabilities/queries';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';
const exec = db.execute as jest.Mock;
const now = new Date('2026-09-28T13:00:00Z');

beforeEach(() => jest.clearAllMocks());

function route(completed: any[], latest: any[], schedules: any[]) {
  exec.mockImplementation(async (sql: string) => {
    if (sql.includes("status = 'completed'")) return [completed, null];
    if (sql.includes('FROM schedules')) return [schedules, null];
    return [latest, null];
  });
}

it('flags a latest failed run and is not stale without schedules', async () => {
  route([{ created_at: '2026-09-20T10:00:00Z' }], [{ status: 'failed' }], []);
  expect(await getReportFreshness(now)).toEqual({
    latestCompletedAt: '2026-09-20T10:00:00Z', latestRunStatus: 'failed', latestRunFailed: true, stale: false,
  });
});

it('is stale when the latest completed report is older than the schedule allows', async () => {
  route([{ created_at: '2026-09-20T10:00:00Z' }], [{ status: 'completed' }],
    [{ cron_expr: '0 9 * * *', timezone: 'America/New_York', enabled: 1 }]);
  const f = await getReportFreshness(now);
  expect(f?.stale).toBe(true);
  expect(f?.latestRunFailed).toBe(false);
});

it('returns null instead of throwing on a DB error', async () => {
  exec.mockRejectedValue(new Error('db down'));
  expect(await getReportFreshness(now)).toBeNull();
});

it('maps the vulnerability sync status and is null when disabled', async () => {
  (getSyncStatus as jest.Mock).mockResolvedValue({
    lastSuccessfulAt: '2026-09-28T10:04:00Z', stale: false, lastStatus: 'failed', running: false,
    issuesCount: 1, issues: [{ kind: 'fetch', message: 'token expired' }],
  });
  expect(await getVulnerabilityFreshness(now)).toEqual({
    lastSuccessfulAt: '2026-09-28T10:04:00Z', stale: false, lastStatus: 'failed', issue: 'token expired',
  });
  (isVulnerabilitiesEnabled as jest.Mock).mockReturnValue(false);
  expect(await getVulnerabilityFreshness(now)).toBeNull();
});
```

- [ ] **Step 2:** `npx jest --testPathPatterns="app-config-freshness"` → FAIL.
- [ ] **Step 3: Implement** in `src/lib/app-config/service.ts` (lazy-import db the same way `getLatestReport` does, so the module stays importable in client-free contexts):

```ts
import { staleAfterMs, isStale } from '@/lib/runs/staleness';

export interface ReportFreshness { latestCompletedAt: string | null; latestRunStatus: string | null; latestRunFailed: boolean; stale: boolean }
export interface VulnerabilityFreshness { lastSuccessfulAt: string | null; stale: boolean; lastStatus: string | null; issue: string | null }

const iso = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export async function getReportFreshness(now = new Date()): Promise<ReportFreshness | null> {
  try {
    const db = (await import('@/lib/db')).default;
    const [completed] = await db.execute(
      `SELECT created_at FROM reports WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1`) as [any[], any];
    const [latest] = await db.execute(
      `SELECT status FROM reports WHERE status IN ('completed','failed','stopped') ORDER BY created_at DESC LIMIT 1`) as [any[], any];
    const [schedules] = await db.execute(`SELECT cron_expr, timezone, enabled FROM schedules`) as [any[], any];
    const latestCompletedAt = iso(completed[0]?.created_at);
    const latestRunStatus: string | null = latest[0]?.status ?? null;
    return {
      latestCompletedAt, latestRunStatus,
      latestRunFailed: latestRunStatus === 'failed',
      stale: isStale(latestCompletedAt, staleAfterMs(schedules, now), now),
    };
  } catch {
    return null;
  }
}

export async function getVulnerabilityFreshness(now = new Date()): Promise<VulnerabilityFreshness | null> {
  if (!isVulnerabilitiesEnabled()) return null;
  const org = getVulnerabilitiesOrg();
  if (!org) return null;
  try {
    const { getSyncStatus } = await import('@/lib/vulnerabilities/queries');
    const s = await getSyncStatus(org, now);
    return { lastSuccessfulAt: s.lastSuccessfulAt, stale: s.stale, lastStatus: s.lastStatus, issue: s.issues?.[0]?.message ?? null };
  } catch {
    return null;
  }
}
```
In `src/app/api/llm-config/route.ts`, add both calls to the `Promise.all` and spread `reportFreshness` and `vulnerabilityFreshness` into the JSON response. Note the test mocks `@/lib/db` — confirm that is the path `getLatestReport` imports; if it imports `@/lib/db/index`, mock that path instead.

- [ ] **Step 4:** PASS; `npx jest && npx tsc --noEmit` (the existing `llm-config-service.test.ts` must stay green).
- [ ] **Step 5: Commit** `GLOOK-59: report and vulnerability freshness on /api/llm-config`.

---

### Task 8: DataFreshness + PageHeader on Org, Team and Vulnerabilities; nav date

**Files:**
- Create: `src/components/runs/DataFreshness.tsx`, `src/components/PageHeader.tsx`
- Modify: `src/app/report/[id]/org/page.tsx`, `src/app/report/[id]/team/page.tsx`, `src/app/vulnerabilities/vulnerabilities-content.tsx`, `src/components/NavBar.tsx`
- Test: `src/lib/__tests__/unit/data-freshness.test.tsx`

**Interfaces:**
- Consumes: `formatRunTime` (Task 1); `/api/llm-config` fields from Task 7.
- Produces:
  - `DataFreshness(props: { label: string; at: string | null; stale: boolean; latestFailed: boolean; failedText: string; failedDetail?: string | null; historicalAt?: string | null })`
  - `PageHeader(props: { title: ReactNode; meta?: ReactNode; freshness?: ReactNode; badges?: ReactNode; actions?: ReactNode; children?: ReactNode })`

Rules:
- `DataFreshness`: when `historicalAt` is set, render ONLY the amber notice `Viewing historical report from <formatted date> — not the latest report.` (keep this exact existing wording; date via `new Date(historicalAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })`) — no staleness, no failed banner. Otherwise render `<span>{label} {formatRunTime(at)}</span>` (amber `text-amber-400` when `stale`, else `text-gray-500`), plus, when `latestFailed`, a banner `<div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2">{failedText} {failedDetail}</div>`.
- `PageHeader`: the Org Summary header block (`bg-gray-900 rounded-xl p-6 mb-6`, `h1 text-2xl font-bold text-white`, meta in `text-gray-500 mt-1`, freshness + badges on the next line, actions right-aligned), with `children` rendered below (for banners).
- Org Summary: replace the hand-rolled header + "Viewing historical report" block with `PageHeader` (title = org, meta = `N days · N developers · date` as today, badges = `<IntegrityBadge …/>`, actions = Download PDF) and `DataFreshness` with `label="report generated"`, `at={report.created_at}`, `stale`/`latestFailed` from `config.reportFreshness` **only when `latestReportId === params.id`**, `historicalAt={latestReportId && latestReportId !== params.id ? report.created_at : null}`, `failedText="The latest report run failed; showing the last completed report."`.
- Team Summary: same treatment for its header and its existing historical notice (it reads `activeReport` rather than `report`).
- Vulnerabilities: use `PageHeader` with `title={\`Vulnerabilities · ${s.org}\`}` and `DataFreshness` with `label="last successful sync"`, `at={s.sync.lastSuccessfulAt}`, `stale={s.sync.stale}`, `latestFailed={s.sync.lastStatus === 'failed'}`, `failedText="The latest sync failed; showing data from the last good sync."`, `failedDetail={s.sync.issues?.[0]?.message}`, and keep the `sync history →` link and `Updating…` indicator in `badges`. Keep the unavailable/error early returns' existing texts. The `vuln-content-*` suites pin some of these strings — run them and keep them green; where a test pinned the raw ISO `last successful sync …` text, update it to the formatted time.
- NavBar: next to the "Vulnerabilities" link, when `config.vulnerabilityFreshness?.lastSuccessfulAt`, render `<span className="text-gray-600 text-[10px] ml-1">{date}</span>` using `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` — the same format as the Team/Org Summary dates — with `text-amber-400` instead when `stale`.

- [ ] **Step 1: Failing test** `src/lib/__tests__/unit/data-freshness.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import DataFreshness from '@/components/runs/DataFreshness';
import PageHeader from '@/components/PageHeader';

const base = { label: 'last successful sync', at: '2026-09-28T10:04:00Z', stale: false, latestFailed: false, failedText: 'The latest sync failed.' };

it('shows the formatted time, amber when stale', () => {
  const { rerender } = render(<DataFreshness {...base} />);
  const el = screen.getByText('last successful sync Sep 28, 6:04 AM');
  expect(el.className).toContain('text-gray-500');
  rerender(<DataFreshness {...base} stale />);
  expect(screen.getByText('last successful sync Sep 28, 6:04 AM').className).toContain('text-amber-400');
});

it('shows the failed banner with detail', () => {
  render(<DataFreshness {...base} latestFailed failedDetail="token expired" />);
  expect(screen.getByText(/The latest sync failed\. token expired/)).toBeTruthy();
});

it('on a historical report shows only the notice — no staleness, no failed banner', () => {
  const { container } = render(<DataFreshness {...base} stale latestFailed historicalAt="2026-09-01T10:00:00Z" />);
  expect(container.textContent).toContain('Viewing historical report from Sep 1, 2026 — not the latest report.');
  expect(container.textContent).not.toContain('last successful sync');
  expect(container.textContent).not.toContain('failed');
});

it('PageHeader renders title, meta, freshness, badges, actions and children', () => {
  render(<PageHeader title="acme" meta="30 days" freshness={<span>fresh</span>} badges={<span>badge</span>} actions={<button>PDF</button>}><p>banner</p></PageHeader>);
  for (const t of ['acme', '30 days', 'fresh', 'badge', 'PDF', 'banner']) expect(screen.getByText(t)).toBeTruthy();
});
```

- [ ] **Step 2:** `npx jest --testPathPatterns="data-freshness"` → FAIL.
- [ ] **Step 3: Implement** the two components and apply them per the rules. Read each page fully before editing; keep all data-loading and tab logic intact.
- [ ] **Step 4:** `npx jest` (all `vuln-content-*`, `profile-self-view`, `spend-model-mix` etc. green) `&& npx tsc --noEmit && rm -rf .next && npx next build`.
- [ ] **Step 5: Commit** `GLOOK-59: shared page header and data-freshness on report and vulnerability dashboards`.

---

### Task 9: Theme tokens, "Owning team" labels, docs

**Files:**
- Modify: `src/app/vulnerabilities/vulnerabilities-content.tsx`, `alerts-table.tsx`, `team-pivot.tsx`, `coverage-panel.tsx`, `src/app/reports/*.tsx` (any `indigo-*` left), `docs/vulnerabilities-page.md`, `CLAUDE.md`
- Test: `src/lib/__tests__/unit/vuln-owning-team-label.test.tsx` (new), plus existing `vuln-team-pivot`, `vuln-alerts-table`, `vuln-content-team-dropdown` suites

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports.

Rules:
- Replace every `indigo-*` class in the listed files: `bg-indigo-600`/`border-indigo-600` → `bg-accent`/`border-accent`; `hover:bg-indigo-500` → `hover:bg-accent-dark`; `text-indigo-400` → `text-accent-light`; `hover:text-indigo-300` → `hover:text-accent-lighter`; `bg-indigo-500/10` → `bg-accent/10`; `border-indigo-500` → `border-accent`. After the change `grep -rn "indigo-" src/app/vulnerabilities src/app/reports src/components/runs` must return nothing. If a class you need has no utility in `src/app/globals.css` (e.g. `bg-accent/20` exists, `bg-accent/5` does not), use one that exists rather than adding new CSS.
- Team labels: in `team-pivot.tsx` the first header cell `Team` → `Owning team` with `title="The repository's team custom property — not a Glooker team"`; in `alerts-table.tsx` the `Team` column header → `Owning team` (keep the sort arrow logic and `onClick`), the team `<select>`'s `aria-label="Team"` → `aria-label="Owning team"` and its "All teams" option → "All owning teams"; in `vulnerabilities-content.tsx` the "By team" heading → "By owning team" and "Filtered to team" → "Filtered to owning team". Update existing tests that pin the old strings (`getByLabelText('Team')`, `'All teams'`, `'By team'`, header `Team`) to the new ones — change the string only, never the assertion's intent.
- Docs: in `docs/vulnerabilities-page.md` update the "Report History gets a second tab" paragraph to describe the Runs page (shared `RunCard`, toolbar with schedule line and primary action, sync cards: subject line, issue-count health, no Delete/Stop), the read-only Settings row, `DataFreshness`/`PageHeader`, the accent-token rule, and the "Owning team" label. In root `CLAUDE.md` add one Gotchas bullet:
  `- **Runs UI (GLOOK-59):** reports and vulnerability syncs render through one run model (`src/lib/runs/`) and one card (`src/components/runs/RunCard.tsx`). A new run source adds a status mapping and an adapter — never a third card copy. `reports.trigger_kind`/`triggered_by` are NULL on rows created before GLOOK-59; `triggerLabel` returns null for them and the card shows no trigger. Report staleness comes from the enabled schedules (`staleAfterMs`: largest upcoming gap + 12h), sync staleness from `STALE_MS` (36h) in `vulnerabilities/queries.ts`. Sync Stop is deliberately absent pending an owner design check (a stopped sync must write nothing).`

- [ ] **Step 1: Failing test** `src/lib/__tests__/unit/vuln-owning-team-label.test.tsx` — render `TeamPivot` with one row (reuse the fixture shape from `vuln-team-pivot.test.tsx`; copy its minimal props object) and assert `screen.getByText('Owning team')` has the `title` above; render `AlertsTable` the way `vuln-alerts-table.test.tsx` does with `onTeamChange` set and assert `screen.getByLabelText('Owning team')` and the option `All owning teams`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement the label changes, token replacements, and docs.
- [ ] **Step 4:** `npx jest && npx tsc --noEmit && rm -rf .next && npx next build`; `grep -rn "indigo-" src/app/vulnerabilities src/app/reports src/components/runs` → empty.
- [ ] **Step 5: Commit** `GLOOK-59: accent tokens and "Owning team" labels on vulnerability pages; docs`.
