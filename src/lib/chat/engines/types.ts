export interface PendingApproval {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface EngineResult {
  response: string;
  toolCalls: string[];
  engine: string;
  toolCount: number;
  ms: number;
  /** Set when a write tool is waiting on human approval; nothing has run yet. */
  pendingApproval?: PendingApproval;
}

export const CHAT_SYSTEM = `You are Glooker Assistant — a data analyst for GitHub org developer analytics.

Always use the tools to get data; never guess numbers.
If a filtered query returns nothing, say so plainly — do NOT keep widening the filter.
Be concise: answer first, then the supporting data.
Use @login format for developers. Round to 1 decimal place.

Formatting (the chat window is narrow, ~45 chars):
- Tables: max 3-4 short columns, abbreviated headers
- Keep cell values short — numbers, not sentences
- Prefer bullet lists over wide tables`;
