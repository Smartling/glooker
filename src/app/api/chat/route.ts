import { NextRequest, NextResponse } from 'next/server';
import { runChatAgent, type ChatMessage } from '@/lib/chat/agent';
import { runControlEngine } from '@/lib/chat/engines/control';
import { runMastraEngine, resolveMastraApproval } from '@/lib/chat/engines/mastra';
import { resolveRequester } from '@/lib/cost-visibility';
import { withRequestLog } from '@/lib/logger';
import { buildPreamble } from '@/lib/chat/context/preamble';
import type { PageContext } from '@/lib/chat/context/types';

export type ChatEngine = 'legacy' | 'control' | 'mastra';

const DEFAULT_ENGINE = (process.env.CHAT_ENGINE as ChatEngine) || 'control';

async function postHandler(req: NextRequest) {
  const body = await req.json();
  const { messages, org, engine, action, runId, toolCallId, pageContext } = body as {
    messages?: ChatMessage[];
    org: string;
    engine?: ChatEngine;
    action?: 'approve' | 'decline';
    runId?: string;
    toolCallId?: string;
    pageContext?: PageContext;
  };

  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  const picked: ChatEngine = engine ?? DEFAULT_ENGINE;
  const systemSuffix = buildPreamble(pageContext);

  // /api/mcp is fail-closed on identity and scopes cost visibility per requester,
  // so the caller's auth header must travel with the server-side call.
  const authHeader = process.env.AUTH_HEADER || 'x-amzn-oidc-data';
  const forward: Record<string, string> = {};
  const identity = req.headers.get(authHeader);
  if (identity) forward[authHeader] = identity;

  const origin = new URL(req.url).origin;
  const requester = await resolveRequester(req.headers, org);
  const engineOpts = {
    mcpUrl: new URL('/api/mcp', req.url).toString(),
    forward,
    org,
    baseUrl: origin,
    // authDisabled means local/dev with no auth at all; treat as admin there only.
    isAdmin: requester.isAdmin || requester.authDisabled === true,
    systemSuffix,
  };

  try {
    // Resolving a pending approval — no new user message involved.
    if (action) {
      if (!runId || !toolCallId) {
        return NextResponse.json({ error: 'runId and toolCallId are required' }, { status: 400 });
      }
      const result = await resolveMastraApproval({
        ...engineOpts, runId, toolCallId, approve: action === 'approve',
      });
      return NextResponse.json(result);
    }

    if (!messages?.length) return NextResponse.json({ error: 'messages are required' }, { status: 400 });

    if (picked === 'legacy') {
      const result = await runChatAgent(messages, org);
      return NextResponse.json({ ...result, engine: 'legacy', toolCount: 7 });
    }
    if (picked === 'mastra') {
      return NextResponse.json(await runMastraEngine({ ...engineOpts, messages }));
    }
    return NextResponse.json(await runControlEngine(messages, engineOpts.mcpUrl, forward, systemSuffix));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), engine: picked },
      { status: 500 },
    );
  }
}

export const POST = withRequestLog(postHandler);
