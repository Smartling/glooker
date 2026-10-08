// src/app/vulnerabilities/team-table.tsx
'use client';
// GLOOK-64: the "Owning teams" tab. One row per owning team with a CRITICAL group and a HIGH group,
// a pinned header and a pinned Total row inside the card's scrolling body. It reads `data.teamSummary`
// (never scoped to the selected team, so every team stays listed to compare against). It never falls
// back to the team-scoped `summary`: that would list one team under a "Total" while the page says
// every team is compared. Until the unfiltered request has data, the body says why (slotView).
import { useState } from 'react';
import type { TeamRow, SevCell } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { SecurityViewProps } from './view-props';
import { TEAM_BAND_H, TEAM_COLHEAD_H, TEAM_FOOTNOTE_H, TEAM_HEAD_H, TEAM_ROW_H, TYPE, Z } from './dimensions';
import { dash, deltaBaselineCaption, resolvedCaption } from './format';
import { unmeasuredBadgeText } from './labels';
import { baselineUnavailableText, carriedFootnote, carriedTitle } from './overview-format';
import { slaActive } from './sla-state';
import { slotView } from './slot-view';
import RefreshNote from './refresh-note';
import {
  deltaOpenFor, hasCarriedFootnote, nextSort, orderTeamRows, sevShown, shownTeamSort, sortGlyph, TEAM_SORT_FIRST,
  type SortState, type TeamSortKey,
} from './ownership-model';

const HIDDEN = '–'; // an en dash: a hidden severity's cell. A missing figure is "—" (em dash) from dash().
const DIM = 'opacity-[0.35]';
/**
 * A numeric header cell is 79px wide at 1024px (with a 15px scrollbar), so its button is 63px at px-2. "RESOLVED ↕" and "% CLOSED ↕"
 * measure 66.6px and 67.1px with a 4px glyph gap, and a right-aligned flex item that is too wide spills to the LEFT. The left padding
 * shrinks to 4px (button 67px; the right padding stays 8px so the header's right edge still lines up with the figures below it) and
 * the glyph gap to 2px (the labels are then 64.6px and 65.1px): about 2px to spare, 4px with overlay scrollbars.
 */
const HEAD_PAD = 'pl-1 pr-2';
/** The name header's tooltip (on the cell and, so the button does not shadow it, on the button). */
const NAME_TITLE = "The repository's team custom property — not a Glooker team";
const GLYPH_GAP = 'gap-0.5';
/**
 * The Owning team track's share, against 1fr per numeric column. At 1024px with both Overdue columns the table is 928.9px wide, so
 * 1fr = (928.9 - 8) / (1.5 + 10) = 80.1px (79.4px at 1.6). 1.1 gave the numeric columns 3.6px more but cut three team names and the
 * "Owning team" header, so the label's width is reduced instead (HEAD_TRACKING) and the name track only gives up 0.1fr.
 */
const NAME_FR = 1.5;
/** The header labels use normal letter-spacing: the 0.06em tracking of TYPE.tableHeader is about 0.7px per letter, which put "% CLOSED" 2px past its cell at 1024px. Team table only. Important (`!`), because two letter-spacing utilities on one element are decided by their order in the generated stylesheet, not by their order in the class list. */
const HEAD_TRACKING = '!tracking-normal';
/** A row that holds a focusable child (the unmeasured badge) scrolls whole into view when that child takes focus. */
const scrollRowIntoView = (e: { currentTarget: HTMLElement }) => e.currentTarget.scrollIntoView?.({ block: 'nearest' });
/** A keyboard-focused row: an inset ring, so the scrolling body does not clip it. */
const ROW_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50';

const GROUPS: Array<{ sev: Severity; prefix: 'c' | 'h'; label: string; band: string; tint: string }> = [
  { sev: 'critical', prefix: 'c', label: 'CRITICAL', band: 'bg-red-500/20 text-red-400', tint: 'bg-crit-tint' },
  { sev: 'high', prefix: 'h', label: 'HIGH', band: 'bg-orange-500/20 text-orange-400', tint: 'bg-high-tint' },
];

type Col = 'Open' | 'Change' | 'Resolved' | 'Pct' | 'Overdue';
const sortKey = (prefix: 'c' | 'h', col: Col) => `${prefix}${col}` as TeamSortKey;

