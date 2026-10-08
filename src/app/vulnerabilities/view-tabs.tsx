// src/app/vulnerabilities/view-tabs.tsx
'use client';
import { useRef, type KeyboardEvent } from 'react';
import type { SecurityView } from './security-state';
import { ALERTS_TAB_COUNT_W } from './dimensions';

export interface ViewTabsProps {
  view: SecurityView;
  onChange: (v: SecurityView) => void;
  /** The open count under Severity for the current scope, shown as "N open"; null until the repos rows load. */
  alertsCount: number | null;
}

const TABS: ReadonlyArray<{ id: SecurityView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'alerts', label: 'Alerts' },
];

export default function ViewTabs({ view, onChange, alertsCount }: ViewTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // Roving focus with manual activation: the arrow keys, Home and End move FOCUS between the tabs; Enter and Space
  // (a button's own click) change the view, because a view change pushes a history entry.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = refs.current.findIndex(el => el === document.activeElement);
    if (at < 0) return;
    const last = TABS.length - 1;
    const next = e.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
      : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Security views" className="flex h-full items-end gap-7" onKeyDown={onKeyDown}>
      {TABS.map((t, i) => {
        const selected = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`security-tab-${t.id}`}
            ref={el => { refs.current[i] = el; }}
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            aria-controls="security-view-panel"
            onClick={() => onChange(t.id)}
            // The underline overlaps the row's 1px rule (-mb-px); 22px line + 10px padding + the 2px underline = BAR_ROW_H.
            className={`-mb-px flex items-baseline gap-[7px] border-b-2 px-0.5 pb-2.5 text-base leading-[22px] ${selected ? 'border-accent font-semibold text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            {/* The pressed tab is semibold. The invisible ::after copy of the label is semibold on both tabs, so each tab is as wide as its
                bold label and switching views does not move the other one. */}
            <span data-label={t.label} className="after:invisible after:block after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]">{t.label}</span>
            {t.id === 'alerts' && (
              // The slot always renders with a minimum width, so the tab does not change size when the count arrives.
              <span data-testid="alerts-tab-count" className="inline-block text-left text-xs font-normal text-gray-400" style={{ minWidth: ALERTS_TAB_COUNT_W }}>
                {alertsCount === null ? '' : `${alertsCount.toLocaleString('en-US')} open`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
