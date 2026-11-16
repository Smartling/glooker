import db from '@/lib/db';
import { resolveRequester } from '@/lib/cost-visibility';

/**
 * Who may see which team's Contributions: admins (and everyone when auth is off) see every team;
 * any other signed-in developer sees only the teams they are a member of. The developer is matched
 * to a GitHub login through user_mappings (same as cost visibility), case-insensitively.
 */
export type CalendarAccess =
  | { scope: 'all' }
  | { scope: 'own'; teamIds: Set<string> }
  | { scope: 'none'; reason: 'unmapped' | 'no_team' };

export async function resolveCalendarAccess(headers: Headers, org: string): Promise<CalendarAccess> {
  const requester = await resolveRequester(headers, org);
  if (requester.authDisabled || requester.isAdmin) return { scope: 'all' };
  if (!requester.githubLogin) return { scope: 'none', reason: 'unmapped' };

  const [rows] = await db.execute<any>(
    `SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id
     WHERE t.org = ? AND LOWER(tm.github_login) = ?`,
    [org, requester.githubLogin.toLowerCase()],
  );
  if (!rows.length) return { scope: 'none', reason: 'no_team' };
  return { scope: 'own', teamIds: new Set(rows.map((r: any) => String(r.team_id))) };
}

export function canSeeTeam(access: CalendarAccess, teamId: string): boolean {
  return access.scope === 'all' || (access.scope === 'own' && access.teamIds.has(teamId));
}
