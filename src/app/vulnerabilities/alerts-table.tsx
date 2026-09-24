'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlertRow, RepoFacetRow } from '@/lib/vulnerabilities/aggregate';
import { panelError } from './format';

export interface AlertListUiFilters {
  state: 'open' | 'resolved'; overdue: boolean; dueSoon: boolean; reopened: boolean; runtimeOnly: boolean; q: string;
  /** GLOOK-43 Wave J2 / J2-5: local alert-filter state, like the chips — not URL, not page-wide. */
  repo: string | null;
}

/** "Due ≤ 7d" sends the `due_soon` filter (Wave A: open AND 0 ≤ days_remaining ≤ 7), not a
 * `due_before` cutoff — a cutoff also matched already-overdue alerts, since any due date before
 * the cutoff includes one already in the past. */
export function alertFilterQuery(f: AlertListUiFilters): string {
  const p = new URLSearchParams({ state: f.state });
  if (f.overdue) p.set('overdue', 'true');
  if (f.dueSoon) p.set('due_soon', 'true');
  if (f.reopened) p.set('reopened', 'true');
  if (f.runtimeOnly) p.set('dependency_scope', 'runtime');
  if (f.repo) p.set('repo', f.repo);
  if (f.q) p.set('q', f.q);
  return p.toString();
}

type SortKey = 'repo' | 'team' | null;
const chip = (on: boolean) => `px-2 py-0.5 rounded-full text-[11px] border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400'}`;

