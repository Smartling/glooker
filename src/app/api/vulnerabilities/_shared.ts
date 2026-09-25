// Not a route file: the leading underscore keeps Next.js from routing it.
import { NextRequest, NextResponse } from 'next/server';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';
import { parseVulnFilters, type ParsedFilters } from '@/lib/vulnerabilities/filters';

export function notFound() {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function withFilters(req: NextRequest, run: (f: ParsedFilters) => Promise<any>): Promise<NextResponse> {
  if (!isVulnerabilitiesEnabled()) return notFound();
  const parsed = parseVulnFilters(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = await run(parsed.value);
  if (body && typeof body === 'object' && 'error' in body) return NextResponse.json(body, { status: 400 });
  return NextResponse.json(body);
}
