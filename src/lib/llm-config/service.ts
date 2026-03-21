import { getLLMClient, LLM_MODEL, extraBodyProps } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';

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
  promptsDir: string;
  analyzer: { temperature: number; maxTokens: number };
  chatAgent: { temperature: number; maxTokens: number; maxIterations: number };
  summary: { temperature: number; maxTokens: number };
  highlights: { temperature: number; maxTokens: number };
  llmTest: { temperature: number; maxTokens: number };
  githubToken: string | null;
  llmApiKey: string | null;
  smartlingUserSecret: string | null;
}

export interface LLMConnectionResult {
  success: boolean;
  response?: string;
  model?: string;
  latencyMs: number;
  error?: string;
}

function maskSecret(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 5) return 'xxxxx';
  return 'xxxxx' + value.slice(-5);
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

  config.promptsDir = process.env.PROMPTS_DIR || './prompts';
  config.analyzer = { temperature: Number(process.env.ANALYZER_TEMPERATURE ?? 0), maxTokens: Number(process.env.ANALYZER_MAX_TOKENS ?? 256) };
  config.chatAgent = { temperature: Number(process.env.CHAT_AGENT_TEMPERATURE ?? 0.3), maxTokens: Number(process.env.CHAT_AGENT_MAX_TOKENS ?? 1500), maxIterations: Number(process.env.CHAT_AGENT_MAX_ITERATIONS ?? 5) };
  config.summary = { temperature: Number(process.env.SUMMARY_TEMPERATURE ?? 0.7), maxTokens: Number(process.env.SUMMARY_MAX_TOKENS ?? 512) };
  config.highlights = { temperature: Number(process.env.HIGHLIGHTS_TEMPERATURE ?? 0.5), maxTokens: Number(process.env.HIGHLIGHTS_MAX_TOKENS ?? 512) };
  config.llmTest = { temperature: Number(process.env.LLM_TEST_TEMPERATURE ?? 0), maxTokens: Number(process.env.LLM_TEST_MAX_TOKENS ?? 32) };
  config.githubToken = maskSecret(process.env.GITHUB_TOKEN);
  config.llmApiKey = maskSecret(process.env.LLM_API_KEY);
  config.smartlingUserSecret = maskSecret(process.env.SMARTLING_USER_SECRET);

  return config;
}

export async function testLLMConnection(): Promise<LLMConnectionResult> {
  const start = Date.now();
  try {
    const client = await getLLMClient();
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: Number(process.env.LLM_TEST_TEMPERATURE ?? 0),
      max_tokens: Number(process.env.LLM_TEST_MAX_TOKENS ?? 32),
      messages: [
        { role: 'system', content: loadPrompt('llm-config-test-system.txt') },
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
