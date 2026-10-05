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
/**
 * Key lookups are driven by an UNVERIFIED `kid`, so every distinct well-formed kid
 * would otherwise cost an outbound request to AWS (amplification). Bounded cache,
 * a short negative cache for misses, and one shared in-flight fetch per kid.
 * The signer check in extractUser also runs first, so a token from another ALB
 * never triggers a fetch at all.
 */
export const ALB_KEY_CACHE_MAX = 100;
const ALB_KEY_MISS_TTL_MS = 60_000;
const albKeyCache = new Map<string, CryptoKey>();
const albKeyMisses = new Map<string, number>();
const albKeyInflight = new Map<string, Promise<CryptoKey>>();
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function remoteJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL!));
  return jwks;
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

async function albPublicKey(kid: string): Promise<CryptoKey> {
  const cached = albKeyCache.get(kid);
  if (cached) return cached;

  // kid comes from an unverified token header, so it must never be able to
  // steer the request off the AWS key host or onto another path.
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(kid)) throw new Error('malformed key id');

  const missUntil = albKeyMisses.get(kid);
  if (missUntil && missUntil > Date.now()) throw new Error('unknown ALB key id (cached)');

  const inflight = albKeyInflight.get(kid);
  if (inflight) return inflight;

  const lookup = (async () => {
    const region = process.env.AUTH_ALB_REGION!;
    const res = await fetch(
      `https://public-keys.auth.elb.${encodeURIComponent(region)}.amazonaws.com/${encodeURIComponent(kid)}`,
      { signal: AbortSignal.timeout(ALB_KEY_TIMEOUT_MS) },
    );
    if (!res.ok) {
      boundedSet(albKeyMisses, kid, Date.now() + ALB_KEY_MISS_TTL_MS, ALB_KEY_CACHE_MAX);
      throw new Error(`unknown ALB key id (HTTP ${res.status})`);
    }
    const key = await importSPKI(await res.text(), 'ES256');
    boundedSet(albKeyCache, kid, key, ALB_KEY_CACHE_MAX);
    return key;
  })();
  albKeyInflight.set(kid, lookup);
  try {
    return await lookup;
  } finally {
    albKeyInflight.delete(kid);
  }
}

/** Tests only. */
export function _albKeyCacheSizeForTests(): number {
  return albKeyCache.size;
}

/** Clear cached signing keys. Tests only. */
export function _clearKeyCache(): void {
  albKeyCache.clear();
  albKeyMisses.clear();
  albKeyInflight.clear();
  jwks = null;
  oktaJwks = null;
  oktaJwksUrl = null;
  verifiedCache.clear();
}

// ---------------------------------------------------------------------------
// Verified-token memo
// ---------------------------------------------------------------------------

/**
 * One request is checked by the gate AND by each handler (requireAdmin,
 * resolveRequester, /api/auth/me), so the same token used to be verified several
 * times per request — and on the Okta path that meant several /userinfo calls.
 * A token that verified once maps to its identity until the token itself
 * expires (and at most VERIFIED_TTL_MS). Only ever written AFTER full
 * verification, so it can't admit anything verification wouldn't. Deliberately
 * not an internal "trusted identity" header: that would reintroduce header trust
 * the moment the proxy matcher missed a path.
 */
const VERIFIED_TTL_MS = 5 * 60_000;
const VERIFIED_MAX = 1_000;
const verifiedCache = new Map<string, { user: AuthUser; expiresAt: number }>();

