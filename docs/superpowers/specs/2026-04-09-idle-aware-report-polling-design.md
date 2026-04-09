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

**Behavior:**

1. On mount, registers debounced listeners (1s debounce) for `mousemove`, `keydown`, `scroll`, `touchstart`, `click` — updates a `lastActiveRef` timestamp.
2. On mount, registers a `visibilitychange` listener.
3. Runs a `setInterval` at `intervalMs`. On each tick:
   - If `document.hidden` → skip.
   - If `Date.now() - lastActive > idleTimeoutMs` → skip.
   - Otherwise → invoke `callback()`.
4. When tab becomes visible again (`visibilitychange` event with `!document.hidden`), or when a user-activity event fires and the previous state was idle (`Date.now() - lastActive > idleTimeoutMs` before updating the timestamp): invoke `callback()` immediately. The regular interval continues ticking on its own cadence — no restart needed.
5. On unmount: clear interval, remove all listeners.

**Design rationale — skip-on-tick vs. pause/resume:** The interval always ticks; the tick handler just checks two conditions before invoking the callback. This avoids complex state management around clearing and recreating intervals when idle/visibility toggles rapidly. The cost of a no-op tick (one timestamp comparison) is negligible.

**Callback stability:** The hook stores the callback in a ref internally, so the caller does not need to memoize it. The hook itself never re-creates the interval.

### Polling state matrix

| Tab visible | User active (< 2min since last interaction) | Polls? |
|-------------|----------------------------------------------|--------|
| Yes         | Yes                                          | Every 30s |
| Yes         | No (idle)                                    | Paused (skip on tick) |
| No (hidden) | --                                           | Paused (skip on tick) |
| Becomes visible / activity resumes | --                      | Immediate fetch, then every 30s |

### Changes to `page.tsx`

1. Extract the inline report-list-fetch + status-sync logic (lines 126-146) into a standalone function. Use functional state updaters (`setActiveReport(prev => ...)`) and refs to avoid stale closures — the function must not close over `activeReport` directly.
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

- Unit test for `useIdleAwarePolling`: mock timers and DOM events, verify callback is called/skipped based on visibility and idle state
- Manual verification: open the page, confirm network tab shows 30s interval; switch to different desktop, confirm requests stop; move mouse, confirm immediate fetch + resumed polling
