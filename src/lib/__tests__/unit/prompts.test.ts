import { loadPrompt, clearPromptCache } from '@/lib/prompt-loader';

describe('team-pulse-projects prompt template', () => {
  beforeEach(() => clearPromptCache());

  it('renders with substituted placeholders', () => {
    const out = loadPrompt('team-pulse-projects.txt', {
      TEAM_NAME: 'Alpha',
      TEAM_MEMBERS_JSON: '["alice","bob"]',
      COMMITS_JSON: '[]',
      JIRA_ISSUES_JSON: '[]',
      IN_FLIGHT_BLOCK: '',
    });
    expect(out).toMatchSnapshot();
    // Verify no leftover {{...}} placeholders
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
