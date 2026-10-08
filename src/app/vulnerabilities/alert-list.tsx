// src/app/vulnerabilities/alert-list.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { ALERT_LIST_H } from './dimensions';

/** Slot for the alert list column (filters, rows, pager). Reserves the 560px list area (10 rows of 56px). */
export default function AlertList(_props: SecurityViewProps) {
  return (
    <section aria-label="Alerts" data-testid="alert-list" className="min-w-0">
      <div data-testid="alert-list-rows" style={{ height: ALERT_LIST_H }} />
    </section>
  );
}
