import type { ClaudeCodeClientInterface, ClaudeCodeDailyRecord } from './client';

// Lazy-load mock identities to avoid bundling in production
let _identities: typeof import('../../../scripts/mock-identities') | null = null;
function getIdentities() {
  if (!_identities) _identities = require('../../../scripts/mock-identities');
  return _identities!;
}

export class MockClaudeCodeClient implements ClaudeCodeClientInterface {
  async fetchDailySpend(_date: string): Promise<ClaudeCodeDailyRecord[]> {
    const { MOCK_DEVELOPERS } = getIdentities();
    return MOCK_DEVELOPERS.map(dev => ({
      email: dev.jiraEmail, // mock uses jiraEmail as the Anthropic email
      totalCost: Math.round((Math.random() * 800 + 200) * 100) / 100, // $2-$10/day in cents
      inputTokens: Math.floor(Math.random() * 500000 + 100000),
      outputTokens: Math.floor(Math.random() * 100000 + 20000),
      sessions: Math.floor(Math.random() * 10 + 1),
    }));
  }
}
