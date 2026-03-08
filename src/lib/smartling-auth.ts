/**
 * Smartling OAuth – exchanges userIdentifier + userSecret for a Bearer token.
 * Tokens expire in ~24h; we refresh proactively 5 minutes before expiry.
 */

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cache: TokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 5 * 60 * 1000) {
    return cache.accessToken;
  }

  const baseUrl  = process.env.SMARTLING_BASE_URL!;
  const userId   = process.env.SMARTLING_USER_IDENTIFIER!;
  const secret   = process.env.SMARTLING_USER_SECRET!;

  const res = await fetch(`${baseUrl}/auth-api/v2/authenticate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userIdentifier: userId, userSecret: secret }),
  });

  if (!res.ok) {
    throw new Error(`Smartling auth failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const { accessToken, expiresIn } = body.response.data;

  cache = {
    accessToken,
    expiresAt: now + expiresIn * 1000,
  };

  return accessToken;
}
