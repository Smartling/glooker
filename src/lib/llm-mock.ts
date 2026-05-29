/**
 * Mock LLM provider. Duck-typed OpenAI client that returns static fixture
 * responses based on __prompt_id. No network calls, instant responses.
 */

const FIXTURES: Record<string, string> = {
  'analyzer-system': JSON.stringify({
    complexity: 5,
    type: 'feature',
    impact_summary: 'Adds mock feature implementation with tests',
    risk_level: 'low',
    maybe_ai: false,
  }),
  'analyzer-system-ai-confirmed': JSON.stringify({
    complexity: 4,
    type: 'feature',
    impact_summary: 'AI-assisted feature implementation',
    risk_level: 'low',
    maybe_ai: false,
  }),
  'epic-summary-system': 'This epic made strong progress with 5 issues resolved. The team completed the core auth migration and rate limiting middleware. Two issues remain for edge-case handling and documentation.',
  'untracked-work-system': JSON.stringify({
    groups: [
      { name: 'CI/CD Improvements', summary: 'Pipeline optimization and caching', commitCount: 3, repos: [], linesAdded: 120, linesRemoved: 45 },
      { name: 'Bug Fixes', summary: 'Various production bug fixes', commitCount: 2, repos: [], linesAdded: 30, linesRemoved: 15 },
    ],
  }),
  'report-summary-system': JSON.stringify({
    summary: 'A productive period focused on platform stability and feature delivery. Contributed 15 commits across 3 repositories with an average complexity of 5.2. Demonstrated strong code review discipline with 90% of changes going through PRs.',
    badges: [
      { label: 'PR Champion', description: 'High PR discipline rate' },
      { label: 'Polyglot', description: 'Active across multiple repositories' },
    ],
  }),
  'report-highlights-system': JSON.stringify({
    highlights: [
      'Overall team velocity increased 15% compared to previous period',
      'Average commit complexity rose from 4.1 to 5.3, indicating more impactful work',
      'AI-assisted commits grew from 8% to 12% of total output',
    ],
  }),
  'chat-agent-system': 'Based on the report data, the team had a productive sprint with 8 active contributors. The highest impact came from platform infrastructure work.',
  'team-pulse-system': '## Activity Changes\n- @dev1 up 40% in commits, focused on api-service\n- @dev2 steady output, shifted from frontend to infra\n\n## Silent Members\n- @dev3 had zero commits in current window. 2 PR reviews noted.\n\n## Team Focus (Past 2 Days)\n- Primary repos: api-service, web-app\n- Mix of feature and bug-fix work\n- 3 PRs merged, 2 Jira tickets resolved\n\n## Alerts\n- @dev3 went silent after active prior window — check in recommended.',
  'team-pulse-projects': JSON.stringify({
    projects: [
      {
        name: 'Multi-tenant Jobs UI',
        summary: 'Refactor of the jobs list page to support per-tenant filtering',
        // Developers listed broadly across the seed team rosters in
        // scripts/mock-identities.ts. The validator in projects.ts intersects
        // this with the request's team_members, so only matching logins remain.
        developers: ['alice-mock', 'bob-mock', 'carol-mock', 'dave-mock', 'eve-mock', 'frank-mock'],
        jira_count: 4,
        estimated_commits: 14,
        estimated_prs: 5,
        last_activity: '2026-05-25T14:00:00Z',
      },
      {
        name: 'Auth Token Cleanup',
        summary: 'Migration off legacy session tokens to OIDC-only flow',
        developers: ['alice-mock', 'bob-mock', 'carol-mock', 'dave-mock', 'eve-mock', 'frank-mock'],
        jira_count: 2,
        estimated_commits: 6,
        estimated_prs: 2,
        last_activity: '2026-05-22T09:30:00Z',
      },
    ],
  }),
  'llm-config-test-system': 'OK',
};

const FALLBACK = 'Mock LLM response — no fixture matched for this prompt.';

export function createMockLLMClient() {
  return {
    chat: {
      completions: {
        async create(params: {
          messages: { role: string; content: string }[];
          model: string;
          __prompt_id?: string;
          [key: string]: unknown;
        }) {
          const promptId = params.__prompt_id || '';
          const content = FIXTURES[promptId] || FALLBACK;

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content,
                },
              },
            ],
          };
        },
      },
    },
  };
}
