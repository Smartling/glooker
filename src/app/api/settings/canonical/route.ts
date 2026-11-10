import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { listCanonicalBuilds, listCanonicalOrgs } from '@/lib/canonical/state';
import { getRebuildLock } from '@/lib/canonical/rebuild';
import { getRebuildProgress } from '@/lib/canonical/progress';

async function getHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const [builds, lock, orgs] = await Promise.all([listCanonicalBuilds(), getRebuildLock(), listCanonicalOrgs()]);
  return NextResponse.json({ builds, orgs, lock, progress: getRebuildProgress() });
}

export const GET = withRequestLog(getHandler);
