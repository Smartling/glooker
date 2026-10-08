// src/app/vulnerabilities/repo-table.tsx
'use client';
// GLOOK-64: the "Repositories" tab. Every repository in scope (the selected owning team's, or all),
// including those with no open alerts, with a pinned header and a pinned footer inside the card's
// scrolling body. A repository's open counts are unknown while it is unmeasured: it is listed last
// as a hatched band and ignores sorting. The footer's open and overdue sums still include its stored
// counts, so the footer agrees with the team table; its count, oldest and next due are measured rows only.
import { useState } from 'react';
import type { RepoRow } from '@/lib/vulnerabilities/aggregate';
import { CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { SecurityViewProps } from './view-props';
import { TEAM_ROW_H, TYPE, Z } from './dimensions';
import { dash } from './format';
import { displayDate, unmeasuredReason } from './labels';
import { slaActive, anySlaActive } from './sla-state';
import { REFRESH_FAILED_NOTE, slotView } from './slot-view';
import {
  buildRepoView, nextSort, noOpenText, repoDisplay, repoKeySeverity, repoTotals, REPO_SORT_FIRST, sevShown, sortGlyph,
  type NextDue, type RepoDisplay, type RepoSortKey, type SortState,
} from './ownership-model';

const HIDDEN = '–'; // en dash: a hidden severity's cell. A missing figure is "—" (em dash).
/** The Owning team track is a fixed width, so a long team name ends in "…" and the numeric columns keep the same room. */
export const REPO_TEAM_COL_W = 150;
const DIM = 'opacity-[0.35]';

interface Col { key: RepoSortKey; label: string; width: string; align: 'right' }

function columns(src: SecurityViewProps['summary']): Col[] {
  const num = (key: RepoSortKey, label: string): Col => ({ key, label, width: 'minmax(0, 0.8fr)', align: 'right' });
  return [
    num('openCrit', 'Open crit'),
    ...(slaActive('critical', src) ? [num('overCrit', 'Overdue crit')] : []),
    num('openHigh', 'Open high'),
    ...(slaActive('high', src) ? [num('overHigh', 'Overdue high')] : []),
    num('oldest', 'Oldest open'),
    ...(anySlaActive(src) ? [{ ...num('next', 'Next due'), width: 'minmax(0, 1.1fr)' }] : []),
  ];
}

const nextText = (n: NextDue) => ({ date: displayDate(n.date), sub: n.daysRemaining === 0 ? 'today' : `in ${n.daysRemaining}d` });

/** The text of one numeric cell (or footer cell) for a column; null for a hidden severity. */
function figure(col: Col, v: { openCrit: number; openHigh: number; overCrit: number | null; overHigh: number | null; oldest: number | null; next: NextDue | null }, bold: boolean) {
  switch (col.key) {
    case 'openCrit': return { text: dash(v.openCrit), cls: v.openCrit ? 'text-white' : 'text-gray-600', weight: true };
    case 'openHigh': return { text: dash(v.openHigh), cls: v.openHigh ? 'text-white' : 'text-gray-600', weight: true };
    // A null overdue (no figure) reads "—", never a zero it does not know.
    case 'overCrit': return { text: dash(v.overCrit), cls: v.overCrit ? 'font-bold text-red-400' : 'text-gray-600', weight: false };
    case 'overHigh': return { text: dash(v.overHigh), cls: v.overHigh ? 'font-bold text-red-400' : 'text-gray-600', weight: false };
    case 'oldest': return { text: v.oldest === null ? '—' : `${v.oldest}d`, cls: bold ? 'text-white' : 'text-gray-300', weight: false };
    default: return { text: v.next ? nextText(v.next).date : '—', cls: 'text-gray-300', weight: false, sub: v.next ? nextText(v.next).sub : undefined };
  }
}

function MeasuredRow({ d, cols, template, severity, onSelect }: {
  d: RepoDisplay; cols: Col[]; template: string; severity: SecurityViewProps['url']['severity']; onSelect: SecurityViewProps['url']['selectRepoRow'];
}) {
  const r = d.row;
  const zero = d.open === 0;
  return (
    <div
      role="row" data-testid={`repo-row-${r.fullName}`} tabIndex={0} title={`Open ${r.fullName} alerts`}
      className="cursor-pointer items-center border-b border-gray-800/60 hover:bg-gray-800/30"
      style={{ display: 'grid', gridTemplateColumns: template, height: TEAM_ROW_H }}
      onClick={() => onSelect({ fullName: r.fullName, team: r.team })}
      onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ fullName: r.fullName, team: r.team }); } }}
    >
      <div role="cell" className="min-w-0 px-2">
        <div className={`${TYPE.body} truncate ${zero ? 'text-gray-500' : 'text-gray-100'}`} title={r.fullName}>{r.fullName}</div>
        <div className="truncate text-xs text-gray-500">{CODEBASE_LABELS[r.codebaseGroup]}{zero ? ` · ${noOpenText(severity)}` : ''}</div>
      </div>
      <div role="cell" className={`${TYPE.body} min-w-0 truncate px-2 ${zero ? 'text-gray-500' : 'text-gray-300'}`} title={r.team}>{r.team}</div>
      {cols.map(c => {
        const sev = repoKeySeverity(c.key);
        if (sev && !sevShown(severity, sev)) return <div key={c.key} role="cell" className="px-2 text-right text-gray-600">{HIDDEN}</div>;
        const f = figure(c, d, false);
        return (
          <div key={c.key} role="cell" className={`px-2 text-right tabular-nums ${f.cls}${f.weight ? ' font-semibold' : ''}`}>
            {f.text}
            {'sub' in f && f.sub && <span className="ml-1 text-xs font-normal text-gray-500">{f.sub}</span>}
          </div>
        );
      })}
    </div>
  );
}

