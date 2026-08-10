import { NextRequest, NextResponse } from 'next/server';
import { getOrgReport } from '@/lib/report/org';
import { ReportNotFoundError } from '@/lib/report/service';
import { resolveRequester, buildCostVisibility, stripDevCost, stripModelCost, costCacheHeaders } from '@/lib/cost-visibility';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await getOrgReport(id);
    const requester = await resolveRequester(req.headers, result.report.org);
    const { canSeeCost, canSeeAnyCost } = await buildCostVisibility(result.report.org, requester);
    result.developers = stripDevCost(result.developers, canSeeCost);
    // Per-model cost/requests are gated per developer. Group by login so
    // stripModelCost's name-reordering applies within each developer's models —
    // the rows arrive ordered by cost, which would otherwise leak a relative
    // ranking for a developer whose amounts are hidden.
    const modelsByLogin = new Map<string, typeof result.modelUsage>();
    for (const row of result.modelUsage ?? []) {
      const arr = modelsByLogin.get(row.github_login) ?? [];
      arr.push(row);
      modelsByLogin.set(row.github_login, arr);
    }
    result.modelUsage = [...modelsByLogin.entries()].flatMap(
      ([login, rows]) => stripModelCost(rows, canSeeCost, login),
    );
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
