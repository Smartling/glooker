import { NextResponse } from 'next/server';
import { createRemoteJWKSet, decodeProtectedHeader, importSPKI, jwtVerify, type CryptoKey, type JWTPayload } from 'jose';

export interface AuthUser {
  email: string;
  sub: string;
  name: string | null;
  groups: string[];
}

/**
 * Whether identity is enforced.
 *
 * Unset means "enabled in production". The previous `=== 'true'` test made a
 * dropped or misspelled env var silently disable every authorization check in
 * the app (isAdmin returned true, requireAdmin returned "not denied", and
 * cost-visibility returned an omniscient predicate), with no error and no log
 * line. The insecure state now has to be chosen explicitly.
 */
export function isAuthEnabled(): boolean {
  const v = process.env.AUTH_ENABLED;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Auth is explicitly off. Convenient locally; in production it demands a
 * second, deliberate opt-in so "AUTH_ENABLED=false" alone cannot hand admin to
 * anonymous callers.
 */
function anonymousAdminAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.AUTH_ALLOW_ANONYMOUS_ADMIN === 'true';
}

// ---------------------------------------------------------------------------
// Signing-key resolution
// ---------------------------------------------------------------------------

/**
 * Two supported verification modes, because this app sits behind two different
 * identity-injecting proxies depending on the surface:
 *
 *   AUTH_JWKS_URL   — any standard JWKS endpoint (the mcp-okta-proxy path, or
 *                     an IdP used directly). Keys are fetched and rotated by
 *                     jose's own cache.
 *   AUTH_ALB_REGION — AWS ALB OIDC. ALB does NOT publish a JWKS document; it
 *                     serves one PEM per key id at
 *                     https://public-keys.auth.elb.<region>.amazonaws.com/<kid>
 *                     so each key is fetched and cached individually.
 *
 * Exactly one must be configured whenever auth is enabled. If neither is, token
 * verification fails closed rather than falling back to trusting the header.
 */
const ALB_KEY_TIMEOUT_MS = 5_000;
const albKeyCache = new Map<string, CryptoKey>();
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function remoteJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL!));
  return jwks;
}

