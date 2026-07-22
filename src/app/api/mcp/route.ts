import { NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { handleJsonRpc } from '@/lib/mcp/protocol';

async function postHandler(req: Request) {
  // Request-log attribution (user identity) is handled by withRequestLog, which
  // calls extractUser itself — no need to duplicate it here.
  let message: any;
  try {
    message = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 200 });
  }

  const { status, body } = await handleJsonRpc(message);
  if (body === null) return new Response(null, { status });
  return NextResponse.json(body, { status });
}

async function getHandler(_req: Request) {
  // POST-only MCP endpoint; no server-initiated SSE stream.
  return new Response('Method Not Allowed', { status: 405 });
}

async function optionsHandler() {
  return new Response(null, { status: 204 });
}

export const POST = withRequestLog(postHandler);
export const GET = withRequestLog(getHandler);
export const OPTIONS = withRequestLog(optionsHandler);
