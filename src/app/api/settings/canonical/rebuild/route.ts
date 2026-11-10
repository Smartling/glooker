import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { RebuildRunningError } from '@/lib/canonical/rebuild';
import { startBackgroundRebuild } from '@/lib/canonical/progress';

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    await startBackgroundRebuild();
  } catch (e) {
    if (e instanceof RebuildRunningError) {
      return NextResponse.json({ error: 'rebuild already running' }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}

export const POST = withRequestLog(postHandler);
