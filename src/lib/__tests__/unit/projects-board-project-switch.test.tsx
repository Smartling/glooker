/** @jest-environment jsdom */
/**
 * Page-level behaviour of the Projects board: what happens when the selected
 * project changes, and what the user is told when the board fetch fails.
 *
 * Two pieces of state on that page are keyed by epic key alone rather than by
 * board, so both leaked across a project switch (PR #66 review): the ring-stats
 * map, whose two derived aggregates then mix two boards' numbers, and the
 * filters, which name goals/initiatives/teams that do not exist on the board
 * the user just switched to.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// --- url-state: a plain in-memory store, so the assertions are about the
// component's own reset logic rather than about Next's router. --------------
const urlStore: Record<string, unknown> = {};
jest.mock('@/lib/url-state', () => {
  const React = require('react');
  return {
    __esModule: true,
    useUrlState: (schema: { key: string; default: unknown }) => {
      const [, bump] = React.useReducer((c: number) => c + 1, 0);
      const set = React.useCallback((next: unknown) => {
        urlStore[schema.key] = next;
        bump();
      }, [schema.key]);
      return [urlStore[schema.key] ?? schema.default, set];
    },
    // Real batching only coalesces URL writes; running the callback inline is
    // behaviourally identical for the state the component reads back.
    useUrlBatch: () => (fn: () => void) => fn(),
  };
});

jest.mock('@/app/auth-context', () => ({ useAuth: () => ({ canAct: true }) }));

// --- swr: key-addressed fixtures, resolved synchronously. -------------------
const swrData: Record<string, unknown> = {};
const swrErrors: Record<string, Error> = {};
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => key
    ? { data: swrData[key], isLoading: false, error: swrErrors[key] }
    : { data: undefined, isLoading: false, error: undefined },
  preload: jest.fn(),
}));

// The ring itself is not under test — surface the two page-wide aggregates it
// is handed, which is where a leaked ringStats map actually does its damage.
jest.mock('@/app/projects/progress-ring', () => ({
  __esModule: true,
  ProgressRing: ({ maxVolume, avgCommitsPerJira }: { maxVolume: number; avgCommitsPerJira: number }) => (
    <div data-testid="ring" data-max={String(maxVolume)} data-avg={String(avgCommitsPerJira)} />
  ),
}));

import ProjectsContent from '@/app/projects/projects-content';

const SPS = {
  id: 'a', org: 'Smartling', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout',
  hierarchy: 'goal-initiative', position: 0, isLegacy: false,
};
const RND = {
  ...SPS, id: 'b', projectKey: 'RND', displayName: 'LanguageAI Research',
  middleStatus: null, position: 1,
};

const epic = (key: string, goal: string) => ({
  key, summary: `${key} summary`, status: 'In Progress',
  dueDate: null, assignee: 'Someone', team: { name: 'Alpha', color: '#fff' },
  initiative: { key: `${key}-I`, summary: `Init ${key}` },
  goal: { key: `${key}-G`, summary: goal },
});

// A busy epic on SPS and a quiet one on RND. If ringStats survives the switch,
// RND's ring is scaled against SPS's volume and measured against the blend of
// both boards' commit rates.
const BUSY = {
  epicKey: 'SPS-1', totalJiras: 40, resolvedJiras: 20, remainingJiras: 20,
  commitCount: 400, devCount: 5, linesAdded: 10, linesRemoved: 5, repos: [], cached: true,
};
const QUIET = {
  epicKey: 'RND-1', totalJiras: 2, resolvedJiras: 1, remainingJiras: 1,
  commitCount: 2, devCount: 1, linesAdded: 1, linesRemoved: 0, repos: [], cached: true,
};

const ORG = 'Smartling';
const boardUrl = (projectKey?: string) =>
  `/api/projects?org=${ORG}&status=active` + (projectKey ? `&project=${projectKey}` : '');

const statsFor: Record<string, unknown> = {
  [`/api/projects/SPS-1/stats?org=${ORG}`]: BUSY,
  [`/api/projects/RND-1/stats?org=${ORG}`]: QUIET,
};

const statsCalls: string[] = [];

beforeEach(() => {
  for (const k of Object.keys(urlStore)) delete urlStore[k];
  for (const k of Object.keys(swrData)) delete swrData[k];
  for (const k of Object.keys(swrErrors)) delete swrErrors[k];
  statsCalls.length = 0;

  swrData['/api/orgs'] = [{ login: ORG }];
  // The board answers the same for the implicit (server-picked) SPS key and
  // the explicit one, exactly as the route does.
  swrData[boardUrl()] = { epics: [epic('SPS-1', 'Platform goal')], jiraHost: 'j.example', project: SPS };
  swrData[boardUrl('SPS')] = swrData[boardUrl()];
  swrData[boardUrl('RND')] = { epics: [epic('RND-1', 'Research goal')], jiraHost: 'j.example', project: RND };

  global.fetch = jest.fn(async (url: string) => {
    if (url.startsWith('/api/jira-projects')) {
      return { ok: true, json: async () => [SPS, RND] };
    }
    if (url.includes('/stats?')) {
      statsCalls.push(url);
      return { ok: true, json: async () => statsFor[url] ?? null };
    }
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

/**
 * Pick the project from the board's project selector, waiting for the option to
 * exist first — the list arrives from `/api/jira-projects` independently of the
 * board response, and `change` on a select with no matching option is a no-op.
 */
