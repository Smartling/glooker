// src/app/vulnerabilities/filter-bar.tsx
'use client';
import { useRef, type ReactNode, type Ref } from 'react';
import { CODEBASE_GROUPS, CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import { codebaseOptionCount, kSev, type CodebaseCounts, type SecurityUrl, type SeverityFilter } from './security-state';
import ViewTabs from './view-tabs';
import {
  BAR_PAD_Y, BAR_ROW_H, FILTER_BAR_H, FILTER_CAPTION_GAP, FILTER_CAPTION_H, FILTER_ROW_GAP, FILTER_ROW_H, FILTER_SELECT_H,
  PAGE_PAD, RESET_SLOT_W, SELECT_W, TYPE, Z,
} from './dimensions';

export type FilterBarUrl = Pick<
  SecurityUrl,
  'view' | 'codebase' | 'team' | 'severity' | 'baseline' | 'isDefault'
  | 'setView' | 'setCodebase' | 'setTeam' | 'setSeverity' | 'setBaseline' | 'resetFilters'
>;

export interface FilterBarProps {
  url: FilterBarUrl;
  /** summary.knownTeams */
  teams: readonly string[];
  /** summary.codebaseCounts; undefined until the summary loads. */
  codebaseCounts: CodebaseCounts | undefined;
  alertsCount: number | null;
  /** The date "A date…" writes immediately (the current baseline's date, else a week ago). */
  baselinePrefill: string;
  barRef?: Ref<HTMLDivElement>;
}

const SEVERITY_OPTIONS: ReadonlyArray<[SeverityFilter, string]> = [
  ['both', 'Critical + high'], ['critical', 'Critical only'], ['high', 'High only'],
];
const COMPARE_OPTIONS = [['last', 'Last sync'], ['7d', '7 days ago'], ['30d', '30 days ago'], ['date', 'A date…']] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The browser's own calendar day: the date input's `max` is what the picker lets the user choose, so it follows the user's day, not UTC's. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A non-default select gets the accent border AND the accent fill; a default one is a plain surface.
const selectClass = (nonDefault: boolean) =>
  `shrink-0 px-2 text-xs truncate border ${TYPE.control} ${nonDefault ? 'border-accent bg-accent-bg text-accent-light' : 'border-gray-700 bg-chart-surface text-gray-300'}`;
const selectStyle = (width: number) => ({ width, height: FILTER_SELECT_H });

/** The visible caption above a select: sentence case in the DOM (it is the select's accessible name), upper-cased by CSS. */
const CAPTION = 'block truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-gray-400';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col" style={{ gap: FILTER_CAPTION_GAP }}>
      <label htmlFor={id} className={CAPTION} style={{ height: FILTER_CAPTION_H, lineHeight: `${FILTER_CAPTION_H}px` }}>{label}</label>
      {children}
    </div>
  );
}

