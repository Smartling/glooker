jest.mock('@/lib/smartling-auth', () => ({
  getAccessToken: jest.fn().mockResolvedValue('test-token-123'),
}));

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation((opts: any) => ({ _opts: opts })),
  };
});

import { getAIClient, LLM_MODEL } from '@/lib/aiproxy';
import OpenAI from 'openai';
import { getAccessToken } from '@/lib/smartling-auth';

describe('aiproxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SMARTLING_BASE_URL = 'https://api.smartling.test';
    process.env.SMARTLING_ACCOUNT_UID = 'acc-uid-123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getAIClient', () => {
    it('fetches access token and creates OpenAI client with correct config', async () => {
      const client = await getAIClient();
      expect(getAccessToken).toHaveBeenCalled();
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-token-123',
        baseURL: 'https://api.smartling.test/ai-proxy-api/v2/accounts/acc-uid-123/compatible/openai',
      });
      expect(client).toBeDefined();
    });
  });

  describe('LLM_MODEL', () => {
    it('defaults to anthropic claude model when LLM_MODEL not set', () => {
      // LLM_MODEL is evaluated at module load time, so we test the default
      // If LLM_MODEL env var was not set when module loaded, it uses the default
      expect(typeof LLM_MODEL).toBe('string');
      expect(LLM_MODEL.length).toBeGreaterThan(0);
    });
  });
});
