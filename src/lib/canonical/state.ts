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
