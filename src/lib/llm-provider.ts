import OpenAI from 'openai';

/**
 * LLM Provider factory. Returns an OpenAI-compatible client configured
 * for the selected provider. All providers use the OpenAI SDK since
 * they all support the OpenAI chat completions format.
 *
 * Supported providers (LLM_PROVIDER env var):
 *   openai             — Direct OpenAI API (default)
 *   anthropic          — Anthropic API (OpenAI-compatible endpoint)
 *   smartling          — Smartling AI Proxy
 *   openai-compatible  — Any OpenAI-compatible endpoint (Ollama, vLLM, Azure, etc.)
 *   bedrock            — AWS Bedrock (Anthropic models via InvokeModel)
 */

type Provider = 'openai' | 'anthropic' | 'smartling' | 'openai-compatible' | 'bedrock';

const provider = (process.env.LLM_PROVIDER || 'openai') as Provider;

// Cache the client (or a promise for Smartling which needs async auth)
let cachedClient: OpenAI | null = null;

const MODEL_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  bedrock:   'us.anthropic.claude-sonnet-4-6',
};

export const LLM_MODEL =
  process.env.LLM_MODEL || MODEL_DEFAULTS[provider] || 'gpt-4o';

/**
 * Extra body properties to include in each chat completion request.
 * Smartling requires `smartling_additional_properties`.
 */
export function extraBodyProps(): Record<string, unknown> {
  if (provider === 'smartling') {
    return {
      smartling_additional_properties: {
        operation_name: 'glooker_commit_analysis',
      },
    };
  }
  return {};
}

/**
 * Normalize max_tokens → max_completion_tokens for OpenAI models that require it.
 * Newer OpenAI models (o1, o3, etc.) reject "max_tokens" and require "max_completion_tokens".
 * This function should be spread into chat.completions.create() params.
 */
export function tokenLimit(maxTokens: number): { max_tokens?: number; max_completion_tokens?: number } {
  if (provider === 'openai') {
    // Use max_completion_tokens for OpenAI — works for all models including newer ones.
    // Older models that only support max_tokens also accept max_completion_tokens in SDK v4.
    return { max_completion_tokens: maxTokens };
  }
  // Other providers (Anthropic, Smartling, Bedrock, etc.) use max_tokens
  return { max_tokens: maxTokens };
}

export async function getLLMClient(): Promise<OpenAI> {
  if (cachedClient) return cachedClient;

  switch (provider) {
    case 'openai': {
      cachedClient = new OpenAI({
        apiKey: process.env.LLM_API_KEY,
      });
      return cachedClient;
    }

    case 'anthropic': {
      cachedClient = new OpenAI({
        apiKey:  process.env.LLM_API_KEY,
        baseURL: 'https://api.anthropic.com/v1/',
      });
      return cachedClient;
    }

    case 'openai-compatible': {
      cachedClient = new OpenAI({
        apiKey:  process.env.LLM_API_KEY || 'not-needed',
        baseURL: process.env.LLM_BASE_URL,
      });
      return cachedClient;
    }

    case 'smartling': {
      const { getAccessToken } = await import('./smartling-auth');
      const token      = await getAccessToken();
      const baseUrl    = process.env.SMARTLING_BASE_URL!;
      const accountUid = process.env.SMARTLING_ACCOUNT_UID!;

      // Don't cache — token expires, so we rebuild each time
      return new OpenAI({
        apiKey:  token,
        baseURL: `${baseUrl}/ai-proxy-api/v2/accounts/${accountUid}/compatible/openai`,
      });
    }

    case 'bedrock': {
      const { createBedrockClient } = await import('./bedrock-adapter');
      cachedClient = createBedrockClient() as unknown as OpenAI;
      return cachedClient;
    }

    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use: openai, anthropic, smartling, openai-compatible, or bedrock`);
  }
}
