// Mock @/lib/llm-provider before importing the service
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'gpt-4o',
  extraBodyProps: jest.fn().mockReturnValue({}),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
  promptTag: (name: string) => name ? { __prompt_id: name } : {},
}));

import { getAppConfig, testLLMConnection } from '@/lib/app-config/service';
import { getLLMClient, extraBodyProps } from '@/lib/llm-provider';

const mockGetLLMClient = getLLMClient as jest.Mock;
const mockExtraBodyProps = extraBodyProps as jest.Mock;

describe('getAppConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};

  const envKeys = [
    'LLM_PROVIDER',
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_CONCURRENCY',
    'SMARTLING_BASE_URL',
    'SMARTLING_ACCOUNT_UID',
    'SMARTLING_USER_IDENTIFIER',
    'SMARTLING_USER_SECRET',
    'GITHUB_TOKEN',
    'ANALYZER_TEMPERATURE',
    'ANALYZER_MAX_TOKENS',
    'PROMPTS_DIR',
    'JIRA_ENABLED',
    'JIRA_HOST',
    'JIRA_USERNAME',
    'JIRA_API_TOKEN',
    'JIRA_STORY_POINTS_FIELDS',
  ];

  beforeEach(() => {
    envKeys.forEach(k => { savedEnv[k] = process.env[k]; });
    // clear all relevant env vars
    envKeys.forEach(k => { delete process.env[k]; });
  });

  afterEach(() => {
    envKeys.forEach(k => {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    });
  });

  describe('provider=openai', () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.LLM_API_KEY = 'sk-test-key';
    });

    it('returns correct endpoint', () => {
      const config = getAppConfig();
      expect(config.endpoint).toBe('https://api.openai.com/v1');
    });

    it('returns hasApiKey=true when LLM_API_KEY is set', () => {
      const config = getAppConfig();
      expect(config.hasApiKey).toBe(true);
    });

    it('returns provider and model', () => {
      const config = getAppConfig();
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4o');
    });

    it('returns ready=true with no missing when key is present', () => {
      const config = getAppConfig();
      expect(config.missing).toEqual([]);
      expect(config.ready).toBe(true);
    });

    it('returns default concurrency=5 when LLM_CONCURRENCY not set', () => {
      const config = getAppConfig();
      expect(config.concurrency).toBe(5);
    });

    it('uses LLM_CONCURRENCY when set', () => {
      process.env.LLM_CONCURRENCY = '10';
      const config = getAppConfig();
      expect(config.concurrency).toBe(10);
    });
  });

  describe('provider=anthropic', () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = 'anthropic';
      process.env.LLM_API_KEY = 'anthropic-key';
    });

    it('returns correct endpoint', () => {
      const config = getAppConfig();
      expect(config.endpoint).toBe('https://api.anthropic.com/v1');
    });

    it('returns provider=anthropic', () => {
      const config = getAppConfig();
      expect(config.provider).toBe('anthropic');
    });

    it('returns ready=true when key is present', () => {
      const config = getAppConfig();
      expect(config.ready).toBe(true);
      expect(config.missing).toEqual([]);
    });
  });

  describe('provider=openai-compatible', () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = 'openai-compatible';
      process.env.LLM_API_KEY = 'compat-key';
      process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
    });

    it('uses LLM_BASE_URL as endpoint', () => {
      const config = getAppConfig();
      expect(config.endpoint).toBe('http://localhost:11434/v1');
    });

    it('returns ready=true when key and base URL are set', () => {
      const config = getAppConfig();
      expect(config.ready).toBe(true);
      expect(config.missing).toEqual([]);
    });

    it('returns "(not set)" and missing LLM_BASE_URL when not provided', () => {
      delete process.env.LLM_BASE_URL;
      const config = getAppConfig();
      expect(config.endpoint).toBe('(not set)');
      expect(config.missing).toContain('LLM_BASE_URL');
      expect(config.ready).toBe(false);
    });
  });

  describe('provider=smartling', () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = 'smartling';
      process.env.SMARTLING_BASE_URL = 'https://api.smartling.test';
      process.env.SMARTLING_ACCOUNT_UID = 'acc-123';
      process.env.SMARTLING_USER_IDENTIFIER = 'user-id';
      process.env.SMARTLING_USER_SECRET = 'secret';
    });

    it('uses SMARTLING_BASE_URL as endpoint', () => {
      const config = getAppConfig();
      expect(config.endpoint).toBe('https://api.smartling.test');
    });

    it('returns hasAccountUid, hasUserIdentifier, hasUserSecret flags', () => {
      const config = getAppConfig();
      expect(config.hasAccountUid).toBe(true);
      expect(config.hasUserIdentifier).toBe(true);
      expect(config.hasUserSecret).toBe(true);
    });

    it('returns ready=true when all smartling vars are set', () => {
      const config = getAppConfig();
      expect(config.ready).toBe(true);
      expect(config.missing).toEqual([]);
    });

    it('does not require LLM_API_KEY', () => {
      const config = getAppConfig();
      expect(config.missing).not.toContain('LLM_API_KEY');
    });

    it('returns "(not set)" and missing vars when smartling vars absent', () => {
      delete process.env.SMARTLING_BASE_URL;
      delete process.env.SMARTLING_ACCOUNT_UID;
      delete process.env.SMARTLING_USER_IDENTIFIER;
      delete process.env.SMARTLING_USER_SECRET;
      const config = getAppConfig();
      expect(config.endpoint).toBe('(not set)');
      expect(config.missing).toContain('SMARTLING_BASE_URL');
      expect(config.missing).toContain('SMARTLING_ACCOUNT_UID');
      expect(config.missing).toContain('SMARTLING_USER_IDENTIFIER');
      expect(config.missing).toContain('SMARTLING_USER_SECRET');
      expect(config.ready).toBe(false);
    });
  });

  describe('extended config fields', () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.LLM_API_KEY = 'sk-test-key-12345';
      process.env.GITHUB_TOKEN = 'github_pat_abcdef12345';
    });

    it('returns per-service settings with defaults', () => {
      const config = getAppConfig();
      expect(config.promptsDir).toBe('./prompts');
      expect(config.analyzer).toEqual({ temperature: 0, maxTokens: 256 });
      expect(config.chatAgent).toEqual({ temperature: 0.3, maxTokens: 1500, maxIterations: 5 });
      expect(config.summary).toEqual({ temperature: 0.7, maxTokens: 512 });
      expect(config.highlights).toEqual({ temperature: 0.5, maxTokens: 512 });
      expect(config.llmTest).toEqual({ temperature: 0, maxTokens: 32 });
    });

    it('reads per-service settings from env when set', () => {
      process.env.ANALYZER_TEMPERATURE = '0.1';
      process.env.ANALYZER_MAX_TOKENS = '512';
      const config = getAppConfig();
      expect(config.analyzer).toEqual({ temperature: 0.1, maxTokens: 512 });
    });

    it('masks secrets showing only last 5 chars', () => {
      const config = getAppConfig();
      expect(config.githubToken).toBe('xxxxx12345');
      expect(config.llmApiKey).toBe('xxxxx12345');
    });

    it('returns null for unset secrets', () => {
      delete process.env.GITHUB_TOKEN;
      const config = getAppConfig();
      expect(config.githubToken).toBeNull();
    });

    it('masks short secrets entirely', () => {
      process.env.LLM_API_KEY = 'abc';
      const config = getAppConfig();
      expect(config.llmApiKey).toBe('xxxxx');
    });
  });

  describe('jira.storyPointsFields parsing', () => {
    beforeEach(() => {
      // Enable Jira so the config block runs
      process.env.JIRA_ENABLED = 'true';
      process.env.JIRA_HOST = 'example.atlassian.net';
      process.env.JIRA_USERNAME = 'user@example.com';
      process.env.JIRA_API_TOKEN = 'token';
    });

    it('returns empty array when JIRA_STORY_POINTS_FIELDS is not set', () => {
      delete process.env.JIRA_STORY_POINTS_FIELDS;
      const config = getAppConfig();
      expect(config.jira.storyPointsFields).toEqual([]);
    });

    it('parses a single field ID', () => {
      process.env.JIRA_STORY_POINTS_FIELDS = 'customfield_10016';
      const config = getAppConfig();
      expect(config.jira.storyPointsFields).toEqual(['customfield_10016']);
    });

    it('parses multiple comma-separated field IDs', () => {
      process.env.JIRA_STORY_POINTS_FIELDS = 'customfield_10016,customfield_10028';
      const config = getAppConfig();
      expect(config.jira.storyPointsFields).toEqual(['customfield_10016', 'customfield_10028']);
    });

    it('trims whitespace around field IDs', () => {
      process.env.JIRA_STORY_POINTS_FIELDS = ' customfield_10016 , customfield_10028 ';
      const config = getAppConfig();
      expect(config.jira.storyPointsFields).toEqual(['customfield_10016', 'customfield_10028']);
    });

    it('filters out empty strings from the list', () => {
      process.env.JIRA_STORY_POINTS_FIELDS = 'customfield_10016,,';
      const config = getAppConfig();
      expect(config.jira.storyPointsFields).toEqual(['customfield_10016']);
    });
  });

  describe('missing env var detection', () => {
    it('reports missing LLM_API_KEY for openai when not set', () => {
      process.env.LLM_PROVIDER = 'openai';
      // no LLM_API_KEY
      const config = getAppConfig();
      expect(config.missing).toContain('LLM_API_KEY');
      expect(config.ready).toBe(false);
    });

    it('reports missing LLM_API_KEY for anthropic when not set', () => {
      process.env.LLM_PROVIDER = 'anthropic';
      const config = getAppConfig();
      expect(config.missing).toContain('LLM_API_KEY');
      expect(config.ready).toBe(false);
    });

    it('defaults to openai provider when LLM_PROVIDER is unset', () => {
      process.env.LLM_API_KEY = 'key';
      const config = getAppConfig();
      expect(config.provider).toBe('openai');
    });
  });
});

