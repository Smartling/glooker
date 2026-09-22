/**
 * Native Anthropic tool calling through the AI Proxy's /anthropicai/chat
 * passthrough. No framework.
 *
 * Why this route: the proxy's OpenAI-compatible endpoint rejects custom tools for
 * Anthropic publishers ("only web_search and web_fetch are supported"), which is
 * why chat/agent.ts had to use a TOOL_CALL: text protocol. The passthrough route
 * supports real tool_use, so the text protocol — and its one-tool-round ceiling —
 * is no longer necessary.
 */
import { getAccessToken } from '@/lib/smartling-auth';
import { mcpListTools, mcpCallTool } from '@/lib/chat/mcp-client';
import { CHAT_SYSTEM, type EngineResult } from './types';

const endpoint = () =>
  `${process.env.SMARTLING_BASE_URL}/ai-proxy-api/v2/accounts/${process.env.SMARTLING_ACCOUNT_UID}/anthropicai/chat`;

async function callProxy(payload: any) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
    body: JSON.stringify({
      requestParameters: { timeout: 110_000, operationName: 'glooker_chat_control' },
      request: { model: 'claude-sonnet-5', modelVersion: 'latest', payload },
    }),
  });
  const json: any = await res.json();
  const env = json?.response;
  if (env?.errors?.length) throw new Error(env.errors.map((e: any) => e.message).join('; '));
  return env.data.payload;
}

export async function runControlEngine(
  messages: { role: string; content: string }[],
  mcpUrl: string,
  forward: Record<string, string>,
  systemSuffix = '',
  maxSteps = 8,
): Promise<EngineResult> {
  const started = Date.now();
  const toolCalls: string[] = [];
  let tools;
  try {
    tools = await mcpListTools(mcpUrl, forward);
  } catch (err: any) {
    throw new Error(`Could not reach the Glooker data tools at ${mcpUrl}: ${err?.message ?? String(err)}`);
  }

  const convo: any[] = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: 'text', text: m.content }],
  }));

  for (let step = 1; step <= maxSteps; step++) {
    const reply = await callProxy({
      max_tokens: 4000,
      system: CHAT_SYSTEM + systemSuffix,
      tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      messages: convo,
    });

    if (reply.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: reply.content });
      const results = [];
      for (const b of reply.content.filter((x: any) => x.type === 'tool_use')) {
        toolCalls.push(`${b.name}(${JSON.stringify(b.input ?? {})})`);
        let out: string;
        try { out = await mcpCallTool(mcpUrl, b.name, b.input ?? {}, forward); }
        catch (e: any) { out = JSON.stringify({ error: e?.message ?? String(e) }); }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
      }
      convo.push({ role: 'user', content: results });
      continue;
    }

    const text = reply.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    // Truncation returns stop_reason 'max_tokens' with possibly empty text — the
    // GLOOK-51/54 "failure indistinguishable from empty" shape. Never ship a bare ''.
    const response = text || (reply.stop_reason === 'max_tokens'
      ? 'That answer was cut off before it finished. Try a narrower question.'
      : 'No answer was produced.');
    return { response, toolCalls, engine: 'control', toolCount: tools.length, ms: Date.now() - started };
  }

  return {
    response: 'I hit the maximum number of data lookups. Try a more specific question.',
    toolCalls, engine: 'control', toolCount: tools.length, ms: Date.now() - started,
  };
}
