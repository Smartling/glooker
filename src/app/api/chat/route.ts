import { NextRequest, NextResponse } from 'next/server';
import { runChatAgent, type ChatMessage } from '@/lib/chat/agent';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';
import { internalError } from '@/lib/api-error';
import { resolveRequester } from '@/lib/cost-visibility';

async function postHandler(req: NextRequest) {
  // A malformed body is the caller's mistake: answer 400, not an unhandled 500.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 });
  }
  const { messages, org } = (body ?? {}) as { messages: ChatMessage[]; org: string };

  const orgCheck = requireAllowedOrg(org);
  if (!orgCheck.ok) return orgCheck.res;
  if (!messages?.length) return NextResponse.json({ error: 'messages are required' }, { status: 400 });

  // Verify the authenticated caller has membership in the requested org.
  // resolveRequester checks user_mappings for a (jira_email, org) → github_login
  // mapping. A null githubLogin with auth enabled means the caller is authenticated
  // but not mapped to this org, which is treated as unauthorized access.
  const requester = await resolveRequester(req.headers, orgCheck.org);
  if (!requester.authDisabled && !requester.isAdmin && !requester.githubLogin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await runChatAgent(messages, orgCheck.org);
    return NextResponse.json(result);
  } catch (err) {
    return internalError('chat', err);
  }
}

export const POST = withRequestLog(postHandler);
