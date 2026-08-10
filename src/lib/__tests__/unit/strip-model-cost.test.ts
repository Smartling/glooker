jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { stripModelCost } from '@/lib/cost-visibility';

const rows = [
  { model: 'claude-sonnet-5', cost: 500, requests: 20 },
  { model: 'claude-opus-4-8', cost: 900, requests: 5 },
];

it('returns rows untouched when cost is visible', () => {
  const out = stripModelCost(rows, () => true, 'alice');
  expect(out).toEqual(rows);
});

it('drops cost AND requests when cost is not visible, keeping model', () => {
  const out = stripModelCost(rows, () => false, 'alice') as any[];
  expect(out.map(m => m.model).sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
  for (const m of out) {
    expect(m).not.toHaveProperty('cost');
    expect(m).not.toHaveProperty('requests');
  }
});

it('re-orders by model name when stripped so order carries no cost signal', () => {
  // cost order is [opus 900, sonnet 500]; name order is [opus, sonnet] — use a
  // fixture where the two differ so the assertion is load-bearing.
  const mixed = [
    { model: 'zeta-model', cost: 900, requests: 1 },
    { model: 'alpha-model', cost: 100, requests: 2 },
  ];
  const visible = stripModelCost(mixed, () => true, 'alice') as any[];
  expect(visible.map(m => m.model)).toEqual(['zeta-model', 'alpha-model']);   // untouched
  const hidden = stripModelCost(mixed, () => false, 'alice') as any[];
  expect(hidden.map(m => m.model)).toEqual(['alpha-model', 'zeta-model']);    // name-ordered
});

it('passes the developer login to the predicate', () => {
  const canSeeCost = jest.fn(() => true);
  stripModelCost(rows, canSeeCost, 'carol');
  expect(canSeeCost).toHaveBeenCalledWith('carol');
});

it('handles an empty array', () => {
  expect(stripModelCost([], () => false, 'alice')).toEqual([]);
});
