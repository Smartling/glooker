import { NextRequest, NextResponse } from 'next/server';
import { runChatAgent, type ChatMessage } from '@/lib/chat/agent';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, org } = body as { messages: ChatMessage[]; org: string };

  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });
  if (!messages?.length) return NextResponse.json({ error: 'messages are required' }, { status: 400 });

  try {
    const result = await runChatAgent(messages, org);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
