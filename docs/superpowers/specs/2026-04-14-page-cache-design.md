# Client-Side Page Cache — Design Spec

## Overview

Add an in-memory client-side cache for API responses so that navigating between pages feels instant. Pages render cached data immediately and revalidate in the background. Full browser refresh clears the cache.

## Problem

Every page is a `'use client'` component that re-fetches all data on mount. Navigating away and back triggers a full re-fetch with a loading spinner. The Projects page is especially slow because it calls the Jira API. Additionally, Team Summary uses `window.location.href` for navigation, causing full page reloads that destroy all client state.

## Design

### Cache Layer

A `CacheProvider` React Context wrapping all pages (in `layout.tsx`). Provides a `useCachedFetch(url)` hook.

**Cache behavior:**
- Key: the full API URL (including query params)
- Value: the parsed JSON response + timestamp
- Storage: in-memory `Map` inside a React ref — survives client-side navigation, destroyed on full page refresh
- TTL: 60 minutes — entries older than this are treated as cache misses

**`useCachedFetch(url)` hook returns:**
```typescript
{
  data: T | null;       // cached or fresh data
  loading: boolean;     // true only on first load (no cache)
  stale: boolean;       // true when showing cached data while revalidating
}
```

**Fetch flow:**
1. Check cache for URL
2. If cached and within TTL → return cached data, set `stale: true`, revalidate in background
3. If cached but expired, or not cached → set `loading: true`, fetch, cache, return
4. On background revalidate → if response differs from cache, update data (triggers re-render)
5. On fetch error → keep showing cached data if available, don't clear cache

**Cache invalidation:**
- `cache.invalidate()` — clears all entries (called when a report completes)
- `cache.invalidatePrefix(prefix)` — clears entries whose URL starts with prefix (for targeted invalidation)
- Full page refresh — naturally clears the cache (React tree remounts)

### Implementation

**File: `src/contexts/cache-context.tsx`**

```typescript
interface CacheEntry {
  data: any;
  timestamp: number;
}

interface CacheContextType {
  get(url: string): CacheEntry | undefined;
  set(url: string, data: any): void;
  invalidate(): void;
  invalidatePrefix(prefix: string): void;
}
```

The provider stores a `Map<string, CacheEntry>` in a ref. The `useCachedFetch` hook is a convenience wrapper:

```typescript
function useCachedFetch<T>(url: string | null, ttlMs = 60 * 60 * 1000): {
  data: T | null;
  loading: boolean;
  stale: boolean;
}
```

When `url` is `null`, the hook returns `{ data: null, loading: false, stale: false }` — useful for conditional fetching.

### Pages to Migrate

Each page replaces its `useEffect` + `fetch` pattern with `useCachedFetch`:

**Home (`src/app/page.tsx`):**
- Replace: `fetch('/api/llm-config')` → `useCachedFetch('/api/llm-config')`

**Team Summary (`src/app/report/[id]/team/page.tsx`):**
- Replace: `fetch('/api/report/{id}')` → `useCachedFetch('/api/report/{id}')`
- Replace: `fetch('/api/teams?org={org}')` → `useCachedFetch('/api/teams?org={org}')`
- Replace: `fetch('/api/llm-config')` → `useCachedFetch('/api/llm-config')`
- Fix: `window.location.href` → Next.js `Link` for developer row clicks and org link

**Org Summary (`src/app/report/[id]/org/page.tsx`):**
- Replace: `fetch('/api/report/{id}/org')` → `useCachedFetch('/api/report/{id}/org')`
- Replace: `fetch('/api/llm-config')` → `useCachedFetch('/api/llm-config')`

**Projects (`src/app/projects/projects-content.tsx`):**
- Replace: `fetch('/api/orgs')` → `useCachedFetch('/api/orgs')`
- Replace: `fetch('/api/projects?org={org}&status={tab}')` → `useCachedFetch` for each tab
- Epic stats and summaries: use `useCachedFetch` so they persist across navigations
- The existing `tabCache` state can be removed since the shared cache handles it

**Report History (`src/app/reports/page.tsx`):**
- Replace: `fetch('/api/orgs')` → `useCachedFetch('/api/orgs')`
- Keep: `fetch('/api/report')` as direct fetch (polled, always needs to be fresh)
- Keep: progress polling as direct fetch
- Add: `cache.invalidate()` when report status changes to `completed`

**NavBar (`src/components/NavBar.tsx`):**
- Replace: `fetch('/api/llm-config')` → `useCachedFetch('/api/llm-config')`
- This means `/api/llm-config` is fetched once and shared across NavBar + all pages that use it

### Preloading

NavBar preloads Team Summary and Org Summary data on hover over those nav items:

```typescript
<Link
  href={teamUrl}
  onMouseEnter={() => cache.prefetch(`/api/report/${latestReport.id}`)}
>
```

`cache.prefetch(url)` — fetches and caches if not already cached. Fire-and-forget, no UI impact. The `useCachedFetch` call on the target page will find the data in cache and render instantly.

Projects is NOT preloaded (Jira API too slow for speculative fetching). It benefits from cache on return visits only.

### Fix window.location.href

Team Summary page uses `window.location.href` in two places, causing full page reloads:
1. Clicking the org name link
2. Clicking a developer table row

Both need to change to Next.js `Link` or `router.push` for client-side navigation. This is required for the cache to work — `window.location.href` destroys all React state including the cache.

### Report Completion Cache Bust

In Report History, the idle-aware polling already detects when a report completes:

```typescript
if (updated.status === 'completed' && current.status === 'running') {
  cache.invalidate(); // Clear all cached data — nav links, team/org data, etc.
  setRunning(false);
}
```

This ensures:
- NavBar picks up the new latest report ID on next render
- Team/Org Summary pages will fetch fresh data on next visit
- Cheap (one Map.clear() call) and reliable (triggered by existing polling logic)

## What This Does NOT Do

- No localStorage/sessionStorage persistence — cache is session-only
- No service worker or offline support
- No preloading of Projects page
- No server-side caching changes
- No changes to API response headers or Next.js caching config

## Files

| File | Change |
|------|--------|
| Create: `src/contexts/cache-context.tsx` | CacheProvider + useCachedFetch + prefetch |
| Modify: `src/app/layout.tsx` | Add CacheProvider |
| Modify: `src/app/page.tsx` | Use useCachedFetch |
| Modify: `src/app/report/[id]/team/page.tsx` | Use useCachedFetch, fix window.location.href → Link |
| Modify: `src/app/report/[id]/org/page.tsx` | Use useCachedFetch |
| Modify: `src/app/projects/projects-content.tsx` | Use useCachedFetch, remove tabCache |
| Modify: `src/app/reports/page.tsx` | Add cache.invalidate() on report completion |
| Modify: `src/components/NavBar.tsx` | Use useCachedFetch, add prefetch on hover |

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cache storage | In-memory React ref | Clears on refresh (desired), survives navigation, no persistence complexity |
| TTL | 60 minutes | Long enough for a session, short enough to not serve very stale data |
| Cache key | Full URL with query params | Simple, unique, no normalization needed |
| Preloading | Team/Org Summary on hover, not Projects | Team/Org are fast APIs; Projects calls Jira (too slow for speculative fetch) |
| Report completion | Invalidate all cache | Cheap, reliable, ensures fresh data everywhere after a report finishes |
| Stale-while-revalidate | Yes | Show cached data instantly, update if changed — best UX |
| Projects tabCache | Remove, use shared cache | Avoids duplicate caching logic; shared cache persists across navigations |
