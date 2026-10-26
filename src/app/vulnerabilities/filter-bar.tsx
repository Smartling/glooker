// src/app/vulnerabilities/filter-bar.tsx
'use client';
import { useRef, type ReactNode, type Ref } from 'react';
import { CODEBASE_GROUPS, CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import { CODEBASE_SCHEMA, codebaseOptionCount, kSev, type CodebaseCounts, type SecurityUrl, type SeverityFilter } from './security-state';
import ViewTabs from './view-tabs';
import FilterChip from '@/components/filter-chip';
import { localToday } from './labels';
import {
  BAR_PAD_TOP, BAR_ROW_GAP, BAR_ROW_H, CHIP_MAX_W, FILTER_BAR_H, FILTER_CAPTION_GAP, FILTER_CAPTION_H, FILTER_CHIP_ROW_GAP, FILTER_CHIP_ROW_H,
  FILTER_CONTROLS_H, FILTER_PAD_BOTTOM, FILTER_ROW_GAP, FILTER_ROW_H, FILTER_SELECT_H, PAGE_PAD, SELECT_W, TYPE, Z,
} from './dimensions';

export type FilterBarUrl = Pick<
  SecurityUrl,
  'view' | 'codebase' | 'team' | 'repo' | 'severity' | 'baseline' | 'isDefault'
  | 'setView' | 'setCodebase' | 'setTeam' | 'setRepo' | 'setSeverity' | 'setBaseline' | 'resetFilters'
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
const COMPARE_CHIP: Record<string, string> = { '7d': '7 days ago', '30d': '30 days ago' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A non-default select gets the accent border AND the accent fill; a default one is a plain surface.
const selectClass = (nonDefault: boolean) =>
  `shrink-0 px-2 text-[13px] truncate border ${TYPE.control} ${nonDefault ? 'border-accent bg-accent-bg text-accent-light' : 'border-gray-700 bg-chart-surface text-gray-300'}`;
const selectStyle = (width: number) => ({ width, height: FILTER_SELECT_H });

/** The visible caption above a select: sentence case in the DOM (it is the select's accessible name), upper-cased by CSS. */
const CAPTION = 'block truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400';

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
  const teamRef = useRef<HTMLSelectElement>(null);
  const severityRef = useRef<HTMLSelectElement>(null);
  const compareRef = useRef<HTMLSelectElement>(null);
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

  // One chip per non-default filter, in the selects' order; × resets that filter and puts focus on its select (the chip is gone).
  const chips: Array<{ key: string; label: string; remove: () => void; focus: () => void }> = [];
  if (!url.isDefault.codebase) chips.push({ key: 'codebase', label: `Codebase: ${CODEBASE_LABELS[url.codebase]}`, remove: () => url.setCodebase(CODEBASE_SCHEMA.default as (typeof CODEBASE_GROUPS)[number]), focus: () => codebaseRef.current?.focus() });
  if (!url.isDefault.team && url.team) chips.push({ key: 'team', label: `Team: ${url.team}`, remove: () => url.setTeam(null), focus: () => teamRef.current?.focus() });
  if (!url.isDefault.repo && url.repo) chips.push({ key: 'repo', label: `Repo: ${url.repo}`, remove: () => url.setRepo(null), focus: () => codebaseRef.current?.focus() }); // no repo select exists, so focus falls back to Codebase
  if (!url.isDefault.severity) chips.push({ key: 'severity', label: `Severity: ${url.severity === 'critical' ? 'Critical' : 'High'}`, remove: () => url.setSeverity('both'), focus: () => severityRef.current?.focus() });
  if (!url.isDefault.baseline) chips.push({ key: 'baseline', label: `Compare to: ${isDate ? url.baseline : COMPARE_CHIP[url.baseline] ?? url.baseline}`, remove: () => url.setBaseline('last'), focus: () => compareRef.current?.focus() });

  return (
    <div
      ref={barRef}
      data-testid="security-bar"
      className="box-border flex flex-col"
      style={{
        position: 'sticky', top: 0, zIndex: Z.stickyBar,
        background: 'var(--body-bg, #0F0F0F)',
        height: FILTER_BAR_H, paddingTop: BAR_PAD_TOP, gap: BAR_ROW_GAP,
        // The top padding is background above the tabs that the page gap would otherwise leave empty: take it out of the gap.
        // The sides extend over the page padding so scrolling content never shows in the gutters; the rules below end at the cards' edges.
        marginTop: -BAR_PAD_TOP, marginLeft: -PAGE_PAD.x, marginRight: -PAGE_PAD.x, paddingLeft: PAGE_PAD.x, paddingRight: PAGE_PAD.x,
      }}
    >
      {/* The 1px rule under the tabs (the stronger of the two) is inside the row's height (border-box), so the bar's total stays FILTER_BAR_H. */}
      <div className="box-border flex flex-none items-end border-b border-gray-700" style={{ height: BAR_ROW_H }}>
        <ViewTabs view={url.view} onChange={url.setView} alertsCount={alertsCount} />
      </div>

      {/* The lower rule is this row's own border (the lighter one), not a shadow on the bar, so it ends at the cards' edges like the tab rule. */}
      <div className="box-border flex flex-none flex-col border-b border-gray-800" style={{ height: FILTER_ROW_H, paddingBottom: FILTER_PAD_BOTTOM }}>
        <div className="flex items-end" style={{ height: FILTER_CONTROLS_H, gap: FILTER_ROW_GAP }}>
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
              ref={teamRef}
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
              ref={severityRef}
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
              ref={compareRef}
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
        </div>

        <div data-testid="chip-row" role="group" aria-label="Active filters" className="flex min-w-0 flex-nowrap items-center overflow-hidden" style={{ height: FILTER_CHIP_ROW_H, marginTop: FILTER_CHIP_ROW_GAP, gap: FILTER_ROW_GAP }}>
          {chips.length === 0 && <span aria-hidden="true">&nbsp;</span>}
          {chips.map(c => (
            <FilterChip key={c.key} label={c.label} maxWidth={CHIP_MAX_W} onRemove={() => { c.remove(); c.focus(); }} />
          ))}
          {/* Reserved: always rendered, hidden at the defaults, so the chips never move when it appears. */}
          <span data-testid="clear-all-slot" className="shrink-0">
            <button
              type="button"
              onClick={() => { url.resetFilters(); codebaseRef.current?.focus(); }}
              disabled={url.isDefault.all}
              tabIndex={url.isDefault.all ? -1 : 0}
              aria-hidden={url.isDefault.all ? true : undefined}
              className={`text-xs ${TYPE.link} ${url.isDefault.all ? 'invisible' : ''}`}
            >
              Clear all
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
