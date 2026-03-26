import { NextRequest, NextResponse } from 'next/server';
import { stopReport, ReportNotFoundError, ReportNotRunningError } from '@/lib/report/service';
import { requireAdmin } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;

  try {
    await stopReport(id);
    return NextResponse.json({ stopped: true });
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof ReportNotRunningError) {
      return NextResponse.json({ error: 'Report is not running' }, { status: 400 });
    }
    throw err;
  }
}
