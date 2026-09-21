/**
 * Approval-gated write tools for the chat agent.
 *
 * Deliberately NOT on the MCP server: that server is read-only by design
 * (GLOOK-26) and is exposed to Claude Desktop through the mcp-okta-proxy
 * sidecar, so a write tool there would be reachable by every MCP consumer.
 * These live only on the chat agent.
 *
 * Two independent gates, on purpose:
 *   1. `requireApproval: true` — Mastra suspends the run before executing and
 *      will not call the tool until a human approves the exact arguments.
 *   2. admin — checked here against the caller's resolved identity, and again
 *      by `requireAdmin` inside POST /api/report, which this calls with the
 *      caller's auth header forwarded.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const VALID_PERIOD_DAYS = [3, 14, 30, 90] as const;

export interface WriteToolContext {
  org: string;
  /** Absolute origin of this app, for the server-side call back into it. */
  baseUrl: string;
  /** Caller's auth headers, forwarded so requireAdmin sees the real user. */
  forward: Record<string, string>;
  isAdmin: boolean;
}

export function buildWriteTools(ctx: WriteToolContext) {
  const startReportRun = createTool({
    id: 'startReportRun',
    description:
      'Start a new Glooker report run for the current org. This is a WRITE action: it ' +
      'consumes GitHub API budget and LLM spend, and takes several minutes. Requires ' +
      'human approval and admin rights. Only period lengths of 3, 14, 30 or 90 days are valid.',
    inputSchema: z.object({
      periodDays: z
        .union([z.literal(3), z.literal(14), z.literal(30), z.literal(90)])
        .describe('How many days the report should cover. Must be 3, 14, 30 or 90.'),
    }),
    requireApproval: true,
    execute: async (input: any) => {
      const periodDays = Number(input?.periodDays);
      if (!VALID_PERIOD_DAYS.includes(periodDays as any)) {
        return { error: `periodDays must be one of ${VALID_PERIOD_DAYS.join(', ')}` };
      }
      if (!ctx.isAdmin) {
        return { error: 'Refused: starting a report run requires admin rights.' };
      }

      const res = await fetch(new URL('/api/report', ctx.baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ctx.forward },
        body: JSON.stringify({ org: ctx.org, periodDays }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: body?.error ?? `Report run failed (HTTP ${res.status})` };
      }
      return { reportId: body.reportId, org: ctx.org, periodDays, status: 'started' };
    },
  } as any);

  return { startReportRun };
}
