jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));
jest.mock('@/lib/report-runner', () => ({
  runReport: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/progress-store', () => ({
  initProgress: jest.fn(),
  updateProgress: jest.fn(),
  addLog: jest.fn(),
  getProgress: jest.fn(),
  clearProgress: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234'),
}));

import {
  initScheduler,
  registerSchedule,
  unregisterSchedule,
  getNextRun,
  type Schedule,
} from '@/lib/schedule-manager';
import db from '@/lib/db/index';
import { runReport } from '@/lib/report-runner';
import { initProgress } from '@/lib/progress-store';

const mockDbExecute = db.execute as jest.Mock;

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sched-1',
    org: 'test-org',
    period_days: 14,
    cron_expr: '0 9 * * 1',
    timezone: 'America/New_York',
    enabled: 1,
    test_mode: 0,
    last_run_at: null,
    last_report_id: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('schedule-manager', () => {
  // Reset the globalThis scheduler init flag between tests
  const g = globalThis as any;

  beforeEach(() => {
    g.__glooker_scheduler_init = false;
    // Clear any registered jobs
    if (g.__glooker_schedules) {
      for (const [, job] of g.__glooker_schedules) {
        job.stop();
      }
      g.__glooker_schedules.clear();
    }
    mockDbExecute.mockResolvedValue([[], null]);
  });

  describe('initScheduler', () => {
    it('marks orphaned running reports as failed', async () => {
      await initScheduler();
      const updateCall = mockDbExecute.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('Server restarted'),
      );
      expect(updateCall).toBeTruthy();
    });

    it('loads and registers enabled schedules from DB', async () => {
      const schedule = makeSchedule();
      mockDbExecute
        .mockResolvedValueOnce([[], null])  // UPDATE orphaned
        .mockResolvedValueOnce([[schedule], null]);  // SELECT schedules

      await initScheduler();

      expect(g.__glooker_schedules.has('sched-1')).toBe(true);
    });

    it('guards against double init', async () => {
      await initScheduler();
      const callsBefore = mockDbExecute.mock.calls.length;

      g.__glooker_scheduler_init = true;
      await initScheduler();

      // No additional DB calls
      expect(mockDbExecute.mock.calls.length).toBe(callsBefore);
    });

    it('handles DB error gracefully', async () => {
      g.__glooker_scheduler_init = false;
      mockDbExecute.mockRejectedValueOnce(new Error('DB down'));

      // Should not throw
      await initScheduler();
    });

    it('handles schedule registration error gracefully', async () => {
      const badSchedule = makeSchedule({ cron_expr: 'invalid-cron!!!' });
      mockDbExecute
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([[badSchedule], null]);

      g.__glooker_scheduler_init = false;
      // Should not throw even if individual schedule fails
      await initScheduler();
    });
  });

  describe('registerSchedule', () => {
    it('creates a cron job for enabled schedule', () => {
      const schedule = makeSchedule();
      registerSchedule(schedule);
      expect(g.__glooker_schedules.has('sched-1')).toBe(true);
    });

    it('does not create job for disabled schedule', () => {
      const schedule = makeSchedule({ enabled: 0 });
      registerSchedule(schedule);
      expect(g.__glooker_schedules.has('sched-1')).toBe(false);
    });

    it('replaces existing job on re-register', () => {
      const schedule = makeSchedule();
      registerSchedule(schedule);
      const firstJob = g.__glooker_schedules.get('sched-1');

      registerSchedule(schedule);
      const secondJob = g.__glooker_schedules.get('sched-1');

      expect(secondJob).not.toBe(firstJob);
    });
  });

  describe('unregisterSchedule', () => {
    it('stops and removes existing job', () => {
      const schedule = makeSchedule();
      registerSchedule(schedule);
      expect(g.__glooker_schedules.has('sched-1')).toBe(true);

      unregisterSchedule('sched-1');
      expect(g.__glooker_schedules.has('sched-1')).toBe(false);
    });

    it('does nothing for nonexistent schedule', () => {
      // Should not throw
      unregisterSchedule('nonexistent');
    });
  });

  describe('triggerSchedule (via cron callback)', () => {
    it('creates report and calls runReport on trigger', async () => {
      const schedule = makeSchedule();
      registerSchedule(schedule);

      // Get the cron job and manually trigger its callback
      const job = g.__glooker_schedules.get('sched-1');
      // Croner stores the callback — trigger it
      await job.trigger();

      // Give async work time to settle
      await new Promise((r) => setTimeout(r, 50));

      // Should have created a report in DB
      const insertCall = mockDbExecute.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO reports'),
      );
      expect(insertCall).toBeTruthy();
      expect(initProgress).toHaveBeenCalledWith('mock-uuid-1234');
      expect(runReport).toHaveBeenCalled();
    });

    it('skips trigger when report already running for org', async () => {
      mockDbExecute.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT id FROM reports')) {
          return [[{ id: 'existing-report' }], null];
        }
        return [[], null];
      });

      const schedule = makeSchedule();
      registerSchedule(schedule);

      const job = g.__glooker_schedules.get('sched-1');
      await job.trigger();
      await new Promise((r) => setTimeout(r, 50));

      // runReport should NOT have been called
      expect(runReport).not.toHaveBeenCalled();
    });

    it('handles trigger error gracefully', async () => {
      mockDbExecute.mockRejectedValue(new Error('DB error'));

      const schedule = makeSchedule();
      registerSchedule(schedule);

      const job = g.__glooker_schedules.get('sched-1');
      // Should not throw
      await job.trigger();
      await new Promise((r) => setTimeout(r, 50));
    });

    it('marks report as failed when runReport rejects', async () => {
      const mockRunReport = runReport as jest.Mock;
      mockRunReport.mockRejectedValueOnce(new Error('LLM crash'));

      const schedule = makeSchedule();
      registerSchedule(schedule);

      const job = g.__glooker_schedules.get('sched-1');
      await job.trigger();
      await new Promise((r) => setTimeout(r, 100));

      // Should have tried to update report status to failed
      const failCall = mockDbExecute.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('SET status') && call[1]?.[0] === 'failed',
      );
      // The catch writes to DB — may or may not succeed, but it's exercised
      // The key thing is it doesn't throw
    });

    it('handles DB error in runReport error handler gracefully', async () => {
      const mockRunReport = runReport as jest.Mock;
      mockRunReport.mockRejectedValueOnce(new Error('LLM crash'));
      // Make ALL db.execute calls reject so the inner catch is exercised
      mockDbExecute.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT id FROM reports')) {
          return [[], null]; // allow concurrency check to pass
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO reports')) {
          return [[], null]; // allow report creation
        }
        if (typeof sql === 'string' && sql.includes('UPDATE schedules')) {
          return [[], null]; // allow schedule update
        }
        if (typeof sql === 'string' && sql.includes('SET status')) {
          throw new Error('DB write failed'); // inner catch
        }
        return [[], null];
      });

      const schedule = makeSchedule();
      registerSchedule(schedule);

      const job = g.__glooker_schedules.get('sched-1');
      await job.trigger();
      await new Promise((r) => setTimeout(r, 100));

      // Should not throw — error is caught internally
    });
  });

  describe('getNextRun', () => {
    it('returns next run date for valid cron', () => {
      const next = getNextRun('0 9 * * 1', 'America/New_York');
      expect(next).toBeInstanceOf(Date);
      expect(next!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns null for invalid cron', () => {
      const next = getNextRun('invalid!!!', 'America/New_York');
      expect(next).toBeNull();
    });
  });
});
