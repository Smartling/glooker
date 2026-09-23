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
import { buildPageReadTool, PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';
import { putPageExtract } from '@/lib/chat/context/page-store';
import type { PageExtract } from '@/lib/chat/context/page-extract';

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
  systemSuffix?: string;
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
  // listTools() is `(await listToolsWithErrors()).tools` — it DISCARDS errors, so an
  // unreachable MCP server yields zero tools and the agent answers from nothing.
  // That is a failure that looks like a success; surface it instead.
  const { tools: rawTools, errors } = await (mcp as any).listToolsWithErrors();
  if (errors?.length) {
    throw new Error(`Could not reach the Glooker data tools: ${errors.map((e: any) => e?.message ?? String(e)).join('; ')}`);
  }
  if (!rawTools || Object.keys(rawTools).length === 0) {
    throw new Error('The Glooker data tools returned an empty tool list; refusing to answer without data access.');
  }
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

  const tools = {
    ...readTools,
    ...buildWriteTools({ org: opts.org, baseUrl: opts.baseUrl, forward: opts.forward, isAdmin: opts.isAdmin }),
    ...buildPageReadTool(),
  };

  const agent = new Agent({
    id: AGENT_ID,
    name: AGENT_ID,
    instructions: CHAT_SYSTEM + (opts.systemSuffix ?? ''),
    model: createSmartlingAnthropic({ operationName: 'glooker_chat_mastra' })('claude-sonnet-5') as any,
    tools,
  });

  const mastra = new Mastra({
    agents: { [AGENT_ID]: agent },
    storage: new LibSQLStore({ id: 'glooker-chat-runs', url: runStoreUrl() }),
  } as any);

  return { mcp, toolCalls, toolCount: Object.keys(tools).length, agent: mastra.getAgent(AGENT_ID) as any };
}

export function pendingFrom(res: any, toolCount: number, toolCalls: string[], started: number): EngineResult {
  const sp = res.suspendPayload ?? {};
  const base = { toolCalls, engine: 'mastra' as const, toolCount, ms: Date.now() - started };

  if (sp.toolName === PAGE_READ_TOOL_ID) {
    return {
      ...base,
      response: (res.text ?? '').trim() || 'Reading the page…',
      pendingPageRead: {
        runId: res.runId,
        toolCallId: sp.toolCallId,
        question: String(sp.args?.question ?? ''),
      },
    };
  }

  const pending: PendingApproval = {
    runId: res.runId,
    toolCallId: sp.toolCallId,
    toolName: sp.toolName,
    args: sp.args ?? {},
  };
  return {
    ...base,
    response: (res.text ?? '').trim() ||
      `This needs your approval before it runs: ${pending.toolName}(${JSON.stringify(pending.args)}).`,
    pendingApproval: pending,
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

/**
 * Confirms the named run's suspended tool call really is the page-read tool
 * before a providePage POST is allowed to resume it (Finding 1).
 *
 * /api/chat is open HTTP: the shipped client only calls providePage when the
 * server said `pendingPageRead`, but nothing stops a crafted POST from naming
 * a pending write-tool's runId/toolCallId instead — approveToolCallGenerate()
 * doesn't care what it's resuming. listSuspendedRuns() (@mastra/core >= 1.43)
 * is the only API that reports a suspended run's actual toolName without
 * resuming it, so it is the check gate here. It also incidentally covers an
 * unknown/expired runId: no matching run means no matching tool call either.
 */
async function isPageReadSuspend(agent: any, runId: string, toolCallId: string): Promise<boolean> {
  const { runs } = await agent.listSuspendedRuns();
  const run = (runs ?? []).find((r: any) => r.runId === runId);
  const toolCall = run?.toolCalls?.find((tc: any) => tc.toolCallId === toolCallId);
  return toolCall?.toolName === PAGE_READ_TOOL_ID;
}

/**
 * Supply the page extract the agent asked for, then let the run continue.
 *
 * `extract` may be null — clampExtract() returns null for an unusable page
 * scrape. That must still resume the run (just without storing an extract) so
 * the tool's own "page content unavailable" branch fires and the agent
 * degrades gracefully instead of the run hanging forever unresolved (Finding 3).
 */
export async function resolvePageRead(
  opts: MastraEngineOpts & { runId: string; toolCallId: string; extract: PageExtract | null },
): Promise<EngineResult> {
  const started = Date.now();
  const { mcp, toolCalls, toolCount, agent } = await withMastra(opts);
  try {
    if (!(await isPageReadSuspend(agent, opts.runId, opts.toolCallId))) {
      const message = 'That run is not waiting on a page read — refusing to resume it with page content.';
      return { response: message, toolCalls, engine: 'mastra', toolCount, ms: Date.now() - started, refused: message };
    }

    if (opts.extract) putPageExtract(opts.runId, opts.extract);
    const res: any = await agent.approveToolCallGenerate({
      runId: opts.runId,
      toolCallId: opts.toolCallId,
    });

    if (res?.finishReason === 'suspended') return pendingFrom(res, toolCount, toolCalls, started);

    const text = (res?.text ?? '').trim();
    return {
      response: text || 'I read the page but could not form an answer.',
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
