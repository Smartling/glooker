import { NextRequest, NextResponse } from 'next/server';
import { runChatAgent, type ChatMessage } from '@/lib/chat/agent';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';
import { internalError } from '@/lib/api-error';

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

  try {
    const result = await runChatAgent(messages, org);
    return NextResponse.json(result);
  } catch (err) {
    return internalError('chat', err);
  }
}

export const POST = withRequestLog(postHandler);
