jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import {
  isCommitInDefaultBranch,
  __setOctokitForTest,
  __clearAllCachesForTest,
  getDefaultBranch,
} from '../../github';

describe('isCommitInDefaultBranch', () => {
  afterEach(() => {
    __setOctokitForTest(null as any);
    __clearAllCachesForTest();
  });

  it('returns true when compare status is behind', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'behind' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app-behind', 'abc123')).toBe(true);
  });

  it('returns true when compare status is identical', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'identical' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app-identical', 'abc123')).toBe(true);
  });

  it('returns false when compare status is ahead', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'ahead' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app-ahead', 'abc123')).toBe(false);
  });

  it('returns false when compare status is diverged', async () => {
    const mockRepos = {
      get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'diverged' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    expect(await isCommitInDefaultBranch('acme', 'app-diverged', 'abc123')).toBe(false);
  });

  it('caches default branch lookups per owner/repo', async () => {
    const reposGet = jest.fn().mockResolvedValue({ data: { default_branch: 'master' } });
    const mockRepos = {
      get: reposGet,
      compareCommits: jest.fn().mockResolvedValue({ data: { status: 'behind' } }),
    };
    __setOctokitForTest({ repos: mockRepos } as any);
    await getDefaultBranch('acme', 'cache-test');
    await getDefaultBranch('acme', 'cache-test');
    expect(reposGet).toHaveBeenCalledTimes(1);
  });
});
