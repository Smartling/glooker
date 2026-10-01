'use client';

import { formatRunTime } from '@/lib/runs/format';

export interface DataFreshnessProps {
  label: string;
  at: string | null;
  stale: boolean;
  latestFailed: boolean;
  failedText: string;
  failedDetail?: string | null;
  historicalAt?: string | null;
  /** Render only the failed-run banner, not the label line. For a caller whose freshness label
   * shares a flex row with other badges (PageHeader's `badges` slot has no wrap — GLOOK-59 final
   * fix item 2), pass the full props to one DataFreshness in `freshness` with `latestFailed={false}`
   * (label only, no banner squeezed into that row) and a second, `bannerOnly` DataFreshness with the
   * real `latestFailed` in PageHeader `children`, so the banner renders full-width under the header
   * row instead. */
  bannerOnly?: boolean;
}

/** Shared freshness line for report and vulnerability dashboards.
 * When `historicalAt` is set, this is an older report/run: show only the amber
 * historical notice — never staleness or the failed banner, which describe the
 * *latest* run and don't apply to a snapshot the viewer chose to look at. */
export default function DataFreshness({ label, at, stale, latestFailed, failedText, failedDetail, historicalAt, bannerOnly }: DataFreshnessProps) {
  if (historicalAt) {
    // The historical notice is not a failed-run banner: a `bannerOnly` call renders nothing for it.
    if (bannerOnly) return null;
    const formatted = new Date(historicalAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return (
      <div className="px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-xs text-amber-400">
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Viewing historical report from {formatted} — not the latest report.
      </div>
    );
  }

  if (bannerOnly) {
    if (!latestFailed) return null;
    return (
      <div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2">{failedText} {failedDetail}</div>
    );
  }

  return (
    <div>
      <span className={stale ? 'text-amber-400' : 'text-gray-500'}>{label} {formatRunTime(at)}</span>
      {latestFailed && (
        <div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2">{failedText} {failedDetail}</div>
      )}
    </div>
  );
}
