// src/app/vulnerabilities/alert-list.tsx
'use client';
// GLOOK-64: the Alerts view's list column: search and Status, the four toggles, six sortable
// headers, a fixed 560px area of 56px rows, and the pager. The server sorts and pages (`limit=10`,
// `offset`, `sort`), so rows render in the order they arrive and this component never re-sorts them.
import { useEffect, useRef, useState } from 'react';
import type { AlertRow } from '@/lib/vulnerabilities/aggregate';
import type { SecurityViewProps } from './view-props';
import type { AlertSortKey, AlertStatus } from './security-state';
import { anySlaActive, slaState, slaStateLabel, type SlaSource } from './sla-state';
import { displayDate } from './labels';
import { REFRESH_FAILED_NOTE, slotView } from './slot-view';
import Pager, { PAGER_H } from './pager';
import { ALERT_LIST_H, ALERT_PAGE_SIZE, ALERT_ROW_H, TYPE } from './dimensions';

/** The search box applies its text this long after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 300;

// ── Fixed sizes of the list column. Together with the 560px row area they make the 776px card:
// padding + two toolbar rows + the header + the pager + three gaps = ALERT_COLUMN_CHROME_H.
export const ALERT_TOOLBAR_ROW_H = 32;
export const ALERT_TOOLBAR_GAP = 8;
export const ALERT_HEAD_H = 52;
export const ALERT_COLUMN_PAD = { top: 16, x: 20, bottom: 12 } as const;
export const ALERT_COLUMN_GAP = 12;
export const ALERT_COLUMN_CHROME_H =
  ALERT_COLUMN_PAD.top + 2 * ALERT_TOOLBAR_ROW_H + ALERT_TOOLBAR_GAP + ALERT_HEAD_H + PAGER_H + 3 * ALERT_COLUMN_GAP + ALERT_COLUMN_PAD.bottom;

/** The Due track keeps this much room, so "104d OVERDUE" is never clipped at 1024px. */
export const ALERT_DUE_MIN_W = 120;
export const ALERT_SEV_W = 56;
export const ALERT_AGE_W = 52;
/** One grid for the header and every row, so the columns line up. Every other track is minmax(0, …) so long text ends in "…". */
export const ALERT_GRID_COLS =
  `${ALERT_SEV_W}px minmax(0,2.2fr) minmax(0,1.8fr) ${ALERT_AGE_W}px minmax(${ALERT_DUE_MIN_W}px,1fr) minmax(0,1fr)`;

/**
 * Why Overdue and Due ≤ 7d are disabled when no severity has an active SLA, or null when one does.
 * Invalid wins over pending, which wins over none, so an unreadable policy never reads as "no policy".
 */
export function noSlaHint(sla: SlaSource, today?: string): string | null {
  const states = [slaState('critical', sla), slaState('high', sla)];
  if (states.some(s => s.kind === 'active')) return null;
  if (states.some(s => s.kind === 'invalid')) return slaStateLabel({ kind: 'invalid' }, { withSla: true });
  const starts: string[] = [];
  let pending = false;
  for (const s of states) {
    if (s.kind !== 'pending') continue;
    pending = true;
    if (s.startsOn) starts.push(s.startsOn);
  }
  if (pending) return `Due dates start ${starts[0] ? displayDate(starts.sort()[0], today) : 'later'}`;
  return slaStateLabel({ kind: 'none' }, { withSla: true });
}

const STATUS_OPTIONS: ReadonlyArray<[AlertStatus, string]> = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'Open + resolved']];

/** Header copy per sort key. A Record, so a key added to the wire contract without a header fails the type check. */
const HEAD_COPY: Record<AlertSortKey, { label: string; sub: string; right: boolean }> = {
  severity: { label: 'Sev', sub: '', right: false },
  advisory: { label: 'Advisory', sub: 'CVSS · package', right: false },
  repo: { label: 'Repository', sub: 'owning team', right: false },
  age: { label: 'Age', sub: '', right: true },
  due: { label: 'Due', sub: '', right: true },
  state: { label: 'State', sub: 'scope', right: false },
};
/** The sort the default order is drawn as. */
const DEFAULT_SORT = { key: 'due', dir: 'asc' } as const;
/** Left to right, matching ALERT_GRID_COLS. */
const HEAD_ORDER: readonly AlertSortKey[] = ['severity', 'advisory', 'repo', 'age', 'due', 'state'];

/** The sort glyphs. U+FE0E asks for the text form of ↕, which some fonts otherwise draw as a coloured emoji. */
export const SORT_ARROW = { none: '↕\uFE0E', asc: '↑', desc: '↓' } as const;

