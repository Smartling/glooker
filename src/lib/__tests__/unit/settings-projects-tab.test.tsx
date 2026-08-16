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
