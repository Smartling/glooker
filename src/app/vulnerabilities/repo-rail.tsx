// src/app/vulnerabilities/repo-rail.tsx
'use client';
// GLOOK-64: the Alerts view's 260px repository rail. One row per repository in scope, re-sorted on
// the client (overdue, then open critical, then open high, then name; unmeasured last), with the
// selected repository tinted and a click that writes only `repo` (a replace, no history entry).
import { useState } from 'react';
import type { RepoRow } from '@/lib/vulnerabilities/aggregate';
import type { SecurityViewProps } from './view-props';
import type { SeverityFilter } from './security-state';
import { slaActive, slaState, slaStateLabel, type SlaSource, type SlaState } from './sla-state';
import { unmeasuredReason } from './labels';
import { noOpenText } from './ownership-model';
import { REFRESH_FAILED_NOTE, slotView } from './slot-view';
import { RAIL_W, TYPE } from './dimensions';

export const RAIL_SORT_NOTE = 'Sorted by overdue, then open critical';

export interface RailStat { crit: number; high: number; overdue: number; total: number }

/**
 * One row's figures under the Severity filter: a hidden severity counts as 0 (so the sort and the
 * "no open alerts" grey follow what the user can see), and overdue sums only the severities that are
 * both visible and have an active SLA. The SLA state decides, not the row's own null.
 */
export function railStat(row: RepoRow, severity: SeverityFilter, sla: SlaSource): RailStat {
  const crit = severity === 'high' ? 0 : row.critical.open;
  const high = severity === 'critical' ? 0 : row.high.open;
  const overdue =
    (severity !== 'high' && slaActive('critical', sla) ? (row.critical.overdue ?? 0) : 0) +
    (severity !== 'critical' && slaActive('high', sla) ? (row.high.overdue ?? 0) : 0);
  return { crit, high, overdue, total: crit + high };
}

/** Measured rows in rail order: overdue desc, open critical desc, open high desc, name asc. */
export function sortRailRows(rows: readonly RepoRow[], severity: SeverityFilter, sla: SlaSource): Array<{ row: RepoRow; stat: RailStat }> {
  return rows
    .filter(r => !r.unmeasured)
    .map(row => ({ row, stat: railStat(row, severity, sla) }))
    .sort((a, b) =>
      b.stat.overdue - a.stat.overdue || b.stat.crit - a.stat.crit || b.stat.high - a.stat.high || a.row.fullName.localeCompare(b.row.fullName));
}

/** "9 crit · 14 high open", or "no open alerts" (under a narrowed Severity, "no open critical alerts") when the visible severities have none. */
export function railCounts(crit: number, high: number, severity: SeverityFilter): string {
  if (crit + high === 0) return noOpenText(severity);
  const parts: string[] = [];
  if (severity !== 'high') parts.push(`${crit.toLocaleString('en-US')} crit`);
  if (severity !== 'critical') parts.push(`${high.toLocaleString('en-US')} high`);
  return `${parts.join(' · ')} open`;
}

const SEV_NAMES = { critical: 'critical', high: 'high' } as const;

/**
 * The footer's second line: which severities the OVERDUE figures include, and why one is missing. It follows
 * Severity: under "Critical only" it never talks about high. The state wording is `slaStateLabel(…, { withSla: true })`,
 * the same as the strip's tails.
 */
