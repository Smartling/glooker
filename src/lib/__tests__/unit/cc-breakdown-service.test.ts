jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/cc-spend/apply', () => ({
  applyCcSpend: jest.fn(async () => ({
    matched: 1, unmappedEmail: 0, noDevStatsRow: 0, totalApiUsers: 1,
    totalSpendUsd: 1, periodStart: '2026-07-01', periodEnd: '2026-07-15',
  })),
  ReportNotFoundError: class ReportNotFoundError extends Error {},
}));
jest.mock('@/lib/cc-spend/apply-breakdowns', () => ({
  applySkillsUsage: jest.fn(async () => ({ matched: 1, unmappedEmail: 0, rows: 2 })),
  applyModelUsage: jest.fn(async () => ({ matched: 1, unmappedEmail: 0, rows: 3 })),
}));

type Log = (msg: string) => void;
const pullByPeriod = jest.fn(async (_periodStart: string, _periodEnd: string, _log?: Log) => [] as unknown[]);
const pullSkillsByPeriod = jest.fn(async (_periodStart: string, _periodEnd: string, _log?: Log) => [] as unknown[]);
const pullModelCostByPeriod = jest.fn(async (_periodStart: string, _periodEnd: string, _log?: Log) => [] as unknown[]);
jest.mock('@/lib/cc-spend/provider', () => ({
  getCcSpendProvider: () => ({ pullByPeriod, pullSkillsByPeriod, pullModelCostByPeriod, probe: jest.fn() }),
}));

import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import db from '@/lib/db';
import { applySkillsUsage, applyModelUsage } from '@/lib/cc-spend/apply-breakdowns';

const mockExecute = db.execute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // created_at far in the past so the clamp is not what limits the window.
  mockExecute.mockResolvedValue([[{ id: 'r1', org: 'acme', created_at: '2026-07-15T00:00:00Z', period_days: 14 }], null]);
});

it('pulls all three dimensions and returns the breakdown results', async () => {
  const res: any = await refreshCcSpendForReport('r1');
  expect(pullByPeriod).toHaveBeenCalled();
  expect(pullSkillsByPeriod).toHaveBeenCalled();
  expect(pullModelCostByPeriod).toHaveBeenCalled();
  expect(res.skills).toEqual({ matched: 1, unmappedEmail: 0, rows: 2 });
  expect(res.models).toEqual({ matched: 1, unmappedEmail: 0, rows: 3 });
});

it('clamps the skills end date to today-2 for the data lag', async () => {
  const today = new Date();
  const recent = today.toISOString().slice(0, 10);
  mockExecute.mockResolvedValue([[{ id: 'r1', org: 'acme', created_at: `${recent}T00:00:00Z`, period_days: 14 }], null]);

  await refreshCcSpendForReport('r1');

  const skillsEnd = pullSkillsByPeriod.mock.calls[0][1] as unknown as string;
  const expected = new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10);
  expect(skillsEnd).toBe(expected);
  // The cost pull is unaffected by the lag clamp.
  expect(pullByPeriod.mock.calls[0][1]).toBe(recent);
});

it('a skills failure does not fail the refresh or block the model pull, and is surfaced on skillsError', async () => {
  pullSkillsByPeriod.mockRejectedValueOnce(new Error('Anthropic Analytics API 400'));
  const res: any = await refreshCcSpendForReport('r1');
  expect(res.matched).toBe(1);          // cost result preserved
  expect(res.skills).toBeUndefined();
  // PR #64 review: the refresh route returns HTTP 200 with no other failure
  // channel, so "skills absent because it failed" must be distinguishable
  // from "skills absent because 0 rows" (skills would be a present, empty
  // BreakdownApplyResult in that case, not undefined).
  expect(res.skillsError).toBe('Anthropic Analytics API 400');
  expect(applySkillsUsage).not.toHaveBeenCalled();
  expect(applyModelUsage).toHaveBeenCalled();
  expect(res.models).toEqual({ matched: 1, unmappedEmail: 0, rows: 3 });
  expect(res.modelsError).toBeUndefined();
});

it('a model failure does not fail the refresh, and is surfaced on modelsError', async () => {
  pullModelCostByPeriod.mockRejectedValueOnce(new Error('boom'));
  const res: any = await refreshCcSpendForReport('r1');
  expect(res.matched).toBe(1);
  expect(res.models).toBeUndefined();
  expect(res.modelsError).toBe('boom');
  // The independently-failed skills pull is unaffected.
  expect(res.skills).toEqual({ matched: 1, unmappedEmail: 0, rows: 2 });
  expect(res.skillsError).toBeUndefined();
});
