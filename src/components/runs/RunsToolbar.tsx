import type { ReactNode } from 'react';

/** The row under the Runs tabs: schedule/next-run info on the left, the tab's primary action on the right. */
export default function RunsToolbar({ info, action, error }: { info?: ReactNode; action?: ReactNode; error?: string | null }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500">{info}</span>
        {action}
      </div>
      {error && <div className="mt-2 text-xs text-red-400 border border-red-900 rounded p-2">{error}</div>}
    </div>
  );
}
