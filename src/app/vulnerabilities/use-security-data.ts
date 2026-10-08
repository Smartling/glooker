// src/app/vulnerabilities/use-security-data.ts
'use client';
// GLOOK-64: every SWR key the Security page uses, in one place (spec section 4, "Data flow").
// Every key uses keepPreviousData, so a scope change keeps rendering the previous key's data
// (`stale: true`) instead of blanking the section while the new key loads.
import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher, vulnSwrOptions, panelError } from './format';
import type { SummaryData, ReposData, CoverageData, AlertsData, TrendData, UnavailableData, Slot } from './api-types';
import {
  alertsQueryString, kSev, sanitiseAlertList, sparklineSince, trendSince,
  type AlertListState, type SecurityScope,
} from './security-state';
import { anySlaActive } from './sla-state';

const BASE = '/api/vulnerabilities';
const SWR_OPTS = { keepPreviousData: true, ...vulnSwrOptions };

// `Slot` is defined in api-types.ts (the test fixtures need it earlier); consumers import it from here too.
export type { Slot };

export interface SecurityKeys {
  summary: string;
  teamSummary: string;
  coverage: string;
  repos: string;
  /** The header meta line's repository and team counts: repos scoped by codebase only, never by team. */
  metaRepos: string;
  trend: string;
  sparkline: string;
}

export type RepoStatus = 'none' | 'pending' | 'ok' | 'not-found';

export interface SecurityData {
  summary: Slot<SummaryData>;
  teamSummary: Slot<SummaryData>;
  coverage: Slot<CoverageData>;
  repos: Slot<ReposData>;
  /** The same rows without the owning team: the header's "N repositories · N owning teams" describes the codebase, not the filter. */
  metaRepos: Slot<ReposData>;
  trend: Slot<TrendData>;
  sparkline: Slot<TrendData>;
  alerts: Slot<AlertsData>;
  repoStatus: RepoStatus;
  effectiveRepo: string | null;
  effectiveList: AlertListState;
  keys: SecurityKeys & { alerts: string | null };
}

/** The seven keys that do not depend on the alert list. Pure, so tests can compute expectations. */
export function securityKeys(scope: SecurityScope, now: Date): SecurityKeys {
  const sev = kSev(scope.severity);

  // The team table's summary is NEVER scoped to the team (selecting a row would otherwise collapse
  // the table to that one row). Param order matches the scoped key, so with no team the two keys are
  // byte-identical and SWR dedupes them into one request.
  const summaryParams = new URLSearchParams({ codebase: scope.codebase, baseline: scope.baseline });
  const teamSummary = `${BASE}/summary?${summaryParams.toString()}`;
  if (scope.team) summaryParams.set('team', scope.team);
  const summary = `${BASE}/summary?${summaryParams.toString()}`;

  const scoped = new URLSearchParams({ codebase: scope.codebase });
  const metaRepos = `${BASE}/repos?${scoped.toString()}`;
  if (scope.team) scoped.set('team', scope.team);

  // Trend and sparkline are unscoped by team: the page filters the series client-side so a team
  // keeps its colour and the sparkline can be summed for a team without a second request.
  const trendKey = (since: string | null) => {
    const p = new URLSearchParams({ codebase: scope.codebase, severity: sev });
    if (since) p.set('since', since);
    return `${BASE}/trend?${p.toString()}`;
  };

  return {
    summary,
    teamSummary,
    coverage: `${BASE}/coverage?${scoped.toString()}`,
    repos: `${BASE}/repos?${scoped.toString()}`,
    // With no team selected this is the same string as `repos`, so SWR sends one request for both.
    metaRepos,
    trend: trendKey(trendSince(scope.range, now)),
    sparkline: trendKey(sparklineSince(now)),
  };
}

/**
 * `ownsData`: the cache holds a response for THIS key. keepPreviousData makes `r.data` the previous key's
 * response while the new key has none, which is right while it loads (`stale`) and wrong once it has
 * failed: an error never shows another key's figures, so a failed key with no data of its own exposes
 * none. A revalidation that fails on a key that has its own data keeps that data (`stale` stays false).
 */
