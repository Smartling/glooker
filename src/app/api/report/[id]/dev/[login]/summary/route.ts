import { NextRequest, NextResponse } from 'next/server';
import { getDevSummary } from '@/lib/report/summary';
import { ReportNotFoundError } from '@/lib/report/service';
import { DeveloperNotFoundError } from '@/lib/report/dev';
import { withRequestLog } from '@/lib/logger';
import { internalError } from '@/lib/api-error';

async function getHandler(_req: NextRequest, { params }: { params: Promise<{ id: string; login: string }> }) {
  const { id, login } = await params;
  try {
    return NextResponse.json(await getDevSummary(id, login));
  } catch (err) {
    if (err instanceof ReportNotFoundError) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (err instanceof DeveloperNotFoundError) return NextResponse.json({ error: 'Developer not found' }, { status: 404 });
    return internalError('dev-summary', err);
  }
}

export const GET = withRequestLog(getHandler);
