import { NextResponse } from 'next/server';

/**
 * One client-safe error response for every public API boundary.
 *
 * Seven handlers returned `err.message` directly, and several of those messages
 * embed an entire upstream response: JiraClient.jiraFetch throws
 * `Jira API error (${status}): ${text}` with the full Jira body, Octokit errors
 * carry request URLs and rate-limit state, and LLM errors carry the provider
 * endpoint, model name and quota detail. On the unauthenticated routes that was
 * a free oracle — notably it turned the JQL injection into an *interactive* one,
 * because Jira's own parse errors came back naming fields and positions.
 *
 * withRequestLog already does the right thing for anything that escapes a
 * handler (generic 500, stack to errors.log only); these handlers bypassed it by
 * catching first. mcp/tools.ts also already had this policy, with a comment
 * explaining why — this is that policy, shared.
 *
 * Messages the code authors itself stay as they are: ReportNotFoundError,
 * JiraNotConfiguredError, TeamDuplicateError and validation failures are
 * contract, not leakage.
 */
export function internalError(scope: string, err: unknown, status = 500): NextResponse {
  console.error(`[${scope}]`, err);
  return NextResponse.json(
    { error: 'internal_error', message: 'Request failed. See server logs for details.' },
    { status },
  );
}