export function railSlaNote(sla: SlaSource, severity: SeverityFilter = 'both'): string {
  const considered = (['critical', 'high'] as const).filter(s => severity === 'both' || severity === s);
  const states = considered.map(sev => ({ sev, st: slaState(sev, sla) as SlaState }));
  const active = states.filter(x => x.st.kind === 'active');
  const inactive = states.filter(x => x.st.kind !== 'active');
  const label = (st: SlaState) => slaStateLabel(st, { withSla: true }) ?? '';
  if (inactive.length === 0) {
    return active.length === 2 ? 'Overdue counts critical and high' : `Overdue counts ${SEV_NAMES[active[0].sev]} only`;
  }
  if (active.length === 0) {
    // One label when every state reads the same, otherwise each severity's own.
    const labels = inactive.map(x => label(x.st));
    const text = new Set(labels).size === 1 ? labels[0] : inactive.map((x, i) => `${x.sev}: ${labels[i]}`).join(' · ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} · no overdue counts`;
  }
  return `Overdue counts ${SEV_NAMES[active[0].sev]} only · ${inactive[0].sev}: ${label(inactive[0].st)}`;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

export default function RepoRail({ summary, data, url, openDrawer }: SecurityViewProps) {
  const [filter, setFilter] = useState('');
  // The slot-view rule: the slot's own rows win (dimmed while stale, with a note when a same-key refresh failed);
  // without rows an error, then an unavailable answer, then "Loading…".
  const view = slotView(data.repos);
  const rows = view.kind === 'data' ? view.data.rows : undefined;
  const dimmed = view.kind === 'data' && view.dimmed;
  const repo = data.effectiveRepo;          // not url.repo: a repository that was not found is not selected
  const needle = filter.trim().toLowerCase();
  const matching = rows ? rows.filter(r => !needle || r.fullName.toLowerCase().includes(needle)) : [];
  const measured = sortRailRows(matching, url.severity, summary);
  const unmeasured = matching.filter(r => r.unmeasured).sort((a, b) => a.fullName.localeCompare(b.fullName));

  // The All row counts like the rows do: a hidden severity is zero, so "no open critical alerts" reads the same on both.
  const all = (rows ?? []).reduce((a, r) => {
    const st = railStat(r, url.severity, summary);
    return { crit: a.crit + st.crit, high: a.high + st.high };
  }, { crit: 0, high: 0 });
  const meta = rows ? `${plural(measured.length, 'repo')}${unmeasured.length ? ` + ${unmeasured.length} unmeasured` : ''}` : '';

  return (
    <aside
      aria-label="Repositories"
      data-testid="repo-rail"
      className="flex min-h-0 min-w-0 flex-col border-r border-gray-700"
      style={{ width: RAIL_W }}
    >
      <div className="flex flex-none flex-col gap-2.5 px-4 pb-2.5 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={`${TYPE.sectionLabel} text-gray-300`}>Repositories</span>
          <span data-testid="rail-meta" className="min-h-4 truncate text-xs text-gray-500">{meta || '\u00a0'}</span>
        </div>
        <input
          aria-label="Filter by name"
          placeholder="Filter by name"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`h-[30px] w-full border border-gray-700 bg-chart-surface px-2.5 text-[13px] text-gray-200 ${TYPE.control}`}
        />
        {/* A reserved line (there with or without the note), so "Couldn't refresh · showing last load" moves nothing. */}
        <div data-testid="rail-note-slot" className="-mt-1 h-4 min-w-0">
          {view.kind === 'data' && view.refreshError && (
            <span data-testid="rail-refresh-note" title={view.refreshError} className="block truncate text-xs text-red-400">{REFRESH_FAILED_NOTE}</span>
          )}
        </div>
      </div>

      <div
        data-testid="rail-list"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
        style={{ opacity: dimmed ? 0.6 : 1 }}
      >
        <button
          type="button"
          data-testid="rail-all"
          aria-pressed={repo === null}
          onClick={() => url.setRepo(null)}
          className={`flex w-full flex-none flex-col gap-0.5 px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${repo === null ? 'bg-accent/10' : 'hover:bg-gray-800/30'}`}
        >
          <span className={`truncate ${repo === null ? 'font-semibold text-accent-light' : 'text-gray-200'}`}>
            {url.team ? `All ${url.team} repositories` : 'All repositories'}
          </span>
          <span className="truncate text-xs text-gray-400">{rows ? railCounts(all.crit, all.high, url.severity) : '\u00a0'}</span>
        </button>
        <div className="mx-0.5 my-1 h-px flex-none bg-gray-700" aria-hidden="true" />

        {view.kind === 'error' && <p className="px-2.5 py-4 text-sm text-red-400">{view.text}</p>}
        {view.kind === 'unavailable' && <p data-testid="rail-unavailable" title={view.title} className="px-2.5 py-4 text-sm text-gray-500">{view.text}</p>}
        {view.kind === 'loading' && <p className="px-2.5 py-4 text-sm text-gray-500">Loading…</p>}
        {rows && measured.length === 0 && unmeasured.length === 0 && (
          <p className="px-2.5 py-4 text-sm text-gray-400">
            {needle ? `No repositories match “${filter.trim()}”.` : 'No repositories in this scope.'}
          </p>
        )}

        {measured.map(({ row, stat }) => {
          const selected = repo === row.fullName;
          return (
            <button
              key={row.fullName}
              type="button"
              data-testid="rail-row"
              data-repo={row.fullName}
              aria-pressed={selected}
              title={selected ? 'Show all repositories' : `Show ${row.fullName} alerts`}
              onClick={() => url.setRepo(selected ? null : row.fullName)}
              className={`flex w-full flex-none flex-col gap-0.5 px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${selected ? 'bg-accent/10' : 'hover:bg-gray-800/30'}`}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className={`truncate ${selected ? 'font-semibold text-accent-light' : stat.total > 0 ? 'text-gray-200' : 'text-gray-500'}`}>{row.fullName}</span>
                {selected && <span aria-hidden="true" className="shrink-0 text-[15px] leading-none text-accent-light">×</span>}
              </span>
              <span className="flex justify-between gap-2 whitespace-nowrap text-xs text-gray-400">
                <span data-testid="rail-counts" className="min-w-0 truncate">{railCounts(stat.crit, stat.high, url.severity)}</span>
                {stat.overdue > 0 && <span data-testid="rail-overdue" className="shrink-0 font-bold text-red-400">{stat.overdue.toLocaleString('en-US')} OVERDUE</span>}
              </span>
              {!url.team && <span className="truncate text-[11px] text-gray-500">Owning team: {row.team}</span>}
            </button>
          );
        })}

        {unmeasured.map(row => (
          <button
            key={row.fullName}
            type="button"
            data-testid="rail-unmeasured"
            data-repo={row.fullName}
            title="Open counts unknown. Resolved alerts and history still count."
            onClick={e => openDrawer(e.currentTarget)}
            className={`vuln-hatch mt-1 flex w-full flex-none flex-col gap-[3px] border border-warn-line px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control}`}
          >
            <span className="truncate text-gray-200">{row.fullName}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-warn">
              <span aria-hidden="true" className="shrink-0">▲</span>
              <span className="truncate uppercase">Unmeasured · {unmeasuredReason(row.unmeasured!)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-none flex-col gap-0.5 border-t border-gray-700 px-4 py-2.5 text-xs text-gray-500">
        <span>{RAIL_SORT_NOTE}</span>
        {/* Wraps: the second line explains which overdue counts are included, so it must never be clipped. */}
        <span data-testid="rail-sla-note" className="whitespace-normal break-words">{railSlaNote(summary, url.severity)}</span>
      </div>
    </aside>
  );
}
