/**
 * The goal: Mastra + Claude + native tool calling, all through the AI Proxy.
 * Uses the /anthropicai/chat passthrough via the fetch shim.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createSmartlingAnthropic } from './smartling-anthropic';

const calls: string[] = [];

const queryLeaderboard = createTool({
  id: 'queryLeaderboard',
  description: 'Get developers ranked by a metric.',
  inputSchema: z.object({ metric: z.enum(['impact_score', 'total_commits']), limit: z.number().optional() }),
  // Mastra v1: execute receives the validated input positionally.
  // (v0.x used `({ context })` — a silent behaviour change.)
  execute: async (inputData: any) => {
    calls.push(`queryLeaderboard(${JSON.stringify(inputData)})`);
    return { developers: [{ login: 'alice', total_commits: 42 }, { login: 'bob', total_commits: 17 }] };
  },
});

const queryOrgSummary = createTool({
  id: 'queryOrgSummary',
  description: 'Get high-level org totals across all developers.',
  inputSchema: z.object({}),
  execute: async () => { calls.push('queryOrgSummary()'); return { developers: 2, total_commits: 59 }; },
});

async function main() {
  const smartling = createSmartlingAnthropic({ operationName: 'glooker_chat_spike' });

  const agent = new Agent({
    id: 'glooker-chat',
    name: 'glooker-chat',
    instructions: 'You are a data analyst for GitHub org analytics. Always use tools for numbers; never guess.',
    // Type-only cast. @ai-sdk/anthropic@4.0.58 resolves @ai-sdk/provider@4.0.17
    // while @mastra/core@1.67.0 pins 4.0.4, and LanguageModelV4.doGenerate's
    // return type differs between those patches. Runtime is verified working
    // (spike-04); this is purely the version skew. Remove when Mastra bumps.
    model: smartling('claude-sonnet-5') as any,
    tools: { queryLeaderboard, queryOrgSummary },
  });

  const res = await agent.generate(
    'Who has the most commits, and what percentage of all org commits is that?',
    { modelSettings: { maxOutputTokens: 600 }, maxSteps: 6 } as any,
  );

  console.log('TOOLS CALLED :', calls.length ? calls : '(none)');
  console.log('MULTI-STEP   :', calls.length >= 2 ? `YES (${calls.length} calls)` : `${calls.length} call`);
  console.log('ANSWER       :', res.text);
}
main().catch(e => {
  const api = e?.cause ?? e;
  console.error('FAILED:', e?.message || e);
  if (api?.responseBody) console.error('BODY:', String(api.responseBody).slice(0, 400));
  process.exit(1);
});
