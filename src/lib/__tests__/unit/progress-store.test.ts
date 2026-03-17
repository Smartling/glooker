import { initProgress, updateProgress, addLog, getProgress, clearProgress } from '@/lib/progress-store';

describe('progress-store', () => {
  const id = 'test-report-id';

  beforeEach(() => {
    clearProgress(id);
  });

  it('getProgress returns null for unknown ID', () => {
    expect(getProgress('nonexistent')).toBeNull();
  });

  it('initProgress creates entry with status pending', () => {
    initProgress(id);
    const p = getProgress(id)!;
    expect(p.status).toBe('pending');
    expect(p.step).toBe('Initializing...');
    expect(p.totalRepos).toBe(0);
    expect(p.processedRepos).toBe(0);
    expect(p.totalDevelopers).toBe(0);
    expect(p.completedDevelopers).toBe(0);
    expect(p.logs).toEqual([]);
  });

  it('updateProgress merges partial state', () => {
    initProgress(id);
    updateProgress(id, { status: 'running', step: 'Fetching...' });
    const p = getProgress(id)!;
    expect(p.status).toBe('running');
    expect(p.step).toBe('Fetching...');
    expect(p.totalRepos).toBe(0); // unchanged
  });

  it('addLog appends a timestamped message', () => {
    initProgress(id);
    addLog(id, 'hello');
    const p = getProgress(id)!;
    expect(p.logs).toHaveLength(1);
    expect(p.logs[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hello$/);
  });

  it('addLog trims at 200 entries', () => {
    initProgress(id);
    for (let i = 0; i < 210; i++) {
      addLog(id, `msg-${i}`);
    }
    const p = getProgress(id)!;
    expect(p.logs).toHaveLength(200);
    // oldest messages trimmed, newest kept
    expect(p.logs[199]).toMatch(/msg-209$/);
  });

  it('clearProgress removes entry', () => {
    initProgress(id);
    clearProgress(id);
    expect(getProgress(id)).toBeNull();
  });

  it('updateProgress does nothing for unknown ID', () => {
    // Should not throw
    updateProgress('nonexistent', { status: 'running' });
    expect(getProgress('nonexistent')).toBeNull();
  });

  it('addLog does nothing for unknown ID', () => {
    // Should not throw
    addLog('nonexistent', 'hello');
    expect(getProgress('nonexistent')).toBeNull();
  });
});
