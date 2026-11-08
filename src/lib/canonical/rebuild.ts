import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { recordCanonicalBuild, listCanonicalBuilds } from '@/lib/canonical/state';
import {
  CANONICAL_BATCH, expectedCommitPicks, expectedJiraPicks,
  insertCommitsByIds, insertJiraByIds, refreshCommitKeys, refreshJiraKeys,
} from '@/lib/canonical/pick';

export class RebuildRunningError extends Error {
  constructor() {
    super('rebuild already running');
    this.name = 'RebuildRunningError';
  }
}

export interface CanonicalCheckTable { stored: number; expected: number; differ: number; examples: string[] }
export interface CanonicalOrgCheck { org: string; builtAt: string | null; commits: CanonicalCheckTable; jira: CanonicalCheckTable }
export interface CanonicalRebuildOrgResult {
  org: string; ok: boolean; commitRows: number; jiraRows: number; durationMs: number; error?: string;
}
export interface RebuildOptions {
  onProgress?: (org: string, done: number, total: number) => void | Promise<void>;
  /** Test hook: called after each insert batch inside the org's transaction. */
  onBatch?: (org: string, table: 'commit' | 'jira') => void;
}

const STALE_LOCK_MS = 2 * 60 * 60 * 1000;
const MAX_EXAMPLES = 20;

async function allOrgs(): Promise<string[]> {
  const [rows] = await db.execute<any>(`SELECT DISTINCT org FROM reports WHERE status = 'completed'`);
  const set = new Set<string>(rows.map((r: any) => String(r.org)));
  for (const b of await listCanonicalBuilds()) set.add(b.org);
  return [...set].sort();
}

async function completedIds(org?: string): Promise<Set<string>> {
  const [rows] = org
    ? await db.execute<any>(`SELECT id FROM reports WHERE status = 'completed' AND org = ?`, [org])
    : await db.execute<any>(`SELECT id FROM reports WHERE status = 'completed'`);
  return new Set(rows.map((r: any) => String(r.id)));
}

function compare(stored: Map<string, number>, expected: Map<string, number>): CanonicalCheckTable {
  const diff: string[] = [];
  for (const [k, id] of expected) if (stored.get(k) !== id) diff.push(k);
  for (const k of stored.keys()) if (!expected.has(k)) diff.push(k);
  return { stored: stored.size, expected: expected.size, differ: diff.length, examples: diff.slice(0, MAX_EXAMPLES) };
}

async function storedMap(sql: string, org: string): Promise<Map<string, number>> {
  const [rows] = await db.execute<any>(sql, [org]);
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r.k), Number(r.id));
  return m;
}

/** Read-only comparison of the stored canonical tables against a fresh pick. */
export async function checkCanonical(): Promise<CanonicalOrgCheck[]> {
  const builds = new Map((await listCanonicalBuilds()).map((b) => [b.org, b]));
  const out: CanonicalOrgCheck[] = [];
  for (const org of await allOrgs()) {
    const commits = compare(
      await storedMap('SELECT commit_sha AS k, analysis_id AS id FROM commit_canonical WHERE org = ?', org),
      await expectedCommitPicks(org),
    );
    const jira = compare(
      await storedMap('SELECT issue_key AS k, issue_id AS id FROM jira_canonical WHERE org = ?', org),
      await expectedJiraPicks(org),
    );
    out.push({ org, builtAt: builds.get(org)?.builtAt ?? null, commits, jira });
  }
  return out;
}

export async function getRebuildLock(): Promise<{ startedAt: string; holder: string } | null> {
  const [rows] = await db.execute<any>('SELECT started_at, holder FROM canonical_rebuild_lock WHERE id = 1');
  return rows.length ? { startedAt: String(rows[0].started_at), holder: String(rows[0].holder) } : null;
}

async function tryInsertLock(holder: string, startedAt: string): Promise<boolean> {
  const [r] = await db.execute<any>(
    'INSERT IGNORE INTO canonical_rebuild_lock (id, started_at, holder) VALUES (1, ?, ?)',
    [startedAt, holder],
  );
  return Number((r as any)?.affectedRows) === 1;
}

