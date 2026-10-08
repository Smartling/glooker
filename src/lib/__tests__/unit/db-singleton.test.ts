// Next 16 can load src/lib/db more than once in one process (instrumentation and
// route handlers are separate bundles). Each copy must share ONE DB, or each runs
// the boot migrations and they deadlock each other on the ALTERs.
jest.mock('@/lib/db/sqlite', () => ({ createSQLiteDB: jest.fn(() => ({ execute: jest.fn(), transaction: jest.fn() })) }));

afterEach(() => { delete (globalThis as any).__glooker_db; });

it('two separately loaded copies of the db module create the DB once', async () => {
  const prev = process.env.DB_TYPE;
  delete process.env.DB_TYPE;
  try {
    let a: any; let b: any;
    jest.isolateModules(() => { a = require('@/lib/db/index').default; });
    jest.isolateModules(() => { b = require('@/lib/db/index').default; });
    await Promise.all([a.execute('SELECT 1'), b.execute('SELECT 1')]);
    const { createSQLiteDB } = require('@/lib/db/sqlite');
    expect(createSQLiteDB).toHaveBeenCalledTimes(1);
  } finally {
    if (prev === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = prev;
  }
});
