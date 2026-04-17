import { getWorkingDays } from '@/lib/team-pulse/data';

describe('getWorkingDays', () => {
  it('returns 4 working days ending before a Sunday', () => {
    // Apr 13 2026 is Sunday → walks back: Fri 10, Thu 9, Wed 8, Tue 7
    const days = getWorkingDays(new Date('2026-04-13T00:00:00'), 4);
    expect(days).toEqual(['2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']);
  });

  it('returns 4 working days ending before a Saturday', () => {
    // Apr 11 2026 is Saturday → walks back: Fri 10, Thu 9, Wed 8, Tue 7
    const days = getWorkingDays(new Date('2026-04-11T00:00:00'), 4);
    expect(days).toEqual(['2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']);
  });

  it('returns 4 working days ending before a Thursday', () => {
    // Apr 16 2026 is Thursday → walks back: Wed 15, Tue 14, Mon 13, Fri 10
    const days = getWorkingDays(new Date('2026-04-16T00:00:00'), 4);
    expect(days).toEqual(['2026-04-10', '2026-04-13', '2026-04-14', '2026-04-15']);
  });

  it('skips weekends going backwards', () => {
    // Apr 7 2026 is Tuesday → walks back: Mon 6, Fri 3, Thu 2, Wed 1
    const days = getWorkingDays(new Date('2026-04-07T00:00:00'), 4);
    expect(days).toEqual(['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-06']);
  });
});
