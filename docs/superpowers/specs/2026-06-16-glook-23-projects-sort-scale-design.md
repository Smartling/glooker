# GLOOK-23: Projects Card — Sort by Volume + Visual Scale Bar

## Goal

Sort project cards by meaningful output (PRs + Jiras) and add a visual volume bar so users can instantly read project size and composition without scanning numbers.

## Problem

The home-page and team-page "Current Projects" cards currently render projects in LLM-output order with only text counters (`5 jiras · ~30 commits · ~12 PRs`). There is no visual hierarchy, and commit counts visually dominate even though commits are squashed into PRs and are a lower-signal metric.

## Design (validated with live Smartling data in visual companion)

### Sorting

Sort projects by **PRs + Jiras** descending (meaningful shipped output). Commits are excluded from the sort key because individual commits collapse into PRs — using commit count would inflate commit-heavy, low-PR projects like the Salesforce CC project, which had 116 commits but only 8 PRs and 9 Jiras.

### Volume Bar

Each project row gets a horizontal bar immediately below the stats line:

```
[cyan: PRs][purple: Jiras][ghost: Commits]
|←————— bar width = total / max_total ——————→|    ←— gray track (100%)
```

- **Track** (background): full width, `rgba(255,255,255,0.05)`, `6px` tall, rounded
- **Fill** (foreground): `width = (estimated_prs + jira_count + estimated_commits) / maxVolume * 100%`
  - Max is computed client-side from the full `projects` array before rendering
- **Segments** inside fill (using CSS `flex` with raw counts as flex values):
  - PRs → `#06B6D4` (cyan)
  - Jiras → `#A855F7` (purple)
  - Commits → `rgba(255,255,255,0.10)` (ghost — visible context, not dominant)
- Segment order: PRs → Jiras → Commits (bright metrics first, ghost last)

### Effect on real data (Salesforce CC example)

With the old order, Salesforce CC ranked #2 (116 commits). With PRs+Jiras sort it ranks #8 (8 PRs, 9 Jiras). Its bar is 50% wide (total volume still significant) but the ghost section visually dominates — immediately communicating "this project is commit-heavy with little shipped output." No text change required; the visual explains itself.

---

## Architecture

**One file changed: `src/components/ProjectsCard.tsx`**

The `ProjectsBody` subcomponent receives `projects: ProjectsCardItem[] | TeamProject[]`. Both interfaces already have `jira_count`, `estimated_commits`, `estimated_prs`.

Changes inside `ProjectsBody`:
1. Sort the incoming `projects` array by `(p.estimated_prs + p.jira_count)` DESC before rendering.
2. Compute `maxVolume = Math.max(...projects.map(p => p.estimated_prs + p.jira_count + p.estimated_commits), 1)`.
3. For each project row, add the bar after the stats line and before the summary.

```tsx
// Sort by PRs + Jiras
const sorted = [...projects].sort((a, b) =>
  (b.estimated_prs + b.jira_count) - (a.estimated_prs + a.jira_count)
);
const maxVolume = Math.max(...sorted.map(p =>
  p.estimated_prs + p.jira_count + p.estimated_commits
), 1);

// Inside the map:
const totalVol = p.estimated_prs + p.jira_count + p.estimated_commits;
const barWidth = (totalVol / maxVolume) * 100;
// Render bar with flex segments: flex={p.estimated_prs}, flex={p.jira_count}, flex={p.estimated_commits}
```

This applies to **both surfaces** (home page and team page) because both use `ProjectsCard` / `ProjectsBody`.

---

## Legend

No separate legend component needed. The `ProjectsCard` header area (or a small inline legend below the title) shows:
- `■ PRs  ■ Jiras  ░ Commits`

Position: a single line of 10px text added to the `ProjectsBody` before the list, only when `projects.length > 0`.

---

## Tests

No unit tests needed — `ProjectsCard` is a pure UI component with no existing test coverage. The sort logic is a one-liner `useMemo` or inline sort; correctness is verified by visual inspection against the live app.

---

## Files Changed

| File | Change |
|---|---|
| `src/components/ProjectsCard.tsx` | Sort by PRs+Jiras; add volume bar with ghost commits; add legend |
