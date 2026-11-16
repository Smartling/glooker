import { NextRequest, NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';
import { listTeams } from '@/lib/teams/service';
import { resolveCalendarAccess, canSeeTeam } from '@/lib/activity-calendar/access';

/** The teams the caller may open on the Contributions page: all for admins, their own otherwise. */
async function getHandler(req: NextRequest) {
  const orgCheck = requireAllowedOrg(req.nextUrl.searchParams.get('org'));
  if (!orgCheck.ok) return orgCheck.res;

  const access = await resolveCalendarAccess(req.headers, orgCheck.org);
  if (access.scope === 'none') return NextResponse.json({ scope: 'none', reason: access.reason, teams: [] });
  const teams = (await listTeams(orgCheck.org))
    .filter((t: any) => canSeeTeam(access, t.id))
    .map((t: any) => ({ id: t.id, name: t.name, color: t.color }));
  return NextResponse.json({ scope: access.scope, teams });
}

export const GET = withRequestLog(getHandler);
