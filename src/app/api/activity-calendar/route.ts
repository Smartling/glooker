import { NextRequest, NextResponse } from 'next/server';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';
import { listTeams } from '@/lib/teams/service';
import { isCanonicalBuilt } from '@/lib/canonical/state';
import { METRICS, getTeamCalendar, type CalendarMetric } from '@/lib/activity-calendar/service';
import { resolveCalendarAccess, canSeeTeam } from '@/lib/activity-calendar/access';

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const orgCheck = requireAllowedOrg(params.get('org'));
  if (!orgCheck.ok) return orgCheck.res;

  const metric = params.get('metric') ?? 'commits';
  if (!(METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ error: `metric must be one of ${METRICS.join(', ')}` }, { status: 400 });
  }
  const teamId = params.get('team') ?? '';
  // Checked before the team lookup, so a non-member can't probe which team ids exist.
  const access = await resolveCalendarAccess(req.headers, orgCheck.org);
  if (!canSeeTeam(access, teamId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const team = (await listTeams(orgCheck.org)).find((t: any) => t.id === teamId);
  if (!team) return NextResponse.json({ error: 'team not found' }, { status: 404 });
  if (!(await isCanonicalBuilt(orgCheck.org))) {
    return NextResponse.json({ error: 'not_built' }, { status: 409 });
  }
  const calendar = await getTeamCalendar(orgCheck.org, team.members ?? [], metric as CalendarMetric);
  return NextResponse.json({ team: { id: team.id, name: team.name, color: team.color }, ...calendar });
}

export const GET = withRequestLog(getHandler);