function changeCell(delta: number | null) {
  const text = delta === null ? '—' : delta > 0 ? `▲ ${dash(delta)}` : delta < 0 ? `▼ ${dash(-delta)}` : '0';
  const tone = delta === null || delta === 0 ? 'text-gray-600' : delta > 0 ? 'text-red-400' : 'text-green-400';
  // Keyed by its text: a baseline switch swaps one figure for another in every row, and in a
  // right-aligned cell an in-place text edit moves the text's start, which the layout-shift API
  // scores. A remounted span is a new object, not a moved one.
  return <span key={text} className={tone}>{text}</span>;
}

interface RowCtx {
  columns: Record<Severity, { overdue: boolean }>;
  severity: SecurityViewProps['url']['severity'];
  deltas: { critical: SecurityViewProps['summary']['delta']['critical']; high: SecurityViewProps['summary']['delta']['high'] };
}

/** The cells of one severity group for one row (or the Total row). */
function GroupCells({ row, g, ctx }: { row: TeamRow; g: typeof GROUPS[number]; ctx: RowCtx }) {
  const hasOverdue = ctx.columns[g.sev].overdue;
  const n = 4 + (hasOverdue ? 1 : 0);
  if (!sevShown(ctx.severity, g.sev)) {
    return <>{Array.from({ length: n }, (_, i) => <div key={i} role="cell" className={`${g.tint} px-2 text-right text-gray-600`}>{HIDDEN}</div>)}</>;
  }
  const c: SevCell = row[g.sev];
  const carried = c.resolved !== null && c.carriedResolved > 0;
  return (
    <>
      <div role="cell" className={`${g.tint} px-2 text-right font-semibold tabular-nums text-white`}>{dash(c.open)}</div>
      <div role="cell" className={`${g.tint} px-2 text-right tabular-nums`}>{changeCell(deltaOpenFor(ctx.deltas[g.sev], row.team))}</div>
      <div role="cell" className={`${g.tint} px-2 text-right tabular-nums text-gray-200`} title={`of which dismissed: ${dash(c.dismissed)}`}>
        {dash(c.resolved)}
        {carried && <span className="ml-0.5 text-warn" title={carriedTitle(c.carriedResolved)}>†</span>}
        <span className="ml-1 text-xs text-gray-500">({dash(c.dismissed)})</span>
      </div>
      <div role="cell" className={`${g.tint} px-2 text-right tabular-nums text-gray-300`}>{dash(c.pctClosed, '%')}</div>
      {hasOverdue && (
        <div role="cell" className={`${g.tint} px-2 text-right tabular-nums ${c.overdue ? 'font-bold text-red-400' : 'text-gray-600'}`}>{dash(c.overdue)}</div>
      )}
    </>
  );
}

function UnmeasuredBadge({ n, onOpen }: { n: number; onOpen: SecurityViewProps['openDrawer'] }) {
  return (
    <button
      type="button"
      className="mt-0.5 w-fit max-w-full truncate rounded border border-warn-line bg-warn-bg px-1 text-[10px] leading-4 text-warn"
      title={`Open counts for ${n} ${n === 1 ? 'repository are' : 'repositories are'} unknown. Their resolved alerts and measured history still count in this row.`}
      onClick={e => { e.stopPropagation(); onOpen(e.currentTarget); }}
    >
      {unmeasuredBadgeText(n)}
    </button>
  );
}

