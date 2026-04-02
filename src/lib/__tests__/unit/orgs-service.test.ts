jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(),
}));

jest.mock('@/lib/github', () => ({
  getGitHubProvider: jest.fn(),
}));

import { listOrgs } from '@/lib/orgs/service';
import { getGitHubProvider } from '@/lib/github';

const mockGetGitHubProvider = getGitHubProvider as jest.MockedFunction<typeof getGitHubProvider>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listOrgs', () => {
  it('returns mapped org objects with login and avatar_url', async () => {
    mockGetGitHubProvider.mockReturnValue({
      listOrgs: jest.fn().mockResolvedValue([
        { login: 'acme', avatar_url: 'https://avatars.example.com/acme' },
        { login: 'widgets-inc', avatar_url: 'https://avatars.example.com/widgets' },
      ]),
      listOrgMembers: jest.fn(),
      fetchUserActivity: jest.fn(),
    });

    const orgs = await listOrgs();

    expect(orgs).toEqual([
      { login: 'acme', avatar_url: 'https://avatars.example.com/acme' },
      { login: 'widgets-inc', avatar_url: 'https://avatars.example.com/widgets' },
    ]);
  });

  it('defaults avatar_url to empty string when missing or undefined', async () => {
    mockGetGitHubProvider.mockReturnValue({
      listOrgs: jest.fn().mockResolvedValue([
        { login: 'no-avatar', avatar_url: '' },
        { login: 'null-avatar', avatar_url: '' },
      ]),
      listOrgMembers: jest.fn(),
      fetchUserActivity: jest.fn(),
    });

    const orgs = await listOrgs();

    expect(orgs).toEqual([
      { login: 'no-avatar', avatar_url: '' },
      { login: 'null-avatar', avatar_url: '' },
    ]);
  });

  it('handles pagination by collecting results from multiple pages', async () => {
    mockGetGitHubProvider.mockReturnValue({
      listOrgs: jest.fn().mockResolvedValue([
        { login: 'org-page1-a', avatar_url: 'https://avatars.example.com/a' },
        { login: 'org-page1-b', avatar_url: 'https://avatars.example.com/b' },
        { login: 'org-page2-a', avatar_url: 'https://avatars.example.com/c' },
      ]),
      listOrgMembers: jest.fn(),
      fetchUserActivity: jest.fn(),
    });

    const orgs = await listOrgs();

    expect(orgs).toHaveLength(3);
    expect(orgs.map((o) => o.login)).toEqual([
      'org-page1-a',
      'org-page1-b',
      'org-page2-a',
    ]);
  });

  it('returns an empty array when there are no orgs', async () => {
    mockGetGitHubProvider.mockReturnValue({
      listOrgs: jest.fn().mockResolvedValue([]),
      listOrgMembers: jest.fn(),
      fetchUserActivity: jest.fn(),
    });

    const orgs = await listOrgs();

    expect(orgs).toEqual([]);
  });
});
