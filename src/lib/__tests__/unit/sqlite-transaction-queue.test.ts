/** GLOOK-63: overlapping SQLite transactions on the one shared handle queue instead of failing. */
import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-txq-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  await db.execute("INSERT INTO reports (id, org, period_days, status) VALUES ('r1', 'acme', 14, 'running')");
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});

const tick = () => new Promise((r) => setTimeout(r, 5));

it('runs a second transaction after the first commits instead of throwing', async () => {
  const order: string[] = [];
  const a = db.transaction(async (tx: any) => {
    order.push('a-start');
    await tick();
    await tx.execute("UPDATE reports SET status = 'stopped' WHERE id = 'r1'");
    order.push('a-end');
  });
  const b = db.transaction(async (tx: any) => {
    order.push('b-start');
    await tx.execute("UPDATE reports SET status = 'completed' WHERE id = 'r1'");
    order.push('b-end');
  });
  await Promise.all([a, b]);
  expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  const [rows] = await db.execute("SELECT status FROM reports WHERE id = 'r1'");
  expect(rows[0].status).toBe('completed');
});

it('a failed transaction rolls back and does not block the next one', async () => {
  const failed = db.transaction(async (tx: any) => {
    await tx.execute("UPDATE reports SET status = 'failed' WHERE id = 'r1'");
    throw new Error('boom');
  });
  const next = db.transaction(async (tx: any) => {
    const [rows] = await tx.execute("SELECT status FROM reports WHERE id = 'r1'");
    return rows[0].status;
  });
  await expect(failed).rejects.toThrow('boom');
  await expect(next).resolves.toBe('completed');
});
