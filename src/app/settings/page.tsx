'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '../theme-context';
import { THEMES, type ThemeColors } from '../themes';
import { useAuth } from '../auth-context';

type Tab = 'schedules' | 'teams' | 'app' | 'appearance';

const CADENCE_PRESETS = [
  { label: 'Every hour',           cron: '0 * * * *' },
  { label: 'Daily at midnight',    cron: '0 0 * * *' },
  { label: 'Daily at 9 AM',        cron: '0 9 * * *' },
  { label: 'Weekdays at 9 AM',     cron: '0 9 * * 1-5' },
  { label: 'Weekly (Monday 9 AM)', cron: '0 9 * * 1' },
  { label: 'Monthly (1st at 9 AM)', cron: '0 9 1 * *' },
];

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo',
];

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SettingsPage() {
  const router = useRouter();
  const { canAct } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>(canAct ? 'app' : 'appearance');
  const [orgs, setOrgs] = useState<Array<{ login: string }>>([]);
  const [selectedOrg, setSelectedOrg] = useState('');

  useEffect(() => {
    fetch('/api/orgs').then(r => r.json()).then((data: Array<{ login: string }>) => {
      setOrgs(data);
      if (data.length > 0 && !selectedOrg) setSelectedOrg(data[0].login);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <span
            className="text-2xl font-bold text-white cursor-pointer hover:text-accent-light transition-colors"
            onClick={() => router.push('/')}
          >
            Glooker
          </span>
          <span className="text-gray-600">/</span>
          <span className="text-lg font-semibold text-gray-400">Settings</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {([
          { id: 'schedules' as Tab, label: 'Schedules', icon: '🕐', adminOnly: true },
          { id: 'teams' as Tab, label: 'Teams', icon: '👥', adminOnly: true },
          { id: 'app' as Tab, label: 'App Settings', icon: '⚙️', adminOnly: true },
          { id: 'appearance' as Tab, label: 'Appearance', icon: '🎨', adminOnly: false },
        ]).filter(tab => !tab.adminOnly || canAct).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-white border-accent'
                : 'text-gray-500 border-transparent hover:text-gray-300 hover:border-gray-700'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'schedules' && <SchedulesTab />}
      {activeTab === 'teams' && selectedOrg && <TeamsTab org={selectedOrg} />}
      {activeTab === 'app' && <AppSettingsTab org={selectedOrg} />}
      {activeTab === 'appearance' && <AppearanceTab />}
    </div>
  );
}

/* ── Schedules Tab (real) ── */
function SchedulesTab() {
  const [orgs, setOrgs] = useState<Array<{ login: string }>>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [formOrg, setFormOrg] = useState('');
  const [formPeriod, setFormPeriod] = useState(14);
  const [formCadence, setFormCadence] = useState('0 9 * * 1-5');
  const [formCustomCron, setFormCustomCron] = useState('');
  const [isCustomCron, setIsCustomCron] = useState(false);
  const [formTz, setFormTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [formTestMode, setFormTestMode] = useState(false);
  const [formEnabled, setFormEnabled] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/orgs').then(r => r.json()).then(data => {
      setOrgs(data);
      if (data.length > 0 && !formOrg) setFormOrg(data[0].login);
    }).catch(() => {});
    loadSchedules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadSchedules() {
    fetch('/api/schedule').then(r => r.json()).then(setSchedules).catch(() => {});
  }

  function resetForm() {
    setFormOrg(orgs[0]?.login || '');
    setFormPeriod(14);
    setFormCadence('0 9 * * 1-5');
    setFormCustomCron('');
    setIsCustomCron(false);
    setFormTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    setFormTestMode(false);
    setFormEnabled(true);
    setEditing(null);
  }

  function openNew() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(s: any) {
    setEditing(s);
    setFormOrg(s.org);
    setFormPeriod(s.period_days);
    setFormTz(s.timezone);
    setFormTestMode(Boolean(s.test_mode));
    setFormEnabled(Boolean(s.enabled));
    const preset = CADENCE_PRESETS.find(p => p.cron === s.cron_expr);
    if (preset) {
      setFormCadence(preset.cron);
      setIsCustomCron(false);
      setFormCustomCron('');
    } else {
      setFormCadence('');
      setIsCustomCron(true);
      setFormCustomCron(s.cron_expr);
    }
    setShowForm(true);
  }

  async function save() {
    const cronExpr = isCustomCron ? formCustomCron : formCadence;
    const body = { org: formOrg, periodDays: formPeriod, cronExpr, timezone: formTz, testMode: formTestMode, enabled: formEnabled };
    try {
      if (editing) {
        const res = await fetch(`/api/schedule/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to update'); return; }
      } else {
        const res = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to create'); return; }
      }
      loadSchedules();
      setShowForm(false);
      resetForm();
    } catch { alert('Network error'); }
  }

  async function del(id: string) {
    try {
      await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
      loadSchedules();
      setDeletingId(null);
      if (editing?.id === id) { setShowForm(false); resetForm(); }
    } catch { alert('Network error'); }
  }

  async function toggle(s: any) {
    const body = { org: s.org, periodDays: s.period_days, cronExpr: s.cron_expr, timezone: s.timezone, testMode: Boolean(s.test_mode), enabled: !s.enabled };
    try {
      await fetch(`/api/schedule/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      loadSchedules();
    } catch { alert('Network error'); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">Scheduled report generation for your organizations.</p>
        <button onClick={openNew} className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-dark text-white rounded-lg transition-colors">
          + New Schedule
        </button>
      </div>

      {schedules.length === 0 && (
        <div className="text-center text-gray-600 py-12">No schedules yet. Create one to automate report generation.</div>
      )}

      {schedules.length > 0 && (
        <div className="bg-gray-900 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Timezone</th>
                <th className="px-4 py-3">Last Run</th>
                <th className="px-4 py-3">Next Run</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => {
                const presetLabel = CADENCE_PRESETS.find(p => p.cron === s.cron_expr)?.label || s.cron_expr;
                return deletingId === s.id ? (
                  <tr key={s.id} className="border-b border-gray-800/50">
                    <td colSpan={8} className="px-4 py-2.5">
                      <div className="rounded-lg bg-red-950 border border-red-800 px-3 py-2.5">
                        <p className="text-red-300 text-xs mb-2">Delete this schedule?</p>
                        <div className="flex gap-2">
                          <button onClick={() => del(s.id)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors">Delete</button>
                          <button onClick={() => setDeletingId(null)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{s.org}</td>
                    <td className="px-4 py-3 text-gray-300">{s.period_days}d</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{presetLabel}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.timezone}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.last_run_at ? (
                        <>
                          {timeAgo(s.last_run_at)}
                          {s.last_report_status && (
                            <span className={
                              s.last_report_status === 'completed' ? ' text-green-500' :
                              s.last_report_status === 'failed' ? ' text-red-400' :
                              s.last_report_status === 'running' ? ' text-accent-light' : ''
                            }> ({s.last_report_status})</span>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.next_run_at && s.enabled ? new Date(s.next_run_at).toLocaleString('en-US', {
                        timeZone: s.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggle(s)} className="inline-flex items-center gap-1.5">
                        <span className={`w-8 h-4 rounded-full transition-colors relative ${s.enabled ? 'bg-green-600' : 'bg-gray-700'}`}>
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${s.enabled ? 'left-4' : 'left-0.5'}`} />
                        </span>
                        <span className={`text-xs font-medium ${s.enabled ? 'text-green-400' : 'text-gray-600'}`}>
                          {s.enabled ? 'Active' : 'Paused'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(s)} className="text-xs text-gray-600 hover:text-gray-300 mr-3">Edit</button>
                      <button onClick={() => setDeletingId(s.id)} className="text-xs text-gray-600 hover:text-red-400">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Schedule form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowForm(false); resetForm(); }} />
          <div className="relative bg-gray-900 rounded-xl p-6 w-full max-w-lg border border-gray-800 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">{editing ? 'Edit Schedule' : 'New Schedule'}</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Org</label>
                <select value={formOrg} onChange={e => setFormOrg(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
                  {orgs.map(o => <option key={o.login} value={o.login}>{o.login}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Period</label>
                <select value={formPeriod} onChange={e => setFormPeriod(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
                  {[3, 14, 30, 90].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Cadence</label>
                <select
                  value={isCustomCron ? '__custom__' : formCadence}
                  onChange={e => {
                    if (e.target.value === '__custom__') { setIsCustomCron(true); setFormCadence(''); }
                    else { setIsCustomCron(false); setFormCadence(e.target.value); setFormCustomCron(''); }
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
                  {CADENCE_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
                  <option value="__custom__">Custom cron expression</option>
                </select>
                {isCustomCron && (
                  <input type="text" value={formCustomCron} onChange={e => setFormCustomCron(e.target.value)}
                    placeholder="e.g. 0 9 * * 1-5"
                    className="w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-accent" />
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Timezone</label>
                <select value={formTz} onChange={e => setFormTz(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent">
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-6 mt-4">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input type="checkbox" checked={formTestMode} onChange={e => setFormTestMode(e.target.checked)} className="rounded bg-gray-800 border-gray-700" />
                Test mode
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input type="checkbox" checked={formEnabled} onChange={e => setFormEnabled(e.target.checked)} className="rounded bg-gray-800 border-gray-700" />
                Enabled
              </label>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={save} className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors">
                {editing ? 'Update' : 'Create'} Schedule
              </button>
              {editing && deletingId !== editing.id && (
                <button onClick={() => setDeletingId(editing.id)} className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
                  Delete
                </button>
              )}
            </div>
            {editing && deletingId === editing.id && (
              <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950 border border-red-800">
                <p className="text-red-300 text-xs mb-2">Delete this schedule?</p>
                <div className="flex gap-2">
                  <button onClick={() => del(editing.id)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors">Delete</button>
                  <button onClick={() => setDeletingId(null)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Teams Tab (mock) ── */
const TEAM_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'];

function TeamsTab({ org }: { org: string }) {
  const [teams, setTeams] = useState<any[]>([]);
  const [devs, setDevs] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState<any | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(TEAM_COLORS[0]);
  const [formMembers, setFormMembers] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [memberHighlight, setMemberHighlight] = useState(0);
  const [searchingGithub, setSearchingGithub] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragLogin, setDragLogin] = useState<string | null>(null);
  const [dragOverTeamId, setDragOverTeamId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { loadTeams(); loadDevs(); }, [org]);

  function loadTeams() {
    fetch(`/api/teams?org=${org}`).then(r => r.json()).then(setTeams).catch(() => {});
  }
  function loadDevs() {
    fetch(`/api/developers?org=${org}`).then(r => r.json()).then(setDevs).catch(() => {});
  }

  function resetForm() {
    setFormName('');
    setFormColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]);
    setFormMembers([]);
    setEditingTeam(null);
    setMemberQuery('');
    setMemberResults([]);
  }

  function openNew() { resetForm(); setShowForm(true); }
  function openEdit(team: any) {
    setEditingTeam(team);
    setFormName(team.name);
    setFormColor(team.color);
    setFormMembers([...team.members]);
    setMemberQuery('');
    setMemberResults([]);
    setShowForm(true);
  }

  async function save() {
    const body = { org, name: formName, color: formColor, members: formMembers };
    try {
      if (editingTeam) {
        const res = await fetch(`/api/teams/${editingTeam.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return; }
      } else {
        const res = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return; }
      }
      loadTeams();
      setShowForm(false);
      resetForm();
    } catch { alert('Network error'); }
  }

  async function del(id: string) {
    await fetch(`/api/teams/${id}`, { method: 'DELETE' });
    loadTeams();
    setDeletingId(null);
    if (editingTeam?.id === id) { setShowForm(false); resetForm(); }
  }

  async function removeMemberFromTeam(teamId: string, login: string) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const newMembers = team.members.filter((m: string) => m !== login);
    await fetch(`/api/teams/${teamId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: newMembers }) });
    loadTeams();
  }

  async function dropMemberOnTeam(targetTeamId: string, login: string) {
    // Remove from source team (if any)
    const sourceTeam = teams.find(t => t.members.includes(login));
    if (sourceTeam && sourceTeam.id !== targetTeamId) {
      const newSourceMembers = sourceTeam.members.filter((m: string) => m !== login);
      await fetch(`/api/teams/${sourceTeam.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: newSourceMembers }) });
    }
    // Add to target team (if not already there)
    const targetTeam = teams.find(t => t.id === targetTeamId);
    if (targetTeam && !targetTeam.members.includes(login)) {
      const newTargetMembers = [...targetTeam.members, login];
      await fetch(`/api/teams/${targetTeamId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: newTargetMembers }) });
    }
    loadTeams();
  }

  // Member search with debounce
  function searchMembers(q: string) {
    setMemberQuery(q);
    setMemberHighlight(0);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q) { setMemberResults([]); return; }

    const lower = q.toLowerCase();
    const local = devs.filter(d =>
      !formMembers.includes(d.github_login) &&
      (d.github_login.toLowerCase().includes(lower) || (d.github_name || '').toLowerCase().includes(lower))
    ).slice(0, 8);
    setMemberResults(local);
    setSearchingGithub(false);

    // If no local results, debounce a GitHub search
    if (local.length === 0) {
      searchTimeout.current = setTimeout(async () => {
        setSearchingGithub(true);
        try {
          const res = await fetch(`/api/developers?org=${org}&q=${encodeURIComponent(q)}&source=github`);
          const data = await res.json();
          if (Array.isArray(data)) {
            setMemberResults(data.filter((d: any) => !formMembers.includes(d.github_login)).slice(0, 8));
          }
        } catch {}
        setSearchingGithub(false);
      }, 500);
    }
  }

  function addMember(login: string) {
    if (!formMembers.includes(login)) setFormMembers([...formMembers, login]);
    setMemberQuery('');
    setMemberResults([]);
  }

  const devMap = new Map(devs.map(d => [d.github_login, d]));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">Group developers into teams for aggregated analytics and filtering.</p>
        <button onClick={openNew} className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-dark text-white rounded-lg transition-colors">
          + New Team
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map(team => deletingId === team.id ? (
          <div key={team.id} className="bg-gray-900 rounded-xl p-5 border-t-2" style={{ borderTopColor: team.color }}>
            <div className="rounded-lg bg-red-950 border border-red-800 px-3 py-2.5">
              <p className="text-red-300 text-xs mb-2">Delete this team?</p>
              <div className="flex gap-2">
                <button onClick={() => del(team.id)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors">Delete</button>
                <button onClick={() => setDeletingId(null)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <div
            key={team.id}
            className={`bg-gray-900 rounded-xl p-5 border-t-2 transition-all ${dragOverTeamId === team.id ? 'ring-2 ring-accent/50 bg-gray-800' : ''}`}
            style={{ borderTopColor: team.color }}
            onDragOver={e => { e.preventDefault(); setDragOverTeamId(team.id); }}
            onDragLeave={() => setDragOverTeamId(null)}
            onDrop={e => { e.preventDefault(); setDragOverTeamId(null); if (dragLogin) dropMemberOnTeam(team.id, dragLogin); setDragLogin(null); }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: team.color }} />
                <h3 className="text-sm font-bold text-white">{team.name}</h3>
                <span className="text-xs text-gray-600">{team.members.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(team)} className="text-xs text-gray-600 hover:text-gray-300">Edit</button>
                <button onClick={() => setDeletingId(team.id)} className="text-xs text-gray-600 hover:text-red-400">Delete</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {team.members.map((login: string) => {
                const d = devMap.get(login);
                return (
                  <div
                    key={login}
                    draggable
                    onDragStart={() => setDragLogin(login)}
                    onDragEnd={() => { setDragLogin(null); setDragOverTeamId(null); }}
                    className={`flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5 border border-gray-700/50 cursor-grab active:cursor-grabbing group ${dragLogin === login ? 'opacity-40' : ''}`}
                  >
                    {d?.avatar_url && <img src={d.avatar_url} alt="" className="w-5 h-5 rounded-full" />}
                    {!d?.avatar_url && <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">{login[0]}</div>}
                    <span className="text-xs text-gray-300">{d?.github_name || login}</span>
                    <button
                      onClick={e => { e.stopPropagation(); removeMemberFromTeam(team.id, login); }}
                      className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs ml-0.5"
                    >&times;</button>
                  </div>
                );
              })}
              {team.members.length === 0 && !dragLogin && (
                <p className="text-xs text-gray-600 py-2">Drop members here</p>
              )}
            </div>
          </div>
        ))}

        {teams.length === 0 && (
          <div className="col-span-full text-center text-gray-600 py-8">No teams yet.</div>
        )}
      </div>

      {/* Not in a team */}
      {(() => {
        const assigned = new Set(teams.flatMap((t: any) => t.members));
        const unassigned = devs.filter(d => !assigned.has(d.github_login));
        if (unassigned.length === 0) return null;
        return (
          <div className="mt-6 bg-gray-900 rounded-xl p-5 border-t-2 border-t-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-gray-700" />
              <h3 className="text-sm font-bold text-gray-400">Not in a team</h3>
              <span className="text-xs text-gray-600">{unassigned.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {unassigned.map(d => (
                <div
                  key={d.github_login}
                  draggable
                  onDragStart={() => setDragLogin(d.github_login)}
                  onDragEnd={() => { setDragLogin(null); setDragOverTeamId(null); }}
                  className={`flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5 border border-gray-700/50 cursor-grab active:cursor-grabbing ${dragLogin === d.github_login ? 'opacity-40' : ''}`}
                >
                  {d.avatar_url && <img src={d.avatar_url} alt="" className="w-5 h-5 rounded-full" />}
                  {!d.avatar_url && <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">{d.github_login[0]}</div>}
                  <span className="text-xs text-gray-400">{d.github_name || d.github_login}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Team form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowForm(false); resetForm(); }} />
          <div className="relative bg-gray-900 rounded-xl p-6 w-full max-w-lg border border-gray-800 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">{editingTeam ? 'Edit Team' : 'New Team'}</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Name */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">Team Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Platform, Frontend, Data"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent" />
            </div>

            {/* Color */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">Color</label>
              <div className="flex gap-2">
                {TEAM_COLORS.map(c => (
                  <button key={c} onClick={() => setFormColor(c)}
                    className={`w-7 h-7 rounded-lg transition-all ${formColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110' : 'hover:scale-105'}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>

            {/* Members */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1 font-medium">Members</label>
              <div className="flex items-center gap-2 flex-wrap bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 focus-within:border-accent transition-colors">
                {formMembers.map(login => {
                  const d = devMap.get(login);
                  return (
                    <span key={login} className="inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2 py-1 rounded-lg border border-accent/30">
                      {d?.avatar_url && <img src={d.avatar_url} alt="" className="w-4 h-4 rounded-full" />}
                      {d?.github_name || login}
                      <button onClick={() => setFormMembers(formMembers.filter(m => m !== login))} className="text-accent-light hover:text-white ml-0.5">&times;</button>
                    </span>
                  );
                })}
                <div className="relative flex-1 min-w-[120px]">
                  {(() => {
                    const q = memberQuery.toLowerCase();
                    // Local matches from devs
                    let matches = q.length > 0
                      ? devs.filter(d =>
                          !formMembers.includes(d.github_login) &&
                          (d.github_login.toLowerCase().includes(q) || (d.github_name || '').toLowerCase().includes(q))
                        ).slice(0, 8)
                      : [];

                    const selectMatch = (login: string) => {
                      if (!formMembers.includes(login)) setFormMembers([...formMembers, login]);
                      setMemberQuery('');
                      setMemberHighlight(0);
                      setMemberResults([]);
                    };

                    // If no local matches and we have GitHub results, use those
                    if (matches.length === 0 && memberResults.length > 0) {
                      matches = memberResults.filter((d: any) => !formMembers.includes(d.github_login));
                    }

                    return (
                      <>
                        <input type="text" value={memberQuery}
                          onChange={e => { searchMembers(e.target.value); setMemberHighlight(0); }}
                          onFocus={() => setMemberHighlight(0)}
                          onBlur={() => setTimeout(() => { setMemberResults([]); }, 150)}
                          onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setMemberHighlight(h => Math.min(h + 1, matches.length - 1)); }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setMemberHighlight(h => Math.max(h - 1, 0)); }
                            else if (e.key === 'Enter' && matches.length > 0) { e.preventDefault(); selectMatch(matches[memberHighlight]?.github_login); }
                            else if (e.key === 'Escape') { setMemberResults([]); setMemberQuery(''); }
                            else if (e.key === 'Backspace' && memberQuery === '' && formMembers.length > 0) {
                              setFormMembers(formMembers.slice(0, -1));
                            }
                          }}
                          placeholder={formMembers.length > 0 ? 'Add more...' : 'Search by name or login...'}
                          className="w-full bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none py-0.5" />
                        {matches.length > 0 && (
                          <div className="absolute z-40 top-full mt-1 left-0 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                            {searchingGithub && <div className="px-3 py-1.5 text-[10px] text-gray-600 uppercase tracking-wider border-b border-gray-700">GitHub org results</div>}
                            {matches.map((d: any, idx: number) => (
                              <button key={d.github_login}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${idx === memberHighlight ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                                onMouseEnter={() => setMemberHighlight(idx)}
                                onMouseDown={e => { e.preventDefault(); selectMatch(d.github_login); }}>
                                {d.avatar_url && <img src={d.avatar_url} alt="" className="w-5 h-5 rounded-full" />}
                                <div>
                                  <span className="text-white">{d.github_name || d.github_login}</span>
                                  {d.github_name && <span className="text-gray-500 ml-1.5">@{d.github_login}</span>}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {searchingGithub && matches.length === 0 && (
                          <div className="absolute z-40 top-full mt-1 left-0 w-64 bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-500 flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Searching GitHub org...
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              {formMembers.length > 0 && (
                <button onClick={() => setFormMembers([])} className="text-xs text-gray-600 hover:text-gray-400 mt-1">Clear all</button>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={save} disabled={!formName.trim()}
                className="px-4 py-2 bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors">
                {editingTeam ? 'Update' : 'Create'} Team
              </button>
              {editingTeam && deletingId !== editingTeam.id && (
                <button onClick={() => setDeletingId(editingTeam.id)}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
                  Delete
                </button>
              )}
            </div>
            {editingTeam && deletingId === editingTeam.id && (
              <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950 border border-red-800">
                <p className="text-red-300 text-xs mb-2">Delete this team?</p>
                <div className="flex gap-2">
                  <button onClick={() => del(editingTeam.id)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors">Delete</button>
                  <button onClick={() => setDeletingId(null)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── LLM Settings Tab ── */
const PROVIDER_INFO: Record<string, { name: string; docs: string; envVars: string[] }> = {
  openai: {
    name: 'OpenAI',
    docs: 'https://platform.openai.com/api-keys',
    envVars: ['LLM_PROVIDER=openai', 'LLM_API_KEY=sk-...', 'LLM_MODEL=gpt-4o'],
  },
  anthropic: {
    name: 'Anthropic',
    docs: 'https://console.anthropic.com/settings/keys',
    envVars: ['LLM_PROVIDER=anthropic', 'LLM_API_KEY=sk-ant-...', 'LLM_MODEL=claude-sonnet-4-20250514'],
  },
  'openai-compatible': {
    name: 'OpenAI-Compatible (Ollama, vLLM, Azure)',
    docs: '',
    envVars: ['LLM_PROVIDER=openai-compatible', 'LLM_BASE_URL=http://localhost:11434/v1', 'LLM_MODEL=llama3', 'LLM_API_KEY=not-needed'],
  },
  smartling: {
    name: 'Smartling AI Proxy',
    docs: '',
    envVars: ['LLM_PROVIDER=smartling', 'SMARTLING_BASE_URL=https://api.smartling.com', 'SMARTLING_ACCOUNT_UID=...', 'SMARTLING_USER_IDENTIFIER=...', 'SMARTLING_USER_SECRET=...', 'LLM_MODEL=anthropic/claude-sonnet-4-20250514'],
  },
};

function AppSettingsTab({ org }: { org: string }) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Jira state
  const [jiraTesting, setJiraTesting] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState<{ success: boolean; error?: string; user?: { displayName: string; emailAddress: string } } | null>(null);
  const [mappings, setMappings] = useState<any[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [emailEdits, setEmailEdits] = useState<Record<string, string>>({});
  const [savingRow, setSavingRow] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/llm-config').then(r => r.json()).then(setConfig).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!config?.jira?.enabled || !org) return;
    setLoadingMappings(true);
    fetch(`/api/settings/user-mappings?org=${encodeURIComponent(org)}`)
      .then(r => r.json())
      .then(data => {
        setMappings(Array.isArray(data) ? data : []);
        const initial: Record<string, string> = {};
        (Array.isArray(data) ? data : []).forEach((m: any) => {
          initial[m.github_login] = m.jira_email || '';
        });
        setEmailEdits(initial);
      })
      .catch(() => {})
      .finally(() => setLoadingMappings(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, config?.jira?.enabled]);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/llm-config', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: 'Network error' });
    }
    setTesting(false);
  }

  async function testJiraConnection() {
    setJiraTesting(true);
    setJiraTestResult(null);
    try {
      const res = await fetch('/api/settings/jira/test-connection', { method: 'POST' });
      const data = await res.json();
      setJiraTestResult(data);
    } catch {
      setJiraTestResult({ success: false, error: 'Network error' });
    }
    setJiraTesting(false);
  }

  async function saveMapping(login: string) {
    setSavingRow(prev => ({ ...prev, [login]: true }));
    setRowErrors(prev => ({ ...prev, [login]: '' }));
    try {
      const res = await fetch('/api/settings/user-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org, github_login: login, jira_email: emailEdits[login] || '' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRowErrors(prev => ({ ...prev, [login]: data.error || 'Save failed' }));
      } else {
        setMappings(prev => prev.map(m =>
          m.github_login === login
            ? { ...m, jira_email: emailEdits[login] || null, jira_account_id: data.jira_account_id || null }
            : m,
        ));
      }
    } catch {
      setRowErrors(prev => ({ ...prev, [login]: 'Network error' }));
    }
    setSavingRow(prev => ({ ...prev, [login]: false }));
  }

  if (loading) return <div className="text-gray-500 text-sm py-8">Loading configuration...</div>;
  if (!config) return <div className="text-red-400 text-sm py-8">Failed to load configuration.</div>;

  const info = PROVIDER_INFO[config.provider] || PROVIDER_INFO['openai'];

  return (
    <div>
      <p className="text-sm text-gray-400 mb-6">Current app configuration (read-only). Edit <code className="text-xs bg-gray-800 px-1.5 py-0.5 rounded">.env.local</code> to change settings.</p>

      {/* Status */}
      <div className={`rounded-xl p-4 mb-6 flex items-center gap-3 ${config.ready ? 'bg-green-500/10 border border-green-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
        <span className="text-xl">{config.ready ? '✅' : '⚠️'}</span>
        <div>
          <p className={`text-sm font-semibold ${config.ready ? 'text-green-400' : 'text-amber-400'}`}>
            {config.ready ? 'LLM is configured and ready' : 'Configuration incomplete'}
          </p>
          {!config.ready && (
            <p className="text-xs text-gray-500 mt-0.5">
              Missing: {config.missing.map((v: string) => <code key={v} className="bg-gray-800 px-1 py-0.5 rounded text-amber-300 mx-0.5">{v}</code>)}
            </p>
          )}
        </div>
      </div>

      {/* Config details */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <ConfigRow label="Provider" value={info.name} />
          <ConfigRow label="Model" value={config.model} />
          <ConfigRow label="Concurrency" value={String(config.concurrency)} />
        </div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Connection Test</p>
          <button
            onClick={testConnection}
            disabled={testing || !config.ready}
            className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {testing && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
        {testResult && (
          <div className={`rounded-lg p-3 text-sm ${testResult.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
            {testResult.success ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-green-400 font-semibold">Success</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-400">Model: {testResult.model}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-400">{testResult.latencyMs}ms</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-500 font-mono text-xs">&quot;{testResult.response}&quot;</span>
              </div>
            ) : (
              <div>
                <span className="text-red-400 font-semibold">Failed</span>
                <span className="text-gray-500 ml-2">({testResult.latencyMs}ms)</span>
                <p className="text-xs text-red-300/70 mt-1 font-mono">{testResult.error}</p>
              </div>
            )}
          </div>
        )}
        {!testResult && !testing && (
          <p className="text-xs text-gray-600">Sends a simple test message to verify the LLM connection is working.</p>
        )}
      </div>

      {/* Per-Service LLM Settings */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Per-Service LLM Settings</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-4">Service</th>
                <th className="pb-2 pr-4">Temperature</th>
                <th className="pb-2 pr-4">Max Tokens</th>
                <th className="pb-2">Other</th>
              </tr>
            </thead>
            <tbody className="text-gray-300 font-mono">
              {[
                { name: 'Commit Analyzer', ...(config.analyzer || {}) },
                { name: 'Chat Agent', ...(config.chatAgent || {}) },
                { name: 'Dev Summary', ...(config.summary || {}) },
                { name: 'Report Highlights', ...(config.highlights || {}) },
                { name: 'Connection Test', ...(config.llmTest || {}) },
              ].map((s: any) => (
                <tr key={s.name} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4 text-gray-400 text-xs">{s.name}</td>
                  <td className="py-2 pr-4">{s.temperature}</td>
                  <td className="py-2 pr-4">{s.maxTokens}</td>
                  <td className="py-2 text-xs text-gray-500">{s.maxIterations ? `Max iterations: ${s.maxIterations}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Prompt Templates */}
      {config.promptsDir && (
        <div className="bg-gray-900 rounded-xl p-5 mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Prompt Templates</p>
          <ConfigRow label="Directory" value={config.promptsDir} />
        </div>
      )}

      {/* Secrets & Credentials */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Secrets & Credentials</p>
        <div className="grid grid-cols-3 gap-4">
          <ConfigRow label="GitHub Token" value={config.githubToken || '(not set)'} />
          <ConfigRow label="LLM API Key" value={config.llmApiKey || '(not set)'} />
          <ConfigRow label="Smartling Account UID" value={config.smartlingAccountUid || '(not set)'} />
          <ConfigRow label="Smartling User ID" value={config.smartlingUserIdentifier || '(not set)'} />
          <ConfigRow label="Smartling Secret" value={config.smartlingUserSecret || '(not set)'} />
        </div>
      </div>

      {/* Setup instructions */}
      {!config.ready && (
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Setup Instructions</p>
          <p className="text-sm text-gray-400 mb-3">
            Add the following to your <code className="text-xs bg-gray-800 px-1.5 py-0.5 rounded">.env.local</code> file:
          </p>
          <pre className="bg-gray-950 rounded-lg p-4 text-xs text-gray-300 font-mono leading-relaxed overflow-x-auto">
            {info.envVars.join('\n')}
          </pre>
          {info.docs && (
            <p className="text-xs text-gray-500 mt-3">
              Get your API key: <a href={info.docs} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter">{info.docs}</a>
            </p>
          )}
        </div>
      )}

      {/* Jira Configuration */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6 mt-6">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Jira Integration</p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Enabled</p>
            <p className={`text-sm font-mono ${config.jira?.enabled ? 'text-green-400' : 'text-gray-400'}`}>
              {config.jira?.enabled ? 'Yes' : 'No'}
            </p>
          </div>
          {config.jira?.enabled && (
            <>
              <ConfigRow label="Host" value={config.jira.host || '(not set)'} />
              <ConfigRow label="Username" value={config.jira.username || '(not set)'} />
              <ConfigRow label="API Token" value={config.jira.hasApiToken ? '••••••••' : '(not set)'} />
              <ConfigRow label="API Version" value={config.jira.apiVersion || '3'} />
              <ConfigRow label="Projects" value={config.jira.projects?.length > 0 ? config.jira.projects.join(', ') : '(all)'} />
              <ConfigRow
                label="Story Points Fields"
                value={config.jira.storyPointsFields?.length > 0
                  ? config.jira.storyPointsFields.join(', ')
                  : '(not configured)'}
              />
            </>
          )}
        </div>

        {config.jira?.enabled && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Connection Test</p>
              <button
                onClick={testJiraConnection}
                disabled={jiraTesting}
                className="px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {jiraTesting && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {jiraTesting ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {jiraTestResult && (
              <div className={`rounded-lg p-3 text-sm ${jiraTestResult.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                {jiraTestResult.success ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-green-400 font-semibold">Success</span>
                    <span className="text-gray-500">·</span>
                    <span className="text-gray-400">Connected as {jiraTestResult.user?.displayName || 'unknown'}</span>
                    {jiraTestResult.user?.emailAddress && (
                      <>
                        <span className="text-gray-500">·</span>
                        <span className="text-gray-500 font-mono text-xs">{jiraTestResult.user.emailAddress}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div>
                    <span className="text-red-400 font-semibold">Failed</span>
                    <p className="text-xs text-red-300/70 mt-1 font-mono">{jiraTestResult.error}</p>
                  </div>
                )}
              </div>
            )}
            {!jiraTestResult && !jiraTesting && (
              <p className="text-xs text-gray-600">Sends a test request to verify the Jira connection is working.</p>
            )}
          </div>
        )}
      </div>

      {/* Jira User Mappings */}
      {config.jira?.enabled && org && (
        <div className="bg-gray-900 rounded-xl p-5 mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Jira User Mappings</p>
          <p className="text-sm text-gray-400 mb-4">Map GitHub users to their Jira email addresses for issue attribution.</p>

          {loadingMappings ? (
            <div className="text-gray-500 text-sm py-4">Loading mappings...</div>
          ) : mappings.length === 0 ? (
            <div className="rounded-xl p-4 bg-accent\/10 border border-accent\/30 flex items-start gap-3">
              <span className="text-lg shrink-0">💡</span>
              <div>
                <p className="text-sm font-semibold text-accent-lighter mb-1">Jira is connected but no user mappings exist yet.</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Run a report to automatically map GitHub logins to Jira accounts using email matching.
                  Mappings are saved and reused across future reports.
                </p>
                <button
                  onClick={() => window.location.href = '/'}
                  className="mt-3 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-dark text-white rounded-lg transition-colors"
                >
                  Run Report →
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                    <th className="pb-2 pr-4">GitHub User</th>
                    <th className="pb-2 pr-4">Jira Email</th>
                    <th className="pb-2 pr-4">Jira Account</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m: any) => {
                    const currentEmail = emailEdits[m.github_login] ?? (m.jira_email || '');
                    const isDirty = currentEmail !== (m.jira_email || '');
                    return (
                      <tr key={m.github_login} className="border-b border-gray-800/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            {m.avatar_url && (
                              <img src={m.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                            )}
                            <span className="text-white">{m.github_name || m.github_login}</span>
                            {m.github_name && (
                              <span className="text-gray-500 text-xs">@{m.github_login}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="email"
                            value={currentEmail}
                            onChange={e => setEmailEdits(prev => ({ ...prev, [m.github_login]: e.target.value }))}
                            placeholder="user@example.com"
                            className="bg-gray-800 text-white border border-gray-700 rounded px-2 py-1 text-sm w-48"
                          />
                          {rowErrors[m.github_login] && (
                            <p className="text-xs text-red-400 mt-1">{rowErrors[m.github_login]}</p>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span className="text-gray-400 font-mono text-xs">
                            {m.jira_account_id ? `${m.jira_account_id.slice(0, 12)}...` : '—'}
                          </span>
                        </td>
                        <td className="py-2">
                          {isDirty && (
                            <button
                              onClick={() => saveMapping(m.github_login)}
                              disabled={savingRow[m.github_login]}
                              className="px-3 py-1 bg-accent hover:bg-accent-light disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors"
                            >
                              {savingRow[m.github_login] ? 'Saving...' : 'Save'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigRow({ label, value, status }: { label: string; value: string; status?: 'ok' | 'missing' }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-sm text-white font-mono">{value}</p>
        {status === 'ok' && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        {status === 'missing' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </div>
    </div>
  );
}


/* ── Appearance Tab ── */
function ThemeCard({ t, isActive, onSelect }: { t: ThemeColors; isActive: boolean; onSelect: () => void }) {
  const isLight = t.mode === 'light';
  return (
    <button
      onClick={onSelect}
      className={`rounded-xl p-5 text-left border-2 transition-all hover:-translate-y-0.5 ${
        isLight ? 'bg-white' : 'bg-gray-900'
      } ${
        isActive
          ? isLight ? 'border-gray-400 ring-1 ring-gray-300' : 'border-white/30 ring-1 ring-white/10'
          : isLight ? 'border-gray-200 hover:border-gray-300' : 'border-transparent hover:border-gray-800'
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg" style={{ background: t.accent }} />
        <div>
          <p className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{t.name}</p>
          {isActive && <p className={`text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Active</p>}
        </div>
      </div>
      {/* Color swatches */}
      <div className="flex gap-1.5">
        {[t.accentDarker, t.accentDark, t.accent, t.accentLight, t.accentLighter].map((hex, i) => (
          <div key={i} className="w-6 h-6 rounded" style={{ background: hex }} />
        ))}
      </div>
      {/* Mini preview */}
      <div className="mt-3 rounded-lg p-3" style={{ background: t.bodyBg, border: isLight ? '1px solid #e5e7eb' : 'none' }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="h-1.5 w-12 rounded-full" style={{ background: t.accentLight }} />
          <div className="h-1.5 w-8 rounded-full" style={{ background: isLight ? '#d1d5db' : '#374151' }} />
        </div>
        <div className="flex gap-1.5">
          <div className="h-6 flex-1 rounded" style={{ background: `color-mix(in srgb, ${t.accent} 20%, transparent)` }} />
          <div className="h-6 flex-1 rounded" style={{ background: isLight ? '#f3f4f6' : '#1f2937' }} />
          <div className="h-6 flex-1 rounded" style={{ background: isLight ? '#f3f4f6' : '#1f2937' }} />
        </div>
      </div>
    </button>
  );
}

function AppearanceTab() {
  const { theme, setThemeId } = useTheme();
  const darkThemes = THEMES.filter(t => t.mode === 'dark');
  const lightThemes = THEMES.filter(t => t.mode === 'light');

  return (
    <div>
      <p className="text-sm text-gray-400 mb-6">Choose your accent color scheme. Changes apply instantly.</p>

      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Dark</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {darkThemes.map(t => (
          <ThemeCard key={t.id} t={t} isActive={theme.id === t.id} onSelect={() => setThemeId(t.id)} />
        ))}
      </div>

      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Light</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {lightThemes.map(t => (
          <ThemeCard key={t.id} t={t} isActive={theme.id === t.id} onSelect={() => setThemeId(t.id)} />
        ))}
      </div>
    </div>
  );
}
