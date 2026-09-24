'use client';
import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useUrlState } from '@/lib/url-state';
import { CODEBASE_GROUPS, CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import TeamPivot from './team-pivot';
import TrendChart from './trend-chart';
import { AlertsPanel, alertFilterQuery, type AlertListUiFilters } from './alerts-table';
import CoveragePanel from './coverage-panel';
import PolicyPanel from './policy-panel';
import { dash, signed, deltaClass, panelError, fetcher, vulnSwrOptions, resolvedCaption } from './format';
import { addDays } from '@/lib/vulnerabilities/time';

const BASELINES = [['last', 'Last sync'], ['7d', '7 days'], ['30d', '30 days']] as const;
const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`;
const panel = 'border border-gray-800 rounded-lg p-3 mt-3';

// J2-6: timeframe chips on the trend panel. `range` lives in URL state, default 'all'.
export type TrendRange = '30d' | '90d' | '1y' | 'all';
const TREND_RANGES = [['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['all', 'All']] as const;
const TREND_RANGE_DAYS: Record<Exclude<TrendRange, 'all'>, number> = { '30d': 30, '90d': 90, '1y': 365 };

/** Exported (this isn't a page.tsx file, so the App Router's default-export-only rule doesn't
 * apply) so the test computes its expectation the same way the component does, rather than
 * duplicating the day arithmetic. `all` sends nothing; every other range is today minus 30/90/365
 * days, in UTC — matching `addDays`'s UTC-midnight arithmetic used throughout this module. */
export function trendSince(range: TrendRange, now: Date): string | null {
  if (range === 'all') return null;
  const today = now.toISOString().slice(0, 10);
  return addDays(today, -TREND_RANGE_DAYS[range]);
}

/**
 * GLOOK-43 Wave P: the one place that renders the `configErrors` channel every `prepare()`-based
 * response carries (data responses and the Unavailable response alike, never the unknown-team/
 * unknown-repo/repo-not-tracked payloads — those are the caller's parameter to fix, not a config
 * problem). A `source: 'sync'` entry names when it will clear itself, since the next successful
 * sync overwrites it (queries.ts's syncConfigErrors reads only the latest succeeded/partial run);
 * a `source: 'startup'` entry has no such lifecycle — it clears only on the next restart with the
 * variable fixed.
 */
function ConfigErrorBanner({ errors }: { errors?: Array<{ source: string; variable: string; rule: string; at?: string }> }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2 space-y-0.5">
      {errors.map((e, i) => (
        <div key={i}>{e.rule}{e.source === 'sync' ? ` — clears after the next successful sync (as of ${e.at})` : ''}</div>
      ))}
    </div>
  );
}

export default function VulnerabilitiesContent() {
  const [codebase, setCodebase] = useUrlState<CodebaseGroup>({ key: 'codebase', type: 'enum', values: CODEBASE_GROUPS, default: 'backend', history: 'replace' });
  const [baseline, setBaseline] = useUrlState<string>({ key: 'baseline', type: 'string', default: 'last', history: 'replace' });
  const [team, setTeam] = useUrlState<string | null>({ key: 'team', type: 'string', default: null, history: 'replace' });
  const [severity, setSeverity] = useUrlState<'critical' | 'high'>({ key: 'sev', type: 'enum', values: ['critical', 'high'] as const, default: 'critical', history: 'replace' });
  const [range, setRange] = useUrlState<TrendRange>({ key: 'range', type: 'enum', values: ['30d', '90d', '1y', 'all'] as const, default: 'all', history: 'replace' });
  const [alertFilters, setAlertFilters] = useState<AlertListUiFilters>({ state: 'open', overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', repo: null });
  // J2-5: alertFilters.repo is local, alert-only state — but it must be cleared whenever the
  // page-wide team or codebase changes, and the very NEXT alerts request has to reflect that
  // already, not one request later. Adjusting state during render (rather than in a useEffect,
  // which runs after this render's alerts SWR key has already been computed) is the standard
  // pattern for resetting derived state when a prop changes: when the scope key differs from the
  // one seen last render, React discards this render's output and re-renders immediately with the
  // cleared repo, before any fetch for the stale key is ever kicked off.
  const repoScopeKey = `${codebase}\0${team ?? ''}`;
  const [prevRepoScopeKey, setPrevRepoScopeKey] = useState(repoScopeKey);
  if (prevRepoScopeKey !== repoScopeKey) {
    setPrevRepoScopeKey(repoScopeKey);
    if (alertFilters.repo !== null) setAlertFilters(f => ({ ...f, repo: null }));
  }
  const qs = new URLSearchParams({ codebase, baseline, ...(team ? { team } : {}) }).toString();
  // C7: keepPreviousData on every panel, so a codebase/team/baseline change swaps the SWR key but
  // keeps rendering the previous key's data instead of blanking the section while the new key
  // loads. `isLoading` — true only for a key that has never resolved before — combined with
  // `data` still present is exactly "these rows belong to the previous key", the stale signal used
  // below; a same-key revalidation (e.g. a `mutate()` refetch; focus and reconnect revalidation are
  // off app-wide in `SWRProvider`) leaves `isLoading` false since that key already has data, so the
  // indicator doesn't flash on every refetch the way `isValidating` did.
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useSWR(`/api/vulnerabilities/summary?${qs}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const trendSinceParam = trendSince(range, new Date());
  const { data: trend, error: trendError, isLoading: trendLoading } = useSWR(`/api/vulnerabilities/trend?codebase=${codebase}&severity=${severity}${trendSinceParam ? `&since=${trendSinceParam}` : ''}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const { data: alerts, error: alertsError, isLoading: alertsLoading } = useSWR(`/api/vulnerabilities/alerts?codebase=${codebase}${team ? `&team=${encodeURIComponent(team)}` : ''}&${alertFilterQuery(alertFilters)}&limit=200`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const { data: coverage, error: coverageError, isLoading: coverageLoading } = useSWR(`/api/vulnerabilities/coverage${team ? `?team=${encodeURIComponent(team)}` : ''}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const summaryStale = summaryLoading && !!summary;
  const trendStale = trendLoading && !!trend;
  const coverageStale = coverageLoading && !!coverage;

  // GLOOK-43 Wave H: for any summary error other than an unknown team, the page fails visibly
  // with a single error line, whether or not `summary` still holds data. That is deliberate (user
  // decision, 2026-09-23): an error the user can see beats figures they can't trust. keepPreviousData
  // keeps the previous key's summary across a team/codebase/baseline change, and rendering it put
  // stale numbers under the new label. The filters live in the URL, so a reload re-requests the
  // same view; it recovers from a transient failure.
  if (summaryError) {
    // D1: withFilters' 400 `{ error, known_teams }` now arrives as an SWR error (the shared
    // fetcher throws on !r.ok), not as `summary` data — read the body off `.info` instead.
    const info = (summaryError as any)?.info;
    if (info?.known_teams) {
      return (
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-lg font-semibold text-white">Vulnerabilities</h1>
          <p className="text-sm text-red-400 mt-2">{info.error}</p>
          <p className="text-xs text-gray-500 mt-1">Known teams: {info.known_teams.join(', ')}</p>
          {team && (
            <button className="text-xs text-indigo-400 mt-3 inline-block" onClick={() => setTeam(null)}>
              Clear team filter
            </button>
          )}
        </div>
      );
    }
    return <div className="max-w-7xl mx-auto px-4 py-8 text-red-400 text-sm">{panelError(summaryError, 'summary')}</div>;
  }
  if (!summary) return <div className="max-w-7xl mx-auto px-4 py-8 text-gray-500 text-sm">Loading…</div>;
  if (!summary.available) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-lg font-semibold text-white">Vulnerabilities</h1>
        <p className="text-sm text-gray-400 mt-2">{summary.reason}</p>
        <ConfigErrorBanner errors={summary.configErrors} />
        {summary.sync?.lastStatus === 'failed' && <p className="text-sm text-red-400 mt-1">The last sync failed: {summary.sync.issues?.[0]?.message}</p>}
        <Link href="/reports?tab=syncs" className="text-xs text-indigo-400 mt-3 inline-block">Sync history →</Link>
      </div>
    );
  }
  const s = summary;
  const crit = s.pivot.total.critical;
  const dc = s.delta.critical;
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold text-white">Vulnerabilities · {s.org}</h1>
        <span className={`text-xs ${s.sync.stale ? 'text-amber-400' : 'text-gray-500'}`}>last successful sync {s.sync.lastSuccessfulAt}</span>
        <Link href="/reports?tab=syncs" className="text-xs text-indigo-400">sync history →</Link>
        {summaryStale && <span className="text-[11px] text-indigo-400">Updating…</span>}
      </div>
      <ConfigErrorBanner errors={s.configErrors} />
      {s.sync.lastStatus === 'failed' && <div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2">The latest sync failed; showing data from the last good sync. {s.sync.issues?.[0]?.message}</div>}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <span className="text-xs text-gray-500">Codebase:</span>
        {CODEBASE_GROUPS.map(g => <button key={g} className={chip(codebase === g)} onClick={() => setCodebase(g)}>{CODEBASE_LABELS[g]}</button>)}
        <span className="text-xs text-gray-500 ml-auto">Compare to:</span>
        {BASELINES.map(([v, l]) => <button key={v} className={chip(baseline === v)} onClick={() => setBaseline(v)}>{l}</button>)}
        <input type="date" className="bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1"
          value={/^\d{4}-\d{2}-\d{2}$/.test(baseline) ? baseline : ''} onChange={e => e.target.value && setBaseline(e.target.value)} />
      </div>
      {team && <div className="mt-2 text-xs text-gray-400">Filtered to team <b className="text-white">{team}</b> <button className="text-indigo-400 ml-1" onClick={() => setTeam(null)}>clear</button></div>}

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 mt-4${summaryStale ? ' opacity-60' : ''}`}>
        <div className={panel}><div className="text-[11px] text-gray-500">Open critical alerts</div>
          <div className="text-2xl font-semibold text-white">{dash(crit.open)} {dc.available && dc.total && <span className={`text-sm ${deltaClass(dc.total.deltaOpen)}`}>{signed(dc.total.deltaOpen)}</span>}</div>
          {s.kpi.openCriticalOtherCodebases !== null && <div className="text-[11px] text-gray-500">+{s.kpi.openCriticalOtherCodebases} in other codebase types</div>}</div>
        <div className={panel}><div className="text-[11px] text-gray-500">Critical: new / resolved (dismissed) / reopened</div>
          {dc.available && dc.total
            ? <div className="text-lg font-semibold text-white">{dc.total.new} / {dc.total.resolved} ({dc.total.dismissed}) / {dc.total.reopened}{dc.total.other !== 0 && <span className="text-xs text-gray-400"> · other {signed(dc.total.other)}</span>}</div>
            : <div className="text-sm text-gray-500">— no measurement for this view before {dc.baseline?.takenOn ?? 'the chosen baseline'}</div>}
          {dc.available && dc.reposNotInBaseline > 0 && <div className="text-[11px] text-gray-500">{dc.reposNotInBaseline} repos not in baseline</div>}</div>
        <div className={panel}><div className="text-[11px] text-gray-500">Resolved critical {resolvedCaption(s.resolvedSince)}</div>
          <div className="text-2xl font-semibold text-white">
            {dash(crit.resolved)}
            {crit.resolved !== null && !!crit.carriedResolved && (
              <span className="ml-0.5 text-sm text-amber-400" title={`Includes ${crit.carriedResolved} carried over from imported CSV history (archived repo with no alert data)`}>†</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500">{dash(crit.pctClosed, '%')} closed · {dash(crit.dismissed)} dismissed</div></div>
        <div className={panel}><div className="text-[11px] text-gray-500">Critical SLA</div>
          {/* GLOOK-43 Wave P: an invalid VULNERABILITIES_SLA_POLICY parses to an empty policy
              (config.ts), so slaStatus reads 'none' for both severities exactly as it would for a
              genuinely empty policy — check slaPolicyInvalid first so an invalid policy never
              reads as merely empty. */}
          <div className="text-sm font-semibold text-amber-400">{s.slaStatus.critical === 'pending' ? `Starts ${s.policy.find((p: any) => p.severity === 'critical')?.effectiveFrom}` : s.slaStatus.critical === 'active' ? `${dash(crit.overdue)} overdue · ${dash(crit.dueSoon)} due ≤ 7d` : s.slaPolicyInvalid ? 'SLA policy configuration is invalid' : 'none'}</div>
          <div className="text-[11px] text-gray-500">High: {s.slaStatus.high === 'pending' ? `Starts ${s.policy.find((p: any) => p.severity === 'high')?.effectiveFrom}` : s.slaStatus.high === 'none' ? (s.slaPolicyInvalid ? 'SLA policy configuration is invalid' : 'SLA not yet active') : s.slaStatus.high}</div></div>
      </div>

      <div className={panel}>
        <h2 className="text-sm text-white mb-2">By team <span className="text-xs text-gray-500">(click a row to filter the page)</span></h2>
        <div className={summaryStale ? 'opacity-60' : undefined}>
          <TeamPivot rows={s.pivot.rows} total={s.pivot.total} delta={s.delta} highSlaActive={s.slaStatus.high === 'active'}
            resolvedSince={s.resolvedSince} onSelectTeam={setTeam} selectedTeam={team} />
        </div>
      </div>

      <div className={panel}>
        <div className="flex items-center gap-2 mb-2"><h2 className="text-sm text-white">Open alerts over time</h2>
          <button className={chip(severity === 'critical')} onClick={() => setSeverity('critical')}>Critical</button>
          <button className={chip(severity === 'high')} onClick={() => setSeverity('high')}>High</button>
          <span className="text-xs text-gray-500 ml-2">Range:</span>
          {TREND_RANGES.map(([v, l]) => <button key={v} className={chip(range === v)} onClick={() => setRange(v)}>{l}</button>)}
          {(() => {
            const trendErrMsg = panelError(trendError, 'trend');
            return trendStale && !trendErrMsg ? <span className="text-[11px] text-indigo-400">Updating…</span> : null;
          })()}
        </div>
        {(() => {
          const err = panelError(trendError, 'trend');
          if (err) return <p className="text-xs text-red-400">{err}</p>;
          return trend?.series
            ? <div className={trendStale ? 'opacity-60' : undefined}><TrendChart series={team ? trend.series.filter((x: any) => x.team === team) : trend.series} /></div>
            : <p className="text-xs text-gray-500">Loading…</p>;
        })()}
      </div>

      <div className={panel}>
        <AlertsPanel data={alerts?.rows ? { rows: alerts.rows, totalCount: alerts.totalCount, truncated: alerts.truncated, repos: alerts.repos } : undefined}
          error={alertsError} isLoading={alertsLoading} filters={alertFilters} onFiltersChange={setAlertFilters}
          team={team} teams={s.knownTeams ?? []} onTeamChange={setTeam}
          slaStatus={s.slaStatus} policy={s.policy} policyInvalid={s.slaPolicyInvalid} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className={panel}>
          <div className="flex items-center gap-2 mb-2"><h2 className="text-sm text-white">Coverage gaps</h2>
            {(() => {
              const coverageErrMsg = panelError(coverageError, 'coverage');
              return coverageStale && !coverageErrMsg ? <span className="text-[11px] text-indigo-400">Updating…</span> : null;
            })()}
          </div>
          {(() => {
            const err = panelError(coverageError, 'coverage');
            if (err) return <p className="text-xs text-red-400">{err}</p>;
            return coverage?.needsTagging
              ? <div className={coverageStale ? 'opacity-60' : undefined}><CoveragePanel coverage={coverage} /></div>
              : <p className="text-xs text-gray-500">Loading…</p>;
          })()}
        </div>
        <div className={panel}><h2 className="text-sm text-white mb-2">Policy</h2><PolicyPanel policy={s.policy} highActive={s.slaStatus.high === 'active'} resolvedSince={s.resolvedSince} scope={s.scope} policyInvalid={s.slaPolicyInvalid} /></div>
      </div>
    </div>
  );
}
