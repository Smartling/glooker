import { NextRequest, NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { listSyncs } from '@/lib/vulnerabilities/queries';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';
import { notFound } from '../_shared';

// Readable by every signed-in user, the same as Report History (spec decision 16). Do not add requireAdmin.
async function getHandler(req: NextRequest) {
  if (!isVulnerabilitiesEnabled()) return notFound();
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 30);
  return NextResponse.json(await listSyncs(Number.isFinite(limit) ? limit : 30));
}
export const GET = withRequestLog(getHandler);
