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

it('shows an explanatory message for an unmapped developer and fetches nothing', async () => {
  mockAuth.user = { email: 'ghost@x.com', githubLogin: null, name: 'Ghost', role: 'viewer' };
  render(<ProfileContent />);

  expect(await screen.findByText(/No Claude Code usage/i)).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