function UnmeasuredRow({ r, cols, template, onOpen }: { r: RepoRow; cols: Col[]; template: string; onOpen: SecurityViewProps['openDrawer'] }) {
  const u = r.unmeasured!;
  // The band's style is all capitals, so the reason (drawer wording, detail included) is upper-cased here.
  const reason = unmeasuredReason(u).toUpperCase();
  const text = `▲ UNMEASURED · ${reason} — alert counts unknown, not zero`;
  return (
    <div
      role="row" data-testid={`repo-row-${r.fullName}`} tabIndex={0}
      title={`Open counts unknown${u.detail ? ` (${u.detail})` : ''}. Click for details.`}
      className="cursor-pointer items-center border-b border-gray-800/60"
      style={{ display: 'grid', gridTemplateColumns: template, height: TEAM_ROW_H }}
      onClick={e => onOpen(e.currentTarget)}
      onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e.currentTarget); } }}
    >
      <div role="cell" className="min-w-0 px-2">
        <div className={`${TYPE.body} truncate text-gray-100`} title={r.fullName}>{r.fullName}</div>
        <div className="truncate text-xs text-gray-500">{CODEBASE_LABELS[r.codebaseGroup]}</div>
      </div>
      <div role="cell" className={`${TYPE.body} min-w-0 truncate px-2 text-gray-300`} title={r.team}>{r.team}</div>
      <div role="cell" data-testid="repo-unmeasured-band" className="vuln-hatch mx-2 min-w-0 truncate rounded border border-warn-line px-2 py-1 text-xs font-semibold text-warn" style={{ gridColumn: `span ${cols.length}` }}>
        {text}
      </div>
    </div>
  );
}

export interface RepoTableProps extends SecurityViewProps {
  /** The card's name filter text (local state, owned by the card header's input). */
  nameFilter: string;
}

