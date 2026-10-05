import { countableSkips, type RunMetadata } from '@/lib/report-runner/types';

export interface RunHealth { tone: 'info' | 'warn' | 'error'; label: string; title?: string }

function parse(meta: unknown): RunMetadata | null {
  let m: any = meta;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return null; }
  }
  if (!m || typeof m !== 'object' || !['ok', 'degraded', 'failed'].includes(m.state)) return null;
  return m as RunMetadata;
}

/** Compact, card-sized summary of a report's integrity. Same rules as IntegrityBadge. */
export function reportHealth(meta: unknown): RunHealth | null {
  const m = parse(meta);
  if (!m) return null;
  if (m.state === 'failed') return m.abortReason ? { tone: 'error', label: 'incomplete', title: m.abortReason } : { tone: 'error', label: 'incomplete' };
  if (m.state === 'degraded') {
    const skipped = Array.isArray(m.skipped) ? m.skipped : [];
    const counted = countableSkips(skipped).length;
    return { tone: 'warn', label: `${skipped.length} partial${counted > 0 ? ` (${counted} unexplained)` : ''}` };
  }
  const unverified = Array.isArray(m.unverified) ? m.unverified.length : 0;
  return unverified > 0 ? { tone: 'info', label: `${unverified} unverified` } : null;
}

export function syncHealth(row: { status: string; issues: Array<{ message: string }> }): RunHealth | null {
  const n = Array.isArray(row.issues) ? row.issues.length : 0;
  if (row.status === 'running' || n === 0) return null;
  return { tone: row.status === 'failed' ? 'error' : 'warn', label: `${n} issue${n === 1 ? '' : 's'}` };
}
