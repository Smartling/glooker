jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(),
}));

import { listOrgs } from '@/lib/orgs/service';
import { Octokit } from '@octokit/rest';

const MockOctokit = Octokit as jest.MockedClass<typeof Octokit>;

function makeAsyncIterable<T>(pages: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const page of pages) {
        yield page;
      }
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listOrgs', () => {
  it('returns mapped org objects with login and avatar_url', async () => {
    const mockIterator = makeAsyncIterable([
      {
        data: [
          { login: 'acme', avatar_url: 'https://avatars.example.com/acme' },
          { login: 'widgets-inc', avatar_url: 'https://avatars.example.com/widgets' },
        ],
      },
    ]);

    MockOctokit.mockImplementation(() => ({
      orgs: { listForAuthenticatedUser: jest.fn() },
      paginate: { iterator: jest.fn().mockReturnValue(mockIterator) },
    }) as unknown as InstanceType<typeof Octokit>);

    const orgs = await listOrgs();

    expect(orgs).toEqual([
      { login: 'acme', avatar_url: 'https://avatars.example.com/acme' },
      { login: 'widgets-inc', avatar_url: 'https://avatars.example.com/widgets' },
    ]);
  });

  it('defaults avatar_url to empty string when missing or undefined', async () => {
    const mockIterator = makeAsyncIterable([
      {
        data: [
          { login: 'no-avatar', avatar_url: undefined },
          { login: 'null-avatar', avatar_url: null },
        ],
      },
    ]);

    MockOctokit.mockImplementation(() => ({
      orgs: { listForAuthenticatedUser: jest.fn() },
      paginate: { iterator: jest.fn().mockReturnValue(mockIterator) },
    }) as unknown as InstanceType<typeof Octokit>);

    const orgs = await listOrgs();

    expect(orgs).toEqual([
      { login: 'no-avatar', avatar_url: '' },
      { login: 'null-avatar', avatar_url: '' },
    ]);
  });

  it('handles pagination by collecting results from multiple pages', async () => {
    const mockIterator = makeAsyncIterable([
      {
        data: [
          { login: 'org-page1-a', avatar_url: 'https://avatars.example.com/a' },
          { login: 'org-page1-b', avatar_url: 'https://avatars.example.com/b' },
        ],
      },
      {
        data: [
          { login: 'org-page2-a', avatar_url: 'https://avatars.example.com/c' },
        ],
      },
    ]);

    MockOctokit.mockImplementation(() => ({
      orgs: { listForAuthenticatedUser: jest.fn() },
      paginate: { iterator: jest.fn().mockReturnValue(mockIterator) },
    }) as unknown as InstanceType<typeof Octokit>);

    const orgs = await listOrgs();

    expect(orgs).toHaveLength(3);
    expect(orgs.map((o) => o.login)).toEqual([
      'org-page1-a',
      'org-page1-b',
      'org-page2-a',
    ]);
  });

  it('returns an empty array when there are no orgs', async () => {
    const mockIterator = makeAsyncIterable([{ data: [] }]);

    MockOctokit.mockImplementation(() => ({
      orgs: { listForAuthenticatedUser: jest.fn() },
      paginate: { iterator: jest.fn().mockReturnValue(mockIterator) },
    }) as unknown as InstanceType<typeof Octokit>);

    const orgs = await listOrgs();

    expect(orgs).toEqual([]);
  });
});
