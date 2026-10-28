import { withoutSpendInRange } from '@/lib/report/range-options';

describe('withoutSpendInRange', () => {
  const rows = [{ github_login: 'a', cc_total_cost: 1234, cc_requests: 5, total_commits: 3 }];

  it('keeps spend on the current report', () => {
    expect(withoutSpendInRange(rows, 'current')).toBe(rows);
  });

  it.each(['90d', '12m'] as const)('drops spend in %s', (range) => {
    expect(withoutSpendInRange(rows, range)).toEqual([{ github_login: 'a', total_commits: 3 }]);
  });
});
