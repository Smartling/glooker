'use client';
import type { TeamRow, SevCell, DeltaResult } from '@/lib/vulnerabilities/aggregate';
import type { ResolvedSince } from '@/lib/vulnerabilities/types';
import { dash, signed, deltaClass, resolvedCaption, deltaBaselineCaption } from './format';

interface Props {
  rows: TeamRow[]; total: TeamRow;
  delta: { critical: DeltaResult; high: DeltaResult } | null;
  highSlaActive: boolean; resolvedSince: ResolvedSince;
  onSelectTeam: (team: string | null) => void; selectedTeam: string | null;
}

const C = 'bg-red-500/5';     // critical band tint
const H = 'bg-orange-500/5';  // high band tint

function deltaFor(delta: DeltaResult | undefined, team: string): string | null {
  if (!delta || !delta.available) return null;
  const t = team === 'Total' ? delta.total : delta.teams.find(x => x.team === team);
  return t ? signed(t.deltaOpen) : null;
}

function Cells({ c, tint, showOverdue, d, unmeasured }: { c: SevCell; tint: string; showOverdue: boolean; d: string | null; unmeasured?: number }) {
  const dv = d === null ? null : Number(d);
  return (
    <>
      <td className={`${tint} px-2 py-1.5 text-right tabular-nums font-semibold text-white`}>
        {dash(c.open)}
        {!!unmeasured && <span className="ml-1 text-[10px] text-amber-400">{unmeasured} repos unmeasured</span>}
      </td>
      {/* The value sits in a span keyed by its text: a baseline switch swaps "+12" for "—" (or back)
          in every row, and in a right-aligned cell an in-place text edit moves the text's start, which
          the browser's layout-shift API scores. A remounted span is a new object, not a moved one. */}
      <td className={`${tint} px-2 py-1.5 text-right tabular-nums`}><span key={d ?? '—'} className={dv === null ? 'text-gray-600' : deltaClass(dv)}>{d ?? '—'}</span></td>
      <td className={`${tint} px-2 py-1.5 text-right tabular-nums`} title={`of which dismissed: ${dash(c.dismissed)}`}>
        {dash(c.resolved)}
        {c.resolved !== null && !!c.carriedResolved && (
          <span className="ml-0.5 text-amber-400" title={`Includes ${c.carriedResolved} carried over from imported CSV history (archived repo with no alert data)`}>†</span>
        )}
      </td>
      <td className={`${tint} px-2 py-1.5 text-right tabular-nums`}>{dash(c.pctClosed, '%')}</td>
      {showOverdue && <td className={`${tint} px-2 py-1.5 text-right tabular-nums ${c.overdue ? 'text-red-400' : ''}`}>{dash(c.overdue)}</td>}
    </>
  );
}

export default function TeamPivot({ rows, total, delta, highSlaActive, resolvedSince, onSelectTeam, selectedTeam }: Props) {
  const critBaselineCaption = deltaBaselineCaption(delta?.critical);
  // Critical and high share one baseline set, but high is unavailable when the baseline is a
  // csv-import set (those never measure high) — so high's own caption can be null even when
  // critical's isn't.
  const highBaselineCaption = deltaBaselineCaption(delta?.high);
  // The Δ caption slot always renders (a non-breaking space when there is no delta). Without it the
  // "Δ" glyph sits at a different height than next to a caption, and a baseline switch (e.g. to a
  // csv-import baseline, which never measures high) changed the column's WIDTH, since "vs 2099-01-01"
  // is far wider than "Δ", shifting every column to its right. The width floor sits on the caption
  // block, sized for "vs YYYY-MM-DD" at 10px, because a min-width on a <th> is not reliably honoured
  // by auto table layout.
  const head = (tint: string, overdue: boolean, deltaCaption: string | null, sev: 'critical' | 'high') => (
    <>
      <th className={`${tint} px-2 py-1 text-right font-medium`}>Open</th>
      <th className={`${tint} px-2 py-1 text-right font-medium`}>Δ<div data-testid={`pivot-delta-caption-${sev}`} aria-hidden={deltaCaption ? undefined : true} className="min-w-[76px] text-[10px] font-normal text-gray-500">{deltaCaption ?? '\u00a0'}</div></th>
      <th className={`${tint} px-2 py-1 text-right font-medium`}>Resolved<div className="text-[10px] font-normal text-gray-500">{resolvedCaption(resolvedSince)}</div></th>
      <th className={`${tint} px-2 py-1 text-right font-medium`}>% closed</th>
      {overdue && <th className={`${tint} px-2 py-1 text-right font-medium`}>Overdue</th>}
    </>
  );
  const row = (r: TeamRow, isTotal = false) => (
    <tr key={r.team}
      onClick={isTotal ? undefined : () => onSelectTeam(selectedTeam === r.team ? null : r.team)}
      className={`border-b border-gray-800/60 ${isTotal ? 'font-semibold' : 'cursor-pointer hover:bg-gray-800/30'} ${selectedTeam === r.team ? 'bg-indigo-500/10' : ''}`}>
      <td className="px-2 py-1.5 text-left text-gray-200">
        {r.team}
      </td>
      <Cells c={r.critical} tint={C} showOverdue d={deltaFor(delta?.critical, r.team)} unmeasured={r.unmeasuredRepos} />
      <td className="w-3" />
      <Cells c={r.high} tint={H} showOverdue={highSlaActive} d={deltaFor(delta?.high, r.team)} />
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-gray-300">
        <thead>
          <tr>
            <th />
            <th colSpan={5} className="bg-red-500/20 text-red-400 tracking-widest text-[11px] py-1">CRITICAL</th>
            <th className="w-3" />
            <th colSpan={highSlaActive ? 5 : 4} className="bg-orange-500/20 text-orange-400 tracking-widest text-[11px] py-1">HIGH</th>
          </tr>
          <tr className="text-gray-400">
            <th className="px-2 py-1 text-left font-medium">Team</th>
            {head(C, true, critBaselineCaption, 'critical')}
            <th className="w-3" />
            {head(H, highSlaActive, highBaselineCaption, 'high')}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => row(r))}
          {row(total, true)}
        </tbody>
      </table>
      {total.critical.resolved !== null && !!total.critical.carriedResolved && (
        <p className="text-[11px] text-gray-500 mt-1">
          † Resolved includes {total.critical.carriedResolved} carried over from imported CSV history for archived repos Glooker never synced.
        </p>
      )}
    </div>
  );
}
