import { NextRequest, NextResponse } from 'next/server';
import { listReports, createReport, ReportAlreadyRunningError } from '@/lib/report/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { org, periodDays, testMode } = await req.json();

  const orgCheck = requireAllowedOrg(org);
  if (!orgCheck.ok) return orgCheck.res;

  if (!periodDays) {
    return NextResponse.json({ error: 'periodDays is required' }, { status: 400 });
  }

  if (![3, 14, 30, 90].includes(Number(periodDays))) {
    return NextResponse.json({ error: 'periodDays must be 3, 14, 30, or 90' }, { status: 400 });
  }

  try {
    const id = await createReport({ org, periodDays: Number(periodDays), testMode: Boolean(testMode) });
    return NextResponse.json({ reportId: id });
  } catch (err) {
    if (err instanceof ReportAlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

async function getHandler() {
  const rows = await listReports();
  return NextResponse.json(rows);
}

export const POST = withRequestLog(postHandler);
export const GET = withRequestLog(getHandler);
