jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'test-model',
  extraBodyProps: jest.fn().mockReturnValue({}),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
  promptTag: (name: string) => name ? { __prompt_id: name } : {},
}));

import { formatUnmergedWorkSection } from '@/lib/report/summary';

describe('formatUnmergedWorkSection', () => {
  it('returns empty string when no unmerged work', () => {
    expect(formatUnmergedWorkSection([], [])).toBe('');
  });

  it('formats open PRs with age + caps at 5 items', () => {
    const prs = Array.from({ length: 7 }).map((_, i) => ({
      title: `PR ${i}`,
      updatedAt: new Date(Date.now() - i * 86400000).toISOString(),
      createdAt: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
      draft: i === 1,
    }));
    const out = formatUnmergedWorkSection(prs, []);
    expect(out).toContain('Open PRs: 7');
    expect(out).toContain('PR 0');
    expect(out).toContain('+ 2 more');
    expect(out).toMatch(/NOT/);
  });

  it('formats bare branch commits with cap at 3', () => {
    const commits = Array.from({ length: 5 }).map((_, i) => ({
      message: `commit ${i}`,
      repo: `repo-${i % 2}`,
      committedAt: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    const out = formatUnmergedWorkSection([], commits);
    expect(out).toContain('Commits on unmerged branches: 5');
    expect(out).toContain('commit 0');
    expect(out).toContain('+ 2 more');
  });
});
