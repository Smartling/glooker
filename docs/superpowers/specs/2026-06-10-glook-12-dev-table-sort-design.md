# GLOOK-12: Sortable Individuals Table in Team Report

## Goal

Add clickable column-sort to the Individuals developer table on the team report page, with URL-persisted sort state and absolute impact rank display when sorting by a non-impact column.

## Architecture

Extract the inlined developer table from `src/app/report/[id]/team/page.tsx` into a new `dev-table.tsx` component that owns its own sort state — mirroring the existing `team-table.tsx` pattern. No API changes needed; all sorting is client-side over the already-fetched `developers` array.

---

## Files

| File | Change |
|---|---|
| `src/app/report/[id]/team/dev-table.tsx` | **Create** — self-contained sortable developer table |
| `src/app/report/[id]/team/page.tsx` | Remove developer table IIFE + `JiraIssuesPopover`; import `DevTable`; import `Developer` type |

---

## Component: `DevTable`

### Props

```typescript
interface DevTableProps {
  developers: Developer[];  // full server-sorted list (impact DESC) — used to build absoluteRanks
  reportId: string;
  filterLogins: Set<string>;
  canAct: boolean;          // gates Spend column visibility
}
```

### Developer interface

Moved from `page.tsx` to `dev-table.tsx` (exported so `page.tsx` can import it):

```typescript
export interface Developer {
  github_login: string; github_name: string; avatar_url: string;
  total_prs: number; total_commits: number; lines_added: number; lines_removed: number;
  avg_complexity: number; impact_score: number; pr_percentage: number; ai_percentage: number;
  type_breakdown: Record<string, number>; active_repos: string[];
  total_jira_issues?: number;
  cc_total_cost?: number;
  cc_requests?: number;
}
```

### Sort state (URL-persisted)

```typescript
const DEV_SORT_KEYS = [
  'name', 'total_prs', 'total_commits', 'lines_added',
  'avg_complexity', 'pr_percentage', 'ai_percentage',
  'total_jira_issues', 'cc_total_cost', 'impact_score',
] as const;
type DevSortKey = typeof DEV_SORT_KEYS[number];
```

URL keys `devsort` (default: `'impact_score'`) and `devdir` (default: `'desc'`) — distinct from the Teams table's `sort`/`sortDir` to avoid collision.

`effectiveSortKey` fallback: if `hasJira` is false and `devsort === 'total_jira_issues'`, or `hasSpend` is false and `devsort === 'cc_total_cost'`, fall back to `'impact_score'`.

### Internal logic

1. Compute `hasJira = developers.some(d => (d.total_jira_issues ?? 0) > 0)`
2. Compute `hasSpend = canAct && developers.some(d => Number(d.cc_total_cost ?? 0) > 0)`
3. Build `absoluteRanks: Map<string, number>` from `developers` (server order = impact rank)
4. Compute `filteredDevs` from `filterLogins`
5. Sort `filteredDevs` in `useMemo` using `effectiveSortKey` and `devdir`
   - `'name'` → `localeCompare`
   - all other keys → numeric comparison

### Absolute rank display

```typescript
const showAbsolute = filterLogins.size > 0 || effectiveSortKey !== 'impact_score';
```

When `showAbsolute` is true, the rank cell renders:
```
3 (7)
```
where `3` is the current sort rank and `(7)` is the absolute impact rank — matching the existing filtered-view behavior exactly.

### Column headers

Each `<th>` becomes a `<button onClick={() => onSort(key)}>` with `▼`/`▲` caret when active — same pattern as `team-table.tsx`. Clicking an already-active column toggles direction; clicking a new column sets it and defaults to `desc` (or `asc` for `name`).

### JiraIssuesPopover

Moved from `page.tsx` to `dev-table.tsx` (used only by this component).

---

## page.tsx changes

- Import `Developer` from `./dev-table`
- Replace the developer table IIFE with:
  ```tsx
  <DevTable
    developers={developers}
    reportId={params.id}
    filterLogins={filterLogins}
    canAct={canAct}
  />
  ```
- Remove `absoluteRanks`, `showAbsolute` declarations (now internal to `DevTable`)

---

## Tests

No new unit tests needed — `DevTable` is a pure UI component with no business logic beyond the sorting comparator. The sort logic is the same `localeCompare` / numeric pattern already used in `team-table.tsx` and covered by the existing integration test posture. If a unit test is added in the future, the comparator can be extracted as a pure function.
