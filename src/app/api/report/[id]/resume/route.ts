import { NextRequest, NextResponse } from 'next/server';
import { resumeReport, ReportNotFoundError, ReportAlreadyCompletedError } from '@/lib/report/service';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    throw err;
  }
}
