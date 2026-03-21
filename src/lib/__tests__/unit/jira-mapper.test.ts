import { resolveJiraUser } from '@/lib/jira/mapper';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

jest.mock('@/lib/jira/client', () => ({
  getJiraClient: jest.fn(),
}));

import db from '@/lib/db';
import { getJiraClient } from '@/lib/jira/client';

const mockDb = db as any;
const mockGetJiraClient = getJiraClient as jest.Mock;

describe('resolveJiraUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing mapping from DB', async () => {
    mockDb.execute.mockResolvedValueOnce([[{
      jira_account_id: 'jira-123',
      jira_email: 'dev@co.com',
    }], null]);

    const result = await resolveJiraUser('myorg', 'devuser', 'report-1');
    expect(result).toEqual({ accountId: 'jira-123', email: 'dev@co.com' });
  });

  it('returns null when no mapping and no Jira client', async () => {
    mockDb.execute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue(null);

    const result = await resolveJiraUser('myorg', 'devuser', 'report-1');
    expect(result).toBeNull();
  });

  it('auto-discovers via commit emails and persists mapping', async () => {
    mockDb.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[
        { author_email: 'dev@co.com' },
        { author_email: 'dev@personal.com' },
      ], null])
      .mockResolvedValueOnce([[], null]);

    const mockClient = {
      findUserByEmail: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ accountId: 'jira-456', displayName: 'Dev', emailAddress: 'dev@personal.com' }),
    };
    mockGetJiraClient.mockReturnValue(mockClient);

    const result = await resolveJiraUser('myorg', 'devuser', 'report-1');
    expect(result).toEqual({ accountId: 'jira-456', email: 'dev@personal.com' });
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });
});
