// GLOOK-11 T7: cache-hit projects deserialization in getTeamPulse.
//
// Targets the cache-hit branch in src/lib/team-pulse/service.ts:
//   - SELECT now returns `projects` column
//   - legacy rows where projects = NULL still return projects: []
//   - rows where projects is a JSON string deserialize into TeamProject[]
//
// Mocks @/lib/db so we never touch a real DB; LLM is not exercised
// because the cache-hit branch returns before any LLM call.

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

// LLM provider is imported transitively via service.ts; mock so the
// module loads cleanly even though the cache-hit path never calls it.
jest.mock('@/lib/llm-provider', () => ({
  __esModule: true,
  getLLMClient: jest.fn(),
  LLM_MODEL: 'mock-model',
  extraBodyProps: () => ({}),
  tokenLimit: () => ({ max_tokens: 1024 }),
  promptTag: (n: string) => ({ __prompt_id: n }),
}));

import db from '@/lib/db';
import { getTeamPulse } from '@/lib/team-pulse/service';

const mockedExecute = (db as unknown as { execute: jest.Mock }).execute;

describe('getTeamPulse — projects field (GLOOK-11)', () => {
  beforeEach(() => mockedExecute.mockReset());

  it('returns projects: [] when cache row has projects = NULL (legacy row)', async () => {
    mockedExecute.mockResolvedValueOnce([
      [
        {
          summary_text: 'cached summary',
          health_json: JSON.stringify({ activeRatio: '2/3', trending: '+10%', trendDirection: 'up' }),
          projects: null,
          generated_at: '2026-05-25T00:00:00Z',
        },
      ],
      {},
    ]);

    const result = await getTeamPulse('r1', 'Alpha', 'Smartling', ['alice']);

    expect(result.projects).toEqual([]);
    expect(result.cached).toBe(true);
    expect(result.summary).toBe('cached summary');
    expect(result.health.activeRatio).toBe('2/3');
  });

  it('deserializes projects from the cache row when present (string JSON)', async () => {
    const cachedProjects = JSON.stringify([
      {
        name: 'P1',
        summary: 's',
        developers: ['alice'],
        jira_count: 0,
        estimated_commits: 1,
        estimated_prs: 1,
        last_activity: '2026-05-20T10:00:00Z',
      },
    ]);

    mockedExecute.mockResolvedValueOnce([
      [
        {
          summary_text: 'cached summary 2',
          health_json: JSON.stringify({ activeRatio: '3/3', trending: '+5%', trendDirection: 'stable' }),
          projects: cachedProjects,
          generated_at: '2026-05-25T00:00:00Z',
        },
      ],
      {},
    ]);

    const result = await getTeamPulse('r1', 'Alpha', 'Smartling', ['alice']);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('P1');
    expect(result.projects[0].developers).toEqual(['alice']);
    expect(result.cached).toBe(true);
  });
});
