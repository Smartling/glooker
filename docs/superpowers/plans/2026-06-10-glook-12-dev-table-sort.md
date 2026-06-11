# GLOOK-12: Sortable Individuals Table

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-persisted clickable column sort to the Individuals developer table on the team report page, with absolute impact rank displayed when sorted by a non-impact column.

**Architecture:** Extract the inlined developer table IIFE from `page.tsx` into a new `dev-table.tsx` component (mirroring the existing `team-table.tsx` pattern). The new component owns `devsort`/`devdir` URL state, computes sort order client-side, and displays absolute impact rank when the active sort key is not `impact_score`. Helper subcomponents (`CommitCountWithTooltip`, `JiraCountWithTooltip`, badge components, `TypeBreakdown`) move to the new file.

**Tech Stack:** TypeScript, Next.js 15 (`'use client'`), `useUrlState` from `@/lib/url-state`, `useMemo`, `useRef`, `createPortal`

---

## File Map

| File | Change |
|---|---|
| `src/app/report/[id]/team/dev-table.tsx` | **Create** — full sortable developer table component |
| `src/app/report/[id]/team/page.tsx` | Remove IIFE + helper subcomponents; import and use `<DevTable>` |

---

### Task 1: Create `dev-table.tsx`

**Files:**
- Create: `src/app/report/[id]/team/dev-table.tsx`

**Context:** The developer table currently lives as an IIFE inside `page.tsx` (lines 403–523). `CommitCountWithTooltip` (lines 702–802), `JiraCountWithTooltip` (lines 804–869), and the badge/breakdown helpers (lines 635–700) also live in `page.tsx`. All of these move to the new file. `TYPE_COLORS` (line 52) also moves.

