// src/app/api/report/[id]/cc-spend/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import { ReportNotFoundError } from '@/lib/cc-spend/apply';
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
    const result = await refreshCcSpendForReport(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'not_found', message: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'pull_failed', message }, { status: 500 });
  }
}

export const POST = withRequestLog(postHandler);
