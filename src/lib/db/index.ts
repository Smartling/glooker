/**
 * Database abstraction. Supports MySQL and SQLite (default).
 *
 * Set DB_TYPE=mysql for MySQL, or leave unset/sqlite for zero-config SQLite.
 * Both export the same `execute(sql, params)` interface.
 */

export interface DB {
  execute<T = any>(sql: string, params?: any[]): Promise<[T[], any]>;
}

let dbInstance: DB | null = null;

async function getDB(): Promise<DB> {
  if (dbInstance) return dbInstance;

  const dbType = process.env.DB_TYPE || 'sqlite';

  if (dbType === 'mysql') {
    const { createMySQLDB } = await import('./mysql');
    dbInstance = createMySQLDB();
  } else {
    const { createSQLiteDB } = await import('./sqlite');
    dbInstance = createSQLiteDB();
  }

  return dbInstance;
}

// Proxy that lazily initializes the DB on first call
const dbProxy: DB = {
  async execute<T = any>(sql: string, params?: any[]): Promise<[T[], any]> {
    const db = await getDB();
    return db.execute<T>(sql, params);
  },
};

export default dbProxy;
