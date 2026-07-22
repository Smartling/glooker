import { NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { handleJsonRpc } from '@/lib/mcp/protocol';
import { isAuthEnabled, extractUser } from '@/lib/auth';

async function postHandler(req: Request) {
  // Fail-closed backstop. Auth is normally enforced by the mcp-okta-proxy sidecar,
  // which validates the Okta token and injects the identity header. When AUTH_ENABLED
  // is set (prod), require that identity here too — so a missing/misconfigured proxy,
  // or the app port being reached directly, can't silently expose an open read API.
  // When AUTH_ENABLED is unset (local dev / mock), extractUser returns null and this
  // gate is skipped. This is a defense-in-depth check, not the primary auth layer.
  if (isAuthEnabled() && !extractUser(req.headers)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
      { status: 401 },
    );
  }

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
