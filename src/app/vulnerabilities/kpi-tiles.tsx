// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_NOTE_H, KPI_PAD_X, KPI_PAD_Y, KPI_ROW_H, KPI_SINCE_ROW_H, KPI_SLA_ROW_H, TYPE } from './dimensions';
import { slaState, slaStateLabel, type SlaState } from './sla-state';
import type { Severity } from '@/lib/vulnerabilities/types';
import { dash, resolvedCaption, signed } from './format';
import { displayDate, utcToday } from './labels';
import { baselineUnavailableText, carriedFootnote, carriedTitle, openChange, usableTotal } from './overview-format';
import { slotView } from './slot-view';
import Sparkline, { sparkPoints } from './sparkline';

const TILE = 'bg-gray-900 rounded-xl min-w-0 h-full overflow-hidden flex flex-col';
/** The tiles' padding: 18px 20px, inline from the constants (a utility class would be a second copy of the number). */
const TILE_STYLE = { padding: `${KPI_PAD_Y}px ${KPI_PAD_X}px` } as const;
const LABEL = `${TYPE.sectionLabel} truncate text-gray-400`;

function OpenTile({ summary, data, url }: SecurityViewProps) {
  const sev = url.kSev;
  // One "today" for the whole tile: the change sentence and the sparkline caption must print dates against the same year.
  const today = utcToday();
  const change = openChange(summary.delta[sev], sev, today);
  const spark = slotView(data.sparkline);
  return (
    <div data-testid="kpi-open" className={TILE} style={TILE_STYLE}>
      <div className={LABEL} title={`Open ${sev} alerts`}>Open {sev} alerts</div>
      <div data-testid="kpi-open-value" className={`${TYPE.kpiValue} mt-1 text-white`}>{dash(summary.pivot.total[sev].open)}</div>
      {/* Always one line: the change sentence, or the reason there is none. */}
      <div data-testid="kpi-open-change" className={`h-5 truncate text-[13px] leading-5 ${change.toneClass}`} title={change.text}>
        {change.text}
      </div>
      <div className="mt-auto">
        <Sparkline
          points={spark.kind === 'data' ? sparkPoints(spark.data.series, url.team) : undefined}
          sev={sev}
          today={today}
          errorText={spark.kind === 'error' ? spark.text : spark.kind === 'data' ? spark.refreshError : null}
          stale={spark.kind === 'data' && spark.dimmed}
          unavailableText={spark.kind === 'unavailable' ? spark.text : null}
        />
      </div>
    </div>
  );
}

/** One "label  value" line of the since-baseline tile. */
function CountRow({ label, note, value }: { label: string; note?: string; value: number | null }) {
  return (
    <div data-testid="kpi-since-row" className="flex items-baseline justify-between gap-3" style={{ height: KPI_SINCE_ROW_H, lineHeight: `${KPI_SINCE_ROW_H}px` }}>
      <span className="min-w-0 truncate text-[13px] leading-[inherit] text-gray-400" title={note ? `${label} ${note}` : label}>
        {label}
        {note && <span className="ml-1 text-xs text-gray-500">{note}</span>}
      </span>
      <span className={`shrink-0 text-lg font-bold leading-[inherit] tabular-nums ${value === null ? 'text-gray-500' : 'text-white'}`}>{dash(value)}</span>
    </div>
  );
}

