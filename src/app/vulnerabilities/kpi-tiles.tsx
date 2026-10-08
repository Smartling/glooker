// src/app/vulnerabilities/kpi-tiles.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { KPI_ROW_H } from './dimensions';

/** Slot for the Overview KPI tiles. Reserves the spec's 178px row; the tiles replace this body. */
export default function KpiTiles(_props: SecurityViewProps) {
  return <section aria-label="Key figures" data-testid="kpi-tiles" style={{ height: KPI_ROW_H }} />;
}
