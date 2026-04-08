import { NextRequest, NextResponse } from 'next/server';
import { getReportProgress, ReportNotFoundError } from '@/lib/report/service';
import { withRequestLog } from '@/lib/logger';

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const progress = await getReportProgress(id);
    return NextResponse.json(progress);
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
