// src/app/vulnerabilities/coverage-drawer.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { Severity } from '@/lib/vulnerabilities/types';
import type { CoverageData, SummaryData } from './api-types';
import type { Slot } from './use-security-data';
import { slaState, slaStateLabel } from './sla-state';
import { resolvedCaption } from './format';
import { displayDate, unmeasuredReason } from './labels';
import { DRAWER_MAX_W, DRAWER_W, TYPE, Z } from './dimensions';

/** Open the drawer. Pass the clicked element (`e.currentTarget`) so focus can return to it on
 * close; without one the hook falls back to `document.activeElement`. */
export type OpenDrawer = (opener?: HTMLElement | null) => void;

export function useCoverageDrawer(): { open: boolean; opener: HTMLElement | null; openDrawer: OpenDrawer; closeDrawer: () => void } {
  const [state, setState] = useState<{ open: boolean; opener: HTMLElement | null }>({ open: false, opener: null });
  const openDrawer: OpenDrawer = opener => setState({
    open: true,
    opener: opener ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null),
  });
  // The opener is kept after close: the drawer's effect cleanup needs it to return focus.
  const closeDrawer = () => setState(s => ({ ...s, open: false }));
  return { open: state.open, opener: state.opener, openDrawer, closeDrawer };
}

export interface CoverageDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The element that opened the drawer; focus returns to it on close. */
  opener: HTMLElement | null;
  coverage: Slot<CoverageData>;
  summary: SummaryData;
}

type Row = CoverageData['needsTagging'][number];

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TITLE_ID = 'coverage-drawer-title';

const ownerLine = (r: Row) => `owning team ${r.team ?? 'Unassigned'}`;
/** The tags a repository lacks, which is why it is counted under "Unassigned". */
const missingTags = (r: Row) =>
  [!r.team && 'owning team', !r.serviceTier && 'service tier', !r.codebaseType && 'codebase type'].filter((x): x is string => !!x).join(', ');
const repoLink = (r: Row) => (
  <a className="text-accent-light hover:text-accent-lighter" href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer">{r.fullName}</a>
);
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const openCritical = (rows: readonly Row[]) => `${rows.reduce((n, r) => n + r.openCritical, 0).toLocaleString('en-US')} open critical`;

