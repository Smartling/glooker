import { NextResponse } from 'next/server';
import { extractUser, isAuthEnabled } from '@/lib/auth';

/**
 * Validation for the caller-supplied `org` parameter.
 *
 * `org` arrives as free text on ~14 routes (query string or JSON body) and was
 * never checked against anything. Two consequences:
 *
 *  1. /api/developers?org=X&source=github and
 *     POST /api/settings/github/test-connection turn the server's org-wide
 *     GitHub PAT into a read primitive against an attacker-chosen
 *     organisation.
 *  2. Every org-scoped read (teams, projects, user-mappings, epics, chat
 *     tools, MCP) serves whichever org the caller names. With a single org in
 *     the database that is harmless; with two it is a cross-tenant read, and
 *     the schema is built for several (`reports.org`, `teams.org`,
 *     `user_mappings(org, github_login)`).
 *
 * ALLOWED_ORGS is the deployment's answer: a comma-separated allowlist of the
 * orgs this instance manages. Validation is case-insensitive because GitHub org
 * names are.
 *
 * User-to-org authorization is enforced via `requireUserOrg`, which checks the
 * authenticated user's JWT groups claim against the requested organization using
 * the AUTH_USER_ORG_CLAIM pattern. This prevents cross-tenant reads in
 * multi-organization deployments.
 */

export class OrgNotAllowedError extends Error {
  constructor(org: string) {
    // Note: does not echo the rejected value, so this message is safe to return.
    super('Unknown or disallowed org');
    this.name = 'OrgNotAllowedError';
    void org;
  }
}

let cached: { raw: string; set: Set<string> } | null = null;

/** Configured allowlist, lowercased. Empty set means "not configured". */
export function allowedOrgs(): Set<string> {
  const raw = process.env.ALLOWED_ORGS ?? '';
  if (!cached || cached.raw !== raw) {
    cached = {
      raw,
      set: new Set(
        raw.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean),
      ),
    };
  }
  return cached.set;
}

/** Test seam. */
export function _clearOrgCache(): void {
  cached = null;
}

/**
 * True when `org` may be used. An unconfigured ALLOWED_ORGS permits anything,
 * preserving existing single-org deployments — env-validation.ts warns about
 * that state rather than this silently hard-failing an upgrade.
 */
export function isOrgAllowed(org: string): boolean {
  if (typeof org !== 'string' || !org.trim()) return false;
  // Reject anything that is not a plausible GitHub org name regardless of the
  // allowlist: the value reaches GitHub API paths and JQL-adjacent SQL.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(org.trim())) return false;

  const allowed = allowedOrgs();
  if (allowed.size === 0) return true;
  return allowed.has(org.trim().toLowerCase());
}

/**
 * Route helper. Returns a discriminated result so `org` narrows to `string`
 * for everything downstream:
 *
 *   const orgCheck = requireAllowedOrg(req.nextUrl.searchParams.get('org'));
 *   if (!orgCheck.ok) return orgCheck.res;
 *   const org = orgCheck.org;
 *
 * Rejection is 404, not 403, so the response does not confirm whether a given
 * org exists on this deployment.
 */
export type OrgCheck =
  | { ok: true; org: string }
  | { ok: false; res: NextResponse };

export function requireAllowedOrg(org: string | null | undefined): OrgCheck {
  if (!org) {
    return { ok: false, res: NextResponse.json({ error: 'org is required' }, { status: 400 }) };
  }
  if (!isOrgAllowed(org)) {
    return { ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { ok: true, org: org.trim() };
}

/** Service-layer variant for non-route callers (chat tools, MCP handlers). */
export function assertAllowedOrg(org: string): string {
  if (!isOrgAllowed(org)) throw new OrgNotAllowedError(org);
  return org.trim();
}

/**
 * Check whether the authenticated user is authorized to access the requested org.
 *
 * Uses AUTH_USER_ORG_CLAIM to determine the pattern for org membership in JWT
 * groups. Supports two patterns:
 *
 *   1. Prefix pattern: AUTH_USER_ORG_CLAIM=org- means groups like "org-acme"
 *      grant access to org "acme"
 *   2. Exact match: AUTH_USER_ORG_CLAIM=<orgname> means the group must exactly
 *      match the org name
 *
 * When AUTH_USER_ORG_CLAIM is unset, user-to-org authorization is skipped
 * (preserves single-org deployments). When auth is disabled, this check is
 * skipped. Admins (AUTH_ADMIN_GROUP members) bypass this check.
 *
 * Returns a discriminated result for route handlers:
 *   - { ok: true } when authorized
 *   - { ok: false, res: NextResponse } when denied (404 to avoid org enumeration)
 */
export type UserOrgCheck =
  | { ok: true }
  | { ok: false; res: NextResponse };

export async function requireUserOrg(
  headers: Headers,
  org: string,
): Promise<UserOrgCheck> {
  // Skip check when auth is disabled
  if (!isAuthEnabled()) return { ok: true };

  // Skip check when AUTH_USER_ORG_CLAIM is not configured
  const orgClaimPattern = process.env.AUTH_USER_ORG_CLAIM?.trim();
  if (!orgClaimPattern) return { ok: true };

  const user = await extractUser(headers);
  if (!user) {
    // User should have been authenticated by the proxy, but if not, deny
    return {
      ok: false,
      res: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  // Admins bypass org authorization
  const adminGroup = process.env.AUTH_ADMIN_GROUP?.trim();
  if (adminGroup && user.groups.includes(adminGroup)) {
    return { ok: true };
  }

  // Check if user has access to the requested org
  const normalizedOrg = org.trim().toLowerCase();
  const hasAccess = user.groups.some((group) => {
    const normalizedGroup = group.toLowerCase();
    
    // Pattern 1: Prefix pattern (e.g., "org-acme" for org "acme")
    if (orgClaimPattern.endsWith('-')) {
      return normalizedGroup === `${orgClaimPattern}${normalizedOrg}`.toLowerCase();
    }
    
    // Pattern 2: Exact match (e.g., group "acme" for org "acme")
    return normalizedGroup === normalizedOrg;
  });

  if (!hasAccess) {
    // 404 rather than 403 to avoid confirming which orgs exist
    return {
      ok: false,
      res: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  return { ok: true };
}
