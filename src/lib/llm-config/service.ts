import { getLLMClient, LLM_MODEL, extraBodyProps } from '@/lib/llm-provider';

export interface LLMConfig {
  provider: string;
  model: string;
  hasApiKey: boolean;
  concurrency: number;
  endpoint?: string;
  hasAccountUid?: boolean;
  hasUserIdentifier?: boolean;
  hasUserSecret?: boolean;
  missing: string[];
  ready: boolean;
}

export interface LLMConnectionResult {
  success: boolean;
  response?: string;
  model?: string;
  latencyMs: number;
  error?: string;
}

export function getLLMConfig(): LLMConfig {
  const provider = process.env.LLM_PROVIDER || 'openai';
  const model = LLM_MODEL;
  const hasApiKey = Boolean(process.env.LLM_API_KEY);
  const baseUrl = process.env.LLM_BASE_URL || null;
  const concurrency = Number(process.env.LLM_CONCURRENCY || 5);

  const config: LLMConfig = { provider, model, hasApiKey, concurrency, missing: [], ready: false };

  if (provider === 'openai') {
    config.endpoint = 'https://api.openai.com/v1';
  } else if (provider === 'anthropic') {
    config.endpoint = 'https://api.anthropic.com/v1';
  } else if (provider === 'openai-compatible') {
    config.endpoint = baseUrl || '(not set)';
  } else if (provider === 'smartling') {
    config.endpoint = process.env.SMARTLING_BASE_URL || '(not set)';
    config.hasAccountUid = Boolean(process.env.SMARTLING_ACCOUNT_UID);
    config.hasUserIdentifier = Boolean(process.env.SMARTLING_USER_IDENTIFIER);
    config.hasUserSecret = Boolean(process.env.SMARTLING_USER_SECRET);
  }

  const missing: string[] = [];
  if (!hasApiKey && provider !== 'smartling') missing.push('LLM_API_KEY');
  if (provider === 'openai-compatible' && !baseUrl) missing.push('LLM_BASE_URL');
  if (provider === 'smartling') {
    if (!process.env.SMARTLING_BASE_URL) missing.push('SMARTLING_BASE_URL');
    if (!process.env.SMARTLING_ACCOUNT_UID) missing.push('SMARTLING_ACCOUNT_UID');
    if (!process.env.SMARTLING_USER_IDENTIFIER) missing.push('SMARTLING_USER_IDENTIFIER');
    if (!process.env.SMARTLING_USER_SECRET) missing.push('SMARTLING_USER_SECRET');
  }

  config.missing = missing;
  config.ready = missing.length === 0;

  return config;
}

export async function testLLMConnection(): Promise<LLMConnectionResult> {
  const start = Date.now();
  try {
    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0,
      max_tokens: 32,
      messages: [
        { role: 'system', content: 'Reply with exactly: OK' },
        { role: 'user', content: 'Test connection' },
      ],
      ...extraBodyProps(),
    } as any);

    const content = response.choices[0]?.message?.content || '';
    const elapsed = Date.now() - start;

    return {
      success: true,
      response: content.trim(),
      model: response.model || LLM_MODEL,
      latencyMs: elapsed,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: elapsed,
    };
  }
}