function toSlot<T>(label: string, r: { data?: unknown; error?: unknown; isLoading: boolean }, ownsData: boolean): Slot<T> {
  // An error on a key that has no data of its own is the whole answer for that key, even while SWR retries it (isLoading stays true then).
  const failedHere = !!r.error && !ownsData;
  const payload = (failedHere ? undefined : r.data) as { available?: boolean } | undefined;
  const data = payload && payload.available === true ? (payload as unknown as T) : undefined;
  const unavailable = payload && payload.available === false ? (payload as unknown as UnavailableData) : undefined;
  return {
    data, unavailable, error: r.error, errorText: panelError(r.error, label),
    loading: r.isLoading && !payload && !failedHere,
    stale: r.isLoading && !!payload,
  };
}

const EMPTY_SLOT: Slot<never> = { data: undefined, unavailable: undefined, error: undefined, errorText: null, loading: false, stale: false };

/** The alerts API's "your repo parameter is wrong" answers: not a page problem. */
function isRepoRejection(err: unknown): boolean {
  const e = (err as { info?: { error?: unknown } } | null)?.info?.error;
  return e === 'unknown repo' || e === 'repo not tracked';
}

const syncAt = (d: { sync?: { lastSuccessfulAt: string | null } } | undefined): string | null => d?.sync?.lastSuccessfulAt ?? null;

