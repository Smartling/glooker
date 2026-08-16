'use client';

import { useState, useEffect } from 'react';
import type { JiraProject, BoardHierarchy } from '@/lib/jira-projects/types';

const HIERARCHY_LABEL: Record<BoardHierarchy, string> = {
  'goal-initiative': 'Goal and initiative',
  owner: 'Person',
};

export default function ProjectsTab({ org }: { org: string }) {
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<JiraProject | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState('');
  const [middle, setMiddle] = useState('');
  const [hierarchy, setHierarchy] = useState<BoardHierarchy>('goal-initiative');

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [org]);

  function load() {
    fetch(`/api/jira-projects?org=${encodeURIComponent(org)}`)
      .then(r => r.json())
      .then((list: JiraProject[]) => setProjects(Array.isArray(list) ? list : []))
      .catch(() => {});
  }

  function reset() {
    setKey(''); setName(''); setActive(''); setMiddle('');
    setHierarchy('goal-initiative'); setEditing(null); setError(null);
  }

  function openNew() { reset(); setShowForm(true); }

  function openEdit(p: JiraProject) {
    setEditing(p);
    setKey(p.projectKey);
    setName(p.displayName);
    setActive(p.activeStatus);
    setMiddle(p.middleStatus ?? '');
    setHierarchy(p.hierarchy);
    setError(null);
    setShowForm(true);
  }

  async function save() {
    setError(null);
    const fields = {
      projectKey: key,
      displayName: name,
      activeStatus: active,
      middleStatus: middle.trim() === '' ? null : middle,
      hierarchy,
      position: editing ? editing.position : projects.length,
    };
    const url = editing ? `/api/jira-projects/${editing.id}` : '/api/jira-projects';
    const method = editing ? 'PUT' : 'POST';
    const body = editing ? fields : { org, ...fields };
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Failed to save project');
        return;
      }
      load();
      setShowForm(false);
      reset();
    } catch {
      setError('Network error');
    }
  }

  async function del(id: string) {
    await fetch(`/api/jira-projects/${id}`, { method: 'DELETE' }).catch(() => {});
    setDeletingId(null);
    if (editing?.id === id) { setShowForm(false); reset(); }
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          Jira projects available on the Projects board. Each one names the statuses its tabs show.
        </p>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          Add project
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900/50 text-gray-400 text-left text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Key</th>
              <th className="px-4 py-3 font-medium">Active tab</th>
              <th className="px-4 py-3 font-medium">Middle tab</th>
              <th className="px-4 py-3 font-medium">Group by</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3 text-white">{p.displayName}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{p.projectKey}</td>
                <td className="px-4 py-3 text-gray-300">{p.activeStatus}</td>
                <td className="px-4 py-3 text-gray-300">
                  {p.middleStatus ?? <span className="text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-300">{HIERARCHY_LABEL[p.hierarchy]}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(p)} className="text-xs text-gray-500 hover:text-gray-300">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-gray-500 text-sm">
                  No Jira projects configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="mt-6 rounded-lg border border-gray-800 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="jp-key" className="block text-xs text-gray-400 mb-1">Project key</label>
              <input
                id="jp-key" type="text" value={key} onChange={e => setKey(e.target.value)}
                placeholder="RND"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="jp-name" className="block text-xs text-gray-400 mb-1">Display name</label>
              <input
                id="jp-name" type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="LanguageAI Research"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="jp-active" className="block text-xs text-gray-400 mb-1">Active status</label>
              <input
                id="jp-active" type="text" value={active} onChange={e => setActive(e.target.value)}
                placeholder="In Progress"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                The exact Jira status name, not a status category.
              </p>
            </div>
            <div>
              <label htmlFor="jp-middle" className="block text-xs text-gray-400 mb-1">Middle status</label>
              <input
                id="jp-middle" type="text" value={middle} onChange={e => setMiddle(e.target.value)}
                placeholder="Rollout"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
              <p className="text-[11px] text-gray-600 mt-1">Leave blank for a two-tab board.</p>
            </div>
            <div>
              <label htmlFor="jp-hierarchy" className="block text-xs text-gray-400 mb-1">Group rows by</label>
              <select
                id="jp-hierarchy" value={hierarchy}
                onChange={e => setHierarchy(e.target.value as BoardHierarchy)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="goal-initiative">Goal and initiative</option>
                <option value="owner">Person</option>
              </select>
            </div>
          </div>

          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

          <div className="flex gap-3 mt-5">
            <button
              onClick={save}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => { setShowForm(false); reset(); }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            {editing && deletingId !== editing.id && (
              <button
                onClick={() => setDeletingId(editing.id)}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Delete
              </button>
            )}
          </div>

          {editing && deletingId === editing.id && (
            <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950 border border-red-800">
              <p className="text-red-300 text-xs mb-2">Remove this project from the board?</p>
              <div className="flex gap-2">
                <button onClick={() => del(editing.id)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded">Delete</button>
                <button onClick={() => setDeletingId(null)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
