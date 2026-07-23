jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import { getProjectInsights } from '@/lib/projects/insights';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

describe('getProjectInsights', () => {
  beforeEach(() => mockExecute.mockReset());

  it('returns { available: false } when the explicit report id does not exist', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // report lookup empty
    const result = await getProjectInsights('missing-id');
    expect(result).toEqual({ available: false });
  });

  it('returns { available: false } when there are no completed reports', async () => {
    mockExecute.mockResolvedValueOnce([[], null]); // latest lookup empty
    const result = await getProjectInsights();
    expect(result).toEqual({ available: false });
  });

  it('returns { available: false } when the report has no jira issues', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, created_at: '2026-01-01' }], null])
      .mockResolvedValueOnce([[{ cnt: 0 }], null]); // jira count
    const result = await getProjectInsights('r1');
    expect(result).toEqual({ available: false });
  });
});