export default function AlertsTable({ rows, totalCount, truncated, filters, onFiltersChange, stale, error, loading, team, teams, onTeamChange, slaStatus, policy, policyInvalid, repos }: {
  rows: AlertRow[]; totalCount: number; truncated: boolean;
  filters: AlertListUiFilters; onFiltersChange: (f: AlertListUiFilters) => void;
  /** GLOOK-43 Wave J2 / J2-5: the repo dropdown's options — every repo matching every OTHER active
   * filter, with its count (the `repos` facet the alerts API/MCP already return, Wave J1 / J1-5),
   * never the (possibly truncated, possibly already repo-filtered) loaded `rows`. Defaults to
   * empty, which also disables the select — `keepPreviousData` on the caller's SWR key already
   * carries the previous key's facet across a revalidation, so the only genuinely-empty case is
   * "never loaded yet" or an error, and the select must never be empty and enabled at once. */
  repos?: RepoFacetRow[];
  /** GLOOK-43 Wave J2 / J2-3: the alerts panel's team dropdown is bound to the SAME page-wide
   * `team` URL state a pivot-row click sets — there is no separate alerts-only team state. All
   * three are optional so existing direct renders of AlertsTable (without a team control) keep
   * today's behaviour: no dropdown, `teams` defaults to empty. */
  team?: string | null; teams?: string[]; onTeamChange?: (team: string | null) => void;
  /** GLOOK-43 Wave J2 / J2-4: before any severity's SLA is active, Overdue/Due ≤ 7d always
   * returned an empty list with no hint why. Both are optional: an existing direct render of
   * AlertsTable without `slaStatus` is treated as "some severity is active" (today's behaviour —
   * chips stay enabled, no auto-clear, no hint), matching what a caller that hasn't wired J2-4
   * through yet already sees. */
  slaStatus?: { critical: 'pending' | 'active' | 'none'; high: 'pending' | 'active' | 'none' };
  /** Each policy entry as policyWindows() returns it — only `effectiveFrom` and `pending` are
   * read, so the hint is generic: it reacts to whatever the policy file says, nothing hardcoded. */
  policy?: Array<{ effectiveFrom: string; pending: boolean }>;
  /** GLOOK-43 Wave P: getVulnConfig().slaPolicyInvalid — when true, `policy` is always `[]` (an
   * invalid VULNERABILITIES_SLA_POLICY parses to no entries), so the hint below must check this
   * first: an invalid policy must never read as "no policy configured yet". */
  policyInvalid?: boolean;
  /** C7: dims only the table container (never the search input or the chips), so a filter/sort
   * stays interactive while a new page of rows is loading in the background. */
  stale?: boolean;
  /** GLOOK-43 Wave E / E2: when set, replaces the rows/truncation-note/count area with the error
   * text — the search input and every chip above stay rendered and interactive, so a failed
   * request (a 400 from a bad filter, a 500 to retry) never takes away the controls the user needs
   * to undo or retry it. */
  error?: string | null;
  /** GLOOK-43 Wave F / F1: when true and there's no `error`, replaces the rows/truncation-note/
   * count area with the same "Loading…" text AlertsPanel used to render in AlertsTable's place —
   * this is the "never resolved yet" case (no data, no error), e.g. right after a filter change,
   * where `keepPreviousData` has nothing to carry forward because the previous key never
   * succeeded. Keeping AlertsTable itself mounted for this case (rather than AlertsPanel swapping
   * it out) is what keeps the search input's focus, sort state, and any pending debounced search
   * alive across the gap. */
  loading?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const sorted = useMemo(() => !sort ? rows : [...rows].sort((a, b) => dir * a[sort].localeCompare(b[sort])), [rows, sort, dir]);
  const toggleSort = (k: Exclude<SortKey, null>) => { if (sort === k) setDir(d => (d === 1 ? -1 : 1)); else { setSort(k); setDir(1); } };
  // J2-2: all fetched rows (up to 200) used to render at once, pushing the Coverage panel far
  // down the page. Only the first `visible` of the sorted rows render; sorting itself still
  // applies to every loaded row before slicing, never only to the visible page. `rows` changing
  // identity is "new data for a new key" (AlertsTable stays mounted across filter changes, per
  // Wave F), so that's the one thing that resets `visible` back to 20 — a "Show 20 more" click
  // (which doesn't touch `rows`) must not.
  const [visible, setVisible] = useState(20);
  // K4: a `useEffect(() => setVisible(20), [rows])` reset pagination one commit AFTER new `rows`
  // painted, so a filter change made while `visible > 20` could paint up to 40 rows of the new
  // data for one frame. Adjusting `visible` during render instead — the same pattern
  // vulnerabilities-content.tsx uses for its repo-scope reset — discards that stale render and
  // re-renders immediately with `visible` already capped, before anything commits.
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    setVisible(20);
  }
  const visibleRows = sorted.slice(0, visible);
  const set = (patch: Partial<AlertListUiFilters>) => onFiltersChange({ ...filters, ...patch });
  // B1/5: Resolved has no due date, so the two time-based chips are disabled under it, and
  // switching to it clears whatever they were set to rather than leaving a no-op filter combination.
  const setState = (state: AlertListUiFilters['state']) =>
    onFiltersChange(state === 'resolved' ? { ...filters, state, overdue: false, dueSoon: false } : { ...filters, state });
  const timeChip = (on: boolean) => `${chip(on)} disabled:opacity-40 disabled:cursor-not-allowed`;
  // J2-4: a missing `slaStatus` (an existing direct render that hasn't wired this prop) is treated
  // as "some severity is active" — chips stay enabled and no hint shows, i.e. today's behaviour.
  const anyActive = !slaStatus || slaStatus.critical === 'active' || slaStatus.high === 'active';
  const timeChipsDisabled = filters.state === 'resolved' || !anyActive;
  const noSlaHint = anyActive ? null : (() => {
    if (policyInvalid) return 'SLA policy configuration is invalid';
    const futureFroms = (policy ?? []).filter(p => p.pending).map(p => p.effectiveFrom).sort();
    if (futureFroms.length > 0) return `Due dates start ${futureFroms[0]}`;
    return (policy ?? []).length === 0 ? 'No SLA policy yet' : null;
  })();
  // If overdue/dueSoon are somehow set while no SLA is active (e.g. a stale URL), clear them —
  // there's nothing for them to filter on until a severity's SLA starts.
  useEffect(() => {
    if (!anyActive && (filters.overdue || filters.dueSoon)) onFiltersChange({ ...filters, overdue: false, dueSoon: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyActive, filters.overdue, filters.dueSoon]);

  // Search debounces ~300ms after the last keystroke so a per-request refetch doesn't fire on every
  // character; chips call `set` directly above and stay immediate. `filtersRef` (rather than closing
  // over `filters` at effect-registration time) keeps the eventual onFiltersChange call merged onto
  // whatever filters are current when the timer fires, not whatever they were 300ms earlier.
  const [qLocal, setQLocal] = useState(filters.q);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const qLocalRef = useRef(qLocal);
  qLocalRef.current = qLocal;
  const onFiltersChangeRef = useRef(onFiltersChange);
  onFiltersChangeRef.current = onFiltersChange;
  // C7: the last q value the debounce timer actually sent to the parent. filtersRef.current.q
  // only reflects that send once the parent re-renders with the updated `filters` prop — if the
  // component unmounts before that round-trip completes, filtersRef.current.q is still the OLD
  // value, and without this the unmount flush below would re-send the same q a second time.
  const lastSentQRef = useRef(filters.q);
  useEffect(() => {
    if (qLocal === filtersRef.current.q) return;
    const id = setTimeout(() => {
      lastSentQRef.current = qLocal;
      onFiltersChange({ ...filtersRef.current, q: qLocal });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);
  // B1/7: if the component unmounts (filter change, navigation) before the 300ms timer above
  // fires, this flushes whatever's currently typed instead of silently dropping it. Runs only on
  // unmount (empty deps) — reading through refs so it always sees the latest values, not a stale
  // closure from whenever the effect was first registered. The lastSentQRef check (C7) skips the
  // flush when the debounce timer already sent this exact value — otherwise unmounting shortly
  // after a send, but before the parent's next render lands filtersRef.current.q, double-sent it.
  useEffect(() => () => {
    if (qLocalRef.current !== filtersRef.current.q && qLocalRef.current !== lastSentQRef.current) {
      onFiltersChangeRef.current({ ...filtersRef.current, q: qLocalRef.current });
    }
  }, []);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input placeholder="Search CVE, GHSA, package, repo" value={qLocal} onChange={e => setQLocal(e.target.value)}
          className="flex-1 min-w-[180px] bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 px-2 py-1" />
        {onTeamChange && (
          <select aria-label="Team" value={team ?? ''} onChange={e => onTeamChange(e.target.value || null)}
            className="bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1">
            <option value="">All teams</option>
            {(teams ?? []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select aria-label="Repo" value={filters.repo ?? ''} disabled={(repos ?? []).length === 0}
          onChange={e => set({ repo: e.target.value || null })}
          className="bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1 disabled:opacity-40">
          <option value="">All repos</option>
          {/* K1: the `repos` facet covers every OTHER active filter, so toggling one of them (e.g.
              Resolved, Reopened, Runtime only, or search) can drop the selected repo out of it while
              filters.repo stays set — the select would otherwise fall back to "All repos" while
              repo=X is still being sent, with nothing showing why the list is empty. Render the
              stale selection as its own "(0)" option instead of clearing it; the user can pick
              "All repos" themselves. */}
          {filters.repo && !(repos ?? []).some(r => r.repo === filters.repo) && (
            <option value={filters.repo}>{`${filters.repo.split('/').pop()} (0)`}</option>
          )}
          {(repos ?? []).map(r => <option key={r.repo} value={r.repo}>{`${r.repo.split('/').pop()} (${r.count})`}</option>)}
        </select>
        <button className={chip(filters.state === 'open')} onClick={() => setState('open')}>Open</button>
        <button className={chip(filters.state === 'resolved')} onClick={() => setState('resolved')}>Resolved</button>
        {/* C3: overdue and due_soon are disjoint buckets (an alert can't be both past its due date
            and ≤7 days from it) — the API rejects both together, so turning one chip on turns the
            other off instead of letting the pair silently return an empty list. */}
        <button className={timeChip(filters.overdue)} disabled={timeChipsDisabled}
          onClick={() => set(filters.overdue ? { overdue: false } : { overdue: true, dueSoon: false })}>Overdue</button>
        <button className={timeChip(filters.dueSoon)} disabled={timeChipsDisabled}
          onClick={() => set(filters.dueSoon ? { dueSoon: false } : { dueSoon: true, overdue: false })}>Due ≤ 7d</button>
        {!anyActive && noSlaHint && <span className="text-[10px] text-gray-500">{noSlaHint}</span>}
        <button className={chip(filters.reopened)} onClick={() => set({ reopened: !filters.reopened })}>Reopened</button>
        <button className={chip(filters.runtimeOnly)} onClick={() => set({ runtimeOnly: !filters.runtimeOnly })}>Runtime only</button>
      </div>
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : (
        <>
          <div className={`overflow-x-auto${stale ? ' opacity-60' : ''}`}>
            <table className="w-full text-xs text-gray-300">
              <thead className="text-gray-400">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Sev</th>
                  <th className="px-2 py-1 text-left font-medium">CVE / advisory</th>
                  <th className="px-2 py-1 text-left font-medium">Package</th>
                  <th className="px-2 py-1 text-left font-medium cursor-pointer" onClick={() => toggleSort('repo')}>Repo{sort === 'repo' ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>
                  <th className="px-2 py-1 text-left font-medium cursor-pointer" onClick={() => toggleSort('team')}>Team{sort === 'team' ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>
                  <th className="px-2 py-1 text-left font-medium">Age</th>
                  <th className="px-2 py-1 text-left font-medium">Due</th>
                  <th className="px-2 py-1 text-left font-medium">Scope</th>
                  <th className="px-2 py-1 text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr key={r.htmlUrl} className="border-b border-gray-800/60">
                    <td className="px-2 py-1.5"><span className={`px-1.5 rounded text-[10px] ${r.severity === 'critical' ? 'bg-red-500/15 text-red-400' : 'bg-orange-500/15 text-orange-400'}`}>{r.severity === 'critical' ? 'CRIT' : 'HIGH'}</span></td>
                    <td className="px-2 py-1.5">
                      <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">{r.cveId ?? r.ghsaId}</a>
                      {r.cvss !== null && <span className="ml-1 text-gray-500">{Number(r.cvss).toFixed(1)}</span>}
                      {r.reopenedCount > 0 && <span title="Reopened — the original deadline still applies" className="ml-1 px-1 rounded bg-amber-500/15 text-amber-400 text-[10px]">reopened</span>}
                    </td>
                    <td className="px-2 py-1.5">{r.packageName}{r.ecosystem ? ` (${r.ecosystem})` : ''}</td>
                    <td className="px-2 py-1.5">{r.repo.split('/').pop()}</td>
                    <td className="px-2 py-1.5">{r.team}</td>
                    <td className="px-2 py-1.5">{r.ageDays}d</td>
                    <td className={`px-2 py-1.5 ${r.daysRemaining !== null && r.daysRemaining < 0 ? 'text-red-400' : ''}`}>
                      {r.state === 'open'
                        ? (r.dueDate ? `${r.dueDate}${r.daysRemaining !== null ? ` (${r.daysRemaining}d)` : ''}` : <span className="text-gray-500">no SLA</span>)
                        : r.resolvedOnTime === null ? '—' : r.resolvedOnTime ? 'resolved on time' : `resolved ${r.resolvedDaysLate}d late`}
                    </td>
                    <td className="px-2 py-1.5 text-gray-400">{r.scope ?? 'unknown'}</td>
                    <td className="px-2 py-1.5">{r.state}{r.dismissedReason ? ` · ${r.dismissedReason}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > 20 && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-gray-500">Showing {visible} of {sorted.length}</span>
              {visible < sorted.length && (
                <button className="text-[10px] text-indigo-400" onClick={() => setVisible(v => Math.min(v + 20, sorted.length))}>Show 20 more</button>
              )}
            </div>
          )}
          <p className="text-[10px] text-gray-500 mt-1">{truncated ? `Showing ${rows.length} of ${totalCount} alerts.` : `${totalCount} alerts.`} Counts are Dependabot alerts, not CVEs.</p>
        </>
      )}
    </div>
  );
}

/**
 * Owns the alerts panel's header (title, description, "Updating…" indicator) and the
 * error/loading/table swap, so the stale/error interaction is one place, not duplicated in every
 * page that embeds it (GLOOK-43 Wave C / C7). `data === undefined` is the "never loaded yet"
 * state; `stale` (isLoading && data present, and no error) means the rows on screen belong to a
 * previous key while a new one loads — SWR's `isLoading` is true only for a key that has never
 * resolved before, so with `keepPreviousData` it stays true across a key change even though `data`
 * still shows the previous key's rows, and false again for a same-key revalidation (e.g. a `mutate()`
 * or polling refetch; focus and reconnect revalidation are off app-wide in `SWRProvider`) where
 * `data` was already populated. That is what keeps the stale indicator from flashing on a refetch.
 *
 * GLOOK-43 Wave E / E2: an error used to swap the whole AlertsTable — search input and chips
 * included — for the error text, leaving the user no way to undo the filter that caused a 400 or
 * retry after a 500. AlertsTable now takes the error itself and keeps its controls mounted,
 * swapping only the rows/count area.
 *
 * GLOOK-43 Wave F / F1: a *new* key (e.g. right after a filter change) has no data and no error
 * until its own fetch settles — `keepPreviousData` only carries forward the last good *data*,
 * never an error, and a key that follows a failed one has no good data to carry forward either.
 * AlertsPanel used to fall back to a bare "Loading…" `<p>` in that gap, unmounting AlertsTable and
 * dropping its focus, sort state, and any pending debounced search. The real invariant is:
 * AlertsTable is mounted for AlertsPanel's entire lifetime — AlertsPanel never renders anything
 * else in its place. AlertsTable's own `loading` prop now carries the "never resolved yet" case.
 */
export function AlertsPanel({ data, error, isLoading, filters, onFiltersChange, team, teams, onTeamChange, slaStatus, policy, policyInvalid }: {
  data: { rows: AlertRow[]; totalCount: number; truncated: boolean; repos?: RepoFacetRow[] } | undefined;
  error: unknown; isLoading: boolean;
  filters: AlertListUiFilters; onFiltersChange: (f: AlertListUiFilters) => void;
  /** GLOOK-43 Wave J2 / J2-3: forwarded straight through to AlertsTable's team dropdown — see its
   * comment. Optional so an existing direct render of AlertsPanel (without these) keeps today's
   * behaviour. */
  team?: string | null; teams?: string[]; onTeamChange?: (team: string | null) => void;
  /** GLOOK-43 Wave J2 / J2-4: forwarded straight through to AlertsTable's time-chip disabling —
   * see its comment. */
  slaStatus?: { critical: 'pending' | 'active' | 'none'; high: 'pending' | 'active' | 'none' };
  policy?: Array<{ effectiveFrom: string; pending: boolean }>;
  /** GLOOK-43 Wave P: forwarded straight through to AlertsTable's no-SLA hint — see its comment. */
  policyInvalid?: boolean;
}) {
  const err = panelError(error, 'alerts');
  // GLOOK-43 Wave E / E2: `!err` so an error never dims the table (there's no table to dim — see
  // AlertsTable's `error` prop below) and never shows "Updating…" alongside the error banner.
  const stale = isLoading && !!data && !err;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm text-white">Alerts</h2>
        <span className="text-xs text-gray-500">· filtered by the codebase chips and team row above</span>
        {stale && <span className="text-[11px] text-indigo-400">Updating…</span>}
      </div>
      {/* Wave E / E2 + Wave F / F1: a single AlertsTable slot for the error, loading and data
          cases — AlertsTable is mounted for the panel's whole lifetime, so the search input and
          chips never remount, and therefore never lose focus or drop a pending debounced search,
          whether a request fails, recovers, or is simply a new key that hasn't resolved yet.
          Rows/count/truncated fall back to empty/0/false whenever `data` isn't present (no data
          has ever loaded, or the last load errored); `loading` is true only when there's neither
          error nor data. */}
      <AlertsTable rows={data?.rows ?? []} totalCount={data?.totalCount ?? 0} truncated={data?.truncated ?? false}
        filters={filters} onFiltersChange={onFiltersChange} stale={stale} error={err} loading={!err && !data}
        team={team} teams={teams} onTeamChange={onTeamChange} slaStatus={slaStatus} policy={policy} policyInvalid={policyInvalid} repos={data?.repos} />
    </div>
  );
}
