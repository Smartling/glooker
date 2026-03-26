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

    const result = await resolveJiraUser('myorg', 'devuser', ['dev@co.com']);
    expect(result).toEqual({ accountId: 'jira-123', email: 'dev@co.com' });
    // Only one DB call — the mapping lookup; no email query
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('returns null when no mapping and no Jira client', async () => {
    mockDb.execute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue(null);

    const result = await resolveJiraUser('myorg', 'devuser', ['dev@co.com']);
    expect(result).toBeNull();
  });

  it('returns null when no mapping, client present, but no emails provided', async () => {
    mockDb.execute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue({ findUserByEmail: jest.fn() });

    const result = await resolveJiraUser('myorg', 'devuser', []);
    expect(result).toBeNull();
  });

  it('auto-discovers via provided emails and persists mapping', async () => {
    // DB calls: 1 mapping lookup + 1 persist (no longer a 3rd call for email query)
    mockDb.execute
      .mockResolvedValueOnce([[], null])   // mapping lookup → not found
      .mockResolvedValueOnce([[], null]);  // persist INSERT

    const mockClient = {
      findUserByEmail: jest.fn()
        .mockResolvedValueOnce(null)  // dev@co.com → not found
        .mockResolvedValueOnce({ accountId: 'jira-456', displayName: 'Dev' }),
    };
    mockGetJiraClient.mockReturnValue(mockClient);

    const result = await resolveJiraUser('myorg', 'devuser', ['dev@co.com', 'dev@personal.com']);
    expect(result).toEqual({ accountId: 'jira-456', email: 'dev@personal.com' });
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });
});
