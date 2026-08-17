/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectsTab from '@/app/settings/projects-tab';

const list = [
  { id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform', activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0 },
  { id: 'b', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research', activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1 },
];

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => list }) as any;
});

describe('ProjectsTab', () => {
  it('lists the configured projects', async () => {
    render(<ProjectsTab org="o" />);
    expect(await screen.findByText('Smartling Platform')).toBeTruthy();
    expect(screen.getByText('LanguageAI Research')).toBeTruthy();
  });

  it('shows each project key and its tab statuses', async () => {
    render(<ProjectsTab org="o" />);
    expect(await screen.findByText('RND')).toBeTruthy();
    expect(screen.getAllByText('Backlog').length).toBeGreaterThan(0);
  });

  it('loads from the jira-projects API scoped to the org', async () => {
    render(<ProjectsTab org="o" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/jira-projects?org=o');
  });

  it('opens an empty form when adding a project', async () => {
    render(<ProjectsTab org="o" />);
    fireEvent.click(await screen.findByText(/add project/i));
    const key = screen.getByLabelText(/project key/i) as HTMLInputElement;
    expect(key.value).toBe('');
  });

  it('surfaces a failed list load instead of showing an empty table', async () => {
    // A session that lapsed to viewer gets a 403 here. Swallowed, it reads as
    // "no projects configured" — the opposite of what happened.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false, status: 403, json: async () => ({ error: 'Forbidden' }),
    });
    render(<ProjectsTab org="o" />);
    expect(await screen.findByText('Forbidden')).toBeTruthy();
  });

  it('reports a failed delete and leaves the confirm panel open', async () => {
    render(<ProjectsTab org="o" />);
    fireEvent.click((await screen.findAllByText(/^edit$/i))[0]);  // first row: SPS
    fireEvent.click(screen.getByText(/^delete$/i));  // arm the confirm panel
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false, status: 403, json: async () => ({ error: 'Forbidden' }),
    });
    // Arming swaps the toolbar's Delete for the confirm panel's, so there is
    // still exactly one on screen — the one that actually fires the request.
    fireEvent.click(screen.getByText(/^delete$/i));

    expect(await screen.findByText('Forbidden')).toBeTruthy();
    // Still armed, so the admin can retry rather than assuming it worked.
    expect(screen.getByText(/remove this project from the board\?/i)).toBeTruthy();
  });

  it('closes the confirm panel and reloads on a successful delete', async () => {
    render(<ProjectsTab org="o" />);
    fireEvent.click((await screen.findAllByText(/^edit$/i))[0]);
    fireEvent.click(screen.getByText(/^delete$/i));
    expect(screen.getByText(/remove this project from the board\?/i)).toBeTruthy();

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ deleted: true }) });
    fireEvent.click(screen.getByText(/^delete$/i));

    await waitFor(() =>
      expect(screen.queryByText(/remove this project from the board\?/i)).toBeNull());
    const urls = (global.fetch as jest.Mock).mock.calls.map(c => `${c[0]} ${c[1]?.method ?? 'GET'}`);
    expect(urls).toContain('/api/jira-projects/a DELETE');
    // The list is re-read afterwards, so the row disappears without a refresh.
    expect(urls.filter(u => u.startsWith('/api/jira-projects?org=o')).length).toBeGreaterThan(1);
  });

  it('surfaces a 400 message inline instead of throwing', async () => {
    render(<ProjectsTab org="o" />);
    fireEvent.click(await screen.findByText(/add project/i));
    fireEvent.change(screen.getByLabelText(/project key/i), { target: { value: 'bad key' } });
    fireEvent.change(screen.getByLabelText(/active status/i), { target: { value: 'In Progress' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ error: 'projectKey is not a valid Jira project key: bad key' }),
    });
    fireEvent.click(screen.getByText(/^save$/i));
    expect(await screen.findByText(/not a valid Jira project key/i)).toBeTruthy();
  });
});
