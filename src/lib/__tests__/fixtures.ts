import type { CommitData } from '../github';
import type { CommitAnalysis } from '../analyzer';

export function makeCommit(overrides: Partial<CommitData> = {}): CommitData {
  return {
    sha: 'abc1234567890def',
    repo: 'my-repo',
    author: 'testuser',
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    avatarUrl: 'https://example.com/avatar.png',
    message: 'feat: add feature',
    fullMessage: 'feat: add feature',
    diff: '--- file.ts\n+console.log("hello")',
    additions: 10,
    deletions: 2,
    prNumber: 42,
    prTitle: 'Add feature',
    committedAt: '2025-01-15T12:00:00Z',
    aiCoAuthored: false,
    aiToolName: null,
    ...overrides,
  };
}

export function makeAnalysis(overrides: Partial<CommitAnalysis> = {}): CommitAnalysis {
  return {
    sha: 'abc1234567890def',
    complexity: 5,
    type: 'feature',
    impactSummary: 'Adds a new feature',
    riskLevel: 'low',
    maybeAi: false,
    ...overrides,
  };
}
