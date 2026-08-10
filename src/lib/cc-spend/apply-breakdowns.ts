import db from '@/lib/db';
import { buildEmailToLoginMap } from './identity';
import type { PerEmailSkills, PerEmailModelCost } from './provider';

export interface BreakdownApplyResult {
  /** Emails resolved to a github_login. */
  matched: number;
  /** No email→github_login mapping found. */
  unmappedEmail: number;
  /** Breakdown rows written. */
  rows: number;
}

/**
 * Both applies delete this report's rows before writing, so a partial pull
 * cannot leave stale values behind, and each runs in its own transaction so a
 * failure here can never roll back a good cost apply.
 */
export async function applySkillsUsage(input: {
  reportId: string; org: string; skills: PerEmailSkills[];
}): Promise<BreakdownApplyResult> {
  const { reportId, org, skills } = input;

  return await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cc_skills_usage WHERE report_id = ?`, [reportId]);
    await tx.execute(`UPDATE developer_stats SET cc_skills_used = 0 WHERE report_id = ?`, [reportId]);

    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);

    let matched = 0;
    let unmappedEmail = 0;
    let rows = 0;
    for (const entry of skills) {
      const login = emailToLogin.get(entry.email.trim().toLowerCase());
      if (!login) { unmappedEmail++; continue; }
      matched++;

      let usedTotal = 0;
      for (const p of entry.products) {
        await tx.execute(
          `INSERT INTO cc_skills_usage (report_id, github_login, product, skills_used, skills_distinct)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, login, p.product, p.used, p.distinct],
        );
        rows++;
        usedTotal += p.used;
      }

      // Rollup is Σ skills_used only; chat reports no total so it adds nothing.
      await tx.execute(
        `UPDATE developer_stats SET cc_skills_used = ? WHERE report_id = ? AND github_login = ?`,
        [usedTotal, reportId, login],
      );
    }

    return { matched, unmappedEmail, rows };
  });
}

export async function applyModelUsage(input: {
  reportId: string; org: string; models: PerEmailModelCost[];
}): Promise<BreakdownApplyResult> {
  const { reportId, org, models } = input;

  return await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cc_model_usage WHERE report_id = ?`, [reportId]);

    const emailToLogin = await buildEmailToLoginMap(tx, reportId, org);

    let matched = 0;
    let unmappedEmail = 0;
    let rows = 0;
    for (const entry of models) {
      const login = emailToLogin.get(entry.email.trim().toLowerCase());
      if (!login) { unmappedEmail++; continue; }
      matched++;
      for (const m of entry.models) {
        await tx.execute(
          `INSERT INTO cc_model_usage (report_id, github_login, model, cost, requests)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, login, m.model, m.costCents, m.requests],
        );
        rows++;
      }
    }

    return { matched, unmappedEmail, rows };
  });
}
