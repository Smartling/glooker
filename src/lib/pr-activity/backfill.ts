import db from '@/lib/db';
import { getGitHubProvider } from '@/lib/github';
import { upsertPrActivity, recordPrCoverage, hasPrCoverage } from './store';

const DAY_MS = 86_400_000;

export interface BackfillResult {
  done: number;
  skipped: number;
  failed: Array<{ login: string; since: string; until: string; error: string }>;
}

/** The last `months` COMPLETE calendar months before `now`'s month, oldest first; `until` is exclusive. */
export function monthSlices(months: number, now: Date): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = months; i >= 1; i--) {
    const start = new Date(Date.UTC(y, m - i, 1));
    const end = new Date(Date.UTC(y, m - i + 1, 1));
    out.push({ since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) });
  }
  return out;
}

/**
 * GLOOK-63: fill pr_activity for an org's developers, month by month, with the same two searches a
 * report runs (author: / reviewed-by:, is:merged, merged:<month>), going through github.ts's
 * rate-limit and retry handling. Idempotent: rows are upserted, and slices already in
 * pr_activity_coverage are skipped, so an interrupted run resumes. A slice whose searches weren't
 * provably complete gets no coverage row, so it is retried next time.
 */
export async function backfillPrs(opts: {
  org: string; months: number; now?: Date; log?: (m: string) => void;
}): Promise<BackfillResult> {
  const { org, months, now = new Date(), log = () => undefined } = opts;
  const slices = monthSlices(months, now);
  const result: BackfillResult = { done: 0, skipped: 0, failed: [] };
  if (slices.length === 0) return result;

  const [loginRows] = await db.execute(
    `SELECT DISTINCT ds.github_login
     FROM developer_stats ds JOIN reports r ON r.id = ds.report_id
     WHERE r.org = ? AND r.created_at >= ?
     ORDER BY ds.github_login`,
    [org, slices[0].since],
  ) as [any[], any];
  const logins: string[] = loginRows.map((r: any) => r.github_login);
  log(`Backfilling ${logins.length} developers x ${slices.length} months for ${org}`);

  const gh = getGitHubProvider();
  for (const login of logins) {
    for (const { since, until } of slices) {
      if (await hasPrCoverage(org, login, since, until)) { result.skipped++; continue; }
      const from = new Date(`${since}T00:00:00Z`);
      const lastDay = new Date(Date.parse(`${until}T00:00:00Z`) - DAY_MS);
      try {
        const authored = await gh.fetchMergedPRs(org, login, from, log, lastDay);
        const reviewed = await gh.countReviewedPRs(org, login, from, log, lastDay);
        await upsertPrActivity(org, login, 'authored', authored.prs);
        await upsertPrActivity(org, login, 'reviewed', reviewed.prs);
        const doubt = authored.unverified ?? reviewed.unverified
          ?? (reviewed.itemsComplete ? undefined : `review rows incomplete (${reviewed.prs.length} of ${reviewed.reviews})`);
        if (doubt) {
          result.failed.push({ login, since, until, error: `not provably complete: ${doubt}` });
          log(`@${login} ${since}: INCOMPLETE - ${doubt}`);
          continue;
        }
        await recordPrCoverage(org, login, since, until, 'backfill');
        result.done++;
        log(`@${login} ${since}: ${authored.prs.length} authored, ${reviewed.prs.length} reviewed`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        result.failed.push({ login, since, until, error });
        log(`@${login} ${since}: FAILED - ${error}`);
      }
    }
  }
  return result;
}
