import { NextRequest, NextResponse } from 'next/server';
import { getDevReport } from '@/lib/report/dev';
import { ReportNotFoundError } from '@/lib/report/service';
import { DeveloperNotFoundError } from '@/lib/report/dev';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; login: string }> }) {
  const { id, login } = await params;
  try {
    return NextResponse.json(await getDevReport(id, login));
  } catch (err) {
    if (err instanceof ReportNotFoundError) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (err instanceof DeveloperNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
