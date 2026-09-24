import { toIsoSecond, addDays, diffDays, utcDate } from '@/lib/vulnerabilities/time';
import { computeDue, daysRemaining, slaStatus, resolvedTiming, policyWindows } from '@/lib/vulnerabilities/sla';
import type { SlaEntry } from '@/lib/vulnerabilities/types';

describe('time helpers', () => {
  it('toIsoSecond strips milliseconds and normalises to UTC Z', () => {
    expect(toIsoSecond('2026-09-22T14:41:09.123Z')).toBe('2026-09-22T14:41:09Z');
    expect(toIsoSecond('2026-09-22T10:41:09-04:00')).toBe('2026-09-22T14:41:09Z');
    expect(toIsoSecond(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02T03:04:05Z');
  });
  it('addDays / diffDays / utcDate work on UTC calendar dates', () => {
    expect(addDays('2024-03-01', 30)).toBe('2024-03-31');
    expect(diffDays('2024-03-31', '2024-03-01')).toBe(30);
    expect(utcDate('2024-03-01T23:59:59Z')).toBe('2024-03-01');
  });
});

// The due-date example table. The policy playbook requires adding rows here with every policy
// entry. This file passes SlaEntry[] explicitly to every call, so it never uses
// the real deployment-configured policy — every id/date/days below is synthetic (2020-*, single-
// digit days), per the repo's public-repo rule.
const CRIT_ONLY: SlaEntry[] = [{ id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9 }];
const CRIT_CHANGE: SlaEntry[] = [
  { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9 },
  { id: 'critical-2020-06', severity: 'critical', effectiveFrom: '2020-06-01', days: 5 },
];

describe.each([
  // name, alert, policy, expected {clockStart, dueDate, policyId} | null
  ['created before policy start → clock at policy start',
    { severity: 'critical', createdAt: '2019-01-01T00:00:00Z', severityChangedAt: null }, CRIT_ONLY,
    { clockStart: '2020-01-08T00:00:00Z', dueDate: '2020-01-17', policyId: 'critical-2020-01', days: 9 }],
  ['created after policy start → clock at created_at',
    { severity: 'critical', createdAt: '2020-01-10T08:00:00Z', severityChangedAt: null }, CRIT_ONLY,
    { clockStart: '2020-01-10T08:00:00Z', dueDate: '2020-01-19', policyId: 'critical-2020-01', days: 9 }],
  ['across a policy change → entry in effect at clock start wins',
    { severity: 'critical', createdAt: '2020-06-05T00:00:00Z', severityChangedAt: null }, CRIT_CHANGE,
    { clockStart: '2020-06-05T00:00:00Z', dueDate: '2020-06-10', policyId: 'critical-2020-06', days: 5 }],
  ['created before a change keeps the old entry',
    { severity: 'critical', createdAt: '2020-05-28T00:00:00Z', severityChangedAt: null }, CRIT_CHANGE,
    { clockStart: '2020-05-28T00:00:00Z', dueDate: '2020-06-06', policyId: 'critical-2020-01', days: 9 }],
  ['upward re-rating (high → critical) restarts the critical clock at severity_changed_at',
    { severity: 'critical', createdAt: '2020-01-01T00:00:00Z', severityChangedAt: '2020-03-15T09:00:00Z' }, CRIT_ONLY,
    { clockStart: '2020-03-15T09:00:00Z', dueDate: '2020-03-24', policyId: 'critical-2020-01', days: 9 }],
  ['downward re-rating (critical → high) follows the high policy from created_at, not severity_changed_at',
    { severity: 'high', createdAt: '2020-01-01T00:00:00Z', severityChangedAt: '2020-03-15T09:00:00Z' },
    [...CRIT_ONLY, { id: 'high-2020-01', severity: 'high', effectiveFrom: '2020-01-08', days: 4 }],
    { clockStart: '2020-01-08T00:00:00Z', dueDate: '2020-01-12', policyId: 'high-2020-01', days: 4 }],
  // (A wrong implementation that restarts the clock on any re-rating would give a due date derived
  // from 2020-03-15 instead.)
  // The "reopen never moves the clock" rule is tested in vuln-aggregate.test.ts (overdue after reopen).
  ['high with no high entry → no due date',
    { severity: 'high', createdAt: '2020-02-01T00:00:00Z', severityChangedAt: null }, CRIT_ONLY, null],
] as const)('computeDue: %s', (_name, alert, policy, expected) => {
  it('matches the table', () => {
    expect(computeDue(alert as any, policy)).toEqual(expected);
  });
});

describe('daysRemaining / slaStatus / resolvedTiming', () => {
  it('is 0 on the due day and negative after', () => {
    expect(daysRemaining('2020-06-10', new Date('2020-06-10T23:00:00Z'))).toBe(0);
    expect(daysRemaining('2020-06-10', new Date('2020-06-11T00:00:01Z'))).toBe(-1);
    expect(daysRemaining('2020-06-10', new Date('2020-06-03T12:00:00Z'))).toBe(7);
  });
  it('reports pending before the first effectiveFrom, active after, none without entries', () => {
    expect(slaStatus('critical', new Date('2019-12-01T00:00:00Z'), CRIT_ONLY)).toBe('pending');
    expect(slaStatus('critical', new Date('2020-01-08T00:00:00Z'), CRIT_ONLY)).toBe('active');
    expect(slaStatus('high', new Date('2020-01-08T00:00:00Z'), CRIT_ONLY)).toBe('none');
  });
  it('resolvedTiming says on time or how late', () => {
    expect(resolvedTiming('2020-06-10', '2020-06-10T20:00:00Z')).toEqual({ onTime: true, daysLate: 0 });
    expect(resolvedTiming('2020-06-10', '2020-06-13T01:00:00Z')).toEqual({ onTime: false, daysLate: 3 });
  });
});

describe('policyWindows', () => {
  it('computes until for a superseded entry, leaves the latest open-ended, and flags pending correctly', () => {
    const policy: SlaEntry[] = [
      { id: 'critical-2020-01', severity: 'critical', effectiveFrom: '2020-01-08', days: 9 },
      { id: 'critical-2020-06', severity: 'critical', effectiveFrom: '2020-06-01', days: 5 },
    ];
    const now = new Date('2020-03-01T00:00:00Z');
    const windows = policyWindows(policy, now);
    const first = windows.find(w => w.id === 'critical-2020-01')!;
    const second = windows.find(w => w.id === 'critical-2020-06')!;
    expect(first).toMatchObject({ until: '2020-05-31', pending: false });
    expect(second).toMatchObject({ until: null, pending: true }); // the latest entry is open-ended, and hasn't started yet
  });
});
