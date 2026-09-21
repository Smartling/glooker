/**
 * Phase 2 differentiator A, part 2 — drive the 16 MCP tools from a Mastra agent
 * and answer a question the current 7-tool chat CANNOT answer at all.
 *
 * Today's chat tools hardwire latestReportId(org), so no historical or
 * cross-report question is possible. list_reports + get_org_summary are only
 * reachable through the MCP server.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { MCPClient } from '@mastra/mcp';
import { createSmartlingAnthropic } from './smartling-anthropic';

async function main() {
  const mcp = new MCPClient({
    id: `glooker-mcp-${Date.now()}`,
    servers: { glooker: { url: new URL('http://localhost:3000/api/mcp') } },
  });
  const tools = await mcp.listTools();

  const smartling = createSmartlingAnthropic({ operationName: 'glooker_chat_mcp' });
  const agent = new Agent({
    id: 'glooker-mcp-agent',
    name: 'glooker-mcp-agent',
    instructions:
      'You are a data analyst for GitHub org analytics. Always use tools; never guess. ' +
      'If a filtered query returns nothing, say so rather than widening the filter repeatedly. Be concise.',
    model: smartling('claude-sonnet-5') as any,
    tools,
  });

  const q = 'List the available reports, then compare the org summary between the two most recent ones. '
          + 'What changed in total commits and developer count?';
  console.log('Q:', q);
  const t = Date.now();
  const res: any = await agent.generate(q, { modelSettings: { maxOutputTokens: 3000 }, maxSteps: 8 } as any);
  console.log('---');
  console.log('finishReason:', res.finishReason, ' steps:', res.steps?.length);
  console.log('toolCalls   :', (res.toolCalls ?? []).map((c: any) => c.toolName ?? c.name).join(', ') || '(none)');
  console.log('inputTokens :', res.totalUsage?.inputTokens ?? res.usage?.inputTokens);
  console.log('wall        :', ((Date.now() - t) / 1000).toFixed(1) + 's');
  console.log('ANSWER      :\n' + (res.text || '[empty]'));
  await mcp.disconnect();
}
main().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
