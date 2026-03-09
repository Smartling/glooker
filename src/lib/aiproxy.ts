import OpenAI from 'openai';
import { getAccessToken } from './smartling-auth';

/**
 * Returns an OpenAI client pointed at the Smartling AI Proxy.
 * Token is fetched (and cached) from Smartling auth on each call.
 */
export async function getAIClient(): Promise<OpenAI> {
  const token      = await getAccessToken();
  const baseUrl    = process.env.SMARTLING_BASE_URL!;
  const accountUid = process.env.SMARTLING_ACCOUNT_UID!;

  return new OpenAI({
    apiKey:  token,
    baseURL: `${baseUrl}/ai-proxy-api/v2/accounts/${accountUid}/compatible/openai`,
  });
}

export const LLM_MODEL = process.env.LLM_MODEL || 'anthropic/claude-sonnet-4-20250514';
