import { NextRequest, NextResponse } from 'next/server';
import { resumeReport, ReportNotFoundError, ReportAlreadyCompletedError, ReportAlreadyRunningError } from '@/lib/report/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;

  try {
    await resumeReport(id);
    return NextResponse.json({ resumed: true, reportId: id });
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof ReportAlreadyCompletedError) {
      return NextResponse.json({ error: 'Report already completed' }, { status: 400 });
    }
    if (err instanceof ReportAlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export const POST = withRequestLog(postHandler);
