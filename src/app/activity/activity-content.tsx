'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/auth-context';
import { METRICS, METRIC_LABELS, type CalendarMetric, type CalendarResult } from '@/lib/activity-calendar/metrics';
import CalendarGrid from './calendar-grid';
import MemberLabel from './member-label';

interface Team { id: string; name: string; color: string; members?: string[] }
type CalendarResponse = CalendarResult & { team: Team; error?: string };

const fetchJson = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  return body;
};

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

export default function ActivityContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { enabled: authEnabled, user, loading } = useAuth();
  const isAdmin = !authEnabled || user?.role === 'admin';

  const { data: orgs } = useSWR<Array<{ login: string }>>(isAdmin ? '/api/orgs' : null);
  const org = params.get('org') ?? orgs?.[0]?.login ?? null;
  const { data: teams } = useSWR<Team[]>(isAdmin && org ? `/api/teams?org=${encodeURIComponent(org)}` : null);
  const teamId = params.get('team') ?? teams?.[0]?.id ?? null;
  const metric = (params.get('metric') ?? 'commits') as CalendarMetric;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    if (key === 'org') next.delete('team');
    router.replace(`/activity?${next.toString()}`);
  };

  // Put the defaults in the URL so the view can be shared as-is.
  useEffect(() => {
    if (org && teamId && (!params.get('org') || !params.get('team'))) {
      const next = new URLSearchParams(params.toString());
      next.set('org', org);
      next.set('team', teamId);
      router.replace(`/activity?${next.toString()}`);
    }
  }, [org, teamId, params, router]);

  const key = isAdmin && org && teamId
    ? `/api/activity-calendar?org=${encodeURIComponent(org)}&team=${encodeURIComponent(teamId)}&metric=${metric}`
    : null;
  const { data, error, isLoading } = useSWR<CalendarResponse>(key, fetchJson);

  if (loading) return null;
  if (!isAdmin) {
    return <main className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-400">Activity calendars are available to admins only.</main>;
  }

  const selectClass = 'bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-gray-200';
  return (
    <main className="max-w-[1100px] mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-gray-100">Activity calendars</h1>
          <p className="text-xs text-gray-500">Last 12 months, one row per engineer. Shades use one scale for the whole team.</p>
        </div>
        {orgs && orgs.length > 1 && (
          <select id="activity-org" aria-label="Organization" className={selectClass} value={org ?? ''} onChange={(e) => setParam('org', e.target.value)}>
            {orgs.map((o) => <option key={o.login} value={o.login}>{o.login}</option>)}
          </select>
        )}
        <select id="activity-team" aria-label="Team" className={selectClass} value={teamId ?? ''} onChange={(e) => setParam('team', e.target.value)}>
          {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select id="activity-metric" aria-label="Measure" className={selectClass} value={metric} onChange={(e) => setParam('metric', e.target.value)}>
          {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
        </select>
      </header>

      {teams && teams.length === 0 && <p className="text-sm text-gray-400">No teams yet. Create one in Settings → Teams.</p>}
      {error && (
        <p className="text-sm text-amber-400">
          {error.message === 'not_built'
            ? 'This org has no canonical tables yet. Run Rebuild in Settings to see activity.'
            : `Could not load activity: ${error.message}`}
        </p>
      )}
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && !error && (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 overflow-x-auto">
          {data.rows.length === 0 && <p className="text-sm text-gray-400">This team has no members.</p>}
          <div className="grid grid-cols-[170px_auto] gap-x-4 gap-y-2 items-center w-max">
            {data.rows.map((row, i) => (
              <div key={row.login} className="contents">
                <div className={`flex items-center gap-2 min-w-0 ${i === 0 ? 'pt-3' : ''}`}>
                  <MemberLabel row={row} totalLabel={`${fmt(row.total)} ${METRIC_LABELS[metric].toLowerCase()}`} />
                </div>
                <CalendarGrid
                  start={data.start} end={data.end} days={row.days} thresholds={data.thresholds}
                  color={data.team.color} unit={METRIC_LABELS[metric].toLowerCase()} showMonths={i === 0}
                />
              </div>
            ))}
          </div>
          {data.thresholds.length > 0 && (
            <p className="mt-4 text-[11px] text-gray-500 tabular-nums">
              Shades: ≤{fmt(data.thresholds[0])}, ≤{fmt(data.thresholds[1])}, ≤{fmt(data.thresholds[2])}, more per day
            </p>
          )}
        </section>
      )}
    </main>
  );
}
