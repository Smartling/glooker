# Navigation Redesign — Design Spec

## Overview

Rework navigation across all Glooker pages to be consistent. Replace per-page ad-hoc headers with a shared top navigation bar. Add breadcrumbs for drill-down pages. Reorganize the home page into a dashboard and move report management to a dedicated "Report History" page.

## Navigation Bar

A shared `NavBar` component rendered in the root layout, present on every page.

### Layout

```
[G]looker    Home   Team Summary Apr 13   Org Summary Apr 13   Report History   Projects        ⚙  [avatar]
```

- **Left:** Logo — clickable, always navigates to Home (`/`)
- **Center:** Primary nav items with active state highlighting
- **Right:** Settings icon (`/settings`) + Profile avatar (`/profile`), separated from primary nav

### Primary Nav Items

| Label | URL | Source |
|-------|-----|--------|
| Home | `/` | Static |
| Team Summary _date_ | `/report/[latest-id]/dev` (current dev table on org page) | Latest completed report |
| Org Summary _date_ | `/report/[latest-id]/org` | Latest completed report |
| Report History | `/reports` | Static (new route) |
| Projects | `/projects` | Static, hidden when `!jiraProjectsEnabled` |

The date shown next to Team/Org Summary is the latest completed report's `created_at`, formatted as `Mon DD` (e.g., `Apr 13`). When no completed report exists, these items are greyed out and not clickable.

### Active State

The currently active nav item is highlighted (indigo background, bold text). The mapping:

| Page | Highlighted item |
|------|-----------------|
| `/` | Home |
| `/report/[id]/org` | Org Summary |
| `/report/[id]/dev/[login]` | Team Summary |
| `/reports` | Report History |
| `/projects` | Projects |
| `/settings` | Settings icon |
| `/profile` | Profile avatar |

The Team Summary page itself (the developer ranked table) is currently rendered as part of the org report page. It needs to be split out to its own route or the org page needs to render only charts when accessed as "Org Summary". See Page Changes section below.

### Drill-Down Breadcrumbs

Breadcrumbs appear below the nav bar only on drill-down pages (not on top-level pages). They show the navigation path and are clickable.

| Page | Breadcrumb |
|------|-----------|
| Developer detail (`/report/[id]/dev/[login]`) | `Team Summary / @login` |
| All top-level pages | No breadcrumb |

### Implementation

Create `src/components/nav-bar.tsx` as a client component:
- Reads current pathname via `usePathname()` to determine active item
- Fetches latest completed report ID and date from `/api/report?latest=true` (new lightweight endpoint, or use existing data)
- Fetches feature flags from `/api/llm-config` (for Projects visibility)
- Uses `useAuth()` for profile avatar and Settings visibility
- Uses Next.js `Link` for all navigation (no `window.location.href` or `router.push`)

Create `src/components/breadcrumb.tsx`:
- Receives `items: { label: string; href?: string }[]` as props
- Last item is not a link (current page)

Add `NavBar` to `src/app/layout.tsx` so it renders on every page. Remove per-page headers, back buttons, and navigation elements from all page components.

## Page Changes

### Home (`/`)

Currently: Report list + report generation form + developer table from latest report.

Becomes a **dashboard** with:
- **Report summary** — highlights from the latest completed report (total developers, commits, top movers, key changes vs previous report)
- **Projects summary** — high-level status from the Projects page (epics in progress count, completion %)
- **How Impact Score Works** — the formula explanation widget (currently on this page, stays)

Report generation and report list move to Report History.

### Report History (`/reports` — new route)

New page containing what's currently on the home page:
- Report list (past reports with status, date, org)
- Report generation form (+ New Report button, org selector, period selector)
- Delete/resume report controls
- Schedule management link

This is essentially the current home page minus the dashboard content.

### Team Summary (`/report/[id]/org` — reuse existing route)

Currently the org report page contains both the developer ranked table AND the org-level charts. The developer table is what "Team Summary" links to.

