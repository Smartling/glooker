import { computeModelMix } from '@/app/report/[id]/org/spend-tab';

it('merges a model across developers and counts distinct developers', () => {
  const { rows, total } = computeModelMix([
    { github_login: 'alice', model: 'sonnet', cost: 300, requests: 10 },
    { github_login: 'bob', model: 'sonnet', cost: 100, requests: 30 },
    { github_login: 'alice', model: 'opus', cost: 600, requests: 5 },
  ]);
  expect(total).toBe(1000);
  expect(rows).toEqual([
    { model: 'opus', cost: 600, requests: 5, devs: 1, pct: 60, costPerRequest: 120 },
    { model: 'sonnet', cost: 400, requests: 40, devs: 2, pct: 40, costPerRequest: 10 },
  ]);
});

it('SCOPE COHERENCE: ignores rows whose cost was stripped', () => {
  // carol's cost was stripped, so her model must not appear at all and must not
  // inflate any dev count — no $0 phantom row, no org-wide names beside
  // team-only cost.
  const { rows, total } = computeModelMix([
    { github_login: 'alice', model: 'sonnet', cost: 400, requests: 10 },
    { github_login: 'carol', model: 'sonnet' },
    { github_login: 'carol', model: 'haiku' },
  ]);
  expect(total).toBe(400);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ model: 'sonnet', cost: 400, devs: 1 });
  expect(rows.map(r => r.model)).not.toContain('haiku');
});

it('sorts by cost descending, then model name', () => {
  const { rows } = computeModelMix([
    { github_login: 'a', model: 'zeta', cost: 100, requests: 1 },
    { github_login: 'a', model: 'alpha', cost: 100, requests: 1 },
    { github_login: 'a', model: 'big', cost: 900, requests: 1 },
  ]);
  expect(rows.map(r => r.model)).toEqual(['big', 'alpha', 'zeta']);
});

it('handles zero requests without dividing by zero', () => {
  const { rows } = computeModelMix([{ github_login: 'a', model: 'm', cost: 500, requests: 0 }]);
  expect(rows[0].costPerRequest).toBe(0);
  expect(Number.isNaN(rows[0].costPerRequest)).toBe(false);
});

it('returns an empty result for no rows and for all-stripped rows', () => {
  expect(computeModelMix([])).toEqual({ rows: [], total: 0 });
  expect(computeModelMix([{ github_login: 'a', model: 'm' }])).toEqual({ rows: [], total: 0 });
});
