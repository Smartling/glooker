import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { takePageExtract } from './page-store';
import { answerFromPage } from './summarize-page';

export const PAGE_READ_TOOL_ID = 'readCurrentPage';

/**
 * Lets the agent look at the page the user is on.
 *
 * `requireApproval: true` is used as a SUSPEND PRIMITIVE, not a consent gate: the
 * run suspends, the client automatically posts the page extract, the route stores
 * it by runId and resumes. The user is never prompted.
 *
 * Why not suspendSchema/resumeSchema: probe-verified that an agent tool's execute
 * context exposes no `suspend`, and approveToolCallGenerate does not forward
 * resumeData. `runId` IS in the context, so the store is the handoff.
 *
 * Always RESOLVES. A page-read failure must never break an answer the agent could
 * otherwise have given.
 */
export function buildPageReadTool() {
  const readCurrentPage = createTool({
    id: PAGE_READ_TOOL_ID,
    description:
      'Read the page the user is currently looking at, to answer a question about it. ' +
      'Use when the user refers to something on their screen that your data tools cannot ' +
      'resolve. Pass the question you actually need answered. The answer is read off the ' +
      'rendered page, not fetched from the database.',
    inputSchema: z.object({
      question: z.string().describe('The question to answer from the page content.'),
    }),
    requireApproval: true,
    execute: async (input: any, ctx: any) => {
      const question = String(input?.question ?? '').slice(0, 500);
      const extract = takePageExtract(ctx?.runId ?? '');

      if (!extract) {
        return {
          ok: false,
          note: 'Page content unavailable — the page could not be read. Answer from your other tools, and say you could not see the screen.',
        };
      }

      const answer = await answerFromPage(extract, question);
      if (!answer) {
        return { ok: false, note: 'Could not read the page just now. Answer from your other tools instead.' };
      }

      return {
        ok: true,
        source: 'rendered page (read off the screen, not fetched from the database)',
        path: extract.path,
        answer,
      };
    },
  } as any);

  return { [PAGE_READ_TOOL_ID]: readCurrentPage };
}
