jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));
jest.mock('@/lib/github', () => ({
  listOrgMembers: jest.fn(),
}));

import { listDevelopers, listDevelopersFromGitHub } from '@/lib/developers/service';
import db from '@/lib/db/index';
import { listOrgMembers } from '@/lib/github';

const mockDbExecute = db.execute as jest.Mock;
const mockListOrgMembers = listOrgMembers as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

describe('listDevelopers', () => {
  it('deduplicates rows for same login, keeping first (latest) name/avatar', async () => {
    // DB returns rows ordered by created_at DESC — most recent first
    mockDbExecute.mockResolvedValue([
      [
        { github_login: 'alice', github_name: 'Alice New', avatar_url: 'new.png', created_at: '2026-03-01' },
        { github_login: 'alice', github_name: 'Alice Old', avatar_url: 'old.png', created_at: '2026-01-01' },
        { github_login: 'bob',   github_name: 'Bob',       avatar_url: 'bob.png', created_at: '2026-02-01' },
      ],
      null,
    ]);

    const devs = await listDevelopers('my-org');
    expect(devs).toHaveLength(2);
    const alice = devs.find(d => d.github_login === 'alice');
    expect(alice?.github_name).toBe('Alice New');
    expect(alice?.avatar_url).toBe('new.png');
  });

  it('filters by query matching login (case-insensitive)', async () => {
    mockDbExecute.mockResolvedValue([
      [
        { github_login: 'AliceDev',  github_name: 'Alice',  avatar_url: null, created_at: '2026-03-01' },
        { github_login: 'bob-eng',   github_name: 'Bob',    avatar_url: null, created_at: '2026-03-01' },
      ],
      null,
    ]);

    const devs = await listDevelopers('my-org', { query: 'ALICE' });
    expect(devs).toHaveLength(1);
    expect(devs[0].github_login).toBe('AliceDev');
  });

  it('filters by query matching github_name (case-insensitive)', async () => {
    mockDbExecute.mockResolvedValue([
      [
        { github_login: 'adev', github_name: 'Alice Chen', avatar_url: null, created_at: '2026-03-01' },
        { github_login: 'bdev', github_name: 'Bob Smith',  avatar_url: null, created_at: '2026-03-01' },
      ],
      null,
    ]);

    const devs = await listDevelopers('my-org', { query: 'chen' });
    expect(devs).toHaveLength(1);
    expect(devs[0].github_login).toBe('adev');
  });

  it('truncates results when limit is set', async () => {
    mockDbExecute.mockResolvedValue([
      [
        { github_login: 'a', github_name: 'A', avatar_url: null, created_at: '2026-03-01' },
        { github_login: 'b', github_name: 'B', avatar_url: null, created_at: '2026-03-01' },
        { github_login: 'c', github_name: 'C', avatar_url: null, created_at: '2026-03-01' },
      ],
      null,
    ]);

    const devs = await listDevelopers('my-org', { limit: 2 });
    expect(devs).toHaveLength(2);
  });

  it('returns all results when limit is 0 or omitted', async () => {
    mockDbExecute.mockResolvedValue([
      [
        { github_login: 'a', github_name: 'A', avatar_url: null, created_at: '2026-03-01' },
        { github_login: 'b', github_name: 'B', avatar_url: null, created_at: '2026-03-01' },
      ],
      null,
    ]);

    const devs = await listDevelopers('my-org', { limit: 0 });
    expect(devs).toHaveLength(2);
  });

  it('returns empty array when DB has no rows', async () => {
    mockDbExecute.mockResolvedValue([[], null]);
    const devs = await listDevelopers('my-org');
    expect(devs).toHaveLength(0);
  });
});

describe('listDevelopersFromGitHub', () => {
  it('maps members to { github_login, github_name: null, avatar_url }', async () => {
    mockListOrgMembers.mockResolvedValue([
      { login: 'alice', avatar_url: 'alice.png' },
      { login: 'bob',   avatar_url: 'bob.png' },
    ]);

    const devs = await listDevelopersFromGitHub('my-org');
    expect(devs).toEqual([
      { github_login: 'alice', github_name: null, avatar_url: 'alice.png' },
      { github_login: 'bob',   github_name: null, avatar_url: 'bob.png' },
    ]);
  });

  it('filters by query (case-insensitive)', async () => {
    mockListOrgMembers.mockResolvedValue([
      { login: 'alice', avatar_url: 'alice.png' },
      { login: 'bob',   avatar_url: 'bob.png' },
    ]);

    const devs = await listDevelopersFromGitHub('my-org', 'BOB');
    expect(devs).toHaveLength(1);
    expect(devs[0].github_login).toBe('bob');
  });

  it('caps results at 20', async () => {
    const members = Array.from({ length: 30 }, (_, i) => ({
      login: `user${i}`,
      avatar_url: `avatar${i}.png`,
    }));
    mockListOrgMembers.mockResolvedValue(members);

    const devs = await listDevelopersFromGitHub('my-org');
    expect(devs).toHaveLength(20);
  });

  it('returns empty string for avatar_url when member has no avatar', async () => {
    mockListOrgMembers.mockResolvedValue([
      { login: 'noavatar', avatar_url: undefined },
    ]);

    const devs = await listDevelopersFromGitHub('my-org');
    expect(devs[0].avatar_url).toBe('');
  });
});
