import { NextRequest, NextResponse } from 'next/server';
import { runChatAgent, type ChatMessage } from '@/lib/chat/agent';
import { runControlEngine } from '@/lib/chat/engines/control';
import { runMastraEngine } from '@/lib/chat/engines/mastra';
import { withRequestLog } from '@/lib/logger';

export type ChatEngine = 'legacy' | 'control' | 'mastra';

const DEFAULT_ENGINE = (process.env.CHAT_ENGINE as ChatEngine) || 'control';

async function postHandler(req: NextRequest) {
  const body = await req.json();
  const { messages, org, engine } = body as {
    messages: ChatMessage[]; org: string; engine?: ChatEngine;
  };

  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });
  if (!messages?.length) return NextResponse.json({ error: 'messages are required' }, { status: 400 });

  const picked: ChatEngine = engine ?? DEFAULT_ENGINE;
  // The MCP server is this same app; derive its URL from the incoming request so
  // this works identically in dev, podman and ECS.
  const mcpUrl = new URL('/api/mcp', req.url).toString();

  try {
    if (picked === 'legacy') {
      const result = await runChatAgent(messages, org);
      return NextResponse.json({ ...result, engine: 'legacy', toolCount: 7 });
    }
    const result = picked === 'mastra'
      ? await runMastraEngine(messages, mcpUrl)
      : await runControlEngine(messages, mcpUrl);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), engine: picked },
      { status: 500 },
    );
  }
}

export const POST = withRequestLog(postHandler);