export default function FilterBar({ url, teams, codebaseCounts, alertsCount, baselinePrefill, barRef }: FilterBarProps) {
  const codebaseRef = useRef<HTMLSelectElement>(null);
  const isDate = DATE_RE.test(url.baseline);
  const compareValue = isDate ? 'date' : url.baseline;
  const today = localToday();
  const unit = kSev(url.severity) === 'high' ? 'high' : 'crit';
  const codebaseLabel = (g: (typeof CODEBASE_GROUPS)[number]) => {
    // The count is the kSev count (critical, or high under "High only"), so an option reads like the KPI tile beside it.
    const n = codebaseOptionCount(codebaseCounts, g, url.severity);
    return n === null ? CODEBASE_LABELS[g] : `${CODEBASE_LABELS[g]} · ${n.toLocaleString('en-US')} open ${unit}`;
  };
  const severityLabel = SEVERITY_OPTIONS.find(([v]) => v === url.severity)?.[1] ?? '';
  const compareLabel = COMPARE_OPTIONS.find(([v]) => v === compareValue)?.[1] ?? '';

  return (
    <div
      ref={barRef}
      data-testid="security-bar"
      className="box-border flex flex-col"
      style={{
        position: 'sticky', top: 0, zIndex: Z.stickyBar,
        background: 'var(--body-bg, #0F0F0F)',
        height: FILTER_BAR_H, paddingTop: BAR_PAD_Y, paddingBottom: BAR_PAD_Y,
        // Extend over the page padding so scrolling content never shows in the gutters.
        marginLeft: -PAGE_PAD.x, marginRight: -PAGE_PAD.x, paddingLeft: PAGE_PAD.x, paddingRight: PAGE_PAD.x,
        boxShadow: '0 1px 0 var(--chart-grid)',
      }}
    >
      {/* The 1px rule under the tabs is inside the row's height (border-box), so the bar's total stays FILTER_BAR_H. */}
      <div className="box-border flex items-center" style={{ height: BAR_ROW_H, borderBottom: '1px solid var(--chart-grid)' }}>
        <ViewTabs view={url.view} onChange={url.setView} alertsCount={alertsCount} />
      </div>

      <div className="flex items-end" style={{ height: FILTER_ROW_H, gap: FILTER_ROW_GAP }}>
        <Field id="security-codebase" label="Codebase">
          <select
            id="security-codebase"
            ref={codebaseRef}
            value={url.codebase}
            title={codebaseLabel(url.codebase)}
            onChange={e => url.setCodebase(e.target.value as (typeof CODEBASE_GROUPS)[number])}
            className={selectClass(!url.isDefault.codebase)}
            style={selectStyle(SELECT_W.codebase)}
          >
            {CODEBASE_GROUPS.map(g => <option key={g} value={g}>{codebaseLabel(g)}</option>)}
          </select>
        </Field>

        <Field id="security-team" label="Owning team">
          <select
            id="security-team"
            value={url.team ?? ''}
            title={url.team ?? 'All owning teams'}
            onChange={e => url.setTeam(e.target.value || null)}
            className={selectClass(!url.isDefault.team)}
            style={selectStyle(SELECT_W.team)}
          >
            <option value="">All owning teams</option>
            {/* A team from the URL that the summary has not listed (yet) still has an option, so the select shows it. */}
            {url.team && !teams.includes(url.team) && <option value={url.team}>{url.team}</option>}
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>

        <Field id="security-severity" label="Severity">
          <select
            id="security-severity"
            value={url.severity}
            title={severityLabel}
            onChange={e => url.setSeverity(e.target.value as SeverityFilter)}
            className={selectClass(!url.isDefault.severity)}
            style={selectStyle(SELECT_W.severity)}
          >
            {SEVERITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>

        <Field id="security-compare" label="Compare to">
          <select
            id="security-compare"
            value={compareValue}
            title={compareLabel}
            onChange={e => {
              const v = e.target.value;
              // "A date…" must write a concrete date now: the select's value is derived from the URL.
              url.setBaseline(v === 'date' ? baselinePrefill : v);
            }}
            className={selectClass(!url.isDefault.baseline)}
            style={selectStyle(SELECT_W.baseline)}
          >
            {COMPARE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>

        {/* Reserved slot: the input is always rendered, hidden unless the baseline is a date. It has no caption of its own. */}
        <div data-testid="date-slot" className="shrink-0" style={{ width: SELECT_W.date, height: FILTER_SELECT_H }}>
          <input
            type="date"
            aria-label="Compare to date"
            value={isDate ? url.baseline : ''}
            max={today}
            disabled={!isDate}
            tabIndex={isDate ? 0 : -1}
            onChange={e => { if (e.target.value) url.setBaseline(e.target.value); }}
            className={`${selectClass(isDate)} w-full ${isDate ? '' : 'invisible'}`}
            style={{ height: FILTER_SELECT_H }}
          />
        </div>

        {/* Reserved slot at the row's right end (ml-auto, no spacer element, so FILTER_ROW_W counts the row's real gaps): the button is hidden, never removed, so the row does not change. */}
        <div data-testid="reset-slot" className="ml-auto flex shrink-0 items-center justify-end" style={{ width: RESET_SLOT_W, height: FILTER_SELECT_H }}>
          <button
            type="button"
            onClick={() => {
              url.resetFilters();
              // The button hides itself once the filters are default: keep focus on the first filter, not on a hidden control.
              codebaseRef.current?.focus();
            }}
            disabled={url.isDefault.all}
            tabIndex={url.isDefault.all ? -1 : 0}
            aria-hidden={url.isDefault.all ? true : undefined}
            className={`text-xs ${TYPE.link} ${url.isDefault.all ? 'invisible' : ''}`}
          >
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
}
