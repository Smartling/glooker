# Client-Side Page Cache — Design Spec (v2)

## Overview

Add client-side caching for API responses using [SWR](https://swr.vercel.app/) so that navigating between pages feels instant. Pages render cached data immediately and revalidate in the background. Full browser refresh clears the cache.

## Problem

Every page is a `'use client'` component that re-fetches all data on mount. Navigating away and back triggers a full re-fetch with a loading spinner. The Projects page is especially slow because it calls the Jira API. Additionally, several pages use `window.location.href` for navigation, causing full page reloads that destroy all client state.

## Design

### SWR Instead of Custom Cache

Use [SWR](https://swr.vercel.app/) (4KB gzipped, by Vercel) instead of a custom cache implementation. SWR provides out of the box:

- Stale-while-revalidate with configurable TTL
- Request deduplication (concurrent calls to the same URL share one fetch)
- Dependent fetches via `null` key (skip fetch until dependency is ready)
- Error handling with `error` return value
- Force revalidation via `mutate()`
- In-memory cache that survives client-side navigation, cleared on full page refresh
- Works with React hooks rules (one hook call per URL, safe in components)

### Global SWR Configuration

Wrap the app in `<SWRConfig>` in `layout.tsx` with shared defaults:

```typescript
import { SWRConfig } from 'swr';

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
});

<SWRConfig value={{
  fetcher,
  revalidateOnFocus: false,      // don't refetch when tab regains focus
  revalidateOnReconnect: false,   // don't refetch on network reconnect
  dedupingInterval: 60_000,       // dedup identical requests within 60s
  errorRetryCount: 1,             // retry failed fetches once
}}>
```

SWR's in-memory cache provider is the default — data survives client-side navigation, cleared on full page refresh. No localStorage, no service worker.

### Per-Page TTL via `refreshInterval` and `revalidateIfStale`

Pages that need longer caching set per-hook options:

```typescript
// Rarely changes — cache for the session, revalidate on navigation
const { data } = useSWR('/api/llm-config', { revalidateIfStale: false });

// Changes per report — stale-while-revalidate on navigation
const { data, isLoading, isValidating } = useSWR(`/api/report/${id}`);

// Polling — keep fresh
const { data } = useSWR('/api/report', { refreshInterval: 30_000 });
```

### Hook Return Values

SWR's `useSWR` returns:

```typescript
{
  data: T | undefined;     // cached or fresh data
  error: Error | undefined; // fetch error (if any)
  isLoading: boolean;       // true on first load (no cache)
  isValidating: boolean;    // true during any fetch (including background revalidation)
  mutate: () => void;       // force revalidation
}
```

This addresses the missing `error` state and stale lifecycle from v1.

### Dependent Fetches

SWR handles dependent fetches natively via `null` key:

```typescript
// Team Summary: fetch report first, then teams based on org from report
const { data: reportData } = useSWR(`/api/report/${params.id}`);
const org = reportData?.report?.org;
const { data: teams } = useSWR(org ? `/api/teams?org=${org}` : null);
```

When the key is `null`, SWR skips the fetch and returns `undefined`. When the key becomes non-null (org loaded), SWR automatically fetches.

### Pages to Migrate

Each page replaces its `useEffect` + `fetch` + `useState` pattern with `useSWR`:

**Home (`src/app/page.tsx`):**
- Replace: `fetch('/api/llm-config')` → `useSWR('/api/llm-config')`

**Team Summary (`src/app/report/[id]/team/page.tsx`):**
- Replace: `fetch('/api/report/{id}')` → `useSWR('/api/report/{id}')`
- Replace: `fetch('/api/teams?org={org}')` → `useSWR(org ? '/api/teams?org={org}' : null)` (dependent)
- Replace: `fetch('/api/llm-config')` → `useSWR('/api/llm-config')`
- Fix: `window.location.href` → Next.js `Link` or `useRouter().push` for developer row clicks and org link

**Org Summary (`src/app/report/[id]/org/page.tsx`):**
- Replace: `fetch('/api/report/{id}/org')` → `useSWR('/api/report/{id}/org')`
- Replace: `fetch('/api/llm-config')` → `useSWR('/api/llm-config')`

**Dev Detail (`src/app/report/[id]/dev/[login]/page.tsx`):**
- Replace: `fetch('/api/report/{id}/dev/{login}')` → `useSWR('/api/report/{id}/dev/{login}')`
- Replace: `fetch('/api/llm-config')` → `useSWR('/api/llm-config')` (jiraHost + ccEnabled)
- Replace: summary fetch (currently chained inside `.then()` of main fetch) → `useSWR(devData ? '/api/report/{id}/dev/{login}/summary' : null)` (dependent on main data loading)
- Note: this page has 3 fetch chains that need to be unwound into independent `useSWR` calls with null-key dependencies

**Projects (`src/app/projects/projects-content.tsx`):**
- Replace: `fetch('/api/orgs')` → `useSWR('/api/orgs')`
- Replace: tab fetches → `useSWR('/api/projects?org={org}&status={tab}')` per active tab
- Keep: existing `tabCache` for local tab state (epic expand/collapse, optimistic mutations for status transitions and due dates). SWR caches the API responses; `tabCache` manages local UI mutations. These serve different purposes — don't remove `tabCache`.
- Epic ring stats: move to child component `<EpicRow>` that calls `useSWR('/api/projects/{key}/stats?org={org}')` individually — one hook per component instance, no loop violation. The parent still aggregates all loaded stats to compute `maxVolume` and `avgCommitsPerJira` (needed for log-scale ring sizing). EpicRow receives these as props and re-renders when they update. The parent maintains a `ringStats` record updated via a callback from each EpicRow when its SWR resolves. The `ProgressRing` component must be hoisted to module scope (currently defined inside the render body).
- Epic summaries: fetched on demand via `useSWR` with `revalidateIfStale: false` (only fetch once, cache forever within session)
- Untracked work: keep as direct `fetch` (triggered by button click, not render)

**Report History (`src/app/reports/page.tsx`):**
- Replace: `fetch('/api/orgs')` → `useSWR('/api/orgs')`
- Keep: `useIdleAwarePolling` for report list polling — SWR's `refreshInterval` is not idle-aware (no tab visibility or activity detection). The idle-aware hook is intentional and should not regress. Use `useSWR('/api/report')` for the initial load only (cache benefit on return navigation), and keep `useIdleAwarePolling` for the polling updates that call `setPastReports` directly.
- Keep: progress polling as direct `fetch` (1.5s interval with custom logic)
- Replace: `toggleExpand` fetch → `useSWR` in an expandable child component (e.g., `<ReportExpandedStats reportId={id} />`)
- Add: `mutate(() => true, undefined, { revalidate: true })` when report completes (global revalidation)

**NavBar (`src/components/NavBar.tsx`):**
- Replace: `fetch('/api/llm-config')` → `useSWR('/api/llm-config', { revalidateIfStale: false })`
- Shared: the same cache key means NavBar + Home + Team + Org all share one cached response
- Prefetch on hover: `preload('/api/report/{id}', fetcher)` from `swr` — populates cache before navigation

**Auth Context (`src/app/auth-context.tsx`):**
- Replace: `fetch('/api/auth/me')` → `useSWR('/api/auth/me', { revalidateIfStale: false })`
- Auth data cached for the session, never stale-revalidated (identity doesn't change mid-session)

### Preloading

SWR provides `preload(key, fetcher)` for prefetching. NavBar wraps each `<Link>` with an `onMouseEnter` handler:

```typescript
import { preload } from 'swr';

// Define fetcher at module scope (same one used in SWRConfig)
const fetcher = (url: string) => fetch(url).then(r => r.json());

// In NavBar JSX — wrap the Link or use a span wrapper:
<Link
  href={teamUrl}
  onMouseEnter={() => {
    preload(`/api/report/${latestReport.id}`, fetcher);
  }}
>
  Team Summary ...
</Link>

<Link
  href={orgUrl}
  onMouseEnter={() => {
    preload(`/api/report/${latestReport.id}/org`, fetcher);
  }}
>
  Org Summary ...
</Link>
```

`preload()` fires on mouse enter, populates SWR's cache, target page finds cached data on mount. No debounce needed — `preload` is a no-op if data is already cached. Projects is NOT preloaded (Jira API too slow for speculative fetch).

### Fix window.location.href

All `window.location.href` navigation causes full page reloads, destroying the SWR cache. Fix all instances:

| File | Location | Current | Fix |
|------|----------|---------|-----|
| `src/app/report/[id]/team/page.tsx` | Org name click | `window.location.href` | `useRouter().push()` |
| `src/app/report/[id]/team/page.tsx` | Developer row click | `window.location.href` | `useRouter().push()` |
| `src/app/report/[id]/org/page.tsx` | Developer row click (hidden, in `{false &&}` block) | `window.location.href` | `useRouter().push()` (fix while hidden) |
| `src/app/settings/page.tsx` | Navigate to home | `window.location.href` | `useRouter().push()` |
| `src/app/reports/page.tsx` | Expanded report links | `<a href>` | `<Link>` |

### Report Completion Cache Bust

When Report History detects a report completed, trigger a global SWR revalidation:

```typescript
import { useSWRConfig } from 'swr';

const { mutate } = useSWRConfig();

if (updated.status === 'completed' && current.status === 'running') {
  mutate(
    () => true,           // match all keys
    undefined,            // don't set data
    { revalidate: true }, // trigger background revalidation
  );
  setRunning(false);
}
```

This tells SWR to revalidate every cached key in the background. NavBar gets the new latest report ID, pages get fresh data on next visit.

### SWRConfig Provider Position

In `layout.tsx`, provider nesting order:

```
ThemeProvider > SWRConfig > AuthProvider > Suspense > NavBar + children
```

SWRConfig must wrap AuthProvider because AuthProvider migrates to `useSWR('/api/auth/me')` internally — it needs the global SWR config (fetcher, dedup interval) to be available. The fetcher is a plain function that doesn't need React context, so placing SWRConfig above AuthProvider is correct.

## What This Does NOT Do

- No localStorage/sessionStorage persistence — SWR's default in-memory cache only
- No service worker or offline support
- No preloading of Projects page
- No server-side caching changes
- No changes to API response headers or Next.js caching config
- No removal of Projects' `tabCache` — it handles local UI mutations (status transitions, due dates) that SWR doesn't cover

## Files

| File | Change |
|------|--------|
| `package.json` | Add `swr` dependency |
| `src/app/layout.tsx` | Add SWRConfig with global fetcher and options |
| `src/app/page.tsx` | Replace useEffect+fetch with useSWR |
| `src/app/report/[id]/team/page.tsx` | Replace fetches with useSWR, fix window.location.href |
| `src/app/report/[id]/org/page.tsx` | Replace fetches with useSWR, fix window.location.href |
| `src/app/report/[id]/dev/[login]/page.tsx` | Replace fetches with useSWR |
| `src/app/projects/projects-content.tsx` | Replace page-level fetches with useSWR, extract EpicRow component for ring stats |
| `src/app/reports/page.tsx` | Replace orgs fetch with useSWR, use SWR polling for report list, add global mutate on completion, fix <a> → <Link> |
| `src/components/NavBar.tsx` | Replace fetch with useSWR, add preload on hover |
| `src/app/auth-context.tsx` | Replace fetch with useSWR |

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Library | SWR (4KB) | Solves dedup, dependent fetches, error handling, stale lifecycle out of the box. Made by Vercel (Next.js creators). |
| Cache storage | SWR default (in-memory Map) | Clears on refresh (desired), survives navigation |
| TTL strategy | Per-hook via SWR options | `/api/llm-config` cached aggressively; report data uses SWR defaults (stale-while-revalidate); polling uses refreshInterval |
| Preloading | `preload()` on NavBar hover, not Projects | Team/Org APIs are fast; Projects calls Jira (too slow for speculative fetch) |
| Report completion | Global `mutate(() => true, { revalidate: true })` | Revalidates all SWR keys in background — cheap, reliable |
| Projects tabCache | Keep alongside SWR | tabCache handles optimistic UI mutations (status transitions, due dates). SWR caches API responses. Different concerns. |
| Auth caching | `useSWR` with `revalidateIfStale: false` | Identity doesn't change mid-session; cache forever until refresh |
| Custom cache code | None needed | SWR provides everything; no `src/contexts/cache-context.tsx` needed |
