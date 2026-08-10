import db from '@/lib/db';
import { extractUser, isAuthEnabled } from '@/lib/auth';

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
type CcField = typeof CC_FIELDS[number];

/** Cost-bearing developer row shape (fields optional so any caller row satisfies it). */
interface CostBearing {
  cc_total_cost?: number | null;
  cc_requests?: number | null;
}

/**
 * Resolve who is asking, from request headers. Identity only — team membership
 * is org-scoped and resolved in buildCostVisibility. When auth is disabled the
 * caller is treated as omniscient (matches isAdmin() returning true then).
 *
 * `org` scopes the user_mappings lookup. That table is uniquely keyed on
 * (org, github_login) and the visibility rule is org-scoped, so resolving the
 * login within the same org keeps a multi-org install deterministic. Callers
 * without an org context (e.g. /api/auth/me) may omit it; the fallback query is
 * made deterministic with an explicit ORDER BY.
 */
export async function resolveRequester(headers: Headers, org?: string): Promise<Requester> {
  if (!isAuthEnabled()) return { githubLogin: null, isAdmin: false, authDisabled: true };

  const user = extractUser(headers);
  if (!user) return { githubLogin: null, isAdmin: false, authDisabled: false };

  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  const isAdmin = !!adminGroup && user.groups.includes(adminGroup);

  const [rows] = (org
    ? await db.execute(
        `SELECT github_login FROM user_mappings WHERE jira_email = ? AND org = ? LIMIT 1`,
        [user.email, org],
      )
    : await db.execute(
        `SELECT github_login FROM user_mappings WHERE jira_email = ? ORDER BY github_login LIMIT 1`,
        [user.email],
      )) as [any[], any];

  return { githubLogin: rows[0]?.github_login ?? null, isAdmin, authDisabled: false };
}

/**
 * Per-developer cost predicate for a requester within an org. Cost is visible
 * when auth is disabled, the requester is an admin, the developer IS the
 * requester (own cost is always visible), or the requester shares at least one
 * team with the developer. One flat query builds the login→teamIds map.
 *
 * Logins are compared case-insensitively: GitHub logins are case-insensitive
 * and the three source columns (team roster, user_mappings, developer_stats)
 * are populated by different mechanisms (admin entry, Jira auto-discovery,
 * GitHub API), so exact-case matching produces silent no-visibility bugs.
 */
export async function buildCostVisibility(org: string, requester: Requester): Promise<CostVisibility> {
  if (requester.authDisabled || requester.isAdmin) {
    return { canSeeCost: () => true, canSeeAnyCost: true };
  }
  if (!requester.githubLogin) {
    return { canSeeCost: () => false, canSeeAnyCost: false };
  }

  // One flat query (was 1 + N-per-team via listTeams) — this runs on the hot
  // read paths for exactly the non-admin population the feature serves.
  const [rows] = await db.execute(
    `SELECT tm.github_login AS github_login, tm.team_id AS team_id
     FROM team_members tm JOIN teams t ON t.id = tm.team_id
     WHERE t.org = ?`,
    [org],
  ) as [Array<{ github_login: string; team_id: string }>, any];

  const loginToTeamIds = new Map<string, string[]>();
  for (const row of rows) {
    const login = row.github_login.toLowerCase();
    const arr = loginToTeamIds.get(login) ?? [];
    arr.push(row.team_id);
    loginToTeamIds.set(login, arr);
  }

  const requesterLogin = requester.githubLogin.toLowerCase();
  const requesterTeams = new Set(loginToTeamIds.get(requesterLogin) ?? []);
  // A mapped requester can always see their own cost, even when on no team.
  const canSeeAnyCost = true;
  const canSeeCost = (devLogin: string): boolean => {
    const dev = devLogin.toLowerCase();
    if (dev === requesterLogin) return true;
    const devTeams = loginToTeamIds.get(dev) ?? [];
    return devTeams.some((t) => requesterTeams.has(t));
  };

  return { canSeeCost, canSeeAnyCost };
}

/** Drop cc_total_cost / cc_requests from a single developer-shaped object. */
export function stripCostFields<T extends CostBearing>(
  obj: T,
): Omit<T, CcField> & Partial<Pick<T, CcField>> {
  const copy: any = { ...obj };
  for (const f of CC_FIELDS) delete copy[f];
  return copy;
}

/** Drop cc fields from developers the requester cannot see. */
export function stripDevCost<T extends { github_login: string } & CostBearing>(
  devs: T[],
  canSeeCost: (login: string) => boolean,
): Array<Omit<T, CcField> & Partial<Pick<T, CcField>>> {
  return devs.map((d) => (canSeeCost(d.github_login) ? d : stripCostFields(d)));
}

/**
 * Per-model cost fields. `requests` is included deliberately: summing
 * models[].requests across a developer's array reconstructs the gated
 * cc_requests value exactly (same user_cost_report window, merely grouped by
 * model), so leaving it in would let a non-privileged viewer recover a stripped
 * field by arithmetic.
 */
const MODEL_COST_FIELDS = ['cost', 'requests'] as const;
type ModelCostField = typeof MODEL_COST_FIELDS[number];

interface ModelBearing {
  model: string;
  cost?: number | null;
  requests?: number | null;
}

/**
 * Drop per-model cost fields unless the requester may see this developer's cost.
 * When stripped, the array is re-sorted by model name: callers order it by cost
 * for privileged viewers, and that order would otherwise leak a relative-cost
 * ranking to someone not allowed to see the amounts.
 */
export function stripModelCost<T extends ModelBearing>(
  models: T[],
  canSeeCost: (devLogin: string) => boolean,
  devLogin: string,
): Array<Omit<T, ModelCostField> & Partial<Pick<T, ModelCostField>>> {
  if (canSeeCost(devLogin)) return models;
  return models
    .map((m) => {
      const copy: any = { ...m };
      for (const f of MODEL_COST_FIELDS) delete copy[f];
      return copy;
    })
    .sort((a: any, b: any) => String(a.model).localeCompare(String(b.model)));
}

/**
 * Response headers for any endpoint that varies its body by requester identity.
 * These routes now serve one cost variant per team at a single URL, so a shared
 * cache keyed on URL alone could serve an over-privileged body to the next
 * caller. `no-store` + Vary on the identity header prevents that.
 */
export function costCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    Vary: process.env.AUTH_HEADER || 'x-amzn-oidc-data',
  };
}
