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
    // Per-model cost is money, so it follows the same team-scoped rule as
    // cc_total_cost (GLOOK-30). Per-model requests must be stripped too: summing
    // models[].requests across the array reconstructs the gated cc_requests
    // value exactly (same user_cost_report window, merely grouped by model), so
    // leaving it in would let a non-privileged viewer recover a stripped field
    // by arithmetic. dev.ts orders this array by cost DESC for privileged
    // viewers; once cost is stripped, re-sort by model name so array order
    // can't leak a relative-cost ranking to someone who isn't allowed to see
    // the amounts.
    if (!canSeeCost(result.developer.github_login)) {
      result.models = (result.models ?? [])
        .map(({ cost, requests, ...rest }: any) => rest)
        .sort((a: any, b: any) => a.model.localeCompare(b.model));
    }
    return NextResponse.json(result, { headers: costCacheHeaders() });
  } catch (err) {
    if (err instanceof ReportNotFoundError) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if (err instanceof DeveloperNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
