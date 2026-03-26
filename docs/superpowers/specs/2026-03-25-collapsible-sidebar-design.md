# Collapsible Reports Sidebar

**Date:** 2026-03-25
**Status:** Approved

## Problem

The reports sidebar on the landing page occupies 240px + 32px gap = 272px of horizontal space permanently. This reduces the main content area (developer table, progress, logs) unnecessarily, especially since users spend most of their time viewing report data, not switching between reports.

## Solution

Replace the fixed-width sidebar with a collapsible sidebar that defaults to a compact 52px icon strip. Users can expand it to the full 240px sidebar when needed. State is persisted via localStorage.

## Collapsed State (Default)

A 52px-wide vertical strip containing, top to bottom:

1. **Toggle button** — a `›` arrow in a rounded box. Clicking expands the sidebar.
2. **"+ New" button** — a dashed-border box with a `+` icon. Opens the new report form.
3. **Report date cards** — one per report, stacked vertically with 6px gap. Each card is 36px wide with:
   - Status-colored left border (2px): amber for completed, red for failed, orange for stopped, lighter amber for running, gray for pending.
   - Three-line text stack: month abbreviation (9px, gray), day number (10px, white, bold), time in compact format like "2:30p" (7px, dim gray).
   - Active report indicated with an outline matching the status color.
   - **Hover tooltip** showing full details: org name, status, period (days), full timestamp.
   - **Click** loads the report (same as current sidebar behavior).

## Expanded State

The current 240px sidebar, unchanged except:

- The "REPORTS" header area gets a `‹` collapse arrow (replacing or alongside the label).
- Clicking the collapse arrow returns to the collapsed strip.
- All existing functionality preserved: report list, status badges, delete on hover, resume button, "+ New" button.

## Behavior

| Aspect | Detail |
|--------|--------|
| Default state | Collapsed (52px) |
| Persistence | localStorage key (e.g., `glooker-sidebar-expanded`) |
| Toggle | Click arrow to expand/collapse |
| Animation | Smooth width transition (CSS `transition: width`) |
| Report click (collapsed) | Loads report, stays collapsed |
| Report click (expanded) | Loads report, stays expanded (same as today) |
| "+ New" (collapsed) | Opens new report form modal |
| Hover tooltip (collapsed) | Shows org, status, period, full timestamp |
| Print | Sidebar hidden entirely (existing `no-print` class) |

## Layout Changes

- The outer flex container changes from `w-60 shrink-0` to a dynamic width (52px or 240px).
- The `gap-8` (32px) between sidebar and main content can be reduced to `gap-4` (16px) when collapsed, or kept consistent.
- Main content area (`flex-1`) automatically fills the freed space.

## Component Structure

The sidebar remains inline in `page.tsx` (no need to extract a separate component for this scope). The changes are:

1. Add `sidebarExpanded` state, initialized from localStorage (default `false`).
2. Persist to localStorage on toggle.
3. Conditionally render collapsed strip vs expanded sidebar based on state.
4. Add CSS transition on the sidebar wrapper's width.
5. Add tooltip component/title attribute for collapsed cards.

## Out of Scope

- Responsive/mobile behavior (existing page is desktop-focused)
- Keyboard shortcuts for toggle
- Drag-to-resize sidebar
- Extracting sidebar into a separate component file
