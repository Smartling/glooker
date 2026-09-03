'use client';
import { useState } from 'react';
import type { RunMetadata, SkippedMember, IntegrityError } from '@/lib/report-runner/types';
import { countableSkips } from '@/lib/report-runner/types';

export interface IntegrityBadgeProps {
  metadata: RunMetadata | null;
}

const PILL_BASE = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ml-2';

function classificationLabel(c: SkippedMember['classification']): string {
  return c === 'expected' ? 'expected' : c === 'auto-flagged' ? 'auto-flagged' : 'unknown';
}

export default function IntegrityBadge({ metadata }: IntegrityBadgeProps) {
  const [open, setOpen] = useState(false);

  if (!metadata || metadata.state === 'ok') return null;

  const expectedCount = metadata.expectedCount ?? 0;

  if (metadata.state === 'failed') {
    return (
      <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 my-4">
        <div className="flex items-start gap-3">
          <span className="text-red-400 text-lg">⚠</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-red-300">GitHub API degraded — report is incomplete</h3>
            <p className="text-xs text-red-300/80 mt-1">{metadata.abortReason}</p>
            <p className="text-xs text-red-300/60 mt-2">
              {metadata.skipped.length} engineer(s) skipped, {metadata.errors.length} non-fatal error(s).
              Likely an upstream auth/permission regression — try regenerating later.
            </p>
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-2 text-xs underline text-red-300 hover:text-red-200"
            >
              {open ? 'Hide details' : 'Show details'}
            </button>
            {open && <IntegrityDetail skipped={metadata.skipped} errors={metadata.errors} expectedCount={expectedCount} />}
          </div>
        </div>
      </div>
    );
  }

  // degraded
  // countableSkips, not a local 'unknown' filter: an auto-flagged member counts
  // toward the thresholds, so suppressing it here made the pill under-report
  // the very skips that triggered the warning.
  const countedCount = countableSkips(metadata.skipped).length;
  const totalCount = metadata.skipped.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${PILL_BASE} bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors`}
        title="Click for details"
      >
        ⚠ {totalCount} partial{countedCount > 0 ? ` (${countedCount} unexplained)` : ''}
      </button>
      {open && (
        <div className="mt-3 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <IntegrityDetail skipped={metadata.skipped} errors={metadata.errors} expectedCount={expectedCount} />
        </div>
      )}
    </>
  );
}

function IntegrityDetail({ skipped, errors, expectedCount }: { skipped: SkippedMember[]; errors: IntegrityError[]; expectedCount: number }) {
  return (
    <div className="text-xs space-y-3 mt-2">
      {skipped.length > 0 && (
        <div>
          <p className="text-gray-400 font-semibold mb-1">
            Skipped engineers ({skipped.length} of {expectedCount} org members)
          </p>
          <ul className="space-y-0.5 text-gray-300">
            {skipped.map(s => (
              <li key={s.login}>
                <span className="font-mono">@{s.login}</span>
                <span className="text-gray-500 ml-2">({classificationLabel(s.classification)})</span>
                <span className="text-gray-500 ml-2">— {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors.length > 0 && (
        <div>
          <p className="text-gray-400 font-semibold mb-1">Non-fatal errors ({errors.length})</p>
          <ul className="space-y-0.5 text-gray-300">
            {errors.slice(0, 50).map((e, i) => (
              <li key={i}>
                <span className="text-gray-500">[{e.context}]</span>
                {e.login && <span className="font-mono ml-1">@{e.login}</span>}
                {e.sha && <span className="font-mono ml-1">{e.sha.slice(0, 8)}</span>}
                <span className="text-gray-500 ml-2">— {e.message}</span>
              </li>
            ))}
            {errors.length > 50 && <li className="text-gray-500 italic">…and {errors.length - 50} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
