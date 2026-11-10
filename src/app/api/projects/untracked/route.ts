import { NextRequest, NextResponse } from 'next/server';
import { getUntrackedWork } from '@/lib/projects/untracked';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg, requireOrgMembership } from '@/lib/orgs/guard';
import { internalError } from '@/lib/api-error';

async function getHandler(req: NextRequest) {
  const orgParam = req.nextUrl.searchParams.get('org');
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true';

  const orgCheck = requireAllowedOrg(orgParam);
  if (!orgCheck.ok) return orgCheck.res;
  const org = orgCheck.org;

  const membershipDenied = await requireOrgMembership(req.headers, org);
  if (membershipDenied) return membershipDenied;

  try {
    const result = await getUntrackedWork(org, refresh);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[untracked] Error:', err);
    return internalError('untracked', err);
  }
}

export const GET = withRequestLog(getHandler);
