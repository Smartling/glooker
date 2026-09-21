/**
 * Mastra engine — same model, same proxy route, same MCP tools as the control
 * engine, orchestrated by Mastra's agent loop instead of a hand-written one.
 * Kept behind CHAT_ENGINE so the two can be compared live.
 */
import { Agent } from '@mastra/core/agent';
import { MCPClient } from '@mastra/mcp';
import { createSmartlingAnthropic } from '@/lib/chat/smartling-anthropic';
import { CHAT_SYSTEM, type EngineResult } from './types';

export async function runMastraEngine(
  messages: { role: string; content: string }[],
  mcpUrl: string,
  maxSteps = 8,
): Promise<EngineResult> {
  const started = Date.now();
  const toolCalls: string[] = [];

  const mcp = new MCPClient({
    id: `glooker-chat-${Date.now()}`,
    servers: { glooker: { url: new URL(mcpUrl) } },
  });

  try {
    const rawTools = await mcp.listTools();
    // Wrap each MCP tool so tool usage is visible in the UI.
    const tools = Object.fromEntries(
      Object.entries(rawTools).map(([name, tool]: [string, any]) => [
        name,
        {
          ...tool,
          execute: async (...args: any[]) => {
            toolCalls.push(`${name}(${JSON.stringify(args[0] ?? {})})`);
            return tool.execute(...args);
          },
        },
      ]),
    );

    const agent = new Agent({
      id: 'glooker-chat-mastra',
      name: 'glooker-chat-mastra',
      instructions: CHAT_SYSTEM,
      // Cast: @ai-sdk/anthropic resolves @ai-sdk/provider@4.0.17 while
      // @mastra/core pins 4.0.4, and LanguageModelV4.doGenerate differs between
      // those patches. Runtime is verified; this is version skew only.
      model: createSmartlingAnthropic({ operationName: 'glooker_chat_mastra' })('claude-sonnet-5') as any,
      tools,
    });

    // Pass the whole conversation so follow-up questions work. Cast because the
    // mixed user/assistant array does not narrow to Mastra's MessageListInput union.
    const convo = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const res: any = await agent.generate(
      convo as any,
      { modelSettings: { maxOutputTokens: 4000 }, maxSteps } as any,
    );

    // Mastra returns finishReason:'length' with text:'' on truncation. Never ship ''.
    const text = (res.text ?? '').trim();
    const response = text || (res.finishReason === 'length'
      ? 'That answer was cut off before it finished. Try a narrower question.'
      : `No answer was produced (finishReason=${res.finishReason}).`);

    return { response, toolCalls, engine: 'mastra', toolCount: Object.keys(rawTools).length, ms: Date.now() - started };
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}
