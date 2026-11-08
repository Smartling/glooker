import db from '@/lib/db';
import { analyzeCommit, type CommitAnalysis } from '@/lib/analyzer';
import type { CommitData } from '@/lib/github';

/**
 * The stored LLM verdict for a commit already analysed in an earlier completed
 * report of this org, or null. Only the five LLM-derived fields are returned;
 * AI co-author trailers, lines and PR fields always come from the current fetch.
 */
export async function findReusableAnalysis(org: string, sha: string): Promise<CommitAnalysis | null> {
  const [rows] = await db.execute<any>(
    `SELECT complexity, type, impact_summary, risk_level, maybe_ai
     FROM commit_canonical WHERE org = ? AND commit_sha = ? AND complexity IS NOT NULL`,
    [org, sha],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    sha,
    complexity: Number(r.complexity),
    type: r.type,
    impactSummary: r.impact_summary ?? '',
    riskLevel: r.risk_level,
    maybeAi: Number(r.maybe_ai) === 1,
  };
}

export async function analyzeWithReuse(
  org: string,
  commit: CommitData,
  reuseEnabled: boolean,
): Promise<{ analysis: CommitAnalysis; reused: boolean }> {
  if (reuseEnabled) {
    // Best-effort: a failed lookup falls back to a fresh analysis rather than failing the commit.
    const found = await findReusableAnalysis(org, commit.sha).catch((e) => {
      console.warn(`[canonical] reuse lookup failed for ${commit.sha}: ${e?.message ?? e}`);
      return null;
    });
    if (found) return { analysis: found, reused: true };
  }
  return { analysis: await analyzeCommit(commit), reused: false };
}
