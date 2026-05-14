// Verifies that createMySQLDB() does not delegate execute() to the underlying
// pool until the migration IIFE has finished. Before the `ready` promise was
// added, the IIFE was fire-and-forget — pool.execute(SELECT 1) from another
// module imported at startup could land in between migration ALTER TABLEs.

const mockExecute = jest.fn();
const mockCreatePool = jest.fn((_config: unknown) => ({ execute: mockExecute }));

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: { createPool: (config: unknown) => mockCreatePool(config) },
}));

import { createMySQLDB } from '@/lib/db/mysql';

describe('createMySQLDB ready gate', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCreatePool.mockClear();
  });

  it('queues user queries behind ALL migration calls, not just the first', async () => {
    // Each pool.execute resolves on the next macrotask tick. Migrations are
    // awaited sequentially inside the IIFE, so without a `ready` gate a
    // user-issued SELECT 1 fired immediately after createMySQLDB() would
    // race in between two migration ALTER TABLEs.
    mockExecute.mockImplementation(
      () => new Promise<[any[], any]>((resolve) => setImmediate(() => resolve([[], null]))),
    );

    const db = createMySQLDB();
    // Fire the user query before migrations have had a chance to drain.
    await db.execute('SELECT 1');

    const calls = mockExecute.mock.calls.map((c) => String(c[0]).trim());
    const selectIdx = calls.findIndex((s) => /^SELECT/i.test(s));

    // There must actually be migrations — sanity check the harness wired up.
    expect(calls.length).toBeGreaterThan(10);
    expect(selectIdx).toBeGreaterThan(0);

    // The SELECT must come after the LAST migration call. Without `ready`,
    // the SELECT would land somewhere in the middle of the migration list.
    expect(selectIdx).toBe(calls.length - 1);

    // Every preceding call must be a schema/migration statement.
    for (let i = 0; i < selectIdx; i++) {
      expect(calls[i]).toMatch(/^(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)/i);
    }

    // Cross-check via invocationCallOrder: the SELECT's order number must be
    // strictly larger than every migration's order number.
    const selectOrder = mockExecute.mock.invocationCallOrder[selectIdx];
    for (let i = 0; i < selectIdx; i++) {
      expect(mockExecute.mock.invocationCallOrder[i]).toBeLessThan(selectOrder);
    }
  });
});
