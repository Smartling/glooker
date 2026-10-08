// src/app/vulnerabilities/alerts-strip.tsx
'use client';
// GLOOK-64: the Alerts view's 72px summary strip: the scope label and title, a CRIT and a HIGH row
// ("N open · N overdue"), and the unmeasured badge. Every figure comes from the `repos` rows for the
// current scope (the selected repository, if any), never from the alert list's response, so the
// strip, the rail and the Alerts tab count cannot disagree with each other.
import type { RepoRow } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { SecurityViewProps } from './view-props';
import { repoFiguresUnknown, scopeOpenCount } from './security-state';
import { slaState, slaStateLabel } from './sla-state';
import { unmeasuredBadgeText } from './labels';
import { REFRESH_FAILED_NOTE, slotView } from './slot-view';
import { ALERTS_STRIP_H, TYPE } from './dimensions';

/** Widths, in px, that keep the CRIT and HIGH blocks where they are whatever the filters. The title column is
 * fixed, so a short "All repositories" and a long team or repository name take the same room (a long title ends in
 * "…" with its full text in a `title`). The open figure and, while the SLA is active, the overdue figure change
 * width with their digits. The open figure sits right-aligned in a box sized for four digits, so "open" and the tail
 * that follows it read as one phrase ("54 open · 53 overdue") and the phrase starts in the same place; the overdue tail
 * has a minimum width sized for three digits. The blocks themselves are NOT fixed: an SLA state label ("no SLA policy
 * yet", "SLA starts Jan 1, 2099") is longer than the figures and must not be cut, and it does not change with the filters. */
export const ALERTS_STRIP_TITLE_W = 176;
export const ALERTS_STRIP_OPEN_MIN_W = 36;
export const ALERTS_STRIP_OVERDUE_MIN_W = 96;

/** The badge for a selected unmeasured repository: its figures are the stored counts, not a measurement. */
const STORED_COUNT_BADGE = '▲ unmeasured · stored count';
const SEVERITIES: readonly Severity[] = ['critical', 'high'];
const BADGE: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'CRIT', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-400' },
};

/** Overdue alerts of one severity in scope. The server sends null while that severity's SLA is not active. */
function scopeOverdue(rows: readonly RepoRow[], sev: Severity, repo: string | null): number {
  let n = 0;
  for (const r of rows) {
    if (repo && r.fullName !== repo) continue;
    n += r[sev].overdue ?? 0;
  }
  return n;
}