/** Take the DB lock and snapshot the completed report ids. Breaks a > 2 h old lock once. */
export async function acquireRebuildLock(holder: string): Promise<{ startedAt: string; completedIds: Set<string> }> {
  let startedAt = new Date().toISOString();
  let got = await tryInsertLock(holder, startedAt);
  if (!got) {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
    await db.execute('DELETE FROM canonical_rebuild_lock WHERE id = 1 AND started_at < ?', [staleBefore]);
    startedAt = new Date().toISOString();
    got = await tryInsertLock(holder, startedAt);
  }
  if (!got) throw new RebuildRunningError();
  return { startedAt, completedIds: await completedIds() };
}

export async function releaseRebuildLock(holder: string): Promise<void> {
  await db.execute('DELETE FROM canonical_rebuild_lock WHERE id = 1 AND holder = ?', [holder]);
}

function batches(ids: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += CANONICAL_BATCH) out.push(ids.slice(i, i + CANONICAL_BATCH));
  return out;
}

async function rebuildOrg(org: string, opts: RebuildOptions): Promise<CanonicalRebuildOrgResult> {
  const t0 = Date.now();
  try {
    // Picks outside the transaction: the GROUP BY never holds locks (Decision 4).
    const commitIds = [...(await expectedCommitPicks(org)).values()];
    const jiraIds = [...(await expectedJiraPicks(org)).values()];
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM commit_canonical WHERE org = ?', [org]);
      await tx.execute('DELETE FROM jira_canonical WHERE org = ?', [org]);
      for (const b of batches(commitIds)) { await insertCommitsByIds(tx, org, b); opts.onBatch?.(org, 'commit'); }
      for (const b of batches(jiraIds)) { await insertJiraByIds(tx, org, b); opts.onBatch?.(org, 'jira'); }
      await recordCanonicalBuild(tx, {
        org, builtAt: new Date().toISOString(), durationMs: Date.now() - t0,
        commitRows: commitIds.length, jiraRows: jiraIds.length,
      });
    });
    return { org, ok: true, commitRows: commitIds.length, jiraRows: jiraIds.length, durationMs: Date.now() - t0 };
  } catch (e: any) {
    return { org, ok: false, commitRows: 0, jiraRows: 0, durationMs: Date.now() - t0, error: e?.message ?? String(e) };
  }
}

async function refreshReport(reportId: string, org: string): Promise<void> {
  const [c] = await db.execute<any>('SELECT DISTINCT commit_sha AS k FROM commit_analyses WHERE report_id = ?', [reportId]);
  const [j] = await db.execute<any>('SELECT DISTINCT issue_key AS k FROM jira_issues WHERE report_id = ?', [reportId]);
  await db.transaction(async (tx) => {
    await refreshCommitKeys(tx, org, c.map((r: any) => String(r.k)));
    await refreshJiraKeys(tx, org, j.map((r: any) => String(r.k)));
  });
}

/** Rebuild every org. Assumes `holder` holds the lock; always releases it. */
export async function runRebuild(
  holder: string,
  snapshot: { completedIds: Set<string> },
  opts: RebuildOptions = {},
): Promise<CanonicalRebuildOrgResult[]> {
  try {
    const orgs = await allOrgs();
    const results = new Map<string, CanonicalRebuildOrgResult>();
    const usedIds = new Map<string, Set<string>>();
    let done = 0;
    for (const org of orgs) {
      usedIds.set(org, await completedIds(org));
      results.set(org, await rebuildOrg(org, opts));
      await opts.onProgress?.(org, ++done, orgs.length);
    }

    // Reports completed after the snapshot: apply per-report refresh for built orgs (Decision 6).
    const built = new Set((await listCanonicalBuilds()).map((b) => b.org));
    const [late] = await db.execute<any>(`SELECT id, org FROM reports WHERE status = 'completed'`);
    for (const r of late) {
      const id = String(r.id), org = String(r.org);
      if (snapshot.completedIds.has(id) || !built.has(org)) continue;
      await refreshReport(id, org);
    }

    // An org whose snapshot/pick-time reports vanished mid-rebuild is rebuilt once more.
    const present = await completedIds();
    for (const org of orgs) {
      const used = usedIds.get(org)!;
      const missing = [...used].some((id) => !present.has(id));
      if (missing) results.set(org, await rebuildOrg(org, opts));
    }
    return orgs.map((o) => results.get(o)!);
  } finally {
    await releaseRebuildLock(holder);
  }
}

export async function rebuildCanonical(opts: RebuildOptions = {}): Promise<CanonicalRebuildOrgResult[]> {
  const holder = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const snapshot = await acquireRebuildLock(holder);
  return runRebuild(holder, snapshot, opts);
}