export default function TeamTable({ data, url, openDrawer }: SecurityViewProps) {
  const [sort, setSort] = useState<SortState<TeamSortKey> | null>(null);
  const view = slotView(data.teamSummary);

  if (view.kind === 'error') return <p data-testid="team-table-error" className="p-4 text-xs text-red-400">{view.text}</p>;
  if (view.kind === 'loading') return <p data-testid="team-table-loading" className="p-4 text-xs text-gray-500">Loading…</p>;
  if (view.kind === 'unavailable') return <p data-testid="team-table-unavailable" className="p-4 text-xs text-gray-500" title={view.title}>{view.text}</p>;
  const src = view.data;
  const columns: RowCtx['columns'] = {
    critical: { overdue: slaActive('critical', src) },
    high: { overdue: slaActive('high', src) },
  };
  const deltas = { critical: src.delta.critical, high: src.delta.high };
  const ctx: RowCtx = { columns, severity: url.severity, deltas };
  const rows = orderTeamRows(src.pivot.rows, sort, deltas, url.severity);
  const total = src.pivot.total;
  const nC = 4 + (columns.critical.overdue ? 1 : 0);
  const nH = 4 + (columns.high.overdue ? 1 : 0);
  const template = `minmax(0, ${NAME_FR}fr) repeat(${nC}, minmax(0, 1fr)) 8px repeat(${nH}, minmax(0, 1fr))`;
  const rowStyle = { display: 'grid', gridTemplateColumns: template } as const;
  // The caption is a display date ("vs Sep 29"); its title carries the measurement's ISO date.
  const baselineOf = (d: typeof deltas.critical) => ({
    text: deltaBaselineCaption(d) ?? baselineUnavailableText(d),
    title: d?.available && d.baseline ? `Change in open alerts since the measurement taken on ${d.baseline.takenOn}` : undefined,
  });
  const critBaseline = baselineOf(deltas.critical);
  const highBaseline = baselineOf(deltas.high);
  const carriedTotal = total.critical.carriedResolved;
  // The † footnote: only while the critical Resolved column it explains is shown (the same rule the card sizes the rows by).
  const showFootnote = hasCarriedFootnote(src, url.severity);
  // The sort the rows are in: with no header chosen it is the server's order, drawn as "Open ↓" on the Open column of the severity the tiles follow.
  const shownSort = shownTeamSort(sort, url.severity);
  const totalLabel = url.team ? 'Total · all owning teams' : 'Total';

  const header = (g: typeof GROUPS[number], col: Col, label: string, sub?: string, subTitle?: string, title?: string) => {
    const key = sortKey(g.prefix, col);
    const shown = sevShown(url.severity, g.sev);
    const active = shown && shownSort.key === key ? shownSort : null;
    return (
      <div role="columnheader" aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${g.tint} ${HEAD_PAD} ${shown ? '' : DIM}`} title={title}>
        <button
          type="button" disabled={!shown} title={title ?? label}
          className={`${TYPE.tableHeader} ${HEAD_TRACKING} flex w-full items-center justify-end ${GLYPH_GAP} whitespace-nowrap ${active ? 'text-white' : 'text-gray-400'} disabled:cursor-default`}
          onClick={() => setSort(s => nextSort(shownTeamSort(s, url.severity), key, TEAM_SORT_FIRST[key]))}
        >
          <span className="min-w-0 truncate">{label}</span>
          {shown && <span aria-hidden="true" className={`shrink-0 ${active ? 'text-accent-light' : 'text-gray-600'}`}>{sortGlyph(active)}</span>}
        </button>
        <div className="h-3.5 truncate text-right text-[10px] font-normal normal-case leading-[14px] tracking-normal text-gray-500" title={subTitle ?? sub} aria-hidden={sub ? undefined : true}>{sub ?? '\u00a0'}</div>
      </div>
    );
  };

  const band = (g: typeof GROUPS[number], span: number) => (
    <div role="columnheader" data-testid={`team-band-${g.sev}`} className={`${g.band} py-1 text-center text-[11px] font-semibold tracking-widest ${sevShown(url.severity, g.sev) ? '' : DIM}`} style={{ gridColumn: `span ${span}` }}>
      {g.label}
    </div>
  );
  const nameKey: TeamSortKey = 'name';
  const nameActive = shownSort.key === nameKey ? shownSort : null;
  const groupHeader = (g: typeof GROUPS[number], baseline: { text: string; title?: string }, hasOverdue: boolean) => (
    <>
      {header(g, 'Open', 'Open')}
      {header(g, 'Change', 'Change', baseline.text, baseline.title)}
      {header(g, 'Resolved', 'Resolved', '(dismissed)', undefined, `Resolved ${resolvedCaption(src.resolvedSince)}`)}
      {header(g, 'Pct', '% closed')}
      {hasOverdue && header(g, 'Overdue', 'Overdue')}
    </>
  );

  return (
    // The scrollbar gutter is reserved, so a table that starts to scroll does not narrow its columns.
    <div role="table" aria-label="Owning teams" data-testid="team-table" className={`h-full overflow-auto [scrollbar-gutter:stable]${view.dimmed ? ' opacity-60' : ''}`}
      // A row focused with the keyboard scrolls into view clear of the pinned header above it and the pinned Total row (and its footnote) below it.
      style={{ scrollPaddingTop: TEAM_HEAD_H, scrollPaddingBottom: TEAM_ROW_H + (showFootnote ? TEAM_FOOTNOTE_H : 0) }}>
      <div className="sticky top-0 bg-chart-surface" style={{ zIndex: Z.pinnedRows }}>
        <div role="row" style={{ ...rowStyle, height: TEAM_BAND_H }}>
          {/* A refresh of this same request failed: the rows stay, and the note fills the band row's first cell (it was an empty spacer), so
              the Owning team track caps its width (the note is cut with "…", the error in its title) and nothing moves. A cell, so the live
              note is something a row may contain. Live: the team table owns the announcement for the teamSummary request. */}
          <div role="cell" className="min-w-0">
            <RefreshNote error={view.refreshError} testId="team-table-refresh-note" live className="px-2 leading-6" />
          </div>
          {band(GROUPS[0], nC)}
          <div role="presentation" />
          {band(GROUPS[1], nH)}
        </div>
        <div role="row" style={{ ...rowStyle, height: TEAM_COLHEAD_H }} className="box-border items-end border-b border-gray-800">
          <div role="columnheader" aria-sort={nameActive ? (nameActive.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-2 pb-[18px]" title={NAME_TITLE}>
            <button type="button" title={NAME_TITLE} className={`${TYPE.tableHeader} ${HEAD_TRACKING} flex max-w-full items-center gap-1 whitespace-nowrap ${nameActive ? 'text-white' : 'text-gray-400'}`} onClick={() => setSort(s => nextSort(shownTeamSort(s, url.severity), nameKey, TEAM_SORT_FIRST[nameKey]))}>
              <span className="min-w-0 truncate">Owning team</span>
              <span aria-hidden="true" className={`shrink-0 ${nameActive ? 'text-accent-light' : 'text-gray-600'}`}>{sortGlyph(nameActive)}</span>
            </button>
          </div>
          {groupHeader(GROUPS[0], critBaseline, columns.critical.overdue)}
          <div role="presentation" />
          {groupHeader(GROUPS[1], highBaseline, columns.high.overdue)}
        </div>
      </div>

      {rows.map(r => {
        const selected = url.team === r.team;
        return (
          <div
            key={r.team} role="row" data-testid={`team-row-${r.team}`} tabIndex={0} aria-selected={selected}
            title={selected ? 'Clear the Owning team filter' : `Filter the page to ${r.team} and list its repositories`}
            className={`cursor-pointer items-center border-b border-gray-800/60 hover:bg-gray-800/30 ${ROW_FOCUS}${selected ? ' bg-accent/10' : ''}`}
            style={{ ...rowStyle, height: TEAM_ROW_H }}
            onClick={() => url.selectTeamRow(r.team)}
            // Focus on the nested badge scrolls only the badge into view, which can leave the row's top behind the pinned header: bring the whole row (React focus bubbles).
            onFocus={scrollRowIntoView}
            // A key pressed on the nested badge button belongs to the badge: the row must not preventDefault its click.
            onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); url.selectTeamRow(r.team); } }}
          >
            <div role="cell" className="flex min-w-0 flex-col justify-center px-2">
              <div className="flex min-w-0 items-center gap-1">
                <span className={`${TYPE.body} min-w-0 truncate ${selected ? 'font-semibold text-accent-light' : 'text-gray-100'}`} title={r.team}>{r.team}</span>
                {selected && <span aria-hidden="true" className="shrink-0 text-accent-light">×</span>}
              </div>
              {r.unmeasuredRepos > 0 && <UnmeasuredBadge n={r.unmeasuredRepos} onOpen={openDrawer} />}
            </div>
            <GroupCells row={r} g={GROUPS[0]} ctx={ctx} />
            <div role="presentation" />
            <GroupCells row={r} g={GROUPS[1]} ctx={ctx} />
          </div>
        );
      })}

      {/* The shadow above the pinned Total row says more rows are scrolled out of sight behind it. */}
      <div className="sticky bottom-0 bg-chart-surface shadow-[0_-6px_6px_-6px_rgba(0,0,0,0.45)]" style={{ zIndex: Z.pinnedRows }}>
        <div role="row" data-testid="team-total-row" className="items-center border-t border-gray-700 font-bold" style={{ ...rowStyle, height: TEAM_ROW_H }}>
          <div role="cell" className="flex min-w-0 flex-col justify-center px-2">
            {/* With a team selected the rows above still list every team, so say what the Total covers. */}
            <span data-testid="team-total-label" className={`${TYPE.body} truncate text-white`} title={totalLabel}>{totalLabel}</span>
            {total.unmeasuredRepos > 0 && <UnmeasuredBadge n={total.unmeasuredRepos} onOpen={openDrawer} />}
          </div>
          <GroupCells row={total} g={GROUPS[0]} ctx={ctx} />
          <div role="presentation" />
          <GroupCells row={total} g={GROUPS[1]} ctx={ctx} />
        </div>
        {showFootnote && (
          <p data-testid="team-table-footnote" className="truncate px-2 text-[11px] leading-5 text-gray-500" style={{ height: TEAM_FOOTNOTE_H }} title={carriedFootnote(carriedTotal)}>
            {carriedFootnote(carriedTotal)}
          </p>
        )}
      </div>
    </div>
  );
}
