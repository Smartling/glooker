jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'test-model',
  extraBodyProps: jest.fn().mockReturnValue({}),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
}));

import { getDevSummary } from '@/lib/report/summary';
import { ReportNotFoundError } from '@/lib/report/service';
import { DeveloperNotFoundError } from '@/lib/report/dev';
import db from '@/lib/db/index';
import { getLLMClient } from '@/lib/llm-provider';

const mockDbExecute = db.execute as jest.Mock;
const mockGetLLMClient = getLLMClient as jest.Mock;

const reportRow = {
  id: 'report-1',
  org: 'acme',
  period_days: 30,
};

const devRow = {
  github_login: 'alice',
  github_name: 'Alice',
  total_prs: 5,
  total_commits: 20,
  lines_added: 1000,
  lines_removed: 200,
  avg_complexity: '3.5',
  impact_score: '87.5',
  pr_percentage: '25.0',
  ai_percentage: '10.0',
  type_breakdown: '{"feat":5,"fix":3}',
};

const commitRow = {
  commit_sha: 'abc123',
  committed_at: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days ago (recent)
  lines_added: 50,
  lines_removed: 10,
  complexity: 3,
  type: 'feat',
  ai_co_authored: false,
  maybe_ai: false,
};

const llmResponse = {
  summary: 'Alice had a strong week with 20 commits.',
  badges: [{ icon: '🚀', title: 'Prolific Coder', description: 'Top commits this week' }],
};

function makeMockLLMClient() {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(llmResponse) } }],
        }),
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

