# Idle-Aware Report List Polling

**Date:** 2026-04-09
**Status:** Approved
**Branch:** `fix/idle-aware-report-polling`

## Problem

`src/app/page.tsx:125-150` runs an unconditional `setInterval` that fetches `GET /api/report` every 5 seconds, forever, as long as the page is mounted. Its purpose is to detect reports triggered by background schedules, but it never pauses — even when no reports are running, no schedules exist, the browser tab is hidden, or the user has walked away.

Secondary issue: the `useEffect` dependency array `[activeReport?.id, activeReport?.status]` causes the interval to be torn down and recreated whenever the active report's status changes, which the poll itself can trigger.

## Scope

### In scope

- Replace the unconditional 5-second report-list polling with visibility + idle-aware polling at 30-second intervals
- Extract the polling logic into a reusable `useIdleAwarePolling` hook
- Fix the stale-closure / dependency-array churn in the current implementation

### Out of scope

- Active report progress polling (`startPolling`/`stopPolling`, lines 159-206) — stays at 1.5s, untouched
- Initial mount fetch (line 117) — untouched
- One-off fetches on report completion/stop — untouched

## Design

### New hook: `src/hooks/use-idle-aware-polling.ts`

A custom React hook that polls a callback at a given interval, but only when the user is present.

**Signature:**

```ts
function useIdleAwarePolling(
  callback: () => void,
  intervalMs: number,    // 30_000
  idleTimeoutMs: number  // 120_000
): void
```

**Refs:**

- `callbackRef` — stores the latest callback (updated on every render, avoids stale closures)
- `lastActiveRef` — timestamp of last user activity, initialized to `Date.now()` on mount (so the user is considered active until proven idle)
- `lastFiredRef` — timestamp of last callback invocation, initialized to `Date.now()` on mount (prevents double-fire on mount and on simultaneous resume triggers)

**Behavior:**

1. On mount, registers activity listeners for `mousemove`, `keydown`, `scroll`, `touchstart`, `click`. The handler logic on each raw event:
   - **First**, check if the user was idle: `Date.now() - lastActiveRef.current > idleTimeoutMs`.
   - **If idle AND** `Date.now() - lastFiredRef.current > intervalMs / 2`: invoke `callback()` immediately, update `lastFiredRef`.
   - **Then**, debounced (1s trailing): update `lastActiveRef` to `Date.now()`.
   
   The idle check reads `lastActiveRef` *before* the debounced update writes to it. This ensures the "was idle" detection works correctly. The `lastFiredRef` guard prevents burst duplicate invocations when multiple events fire in rapid succession (e.g., mousemove + keydown within 100ms).
2. On mount, registers a `visibilitychange` listener. When `!document.hidden` (tab becomes visible): if `Date.now() - lastFiredRef.current > intervalMs / 2`, invoke `callback()` immediately and update `lastFiredRef`. This guard also prevents double-fire when visibility-resume and activity-resume coincide.
3. Runs a `setInterval` at `intervalMs`. On each tick:
   - If `document.hidden` → skip.
   - If `Date.now() - lastActiveRef.current > idleTimeoutMs` → skip.
   - Otherwise → invoke `callback()`, update `lastFiredRef`.
4. On unmount: clear interval, cancel any pending debounce timer, remove all listeners.

**Error handling:** The hook does not catch errors from `callback()`. The caller is responsible for its own error handling (the extracted fetch function will retain its existing `.catch()` chain). The hook does not guard against overlapping async invocations — at 30-second intervals this is not a practical concern.

**Design rationale — skip-on-tick vs. pause/resume:** The interval always ticks; the tick handler just checks two conditions before invoking the callback. This avoids complex state management around clearing and recreating intervals when idle/visibility toggles rapidly. The cost of a no-op tick (one timestamp comparison) is negligible.

**Callback stability:** The hook stores the callback in `callbackRef` (updated on every render), so the caller does not need to memoize it. The hook itself never re-creates the interval.

**Client-only:** All DOM access (`document.hidden`, `addEventListener`) occurs inside `useEffect`, so the hook is safe in Next.js SSR. The hook must only be used in `'use client'` components.

### Polling state matrix

| Tab visible | User active (< 2min since last interaction) | Polls? |
|-------------|----------------------------------------------|--------|
| Yes         | Yes                                          | Every 30s |
| Yes         | No (idle)                                    | Paused (skip on tick) |
| No (hidden) | --                                           | Paused (skip on tick) |
| Becomes visible / activity resumes | --                      | Immediate fetch, then every 30s |

### Changes to `page.tsx`

1. Extract the inline report-list-fetch + status-sync logic (lines 126-146) into a standalone function. To avoid stale closures:
   - Use an `activeReportRef` (a `useRef` kept in sync with `activeReport` state) to read the current active report inside the callback.
   - Use functional state updaters for `setPastReports` and `setActiveReport`.
   - The status-transition check (`running` → `completed`) reads from `activeReportRef.current` and the fetched report list. If a report's status is `completed` and `activeReportRef.current?.status` is `running`, fetch the full report data. This handles the case where a transition is detected at 30-second granularity.
   - The function must not close over `activeReport` directly.
2. Replace the `useEffect`/`setInterval` block (lines 125-150) with:
   ```ts
   useIdleAwarePolling(fetchReportList, 30_000, 120_000);
   ```
3. The `[activeReport?.id, activeReport?.status]` dependency array is eliminated entirely — the hook manages its own lifecycle.

### What stays the same

- **Active report progress polling** (`startPolling`/`stopPolling`, lines 159-206) — 1.5s interval, untouched.
- **Initial mount fetch** (`GET /api/report` at line 117) — loads reports on page load, untouched.
- **One-off report fetches** on completion, stop, resume — untouched.
- **All other pages and components** — no changes.

## Testing

### Unit tests for `useIdleAwarePolling`

Using fake timers and DOM event simulation:

- **Regular polling:** callback fires every 30s when tab is visible and user is active
- **Hidden tab:** callback is skipped when `document.hidden` is true
- **Idle user:** callback is skipped when no activity for > 2 minutes
- **Visibility resume:** immediate callback when tab becomes visible, no double-fire with next interval tick (lastFiredRef guard)
- **Activity resume from idle:** immediate callback on first user event after idle period
- **Simultaneous resume:** visibility + activity fire together — callback invoked only once (lastFiredRef guard)
- **Burst events:** multiple activity events within 100ms after idle — callback invoked only once
- **Initial state:** callback does not fire immediately on mount (lastFiredRef initialized to Date.now())
- **Cleanup:** interval cleared, listeners removed, pending debounce cancelled on unmount

### Manual verification

- Open the page, confirm network tab shows ~30s interval between `/api/report` calls
- Switch to different virtual desktop, confirm requests stop
- Move mouse after being idle, confirm immediate fetch + resumed 30s polling
- Hide tab, wait, switch back — confirm single immediate fetch on return
