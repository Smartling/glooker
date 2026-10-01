const TZ = 'America/New_York';

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The one timestamp format for run cards and freshness lines. */
export function formatRunTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  const a = toDate(start), b = toDate(end);
  if (!a || !b) return '—';
  const s = Math.round((b.getTime() - a.getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** null for rows that predate trigger tracking — show nothing rather than guess. */
export function triggerLabel(kind: string | null | undefined, by: string | null | undefined): string | null {
  if (kind === 'schedule') return 'Scheduled';
  if (kind === 'manual') return by ? `Manual · ${by}` : 'Manual';
  return null;
}
