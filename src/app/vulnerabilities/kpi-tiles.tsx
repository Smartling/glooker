// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H, TYPE } from './dimensions';
import { dash, signed } from './format';
import { displayDate, utcToday } from './labels';
import { baselineUnavailableText, openChange, usableTotal } from './overview-format';
import Sparkline, { sparkPoints } from './sparkline';

const TILE = 'bg-gray-900 rounded-xl p-4 min-w-0 h-full overflow-hidden flex flex-col';
const LABEL = `${TYPE.sectionLabel} truncate text-gray-400`;

function OpenTile({ summary, data, url }: SecurityViewProps) {
  const sev = url.kSev;
  const change = openChange(summary.delta[sev], sev);
  const spark = data.sparkline;
  return (
    <div data-testid="kpi-open" className={TILE}>
      <div className={LABEL}>Open {sev} alerts</div>
      <div className={`${TYPE.kpiValue} mt-1 text-white`}>{dash(summary.pivot.total[sev].open)}</div>
      {/* Always one line: the change sentence, or the reason there is none. */}
      <div data-testid="kpi-open-change" className={`h-5 truncate text-[13px] leading-5 ${change.toneClass}`} title={change.text}>
        {change.text}
      </div>
      <div className="mt-auto">
        <Sparkline
          points={spark.data ? sparkPoints(spark.data.series, url.team) : undefined}
          sev={sev}
          today={utcToday()}
          errorText={spark.errorText}
        />
      </div>
    </div>
  );
}

/** One "label  value" line of the since-baseline tile. */
function CountRow({ label, note, value }: { label: string; note?: string; value: number | null }) {
  return (
    <div className="flex h-5 items-baseline justify-between gap-2 text-sm leading-5">
      <span className="min-w-0 truncate text-gray-300">
        {label}
        {note && <span className="ml-1 text-xs text-gray-500">{note}</span>}
      </span>
      <span className={`shrink-0 font-semibold tabular-nums ${value === null ? 'text-gray-500' : 'text-white'}`}>{dash(value)}</span>
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
  const notInBaseline = d?.available && d.reposNotInBaseline > 0 ? `${d.reposNotInBaseline} repos not in baseline` : null;
  const other = total && total.other !== 0
    ? { text: `other ${signed(total.other)}`, title: `other ${signed(total.other)}: change in open alerts not explained by new, resolved or reopened` }
    : null;
  return (
    <div data-testid="kpi-since" className={TILE}>
      <div className={LABEL} title={d?.baseline ? `Compared with the measurement taken on ${d.baseline.takenOn}` : undefined}>
        {sev} since {d?.baseline ? displayDate(d.baseline.takenOn) : 'baseline'}
      </div>
      <div className="mt-1">
        <CountRow label="new" value={total ? total.new : null} />
        <CountRow label="resolved" note={total ? `(${total.dismissed} dismissed)` : undefined} value={total ? total.resolved : null} />
        <CountRow label="reopened" value={total ? total.reopened : null} />
      </div>
      {/* Three reserved one-line slots, whatever the delta holds, so the tile never changes shape. */}
      <div
        data-testid="kpi-since-other" aria-hidden={other ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-400" title={other?.title}
      >
        {other?.text ?? '\u00a0'}
      </div>
      <div
        data-testid="kpi-since-caption" aria-hidden={caption ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-500" title={caption ?? undefined}
      >
        {caption ?? '\u00a0'}
      </div>
      <div
        data-testid="kpi-since-repos" aria-hidden={notInBaseline ? undefined : true}
        className="h-4 truncate text-[11px] leading-4 text-gray-500" title={notInBaseline ?? undefined}
      >
        {notInBaseline ?? '\u00a0'}
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
    </section>
  );
}
