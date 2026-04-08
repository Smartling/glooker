import { NextRequest, NextResponse } from 'next/server';
import { listReports, createReport } from '@/lib/report/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { org, periodDays, testMode } = await req.json();

  if (!org || !periodDays) {
    return NextResponse.json({ error: 'org and periodDays are required' }, { status: 400 });
  }

  if (![3, 14, 30, 90].includes(Number(periodDays))) {
    return NextResponse.json({ error: 'periodDays must be 3, 14, 30, or 90' }, { status: 400 });
  }

  const id = await createReport({ org, periodDays: Number(periodDays), testMode: Boolean(testMode) });
  return NextResponse.json({ reportId: id });
}

async function getHandler() {
  const rows = await listReports();
  return NextResponse.json(rows);
}

export const POST = withRequestLog(postHandler);
export const GET = withRequestLog(getHandler);
