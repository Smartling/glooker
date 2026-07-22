import { NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { handleJsonRpc } from '@/lib/mcp/protocol';
import { extractUser } from '@/lib/auth';

async function postHandler(req: Request) {
  // Identity is read for request-log attribution only (read-only server, no gating).
  try { extractUser(req.headers); } catch { /* no-op */ }

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

async function getHandler() {
  // POST-only MCP endpoint; no server-initiated SSE stream.
  return new Response('Method Not Allowed', { status: 405 });
}

async function optionsHandler() {
  return new Response(null, { status: 204 });
}

export const POST = withRequestLog(postHandler);
export const GET = withRequestLog(getHandler);
export const OPTIONS = withRequestLog(optionsHandler);
