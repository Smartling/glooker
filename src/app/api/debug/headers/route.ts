import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // Truncate long values (JWTs) to keep output readable
    headers[key] = value.length > 200 ? value.slice(0, 200) + '...' : value;
  });

  return NextResponse.json({ headers, timestamp: new Date().toISOString() });
}
