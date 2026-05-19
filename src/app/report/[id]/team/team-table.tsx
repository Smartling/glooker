'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUrlState } from '@/lib/url-state';
import { aggregateTeams, type AggregatorDeveloper, type AggregatorTeam, type TeamRow } from '@/lib/teams/team-aggregator';

interface TeamTableProps {
  developers: AggregatorDeveloper[];
  teams:      AggregatorTeam[];
  reportId:   string;
  canAct:     boolean;
}

const SORT_KEYS = [
  'name', 'size', 'active_count', 'total_prs', 'total_commits',
  'lines_added', 'avg_complexity', 'pr_percentage', 'ai_percentage',
  'total_jira_issues', 'cc_total_cost',
  'impact_total', 'impact_avg', 'impact_weighted',
] as const;
type SortKey = typeof SORT_KEYS[number];

export default function TeamTable({ developers, teams, reportId, canAct }: TeamTableProps) {
  const router = useRouter();
  const rows: TeamRow[] = useMemo(() => aggregateTeams(developers, teams), [developers, teams]);

  // URL-stated so sort survives reload and shareable links.
  const [sortKey, setSortKey] = useUrlState<SortKey>({
    key: 'sort',
    type: 'enum',
    values: SORT_KEYS,
    default: 'impact_weighted',
    history: 'replace',
  });
  const [sortDir, setSortDir] = useUrlState<'asc' | 'desc'>({
    key: 'dir',
    type: 'enum',
    values: ['asc', 'desc'] as const,
    default: 'desc',
    history: 'replace',
  });

  const hasJira  = rows.some(r => r.total_jira_issues > 0);
  const hasSpend = canAct && rows.some(r => r.cc_total_cost > 0);

  const sortedRows = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * sign;
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      if (av === bv) return a.name.localeCompare(b.name);
      return (av - bv) * sign;
    });
  }, [rows, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const onRowClick = (row: TeamRow) => {
    // Look up the authoritative member list from the team object (TeamRow.members
    // only carries active devs). Mirrors what the in-page team-filter dropdown does:
    // it sets BOTH the `team` URL state (drives TeamPulseCard) and the `dev` URL
    // state (drives the dev-filter chips and the IC table). The `dev` URL state
    // is encoded as repeated `?dev=…&dev=…` params, not comma-joined.
    const team = teams.find(t => t.id === row.team_id);
    const params = new URLSearchParams();
    params.set('view', 'individuals');
    params.set('team', row.name);
    for (const login of team?.members ?? []) params.append('dev', login);
    router.push(`/report/${reportId}/team?${params.toString()}`);
  };

  if (rows.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-8 text-gray-500 text-sm">
        No teams configured for this org. Add teams in Settings to compare.
      </div>
    );
  }

  const sortCaret = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
            <th className="px-4 py-3 w-[16%]"><button onClick={() => onSort('name')} className="hover:text-gray-300">Team{sortCaret('name')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('size')} className="hover:text-gray-300">Size{sortCaret('size')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('active_count')} className="hover:text-gray-300">Active{sortCaret('active_count')}</button></th>
            <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('total_prs')} className="hover:text-gray-300">PRs{sortCaret('total_prs')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('total_commits')} className="hover:text-gray-300">Commits{sortCaret('total_commits')}</button></th>
            <th className="px-4 py-3 text-right w-[8%]"><button onClick={() => onSort('lines_added')} className="hover:text-gray-300">Lines +/-{sortCaret('lines_added')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('avg_complexity')} className="hover:text-gray-300">Cmplx{sortCaret('avg_complexity')}</button></th>
            <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('pr_percentage')} className="hover:text-gray-300">PR%{sortCaret('pr_percentage')}</button></th>
            <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('ai_percentage')} className="hover:text-gray-300">AI%{sortCaret('ai_percentage')}</button></th>
            {hasJira  && <th className="px-4 py-3 text-right w-[5%]"><button onClick={() => onSort('total_jira_issues')} className="hover:text-gray-300">Jira{sortCaret('total_jira_issues')}</button></th>}
            {hasSpend && <th className="px-4 py-3 text-right w-[6%]"><button onClick={() => onSort('cc_total_cost')} className="hover:text-gray-300">Spend{sortCaret('cc_total_cost')}</button></th>}
            <th className="px-4 py-3 text-right w-[7%]" title="Per-capita-then-apply: team-level metrics ÷ team size, run through the IC impact formula"><button onClick={() => onSort('impact_weighted')} className="hover:text-gray-300">Impact (W){sortCaret('impact_weighted')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]" title="Arithmetic mean of active developers' impact scores"><button onClick={() => onSort('impact_avg')} className="hover:text-gray-300">(A){sortCaret('impact_avg')}</button></th>
            <th className="px-4 py-3 text-right w-[6%]" title="Sum-then-apply: team-level totals run through the IC impact formula. Saturates fast — use as a context column, not a primary sort."><button onClick={() => onSort('impact_total')} className="hover:text-gray-300">(T){sortCaret('impact_total')}</button></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => (
            <tr
              key={row.team_id}
              onClick={() => onRowClick(row)}
              className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${row.active_count === 0 ? 'opacity-50' : ''}`}
            >
              <td className="px-4 py-3 font-medium text-white">
                <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: row.color }} />
                {row.name}
              </td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.size}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">
                {row.active_count}
                {row.active_count < row.size && <span className="text-amber-400/70 text-xs ml-1">−{row.size - row.active_count}</span>}
              </td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.total_prs}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.total_commits}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">
                <span className="text-green-400/80">+{row.lines_added}</span>
                <span className="text-gray-500 mx-1">/</span>
                <span className="text-red-400/80">−{row.lines_removed}</span>
              </td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.active_count > 0 ? row.avg_complexity.toFixed(1) : '—'}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.active_count > 0 ? `${Math.round(row.pr_percentage)}%` : '—'}</td>
              <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.active_count > 0 ? `${Math.round(row.ai_percentage)}%` : '—'}</td>
              {hasJira  && <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{row.total_jira_issues}</td>}
              {hasSpend && <td className="px-4 py-3 text-right text-green-400 font-mono text-sm tabular-nums">${Math.round(row.cc_total_cost / 100).toLocaleString()}</td>}
              <td className="px-4 py-3 text-right text-white tabular-nums font-semibold">{row.impact_weighted.toFixed(1)}</td>
              <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{row.impact_avg.toFixed(1)}</td>
              <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{row.impact_total.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