async function memoKey(kind: string, token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}\u0000${token}`));
  return Buffer.from(digest).toString('base64');
}

function memoExpiry(payload: JWTPayload): number {
  const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now();
  return Math.min(exp, Date.now() + VERIFIED_TTL_MS);
}

async function memoized(kind: string, token: string, verify: () => Promise<{ user: AuthUser | null; payload?: JWTPayload }>): Promise<AuthUser | null> {
  const key = await memoKey(kind, token);
  const hit = verifiedCache.get(key);
  if (hit) {
    if (hit.expiresAt > Date.now()) return hit.user;
    verifiedCache.delete(key);
  }
  const { user, payload } = await verify();
  if (user && payload) boundedSet(verifiedCache, key, { user, expiresAt: memoExpiry(payload) }, VERIFIED_MAX);
  return user;
}

// ---------------------------------------------------------------------------
// Okta access tokens from the MCP sidecar
// ---------------------------------------------------------------------------

/**
 * The second identity path. MCP clients authenticate to the mcp-okta-proxy
 * sidecar with an Okta access token; the sidecar validates it and forwards the
 * ORIGINAL token to us in `x-okta-access-token` (its
 * OKTA_MCP_PROXY_ACCESS_TOKEN_HEADER_NAME). We verify that token ourselves
 * against Okta's JWKS — the sidecar's older synthetic `alg=none` header is
 * unverifiable by design and is rejected like any other unsigned token.
 *
 * Okta's org authorization server issues access tokens without email or groups,
 * so those come from Okta's /userinfo, called with the verified token (the same
 * thing the sidecar does). An identity is only ever built from a token whose
 * signature, issuer, audience and expiry all checked out.
 *
 * Accepted only on OKTA_TOKEN_PATHS: proxy.ts strips the header from every other
 * request (sanitizeIdentityHeaders), so a captured MCP token can't drive the UI.
 *
 * Config: AUTH_OKTA_ISSUER + AUTH_OKTA_AUDIENCE (both required, or the path is
 * off), optional AUTH_OKTA_CLIENT_ID (pins `cid`), AUTH_OKTA_JWKS_URL and
 * AUTH_OKTA_USERINFO_URL (derived from the issuer when unset),
 * AUTH_OKTA_TOKEN_HEADER (default x-okta-access-token).
 */
export const OKTA_TOKEN_PATHS = ['/api/mcp'] as const;

const OKTA_USERINFO_TIMEOUT_MS = 3_000;
let oktaJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let oktaJwksUrl: string | null = null;

export function oktaTokenHeader(): string {
  return (process.env.AUTH_OKTA_TOKEN_HEADER || 'x-okta-access-token').toLowerCase();
}

/** True when `pathname` may carry an Okta token (exact match or a sub-path). */
export function isOktaTokenPath(pathname: string): boolean {
  return OKTA_TOKEN_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

/** Drop the Okta token header from any request outside OKTA_TOKEN_PATHS. */
export function sanitizeIdentityHeaders(headers: Headers, pathname: string): Headers {
  if (isOktaTokenPath(pathname)) return headers;
  const out = new Headers(headers);
  out.delete(oktaTokenHeader());
  return out;
}

interface OktaConfig { issuer: string; audience: string; clientId: string; jwksUrl: string; userinfoUrl: string }

function oktaConfig(): OktaConfig | null {
  const issuer = process.env.AUTH_OKTA_ISSUER?.trim().replace(/\/+$/, '');
  const audience = process.env.AUTH_OKTA_AUDIENCE?.trim();
  if (!issuer && !audience) return null;
  if (!issuer || !audience) {
    console.error('[auth] Okta token verification needs BOTH AUTH_OKTA_ISSUER and AUTH_OKTA_AUDIENCE; Okta tokens are being denied.');
    return null;
  }
  // Okta's org server issues as https://<tenant> but serves its endpoints under
  // /oauth2/v1; a custom authorization server serves them under its issuer.
  const base = /\/oauth2\//.test(issuer) ? issuer : `${issuer}/oauth2`;
  const clientId = process.env.AUTH_OKTA_CLIENT_ID?.trim();
  if (!clientId) {
    // Required: Okta's org server uses one audience for every app in the tenant,
    // so the cid pin is what stops a token minted for another app.
    console.error('[auth] AUTH_OKTA_CLIENT_ID is required to verify Okta tokens; Okta tokens are being denied.');
    return null;
  }
  return {
    issuer,
    audience,
    clientId,
    jwksUrl: process.env.AUTH_OKTA_JWKS_URL?.trim() || `${base}/v1/keys`,
    userinfoUrl: process.env.AUTH_OKTA_USERINFO_URL?.trim() || `${base}/v1/userinfo`,
  };
}

function oktaKeySet(url: string) {
  if (!oktaJwks || oktaJwksUrl !== url) {
    oktaJwks = createRemoteJWKSet(new URL(url));
    oktaJwksUrl = url;
  }
  return oktaJwks;
}

async function verifyOktaToken(token: string): Promise<{ user: AuthUser | null; payload?: JWTPayload }> {
  const cfg = oktaConfig();
  if (!cfg) return { user: null };

  const { payload } = await jwtVerify(token, oktaKeySet(cfg.jwksUrl), {
    // Okta signs access tokens with RS256 only; pinning it means the token can't
    // pick its own algorithm (alg: none, HMAC-with-public-key, ...).
    algorithms: ['RS256'],
    issuer: cfg.issuer,
    audience: cfg.audience,
    clockTolerance: 60,
  });
  if (payload.cid !== cfg.clientId) return { user: null };

  const res = await fetch(cfg.userinfoUrl, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(OKTA_USERINFO_TIMEOUT_MS),
  });
  if (!res.ok) return { user: null };
  const info = await res.json() as Record<string, unknown>;
  // /userinfo must describe the principal the token was issued to. Okta's org
  // server puts the login in the access token's `sub` and the user id in `uid`,
  // while /userinfo answers sub = user id — so compare against uid when present.
  const expectedSub = typeof payload.uid === 'string' ? payload.uid : payload.sub;
  if (typeof info.sub !== 'string' || info.sub !== expectedSub) return { user: null };
  const user = toAuthUser({ ...info, sub: typeof payload.sub === 'string' ? payload.sub : info.sub } as JWTPayload);
  return { user, payload };
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
  if (!token) {
    // The MCP path: an Okta access token forwarded by the sidecar. Only reaches
    // here on OKTA_TOKEN_PATHS — proxy.ts strips the header everywhere else.
    const oktaToken = headers.get(oktaTokenHeader());
    if (!oktaToken) return null;
    try {
      return await memoized('okta', oktaToken, () => verifyOktaToken(oktaToken));
    } catch {
      return null;
    }
  }

  try {
    return await memoized('identity', token, () => verifyIdentityToken(token));
  } catch {
    return null;
  }
}

async function verifyIdentityToken(token: string): Promise<{ user: AuthUser | null; payload?: JWTPayload }> {
  const iss = process.env.AUTH_EXPECTED_ISS?.trim();

  {
    // Unverified header read, used ONLY to pick a signing key (kid) and to
    // reject obviously-wrong algorithms early. No claim from it drives a
    // security decision: jwtVerify below is the authority, and it is given an
    // explicit `algorithms` allowlist, so a token lying about `alg` cannot
    // influence which algorithm is actually accepted. This is why the
    // "unsafe JWT decode" pattern does not apply here — the pre-filter can only
    // ever reject, never admit.
    const header = decodeProtectedHeader(token) as { alg?: string; kid?: string; signer?: unknown };
    const { alg, kid } = header;

    let payload: JWTPayload;
    if (process.env.AUTH_JWKS_URL) {
      // Issuer AND audience are required: without the audience, a token the same
      // IdP signed for a different client app would authenticate here.
      const aud = process.env.AUTH_EXPECTED_AUD?.trim();
      if (!iss || !aud) {
        console.error('[auth] AUTH_JWKS_URL needs AUTH_EXPECTED_ISS and AUTH_EXPECTED_AUD; all requests are being denied.');
        return { user: null };
      }
      ({ payload } = await jwtVerify(token, remoteJwks(), {
        // Pinned here too, not just on the ALB branch. Without an explicit
        // allowlist jose accepts whatever the JWKS advertises, which hands
        // algorithm choice to the key document rather than to us.
        algorithms: (process.env.AUTH_JWKS_ALGS || 'RS256,ES256').split(',').map((a) => a.trim()),
        clockTolerance: 60,
        issuer: iss,
        audience: aud,
      }));
    } else if (process.env.AUTH_ALB_REGION) {
      // AWS serves signing keys for EVERY ALB in the region from the same host, so
      // a valid signature alone proves only "some ALB signed this". The token must
      // come from OUR load balancer (`signer`) for OUR IdP (`iss`). Checked before
      // any key fetch, so a foreign token costs no outbound request.
      const albArn = process.env.AUTH_ALB_ARN?.trim();
      if (!albArn || !iss) {
        console.error('[auth] AUTH_ALB_REGION needs AUTH_ALB_ARN and AUTH_EXPECTED_ISS; all requests are being denied.');
        return { user: null };
      }
      if (header.signer !== albArn) return { user: null };
      if (alg !== 'ES256' || !kid) return { user: null };
      ({ payload } = await jwtVerify(token, await albPublicKey(kid), {
        algorithms: ['ES256'],
        clockTolerance: 60,
        issuer: iss,
      }));
    } else {
      // Enabled but unconfigured: refuse rather than trust the header.
      console.error(
        '[auth] AUTH_ENABLED is on but neither AUTH_JWKS_URL nor AUTH_ALB_REGION is set. ' +
        'Identity tokens cannot be verified, so all requests are being denied.',
      );
      return { user: null };
    }

    return { user: toAuthUser(payload), payload };
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