describe('testLLMConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtraBodyProps.mockReturnValue({});
  });

  it('returns success with response content, model, and latency on good connection', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      model: 'gpt-4o',
    });
    mockGetLLMClient.mockResolvedValue({
      chat: { completions: { create: mockCreate } },
    });

    const result = await testLLMConnection();

    expect(result.success).toBe(true);
    expect(result.response).toBe('OK');
    expect(result.model).toBe('gpt-4o');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('trims whitespace from response content', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '  OK  \n' } }],
      model: 'gpt-4o',
    });
    mockGetLLMClient.mockResolvedValue({
      chat: { completions: { create: mockCreate } },
    });

    const result = await testLLMConnection();
    expect(result.response).toBe('OK');
  });

  it('falls back to LLM_MODEL when response.model is missing', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      model: null,
    });
    mockGetLLMClient.mockResolvedValue({
      chat: { completions: { create: mockCreate } },
    });

    const result = await testLLMConnection();
    expect(result.model).toBe('gpt-4o');
  });

  it('returns error message and success=false on failure', async () => {
    mockGetLLMClient.mockRejectedValue(new Error('Connection refused'));

    const result = await testLLMConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.response).toBeUndefined();
  });

  it('handles non-Error thrown values as strings', async () => {
    mockGetLLMClient.mockRejectedValue('timeout');

    const result = await testLLMConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('timeout');
  });

  describe('prompt and settings snapshots', () => {
    it('sends exact system prompt and user message', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'OK' } }],
        model: 'gpt-4o',
      });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: mockCreate } },
      });

      await testLLMConnection();

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'Reply with exactly: OK' });
      expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'Test connection' });
    });

    it('passes correct LLM settings', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'OK' } }],
        model: 'gpt-4o',
      });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: mockCreate } },
      });

      await testLLMConnection();

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0);
      expect(callArgs.max_completion_tokens).toBe(32);
      expect(callArgs.model).toBe('gpt-4o');
    });
  });
});
