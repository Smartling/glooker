// src/app/vulnerabilities/refresh-note.tsx
// GLOOK-64: the one "Couldn't refresh · showing last load" note (slot-view.ts' REFRESH_FAILED_NOTE). Every section that keeps its
// figures after a refresh of the same request failed draws it through this, so the strip, rail, list, tables, trend card and
// sparkline read the same: 12px, red, cut with "…" at its slot's edge, the failed request's own error text in the title.
import { REFRESH_FAILED_NOTE } from './slot-view';

export interface RefreshNoteProps {
  /** The failed request's error text (the title), or null while nothing has failed. */
  error: string | null;
  testId: string;
  /**
   * role="status": a screen reader announces the note when it appears. Only the note that owns its request uniquely is live
   * (the list for alerts, the team table for teamSummary, the trend card for trend, the sparkline for sparkline, the strip for the
   * shared repos slot): the rail's and the repository table's notes read the same repos slot, so they stay silent and the
   * failure is announced once.
   */
  live?: boolean;
  /** Placement only (an absolute corner, a grid cell's padding, shrink-0); never the type size or colour. */
  className?: string;
}

/**
 * Always rendered, empty while nothing has failed: a live region has to be in the page BEFORE its text arrives to be announced,
 * and an empty slot keeps the layout identical with and without the note.
 */
export default function RefreshNote({ error, testId, live = false, className = '' }: RefreshNoteProps) {
  return (
    <span
      data-testid={testId}
      role={live ? 'status' : undefined}
      title={error ?? undefined}
      className={`block min-w-0 truncate text-xs text-red-400${className ? ` ${className}` : ''}`}
    >
      {error ? REFRESH_FAILED_NOTE : null}
    </span>
  );
}