The new component:
- Exports `Developer` interface (so `page.tsx` can import it)
- Owns `devsort`/`devdir` URL state (keys distinct from TeamTable's `sort`/`dir`)
- Default sort: `impact_score` DESC (matches server order)
- `showAbsolute`: true when `filterLogins.size > 0 || effectiveSortKey !== 'impact_score'`
- `absoluteRanks` built from the full `developers` array (server = impact order)

- [ ] **Step 1: Create the file**

Create `src/app/report/[id]/team/dev-table.tsx` with this complete content:

```tsx
'use client';

import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useUrlState } from '@/lib/url-state';

export interface Developer {
  github_login:       string;
  github_name:        string;
  avatar_url:         string;
  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  avg_complexity:     number;
  impact_score:       number;
  pr_percentage:      number;
  ai_percentage:      number;
  total_jira_issues?: number;
  cc_total_cost?:     number;
  cc_requests?:       number;
  type_breakdown:     Record<string, number>;
  active_repos:       string[];
}

const TYPE_COLORS: Record<string, string> = {
  feature:  'bg-blue-500',
  bug:      'bg-red-500',
  refactor: 'bg-purple-500',
  infra:    'bg-yellow-500',
  docs:     'bg-gray-500',
  test:     'bg-green-500',
  other:    'bg-gray-600',
};

const DEV_SORT_KEYS = [
  'name', 'total_prs', 'total_commits', 'lines_added',
  'avg_complexity', 'pr_percentage', 'ai_percentage',
  'total_jira_issues', 'cc_total_cost', 'impact_score',
] as const;
type DevSortKey = typeof DEV_SORT_KEYS[number];

interface DevTableProps {
  developers:   Developer[];   // full list, server-sorted by impact DESC
  reportId:     string;
  org:          string;        // needed for commit URL links in tooltip
  filterLogins: Set<string>;
  canAct:       boolean;       // gates Spend column
}

export default function DevTable({ developers, reportId, org, filterLogins, canAct }: DevTableProps) {
  const router = useRouter();
  const commitCache = useRef<Map<string, any[]>>(new Map());
  const jiraCache   = useRef<Map<string, any[]>>(new Map());

  const hasJira  = developers.some(d => (d.total_jira_issues ?? 0) > 0);
  const hasSpend = canAct && developers.some(d => Number(d.cc_total_cost ?? 0) > 0);

  const [sortKey, setSortKey] = useUrlState<DevSortKey>({
    key: 'devsort',
    type: 'enum',
    values: DEV_SORT_KEYS,
    default: 'impact_score',
    history: 'replace',
  });
  const [sortDir, setSortDir] = useUrlState<'asc' | 'desc'>({
    key: 'devdir',
    type: 'enum',
    values: ['asc', 'desc'] as const,
    default: 'desc',
    history: 'replace',
  });

  // Fall back to impact_score if the active sort key's column is hidden
  const effectiveSortKey: DevSortKey =
    (!hasJira && sortKey === 'total_jira_issues') || (!hasSpend && sortKey === 'cc_total_cost')
      ? 'impact_score'
      : sortKey;

  // Build impact rank from server-sorted full list (impact order)
  const absoluteRanks = useMemo(() => {
    const map = new Map<string, number>();
    developers.forEach((d, idx) => map.set(d.github_login, idx + 1));
    return map;
  }, [developers]);

  const filteredDevs = useMemo(
    () => filterLogins.size > 0
      ? developers.filter(d => filterLogins.has(d.github_login))
      : developers,
    [developers, filterLogins],
  );

  const sortedDevs = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...filteredDevs].sort((a, b) => {
      if (effectiveSortKey === 'name') {
        return (a.github_name || a.github_login).localeCompare(b.github_name || b.github_login) * sign;
      }
      const av = Number(a[effectiveSortKey as keyof Developer] ?? 0);
      const bv = Number(b[effectiveSortKey as keyof Developer] ?? 0);
      if (av === bv) return (a.github_name || a.github_login).localeCompare(b.github_name || b.github_login);
      return (av - bv) * sign;
    });
  }, [filteredDevs, effectiveSortKey, sortDir]);

  const onSort = (key: DevSortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortCaret = (key: DevSortKey) =>
    effectiveSortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  // Show absolute impact rank when sort diverges from impact order, or filter is active
  const showAbsolute = filterLogins.size > 0 || effectiveSortKey !== 'impact_score';

  if (sortedDevs.length === 0) return null;

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
            <th className="px-4 py-3 w-[24%]">
              <button onClick={() => onSort('name')} className="hover:text-gray-300">
                Developer{sortCaret('name')}
              </button>
            </th>
            <th className="px-4 py-3 text-right w-[5%]">
              <button onClick={() => onSort('total_prs')} className="hover:text-gray-300">
                PRs{sortCaret('total_prs')}
              </button>
            </th>
            <th className="px-4 py-3 text-right w-[7%]">
              <button onClick={() => onSort('total_commits')} className="hover:text-gray-300">
                Commits{sortCaret('total_commits')}
              </button>
            </th>
            <th className="px-4 py-3 text-right w-[11%]">
              <button onClick={() => onSort('lines_added')} className="hover:text-gray-300">
                Lines +/-{sortCaret('lines_added')}
              </button>
            </th>
            <th className="px-4 py-3 text-right w-[7%]">
              <button onClick={() => onSort('avg_complexity')} className="hover:text-gray-300">
                Cmplx{sortCaret('avg_complexity')}
              </button>
            </th>
            <th className="px-4 py-3 text-right w-[5%]">
              <button onClick={() => onSort('pr_percentage')} className="hover:text-gray-300">
                PR%{sortCaret('pr_percentage')}
              </button>
            </th>
            <th className="px-4 py-3 text-right w-[5%]">
              <button onClick={() => onSort('ai_percentage')} className="hover:text-gray-300">
                AI%{sortCaret('ai_percentage')}
              </button>
            </th>
            {hasJira && (
              <th className="px-4 py-3 text-right w-[5%]">
                <button onClick={() => onSort('total_jira_issues')} className="hover:text-gray-300">
                  Jira{sortCaret('total_jira_issues')}
                </button>
              </th>
            )}
            {hasSpend && (
              <th className="px-4 py-3 text-right w-[7%]" title="Anthropic API spend (last uploaded period)">
                <button onClick={() => onSort('cc_total_cost')} className="hover:text-gray-300">
                  Spend{sortCaret('cc_total_cost')}
                </button>
              </th>
            )}
            <th className="px-4 py-3 w-[24%]">Types</th>
            <th
              className="px-4 py-3 text-right w-[7%]"
              title="Impact = Commits (2.0) + PRs (2.7) + Complexity (3.5) + PR% (1.1) + Jira (0.5) + Reviews (0.5). Max: 9.3"
            >
              <button onClick={() => onSort('impact_score')} className="hover:text-gray-300">
                Impact &#9432;{sortCaret('impact_score')}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedDevs.map((dev, i) => (
            <tr
              key={dev.github_login}
              className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
              onClick={() => router.push(`/report/${reportId}/dev/${dev.github_login}`)}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="text-gray-600 text-xs shrink-0 text-right tabular-nums"
                    style={{ minWidth: showAbsolute ? '3rem' : '1.25rem' }}
                    title={showAbsolute ? `#${i + 1} in current sort (impact rank: #${absoluteRanks.get(dev.github_login)})` : undefined}
                  >
                    {i + 1}
                    {showAbsolute && absoluteRanks.has(dev.github_login) && (
                      <span className="text-gray-700 ml-0.5">({absoluteRanks.get(dev.github_login)})</span>
                    )}
                  </span>
                  {dev.avatar_url && (
                    <img src={dev.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-white truncate">{dev.github_name || dev.github_login}</div>
                    <div className="text-xs text-gray-500 truncate">@{dev.github_login}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-gray-300">{dev.total_prs}</td>
              <td className="px-4 py-3 text-right">
                <CommitCountWithTooltip
                  count={dev.total_commits}
                  reportId={reportId}
                  login={dev.github_login}
                  org={org}
                  cacheRef={commitCache}
                />
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-green-400">+{dev.lines_added.toLocaleString()}</span>
                <span className="text-gray-600"> / </span>
                <span className="text-red-400">-{dev.lines_removed.toLocaleString()}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <ComplexityBadge value={dev.avg_complexity} />
              </td>
              <td className="px-4 py-3 text-right">
                <PrPercentBadge value={dev.pr_percentage} />
              </td>
              <td className="px-4 py-3 text-right">
                <AiPercentBadge value={dev.ai_percentage} />
              </td>
              {hasJira && (
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  {(dev.total_jira_issues ?? 0) > 0 ? (
                    <JiraCountWithTooltip
                      count={dev.total_jira_issues!}
                      reportId={reportId}
                      login={dev.github_login}
                      cacheRef={jiraCache}
                    />
                  ) : (
                    <span className="text-gray-600 text-sm">—</span>
                  )}
                </td>
              )}
              {hasSpend && (
                <td className="px-4 py-3 text-right">
                  {Number(dev.cc_total_cost ?? 0) > 0 ? (
                    <span className="text-green-400 font-mono text-sm">
                      ${(Number(dev.cc_total_cost) / 100).toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-gray-600 text-sm">—</span>
                  )}
                </td>
              )}
              <td className="px-4 py-3">
                <TypeBreakdown breakdown={dev.type_breakdown} />
              </td>
              <td className="px-4 py-3 text-right">
                <ImpactBadge value={dev.impact_score} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComplexityBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  const color = n >= 7 ? 'text-red-400' : n >= 4 ? 'text-yellow-400' : 'text-green-400';
  return <span className={`font-mono font-medium ${color}`}>{n.toFixed(1)}</span>;
}

function ImpactBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  const color = n >= 7 ? 'bg-accent-light' : n >= 4 ? 'bg-accent-dark' : 'bg-gray-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${color}`}>
      {n.toFixed(1)}
    </span>
  );
}

function AiPercentBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  if (n === 0) return <span className="text-gray-600 text-sm">—</span>;
  const color = n >= 50 ? 'text-purple-400' : 'text-purple-600';
  return <span className={`font-mono font-medium text-sm ${color}`}>{n}%</span>;
}

function PrPercentBadge({ value }: { value: number }) {
  const n = Number(value) || 0;
  const color = n >= 80 ? 'text-green-400' : n >= 50 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono font-medium text-sm ${color}`}>{n}%</span>;
}

function TypeBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([type, count]) => (
        <span
          key={type}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-white ${TYPE_COLORS[type] || 'bg-gray-600'}`}
        >
          {type} <span className="opacity-75">{count}</span>
        </span>
      ))}
    </div>
  );
}

