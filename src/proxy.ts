import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { extractUser, isAuthEnabled, sanitizeIdentityHeaders } from '@/lib/auth';
import { buildCsp, newNonce } from '@/lib/csp';

/**
 * Deny-by-default authentication gate.
 *
 * Authorization used to be opt-in per handler: 24 of the 62 exported route
 * handlers referenced no auth function at all, so every GET on /api/report/*,
 * /api/vulnerabilities/*, /api/projects/*, /api/teams, /api/schedule and
 * /api/settings/user-mappings was readable by anyone who could reach the port,
 * as were POST /api/chat and POST /api/settings/github/test-connection. Two of
 * those routes proxy the server's GitHub PAT at a caller-chosen org, and
 * /api/vulnerabilities/alerts returns the org's unpatched critical CVEs with
 * due dates — a prioritised target list.
 *
 * Two of the vulnerability route files even carried the comment "Readable by
 * every signed-in user … Do not add requireAdmin", documenting a signed-in
 * check that nothing in the request path performed. This file is that check.
 *
 * requireAdmin() stays in the handlers: this establishes *authentication*,
 * handlers enforce *authorization*. Adding a new route can no longer ship an
 * unauthenticated endpoint by omission.
 *
 * Next 16 renamed this convention from `middleware` to `proxy`; the runtime is
 * nodejs and cannot be configured, which is what lets this call extractUser()
 * (JWKS fetch + jose verification) directly.
 */

/** Reachable without an identity. Deliberately tiny. */
const PUBLIC_PATHS = new Set<string>([
  '/api/health', // liveness probe: no auth, no DB, no secrets
]);

// A 401 renders nothing, so it gets the tightest possible policy.
const UNAUTHORIZED_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function unauthorized(req: NextRequest) {
  // API callers get JSON; page loads get a plain 401 body, because there is no
  // in-app login to redirect to — the edge proxy owns the sign-in flow.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Content-Security-Policy': UNAUTHORIZED_CSP } });
  }
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'Content-Security-Policy': UNAUTHORIZED_CSP },
  });
}

/**
 * Pass the request on with a per-request CSP nonce (see lib/csp.ts). The policy goes
 * on the REQUEST headers so Next can read the nonce and stamp it on its own inline
 * scripts, and on the response so the browser enforces it.
 */
function next(req: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== 'production' });
  // An Okta access token only counts on the MCP route (lib/auth.ts); drop it from
  // every other request so no handler downstream can ever be shown one.
  const headers = sanitizeIdentityHeaders(new Headers(req.headers), req.nextUrl.pathname);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export async function proxy(req: NextRequest) {
  // When auth is off this gate is inert, matching isAuthEnabled() everywhere
  // else. Note that "off" now means an explicit AUTH_ENABLED=false, or any
  // non-production environment — production defaults to on, and
  // validateEnv() prints a startup banner whenever auth is off at all.
  if (!isAuthEnabled()) return next(req);

  if (PUBLIC_PATHS.has(req.nextUrl.pathname)) return next(req);

  const user = await extractUser(sanitizeIdentityHeaders(req.headers, req.nextUrl.pathname));
  if (!user) return unauthorized(req);

  return next(req);
}

export const config = {
  // Everything except Next's own static output and the favicon. Keeping the
  // matcher broad (rather than listing API paths) is the point: a new route
  // is covered by default instead of needing to be remembered.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
