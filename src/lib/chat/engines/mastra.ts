/**
 * Mastra engine — same model, same proxy route, same MCP tools as the control
 * engine, orchestrated by Mastra's agent loop instead of a hand-written one.
 * Kept behind CHAT_ENGINE so the two can be compared live.
 */
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { MCPClient } from '@mastra/mcp';
import { LibSQLStore } from '@mastra/libsql';
import { buildWriteTools } from './write-tools';
import { createSmartlingAnthropic } from '@/lib/chat/smartling-anthropic';
import { CHAT_SYSTEM, type EngineResult, type PendingApproval } from './types';

const AGENT_ID = 'glooker-chat-mastra';
/** Suspended runs are persisted here so an approval can arrive in a later request. */
const runStoreUrl = () => process.env.CHAT_RUN_STORE_URL || 'file:/tmp/glooker-chat-runs.db';

export interface MastraEngineOpts {
  mcpUrl: string;
  forward: Record<string, string>;
  org: string;
  baseUrl: string;
  isAdmin: boolean;
  maxSteps?: number;
}

/**
 * Storage lives on the Mastra instance, not the Agent — registering the agent
 * here is what makes approveToolCallGenerate() able to find a suspended run in
 * a later HTTP request. An Agent constructed with `storage` alone cannot resume.
 */
async function withMastra(opts: MastraEngineOpts) {
  const mcp = new MCPClient({
    id: `glooker-chat-${Date.now()}`,
    servers: { glooker: { url: new URL(opts.mcpUrl), requestInit: { headers: opts.forward } } } as any,
  });
  const toolCalls: string[] = [];
  const rawTools = await mcp.listTools();
  const readTools = Object.fromEntries(
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
    id: AGENT_ID,
    name: AGENT_ID,
    instructions: CHAT_SYSTEM,
    model: createSmartlingAnthropic({ operationName: 'glooker_chat_mastra' })('claude-sonnet-5') as any,
    tools: {
      ...readTools,
      ...buildWriteTools({ org: opts.org, baseUrl: opts.baseUrl, forward: opts.forward, isAdmin: opts.isAdmin }),
    },
  });

  const mastra = new Mastra({
    agents: { [AGENT_ID]: agent },
    storage: new LibSQLStore({ id: 'glooker-chat-runs', url: runStoreUrl() }),
  } as any);

  return { mcp, toolCalls, toolCount: Object.keys(rawTools).length + 1, agent: mastra.getAgent(AGENT_ID) as any };
}

function pendingFrom(res: any, toolCount: number, toolCalls: string[], started: number): EngineResult {
  const sp = res.suspendPayload ?? {};
  const pending: PendingApproval = {
    runId: res.runId,
    toolCallId: sp.toolCallId,
    toolName: sp.toolName,
    args: sp.args ?? {},
  };
  return {
    response: (res.text ?? '').trim() ||
      `This needs your approval before it runs: ${pending.toolName}(${JSON.stringify(pending.args)}).`,
    toolCalls, engine: 'mastra', toolCount, ms: Date.now() - started, pendingApproval: pending,
  };
}

/** Resolve a suspended run: execute the tool, or decline it. */
export async function resolveMastraApproval(
  opts: MastraEngineOpts & { runId: string; toolCallId: string; approve: boolean },
): Promise<EngineResult> {
  const started = Date.now();
  const { mcp, toolCalls, toolCount, agent } = await withMastra(opts);
  try {
    const res: any = opts.approve
      ? await agent.approveToolCallGenerate({ runId: opts.runId, toolCallId: opts.toolCallId })
      : await agent.declineToolCallGenerate({ runId: opts.runId, toolCallId: opts.toolCallId });

    if (res?.finishReason === 'suspended') return pendingFrom(res, toolCount, toolCalls, started);

    const text = (res?.text ?? '').trim();
    return {
      response: text || (opts.approve ? 'Done.' : 'Cancelled — nothing was changed.'),
      toolCalls, engine: 'mastra', toolCount, ms: Date.now() - started,
    };
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}

export async function runMastraEngine(opts: MastraEngineOpts & {
  messages: { role: string; content: string }[];
}): Promise<EngineResult> {
  const { messages, maxSteps = 8 } = opts;
  const started = Date.now();
  const { mcp, toolCalls, toolCount, agent } = await withMastra(opts);

  try {
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

    // A write tool asked for approval: nothing has run yet.
    if (res.finishReason === 'suspended') return pendingFrom(res, toolCount, toolCalls, started);

    // Mastra returns finishReason:'length' with text:'' on truncation. Never ship ''.
    const text = (res.text ?? '').trim();
    const response = text || (res.finishReason === 'length'
      ? 'That answer was cut off before it finished. Try a narrower question.'
      : `No answer was produced (finishReason=${res.finishReason}).`);

    return { response, toolCalls, engine: 'mastra', toolCount, ms: Date.now() - started };
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}
