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

type Provider = 'openai' | 'anthropic' | 'smartling' | 'openai-compatible' | 'bedrock' | 'mock';

const provider = (process.env.LLM_PROVIDER || 'openai') as Provider;

// Cache the client (or a promise for Smartling which needs async auth)
let cachedClient: OpenAI | null = null;

const MODEL_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-5',
  bedrock:   'us.anthropic.claude-sonnet-5',
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

/**
 * Models whose API removed the sampling parameters (`temperature`, `top_p`,
 * `stop`). Sending any of them returns a 400 — including `temperature: 0`.
 *
 * This is the Sonnet 5 / Opus 5 / Opus 4.7-4.8 / Fable 5 generation. Sonnet 4.6,
 * Opus 4.6, Haiku 4.5 and everything older still accept sampling.
 *
 * Matched on the model string rather than a provider, because the same model
 * arrives under three shapes: bare (`claude-sonnet-5`, direct Anthropic), an
 * `anthropic/` prefix (Smartling AI Proxy), and a `us.anthropic.` cross-region
 * inference profile (Bedrock). The trailing boundary matters: without it,
 * `claude-opus-4-60` would match the `4-6`-adjacent alternatives.
 */
const MODELS_WITHOUT_SAMPLING =
  /claude-(?:sonnet|opus|fable|mythos)-5(?![\d-])|claude-opus-4-[78](?![\d-])/i;

/**
 * Whether `model` rejects sampling parameters. Exported for tests; call sites
 * should use `samplingParams()`.
 */
export function modelRejectsSampling(model: string): boolean {
  return MODELS_WITHOUT_SAMPLING.test(model);
}

/**
 * Sampling parameters for a chat completion, or `{}` when the configured model
 * rejects them. Spread into chat.completions.create(), the same way
 * `tokenLimit()` is:
 *
 *   ...samplingParams(getAppConfig().analyzer.temperature),
 *
 * Note for callers that relied on `temperature: 0` for determinism: on a model
 * that rejects sampling there is no way to express it, so output falls back to
 * the model default. Reports become less reproducible run-to-run — that is a
 * property of the model, not something this helper can work around.
 */
export function samplingParams(temperature: number): { temperature?: number } {
  return modelRejectsSampling(LLM_MODEL) ? {} : { temperature };
}

/**
 * Tag an LLM request with the prompt template name.
 * The mock provider uses this to select fixture responses.
 * Real providers ignore unknown keys.
 */
export function promptTag(name: string): Record<string, unknown> {
  if (!name) return {};
  return { __prompt_id: name };
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

    case 'mock': {
      const { createMockLLMClient } = await import('./llm-mock');
      cachedClient = createMockLLMClient() as unknown as OpenAI;
      return cachedClient;
    }

    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use: openai, anthropic, smartling, openai-compatible, bedrock, or mock`);
  }
}
