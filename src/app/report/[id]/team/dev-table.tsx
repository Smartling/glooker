'use client';

import { useState, useRef, useMemo, useEffect, type RefObject } from 'react';
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
  /** Full developer list. MUST be ordered by impact_score DESC (server sort order) —
   *  absoluteRanks derives position numbers from this array index. */
  developers:   Developer[];
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
                Lines +{sortCaret('lines_added')}
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
  cacheRef: RefObject<Map<string, any[]>>;
}) {
  const [commits, setCommits] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean }>({ top: 0, left: 0, flipDown: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }, []);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const flipDown = rect.top < 300;
      setPos({ top: flipDown ? rect.bottom + 8 : rect.top - 8, left: rect.right, flipDown });
    }
    setShow(true);
    const key = `${reportId}:${login}`;
    if (cacheRef.current!.has(key)) { setCommits(cacheRef.current!.get(key)!); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/report/${reportId}/commits?login=${encodeURIComponent(login)}`);
      if (!res.ok) throw new Error(res.statusText);
      const rows = await res.json();
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
              {commits.map((c: any, i: number) => (
                <tr key={c.commit_sha ?? i} className="border-b border-gray-700/30 last:border-0">
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
  cacheRef: RefObject<Map<string, any[]>>;
}) {
  const [issues, setIssues] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipDown: boolean; bottomOffset: number }>({ top: 0, left: 0, flipDown: false, bottomOffset: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }, []);

  async function handleMouseEnter() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const flipDown = rect.top < 300;
      setPos({ top: flipDown ? rect.bottom + 8 : rect.top - 8, left: rect.right, flipDown, bottomOffset: window.innerHeight - rect.top });
    }
    setShow(true);
    const key = `jira:${reportId}:${login}`;
    if (cacheRef.current!.has(key)) { setIssues(cacheRef.current!.get(key)!); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/report/${reportId}/jira-issues?login=${encodeURIComponent(login)}`);
      if (!res.ok) throw new Error(res.statusText);
      const rows = await res.json();
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
        bottom: pos.flipDown ? undefined : `${pos.bottomOffset}px`,
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
