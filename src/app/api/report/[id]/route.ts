import { NextRequest, NextResponse } from 'next/server';
import { getReport, deleteReport, ReportNotFoundError } from '@/lib/report/service';
import { requireAdmin } from '@/lib/auth';
import { resolveRequester, buildCostVisibility, stripDevCost } from '@/lib/cost-visibility';
import { withRequestLog } from '@/lib/logger';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const result = await getReport(id);
    const requester = await resolveRequester(req.headers);
    const { canSeeCost } = await buildCostVisibility(result.report.org, requester);
    result.developers = stripDevCost(result.developers, canSeeCost);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;

  try {
    await deleteReport(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
export const DELETE = withRequestLog(deleteHandler);