const SEV_BADGE = {
  critical: { label: 'CRIT', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-400' },
} as const;

function AlertRowView({ r, sla }: { r: AlertRow; sla: SlaSource }) {
  const idText = r.cveId ?? r.ghsaId ?? '';
  const cvss = r.cvss !== null ? `CVSS ${Number(r.cvss).toFixed(1)}` : null;
  // A null package renders nothing (never the text "null"), in the cell or its title.
  const pkg = `${r.packageName ?? ''}${r.packageName && r.ecosystem ? ` (${r.ecosystem})` : ''}`;
  const advSub = [cvss, pkg || null].filter(Boolean).join(' · ');
  const repoShort = r.repo.split('/').pop() ?? r.repo;

  // Due: the date and "Nd OVERDUE" / "in Nd" while this severity's SLA is active; otherwise a dash
  // with the SLA state's own message (or, for a resolved alert, whether it was fixed in time).
  const st = slaState(r.severity, sla);
  let due = '—';
  let dueSub = '';
  let overdue = false;
  if (r.state === 'open') {
    if (st.kind === 'active') {
      if (r.dueDate) {
        due = displayDate(r.dueDate);
        if (r.daysRemaining !== null) {
          overdue = r.daysRemaining < 0;
          dueSub = overdue ? `${-r.daysRemaining}d OVERDUE` : r.daysRemaining === 0 ? 'today' : `in ${r.daysRemaining}d`;
        }
      }
    } else {
      // The column's header says "Due", not "SLA", so the state names the SLA itself ("SLA starts Feb 1, 2099").
      dueSub = slaStateLabel(st, { withSla: true }) ?? '';
    }
  } else if (r.resolvedOnTime !== null) {
    dueSub = r.resolvedOnTime ? 'resolved on time' : `resolved ${r.resolvedDaysLate}d late`;
  }

  // The State cell's first line is short enough never to clip: "open", "open ↺" (reopened), or "resolved · {reason}" (truncated
  // at the cell edge). The dates ride in the title and the glyph's aria-label; the second line is the dependency scope.
  const resolvedReason = r.state === 'open' ? null : (r.dismissedReason ?? r.state);
  const stateText = resolvedReason === null ? 'open' : `resolved · ${resolvedReason}`;
  const reopened = r.reopenedCount > 0;
  const reopenedLabel = `reopened${r.lastReopenedAt ? ` ${displayDate(r.lastReopenedAt)}` : ''}`;
  const stateTitle = [
    r.state === 'open' ? 'open' : `${r.state}${r.dismissedReason ? ` (${r.dismissedReason})` : ''}${r.resolvedAt ? `, resolved ${r.resolvedAt.slice(0, 10)}` : ''}`,
    reopened ? `reopened${r.reopenedCount > 1 ? ` ${r.reopenedCount} times` : ''}${r.lastReopenedAt ? `, last on ${r.lastReopenedAt.slice(0, 10)}` : ''}` : null,
  ].filter((x): x is string => !!x).join(' · ');

  const cell = 'flex min-w-0 flex-col justify-center gap-0.5 px-2.5';
  const sub = 'truncate text-xs text-gray-400';
  return (
    <div
      data-testid="alert-row"
      className="grid box-border border-b border-gray-800/60 text-sm text-gray-200"
      style={{ gridTemplateColumns: ALERT_GRID_COLS, height: ALERT_ROW_H }}
    >
      <div className="flex items-center">
        <span className={`w-[38px] py-0.5 text-center text-[10px] font-bold tracking-[0.05em] ${TYPE.badge} ${SEV_BADGE[r.severity].cls}`}>{SEV_BADGE[r.severity].label}</span>
      </div>
      <div className={cell}>
        <a href={r.htmlUrl} target="_blank" rel="noreferrer" title={idText} className="truncate text-accent-light underline underline-offset-2 hover:text-accent-lighter">{idText}</a>
        <span className={sub} title={advSub || undefined}>{advSub || '\u00a0'}</span>
      </div>
      <div className={cell}>
        <span className="truncate" title={r.repo}>{repoShort}</span>
        <span className={sub} title={r.team}>{r.team}</span>
      </div>
      <div className="flex items-center justify-end px-2.5 text-gray-300 tabular-nums">{r.ageDays}d</div>
      <div className={`${cell} items-end`}>
        <span data-testid="alert-due" title={r.dueDate ?? undefined} className={`whitespace-nowrap tabular-nums ${overdue ? 'text-red-400' : 'text-gray-300'}`}>{due}</span>
        {overdue ? (
          // Never clipped: no overflow, no ellipsis, and the track has a pixel minimum (ALERT_DUE_MIN_W).
          <span data-testid="alert-due-sub" className="shrink-0 whitespace-nowrap text-xs font-bold text-red-400">{dueSub}</span>
        ) : (
          <span data-testid="alert-due-sub" className={`${sub} max-w-full`} title={dueSub || undefined}>{dueSub || '\u00a0'}</span>
        )}
      </div>
      <div className={cell}>
        <span data-testid="alert-state" className="truncate" title={stateTitle}>
          {stateText}
          {reopened && <span data-testid="alert-reopened" role="img" aria-label={reopenedLabel} className="ml-1 text-gray-400">↺</span>}
        </span>
        <span className={sub}>{r.scope ?? 'unknown'}</span>
      </div>
    </div>
  );
}

/** One of the four toggles. A disabled toggle never reads as on, whatever the state says. */
function Toggle({ label, on, disabled, title, onClick }: { label: string; on: boolean; disabled: boolean; title?: string; onClick: () => void }) {
  const pressed = on && !disabled;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-[7px] whitespace-nowrap border px-2.5 text-[13px] ${TYPE.control} ${pressed ? 'border-accent bg-accent-bg text-accent-light' : 'border-gray-700 text-gray-300'} ${disabled ? 'cursor-default opacity-[0.45]' : ''}`}
      style={{ height: ALERT_TOOLBAR_ROW_H }}
    >
      <span aria-hidden="true" className={`flex h-3 w-3 items-center justify-center rounded-[3px] border-[1.5px] text-[9px] font-bold leading-none ${pressed ? 'border-accent bg-accent text-gray-900' : 'border-gray-500'}`}>{pressed ? '✓' : ''}</span>
      {label}
    </button>
  );
}

export default function AlertList({ summary, data, url, list: ctl }: SecurityViewProps) {
  const l = ctl.list;
  const alerts = data.alerts;
  const timeEnabled = anySlaActive(summary) && l.status !== 'resolved';
  const slaHint = noSlaHint(summary);

  // ── Search: typed text is local, applied SEARCH_DEBOUNCE_MS after the last keystroke, and applied
  // at once (never dropped) when the user clicks any other control or leaves the view.
  const [typed, setTyped] = useState(l.q);
  const typedRef = useRef(typed);
  const sentRef = useRef(l.q);             // the last value handed to setQuery (or the one the list started with)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  const flush = useRef(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (typedRef.current !== sentRef.current) {
      sentRef.current = typedRef.current;
      ctlRef.current.setQuery(typedRef.current);
    }
  }).current;
  const onType = (v: string) => {
    typedRef.current = v;
    setTyped(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => flush(), [flush]);   // a view switch unmounts the list: apply what is typed
  const then = (fn: () => void) => () => { flush(); fn(); };

  // ── Page clamp: a page past the end (a sync shrank the result, or a hand-edited state) goes to the last page.
  const rowsLen = alerts.data?.rows.length ?? 0;
  const total = alerts.data?.totalCount ?? 0;
  useEffect(() => {
    if (!alerts.data || alerts.stale || alerts.loading) return;
    if (rowsLen === 0 && total > 0 && l.page > 1) ctlRef.current.setPage(Math.ceil(total / ALERT_PAGE_SIZE));
  }, [alerts.data, alerts.stale, alerts.loading, rowsLen, total, l.page]);

  // ── What the 560px area shows. Not-found is checked first: its alerts slot is the empty slot. Then the slot-view
  // rule: the slot's own rows win (dimmed while stale, with a note when a same-key refresh failed); without rows, an
  // error, then an unavailable answer's short message, then "Loading…".
  const notFound = data.repoStatus === 'not-found';
  const view = slotView(alerts);
  const rows = !notFound && view.kind === 'data' ? view.data.rows : null;
  const stale = !notFound && view.kind === 'data' && view.dimmed;
  const refreshError = !notFound && view.kind === 'data' ? view.refreshError : null;
  const errorText = !notFound && view.kind === 'error' ? view.text : null;
  const unavailable = !notFound && view.kind === 'unavailable' ? view : null;
  const loading = !notFound && view.kind === 'loading';
  const pagerTotal = rows ? total : null;

  const timeTitle = l.status === 'resolved' ? 'Resolved alerts have no due date' : (slaHint ?? undefined);
  // With no header chosen the server's order is "soonest due first", so Due is drawn as the active header (ascending).
  // The first click on it sorts descending (the list controller's rule), so the arrow always flips.
  const shownSort = l.sort ?? (l.status === 'resolved' ? null : DEFAULT_SORT);

  return (
    <section
      aria-label="Alerts"
      data-testid="alert-list"
      className="flex min-w-0 flex-col"
      style={{
        paddingTop: ALERT_COLUMN_PAD.top, paddingBottom: ALERT_COLUMN_PAD.bottom,
        paddingLeft: ALERT_COLUMN_PAD.x, paddingRight: ALERT_COLUMN_PAD.x, gap: ALERT_COLUMN_GAP,
      }}
    >
      <div className="flex flex-none flex-col" style={{ gap: ALERT_TOOLBAR_GAP }}>
        <div className="flex items-center gap-2" style={{ height: ALERT_TOOLBAR_ROW_H }}>
          <input
            aria-label="Search alerts"
            placeholder="Search CVE, GHSA, package"
            value={typed}
            onChange={e => onType(e.target.value)}
            className={`min-w-[160px] flex-1 border border-gray-700 bg-chart-surface px-2.5 text-[13px] text-gray-200 ${TYPE.control}`}
            style={{ height: ALERT_TOOLBAR_ROW_H }}
          />
          <select
            aria-label="Status"
            value={l.status}
            onChange={e => { flush(); ctl.setStatus(e.target.value as AlertStatus); }}
            className={`w-[132px] shrink-0 border border-gray-700 bg-chart-surface px-2 text-[13px] text-gray-200 ${TYPE.control}`}
            style={{ height: ALERT_TOOLBAR_ROW_H }}
          >
            {STATUS_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <div data-testid="alert-toolbar-row2" className="flex items-center gap-2 overflow-hidden" style={{ height: ALERT_TOOLBAR_ROW_H }}>
          <Toggle label="Overdue" on={l.overdue} disabled={!timeEnabled} title={timeTitle} onClick={then(ctl.toggleOverdue)} />
          <Toggle label="Due ≤ 7d" on={l.dueSoon} disabled={!timeEnabled} title={timeTitle} onClick={then(ctl.toggleDueSoon)} />
          <Toggle label="Reopened" on={l.reopened} disabled={false} onClick={then(ctl.toggleReopened)} />
          <Toggle label="Runtime only" on={l.runtimeOnly} disabled={false} onClick={then(ctl.toggleRuntimeOnly)} />
          {slaHint && <span data-testid="alert-sla-hint" title={slaHint} className="min-w-0 truncate text-xs text-gray-500">{slaHint}</span>}
          <span className="flex-1" />
          {/* The right end of this fixed-height row is the reserved line for status text, so neither message moves a control or a row. */}
          {refreshError && <span data-testid="alert-refresh-note" title={refreshError} className="min-w-0 truncate text-[11px] text-red-400">{REFRESH_FAILED_NOTE}</span>}
          {stale && <span data-testid="alert-updating" className="shrink-0 text-[11px] text-accent-light">Updating…</span>}
        </div>
      </div>

      <div
        role="row"
        data-testid="alert-list-head"
        className="grid flex-none box-border border-b border-gray-700"
        style={{ gridTemplateColumns: ALERT_GRID_COLS, height: ALERT_HEAD_H }}
      >
        {HEAD_ORDER.map(key => {
          const h = { key, ...HEAD_COPY[key] };
          const active = shownSort?.key === h.key ? shownSort : null;
          return (
            <div
              key={h.key}
              role="columnheader"
              aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className="min-w-0"
            >
              <button
                type="button"
                data-testid={`sort-${h.key}`}
                onClick={then(() => ctl.setSort(h.key))}
                className={`flex h-full w-full min-w-0 flex-col justify-end gap-px overflow-hidden whitespace-nowrap pb-2 pt-2 ${h.key === 'severity' || h.key === 'age' ? 'pl-0 pr-2.5' : 'px-2.5'} ${h.right ? 'items-end' : 'items-start'} ${TYPE.tableHeader} ${active ? 'text-white' : 'text-gray-400'}`}
              >
                <span className="flex max-w-full items-baseline gap-1">
                  <span className="truncate">{h.label}</span>
                  <span data-testid={`sort-arrow-${h.key}`} aria-hidden="true" className={`shrink-0 tracking-normal ${active ? 'text-accent-light' : 'text-gray-500'}`}>
                    {active ? (active.dir === 'asc' ? SORT_ARROW.asc : SORT_ARROW.desc) : SORT_ARROW.none}
                  </span>
                </span>
                <span className="max-w-full truncate text-xs font-medium normal-case tracking-normal text-gray-500">{h.sub || '\u00a0'}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div
        data-testid="alert-list-rows"
        className={`relative flex-none overflow-hidden ${stale ? 'opacity-60' : ''}`}
        style={{ height: ALERT_LIST_H }}
        aria-busy={stale || loading ? true : undefined}
      >
        {rows?.map((r, i) => <AlertRowView key={i} r={r} sla={summary} />)}
        {rows && rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No alerts match these filters.</div>
        )}
        {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading…</div>}
        {unavailable && <div data-testid="alert-unavailable" title={unavailable.title} className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">{unavailable.text}</div>}
        {errorText && <div role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-400">{errorText}</div>}
        {notFound && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-sm text-gray-300">
            <span>Repository not found ·</span>
            <button type="button" onClick={() => url.clearRepo()} className={TYPE.link}>
              Show all repositories
            </button>
          </div>
        )}
      </div>

      <Pager page={l.page} pageSize={ALERT_PAGE_SIZE} totalCount={pagerTotal} onPage={p => ctl.setPage(p)} />
    </section>
  );
}
