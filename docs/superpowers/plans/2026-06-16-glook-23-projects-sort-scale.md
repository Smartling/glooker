# GLOOK-23: Projects Card Sort + Volume Bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort project cards by PRs+Jiras and add a segmented volume bar so users can instantly read project size and composition.

**Architecture:** Single-file change to `src/components/ProjectsCard.tsx`. Inside `ProjectsBody`, sort the incoming array by `(estimated_prs + jira_count)` DESC, compute `maxVolume` across all projects, add a one-line legend before the list, and insert a `6px` segmented bar between the stats row and the summary text. Both the home-page (standalone) and team-page (collapsible) surfaces use the same `ProjectsBody` component and get the change automatically.

**Tech Stack:** React, TypeScript, Tailwind CSS. No new dependencies.

---

## File Map

| File | Change |
|---|---|
| `src/components/ProjectsCard.tsx` | Sort by PRs+Jiras; add `maxVolume` computation; add legend; add volume bar per row |

---

### Task 1: Add sort, legend, and volume bar to `ProjectsBody`

**Files:**
- Modify: `src/components/ProjectsCard.tsx:45-113`

**Context:** `ProjectsBody` receives `projects: ProjectsCardItem[] | TeamProject[]`. Both interfaces already have `jira_count`, `estimated_commits`, and `estimated_prs`. The function currently renders projects in the order they arrive (LLM output order). After this change:

1. Projects are sorted by `estimated_prs + jira_count` DESC before rendering.
2. `maxVolume = max(estimated_prs + jira_count + estimated_commits)` computed once across all sorted projects.
3. A small legend (`PRs · Jiras · Commits`) appears before the list.
4. Each project row gets a `6px` tall bar inserted between the stats line and the summary text. Bar width = `(estimated_prs + jira_count + estimated_commits) / maxVolume * 100%`. Inside the bar three flex segments: PRs (cyan), Jiras (purple), Commits (ghost).

No tests exist for this component — verify visually against the running app.

- [ ] **Step 1: Replace the `ProjectsBody` function with the updated version**

Find and replace the entire `ProjectsBody` function (lines 45–114 in the current file). The new version:

```tsx
function ProjectsBody({
  projects,
  loading,
  emptyMessage,
  developerHref,
  variant,
}: {
  projects: ProjectsCardItem[] | TeamProject[];
  loading?: boolean;
  emptyMessage: string;
  developerHref?: (login: string) => string;
  variant: 'standalone' | 'collapsible';
}) {
  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 text-sm ${variant === 'collapsible' ? 'py-6 justify-center' : 'mt-3'}`}>
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Analyzing projects…
      </div>
    );
  }
  if (projects.length === 0) {
    return <p className={`text-sm text-gray-500 ${variant === 'collapsible' ? 'py-4' : 'mt-2'}`}>{emptyMessage}</p>;
  }

  // Sort by meaningful output (PRs + Jiras). Commits are squashed into PRs so
  // using raw commit count would inflate commit-heavy, low-PR projects.
  const sorted = [...projects].sort(
    (a, b) => (b.estimated_prs + b.jira_count) - (a.estimated_prs + a.jira_count),
  );

  // Max total volume across all projects — used to normalise bar widths.
  const maxVolume = Math.max(
    ...sorted.map(p => p.estimated_prs + p.jira_count + p.estimated_commits),
    1,
  );

  return (
    <div className={`space-y-3 ${variant === 'collapsible' ? 'mt-3' : 'mt-4'}`}>
      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-gray-600 pl-6">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: '#06B6D4' }} />PRs
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: '#A855F7' }} />Jiras
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: 'rgba(255,255,255,0.18)' }} />Commits
        </span>
      </div>

      {sorted.map((p, i) => {
        const ago = timeAgo((p as TeamProject).last_activity);
        const totalVol = p.estimated_prs + p.jira_count + p.estimated_commits;
        const barPct = (totalVol / maxVolume) * 100;
        return (
          <div key={i} className="bg-white/[0.02] rounded-lg p-3">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-600 w-4 shrink-0 text-right">{i + 1}</span>
                <span className="text-sm font-semibold text-white">{p.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[11px] text-gray-500">
                <span>{p.jira_count} jiras</span>
                <span>~{p.estimated_commits} commits</span>
                <span>~{p.estimated_prs} PRs</span>
                {ago && <span className="text-gray-600">· {ago}</span>}
              </div>
            </div>

            {/* Volume bar: width = total / max, segments = PRs (cyan) + Jiras (purple) + Commits (ghost) */}
            <div className="pl-6 mb-1.5">
              <div className="h-[5px] rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="h-full flex" style={{ width: `${barPct}%` }}>
                  <div style={{ flex: p.estimated_prs, background: '#06B6D4' }} />
                  <div style={{ flex: p.jira_count, background: '#A855F7' }} />
                  <div style={{ flex: p.estimated_commits, background: 'rgba(255,255,255,0.10)' }} />
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 pl-6 mb-1.5">{p.summary}</p>
            <div className="flex gap-1 pl-6 flex-wrap">
              {p.developers.map(d =>
                developerHref ? (
                  <a
                    key={d}
                    href={developerHref(d)}
                    className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                  >@{d}</a>
                ) : (
                  <span
                    key={d}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                  >@{d}</span>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test --no-coverage
```

Expected: All tests pass (no changes to logic or data — pure UI addition).

- [ ] **Step 3: Start the dev server and verify visually**

```bash
npm run dev
```

Open the home page and check:
- Projects are sorted by PRs+Jiras (largest first, not LLM output order)
- A small legend appears: `■ PRs  ■ Jiras  ░ Commits`
- Each project has a `5px` bar between the stats and summary
- Bar widths differ — the largest project fills 100%, others are proportionally shorter
- Segment colours: cyan (PRs), purple (Jiras), near-invisible ghost (Commits)
- Commit-heavy projects (low PRs/Jiras) rank lower and have large ghost tails

Also open the team page and expand a Current Projects card — same visual should appear.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProjectsCard.tsx
git commit -m "feat(glook-23): sort projects by PRs+Jiras, add segmented volume bar"
```
