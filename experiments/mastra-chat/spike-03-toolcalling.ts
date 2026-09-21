/**
 * Phase 0c — the risk that threatens BOTH arms of the experiment.
 * Glooker has never sent native `tools:` to the Smartling proxy; the current
 * chat agent asks the model to emit `TOOL_CALL: {...}` as plain text and
 * regexes it back out. If the proxy does not support native tool calling for
 * Anthropic models, neither Mastra nor a fixed vanilla loop can fix that.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getAccessToken } from '../../src/lib/smartling-auth';

const baseUrl = process.env.SMARTLING_BASE_URL!;
const accountUid = process.env.SMARTLING_ACCOUNT_UID!;
const url = `${baseUrl}/ai-proxy-api/v2/accounts/${accountUid}/compatible/openai`;

const calls: string[] = [];

const queryLeaderboard = createTool({
  id: 'queryLeaderboard',
  description: 'Get developers ranked by a metric.',
  inputSchema: z.object({
    metric: z.enum(['impact_score', 'total_commits']).describe('Metric to rank by'),
    limit: z.number().optional().describe('Max results'),
  }),
  execute: async ({ context }: any) => {
    calls.push(`queryLeaderboard(${JSON.stringify(context)})`);
    return { developers: [{ login: 'alice', total_commits: 42 }, { login: 'bob', total_commits: 17 }] };
  },
});

const getOrgSummary = createTool({
  id: 'getOrgSummary',
  description: 'Get high-level org totals.',
  inputSchema: z.object({}),
  execute: async () => { calls.push('getOrgSummary()'); return { developers: 2, commits: 59 }; },
});

async function main() {
  const agent = new Agent({
    id: 'spike3', name: 'spike3',
    instructions: 'You are a data analyst. Always use tools for numbers; never guess.',
    model: { id: 'smartling/anthropic/claude-sonnet-5', url, apiKey: await getAccessToken() } as any,
    tools: { queryLeaderboard, getOrgSummary },
  });

  // Multi-step: needs the leaderboard AND the org total, then a derived answer.
  const res = await agent.generate(
    'Who has the most commits, and what percentage of all org commits is that? Use the tools.',
    { modelSettings: { maxOutputTokens: 400 }, maxSteps: 5 } as any,
  );

  console.log('TOOLS INVOKED :', calls.length ? calls : '(none)');
  console.log('NATIVE CALLS  :', calls.length > 0 ? 'YES — proxy supports native tool calling' : 'NO');
  console.log('MULTI-STEP    :', calls.length >= 2 ? `YES (${calls.length} calls)` : 'single call only');
  console.log('ANSWER        :', JSON.stringify(res.text));
}
main().catch(e => {
  const api = e?.cause ?? e;
  console.error('SPIKE FAILED:', e?.message || e);
  if (api?.responseBody) console.error('BODY:', String(api.responseBody).slice(0, 700));
  if (api?.requestBodyValues?.tools) console.error('SENT TOOLS:', JSON.stringify(api.requestBodyValues.tools).slice(0, 700));
  process.exit(1);
});
