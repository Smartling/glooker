jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation((opts: any) => ({ _opts: opts })),
  };
});

describe('llm-provider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  describe('extraBodyProps', () => {
    it('returns empty object for default (openai) provider', () => {
      delete process.env.LLM_PROVIDER;
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.extraBodyProps()).toEqual({});
    });

    it('returns smartling properties for smartling provider', () => {
      process.env.LLM_PROVIDER = 'smartling';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.extraBodyProps()).toEqual({
        smartling_additional_properties: {
          operation_name: 'glooker_commit_analysis',
        },
      });
    });
  });

  describe('LLM_MODEL', () => {
    it('defaults to gpt-4o for openai provider', () => {
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_MODEL;
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.LLM_MODEL).toBe('gpt-4o');
    });

    it('defaults to claude for anthropic provider', () => {
      process.env.LLM_PROVIDER = 'anthropic';
      delete process.env.LLM_MODEL;
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.LLM_MODEL).toBe('claude-sonnet-4-20250514');
    });

    it('uses LLM_MODEL env var when set', () => {
      process.env.LLM_MODEL = 'custom-model';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.LLM_MODEL).toBe('custom-model');
    });

    it('defaults to bedrock claude model for bedrock provider', () => {
      process.env.LLM_PROVIDER = 'bedrock';
      delete process.env.LLM_MODEL;
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.LLM_MODEL).toBe('anthropic.claude-sonnet-4-20250514-v1:0');
    });
  });

  describe('getLLMClient', () => {
    it('creates OpenAI client for openai provider', async () => {
      delete process.env.LLM_PROVIDER;
      process.env.LLM_API_KEY = 'test-key';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const client = await mod.getLLMClient();
      expect(client).toBeDefined();
      expect(client._opts.apiKey).toBe('test-key');
    });

    it('creates Anthropic client with correct baseURL', async () => {
      process.env.LLM_PROVIDER = 'anthropic';
      process.env.LLM_API_KEY = 'anthropic-key';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const client = await mod.getLLMClient();
      expect(client._opts.baseURL).toBe('https://api.anthropic.com/v1/');
      expect(client._opts.apiKey).toBe('anthropic-key');
    });

    it('creates openai-compatible client with custom baseURL', async () => {
      process.env.LLM_PROVIDER = 'openai-compatible';
      process.env.LLM_API_KEY = 'compat-key';
      process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const client = await mod.getLLMClient();
      expect(client._opts.baseURL).toBe('http://localhost:11434/v1');
    });

    it('returns cached client on second call', async () => {
      delete process.env.LLM_PROVIDER;
      process.env.LLM_API_KEY = 'test-key';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const first = await mod.getLLMClient();
      const second = await mod.getLLMClient();
      expect(first).toBe(second);
    });

    it('creates Smartling client using smartling-auth token', async () => {
      process.env.LLM_PROVIDER = 'smartling';
      process.env.SMARTLING_BASE_URL = 'https://api.smartling.test';
      process.env.SMARTLING_ACCOUNT_UID = 'acc-123';

      // Need to mock smartling-auth within the isolated module
      jest.doMock('@/lib/smartling-auth', () => ({
        getAccessToken: jest.fn().mockResolvedValue('smartling-tok'),
      }));

      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const client = await mod.getLLMClient();
      expect(client._opts.apiKey).toBe('smartling-tok');
      expect(client._opts.baseURL).toBe(
        'https://api.smartling.test/ai-proxy-api/v2/accounts/acc-123/compatible/openai',
      );
    });

    it('creates Bedrock client via adapter', async () => {
      process.env.LLM_PROVIDER = 'bedrock';

      jest.doMock('@/lib/bedrock-adapter', () => ({
        createBedrockClient: jest.fn().mockReturnValue({ chat: { completions: { create: jest.fn() } } }),
      }));

      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const client = await mod.getLLMClient();
      expect(client).toBeDefined();
      expect(client.chat.completions.create).toBeDefined();
    });

    it('caches Bedrock client on second call', async () => {
      process.env.LLM_PROVIDER = 'bedrock';

      jest.doMock('@/lib/bedrock-adapter', () => ({
        createBedrockClient: jest.fn().mockReturnValue({ chat: { completions: { create: jest.fn() } } }),
      }));

      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const first = await mod.getLLMClient();
      const second = await mod.getLLMClient();
      expect(first).toBe(second);
    });

    it('does not cache Smartling client (token expires)', async () => {
      process.env.LLM_PROVIDER = 'smartling';
      process.env.SMARTLING_BASE_URL = 'https://api.smartling.test';
      process.env.SMARTLING_ACCOUNT_UID = 'acc-123';

      jest.doMock('@/lib/smartling-auth', () => ({
        getAccessToken: jest.fn().mockResolvedValue('tok'),
      }));

      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const first = await mod.getLLMClient();
      const second = await mod.getLLMClient();
      // Smartling case doesn't cache — returns new client each time
      expect(first).not.toBe(second);
    });

    it('throws for unknown provider', async () => {
      process.env.LLM_PROVIDER = 'unknown-provider';
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      await expect(mod.getLLMClient()).rejects.toThrow('Unknown LLM_PROVIDER');
    });
  });
});
