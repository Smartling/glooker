jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'test-model',
  extraBodyProps: jest.fn().mockReturnValue({}),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
  promptTag: (name: string) => name ? { __prompt_id: name } : {},
}));

import { getReportHighlights } from '@/lib/report-highlights/service';
import db from '@/lib/db/index';
import { getLLMClient } from '@/lib/llm-provider';

const mockDbExecute = db.execute as jest.Mock;
const mockGetLLMClient = getLLMClient as jest.Mock;

const latestReport = {
  id: 'report-b',
  org: 'acme',
  period_days: 30,
  created_at: '2026-03-15T10:00:00Z',
};

const prevReport = {
  id: 'report-a',
  org: 'acme',
  period_days: 30,
  created_at: '2026-02-13T10:00:00Z',
};

const devStatsA = [
  {
    github_login: 'alice',
    github_name: 'Alice',
    total_commits: 20,
    total_prs: 5,
    lines_added: 1000,
    lines_removed: 200,
    avg_complexity: '3.5',
    impact_score: '80.0',
    pr_percentage: '25.0',
    ai_percentage: 10,
  },
  {
    github_login: 'bob',
    github_name: 'Bob',
    total_commits: 10,
    total_prs: 2,
    lines_added: 400,
    lines_removed: 50,
    avg_complexity: '2.0',
    impact_score: '50.0',
    pr_percentage: '20.0',
    ai_percentage: 5,
  },
];

const devStatsB = [
  {
    github_login: 'alice',
    github_name: 'Alice',
    total_commits: 25,
    total_prs: 6,
    lines_added: 1200,
    lines_removed: 250,
    avg_complexity: '3.8',
    impact_score: '90.0',
    pr_percentage: '24.0',
    ai_percentage: 12,
  },
  {
    github_login: 'carol',
    github_name: 'Carol',
    total_commits: 8,
    total_prs: 1,
    lines_added: 300,
    lines_removed: 30,
    avg_complexity: '2.5',
    impact_score: '40.0',
    pr_percentage: '12.5',
    ai_percentage: 0,
  },
];

const llmHighlights = [
  { icon: '🚀', text: 'Alice climbed from rank 1 to rank 1 with a +10 impact gain.', sentiment: 'positive' },
];

