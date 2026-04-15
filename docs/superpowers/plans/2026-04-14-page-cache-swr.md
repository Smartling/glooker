# Client-Side Page Cache (SWR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SWR-based client-side caching so page navigation feels instant — cached data renders immediately, revalidates in background.

**Architecture:** Install SWR, add global `SWRConfig` in layout, then migrate each page from `useEffect` + `fetch` + `useState` to `useSWR`. Fix `window.location.href` to preserve cache across navigation. Add prefetching on NavBar hover.

**Tech Stack:** SWR 2.x, Next.js 15, TypeScript, React hooks

---

### Task 1: Install SWR and Configure Layout

**Files:**
- Modify: `package.json`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Install SWR**

```bash
npm install swr
```

- [ ] **Step 2: Add SWRConfig to layout.tsx**

In `src/app/layout.tsx`, add the import and wrap children. The provider order must be: `ThemeProvider > SWRConfig > AuthProvider > Suspense > NavBar + children`.

```tsx
import { SWRConfig } from 'swr';

// Add this fetcher function before the component:
const swrFetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
});
```

Update the JSX to wrap `SWRConfig` around `AuthProvider`:

```tsx
<ThemeProvider>
  <SWRConfig value={{
    fetcher: swrFetcher,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    errorRetryCount: 1,
  }}>
    <AuthProvider>
      <Suspense>
        <NavBar />
      </Suspense>
      {children}
      <Footer />
    </AuthProvider>
  </SWRConfig>
</ThemeProvider>
```

Note: `SWRConfig` is a client component but `layout.tsx` is a server component. You need to create a small client wrapper. Create a `'use client'` wrapper component in the same file or extract it:

```tsx
'use client';
import { SWRConfig } from 'swr';

const swrFetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
});

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{
      fetcher: swrFetcher,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
      errorRetryCount: 1,
    }}>
      {children}
    </SWRConfig>
  );
}
```

Since `ThemeProvider` and `AuthProvider` are already `'use client'`, the simplest approach is to add `SWRConfig` directly inside the existing client component tree. The layout imports client components — `SWRConfig` can be used inside any of them. Add `SWRProvider` as a wrapper in `layout.tsx`:

```tsx
<ThemeProvider>
  <SWRProvider>
    <AuthProvider>
      <Suspense>
        <NavBar />
      </Suspense>
      {children}
      <Footer />
    </AuthProvider>
  </SWRProvider>
</ThemeProvider>
```

Create `src/lib/swr-provider.tsx` as the client component:

```tsx
'use client';

import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
});

export default function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{
      fetcher,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
      errorRetryCount: 1,
    }}>
      {children}
    </SWRConfig>
  );
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build` — should compile. The app should work identically (SWR is configured but no page uses it yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/swr-provider.tsx src/app/layout.tsx
git commit -m "feat(cache): install SWR and add global SWRConfig to layout"
```

---

### Task 2: Migrate Auth Context to SWR

**Files:**
- Modify: `src/app/auth-context.tsx`

- [ ] **Step 1: Replace useEffect+fetch with useSWR**

In `src/app/auth-context.tsx`, the current pattern is:

```tsx
useEffect(() => {
  fetch('/api/auth/me').then(res => res.json()).then(data => {
    setState({ enabled: data.enabled ?? false, user: data.user ?? null, loading: false });
  }).catch(() => {
    setState({ enabled: false, user: null, loading: false });
  });
}, []);
```

Replace with `useSWR`. The component needs to stay as a context provider. Import `useSWR` and replace the state + effect:

```tsx
import useSWR from 'swr';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSWR('/api/auth/me', { revalidateIfStale: false });

  const state: AuthContextType = {
    enabled: data?.enabled ?? false,
    user: data?.user ?? null,
    loading: isLoading,
  };

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}
```

Remove the `useState` and `useEffect` that were doing the fetch. Keep the `AuthContext`, `useAuth`, and interface definitions unchanged.

- [ ] **Step 2: Build and verify**

Run: `npm run build` — auth should still work.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth-context.tsx
git commit -m "feat(cache): migrate auth context to useSWR"
```

---

### Task 3: Migrate NavBar to SWR + Add Preloading

**Files:**
- Modify: `src/components/NavBar.tsx`

- [ ] **Step 1: Replace useEffect+fetch with useSWR**

