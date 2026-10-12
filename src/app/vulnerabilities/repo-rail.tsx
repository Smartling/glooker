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
import { slotView } from './slot-view';
import RefreshNote from './refresh-note';
import BangMark from './bang-mark';
import { RAIL_FOOT_MIN_H, RAIL_W, TYPE } from './dimensions';

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

/** A run of the footer note's text; `invalid` is the part that says the policy cannot be read (drawn red, with the "!" mark). */
export interface RailNoteSegment { text: string; invalid?: boolean }

/**
 * The footer's second line: which severities the OVERDUE figures include, and why one is missing. It follows
 * Severity: under "Critical only" it never talks about high. The state wording is `slaStateLabel(…, { withSla: true })`,
 * the same as the strip's tails. Returned as segments so only the "SLA policy can't be read" part is red.
 */
export function railSlaSegments(sla: SlaSource, severity: SeverityFilter = 'both'): RailNoteSegment[] {
  const considered = (['critical', 'high'] as const).filter(s => severity === 'both' || severity === s);
  const states = considered.map(sev => ({ sev, st: slaState(sev, sla) as SlaState }));
  const active = states.filter(x => x.st.kind === 'active');
  const inactive = states.filter(x => x.st.kind !== 'active');
  const label = (st: SlaState) => slaStateLabel(st, { withSla: true }) ?? '';
  if (inactive.length === 0) {
    return [{ text: active.length === 2 ? 'Overdue counts critical and high' : `Overdue counts ${SEV_NAMES[active[0].sev]} only` }];
  }
  if (active.length === 0) {
    // One label when every state reads the same, otherwise each severity's own.
    const labels = inactive.map(x => label(x.st));
    const parts: RailNoteSegment[] = new Set(labels).size === 1
      ? [{ text: labels[0], invalid: inactive[0].st.kind === 'invalid' }]
      : inactive.flatMap((x, i) => [...(i ? [{ text: ' · ' }] : []), { text: `${x.sev}: ${labels[i]}`, invalid: x.st.kind === 'invalid' }]);
    parts[0] = { ...parts[0], text: `${parts[0].text.charAt(0).toUpperCase()}${parts[0].text.slice(1)}` };
    return [...parts, { text: ' · no overdue counts' }];
  }
  return [
    { text: `Overdue counts ${SEV_NAMES[active[0].sev]} only · ${inactive[0].sev}: ` },
    { text: label(inactive[0].st), invalid: inactive[0].st.kind === 'invalid' },
  ];
}

