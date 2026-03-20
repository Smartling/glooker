import { NextRequest, NextResponse } from 'next/server';
import { getOrgReport } from '@/lib/report/org';
import { ReportNotFoundError } from '@/lib/report/service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await getOrgReport(id));
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    throw err;
  }
}