Replace the `useState` + `useEffect` pattern with `useSWR`:

```tsx
import useSWR, { preload } from 'swr';

// Remove: const [latestReport, setLatestReport] = useState(...)
// Remove: const [projectsEnabled, setProjectsEnabled] = useState(...)
// Remove: the entire useEffect block

// Replace with:
const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
const latestReport = config?.latestReport ?? null;
const projectsEnabled = Boolean(config?.jira?.enabled && config?.jira?.projectsJql);
```

- [ ] **Step 2: Add preload on hover**

Define the fetcher at module scope (must match the global SWR fetcher):

```tsx
const fetcher = (url: string) => fetch(url).then(r => r.json());
```

On the Team Summary and Org Summary `<Link>` elements, add `onMouseEnter`:

```tsx
{teamUrl ? (
  <Link
    href={teamUrl}
    className={navItemClass(isTeamActive)}
    onMouseEnter={() => preload(`/api/report/${latestReport!.id}`, fetcher)}
  >
    Team Summary <span className="text-gray-600 text-[10px] ml-1">{latestReport?.date}</span>
  </Link>
) : ( ... )}

{orgUrl ? (
  <Link
    href={orgUrl}
    className={navItemClass(isOrgActive)}
    onMouseEnter={() => preload(`/api/report/${latestReport!.id}/org`, fetcher)}
  >
    Org Summary <span className="text-gray-600 text-[10px] ml-1">{latestReport?.date}</span>
  </Link>
) : ( ... )}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/components/NavBar.tsx
git commit -m "feat(cache): migrate NavBar to useSWR with hover preloading"
```

---

### Task 4: Migrate Home Page to SWR

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace useEffect+fetch with useSWR**

The Home page fetches `/api/llm-config` on mount. Replace with `useSWR`:

```tsx
import useSWR from 'swr';

// Remove: useState for org, loading
// Remove: the useEffect block

// Replace with:
const { data: config, isLoading: loading } = useSWR('/api/llm-config', { revalidateIfStale: false });
const org = config?.latestReport?.org ?? null;
```

Update the JSX to use `loading` and `org` from SWR instead of state. The `LlmFindings` and `ChatPanel` rendering stays the same.

- [ ] **Step 2: Build and verify**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(cache): migrate Home page to useSWR"
```

---

### Task 5: Migrate Team Summary to SWR + Fix window.location.href

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`

- [ ] **Step 1: Replace fetch patterns with useSWR**

The page has 3 fetches in one useEffect. Replace with 3 independent `useSWR` calls:

```tsx
import useSWR from 'swr';

// Main report data
const { data: reportData, isLoading } = useSWR(`/api/report/${params.id}`);
const developers = reportData?.developers ?? [];
const activeReport = reportData?.report ?? null;

// Teams (dependent on org from report)
const org = activeReport?.org;
const { data: teamsData } = useSWR(org ? `/api/teams?org=${org}` : null);
const teams = teamsData ?? [];

// Latest report ID (for historical warning)
const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
const latestReportId = config?.latestReport?.id ?? null;
```

Remove the `useState` for `developers`, `activeReport`, `teams`, `latestReportId` and the `useEffect` that fetched them.

Keep: `filterLogins`, `filterQuery`, `filterOpen`, `filterHighlight` state (UI-only). Keep: `commitCache`, `jiraCache` refs (tooltip caches).

- [ ] **Step 2: Fix window.location.href → useRouter**

Import `useRouter`:
```tsx
import { useParams, useRouter } from 'next/navigation';
const router = useRouter();
```

Replace the two `window.location.href` usages:

```tsx
// Org name click (around line 158):
onClick={() => router.push(`/report/${activeReport.id}/org`)}

// Developer row click (around line 320):
onClick={() => router.push(`/report/${params.id}/dev/${dev.github_login}`)}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add "src/app/report/[id]/team/page.tsx"
git commit -m "feat(cache): migrate Team Summary to useSWR, fix window.location.href"
```

---

### Task 6: Migrate Org Summary to SWR

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Replace fetch patterns with useSWR**

Replace the useEffect with two `useSWR` calls:

