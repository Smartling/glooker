'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useUrlState } from '@/lib/url-state';
import { CODEBASE_GROUPS, CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import PageHeader from '@/components/PageHeader';
import DataFreshness from '@/components/runs/DataFreshness';
import TeamPivot from './team-pivot';
import TrendChart from './trend-chart';
import { assignTeamColors } from './team-colors';
import { AlertsPanel, alertFilterQuery, type AlertListUiFilters } from './alerts-table';
import CoveragePanel from './coverage-panel';
import PolicyPanel from './policy-panel';
import { dash, signed, deltaClass, panelError, fetcher, vulnSwrOptions, resolvedCaption, deltaBaselineCaption } from './format';
import { addDays } from '@/lib/vulnerabilities/time';

const BASELINES = [['last', 'Last sync'], ['7d', '7 days'], ['30d', '30 days']] as const;
const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-accent border-accent text-white' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`;
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
  const [codebase, setCodebase] = useUrlState<CodebaseGroup>({ key: 'codebase', type: 'enum', values: CODEBASE_GROUPS, default: 'backend', history: 'replace', scroll: false });
  const [baseline, setBaseline] = useUrlState<string>({ key: 'baseline', type: 'string', default: 'last', history: 'replace', scroll: false });
  const [team, setTeam] = useUrlState<string | null>({ key: 'team', type: 'string', default: null, history: 'replace', scroll: false });
  const [severity, setSeverity] = useUrlState<'critical' | 'high'>({ key: 'sev', type: 'enum', values: ['critical', 'high'] as const, default: 'critical', history: 'replace', scroll: false });
  const [range, setRange] = useUrlState<TrendRange>({ key: 'range', type: 'enum', values: ['30d', '90d', '1y', 'all'] as const, default: 'all', history: 'replace', scroll: false });
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
  // The "By team" pivot deliberately never scopes to the selected team — selecting a row would
  // otherwise collapse the table to that one row + Total, which both breaks the point of a
  // selected-row highlight (nothing else to compare it against) and shrinks the page enough to
  // move the scroll position out from under the user. Same param order/encoding as `qs` above so
  // the two SWR keys are byte-identical (and dedupe to one request) whenever no team is selected.
  const pivotQs = new URLSearchParams({ codebase, baseline }).toString();
  // C7: keepPreviousData on every panel, so a codebase/team/baseline change swaps the SWR key but
  // keeps rendering the previous key's data instead of blanking the section while the new key
  // loads. `isLoading` — true only for a key that has never resolved before — combined with
  // `data` still present is exactly "these rows belong to the previous key", the stale signal used
  // below; a same-key revalidation (e.g. a `mutate()` refetch; focus and reconnect revalidation are
  // off app-wide in `SWRProvider`) leaves `isLoading` false since that key already has data, so the
  // indicator doesn't flash on every refetch the way `isValidating` did.
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useSWR(`/api/vulnerabilities/summary?${qs}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const { data: pivotSummary, error: pivotSummaryError, isLoading: pivotSummaryLoading } = useSWR(`/api/vulnerabilities/summary?${pivotQs}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const trendSinceParam = trendSince(range, new Date());
  const { data: trend, error: trendError, isLoading: trendLoading } = useSWR(`/api/vulnerabilities/trend?codebase=${codebase}&severity=${severity}${trendSinceParam ? `&since=${trendSinceParam}` : ''}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const { data: alerts, error: alertsError, isLoading: alertsLoading } = useSWR(`/api/vulnerabilities/alerts?codebase=${codebase}${team ? `&team=${encodeURIComponent(team)}` : ''}&${alertFilterQuery(alertFilters)}&limit=200`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const { data: coverage, error: coverageError, isLoading: coverageLoading } = useSWR(`/api/vulnerabilities/coverage${team ? `?team=${encodeURIComponent(team)}` : ''}`, fetcher, { keepPreviousData: true, ...vulnSwrOptions });
  const summaryStale = summaryLoading && !!summary;
  const pivotStale = pivotSummaryLoading && !!pivotSummary;
  const trendStale = trendLoading && !!trend;
  const coverageStale = coverageLoading && !!coverage;
  // GLOOK-58 Decision 11: built from the UNFILTERED trend series, before the team filter below, so
  // a team keeps its colour when the page filter narrows the chart. Memoized because it's an O(n
  // log n) sort over every team on every render otherwise, keyed on trend.series so it only
  // recomputes when the trend response actually changes (not on every unrelated re-render, e.g.
  // an alertFilters update).
  const colorByTeam = useMemo(() => assignTeamColors(trend?.series ?? []), [trend?.series]);

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
          <h1 className="text-lg font-semibold text-white">Security</h1>
          <p className="text-sm text-red-400 mt-2">{info.error}</p>
          <p className="text-xs text-gray-500 mt-1">Known teams: {info.known_teams.join(', ')}</p>
          {team && (
            <button className="text-xs text-accent-light mt-3 inline-block" onClick={() => setTeam(null)}>
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
        <h1 className="text-lg font-semibold text-white">Security</h1>
        <p className="text-sm text-gray-400 mt-2">{summary.reason}</p>
        <ConfigErrorBanner errors={summary.configErrors} />
        {summary.sync?.lastStatus === 'failed' && <p className="text-sm text-red-400 mt-1">The last sync failed: {summary.sync.issues?.[0]?.message}</p>}
        <Link href="/reports?tab=syncs" className="text-xs text-accent-light mt-3 inline-block">Sync history →</Link>
      </div>
    );
  }
  const s = summary;
  const crit = s.pivot.total.critical;
  const dc = s.delta.critical;
  const dcCaption = deltaBaselineCaption(dc);
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <PageHeader
        title={`Security · ${s.org}`}
        freshness={
          <DataFreshness
            label="last successful sync"
            at={s.sync.lastSuccessfulAt}
            stale={s.sync.stale}
            // Label only here — this row shares a flex line with `badges` and has no wrap, so the
            // failed-sync banner is rendered separately below (bannerOnly, in `children`) instead of
            // being squeezed into this row (GLOOK-59 final fix item 2).
            latestFailed={false}
            failedText="The latest sync failed; showing data from the last good sync."
            failedDetail={s.sync.issues?.[0]?.message}
          />
        }
        badges={
          <>
            <Link href="/reports?tab=syncs" className="text-xs text-accent-light">sync history →</Link>
            {summaryStale && <span className="text-[11px] text-accent-light">Updating…</span>}
          </>
        }
      >
        <DataFreshness
          label="last successful sync"
          at={s.sync.lastSuccessfulAt}
          stale={s.sync.stale}
          latestFailed={s.sync.lastStatus === 'failed'}
          failedText="The latest sync failed; showing data from the last good sync."
          failedDetail={s.sync.issues?.[0]?.message}
          bannerOnly
        />
        <ConfigErrorBanner errors={s.configErrors} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <span className="text-xs text-gray-500">Codebase:</span>
        {CODEBASE_GROUPS.map(g => <button key={g} className={chip(codebase === g)} onClick={() => setCodebase(g)}>{CODEBASE_LABELS[g]}</button>)}
        <span className="text-xs text-gray-500 ml-auto">Compare to:</span>
        {BASELINES.map(([v, l]) => <button key={v} className={chip(baseline === v)} onClick={() => setBaseline(v)}>{l}</button>)}
        <input type="date" className="bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1"
          value={/^\d{4}-\d{2}-\d{2}$/.test(baseline) ? baseline : ''} onChange={e => e.target.value && setBaseline(e.target.value)} />
      </div>
      {/* Always rendered, same classes and fixed height in both states: the "Filtered to owning team" line used
          to appear only with a team set, pushing everything below it down on every team change. The
          name truncates (a long one can't wrap) and the clear button never does. */}
      <div data-testid="team-line" className="mt-2 h-4 flex items-center text-xs leading-4 text-gray-400 whitespace-nowrap">
        {team ? (
          <>
            <span className="shrink-0 whitespace-pre">Filtered to owning team </span>
            <b className="min-w-0 max-w-[24rem] truncate text-white" title={team}>{team}</b>
            <button className="ml-1 shrink-0 text-accent-light" onClick={() => setTeam(null)}>clear</button>
          </>
        ) : 'Showing all owning teams'}
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 mt-4${summaryStale ? ' opacity-60' : ''}`}>
        <div className={panel}><div className="text-[11px] text-gray-500">Open critical alerts</div>
          <div className="text-2xl font-semibold text-white">{dash(crit.open)} {dc.available && dc.total && <span className={`text-sm ${deltaClass(dc.total.deltaOpen)}`}>{signed(dc.total.deltaOpen)}</span>}</div>
          {/* The caption slot always renders: a delta-less view used to be one line shorter. */}
          <div data-testid="kpi1-caption" aria-hidden={dcCaption ? undefined : true} className="text-[11px] leading-4 text-gray-500">{dcCaption ?? '\u00a0'}</div>
          {s.kpi.openCriticalOtherCodebases !== null && <div className="text-[11px] text-gray-500">+{s.kpi.openCriticalOtherCodebases} in other codebase types</div>}</div>
        <div className={panel}><div className="text-[11px] text-gray-500">Critical: new / resolved (dismissed) / reopened</div>
          {/* Both branches share one shape: a figure line and two reserved lines, at fixed heights, so
              the tile can't resize when the delta appears or disappears. The figure line truncates
              (its title holds the full text), so "· other ±N" can't force a second line. */}
          {(() => {
            const total = dc.available ? dc.total : null;
            const figure = total
              ? `${total.new} / ${total.resolved} (${total.dismissed}) / ${total.reopened}${total.other !== 0 ? ` · other ${signed(total.other)}` : ''}`
              : '—';
            const caption = total ? dcCaption : `no measurement for this view before ${dc.baseline?.takenOn ?? 'the chosen baseline'}`;
            const baseRepos = dc.available && dc.reposNotInBaseline > 0 ? `${dc.reposNotInBaseline} repos not in baseline` : null;
            return (
              <>
                <div className={`h-7 truncate text-lg leading-7 font-semibold ${total ? 'text-white' : 'text-gray-500'}`} title={figure}>
                  {total
                    ? <>{total.new} / {total.resolved} ({total.dismissed}) / {total.reopened}{total.other !== 0 && <span className="text-xs text-gray-400"> · other {signed(total.other)}</span>}</>
                    : figure}
                </div>
                <div data-testid="kpi2-caption" className="h-4 truncate text-[11px] leading-4 text-gray-500" title={caption ?? undefined}>{caption}</div>
                <div data-testid="kpi2-baseline-repos" aria-hidden={baseRepos ? undefined : true} className="h-4 truncate text-[11px] leading-4 text-gray-500" title={baseRepos ?? undefined}>{baseRepos ?? '\u00a0'}</div>
              </>
            );
          })()}</div>
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
        <h2 className="text-sm text-white mb-2">By owning team <span className="text-xs text-gray-500">(click a row to filter the page)</span></h2>
        {(() => {
          const err = panelError(pivotSummaryError, 'team table');
          if (err) return <p className="text-xs text-red-400">{err}</p>;
          // Falls back to the (team-scoped) main summary's pivot only until the unfiltered
          // request first resolves — e.g. a deep link that arrives with `?team=` already set.
          const pivotView = pivotSummary?.pivot ? pivotSummary : s;
          return (
            <div className={pivotStale ? 'opacity-60' : undefined}>
              <TeamPivot rows={pivotView.pivot.rows} total={pivotView.pivot.total} delta={pivotView.delta} highSlaActive={s.slaStatus.high === 'active'}
                resolvedSince={s.resolvedSince} onSelectTeam={setTeam} selectedTeam={team} />
            </div>
          );
        })()}
      </div>

      <div className={panel}>
        <div className="flex items-center gap-2 mb-2"><h2 className="text-sm text-white">Open alerts over time</h2>
          <button className={chip(severity === 'critical')} onClick={() => setSeverity('critical')}>Critical</button>
          <button className={chip(severity === 'high')} onClick={() => setSeverity('high')}>High</button>
          <span className="text-xs text-gray-500 ml-2">Range:</span>
          {TREND_RANGES.map(([v, l]) => <button key={v} className={chip(range === v)} onClick={() => setRange(v)}>{l}</button>)}
          {(() => {
            const trendErrMsg = panelError(trendError, 'trend');
            return trendStale && !trendErrMsg ? <span className="text-[11px] text-accent-light">Updating…</span> : null;
          })()}
        </div>
        {(() => {
          const err = panelError(trendError, 'trend');
          if (err) return <p className="text-xs text-red-400">{err}</p>;
          return trend?.series
            ? <div className={trendStale ? 'opacity-60' : undefined}><TrendChart series={team ? trend.series.filter((x: any) => x.team === team) : trend.series} colorByTeam={colorByTeam} /></div>
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
              return coverageStale && !coverageErrMsg ? <span className="text-[11px] text-accent-light">Updating…</span> : null;
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
