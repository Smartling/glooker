import { NextResponse } from 'next/server';

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
 * Deliberately NOT attempted here: deciding which orgs a *particular user* may
 * see. That needs a membership model (an OIDC group claim, or an explicit
 * table) and is a product decision, not something to invent in a security fix.
 * What this does give you is that the set of reachable orgs is the configured
 * set rather than "any string on the internet", which is what closes the
 * credentialed-proxy problem outright and bounds the cross-tenant one to orgs
 * the operator already chose to host together.
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
