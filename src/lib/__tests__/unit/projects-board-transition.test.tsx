/** @jest-environment jsdom */
/**
 * The status dropdown on the Projects board, end to end.
 *
 * Jira offers a transition to every status its workflow allows — nine on live
 * SPS — while the board shows tabs for three. The page used to record anything
 * that was neither the active nor the middle status as a move to Done, so five
 * of SPS's nine destinations landed the epic in the pending-transitions
 * registry aimed at Done. `applyPendingTransitions` prepends, and Jira's Done
 * JQL never returns a Blocked epic, so it was re-injected on every subsequent
 * fetch — "Blocked" sitting at the top of Done until a reload (PR #66 review).
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

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
    useUrlBatch: () => (fn: () => void) => fn(),
  };
});

jest.mock('@/app/auth-context', () => ({ useAuth: () => ({ canAct: true }) }));

const swrData: Record<string, unknown> = {};
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) =>
    key ? { data: swrData[key], isLoading: false, error: undefined } : { data: undefined, isLoading: false, error: undefined },
  preload: jest.fn(),
}));

jest.mock('@/app/projects/progress-ring', () => ({
  __esModule: true,
  ProgressRing: () => <div data-testid="ring" />,
}));

import ProjectsContent from '@/app/projects/projects-content';

const ORG = 'Smartling';
const SPS = {
  id: 'a', org: ORG, projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout',
  hierarchy: 'goal-initiative', position: 0, isLegacy: false,
};

const SPS_1 = {
  key: 'SPS-1', summary: 'SPS-1 summary', status: 'In Progress',
  dueDate: null, assignee: 'Someone', team: { name: 'Alpha', color: '#fff' },
  initiative: { key: 'I-1', summary: 'Init one' },
  goal: { key: 'G-1', summary: 'Goal one' },
};

// Trimmed from the live SPS payload. Note "Won't Do": Done-category without
// being named Done, and "Blocked": not Done-category despite being neither of
// the board's two named statuses.
const TRANSITIONS = [
  { id: '11', name: 'Backlog', to: { name: 'Backlog' }, toStatusCategory: 'new' },
  { id: '61', name: 'Blocked', to: { name: 'Blocked' }, toStatusCategory: 'new' },
  { id: '71', name: 'Rollout', to: { name: 'Rollout' }, toStatusCategory: 'indeterminate' },
  { id: '41', name: 'Done', to: { name: 'Done' }, toStatusCategory: 'done' },
  { id: '81', name: "Won't Do", to: { name: "Won't Do" }, toStatusCategory: 'done' },
];

const board = (tab: string) => `/api/projects?org=${ORG}&status=${tab}`;
let patched: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  for (const k of Object.keys(urlStore)) delete urlStore[k];
  for (const k of Object.keys(swrData)) delete swrData[k];
  patched = [];

  swrData['/api/orgs'] = [{ login: ORG }];
  swrData[board('active')] = { epics: [SPS_1], jiraHost: 'j.example', project: SPS };
  // Jira's own view of the other tabs: the epic is on neither, and never will
  // be for a destination the board has no tab for.
  swrData[board('middle')] = { epics: [], jiraHost: 'j.example', project: SPS };
  swrData[board('done')] = { epics: [], jiraHost: 'j.example', project: SPS };

  global.fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/jira-projects')) return { ok: true, json: async () => [SPS] };
    if (url.endsWith('/status')) {
      if (init?.method === 'PATCH') {
        patched.push({ url, body: JSON.parse(init.body ?? '{}') });
        return { ok: true, json: async () => ({ success: true, key: 'SPS-1' }) };
      }
      return { ok: true, json: async () => ({ transitions: TRANSITIONS }) };
    }
    if (url.includes('/stats?')) return { ok: true, json: async () => null };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

/**
 * Open the epic's status dropdown and return its row.
 *
 * Scoped to the row throughout, because the tab bar carries the same labels as
 * the dropdown does — an unscoped `getByText('Rollout')` clicks the tab.
 */
async function openDropdown() {
  const row = (await screen.findByText(/SPS-1 summary/)).closest('tr')!;
  fireEvent.click(within(row).getByText('In Progress'));
  // The destinations come from GET …/status, so they are not in the DOM until
  // that resolves — until then the dropdown just says "Loading...".
  await within(row).findByText('Blocked');
  return row;
}

/** Open the dropdown and pick a destination by name. */
async function transitionTo(destination: string) {
  const row = await openDropdown();
  fireEvent.click(within(row).getByText(destination));
}

/**
 * Click a tab by its label. The status dropdown closes a tick after the PATCH
 * resolves and carries the same labels the tabs do, so wait until the tab is
 * the only button with this name — `waitFor` retries the multiple-match error.
 */
async function goToTab(label: string) {
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: label })));
}

describe('transitioning an epic to a status with no tab on this board', () => {
  it('takes it off the tab in view and puts it on none of the others', async () => {
    render(<ProjectsContent /> as ReactNode);
    await transitionTo('Blocked');

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ url: '/api/projects/SPS-1/status', body: { transitionId: '61' } });

    // Gone from the active tab: its status is no longer "In Progress".
    await waitFor(() => expect(screen.queryByText(/SPS-1 summary/)).toBeNull());

    // And not injected into Done as a guess — this is the regression. Jira
    // returns an empty Done list, and that is what the user must see.
    await goToTab('Done (30d)');
    await waitFor(() => expect(screen.getByText(/no epics on the done \(30d\) tab/i)).toBeTruthy());
    expect(screen.queryByText(/SPS-1 summary/)).toBeNull();

    await goToTab('Rollout');
    await waitFor(() => expect(screen.getByText(/no epics on the rollout tab/i)).toBeTruthy());
  });

  it('still moves a genuine Done-category destination onto the Done tab', async () => {
    render(<ProjectsContent /> as ReactNode);
    await transitionTo("Won't Do");

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body).toEqual({ transitionId: '81' });

    // Done-category, so it belongs on Done even though nothing is named "Done"
    // — and Jira's index has not caught up, hence the optimistic injection.
    await goToTab('Done (30d)');
    expect(await screen.findByText(/SPS-1 summary/)).toBeTruthy();
    const row = screen.getByText(/SPS-1 summary/).closest('tr')!;
    expect(within(row).getByText("Won't Do")).toBeTruthy();
  });

  it('still moves the middle status onto the middle tab', async () => {
    render(<ProjectsContent /> as ReactNode);
    await transitionTo('Rollout');

    await goToTab('Rollout');
    expect(await screen.findByText(/SPS-1 summary/)).toBeTruthy();
  });

  it('colours each destination by the role it plays on this board', async () => {
    render(<ProjectsContent /> as ReactNode);
    const row = await openDropdown();

    const dotOf = (name: string) =>
      (within(row).getByText(name).querySelector('span') as HTMLElement).style.background;

    // Amber active, blue middle, green Done-category, grey for the rest — the
    // pre-GLOOK-38 SPS palette, now derived rather than hardcoded.
    expect(dotOf('Rollout')).toBe('rgb(59, 130, 246)');
    expect(dotOf('Done')).toBe('rgb(16, 185, 129)');
    expect(dotOf("Won't Do")).toBe('rgb(16, 185, 129)');
    expect(dotOf('Blocked')).toBe('rgb(107, 114, 128)');
    expect(dotOf('Backlog')).toBe('rgb(107, 114, 128)');
  });
});
