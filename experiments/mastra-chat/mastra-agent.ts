/**
 * MASTRA ARM — same tools, same model, same proxy route as the control arm.
 * Built from the identical TOOL_SPECS so the comparison isolates orchestration.
 */
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { jsonSchema } from '@mastra/schema-compat';
import { createSmartlingAnthropic } from './smartling-anthropic';
import { TOOL_SPECS, runTool } from './shared-tools';
import type { AgentRun } from './control-agent';

export function buildMastraAgent(org: string, systemPrompt: string, log: string[]) {
  const tools = Object.fromEntries(
    TOOL_SPECS.map(spec => [
      spec.name,
      createTool({
        id: spec.name,
        description: spec.description,
        // Reuse the repo's existing JSON Schema rather than rewriting it in zod,
        // so both arms advertise byte-identical tool surfaces to the model.
        inputSchema: jsonSchema(spec.schema) as any,
        execute: async (inputData: any) => {
          const raw = await runTool(spec.name, inputData ?? {}, org, log);
          return JSON.parse(raw);
        },
      }),
    ]),
  );

  const smartling = createSmartlingAnthropic({ operationName: 'glooker_chat_mastra' });

  return new Agent({
    id: 'glooker-chat-mastra',
    name: 'glooker-chat-mastra',
    instructions: systemPrompt,
    // Type-only cast. @ai-sdk/anthropic@4.0.58 resolves @ai-sdk/provider@4.0.17
    // while @mastra/core@1.67.0 pins 4.0.4, and LanguageModelV4.doGenerate's
    // return type differs between those patches. Runtime is verified working
    // (spike-04); this is purely the version skew. Remove when Mastra bumps.
    model: smartling('claude-sonnet-5') as any,
    tools,
  });
}

export async function runMastraAgent(
  question: string,
  org: string,
  systemPrompt: string,
  maxSteps = 6,
): Promise<AgentRun> {
  const started = Date.now();
  const toolCalls: string[] = [];
  const agent = buildMastraAgent(org, systemPrompt, toolCalls);

  const res: any = await agent.generate(question, {
    modelSettings: { maxOutputTokens: 2000 },
    maxSteps,
  } as any);

  return {
    answer: (res.text ?? '').trim(),
    toolCalls,
    steps: res.steps?.length ?? (toolCalls.length + 1),
    inputTokens: res.usage?.inputTokens ?? res.usage?.promptTokens ?? 0,
    outputTokens: res.usage?.outputTokens ?? res.usage?.completionTokens ?? 0,
    ms: Date.now() - started,
  };
}
