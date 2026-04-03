jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));

import { PATCH } from '@/app/api/projects/[key]/due/route';
import { getJiraClient } from '@/lib/jira/client';

const mockGetJiraClient = getJiraClient as jest.Mock;

/** Build a minimal mock NextRequest with a JSON body. */
function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

/** Build the params object the route handler expects. */
function makeParams(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe('PATCH /api/projects/[key]/due', () => {
  describe('date validation', () => {
    it('rejects an invalid date format with 400', async () => {
      mockGetJiraClient.mockReturnValue({
        updateDueDate: jest.fn().mockResolvedValue(undefined),
      });

      const res = await PATCH(makeRequest({ dueDate: 'not-a-date' }), makeParams('PROJ-1'));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/YYYY-MM-DD/);
    });

    it('rejects a partially correct date format with 400', async () => {
      mockGetJiraClient.mockReturnValue({
        updateDueDate: jest.fn().mockResolvedValue(undefined),
      });

      const res = await PATCH(makeRequest({ dueDate: '2026/04/15' }), makeParams('PROJ-1'));
      expect(res.status).toBe(400);
    });
  });

  describe('Jira not configured', () => {
    it('returns 404 when getJiraClient returns null', async () => {
      mockGetJiraClient.mockReturnValue(null);

      const res = await PATCH(makeRequest({ dueDate: '2026-04-15' }), makeParams('PROJ-1'));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    });
  });

  describe('successful update', () => {
    it('calls updateDueDate with correct key and date, returns success JSON', async () => {
      const mockUpdateDueDate = jest.fn().mockResolvedValue(undefined);
      mockGetJiraClient.mockReturnValue({ updateDueDate: mockUpdateDueDate });

      const res = await PATCH(makeRequest({ dueDate: '2026-04-15' }), makeParams('PROJ-42'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.key).toBe('PROJ-42');
      expect(body.dueDate).toBe('2026-04-15');
      expect(mockUpdateDueDate).toHaveBeenCalledWith('PROJ-42', '2026-04-15');
    });

    it('accepts null dueDate to clear the date', async () => {
      const mockUpdateDueDate = jest.fn().mockResolvedValue(undefined);
      mockGetJiraClient.mockReturnValue({ updateDueDate: mockUpdateDueDate });

      const res = await PATCH(makeRequest({ dueDate: null }), makeParams('PROJ-42'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.dueDate).toBeNull();
      expect(mockUpdateDueDate).toHaveBeenCalledWith('PROJ-42', null);
    });
  });

  describe('Jira error', () => {
    it('returns 500 when updateDueDate throws', async () => {
      const mockUpdateDueDate = jest.fn().mockRejectedValue(new Error('Jira API error (403): Forbidden'));
      mockGetJiraClient.mockReturnValue({ updateDueDate: mockUpdateDueDate });

      const res = await PATCH(makeRequest({ dueDate: '2026-04-15' }), makeParams('PROJ-42'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Jira API error (403)');
    });

    it('returns generic error message when error is not an Error instance', async () => {
      const mockUpdateDueDate = jest.fn().mockRejectedValue('unexpected string error');
      mockGetJiraClient.mockReturnValue({ updateDueDate: mockUpdateDueDate });

      const res = await PATCH(makeRequest({ dueDate: '2026-04-15' }), makeParams('PROJ-42'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Failed to update due date');
    });
  });
});
