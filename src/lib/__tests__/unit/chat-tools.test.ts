jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import db from '@/lib/db';
import { executeTool } from '@/lib/chat/tools';

const mockExecute = db.execute as jest.Mock;

describe('chat tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper: mock latestReportId
  function mockLatestReport(id: string | null) {
    if (id) {
      mockExecute.mockResolvedValueOnce([[{ id }], []]);
    } else {
      mockExecute.mockResolvedValueOnce([[], []]);
    }
  }

  describe('queryJiraIssues', () => {
    it('returns issues for a developer', async () => {
      mockLatestReport('report-1');
      mockExecute.mockResolvedValueOnce([[
        { issue_key: 'TCM-100', project_key: 'TCM', issue_type: 'Story', summary: 'Add feature', status: 'Done', story_points: 3, github_login: 'msogin', resolved_at: '2026-03-20' },
        { issue_key: 'TCM-101', project_key: 'TCM', issue_type: 'Bug', summary: 'Fix bug', status: 'Done', story_points: 1, github_login: 'msogin', resolved_at: '2026-03-19' },
      ], []]);

      const result = JSON.parse(await executeTool('queryJiraIssues', { org: 'Smartling', login: 'msogin' }));
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].issue_key).toBe('TCM-100');
      expect(result.count).toBe(2);
    });

    it('filters by project key', async () => {
      mockLatestReport('report-1');
      mockExecute.mockResolvedValueOnce([[
        { issue_key: 'BRZ-50', project_key: 'BRZ', issue_type: 'Task', summary: 'Task', status: 'Done', story_points: null, github_login: 'dev1', resolved_at: '2026-03-18' },
      ], []]);

      const result = JSON.parse(await executeTool('queryJiraIssues', { org: 'Smartling', projectKey: 'BRZ' }));
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].project_key).toBe('BRZ');
    });

    it('returns error when no reports exist', async () => {
      mockLatestReport(null);
      const result = JSON.parse(await executeTool('queryJiraIssues', { org: 'Smartling' }));
      expect(result.error).toBe('No completed reports found');
    });
  });

  describe('queryJiraSummary', () => {
    it('returns aggregate stats', async () => {
      mockLatestReport('report-1');
      // totals query
      mockExecute.mockResolvedValueOnce([[{ total_issues: 45, total_story_points: 120, developer_count: 10 }], []]);
      // byProject query
      mockExecute.mockResolvedValueOnce([[
        { project_key: 'TCM', issue_count: 20, story_points: 60 },
        { project_key: 'BRZ', issue_count: 15, story_points: 40 },
      ], []]);
      // byType query
      mockExecute.mockResolvedValueOnce([[
        { issue_type: 'Story', issue_count: 25 },
        { issue_type: 'Bug', issue_count: 15 },
      ], []]);

      const result = JSON.parse(await executeTool('queryJiraSummary', { org: 'Smartling' }));
      expect(result.totals.total_issues).toBe(45);
      expect(result.totals.total_story_points).toBe(120);
      expect(result.byProject).toHaveLength(2);
      expect(result.byType).toHaveLength(2);
    });

    it('filters by developer login', async () => {
      mockLatestReport('report-1');
      mockExecute.mockResolvedValueOnce([[{ total_issues: 5, total_story_points: 15, developer_count: 1 }], []]);
      mockExecute.mockResolvedValueOnce([[{ project_key: 'TCM', issue_count: 5, story_points: 15 }], []]);
      mockExecute.mockResolvedValueOnce([[{ issue_type: 'Story', issue_count: 5 }], []]);

      const result = JSON.parse(await executeTool('queryJiraSummary', { org: 'Smartling', login: 'msogin' }));
      expect(result.totals.total_issues).toBe(5);
      expect(result.totals.developer_count).toBe(1);
    });

    it('returns error when no reports exist', async () => {
      mockLatestReport(null);
      const result = JSON.parse(await executeTool('queryJiraSummary', { org: 'Smartling' }));
      expect(result.error).toBe('No completed reports found');
    });
  });

  describe('queryOrgSummary includes jira', () => {
    it('returns jira stats in org summary', async () => {
      mockLatestReport('report-1');
      // report query
      mockExecute.mockResolvedValueOnce([[{ id: 'report-1', period_days: 14, created_at: '2026-03-14', completed_at: '2026-03-14' }], []]);
      // dev stats query
      mockExecute.mockResolvedValueOnce([[{ dev_count: 20, total_commits: 500, total_prs: 100, total_lines_added: 10000, total_lines_removed: 5000, avg_complexity: 3.5, avg_impact: 5.0, avg_pr_pct: 70, avg_ai_pct: 25 }], []]);
      // team count query
      mockExecute.mockResolvedValueOnce([[{ count: 4 }], []]);
      // jira stats query
      mockExecute.mockResolvedValueOnce([[{ total_issues: 45, total_story_points: 120, project_count: 5 }], []]);

      const result = JSON.parse(await executeTool('queryOrgSummary', { org: 'Smartling' }));
      expect(result.jira.total_issues).toBe(45);
      expect(result.jira.total_story_points).toBe(120);
      expect(result.jira.project_count).toBe(5);
    });
  });

  describe('executeTool unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = JSON.parse(await executeTool('nonexistent', { org: 'Smartling' }));
      expect(result.error).toBe('Unknown tool: nonexistent');
    });
  });
});
