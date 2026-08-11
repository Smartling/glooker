import db from '@/lib/db';
import { buildEmailToLoginMap } from './identity';
import type { PerEmailSkills, PerEmailModelCost } from './provider';

/**
 * Lowercased set of logins with a developer_stats row for this report — the
 * same population org.ts's getOrgReport INNER JOINs against (LOWER() on both
 * sides there too; see its doc comment). Used only to count noDevStatsRow
 * below; it isn't a gate, since these tables are intentionally written for
 * every login buildEmailToLoginMap can resolve, developer_stats row or not.
 */
async function getDevStatsLogins(
  tx: { execute: (sql: string, params?: any[]) => Promise<any> },
  reportId: string,
): Promise<Set<string>> {
  const [rows] = await tx.execute(
    `SELECT LOWER(github_login) AS login FROM developer_stats WHERE report_id = ?`,
    [reportId],
  ) as [Array<{ login: string }>, any];
  return new Set(rows.map((r) => r.login));
}

export interface BreakdownApplyResult {
  /**
   * Input emails resolved to a github_login — NOT distinct logins. A
   * developer with two commit emails that both resolve to the same login
   * (via `buildEmailToLoginMap`) is counted twice here, even though their
   * rows are merged into one set of per-login writes below.
   */
  matched: number;
  /** No email→github_login mapping found. */
  unmappedEmail: number;
  /** Breakdown rows written (one per distinct login+product / login+model, after merging). */
  rows: number;
  /**
   * Of the rows above, how many belong to a login with no developer_stats row
   * for this report. buildEmailToLoginMap's user_mappings fallback can resolve
   * a login that never appears in this report's developer_stats (a login known
   * from a *different* report or from Jira auto-discovery alone) — org.ts's
   * getOrgReport INNER JOINs this table against developer_stats, so those rows
   * are written here but never rendered in the Spend tab. Without this
   * counter, "N matched, M rows" silently overstates what the panel can show.
   */
  noDevStatsRow: number;
}

/**
 * Both applies delete this report's rows before writing, so a partial pull
 * cannot leave stale values behind, and each runs in its own transaction so a
 * failure here can never roll back a good cost apply.
 *
 * `buildEmailToLoginMap` can resolve more than one input email to the same
 * github_login (a developer with two commit emails, or duplicate entries in
 * the input array). Both applies therefore aggregate by resolved login
 * BEFORE writing anything: an absolute `UPDATE ... SET cc_skills_used = ?`
 * would let a later email silently clobber an earlier one's rollup, and a
 * raw per-entry INSERT into a `UNIQUE (report_id, github_login, product)` /
 * `(..., model)` table would throw on the second collision and roll back the
 * whole apply. Merging first makes both failure modes structurally
 * impossible instead of caught.
 */
export async function applySkillsUsage(input: {
  reportId: string; org: string; skills: PerEmailSkills[];
}): Promise<BreakdownApplyResult> {
  const { reportId, org, skills } = input;

  return await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cc_skills_usage WHERE report_id = ?`, [reportId]);
    await tx.execute(`UPDATE developer_stats SET cc_skills_used = 0 WHERE report_id = ?`, [reportId]);

    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);
    const devStatsLogins = await getDevStatsLogins(tx, reportId);

    let matched = 0;
    let unmappedEmail = 0;

    // Merge per (login, product) across all input entries before writing.
    const merged = new Map<string, Map<string, { used: number; distinct: number }>>();
    for (const entry of skills) {
      const login = emailToLogin.get(entry.email.trim().toLowerCase());
      if (!login) { unmappedEmail++; continue; }
      matched++;

      let products = merged.get(login);
      if (!products) { products = new Map(); merged.set(login, products); }
      for (const p of entry.products) {
        const existing = products.get(p.product);
        if (existing) {
          existing.used += p.used;
          existing.distinct += p.distinct;
        } else {
          products.set(p.product, { used: p.used, distinct: p.distinct });
        }
      }
    }

    let rows = 0;
    let noDevStatsRow = 0;
    for (const [login, products] of merged) {
      const hasDevStatsRow = devStatsLogins.has(login.toLowerCase());
      let usedTotal = 0;
      for (const [product, agg] of products) {
        await tx.execute(
          `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, login, product, agg.used, agg.distinct],
        );
        rows++;
        if (!hasDevStatsRow) noDevStatsRow++;
        usedTotal += agg.used;
      }

      // Rollup is Σ skills_used only; chat reports no total so it adds nothing.
      // Affects nothing when !hasDevStatsRow — there's no row to update.
      await tx.execute(
        `UPDATE developer_stats SET cc_skills_used = ? WHERE report_id = ? AND github_login = ?`,
        [usedTotal, reportId, login],
      );
    }

    return { matched, unmappedEmail, rows, noDevStatsRow };
  });
}

export async function applyModelUsage(input: {
  reportId: string; org: string; models: PerEmailModelCost[];
}): Promise<BreakdownApplyResult> {
  const { reportId, org, models } = input;

  return await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cc_model_usage WHERE report_id = ?`, [reportId]);

    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);
    const devStatsLogins = await getDevStatsLogins(tx, reportId);

    let matched = 0;
    let unmappedEmail = 0;

    // Merge per (login, model) across all input entries before writing — see
    // applySkillsUsage's doc comment for why.
    const merged = new Map<string, Map<string, { costCents: number; requests: number }>>();
    for (const entry of models) {
      const login = emailToLogin.get(entry.email.trim().toLowerCase());
      if (!login) { unmappedEmail++; continue; }
      matched++;

      let modelMap = merged.get(login);
      if (!modelMap) { modelMap = new Map(); merged.set(login, modelMap); }
      for (const m of entry.models) {
        const existing = modelMap.get(m.model);
        if (existing) {
          existing.costCents += m.costCents;
          existing.requests += m.requests;
        } else {
          modelMap.set(m.model, { costCents: m.costCents, requests: m.requests });
        }
      }
    }

    let rows = 0;
    let noDevStatsRow = 0;
    for (const [login, modelMap] of merged) {
      const hasDevStatsRow = devStatsLogins.has(login.toLowerCase());
      for (const [model, agg] of modelMap) {
        await tx.execute(
          `INSERT INTO cc_model_usage (report_id, github_login, model, cost, requests)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, login, model, agg.costCents, agg.requests],
        );
        rows++;
        if (!hasDevStatsRow) noDevStatsRow++;
      }
    }

    return { matched, unmappedEmail, rows, noDevStatsRow };
  });
}