Approach: The current org page already shows the developer table at the top and charts below. Keep the route as-is — "Team Summary" and "Org Summary" both link to `/report/[id]/org` but the page now has two tabs controlled by which nav item was clicked (or URL parameter):
- `/report/[id]/org?view=team` — scrolls to / highlights the developer table (default for Team Summary nav click)
- `/report/[id]/org?view=org` — scrolls to / highlights the charts section (default for Org Summary nav click)

Alternatively, the simpler approach: both nav items link to the same page, with the nav bar highlighting the correct one based on the URL parameter. The page content stays as-is (table + charts together).

### Org Summary

Same route as Team Summary — `/report/[id]/org?view=org`. See above.

### Developer Detail (`/report/[id]/dev/[login]`)

- Remove the custom header (back button, "Glooker" logo)
- NavBar shows with "Team Summary" highlighted
- Breadcrumb: `Team Summary / @login`
- Remove print-specific header (NavBar handles home navigation)

### Projects (`/projects`)

- Remove "← Back to Dashboard" link
- NavBar shows with "Projects" highlighted
- No breadcrumb (top-level page)

### Settings (`/settings`)

- Remove custom "Glooker" header
- NavBar shows with Settings icon highlighted
- No breadcrumb (top-level page)

### Profile (`/profile`)

- Remove custom back button
- NavBar shows with Profile avatar highlighted
- No breadcrumb (top-level page)

## Responsive Behavior

On narrow screens (< 768px), the nav bar collapses primary items into a hamburger menu. Logo and Settings/Profile remain visible. This is a future enhancement — for now, the nav bar scrolls horizontally on small screens.

## Navigation Method

Standardize all navigation to use Next.js `<Link>` components. Remove all instances of:
- `window.location.href = '...'`
- `router.push('...')`
- `router.back()`

Exception: external links (GitHub, Jira) continue to use `<a>` with `target="_blank"`.

## Latest Report Resolution

The nav bar needs to know the latest completed report ID to construct Team/Org Summary links. Options:

**Approach:** Add a lightweight API endpoint or extend the existing `/api/llm-config` response to include `latestReportId` and `latestReportDate`. The NavBar fetches this once on mount and caches it. When a new report completes, the home page can trigger a refresh.

Extend `/api/llm-config` response:
```typescript
{
  ...existingConfig,
  latestReport: {
    id: string;
    date: string;      // formatted date for display
    org: string;
  } | null
}
```

## Files Changed

| File | Change |
|------|--------|
| Create `src/components/nav-bar.tsx` | Shared navigation bar component |
| Create `src/components/breadcrumb.tsx` | Breadcrumb component for drill-down pages |
| Create `src/app/reports/page.tsx` | New Report History page (moved from home) |
| Modify `src/app/layout.tsx` | Add NavBar to root layout |
| Modify `src/app/page.tsx` | Rework into dashboard (remove report list/generation) |
| Modify `src/app/report/[id]/org/page.tsx` | Remove custom header, add view param support |
| Modify `src/app/report/[id]/dev/[login]/page.tsx` | Remove custom header, add breadcrumb |
| Modify `src/app/projects/projects-content.tsx` | Remove back-to-dashboard link |
| Modify `src/app/settings/page.tsx` | Remove custom header |
| Modify `src/app/profile/profile-content.tsx` | Remove back button |
| Modify `src/app/api/llm-config/route.ts` | Add latestReport to response |
| Modify `src/lib/app-config/service.ts` | Add latestReport query |

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Nav position | Top horizontal bar | Full width for data-dense tables/charts |
| Unavailable items | Grey out, always show | Users know what's available before first report |
| Drill-down behavior | Parent stays highlighted + breadcrumb | Clear hierarchy without losing nav context |
| Team/Org split | Same route with view param | Avoids duplicating page logic; both views share the same report data |
| Home page | Dashboard with latest report summary + projects + formula | Report management moves to Report History |
| Navigation method | Next.js Link everywhere | Consistent, enables client-side navigation, removes mixed patterns |
| Latest report in nav | Extend /api/llm-config response | Single fetch, already consumed by pages for feature flags |
