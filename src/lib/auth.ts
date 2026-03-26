export interface AuthUser {
  email: string;
  sub: string;
}

export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === 'true';
}

export function extractUser(headers: Headers): AuthUser | null {
  if (!isAuthEnabled()) return null;

  const headerName = process.env.AUTH_HEADER || 'x-amzn-oidc-data';
  const jwt = headers.get(headerName);
  if (!jwt) return null;

  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (!payload.email) return null;
    return { email: payload.email, sub: payload.sub || '' };
  } catch {
    return null;
  }
}
