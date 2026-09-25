import { NextRequest, NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { getSyncProgressView, SyncNotFoundError } from '@/lib/vulnerabilities/queries';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';
import { notFound } from '../../../_shared';

// Readable by every signed-in user, the same as Report History (spec decision 16). Do not add requireAdmin.
async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isVulnerabilitiesEnabled()) return notFound();
  const { id } = await params;
  // Digits only: Number() alone would accept '1e3', ' 12' or '0x1f' as ids.
  const syncId = /^\d{1,15}$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(syncId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  try {
    const progress = await getSyncProgressView(syncId);
    return NextResponse.json(progress);
  } catch (err) {
    if (err instanceof SyncNotFoundError) return notFound();
    throw err;
  }
}
export const GET = withRequestLog(getHandler);