function SinceTile({ summary, url }: SecurityViewProps) {
  const sev = url.kSev;
  const d = summary.delta[sev];
  const total = usableTotal(d);
  // The tile's own title names the baseline date, so there is no "vs <date>" caption; with no usable total the
  // caption says why there is no figure instead.
  const caption = total ? null : baselineUnavailableText(d);
  const sinceLabel = `${sev} since ${d?.baseline ? displayDate(d.baseline.takenOn) : 'baseline'}`;
  // Only beside figures that can be trusted: without a usable total the tile shows dashes and says why, not a count of repositories.
  const notInBaseline = total && d && d.reposNotInBaseline > 0 ? `${dash(d.reposNotInBaseline)} repos not in baseline` : null;
  const other = total && total.other !== 0
    ? { text: `other ${signed(total.other)}`, title: `other ${signed(total.other)}: change in open alerts not explained by new, resolved or reopened` }
    : null;
  return (
    <div data-testid="kpi-since" className={TILE} style={TILE_STYLE}>
      <div className={LABEL} title={d?.baseline ? `${sinceLabel}. Compared with the measurement taken on ${d.baseline.takenOn}` : sinceLabel}>
        {sinceLabel}
      </div>
      <div>
        <CountRow label="new" value={total ? total.new : null} />
        <CountRow label="resolved" note={total ? `(${dash(total.dismissed)} dismissed)` : undefined} value={total ? total.resolved : null} />
        <CountRow label="reopened" value={total ? total.reopened : null} />
      </div>
      {/* Three reserved one-line slots, whatever the delta holds, so the tile never changes shape. */}
      <div
        data-testid="kpi-since-other" aria-hidden={other ? undefined : true}
        className="truncate text-[11px] leading-4 text-gray-400" style={{ height: KPI_NOTE_H }} title={other?.title}
      >
        {other?.text ?? '\u00a0'}
      </div>
      <div
        data-testid="kpi-since-caption" aria-hidden={caption ? undefined : true}
        className="truncate text-[11px] leading-4 text-gray-500" style={{ height: KPI_NOTE_H }} title={caption ?? undefined}
      >
        {caption ?? '\u00a0'}
      </div>
      <div
        data-testid="kpi-since-repos" aria-hidden={notInBaseline ? undefined : true}
        className="truncate text-[11px] leading-4 text-gray-500" style={{ height: KPI_NOTE_H }} title={notInBaseline ?? undefined}
      >
        {notInBaseline ?? '\u00a0'}
      </div>
    </div>
  );
}

function ResolvedTile({ summary, url }: SecurityViewProps) {
  const sev = url.kSev;
  const c = summary.pivot.total[sev];
  // `resolved` is null when the start date is invalid: nothing carried can be trusted either.
  const carried = c.resolved !== null && c.carriedResolved > 0 ? c.carriedResolved : 0;
  const raised = c.open + (c.resolved ?? 0);
  const closedLine = c.resolved === null
    ? `${dash(c.pctClosed, '%')} closed`
    : raised === 0 ? 'None raised yet' : `${dash(c.pctClosed, '%')} of ${dash(raised)} raised are closed`;
  const footnote = carried > 0 ? carriedFootnote(carried) : null;
  const sinceText = `${dash(c.dismissed)} dismissed · ${resolvedCaption(summary.resolvedSince)}`;
  return (
    <div data-testid="kpi-resolved" className={TILE} style={TILE_STYLE}>
      <div className={LABEL} title={`Resolved ${sev}`}>Resolved {sev}</div>
      <div className={`${TYPE.kpiValue} mt-1 text-white`}>
        {dash(c.resolved)}
        {carried > 0 && <span className="ml-0.5 text-sm text-warn" title={carriedTitle(carried)}>†</span>}
      </div>
      <div data-testid="kpi-resolved-since" className="h-4 truncate text-xs leading-4 text-gray-400" title={sinceText}>
        {sinceText}
      </div>
      <div
        data-testid="kpi-resolved-footnote" aria-hidden={footnote ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-500" title={footnote ?? undefined}
      >
        {footnote ?? '\u00a0'}
      </div>
      <div data-testid="kpi-resolved-closed" className="mt-auto h-4 truncate text-xs leading-4 text-gray-400" title={closedLine}>{closedLine}</div>
    </div>
  );
}

const SLA_TIP: Record<Exclude<SlaState['kind'], 'active'>, string> = {
  pending: 'An SLA policy exists for this severity, but it has not started yet.',
  none: 'No SLA policy is configured for this severity.',
  invalid: "SLA policy can't be read: its configuration doesn't parse. Check the deployment configuration.",
};

/** The badge column has a fixed width so both rows and the header line up whatever the row shows. */
const SLA_COLS = '40px minmax(0, 1fr) minmax(0, 1fr)';

const SLA_BADGE: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'CRIT', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-400' },
};

