/**
 * Live proof for the model-invoked page-read tool (task 6 of
 * .superpowers/sdd/2026-09-23-model-invoked-page-read/).
 *
 * Everything below is the REAL production code — buildPageReadTool(),
 * putPageExtract()/takePageExtract(), answerFromPage() and its Haiku call — not
 * a spike stand-in. Only the data tool and the "current page" are synthetic,
 * the same way spike-08 stood in a fake write tool to exercise the real
 * approval-suspend primitive.
 *
 * Question is picked so neither the fake data tool nor a tier-1/2 style
 * descriptor in the system prompt could answer it: only the rendered page
 * text (supplied after suspend, via the real readCurrentPage tool) has it.
 *
 * Run: npx tsx experiments/mastra-chat/spike-09-page-read.ts
 * Loads .env.local automatically.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { createTool } from '@mastra/core/tools';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import { createSmartlingAnthropic } from '../../src/lib/chat/smartling-anthropic';
import { CHAT_SYSTEM } from '../../src/lib/chat/engines/types';
import { buildPageReadTool, PAGE_READ_TOOL_ID } from '../../src/lib/chat/context/page-read-tool';
import { putPageExtract } from '../../src/lib/chat/context/page-store';
import { HAIKU_MODEL, HAIKU_MODEL_VERSION } from '../../src/lib/chat/context/summarize-page';

// A fake data tool, standing in for the real 16-tool MCP surface — present so
// the model has *something* structured to reach for, and so a wrong-tool call
// would be visible instead of trivially absent.
let dataToolCalls = 0;
const queryOrgSummary = createTool({
  id: 'queryOrgSummary',
  description: 'Get high-level org totals across all developers (commits, PRs, developer count).',
  inputSchema: z.object({}),
  execute: async () => { dataToolCalls++; return { developers: 2, total_commits: 59 }; },
} as any);

// Stands in for a tier-1 route descriptor injected into the system prompt —
// it names the page but, same as the real preamble, carries no arbitrary
// visible text. It deliberately does NOT mention the banner below.
const PAGE_DESCRIPTOR_SUFFIX =
  '\n\nCurrent page: Settings > Integrations. The user is viewing configuration options.';

// Wrap the REAL tool so we can prove its execute body did not run pre-approval,
// without touching production code. requireApproval:true is what makes Mastra
// suspend before this ever fires.
let toolBodyRan = false;
const realPageTools = buildPageReadTool();
const realReadTool: any = realPageTools[PAGE_READ_TOOL_ID];
const instrumentedReadTool = {
  ...realReadTool,
  execute: async (...args: any[]) => {
    toolBodyRan = true;
    return realReadTool.execute(...args);
  },
};

async function main() {
  const agent = new Agent({
    id: 'page-read-spike', name: 'page-read-spike',
    instructions: CHAT_SYSTEM + PAGE_DESCRIPTOR_SUFFIX,
    model: createSmartlingAnthropic({ operationName: 'glooker_page_read_spike' })('claude-sonnet-5') as any,
    tools: { queryOrgSummary, [PAGE_READ_TOOL_ID]: instrumentedReadTool },
  } as any);

  // Storage must live on the Mastra instance, not the Agent, or
  // approveToolCallGenerate cannot find the suspended run later (spike-08).
  const mastra = new Mastra({
    agents: { 'page-read-spike': agent },
    storage: new LibSQLStore({ id: 'spike-page-read', url: 'file:/tmp/spike-page-read.db' }),
  } as any);
  const registered = mastra.getAgent('page-read-spike') as any;

  const question =
    "There's a banner at the top of this settings page right now — what does it say? " +
    "I want to know if I need to do anything about it.";

  console.log('QUESTION:', question);
  const res: any = await registered.generate(question, {
    modelSettings: { maxOutputTokens: 500 }, maxSteps: 4,
  } as any);

  console.log('\n=== BEFORE RESUME ===');
  console.log('dataToolCalls                 :', dataToolCalls);
  console.log('toolBodyRan                   :', toolBodyRan, '  <-- must be false');
  console.log('finishReason                  :', res.finishReason);
  console.log('runId                         :', res.runId);
  console.log('suspendPayload                :', JSON.stringify(res.suspendPayload));

  const sp = res.suspendPayload ?? {};
  const calledPageReadUnprompted = res.finishReason === 'suspended' && sp.toolName === PAGE_READ_TOOL_ID;

  // "Unprompted" here means the production CHAT_SYSTEM prompt (which does name
  // readCurrentPage and instructs the agent to use it for screen references —
  // it is not a zero-shot discovery) actually causes the model to follow
  // through and call the tool on a real screen-referencing question, as
  // opposed to guessing an answer, refusing, or ignoring the instruction. This
  // is the real production system prompt, unmodified.
  console.log(
    '\nDID THE MODEL FOLLOW THE PROMPT AND CALL THE TOOL?  :',
    calledPageReadUnprompted
      ? 'YES — no leading/explicit "use readCurrentPage now" instruction was added beyond the standing production system prompt; the model recognized the screen-reference and called the tool rather than guessing or refusing.'
      : `NO — it did something else (finishReason=${res.finishReason}, toolName=${sp.toolName ?? '(none)'}).`,
  );

  if (!calledPageReadUnprompted) {
    console.log('\ntext at this point:', res.text);
    console.log('\nRESULT: negative — the model did not reach for the page. Reporting honestly, not retrying with a leading question.');
    process.exit(0);
  }

  // --- Assertions: the run suspended with a pendingPageRead-shaped payload,
  // and the real tool body has genuinely not executed yet. ---
  assert.equal(res.finishReason, 'suspended', 'expected the run to suspend');
  assert.equal(sp.toolName, PAGE_READ_TOOL_ID, 'expected the suspended tool to be readCurrentPage');
  assert.ok(typeof res.runId === 'string' && res.runId.length > 0, 'expected a runId');
  assert.ok(typeof sp.toolCallId === 'string' && sp.toolCallId.length > 0, 'expected a toolCallId');
  assert.ok(typeof sp.args?.question === 'string' && sp.args.question.length > 0, 'expected the model to pass a question');
  assert.equal(toolBodyRan, false, 'the tool body must NOT have run before the extract was supplied');

  // This is exactly the shape mastra.ts's pendingFrom() hands back as
  // EngineResult.pendingPageRead.
  const pendingPageRead = {
    runId: res.runId as string,
    toolCallId: sp.toolCallId as string,
    question: String(sp.args.question),
  };
  console.log('\npendingPageRead payload       :', JSON.stringify(pendingPageRead));
  console.log('ASSERTIONS PASSED             : suspended with a pendingPageRead-shaped payload; tool body did not run.');

  // Supply a synthetic extract exactly as the client's auto-answer would via
  // POST /api/chat { action: 'providePage', pageExtract }.
  const syntheticExtract = {
    path: '/settings',
    title: 'Settings',
    heading: 'Integrations',
    text:
      'Warning: your GitHub fine-grained token expires in 3 days (2026-09-26). ' +
      'Renew it in the Integrations tab before then, or the next scheduled report run will fail.',
  };
  putPageExtract(pendingPageRead.runId, syntheticExtract);
  console.log('\nSupplied synthetic extract    :', JSON.stringify(syntheticExtract));
  console.log(
    `Haiku model split             : model=${HAIKU_MODEL} modelVersion=${HAIKU_MODEL_VERSION} (two fields, not combined)`,
  );

  // Intercept the outgoing fetch just to read back the Haiku call's usage —
  // production code (summarize-page.ts) doesn't need or report this; we only
  // want it for this spike's record. Filtered on the Haiku model id in the
  // body so the Sonnet agent-continuation call on the same endpoint isn't
  // misattributed.
  let haikuUsage: { input_tokens?: number; output_tokens?: number } | null = null;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const response = await originalFetch(input as any, init as any);
    try {
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      if (bodyStr.includes(HAIKU_MODEL)) {
        const clone = response.clone();
        clone.json().then((json: any) => {
          const usage = json?.response?.data?.payload?.usage;
          if (usage) haikuUsage = usage;
        }).catch(() => {});
      }
    } catch {
      // best-effort instrumentation only; never let it affect the real call
    }
    return response;
  };

  const resumeStarted = Date.now();
  const approved: any = await registered.approveToolCallGenerate({
    runId: pendingPageRead.runId,
    toolCallId: pendingPageRead.toolCallId,
  });
  const resumeMs = Date.now() - resumeStarted;
  (globalThis as any).fetch = originalFetch;

  console.log('\n=== AFTER RESUME ===');
  console.log('toolBodyRan                   :', toolBodyRan, '  <-- must now be true');
  console.log('finishReason                  :', approved?.finishReason);
  console.log('resume round-trip ms          :', resumeMs, '(includes the Haiku page-read call + the Sonnet continuation call)');
  console.log('Haiku call usage (measured)   :', haikuUsage ? JSON.stringify(haikuUsage) : '(not observed — see note below)');
  console.log('\nFINAL ANSWER                  :', (approved?.text || '').trim());

  assert.equal(toolBodyRan, true, 'the tool body must have run after the extract was supplied and the run was resumed');
}

main().catch(e => {
  console.error('SPIKE ERR:', e?.message || e);
  process.exit(1);
});
