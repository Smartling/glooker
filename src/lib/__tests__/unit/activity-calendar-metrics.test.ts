import { teamThresholds, shadeFor } from '@/lib/activity-calendar/metrics';

describe('team shade scale', () => {
  it('uses quartiles of the non-zero days', () => {
    expect(teamThresholds([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([2, 4, 6]);
    expect(teamThresholds([0, 0])).toEqual([]);
  });

  it('maps values to shades 0..4', () => {
    const t = [3, 5, 7];
    expect([0, 1, 3, 4, 5, 7, 8, 100].map((v) => shadeFor(v, t))).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
  });

  it('gives the same value the same shade regardless of whose row it is on', () => {
    const t = teamThresholds([1, 1, 1, 20]);
    expect(shadeFor(20, t)).toBe(4);
    expect(shadeFor(1, t)).toBe(1);
  });
});