/** The footer note as one string (the segments joined). */
export function railSlaNote(sla: SlaSource, severity: SeverityFilter = 'both'): string {
  return railSlaSegments(sla, severity).map(seg => seg.text).join('');
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
/** A keyboard-focused row: an inset ring, so the scrolling list (which has no top padding) cannot clip it. The same ring as the tables' rows. */
const ROW_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50';

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
  const allLabel = url.team ? `All ${url.team} repositories` : 'All repositories';
  const allCounts = rows ? railCounts(all.crit, all.high, url.severity) : '';
  const meta = rows ? `${plural(measured.length, 'repo')}${unmeasured.length ? ` + ${unmeasured.length} unmeasured` : ''}` : '';

  return (
    <aside
      aria-label="Repositories"
      data-testid="repo-rail"
      className="flex min-h-0 min-w-0 flex-col border-r border-gray-700"
      style={{ width: RAIL_W }}
    >
      <div className="flex flex-none flex-col gap-2.5 px-4 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={`${TYPE.sectionLabel} text-gray-300`}>Repositories</span>
          <span data-testid="rail-meta" className="min-h-4 truncate text-xs text-gray-500">{meta || '\u00a0'}</span>
        </div>
        {/* The box and its note are one group with NO gap and no padding round it: the note's reserved line is the only space between the box
            and the list, so the All row sits one line (16px) under the box, as the mockup's ~10-16px, with the line still reserved. */}
        <div className="flex min-w-0 flex-col">
          {/* Filled (the mockup's surface-2), as the Owning teams tab's filter box: a fill and a quiet border, not a card-coloured box in an outline. */}
          <input
            aria-label="Filter by name"
            placeholder="Filter by name"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className={`h-[30px] w-full border border-gray-700 bg-gray-800 px-2.5 text-[13px] text-gray-200 placeholder:text-gray-500 ${TYPE.control}`}
          />
          {/* A reserved line (there with or without the note), so "Couldn't refresh · showing last load" moves nothing. */}
          <div data-testid="rail-note-slot" className="h-4 min-w-0">
            {/* Not live: the strip announces a failed refresh of the repos slot, and this note reads the same slot. */}
            <RefreshNote error={view.kind === 'data' ? view.refreshError : null} testId="rail-refresh-note" />
          </div>
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
          className={`flex w-full flex-none flex-col gap-0.5 px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${ROW_FOCUS} ${repo === null ? 'bg-accent/10' : 'hover:bg-gray-800/30'}`}
        >
          <span className={`truncate ${repo === null ? 'font-semibold text-accent-light' : 'text-gray-200'}`} title={allLabel}>{allLabel}</span>
          <span className="truncate text-xs tabular-nums text-gray-400" title={allCounts || undefined}>{allCounts || '\u00a0'}</span>
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
              // The title is the full name (the name truncates); the selected row's accessible name says what a click does.
              title={selected ? row.fullName : `Show ${row.fullName} alerts`}
              aria-label={selected ? 'Show all repositories' : undefined}
              onClick={() => url.setRepo(selected ? null : row.fullName)}
              className={`flex w-full flex-none flex-col gap-0.5 px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${ROW_FOCUS} ${selected ? 'bg-accent/10' : 'hover:bg-gray-800/30'}`}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className={`truncate ${selected ? 'font-semibold text-accent-light' : stat.total > 0 ? 'text-gray-200' : 'text-gray-500'}`} title={row.fullName}>{row.fullName}</span>
                {selected && <span aria-hidden="true" className="shrink-0 text-[15px] leading-none text-accent-light">×</span>}
              </span>
              <span className="flex justify-between gap-2 whitespace-nowrap text-xs text-gray-400">
                <span data-testid="rail-counts" className="min-w-0 truncate tabular-nums" title={railCounts(stat.crit, stat.high, url.severity)}>{railCounts(stat.crit, stat.high, url.severity)}</span>
                {stat.overdue > 0 && <span data-testid="rail-overdue" className="shrink-0 font-bold tabular-nums text-red-400">{stat.overdue.toLocaleString('en-US')} OVERDUE</span>}
              </span>
              {!url.team && <span className="truncate text-[11px] text-gray-500" title={`Owning team: ${row.team}`}>Owning team: {row.team}</span>}
            </button>
          );
        })}

        {unmeasured.map(row => (
          <button
            key={row.fullName}
            type="button"
            data-testid="rail-unmeasured"
            data-repo={row.fullName}
            title={`${row.fullName} · ${unmeasuredReason(row.unmeasured!)}`}
            onClick={e => openDrawer(e.currentTarget)}
            className={`vuln-hatch mt-1 flex w-full flex-none flex-col gap-[3px] border border-warn-line px-2.5 py-2 text-left ${TYPE.body} ${TYPE.control} ${ROW_FOCUS}`}
          >
            <span className="truncate text-gray-200">{row.fullName}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-warn">
              <span aria-hidden="true" className="shrink-0">▲</span>
              <span className="truncate uppercase">Unmeasured · {unmeasuredReason(row.unmeasured!)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* A minimum height for the note's longest wording (three lines), so the list's bottom edge does not move with Severity. */}
      <div data-testid="rail-foot" className="flex flex-none flex-col gap-0.5 border-t border-gray-700 px-4 py-2.5 text-xs text-gray-500" style={{ minHeight: RAIL_FOOT_MIN_H }}>
        <span>{RAIL_SORT_NOTE}</span>
        {/* Wraps: the second line explains which overdue counts are included, so it must never be clipped. The unreadable-policy part is red. */}
        <span data-testid="rail-sla-note" className="whitespace-normal break-words">
          {railSlaSegments(summary, url.severity).map((seg, i) => seg.invalid
            ? <span key={i} className="font-bold text-red-400"><BangMark /> {seg.text}</span>
            : <span key={i}>{seg.text}</span>)}
        </span>
      </div>
    </aside>
  );
}
