import { NextRequest, NextResponse } from 'next/server';
import { getOrgReport } from '@/lib/report/org';
import { ReportNotFoundError } from '@/lib/report/service';
import { isAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await getOrgReport(id);
    if (!isAdmin(req)) {
      result.developers = result.developers.map(({ cc_total_cost, cc_requests, ...rest }: any) => rest);
      const { cc_period_start, cc_period_end, ...reportRest } = result.report;
      result.report = reportRest;
      (result as any).spendWindow = null;
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
