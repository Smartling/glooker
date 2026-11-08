/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import CanonicalCard from '@/app/settings/canonical-card';

const mockAuth: any = { canAct: true };
jest.mock('@/app/auth-context', () => ({ useAuth: () => mockAuth }));

const fetchMock = jest.fn();
const idle = { running: false, startedAt: null, finishedAt: null, currentOrg: null, orgsDone: 0, orgsTotal: 0, results: null, error: null };
const build = { org: 'acme', builtAt: '2026-11-01T10:00:00.000Z', durationMs: 4200, commitRows: 120, jiraRows: 30 };
const ok = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body });

let status: any;
let rebuildResponse: any;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockAuth.canAct = true;
  status = { builds: [build], lock: null, progress: idle };
  rebuildResponse = ok({ started: true }, 202);
  (global as any).fetch = fetchMock;
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    if (url === '/api/settings/canonical/rebuild') return rebuildResponse;
    if (url === '/api/settings/canonical/check') {
      return ok({ orgs: [{ org: 'acme', builtAt: build.builtAt,
        commits: { stored: 10, expected: 12, differ: 2, examples: ['sha1', 'sha2'] },
        jira: { stored: 5, expected: 5, differ: 0, examples: [] } }] });
    }
    return ok(status);
  });
});
afterEach(() => { jest.useRealTimers(); });

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

it('renders nothing for a viewer', async () => {
  mockAuth.canAct = false;
  const { container } = render(<CanonicalCard />);
  await flush();
  expect(container.firstChild).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows Not built yet for an org without a build', async () => {
  status = { builds: [], lock: null, progress: idle };
  render(<CanonicalCard />);
  expect(await screen.findByText(/Not built yet — range views use the slower path/)).toBeTruthy();
});

it('shows last rebuild time and duration', async () => {
  render(<CanonicalCard />);
  const expected = `Last rebuild ${new Date(build.builtAt).toLocaleString()} · took 4.2s · 120 commits, 30 issues`;
  expect(await screen.findByText(expected)).toBeTruthy();
});

it('Check shows stored, expected and differ per table with examples', async () => {
  render(<CanonicalCard />);
  await flush();
  fireEvent.click(screen.getByText('Check'));
  expect(await screen.findByText('Commits')).toBeTruthy();
  expect(screen.getByText('Jira issues')).toBeTruthy();
  for (const h of ['Stored', 'Expected', 'Differ']) expect(screen.getByText(h)).toBeTruthy();
  expect(screen.getByText('Examples: sha1, sha2')).toBeTruthy();
});

it('Rebuild asks for confirmation and Cancel sends nothing', async () => {
  render(<CanonicalCard />);
  await flush();
  fireEvent.click(screen.getByText('Rebuild'));
  expect(screen.getByText('Rebuild both tables for every org? Range views keep working during the rebuild.')).toBeTruthy();
  fireEvent.click(screen.getByText('Cancel'));
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  expect(screen.queryByText('Confirm rebuild')).toBeNull();
});

it('Confirm rebuild posts, then polls until finished', async () => {
  render(<CanonicalCard />);
  await flush();
  fireEvent.click(screen.getByText('Rebuild'));
  status = { builds: [build], lock: null, progress: { ...idle, running: true, orgsDone: 1, orgsTotal: 2 } };
  fireEvent.click(screen.getByText('Confirm rebuild'));
  await flush();
  await flush();
  expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/settings/canonical/rebuild' && i?.method === 'POST')).toBe(true);
  expect(screen.getByText('Rebuilding… 1/2 orgs')).toBeTruthy();
  expect((screen.getByText('Check') as HTMLButtonElement).disabled).toBe(true);
  status = { builds: [{ ...build, commitRows: 130 }], lock: null, progress: idle };
  await act(async () => { jest.advanceTimersByTime(2000); });
  await flush();
  await flush();
  expect(screen.queryByText(/Rebuilding…/)).toBeNull();
  expect(screen.getByText(/130 commits, 30 issues/)).toBeTruthy();
});

it('shows rebuild already running on 409', async () => {
  rebuildResponse = ok({ error: 'rebuild already running' }, 409);
  render(<CanonicalCard />);
  await flush();
  fireEvent.click(screen.getByText('Rebuild'));
  fireEvent.click(screen.getByText('Confirm rebuild'));
  await waitFor(() => expect(screen.getByText('rebuild already running')).toBeTruthy());
});