```tsx
import useSWR from 'swr';

// Main org report data
const { data, isLoading: loading, error } = useSWR(`/api/report/${params.id}/org`);
const report = data?.report ?? null;
const developers = data?.developers ?? [];
const timeline = data?.timeline ?? [];

// Latest report ID (for historical warning)
const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
const latestReportId = config?.latestReport?.id ?? null;
```

Remove the `useState` for `loading`, `report`, `developers`, `timeline`, `error`, `latestReportId` and the `useEffect`.

- [ ] **Step 2: Fix window.location.href in hidden developer table**

Find the `window.location.href` in the `{false && ...}` block (developer row click). Replace with `router.push`:

```tsx
import { useParams, useRouter } from 'next/navigation';
const router = useRouter();

// In the hidden table row onClick:
onClick={() => router.push(`/report/${params.id}/dev/${dev.github_login}`)}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx"
git commit -m "feat(cache): migrate Org Summary to useSWR"
```

---

### Task 7: Migrate Dev Detail to SWR

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`

- [ ] **Step 1: Replace 3 fetch chains with independent useSWR calls**

This page has 3 useEffect blocks with fetches. Replace each:

```tsx
import useSWR from 'swr';

// 1. Config (jiraHost, ccEnabled)
const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
const jiraHost = config?.jira?.host ?? null;
const ccEnabled = config?.claudeCode?.enabled ?? false;

// 2. Main dev data
const { data: devData, isLoading } = useSWR(`/api/report/${params.id}/dev/${params.login}`);
const report = devData?.report ?? null;
const dev = devData?.developer ?? null;
const allDevs = devData?.allDevelopers ?? [];
const commits = devData?.commits ?? [];
const timeline = devData?.timeline ?? [];

// 3. Summary (dependent on devData loading)
const { data: summaryData, isLoading: summaryLoading } = useSWR(
  devData ? `/api/report/${params.id}/dev/${params.login}/summary` : null,
  { revalidateIfStale: false }
);
const summary = summaryData?.summary ?? null;
const badges = summaryData?.badges ?? [];
```

Remove the corresponding `useState` and `useEffect` blocks. Keep UI state (expand/collapse, tooltip state, etc.).

For Jira issues (conditional fetch based on dev data):
```tsx
const hasJira = dev && (dev.total_jira_issues ?? 0) > 0;
const { data: jiraIssues } = useSWR(
  hasJira ? `/api/report/${params.id}/jira-issues?login=${params.login}` : null,
  { revalidateIfStale: false }
);
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add "src/app/report/[id]/dev/[login]/page.tsx"
git commit -m "feat(cache): migrate Dev Detail to useSWR with dependent fetches"
```

---

### Task 8: Migrate Report History to SWR + Cache Bust

**Files:**
- Modify: `src/app/reports/page.tsx`

- [ ] **Step 1: Replace orgs fetch with useSWR**

```tsx
import useSWR, { useSWRConfig } from 'swr';

// Replace the orgs fetch in useEffect:
const { data: orgsData } = useSWR('/api/orgs');
const orgs = orgsData ?? [];

// Set default org when orgs load:
useEffect(() => {
  if (orgs.length > 0 && !org) setOrg(orgs[0].login);
}, [orgs]);
```

- [ ] **Step 2: Use useSWR for initial report list load**

```tsx
// Initial load — SWR caches this for return navigation
const { data: initialReports } = useSWR('/api/report');
useEffect(() => {
  if (initialReports) setPastReports(initialReports);
}, [initialReports]);
```

Keep `useIdleAwarePolling` for the polling updates — it calls `setPastReports` directly. SWR handles the initial cached load only.

- [ ] **Step 3: Add global cache bust on report completion**

```tsx
const { mutate: globalMutate } = useSWRConfig();

// In the fetchReportList function, where completion is detected:
if (updated.status === 'completed' && current.status === 'running') {
  globalMutate(
    () => true,
    undefined,
    { revalidate: true },
  );
  setRunning(false);
}
```

- [ ] **Step 4: Fix expanded report links — `<a href>` → `<Link>`**

Import `Link` from `next/link` and replace the expanded report links:

```tsx
import Link from 'next/link';