/** One severity's row: Overdue and Due ≤ 7d while its policy is active, otherwise its state, spanning both columns. */
function SlaRow({ sev, summary, dimmed }: { sev: Severity; summary: SecurityViewProps['summary']; dimmed: boolean }) {
  const st = slaState(sev, summary);
  const cell = summary.pivot.total[sev];
  const badge = SLA_BADGE[sev];
  return (
    <div
      data-testid={`kpi-sla-${sev}`}
      className={`grid items-center gap-x-2${dimmed ? ' opacity-[0.35]' : ''}`}
      style={{ gridTemplateColumns: SLA_COLS, height: KPI_SLA_ROW_H }}
    >
      <span className={`w-fit rounded px-1.5 text-[10px] font-semibold leading-4 tracking-wide ${badge.cls}`}>{badge.label}</span>
      {st.kind === 'active' ? (
        <>
          <span className={`text-right text-lg font-semibold tabular-nums ${cell.overdue ? 'text-red-400' : 'text-white'}`}>{dash(cell.overdue)}</span>
          <span className="text-right text-lg font-semibold tabular-nums text-white">{dash(cell.dueSoon)}</span>
        </>
      ) : (
        <span
          data-testid={`kpi-sla-${sev}-state`}
          className={`col-span-2 truncate text-right text-sm ${st.kind === 'invalid' ? 'font-semibold text-red-400' : st.kind === 'pending' ? 'text-gray-300' : 'text-gray-400'}`}
          title={SLA_TIP[st.kind]}
        >
          {st.kind === 'invalid' && <span aria-hidden="true" className="mr-1 inline-block rounded-full bg-red-400 px-1.5 text-[10px] leading-4 text-gray-900">!</span>}
          {slaStateLabel(st, { withSla: false })}
        </span>
      )}
    </div>
  );
}

function SlaTile({ summary, url, openDrawer }: SecurityViewProps) {
  const shown = (sev: Severity) => url.severity === 'both' || url.severity === sev;
  return (
    <div data-testid="kpi-sla" className={TILE} style={TILE_STYLE}>
      {/* items-start: the title sits on the tile's top line like the other three tiles' titles, whatever the 24px button's height. */}
      <div className="flex items-start justify-between gap-2">
        <div className={LABEL} title="SLA · open alerts">SLA · open alerts</div>
        <button
          type="button" aria-label="Coverage and policy details" title="Coverage and policy details"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-600 text-[11px] leading-none text-gray-400 hover:text-white"
          onClick={e => openDrawer(e.currentTarget)}
        >
          i
        </button>
      </div>
      <div className="mt-2">
        <div className="grid items-center gap-x-2" style={{ gridTemplateColumns: SLA_COLS }}>
          <span />
          <span className={`${TYPE.tableHeader} text-right text-gray-500`}>Overdue</span>
          <span className={`${TYPE.tableHeader} text-right text-gray-500`}>Due ≤ 7d</span>
        </div>
        <SlaRow sev="critical" summary={summary} dimmed={!shown('critical')} />
        <SlaRow sev="high" summary={summary} dimmed={!shown('high')} />
      </div>
    </div>
  );
}

export default function KpiTiles(props: SecurityViewProps) {
  const stale = props.data.summary.stale;
  return (
    <section
      aria-label="Key figures"
      data-testid="kpi-tiles"
      className={`grid gap-4${stale ? ' opacity-60' : ''}`}
      style={{ height: KPI_ROW_H, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
    >
      <OpenTile {...props} />
      <SinceTile {...props} />
      <ResolvedTile {...props} />
      <SlaTile {...props} />
    </section>
  );
}
