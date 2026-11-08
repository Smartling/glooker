import db, { type DB } from '@/lib/db';

export interface CanonicalBuild {
  org: string;
  builtAt: string;
  durationMs: number;
  commitRows: number;
  jiraRows: number;
}

function toBuild(r: any): CanonicalBuild {
  return {
    org: String(r.org),
    builtAt: String(r.built_at),
    durationMs: Number(r.duration_ms),
    commitRows: Number(r.commit_rows),
    jiraRows: Number(r.jira_rows),
  };
}

const COLS = 'org, built_at, duration_ms, commit_rows, jira_rows';

export async function getCanonicalBuild(org: string): Promise<CanonicalBuild | null> {
  const [rows] = await db.execute<any>(`SELECT ${COLS} FROM canonical_builds WHERE org = ?`, [org]);
  return rows.length ? toBuild(rows[0]) : null;
}

export async function isCanonicalBuilt(org: string): Promise<boolean> {
  return (await getCanonicalBuild(org)) !== null;
}

export async function listCanonicalBuilds(): Promise<CanonicalBuild[]> {
  const [rows] = await db.execute<any>(`SELECT ${COLS} FROM canonical_builds ORDER BY org`);
  return rows.map(toBuild);
}

/** Every org with a completed report or a canonical build, sorted. */
export async function listCanonicalOrgs(): Promise<string[]> {
  const [reportRows] = await db.execute<any>(`SELECT DISTINCT org FROM reports WHERE status = 'completed'`);
  const [buildRows] = await db.execute<any>('SELECT org FROM canonical_builds');
  const all = new Set<string>([...reportRows, ...buildRows].map((r: any) => String(r.org)));
  return [...all].sort();
}

/** Replace the org's build marker. Call inside the same transaction that wrote the rows. */
export async function recordCanonicalBuild(tx: DB, b: CanonicalBuild): Promise<void> {
  await tx.execute('DELETE FROM canonical_builds WHERE org = ?', [b.org]);
  await tx.execute(
    `INSERT INTO canonical_builds (${COLS}) VALUES (?, ?, ?, ?, ?)`,
    [b.org, b.builtAt, b.durationMs, b.commitRows, b.jiraRows],
  );
}

/**
 * Per-org canonical lock. LOCK ORDER: always canonical_builds first. Upkeep (completeReport,
 * deleteReportWithUpkeep), the rebuild (rebuildOrg) and its late-report catch-up (refreshReport)
 * all make this the FIRST statement of their transaction, before touching commit_canonical or
 * jira_canonical; taking it in any other order deadlocks against the others. Being first also
 * matters under MySQL REPEATABLE READ: the read view is created at the first consistent read, so
 * later SELECTs see everything committed before the lock was granted. On an unbuilt org the row is
 * missing and only a gap lock is taken. Returns whether the org is built.
 */
export async function lockBuild(tx: any, org: string | null): Promise<boolean> {
  if (!org) return false;
  const [rows] = await tx.execute(`SELECT org FROM canonical_builds WHERE org = ? FOR UPDATE`, [org]);
  return rows.length > 0;
}

const LOCK_ERRNOS = new Set([1213, 1205]);
const LOCK_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
export const LOCK_RETRY_BACKOFF_MS = [250, 1000];

export function isLockConflict(err: any): boolean {
  return !!err && (LOCK_ERRNOS.has(Number(err.errno)) || LOCK_CODES.has(String(err.code)));
}

/**
 * Run `fn` (a whole transaction) up to 3 times, retrying only on a MySQL deadlock (1213) or
 * lock-wait timeout (1205). Anything else, or the last lock error, is rethrown.
 */
export async function withLockRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isLockConflict(e) || attempt >= LOCK_RETRY_BACKOFF_MS.length) throw e;
      await sleep(LOCK_RETRY_BACKOFF_MS[attempt]);
    }
  }
}
