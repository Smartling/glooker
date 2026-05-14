// src/app/api/report/[id]/cc-spend/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { refreshCcSpendForReport } from '@/lib/cc-spend/service';
import { ReportNotFoundError } from '@/lib/cc-spend/apply';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

// Per-report in-flight tracker. Concurrent POSTs to the same report short-circuit
// with 409 Conflict instead of running parallel paginating pulls + parallel
// developer_stats resets. Stored on globalThis so Next.js HMR doesn't drop the
// set on file reload; matches the existing progress-store pattern. Single-replica
// only — multi-replica deployments would need a Redis lock or DB advisory lock.
const G = globalThis as any;
const inFlightReports: Set<string> = (G.__cc_refresh_in_flight ??= new Set<string>());

async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;

  if (inFlightReports.has(id)) {
    return NextResponse.json(
      {
        error: 'in_progress',
        message: 'A CC spend refresh is already running for this report',
      },
      { status: 409 },
    );
  }
  inFlightReports.add(id);
  try {
    const result = await refreshCcSpendForReport(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'not_found', message: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'pull_failed', message }, { status: 500 });
  } finally {
    inFlightReports.delete(id);
  }
}

export const POST = withRequestLog(postHandler);