export default function RepoTable({ summary, data, url, openDrawer, nameFilter }: RepoTableProps) {
  const [sort, setSort] = useState<SortState<RepoSortKey> | null>(null);
  const view = slotView(data.repos);
  if (view.kind === 'error') return <p data-testid="repo-table-error" className="p-4 text-xs text-red-400">{view.text}</p>;
  if (view.kind === 'loading') return <p data-testid="repo-table-loading" className="p-4 text-xs text-gray-500">Loading…</p>;
  if (view.kind === 'unavailable') return <p data-testid="repo-table-unavailable" className="p-4 text-xs text-gray-500" title={view.title}>{view.text}</p>;

  const rows = view.data.rows;
  // The footer names the scope the ROWS were fetched for. While a new scope loads the rows are the previous one's, and
  // url.team already names the new team: "Search total" over Payments' rows would be a lie.
  const rowsTeam = view.data.appliedFilters.team ?? null;
  const cols = columns(summary);
  const template = `minmax(0, 2fr) ${REPO_TEAM_COL_W}px ${cols.map(c => c.width).join(' ')}`;
  const repoView = buildRepoView(rows, url.severity, sort, nameFilter);
  const totals = repoTotals(repoView.measured, repoView.unmeasured.map(r => repoDisplay(r, url.severity)));
  const filtering = nameFilter.trim() !== '';
  const subs = [
    repoView.unmeasured.length ? `${dash(repoView.unmeasured.length)} unmeasured: totals include stored counts` : null,
    filtering ? `name contains “${nameFilter.trim()}”` : null,
  ].filter((s): s is string => s !== null);
  const note = subs.join(' · ');

  const head = (key: RepoSortKey, label: string, right: boolean) => {
    const sev = repoKeySeverity(key);
    const shown = !sev || sevShown(url.severity, sev);
    const active = shown && sort?.key === key ? sort : null;
    return (
      <div key={key} role="columnheader" aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2 ${shown ? '' : DIM}`}>
        <button
          type="button" disabled={!shown}
          className={`${TYPE.tableHeader} flex w-full items-center gap-1 whitespace-nowrap leading-[13px] ${right ? 'justify-end text-right' : 'text-left'} ${active ? 'text-white' : 'text-gray-400'} disabled:cursor-default`}
          onClick={() => setSort(s => nextSort(s, key, REPO_SORT_FIRST[key]))}
        >
          <span className="min-w-0 truncate">{label}</span>
          {shown && <span aria-hidden="true" className={`shrink-0 ${active ? 'text-accent-light' : 'text-gray-600'}`}>{sortGlyph(active)}</span>}
        </button>
      </div>
    );
  };

  return (
    <div role="table" aria-label="Repositories" data-testid="repo-table" className={`h-full overflow-auto${view.dimmed ? ' opacity-60' : ''}`}>
      <div role="row" className="sticky top-0 items-center border-b border-gray-800 bg-chart-surface" style={{ display: 'grid', gridTemplateColumns: template, height: 40, zIndex: Z.pinnedRows }}>
        {head('name', 'Repository', false)}
        {head('team', 'Owning team', false)}
        {cols.map(c => head(c.key, c.label, true))}
      </div>

      {rows.length === 0 && <p className="p-4 text-xs text-gray-500">No repositories in this scope.</p>}
      {rows.length > 0 && repoView.measured.length + repoView.unmeasured.length === 0 && (
        <p className="p-4 text-xs text-gray-500">No repositories match “{nameFilter.trim()}”.</p>
      )}
      {repoView.measured.map(d => <MeasuredRow key={d.row.fullName} d={d} cols={cols} template={template} severity={url.severity} onSelect={url.selectRepoRow} />)}
      {repoView.unmeasured.map(r => <UnmeasuredRow key={r.fullName} r={r} cols={cols} template={template} onOpen={openDrawer} />)}

      <div className="sticky bottom-0 border-t border-gray-700 bg-chart-surface" style={{ zIndex: Z.pinnedRows }}>
        <div role="row" data-testid="repo-footer" className="items-center font-bold" style={{ display: 'grid', gridTemplateColumns: template, minHeight: TEAM_ROW_H }}>
          <div role="cell" className="col-span-2 min-w-0 px-2">
            <div className={`${TYPE.body} truncate text-white`}>
              {filtering ? 'Matching' : rowsTeam ? `${rowsTeam} total` : 'Total'} · {dash(totals.count)} {totals.count === 1 ? 'repo' : 'repos'}
            </div>
            {/* The one reserved line under the label: a failed refresh of these rows comes first, in red, then the scope notes. */}
            <div data-testid="repo-footer-note" className="h-4 truncate text-xs font-normal leading-4 text-gray-500" aria-hidden={note || view.refreshError ? undefined : true} title={view.refreshError ?? undefined}>
              {view.refreshError && <span data-testid="repo-refresh-note" className="text-red-400">{REFRESH_FAILED_NOTE}</span>}
              {view.refreshError && note ? ' · ' : ''}
              {note || (view.refreshError ? '' : '\u00a0')}
            </div>
          </div>
          {cols.map(c => {
            const sev = repoKeySeverity(c.key);
            if (sev && !sevShown(url.severity, sev)) return <div key={c.key} role="cell" className="px-2 text-right text-gray-600">{HIDDEN}</div>;
            const f = figure(c, totals, true);
            return (
              <div key={c.key} role="cell" className={`px-2 text-right tabular-nums ${f.cls.replace('text-gray-600', 'text-white')}`}>
                {f.text}
                {'sub' in f && f.sub && <span className="ml-1 text-xs font-normal text-gray-500">{f.sub}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
