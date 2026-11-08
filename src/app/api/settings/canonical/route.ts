import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { listCanonicalBuilds } from '@/lib/canonical/state';
import { getRebuildLock } from '@/lib/canonical/rebuild';
import { getRebuildProgress } from '@/lib/canonical/progress';

async function getHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const [builds, lock] = await Promise.all([listCanonicalBuilds(), getRebuildLock()]);
  return NextResponse.json({ builds, lock, progress: getRebuildProgress() });
}

export const GET = withRequestLog(getHandler);
