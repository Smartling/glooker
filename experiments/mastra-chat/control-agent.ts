/**
 * CONTROL ARM — no new dependencies.
 *
 * The same capability as the Mastra arm (native Anthropic tool calling, real
 * multi-step) built with plain fetch against the proxy's /anthropicai/chat
 * passthrough. This exists so the experiment can tell the difference between
 * "Mastra is better" and "our current loop was just unfinished".
 */
import { getAccessToken } from '../../src/lib/smartling-auth';
import { anthropicTools, runTool } from './shared-tools';

export interface AgentRun {
  answer: string;
  toolCalls: string[];
  steps: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

const endpoint = () =>
  `${process.env.SMARTLING_BASE_URL}/ai-proxy-api/v2/accounts/${process.env.SMARTLING_ACCOUNT_UID}/anthropicai/chat`;

async function callProxy(payload: any) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getAccessToken()}`,
    },
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

export async function runControlAgent(
  question: string,
  org: string,
  systemPrompt: string,
  maxSteps = 6,
): Promise<AgentRun> {
  const started = Date.now();
  const toolCalls: string[] = [];
  let inputTokens = 0, outputTokens = 0;

  const messages: any[] = [{ role: 'user', content: [{ type: 'text', text: question }] }];

  for (let step = 1; step <= maxSteps; step++) {
    const reply = await callProxy({
      max_tokens: 2000,
      system: systemPrompt,
      tools: anthropicTools(),
      messages,
    });
    inputTokens += reply.usage?.input_tokens ?? 0;
    outputTokens += reply.usage?.output_tokens ?? 0;

    if (reply.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: reply.content });
      const results = [];
      for (const block of reply.content.filter((b: any) => b.type === 'tool_use')) {
        let out: string;
        try {
          out = await runTool(block.name, block.input ?? {}, org, toolCalls);
        } catch (err: any) {
          out = JSON.stringify({ error: err?.message ?? String(err) });
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    const answer = reply.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    return { answer, toolCalls, steps: step, inputTokens, outputTokens, ms: Date.now() - started };
  }

  return {
    answer: 'Hit the step limit without a final answer.',
    toolCalls, steps: maxSteps, inputTokens, outputTokens, ms: Date.now() - started,
  };
}
