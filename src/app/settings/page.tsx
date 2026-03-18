'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Tab = 'schedules' | 'teams';

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
  const [activeTab, setActiveTab] = useState<Tab>('schedules');

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <span
            className="text-2xl font-bold text-white cursor-pointer hover:text-blue-400 transition-colors"
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
          { id: 'schedules' as Tab, label: 'Schedules', icon: '🕐' },
          { id: 'teams' as Tab, label: 'Teams', icon: '👥' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-white border-blue-500'
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
      {activeTab === 'teams' && <TeamsTab />}
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
    if (!confirm('Delete this schedule?')) return;
    try {
      await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
      loadSchedules();
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
        <button onClick={openNew} className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
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
                return (
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
                              s.last_report_status === 'running' ? ' text-blue-400' : ''
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
                      <button onClick={() => del(s.id)} className="text-xs text-gray-600 hover:text-red-400">Delete</button>
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                  {orgs.map(o => <option key={o.login} value={o.login}>{o.login}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Period</label>
                <select value={formPeriod} onChange={e => setFormPeriod(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                  {CADENCE_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
                  <option value="__custom__">Custom cron expression</option>
                </select>
                {isCustomCron && (
                  <input type="text" value={formCustomCron} onChange={e => setFormCustomCron(e.target.value)}
                    placeholder="e.g. 0 9 * * 1-5"
                    className="w-full mt-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500" />
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Timezone</label>
                <select value={formTz} onChange={e => setFormTz(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
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
              <button onClick={save} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
                {editing ? 'Update' : 'Create'} Schedule
              </button>
              {editing && (
                <button onClick={() => del(editing.id)} className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Teams Tab (mock) ── */
function TeamsTab() {
  const teams = [
    {
      id: '1', name: 'Platform', color: '#3B82F6',
      members: [
        { login: 'alice', name: 'Alice Chen', avatar: 'https://i.pravatar.cc/32?u=alice' },
        { login: 'bob', name: 'Bob Smith', avatar: 'https://i.pravatar.cc/32?u=bob' },
        { login: 'carol', name: 'Carol Wang', avatar: 'https://i.pravatar.cc/32?u=carol' },
        { login: 'dave', name: 'Dave Park', avatar: 'https://i.pravatar.cc/32?u=dave' },
      ],
    },
    {
      id: '2', name: 'Frontend', color: '#10B981',
      members: [
        { login: 'eve', name: 'Eve Johnson', avatar: 'https://i.pravatar.cc/32?u=eve' },
        { login: 'frank', name: 'Frank Lee', avatar: 'https://i.pravatar.cc/32?u=frank' },
      ],
    },
    {
      id: '3', name: 'Data & ML', color: '#F59E0B',
      members: [
        { login: 'grace', name: 'Grace Kim', avatar: 'https://i.pravatar.cc/32?u=grace' },
        { login: 'hank', name: 'Hank Patel', avatar: 'https://i.pravatar.cc/32?u=hank' },
        { login: 'ivy', name: 'Ivy Torres', avatar: 'https://i.pravatar.cc/32?u=ivy' },
      ],
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">Group developers into teams for aggregated analytics and filtering.</p>
        <button className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
          + New Team
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map(team => (
          <div key={team.id} className="bg-gray-900 rounded-xl p-5 border-t-2" style={{ borderTopColor: team.color }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: team.color }} />
                <h3 className="text-sm font-bold text-white">{team.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button className="text-xs text-gray-600 hover:text-gray-300">Edit</button>
                <button className="text-xs text-gray-600 hover:text-red-400">Delete</button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">{team.members.length} members</p>
            <div className="space-y-2">
              {team.members.map(m => (
                <div key={m.login} className="flex items-center gap-2.5 group">
                  <img src={m.avatar} alt="" className="w-6 h-6 rounded-full" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-300">{m.name}</span>
                    <span className="text-xs text-gray-600 ml-1.5">@{m.login}</span>
                  </div>
                  <button className="text-xs text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              + Add member
            </button>
          </div>
        ))}

        <button className="bg-gray-900/50 rounded-xl p-5 border-2 border-dashed border-gray-800 hover:border-gray-700 transition-colors flex flex-col items-center justify-center gap-2 min-h-[200px]">
          <span className="text-2xl text-gray-700">+</span>
          <span className="text-sm text-gray-600">Create team</span>
        </button>
      </div>
    </div>
  );
}
