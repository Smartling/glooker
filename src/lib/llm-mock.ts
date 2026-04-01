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
  'untracked-work-system': JSON.stringify([
    { name: 'CI/CD Improvements', summary: 'Pipeline optimization and caching', commitCount: 3, repos: ['infra-config'], linesAdded: 120, linesRemoved: 45 },
    { name: 'Bug Fixes', summary: 'Various production bug fixes', commitCount: 2, repos: ['api-service'], linesAdded: 30, linesRemoved: 15 },
  ]),
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
