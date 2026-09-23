import { getAccessToken } from '@/lib/smartling-auth';
import type { PageExtract } from './page-extract';

/**
 * The catalog entry is DATED and has no bare alias, and /anthropicai/chat wants the
 * model and version SPLIT. `claude-haiku-4-5-20251001` with version "latest" is
 * rejected — that mistake is what produced the false "Haiku is unavailable" finding.
 */
export const HAIKU_MODEL = 'claude-haiku-4-5';
export const HAIKU_MODEL_VERSION = '20251001';

const TIMEOUT_MS = 8000;

const endpoint = () =>
  `${process.env.SMARTLING_BASE_URL}/ai-proxy-api/v2/accounts/${process.env.SMARTLING_ACCOUNT_UID}/anthropicai/chat`;

const SYSTEM =
  'You are reading the text of a web page the user is looking at. Answer the ' +
  'question using ONLY that text. Be specific and under 60 words. If the page ' +
  'does not contain the answer, say so plainly rather than guessing.';

/** Returns null on ANY failure so the caller degrades instead of breaking the chat. */
export async function answerFromPage(extract: PageExtract, question: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
      signal: controller.signal,
      body: JSON.stringify({
        requestParameters: { timeout: TIMEOUT_MS, operationName: 'glooker_chat_page_read' },
        request: {
          model: HAIKU_MODEL,
          modelVersion: HAIKU_MODEL_VERSION,
          payload: {
            max_tokens: 300,
            system: SYSTEM,
            messages: [{
              role: 'user',
              content: [{
                type: 'text',
                text:
                  `Question: ${question}\n\n` +
                  `Page path: ${extract.path}\nTitle: ${extract.title}\nHeading: ${extract.heading}\n\n` +
                  extract.text,
              }],
            }],
          },
        },
      }),
    });

    const json: any = await res.json().catch(() => null);
    const env = json?.response;
    if (!res.ok || env?.errors?.length) return null;

    const text = (env?.data?.payload?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
