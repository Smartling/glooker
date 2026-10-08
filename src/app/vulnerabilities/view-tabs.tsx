// src/app/vulnerabilities/view-tabs.tsx
'use client';
import type { SecurityView } from './security-state';
import { BAR_ROW_H } from './dimensions';

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
  return (
    <div role="tablist" aria-label="Security views" className="flex items-center gap-1" style={{ height: BAR_ROW_H }}>
      {TABS.map(t => {
        const selected = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`security-tab-${t.id}`}
            aria-selected={selected}
            aria-controls="security-view-panel"
            onClick={() => onChange(t.id)}
            className={`h-full px-3 text-sm font-medium border-b-2 ${selected ? 'border-accent text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            {t.label}
            {t.id === 'alerts' && (
              // The slot always renders with a minimum width, so the tab does not change size when the count arrives.
              <span data-testid="alerts-tab-count" className="ml-2 inline-block min-w-[64px] text-left text-xs font-normal text-gray-400">
                {alertsCount === null ? '' : `${alertsCount.toLocaleString('en-US')} open`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
