import type { DB } from '../db/index';
import type { AlertFact, RepoFact } from './types';

export const bool = (v: boolean): 0 | 1 => (v ? 1 : 0);

/**
 * The one resolution-timestamp rule (GLOOK-43): fixed_at wins, then dismissed_at, then
 * auto_dismissed_at. sync.ts's snapshot aggregate uses this SQL fragment directly; rowToAlertFact
 * below mirrors the same precedence in TypeScript so a stored row and its derived AlertFact can
 * never disagree about when (or whether) an alert resolved.
 */
export const RESOLVED_AT_SQL = 'COALESCE(fixed_at, dismissed_at, auto_dismissed_at)';

/**
 * Multi-row INSERT … ON DUPLICATE KEY UPDATE. The SQLite translation takes its conflict target from
 * translateSQL's conflictCols map, which has entries for vulnerability_repos and vulnerability_alerts.
 * batchSize × cols stays well under SQLite's bound-parameter limit.
 */
export async function upsertRows(
  tx: DB, table: string, cols: string[], updateCols: string[], rows: unknown[][], batchSize = 200,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const tuple = `(${cols.map(() => '?').join(', ')})`;
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')} `
      + `ON DUPLICATE KEY UPDATE ${updateCols.map(c => `${c} = VALUES(${c})`).join(', ')}`;
    await tx.execute(sql, chunk.flat());
  }
}

export async function insertRows(tx: DB, table: string, cols: string[], rows: unknown[][], batchSize = 200): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const tuple = `(${cols.map(() => '?').join(', ')})`;
    await tx.execute(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')}`, chunk.flat());
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function rowToAlertFact(r: any): AlertFact {
  return {
    repoId: Number(r.repo_id), number: Number(r.number), htmlUrl: r.html_url,
    state: r.state, severity: r.severity, severityChangedAt: r.severity_changed_at ?? null,
    ghsaId: r.ghsa_id ?? null, cveId: r.cve_id ?? null, summary: r.summary ?? null,
    cvssScore: num(r.cvss_score), epssPercentage: num(r.epss_percentage),
    withdrawn: r.advisory_withdrawn_at != null,
    packageName: r.package_name ?? null, ecosystem: r.ecosystem ?? null, manifestPath: r.manifest_path ?? null,
    relationship: r.relationship ?? null, scope: r.scope ?? null,
    createdAt: r.created_at,
    // TypeScript mirror of RESOLVED_AT_SQL above (fixed_at > dismissed_at > auto_dismissed_at) — keep the two in sync.
    resolvedAt: r.state === 'open' ? null : (r.fixed_at ?? r.dismissed_at ?? r.auto_dismissed_at ?? null),
    dismissedReason: r.dismissed_reason ?? null,
    reopenedCount: Number(r.reopened_count ?? 0), lastReopenedAt: r.last_reopened_at ?? null,
    missing: r.missing_since != null,
  };
}

export function rowToRepoFact(r: any): RepoFact {
  return {
    repoId: Number(r.repo_id), fullName: r.full_name, team: r.team ?? null,
    serviceTier: r.service_tier ?? null, codebaseType: r.codebase_type ?? null,
    archived: Number(r.archived) === 1, dependabotStatus: r.dependabot_status,
    dependabotStatusDetail: r.dependabot_status_detail ?? null,
    // Not derivable from this row alone (it needs a join against
    // vulnerability_repo_snapshots) — queries.ts's loadRepos overlays the real value; this is
    // just the default for a repo that doesn't qualify.
    carriedResolvedCritical: 0,
  };
}
