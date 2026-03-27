import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Decode OIDC JWTs for debugging
  const decoded: Record<string, unknown> = {};
  for (const name of ['x-amzn-oidc-data', 'x-amzn-oidc-accesstoken']) {
    const jwt = req.headers.get(name);
    if (jwt) {
      try {
        const parts = jwt.split('.');
        if (parts.length >= 2) {
          decoded[`${name}:header`] = JSON.parse(Buffer.from(parts[0], 'base64').toString());
          decoded[`${name}:payload`] = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        }
      } catch (e) {
        decoded[`${name}:error`] = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return NextResponse.json({ headers, decoded, timestamp: new Date().toISOString() });
}
