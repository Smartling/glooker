import { NextRequest, NextResponse } from 'next/server';
import { getReport, deleteReport, ReportNotFoundError } from '@/lib/report/service';
import { requireAdmin, isAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const result = await getReport(id);
    if (!isAdmin(req)) {
      result.developers = result.developers.map(({ cc_total_cost, cc_input_tokens, cc_output_tokens, cc_sessions, ...rest }: any) => rest);
    }
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
