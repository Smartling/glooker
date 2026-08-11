import { NextRequest, NextResponse } from 'next/server';
import { getDevReport } from '@/lib/report/dev';
import { ReportNotFoundError } from '@/lib/report/service';
import { DeveloperNotFoundError } from '@/lib/report/dev';
import { resolveRequester, buildCostVisibility, stripCostFields, stripModelCost, costCacheHeaders } from '@/lib/cost-visibility';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string; login: string }> }) {
  const { id, login } = await params;
  try {
    const result = await getDevReport(id, login);
    const requester = await resolveRequester(req.headers, result.report.org);
    const { canSeeCost } = await buildCostVisibility(result.report.org, requester);
    if (!canSeeCost(result.developer.github_login)) result.developer = stripCostFields(result.developer);
    result.allDevelopers = result.allDevelopers.map((d: any) => canSeeCost(d.github_login) ? d : stripCostFields(d));
    // Per-model cost/requests follow the same team-scoped rule as cc_total_cost
    // (GLOOK-30); stripModelCost is the single implementation (see its doc
    // comment for why requests is included and why the array is re-sorted
    // when stripped).
    result.models = stripModelCost(result.models ?? [], canSeeCost, result.developer.github_login);
    return NextResponse.json(result, { headers: costCacheHeaders() });
  } catch (err) {
    if (err instanceof ReportNotFoundError) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (err instanceof DeveloperNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
