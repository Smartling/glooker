import { getWorkingDays } from '@/lib/team-pulse/data';

describe('getWorkingDays', () => {
  it('returns 4 working days ending before a Sunday', () => {
    const days = getWorkingDays(new Date('2026-04-13T00:00:00'), 4);
    expect(days).toEqual(['2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']);
  });

  it('returns 4 working days ending before a Saturday', () => {
    const days = getWorkingDays(new Date('2026-04-11T00:00:00'), 4);
    expect(days).toEqual(['2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']);
  });

  it('returns 4 working days ending before a Friday', () => {
    const days = getWorkingDays(new Date('2026-04-10T00:00:00'), 4);
    expect(days).toEqual(['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09']);
  });

  it('skips weekends going backwards', () => {
    const days = getWorkingDays(new Date('2026-04-07T00:00:00'), 4);
    expect(days).toEqual(['2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03']);
  });
});
