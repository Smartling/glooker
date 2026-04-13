export { ClaudeCodeClient } from './client';
export type { ClaudeCodeDailyRecord, ClaudeCodeClientInterface } from './client';
export { MockClaudeCodeClient } from './mock-client';

import type { ClaudeCodeClientInterface } from './client';
import { ClaudeCodeClient } from './client';
import { MockClaudeCodeClient } from './mock-client';

let cachedClient: ClaudeCodeClientInterface | null = null;

export function getClaudeCodeClient(): ClaudeCodeClientInterface | null {
  if (cachedClient) return cachedClient;

  if (process.env.CLAUDE_CODE_PROVIDER === 'mock') {
    cachedClient = new MockClaudeCodeClient();
    return cachedClient;
  }

  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) return null;

  cachedClient = new ClaudeCodeClient(apiKey);
  return cachedClient;
}