async function albPublicKey(kid: string): Promise<CryptoKey> {
  const cached = albKeyCache.get(kid);
  if (cached) return cached;

  // kid comes from an unverified token header, so it must never be able to
  // steer the request off the AWS key host or onto another path.
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(kid)) throw new Error('malformed key id');

  const region = process.env.AUTH_ALB_REGION!;
  const res = await fetch(
    `https://public-keys.auth.elb.${encodeURIComponent(region)}.amazonaws.com/${encodeURIComponent(kid)}`,
    { signal: AbortSignal.timeout(ALB_KEY_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`unknown ALB key id (HTTP ${res.status})`);

  const key = await importSPKI(await res.text(), 'ES256');
  albKeyCache.set(kid, key);
  return key;
}

/** Clear cached signing keys. Tests only. */
export function _clearKeyCache(): void {
  albKeyCache.clear();
  jwks = null;
}

// ---------------------------------------------------------------------------
// Identity extraction
// ---------------------------------------------------------------------------

function testModeUser(): AuthUser | null {
  // Local development only, and structurally impossible in a production build.
  //
  // This bypass never consults the identity header, so while active every
  // request resolves to one fabricated identity regardless of the real caller.
  // It used to be reachable under NODE_ENV=production via
  // AUTH_TEST_ALLOW_IN_PRODUCTION, which made a full authentication bypass a
  // supported, documented configuration — and one pre-wired into
  // docker-compose.yml. That second opt-in is gone; the local flow should run
  // a development build instead.
  if (process.env.NODE_ENV === 'production') return null;

  const testUser = process.env.AUTH_TEST_USER;
  if (!testUser) return null;

  const adminGroup = process.env.AUTH_ADMIN_GROUP || 'admins';
  return {
    email: process.env.AUTH_TEST_EMAIL || 'testuser@glooker.dev',
    sub: 'test-user-001',
    name: testUser === 'admin' ? 'Test Admin' : 'Test Viewer',
    groups: testUser === 'admin' ? [adminGroup] : [],
  };
}

function toAuthUser(payload: JWTPayload): AuthUser | null {
  if (typeof payload.email !== 'string' || !payload.email) return null;
  return {
    email: payload.email,
    sub: typeof payload.sub === 'string' ? payload.sub : '',
    name: typeof payload.name === 'string' ? payload.name : null,
    groups: Array.isArray(payload.groups)
      ? payload.groups.filter((g): g is string => typeof g === 'string')
      : [],
  };
}

/**
 * Resolve the caller's identity from a cryptographically verified token.
 *
 * The previous implementation split the header on '.', base64-decoded segment
 * one, JSON.parsed it and trusted `email` and `groups` verbatim — no signature,
 * no expiry, no issuer. `x-amzn-oidc-data` is an ordinary HTTP header once it
 * leaves the load balancer, so anything that could open a TCP connection to the
 * app port was whichever identity, in whichever groups, it cared to claim.
 * AWS documents signature verification as mandatory for exactly this reason.
 *
 * Returns null on any failure. Never throws, so a key-fetch outage denies
 * access rather than granting it.
 */
export async function extractUser(headers: Headers): Promise<AuthUser | null> {
  if (!isAuthEnabled()) return null;

  const test = testModeUser();
  if (test) return test;

  const token = headers.get(process.env.AUTH_HEADER || 'x-amzn-oidc-data');
  if (!token) return null;

  try {
    // Unverified header read, used ONLY to pick a signing key (kid) and to
    // reject obviously-wrong algorithms early. No claim from it drives a
    // security decision: jwtVerify below is the authority, and it is given an
    // explicit `algorithms` allowlist, so a token lying about `alg` cannot
    // influence which algorithm is actually accepted. This is why the
    // "unsafe JWT decode" pattern does not apply here — the pre-filter can only
    // ever reject, never admit.
    const { alg, kid } = decodeProtectedHeader(token);

    let payload: JWTPayload;
    if (process.env.AUTH_JWKS_URL) {
      ({ payload } = await jwtVerify(token, remoteJwks(), {
        // Pinned here too, not just on the ALB branch. Without an explicit
        // allowlist jose accepts whatever the JWKS advertises, which hands
        // algorithm choice to the key document rather than to us.
        algorithms: (process.env.AUTH_JWKS_ALGS || 'RS256,ES256').split(',').map((a) => a.trim()),
        clockTolerance: 60,
        ...(process.env.AUTH_EXPECTED_ISS ? { issuer: process.env.AUTH_EXPECTED_ISS } : {}),
      }));
    } else if (process.env.AUTH_ALB_REGION) {
      if (alg !== 'ES256' || !kid) return null;
      ({ payload } = await jwtVerify(token, await albPublicKey(kid), {
        algorithms: ['ES256'],
        clockTolerance: 60,
        ...(process.env.AUTH_EXPECTED_ISS ? { issuer: process.env.AUTH_EXPECTED_ISS } : {}),
      }));
    } else {
      // Enabled but unconfigured: refuse rather than trust the header.
      console.error(
        '[auth] AUTH_ENABLED is on but neither AUTH_JWKS_URL nor AUTH_ALB_REGION is set. ' +
        'Identity tokens cannot be verified, so all requests are being denied.',
      );
      return null;
    }

    return toAuthUser(payload);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export async function isAdmin(req: Request): Promise<boolean> {
  if (!isAuthEnabled()) return anonymousAdminAllowed();
  const user = await extractUser(req.headers);
  if (!user) return false;
  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  if (!adminGroup) return false;
  return user.groups.includes(adminGroup);
}

export async function requireAdmin(req: Request): Promise<NextResponse | null> {
  return (await isAdmin(req)) ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
