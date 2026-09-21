import { config } from 'dotenv';
config({ path: '.env.local' });
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { createTool } from '@mastra/core/tools';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import { createSmartlingAnthropic } from '../../src/lib/chat/smartling-anthropic';

let executed = false;
const startReportRun = createTool({
  id: 'startReportRun',
  description: 'Start a new Glooker report run for the org. This costs GitHub API budget and LLM spend.',
  inputSchema: z.object({ periodDays: z.number().describe('Days to cover, e.g. 14') }),
  requireApproval: true,
  execute: async (input: any) => { executed = true; return { reportId: 'fake-123', periodDays: input.periodDays }; },
} as any);

async function main() {
  const agent = new Agent({
    id: 'approval-spike', name: 'approval-spike',
    instructions: 'You start report runs when asked. Be brief.',
    model: createSmartlingAnthropic({ operationName: 'glooker_approval_spike' })('claude-sonnet-5') as any,
    tools: { startReportRun },
  } as any);

  // Suspended runs are persisted by the Mastra instance's storage, not the
  // Agent's — registering the agent here is what makes resume work at all.
  const mastra = new Mastra({
    agents: { 'approval-spike': agent },
    storage: new LibSQLStore({ id: 'spike', url: 'file:/tmp/spike-approval.db' }),
  } as any);
  const registered = mastra.getAgent('approval-spike') as any;

  const res: any = await registered.generate('Start a 14 day report run.', {
    modelSettings: { maxOutputTokens: 500 }, maxSteps: 4,
  } as any);

  console.log('executed-before-approval:', executed, '  <-- must be false');
  console.log('finishReason :', res.finishReason);
  console.log('runId        :', res.runId);
  console.log('suspendPayload:', JSON.stringify(res.suspendPayload)?.slice(0, 300));
  const keys = Object.keys(res).filter(k => /approv|suspend|pending|runId|toolCall/i.test(k));
  console.log('relevant keys:', keys.join(', '));
  for (const k of keys) console.log('  ', k, '=', JSON.stringify((res as any)[k])?.slice(0, 200));
  // Now approve it and confirm the tool actually runs.
  const sp = res.suspendPayload;
  const approved: any = await registered.approveToolCallGenerate({
    runId: res.runId,
    toolCallId: sp.toolCallId,
  });
  console.log('--- after approve ---');
  console.log('executed      :', executed, '  <-- must now be true');
  console.log('finishReason  :', approved?.finishReason);
  console.log('text          :', (approved?.text || '').slice(0, 200).replace(/\n/g, ' | '));
}
main().catch(e => { console.error('SPIKE ERR:', e?.message || e); process.exit(1); });