function CommitCountWithTooltip({
  count, reportId, login, org, cacheRef,
}: {
  count: number; reportId: string; login: string; org: string;
  cacheRef: React.RefObject<Map<string, any[]>>;
}) {
  const [commits, setCommits] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean }>({ top: 0, left: 0, flipDown: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const flipDown = rect.top < 300;
      setPos({ top: flipDown ? rect.bottom + 8 : rect.top - 8, left: rect.right, flipDown });
    }
    setShow(true);
    const key = `${reportId}:${login}`;
    if (cacheRef.current!.has(key)) { setCommits(cacheRef.current!.get(key)!); return; }
    setLoading(true);
    try {
      const rows = await fetch(`/api/report/${reportId}/commits?login=${login}`).then(r => r.json());
      cacheRef.current!.set(key, rows);
      setCommits(rows);
    } catch { setCommits([]); }
    setLoading(false);
  }

  function handleMouseLeave() {
    hideTimeout.current = setTimeout(() => setShow(false), 200);
  }

  const tooltip = show && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed z-[9999] w-[420px] max-h-72 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-2xl text-xs text-left"
      style={{
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        transform: pos.flipDown ? 'translate(-100%, 0)' : 'translate(-100%, -100%)',
      }}
      onMouseEnter={() => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }}
      onMouseLeave={handleMouseLeave}
    >
      <div className="px-3 py-2 border-b border-gray-700 text-gray-400 font-medium">
        {count} commits by @{login}
      </div>
      <div className="p-2">
        {loading && <p className="text-gray-500 px-1 py-2">Loading...</p>}
        {!loading && commits && commits.length === 0 && <p className="text-gray-500 px-1 py-2">No commits</p>}
        {!loading && commits && commits.length > 0 && (
          <table className="w-full">
            <tbody>
              {commits.map((c: any) => (
                <tr key={c.commit_sha} className="border-b border-gray-700/30 last:border-0">
                  <td className="py-1.5 px-1 font-mono whitespace-nowrap align-top">
                    <a href={`https://github.com/${org}/${c.repo}/commit/${c.commit_sha}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter hover:underline">
                      {c.commit_sha.slice(0, 7)}
                    </a>
                  </td>
                  <td className="py-1.5 px-1 text-gray-400 align-top" style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.commit_message}>
                    {c.commit_message?.split('\n')[0]?.slice(0, 60) || '—'}
                  </td>
                  <td className="py-1.5 px-1 text-gray-600 whitespace-nowrap align-top">
                    {c.repo?.split('/')[1] || c.repo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <span className="inline-block" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <span ref={triggerRef} className="text-gray-300 cursor-default underline decoration-dotted decoration-gray-600 underline-offset-4">
        {count}
      </span>
      {tooltip}
    </span>
  );
}

function JiraCountWithTooltip({
  count, reportId, login, cacheRef,
}: {
  count: number; reportId: string; login: string;
  cacheRef: React.RefObject<Map<string, any[]>>;
}) {
  const [issues, setIssues] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean }>({ top: 0, left: 0, flipDown: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const flipDown = rect.top < 300;
      setPos({ top: flipDown ? rect.bottom + 8 : rect.top - 8, left: rect.right, flipDown });
    }
    setShow(true);
    const key = `jira:${reportId}:${login}`;
    if (cacheRef.current!.has(key)) { setIssues(cacheRef.current!.get(key)!); return; }
    setLoading(true);
    try {
      const rows = await fetch(`/api/report/${reportId}/jira-issues?login=${login}`).then(r => r.json());
      cacheRef.current!.set(key, rows);
      setIssues(rows);
    } catch { setIssues([]); }
    setLoading(false);
  }

  function handleMouseLeave() {
    hideTimeout.current = setTimeout(() => setShow(false), 200);
  }

  const tooltip = show && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed z-[9999] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-3 w-80 max-h-60 overflow-y-auto text-sm"
      style={{
        top: pos.flipDown ? pos.top : undefined,
        bottom: pos.flipDown ? undefined : `${window.innerHeight - pos.top}px`,
        left: Math.max(pos.left - 320, 8),
      }}
      onMouseEnter={() => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }}
      onMouseLeave={handleMouseLeave}
    >
      {loading && <div className="text-gray-500 text-xs py-2">Loading...</div>}
      {issues && issues.length === 0 && <div className="text-gray-500 text-xs py-2">No issues found</div>}
      {issues && issues.map((issue: any) => (
        <a
          key={issue.issue_key}
          href={issue.issue_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block py-1.5 px-2 hover:bg-gray-800 rounded"
        >
          <span className="text-accent-light font-mono text-xs">{issue.issue_key}</span>
          <span className="text-gray-400 ml-2 text-xs">{issue.summary?.slice(0, 50)}</span>
        </a>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <span className="inline-block" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <span ref={triggerRef} className="text-accent cursor-pointer underline decoration-dotted decoration-accent/40 underline-offset-4">
        {count}
      </span>
      {tooltip}
    </span>
  );
}
```

- [ ] **Step 2: Run the test suite to confirm TypeScript compiles**

```bash
npm test --no-coverage 2>&1 | tail -8
```

Expected: All tests pass (no TypeScript errors in the new file — it hasn't been imported yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/report/\[id\]/team/dev-table.tsx
git commit -m "feat(glook-12): add DevTable component with sortable columns"
```

---

### Task 2: Update `page.tsx` to use DevTable

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`

**Context:** After this task:
- `Developer` interface is imported from `./dev-table` (removed from page)
- `TYPE_COLORS` constant is removed from page
- `commitCache` and `jiraCache` refs are removed from `TeamSummaryPage`
- The developer table IIFE (lines 403–523) is replaced with `<DevTable ... />`
- Helper functions that moved to `dev-table.tsx` are removed: `ComplexityBadge`, `ImpactBadge`, `AiPercentBadge`, `PrPercentBadge`, `TypeBreakdown`, `CommitCountWithTooltip`, `JiraCountWithTooltip`
- `createPortal` import is removed (only used in moved tooltip components)
- `useRef` is removed from the React import (no longer used in page)

`TeamPulseCard` and `renderPulseMarkdown` stay in `page.tsx`.

- [ ] **Step 1: Update imports at the top of `page.tsx`**

Change the import block from:

```typescript
import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { createPortal } from 'react-dom';
import ChatPanel from '@/app/chat-panel';
import { useAuth } from '@/app/auth-context';
import { useUrlState, useUrlBatch } from '@/lib/url-state';
import TeamTable from './team-table';
import ProjectsCard from '@/components/ProjectsCard';
import IntegrityBadge from '@/components/IntegrityBadge';
import type { TeamProject } from '@/lib/team-pulse/types';
import type { RunMetadata } from '@/lib/report-runner/types';

interface Developer {
  github_login:       string;
  github_name:        string;
  avatar_url:         string;
  total_prs:          number;
  total_commits:      number;
  lines_added:        number;
  lines_removed:      number;
  avg_complexity:     number;
  impact_score:       number;
  pr_percentage:      number;
  ai_percentage:      number;
  total_jira_issues?: number;
  cc_total_cost?:     number;
  cc_requests?:       number;
  type_breakdown:     Record<string, number>;
  active_repos:       string[];
}
```

to:

```typescript
import { useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import ChatPanel from '@/app/chat-panel';
import { useAuth } from '@/app/auth-context';
import { useUrlState, useUrlBatch } from '@/lib/url-state';
import TeamTable from './team-table';
import DevTable from './dev-table';
import type { Developer } from './dev-table';
import ProjectsCard from '@/components/ProjectsCard';
import IntegrityBadge from '@/components/IntegrityBadge';
import type { TeamProject } from '@/lib/team-pulse/types';
import type { RunMetadata } from '@/lib/report-runner/types';
```

Also remove `useRouter` from the component body (it's only used in the IIFE being deleted):

```typescript
  // DELETE this line from TeamSummaryPage:
  const router = useRouter();
```

- [ ] **Step 2: Remove `TYPE_COLORS` and cache refs from `TeamSummaryPage`**

Remove the `TYPE_COLORS` constant (lines 52–60 — the block that defines the `Record<string, string>` mapping).

Inside `TeamSummaryPage`, remove the two `useRef` lines:

```typescript
  const commitCache = useRef<Map<string, any[]>>(new Map());
  const jiraCache   = useRef<Map<string, any[]>>(new Map());
```

- [ ] **Step 3: Replace the developer table IIFE with `<DevTable>`**

Find the developer table block:

```tsx
      {/* Developer table */}
      {(() => {
        const filteredDevs = filterLogins.size > 0 ? developers.filter(d => filterLogins.has(d.github_login)) : developers;
        const hasJira = developers.some(d => (d.total_jira_issues ?? 0) > 0);
        const hasSpend = canAct && developers.some(d => Number(d.cc_total_cost ?? 0) > 0);
        // Absolute rank across the full server-sorted developer list — shown
        // alongside the filter-relative rank so users can still see where a
        // developer sits across the whole team even when filtered down.
        const absoluteRanks = new Map<string, number>();
        developers.forEach((d, idx) => absoluteRanks.set(d.github_login, idx + 1));
        const showAbsolute = filterLogins.size > 0;
        return filteredDevs.length > 0 && (
        <div className="bg-gray-900 rounded-xl overflow-hidden">
```

(this block runs through to the closing `})()}` around line 523)

Replace the entire IIFE block with:

```tsx
      {/* Developer table */}
      <DevTable
        developers={developers}
        reportId={params.id}
        org={activeReport?.org ?? ''}
        filterLogins={filterLogins}
        canAct={canAct}
      />
```

- [ ] **Step 4: Remove moved helper functions from the bottom of `page.tsx`**

Delete these function declarations (they now live in `dev-table.tsx`):
- `function ComplexityBadge(...)` and its body
- `function ImpactBadge(...)` and its body
- `function AiPercentBadge(...)` and its body
- `function PrPercentBadge(...)` and its body
- `function TypeBreakdown(...)` and its body
- `function CommitCountWithTooltip(...)` and its entire body (including the portal JSX)
- `function JiraCountWithTooltip(...)` and its entire body (including the portal JSX)

Keep: `TeamPulseCard`, `renderPulseMarkdown`.

Also remove the closing `}` of `JiraCountWithTooltip` and any trailing code after it (the last function in the file). The file should end after the last closing `}` of whichever function is last.

- [ ] **Step 5: Run the test suite**

```bash
npm test --no-coverage 2>&1 | tail -8
```

Expected: All tests pass.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v " 2\.ts"
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/report/\[id\]/team/page.tsx
git commit -m "feat(glook-12): wire DevTable into team page, remove inlined table IIFE"
```
