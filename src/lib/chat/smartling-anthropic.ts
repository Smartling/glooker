/**
 * Makes the AI SDK's Anthropic provider speak to the Smartling AI Proxy.
 *
 * Why this exists: the proxy's OpenAI-compatible endpoint REJECTS custom tools
 * for Anthropic publishers ("only web_search and web_fetch are supported"), so
 * no agent loop can run over it. But the proxy also exposes a native Anthropic
 * Messages passthrough at /anthropicai/chat which DOES support tool_use — it
 * just wraps the real Anthropic body in a Smartling envelope.
 *
 * So we keep the AI SDK's Anthropic provider (which produces a correct Messages
 * body) and intercept at the fetch boundary: wrap the request, unwrap the
 * response, inject a fresh bearer. Everything upstream — Mastra, tool calling,
 * multi-turn tool_result — is then stock.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { getAccessToken } from '@/lib/smartling-auth';

const endpoint = () =>
  `${process.env.SMARTLING_BASE_URL}/ai-proxy-api/v2/accounts/${process.env.SMARTLING_ACCOUNT_UID}/anthropicai/chat`;

export interface SmartlingAnthropicOpts {
  operationName?: string;
  timeoutMs?: number;
  /** The proxy rejects a blank modelVersion; 'latest' is accepted for current models. */
  modelVersion?: string;
}

export function createSmartlingAnthropic(opts: SmartlingAnthropicOpts = {}) {
  const { operationName = 'glooker_chat', timeoutMs = 110_000, modelVersion = 'latest' } = opts;

  const smartlingFetch = (async (_input: any, init: any = {}) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    const { model, ...payload } = body;

    // The envelope route is request/response only — no SSE.
    const streamed = payload.stream === true;
    delete payload.stream;

    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({
        requestParameters: { timeout: timeoutMs, operationName,
          useCache: process.env.EXPERIMENT_NO_CACHE !== '1' },
        request: { model, modelVersion, payload },
      }),
    });

    const json: any = await res.json().catch(() => ({}));
    const envelope = json?.response;

    if (!res.ok || envelope?.errors?.length) {
      const message = envelope?.errors?.map((e: any) => e.message).join('; ')
        ?? `AI Proxy ${res.status}`;
      // Shape it as an Anthropic API error so the AI SDK reports it usefully.
      return new Response(
        JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }),
        { status: res.status === 200 ? 400 : res.status, headers: { 'content-type': 'application/json' } },
      );
    }

    const anthropicResponse = envelope?.data?.payload;
    if (streamed) {
      // Caller asked for SSE; the proxy can't. Surface it rather than hang.
      return new Response(
        JSON.stringify({ type: 'error', error: { type: 'invalid_request_error',
          message: 'Streaming is not supported by the AI Proxy anthropicai/chat route' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(anthropicResponse), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return createAnthropic({
    baseURL: 'https://ai-proxy.invalid/v1', // never dialled; smartlingFetch rewrites
    apiKey: 'unused-the-proxy-uses-a-bearer',
    fetch: smartlingFetch,
  });
}
