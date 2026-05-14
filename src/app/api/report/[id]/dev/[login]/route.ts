import { NextRequest, NextResponse } from 'next/server';
import { getDevReport } from '@/lib/report/dev';
import { ReportNotFoundError } from '@/lib/report/service';
import { DeveloperNotFoundError } from '@/lib/report/dev';
import { isAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

const CC_FIELDS = ['cc_total_cost', 'cc_requests'] as const;

function stripCc<T extends Record<string, any>>(obj: T): T {
  const copy: any = { ...obj };
  for (const f of CC_FIELDS) delete copy[f];
  return copy;
}

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string; login: string }> }) {
  const { id, login } = await params;
  try {
    const result = await getDevReport(id, login);
    if (!isAdmin(req)) {
      result.developer = stripCc(result.developer);
      result.allDevelopers = result.allDevelopers.map(stripCc);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReportNotFoundError) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (err instanceof DeveloperNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