function makeMockLLMClient(content?: string) {
  const responseContent = content ?? JSON.stringify({ highlights: llmHighlights });
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

describe('getReportHighlights', () => {
  describe('no completed reports', () => {
    it('returns { available: false } when no completed report exists', async () => {
      mockDbExecute.mockResolvedValueOnce([[], null]); // no latest report

      const result = await getReportHighlights();

      expect(result).toEqual({ available: false });
      expect(mockGetLLMClient).not.toHaveBeenCalled();
      expect(mockDbExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('no previous report for same org+period', () => {
    it('returns { available: false } when no previous report exists', async () => {
      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null]) // latest report
        .mockResolvedValueOnce([[], null]);             // no previous report

      const result = await getReportHighlights();

      expect(result).toEqual({ available: false });
      expect(mockGetLLMClient).not.toHaveBeenCalled();
      expect(mockDbExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe('cached highlights', () => {
    it('returns cached data with cached: true and does NOT call LLM', async () => {
      const cachedHighlights = [{ icon: '✅', text: 'Steady state', sentiment: 'neutral' }];
      const cachedRow = {
        highlights_json: JSON.stringify(cachedHighlights),
        generated_at: '2026-03-16T08:00:00Z',
      };

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])  // latest
        .mockResolvedValueOnce([[prevReport], null])    // prev
        .mockResolvedValueOnce([[cachedRow], null]);    // cache hit

      const result = await getReportHighlights();

      expect(result).toEqual({
        available: true,
        org: 'acme',
        periodDays: 30,
        reportDateA: prevReport.created_at,
        reportDateB: latestReport.created_at,
        highlights: cachedHighlights,
        cached: true,
      });
      expect(mockGetLLMClient).not.toHaveBeenCalled();
      expect(mockDbExecute).toHaveBeenCalledTimes(3);
    });

    it('handles highlights_json already parsed as object (not string)', async () => {
      const cachedHighlights = [{ icon: '📊', text: 'Metrics stable', sentiment: 'neutral' }];
      const cachedRow = {
        highlights_json: cachedHighlights, // already an array, not a string
        generated_at: '2026-03-16T08:00:00Z',
      };

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])
        .mockResolvedValueOnce([[prevReport], null])
        .mockResolvedValueOnce([[cachedRow], null]);

      const result = await getReportHighlights();

      expect(result).toMatchObject({
        available: true,
        highlights: cachedHighlights,
        cached: true,
      });
      expect(mockGetLLMClient).not.toHaveBeenCalled();
    });
  });

  describe('fresh generation', () => {
    function setupFreshPath(llmContent?: string) {
      const mockClient = makeMockLLMClient(llmContent);
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])  // latest
        .mockResolvedValueOnce([[prevReport], null])    // prev
        .mockResolvedValueOnce([[], null])              // cache miss
        .mockResolvedValueOnce([devStatsA, null])       // statsA
        .mockResolvedValueOnce([devStatsB, null])       // statsB
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

      return mockClient;
    }

    it('calls LLM, saves to DB, and returns with cached: false', async () => {
      const mockClient = setupFreshPath();

      const result = await getReportHighlights();

      expect(result).toEqual({
        available: true,
        org: 'acme',
        periodDays: 30,
        reportDateA: prevReport.created_at,
        reportDateB: latestReport.created_at,
        highlights: llmHighlights,
        cached: false,
      });
      expect(mockGetLLMClient).toHaveBeenCalledTimes(1);
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('saves highlights to report_comparisons table', async () => {
      setupFreshPath();

      await getReportHighlights();

      const insertCall = mockDbExecute.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO report_comparisons'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain('report-a');
      expect(insertCall![1]).toContain('report-b');
    });

    it('strips markdown fences from LLM response', async () => {
      const fencedContent = '```json\n' + JSON.stringify({ highlights: llmHighlights }) + '\n```';
      setupFreshPath(fencedContent);

      const result = await getReportHighlights();

      expect(result).toMatchObject({ available: true, highlights: llmHighlights, cached: false });
    });

    it('passes correct report_id_a (older) and report_id_b (newer) to cache check', async () => {
      setupFreshPath();

      await getReportHighlights();

      const cacheCheckCall = mockDbExecute.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('report_comparisons') && call[0].includes('SELECT'),
      );
      expect(cacheCheckCall).toBeDefined();
      // report_id_a = prev (older), report_id_b = latest (newer)
      expect(cacheCheckCall![1]).toEqual(['report-a', 'report-b']);
    });
  });

  describe('prompt and settings snapshots', () => {
    function setupFreshPathWithCreateFn() {
      const createFn = jest.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ highlights: llmHighlights }) } }],
      });
      const mockClient = { chat: { completions: { create: createFn } } };
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])  // latest
        .mockResolvedValueOnce([[prevReport], null])    // prev
        .mockResolvedValueOnce([[], null])              // cache miss
        .mockResolvedValueOnce([devStatsA, null])       // statsA
        .mockResolvedValueOnce([devStatsB, null])       // statsB
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

      return createFn;
    }

    it('sends exact system prompt', async () => {
      const createFn = setupFreshPathWithCreateFn();

      await getReportHighlights();

      const callArgs = createFn.mock.calls[0][0];
      const systemMessage = callArgs.messages.find((m: any) => m.role === 'system');
      expect(systemMessage).toBeDefined();
      const content: string = systemMessage.content;

      expect(content).toContain('You are a concise engineering analytics assistant for Glooker');
      expect(content).toContain('Compare two reports');
      expect(content).toContain('3-5 bullet highlights max.');
      expect(content).toContain('developers missing from the latest report are NOT "departed"');
      expect(content).toContain('Return ONLY raw JSON.');

      expect(content).toMatchSnapshot('highlights-system-prompt');
    });

    it('sends correct user message structure', async () => {
      const createFn = setupFreshPathWithCreateFn();

      await getReportHighlights();

      const callArgs = createFn.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMessage).toBeDefined();
      const content: string = userMessage.content;

      expect(content).toContain('Org: acme, Period: 30 days');
      expect(content).toContain('PREVIOUS REPORT');
      expect(content).toContain('LATEST REPORT');
      expect(content).toContain('Top movers:');
      expect(content).toContain('Recently inactive');
      expect(content).toContain('@bob');
      expect(content).toContain('New developers');
      expect(content).toContain('@carol');

      expect(content).toMatchSnapshot('highlights-user-message');
    });

    it('passes correct LLM settings', async () => {
      const createFn = setupFreshPathWithCreateFn();

      await getReportHighlights();

      const callArgs = createFn.mock.calls[0][0];

      expect(callArgs.temperature).toBe(0.5);
      expect(callArgs.max_completion_tokens).toBe(512);
      expect(callArgs.model).toBe('test-model');
      expect(callArgs.response_format).toEqual({ type: 'json_object' });
    });
  });
});
