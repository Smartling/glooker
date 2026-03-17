import { validateScheduleBody } from '@/lib/schedule-validation';

describe('validateScheduleBody', () => {
  const valid = {
    org: 'my-org',
    periodDays: 14,
    cronExpr: '0 9 * * 1',
    timezone: 'America/New_York',
  };

  it('returns null for valid input', () => {
    expect(validateScheduleBody(valid)).toBeNull();
  });

  it('rejects missing org', () => {
    expect(validateScheduleBody({ ...valid, org: '' })).toBe('org is required');
  });

  it('rejects non-string org', () => {
    expect(validateScheduleBody({ ...valid, org: 123 })).toBe('org is required');
  });

  it('rejects invalid periodDays', () => {
    expect(validateScheduleBody({ ...valid, periodDays: 7 })).toBe('periodDays must be 3, 14, 30, or 90');
  });

  it('accepts all valid periodDays values', () => {
    for (const d of [3, 14, 30, 90]) {
      expect(validateScheduleBody({ ...valid, periodDays: d })).toBeNull();
    }
  });

  it('rejects missing cronExpr', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: '' })).toBe('cronExpr is required');
  });

  it('rejects non-string cronExpr', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: 42 })).toBe('cronExpr is required');
  });

  it('rejects invalid cron expression', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: 'not-a-cron' })).toBe('Invalid cron expression or timezone');
  });

  it('rejects missing timezone', () => {
    expect(validateScheduleBody({ ...valid, timezone: '' })).toBe('timezone is required');
  });

  it('rejects non-string timezone', () => {
    expect(validateScheduleBody({ ...valid, timezone: null })).toBe('timezone is required');
  });

  it('rejects invalid cron with valid timezone', () => {
    expect(validateScheduleBody({ ...valid, cronExpr: '99 99 99 99 99' })).toBe('Invalid cron expression or timezone');
  });
});