export function useSecurityData(scope: SecurityScope, listState: AlertListState): SecurityData {
  const keys = securityKeys(scope, new Date());
  const { cache, mutate } = useSWRConfig();
  const ownsData = (key: string | null) => key !== null && (cache.get(key) as { data?: unknown } | undefined)?.data !== undefined;

  const summary = useSWR(keys.summary, fetcher, SWR_OPTS);
  const teamSummary = useSWR(keys.teamSummary, fetcher, SWR_OPTS);
  const coverage = useSWR(keys.coverage, fetcher, SWR_OPTS);
  const repos = useSWR(keys.repos, fetcher, SWR_OPTS);
  const metaRepos = useSWR(keys.metaRepos, fetcher, SWR_OPTS);
  const trend = useSWR(keys.trend, fetcher, SWR_OPTS);
  const sparkline = useSWR(keys.sparkline, fetcher, SWR_OPTS);

  const summarySlot = toSlot<SummaryData>('summary', summary, ownsData(keys.summary));
  const teamSummarySlot = toSlot<SummaryData>('team table', teamSummary, ownsData(keys.teamSummary));
  const coverageSlot = toSlot<CoverageData>('coverage', coverage, ownsData(keys.coverage));
  const reposSlot = toSlot<ReposData>('repositories', repos, ownsData(keys.repos));
  const metaReposSlot = toSlot<ReposData>('repositories', metaRepos, ownsData(keys.metaRepos));
  const trendSlot = toSlot<TrendData>('trend', trend, ownsData(keys.trend));
  const sparklineSlot = toSlot<TrendData>('trend', sparkline, ownsData(keys.sparkline));

  // Sanitise at key-build time: a bad combination never costs a wasted request. Until the summary
  // loads, assume an SLA is active (nothing to clear yet).
  const slaActive = summarySlot.data ? anySlaActive(summarySlot.data) : true;
  const effectiveList = sanitiseAlertList(listState, { anySlaActive: slaActive });

  // ── Stale repository ───────────────────────────────────────────────────────────────────────────
  const repoKey = scope.repo ? `${scope.codebase}\u0000${scope.team ?? ''}\u0000${scope.repo}` : null;
  // Repositories the alerts API rejected, per scope (codebase + team + repo) -> the alerts key whose cached
  // error has to be evicted when the memory is cleared.
  const [rejected, setRejected] = useState<ReadonlyMap<string, string>>(() => new Map());
  const rejectedRef = useRef(rejected);
  rejectedRef.current = rejected;
  const applied = reposSlot.data?.appliedFilters as { codebase?: string; team?: string } | undefined;
  // Only rows that belong to THIS scope can say a repo is absent: keepPreviousData otherwise shows
  // the previous scope's rows, and judging by them would mark a valid repo as not found.
  const rowsAreForThisScope = !!reposSlot.data && !reposSlot.stale
    && applied?.codebase === scope.codebase && (applied?.team ?? null) === scope.team;
  let repoStatus: RepoStatus = 'none';
  if (scope.repo) {
    if (repoKey !== null && rejected.has(repoKey)) repoStatus = 'not-found';
    else if (rowsAreForThisScope) repoStatus = reposSlot.data!.rows.some(r => r.fullName === scope.repo) ? 'ok' : 'not-found';
    else repoStatus = 'pending';
  }

  const alertsKey = repoStatus === 'not-found'
    ? null
    : `${BASE}/alerts?${alertsQueryString({
        codebase: scope.codebase, team: scope.team, repo: scope.repo, severity: scope.severity,
        list: effectiveList, anySlaActive: slaActive,
      })}`;
  const alerts = useSWR(alertsKey, fetcher, SWR_OPTS);
  const alertsSlot: Slot<AlertsData> = alertsKey === null ? EMPTY_SLOT : toSlot<AlertsData>('alerts', alerts, ownsData(alertsKey));

  // Remember a repo the API rejected, per scope, so it is never sent again.
  const alertsError = alerts.error;
  useEffect(() => {
    if (repoKey && alertsKey && isRepoRejection(alertsError)) {
      setRejected(m => (m.has(repoKey) ? m : new Map(m).set(repoKey, alertsKey)));
    }
  }, [alertsError, repoKey, alertsKey]);

  // ── Sync time ──────────────────────────────────────────────────────────────────────────────────
  const settled = <T extends { sync?: { lastSuccessfulAt: string | null } }>(s: Slot<T>) =>
    s.data && !s.stale && !s.loading ? syncAt(s.data) : null;
  const summaryAt = settled(summarySlot);
  const teamAt = settled(teamSummarySlot);
  const reposAt = settled(reposSlot);
  const metaAt = settled(metaReposSlot);

  // A new sync clears the "rejected" memory: the repo may be tracked now. The cached 4xx is evicted first:
  // the same alerts key comes back as soon as the memory is clear, and SWR would serve it the error it
  // still holds (which would put the repo straight back in the memory).
  const prevSummaryAt = useRef<string | null>(null);
  useEffect(() => {
    if (prevSummaryAt.current && summaryAt && prevSummaryAt.current !== summaryAt && rejectedRef.current.size > 0) {
      rejectedRef.current.forEach(alertsKeyOfRejection => { void mutate(alertsKeyOfRejection, undefined, { revalidate: false }); });
      setRejected(new Map());
    }
    if (summaryAt) prevSummaryAt.current = summaryAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the settled sync time only
  }, [summaryAt]);

  // The summary and repos requests can straddle a sync. When their settled responses disagree,
  // refetch the older ones, once per distinct disagreement (a server that keeps answering with an
  // old time must not make this loop).
  const handled = useRef('');
  const summaryMutate = summary.mutate;
  const teamMutate = teamSummary.mutate;
  const reposMutate = repos.mutate;
  const metaMutate = metaRepos.mutate;
  useEffect(() => {
    const seen = [summaryAt, teamAt, reposAt, metaAt].filter((t): t is string => t !== null);
    if (seen.length < 2) return;
    const newest = seen.reduce((a, b) => (a > b ? a : b));
    if (seen.every(t => t === newest)) return;
    const signature = `${summaryAt}|${teamAt}|${reposAt}|${metaAt}`;
    if (handled.current === signature) return;
    handled.current = signature;
    // Keyed by SWR key: with no team the two summary keys are one cache entry, and so are the two repos keys; each is refetched once.
    const refresh = new Map<string, () => unknown>();
    if (summaryAt && summaryAt !== newest) refresh.set(keys.summary, summaryMutate);
    if (teamAt && teamAt !== newest) refresh.set(keys.teamSummary, teamMutate);
    if (reposAt && reposAt !== newest) refresh.set(keys.repos, reposMutate);
    if (metaAt && metaAt !== newest) refresh.set(keys.metaRepos, metaMutate);
    refresh.forEach(run => { void run(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the settled sync times only
  }, [summaryAt, teamAt, reposAt, metaAt]);

  return {
    summary: summarySlot,
    teamSummary: teamSummarySlot,
    coverage: coverageSlot,
    repos: reposSlot,
    metaRepos: metaReposSlot,
    trend: trendSlot,
    sparkline: sparklineSlot,
    alerts: alertsSlot,
    repoStatus,
    effectiveRepo: repoStatus === 'pending' || repoStatus === 'ok' ? scope.repo : null,
    effectiveList,
    keys: { ...keys, alerts: alertsKey },
  };
}
