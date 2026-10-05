/**
 * Database abstraction. Supports MySQL and SQLite (default).
 *
 * Set DB_TYPE=mysql for MySQL, or leave unset/sqlite for zero-config SQLite.
 * Both export the same `execute(sql, params)` interface.
 */

export interface DB {
  execute<T = any>(sql: string, params?: any[]): Promise<[T[], any]>;
  /**
   * Run `fn` inside a single transaction. The `tx` handle issues all queries
   * on the same connection (MySQL) or under one BEGIN/COMMIT (SQLite). Any
   * thrown error rolls back; nested transactions are not supported.
   */
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
}

// One DB per process, on globalThis — the same pattern as the progress and
// schedule stores. Next 16 can load this module more than once (startup
// instrumentation and route handlers are separate bundles); a module-level
// singleton then created one connection pool per copy, and each ran the boot
// migrations concurrently, which InnoDB answered with "Deadlock found" on the
// ALTERs. On a fresh column that would leave it silently missing (initSchema
// logs and continues). Sharing the promise also covers two first calls racing.
const g = globalThis as typeof globalThis & { __glooker_db?: Promise<DB> };

function getDB(): Promise<DB> {
  if (!g.__glooker_db) {
    g.__glooker_db = (async () => {
      const dbType = process.env.DB_TYPE || 'sqlite';
      if (dbType === 'mysql') {
        const { createMySQLDB } = await import('./mysql');
        return createMySQLDB();
      }
      const { createSQLiteDB } = await import('./sqlite');
      return createSQLiteDB();
    })();
  }
  return g.__glooker_db;
}

/** Drop the shared DB handle. Tests only. */
export function _resetDBForTests(): void {
  delete g.__glooker_db;
}

// Proxy that lazily initializes the DB on first call
const dbProxy: DB = {
  async execute<T = any>(sql: string, params?: any[]): Promise<[T[], any]> {
    const db = await getDB();
    return db.execute<T>(sql, params);
  },
  async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
    const db = await getDB();
    return db.transaction(fn);
  },
};

export default dbProxy;