export default function AlertsStrip({ summary, data, url, openDrawer }: SecurityViewProps) {
  // The slot-view rule: the slot's own rows win (dimmed while stale, with a note when a same-key refresh failed);
  // without rows an error, then an unavailable answer, then dashes while loading.
  const view = slotView(data.repos);
  const rows = view.kind === 'data' ? view.data.rows : undefined;
  const dimmed = view.kind === 'data' && view.dimmed;
  const repo = data.effectiveRepo;          // not url.repo: a repository that was not found is not the scope
  const repoRow = repo && rows ? rows.find(r => r.fullName === repo) : undefined;
  // A selected repository whose row is not (yet) in the rows reads "—", never 0: the same predicate as the Alerts tab count.
  const unknown = !!rows && repoFiguresUnknown(rows, repo, dimmed);
  // A selected unmeasured repository: its figures are the stored counts, so they carry a cue and never read as measured.
  const storedCount = !!repoRow?.unmeasured && !unknown;

  const kind = repo ? `Repository · owning team ${repoRow?.team ?? url.team ?? '—'}` : url.team ? 'Owning team' : 'All owning teams';
  const title = repo ?? (url.team ? `${url.team} · all repositories` : 'All repositories');
  const unmeasured = rows && !repo ? rows.filter(r => r.unmeasured).length : 0;

  return (
    <section
      aria-label="Alerts summary"
      data-testid="alerts-strip"
      className={`bg-gray-900 ${TYPE.card} px-4 flex items-center gap-3 overflow-hidden whitespace-nowrap`}
      style={{ height: ALERTS_STRIP_H }}
    >
      <div data-testid="strip-title-col" className="flex shrink-0 flex-col gap-0.5" style={{ width: ALERTS_STRIP_TITLE_W }}>
        <span data-testid="strip-kind" className={`${TYPE.tableHeader} text-gray-400 truncate`}>{kind}</span>
        <span data-testid="strip-title" title={title} className="text-base font-bold text-white truncate">{title}</span>
      </div>
      <div className="h-9 w-px shrink-0 bg-gray-700" aria-hidden="true" />
      {view.kind === 'error' ? (
        <span className="text-sm text-red-400 truncate">{view.text}</span>
      ) : view.kind === 'unavailable' ? (
        <span data-testid="strip-unavailable" title={view.title} className="text-sm text-gray-500 truncate">{view.text}</span>
      ) : (
        <div data-testid="strip-figures" className="flex min-w-0 items-center gap-3" style={{ opacity: dimmed ? 0.6 : 1 }}>
          {SEVERITIES.map(sev => {
            const st = slaState(sev, summary);
            const open = rows && !unknown ? scopeOpenCount(rows, sev, repo) : null;
            const overdue = rows ? scopeOverdue(rows, sev, repo) : 0;
            // No SLA header sits above these figures, so the state names the SLA itself ("SLA starts Feb 1, 2099").
            const label = slaStateLabel(st, { withSla: true });
            const hidden = url.severity !== 'both' && url.severity !== sev;
            return (
              <div
                key={sev}
                data-testid={`strip-${sev}`}
                title={label ?? undefined}
                className="flex min-w-0 items-center gap-2 text-sm text-gray-300"
                style={{ opacity: hidden ? 0.35 : 1 }}
              >
                <span className={`w-[34px] shrink-0 py-px text-center text-[10px] font-bold tracking-[0.05em] ${TYPE.badge} ${BADGE[sev].cls}`}>{BADGE[sev].label}</span>
                <span className="shrink-0">
                  <span data-testid={`strip-${sev}-open-slot`} className="inline-block text-right" style={{ minWidth: ALERTS_STRIP_OPEN_MIN_W }}>
                    <b data-testid={`strip-${sev}-open`} className="text-white">{open === null ? '—' : open.toLocaleString('en-US')}</b>
                  </span>{' '}open
                </span>
                <span
                  data-testid={`strip-${sev}-tail`}
                  className={`flex min-w-0 items-center gap-1 ${st.kind === 'invalid' ? 'font-bold text-red-400' : st.kind === 'active' && overdue > 0 ? 'font-bold text-red-400' : 'text-gray-500'}`}
                  style={st.kind === 'active' ? { minWidth: ALERTS_STRIP_OVERDUE_MIN_W } : undefined}
                >
                  ·
                  {st.kind === 'invalid' && (
                    <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-400 text-[10px] font-bold text-gray-900">!</span>
                  )}
                  <span className="truncate">{!rows || unknown ? '—' : st.kind === 'active' ? `${overdue.toLocaleString('en-US')} overdue` : label}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* The flexible space is also the reserved line for "Couldn't refresh · showing last load", so the note moves nothing. */}
      <div data-testid="strip-note-slot" className="flex min-w-0 flex-1 justify-end">
        {view.kind === 'data' && view.refreshError && (
          <span data-testid="strip-refresh-note" title={view.refreshError} className="truncate text-xs text-red-400">{REFRESH_FAILED_NOTE}</span>
        )}
      </div>
      {(unmeasured > 0 || storedCount) && (
        <button
          type="button"
          data-testid="strip-unmeasured"
          title={storedCount ? 'Open counts for this repository are unknown; these are the last stored counts. Click for details.' : 'Open counts for these repositories are unknown. Click for details.'}
          onClick={e => openDrawer(e.currentTarget)}
          className={`vuln-hatch flex h-6 shrink-0 items-center gap-1.5 border border-warn-line px-2 text-xs font-semibold text-warn ${TYPE.badge}${dimmed ? ' opacity-60' : ''}`}
        >
          {storedCount ? STORED_COUNT_BADGE : unmeasuredBadgeText(unmeasured)}
        </button>
      )}
    </section>
  );
}
