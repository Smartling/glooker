import { NextRequest, NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { requireAdmin, extractUser } from '@/lib/auth';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';
import { startSync } from '@/lib/vulnerabilities/scheduler';
import { notFound } from '../_shared';

async function postHandler(req: NextRequest) {
  if (!isVulnerabilitiesEnabled()) return notFound();
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const r = await startSync('manual', extractUser(req.headers)?.email ?? null);
  if (r.status === 'already-running') return NextResponse.json({ error: 'A vulnerability sync is already running' }, { status: 409 });
  if (r.status === 'disabled') return notFound();
  return NextResponse.json({ syncId: r.syncId }, { status: 202 });
}
export const POST = withRequestLog(postHandler);
