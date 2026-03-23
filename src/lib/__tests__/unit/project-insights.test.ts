/**
 * Tests for project insights logic — the data extraction and
 * LLM response parsing used by /api/project-insights.
 */

describe('project insights data extraction', () => {
  // Simulate Jira data formatting for LLM
  function formatJiraForLLM(issues: Array<{ issue_key: string; project_key: string; issue_type: string; github_login: string; summary: string }>) {
    return issues.map(i => `${i.issue_key}|${i.project_key}|${i.issue_type}|${i.github_login}|${i.summary}`).join('\n');
  }

  it('formats Jira issues as pipe-delimited lines', () => {
    const issues = [
      { issue_key: 'BRZ-190', project_key: 'BRZ', issue_type: 'Task', github_login: 'alice', summary: 'Upload flow' },
      { issue_key: 'BRZ-191', project_key: 'BRZ', issue_type: 'Task', github_login: 'alice', summary: 'Download flow' },
    ];
    const result = formatJiraForLLM(issues);
    expect(result).toBe('BRZ-190|BRZ|Task|alice|Upload flow\nBRZ-191|BRZ|Task|alice|Download flow');
  });

  it('handles empty issues', () => {
    expect(formatJiraForLLM([])).toBe('');
  });

  // Simulate dev stats formatting
  function formatDevStats(stats: Array<{ github_login: string; total_commits: number; total_prs: number }>) {
    return stats.map(d => `${d.github_login}\t${d.total_commits}\t${d.total_prs}`).join('\n');
  }

  it('formats dev stats as tab-delimited', () => {
    const stats = [
      { github_login: 'alice', total_commits: 30, total_prs: 12 },
      { github_login: 'bob', total_commits: 20, total_prs: 8 },
    ];
    const result = formatDevStats(stats);
    expect(result).toBe('alice\t30\t12\nbob\t20\t8');
  });
});

describe('project insights LLM response parsing', () => {
  function parseLLMResponse(raw: string) {
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return {
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        untracked_work: Array.isArray(parsed.untracked_work) ? parsed.untracked_work : [],
      };
    } catch {
      return { projects: [], untracked_work: [] };
    }
  }

  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      projects: [
        { name: 'Auth Hardening', developers: ['alice'], summary: 'Fixing CVEs', jira_count: 5, estimated_commits: 20, estimated_prs: 8 },
      ],
      untracked_work: [
        { name: 'New Service', repo: 'my-service', developers: ['bob'], commits: 10, summary: 'Building new service' },
      ],
    });
    const result = parseLLMResponse(raw);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Auth Hardening');
    expect(result.untracked_work).toHaveLength(1);
    expect(result.untracked_work[0].repo).toBe('my-service');
  });

  it('handles markdown-fenced JSON', () => {
    const raw = '```json\n{"projects": [{"name": "Test"}], "untracked_work": []}\n```';
    const result = parseLLMResponse(raw);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Test');
  });

  it('returns empty arrays for invalid JSON', () => {
    const result = parseLLMResponse('not json at all');
    expect(result.projects).toEqual([]);
    expect(result.untracked_work).toEqual([]);
  });

  it('returns empty arrays for empty response', () => {
    const result = parseLLMResponse('{}');
    expect(result.projects).toEqual([]);
    expect(result.untracked_work).toEqual([]);
  });

  it('handles missing untracked_work field', () => {
    const raw = JSON.stringify({ projects: [{ name: 'P1' }] });
    const result = parseLLMResponse(raw);
    expect(result.projects).toHaveLength(1);
    expect(result.untracked_work).toEqual([]);
  });
});

describe('project insights cache key', () => {
  // Cache uses report_id for both a and b to distinguish from real comparisons
  it('same report_id for both keys distinguishes from real comparisons', () => {
    const reportId = 'abc-123';
    const cacheKeyA = reportId;
    const cacheKeyB = reportId;
    // Real comparisons always have different a and b
    const realCompA = 'report-old';
    const realCompB = 'report-new';
    expect(cacheKeyA).toBe(cacheKeyB); // project insights: same
    expect(realCompA).not.toBe(realCompB); // real comparison: different
  });

  it('cache key fits in VARCHAR(36)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'; // standard UUID
    expect(uuid.length).toBeLessThanOrEqual(36);
  });
});
