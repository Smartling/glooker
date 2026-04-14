# Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-page ad-hoc navigation with a shared top NavBar, add breadcrumbs for drill-down pages, move report management to a dedicated Report History page, and rework the home page into a dashboard.

**Architecture:** Create a shared `NavBar` client component in `src/components/` that renders on every page via `layout.tsx`. It fetches the latest report ID from a new API field to build Team/Org Summary links. Each page's custom navigation (back buttons, logo links, settings buttons) gets removed. A new `/reports` route receives the report list and generation form currently on the home page.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, `usePathname()` for active state, `<Link>` for client-side navigation

---

### Task 1: Add latestReport to API Config

**Files:**
- Modify: `src/lib/app-config/service.ts`
- Modify: `src/app/api/llm-config/route.ts`

- [ ] **Step 1: Add latestReport query to getAppConfig**

The function needs to be async now since it queries the DB. However, `getAppConfig()` is called synchronously in many places. Instead, add a separate function. In `src/lib/app-config/service.ts`, add at the bottom before the `testLLMConnection` function:

```typescript
export async function getLatestReport(): Promise<{ id: string; date: string; org: string } | null> {
  try {
    const db = (await import('@/lib/db')).default;
    const [rows] = await db.execute(
      `SELECT id, org, created_at FROM reports WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    ) as [any[], any];
    if (!rows.length) return null;
    const r = rows[0];
    const date = new Date(r.created_at);
    return {
      id: r.id,
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      org: r.org,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add latestReport to the API response**

In `src/app/api/llm-config/route.ts`, update the GET handler:

```typescript
import { NextResponse } from 'next/server';
import { getAppConfig, testLLMConnection, getLatestReport } from '@/lib/app-config/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  const [config, latestReport] = await Promise.all([
    Promise.resolve(getAppConfig()),
    getLatestReport(),
  ]);
  return NextResponse.json({ ...config, latestReport });
}

async function postHandler(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(await testLLMConnection());
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
```

- [ ] **Step 3: Verify it works**

Run: `npm run build` — should compile. Then start dev server and check:
```
curl -s http://localhost:3000/api/llm-config | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('latestReport'))"
```

Expected: `{'id': '...', 'date': 'Apr 13', 'org': 'Smartling'}` or `None` if no reports.

- [ ] **Step 4: Commit**

```bash
git add src/lib/app-config/service.ts src/app/api/llm-config/route.ts
git commit -m "feat(nav): add latestReport to /api/llm-config response"
```

---

### Task 2: Create NavBar Component

**Files:**
- Create: `src/components/NavBar.tsx`

- [ ] **Step 1: Create the NavBar component**

Create `src/components/NavBar.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/auth-context';

interface LatestReport {
  id: string;
  date: string;
  org: string;
}

export default function NavBar() {
  const pathname = usePathname();
  const { enabled: authEnabled, user, canAct } = useAuth();
  const [latestReport, setLatestReport] = useState<LatestReport | null>(null);
  const [projectsEnabled, setProjectsEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/llm-config')
      .then(r => r.json())
      .then(d => {
        setLatestReport(d.latestReport ?? null);
        setProjectsEnabled(d.jira?.enabled && d.jira?.projectsJql);
      })
      .catch(() => {});
  }, []);

  // Determine active nav item from pathname
  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  const isTeamActive = pathname.match(/^\/report\/[^/]+\/org/) && !pathname.includes('?view=org')
    || pathname.match(/^\/report\/[^/]+\/dev\//);
  const isOrgActive = pathname.match(/^\/report\/[^/]+\/org/) && !isTeamActive;

  const navItemClass = (active: boolean, disabled: boolean = false) =>
    `px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
      disabled
        ? 'text-gray-700 cursor-not-allowed'
        : active
          ? 'text-indigo-400 bg-indigo-500/10 font-semibold'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
    }`;

  const teamUrl = latestReport ? `/report/${latestReport.id}/org` : null;
  const orgUrl = latestReport ? `/report/${latestReport.id}/org?view=org` : null;

  return (
    <nav className="bg-[#111118] border-b border-gray-800/80 px-5 flex items-center h-12 gap-1 no-print">
      {/* Logo */}
      <Link href="/" className="font-bold text-[15px] text-gray-100 mr-6 tracking-tight hover:text-white transition-colors">
        <span className="text-indigo-400">G</span>looker
      </Link>

      {/* Primary nav */}
      <div className="flex items-center gap-0.5 flex-1">
        <Link href="/" className={navItemClass(isActive('/') && !pathname.startsWith('/report') && !pathname.startsWith('/projects') && !pathname.startsWith('/reports'))}>
          Home
        </Link>

        {teamUrl ? (
          <Link href={teamUrl} className={navItemClass(Boolean(isTeamActive))}>
            Team Summary <span className="text-gray-600 text-[10px] ml-1">{latestReport?.date}</span>
          </Link>
        ) : (
          <span className={navItemClass(false, true)}>
            Team Summary
          </span>
        )}

        {orgUrl ? (
          <Link href={orgUrl} className={navItemClass(Boolean(isOrgActive))}>
            Org Summary <span className="text-gray-600 text-[10px] ml-1">{latestReport?.date}</span>
          </Link>
        ) : (
          <span className={navItemClass(false, true)}>
            Org Summary
          </span>
        )}

        <Link href="/reports" className={navItemClass(isActive('/reports'))}>
          Report History
        </Link>

        {projectsEnabled && (
          <Link href="/projects" className={navItemClass(isActive('/projects'))}>
            Projects
          </Link>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <Link href="/settings" className={`p-2 rounded-md transition-colors ${isActive('/settings') ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
        {authEnabled && user && (
          <Link href="/profile" className={`flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full transition-colors ${isActive('/profile') ? 'bg-indigo-500/10' : 'hover:bg-gray-800/50'}`}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full border border-gray-700" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
            )}
          </Link>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build` — should compile with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/NavBar.tsx
git commit -m "feat(nav): create shared NavBar component"
```

---

### Task 3: Create Breadcrumb Component

**Files:**
- Create: `src/components/Breadcrumb.tsx`

- [ ] **Step 1: Create the Breadcrumb component**

Create `src/components/Breadcrumb.tsx`:

```tsx
import Link from 'next/link';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="px-5 py-2 text-xs text-gray-500 flex items-center gap-1.5 no-print">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-700">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-indigo-400 hover:text-indigo-300 transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-300 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Breadcrumb.tsx
git commit -m "feat(nav): create Breadcrumb component"
```

---

### Task 4: Add NavBar to Root Layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Import and add NavBar**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from './theme-context';
import { AuthProvider } from './auth-context';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Glooker — GitHub Analytics',
  description: 'Developer impact analytics for your GitHub org',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0F0F0F] text-gray-100 min-h-screen antialiased">
        <ThemeProvider>
          <AuthProvider>
            <NavBar />
            {children}
            <Footer />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `npm run dev` — every page should now show the NavBar at the top (plus the old per-page navigation below it, which we'll remove next). Verify the NavBar appears and links work.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(nav): add NavBar to root layout"
```

---

### Task 5: Remove Per-Page Navigation from All Pages

**Files:**
- Modify: `src/app/page.tsx` (remove header with Glooker title + Settings/Projects/Profile buttons)
- Modify: `src/app/report/[id]/org/page.tsx` (remove back button + Glooker logo)
- Modify: `src/app/report/[id]/dev/[login]/page.tsx` (remove back button + Glooker logo, add Breadcrumb)
- Modify: `src/app/projects/projects-content.tsx` (remove "← Back to Dashboard" link)
- Modify: `src/app/settings/page.tsx` (remove Glooker header)
- Modify: `src/app/profile/profile-content.tsx` (remove back button)

- [ ] **Step 1: Remove home page header**

In `src/app/page.tsx`, find and delete the entire header `<div>` block (the one containing the Glooker title, Projects button, Settings button, and Profile link). It starts with `{/* Header */}` and the `<div className="mb-8 flex items-center justify-between">`. Remove from `{/* Header */}` through the closing `</div>` of that block.

- [ ] **Step 2: Remove org report page navigation**

In `src/app/report/[id]/org/page.tsx`, find and delete the "Back link" div — the block starting with `{/* Back link */}` containing the back button and "Glooker" span. Keep the report header (`<div className="bg-gray-900 rounded-xl p-6 mb-6">`) that shows org name, period, and Download PDF button.

Also remove `const router = useRouter();` if it's only used for the back button and logo click. Check if `router` is used elsewhere first.

- [ ] **Step 3: Remove dev detail page navigation and add Breadcrumb**

In `src/app/report/[id]/dev/[login]/page.tsx`, find and delete the "Back link" div — same pattern as org page (back button + Glooker span).

Add Breadcrumb import and rendering. After the early return guards (loading/error), add:

```tsx
import Breadcrumb from '@/components/Breadcrumb';

// In the JSX, before the developer content:
<Breadcrumb items={[
  { label: 'Team Summary', href: `/report/${params.id}/org` },
  { label: `@${params.login}` },
]} />
```

- [ ] **Step 4: Remove projects page back link**

In `src/app/projects/projects-content.tsx`, find and delete the `<a href="/" ...>← Back to Dashboard</a>` element.

- [ ] **Step 5: Remove settings page header**

In `src/app/settings/page.tsx`, find and delete the header div containing the "Glooker" span with `onClick={() => router.push('/')}` and the "/ Settings" text. Keep the tabs section.

- [ ] **Step 6: Remove profile page back button**

In `src/app/profile/profile-content.tsx`, find and delete the back button with the SVG arrow and "Back" text.

- [ ] **Step 7: Clean up unused imports**

After removing navigation elements, clean up any now-unused imports across all modified files:
- `useRouter` from `next/navigation` (if no longer used in that file)
- Any SVG icon imports that were only used in removed nav elements

- [ ] **Step 8: Build and test**

Run: `npm run build` — must compile with no errors.

Manually test each page:
- Home: no duplicate header
- Org report: no back button, NavBar shows "Org Summary" or "Team Summary" highlighted
- Dev detail: breadcrumb shows, NavBar has "Team Summary" highlighted
- Projects: no back link, NavBar has "Projects" highlighted
- Settings: no Glooker header, NavBar has settings icon highlighted
- Profile: no back button

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx "src/app/report/[id]/org/page.tsx" "src/app/report/[id]/dev/[login]/page.tsx" src/app/projects/projects-content.tsx src/app/settings/page.tsx src/app/profile/profile-content.tsx
git commit -m "feat(nav): remove per-page navigation, add breadcrumb to dev detail"
```

---

### Task 6: Create Report History Page

**Files:**
- Create: `src/app/reports/page.tsx`
- Modify: `src/app/page.tsx`

The current home page (`src/app/page.tsx`) contains the report list, generation form, and developer table. The report list and generation form need to move to `/reports`. The developer table stays on the home page (it shows developers from the active/latest report).

- [ ] **Step 1: Create the Report History page**

Create `src/app/reports/page.tsx`. This page needs the following content moved from `src/app/page.tsx`:
- The report list sidebar (past reports with status, date, org, delete/resume controls)
- The report generation form (+ New Report button, org selector, period selector)
- The org selection logic

The page should be a `'use client'` component that fetches from `/api/report` and `/api/orgs`, same as the current home page. Extract the report list and generation form JSX from `src/app/page.tsx` into this new page.

Keep the same state management pattern (useState for reports, orgs, running state, etc.) but only for the report management functionality.

- [ ] **Step 2: Simplify the home page**

In `src/app/page.tsx`, remove:
- The report list sidebar
- The report generation form
- The org selector (if only used for report generation)

Keep:
- Developer table from the latest/active report
- How Impact Score Works widget
- Tips
- Any other dashboard content

The home page should auto-load the latest completed report's developer data on mount (currently it shows developers only after clicking a report in the sidebar).

- [ ] **Step 3: Build and test**

Run: `npm run build`

Test:
- `/reports` shows the report list and generation form
- `/` shows the dashboard with latest report's developer table
- Generating a report from `/reports` works
- NavBar "Report History" link goes to `/reports`

- [ ] **Step 4: Commit**

```bash
git add src/app/reports/page.tsx src/app/page.tsx
git commit -m "feat(nav): create Report History page, rework home into dashboard"
```

---

### Task 7: Add view Param Support to Org Page

**Files:**
- Modify: `src/app/report/[id]/org/page.tsx`

- [ ] **Step 1: Read view param and scroll behavior**

In `src/app/report/[id]/org/page.tsx`, use `useSearchParams()` to read the `view` parameter:

```tsx
import { useSearchParams } from 'next/navigation';

// Inside component:
const searchParams = useSearchParams();
const view = searchParams.get('view'); // 'org' or null (default = team)
```

When `view=org`, auto-scroll past the developer table to the charts section on mount. Use a `useEffect` with a ref:

```tsx
const chartsRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (view === 'org' && chartsRef.current && !loading) {
    chartsRef.current.scrollIntoView({ behavior: 'smooth' });
  }
}, [view, loading]);
```

Add `ref={chartsRef}` to the timeline charts section div.

- [ ] **Step 2: Build and test**

Run: `npm run build`

Test:
- `/report/[id]/org` — shows developer table at top (default)
- `/report/[id]/org?view=org` — auto-scrolls to charts section
- NavBar "Team Summary" links to `/report/[id]/org`
- NavBar "Org Summary" links to `/report/[id]/org?view=org`

- [ ] **Step 3: Commit**

```bash
git add "src/app/report/[id]/org/page.tsx"
git commit -m "feat(nav): add view param for team/org scroll on org page"
```

---

### Task 8: Final Cleanup and Testing

- [ ] **Step 1: Run full test suite**

Run: `npm test` — all tests must pass.

- [ ] **Step 2: Run production build**

Run: `rm -rf .next && npm run build` — must compile cleanly.

- [ ] **Step 3: Manual smoke test all navigation flows**

Test every nav flow:
1. Home → click "Team Summary" → org page with developer table
2. Team Summary → click developer row → dev detail with breadcrumb
3. Dev detail → click "Team Summary" in breadcrumb → back to org page
4. NavBar → click "Org Summary" → org page scrolled to charts
5. NavBar → click "Report History" → report list page
6. Report History → generate report → report runs
7. NavBar → click "Projects" → projects page
8. NavBar → click Settings icon → settings page
9. NavBar → click Profile avatar → profile page
10. Any page → click "Glooker" logo → home
11. No report exists → Team/Org Summary greyed out
12. Print/PDF on org and dev pages still works (NavBar has `no-print` class)

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Commit if any fixups needed**

```bash
git add -A
git commit -m "fix(nav): fixups from smoke testing"
```
