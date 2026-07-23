jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { resolveReportId } from '@/lib/mcp/resolve';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('resolveReportId', () => {
  it('returns the id when an explicit report id exists', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1' }], null]);
    expect(await resolveReportId('r1')).toEqual({ id: 'r1' });
  });

  it('errors with the exact message when an explicit id does not exist', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    expect(await resolveReportId('missing')).toEqual({ error: 'report not found: missing' });
  });

  it('falls back to the latest completed report when no id is given', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'latest' }], null]);
    expect(await resolveReportId()).toEqual({ id: 'latest' });
  });

  it('errors with "no completed reports" when none exist', async () => {
    mockExecute.mockResolvedValueOnce([[], null]);
    expect(await resolveReportId()).toEqual({ error: 'no completed reports' });
  });
});
