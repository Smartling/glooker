// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
// GLOOK-64: the Overview's four KPI tiles in a fixed 178px row. Every tile follows ONE severity
// (`url.kSev`: critical, or high when Severity is "High only"), never a sum of both. The tiles read
// the team-scoped summary (`props.summary`), so with an owning team selected they show that team.
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H, TYPE } from './dimensions';
import { dash } from './format';
import { utcToday } from './labels';
import { openChange } from './overview-format';
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
    </section>
  );
}
