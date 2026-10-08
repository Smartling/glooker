import { displayDate, utcToday, unmeasuredBadgeText, unmeasuredCountText, unmeasuredReason } from '@/app/vulnerabilities/labels';

describe('displayDate', () => {
  it('drops the year within the current year and keeps it in any other year', () => {
    expect(displayDate('2026-10-04', '2026-10-07')).toBe('Oct 4');
    expect(displayDate('2026-01-01', '2026-12-31')).toBe('Jan 1');
    expect(displayDate('2020-01-08', '2026-10-07')).toBe('Jan 8, 2020');
    expect(displayDate('2027-02-03', '2026-10-07')).toBe('Feb 3, 2027');
  });

  it('reads an ISO instant in UTC, so a late-evening instant stays on its UTC day', () => {
    expect(displayDate('2026-08-14T23:30:00Z', '2026-10-07')).toBe('Aug 14');
    expect(displayDate('2025-12-31T23:59:59Z', '2026-10-07')).toBe('Dec 31, 2025');
    // Just after UTC midnight: a local-time reading west of UTC would still be on the day before.
    expect(displayDate('2026-08-14T00:30:00Z', '2026-10-07')).toBe('Aug 14');
    expect(displayDate('2026-01-01T00:00:00Z', '2026-10-07')).toBe('Jan 1');
  });

  it('returns anything unparseable as it came', () => {
    expect(displayDate('not a date', '2026-10-07')).toBe('not a date');
    expect(displayDate('', '2026-10-07')).toBe('');
  });

  it('defaults "today" to the UTC date of Date.now(), so the current year follows the clock', () => {
    const spy = jest.spyOn(Date, 'now');
    try {
      spy.mockReturnValue(Date.parse('2031-06-15T12:00:00Z'));
      expect(utcToday()).toBe('2031-06-15');
      expect(displayDate('2031-03-02')).toBe('Mar 2');
      expect(displayDate('2030-03-02')).toBe('Mar 2, 2030');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('unmeasuredReason', () => {
  it('Dependabot off, else the check\'s own detail, else "Status check failed"', () => {
    expect(unmeasuredReason({ status: 'dependabot-off', detail: null })).toBe('Dependabot off');
    expect(unmeasuredReason({ status: 'dependabot-off', detail: 'ignored' })).toBe('Dependabot off');
    expect(unmeasuredReason({ status: 'error', detail: 'HTTP 500' })).toBe('HTTP 500');
    expect(unmeasuredReason({ status: 'error', detail: null })).toBe('Status check failed');
  });
});

describe('the unmeasured badge phrase', () => {
  it('counts "repo" and "repos" and starts with the ▲ glyph', () => {
    expect(unmeasuredCountText(1)).toBe('1 unmeasured repo');
    expect(unmeasuredCountText(2)).toBe('2 unmeasured repos');
    expect(unmeasuredBadgeText(1)).toBe('▲ 1 unmeasured repo');
    expect(unmeasuredBadgeText(12)).toBe('▲ 12 unmeasured repos');
    expect(unmeasuredBadgeText(1234)).toBe('▲ 1,234 unmeasured repos');
  });
});