/** One group: its title, repository count and a right-aligned summary, then the rows, then the counting rule. */
function Group({ title, count, summary, note, children }: { title: string; count: number; summary: string; note: string; children: React.ReactNode }) {
  const id = `coverage-group-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className={`${TYPE.sectionLabel} text-gray-300`}>
          {title} <span className="ml-1 font-normal normal-case tracking-normal text-gray-500">{plural(count, 'repo')}</span>
        </h3>
        <span data-testid={`${id}-summary`} className="shrink-0 text-xs text-gray-500">{summary}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {count === 0 ? <li className="text-xs text-gray-500">None</li> : children}
      </ul>
      <p className="mt-2 text-xs text-gray-500">{note}</p>
    </section>
  );
}

/** A row's left text and its right-aligned reason, on one line each. */
function RowLine({ left, reason, reasonClass = 'text-gray-400' }: { left: React.ReactNode; reason: string; reasonClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate">{left}</span>
      <span className={`shrink-0 ${reasonClass}`}>{reason}</span>
    </div>
  );
}

type PolicyValue = { text: string; tone: 'normal' | 'muted' | 'error' };
const CANT_READ = "! Can't be read · check the SLA settings in the deployment config";

/** One severity's SLA row: its window and start date, or the state that explains why it has none. */
function slaValue(sev: Severity, summary: SummaryData): PolicyValue {
  const st = slaState(sev, summary);
  if (st.kind === 'invalid') return { text: CANT_READ, tone: 'error' };
  if (st.kind === 'none') return { text: 'No SLA policy yet', tone: 'muted' };
  const entries = summary.policy.filter(p => p.severity === sev && p.pending === (st.kind === 'pending'))
    .sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom));
  // In force: the latest entry already started. Pending: the earliest one still to start.
  const e = st.kind === 'pending' ? entries[0] : entries[entries.length - 1];
  if (!e) return { text: slaStateLabel(st, { withSla: false }) ?? 'Active', tone: 'normal' };
  const window = `${e.days} ${e.days === 1 ? 'day' : 'days'}`;
  return { text: `${window} · ${st.kind === 'pending' ? 'starts' : 'since'} ${displayDate(e.effectiveFrom)}`, tone: 'normal' };
}

/** "Since Jan 8, 2020 · fixed + dismissed", "All time · fixed + dismissed", or the unreadable-date message. */
function resolvedValue(summary: SummaryData): PolicyValue {
  const r = summary.resolvedSince;
  if (r.invalid) return { text: "! Can't be read · check the resolved-count start date in the deployment config", tone: 'error' };
  const caption = resolvedCaption(r);
  return { text: `${caption.charAt(0).toUpperCase()}${caption.slice(1)} · fixed + dismissed`, tone: 'normal' };
}

export default function CoverageDrawer({ open, onClose, opener, coverage, summary }: CoverageDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Attached only while open. Esc closes; Tab and Shift+Tab wrap inside the panel.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = !!active && panelRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, opener]);

  if (!open) return null;
  const c = coverage.data;
  const codebase = summary.appliedFilters.codebase;

  return (
    <div className="fixed inset-0" style={{ zIndex: Z.drawer }}>
      <div data-testid="drawer-backdrop" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="absolute right-0 top-0 bottom-0 flex flex-col bg-gray-900 border-l border-gray-800 shadow-xl"
        style={{ width: DRAWER_W, maxWidth: DRAWER_MAX_W }}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800">
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="text-base font-semibold text-white">Coverage &amp; policy</h2>
            <p data-testid="drawer-scope" className="mt-0.5 text-xs text-gray-500">
              {codebase ? CODEBASE_LABELS[codebase] : 'All codebases'} · Owning team: {summary.appliedFilters.team ?? 'all'} · follows the page filters
            </p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="px-2 text-lg leading-none text-gray-400 hover:text-white">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {coverage.errorText ? (
            <p className="text-xs text-red-400">{coverage.errorText}</p>
          ) : !c ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : (
            <>
              <Group title="Unmeasured" count={c.unmeasured.length} summary="open counts unknown"
                note="Open counts unknown, not zero. Their resolved alerts and measured history still count.">
                {c.unmeasured.map(r => (
                  <li key={r.repoId} className={`vuln-hatch border border-warn-line px-2.5 py-2 text-xs ${TYPE.control}`}>
                    <RowLine
                      left={<>{repoLink(r)} <span className="text-gray-400">· {ownerLine(r)}</span></>}
                      reason={unmeasuredReason({ status: r.dependabotStatus ?? 'error', detail: r.detail ?? null })}
                      reasonClass="font-semibold text-warn"
                    />
                  </li>
                ))}
              </Group>
              <Group title="Needs tagging" count={c.needsTagging.length} summary={openCritical(c.needsTagging)} note="Counted under “Unassigned” until tagged.">
                {c.needsTagging.map(r => (
                  <li key={r.repoId} className={`bg-chart-surface px-2.5 py-2 text-xs ${TYPE.control}`}>
                    <RowLine left={repoLink(r)} reason={`${r.openCritical} crit · ${r.openHigh} high`} reasonClass="text-gray-300" />
                    <div className="truncate text-gray-400">Missing: {missingTags(r)}</div>
                  </li>
                ))}
              </Group>
              <Group title="Excluded by policy" count={c.excludedByPolicy.length} summary={openCritical(c.excludedByPolicy)} note="Not counted anywhere on this page.">
                {c.excludedByPolicy.map(r => (
                  <li key={r.repoId} className={`bg-chart-surface px-2.5 py-2 text-xs ${TYPE.control}`}>
                    <RowLine
                      left={<>{repoLink(r)} <span className="text-gray-400">· {ownerLine(r)}</span></>}
                      reason={`outside scope (${r.serviceTier ?? 'no tier'})`}
                    />
                    <div className="truncate text-gray-400">{`${r.openCritical} crit · ${r.openHigh} high`}</div>
                  </li>
                ))}
              </Group>
            </>
          )}

          <section aria-labelledby="coverage-policy-title" className="mt-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 id="coverage-policy-title" className={`${TYPE.sectionLabel} text-gray-300`}>Policy</h3>
              <span className="text-xs text-gray-500">From deployment configuration</span>
            </div>
            <dl className="mt-2 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
              {([
                ['critical', 'Critical SLA', slaValue('critical', summary)],
                ['high', 'High SLA', slaValue('high', summary)],
                ['resolved', 'Resolved count', resolvedValue(summary)],
                ['scope', 'Scope', { text: `${summary.scope.property} = ${summary.scope.value}`, tone: 'normal' } as PolicyValue],
              ] as const).map(([key, label, v]) => (
                <div key={key} className="contents">
                  <dt className="text-gray-500">{label}</dt>
                  <dd
                    data-testid={`policy-value-${key}`}
                    className={v.tone === 'error' ? 'font-semibold text-red-400' : v.tone === 'muted' ? 'text-gray-400' : 'text-gray-200'}
                  >{v.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-gray-500">Archiving a repository drops its open alerts but keeps its resolved ones, which raises % closed.</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