// Replace <a href={...}> with:
<Link href={`/report/${r.id}/team`} className="...">Team Summary →</Link>
<Link href={`/report/${r.id}/org`} className="...">Org Summary →</Link>
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/app/reports/page.tsx
git commit -m "feat(cache): migrate Report History to useSWR with global cache bust"
```

---

### Task 9: Migrate Projects Page to SWR

**Files:**
- Modify: `src/app/projects/projects-content.tsx`

This is the most complex migration. Be careful to keep existing UI mutation logic intact.

- [ ] **Step 1: Replace orgs fetch with useSWR**

```tsx
import useSWR from 'swr';

// Replace the orgs useEffect:
const { data: orgsData } = useSWR('/api/orgs');

// Set org when orgs load (keep existing logic):
useEffect(() => {
  if (orgsData?.length > 0 && !org) {
    setOrg(orgsData[0].login);
  }
}, [orgsData]);
```

- [ ] **Step 2: Replace tab fetch with useSWR**

The current `fetchTab` callback fetches `/api/projects?org=...&status=...`. Replace with `useSWR` for the active tab:

```tsx
const { data: tabData, isLoading: tabLoading } = useSWR(
  org ? `/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(activeTab)}` : null,
);

// When tabData arrives, populate the tabCache (for mutations):
useEffect(() => {
  if (tabData?.epics) {
    setTabCache(prev => ({ ...prev, [activeTab]: tabData.epics }));
    if (tabData.jiraHost) setJiraHost(tabData.jiraHost);
  }
}, [tabData, activeTab]);
```

Keep the `tabCache` state for optimistic mutations (status transitions, due dates). SWR caches the API response; `tabCache` is the mutable local copy.

Remove the `fetchTab` callback and its `useEffect` trigger. The background prefetch for non-active tabs can use SWR's `preload`:

```tsx
import { preload } from 'swr';
const fetcher = (url: string) => fetch(url).then(r => r.json());

// After active tab loads, prefetch other tabs:
useEffect(() => {
  if (org && tabData) {
    const otherTabs = ['In Progress', 'Rollout', 'Done'].filter(t => t !== activeTab);
    for (const tab of otherTabs) {
      preload(`/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(tab)}`, fetcher);
    }
  }
}, [org, tabData, activeTab]);
```

- [ ] **Step 3: Epic ring stats — use useSWR per-epic in child component pattern**

The current pattern fetches ring stats in a `useEffect` loop (one fetch per epic). This can't use `useSWR` directly (hooks in loops violate React rules). Instead, each epic row should be a child component that calls `useSWR` for its own stats.

However, `maxVolume` and `avgCommitsPerJira` need all stats to be computed at the parent level. The pragmatic approach: keep the existing `ringStats` state + `useEffect` loop for now. The ring stats already have their own cache in the `epic_stats` DB table (24h server-side cache). The SWR migration adds value for page-level API responses, not for these per-row fetches.

Keep the existing ring stats pattern unchanged. The main cache benefit comes from the page-level `/api/projects` responses being cached by SWR.

- [ ] **Step 4: Build and verify**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/app/projects/projects-content.tsx
git commit -m "feat(cache): migrate Projects page to useSWR, keep tabCache for mutations"
```

---

### Task 10: Fix Remaining window.location.href + Final Verification

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Fix settings page window.location.href**

Find the `window.location.href = '/'` usage (around line 1179) and replace with `useRouter().push('/')`. The settings page may already have `useRouter` imported — check first. If not, add the import and variable.

Actually, check if settings page still has `window.location.href` — it may have been removed during the nav redesign. If already removed, skip this step.

- [ ] **Step 2: Run full test suite**

Run: `npm test` — all tests must pass.

- [ ] **Step 3: Run production build**

Run: `rm -rf .next && npm run build` — must compile cleanly.

- [ ] **Step 4: Manual smoke test**

Start the dev server or Docker and test:
1. Navigate Home → Team Summary → back to Home — should be instant on return
2. Navigate Home → Org Summary → back — instant
3. Navigate Home → Projects → back — Projects is slow first time, instant on return
4. Navigate Home → Report History → back — instant
5. Click a developer row on Team Summary → Dev Detail → back — instant (client-side navigation, no reload)
6. Hover over "Team Summary" in NavBar → click — should feel faster (preloaded)
7. Full page refresh (F5) → all data re-fetches (cache cleared)
8. Start a report → let it complete → navigate to Team Summary → should show new data (cache busted)

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "feat(cache): final fixups from smoke testing"
```
