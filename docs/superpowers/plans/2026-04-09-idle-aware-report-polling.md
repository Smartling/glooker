# Idle-Aware Report List Polling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unconditional 5-second report-list polling with a visibility + idle-aware 30-second polling hook, eliminating wasted network requests when the user is away.

**Architecture:** A new `useIdleAwarePolling` hook in `src/hooks/` encapsulates all timer, visibility, and idle-detection logic. The existing `page.tsx` replaces its `useEffect`/`setInterval` block with a single hook call. The active-report progress poller (1.5s) is untouched.

**Tech Stack:** React 19 hooks, Page Visibility API, DOM event listeners, Jest 30 with fake timers + `@testing-library/react` (`renderHook`)

**Spec:** `docs/superpowers/specs/2026-04-09-idle-aware-report-polling-design.md`

---

### Task 1: Install test dependencies and configure Jest

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `jest.config.ts` (coverage paths)

- [ ] **Step 1: Install `jest-environment-jsdom` and `@testing-library/react`**

Run:
```bash
npm install --save-dev jest-environment-jsdom @testing-library/react
```

Expected: packages install without errors. `@testing-library/react` v16+ (supports React 19). Verify `jest-environment-jsdom` major version matches Jest (v30): run `npm ls jest-environment-jsdom` and confirm `^30.x`. If only v29 is available, try `npm install --save-dev jest-environment-jsdom@next`.

- [ ] **Step 2: Add `src/hooks` to Jest coverage config**

In `jest.config.ts`, add `'src/hooks/**/*.ts'` to `collectCoverageFrom`:

```ts
collectCoverageFrom: [
  'src/lib/**/*.ts',
  'src/hooks/**/*.ts',
  '!src/lib/__tests__/**',
  '!src/lib/db/**',
],
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `npm test`

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json jest.config.ts
git commit -m "chore: add jest-environment-jsdom and @testing-library/react for hook tests"
```

---

### Task 2: Hook — basic interval polling (test + implement)

**Files:**
- Create: `src/hooks/use-idle-aware-polling.ts`
- Create: `src/lib/__tests__/unit/use-idle-aware-polling.test.ts`

- [ ] **Step 1: Write failing tests for basic polling behavior**

Create `src/lib/__tests__/unit/use-idle-aware-polling.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useIdleAwarePolling } from '@/hooks/use-idle-aware-polling';

describe('useIdleAwarePolling', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    // Ensure document is visible and user is "active" by default
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not fire callback immediately on mount', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    expect(cb).not.toHaveBeenCalled();

    // Even after a small advance — no fire until first interval tick
    act(() => { jest.advanceTimersByTime(1_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires callback every intervalMs when tab is visible and user is active', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).toHaveBeenCalledTimes(1);

    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).toHaveBeenCalledTimes(2);

    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: FAIL — `Cannot find module '@/hooks/use-idle-aware-polling'`

- [ ] **Step 3: Create the hook with minimal implementation**

Create `src/hooks/use-idle-aware-polling.ts`:

```ts
import { useEffect, useRef } from 'react';

const COOLDOWN = 5_000;

