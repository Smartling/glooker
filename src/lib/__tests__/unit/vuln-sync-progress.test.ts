import { initSyncProgress, updateSyncProgress, addSyncLog, getSyncProgress } from '@/lib/vulnerabilities/progress';

describe('vulnerabilities/progress (the syncs tab running card\'s in-memory store)', () => {
  it('getSyncProgress returns null for an id with no entry', () => {
    expect(getSyncProgress(999999)).toBeNull();
  });

  it('initSyncProgress creates a running entry with the starting shape', () => {
    initSyncProgress(1);
    expect(getSyncProgress(1)).toEqual({ status: 'running', step: 'Starting…', done: 0, total: 0, logs: [] });
  });

  it('updateSyncProgress merges partial state, leaving other fields unchanged', () => {
    initSyncProgress(2);
    updateSyncProgress(2, { step: 'Fetching repos…', done: 3, total: 10 });
    const p = getSyncProgress(2)!;
    expect(p.step).toBe('Fetching repos…');
    expect(p.done).toBe(3);
    expect(p.total).toBe(10);
    expect(p.status).toBe('running'); // unchanged
    expect(p.logs).toEqual([]); // unchanged
  });

  it('updateSyncProgress does nothing for an id with no entry (never auto-creates)', () => {
    updateSyncProgress(12345, { step: 'x' });
    expect(getSyncProgress(12345)).toBeNull();
  });

  it('addSyncLog appends an ET-timestamped message', () => {
    initSyncProgress(3);
    addSyncLog(3, 'hello');
    const p = getSyncProgress(3)!;
    expect(p.logs).toHaveLength(1);
    expect(p.logs[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hello$/);
  });

  it('addSyncLog does nothing for an id with no entry (never auto-creates)', () => {
    addSyncLog(54321, 'hello');
    expect(getSyncProgress(54321)).toBeNull();
  });

  it('addSyncLog trims at 200 entries, keeping the newest', () => {
    initSyncProgress(4);
    for (let i = 0; i < 210; i++) addSyncLog(4, `msg-${i}`);
    const p = getSyncProgress(4)!;
    expect(p.logs).toHaveLength(200);
    expect(p.logs[0]).toMatch(/msg-10$/);
    expect(p.logs[199]).toMatch(/msg-209$/);
  });

  it('initSyncProgress clears every other entry — only one sync runs at a time', () => {
    initSyncProgress(5);
    updateSyncProgress(5, { step: 'mid-flight' });
    initSyncProgress(6);
    expect(getSyncProgress(5)).toBeNull();
    expect(getSyncProgress(6)).toEqual({ status: 'running', step: 'Starting…', done: 0, total: 0, logs: [] });
  });
});
