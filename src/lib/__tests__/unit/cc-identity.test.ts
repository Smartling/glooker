jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

import { buildEmailToLoginMap } from '@/lib/cc-spend/identity';

it('prefers commit_analyses over user_mappings and lowercases keys', async () => {
  const tx = {
    execute: jest.fn()
      .mockResolvedValueOnce([[{ email: 'alice@x.com', github_login: 'alice' }], null])
      .mockResolvedValueOnce([[
        { email: 'alice@x.com', github_login: 'alice-jira' }, // must NOT override
        { email: 'bob@x.com', github_login: 'bob' },
      ], null]),
  };

  const map = await buildEmailToLoginMap(tx as any, 'r1', 'acme');

  expect(map.get('alice@x.com')).toBe('alice');
  expect(map.get('bob@x.com')).toBe('bob');
  expect(map.size).toBe(2);
  expect(tx.execute.mock.calls[0][0]).toMatch(/FROM commit_analyses/);
  expect(tx.execute.mock.calls[0][1]).toEqual(['r1']);
  expect(tx.execute.mock.calls[1][0]).toMatch(/FROM user_mappings/);
  expect(tx.execute.mock.calls[1][1]).toEqual(['acme']);
});

it('skips rows with a missing email or login', async () => {
  const tx = {
    execute: jest.fn()
      .mockResolvedValueOnce([[{ email: '', github_login: 'x' }, { email: 'y@x.com', github_login: null }], null])
      .mockResolvedValueOnce([[], null]),
  };
  const map = await buildEmailToLoginMap(tx as any, 'r1', 'acme');
  expect(map.size).toBe(0);
});
