jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('rid') }));

import { listReports, createReport } from '@/lib/report/service';
import db from '@/lib/db/index';
const exec = db.execute as jest.Mock;

const row = (over: any = {}) => ({
  id: 'r1', org: 'acme', period_days: 30, status: 'completed',
  created_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T10:20:00Z',
  trigger_kind: null, triggered_by: null, run_metadata: null, ...over,
});

beforeEach(() => { jest.clearAllMocks(); exec.mockResolvedValue([[], null]); });

describe('listReports health + trigger', () => {
  it('selects the trigger columns and run_metadata, and never returns run_metadata itself', async () => {
    exec.mockResolvedValueOnce([[row()], null]);
    const [r] = await listReports();
    expect(exec.mock.calls[0][0]).toMatch(/trigger_kind/);
    expect(exec.mock.calls[0][0]).toMatch(/run_metadata/);
    expect(r).not.toHaveProperty('run_metadata');
    expect(r).toMatchObject({ trigger_kind: null, triggered_by: null, health: null });
  });
  it('summarises run_metadata from an object (MySQL) and a string (SQLite)', async () => {
    const meta = { state: 'failed', skipped: [], errors: [], expectedCount: 1, thresholds: {}, abortReason: 'x' };
    exec.mockResolvedValueOnce([[row({ run_metadata: meta }), row({ id: 'r2', run_metadata: JSON.stringify(meta) })], null]);
    const rows = await listReports();
    expect(rows.map(r => r.health?.label)).toEqual(['incomplete', 'incomplete']);
  });
  it('degrades malformed run_metadata to null health instead of throwing', async () => {
    exec.mockResolvedValueOnce([[row({ run_metadata: '{broken' })], null]);
    const [r] = await listReports();
    expect(r.health).toBeNull();
  });
});

describe('createReport trigger', () => {
  it('records a manual trigger with the caller', async () => {
    await createReport({ org: 'acme', periodDays: 30, triggeredBy: 'a@x' });
    const insert = exec.mock.calls.find(c => String(c[0]).includes('INSERT INTO reports'))!;
    expect(insert[0]).toMatch(/trigger_kind/);
    expect(insert[1]).toEqual(['rid', 'acme', 30, 'manual', 'a@x']);
  });
  it('records a manual trigger with no caller when auth is off', async () => {
    await createReport({ org: 'acme', periodDays: 30 });
    const insert = exec.mock.calls.find(c => String(c[0]).includes('INSERT INTO reports'))!;
    expect(insert[1]).toEqual(['rid', 'acme', 30, 'manual', null]);
  });
});
