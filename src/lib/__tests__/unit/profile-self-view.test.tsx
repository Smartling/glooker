/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import ProfileContent from '@/app/profile/profile-content';

const mockAuth: any = { loading: false, user: null };
jest.mock('@/app/auth-context', () => ({ useAuth: () => mockAuth }));

const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = fetchMock;
  mockAuth.loading = false;
  mockAuth.user = { email: 'alice@x.com', githubLogin: 'alice', name: 'Alice', role: 'viewer' };
});

const jsonOnce = (body: any) => ({ ok: true, status: 200, json: async () => body });

function wireHappyPath() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/report') {
      return jsonOnce([{ id: 'r1', status: 'completed' }]) as any;
    }
    return jsonOnce({
      developer: { cc_total_cost: 12345, cc_requests: 42, cc_skills_used: 12 },
      skills: [{ product: 'cowork', skills_used: 12, skills_distinct: 4 }],
      models: [{ model: 'claude-sonnet-5', cost: 500, requests: 20 }],
    }) as any;
  });
}

it('requests the dev report for the authenticated login only', async () => {
  wireHappyPath();
  render(<ProfileContent />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/report/r1/dev/alice'));

  // Nothing may request another developer's data through this path.
  const urls = fetchMock.mock.calls.map(c => String(c[0]));
  expect(urls.filter(u => u.includes('/dev/'))).toEqual(['/api/report/r1/dev/alice']);
});

it('renders own spend, requests, skills and models', async () => {
  wireHappyPath();
  render(<ProfileContent />);

  expect(await screen.findByText('$123.45')).toBeTruthy();
  expect(await screen.findByText('42')).toBeTruthy();
  expect(await screen.findByText('cowork')).toBeTruthy();
  expect(await screen.findByText(/12 used/)).toBeTruthy();
  expect(await screen.findByText('claude-sonnet-5')).toBeTruthy();
  expect(await screen.findByText(/\$5\.00/)).toBeTruthy();
});

it('omits per-model cost when the payload has none (gated away)', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/report') return jsonOnce([{ id: 'r1', status: 'completed' }]) as any;
    return jsonOnce({
      developer: { cc_skills_used: 0 },
      skills: [],
      models: [{ model: 'claude-sonnet-5', requests: 20 }],   // no `cost` key
    }) as any;
  });
  render(<ProfileContent />);

  expect(await screen.findByText('claude-sonnet-5')).toBeTruthy();
  expect(await screen.findByText(/20 req/)).toBeTruthy();
  expect(screen.queryByText(/\$/)).toBeNull();
});

it('renders a model with cost and requests both stripped without printing undefined or NaN', async () => {
  // The real shape stripModelCost can produce: it deletes `cost` and `requests`
  // atomically, so `{ model }` alone (neither field present) is a payload the
  // route can actually emit — unlike `{ model, requests }` used elsewhere in
  // this file, which stripModelCost never produces on its own.
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/report') return jsonOnce([{ id: 'r1', status: 'completed' }]) as any;
    return jsonOnce({
      developer: { cc_skills_used: 0 },
      skills: [],
      models: [{ model: 'claude-sonnet-5' }],   // no `cost`, no `requests`
    }) as any;
  });
  render(<ProfileContent />);

  expect(await screen.findByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.queryByText(/undefined|NaN|\$/)).toBeNull();
});

it('does not treat a failed /api/report as "no usage" by attempting to parse it', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/report') {
      return { ok: false, status: 500, json: async () => { throw new Error('should not be parsed'); } } as any;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  render(<ProfileContent />);

  // Resolves to the same empty-state copy (a distinct error message is a
  // separate, deferred follow-up), but critically never attempts .json() on
  // the failed response and never requests a dev report at all.
  expect(await screen.findByText(/No Claude Code usage/i)).toBeTruthy();
  expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual(['/api/report']);
});

it('falls back to the next completed report when the newest 404s for this developer', async () => {
  // Simulates a multi-org install where the newest completed report belongs
  // to an org this developer isn't in: the dev-report call 404s for r1, so
  // the fetch chain must walk forward to r2 rather than giving up.
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/report') {
      return jsonOnce([
        { id: 'r1', status: 'completed' },
        { id: 'r2', status: 'completed' },
      ]) as any;
    }
    if (url === '/api/report/r1/dev/alice') {
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }
    if (url === '/api/report/r2/dev/alice') {
      return jsonOnce({
        developer: { cc_total_cost: 500, cc_requests: 5, cc_skills_used: 0 },
        skills: [],
        models: [],
      }) as any;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  render(<ProfileContent />);

  expect(await screen.findByText('$5.00')).toBeTruthy();
  expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
    '/api/report',
    '/api/report/r1/dev/alice',
    '/api/report/r2/dev/alice',
  ]);
});

it('shows an explanatory message for an unmapped developer and fetches nothing', async () => {
  mockAuth.user = { email: 'ghost@x.com', githubLogin: null, name: 'Ghost', role: 'viewer' };
  render(<ProfileContent />);

  expect(await screen.findByText(/No Claude Code usage/i)).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not flash the empty state when auth resolves to a mapped user with data in flight', async () => {
  // Start in the auth-loading state — no user yet.
  mockAuth.loading = true;
  mockAuth.user = null;
  wireHappyPath();
  const { rerender } = render(<ProfileContent />);

  // Auth resolves: `loading` flips to false and `githubLogin` becomes available
  // in the very same update — exactly how the real SWR-backed AuthProvider behaves.
  mockAuth.loading = false;
  mockAuth.user = { email: 'alice@x.com', githubLogin: 'alice', name: 'Alice', role: 'viewer' };
  rerender(<ProfileContent />);

  // Immediately after that transition, the dev-report fetch is still in flight.
  // The developer DOES have usage data — the empty-state message must never appear.
  expect(screen.queryByText(/No Claude Code usage/i)).toBeNull();

  // Once the fetch resolves, the real data renders, and the empty state still never appeared.
  expect(await screen.findByText('$123.45')).toBeTruthy();
  expect(screen.queryByText(/No Claude Code usage/i)).toBeNull();
});
