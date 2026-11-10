import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { checkCanonical } from '@/lib/canonical/rebuild';

async function getHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ orgs: await checkCanonical() });
}

export const GET = withRequestLog(getHandler);
