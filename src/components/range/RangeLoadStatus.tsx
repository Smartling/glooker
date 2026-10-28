'use client';

/**
 * GLOOK-63: what sits next to the range picker while keepPreviousData holds the previous range's
 * payload. Pending → a small "Loading…"; failed → a banner naming what is actually on screen.
 */
export default function RangeLoadStatus({ pending, failed, selectedLabel, shownLabel, onRetry }: {
  pending: boolean;
  failed: boolean;
  selectedLabel: string;
  shownLabel: string;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <div role="alert" className="w-full flex items-center gap-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
        <span>Couldn&apos;t load {selectedLabel}. Showing {shownLabel}.</span>
        <button type="button" onClick={onRetry} className="underline hover:text-red-300">Retry</button>
      </div>
    );
  }
  if (pending) return <span role="status" className="text-xs text-gray-500 animate-pulse">Loading…</span>;
  return null;
}
