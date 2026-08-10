import { NextRequest, NextResponse } from 'next/server';
import { getDevReport } from '@/lib/report/dev';
import { ReportNotFoundError } from '@/lib/report/service';
import { DeveloperNotFoundError } from '@/lib/report/dev';
import { resolveRequester, buildCostVisibility, stripCostFields, costCacheHeaders } from '@/lib/cost-visibility';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string; login: string }> }) {
  const { id, login } = await params;
  try {
    const result = await getDevReport(id, login);
    const requester = await resolveRequester(req.headers, result.report.org);
    const { canSeeCost } = await buildCostVisibility(result.report.org, requester);
    if (!canSeeCost(result.developer.github_login)) result.developer = stripCostFields(result.developer);
    result.allDevelopers = result.allDevelopers.map((d: any) => canSeeCost(d.github_login) ? d : stripCostFields(d));
    // Model identity and request counts are ungated telemetry; per-model cost is
    // money, so it follows the same team-scoped rule as cc_total_cost (GLOOK-30).
    if (!canSeeCost(result.developer.github_login)) {
      result.models = (result.models ?? []).map(({ cost, ...rest }: any) => rest);
    }
    return NextResponse.json(result, { headers: costCacheHeaders() });
  } catch (err) {
    if (err instanceof ReportNotFoundError) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (err instanceof DeveloperNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
