// src/app/vulnerabilities/alerts-strip.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { ALERTS_STRIP_H } from './dimensions';

/** Slot for the Alerts summary strip. Reserves the 72px strip. */
export default function AlertsStrip(_props: SecurityViewProps) {
  return <section aria-label="Alerts summary" data-testid="alerts-strip" style={{ height: ALERTS_STRIP_H }} />;
}
