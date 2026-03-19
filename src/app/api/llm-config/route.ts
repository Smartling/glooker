import { NextRequest, NextResponse } from 'next/server';
import { getLLMClient, LLM_MODEL, extraBodyProps } from '@/lib/llm-provider';

// GET — return current LLM config (no secrets)
export async function GET() {
  const provider = process.env.LLM_PROVIDER || 'openai';
  const model = LLM_MODEL;
  const hasApiKey = Boolean(process.env.LLM_API_KEY);
  const baseUrl = process.env.LLM_BASE_URL || null;
  const concurrency = Number(process.env.LLM_CONCURRENCY || 5);

  // Provider-specific config
  const config: Record<string, any> = { provider, model, hasApiKey, concurrency };

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

  // Check what's missing
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

  return NextResponse.json(config);
}

// POST — test LLM connection
export async function POST() {
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

    return NextResponse.json({
      success: true,
      response: content.trim(),
      model: response.model || LLM_MODEL,
      latencyMs: elapsed,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: elapsed,
    });
  }
}
