import { fromReportStatus, fromSyncStatus, isActive, STATUS_STYLE } from '@/lib/runs/status';
import { formatRunTime, formatDuration, triggerLabel } from '@/lib/runs/format';
import { reportHealth, syncHealth } from '@/lib/runs/health';
import { staleAfterMs, isStale } from '@/lib/runs/staleness';

describe('run status mapping', () => {
  it('maps report statuses onto the shared model', () => {
    expect(fromReportStatus('completed')).toEqual({ status: 'succeeded', label: 'succeeded' });
    expect(fromReportStatus('stopped')).toEqual({ status: 'stopped', label: 'stopped' });
    expect(fromReportStatus('running')).toEqual({ status: 'running', label: 'running' });
    expect(fromReportStatus('pending')).toEqual({ status: 'pending', label: 'pending' });
    expect(fromReportStatus('failed')).toEqual({ status: 'failed', label: 'failed' });
  });
  it('maps sync statuses onto the shared model', () => {
    expect(fromSyncStatus('succeeded').status).toBe('succeeded');
    expect(fromSyncStatus('partial').status).toBe('partial');
    expect(fromSyncStatus('failed').status).toBe('failed');
    expect(fromSyncStatus('running').status).toBe('running');
  });
  it('falls back to pending with the raw label for an unknown status', () => {
    expect(fromReportStatus('archived')).toEqual({ status: 'pending', label: 'archived' });
    expect(fromSyncStatus('weird')).toEqual({ status: 'pending', label: 'weird' });
  });
  it('isActive only for pending/running', () => {
    expect(isActive('running')).toBe(true);
    expect(isActive('pending')).toBe(true);
    expect(isActive('succeeded')).toBe(false);
  });
  it('has a style for every status and uses the accent token for running', () => {
    for (const s of ['pending', 'running', 'succeeded', 'partial', 'stopped', 'failed'] as const) {
      expect(STATUS_STYLE[s].text).toBeTruthy();
    }
    expect(STATUS_STYLE.running.text).toContain('accent');
  });
});

describe('run formatting', () => {
  it('formats times in America/New_York', () => {
    expect(formatRunTime('2026-09-22T10:00:00Z')).toBe('Sep 22, 6:00 AM');
  });
  it('returns an em dash for missing or invalid times', () => {
    expect(formatRunTime(null)).toBe('—');
    expect(formatRunTime('not a date')).toBe('—');
  });
  it('formats durations as Xm SSs', () => {
    expect(formatDuration('2026-09-22T10:00:00Z', '2026-09-22T10:04:12Z')).toBe('4m 12s');
    expect(formatDuration('2026-09-22T10:00:00Z', null)).toBe('—');
    expect(formatDuration('2026-09-22T10:05:00Z', '2026-09-22T10:00:00Z')).toBe('—');
  });
  it('labels triggers, and returns null for legacy rows with no trigger', () => {
    expect(triggerLabel('schedule', null)).toBe('Scheduled');
    expect(triggerLabel('manual', 'a@x')).toBe('Manual · a@x');
    expect(triggerLabel('manual', null)).toBe('Manual');
    expect(triggerLabel(null, null)).toBeNull();
    expect(triggerLabel(undefined, 'a@x')).toBeNull();
  });
});

describe('run health', () => {
  const base = { skipped: [], errors: [], expectedCount: 10, thresholds: {} };
  it('is null for no metadata or a clean ok run', () => {
    expect(reportHealth(null)).toBeNull();
    expect(reportHealth({ ...base, state: 'ok' })).toBeNull();
  });
  it('reports unverified figures on an ok run', () => {
    expect(reportHealth({ ...base, state: 'ok', unverified: [{ login: 'a', field: 'prs', reason: 'x' }] }))
      .toEqual({ tone: 'info', label: '1 unverified' });
  });
  it('reports degraded runs with the unexplained count', () => {
    const skipped = [
      { login: 'a', reason: 'r', classification: 'unknown' },
      { login: 'b', reason: 'r', classification: 'expected' },
    ];
    expect(reportHealth({ ...base, state: 'degraded', skipped })).toEqual({ tone: 'warn', label: '2 partial (1 unexplained)' });
  });
  it('reports failed runs as incomplete with the abort reason as title', () => {
    expect(reportHealth({ ...base, state: 'failed', abortReason: 'too many skips' }))
      .toEqual({ tone: 'error', label: 'incomplete', title: 'too many skips' });
  });
  it('accepts a JSON string (SQLite) and survives malformed input', () => {
    expect(reportHealth(JSON.stringify({ ...base, state: 'failed' }))?.label).toBe('incomplete');
    expect(reportHealth('{not json')).toBeNull();
    expect(reportHealth(42)).toBeNull();
    expect(reportHealth({ nonsense: true })).toBeNull();
  });
  it('sync health counts issues on finished runs only', () => {
    expect(syncHealth({ status: 'partial', issues: [{ message: 'a' }, { message: 'b' }] })).toEqual({ tone: 'warn', label: '2 issues' });
    expect(syncHealth({ status: 'failed', issues: [{ message: 'a' }] })).toEqual({ tone: 'error', label: '1 issue' });
    expect(syncHealth({ status: 'succeeded', issues: [] })).toBeNull();
    expect(syncHealth({ status: 'running', issues: [{ message: 'a' }] })).toBeNull();
  });
});

describe('report staleness', () => {
  const monday9am = new Date('2026-09-28T13:00:00Z'); // Mon 09:00 America/New_York
  it('is null when no schedule is enabled', () => {
    expect(staleAfterMs([], monday9am)).toBeNull();
    expect(staleAfterMs([{ cron_expr: '0 9 * * *', timezone: 'America/New_York', enabled: 0 }], monday9am)).toBeNull();
  });
  it('uses the largest gap between upcoming fires plus 12h grace', () => {
    // weekday 9am: largest gap is Fri 9am -> Mon 9am = 72h
    const ms = staleAfterMs([{ cron_expr: '0 9 * * 1-5', timezone: 'America/New_York', enabled: 1 }], monday9am);
    expect(ms).toBe((72 + 12) * 3600 * 1000);
  });
  it('takes the tightest threshold across schedules and skips invalid crons', () => {
    const ms = staleAfterMs([
      { cron_expr: 'not a cron', timezone: 'America/New_York', enabled: true },
      { cron_expr: '0 9 * * 1', timezone: 'America/New_York', enabled: true },   // weekly: 168h
      { cron_expr: '0 */6 * * *', timezone: 'America/New_York', enabled: true }, // 6h
    ], monday9am);
    expect(ms).toBe((6 + 12) * 3600 * 1000);
  });
  it('a Monday-morning report after a Friday run is not stale on a weekday schedule', () => {
    const ms = staleAfterMs([{ cron_expr: '0 9 * * 1-5', timezone: 'America/New_York', enabled: 1 }], monday9am);
    expect(isStale('2026-09-25T13:05:00Z', ms, monday9am)).toBe(false); // Fri 09:05 ET, 72h ago
  });
  it('isStale: never stale without a threshold; stale when missing data and a threshold exists', () => {
    expect(isStale('2020-01-01T00:00:00Z', null, monday9am)).toBe(false);
    expect(isStale(null, 1000, monday9am)).toBe(true);
    expect(isStale(new Date(monday9am.getTime() - 2000), 1000, monday9am)).toBe(true);
  });
});
