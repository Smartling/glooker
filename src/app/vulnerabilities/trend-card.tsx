// src/app/vulnerabilities/trend-card.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { TREND_PLOT_H } from './dimensions';

/** Slot for the trend chart card. Reserves the 220px plot; the card's own header sits above it. */
export default function TrendCard(_props: SecurityViewProps) {
  return (
    <section aria-label="Trend" data-testid="trend-card">
      <div data-testid="trend-plot" style={{ height: TREND_PLOT_H }} />
    </section>
  );
}
