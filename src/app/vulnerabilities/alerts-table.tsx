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

/**
 * Layout-stability sizing (GLOOK-43 follow-up). A page-filter change may change what the alerts
 * slot shows, never its size, so every dimension below is a constant rather than a function of the
 * current rows. They are exported from here (not from a page.tsx, which may export only `default`).
 *
 *  - ROW_H / HEAD_H: measured in headless Chrome as the rendered <tr> height (bottom border
 *    included) with the pinning classes below (`py-1.5 leading-4` + 1px border, `py-1 leading-4`).
 *  - LINE_H: the count line and the footnote, each `pt-1` + a 14px leading, including its spacing.
 *  - PAGE_ROWS: the first page. The reserved height is max(PAGE_ROWS, rows the user expanded to).
 */
export const ROW_H = 29;
export const HEAD_H = 24;
export const LINE_H = 18;
export const PAGE_ROWS = 20;
/** `border-collapse` makes the table's own box HEAD_H + rows*ROW_H + 0.5px (half the last row's
 * bottom border, measured), so a full slot came out 0.5px taller than its reservation. One whole
 * pixel is reserved for it. */
export const TABLE_BORDER_H = 1;

/** Fixed column widths in px (cell padding included). Package is the one flexible column, so it has
 * no entry: it takes whatever is left, and never less than PACKAGE_MIN_W. Sized against real data
 * (repo short name ~20-27 chars, team <=16, id <=19 chars plus CVSS, due text 16-18 chars, and a
 * state plus its `reopened` badge, which sits in the State cell, hence CVE 168 and State 98) but
 * constrained by the hard rule that the table must not scroll horizontally at a 1024px viewport
 * (~950px of panel content). Everything sized for its maximum would need ~970px
 * before Package got any width, so Repo, State and the CVE id truncate first (each carries a
 * `title`). Recompute TABLE_MIN_W's inputs whenever one of these changes. */
export const ALERT_COL_W = { sev: 52, cve: 168, repo: 140, team: 104, age: 50, due: 130, scope: 86, state: 98 } as const;
export const PACKAGE_MIN_W = 100;
export const TABLE_MIN_W = Object.values(ALERT_COL_W).reduce((a, b) => a + b, PACKAGE_MIN_W);
/** The alerts slot's reserved height: header + max(first page, rows the user expanded to) + the
 * count line + the footnote line. Exported so tests can compare against the rendered inline style. */
export const alertsBodyMinHeight = (visibleRows: number) => HEAD_H + Math.max(PAGE_ROWS, visibleRows) * ROW_H + TABLE_BORDER_H;
export const alertsSlotMinHeight = (visibleRows: number) => alertsBodyMinHeight(visibleRows) + 2 * LINE_H;

// Every body cell: one line, clipped with an ellipsis, on a fixed leading. `align-middle` and the
// explicit leading keep a badge or a wrapped-looking value from making a row taller than ROW_H.
const TD = 'px-1.5 py-1.5 leading-4 align-middle whitespace-nowrap overflow-hidden text-ellipsis';
const TH = 'px-1.5 py-1 text-left font-medium leading-4 whitespace-nowrap overflow-hidden text-ellipsis';
const BADGE = 'rounded text-[10px] leading-none align-middle';
const repoLabel = (full: string, count: number) => `${full.split('/').pop()} (${count})`;

