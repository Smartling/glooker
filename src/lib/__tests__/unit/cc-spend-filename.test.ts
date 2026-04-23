import { parseSpendPeriodFromFilename } from '../../cc-spend/filename';

describe('parseSpendPeriodFromFilename', () => {
  it('extracts the date range from a canonical filename', () => {
    expect(parseSpendPeriodFromFilename('spend-report-1ae190d0-0989-4e37-9578-fbe66969e86b-2026-04-01-to-2026-04-21.csv'))
      .toEqual({ start: '2026-04-01', end: '2026-04-21' });
  });

  it('returns null when the date range is missing', () => {
    expect(parseSpendPeriodFromFilename('spend-report.csv')).toBeNull();
    expect(parseSpendPeriodFromFilename('something-2026-04-01.csv')).toBeNull();
  });

  it('returns null for malformed date shapes', () => {
    expect(parseSpendPeriodFromFilename('report-2026-4-1-to-2026-4-21.csv')).toBeNull();
  });

  it('uses the first date range when multiple appear', () => {
    expect(parseSpendPeriodFromFilename('x-2026-01-01-to-2026-01-31-y-2026-02-01-to-2026-02-28.csv'))
      .toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });
});