export function useIdleAwarePolling(
  callback: () => void,
  intervalMs: number,
  idleTimeoutMs: number,
): void {
  const callbackRef = useRef(callback);
  const lastActiveRef = useRef(Date.now());
  const lastFiredRef = useRef(Date.now());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep callback ref current
  callbackRef.current = callback;

  useEffect(() => {
    const fire = () => {
      callbackRef.current();
      lastFiredRef.current = Date.now();
    };

    // --- Interval tick ---
    const intervalId = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActiveRef.current > idleTimeoutMs) return;
      fire();
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [intervalMs, idleTimeoutMs]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-idle-aware-polling.ts src/lib/__tests__/unit/use-idle-aware-polling.test.ts
git commit -m "feat: add useIdleAwarePolling hook — basic interval polling with TDD"
```

---

### Task 3: Hook — visibility and idle skipping (test + implement)

**Files:**
- Modify: `src/lib/__tests__/unit/use-idle-aware-polling.test.ts`
- Modify: `src/hooks/use-idle-aware-polling.ts` (if needed — idle skipping may already pass from Task 2)

- [ ] **Step 1: Write failing tests for visibility and idle skipping**

Add these tests inside the existing `describe` block in `src/lib/__tests__/unit/use-idle-aware-polling.test.ts`:

```ts
  it('skips callback when document is hidden', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).not.toHaveBeenCalled();

    // Restore for subsequent tests
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('skips callback when user has been idle beyond the threshold', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    // Ticks at 30, 60, 90, 120s fire (user not yet idle — 120s is NOT > 120s)
    act(() => { jest.advanceTimersByTime(120_000); });
    expect(cb).toHaveBeenCalledTimes(4);

    cb.mockClear();

    // Next tick at 150s: user idle for 150s > 120s threshold → skipped
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify new tests pass (or fail)**

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: both new tests should PASS — the `document.hidden` check and idle check are already in the interval tick from Task 2. If they fail, the implementation needs adjustment.

- [ ] **Step 3: If any test failed, fix and re-run**

The idle test depends on `lastActiveRef` being initialized to `Date.now()` at mount time. With fake timers, `Date.now()` advances with `jest.advanceTimersByTime`. Verify the implementation initializes `lastActiveRef` to `Date.now()` (already done in Task 2).

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/unit/use-idle-aware-polling.test.ts
git commit -m "test: add visibility and idle skipping tests for useIdleAwarePolling"
```

---

### Task 4: Hook — resume triggers with cooldown guard (test + implement)

**Files:**
- Modify: `src/lib/__tests__/unit/use-idle-aware-polling.test.ts`
- Modify: `src/hooks/use-idle-aware-polling.ts`

- [ ] **Step 1: Write failing tests for resume behavior**

Add these tests to the existing `describe` block:

```ts
  it('fires immediately when tab becomes visible after cooldown', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    // Advance past cooldown (5s) but before first interval tick (30s)
    act(() => { jest.advanceTimersByTime(6_000); });
    expect(cb).not.toHaveBeenCalled();

    // Hide tab, then show it
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).not.toHaveBeenCalled(); // no fire when hidden

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).toHaveBeenCalledTimes(1); // immediate fire on visible

    // Advance to next interval tick — verify no spurious extra fire
    act(() => { jest.advanceTimersByTime(24_000); }); // 6s + 24s = 30s total
    expect(cb).toHaveBeenCalledTimes(2); // 1 visibility resume + 1 normal interval tick
  });

  it('fires immediately on activity after idle period (past cooldown)', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    // Advance to 126s: ticks fire at 30, 60, 90, 120s (4 calls).
    // Last fired at 120s. At 126s: idle (126s > 120s) AND cooldown passed (126-120=6s > 5s).
    act(() => { jest.advanceTimersByTime(126_000); });
    expect(cb).toHaveBeenCalledTimes(4);
    cb.mockClear();

    // User activity — was idle, cooldown passed
    act(() => { document.dispatchEvent(new MouseEvent('mousemove')); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires only once when visibility and activity resume simultaneously', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    // Get to idle state, past cooldown
    act(() => { jest.advanceTimersByTime(126_000); });
    cb.mockClear();

    // Hide tab
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { jest.advanceTimersByTime(30_000); }); // ticks skip (hidden + idle)

    // Show tab + mouse move at the same time
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(cb).toHaveBeenCalledTimes(1); // only one fire
  });

  it('fires only once for burst activity events after idle', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    act(() => { jest.advanceTimersByTime(126_000); });
    cb.mockClear();

    // Rapid burst of events
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
      document.dispatchEvent(new KeyboardEvent('keydown'));
      document.dispatchEvent(new MouseEvent('click'));
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: the 4 new tests FAIL — the hook has no `visibilitychange` listener or activity handler yet.

- [ ] **Step 3: Implement activity listeners, visibility handler, and cooldown guard**

Replace the `useEffect` in `src/hooks/use-idle-aware-polling.ts` with:

```ts
  useEffect(() => {
    const fire = () => {
      callbackRef.current();
      lastFiredRef.current = Date.now();
    };

    // --- Activity handler (raw events) ---
    const onActivity = () => {
      const now = Date.now();
      const wasIdle = now - lastActiveRef.current > idleTimeoutMs;

      // Immediate fire on resume from idle (with cooldown guard)
      if (wasIdle && now - lastFiredRef.current > COOLDOWN) {
        fire();
      }

      // Debounced: update lastActiveRef (1s trailing)
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        lastActiveRef.current = Date.now();
      }, 1_000);
    };

    // --- Visibility handler ---
    const onVisibility = () => {
      if (!document.hidden && Date.now() - lastFiredRef.current > COOLDOWN) {
        fire();
      }
    };

    // --- Interval tick ---
    const intervalId = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActiveRef.current > idleTimeoutMs) return;
      fire();
    }, intervalMs);

    // --- Register listeners ---
    const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    activityEvents.forEach(evt =>
      document.addEventListener(evt, onActivity, { passive: true }),
    );
    document.addEventListener('visibilitychange', onVisibility);

    // --- Cleanup ---
    return () => {
      clearInterval(intervalId);
      clearTimeout(debounceTimerRef.current);
      activityEvents.forEach(evt =>
        document.removeEventListener(evt, onActivity),
      );
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, idleTimeoutMs]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: all 8 tests PASS (2 from Task 2, 2 from Task 3, 4 from this task).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-idle-aware-polling.ts src/lib/__tests__/unit/use-idle-aware-polling.test.ts
git commit -m "feat: add resume triggers with cooldown guard to useIdleAwarePolling"
```

---

### Task 5: Hook — cleanup and edge cases (test + finalize)

**Files:**
- Modify: `src/lib/__tests__/unit/use-idle-aware-polling.test.ts`

- [ ] **Step 1: Write cleanup test**

Add to the `describe` block:

```ts
  it('clears interval and removes listeners on unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    unmount();

    // Interval should be cleared — advancing time should not fire callback
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(cb).not.toHaveBeenCalled();

    // Activity events should be removed — no fire
    act(() => { document.dispatchEvent(new MouseEvent('mousemove')); });
    expect(cb).not.toHaveBeenCalled();

    // Visibility events should be removed — no fire
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels pending debounce timer on unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));

    // Trigger activity to create a pending debounce timer
    act(() => { document.dispatchEvent(new MouseEvent('mousemove')); });

    // Unmount before debounce fires (within 1s)
    unmount();

    // Advance past debounce delay — timer should have been cancelled, no errors
    act(() => { jest.advanceTimersByTime(2_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not re-create interval when callback reference changes', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const { rerender } = renderHook(
      ({ fn }) => useIdleAwarePolling(fn, 30_000, 120_000),
      { initialProps: { fn: cb1 } },
    );

    // First tick at 30s fires cb1
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();

    // Change callback at 30s — should NOT reset the interval
    rerender({ fn: cb2 });

    // Next tick at 60s should fire cb2, not cb1 — and should be at 60s, not 30s+30s
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb1).toHaveBeenCalledTimes(1); // unchanged
    expect(cb2).toHaveBeenCalledTimes(1); // new callback fired
  });
```

- [ ] **Step 2: Run tests to verify all 11 pass**

Run: `npm test -- --testPathPattern="use-idle-aware-polling"`

Expected: 11 tests PASS (cleanup and callback-ref behavior already implemented in Tasks 2-4).

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/unit/use-idle-aware-polling.test.ts
git commit -m "test: add cleanup, debounce cancel, and callback stability tests — all 11 cases pass"
```

---

### Task 6: Refactor `page.tsx` to use the hook

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add import for the hook**

At the top of `src/app/page.tsx`, add:

```ts
import { useIdleAwarePolling } from '@/hooks/use-idle-aware-polling';
```

- [ ] **Step 2: Add `activeReportRef` and sync effect**

After the existing ref declarations (near `generationRef` / `lastCompletedDevsRef`), add:

```ts
const activeReportRef = useRef<Report | null>(null);
```

After the existing `useEffect` blocks (after the mount effect ending at line ~122), add:

```ts
useEffect(() => { activeReportRef.current = activeReport; }, [activeReport]);
```

- [ ] **Step 3: Replace the polling `useEffect` with `useIdleAwarePolling`**

Delete the entire `useEffect` block at lines 124-150 (the one with the comment `// Poll reports list to pick up scheduled reports`). Replace with:

```ts
// Poll reports list to pick up scheduled reports (idle-aware, 30s)
function fetchReportList() {
  fetch('/api/report')
    .then((r) => r.json())
    .then((reports: Report[]) => {
      setPastReports(reports);
      const current = activeReportRef.current;
      if (current) {
        const updated = reports.find((r: Report) => r.id === current.id);
        if (updated && updated.status !== current.status) {
          setActiveReport((prev) => prev ? { ...prev, status: updated.status, completed_at: updated.completed_at } : prev);
          if (updated.status === 'completed' && current.status === 'running') {
            fetch(`/api/report/${updated.id}`).then((r) => r.json()).then((data) => {
              setDevelopers(data.developers || []);
              setActiveReport(data.report);
            }).catch((err) => console.error('[glooker] Failed to load completed report:', err));
          }
        }
      }
    })
    .catch((err) => console.error('[glooker]', err));
}
useIdleAwarePolling(fetchReportList, 30_000, 120_000);
```

Key differences from the old code:
- Extracted into a named `fetchReportList` function (greppable in stack traces, matches spec)
- `activeReport` → `activeReportRef.current` (reads from ref, not closure)
- No `setInterval` / `clearInterval` / dependency array — the hook handles all of it
- Interval changed from 5s to 30s, with visibility + idle awareness

- [ ] **Step 4: Verify the build compiles**

Run: `npx next build 2>&1 | tail -20` (or `npm run dev` and check for compile errors)

Expected: no TypeScript or build errors.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: all tests pass (hook tests + existing tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "fix: replace unconditional 5s report polling with idle-aware 30s hook"
```

---

### Task 7: Final verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Expected: server starts without errors.

- [ ] **Step 2: Manual verification in browser**

Open `http://localhost:3000`. Open browser DevTools → Network tab. Filter for `/api/report`.

Verify:
1. **Initial load:** one `GET /api/report` on mount
2. **Regular polling:** next request appears ~30s later (not 5s)
3. **Tab hide/show:** hide the tab (switch to another tab), wait 10s, switch back — see an immediate fetch on return, then 30s cadence resumes
4. **Idle detection:** stop moving the mouse for ~2.5 minutes, observe that requests stop. Move mouse — see an immediate fetch and polling resumes.

- [ ] **Step 3: Verify the active-report progress poller is untouched**

Start a report generation (or use mock mode: `npm run dev:mock`). Observe that the progress polling still fires at 1.5s intervals (`/api/report/{id}/progress`), independent of the 30s list polling.
