# Commit Tooltip Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a hover tooltip on the commits count in the developer table that lists the developer's individual commits (sha, message, repo, type).

**Architecture:** New API endpoint returns commits per developer per report. A pure-CSS-positioned tooltip component fetches on hover (with cache) and renders the commit list. No external tooltip libraries.

**Tech Stack:** Next.js API route, React useState/onMouseEnter, Tailwind CSS for positioning.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/report/[id]/commits/route.ts` | Create | API: return commit_analyses for a report+developer |
| `src/app/page.tsx` | Modify (~1059) | Replace static commits cell with `CommitCountWithTooltip` component |

---

## Chunk 1: API Endpoint + Tooltip Component

### Task 1: Create the commits API endpoint

**Files:**
- Create: `src/app/api/report/[id]/commits/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// src/app/api/report/[id]/commits/route.ts
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login');
  if (!login) {
    return NextResponse.json({ error: 'login is required' }, { status: 400 });
  }

  const [rows] = await db.execute(
    `SELECT commit_sha, repo, commit_message, type, complexity, risk_level,
            lines_added, lines_removed, committed_at
     FROM commit_analyses
     WHERE report_id = ? AND github_login = ?
     ORDER BY committed_at DESC`,
    [id, login],
  ) as [any[], any];

  return NextResponse.json(rows);
}
```

- [ ] **Step 2: Verify endpoint works**

Run: `npm run dev` then `curl 'http://localhost:3000/api/report/<ID>/commits?login=<LOGIN>'`
Expected: JSON array of commit objects (or empty array)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/report/\[id\]/commits/route.ts
git commit -m "feat: add commits-per-developer API endpoint"
```

### Task 2: Add CommitCountWithTooltip component to page.tsx

**Files:**
- Modify: `src/app/page.tsx:~1059` (the `{dev.total_commits}` cell)
- Modify: `src/app/page.tsx` (add component at bottom, add state)

- [ ] **Step 4: Add tooltip cache state to Home component**

Near the other `useState` declarations (~line 56), add:

```typescript
const commitCache = useRef<Map<string, any[]>>(new Map());
```

- [ ] **Step 5: Add the CommitCountWithTooltip component**

Add at the bottom of `page.tsx`, before the final closing:

```typescript
function CommitCountWithTooltip({
  count,
  reportId,
  login,
  cacheRef,
}: {
  count: number;
  reportId: string;
  login: string;
  cacheRef: React.RefObject<Map<string, any[]>>;
}) {
  const [commits, setCommits] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    setShow(true);
    const key = `${reportId}:${login}`;
    if (cacheRef.current!.has(key)) {
      setCommits(cacheRef.current!.get(key)!);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetch(`/api/report/${reportId}/commits?login=${login}`).then(r => r.json());
      cacheRef.current!.set(key, rows);
      setCommits(rows);
    } catch {
      setCommits([]);
    }
    setLoading(false);
  }

  function handleMouseLeave() {
    hideTimeout.current = setTimeout(() => setShow(false), 200);
  }

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <span className="text-gray-300 cursor-default underline decoration-dotted decoration-gray-600 underline-offset-4">
        {count}
      </span>
      {show && (
        <div
          className="absolute z-50 right-0 top-full mt-1 w-96 max-h-64 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 text-xs"
          onMouseEnter={() => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }}
          onMouseLeave={handleMouseLeave}
        >
          {loading && <p className="text-gray-500">Loading...</p>}
          {!loading && commits && commits.length === 0 && <p className="text-gray-500">No commits</p>}
          {!loading && commits && commits.length > 0 && (
            <table className="w-full">
              <tbody>
                {commits.map((c: any) => (
                  <tr key={c.commit_sha} className="border-b border-gray-700/50 last:border-0">
                    <td className="py-1.5 pr-2 font-mono text-blue-400 whitespace-nowrap">{c.commit_sha.slice(0, 7)}</td>
                    <td className="py-1.5 pr-2 text-gray-400 truncate max-w-[180px]" title={c.commit_message}>
                      {c.commit_message?.split('\n')[0]?.slice(0, 60) || '—'}
                    </td>
                    <td className="py-1.5 text-gray-600 whitespace-nowrap">{c.repo?.split('/')[1] || c.repo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Replace the static commits cell with the tooltip component**

In the developer table row (~line 1059), change:

```tsx
// FROM:
<td className="px-4 py-3 text-right text-gray-300">{dev.total_commits}</td>

// TO:
<td className="px-4 py-3 text-right">
  <CommitCountWithTooltip
    count={dev.total_commits}
    reportId={reportId || activeReport?.id || ''}
    login={dev.github_login}
    cacheRef={commitCache}
  />
</td>
```

- [ ] **Step 7: Verify tooltip works**

Run: `npm run dev`, open a completed report, hover over a commit count.
Expected: Tooltip appears with commit list after brief load, stays visible when mouse moves into tooltip, dismisses on mouse leave.

- [ ] **Step 8: Type check**

Run: `npx tsc --noEmit`
Expected: Clean compile, no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add commit list tooltip on hover over commits count"
```