describe('getDevSummary', () => {
  describe('cached path', () => {
    it('returns immediately with cached: true when summary exists in DB', async () => {
      const cachedSummary = {
        summary_text: 'Cached summary text.',
        badges_json: '[{"icon":"⭐","title":"Star","description":"great work"}]',
        generated_at: '2026-01-15T10:00:00Z',
      };
      mockDbExecute.mockResolvedValueOnce([[cachedSummary], null]);

      const result = await getDevSummary('report-1', 'alice');

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('Cached summary text.');
      expect(result.badges).toEqual([{ icon: '⭐', title: 'Star', description: 'great work' }]);
      expect(result.generated_at).toBe('2026-01-15T10:00:00Z');
      expect(mockGetLLMClient).not.toHaveBeenCalled();
      // Only 1 DB call (cache check), no further calls
      expect(mockDbExecute).toHaveBeenCalledTimes(1);
    });

    it('handles already-parsed badges_json (array from MySQL)', async () => {
      const cachedSummary = {
        summary_text: 'Another summary.',
        badges_json: [{ icon: '🔥', title: 'Hot', description: 'on fire' }],
        generated_at: '2026-01-16T10:00:00Z',
      };
      mockDbExecute.mockResolvedValueOnce([[cachedSummary], null]);

      const result = await getDevSummary('report-1', 'alice');

      expect(result.cached).toBe(true);
      expect(result.badges).toEqual([{ icon: '🔥', title: 'Hot', description: 'on fire' }]);
    });
  });

  describe('fresh generation path', () => {
    function setupFreshPath() {
      const mockClient = makeMockLLMClient();
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockDbExecute
        .mockResolvedValueOnce([[], null])                          // cache miss
        .mockResolvedValueOnce([[reportRow], null])                 // report metadata
        .mockResolvedValueOnce([[devRow], null])                    // all devs
        .mockResolvedValueOnce([[{ id: 'report-1' }], null])       // all report IDs for org
        .mockResolvedValueOnce([[commitRow], null])                 // all commits for dev
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]);       // INSERT/UPDATE summary

      return mockClient;
    }

    it('calls LLM and returns { summary, badges, generated_at, cached: false }', async () => {
      setupFreshPath();

      const result = await getDevSummary('report-1', 'alice');

      expect(result.cached).toBe(false);
      expect(result.summary).toBe(llmResponse.summary);
      expect(result.badges).toEqual(llmResponse.badges);
      expect(result.generated_at).toBeDefined();
      expect(mockGetLLMClient).toHaveBeenCalledTimes(1);
    });

    it('saves to DB after LLM call', async () => {
      setupFreshPath();

      await getDevSummary('report-1', 'alice');

      const insertCall = mockDbExecute.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO developer_summaries'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain('report-1');
      expect(insertCall![1]).toContain('alice');
    });

    it('strips markdown fences from LLM response', async () => {
      const mockClient = makeMockLLMClient();
      mockClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '```json\n' + JSON.stringify(llmResponse) + '\n```' } }],
      });
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockDbExecute
        .mockResolvedValueOnce([[], null])
        .mockResolvedValueOnce([[reportRow], null])
        .mockResolvedValueOnce([[devRow], null])
        .mockResolvedValueOnce([[{ id: 'report-1' }], null])
        .mockResolvedValueOnce([[commitRow], null])
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

      const result = await getDevSummary('report-1', 'alice');

      expect(result.summary).toBe(llmResponse.summary);
      expect(result.badges).toEqual(llmResponse.badges);
    });
  });

  describe('prompt and settings snapshots', () => {
    function setupFreshPathWithCreateFn() {
      const createFn = jest.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
      });
      const mockClient = { chat: { completions: { create: createFn } } };
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockDbExecute
        .mockResolvedValueOnce([[], null])                          // cache miss
        .mockResolvedValueOnce([[reportRow], null])                 // report metadata
        .mockResolvedValueOnce([[devRow], null])                    // all devs (single dev = rank 1)
        .mockResolvedValueOnce([[{ id: 'report-1' }], null])       // all report IDs for org
        .mockResolvedValueOnce([[commitRow], null])                 // commits for dev
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]);       // INSERT

      return createFn;
    }

    it('sends exact system prompt', async () => {
      const createFn = setupFreshPathWithCreateFn();

      await getDevSummary('report-1', 'alice');

      const callArgs = createFn.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m: any) => m.role === 'system');
      const systemContent = systemMsg.content as string;

      expect(systemContent).toContain('You are a terse engineering performance coach.');
      expect(systemContent).toContain('Output JSON with two fields:');
      expect(systemContent).toContain('SUMMARY rules:');
      expect(systemContent).toContain('BADGES: 2-4 badges max.');
      expect(systemContent).toContain('Return ONLY raw JSON.');

      expect(systemContent).toMatchSnapshot('summary-system-prompt');
    });

    it('sends correct user message structure', async () => {
      const createFn = setupFreshPathWithCreateFn();

      await getDevSummary('report-1', 'alice');

      const callArgs = createFn.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
      const userContent = userMsg.content as string;

      expect(userContent).toContain('Developer: Alice (@alice)');
      expect(userContent).toContain('Rank: 1st (top of leaderboard)');
      expect(userContent).toContain('Period: 30 days');
      expect(userContent).toContain('Overall stats:');
      expect(userContent).toContain('Last 7 days:');
      expect(userContent).toContain('Prior 7 days:');
      expect(userContent).toContain('This developer is #1');
      expect(userContent).toContain('Total developers in org: 1');

      expect(userContent).toMatchSnapshot('summary-user-message');
    });

    it('passes correct LLM settings', async () => {
      const createFn = setupFreshPathWithCreateFn();

      await getDevSummary('report-1', 'alice');

      const callArgs = createFn.mock.calls[0][0];

      expect(callArgs.temperature).toBe(0.7);
      expect(callArgs.max_completion_tokens).toBe(512);
      expect(callArgs.model).toBe('test-model');
      expect(callArgs.response_format).toEqual({ type: 'json_object' });
    });
  });

  describe('error cases', () => {
    it('throws ReportNotFoundError when report is missing', async () => {
      mockDbExecute
        .mockResolvedValueOnce([[], null])   // cache miss
        .mockResolvedValueOnce([[], null]);  // report not found

      await expect(getDevSummary('missing-id', 'alice')).rejects.toThrow(ReportNotFoundError);
    });

    it('throws DeveloperNotFoundError when dev not in dev stats', async () => {
      mockDbExecute
        .mockResolvedValueOnce([[], null])         // cache miss
        .mockResolvedValueOnce([[reportRow], null]) // report found
        .mockResolvedValueOnce([[], null]);         // no devs (dev not found)

      await expect(getDevSummary('report-1', 'unknown')).rejects.toThrow(DeveloperNotFoundError);
    });
  });
});
