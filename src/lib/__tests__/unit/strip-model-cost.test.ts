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

// PR #64 review: keeping one row per model (with `model` retained, cost/requests
// stripped) still discloses that a non-teammate uses Claude Code and which
// models — a coarse spend signal even with amounts hidden, since model choice
// is the dominant per-request cost driver. Returning no rows at all makes
// "cannot see this developer's cost" indistinguishable from "no usage",
// matching stripCostFields/stripDevCost's behavior for the scalar fields.
it('returns no rows at all when cost is not visible', () => {
  const out = stripModelCost(rows, () => false, 'alice');
  expect(out).toEqual([]);
});

it('passes the developer login to the predicate', () => {
  const canSeeCost = jest.fn(() => true);
  stripModelCost(rows, canSeeCost, 'carol');
  expect(canSeeCost).toHaveBeenCalledWith('carol');
});

it('handles an empty array', () => {
  expect(stripModelCost([], () => false, 'alice')).toEqual([]);
  expect(stripModelCost([], () => true, 'alice')).toEqual([]);
});
