import { NextRequest, NextResponse } from 'next/server';
import { getOrgReport } from '@/lib/report/org';
import { ReportNotFoundError } from '@/lib/report/service';
import { resolveRequester, buildCostVisibility, stripDevCost, gateModelRowsByLogin, costCacheHeaders } from '@/lib/cost-visibility';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await getOrgReport(id);
    const requester = await resolveRequester(req.headers, result.report.org);
    const { canSeeCost, canSeeAnyCost } = await buildCostVisibility(result.report.org, requester);
    result.developers = stripDevCost(result.developers, canSeeCost);
    // Per-model rows are gated per developer — see stripModelCost's doc comment.
    result.modelUsage = gateModelRowsByLogin(result.modelUsage ?? [], canSeeCost);
    if (!canSeeAnyCost) {
      const { cc_period_start, cc_period_end, ...reportRest } = result.report;
      result.report = reportRest;
      (result as any).spendWindow = null;
    }
    return NextResponse.json(result, { headers: costCacheHeaders() });
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
