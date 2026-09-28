/** GLOOK-59: one run model shared by GitHub reports and vulnerability syncs. */
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'partial' | 'stopped' | 'failed';

const REPORT: Record<string, RunStatus> = {
  pending: 'pending', running: 'running', completed: 'succeeded', failed: 'failed', stopped: 'stopped',
};
const SYNC: Record<string, RunStatus> = {
  running: 'running', succeeded: 'succeeded', partial: 'partial', failed: 'failed',
};

function map(table: Record<string, RunStatus>, s: string): { status: RunStatus; label: string } {
  const status = table[s];
  // An unknown status still renders (neutral chip, raw text) rather than being mislabelled.
  return status ? { status, label: status } : { status: 'pending', label: s };
}

export const fromReportStatus = (s: string) => map(REPORT, s);
export const fromSyncStatus = (s: string) => map(SYNC, s);
export const isActive = (s: RunStatus) => s === 'pending' || s === 'running';

export const STATUS_STYLE: Record<RunStatus, { text: string; bg: string }> = {
  pending:   { text: 'text-gray-400',      bg: 'bg-gray-800' },
  running:   { text: 'text-accent-light',  bg: 'bg-accent/10' },
  succeeded: { text: 'text-green-400',     bg: 'bg-green-500/10' },
  partial:   { text: 'text-amber-400',     bg: 'bg-amber-500/10' },
  stopped:   { text: 'text-orange-400',    bg: 'bg-orange-500/10' },
  failed:    { text: 'text-red-400',       bg: 'bg-red-500/10' },
};
