jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));

import { getReleaseNotes } from '@/lib/release-notes/service';

describe('getReleaseNotes', () => {
  const original = process.env.GITHUB_TOKEN;
  afterEach(() => { process.env.GITHUB_TOKEN = original; });

  it('returns available:false with an error field when GITHUB_TOKEN is unset', async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await getReleaseNotes();
    expect(result).toEqual({ available: false, error: 'GITHUB_TOKEN not configured' });
  });
});