async function selectProject(key: string) {
  const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  await waitFor(() => expect(select.querySelector(`option[value="${key}"]`)).not.toBeNull());
  fireEvent.change(select, { target: { value: key } });
}

function ring() {
  return screen.getByTestId('ring');
}

describe('switching the selected project', () => {
  it('rescales the rings against the new board alone', async () => {
    render(<ProjectsContent /> as ReactNode);
    await screen.findByText(/SPS-1 summary/);
    // SPS's own aggregates: log(400 + 40 + 1) and 400 commits / 40 jiras.
    await waitFor(() => expect(ring().getAttribute('data-max')).toBe(String(Math.log(441))));
    expect(ring().getAttribute('data-avg')).toBe('10');

    await selectProject('RND');
    await screen.findByText(/RND-1 summary/);

    // RND alone: log(2 + 2 + 1) and 2 commits / 2 jiras. Before the fix these
    // stayed at SPS's log(441) and 10 — a two-commit epic drawn as if it were
    // 5% of the way to a 400-commit board's expectations.
    await waitFor(() => expect(ring().getAttribute('data-avg')).toBe('1'));
    expect(ring().getAttribute('data-max')).toBe(String(Math.log(5)));
  });

  it('drops the previous board\'s entries rather than keeping them cached', async () => {
    // The fetch effect skips any epic already in `ringStats`, so re-fetching
    // SPS-1 on the way back is the observable proof that its entry was dropped
    // when the board changed — and therefore was not in the map while RND's
    // aggregates were being computed.
    const sps1 = `/api/projects/SPS-1/stats?org=${ORG}`;
    render(<ProjectsContent /> as ReactNode);
    await waitFor(() => expect(statsCalls.filter(u => u === sps1)).toHaveLength(1));

    await selectProject('RND');
    await waitFor(() => expect(statsCalls).toContain(`/api/projects/RND-1/stats?org=${ORG}`));

    await selectProject('SPS');
    await waitFor(() => expect(statsCalls.filter(u => u === sps1)).toHaveLength(2));
  });

  it('clears the goal, initiative, team and search filters', async () => {
    render(<ProjectsContent /> as ReactNode);
    await screen.findByText(/SPS-1 summary/);

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'platform' } });
    // The filter selects follow the project selector: goal, initiative, team.
    const [, goalSel, initSel, teamSel] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(goalSel, { target: { value: 'Platform goal' } });
    fireEvent.change(initSel, { target: { value: 'Init SPS-1' } });
    fireEvent.change(teamSel, { target: { value: 'Alpha' } });
    expect(urlStore).toMatchObject({ q: 'platform', goal: 'Platform goal', initiative: 'Init SPS-1', team: 'Alpha' });

    await selectProject('RND');

    // A goal from SPS matches nothing on RND, so carrying it over renders
    // "No epics match the selected filters" with the cause out of sight.
    await waitFor(() => expect(urlStore.goal).toBe(''));
    expect(urlStore.initiative).toBe('');
    expect(urlStore.team).toBe('');
    expect(urlStore.q).toBe('');
    expect(await screen.findByText(/RND-1 summary/)).toBeTruthy();
  });

  it('keeps the filters across a tab switch of the same board', async () => {
    swrData[`/api/projects?org=${ORG}&status=middle&project=SPS`] = {
      epics: [epic('SPS-2', 'Platform goal')], jiraHost: 'j.example', project: SPS,
    };
    render(<ProjectsContent /> as ReactNode);
    await screen.findByText(/SPS-1 summary/);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'platform' } });

    fireEvent.click(screen.getByText('Rollout'));

    await waitFor(() => expect(urlStore.status).toBe('middle'));
    expect(urlStore.q).toBe('platform');
  });

  it('does not wipe filters carried in on a deep link, before any switch', async () => {
    // `?project=RND&goal=…` has to survive the first render — the reset keys
    // off an actual change, not off the effect firing.
    urlStore.project = 'RND';
    urlStore.goal = 'Research goal';
    render(<ProjectsContent /> as ReactNode);
    await screen.findByText(/RND-1 summary/);
    expect(urlStore.goal).toBe('Research goal');
  });
});

describe('a failed board fetch', () => {
  it('shows the API\'s own message, not a bare status code', async () => {
    // The normal first-run state of a fresh deployment. The shared fetcher lifts
    // `{ error: … }` out of the response body; before that this read
    // "Error: 404" and told the admin nothing about what to do.
    const apiError = 'No Jira projects configured. Add one in Settings \u2192 Projects.';
    delete swrData[boardUrl()];
    swrErrors[boardUrl()] = new Error(apiError);

    render(<ProjectsContent /> as ReactNode);
    expect(await screen.findByText(`Error: ${apiError}`)).toBeTruthy();
  });
});
