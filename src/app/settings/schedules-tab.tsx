'use client';

import { useState, useEffect } from 'react';

const CADENCE_PRESETS = [
  { label: 'Every hour',           cron: '0 * * * *' },
  { label: 'Daily at midnight',    cron: '0 0 * * *' },
  { label: 'Daily at 6 AM',        cron: '0 6 * * *' },
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

/* ── Schedules Tab (real) ── */
export default function SchedulesTab() {
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
      const res = await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to delete'); setDeletingId(null); return; }
      loadSchedules();
      setDeletingId(null);
      if (editing?.id === id) { setShowForm(false); resetForm(); }
    } catch { alert('Network error'); }
  }

  async function toggle(s: any) {
    const body = { org: s.org, periodDays: s.period_days, cronExpr: s.cron_expr, timezone: s.timezone, testMode: Boolean(s.test_mode), enabled: !s.enabled };
    try {
      const res = await fetch(`/api/schedule/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to update'); return; }
      loadSchedules();
    } catch { alert('Network error'); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">Scheduled data pulls: Commits &amp; PRs reports and the Dependabot alerts sync.</p>
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
                <th className="px-4 py-3">Type</th>
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
                    <td colSpan={9} className="px-4 py-2.5">
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
                    <td className="px-4 py-3 text-gray-300 text-xs">{s.kind === 'vuln_sync' ? 'Dependabot alerts' : 'Commits & PRs'}</td>
                    <td className="px-4 py-3 text-white font-medium">{s.org}</td>
                    <td className="px-4 py-3 text-gray-300">{s.kind === 'vuln_sync' ? '—' : `${s.period_days}d`}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{presetLabel}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.timezone}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.last_run_at ? (
                        <>
                          {timeAgo(s.last_run_at)}
                          {s.last_report_status && (
                            <span className={
                              s.last_report_status === 'completed' || s.last_report_status === 'succeeded' ? ' text-green-500' :
                              s.last_report_status === 'partial' ? ' text-amber-400' :
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
                      {s.kind !== 'vuln_sync' && (
                        <button onClick={() => setDeletingId(s.id)} className="text-xs text-gray-600 hover:text-red-400">Delete</button>
                      )}
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
            {editing?.kind === 'vuln_sync' && (
              <p className="text-xs text-gray-500 mb-3">Dependabot alerts sync for {editing.org}. It can be paused but not deleted.</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              {!(editing?.kind === 'vuln_sync') && (<>
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
              </>)}
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
              {!(editing?.kind === 'vuln_sync') && <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input type="checkbox" checked={formTestMode} onChange={e => setFormTestMode(e.target.checked)} className="rounded bg-gray-800 border-gray-700" />
                Test mode
              </label>}
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input type="checkbox" checked={formEnabled} onChange={e => setFormEnabled(e.target.checked)} className="rounded bg-gray-800 border-gray-700" />
                Enabled
              </label>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={save} className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors">
                {editing ? 'Update' : 'Create'} Schedule
              </button>
              {editing && editing.kind !== 'vuln_sync' && deletingId !== editing.id && (
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

