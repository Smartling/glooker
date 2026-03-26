import { NextResponse } from 'next/server';

export interface AuthUser {
  email: string;
  sub: string;
  name: string | null;
  groups: string[];
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
    return {
      email: payload.email,
      sub: payload.sub || '',
      name: payload.name || null,
      groups: Array.isArray(payload.groups) ? payload.groups : [],
    };
  } catch {
    return null;
  }
}

export async function requireAdmin(req: Request): Promise<NextResponse | null> {
  if (!isAuthEnabled()) return null;

  const user = extractUser(req.headers);
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  if (!adminGroup) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (user.groups.includes(adminGroup)) {
    return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
