import db from '@/lib/db';
import { analyzeCommit, type CommitAnalysis } from '@/lib/analyzer';
import type { CommitData } from '@/lib/github';
import { chunks } from './pick';

/**
 * The stored LLM verdict for a commit already analysed in an earlier completed
 * report of this org, or null. Only the five LLM-derived fields are returned;
 * AI co-author trailers, lines and PR fields always come from the current fetch.
 */
export async function findReusableAnalysis(org: string, sha: string): Promise<CommitAnalysis | null> {
  return (await findReusableAnalyses(org, [sha])).get(sha) ?? null;
}

function toAnalysis(r: any): CommitAnalysis {
  return {
    sha: String(r.commit_sha),
    complexity: Number(r.complexity),
    type: r.type,
    impactSummary: r.impact_summary ?? '',
    riskLevel: r.risk_level,
    maybeAi: Number(r.maybe_ai) === 1,
  };
}

/** Batched findReusableAnalysis: one query per CANONICAL_BATCH shas instead of one per commit. */
export async function findReusableAnalyses(org: string, shas: string[]): Promise<Map<string, CommitAnalysis>> {
  const out = new Map<string, CommitAnalysis>();
  for (const batch of chunks(shas)) {
    const [rows] = await db.execute<any>(
      `SELECT commit_sha, complexity, type, impact_summary, risk_level, maybe_ai
       FROM commit_canonical
       WHERE org = ? AND commit_sha IN (${batch.map(() => '?').join(',')}) AND complexity IS NOT NULL`,
      [org, ...batch],
    );
    for (const r of rows) out.set(String(r.commit_sha), toAnalysis(r));
  }
  return out;
}

export async function analyzeWithReuse(
  org: string,
  commit: CommitData,
  reuseEnabled: boolean,
  prefetched?: Map<string, CommitAnalysis>,
): Promise<{ analysis: CommitAnalysis; reused: boolean }> {
  if (reuseEnabled && prefetched) {
    const found = prefetched.get(commit.sha);
    if (found) return { analysis: found, reused: true };
  } else if (reuseEnabled) {
    // Best-effort: a failed lookup falls back to a fresh analysis rather than failing the commit.
    const found = await findReusableAnalysis(org, commit.sha).catch((e) => {
      console.warn(`[canonical] reuse lookup failed for ${commit.sha}: ${e?.message ?? e}`);
      return null;
    });
    if (found) return { analysis: found, reused: true };
  }
  return { analysis: await analyzeCommit(commit), reused: false };
}
