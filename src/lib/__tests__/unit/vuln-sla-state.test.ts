import { slaState, slaStateLabel, slaActive, anySlaActive, type SlaSource } from '@/app/vulnerabilities/sla-state';

const TODAY = '2099-06-01';

const src = (over: Partial<SlaSource> = {}): SlaSource => ({
  slaStatus: { critical: 'active', high: 'none' },
  slaPolicyInvalid: false,
  policy: [{ severity: 'critical', effectiveFrom: '2020-01-08', pending: false }],
  ...over,
});

it('active: no label in either wording, and the overdue columns exist', () => {
  expect(slaState('critical', src())).toEqual({ kind: 'active' });
  expect(slaStateLabel(slaState('critical', src()), { withSla: false })).toBeNull();
  expect(slaStateLabel(slaState('critical', src()), { withSla: true })).toBeNull();
  expect(slaActive('critical', src())).toBe(true);
});

it('none: "No SLA policy yet" where the header says SLA, "no SLA policy yet" where it does not, and no overdue column', () => {
  const st = slaState('high', src());
  expect(st).toEqual({ kind: 'none' });
  expect(slaStateLabel(st, { withSla: false })).toBe('No SLA policy yet');
  expect(slaStateLabel(st, { withSla: true })).toBe('no SLA policy yet');
  expect(slaActive('high', src())).toBe(false);
});

it('pending: the earliest pending effectiveFrom for THAT severity, written as a display date', () => {
  const s = src({
    slaStatus: { critical: 'active', high: 'pending' },
    policy: [
      { severity: 'critical', effectiveFrom: '2020-01-08', pending: false },
      { severity: 'high', effectiveFrom: '2099-03-01', pending: true },
      { severity: 'high', effectiveFrom: '2099-02-01', pending: true },
      { severity: 'critical', effectiveFrom: '2098-01-01', pending: true },
    ],
  });
  const st = slaState('high', s);
  expect(st).toEqual({ kind: 'pending', startsOn: '2099-02-01' });
  expect(slaStateLabel(st, { withSla: false, today: TODAY })).toBe('Starts Feb 1');
  expect(slaStateLabel(st, { withSla: true, today: TODAY })).toBe('SLA starts Feb 1');
  // A start date in another year than today's carries its year.
  expect(slaStateLabel(st, { withSla: true, today: '2098-06-01' })).toBe('SLA starts Feb 1, 2099');
  expect(slaActive('high', s)).toBe(false);
});

it('pending with no pending entry for the severity reads "later"', () => {
  expect(slaStateLabel({ kind: 'pending', startsOn: null }, { withSla: false })).toBe('Starts later');
  expect(slaStateLabel({ kind: 'pending', startsOn: null }, { withSla: true })).toBe('SLA starts later');
});

it('invalid wins over none for BOTH severities: an invalid policy never reads as merely empty', () => {
  const s = src({ slaStatus: { critical: 'none', high: 'none' }, slaPolicyInvalid: true, policy: [] });
  for (const sev of ['critical', 'high'] as const) {
    const st = slaState(sev, s);
    expect(st).toEqual({ kind: 'invalid' });
    expect(slaStateLabel(st, { withSla: false })).toBe('Policy error');
    expect(slaStateLabel(st, { withSla: true })).toBe("SLA policy can't be read");
    expect(slaActive(sev, s)).toBe(false);
  }
});

it('anySlaActive is true when either severity is active, false otherwise (pending counts as not active)', () => {
  expect(anySlaActive(src())).toBe(true);
  expect(anySlaActive(src({ slaStatus: { critical: 'none', high: 'active' } }))).toBe(true);
  expect(anySlaActive(src({ slaStatus: { critical: 'pending', high: 'none' } }))).toBe(false);
  expect(anySlaActive(src({ slaStatus: { critical: 'active', high: 'active' }, slaPolicyInvalid: true }))).toBe(false);
});
