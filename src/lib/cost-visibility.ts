import db from '@/lib/db';
import { extractUser, isAuthEnabled } from '@/lib/auth';
import { listTeams } from '@/lib/teams/service';

export interface Requester {
  githubLogin: string | null;
  isAdmin: boolean;
  authDisabled: boolean;
}

export interface CostVisibility {
  canSeeCost: (devLogin: string) => boolean;
  canSeeAnyCost: boolean;
}

const CC_FIELDS = ['cc_total_cost', 'cc_requests'] as const;

/**
 * Resolve who is asking, from request headers. Identity only — team membership
 * is org-scoped and resolved in buildCostVisibility. When auth is disabled the
 * caller is treated as omniscient (matches isAdmin() returning true then).
 */
export async function resolveRequester(headers: Headers): Promise<Requester> {
  if (!isAuthEnabled()) return { githubLogin: null, isAdmin: false, authDisabled: true };

  const user = extractUser(headers);
  if (!user) return { githubLogin: null, isAdmin: false, authDisabled: false };

  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  const isAdmin = !!adminGroup && user.groups.includes(adminGroup);

  const [rows] = await db.execute(
    `SELECT github_login FROM user_mappings WHERE jira_email = ? LIMIT 1`,
    [user.email],
  ) as [any[], any];

  return { githubLogin: rows[0]?.github_login ?? null, isAdmin, authDisabled: false };
}

/**
 * Per-developer cost predicate for a requester within an org. Visible when auth
 * is disabled, the requester is an admin, or the requester shares at least one
 * team with the developer. One listTeams(org) call builds a login→teamIds map.
 */
export async function buildCostVisibility(org: string, requester: Requester): Promise<CostVisibility> {
  if (requester.authDisabled || requester.isAdmin) {
    return { canSeeCost: () => true, canSeeAnyCost: true };
  }
  if (!requester.githubLogin) {
    return { canSeeCost: () => false, canSeeAnyCost: false };
  }

  const teams = await listTeams(org) as Array<{ id: string; members: string[] }>;
  const loginToTeamIds = new Map<string, string[]>();
  for (const t of teams) {
    for (const login of t.members) {
      const arr = loginToTeamIds.get(login) ?? [];
      arr.push(t.id);
      loginToTeamIds.set(login, arr);
    }
  }

  const requesterTeams = new Set(loginToTeamIds.get(requester.githubLogin) ?? []);
  const canSeeAnyCost = requesterTeams.size > 0;
  const canSeeCost = (devLogin: string): boolean => {
    if (!canSeeAnyCost) return false;
    const devTeams = loginToTeamIds.get(devLogin) ?? [];
    return devTeams.some((t) => requesterTeams.has(t));
  };

  return { canSeeCost, canSeeAnyCost };
}

/** Drop cc_total_cost / cc_requests from developers the requester cannot see. */
export function stripDevCost<T extends { github_login: string }>(
  devs: T[],
  canSeeCost: (login: string) => boolean,
): T[] {
  return devs.map((d) => {
    if (canSeeCost(d.github_login)) return d;
    const copy: any = { ...d };
    for (const f of CC_FIELDS) delete copy[f];
    return copy;
  });
}