type SortKey = 'repo' | 'team' | null;
const chip =(on: boolean) => `px-2 py-0.5 rounded-full text-[11px] border ${on ? 'bg-accent border-accent text-white' : 'border-gray-700 text-gray-400'}`;

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
  // applies to every loaded row before slicing, never only to the visible page.
  // The page size the user expanded to persists across filter changes (the layout-stability
  // decision): the reserved slot height follows `visible`, so a filter change never shrinks the
  // panel underneath a scrolled page. It used to reset to 20 whenever `rows` changed identity; now
  // only a reload resets it. The count line shows min(visible, loaded rows), so a shorter result
  // reads "Showing 5 of 5", never "Showing 40 of 5".
  const [visible, setVisible] = useState(PAGE_ROWS);
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
  const selectedRepoFacet = filters.repo ? (repos ?? []).find(r => r.repo === filters.repo) : undefined;
  const selectedRepoLabel = filters.repo ? repoLabel(filters.repo, selectedRepoFacet?.count ?? 0) : 'All repos';
  // The slot renders in every branch and shows the same count line and footnote frame, so an
  // error or loading state never shows a "Showing 0 of 0" that reads as a real count.
  const placeholder = !!error || !!loading;
  const shown = Math.min(visible, sorted.length);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input placeholder="Search CVE, GHSA, package, repo" value={qLocal} onChange={e => setQLocal(e.target.value)}
          className="flex-1 min-w-[180px] bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 px-2 py-1" />
        {onTeamChange && (
          <select aria-label="Owning team" value={team ?? ''} onChange={e => onTeamChange(e.target.value || null)}
            className="bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1">
            <option value="">All owning teams</option>
            {(teams ?? []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {/* Fixed width, never as wide as the longest facet option: an auto-width select resized with
            every filter change, and the search input (flex-1) absorbed it, sliding the Team select
            between them. The closed select truncates its label; `title` shows the rest. */}
        <select aria-label="Repo" value={filters.repo ?? ''} disabled={(repos ?? []).length === 0}
          title={selectedRepoLabel}
          onChange={e => set({ repo: e.target.value || null })}
          className="w-48 shrink-0 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1 disabled:opacity-40">
          <option value="">All repos</option>
          {/* K1: the `repos` facet covers every OTHER active filter, so toggling one of them (e.g.
              Resolved, Reopened, Runtime only, or search) can drop the selected repo out of it while
              filters.repo stays set — the select would otherwise fall back to "All repos" while
              repo=X is still being sent, with nothing showing why the list is empty. Render the
              stale selection as its own "(0)" option instead of clearing it; the user can pick
              "All repos" themselves. */}
          {filters.repo && !(repos ?? []).some(r => r.repo === filters.repo) && (
            <option value={filters.repo}>{repoLabel(filters.repo, 0)}</option>
          )}
          {(repos ?? []).map(r => <option key={r.repo} value={r.repo}>{repoLabel(r.repo, r.count)}</option>)}
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
      {/* The scroll wrapper holds ONE slot for every branch (error, loading, empty, table), the count
          line and the footnote. The slot carries the table's min-width and a min-height for the
          header + a full page of rows + both lines, so a filter change can swap what is inside it
          but never resize it. The horizontal scrollbar's presence then depends only on viewport
          width, never on which branch is showing. jsdom has no layout: the tests guard the
          structure, the browser acceptance harness is the real check. */}
      <div className="overflow-x-auto">
        <div data-testid="alerts-slot" style={{ minHeight: alertsSlotMinHeight(visible), minWidth: TABLE_MIN_W }}>
          {/* The branch region has its own floor (header + a full page of rows), so the count line and
              the footnote below it sit at the same y whatever the row count: a shorter result blanks
              the space under its rows instead of pulling those two lines up (which the browser's
              layout-shift API scores as a shift). */}
          <div data-testid="alerts-body" style={{ minHeight: alertsBodyMinHeight(visible) }}>
          {/* The error and loading text sits in a `sticky left-0` box no wider than the viewport: the slot
              keeps the table's min-width even below ~950px, and without this the message would sit at
              the slot's left edge, scrolled out of view. */}
          {error ? (
            <div className="sticky left-0 max-w-[calc(100vw-4rem)]"><p className="text-xs leading-4 text-red-400">{error}</p></div>
          ) : loading ? (
            <div className="sticky left-0 max-w-[calc(100vw-4rem)]"><p className="text-xs leading-4 text-gray-500">Loading…</p></div>
          ) : (
            <div className={stale ? 'opacity-60' : undefined}>
              <table className="w-full table-fixed text-xs text-gray-300" style={{ minWidth: TABLE_MIN_W }}>
                <colgroup>
                  <col style={{ width: ALERT_COL_W.sev }} />
                  <col style={{ width: ALERT_COL_W.cve }} />
                  <col />
                  <col style={{ width: ALERT_COL_W.repo }} />
                  <col style={{ width: ALERT_COL_W.team }} />
                  <col style={{ width: ALERT_COL_W.age }} />
                  <col style={{ width: ALERT_COL_W.due }} />
                  <col style={{ width: ALERT_COL_W.scope }} />
                  <col style={{ width: ALERT_COL_W.state }} />
                </colgroup>
                <thead className="text-gray-400">
                  <tr style={{ height: HEAD_H }}>
                    <th className={TH}>Sev</th>
                    <th className={TH}>CVE / advisory</th>
                    <th className={TH}>Package</th>
                    <th className={`${TH} cursor-pointer`} onClick={() => toggleSort('repo')}>Repo{sort === 'repo' ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>
                    <th className={`${TH} cursor-pointer`} onClick={() => toggleSort('team')}>Owning team{sort === 'team' ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>
                    <th className={TH}>Age</th>
                    <th className={TH}>Due</th>
                    <th className={TH}>Scope</th>
                    <th className={TH}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r, i) => {
                    const idText = r.cveId ?? r.ghsaId ?? '';
                    const cvssText = r.cvss !== null ? Number(r.cvss).toFixed(1) : null;
                    // A null package renders nothing (as on main), never the text "null", in the cell or its title.
                    const pkgText = `${r.packageName ?? ''}${r.ecosystem ? ` (${r.ecosystem})` : ''}`;
                    const repoText = r.repo.split('/').pop() ?? '';
                    const dueText = r.state === 'open'
                      ? (r.dueDate ? `${r.dueDate}${r.daysRemaining !== null ? ` (${r.daysRemaining}d)` : ''}` : 'no SLA')
                      : r.resolvedOnTime === null ? '—' : r.resolvedOnTime ? 'resolved on time' : `resolved ${r.resolvedDaysLate}d late`;
                    const stateText = `${r.state}${r.dismissedReason ? ` · ${r.dismissedReason}` : ''}`;
                    return (
                      // Keyed by position, not by alert: rows carry no state, and a key per alert made the
                      // browser treat a filter change as the SAME rows sliding up the page, which its
                      // layout-shift API scores; by position, row N is simply repainted in place.
                      <tr key={i} className="border-b border-gray-800/60" style={{ height: ROW_H }}>
                        <td className={TD}><span className={`${BADGE} px-1.5 ${r.severity === 'critical' ? 'bg-red-500/15 text-red-400' : 'bg-orange-500/15 text-orange-400'}`}>{r.severity === 'critical' ? 'CRIT' : 'HIGH'}</span></td>
                        <td className={TD} title={[idText, cvssText].filter(Boolean).join(' ')}>
                          {/* The id is the part that truncates: the CVSS score is shrink-0. */}
                          <div className="flex items-center gap-1 min-w-0">
                            <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent-light hover:text-accent-lighter underline">{idText}</a>
                            {cvssText !== null && <span className="shrink-0 text-gray-500">{cvssText}</span>}
                          </div>
                        </td>
                        <td className={TD} title={pkgText || undefined}>{pkgText}</td>
                        <td className={TD} title={repoText}>{repoText}</td>
                        <td className={TD} title={r.team}>{r.team}</td>
                        <td className={TD}>{r.ageDays}d</td>
                        <td className={`${TD} ${r.daysRemaining !== null && r.daysRemaining < 0 ? 'text-red-400' : ''}`} title={dueText}>
                          {dueText === 'no SLA' ? <span className="text-gray-500">no SLA</span> : dueText}
                        </td>
                        <td className={`${TD} text-gray-400`}>{r.scope ?? 'unknown'}</td>
                        {/* The state text is the part that truncates: the reopened badge is shrink-0, so it is
                            never the piece that gets cut off (resolved-then-reopened rows included). */}
                        <td className={TD} title={r.reopenedCount > 0 ? `${stateText} · reopened` : stateText}>
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="min-w-0 truncate">{stateText}</span>
                            {r.reopenedCount > 0 && <span title="Reopened — the original deadline still applies" className={`${BADGE} shrink-0 px-1 bg-amber-500/15 text-amber-400`}>reopened</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
          {/* The count line always renders (including "Showing 0 of 0"), and "Show 20 more" sits on the
              same line, so its height is the same with or without the button. In the error and
              loading branches it is an empty placeholder, so an error never reads as a real count. No
              `overflow-hidden` here: it clipped the "Show 20 more" button's focus ring. The line is
              nowrap and its content short, so the fixed height alone keeps it one line. */}
          <div data-testid="alerts-count-line" aria-hidden={placeholder ? true : undefined}
            className="box-border pt-1 flex items-center gap-2 text-[10px] leading-[14px] text-gray-500 whitespace-nowrap" style={{ height: LINE_H }}>
            {placeholder ? '\u00a0' : (
              <>
                <span>Showing {shown} of {sorted.length}</span>
                {visible < sorted.length && (
                  <button className="text-[10px] leading-[14px] text-accent-light" onClick={() => setVisible(v => Math.min(v + PAGE_ROWS, sorted.length))}>Show 20 more</button>
                )}
              </>
            )}
          </div>
          {/* Loaded count and total are stated once each: the count line says how many of the loaded
              rows are on screen, this line says how many are loaded of the real total. */}
          <p data-testid="alerts-footnote" aria-hidden={placeholder ? true : undefined}
            className="box-border pt-1 text-[10px] leading-[14px] text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis" style={{ height: LINE_H }}>
            {placeholder ? '\u00a0' : `${truncated ? `${rows.length} of ${totalCount} alerts loaded.` : `${totalCount} alerts.`} Counts are Dependabot alerts, not CVEs.`}
          </p>
        </div>
      </div>
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
        {stale && <span className="text-[11px] text-accent-light">Updating…</span>}
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
